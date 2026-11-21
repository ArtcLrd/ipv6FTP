package expo.modules.ipv6voice

import android.content.Context
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.util.Base64
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

internal class DirectTransport(
  context: Context,
  private val keyEpoch: Int,
  private val connectionTag: ByteArray,
  senderCipher: com.southernstorm.noise.protocol.CipherState,
  receiverCipher: com.southernstorm.noise.protocol.CipherState,
  private val onPacket: (DatagramProtocol.Packet) -> Unit,
  private val onFailure: (String) -> Unit,
) {
  private val connectivity = context.getSystemService(ConnectivityManager::class.java)
  private val network = connectivity.activeNetwork ?: error("No active network")
  private val socket = DatagramSocket(null)
  private val executor: ScheduledExecutorService = Executors.newScheduledThreadPool(3)
  private val sender = senderCipher
  private val receiver = DatagramProtocol.Receiver(receiverCipher, connectionTag, keyEpoch)
  private val sequence = AtomicLong(0)
  private val running = AtomicBoolean(false)
  private var peer: InetSocketAddress? = null

  init {
    val properties: LinkProperties = connectivity.getLinkProperties(network) ?: error("No active network properties")
    check(properties.linkAddresses.any { isPublicIPv6(it.address) }) { "Active network has no public IPv6 address" }
    socket.reuseAddress = false
    socket.bind(InetSocketAddress(0))
    network.bindSocket(socket)
  }

  fun register(ticketId: String, encodedSecret: String, host: String, port: Int): String {
    check(!running.get()) { "direct transport is already receiving" }
    val server = network.getAllByName(host).firstOrNull { isPublicIPv6(it) }
      ?: throw IllegalArgumentException("rendezvous host has no public IPv6 address")
    val nonceBytes = ByteArray(16).also(SecureRandom()::nextBytes)
    val nonce = Base64.encodeToString(nonceBytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    val secret = Base64.decode(encodedSecret, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    val text = "1|$ticketId|$nonce"
    val request = JSONObject()
      .put("version", 1)
      .put("ticket_id", ticketId)
      .put("nonce", nonce)
      .put("mac", hmacHex(secret, text))
      .toString().toByteArray(Charsets.UTF_8)
    check(request.size <= DatagramProtocol.MAX_DATAGRAM)
    socket.soTimeout = 5_000
    socket.send(DatagramPacket(request, request.size, InetSocketAddress(server, port)))
    val responseBytes = ByteArray(DatagramProtocol.MAX_DATAGRAM)
    val response = DatagramPacket(responseBytes, responseBytes.size)
    socket.receive(response)
    val json = JSONObject(String(response.data, response.offset, response.length, Charsets.UTF_8))
    val endpoint = json.getString("endpoint")
    val responseText = "1|registered|${json.getString("call_id")}|$endpoint|$nonce"
    check(json.getString("nonce") == nonce && constantTimeEquals(json.getString("mac"), hmacHex(secret, responseText))) {
      "invalid rendezvous acknowledgement"
    }
    socket.soTimeout = 0
    secret.fill(0)
    return endpoint
  }

  fun setPeer(endpoint: String) {
    peer = parseLiteralPublicIPv6(endpoint)
    if (running.compareAndSet(false, true)) {
      executor.execute(::receiveLoop)
      executor.scheduleAtFixedRate({ if (running.get()) send(DatagramProtocol.KEEPALIVE, ByteArray(0), false) }, 10, 10, TimeUnit.SECONDS)
    }
    send(DatagramProtocol.PROBE, byteArrayOf(1), true)
  }

  fun send(type: Byte, plaintext: ByteArray, repeat: Boolean = false): Long {
    val destination = peer ?: error("peer endpoint is not set")
    val seq = sequence.getAndIncrement()
    val timestamp = (System.nanoTime() / 1_000_000L).toInt()
    val encoded = DatagramProtocol.encrypt(sender, type, connectionTag, keyEpoch, seq, timestamp, plaintext)
    val attempts = if (repeat) 3 else 1
    repeat(attempts) { attempt ->
      executor.schedule({
        if (running.get()) {
          try {
            socket.send(DatagramPacket(encoded, encoded.size, destination))
          } catch (error: Exception) {
            onFailure(error.message ?: "UDP send failed")
          }
        }
      }, attempt * 120L, TimeUnit.MILLISECONDS)
    }
    return seq
  }

  private fun receiveLoop() {
    val data = ByteArray(DatagramProtocol.MAX_DATAGRAM + 1)
    while (running.get()) {
      try {
        val incoming = DatagramPacket(data, data.size)
        socket.receive(incoming)
        val expected = peer ?: continue
        if (incoming.length > DatagramProtocol.MAX_DATAGRAM || incoming.address != expected.address || incoming.port != expected.port) continue
        receiver.offer(incoming.data.copyOfRange(incoming.offset, incoming.offset + incoming.length)).forEach(onPacket)
      } catch (error: Exception) {
        if (running.get()) onFailure(error.message ?: "UDP receive failed")
      }
    }
  }

  fun close() {
    if (running.getAndSet(false) && peer != null) {
      try { send(DatagramProtocol.CALL_END, ByteArray(0), true) } catch (_: Exception) { }
    }
    socket.close()
    executor.shutdownNow()
    sender.destroy()
    receiver.destroy()
  }

  private fun parseLiteralPublicIPv6(value: String): InetSocketAddress {
    val endBracket = value.lastIndexOf(']')
    require(value.startsWith("[") && endBracket > 1 && endBracket + 2 < value.length && value[endBracket + 1] == ':') {
      "peer endpoint must be a bracketed IPv6 literal"
    }
    val host = value.substring(1, endBracket)
    require(host.matches(Regex("[0-9A-Fa-f:]+"))) { "peer endpoint must be a literal IPv6 address" }
    val address = InetAddress.getByName(host)
    require(isPublicIPv6(address)) { "peer endpoint is not public IPv6" }
    val port = value.substring(endBracket + 2).toInt()
    require(port in 1..65535)
    return InetSocketAddress(address, port)
  }

  private fun isPublicIPv6(address: InetAddress): Boolean {
    if (address !is Inet6Address || address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress || address.isMulticastAddress) return false
    val raw = address.address
    if ((raw[0].toInt() and 0xfe) == 0xfc) return false
    val mapped = raw.take(10).all { it == 0.toByte() } && raw[10] == 0xff.toByte() && raw[11] == 0xff.toByte()
    return !mapped
  }

  private fun hmacHex(secret: ByteArray, text: String): String {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(secret, "HmacSHA256"))
    return mac.doFinal(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
  }

  private fun constantTimeEquals(left: String, right: String): Boolean =
    java.security.MessageDigest.isEqual(left.toByteArray(Charsets.US_ASCII), right.toByteArray(Charsets.US_ASCII))
}
