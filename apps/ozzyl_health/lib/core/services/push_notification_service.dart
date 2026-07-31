import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

/// Background message handler — must be a top-level function
@pragma('vm:entry-point')
Future<void> _firebaseMessagingBackgroundHandler(RemoteMessage message) async {
  // Background messages are handled by the system tray notification.
  // If we need to do custom work here (e.g., cache to local DB), add it.
  debugPrint('[FCM] Background message: ${message.messageId}');
}

class PushNotificationService {
  final ApiClient _apiClient;
  final FirebaseMessaging _messaging = FirebaseMessaging.instance;

  PushNotificationService(this._apiClient);

  Future<void> init() async {
    FirebaseMessaging.onBackgroundMessage(_firebaseMessagingBackgroundHandler);

    final settings = await _messaging.requestPermission(
      alert: true,
      badge: true,
      sound: true,
      provisional: false,
    );

    if (settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional) {
      // Get and register token
      final token = await _messaging.getToken();
      if (token != null) {
        await _registerToken(token);
      }

      // Listen for token refresh
      _messaging.onTokenRefresh.listen(_registerToken);
    }

    // Handle foreground messages
    FirebaseMessaging.onMessage.listen((RemoteMessage message) {
      debugPrint('[FCM] Foreground message: ${message.notification?.title}');
      // Optionally show a local notification or update in-app badge
    });

    // Handle notification taps when app is in background/terminated
    FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
      debugPrint('[FCM] Message opened app: ${message.data}');
      // Navigation logic can be added here based on message.data['route']
    });

    // Check if app was opened from a terminated state via notification
    final initialMessage = await _messaging.getInitialMessage();
    if (initialMessage != null) {
      debugPrint('[FCM] Initial message: ${initialMessage.data}');
    }
  }

  Future<void> _registerToken(String token) async {
    try {
      await _apiClient.dio.post(
        ApiConstants.pushNotifications,
        data: {
          'device_id': token,
          'platform': 'android',
          'push_token': token,
        },
      );
    } catch (e) {
      debugPrint('[FCM] Token registration failed: $e');
    }
  }

  Future<void> deleteToken() async {
    await _messaging.deleteToken();
  }
}
