import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class MockSecureStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late MockSecureStorage mockStorage;
  late TokenStorage tokenStorage;

  setUp(() {
    mockStorage = MockSecureStorage();
    tokenStorage = TokenStorage(mockStorage);
  });

  group('TokenStorage', () {
    test('saveToken writes to secure storage', () async {
      when(() => mockStorage.write(key: 'auth_token', value: 'test_jwt'))
          .thenAnswer((_) async {});

      await tokenStorage.saveToken('test_jwt');

      verify(() => mockStorage.write(key: 'auth_token', value: 'test_jwt'))
          .called(1);
    });

    test('getToken reads from secure storage', () async {
      when(() => mockStorage.read(key: 'auth_token'))
          .thenAnswer((_) async => 'test_jwt');

      final token = await tokenStorage.getToken();

      expect(token, 'test_jwt');
    });

    test('getToken returns null when no token stored', () async {
      when(() => mockStorage.read(key: 'auth_token'))
          .thenAnswer((_) async => null);

      final token = await tokenStorage.getToken();

      expect(token, isNull);
    });

    test('clearToken deletes from secure storage', () async {
      when(() => mockStorage.delete(key: 'auth_token'))
          .thenAnswer((_) async {});
      when(() => mockStorage.delete(key: 'tenant_id'))
          .thenAnswer((_) async {});
      when(() => mockStorage.delete(key: 'refresh_token'))
          .thenAnswer((_) async {});

      await tokenStorage.clearAll();

      verify(() => mockStorage.delete(key: 'auth_token')).called(1);
      verify(() => mockStorage.delete(key: 'tenant_id')).called(1);
      verify(() => mockStorage.delete(key: 'refresh_token')).called(1);
    });

    test('saveTenantId and getTenantId work', () async {
      when(() => mockStorage.write(key: 'tenant_id', value: 'tenant_123'))
          .thenAnswer((_) async {});
      when(() => mockStorage.read(key: 'tenant_id'))
          .thenAnswer((_) async => 'tenant_123');

      await tokenStorage.saveTenantId('tenant_123');
      final tenantId = await tokenStorage.getTenantId();

      expect(tenantId, 'tenant_123');
    });
  });
}
