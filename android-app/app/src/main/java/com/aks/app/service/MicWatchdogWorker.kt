package com.aks.app.service

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import com.aks.app.utils.EventBus

/**
 * WorkManager Worker that checks if the MicForegroundService is healthy.
 * If the service appears stalled (no heartbeat updates), it restarts the service.
 */
class MicWatchdogWorker(
    context: Context,
    params: WorkerParameters
) : Worker(context, params) {
    
    companion object {
        private const val TAG = "MicWatchdogWorker"
        private const val STALE_THRESHOLD_MS = 2 * 60 * 1000L // 2 minutes
    }
    
    override fun doWork(): Result {
        Log.d(TAG, "Watchdog checking service health")
        
        // Check if mic permission is granted
        val micPermissionGranted = ContextCompat.checkSelfPermission(
            applicationContext,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        
        if (!micPermissionGranted) {
            Log.d(TAG, "Mic permission not granted, skipping")
            return Result.success()
        }
        
        // Check if monitoring was enabled
        val prefs = applicationContext.getSharedPreferences(
            MicForegroundService.PREFS_NAME,
            Context.MODE_PRIVATE
        )
        
        val isMonitoringEnabled = prefs.getBoolean(MicForegroundService.KEY_IS_MONITORING, false)
        if (!isMonitoringEnabled) {
            Log.d(TAG, "Monitoring not enabled, skipping")
            return Result.success()
        }
        
        // Check heartbeat
        val lastHeartbeat = prefs.getLong(MicForegroundService.KEY_LAST_FRAME, 0L)
        val now = SystemClock.elapsedRealtime()
        
        val isStale = lastHeartbeat == 0L || (now - lastHeartbeat) > STALE_THRESHOLD_MS
        
        if (isStale) {
            Log.w(TAG, "Service appears stalled (last heartbeat: ${now - lastHeartbeat}ms ago), restarting")
            
            // Restart the service
            val intent = Intent(applicationContext, MicForegroundService::class.java)
            ContextCompat.startForegroundService(applicationContext, intent)
            
            EventBus.post(
                applicationContext,
                EventBus.Events.SERVICE_RESTARTED,
                mapOf("reason" to "watchdog_stale_heartbeat")
            )
        } else {
            Log.d(TAG, "Service healthy (last heartbeat: ${now - lastHeartbeat}ms ago)")
        }
        
        return Result.success()
    }
}
