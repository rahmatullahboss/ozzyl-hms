import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/repositories/auth_repository.dart';
import 'auth_event.dart';
import 'auth_state.dart';

class AuthBloc extends Bloc<AuthEvent, AuthState> {
  final AuthRepository _authRepository;

  AuthBloc(this._authRepository) : super(const AuthState.initial()) {
    on<CheckAuthStatus>(_onCheckAuthStatus);
    on<LoginRequested>(_onLoginRequested);
    on<RegisterRequested>(_onRegisterRequested);
    on<MfaSubmitted>(_onMfaSubmitted);
    on<BiometricRequested>(_onBiometricRequested);
    on<LogoutRequested>(_onLogoutRequested);
  }

  Future<void> _onCheckAuthStatus(
    CheckAuthStatus event,
    Emitter<AuthState> emit,
  ) async {
    final loggedIn = await _authRepository.isLoggedIn();
    if (loggedIn) {
      final user = await _authRepository.getCurrentUser();
      if (user != null) {
        emit(AuthState.authenticated(user));
      } else {
        emit(const AuthState.unauthenticated());
      }
    } else {
      emit(const AuthState.unauthenticated());
    }
  }

  Future<void> _onLoginRequested(
    LoginRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthState.loading());
    try {
      final response = await _authRepository.login(
        LoginRequest(email: event.email, password: event.password),
      );
      if (response.mfaRequired) {
        emit(AuthState.mfaRequired(response.token));
      } else {
        emit(AuthState.authenticated(response.user));
      }
    } catch (e) {
      emit(AuthState.error(e.toString()));
    }
  }

  Future<void> _onRegisterRequested(
    RegisterRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthState.loading());
    try {
      final response = await _authRepository.register(
        RegisterRequest(
          email: event.email,
          password: event.password,
          name: event.name,
          phone: event.phone,
        ),
      );
      emit(AuthState.authenticated(response.user));
    } catch (e) {
      emit(AuthState.error(e.toString()));
    }
  }

  Future<void> _onMfaSubmitted(
    MfaSubmitted event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthState.loading());
    try {
      final response = await _authRepository.verifyMfa(
        MfaVerifyRequest(code: event.code, tempToken: event.tempToken),
      );
      emit(AuthState.authenticated(response.user));
    } catch (e) {
      emit(AuthState.error(e.toString()));
    }
  }

  Future<void> _onBiometricRequested(
    BiometricRequested event,
    Emitter<AuthState> emit,
  ) async {
    emit(const AuthState.loading());
    try {
      final success = await _authRepository.biometricLogin();
      if (success) {
        final user = await _authRepository.getCurrentUser();
        if (user != null) {
          emit(AuthState.authenticated(user));
          return;
        }
      }
      emit(const AuthState.unauthenticated());
    } catch (e) {
      emit(AuthState.error(e.toString()));
    }
  }

  Future<void> _onLogoutRequested(
    LogoutRequested event,
    Emitter<AuthState> emit,
  ) async {
    await _authRepository.logout();
    emit(const AuthState.unauthenticated());
  }
}
