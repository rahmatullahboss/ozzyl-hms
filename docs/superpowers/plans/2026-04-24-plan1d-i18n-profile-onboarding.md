# Plan 1D: Localization, Profile & Onboarding

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Set up BN/EN localization, build the profile feature, and create the onboarding flow

**Architecture:** Flutter's built-in l10n with ARB files. Profile follows Clean Architecture pattern. Onboarding is a simple page-view flow stored in shared_preferences.

**Tech Stack:** flutter_localizations, intl ^0.20.0, go_router ^17.2.2

**Depends on:** Plan 1A + 1B + 1C completed (app scaffold, auth, DI, databases exist)

---

### Task 1: Localization setup (BN + EN)

**Files:**
- Create: `apps/ozzyl_health/lib/l10n/app_en.arb`
- Create: `apps/ozzyl_health/lib/l10n/app_bn.arb`
- Create: `apps/ozzyl_health/l10n.yaml`
- Modify: `apps/ozzyl_health/lib/main.dart`

- [ ] **Step 1: Write l10n config**

```yaml
# apps/ozzyl_health/l10n.yaml
arb-dir: lib/l10n
template-arb-file: app_en.arb
output-localization-file: app_localizations.dart
output-class: AppL10n
synthetic-package: true
```

- [ ] **Step 2: Write English ARB**

```json
{
  "@@locale": "en",
  "appName": "Ozzyl Health",
  "home": "Home",
  "wellness": "Wellness",
  "hospital": "Hospital",
  "articles": "Articles",
  "profile": "Profile",
  "login": "Login",
  "register": "Create Account",
  "email": "Email",
  "password": "Password",
  "name": "Full Name",
  "phone": "Phone",
  "logout": "Logout",
  "biometricLogin": "Biometric Login",
  "continueWithout": "Continue without account",
  "noAccount": "Don't have an account? Register",
  "hasAccount": "Already have an account? Login",
  "mfaTitle": "Two-Factor Authentication",
  "mfaSubtitle": "Open your authenticator app and enter the code",
  "verify": "Verify",
  "enterCode": "Enter your 6-digit code",
  "settings": "Settings",
  "language": "Language",
  "darkMode": "Dark Mode",
  "notifications": "Notifications",
  "emergencyInfo": "Emergency Info",
  "aboutApp": "About",
  "help": "Help",
  "editProfile": "Edit Profile",
  "personalInfo": "Personal Information",
  "hospitalLink": "Hospital Connection",
  "linkHospital": "Link Hospital",
  "unlinkHospital": "Unlink Hospital",
  "onboardingWelcome": "Welcome to Ozzyl Health",
  "onboardingWellness": "Track your daily wellness",
  "onboardingHospital": "Connect with your hospital",
  "onboardingGoals": "Set your health goals",
  "getStarted": "Get Started",
  "skip": "Skip",
  "next": "Next",
  "save": "Save",
  "cancel": "Cancel",
  "retry": "Retry",
  "noData": "No data yet",
  "lastUpdated": "Last updated {time}",
  "@lastUpdated": {
    "placeholders": {
      "time": { "type": "String" }
    }
  },
  "offline": "You are offline",
  "nearbyHospitals": "Nearby Hospitals",
  "myHospitals": "My Hospitals",
  "findHospital": "Find a hospital",
  "bookAppointment": "Book Appointment",
  "appointments": "Appointments",
  "prescriptions": "Prescriptions",
  "labResults": "Lab Results",
  "healthRecords": "Health Records",
  "family": "Family",
  "moodTracker": "Mood Tracker",
  "waterIntake": "Water Intake",
  "sleepLog": "Sleep Log",
  "exerciseLog": "Exercise Log",
  "healthGoals": "Health Goals",
  "mentalWellness": "Mental Wellness",
  "medicationReminders": "Medication Reminders",
  "healthAssessments": "Health Assessments",
  "symptomChecker": "Symptom Checker",
  "womensHealth": "Women's Health",
  "emergency": "Emergency",
  "steps": "Steps",
  "water": "Water",
  "mood": "Mood",
  "streak": "Streak",
  "wellnessScore": "Wellness Score"
}
```

