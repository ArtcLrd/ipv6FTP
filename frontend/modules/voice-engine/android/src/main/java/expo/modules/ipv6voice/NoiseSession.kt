package expo.modules.ipv6voice

import android.content.Context
import android.util.Base64
import com.southernstorm.noise.protocol.CipherState
import com.southernstorm.noise.protocol.HandshakeState
import java.security.MessageDigest

internal data class HandshakeResult(
  val verificationCode: String,
  val remotePublicKey: ByteArray,
  val connectionTag: ByteArray,
  val sender: CipherState,
  val receiver: CipherState,
  val remembered: Boolean,
)

internal class NoiseSession(
  private val context: Context,
  private val accountScope: String,
  private val remoteDeviceId: String,
  private val expectedRemotePublicKey: ByteArray,
  localPrivateKey: ByteArray,
  private val initiator: Boolean,
) {
  companion object {
    const val PROFILE = "Noise_XX_25519_ChaChaPoly_SHA256"
    private val EMPTY = ByteArray(0)
    private const val SAS_CONTEXT = "ipv6ftp-peer-verification-v1"
  }

  private val handshake = HandshakeState(PROFILE, if (initiator) HandshakeState.INITIATOR else HandshakeState.RESPONDER)
  private var completed = false

  init {
    handshake.localKeyPair.setPrivateKey(localPrivateKey, 0)
    localPrivateKey.fill(0)
    handshake.setPrologue("ipv6ftp-direct-voice-v1".toByteArray(Charsets.UTF_8), 0, 23)
    handshake.start()
  }

  fun initialFrame(): ByteArray? = if (handshake.action == HandshakeState.WRITE_MESSAGE) writeFrame() else null

  fun consume(frame: ByteArray): Pair<ByteArray?, HandshakeResult?> {
    check(!completed) { "handshake is already complete" }
    check(handshake.action == HandshakeState.READ_MESSAGE) { "unexpected Noise frame" }
    val payload = ByteArray(256)
    handshake.readMessage(frame, 0, frame.size, payload, 0)
    val outgoing = if (handshake.action == HandshakeState.WRITE_MESSAGE) writeFrame() else null
    return outgoing to finishIfReady()
  }

  private fun writeFrame(): ByteArray {
    val output = ByteArray(512)
    val length = handshake.writeMessage(output, 0, EMPTY, 0, 0)
    return output.copyOf(length)
  }

  private fun finishIfReady(): HandshakeResult? {
    if (handshake.action != HandshakeState.SPLIT) return null
    val remoteKey = ByteArray(handshake.remotePublicKey.publicKeyLength).also {
      handshake.remotePublicKey.getPublicKey(it, 0)
    }
    if (!MessageDigest.isEqual(remoteKey, expectedRemotePublicKey)) {
      destroy()
      throw SecurityException("remote device key differs from the authenticated account device")
    }
    val hash = handshake.handshakeHash
    val localKey = ByteArray(handshake.localKeyPair.publicKeyLength).also {
      handshake.localKeyPair.getPublicKey(it, 0)
    }
    val ordered = listOf(localKey, remoteKey).sortedWith { a, b -> compareBytes(a, b) }
    val digest = MessageDigest.getInstance("SHA-256")
    digest.update(SAS_CONTEXT.toByteArray(Charsets.UTF_8))
    digest.update(0)
    digest.update(hash)
    digest.update(ordered[0])
    digest.update(ordered[1])
    val sas = digest.digest()
    val value = ((sas[0].toLong() and 0xff) shl 32) or
      ((sas[1].toLong() and 0xff) shl 24) or
      ((sas[2].toLong() and 0xff) shl 16) or
      ((sas[3].toLong() and 0xff) shl 8) or (sas[4].toLong() and 0xff)
    val digits = (value % 1_000_000_000_000L).toString().padStart(12, '0')
    val code = digits.chunked(3).joinToString(" ")
    val pair = handshake.split()
    completed = true
    val keyString = Base64.encodeToString(remoteKey, Base64.NO_WRAP)
    val pinned = context.getSharedPreferences("ipv6_voice_peers_v1", Context.MODE_PRIVATE)
      .getString("${accountScope.trim().lowercase()}|$remoteDeviceId", null)
    return HandshakeResult(code, remoteKey, hash.copyOfRange(0, 8), pair.sender, pair.receiver, pinned == keyString)
  }

  fun remember(remotePublicKey: ByteArray) {
    context.getSharedPreferences("ipv6_voice_peers_v1", Context.MODE_PRIVATE).edit()
      .putString(
        "${accountScope.trim().lowercase()}|$remoteDeviceId",
        Base64.encodeToString(remotePublicKey, Base64.NO_WRAP),
      ).apply()
  }

  fun destroy() {
    handshake.destroy()
  }

  private fun compareBytes(left: ByteArray, right: ByteArray): Int {
    for (i in left.indices) {
      val difference = (left[i].toInt() and 0xff) - (right[i].toInt() and 0xff)
      if (difference != 0) return difference
    }
    return left.size - right.size
  }
}
