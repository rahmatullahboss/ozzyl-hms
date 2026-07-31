import 'package:dio/dio.dart';
import '../../auth/token_storage.dart';

class TenantInterceptor extends Interceptor {
  final TokenStorage _tokenStorage;

  TenantInterceptor(this._tokenStorage);

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final tenantId = await _tokenStorage.getTenantId();
    if (tenantId != null) {
      options.headers['X-Tenant-ID'] = tenantId;
    }
    handler.next(options);
  }
}
