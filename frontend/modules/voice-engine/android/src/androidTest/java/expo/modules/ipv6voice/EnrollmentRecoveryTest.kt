package expo.modules.ipv6voice

import android.content.Context
import android.test.InstrumentationTestCase
import android.util.Base64
import com.southernstorm.noise.protocol.HandshakeState
import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.json.JSONObject

class EnrollmentRecoveryTest : InstrumentationTestCase() {
  private val flags = Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING
  private fun encode(bytes: ByteArray) = Base64.encodeToString(bytes, flags)
  private fun decode(value: String) = Base64.decode(value, flags)

  fun testBackupWithoutWrappingKeyRequiresProofAndRecovers() {
    val context = instrumentation.targetContext
    val principal = UUID.randomUUID().toString()
    val scope = "principal:$principal"
    val store = SecureIdentityStore(context)
    val origin = "https://${UUID.randomUUID()}.test"
    val handshake = EnrollmentHandshake(context)
    val oldKey = store.publicIdentity(scope)
    val id = MessageDigest.getInstance("SHA-256").digest(scope.toByteArray())
      .take(16).joinToString("") { "%02x".format(it) }
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val alias = "ipv6_voice_$id"
    val responder = responder()
    try {
      keyStore.deleteEntry(alias)
      assertNull(store.identityFingerprint(scope))
      assertFalse(keyStore.containsAlias(alias))

      val challenge = UUID.randomUUID().toString()
      val first = handshake.begin(challenge, principal, encode(nonce), publicKey(responder),
        "k1", origin, 120, null, null)
      val grant = JSONObject().put("principal_id", principal).toString().toByteArray()
      assertEquals(String(grant), handshake.finish(challenge, finishMessage(responder, challenge, first, grant)))
      assertFalse(oldKey.contentEquals(store.publicIdentity(scope)))
      assertNotNull(store.identityFingerprint(scope))
    } finally {
      responder.destroy()
      handshake.cancel()
      store.removeProfile(scope, "")
      removePins(context, origin)
    }
  }

  fun testRotationChecksSignatureOriginEpochAndInterruptedProof() {
    val context = instrumentation.targetContext
    val principal = UUID.randomUUID().toString()
    val origin = "https://${UUID.randomUUID()}.test"
    val signer = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    val signerPublic = encode(signer.public.encoded)
    val grants = JSONObject().put("principal_id", principal).put("rotation_signer", signerPublic).toString().toByteArray()
    val oldResponder = responder()
    val newResponder = responder()
    val oldKey = publicKey(oldResponder)
    val newKey = publicKey(newResponder)
    val handshake = EnrollmentHandshake(context)
    val pins = context.getSharedPreferences("ipv6_enrollment_server_pins_v1", Context.MODE_PRIVATE)
    fun metadata(id: String, key: String, epoch: Int, signedOrigin: String = origin): Map<String, Any> {
      val bytes = ByteArrayOutputStream()
      DataOutputStream(bytes).use { statement ->
        for (part in listOf("ipv6ftp/enrollment-key/v1".toByteArray(), signedOrigin.toByteArray(), id.toByteArray(), decode(key))) {
          statement.writeShort(part.size)
          statement.write(part)
        }
        statement.writeInt(epoch)
      }
      val sig = Signature.getInstance("SHA256withECDSA").apply {
        initSign(signer.private)
        update(bytes.toByteArray())
      }
      return mapOf("signer" to signerPublic, "signature" to encode(sig.sign()), "epoch" to epoch)
    }
    fun begin(id: String, key: String, rotation: Map<String, Any>?): Pair<String, String> {
      val challenge = UUID.randomUUID().toString()
      return challenge to handshake.begin(challenge, principal, encode(nonce), key, id, origin, 120, null, rotation)
    }
    fun rejected(expected: String, block: () -> Unit) {
      try {
        block()
        fail("Expected rejection: $expected")
      } catch (error: IllegalStateException) {
        assertEquals(expected, error.message)
      }
    }
    try {
      assertTrue(pins.edit().putString(origin, "k1:$oldKey").commit())
      rejected("Enrollment server key changed") { begin("k2", newKey, metadata("k2", newKey, 2)) }
      val (initial, first) = begin("k1", oldKey, metadata("k1", oldKey, 1))
      handshake.finish(initial, finishMessage(oldResponder, initial, first, grants))
      assertEquals(signerPublic, pins.getString("signer:$origin", null))
      rejected("Enrollment rotation signature invalid") { begin("k2", newKey, metadata("k1", newKey, 2)) }
      rejected("Enrollment rotation signature invalid") { begin("k2", newKey, metadata("k2", newKey, 2, "https://wrong.test")) }
      val (interrupted, _) = begin("k2", newKey, metadata("k2", newKey, 2))
      handshake.cancel(interrupted)
      assertEquals("k1:$oldKey", pins.getString(origin, null))
      assertEquals(1L, pins.getLong("epoch:$origin", 0L))
      val (replacement, next) = begin("k2", newKey, metadata("k2", newKey, 2))
      handshake.finish(replacement, finishMessage(newResponder, replacement, next, grants))
      assertEquals("k2:$newKey", pins.getString(origin, null))
      rejected("Enrollment key rollback") { begin("k1", oldKey, metadata("k1", oldKey, 1)) }
    } finally {
      oldResponder.destroy()
      newResponder.destroy()
      handshake.cancel()
      SecureIdentityStore(context).removeProfile("principal:$principal", "")
      removePins(context, origin)
    }
  }

