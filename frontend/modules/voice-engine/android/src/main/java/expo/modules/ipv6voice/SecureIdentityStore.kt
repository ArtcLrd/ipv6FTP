package expo.modules.ipv6voice

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import com.southernstorm.noise.protocol.Noise
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.AEADBadTagException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class DeviceIdentity(val publicKey: ByteArray, val privateKey: ByteArray)

private class MissingWrappingKey : SecurityException("Device identity wrapping key is unavailable")

internal class SecureIdentityStore(private val context: Context) {
  companion object {
    private val identityLock = Any()
  }
  private val preferences = context.getSharedPreferences("ipv6_voice_identity_v1", Context.MODE_PRIVATE)
  private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

  fun publicIdentity(scope: String): ByteArray = loadOrCreate(scope).useIdentity { it.publicKey.copyOf() }

  private fun usableIdentity(scope: String): DeviceIdentity? {
    val identity = try {
      loadExisting(scope) ?: return null
    } catch (_: IllegalArgumentException) {
      return null
    } catch (_: AEADBadTagException) {
      return null
    } catch (_: MissingWrappingKey) {
      return null
    } catch (_: KeyPermanentlyInvalidatedException) {
      return null
    }
    var usable = false
    try {
      val dh = Noise.createDH("25519")
      try {
        if (identity.privateKey.size != dh.privateKeyLength) return null
        dh.setPrivateKey(identity.privateKey, 0)
        val publicKey = ByteArray(dh.publicKeyLength).also { dh.getPublicKey(it, 0) }
        usable = MessageDigest.isEqual(identity.publicKey, publicKey)
        return if (usable) identity else null
      } finally {
        dh.destroy()
      }
    } finally {
      if (!usable) identity.privateKey.fill(0)
    }
  }

  fun identityFingerprint(scope: String): String? = usableIdentity(scope)?.useIdentity { identity ->
    MessageDigest.getInstance("SHA-256").digest(identity.publicKey).joinToString("") { "%02x".format(it) }
  }

  // Called after the server issued a password-authenticated enrollment challenge.
  fun enrollmentIdentity(scope: String, legacyScope: String?): Pair<DeviceIdentity, Boolean> =
    synchronized(identityLock) {
      usableIdentity(scope)?.let { return@synchronized it to false }
      val id = scopeId(scope)
      val hasUnusableRecord = preferences.contains("identity_$id")
      if (!hasUnusableRecord && !legacyScope.isNullOrBlank()) {
        usableIdentity(legacyScope)?.let { return@synchronized it to true }
      }
      // Write the replacement atomically. Access errors from the Keystore propagate
      // before this point and leave the existing record available for retry.
      createIdentity(id) to false
    }

  fun hasIdentity(scope: String): Boolean = loadExisting(scope)?.useIdentity { true } ?: false

  fun loadExisting(scope: String): DeviceIdentity? = synchronized(identityLock) {
    val id = scopeId(scope)
    preferences.getString("identity_$id", null)?.let { decrypt(id, it) }
  }

  fun linkProvenIdentity(scope: String, identity: DeviceIdentity, legacyScope: String) = synchronized(identityLock) {
    val peers = context.getSharedPreferences("ipv6_voice_peers_v1", Context.MODE_PRIVATE)
    val oldPrefix = legacyScope.trim().lowercase() + "|"
    val newPrefix = scope.trim().lowercase() + "|"
    val peerEdit = peers.edit()
    for ((key, value) in peers.all) {
      if (key.startsWith(oldPrefix) && value is String) {
        val target = newPrefix + key.removePrefix(oldPrefix)
        if (!peers.contains(target)) peerEdit.putString(target, value)
      }
    }
    check(peerEdit.commit()) { "Could not link trusted peers" }
    val existing = loadExisting(scope)
    if (existing != null) {
      existing.useIdentity {
        check(MessageDigest.isEqual(it.publicKey, identity.publicKey)) { "Account identity changed" }
      }
    } else {
      val id = scopeId(scope)
      check(preferences.edit().putString("identity_$id", encrypt(id, identity.publicKey, identity.privateKey))
        .putString("legacy_$id", legacyScope).commit()) {
        "Could not persist account identity"
      }
    }
  }

