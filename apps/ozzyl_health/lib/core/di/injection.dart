import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:get_it/get_it.dart';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../database/wellness_database.dart';
import '../database/cache_database.dart';
import '../../features/auth/data/datasources/auth_remote_datasource.dart';
import '../../features/auth/data/repositories/auth_repository_impl.dart';
import '../../features/auth/domain/repositories/auth_repository.dart';
import '../services/gamification_service.dart';
import '../services/notification_service.dart';
import '../services/push_notification_service.dart';

final sl = GetIt.instance;

Future<void> initDependencies() async {
  // Storage
  sl.registerLazySingleton<FlutterSecureStorage>(
    createOzzylSecureStorage,
  );

  // Token storage
  sl.registerLazySingleton<TokenStorage>(
    () => TokenStorage(sl<FlutterSecureStorage>()),
  );

  // Connectivity
  sl.registerLazySingleton<ConnectivityService>(() => ConnectivityService());

  // API Client
  sl.registerLazySingleton<ApiClient>(
    () => ApiClient(
      tokenStorage: sl<TokenStorage>(),
      enableLogging: false,
    ),
  );

  // Databases
  sl.registerLazySingleton<WellnessDatabase>(() => WellnessDatabase());
  sl.registerLazySingleton<CacheDatabase>(() => CacheDatabase());

  // Notifications
  sl.registerLazySingleton<NotificationService>(() => NotificationService());
  sl.registerLazySingleton<PushNotificationService>(
    () => PushNotificationService(sl<ApiClient>()),
  );

  // Gamification
  sl.registerLazySingleton<GamificationService>(
    () => GamificationService(sl<WellnessDatabase>()),
  );

  // Auth
  sl.registerLazySingleton<AuthRemoteDatasource>(
    () => AuthRemoteDatasource(sl<ApiClient>()),
  );

  sl.registerLazySingleton<AuthRepository>(
    () => AuthRepositoryImpl(
      remoteDatasource: sl<AuthRemoteDatasource>(),
      tokenStorage: sl<TokenStorage>(),
    ),
  );
}
