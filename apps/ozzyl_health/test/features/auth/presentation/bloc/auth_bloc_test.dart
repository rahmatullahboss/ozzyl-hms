import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import 'package:ozzyl_health/features/auth/domain/repositories/auth_repository.dart';
import 'package:ozzyl_health/features/auth/presentation/bloc/auth_bloc.dart';
import 'package:ozzyl_health/features/auth/presentation/bloc/auth_event.dart';
import 'package:ozzyl_health/features/auth/presentation/bloc/auth_state.dart';

class MockAuthRepository extends Mock implements AuthRepository {}

void main() {
  late MockAuthRepository mockRepo;
  late AuthBloc bloc;

  const testUser = AuthUser(
    id: '1',
    email: 'test@test.com',
    name: 'Test User',
    role: 'patient',
  );

  const testAuthResponse = AuthResponse(
    token: 'jwt_token',
    user: testUser,
  );

  setUp(() {
    mockRepo = MockAuthRepository();
    bloc = AuthBloc(mockRepo);
  });

  tearDown(() => bloc.close());

  setUpAll(() {
    registerFallbackValue(
      const LoginRequest(email: '', password: ''),
    );
    registerFallbackValue(
      const RegisterRequest(email: '', password: '', name: ''),
    );
    registerFallbackValue(
      const MfaVerifyRequest(code: '', tempToken: ''),
    );
  });

  group('AuthBloc', () {
    blocTest<AuthBloc, AuthState>(
      'emits [loading, authenticated] on successful login',
      build: () {
        when(() => mockRepo.login(any())).thenAnswer((_) async => testAuthResponse);
        return bloc;
      },
      act: (bloc) => bloc.add(
        const AuthEvent.loginRequested(email: 'test@test.com', password: 'pass123'),
      ),
      expect: () => [
        const AuthState.loading(),
        const AuthState.authenticated(testUser),
      ],
    );

    blocTest<AuthBloc, AuthState>(
      'emits [loading, mfaRequired] when MFA is needed',
      build: () {
        when(() => mockRepo.login(any())).thenAnswer(
          (_) async => const AuthResponse(
            token: 'temp_token',
            user: testUser,
            mfaRequired: true,
          ),
        );
        return bloc;
      },
      act: (bloc) => bloc.add(
        const AuthEvent.loginRequested(email: 'test@test.com', password: 'pass123'),
      ),
      expect: () => [
        const AuthState.loading(),
        const AuthState.mfaRequired('temp_token'),
      ],
    );

    blocTest<AuthBloc, AuthState>(
      'emits [loading, error] on login failure',
      build: () {
        when(() => mockRepo.login(any())).thenThrow(Exception('Invalid credentials'));
        return bloc;
      },
      act: (bloc) => bloc.add(
        const AuthEvent.loginRequested(email: 'bad@test.com', password: 'wrong'),
      ),
      expect: () => [
        const AuthState.loading(),
        isA<AuthError>(),
      ],
    );

    blocTest<AuthBloc, AuthState>(
      'emits [unauthenticated] on logout',
      build: () {
        when(() => mockRepo.logout()).thenAnswer((_) async {});
        return bloc;
      },
      act: (bloc) => bloc.add(const AuthEvent.logoutRequested()),
      expect: () => [
        const AuthState.unauthenticated(),
      ],
    );

    blocTest<AuthBloc, AuthState>(
      'emits [loading, authenticated] on successful register',
      build: () {
        when(() => mockRepo.register(any()))
            .thenAnswer((_) async => testAuthResponse);
        return bloc;
      },
      act: (bloc) => bloc.add(
        const AuthEvent.registerRequested(
          email: 'new@test.com',
          password: 'Pass123!',
          name: 'New User',
        ),
      ),
      expect: () => [
        const AuthState.loading(),
        const AuthState.authenticated(testUser),
      ],
    );
  });
}
