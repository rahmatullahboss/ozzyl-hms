import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class MockSecureStorage extends Mock implements FlutterSecureStorage {}

void main() {
  group('ApiClient', () {
    test('never logs request or response bodies when logging is enabled', () {
      final apiClient = ApiClient(
        tokenStorage: TokenStorage(MockSecureStorage()),
        enableLogging: true,
      );

      final logInterceptor = apiClient.dio.interceptors
          .whereType<LogInterceptor>()
          .single;

      expect(logInterceptor.requestBody, isFalse);
      expect(logInterceptor.responseBody, isFalse);
      expect(logInterceptor.requestHeader, isFalse);
      expect(logInterceptor.responseHeader, isFalse);
    });
  });
}
