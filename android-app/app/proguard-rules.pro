# Add project specific ProGuard rules here.
-keepattributes JavascriptInterface
-keepclassmembers class com.aks.app.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep EventBus
-keep class com.aks.app.utils.EventBus { *; }

# Keep service classes
-keep class com.aks.app.service.** { *; }

# Keep WebView JS interface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Coroutines
-keepnames class kotlinx.coroutines.internal.MainDispatcherFactory {}
-keepnames class kotlinx.coroutines.CoroutineExceptionHandler {}
