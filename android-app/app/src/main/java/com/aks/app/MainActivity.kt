package com.aks.app

import android.Manifest
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.ProgressBar
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.aks.app.service.MicForegroundService
import com.aks.app.service.WatchdogScheduler
import com.aks.app.utils.EventBus
import org.json.JSONObject

/**
 * Main Activity hosting the WebView and managing native mic service.
 */
class MainActivity : AppCompatActivity() {
    
    companion object {
        private const val TAG = "MainActivity"
        private const val WEBVIEW_URL = "https://itsmira.cloud/"
    }
    
    private lateinit var webView: WebView
    private lateinit var progressBar: ProgressBar
    private var permissionsRequested = false
    
    // Required permissions
    private val requiredPermissions = mutableListOf(
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.CAMERA
    ).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
    
    // Multiple permissions launcher
    private val permissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.all { it.value }
        val micGranted = permissions[Manifest.permission.RECORD_AUDIO] == true
        val cameraGranted = permissions[Manifest.permission.CAMERA] == true
        
        Log.d(TAG, "Permissions result - Mic: $micGranted, Camera: $cameraGranted, All: $allGranted")
        
        if (micGranted) {
            sendToWeb(EventBus.Events.MIC_PERMISSION_GRANTED, emptyMap())
            // Start the foreground service
            startMicService()
        } else {
            sendToWeb(EventBus.Events.MIC_PERMISSION_DENIED, emptyMap())
        }
        
        // Check for battery optimization after permissions
        checkBatteryOptimization()
        
        // Load WebView after permissions
        loadWebView()
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Set up full-screen immersive mode
        setupFullscreenMode()
        
        // Create layout programmatically
        setupLayout()
        
        // Configure WebView
        setupWebView()
        
        // Initialize EventBus to receive events from service
        EventBus.init(this) { type, payload ->
            runOnUiThread { sendToWeb(type, payload) }
        }
        
