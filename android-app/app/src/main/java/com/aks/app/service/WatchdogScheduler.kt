package com.aks.app.service

import android.content.Context
import androidx.work.*
import java.util.concurrent.TimeUnit

/**
 * Schedules the MicWatchdogWorker to periodically check service health.
 */
object WatchdogScheduler {
    
    private const val WORK_NAME = "mic_watchdog"
    private const val INTERVAL_MINUTES = 15L
    
    /**
     * Schedules periodic watchdog checks.
     * Uses WorkManager for reliable background execution.
     */
    fun schedule(context: Context) {
        val constraints = Constraints.Builder()
            .setRequiresBatteryNotLow(false) // Run even on low battery
            .build()
        
        val request = PeriodicWorkRequestBuilder<MicWatchdogWorker>(
            INTERVAL_MINUTES, TimeUnit.MINUTES
        )
            .setConstraints(constraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                WorkRequest.MIN_BACKOFF_MILLIS,
                TimeUnit.MILLISECONDS
            )
            .build()
        
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME,
            ExistingPeriodicWorkPolicy.UPDATE,
            request
        )
    }
    
    /**
     * Cancels the watchdog worker.
     */
    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }
}
