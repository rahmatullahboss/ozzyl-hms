import 'package:freezed_annotation/freezed_annotation.dart';

part 'auth_models.freezed.dart';
part 'auth_models.g.dart';

@freezed
sealed class LoginRequest with _$LoginRequest {
  const factory LoginRequest({
    required String email,
    required String password,
  }) = _LoginRequest;

  factory LoginRequest.fromJson(Map<String, dynamic> json) =>
      _$LoginRequestFromJson(json);
}

@freezed
sealed class RegisterRequest with _$RegisterRequest {
  const factory RegisterRequest({
    required String email,
    required String password,
    required String name,
    String? phone,
  }) = _RegisterRequest;

  factory RegisterRequest.fromJson(Map<String, dynamic> json) =>
      _$RegisterRequestFromJson(json);
}

@freezed
sealed class AuthResponse with _$AuthResponse {
  const factory AuthResponse({
    required String token,
    required AuthUser user,
    @Default(false) bool mfaRequired,
  }) = _AuthResponse;

  factory AuthResponse.fromJson(Map<String, dynamic> json) =>
      _$AuthResponseFromJson(json);
}

@freezed
sealed class AuthUser with _$AuthUser {
  const factory AuthUser({
    required String id,
    required String email,
    required String name,
    required String role,
    String? phone,
    String? tenantId,
  }) = _AuthUser;

  factory AuthUser.fromJson(Map<String, dynamic> json) =>
      _$AuthUserFromJson(json);
}

@freezed
sealed class MfaVerifyRequest with _$MfaVerifyRequest {
  const factory MfaVerifyRequest({
    required String code,
    required String tempToken,
  }) = _MfaVerifyRequest;

  factory MfaVerifyRequest.fromJson(Map<String, dynamic> json) =>
      _$MfaVerifyRequestFromJson(json);
}
