package com.aks.app.utils

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import org.json.JSONObject

/**
 * Simple event bus for communication between Service and Activity/WebView.
 * Uses local broadcasts for in-app communication.
 */
object EventBus {
    
    private const val ACTION = "com.aks.app.NATIVE_EVENT"
    private const val EXTRA_TYPE = "event_type"
    private const val EXTRA_PAYLOAD = "event_payload"
    
    private var receiver: BroadcastReceiver? = null
    
    /**
     * Posts an event from anywhere (Service, Activity, etc.)
     * 
     * @param context Application context
     * @param type Event type identifier (e.g., "LOUD_SOUND", "SERVICE_RESTARTED")
     * @param payload Map of data to send with the event
     */
    fun post(context: Context, type: String, payload: Map<String, Any> = emptyMap()) {
        val intent = Intent(ACTION).apply {
            `package` = context.packageName
            putExtra(EXTRA_TYPE, type)
            putExtra(EXTRA_PAYLOAD, JSONObject(payload).toString())
        }
        context.sendBroadcast(intent)
    }
    
    /**
     * Initializes the event receiver in the Activity.
     * Call this in onCreate() of your main activity.
     * 
     * @param context Activity context
     * @param onEvent Callback invoked when an event is received
     */
    fun init(context: Context, onEvent: (type: String, payload: Map<String, Any>) -> Unit) {
        // Avoid duplicate registration
        receiver?.let { 
            try { context.unregisterReceiver(it) } catch (_: Exception) {}
        }
        
        receiver = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context, intent: Intent) {
                val type = intent.getStringExtra(EXTRA_TYPE) ?: return
                val jsonStr = intent.getStringExtra(EXTRA_PAYLOAD) ?: "{}"
                
                val payload = try {
                    val json = JSONObject(jsonStr)
                    json.keys().asSequence().associateWith { key -> json.get(key) }
                } catch (_: Exception) {
                    emptyMap()
                }
                
                onEvent(type, payload)
            }
        }
        
        val filter = IntentFilter(ACTION)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
    }
    
    /**
     * Unregisters the event receiver.
     * Call this in onDestroy() of your main activity.
     */
    fun destroy(context: Context) {
        receiver?.let {
            try {
                context.unregisterReceiver(it)
            } catch (_: Exception) {}
            receiver = null
        }
    }
    
    // Event type constants
    object Events {
        const val MONITORING_STARTED = "MONITORING_STARTED"
        const val MONITORING_STOPPED = "MONITORING_STOPPED"
        const val MIC_PERMISSION_DENIED = "MIC_PERMISSION_DENIED"
        const val MIC_PERMISSION_GRANTED = "MIC_PERMISSION_GRANTED"
        const val LOUD_SOUND = "LOUD_SOUND"
        const val SERVICE_RESTARTED = "SERVICE_RESTARTED"
        const val AUDIO_DATA = "AUDIO_DATA"
        const val ERROR = "ERROR"
        const val STATUS_UPDATE = "STATUS_UPDATE"
    }
}
