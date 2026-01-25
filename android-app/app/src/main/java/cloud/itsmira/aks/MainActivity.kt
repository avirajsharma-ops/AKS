package cloud.itsmira.aks

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.*
import android.widget.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import cloud.itsmira.aks.services.MicrophoneService
import com.google.android.material.button.MaterialButton

class MainActivity : AppCompatActivity() {
    
    companion object {
        private const val TAG = "MainActivity"
        private const val WEB_URL = "https://itsmira.cloud"
        private const val PREFS_NAME = "aks_prefs"
        private const val KEY_PERMISSION_DENIED_COUNT = "permission_denied_count"
    }
    
    // Views
    private lateinit var webView: WebView
    private lateinit var loadingView: View
    private lateinit var errorView: View
    private lateinit var permissionView: View
    private lateinit var webViewProgress: ProgressBar
    private lateinit var btnRetry: MaterialButton
    private lateinit var btnGrantPermission: MaterialButton
    private lateinit var btnOpenSettings: MaterialButton
    private lateinit var errorTitle: TextView
    private lateinit var errorMessage: TextView
    private lateinit var loadingText: TextView
    
    // State
    private var isWebViewLoaded = false
    private var pendingPermissionRequest: String? = null
    private var permissionCallback: ((Boolean) -> Unit)? = null
    
