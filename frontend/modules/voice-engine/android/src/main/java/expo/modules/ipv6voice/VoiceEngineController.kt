package expo.modules.ipv6voice

import android.content.Context
import android.content.Intent
import android.util.Base64
import androidx.core.content.ContextCompat
import java.nio.ByteBuffer
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal object VoiceRuntime {
  @Volatile var controller: VoiceEngineController? = null
  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null
}

internal class VoiceEngineController(private val context: Context) {
  private val identities = SecureIdentityStore(context)
  private var state = "idle"
  private var activeCallId: String? = null
  private var activeAttemptId: String? = null
  private var accountScope = ""
  private var remoteDeviceId = ""
  private var keyEpoch = 0
  private var noise: NoiseSession? = null
  private var handshakeResult: HandshakeResult? = null
  private var transport: DirectTransport? = null
  private var audio: AudioPipeline? = null
  private var muted = false
  private var speaker = false
  private val localConfirmed = AtomicBoolean(false)
  private val remoteConfirmed = AtomicBoolean(false)
  private val inboundReachable = AtomicBoolean(false)
  private val outboundReachable = AtomicBoolean(false)
  private val sentPackets = AtomicLong(0)
  private val receivedPackets = AtomicLong(0)
  private val droppedPackets = AtomicLong(0)
  private var lastError: String? = null

  fun getOrCreateIdentity(scope: String): String = Base64.encodeToString(
    identities.publicIdentity(scope),
    Base64.NO_WRAP or Base64.NO_PADDING,
  )

  fun identityFingerprint(scope: String): String? = identities.identityFingerprint(scope)

  fun removeProfile(scope: String, username: String) = identities.removeProfile(scope, username)

  fun hasIdentity(scope: String): Boolean = identities.hasIdentity(scope)

  @Synchronized
  fun prepare(options: Map<String, Any?>) {
    end("replaced")
    activeCallId = options.string("callId")
    activeAttemptId = options.string("attemptId")
    accountScope = options.string("accountScope")
    remoteDeviceId = options.string("remoteDeviceId")
    keyEpoch = (options["keyEpoch"] as? Number)?.toInt() ?: 1
    val initiator = options["initiator"] as? Boolean ?: false
    val remoteKey = Base64.decode(options.string("expectedRemotePublicKey"), Base64.DEFAULT)
    require(remoteKey.size == 32) { "expected remote Noise key must be 32 bytes" }
    setState("preparing")
    val identity = if (accountScope.startsWith("principal:")) {
      requireNotNull(identities.loadExisting(accountScope)) { "Enrolled device identity is unavailable" }
    } else {
      identities.loadOrCreate(accountScope)
    }
    try {
      noise = NoiseSession(context, accountScope, remoteDeviceId, remoteKey, identity.privateKey, initiator)
      setState("handshaking")
      noise?.initialFrame()?.let(::emitHandshake)
    } catch (error: Exception) {
      identity.privateKey.fill(0)
      fail("HANDSHAKE_PREPARE_FAILED", error)
      throw error
    }
  }

  @Synchronized
  fun consumeHandshake(encoded: String) {
    try {
      val (outgoing, result) = requireNotNull(noise) { "call is not prepared" }
        .consume(Base64.decode(encoded, Base64.DEFAULT))
      outgoing?.let(::emitHandshake)
      result?.let(::onHandshakeComplete)
    } catch (error: Exception) {
      fail("NOISE_HANDSHAKE_FAILED", error)
      throw error
    }
  }

  private fun onHandshakeComplete(result: HandshakeResult) {
    val attempt = requireNotNull(activeAttemptId)
    handshakeResult = result
    transport = DirectTransport(
      context,
      keyEpoch,
      result.connectionTag,
      result.sender,
      result.receiver,
      { packet -> withAttempt(attempt) { onDirectPacket(packet) } },
    ) { message -> withAttempt(attempt) { fail("DIRECT_CONNECTION_FAILED", IllegalStateException(message)) } }
    if (result.remembered) localConfirmed.set(true)
    setState("verifying")
    emit(
      "onVerification",
      mapOf(
        "code" to result.verificationCode,
        "remembered" to result.remembered,
        "remotePublicKey" to Base64.encodeToString(result.remotePublicKey, Base64.NO_WRAP),
      ),
    )
  }

  @Synchronized
  fun registerDirect(ticket: Map<String, Any?>): String {
    setState("discovering")
    return try {
      requireNotNull(transport) { "Noise handshake is incomplete" }.register(
        ticket.string("ticketId"),
        ticket.string("secret"),
        ticket.string("rendezvousHost"),
        (ticket["rendezvousPort"] as Number).toInt(),
      )
    } catch (error: Exception) {
      fail("IPV6_UNAVAILABLE", error)
      throw error
    }
  }

  @Synchronized
  fun setDirectEndpoint(endpoint: String) {
    requireNotNull(transport) { "Noise handshake is incomplete" }.setPeer(endpoint)
    setState("connecting")
    if (localConfirmed.get()) sendVerification()
  }

