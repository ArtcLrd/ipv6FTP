package expo.modules.ipv6voice

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Base64
import com.southernstorm.noise.protocol.HandshakeState
import org.json.JSONObject
import java.nio.ByteBuffer
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/** One in-flight Noise IK initiator, separate from the voice handshake. */
internal class EnrollmentHandshake(context: Context) {
  private val identities = SecureIdentityStore(context)
  private val pins = context.getSharedPreferences("ipv6_enrollment_server_pins_v1", Context.MODE_PRIVATE)
  private val handler = Handler(Looper.getMainLooper())
  private var pending: Pending? = null

  private data class Pending(
    val challenge: String,
    val principal: String,
    val origin: String,
    val pin: String,
    val expiresAt: Long,
    val noise: HandshakeState,
    val legacyIdentity: DeviceIdentity?,
    val legacyScope: String?,
    val signer: String?,
    val epoch: Long,
  ) {
    fun destroy() {
      legacyIdentity?.privateKey?.fill(0)
      noise.destroy()
    }
  }

  @Synchronized
  fun begin(
    challenge: String,
    principal: String,
    nonce: String,
    serverKey: String,
    keyId: String,
    origin: String,
    ttlSeconds: Int,
    legacyScope: String?,
    rotation: Map<*, *>?,
  ): String {
    cancel()
    require(UUID_PATTERN.matches(challenge) && UUID_PATTERN.matches(principal))
    require(ttlSeconds in 1..300 && origin.startsWith("https://"))
    require(keyId.matches(Regex("[A-Za-z0-9_-]{1,64}")))
    val remote = decode(serverKey, 43, 43)
    val challengeNonce = decode(nonce, 43, 43)
    require(remote.size == 32 && challengeNonce.size == 32)
    val pin = "$keyId:$serverKey"
    val existingPin = pins.getString(origin, null)
    val trustedSigner = pins.getString("signer:$origin", null)
    val trustedEpoch = pins.getLong("epoch:$origin", 0)
    val signer = rotation?.get("signer") as? String
    val epoch = (rotation?.get("epoch") as? Number)?.toLong() ?: 0
    if (rotation != null) {
      require(signer != null && epoch in 1L..0xffffffffL)
      check(trustedSigner == null || trustedSigner == signer) { "Enrollment signer changed" }
      val verifier = Signature.getInstance("SHA256withECDSA")
      val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(decode(signer, 122, 122)))
      verifier.initVerify(publicKey)
      val bytes = ByteArrayOutputStream()
      DataOutputStream(bytes).use { statement ->
        for (part in listOf("ipv6ftp/enrollment-key/v1".toByteArray(), origin.toByteArray(), keyId.toByteArray(), remote)) {
          statement.writeShort(part.size)
          statement.write(part)
        }
        statement.writeInt(epoch.toInt())
      }
      verifier.update(bytes.toByteArray())
      check(verifier.verify(decode(rotation["signature"] as String, 11, 96))) { "Enrollment rotation signature invalid" }
    }
    check(epoch >= trustedEpoch) { "Enrollment key rollback" }
    if (existingPin != null && existingPin != pin) {
      check(trustedSigner != null && signer == trustedSigner && epoch > trustedEpoch) { "Enrollment server key changed" }
    }

    val scope = scope(principal)
    val (identity, fromLegacy) = identities.enrollmentIdentity(scope, legacyScope)
    val legacy = identity.takeIf { fromLegacy }
    var noise: HandshakeState? = null
    try {
      val initiator = HandshakeState("Noise_IK_25519_ChaChaPoly_SHA256", HandshakeState.INITIATOR)
      noise = initiator
      initiator.localKeyPair.setPrivateKey(identity.privateKey, 0)
      initiator.remotePublicKey.setPublicKey(remote, 0)
      val prefix = "ipv6ftp/noise-ik/v1/enroll\u0000".toByteArray(Charsets.UTF_8)
      val id = challenge.toByteArray(Charsets.UTF_8)
      val prologue = ByteBuffer.allocate(prefix.size + 4 + id.size + challengeNonce.size)
        .put(prefix).putShort(id.size.toShort()).put(id)
        .putShort(challengeNonce.size.toShort()).put(challengeNonce).array()
      initiator.setPrologue(prologue, 0, prologue.size)
      initiator.start()
      val output = ByteArray(96)
      val length = initiator.writeMessage(output, 0, ByteArray(0), 0, 0)
      check(length == output.size)
      val state = Pending(challenge, principal, origin, pin, SystemClock.elapsedRealtime() + ttlSeconds * 1000L, initiator, legacy, legacyScope, signer, epoch)
      pending = state
      handler.postDelayed({ expire(state) }, ttlSeconds * 1000L)
      return Base64.encodeToString(output, FLAGS)
    } finally {
      if (legacy == null || pending == null) identity.privateKey.fill(0)
      if (pending == null) noise?.destroy()
    }
  }

  @Synchronized
  fun finish(challenge: String, message: String): String {
    val state = checkNotNull(pending) { "Enrollment is no longer pending" }
    check(state.challenge == challenge) { "Enrollment challenge changed" }
    pending = null
    val plaintext = ByteArray(4096)
    try {
      check(SystemClock.elapsedRealtime() < state.expiresAt) { "Enrollment expired" }
      val frame = decode(message, 64, 5462)
      require(frame.size in 48..4096)
      val length = state.noise.readMessage(frame, 0, frame.size, plaintext, 0)
      check(state.noise.action == HandshakeState.SPLIT)
      val grant = String(plaintext, 0, length, Charsets.UTF_8)
      val payload = JSONObject(grant)
      check(payload.getString("principal_id") == state.principal) { "Enrollment account changed" }
      state.legacyIdentity?.let { identities.linkProvenIdentity(scope(state.principal), it, requireNotNull(state.legacyScope)) }
      val edit = pins.edit().putString(state.origin, state.pin)
      if (state.signer != null) {
        check(payload.optString("rotation_signer") == state.signer) { "Enrollment signer was not authenticated" }
        edit.putString("signer:${state.origin}", state.signer).putLong("epoch:${state.origin}", state.epoch)
      }
      check(edit.commit()) { "Could not persist enrollment server pin" }
      return grant
    } finally {
      plaintext.fill(0)
      state.destroy()
    }
  }

  @Synchronized
  fun cancel(challenge: String? = null) {
    if (challenge != null && pending?.challenge != challenge) return
    pending?.destroy()
    pending = null
  }

  @Synchronized
  private fun expire(state: Pending) {
    if (pending === state) cancel()
  }

  private fun decode(value: String, min: Int, max: Int): ByteArray {
    require(value.length in min..max && BASE64URL.matches(value))
    val bytes = Base64.decode(value, FLAGS)
    require(Base64.encodeToString(bytes, FLAGS) == value) { "Invalid base64url encoding" }
    return bytes
  }

  companion object {
    private const val FLAGS = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
    private val UUID_PATTERN = Regex("[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}")
    private val BASE64URL = Regex("[A-Za-z0-9_-]+")
    private fun scope(principal: String) = "principal:$principal"
  }
}
