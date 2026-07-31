import 'package:freezed_annotation/freezed_annotation.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

part 'auth_state.freezed.dart';

@freezed
sealed class AuthState with _$AuthState {
  const factory AuthState.initial() = AuthInitial;
  const factory AuthState.loading() = AuthLoading;
  const factory AuthState.authenticated(AuthUser user) = Authenticated;
  const factory AuthState.unauthenticated() = Unauthenticated;
  const factory AuthState.mfaRequired(String tempToken) = MfaRequired;
  const factory AuthState.error(String message) = AuthError;
}
