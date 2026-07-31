import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import 'core/di/injection.dart';
import 'core/router/app_router.dart';
import 'features/auth/domain/repositories/auth_repository.dart';
import 'features/auth/presentation/bloc/auth_bloc.dart';
import 'features/auth/presentation/bloc/auth_event.dart';
import 'core/services/notification_service.dart';
import 'core/services/push_notification_service.dart';
import 'core/theme/theme_controller.dart';
import 'l10n/app_localizations.dart';
import 'firebase_options.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  await initDependencies();
  await themeController.load();
  runApp(const OzzylHealthApp());
  _initStartupServices();
}

Future<void> _initStartupServices() async {
  try {
    await sl<NotificationService>().init();
    await sl<PushNotificationService>().init();
  } catch (e) {
    debugPrint('Startup services failed: $e');
  }
}

class OzzylHealthApp extends StatelessWidget {
  const OzzylHealthApp({super.key});

  @override
  Widget build(BuildContext context) {
    return BlocProvider(
      create: (_) => AuthBloc(sl<AuthRepository>())
        ..add(const AuthEvent.checkAuthStatus()),
      child: ValueListenableBuilder<ThemeMode>(
        valueListenable: themeController,
        builder: (context, themeMode, _) {
          return MaterialApp.router(
            title: AppConstants.appName,
            theme: AppTheme.light,
            darkTheme: AppTheme.dark,
            themeMode: themeMode,
            routerConfig: appRouter,
            debugShowCheckedModeBanner: false,
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
          );
        },
      ),
    );
  }
}