- [ ] **Step 3: Write Bengali ARB**

```json
{
  "@@locale": "bn",
  "appName": "অজিল হেলথ",
  "home": "হোম",
  "wellness": "সুস্থতা",
  "hospital": "হাসপাতাল",
  "articles": "আর্টিকেল",
  "profile": "প্রোফাইল",
  "login": "লগইন",
  "register": "অ্যাকাউন্ট তৈরি করুন",
  "email": "ইমেইল",
  "password": "পাসওয়ার্ড",
  "name": "পুরো নাম",
  "phone": "ফোন",
  "logout": "লগআউট",
  "biometricLogin": "বায়োমেট্রিক লগইন",
  "continueWithout": "অ্যাকাউন্ট ছাড়া চালিয়ে যান",
  "noAccount": "অ্যাকাউন্ট নেই? রেজিস্টার করুন",
  "hasAccount": "অ্যাকাউন্ট আছে? লগইন করুন",
  "mfaTitle": "টু-ফ্যাক্টর অথেনটিকেশন",
  "mfaSubtitle": "আপনার অথেনটিকেটর অ্যাপ খুলুন এবং কোডটি দিন",
  "verify": "যাচাই করুন",
  "enterCode": "আপনার ৬-সংখ্যার কোড দিন",
  "settings": "সেটিংস",
  "language": "ভাষা",
  "darkMode": "ডার্ক মোড",
  "notifications": "নোটিফিকেশন",
  "emergencyInfo": "জরুরি তথ্য",
  "aboutApp": "অ্যাপ সম্পর্কে",
  "help": "সাহায্য",
  "editProfile": "প্রোফাইল সম্পাদনা",
  "personalInfo": "ব্যক্তিগত তথ্য",
  "hospitalLink": "হাসপাতাল সংযোগ",
  "linkHospital": "হাসপাতাল যুক্ত করুন",
  "unlinkHospital": "হাসপাতাল বিচ্ছিন্ন করুন",
  "onboardingWelcome": "অজিল হেলথে স্বাগতম",
  "onboardingWellness": "প্রতিদিনের সুস্থতা ট্র্যাক করুন",
  "onboardingHospital": "আপনার হাসপাতালের সাথে সংযুক্ত হন",
  "onboardingGoals": "আপনার স্বাস্থ্য লক্ষ্য নির্ধারণ করুন",
  "getStarted": "শুরু করুন",
  "skip": "স্কিপ",
  "next": "পরবর্তী",
  "save": "সেভ করুন",
  "cancel": "বাতিল",
  "retry": "আবার চেষ্টা করুন",
  "noData": "এখনো কোন তথ্য নেই",
  "lastUpdated": "সর্বশেষ আপডেট {time}",
  "@lastUpdated": {
    "placeholders": {
      "time": { "type": "String" }
    }
  },
  "offline": "আপনি অফলাইনে আছেন",
  "nearbyHospitals": "কাছের হাসপাতাল",
  "myHospitals": "আমার হাসপাতাল",
  "findHospital": "হাসপাতাল খুঁজুন",
  "bookAppointment": "অ্যাপয়েন্টমেন্ট বুক করুন",
  "appointments": "অ্যাপয়েন্টমেন্ট",
  "prescriptions": "প্রেসক্রিপশন",
  "labResults": "ল্যাব রিপোর্ট",
  "healthRecords": "স্বাস্থ্য রেকর্ড",
  "family": "পরিবার",
  "moodTracker": "মুড ট্র্যাকার",
  "waterIntake": "পানি গ্রহণ",
  "sleepLog": "ঘুমের লগ",
  "exerciseLog": "ব্যায়ামের লগ",
  "healthGoals": "স্বাস্থ্য লক্ষ্য",
  "mentalWellness": "মানসিক সুস্থতা",
  "medicationReminders": "ওষুধের রিমাইন্ডার",
  "healthAssessments": "স্বাস্থ্য মূল্যায়ন",
  "symptomChecker": "লক্ষণ পরীক্ষক",
  "womensHealth": "নারী স্বাস্থ্য",
  "emergency": "জরুরি",
  "steps": "পদক্ষেপ",
  "water": "পানি",
  "mood": "মুড",
  "streak": "ধারাবাহিকতা",
  "wellnessScore": "সুস্থতা স্কোর"
}
```

