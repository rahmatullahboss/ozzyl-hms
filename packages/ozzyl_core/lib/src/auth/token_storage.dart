import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class TokenStorage {
  final FlutterSecureStorage _storage;

  static const _tokenKey = 'auth_token';
  static const _tenantKey = 'tenant_id';
  static const _refreshTokenKey = 'refresh_token';

  TokenStorage(this._storage);

  Future<void> saveToken(String token) async {
    await _storage.write(key: _tokenKey, value: token);
  }

  Future<String?> getToken() async {
    return _storage.read(key: _tokenKey);
  }

  Future<void> saveTenantId(String tenantId) async {
    await _storage.write(key: _tenantKey, value: tenantId);
  }

  Future<String?> getTenantId() async {
    return _storage.read(key: _tenantKey);
  }

  Future<void> saveRefreshToken(String token) async {
    await _storage.write(key: _refreshTokenKey, value: token);
  }

  Future<String?> getRefreshToken() async {
    return _storage.read(key: _refreshTokenKey);
  }

  Future<bool> hasToken() async {
    final token = await getToken();
    return token != null && token.isNotEmpty;
  }

  Future<void> clearAll() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _tenantKey);
    await _storage.delete(key: _refreshTokenKey);
  }
}
