package cloud.itsmira.aks.services

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import cloud.itsmira.aks.MainActivity
import cloud.itsmira.aks.R

/**
 * Foreground service that keeps the app running in the background
 * with microphone permission active. This allows the WebView to
 * continue listening for voice commands even when the app is backgrounded.
 */
class MicrophoneService : Service() {
    
    companion object {
        private const val TAG = "MicrophoneService"
        private const val NOTIFICATION_ID = 1001
        private const val WAKELOCK_TAG = "AKS::MicrophoneWakeLock"
    }
    
    private var wakeLock: PowerManager.WakeLock? = null
    private var isRunning = false
    
    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "MicrophoneService created")
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "MicrophoneService started")
        
        if (!isRunning) {
            isRunning = true
            startForegroundWithNotification()
            acquireWakeLock()
        }
        
        // Restart if killed by system
        return START_STICKY
    }
    
    override fun onBind(intent: Intent?): IBinder? {
        return null
    }
    
    override fun onDestroy() {
        Log.d(TAG, "MicrophoneService destroyed")
        releaseWakeLock()
        isRunning = false
        super.onDestroy()
    }
    
    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "Task removed, restarting service")
        
        // Restart service when app is swiped away
        val restartIntent = Intent(applicationContext, MicrophoneService::class.java)
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            applicationContext.startForegroundService(restartIntent)
        } else {
            applicationContext.startService(restartIntent)
        }
        
        super.onTaskRemoved(rootIntent)
    }
    
    private fun startForegroundWithNotification() {
        val notification = createNotification()
        
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                // Android 14+ requires specifying foreground service type
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                )
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            Log.d(TAG, "Foreground service started successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start foreground service", e)
            stopSelf()
        }
    }
    
    private fun createNotification(): Notification {
        val channelId = getString(R.string.notification_channel_id)
        
        // Intent to open the app when notification is tapped
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        
        val openAppPendingIntent = PendingIntent.getActivity(
            this,
            0,
            openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        // Intent to stop the service
        val stopIntent = Intent(this, MicrophoneService::class.java).apply {
            action = "STOP_SERVICE"
        }
        
        val stopPendingIntent = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        return NotificationCompat.Builder(this, channelId)
            .setContentTitle(getString(R.string.notification_title))
            .setContentText(getString(R.string.notification_message))
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setAutoCancel(false)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openAppPendingIntent)
            .addAction(
                R.drawable.ic_mic,
                getString(R.string.notification_action_stop),
                stopPendingIntent
            )
            .build()
    }
    
    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                WAKELOCK_TAG
            ).apply {
                setReferenceCounted(false)
                acquire(10 * 60 * 60 * 1000L) // 10 hours max
            }
            Log.d(TAG, "WakeLock acquired")
        }
    }
    
    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
                Log.d(TAG, "WakeLock released")
            }
        }
        wakeLock = null
    }
}
