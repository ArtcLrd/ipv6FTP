package expo.modules.ipv6voice

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import android.media.audiofx.NoiseSuppressor
import androidx.core.content.ContextCompat
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal class AudioPipeline(
  private val context: Context,
  private val sendEncoded: (ByteArray, Int) -> Unit,
  private val onFailure: (String) -> Unit,
) {
  companion object {
    const val SAMPLE_RATE = 48_000
    const val FRAME_MS = 20
    const val SAMPLES_PER_FRAME = 960
    const val PCM_BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2
    const val BITRATE = 24_000
  }

  private val running = AtomicBoolean(false)
  private val captureExecutor = Executors.newSingleThreadExecutor()
  private val audioManager = context.getSystemService(AudioManager::class.java)
  private var recorder: AudioRecord? = null
  private var player: AudioTrack? = null
  private var encoder: MediaCodec? = null
  private var decoder: MediaCodec? = null
  private var echoCanceler: AcousticEchoCanceler? = null
  private var noiseSuppressor: NoiseSuppressor? = null
  private var muted = false
  private var capturePaused = false
  private var frameIndex = 0L

  private val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
    .setOnAudioFocusChangeListener { change ->
      capturePaused = change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
    }
    .build()

  @SuppressLint("MissingPermission")
  fun start() {
    check(ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
      "Microphone permission is required"
    }
    if (!running.compareAndSet(false, true)) return
    try {
      audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
      audioManager.requestAudioFocus(focusRequest)
      encoder = createCodec(true)
      decoder = createCodec(false)
      val captureBuffer = maxOf(
        AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT),
        PCM_BYTES_PER_FRAME * 4,
      )
      recorder = AudioRecord.Builder()
        .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
        .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(captureBuffer)
        .build()
      val outputBuffer = maxOf(
        AudioTrack.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT),
        PCM_BYTES_PER_FRAME * 6,
      )
      player = AudioTrack.Builder()
        .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
        .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
        .setBufferSizeInBytes(outputBuffer)
        .setTransferMode(AudioTrack.MODE_STREAM)
        .build()
      recorder?.audioSessionId?.let { session ->
        if (AcousticEchoCanceler.isAvailable()) echoCanceler = AcousticEchoCanceler.create(session)?.apply { enabled = true }
        if (NoiseSuppressor.isAvailable()) noiseSuppressor = NoiseSuppressor.create(session)?.apply { enabled = true }
      }
      player?.play()
      recorder?.startRecording()
      captureExecutor.execute(::captureLoop)
    } catch (error: Exception) {
      stop()
      throw error
    }
  }

  private fun createCodec(encode: Boolean): MediaCodec {
    val codec = if (encode) MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS) else MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_OPUS)
    val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_OPUS, SAMPLE_RATE, 1).apply {
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, PCM_BYTES_PER_FRAME)
      if (encode) {
        setInteger(MediaFormat.KEY_BIT_RATE, BITRATE)
      } else {
        setByteBuffer("csd-0", ByteBuffer.wrap(opusHead()))
        setByteBuffer("csd-1", longBuffer(6_500_000L))
        setByteBuffer("csd-2", longBuffer(80_000_000L))
      }
    }
    codec.configure(format, null, null, if (encode) MediaCodec.CONFIGURE_FLAG_ENCODE else 0)
    codec.start()
    return codec
  }

  private fun captureLoop() {
    val pcm = ByteArray(PCM_BYTES_PER_FRAME)
    while (running.get()) {
      val count = recorder?.read(pcm, 0, pcm.size, AudioRecord.READ_BLOCKING) ?: break
      if (count != pcm.size || muted || capturePaused) continue
      try {
        val codec = encoder ?: break
        val inputIndex = codec.dequeueInputBuffer(10_000)
        if (inputIndex >= 0) {
          codec.getInputBuffer(inputIndex)?.apply { clear(); put(pcm, 0, count) }
          codec.queueInputBuffer(inputIndex, 0, count, frameIndex * FRAME_MS * 1_000, 0)
          frameIndex++
        }
        val info = MediaCodec.BufferInfo()
        var outputIndex = codec.dequeueOutputBuffer(info, 0)
        while (outputIndex >= 0) {
          if (info.size > 0 && info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0) {
            val encoded = ByteArray(info.size)
            codec.getOutputBuffer(outputIndex)?.apply { position(info.offset); limit(info.offset + info.size); get(encoded) }
            sendEncoded(encoded, (info.presentationTimeUs / 1_000).toInt())
          }
          codec.releaseOutputBuffer(outputIndex, false)
          outputIndex = codec.dequeueOutputBuffer(info, 0)
        }
      } catch (error: Exception) {
        onFailure(error.message ?: "Opus encoder failed")
        return
      }
    }
    pcm.fill(0)
  }

  @Synchronized
  fun decode(encoded: ByteArray, timestampMs: Int) {
    if (!running.get()) return
    try {
      val codec = decoder ?: return
      val inputIndex = codec.dequeueInputBuffer(0)
      if (inputIndex >= 0) {
        codec.getInputBuffer(inputIndex)?.apply { clear(); put(encoded) }
        codec.queueInputBuffer(inputIndex, 0, encoded.size, timestampMs.toLong() * 1_000, 0)
      }
      val info = MediaCodec.BufferInfo()
      var outputIndex = codec.dequeueOutputBuffer(info, 0)
      while (outputIndex >= 0) {
        if (info.size > 0) {
          val pcm = ByteArray(info.size)
          codec.getOutputBuffer(outputIndex)?.apply { position(info.offset); limit(info.offset + info.size); get(pcm) }
          player?.write(pcm, 0, pcm.size, AudioTrack.WRITE_NON_BLOCKING)
          pcm.fill(0)
        }
        codec.releaseOutputBuffer(outputIndex, false)
        outputIndex = codec.dequeueOutputBuffer(info, 0)
      }
    } catch (error: Exception) {
      onFailure(error.message ?: "Opus decoder failed")
    }
  }

  fun setMuted(value: Boolean) { muted = value }

  @Suppress("DEPRECATION")
  fun setSpeaker(enabled: Boolean) { audioManager.isSpeakerphoneOn = enabled }

  fun stop() {
    if (!running.getAndSet(false)) return
    try { recorder?.stop() } catch (_: Exception) { }
    try { player?.stop() } catch (_: Exception) { }
    recorder?.release(); recorder = null
    player?.release(); player = null
    echoCanceler?.release(); echoCanceler = null
    noiseSuppressor?.release(); noiseSuppressor = null
    try { encoder?.stop() } catch (_: Exception) { }
    try { decoder?.stop() } catch (_: Exception) { }
    encoder?.release(); encoder = null
    decoder?.release(); decoder = null
    audioManager.abandonAudioFocusRequest(focusRequest)
    audioManager.mode = AudioManager.MODE_NORMAL
    captureExecutor.shutdownNow()
  }

  private fun opusHead(): ByteArray = byteArrayOf(
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, 0x01, 0x01,
    0x38, 0x01, 0x80.toByte(), 0xbb.toByte(), 0x00, 0x00, 0x00, 0x00, 0x00,
  )

  private fun longBuffer(value: Long): ByteBuffer = ByteBuffer.allocate(8)
    .order(ByteOrder.nativeOrder())
    .putLong(value)
    .apply { flip() }
}