- [ ] **Step 4: Update main.dart with localization**

Add to `MaterialApp.router` in main.dart:
```dart
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';

// Inside MaterialApp.router:
  localizationsDelegates: const [
    AppL10n.delegate,
    GlobalMaterialLocalizations.delegate,
    GlobalWidgetsLocalizations.delegate,
    GlobalCupertinoLocalizations.delegate,
  ],
  supportedLocales: const [
    Locale('en'),
    Locale('bn'),
  ],
```

- [ ] **Step 5: Generate localizations**

Run: `cd apps/ozzyl_health && flutter gen-l10n`
Expected: Generates `app_localizations.dart` and locale files

- [ ] **Step 6: Commit**

```bash
git add apps/ozzyl_health/
git commit -m "feat(i18n): add Bengali + English localization with 60+ keys"
```

---

### Task 2: Onboarding flow

**Files:**
- Create: `apps/ozzyl_health/lib/features/onboarding/presentation/pages/onboarding_page.dart`
- Modify: `apps/ozzyl_health/lib/core/router/app_router.dart`
- Modify: `apps/ozzyl_health/pubspec.yaml` (add shared_preferences)

- [ ] **Step 1: Add shared_preferences dependency**

Add to `apps/ozzyl_health/pubspec.yaml` dependencies:
```yaml
  shared_preferences: ^2.3.0
```

Run: `cd apps/ozzyl_health && flutter pub get`

- [ ] **Step 2: Write OnboardingPage**

```dart
// apps/ozzyl_health/lib/features/onboarding/presentation/pages/onboarding_page.dart
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class OnboardingPage extends StatefulWidget {
  const OnboardingPage({super.key});

  @override
  State<OnboardingPage> createState() => _OnboardingPageState();
}

class _OnboardingPageState extends State<OnboardingPage> {
  final _controller = PageController();
  int _currentPage = 0;

  static const _pages = [
    _OnboardingData(
      icon: Icons.favorite,
      title: 'Welcome to Ozzyl Health',
      description: 'Your personal health and wellness companion',
      color: AppColors.primary,
    ),
    _OnboardingData(
      icon: Icons.track_changes,
      title: 'Track Your Wellness',
      description: 'Log mood, water, sleep, exercise — build healthy habits with streaks and goals',
      color: AppColors.accent,
    ),
    _OnboardingData(
      icon: Icons.local_hospital,
      title: 'Connect With Hospitals',
      description: 'Find nearby hospitals, book appointments, view prescriptions and lab results',
      color: AppColors.info,
    ),
    _OnboardingData(
      icon: Icons.emoji_events,
      title: 'Achieve Your Goals',
      description: 'Set health goals, track progress, earn badges — stay motivated every day',
      color: AppColors.success,
    ),
  ];

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _completeOnboarding() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('onboarding_complete', true);
    if (mounted) context.go('/login');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.topRight,
              child: TextButton(
                onPressed: _completeOnboarding,
                child: const Text('Skip'),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _controller,
                itemCount: _pages.length,
                onPageChanged: (i) => setState(() => _currentPage = i),
                itemBuilder: (context, i) {
                  final page = _pages[i];
                  return Padding(
                    padding: const EdgeInsets.all(32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(24),
                          decoration: BoxDecoration(
                            color: page.color.withOpacity(0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(page.icon, size: 80, color: page.color),
                        ),
                        const SizedBox(height: 40),
                        Text(
                          page.title,
                          style: Theme.of(context).textTheme.headlineMedium,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 16),
                        Text(
                          page.description,
                          style: Theme.of(context).textTheme.bodyLarge,
                          textAlign: TextAlign.center,
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: List.generate(
                      _pages.length,
                      (i) => Container(
                        margin: const EdgeInsets.only(right: 8),
                        width: _currentPage == i ? 24 : 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: _currentPage == i
                              ? AppColors.primary
                              : AppColors.divider,
                          borderRadius: BorderRadius.circular(4),
                        ),
                      ),
                    ),
                  ),
                  if (_currentPage == _pages.length - 1)
                    ElevatedButton(
                      onPressed: _completeOnboarding,
                      child: const Text('Get Started'),
                    )
                  else
                    ElevatedButton(
                      onPressed: () => _controller.nextPage(
                        duration: const Duration(milliseconds: 300),
                        curve: Curves.easeInOut,
                      ),
                      child: const Text('Next'),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _OnboardingData {
  final IconData icon;
  final String title;
  final String description;
  final Color color;

  const _OnboardingData({
    required this.icon,
    required this.title,
    required this.description,
    required this.color,
  });
}
```