  fun removeProfile(scope: String, username: String) = synchronized(identityLock) {
    val id = scopeId(scope)
    val linkedScope = preferences.getString("legacy_$id", null)
    // Older builds did not record the alias. Compare keys before removing it.
    val legacy = linkedScope ?: username.takeIf {
      scope != username && identityFingerprint(scope)?.let { identityFingerprint(username) == it } == true
    }
    if (legacy != null && linkedScope == null) {
      check(preferences.edit().putString("legacy_$id", legacy).commit())
    }
    val scopes = listOfNotNull(scope, legacy).distinct()
    val peers = context.getSharedPreferences("ipv6_voice_peers_v1", Context.MODE_PRIVATE)
    val peerEdit = peers.edit()
    for (account in scopes) {
      val prefix = account.trim().lowercase() + "|"
      peers.all.keys.filter { it.startsWith(prefix) }.forEach { peerEdit.remove(it) }
      keyStore.deleteEntry("ipv6_voice_${scopeId(account)}")
    }
    check(peerEdit.commit())
    val edit = preferences.edit().remove("legacy_$id")
    scopes.forEach { edit.remove("identity_${scopeId(it)}") }
    check(edit.commit())
  }

  fun loadOrCreate(scope: String): DeviceIdentity = synchronized(identityLock) {
    require(scope.isNotBlank()) { "account scope is required" }
    val id = scopeId(scope)
    val stored = preferences.getString("identity_$id", null)
    if (stored != null) return decrypt(id, stored)
    createIdentity(id)
  }

  private fun createIdentity(id: String): DeviceIdentity {
    val dh = Noise.createDH("25519")
    try {
      dh.generateKeyPair()
      val publicKey = ByteArray(dh.publicKeyLength).also { dh.getPublicKey(it, 0) }
      val privateKey = ByteArray(dh.privateKeyLength).also { dh.getPrivateKey(it, 0) }
      try {
        check(preferences.edit().putString("identity_$id", encrypt(id, publicKey, privateKey)).commit()) {
          "Could not persist account identity"
        }
        return DeviceIdentity(publicKey, privateKey)
      } catch (error: Exception) {
        privateKey.fill(0)
        throw error
      }
    } finally {
      dh.destroy()
    }
  }

  private fun encrypt(id: String, publicKey: ByteArray, privateKey: ByteArray): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    try {
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateWrappingKey(id))
    } catch (_: KeyPermanentlyInvalidatedException) {
      keyStore.deleteEntry("ipv6_voice_$id")
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateWrappingKey(id))
    }
    cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
    val encrypted = cipher.doFinal(privateKey)
    return listOf(publicKey, cipher.iv, encrypted).joinToString(".") {
      Base64.encodeToString(it, Base64.NO_WRAP)
    }
  }

  private fun decrypt(id: String, encoded: String): DeviceIdentity {
    val parts = encoded.split('.')
    require(parts.size == 3) { "invalid stored device identity" }
    val publicKey = Base64.decode(parts[0], Base64.DEFAULT)
    val iv = Base64.decode(parts[1], Base64.DEFAULT)
    val ciphertext = Base64.decode(parts[2], Base64.DEFAULT)
    require(publicKey.size == 32 && iv.size == 12 && ciphertext.size == 48) { "invalid stored device identity" }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    val key = keyStore.getKey("ipv6_voice_$id", null) as? SecretKey
      ?: throw MissingWrappingKey()
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
    cipher.updateAAD(id.toByteArray(Charsets.UTF_8))
    return DeviceIdentity(publicKey, cipher.doFinal(ciphertext))
  }

  private fun getOrCreateWrappingKey(id: String): SecretKey {
    val alias = "ipv6_voice_$id"
    (keyStore.getKey(alias, null) as? SecretKey)?.let { return it }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .build()
    )
    return generator.generateKey()
  }

  private fun scopeId(scope: String): String = MessageDigest.getInstance("SHA-256")
    .digest(scope.trim().lowercase().toByteArray(Charsets.UTF_8))
    .take(16)
    .joinToString("") { "%02x".format(it) }
}

private inline fun <T> DeviceIdentity.useIdentity(block: (DeviceIdentity) -> T): T = try {
  block(this)
} finally {
  privateKey.fill(0)
}
