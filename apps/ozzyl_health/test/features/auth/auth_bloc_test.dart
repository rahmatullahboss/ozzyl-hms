import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_health/features/auth/presentation/bloc/auth_event.dart';

void main() {
  group('AuthBloc', () {
    test('checkAuthStatus event exists', () {
      const event = AuthEvent.checkAuthStatus();
      expect(event, isA<AuthEvent>());
    });
  });
}
