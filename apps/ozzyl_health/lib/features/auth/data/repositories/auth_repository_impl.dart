import 'package:flutter/services.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:local_auth/local_auth.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/repositories/auth_repository.dart';
import '../datasources/auth_remote_datasource.dart';

const _googleWebClientId = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');

class AuthRepositoryImpl implements AuthRepository {
  final AuthRemoteDatasource _remoteDatasource;
  final TokenStorage _tokenStorage;
  final LocalAuthentication _localAuth;
  final GoogleSignIn _googleSignIn;

  AuthRepositoryImpl({
    required AuthRemoteDatasource remoteDatasource,
    required TokenStorage tokenStorage,
    LocalAuthentication? localAuth,
    GoogleSignIn? googleSignIn,
  })  : _remoteDatasource = remoteDatasource,
        _tokenStorage = tokenStorage,
        _localAuth = localAuth ?? LocalAuthentication(),
        _googleSignIn = googleSignIn ??
            GoogleSignIn(
              scopes: ['email', 'profile'],
              serverClientId:
                  _googleWebClientId.isNotEmpty ? _googleWebClientId : null,
            );

  @override
  Future<AuthResponse> login(LoginRequest request) async {
    final response = await _remoteDatasource.login(request);
    if (!response.mfaRequired) {
      await _tokenStorage.saveToken(response.token);
      if (response.user.tenantId != null) {
        await _tokenStorage.saveTenantId(response.user.tenantId!);
      }
    }
    return response;
  }

  @override
  Future<AuthResponse> register(RegisterRequest request) async {
    final response = await _remoteDatasource.register(request);
    await _tokenStorage.saveToken(response.token);
    return response;
  }

  @override
  Future<AuthResponse> verifyMfa(MfaVerifyRequest request) async {
    final response = await _remoteDatasource.verifyMfa(request);
    await _tokenStorage.saveToken(response.token);
    if (response.user.tenantId != null) {
      await _tokenStorage.saveTenantId(response.user.tenantId!);
    }
    return response;
  }

  @override
  Future<AuthResponse> loginWithGoogle() async {
    try {
      final account = await _googleSignIn.signIn();
      if (account == null) {
        throw Exception('Google sign-in was cancelled');
      }

      final auth = await account.authentication;
      final idToken = auth.idToken;
      if (idToken == null) {
        throw Exception('Google did not return an ID token');
      }

      final response = await _remoteDatasource.loginWithGoogle(idToken);
      await _tokenStorage.saveToken(response.token);
      if (response.user.tenantId != null) {
        await _tokenStorage.saveTenantId(response.user.tenantId!);
      }
      return response;
    } on PlatformException catch (e) {
      if (e.code == 'sign_in_failed' && e.message?.contains('ApiException: 10') == true) {
        throw Exception(
          'Google Sign-In is not configured for this Android build. Add the app package and signing SHA-1/SHA-256 to the Google OAuth client, then rebuild.',
        );
      }
      rethrow;
    }
  }

  @override
  Future<AuthResponse> loginWithPhone(String firebaseIdToken) async {
    final response = await _remoteDatasource.loginWithPhone(firebaseIdToken);
    await _tokenStorage.saveToken(response.token);
    if (response.user.tenantId != null) {
      await _tokenStorage.saveTenantId(response.user.tenantId!);
    }
    return response;
  }

  @override
  Future<void> logout() async {
    try {
      await _remoteDatasource.logout();
      await _googleSignIn.signOut();
    } finally {
      await _tokenStorage.clearAll();
    }
  }

  @override
  Future<bool> isLoggedIn() async {
    return _tokenStorage.hasToken();
  }

  @override
  Future<AuthUser?> getCurrentUser() async {
    return null;
  }

  @override
  Future<bool> biometricLogin() async {
    final canCheck = await _localAuth.canCheckBiometrics;
    if (!canCheck) return false;

    final didAuth = await _localAuth.authenticate(
      localizedReason: 'Authenticate to access Ozzyl Health',
      options: const AuthenticationOptions(
        biometricOnly: true,
        stickyAuth: true,
      ),
    );

    if (!didAuth) return false;

    final hasToken = await _tokenStorage.hasToken();
    return hasToken;
  }
}