        // Request all permissions on first launch
        requestAllPermissions()
    }
    
    private fun requestAllPermissions() {
        val permissionsToRequest = requiredPermissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        
        if (permissionsToRequest.isNotEmpty()) {
            // Show explanation dialog first
            showPermissionExplanationDialog(permissionsToRequest)
        } else {
            // All permissions already granted
            Log.d(TAG, "All permissions already granted")
            startMicService()
            checkBatteryOptimization()
            loadWebView()
        }
    }
    
    private fun showPermissionExplanationDialog(permissionsToRequest: List<String>) {
        AlertDialog.Builder(this)
            .setTitle("Permissions Required")
            .setMessage("AKS needs the following permissions to work properly:\n\n" +
                    "• Microphone - For voice recognition and monitoring\n" +
                    "• Camera - For face tracking features\n" +
                    "• Notifications - To show background service status\n\n" +
                    "Please grant these permissions to continue.")
            .setPositiveButton("Grant Permissions") { _, _ ->
                permissionsLauncher.launch(permissionsToRequest.toTypedArray())
            }
            .setNegativeButton("Cancel") { _, _ ->
                Toast.makeText(this, "Permissions are required for the app to work", Toast.LENGTH_LONG).show()
                loadWebView() // Load anyway but features won't work
            }
            .setCancelable(false)
            .show()
    }
    
    private fun checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val powerManager = getSystemService(POWER_SERVICE) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                showBatteryOptimizationDialog()
            }
        }
    }
    
    private fun showBatteryOptimizationDialog() {
        AlertDialog.Builder(this)
            .setTitle("Background Permission")
            .setMessage("To keep AKS running reliably in the background, please disable battery optimization for this app.\n\nThis ensures the microphone service continues working even when the app is minimized.")
            .setPositiveButton("Open Settings") { _, _ ->
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } catch (e: Exception) {
                    // Fallback to general battery settings
                    try {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    } catch (e2: Exception) {
                        Toast.makeText(this, "Please manually disable battery optimization in Settings", Toast.LENGTH_LONG).show()
                    }
                }
            }
            .setNegativeButton("Later") { _, _ -> }
            .show()
    }
    
    private fun loadWebView() {
        if (!permissionsRequested) {
            permissionsRequested = true
            webView.loadUrl(WEBVIEW_URL)
        }
    }
    
    private fun setupFullscreenMode() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.hide(WindowInsetsCompat.Type.systemBars())
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    
    private fun setupLayout() {
        webView = WebView(this).apply {
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT
            )
        }
        
        progressBar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            layoutParams = android.widget.FrameLayout.LayoutParams(
                android.widget.FrameLayout.LayoutParams.MATCH_PARENT,
                8
            )
            isIndeterminate = false
            max = 100
        }
        
        val container = android.widget.FrameLayout(this).apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            addView(webView)
            addView(progressBar)
        }
        
        setContentView(container)
    }
    
    private fun setupWebView() {
        webView.apply {
            setBackgroundColor(android.graphics.Color.BLACK)
            
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                allowFileAccess = true
                allowContentAccess = true
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                cacheMode = WebSettings.LOAD_DEFAULT
                builtInZoomControls = false
                displayZoomControls = false
                userAgentString = "$userAgentString AKSApp/1.0 (Native)"
                mediaPlaybackRequiresUserGesture = false
            }
            
            addJavascriptInterface(AndroidBridge(), "AndroidBridge")
            
            webViewClient = object : WebViewClient() {
                override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                    super.onPageStarted(view, url, favicon)
                    progressBar.visibility = View.VISIBLE
                }
                
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    progressBar.visibility = View.GONE
                    injectNativeDetectionScript()
                }
                
                override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                    super.onReceivedError(view, request, error)
                    Log.e(TAG, "WebView error: ${error?.description}")
                }
                
                override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                    val url = request?.url?.toString() ?: return false
                    return if (url.contains("itsmira.cloud")) {
                        false
                    } else {
                        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                        true
                    }
                }
            }
            
            webChromeClient = object : WebChromeClient() {
                override fun onProgressChanged(view: WebView?, newProgress: Int) {
                    super.onProgressChanged(view, newProgress)
                    progressBar.progress = newProgress
                }
                
                override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                    Log.d("WebView", "${consoleMessage?.message()} -- Line ${consoleMessage?.lineNumber()}")
                    return true
                }
                
                override fun onPermissionRequest(request: PermissionRequest?) {
                    request?.let { req ->
                        runOnUiThread {
                            val resources = req.resources
                            val grantedResources = mutableListOf<String>()
                            
                            // Check each requested resource
                            for (resource in resources) {
                                when (resource) {
                                    PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                                        // We handle mic natively, but grant to WebView too if we have permission
                                        if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                                            grantedResources.add(resource)
                                        }
                                    }
                                    PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
                                        if (ContextCompat.checkSelfPermission(this@MainActivity, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                                            grantedResources.add(resource)
                                        }
                                    }
                                    else -> grantedResources.add(resource)
                                }
                            }
                            
                            if (grantedResources.isNotEmpty()) {
                                req.grant(grantedResources.toTypedArray())
                            } else {
                                req.deny()
                            }
                        }
                    }
                }
            }
        }
    }
    
    private fun injectNativeDetectionScript() {
        val script = """
            (function() {
                window.isNativeAKSApp = true;
                window.isNativeMiraApp = true;
                window.nativeAppVersion = '1.0.0';
                
                window.dispatchEvent(new CustomEvent('nativeAppReady', {
                    detail: {
                        platform: 'android',
                        version: '1.0.0',
                        hasMicService: true,
                        appName: 'AKS'
                    }
                }));
                
                console.log('AKS native app detected');
            })();
        """.trimIndent()
        
        webView.evaluateJavascript(script, null)
    }
    
    inner class AndroidBridge {
        
        @JavascriptInterface
        fun startMonitoring() {
            Log.d(TAG, "JS called: startMonitoring")
            runOnUiThread { ensurePermissionsThenStart() }
        }
        
        @JavascriptInterface
        fun stopMonitoring() {
            Log.d(TAG, "JS called: stopMonitoring")
            runOnUiThread {
                stopService(Intent(this@MainActivity, MicForegroundService::class.java))
                WatchdogScheduler.cancel(this@MainActivity)
                sendToWeb(EventBus.Events.MONITORING_STOPPED, emptyMap())
            }
        }
        
        @JavascriptInterface
        fun getStatus(): String {
            val prefs = getSharedPreferences(MicForegroundService.PREFS_NAME, MODE_PRIVATE)
            val lastFrame = prefs.getLong(MicForegroundService.KEY_LAST_FRAME, 0L)
            val isMonitoring = prefs.getBoolean(MicForegroundService.KEY_IS_MONITORING, false)
            val now = SystemClock.elapsedRealtime()
            
            return JSONObject().apply {
                put("isMonitoring", isMonitoring)
                put("lastFrameMs", lastFrame)
                put("elapsedSinceLastFrame", if (lastFrame > 0) now - lastFrame else -1)
                put("hasMicPermission", hasMicPermission())
                put("hasCameraPermission", hasCameraPermission())
            }.toString()
        }
        
        @JavascriptInterface
        fun hasMicPermission(): Boolean {
            return ContextCompat.checkSelfPermission(
                this@MainActivity,
                Manifest.permission.RECORD_AUDIO
            ) == PackageManager.PERMISSION_GRANTED
        }
        
        @JavascriptInterface
        fun hasCameraPermission(): Boolean {
            return ContextCompat.checkSelfPermission(
                this@MainActivity,
                Manifest.permission.CAMERA
            ) == PackageManager.PERMISSION_GRANTED
        }
        
        @JavascriptInterface
        fun requestPermissions() {
            Log.d(TAG, "JS called: requestPermissions")
            runOnUiThread { requestAllPermissions() }
        }
        
        @JavascriptInterface
        fun openBatterySettings() {
            Log.d(TAG, "JS called: openBatterySettings")
            runOnUiThread {
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } catch (e: Exception) {
                    try {
                        startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
                    } catch (e2: Exception) {
                        Toast.makeText(this@MainActivity, "Could not open battery settings", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        }
        
        @JavascriptInterface
        fun openAppSettings() {
            Log.d(TAG, "JS called: openAppSettings")
            runOnUiThread {
                val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                    data = Uri.fromParts("package", packageName, null)
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                startActivity(intent)
            }
        }
        
        @JavascriptInterface
        fun sendAudio(base64Audio: String) {
            Log.d(TAG, "JS sent audio data: ${base64Audio.length} chars")
        }
        
        @JavascriptInterface
        fun log(message: String) {
            Log.d("WebView-JS", message)
        }
    }
    
    private fun ensurePermissionsThenStart() {
        if (hasMicPermission()) {
            startMicService()
        } else {
            requestAllPermissions()
        }
    }
    
    private fun hasMicPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }
    
    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED
    }
    
    private fun startMicService() {
        if (hasMicPermission()) {
            Log.d(TAG, "Starting MicForegroundService")
            val intent = Intent(this, MicForegroundService::class.java)
            ContextCompat.startForegroundService(this, intent)
            sendToWeb(EventBus.Events.MONITORING_STARTED, emptyMap())
        }
    }
    
    private fun sendToWeb(type: String, payload: Map<String, Any>) {
        val json = JSONObject(payload).toString()
        val js = "window.onNativeEvent && window.onNativeEvent('$type', $json);"
        webView.evaluateJavascript(js, null)
    }
    
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
    
    override fun onResume() {
        super.onResume()
        webView.onResume()
    }
    
    override fun onPause() {
        super.onPause()
        webView.onPause()
    }
    
    override fun onDestroy() {
        EventBus.destroy(this)
        webView.destroy()
        super.onDestroy()
    }
}
