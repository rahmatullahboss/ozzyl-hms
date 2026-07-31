# Plan 1A: Project Scaffolding & Core Package

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the Flutter project, shared Dart package, and core infrastructure (DI, constants, theme)

**Architecture:** Clean Architecture monorepo — `apps/ozzyl_health/` depends on `packages/ozzyl_core/`

**Tech Stack:** Flutter 3.x, Dart 3.x, get_it ^8.0.0, freezed ^3.0.0

---

### Task 1: Create ozzyl_core shared package

**Files:**
- Create: `packages/ozzyl_core/pubspec.yaml`
- Create: `packages/ozzyl_core/lib/ozzyl_core.dart`
- Create: `packages/ozzyl_core/lib/src/constants/api_constants.dart`
- Create: `packages/ozzyl_core/lib/src/constants/app_constants.dart`

- [ ] **Step 1: Create the package directory**

```bash
mkdir -p packages/ozzyl_core/lib/src/constants
```

- [ ] **Step 2: Write pubspec.yaml**

```yaml
# packages/ozzyl_core/pubspec.yaml
name: ozzyl_core
description: Shared core package for Ozzyl Health and Ozzyl HMS Flutter apps
version: 0.1.0
publish_to: none

environment:
  sdk: ">=3.5.0 <4.0.0"

dependencies:
  dio: ^5.0.0
  flutter_secure_storage: ^9.0.0
  freezed_annotation: ^3.0.0
  json_annotation: ^4.9.0
  connectivity_plus: ^6.0.0

dev_dependencies:
  build_runner: ^2.13.1
  freezed: ^3.0.0
  json_serializable: ^6.9.0
  flutter_lints: ^5.0.0
```

- [ ] **Step 3: Write barrel export file**

```dart
// packages/ozzyl_core/lib/ozzyl_core.dart
library ozzyl_core;

export 'src/constants/api_constants.dart';
export 'src/constants/app_constants.dart';
```

- [ ] **Step 4: Write API constants**

```dart
// packages/ozzyl_core/lib/src/constants/api_constants.dart
abstract final class ApiConstants {
  static const String prodBaseUrl =
      'https://hms-saas-production.rahmatullahzisan.workers.dev';
  static const String stagingBaseUrl =
      'https://hms-saas-staging.rahmatullahzisan.workers.dev';

  static const String authLogin = '/api/auth/login';
  static const String authRegister = '/api/auth/register';
  static const String authLogout = '/api/auth/logout';
  static const String authMfaVerify = '/api/auth/mfa/verify';

  static const String appointments = '/api/v1/appointments';
  static const String prescriptions = '/api/v1/prescriptions';
  static const String labResults = '/api/v1/lab/results';
  static const String patientPhr = '/api/v1/patient-phr';
  static const String wellnessSync = '/api/v1/wellness/sync';
  static const String doctors = '/api/v1/doctors';
  static const String publicHospitals = '/api/v1/public/hospitals';
  static const String patientFamily = '/api/v1/patients/family';
  static const String pushNotifications = '/api/v1/push-notifications';
  static const String patientProfile = '/api/v1/patients/me';
  static const String healthArticles = '/api/v1/public/health-articles';
  static const String linkHospital = '/api/v1/patients/link-hospital';
  static const String ai = '/api/v1/ai';
}
```

- [ ] **Step 5: Write app constants**

```dart
// packages/ozzyl_core/lib/src/constants/app_constants.dart
abstract final class AppConstants {
  static const String appName = 'Ozzyl Health';
  static const Duration cacheTtl = Duration(hours: 24);
  static const int maxRetryAttempts = 3;
  static const Duration retryDelay = Duration(seconds: 2);
  static const int syncBatchSize = 50;
}
```

- [ ] **Step 6: Verify package resolves**

Run: `cd packages/ozzyl_core && dart pub get`
Expected: "Resolving dependencies... Got dependencies!"

- [ ] **Step 7: Commit**

```bash
git add packages/ozzyl_core/
git commit -m "feat: scaffold ozzyl_core shared Dart package with constants"
```

---

### Task 2: Create ozzyl_health Flutter app

**Files:**
- Create: `apps/ozzyl_health/` (Flutter project)
- Modify: `apps/ozzyl_health/pubspec.yaml`

- [ ] **Step 1: Create Flutter project**

```bash
cd apps
flutter create --org com.ozzyl --project-name ozzyl_health ozzyl_health
```

- [ ] **Step 2: Replace pubspec.yaml with full dependencies**