  fun testLegacyKeyAndTrustContinuityAndScopedRemoval() {
    val context = instrumentation.targetContext
    val principal = UUID.randomUUID().toString()
    val scope = "principal:$principal"
    val legacyScope = "legacy-${UUID.randomUUID()}"
    val unrelatedScope = "unrelated-${UUID.randomUUID()}"
    val origin = "https://${UUID.randomUUID()}.test"
    val identities = SecureIdentityStore(context)
    val peers = context.getSharedPreferences("ipv6_voice_peers_v1", Context.MODE_PRIVATE)
    val handshake = EnrollmentHandshake(context)
    val server = responder()
    try {
      val legacyKey = identities.publicIdentity(legacyScope)
      val unrelatedKey = identities.publicIdentity(unrelatedScope)
      assertTrue(peers.edit().putString("$legacyScope|peer", "trusted")
        .putString("$unrelatedScope|peer", "unrelated").commit())
      val challenge = UUID.randomUUID().toString()
      val first = handshake.begin(challenge, principal, encode(nonce), publicKey(server),
        "k1", origin, 120, legacyScope, null)
      assertNull(identities.identityFingerprint(scope))
      val grant = JSONObject().put("principal_id", principal).toString().toByteArray()
      handshake.finish(challenge, finishMessage(server, challenge, first, grant))
      assertTrue(legacyKey.contentEquals(identities.publicIdentity(scope)))
      assertEquals("trusted", peers.getString("$scope|peer", null))

      identities.removeProfile(scope, "")
      identities.removeProfile(scope, "")
      assertNull(identities.identityFingerprint(scope))
      assertNull(identities.identityFingerprint(legacyScope))
      assertFalse(peers.contains("$scope|peer"))
      assertFalse(peers.contains("$legacyScope|peer"))
      assertTrue(unrelatedKey.contentEquals(identities.publicIdentity(unrelatedScope)))
      assertEquals("unrelated", peers.getString("$unrelatedScope|peer", null))
    } finally {
      server.destroy()
      handshake.cancel()
      identities.removeProfile(scope, "")
      identities.removeProfile(legacyScope, "")
      identities.removeProfile(unrelatedScope, "")
      removePins(context, origin)
    }
  }

  fun testConcurrentEnrollmentUsesOneScopedKey() {
    val context = instrumentation.targetContext
    val scope = "principal:${UUID.randomUUID()}"
    val start = CountDownLatch(1)
    val executor = Executors.newFixedThreadPool(2)
    try {
      val reads = List(2) {
        executor.submit<ByteArray> {
          val store = SecureIdentityStore(context)
          check(start.await(5, TimeUnit.SECONDS))
          val (identity, _) = store.enrollmentIdentity(scope, null)
          identity.privateKey.fill(0)
          identity.publicKey
        }
      }
      start.countDown()
      assertTrue(reads[0].get(10, TimeUnit.SECONDS).contentEquals(reads[1].get(10, TimeUnit.SECONDS)))
    } finally {
      executor.shutdownNow()
      SecureIdentityStore(context).removeProfile(scope, "")
    }
  }

  private fun responder() = HandshakeState("Noise_IK_25519_ChaChaPoly_SHA256", HandshakeState.RESPONDER)
    .apply { localKeyPair.generateKeyPair() }

  private fun publicKey(state: HandshakeState) =
    encode(ByteArray(32).also { state.localKeyPair.getPublicKey(it, 0) })

  private fun finishMessage(state: HandshakeState, challenge: String, first: String, grant: ByteArray): String {
    val bytes = ByteArrayOutputStream()
    DataOutputStream(bytes).use { prologue ->
      prologue.write("ipv6ftp/noise-ik/v1/enroll\u0000".toByteArray())
      prologue.writeShort(challenge.length)
      prologue.write(challenge.toByteArray())
      prologue.writeShort(nonce.size)
      prologue.write(nonce)
    }
    val prologue = bytes.toByteArray()
    state.setPrologue(prologue, 0, prologue.size)
    state.start()
    val message = decode(first)
    assertEquals(96, message.size)
    assertEquals(0, state.readMessage(message, 0, message.size, ByteArray(1), 0))
    val output = ByteArray(grant.size + 48)
    assertEquals(output.size, state.writeMessage(output, 0, grant, 0, grant.size))
    return encode(output)
  }

  private fun removePins(context: Context, origin: String) {
    context.getSharedPreferences("ipv6_enrollment_server_pins_v1", Context.MODE_PRIVATE)
      .edit().remove(origin).remove("signer:$origin").remove("epoch:$origin").commit()
  }

  private val nonce = ByteArray(32) { it.toByte() }
}
