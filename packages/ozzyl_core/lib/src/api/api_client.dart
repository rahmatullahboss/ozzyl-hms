import 'package:dio/dio.dart';
import '../constants/api_constants.dart';
import '../auth/token_storage.dart';
import 'interceptors/auth_interceptor.dart';
import 'interceptors/tenant_interceptor.dart';
import 'interceptors/retry_interceptor.dart';

class ApiClient {
  final Dio dio;
  final TokenStorage tokenStorage;

  ApiClient._({required this.dio, required this.tokenStorage});

  factory ApiClient({
    required TokenStorage tokenStorage,
    String? baseUrl,
    bool enableLogging = false,
  }) {
    final dio = Dio(
      BaseOptions(
        baseUrl: baseUrl ?? ApiConstants.prodBaseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {'Content-Type': 'application/json'},
      ),
    );

    dio.interceptors.addAll([
      AuthInterceptor(tokenStorage),
      TenantInterceptor(tokenStorage),
      RetryInterceptor(dio),
      if (enableLogging)
        LogInterceptor(
          requestHeader: false,
          requestBody: false,
          responseHeader: false,
          responseBody: false,
        ),
    ]);

    return ApiClient._(dio: dio, tokenStorage: tokenStorage);
  }
}