```yaml
# apps/ozzyl_health/pubspec.yaml
name: ozzyl_health
description: Ozzyl Health — wellness-first mobile app with hospital connectivity
publish_to: none
version: 1.0.0+1

environment:
  sdk: ">=3.5.0 <4.0.0"

dependencies:
  flutter:
    sdk: flutter
  flutter_localizations:
    sdk: flutter

  # Core
  ozzyl_core:
    path: ../../packages/ozzyl_core
  flutter_bloc: ^9.1.0
  bloc: ^9.0.0
  get_it: ^8.0.0
  go_router: ^17.2.2
  dio: ^5.0.0
  flutter_secure_storage: ^9.0.0

  # Database & Offline
  drift: ^2.32.1
  drift_flutter: ^0.1.0
  connectivity_plus: ^6.0.0

  # Code Generation (annotations)
  freezed_annotation: ^3.0.0
  json_annotation: ^4.9.0

  # UI
  lottie: ^3.0.0
  fl_chart: ^0.70.0
  shimmer: ^3.0.0
  cached_network_image: ^3.0.0

  # Health & Sensors
  pedometer: ^4.0.0
  local_auth: ^2.0.0
  geolocator: ^13.0.0
  flutter_local_notifications: ^18.0.0
  firebase_messaging: ^15.0.0

  # Utilities
  intl: ^0.20.0
  share_plus: ^10.0.0
  url_launcher: ^6.0.0

dev_dependencies:
  flutter_test:
    sdk: flutter
  build_runner: ^2.13.1
  freezed: ^3.0.0
  json_serializable: ^6.9.0
  drift_dev: ^2.32.1
  bloc_test: ^10.0.0
  bloc_lint: ^0.3.0
  mocktail: ^1.0.0
  flutter_lints: ^5.0.0

flutter:
  uses-material-design: true
  generate: true

  assets:
    - assets/lottie/
    - assets/images/
```

- [ ] **Step 3: Create asset directories**

```bash
mkdir -p apps/ozzyl_health/assets/lottie
mkdir -p apps/ozzyl_health/assets/images
```

- [ ] **Step 4: Install dependencies**

Run: `cd apps/ozzyl_health && flutter pub get`
Expected: Dependencies resolve successfully

- [ ] **Step 5: Verify app runs**

Run: `cd apps/ozzyl_health && flutter run --no-sound-null-safety` (or just `flutter run`)
Expected: Default Flutter counter app launches

- [ ] **Step 6: Commit**

```bash
git add apps/ozzyl_health/
git commit -m "feat: scaffold ozzyl_health Flutter app with all dependencies"
```

---

### Task 3: Theme system (Vibrant & Motivational)

**Files:**
- Create: `packages/ozzyl_core/lib/src/theme/app_colors.dart`
- Create: `packages/ozzyl_core/lib/src/theme/app_theme.dart`
- Create: `packages/ozzyl_core/lib/src/theme/app_typography.dart`
- Modify: `packages/ozzyl_core/lib/ozzyl_core.dart`
- Modify: `packages/ozzyl_core/pubspec.yaml`

- [ ] **Step 1: Add Flutter SDK dependency to ozzyl_core**

Add to `packages/ozzyl_core/pubspec.yaml` dependencies:
```yaml
dependencies:
  flutter:
    sdk: flutter
  # ... existing deps
```

- [ ] **Step 2: Write color palette**

