# AKS Android App

Native Android app for AKS (AI Knowledge System) with WebView, background microphone service, and always-on voice listening.

## Features

- **WebView-based UI**: Loads the AKS web app from `itsmira.cloud`
- **Background Microphone Service**: Foreground service keeps mic active in background
- **Auto-start on Boot**: Service restarts automatically when device boots
- **Battery Optimization Bypass**: Requests exemption from battery optimization
- **Robust Error Handling**: Network errors, SSL errors, permission denials
- **No Browser Dependencies**: Self-contained WebView with all permissions managed

## Permissions

| Permission | Purpose |
|------------|---------|
| `INTERNET` | Load web content |
| `RECORD_AUDIO` | Voice commands |
| `FOREGROUND_SERVICE` | Background operation |
| `FOREGROUND_SERVICE_MICROPHONE` | Background mic access (Android 14+) |
| `POST_NOTIFICATIONS` | Service notification |
| `WAKE_LOCK` | Keep CPU active |
| `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` | Prevent battery kill |
| `CAMERA` | Optional video calls |

## Building

### Prerequisites
- Android Studio Hedgehog (2023.1.1) or later
- JDK 17
- Android SDK 34

### Steps

1. Open the `android-app` folder in Android Studio
2. Wait for Gradle sync to complete
3. Build → Build Bundle(s) / APK(s) → Build APK(s)

### Command Line Build

```bash
cd android-app
./gradlew assembleRelease
```

APK will be at: `app/build/outputs/apk/release/app-release.apk`

## Configuration

### Change Web URL

Edit `MainActivity.kt`:
```kotlin
private const val WEB_URL = "https://itsmira.cloud"
```

### App Icons

Replace files in `res/mipmap-*` folders with your icons.

### Colors

Edit `res/values/colors.xml` to match your brand.

## Architecture

```
android-app/
├── app/
│   └── src/main/
│       ├── java/cloud/itsmira/aks/
│       │   ├── AKSApplication.kt    # App initialization
│       │   ├── MainActivity.kt       # Main WebView activity
│       │   ├── services/
│       │   │   └── MicrophoneService.kt  # Foreground service
│       │   └── receivers/
│       │       └── BootReceiver.kt   # Boot complete receiver
│       ├── res/
│       │   ├── layout/               # UI layouts
│       │   ├── values/               # Strings, colors, themes
│       │   ├── drawable/             # Icons and graphics
│       │   └── xml/                  # Network security config
│       └── AndroidManifest.xml       # App manifest
├── build.gradle.kts                  # Root build config
└── settings.gradle.kts               # Project settings
```

## Key Components

### MainActivity

- Handles all permission requests (mic, notification, battery)
- Manages WebView lifecycle
- Provides error recovery UI
- Grants WebView mic/camera permissions

### MicrophoneService

- Runs as foreground service
- Shows persistent notification
- Acquires partial wake lock
- Auto-restarts if killed

### BootReceiver

- Listens for device boot
- Restarts MicrophoneService automatically

## Troubleshooting

### Service killed by system

1. Disable battery optimization for the app
2. Add app to "Don't optimize" list
3. On some devices, enable "Auto-start" in settings

### Microphone not working in background

1. Ensure Android 14+ has `FOREGROUND_SERVICE_MICROPHONE` permission
2. Check if battery saver is active
3. Verify foreground service notification is showing

### WebView not loading

1. Check internet connection
2. Verify SSL certificate on server
3. Check network security config allows domain

## Release Checklist

- [ ] Replace debug signing with release keystore
- [ ] Update version code/name in `build.gradle.kts`
- [ ] Replace placeholder app icons
- [ ] Test on multiple Android versions (API 24-34)
- [ ] Verify all permissions work correctly
- [ ] Test background service persistence
- [ ] Test boot receiver functionality

## License

Proprietary - All rights reserved
