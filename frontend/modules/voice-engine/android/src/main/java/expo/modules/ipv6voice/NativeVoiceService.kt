package expo.modules.ipv6voice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat

internal const val ACTION_HANG_UP = "expo.modules.ipv6voice.HANG_UP"
private const val CHANNEL_ID = "ipv6_voice_active_call"
private const val NOTIFICATION_ID = 7401

class NativeVoiceService : Service() {
  override fun onCreate() {
    super.onCreate()
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "Active voice call", NotificationManager.IMPORTANCE_LOW))
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_HANG_UP) {
      VoiceRuntime.controller?.end("notification_hangup")
      stopSelf()
      return START_NOT_STICKY
    }
    startForeground(NOTIFICATION_ID, notification())
    return START_STICKY
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun notification(): Notification {
    val hangup = Intent(this, HangupReceiver::class.java).setAction(ACTION_HANG_UP)
    val pending = PendingIntent.getBroadcast(this, 0, hangup, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle("IPv6 voice call")
      .setContentText("Direct encrypted call in progress")
      .setOngoing(true)
      .setCategory(NotificationCompat.CATEGORY_CALL)
      .addAction(0, "Hang up", pending)
      .build()
  }
}

class HangupReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action == ACTION_HANG_UP) VoiceRuntime.controller?.end("notification_hangup")
  }
}