    // Permission launchers
    private val microphonePermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        handleMicrophonePermissionResult(isGranted)
    }
    
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        Log.d(TAG, "Notification permission granted: $isGranted")
        // Continue regardless of notification permission
        checkBatteryOptimization()
    }
    
    private val cameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        Log.d(TAG, "Camera permission granted: $isGranted")
        permissionCallback?.invoke(isGranted)
        permissionCallback = null
    }
    
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        
        // Keep screen on and enable hardware acceleration
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        
        setContentView(R.layout.activity_main)
        
        initializeViews()
        setupClickListeners()
        
        // Start permission flow
        checkAndRequestPermissions()
    }
    
    private fun initializeViews() {
        webView = findViewById(R.id.webView)
        loadingView = findViewById(R.id.loadingView)
        errorView = findViewById(R.id.errorView)
        permissionView = findViewById(R.id.permissionView)
        webViewProgress = findViewById(R.id.webViewProgress)
        btnRetry = findViewById(R.id.btnRetry)
        btnGrantPermission = findViewById(R.id.btnGrantPermission)
        btnOpenSettings = findViewById(R.id.btnOpenSettings)
        errorTitle = findViewById(R.id.errorTitle)
        errorMessage = findViewById(R.id.errorMessage)
        loadingText = findViewById(R.id.loadingText)
    }
    
    private fun setupClickListeners() {
        btnRetry.setOnClickListener {
            loadWebView()
        }
        
        btnGrantPermission.setOnClickListener {
            requestMicrophonePermission()
        }
        
        btnOpenSettings.setOnClickListener {
            openAppSettings()
        }
    }
    
    // ==================== Permission Handling ====================
    
    private fun checkAndRequestPermissions() {
        when {
            hasMicrophonePermission() -> {
                // Microphone already granted, check other permissions
                checkNotificationPermission()
            }
            shouldShowRationale() -> {
                // Show permission explanation
                showPermissionView(showSettingsButton = false)
            }
            hasBeenDeniedMultipleTimes() -> {
                // User has denied multiple times, show settings button
                showPermissionView(showSettingsButton = true)
            }
            else -> {
                // First time asking
                showPermissionView(showSettingsButton = false)
            }
        }
    }
    
    private fun hasMicrophonePermission(): Boolean {
        return ContextCompat.checkSelfPermission(
            this, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
    }
    
    private fun shouldShowRationale(): Boolean {
        return shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO)
    }
    
    private fun hasBeenDeniedMultipleTimes(): Boolean {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_PERMISSION_DENIED_COUNT, 0) >= 2
    }
    
    private fun incrementPermissionDeniedCount() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val count = prefs.getInt(KEY_PERMISSION_DENIED_COUNT, 0)
        prefs.edit().putInt(KEY_PERMISSION_DENIED_COUNT, count + 1).apply()
    }
    
    private fun resetPermissionDeniedCount() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putInt(KEY_PERMISSION_DENIED_COUNT, 0).apply()
    }
    
    private fun showPermissionView(showSettingsButton: Boolean) {
        loadingView.visibility = View.GONE
        errorView.visibility = View.GONE
        webView.visibility = View.GONE
        permissionView.visibility = View.VISIBLE
        
        btnGrantPermission.visibility = if (showSettingsButton) View.GONE else View.VISIBLE
        btnOpenSettings.visibility = if (showSettingsButton) View.VISIBLE else View.GONE
    }
    
    private fun requestMicrophonePermission() {
        Log.d(TAG, "Requesting microphone permission")
        microphonePermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }
    
    private fun handleMicrophonePermissionResult(isGranted: Boolean) {
        Log.d(TAG, "Microphone permission granted: $isGranted")
        
        if (isGranted) {
            resetPermissionDeniedCount()
            checkNotificationPermission()
        } else {
            incrementPermissionDeniedCount()
            
            if (hasBeenDeniedMultipleTimes() || !shouldShowRationale()) {
                // Permanently denied or denied multiple times
                showPermissionView(showSettingsButton = true)
            } else {
                // Show rationale again
                showPermissionDeniedDialog()
            }
        }
    }
    
    private fun showPermissionDeniedDialog() {
        AlertDialog.Builder(this)
            .setTitle(R.string.permission_microphone_title)
            .setMessage(R.string.permission_microphone_message)
            .setPositiveButton(R.string.btn_grant_permission) { _, _ ->
                requestMicrophonePermission()
            }
            .setNegativeButton(R.string.btn_cancel) { dialog, _ ->
                dialog.dismiss()
                // Continue without mic permission (limited functionality)
                checkNotificationPermission()
            }
            .setCancelable(false)
            .show()
    }
    
    private fun checkNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            when {
                ContextCompat.checkSelfPermission(
                    this, Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED -> {
                    checkBatteryOptimization()
                }
                else -> {
                    notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        } else {
            checkBatteryOptimization()
        }
    }
    
    private fun checkBatteryOptimization() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (!powerManager.isIgnoringBatteryOptimizations(packageName)) {
                showBatteryOptimizationDialog()
            } else {
                startApp()
            }
        } else {
            startApp()
        }
    }
    
    @SuppressLint("BatteryLife")
    private fun showBatteryOptimizationDialog() {
        AlertDialog.Builder(this)
            .setTitle(R.string.permission_battery_title)
            .setMessage(R.string.permission_battery_message)
            .setPositiveButton(R.string.btn_ok) { _, _ ->
                try {
                    val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                        data = Uri.parse("package:$packageName")
                    }
                    startActivity(intent)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to open battery settings", e)
                }
                startApp()
            }
            .setNegativeButton(R.string.btn_cancel) { _, _ ->
                startApp()
            }
            .setCancelable(false)
            .show()
    }
    
    private fun openAppSettings() {
        try {
            val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
                data = Uri.fromParts("package", packageName, null)
            }
            startActivity(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open app settings", e)
            Toast.makeText(this, "Could not open settings", Toast.LENGTH_SHORT).show()
        }
    }
    
    // ==================== App Start ====================
    
    private fun startApp() {
        permissionView.visibility = View.GONE
        
        if (isNetworkAvailable()) {
            setupWebView()
            loadWebView()
            startMicrophoneService()
        } else {
            showError(
                getString(R.string.error_no_internet),
                "No Internet Connection"
            )
        }
    }
    
    private fun startMicrophoneService() {
        if (hasMicrophonePermission()) {
            Log.d(TAG, "Starting microphone service")
            val serviceIntent = Intent(this, MicrophoneService::class.java)
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        } else {
            Log.w(TAG, "Cannot start microphone service - permission not granted")
        }
    }
    
    // ==================== WebView Setup ====================
    
    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        webView.apply {
            settings.apply {
                // Enable JavaScript
                javaScriptEnabled = true
                
                // Enable DOM Storage
                domStorageEnabled = true
                
                // Enable media playback
                mediaPlaybackRequiresUserGesture = false
                
                // Cache settings
                cacheMode = WebSettings.LOAD_DEFAULT
                databaseEnabled = true
                
                // Allow file access
                allowFileAccess = true
                allowContentAccess = true
                
                // Viewport settings
                useWideViewPort = true
                loadWithOverviewMode = true
                
                // Zoom settings
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
                
                // Mixed content (for debugging only - disable in production)
                mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
                
                // User agent - identify as AKS app
                userAgentString = "$userAgentString AKSApp/1.0"
            }
            
            // Set WebViewClient for handling navigation
            webViewClient = AKSWebViewClient()
            
            // Set WebChromeClient for handling permissions and console
            webChromeClient = AKSWebChromeClient()
            
            // Enable debugging in debug builds
            WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        }
    }
    
    private fun loadWebView() {
        showLoading("Connecting to AKS...")
        
        if (!isNetworkAvailable()) {
            showError(getString(R.string.error_no_internet), "No Internet Connection")
            return
        }
        
        webView.loadUrl(WEB_URL)
    }
    
    // ==================== WebViewClient ====================
    
    private inner class AKSWebViewClient : WebViewClient() {
        
        override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            Log.d(TAG, "Page started: $url")
            showLoading("Loading AKS...")
            webViewProgress.visibility = View.VISIBLE
        }
        
        override fun onPageFinished(view: WebView?, url: String?) {
            super.onPageFinished(view, url)
            Log.d(TAG, "Page finished: $url")
            isWebViewLoaded = true
            webViewProgress.visibility = View.GONE
            showWebView()
            
            // Inject JS to notify app about mic state
            injectJavaScript()
        }
        
        override fun onReceivedError(
            view: WebView?,
            request: WebResourceRequest?,
            error: WebResourceError?
        ) {
            super.onReceivedError(view, request, error)
            
            // Only handle main frame errors
            if (request?.isForMainFrame == true) {
                val errorCode = error?.errorCode ?: -1
                val description = error?.description?.toString() ?: "Unknown error"
                Log.e(TAG, "WebView error: $errorCode - $description")
                
                when (errorCode) {
                    ERROR_HOST_LOOKUP, ERROR_CONNECT -> {
                        showError(getString(R.string.error_no_internet), "Connection Failed")
                    }
                    ERROR_TIMEOUT -> {
                        showError(getString(R.string.error_timeout), "Timeout")
                    }
                    else -> {
                        showError(getString(R.string.error_page_load_failed), "Error")
                    }
                }
            }
        }
        
        override fun onReceivedSslError(
            view: WebView?,
            handler: SslErrorHandler?,
            error: android.net.http.SslError?
        ) {
            Log.e(TAG, "SSL Error: ${error?.toString()}")
            
            // In production, always cancel SSL errors
            if (!BuildConfig.DEBUG) {
                handler?.cancel()
                showError(getString(R.string.error_ssl_certificate), "Security Error")
            } else {
                // In debug, show warning but allow
                AlertDialog.Builder(this@MainActivity)
                    .setTitle("SSL Certificate Warning")
                    .setMessage("There's an issue with the SSL certificate. Continue anyway? (Debug mode only)")
                    .setPositiveButton("Continue") { _, _ -> handler?.proceed() }
                    .setNegativeButton("Cancel") { _, _ -> 
                        handler?.cancel()
                        showError(getString(R.string.error_ssl_certificate), "Security Error")
                    }
                    .show()
            }
        }
        
        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
        ): Boolean {
            val url = request?.url?.toString() ?: return false
            
            // Keep itsmira.cloud URLs in WebView
            return if (url.contains("itsmira.cloud")) {
                false
            } else {
                // Open external URLs in browser
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to open external URL: $url", e)
                }
                true
            }
        }
    }
    
    // ==================== WebChromeClient ====================
    
    private inner class AKSWebChromeClient : WebChromeClient() {
        
        override fun onProgressChanged(view: WebView?, newProgress: Int) {
            super.onProgressChanged(view, newProgress)
            webViewProgress.progress = newProgress
        }
        
        override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
            Log.d(TAG, "WebView Console: ${consoleMessage?.message()}")
            return super.onConsoleMessage(consoleMessage)
        }
        
        override fun onPermissionRequest(request: PermissionRequest?) {
            Log.d(TAG, "Permission request: ${request?.resources?.contentToString()}")
            
            request?.resources?.let { resources ->
                val granted = mutableListOf<String>()
                
                resources.forEach { resource ->
                    when (resource) {
                        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> {
                            if (hasMicrophonePermission()) {
                                granted.add(resource)
                                Log.d(TAG, "Granting AUDIO_CAPTURE to WebView")
                            } else {
                                Log.d(TAG, "Requesting mic permission from WebView request")
                                runOnUiThread {
                                    permissionCallback = { isGranted ->
                                        if (isGranted) {
                                            request.grant(arrayOf(resource))
                                        } else {
                                            request.deny()
                                        }
                                    }
                                    requestMicrophonePermission()
                                }
                                return
                            }
                        }
                        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> {
                            if (ContextCompat.checkSelfPermission(
                                    this@MainActivity, Manifest.permission.CAMERA
                                ) == PackageManager.PERMISSION_GRANTED
                            ) {
                                granted.add(resource)
                                Log.d(TAG, "Granting VIDEO_CAPTURE to WebView")
                            } else {
                                permissionCallback = { isGranted ->
                                    if (isGranted) {
                                        request.grant(arrayOf(resource))
                                    } else {
                                        request.deny()
                                    }
                                }
                                cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
                                return
                            }
                        }
                    }
                }
                
                if (granted.isNotEmpty()) {
                    request.grant(granted.toTypedArray())
                } else {
                    request.deny()
                }
            }
        }
        
        override fun onPermissionRequestCanceled(request: PermissionRequest?) {
            super.onPermissionRequestCanceled(request)
            permissionCallback = null
        }
    }
    
    // ==================== JavaScript Injection ====================
    
    private fun injectJavaScript() {
        // Inject bridge for native app communication
        val js = """
            (function() {
                // Notify web app that we're in native app
                window.isAKSNativeApp = true;
                window.dispatchEvent(new CustomEvent('aksNativeAppReady', {
                    detail: { 
                        platform: 'android',
                        version: '1.0',
                        hasMicPermission: ${hasMicrophonePermission()}
                    }
                }));
                console.log('AKS Native App bridge initialized');
            })();
        """.trimIndent()
        
        webView.evaluateJavascript(js, null)
    }
    
    // ==================== UI State Management ====================
    
    private fun showLoading(message: String = "Loading...") {
        runOnUiThread {
            loadingText.text = message
            loadingView.visibility = View.VISIBLE
            errorView.visibility = View.GONE
            webView.visibility = View.GONE
        }
    }
    
    private fun showWebView() {
        runOnUiThread {
            loadingView.visibility = View.GONE
            errorView.visibility = View.GONE
            webView.visibility = View.VISIBLE
        }
    }
    
    private fun showError(message: String, title: String = "Error") {
        runOnUiThread {
            errorTitle.text = title
            errorMessage.text = message
            loadingView.visibility = View.GONE
            errorView.visibility = View.VISIBLE
            webView.visibility = View.GONE
        }
    }
    
    // ==================== Network Utilities ====================
    
    private fun isNetworkAvailable(): Boolean {
        val connectivityManager = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val network = connectivityManager.activeNetwork ?: return false
            val capabilities = connectivityManager.getNetworkCapabilities(network) ?: return false
            
            capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) &&
                    capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        } else {
            @Suppress("DEPRECATION")
            connectivityManager.activeNetworkInfo?.isConnected == true
        }
    }
    
    // ==================== Lifecycle ====================
    
    override fun onResume() {
        super.onResume()
        webView.onResume()
        
        // Check if permission was granted in settings
        if (permissionView.visibility == View.VISIBLE && hasMicrophonePermission()) {
            checkNotificationPermission()
        }
    }
    
    override fun onPause() {
        super.onPause()
        webView.onPause()
    }
    
    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }
    
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
