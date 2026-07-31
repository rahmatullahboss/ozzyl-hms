# Native Health Integration Setup

This guide covers the native configuration required for HealthKit (iOS) and Health Connect (Android) to work with the Ozzyl Lifestyle wearable sync feature.

## Prerequisites

```bash
cd apps/ozzyl-lifestyle
npm install @capacitor-community/health
npx cap sync
```

---

## iOS — HealthKit

### 1. Enable HealthKit in Xcode

1. Open `ios/App/App.xcworkspace` in Xcode.
2. Select the **App** target → **Signing & Capabilities**.
3. Click **+ Capability** → search for **HealthKit** → add it.

### 2. Add Usage Descriptions to `Info.plist`

Open `ios/App/App/Info.plist` and add:

```xml
<key>NSHealthShareUsageDescription</key>
<string>Ozzyl Lifestyle reads your step count, sleep, and activity data to display health insights in your dashboard.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>Ozzyl Lifestyle may write workout and mindfulness data from in-app activities.</string>
```

### 3. Sync

```bash
npx cap sync ios
```

---

## Android — Health Connect

### 1. Minimum SDK

Ensure `android/app/build.gradle` has:
```groovy
minSdkVersion 28
```

### 2. Add Permissions to `AndroidManifest.xml`

Open `android/app/src/main/AndroidManifest.xml` and add inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.health.READ_STEPS"/>
<uses-permission android:name="android.permission.health.READ_SLEEP"/>
<uses-permission android:name="android.permission.health.READ_TOTAL_CALORIES_BURNED"/>
<uses-permission android:name="android.permission.health.READ_DISTANCE"/>
```

And add this `<intent-filter>` inside the `<activity>` section:

```xml
<intent-filter>
  <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
</intent-filter>
```

### 3. Sync

```bash
npx cap sync android
```

---

## Verification

After native setup, run the app on a device (simulator won't have real health data):

```bash
npx cap run ios        # iOS
npx cap run android    # Android
```

Navigate to **Dashboard → Data tab → Sync Wearables** and tap the sync button. You should see a success toast if health data was found.
