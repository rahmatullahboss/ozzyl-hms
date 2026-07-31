abstract final class AppConstants {
  static const String appName = 'Ozzyl Health';
  static const Duration cacheTtl = Duration(hours: 24);
  static const int maxRetryAttempts = 3;
  static const Duration retryDelay = Duration(seconds: 2);
  static const int syncBatchSize = 50;
}