```dart
// packages/ozzyl_core/lib/src/theme/app_colors.dart
import 'package:flutter/material.dart';

abstract final class AppColors {
  // Primary — Teal
  static const Color primary = Color(0xFF00897B);
  static const Color primaryLight = Color(0xFF4DB6AC);
  static const Color primaryDark = Color(0xFF00695C);

  // Accent — Coral
  static const Color accent = Color(0xFFFF6F61);
  static const Color accentLight = Color(0xFFFF8A80);
  static const Color accentDark = Color(0xFFE64A45);

  // Wellness ring colors
  static const Color stepsRing = Color(0xFF26C6DA);
  static const Color waterRing = Color(0xFF42A5F5);
  static const Color moodRing = Color(0xFFFFCA28);

  // Mood levels
  static const Color moodGreat = Color(0xFF66BB6A);
  static const Color moodGood = Color(0xFF9CCC65);
  static const Color moodOkay = Color(0xFFFFCA28);
  static const Color moodLow = Color(0xFFFFA726);
  static const Color moodBad = Color(0xFFEF5350);

  // Neutral
  static const Color background = Color(0xFFFAFAFA);
  static const Color surface = Color(0xFFFFFFFF);
  static const Color textPrimary = Color(0xFF212121);
  static const Color textSecondary = Color(0xFF757575);
  static const Color divider = Color(0xFFE0E0E0);

  // Dark mode
  static const Color darkBackground = Color(0xFF121212);
  static const Color darkSurface = Color(0xFF1E1E1E);
  static const Color darkTextPrimary = Color(0xFFE0E0E0);
  static const Color darkTextSecondary = Color(0xFF9E9E9E);

  // Status
  static const Color success = Color(0xFF4CAF50);
  static const Color warning = Color(0xFFFFC107);
  static const Color error = Color(0xFFE53935);
  static const Color info = Color(0xFF2196F3);

  // Gradients
  static const LinearGradient primaryGradient = LinearGradient(
    colors: [primary, Color(0xFF26A69A)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient accentGradient = LinearGradient(
    colors: [accent, Color(0xFFFF8A65)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );

  static const LinearGradient warmGradient = LinearGradient(
    colors: [Color(0xFFFF6F61), Color(0xFFFFCA28)],
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
  );
}
```

- [ ] **Step 3: Write typography**

```dart
// packages/ozzyl_core/lib/src/theme/app_typography.dart
import 'package:flutter/material.dart';
import 'app_colors.dart';

abstract final class AppTypography {
  static const String fontFamily = 'Inter';

  static TextTheme get lightTextTheme => const TextTheme(
        displayLarge: TextStyle(
          fontSize: 32,
          fontWeight: FontWeight.w700,
          color: AppColors.textPrimary,
          letterSpacing: -0.5,
        ),
        headlineLarge: TextStyle(
          fontSize: 28,
          fontWeight: FontWeight.w700,
          color: AppColors.textPrimary,
        ),
        headlineMedium: TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
        titleLarge: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
        titleMedium: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
        ),
        bodyLarge: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: AppColors.textPrimary,
        ),
        bodyMedium: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: AppColors.textSecondary,
        ),
        labelLarge: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppColors.textPrimary,
          letterSpacing: 0.5,
        ),
      );

  static TextTheme get darkTextTheme => const TextTheme(
        displayLarge: TextStyle(
          fontSize: 32,
          fontWeight: FontWeight.w700,
          color: AppColors.darkTextPrimary,
          letterSpacing: -0.5,
        ),
        headlineLarge: TextStyle(
          fontSize: 28,
          fontWeight: FontWeight.w700,
          color: AppColors.darkTextPrimary,
        ),
        headlineMedium: TextStyle(
          fontSize: 24,
          fontWeight: FontWeight.w600,
          color: AppColors.darkTextPrimary,
        ),
        titleLarge: TextStyle(
          fontSize: 20,
          fontWeight: FontWeight.w600,
          color: AppColors.darkTextPrimary,
        ),
        titleMedium: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          color: AppColors.darkTextPrimary,
        ),
        bodyLarge: TextStyle(
          fontSize: 16,
          fontWeight: FontWeight.w400,
          color: AppColors.darkTextPrimary,
        ),
        bodyMedium: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          color: AppColors.darkTextSecondary,
        ),
        labelLarge: TextStyle(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          color: AppColors.darkTextPrimary,
          letterSpacing: 0.5,
        ),
      );
}
```

- [ ] **Step 4: Write theme data**

