package cloud.itsmira.aks.receivers

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import cloud.itsmira.aks.services.MicrophoneService

/**
 * Boot receiver to restart the microphone service when device boots up.
 * This ensures AKS is always ready to listen after device restart.
 */
class BootReceiver : BroadcastReceiver() {
    
    companion object {
        private const val TAG = "BootReceiver"
    }
    
    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_BOOT_COMPLETED ||
            intent?.action == "android.intent.action.QUICKBOOT_POWERON") {
            
            Log.d(TAG, "Boot completed, starting MicrophoneService")
            
            context?.let {
                val serviceIntent = Intent(it, MicrophoneService::class.java)
                
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        it.startForegroundService(serviceIntent)
                    } else {
                        it.startService(serviceIntent)
                    }
                    Log.d(TAG, "MicrophoneService started successfully")
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to start MicrophoneService on boot", e)
                }
            }
        }
    }
}
