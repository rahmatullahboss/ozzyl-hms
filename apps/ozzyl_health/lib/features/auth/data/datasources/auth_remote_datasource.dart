import 'package:dio/dio.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

Map<String, dynamic> patientLoginPayload(LoginRequest request) {
  return {
    'identifier': request.email,
    'password': request.password,
  };
}

Map<String, dynamic> patientGooglePayload(String idToken) {
  return {'credential': idToken};
}

AuthResponse normalizePatientAuthResponse(Map<String, dynamic> json) {
  final token = json['token'];
  final rawUser = json['user'];
  if (token is! String || token.isEmpty || rawUser is! Map) {
    throw const FormatException('Patient authentication response is invalid');
  }
  final user = Map<String, dynamic>.from(rawUser);
  final id = user['id'];
  final name = user['name'];
  if (id == null || '$id'.isEmpty || name is! String || name.trim().isEmpty) {
    throw const FormatException('Patient authentication user is invalid');
  }

  return AuthResponse(
    token: token,
    user: AuthUser(
      id: '$id',
      email: user['email'] == null ? '' : '${user['email']}',
      name: name,
      role: 'patient',
      phone: user['phone'] == null ? null : '${user['phone']}',
      tenantId: null,
    ),
  );
}

void assertVerifiedPatientProfile(Map<String, dynamic> profile) {
  final status = '${profile['authStatus'] ?? ''}'.trim().toLowerCase();
  if (status != 'verified') {
    throw StateError(
      status == 'suspended'
          ? 'Patient account verification is suspended.'
          : 'Patient identity verification is required before sign-in.',
    );
  }
}

class AuthRemoteDatasource {
  final ApiClient _apiClient;

  AuthRemoteDatasource(this._apiClient);

  Future<AuthResponse> login(LoginRequest request) async {
    final response = await _apiClient.dio.post(
      ApiConstants.authLogin,
      data: patientLoginPayload(request),
    );
    final auth = normalizePatientAuthResponse(
      Map<String, dynamic>.from(response.data as Map),
    );
    await _verifyPatientAccess(auth.token);
    return auth;
  }

  Future<AuthResponse> register(RegisterRequest request) async {
    throw UnsupportedError(
      'Patient self-registration requires the identity verification flow.',
    );
  }

  Future<AuthResponse> verifyMfa(MfaVerifyRequest request) async {
    throw UnsupportedError(
      'Patient MFA verification is not configured for this application.',
    );
  }

  Future<AuthResponse> loginWithGoogle(String idToken) async {
    final response = await _apiClient.dio.post(
      '/api/patient-auth/google',
      data: patientGooglePayload(idToken),
    );
    final auth = normalizePatientAuthResponse(
      Map<String, dynamic>.from(response.data as Map),
    );
    await _verifyPatientAccess(auth.token);
    return auth;
  }

  Future<AuthResponse> loginWithPhone(String firebaseIdToken) async {
    throw UnsupportedError(
      'Phone sign-in backend is not configured. Use email or Google sign-in.',
    );
  }

  Future<void> _verifyPatientAccess(String token) async {
    final response = await _apiClient.dio.get(
      '/api/patient-auth/me',
      options: Options(
        headers: {'Authorization': 'Bearer $token'},
      ),
    );
    if (response.data is! Map) {
      throw const FormatException('Patient verification profile is invalid');
    }
    assertVerifiedPatientProfile(
      Map<String, dynamic>.from(response.data as Map),
    );
  }

  Future<void> logout() async {
    await _apiClient.dio.post(ApiConstants.authLogout);
  }
}