```dart
// packages/ozzyl_core/lib/src/theme/app_theme.dart
import 'package:flutter/material.dart';
import 'app_colors.dart';
import 'app_typography.dart';

abstract final class AppTheme {
  static ThemeData get light => ThemeData(
        useMaterial3: true,
        brightness: Brightness.light,
        colorSchemeSeed: AppColors.primary,
        scaffoldBackgroundColor: AppColors.background,
        textTheme: AppTypography.lightTextTheme,
        appBarTheme: const AppBarTheme(
          backgroundColor: AppColors.surface,
          foregroundColor: AppColors.textPrimary,
          elevation: 0,
          centerTitle: true,
        ),
        cardTheme: CardTheme(
          color: AppColors.surface,
          elevation: 2,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            textStyle: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: AppColors.surface,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.divider),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.divider),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.primary, width: 2),
          ),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        ),
        bottomNavigationBarTheme: const BottomNavigationBarThemeData(
          backgroundColor: AppColors.surface,
          selectedItemColor: AppColors.primary,
          unselectedItemColor: AppColors.textSecondary,
          type: BottomNavigationBarType.fixed,
          elevation: 8,
        ),
      );

  static ThemeData get dark => ThemeData(
        useMaterial3: true,
        brightness: Brightness.dark,
        colorSchemeSeed: AppColors.primary,
        scaffoldBackgroundColor: AppColors.darkBackground,
        textTheme: AppTypography.darkTextTheme,
        appBarTheme: const AppBarTheme(
          backgroundColor: AppColors.darkSurface,
          foregroundColor: AppColors.darkTextPrimary,
          elevation: 0,
          centerTitle: true,
        ),
        cardTheme: CardTheme(
          color: AppColors.darkSurface,
          elevation: 2,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
        ),
        elevatedButtonTheme: ElevatedButtonThemeData(
          style: ElevatedButton.styleFrom(
            backgroundColor: AppColors.primary,
            foregroundColor: Colors.white,
            padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(12),
            ),
            textStyle: const TextStyle(
              fontSize: 16,
              fontWeight: FontWeight.w600,
            ),
          ),
        ),
        inputDecorationTheme: InputDecorationTheme(
          filled: true,
          fillColor: AppColors.darkSurface,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.divider),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.divider),
          ),
          focusedBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(12),
            borderSide: const BorderSide(color: AppColors.primary, width: 2),
          ),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        ),
        bottomNavigationBarTheme: const BottomNavigationBarThemeData(
          backgroundColor: AppColors.darkSurface,
          selectedItemColor: AppColors.primaryLight,
          unselectedItemColor: AppColors.darkTextSecondary,
          type: BottomNavigationBarType.fixed,
          elevation: 8,
        ),
      );
}
```

- [ ] **Step 5: Update barrel exports**

```dart
// packages/ozzyl_core/lib/ozzyl_core.dart
library ozzyl_core;

export 'src/constants/api_constants.dart';
export 'src/constants/app_constants.dart';
export 'src/theme/app_colors.dart';
export 'src/theme/app_theme.dart';
export 'src/theme/app_typography.dart';
```

- [ ] **Step 6: Run pub get to verify**

Run: `cd packages/ozzyl_core && flutter pub get`
Expected: Resolves successfully

- [ ] **Step 7: Commit**

```bash
git add packages/ozzyl_core/
git commit -m "feat(core): add vibrant theme system with light/dark mode"
```

---

### Task 4: Dependency Injection setup

**Files:**
- Create: `apps/ozzyl_health/lib/core/di/injection.dart`

- [ ] **Step 1: Write DI container**

```dart
// apps/ozzyl_health/lib/core/di/injection.dart
import 'package:get_it/get_it.dart';
import 'package:dio/dio.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

final sl = GetIt.instance;

Future<void> initDependencies() async {
  // Storage
  sl.registerLazySingleton<FlutterSecureStorage>(
    () => const FlutterSecureStorage(),
  );

  // Dio
  sl.registerLazySingleton<Dio>(() {
    final dio = Dio(
      BaseOptions(
        baseUrl: ApiConstants.prodBaseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {'Content-Type': 'application/json'},
      ),
    );
    return dio;
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/ozzyl_health/lib/core/
git commit -m "feat: add get_it dependency injection container"
```

---

### Task 5: GoRouter navigation shell with 5-tab bottom nav

**Files:**
- Create: `apps/ozzyl_health/lib/core/router/app_router.dart`
- Create: `apps/ozzyl_health/lib/features/wellness_dashboard/presentation/pages/home_page.dart`
- Create: `apps/ozzyl_health/lib/features/wellness_dashboard/presentation/pages/wellness_page.dart`
- Create: `apps/ozzyl_health/lib/features/hospital_discovery/presentation/pages/hospital_page.dart`
- Create: `apps/ozzyl_health/lib/features/health_articles/presentation/pages/articles_page.dart`
- Create: `apps/ozzyl_health/lib/features/profile/presentation/pages/profile_page.dart`
- Create: `apps/ozzyl_health/lib/core/router/shell_scaffold.dart`
- Modify: `apps/ozzyl_health/lib/main.dart`

- [ ] **Step 1: Create placeholder pages**

Each page is a simple Scaffold with centered text for now.

```dart
// apps/ozzyl_health/lib/features/wellness_dashboard/presentation/pages/home_page.dart
import 'package:flutter/material.dart';

class HomePage extends StatelessWidget {
  const HomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Home')),
    );
  }
}
```