  @Synchronized
  fun confirmPeer() {
    val result = requireNotNull(handshakeResult) { "verification code is not ready" }
    noise?.remember(result.remotePublicKey)
    localConfirmed.set(true)
    if (transport != null) sendVerification()
    maybeStartAudio()
  }

  private fun sendVerification() {
    transport?.send(DatagramProtocol.VERIFICATION, "confirmed-v1".toByteArray(Charsets.US_ASCII), true)
    sentPackets.incrementAndGet()
  }

  private fun onDirectPacket(packet: DatagramProtocol.Packet) {
    receivedPackets.incrementAndGet()
    when (packet.type) {
      DatagramProtocol.PROBE -> {
        inboundReachable.set(true)
        val payload = ByteBuffer.allocate(8).putLong(packet.sequence).array()
        transport?.send(DatagramProtocol.ACKNOWLEDGEMENT, payload, true)
        sentPackets.incrementAndGet()
      }
      DatagramProtocol.ACKNOWLEDGEMENT -> outboundReachable.set(true)
      DatagramProtocol.VERIFICATION -> {
        if (packet.plaintext.contentEquals("confirmed-v1".toByteArray(Charsets.US_ASCII))) remoteConfirmed.set(true)
      }
      DatagramProtocol.AUDIO -> if (state == "active") audio?.decode(packet.plaintext, packet.timestamp)
      DatagramProtocol.CALL_END -> end("peer_hangup")
      DatagramProtocol.KEEPALIVE -> Unit
    }
    maybeStartAudio()
  }

  @Synchronized
  private fun maybeStartAudio() {
    if (state == "active" || !localConfirmed.get() || !remoteConfirmed.get() || !inboundReachable.get() || !outboundReachable.get()) return
    try {
      val attempt = requireNotNull(activeAttemptId)
      ContextCompat.startForegroundService(context, Intent(context, NativeVoiceService::class.java))
      audio = AudioPipeline(
        context,
        { bytes, timestamp ->
          withAttempt(attempt) {
            transport?.send(DatagramProtocol.AUDIO, bytes)
            sentPackets.incrementAndGet()
          }
        },
      ) { message -> withAttempt(attempt) { fail("AUDIO_FAILED", IllegalStateException(message)) } }.also {
        it.setMuted(muted)
        it.setSpeaker(speaker)
        it.start()
      }
      setState("active")
    } catch (error: Exception) {
      fail("AUDIO_START_FAILED", error)
    }
  }

  fun setMuted(value: Boolean) {
    muted = value
    audio?.setMuted(value)
  }

  fun setOutputRoute(route: String) {
    require(route == "earpiece" || route == "speaker")
    speaker = route == "speaker"
    audio?.setSpeaker(speaker)
  }

  @Synchronized
  fun end(reason: String = "normal") {
    if (state != "idle" && activeAttemptId != null) setState("ended", reason)
    activeAttemptId = null
    activeCallId = null
    audio?.stop(); audio = null
    transport?.close(); transport = null
    noise?.destroy(); noise = null
    handshakeResult = null
    localConfirmed.set(false); remoteConfirmed.set(false)
    inboundReachable.set(false); outboundReachable.set(false)
    context.stopService(Intent(context, NativeVoiceService::class.java))
    state = "idle"
  }

  fun diagnostics(): Map<String, Any?> = mapOf(
    "state" to state,
    "muted" to muted,
    "speaker" to speaker,
    "keyEpoch" to keyEpoch,
    "sentPackets" to sentPackets.get(),
    "receivedPackets" to receivedPackets.get(),
    "droppedPackets" to droppedPackets.get(),
    "lastError" to lastError,
  )

  private fun emitHandshake(frame: ByteArray) = emit(
    "onHandshakeFrame",
    mapOf("frame" to Base64.encodeToString(frame, Base64.NO_WRAP)),
  )

  private fun setState(next: String, reason: String? = null) {
    state = next
    emit("onCallState", buildMap { put("state", next); reason?.let { put("reason", it) } })
  }

  private fun fail(code: String, error: Exception) {
    lastError = error.message ?: code
    setState("failed", lastError)
    emit("onError", mapOf("code" to code, "message" to (lastError ?: code)))
    audio?.stop(); audio = null
  }

  @Synchronized
  private fun withAttempt(attempt: String, action: () -> Unit) {
    if (activeAttemptId == attempt) action()
  }

  private fun emit(name: String, payload: Map<String, Any?>) {
    val callId = activeCallId ?: return
    val attemptId = activeAttemptId ?: return
    VoiceRuntime.emit?.invoke(name, payload + mapOf("callId" to callId, "attemptId" to attemptId))
  }

  private fun Map<String, Any?>.string(key: String): String = (this[key] as? String)?.trim().orEmpty().also {
    require(it.isNotEmpty()) { "$key is required" }
  }
}
