package com.aks.app.receiver

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.content.ContextCompat
import com.aks.app.service.MicForegroundService

/**
 * BroadcastReceiver that starts the MicForegroundService after device boot.
 * This ensures continuous monitoring even after device restarts.
 */
class BootReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "BootReceiver"
    }
    
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == "android.intent.action.QUICKBOOT_POWERON") {
            
            Log.d(TAG, "Boot completed, checking if service should start")
            
            // Check if mic permission is granted
            val micPermissionGranted = ContextCompat.checkSelfPermission(
                context,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
            
            if (!micPermissionGranted) {
                Log.d(TAG, "Mic permission not granted, not starting service")
                return
            }
            
            // Check if monitoring was previously enabled
            val prefs = context.getSharedPreferences(
                MicForegroundService.PREFS_NAME,
                Context.MODE_PRIVATE
            )
            val wasMonitoring = prefs.getBoolean(MicForegroundService.KEY_IS_MONITORING, false)
            
            if (wasMonitoring) {
                Log.d(TAG, "Starting MicForegroundService after boot")
                val serviceIntent = Intent(context, MicForegroundService::class.java)
                ContextCompat.startForegroundService(context, serviceIntent)
            } else {
                Log.d(TAG, "Monitoring was not enabled, not starting service")
            }
        }
    }
}
