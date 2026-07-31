import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_health/core/router/auth_route_policy.dart';

void main() {
  group('AuthRoutePolicy', () {
    test(
        'sends protected routes to login when onboarding is complete but user is not authenticated',
        () {
      final redirect = AuthRoutePolicy.redirectFor(
        path: '/health-records',
        onboardingComplete: true,
        isAuthenticated: false,
      );

      expect(redirect, '/login');
    });

    test('allows authenticated users to open protected health routes', () {
      final redirect = AuthRoutePolicy.redirectFor(
        path: '/health-records',
        onboardingComplete: true,
        isAuthenticated: true,
      );

      expect(redirect, isNull);
    });

    test('keeps emergency route available without onboarding or authentication',
        () {
      final redirect = AuthRoutePolicy.redirectFor(
        path: '/emergency',
        onboardingComplete: false,
        isAuthenticated: false,
      );

      expect(redirect, isNull);
    });

    test('sends authenticated users away from login to home', () {
      final redirect = AuthRoutePolicy.redirectFor(
        path: '/login',
        onboardingComplete: true,
        isAuthenticated: true,
      );

      expect(redirect, '/home');
    });
  });
}