- [ ] **Step 3: Add onboarding route and redirect logic**

Update `app_router.dart` — change initialLocation and add redirect:

```dart
import 'package:shared_preferences/shared_preferences.dart';
import '../../features/onboarding/presentation/pages/onboarding_page.dart';

final appRouter = GoRouter(
  initialLocation: '/onboarding',
  redirect: (context, state) async {
    final prefs = await SharedPreferences.getInstance();
    final onboardingDone = prefs.getBool('onboarding_complete') ?? false;
    final path = state.uri.path;

    if (!onboardingDone && path != '/onboarding') {
      return '/onboarding';
    }
    if (onboardingDone && path == '/onboarding') {
      return '/login';
    }
    return null;
  },
  routes: [
    GoRoute(
      path: '/onboarding',
      builder: (context, state) => const OnboardingPage(),
    ),
    // ... existing routes (login, register, mfa, shell)
  ],
);
```

- [ ] **Step 4: Commit**

```bash
git add apps/ozzyl_health/
git commit -m "feat: add 4-step onboarding flow with page indicators"
```

---

### Task 3: Profile page (basic)

**Files:**
- Modify: `apps/ozzyl_health/lib/features/profile/presentation/pages/profile_page.dart`

- [ ] **Step 1: Replace placeholder with real profile page**

