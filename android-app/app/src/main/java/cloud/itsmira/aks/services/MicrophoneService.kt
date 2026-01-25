package cloud.itsmira.aks.services

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import cloud.itsmira.aks.MainActivity
import cloud.itsmira.aks.R
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Foreground service that provides 24/7 microphone listening
 * Uses native Android SpeechRecognizer for continuous voice recognition
 * Sends transcripts directly to backend via WebSocket
 */
class MicrophoneService : Service() {
    
    companion object {
        private const val TAG = "MicrophoneService"
        private const val NOTIFICATION_ID = 1001
        private const val WAKELOCK_TAG = "AKS::MicrophoneWakeLock"
        private const val WS_URL = "wss://itsmira.cloud/ws/audio"
        private const val RECONNECT_DELAY_MS = 5000L
    }
    
    private var wakeLock: PowerManager.WakeLock? = null
    private var isRunning = false
    private var speechRecognizer: NativeSpeechRecognizer? = null
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(0, TimeUnit.MINUTES) // No timeout for WebSocket
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()
    private val handler = Handler(Looper.getMainLooper())
    private var authToken: String? = null
    private var isPaused = false
    
    override fun onCreate() {
        super.onCreate()
        Log.d(TAG, "MicrophoneService created")
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "MicrophoneService onStartCommand")
        
        when (intent?.action) {
            "STOP_SERVICE" -> {
                Log.d(TAG, "Stopping service via notification action")
                stopSelf()
                return START_NOT_STICKY
            }
            "PAUSE_RECOGNITION" -> {
                pauseRecognition()
                return START_STICKY
            }
            "RESUME_RECOGNITION" -> {
                resumeRecognition()
                return START_STICKY
            }
            "SET_TOKEN" -> {
                authToken = intent.getStringExtra("token")
                Log.d(TAG, "Auth token received")
                connectWebSocket()
                return START_STICKY
            }
        }
        
        if (!isRunning) {
            isRunning = true
            startForegroundWithNotification()
            acquireWakeLock()
            initializeSpeechRecognizer()
        }
        
        // Restart if killed by system
        return START_STICKY
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
    
    override fun onDestroy() {
        Log.d(TAG, "MicrophoneService destroyed")
        speechRecognizer?.destroy()
        webSocket?.close(1000, "Service destroyed")
        client.dispatcher.executorService.shutdown()
        releaseWakeLock()
        isRunning = false
        super.onDestroy()
    }
    
    override fun onTaskRemoved(rootIntent: Intent?) {
        Log.d(TAG, "Task removed, service continues running")
        // Service keeps running even when app is swiped away
        super.onTaskRemoved(rootIntent)
    }
    
    private fun initializeSpeechRecognizer() {
        speechRecognizer = NativeSpeechRecognizer(
            context = this,
            onTranscript = { text, isFinal ->
                sendTranscript(text, isFinal)
            },
            onError = { error ->
                Log.e(TAG, "Speech recognition error: $error")
            }
        )
        speechRecognizer?.start()
        Log.d(TAG, "🎙️ Native speech recognizer started")
    }
    
    private fun pauseRecognition() {
        isPaused = true
        speechRecognizer?.pause()
        Log.d(TAG, "⏸️ Recognition paused (AI speaking)")
    }
    
    private fun resumeRecognition() {
        isPaused = false
        speechRecognizer?.resume()
        Log.d(TAG, "▶️ Recognition resumed")
    }
    
    private fun connectWebSocket() {
        val token = authToken ?: run {
            Log.w(TAG, "No auth token, cannot connect WebSocket")
            return
        }
        
        webSocket?.close(1000, "Reconnecting")
        
        val request = Request.Builder()
            .url("$WS_URL?token=$token")
            .build()
        
        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "🔌 WebSocket connected")
            }
            
            override fun onMessage(webSocket: WebSocket, text: String) {
                Log.d(TAG, "📥 WS message: $text")
                try {
                    val json = JSONObject(text)
                    when (json.optString("type")) {
                        "ai:speaking:start" -> pauseRecognition()
                        "ai:speaking:end" -> resumeRecognition()
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error parsing WS message", e)
                }
            }
            
            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: $code $reason")
            }
            
            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: $code $reason")
                scheduleReconnect()
            }
            
            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket failure", t)
                scheduleReconnect()
            }
        })
    }
    
    private fun scheduleReconnect() {
        if (!isRunning || authToken == null) return
        
        handler.postDelayed({
            if (isRunning) {
                Log.d(TAG, "🔄 Reconnecting WebSocket...")
                connectWebSocket()
            }
        }, RECONNECT_DELAY_MS)
    }
    
    private fun sendTranscript(text: String, isFinal: Boolean) {
        if (text.isBlank()) return
        
        val json = JSONObject().apply {
            put("type", "transcript")
            put("text", text)
            put("isFinal", isFinal)
            put("language", "en-IN")
            put("source", "native_android")
            put("timestamp", System.currentTimeMillis())
        }
        
        webSocket?.send(json.toString()) ?: run {
            Log.w(TAG, "WebSocket not connected, transcript not sent")
        }
        
        Log.d(TAG, "📤 Sent: $text (final=$isFinal)")
    }
    
    private fun startForegroundWithNotification() {
        val notification = createNotification()
        
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
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
        
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        
        val openAppPendingIntent = PendingIntent.getActivity(
            this, 0, openAppIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        val stopIntent = Intent(this, MicrophoneService::class.java).apply {
            action = "STOP_SERVICE"
        }
        
        val stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent,
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
            .addAction(R.drawable.ic_mic, getString(R.string.notification_action_stop), stopPendingIntent)
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
                acquire(24 * 60 * 60 * 1000L) // 24 hours max
            }
            Log.d(TAG, "WakeLock acquired (24 hours)")
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
