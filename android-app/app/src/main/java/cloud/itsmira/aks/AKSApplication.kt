package cloud.itsmira.aks

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log

class AKSApplication : Application() {
    
    companion object {
        private const val TAG = "AKSApplication"
        lateinit var instance: AKSApplication
            private set
    }
    
    override fun onCreate() {
        super.onCreate()
        instance = this
        
        Log.d(TAG, "AKS Application starting...")
        
        // Create notification channel for foreground service
        createNotificationChannel()
    }
    
    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channelId = getString(R.string.notification_channel_id)
            val channelName = getString(R.string.notification_channel_name)
            val channelDescription = getString(R.string.notification_channel_description)
            
            val importance = NotificationManager.IMPORTANCE_LOW
            val channel = NotificationChannel(channelId, channelName, importance).apply {
                description = channelDescription
                setShowBadge(false)
                enableVibration(false)
                setSound(null, null)
            }
            
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            notificationManager.createNotificationChannel(channel)
            
            Log.d(TAG, "Notification channel created: $channelId")
        }
    }
}
