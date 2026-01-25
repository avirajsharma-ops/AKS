# Mira Android App

A WebView-based Android application that loads https://itsmira.cloud/ with native microphone handling.

## Architecture

The app uses a **native microphone foreground service** instead of WebView's getUserMedia() to avoid the common issues with WebView mic permissions and background audio capture.

### Components

1. **MainActivity** - Hosts the WebView and manages the JS bridge
2. **MicForegroundService** - Foreground service that captures audio from the native mic
3. **MicWatchdogWorker** - WorkManager worker that monitors service health
4. **BootReceiver** - Restarts the service after device boot
5. **EventBus** - Communication between service and activity/WebView

## Features

- ✅ Native microphone handling (bypasses WebView mic limitations)
- ✅ Foreground service for background audio capture
- ✅ Auto-recovery with exponential backoff
- ✅ Watchdog to restart stalled service
- ✅ Boot receiver for auto-start after reboot
- ✅ Two-way JavaScript bridge for WebView communication
- ✅ Full-screen immersive mode

## JavaScript Bridge API

From JavaScript in the WebView, you can use:

```javascript
// Check if running in native app
if (window.isNativeMiraApp) {
    console.log('Running in native Mira app');
}

// Start microphone monitoring
AndroidBridge.startMonitoring();

// Stop microphone monitoring
AndroidBridge.stopMonitoring();

// Get current status
const status = JSON.parse(AndroidBridge.getStatus());
console.log(status); // { isMonitoring, lastFrameMs, hasMicPermission }

// Check mic permission
const hasMic = AndroidBridge.hasMicPermission();

// Request mic permission
AndroidBridge.requestMicPermission();

// Open battery optimization settings
AndroidBridge.openBatterySettings();

// Open app settings
AndroidBridge.openAppSettings();

// Log to native console
AndroidBridge.log('Hello from web');
```

### Receiving Events from Native

```javascript
window.onNativeEvent = (type, payload) => {
    switch (type) {
        case 'MONITORING_STARTED':
            console.log('Mic monitoring started');
            break;
        case 'MONITORING_STOPPED':
            console.log('Mic monitoring stopped');
            break;
        case 'AUDIO_DATA':
            // payload.audio = base64 encoded PCM audio
            // payload.sampleRate = 16000
            // payload.timestamp = ms since epoch
            handleAudioData(payload);
            break;
        case 'LOUD_SOUND':
            console.log('Loud sound detected, RMS:', payload.rms);
            break;
        case 'MIC_PERMISSION_DENIED':
            console.log('User denied mic permission');
            break;
        case 'ERROR':
            console.error('Native error:', payload.message);
            break;
    }
};
```

## Build

1. Open in Android Studio
2. Sync Gradle
3. Build > Make Project
4. Run on device (emulator mic may not work reliably)

## Permissions

The app requests:
- `RECORD_AUDIO` - For microphone access
- `FOREGROUND_SERVICE` / `FOREGROUND_SERVICE_MICROPHONE` - For background mic
- `POST_NOTIFICATIONS` (Android 13+) - For foreground service notification
- `RECEIVE_BOOT_COMPLETED` - To restart after reboot
- `INTERNET` - For WebView

## Battery Optimization

For reliable background operation, users should:
1. Disable battery optimization for the app
2. On Samsung/Xiaomi/Oppo: Add to "unmonitored apps" or similar

The app provides `AndroidBridge.openBatterySettings()` to help users navigate to these settings.

## Target SDK

- minSdk: 26 (Android 8.0)
- targetSdk: 34 (Android 14)
- Kotlin: 1.9.20
- Gradle: 8.2