```dart
// apps/ozzyl_health/lib/features/wellness_dashboard/presentation/pages/wellness_page.dart
import 'package:flutter/material.dart';

class WellnessPage extends StatelessWidget {
  const WellnessPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Wellness')),
    );
  }
}
```

```dart
// apps/ozzyl_health/lib/features/hospital_discovery/presentation/pages/hospital_page.dart
import 'package:flutter/material.dart';

class HospitalPage extends StatelessWidget {
  const HospitalPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Hospital')),
    );
  }
}
```

```dart
// apps/ozzyl_health/lib/features/health_articles/presentation/pages/articles_page.dart
import 'package:flutter/material.dart';

class ArticlesPage extends StatelessWidget {
  const ArticlesPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Articles')),
    );
  }
}
```

```dart
// apps/ozzyl_health/lib/features/profile/presentation/pages/profile_page.dart
import 'package:flutter/material.dart';

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(child: Text('Profile')),
    );
  }
}
```

- [ ] **Step 2: Write shell scaffold with bottom nav**

```dart
// apps/ozzyl_health/lib/core/router/shell_scaffold.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class ShellScaffold extends StatelessWidget {
  final StatefulNavigationShell navigationShell;

  const ShellScaffold({super.key, required this.navigationShell});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell,
      bottomNavigationBar: NavigationBar(
        selectedIndex: navigationShell.currentIndex,
        onDestinationSelected: (index) {
          navigationShell.goBranch(
            index,
            initialLocation: index == navigationShell.currentIndex,
          );
        },
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.home_outlined),
            selectedIcon: Icon(Icons.home),
            label: 'Home',
          ),
          NavigationDestination(
            icon: Icon(Icons.favorite_outline),
            selectedIcon: Icon(Icons.favorite),
            label: 'Wellness',
          ),
          NavigationDestination(
            icon: Icon(Icons.local_hospital_outlined),
            selectedIcon: Icon(Icons.local_hospital),
            label: 'Hospital',
          ),
          NavigationDestination(
            icon: Icon(Icons.article_outlined),
            selectedIcon: Icon(Icons.article),
            label: 'Articles',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: 'Profile',
          ),
        ],
      ),
    );
  }
}
```

- [ ] **Step 3: Write GoRouter config**

```dart
// apps/ozzyl_health/lib/core/router/app_router.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'shell_scaffold.dart';
import '../../features/wellness_dashboard/presentation/pages/home_page.dart';
import '../../features/wellness_dashboard/presentation/pages/wellness_page.dart';
import '../../features/hospital_discovery/presentation/pages/hospital_page.dart';
import '../../features/health_articles/presentation/pages/articles_page.dart';
import '../../features/profile/presentation/pages/profile_page.dart';

final appRouter = GoRouter(
  initialLocation: '/home',
  routes: [
    StatefulShellRoute.indexedStack(
      builder: (context, state, navigationShell) {
        return ShellScaffold(navigationShell: navigationShell);
      },
      branches: [
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/home',
              builder: (context, state) => const HomePage(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/wellness',
              builder: (context, state) => const WellnessPage(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/hospital',
              builder: (context, state) => const HospitalPage(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/articles',
              builder: (context, state) => const ArticlesPage(),
            ),
          ],
        ),
        StatefulShellBranch(
          routes: [
            GoRoute(
              path: '/profile',
              builder: (context, state) => const ProfilePage(),
            ),
          ],
        ),
      ],
    ),
  ],
);
```

- [ ] **Step 4: Update main.dart**

```dart
// apps/ozzyl_health/lib/main.dart
import 'package:flutter/material.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import 'core/di/injection.dart';
import 'core/router/app_router.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initDependencies();
  runApp(const OzzylHealthApp());
}

class OzzylHealthApp extends StatelessWidget {
  const OzzylHealthApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp.router(
      title: AppConstants.appName,
      theme: AppTheme.light,
      darkTheme: AppTheme.dark,
      themeMode: ThemeMode.system,
      routerConfig: appRouter,
      debugShowCheckedModeBanner: false,
    );
  }
}
```

- [ ] **Step 5: Run the app**

Run: `cd apps/ozzyl_health && flutter run`
Expected: App launches with 5-tab bottom navigation, teal theme, tapping each tab shows its placeholder text

- [ ] **Step 6: Commit**

```bash
git add apps/ozzyl_health/
git commit -m "feat: add GoRouter 5-tab navigation shell with vibrant theme"
```
