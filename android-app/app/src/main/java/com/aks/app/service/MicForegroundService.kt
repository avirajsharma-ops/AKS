package com.aks.app.service

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Base64
import android.util.Log
import com.aks.app.utils.EventBus
import com.aks.app.utils.NotificationHelper
import kotlinx.coroutines.*
import java.io.ByteArrayOutputStream
import kotlin.math.sqrt

/**
 * Foreground service that handles microphone recording.
 * This keeps the mic active even when the app is in background.
 * 
 * Features:
 * - Continuous microphone recording at 16kHz
 * - Self-recovery with exponential backoff
 * - Heartbeat for watchdog monitoring
 * - Audio data streaming to WebView via EventBus
 */
class MicForegroundService : Service() {
    
    companion object {
        private const val TAG = "MicForegroundService"
        const val PREFS_NAME = "mic_health"
        const val KEY_LAST_FRAME = "last_frame"
        const val KEY_IS_MONITORING = "is_monitoring"
        
        // Audio configuration
        private const val SAMPLE_RATE = 16000
        private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
        private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT
        
        // Sound detection threshold (RMS value)
        private const val LOUD_SOUND_THRESHOLD = 5000
        
        // How often to send audio data to WebView (in buffer reads)
        private const val AUDIO_SEND_INTERVAL = 10
    }
    
    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    
    @Volatile
    private var isRunning = false
    
    private var wakeLock: PowerManager.WakeLock? = null
    private var audioSendCounter = 0
    
    override fun onCreate() {
        super.onCreate()
        NotificationHelper.createChannel(this)
        Log.d(TAG, "Service created")
    }
    
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        Log.d(TAG, "Service onStartCommand")
        
