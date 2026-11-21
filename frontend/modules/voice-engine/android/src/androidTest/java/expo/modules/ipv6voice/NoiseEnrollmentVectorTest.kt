package expo.modules.ipv6voice

import android.test.InstrumentationTestCase
import com.southernstorm.noise.protocol.HandshakeState
import org.json.JSONObject

class NoiseEnrollmentVectorTest : InstrumentationTestCase() {
  fun testNoiseIkReferenceVector() {
    val bytes = instrumentation.context.assets.open("IK_25519_ChaChaPoly_SHA256.json")
      .bufferedReader().use { it.readText() }
    val vector = JSONObject(bytes).getJSONObject("vector")
    fun hex(value: String) = value.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    val handshake = HandshakeState(vector.getString("name"), HandshakeState.INITIATOR)
    try {
      handshake.localKeyPair.setPrivateKey(hex(vector.getString("init_static")), 0)
      handshake.fixedEphemeralKey.setPrivateKey(hex(vector.getString("init_ephemeral")), 0)
      handshake.remotePublicKey.setPublicKey(hex(vector.getString("init_remote_static")), 0)
      val prologue = hex(vector.getString("init_prologue"))
      handshake.setPrologue(prologue, 0, prologue.size)
      handshake.start()
      val messages = vector.getJSONArray("messages")
      val first = messages.getJSONObject(0)
      val input = hex(first.getString("payload"))
      val expected = hex(first.getString("ciphertext"))
      val output = ByteArray(expected.size)
      assertEquals(expected.size, handshake.writeMessage(output, 0, input, 0, input.size))
      assertTrue(expected.contentEquals(output))
      val second = messages.getJSONObject(1)
      val ciphertext = hex(second.getString("ciphertext"))
      val plaintext = hex(second.getString("payload"))
      val decrypted = ByteArray(plaintext.size)
      assertEquals(plaintext.size, handshake.readMessage(ciphertext, 0, ciphertext.size, decrypted, 0))
      assertTrue(plaintext.contentEquals(decrypted))
      assertEquals(HandshakeState.SPLIT, handshake.action)
    } finally {
      handshake.destroy()
    }
  }
}
