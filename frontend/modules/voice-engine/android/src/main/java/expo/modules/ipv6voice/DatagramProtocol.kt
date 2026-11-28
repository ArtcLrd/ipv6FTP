package expo.modules.ipv6voice

import com.southernstorm.noise.protocol.CipherState
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.TreeMap

internal object DatagramProtocol {
  const val VERSION: Byte = 1
  const val MAX_DATAGRAM = 1200
  const val HEADER_SIZE = 28
  const val TAG_SIZE = 16

  const val PROBE: Byte = 1
  const val VERIFICATION: Byte = 2
  const val AUDIO: Byte = 3
  const val ACKNOWLEDGEMENT: Byte = 4
  const val KEEPALIVE: Byte = 5
  const val CALL_END: Byte = 6

  data class Packet(val type: Byte, val sequence: Long, val timestamp: Int, val plaintext: ByteArray)

  @Synchronized
  fun encrypt(
    cipher: CipherState,
    type: Byte,
    connectionTag: ByteArray,
    epoch: Int,
    sequence: Long,
    timestamp: Int,
    plaintext: ByteArray,
  ): ByteArray {
    require(connectionTag.size == 8)
    require(plaintext.size + HEADER_SIZE + TAG_SIZE <= MAX_DATAGRAM)
    val header = ByteBuffer.allocate(HEADER_SIZE).order(ByteOrder.BIG_ENDIAN)
      .put(VERSION)
      .put(type)
      .put(connectionTag)
      .putInt(epoch)
      .putLong(sequence)
      .putInt(timestamp)
      .putShort((plaintext.size + TAG_SIZE).toShort())
      .array()
    cipher.setNonce(sequence)
    val ciphertext = ByteArray(plaintext.size + TAG_SIZE)
    val length = cipher.encryptWithAd(header, plaintext, 0, ciphertext, 0, plaintext.size)
    return header + ciphertext.copyOf(length)
  }

  class Receiver(
    private val cipher: CipherState,
    private val connectionTag: ByteArray,
    private val epoch: Int,
    private val jitterDeadlineMs: Long = 60,
  ) {
    private data class Queued(val packet: Packet, val arrivedAt: Long)
    private val queued = TreeMap<Long, Queued>()
    private var nextSequence = 0L

    @Synchronized
    fun offer(datagram: ByteArray, nowMs: Long = System.currentTimeMillis()): List<Packet> {
      val parsedSequence = validateHeader(datagram) ?: return emptyList()
      if (parsedSequence < nextSequence || queued.containsKey(parsedSequence)) return emptyList()
      if (parsedSequence - nextSequence > 256 || queued.size >= 128) return emptyList()
      val packet = decrypt(datagram) ?: return emptyList()
      queued[parsedSequence] = Queued(packet, nowMs)
      val output = mutableListOf<Packet>()
      while (queued.isNotEmpty()) {
        var candidate = queued[nextSequence]
        if (candidate == null) {
          val first = queued.firstEntry()
          if (nowMs - first.value.arrivedAt < jitterDeadlineMs) break
          nextSequence = first.key
          candidate = first.value
        }
        val sequence = nextSequence
        queued.remove(sequence)
        output.add(candidate.packet)
        nextSequence = sequence + 1
      }
      return output
    }

    private fun validateHeader(bytes: ByteArray): Long? {
      if (bytes.size !in (HEADER_SIZE + TAG_SIZE)..MAX_DATAGRAM) return null
      val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
      if (buffer.get() != VERSION) return null
      val type = buffer.get()
      if (type !in PROBE..CALL_END) return null
      val tag = ByteArray(8).also(buffer::get)
      if (!tag.contentEquals(connectionTag)) return null
      if (buffer.int != epoch) return null
      val sequence = buffer.long
      if (sequence < 0 || sequence == Long.MAX_VALUE) return null
      buffer.int
      val length = buffer.short.toInt() and 0xffff
      if (length != bytes.size - HEADER_SIZE || length < TAG_SIZE) return null
      return sequence
    }

    private fun decrypt(bytes: ByteArray): Packet? = try {
      val header = bytes.copyOfRange(0, HEADER_SIZE)
      val buffer = ByteBuffer.wrap(header).order(ByteOrder.BIG_ENDIAN)
      buffer.get()
      val type = buffer.get()
      buffer.position(buffer.position() + 8)
      buffer.int
      val sequence = buffer.long
      val timestamp = buffer.int
      val payloadLength = buffer.short.toInt() and 0xffff
      val plaintext = ByteArray(payloadLength - TAG_SIZE)
      cipher.setNonce(sequence)
      val length = cipher.decryptWithAd(header, bytes, HEADER_SIZE, plaintext, 0, payloadLength)
      Packet(type, sequence, timestamp, plaintext.copyOf(length))
    } catch (_: Exception) {
      null
    }

    fun destroy() = cipher.destroy()
  }
}