        // Start as foreground service
        val notification = NotificationHelper.buildOngoingNotification(this, "Listening...")
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NotificationHelper.NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
            )
        } else {
            startForeground(NotificationHelper.NOTIFICATION_ID, notification)
        }
        
        // Acquire wake lock to prevent CPU from sleeping
        acquireWakeLock()
        
        // Start recording if not already running
        if (!isRunning) {
            isRunning = true
            saveMonitoringState(true)
            
            serviceScope.launch {
                recordLoopWithRecovery()
            }
            
            // Schedule watchdog
            WatchdogScheduler.schedule(this)
            
            EventBus.post(this, EventBus.Events.MONITORING_STARTED)
        }
        
        return START_STICKY
    }
    
    /**
     * Main recording loop with automatic recovery on failure.
     */
    private suspend fun recordLoopWithRecovery() {
        var backoffMs = 500L
        
        while (isRunning) {
            try {
                recordUntilStopOrFailure()
                // Reset backoff on successful recording session
                backoffMs = 500L
            } catch (e: Exception) {
                Log.e(TAG, "Recording failed, will retry: ${e.message}")
                EventBus.post(
                    applicationContext,
                    EventBus.Events.ERROR,
                    mapOf("message" to (e.message ?: "Unknown error"))
                )
                
                // Exponential backoff
                delay(backoffMs)
                backoffMs = (backoffMs * 2).coerceAtMost(8000L)
            }
        }
    }
    
    /**
     * Actual recording logic using AudioRecord.
     */
    private fun recordUntilStopOrFailure() {
        val minBufferSize = AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT)
        
        if (minBufferSize == AudioRecord.ERROR || minBufferSize == AudioRecord.ERROR_BAD_VALUE) {
            throw IllegalStateException("Invalid AudioRecord buffer size: $minBufferSize")
        }
        
        val bufferSize = minBufferSize * 2
        
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            CHANNEL_CONFIG,
            AUDIO_FORMAT,
            bufferSize
        )
        
        if (audioRecord.state != AudioRecord.STATE_INITIALIZED) {
            audioRecord.release()
            throw IllegalStateException("AudioRecord failed to initialize")
        }
        
        val buffer = ShortArray(minBufferSize / 2)
        val audioOutputStream = ByteArrayOutputStream()
        
        try {
            audioRecord.startRecording()
            Log.d(TAG, "Recording started")
            NotificationHelper.updateNotification(this, "Listening...")
            
            while (isRunning) {
                val readCount = audioRecord.read(buffer, 0, buffer.size)
                
                if (readCount > 0) {
                    // Update heartbeat
                    writeHeartbeat()
                    
                    // Calculate RMS for sound detection
                    val rms = calculateRms(buffer, readCount)
                    
                    // Detect loud sounds
                    if (rms > LOUD_SOUND_THRESHOLD) {
                        EventBus.post(
                            applicationContext,
                            EventBus.Events.LOUD_SOUND,
                            mapOf("rms" to rms, "timestamp" to System.currentTimeMillis())
                        )
                    }
                    
                    // Send audio data periodically to WebView
                    audioSendCounter++
                    if (audioSendCounter >= AUDIO_SEND_INTERVAL) {
                        audioSendCounter = 0
                        sendAudioData(buffer, readCount)
                    }
                    
                } else {
                    // Read error - trigger recovery
                    throw IllegalStateException("AudioRecord read failed: $readCount")
                }
            }
            
        } finally {
            try {
                audioRecord.stop()
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping AudioRecord: ${e.message}")
            }
            audioRecord.release()
            audioOutputStream.close()
            Log.d(TAG, "Recording stopped")
        }
    }
    
    /**
     * Sends audio data to WebView via EventBus.
     * Audio is encoded as Base64 for easy JS consumption.
     */
    private fun sendAudioData(buffer: ShortArray, count: Int) {
        // Convert short array to byte array
        val byteBuffer = ByteArray(count * 2)
        for (i in 0 until count) {
            byteBuffer[i * 2] = (buffer[i].toInt() and 0xFF).toByte()
            byteBuffer[i * 2 + 1] = (buffer[i].toInt() shr 8 and 0xFF).toByte()
        }
        
        val base64Audio = Base64.encodeToString(byteBuffer, Base64.NO_WRAP)
        
        EventBus.post(
            applicationContext,
            EventBus.Events.AUDIO_DATA,
            mapOf(
                "audio" to base64Audio,
                "sampleRate" to SAMPLE_RATE,
                "timestamp" to System.currentTimeMillis()
            )
        )
    }
    
    /**
     * Calculates RMS (Root Mean Square) of audio buffer.
     * Used for detecting loud sounds.
     */
    private fun calculateRms(buffer: ShortArray, count: Int): Int {
        var sum = 0.0
        for (i in 0 until count) {
            val value = buffer[i].toDouble()
            sum += value * value
        }
        return sqrt(sum / count).toInt()
    }
    
    /**
     * Writes heartbeat timestamp to SharedPreferences.
     * Used by watchdog to detect if service is stalled.
     */
    private fun writeHeartbeat() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        prefs.edit()
            .putLong(KEY_LAST_FRAME, SystemClock.elapsedRealtime())
            .apply()
    }
    
    /**
     * Saves monitoring state to SharedPreferences.
     */
    private fun saveMonitoringState(isMonitoring: Boolean) {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        prefs.edit()
            .putBoolean(KEY_IS_MONITORING, isMonitoring)
            .apply()
    }
    
    /**
     * Acquires a partial wake lock to prevent CPU from sleeping.
     */
    private fun acquireWakeLock() {
        if (wakeLock == null) {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "Mira::MicWakeLock"
            ).apply {
                acquire(10 * 60 * 1000L) // 10 minutes, will be re-acquired in loop
            }
        }
    }
    
    /**
     * Releases the wake lock.
     */
    private fun releaseWakeLock() {
        wakeLock?.let {
            if (it.isHeld) {
                it.release()
            }
        }
        wakeLock = null
    }
    
    override fun onDestroy() {
        Log.d(TAG, "Service destroyed")
        isRunning = false
        saveMonitoringState(false)
        releaseWakeLock()
        serviceScope.cancel()
        
        EventBus.post(applicationContext, EventBus.Events.MONITORING_STOPPED)
        
        super.onDestroy()
    }
    
    override fun onBind(intent: Intent?): IBinder? = null
}