```dart
// apps/ozzyl_health/lib/features/profile/presentation/pages/profile_page.dart
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../auth/presentation/bloc/auth_bloc.dart';
import '../../../auth/presentation/bloc/auth_event.dart';
import '../../../auth/presentation/bloc/auth_state.dart';

class ProfilePage extends StatelessWidget {
  const ProfilePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Profile')),
      body: BlocBuilder<AuthBloc, AuthState>(
        builder: (context, state) {
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // Avatar + name
              Center(
                child: Column(
                  children: [
                    CircleAvatar(
                      radius: 48,
                      backgroundColor: AppColors.primaryLight,
                      child: state is Authenticated
                          ? Text(
                              state.user.name.isNotEmpty
                                  ? state.user.name[0].toUpperCase()
                                  : '?',
                              style: const TextStyle(
                                fontSize: 36,
                                color: Colors.white,
                              ),
                            )
                          : const Icon(Icons.person, size: 48, color: Colors.white),
                    ),
                    const SizedBox(height: 12),
                    if (state is Authenticated) ...[
                      Text(
                        state.user.name,
                        style: Theme.of(context).textTheme.titleLarge,
                      ),
                      Text(
                        state.user.email,
                        style: Theme.of(context).textTheme.bodyMedium,
                      ),
                    ] else
                      const Text('Guest User'),
                  ],
                ),
              ),
              const SizedBox(height: 32),

              // Settings sections
              _SectionHeader(title: 'Personal'),
              _SettingsTile(
                icon: Icons.person_outline,
                title: 'Personal Information',
                onTap: () {},
              ),
              _SettingsTile(
                icon: Icons.emergency_outlined,
                title: 'Emergency Info',
                subtitle: 'SOS contacts, blood type, allergy card',
                onTap: () {},
              ),
              _SettingsTile(
                icon: Icons.local_hospital_outlined,
                title: 'Hospital Connection',
                onTap: () {},
              ),
              _SettingsTile(
                icon: Icons.people_outline,
                title: 'Family Members',
                onTap: () {},
              ),

              const SizedBox(height: 16),
              _SectionHeader(title: 'Preferences'),
              _SettingsTile(
                icon: Icons.notifications_outlined,
                title: 'Notifications',
                onTap: () {},
              ),
              _SettingsTile(
                icon: Icons.language_outlined,
                title: 'Language',
                subtitle: 'English',
                onTap: () {},
              ),
              _SettingsTile(
                icon: Icons.dark_mode_outlined,
                title: 'Dark Mode',
                trailing: Switch(
                  value: Theme.of(context).brightness == Brightness.dark,
                  onChanged: (v) {},
                ),
                onTap: () {},
              ),

              const SizedBox(height: 16),
              _SectionHeader(title: 'About'),
              _SettingsTile(
                icon: Icons.help_outline,
                title: 'Help',
                onTap: () {},
              ),
              _SettingsTile(
                icon: Icons.info_outline,
                title: 'About Ozzyl Health',
                subtitle: 'v1.0.0',
                onTap: () {},
              ),

              const SizedBox(height: 24),
              if (state is Authenticated)
                OutlinedButton.icon(
                  onPressed: () {
                    context.read<AuthBloc>().add(const AuthEvent.logoutRequested());
                    context.go('/login');
                  },
                  icon: const Icon(Icons.logout, color: AppColors.error),
                  label: const Text('Logout', style: TextStyle(color: AppColors.error)),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: AppColors.error),
                    padding: const EdgeInsets.symmetric(vertical: 14),
                  ),
                )
              else
                ElevatedButton(
                  onPressed: () => context.go('/login'),
                  child: const Text('Login / Create Account'),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  const _SectionHeader({required this.title});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8, top: 8),
      child: Text(
        title,
        style: Theme.of(context).textTheme.labelLarge?.copyWith(
              color: AppColors.textSecondary,
            ),
      ),
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final IconData icon;
  final String title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback onTap;

  const _SettingsTile({
    required this.icon,
    required this.title,
    this.subtitle,
    this.trailing,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppColors.primary),
      title: Text(title),
      subtitle: subtitle != null ? Text(subtitle!) : null,
      trailing: trailing ?? const Icon(Icons.chevron_right),
      onTap: onTap,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    );
  }
}
```

- [ ] **Step 2: Verify app builds**

Run: `cd apps/ozzyl_health && flutter build apk --debug`
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**

```bash
git add apps/ozzyl_health/
git commit -m "feat(profile): add profile page with settings, logout, guest mode"
```

---

## Plan 1 Complete

After completing Plans 1A through 1D, you have a running Flutter app with:
- Shared `ozzyl_core` package (theme, API client, auth, constants)
- 5-tab bottom navigation (GoRouter)
- Auth flow (login, register, MFA, biometric, logout)
- Onboarding (4-step page view)
- Profile page (settings list, guest/authenticated modes)
- Wellness DB (11 tables) + Cache DB (8 tables) via Drift
- Dio with auth/tenant/retry interceptors
- Bengali + English localization (60+ keys)
- Dependency injection (get_it)
- BLoC test suite for auth

**Next:** Plan 2 (Wellness Core) — builds the daily wellness features on top of this foundation.
