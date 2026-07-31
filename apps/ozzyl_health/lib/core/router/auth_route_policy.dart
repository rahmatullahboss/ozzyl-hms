abstract final class AuthRoutePolicy {
  static const Set<String> publicPaths = {
    '/onboarding',
    '/login',
    '/register',
    '/mfa',
    '/emergency',
  };

  static bool isPublicPath(String path) {
    return publicPaths.contains(path);
  }

  static String? redirectFor({
    required String path,
    required bool onboardingComplete,
    required bool isAuthenticated,
  }) {
    if (path == '/emergency') {
      return null;
    }

    if (!onboardingComplete && path != '/onboarding') {
      return '/onboarding';
    }

    if (onboardingComplete && path == '/onboarding') {
      return isAuthenticated ? '/home' : '/login';
    }

    if (isAuthenticated && (path == '/login' || path == '/register')) {
      return '/home';
    }

    if (!isAuthenticated && !isPublicPath(path)) {
      return '/login';
    }

    return null;
  }
}
