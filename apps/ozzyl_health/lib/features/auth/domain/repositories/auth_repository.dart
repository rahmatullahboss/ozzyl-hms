import 'package:ozzyl_core/ozzyl_core.dart';

abstract class AuthRepository {
  Future<AuthResponse> login(LoginRequest request);
  Future<AuthResponse> register(RegisterRequest request);
  Future<AuthResponse> verifyMfa(MfaVerifyRequest request);
  Future<AuthResponse> loginWithGoogle();
  Future<AuthResponse> loginWithPhone(String firebaseIdToken);
  Future<void> logout();
  Future<bool> isLoggedIn();
  Future<AuthUser?> getCurrentUser();
  Future<bool> biometricLogin();
}
