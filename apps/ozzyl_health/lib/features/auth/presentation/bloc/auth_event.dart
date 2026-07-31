import 'package:freezed_annotation/freezed_annotation.dart';

part 'auth_event.freezed.dart';

@freezed
sealed class AuthEvent with _$AuthEvent {
  const factory AuthEvent.loginRequested({
    required String email,
    required String password,
  }) = LoginRequested;

  const factory AuthEvent.registerRequested({
    required String email,
    required String password,
    required String name,
    String? phone,
  }) = RegisterRequested;

  const factory AuthEvent.mfaSubmitted({
    required String code,
    required String tempToken,
  }) = MfaSubmitted;

  const factory AuthEvent.biometricRequested() = BiometricRequested;

  const factory AuthEvent.logoutRequested() = LogoutRequested;

  const factory AuthEvent.checkAuthStatus() = CheckAuthStatus;
}
