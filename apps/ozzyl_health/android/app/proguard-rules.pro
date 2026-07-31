# Ozzyl Health ProGuard Rules

# Flutter wrapper
-keep class io.flutter.app.** { *; }
-keep class io.flutter.plugin.** { *; }
-keep class io.flutter.util.** { *; }
-keep class io.flutter.view.** { *; }
-keep class io.flutter.** { *; }
-keep class io.flutter.plugins.** { *; }

# Keep classes used by reflection
-keepclasseswithmembers class * {
    @retrofit2.http.* <methods>;
}

# Dio / HTTP
-keepattributes Signature
-keepattributes *Annotation*
-keep class com.squareup.dio.** { *; }
-keep class retrofit2.** { *; }

# Firebase
-keep class com.google.firebase.** { *; }
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.firebase.**
-dontwarn com.google.android.gms.**

# Drift / SQLite
-keep class * extends com.google.protobuf.GeneratedMessageLite { *; }

# Health Connect
-keep class androidx.health.connect.client.** { *; }
-dontwarn androidx.health.connect.client.**

# Biometric
-keep class androidx.biometric.** { *; }

# Geolocator
-keep class com.baseflow.geolocator.** { *; }

# Local Notifications
-keep class com.dexterous.flutterlocalnotifications.** { *; }

# URL Launcher
-keep class io.flutter.plugins.urllauncher.** { *; }

# Secure Storage
-keep class com.it_nomads.fluttersecurestorage.** { *; }

# Google Play Core
-keep class com.google.android.play.core.** { *; }
-dontwarn com.google.android.play.core.**
-keep class com.google.android.play.core.splitinstall.** { *; }
-keep class com.google.android.play.core.tasks.** { *; }

# Remove logging in release builds
-assumenosideeffects class android.util.Log {
    public static boolean isLoggable(java.lang.String, int);
    public static int v(...);
    public static int i(...);
    public static int w(...);
    public static int d(...);
    public static int e(...);
}
