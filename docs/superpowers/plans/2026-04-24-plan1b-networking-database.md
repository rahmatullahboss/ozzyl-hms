# Plan 1B: API Client & Drift Databases

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Dio networking layer with interceptors and both Drift databases (wellness + cache)

**Architecture:** API client lives in ozzyl_core (shared). Databases live in ozzyl_health (app-specific). Interceptors handle auth, tenant, offline, retry, caching.

**Tech Stack:** Dio ^5.0.0, Drift ^2.32.1, flutter_secure_storage ^9.0.0, connectivity_plus ^6.0.0

**Depends on:** Plan 1A completed (ozzyl_core package, DI container exist)

---

### Task 1: Auth token storage service

**Files:**
- Create: `packages/ozzyl_core/lib/src/auth/token_storage.dart`
- Create: `packages/ozzyl_core/test/auth/token_storage_test.dart`
- Modify: `packages/ozzyl_core/lib/ozzyl_core.dart`

- [ ] **Step 1: Write the test**

```dart
// packages/ozzyl_core/test/auth/token_storage_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:ozzyl_core/ozzyl_core.dart';

class MockSecureStorage extends Mock implements FlutterSecureStorage {}

void main() {
  late MockSecureStorage mockStorage;
  late TokenStorage tokenStorage;

  setUp(() {
    mockStorage = MockSecureStorage();
    tokenStorage = TokenStorage(mockStorage);
  });

  group('TokenStorage', () {
    test('saveToken writes to secure storage', () async {
      when(() => mockStorage.write(key: 'auth_token', value: 'test_jwt'))
          .thenAnswer((_) async {});

      await tokenStorage.saveToken('test_jwt');

      verify(() => mockStorage.write(key: 'auth_token', value: 'test_jwt'))
          .called(1);
    });

    test('getToken reads from secure storage', () async {
      when(() => mockStorage.read(key: 'auth_token'))
          .thenAnswer((_) async => 'test_jwt');

      final token = await tokenStorage.getToken();

      expect(token, 'test_jwt');
    });

    test('getToken returns null when no token stored', () async {
      when(() => mockStorage.read(key: 'auth_token'))
          .thenAnswer((_) async => null);

      final token = await tokenStorage.getToken();

      expect(token, isNull);
    });

    test('clearToken deletes from secure storage', () async {
      when(() => mockStorage.delete(key: 'auth_token'))
          .thenAnswer((_) async {});
      when(() => mockStorage.delete(key: 'tenant_id'))
          .thenAnswer((_) async {});

      await tokenStorage.clearAll();

      verify(() => mockStorage.delete(key: 'auth_token')).called(1);
      verify(() => mockStorage.delete(key: 'tenant_id')).called(1);
    });

    test('saveTenantId and getTenantId work', () async {
      when(() => mockStorage.write(key: 'tenant_id', value: 'tenant_123'))
          .thenAnswer((_) async {});
      when(() => mockStorage.read(key: 'tenant_id'))
          .thenAnswer((_) async => 'tenant_123');

      await tokenStorage.saveTenantId('tenant_123');
      final tenantId = await tokenStorage.getTenantId();

      expect(tenantId, 'tenant_123');
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/ozzyl_core && flutter test test/auth/token_storage_test.dart`
Expected: FAIL — TokenStorage class not found

- [ ] **Step 3: Write implementation**

```dart
// packages/ozzyl_core/lib/src/auth/token_storage.dart
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class TokenStorage {
  final FlutterSecureStorage _storage;

  static const _tokenKey = 'auth_token';
  static const _tenantKey = 'tenant_id';
  static const _refreshTokenKey = 'refresh_token';

  TokenStorage(this._storage);

  Future<void> saveToken(String token) async {
    await _storage.write(key: _tokenKey, value: token);
  }

  Future<String?> getToken() async {
    return _storage.read(key: _tokenKey);
  }

  Future<void> saveTenantId(String tenantId) async {
    await _storage.write(key: _tenantKey, value: tenantId);
  }

  Future<String?> getTenantId() async {
    return _storage.read(key: _tenantKey);
  }

  Future<void> saveRefreshToken(String token) async {
    await _storage.write(key: _refreshTokenKey, value: token);
  }

  Future<String?> getRefreshToken() async {
    return _storage.read(key: _refreshTokenKey);
  }

  Future<bool> hasToken() async {
    final token = await getToken();
    return token != null && token.isNotEmpty;
  }

  Future<void> clearAll() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _tenantKey);
    await _storage.delete(key: _refreshTokenKey);
  }
}
```

- [ ] **Step 4: Update barrel exports**

Add to `packages/ozzyl_core/lib/ozzyl_core.dart`:
```dart
export 'src/auth/token_storage.dart';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/ozzyl_core && flutter test test/auth/token_storage_test.dart`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/ozzyl_core/
git commit -m "feat(core): add TokenStorage with secure storage for JWT and tenant"
```

---

### Task 2: Dio interceptors

**Files:**
- Create: `packages/ozzyl_core/lib/src/api/interceptors/auth_interceptor.dart`
- Create: `packages/ozzyl_core/lib/src/api/interceptors/tenant_interceptor.dart`
- Create: `packages/ozzyl_core/lib/src/api/interceptors/retry_interceptor.dart`
- Create: `packages/ozzyl_core/lib/src/api/api_client.dart`
- Modify: `packages/ozzyl_core/lib/ozzyl_core.dart`

- [ ] **Step 1: Write AuthInterceptor**

```dart
// packages/ozzyl_core/lib/src/api/interceptors/auth_interceptor.dart
import 'package:dio/dio.dart';
import '../../auth/token_storage.dart';

class AuthInterceptor extends Interceptor {
  final TokenStorage _tokenStorage;

  AuthInterceptor(this._tokenStorage);

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final token = await _tokenStorage.getToken();
    if (token != null) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      await _tokenStorage.clearAll();
    }
    handler.next(err);
  }
}
```

- [ ] **Step 2: Write TenantInterceptor**

```dart
// packages/ozzyl_core/lib/src/api/interceptors/tenant_interceptor.dart
import 'package:dio/dio.dart';
import '../../auth/token_storage.dart';

class TenantInterceptor extends Interceptor {
  final TokenStorage _tokenStorage;

  TenantInterceptor(this._tokenStorage);

  @override
  void onRequest(
    RequestOptions options,
    RequestInterceptorHandler handler,
  ) async {
    final tenantId = await _tokenStorage.getTenantId();
    if (tenantId != null) {
      options.headers['X-Tenant-ID'] = tenantId;
    }
    handler.next(options);
  }
}
```

- [ ] **Step 3: Write RetryInterceptor**

```dart
// packages/ozzyl_core/lib/src/api/interceptors/retry_interceptor.dart
import 'package:dio/dio.dart';
import '../../constants/app_constants.dart';

class RetryInterceptor extends Interceptor {
  final Dio _dio;

  RetryInterceptor(this._dio);

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    final statusCode = err.response?.statusCode;
    final isRetryable = statusCode == null ||
        statusCode >= 500 ||
        err.type == DioExceptionType.connectionTimeout ||
        err.type == DioExceptionType.receiveTimeout;

    if (!isRetryable) {
      handler.next(err);
      return;
    }

    final retryCount = err.requestOptions.extra['retryCount'] ?? 0;
    if (retryCount >= AppConstants.maxRetryAttempts) {
      handler.next(err);
      return;
    }

    final delay = AppConstants.retryDelay * (retryCount + 1);
    await Future.delayed(delay);

    err.requestOptions.extra['retryCount'] = retryCount + 1;

    try {
      final response = await _dio.fetch(err.requestOptions);
      handler.resolve(response);
    } on DioException catch (e) {
      handler.next(e);
    }
  }
}
```

- [ ] **Step 4: Write ApiClient factory**

```dart
// packages/ozzyl_core/lib/src/api/api_client.dart
import 'package:dio/dio.dart';
import '../constants/api_constants.dart';
import '../auth/token_storage.dart';
import 'interceptors/auth_interceptor.dart';
import 'interceptors/tenant_interceptor.dart';
import 'interceptors/retry_interceptor.dart';

class ApiClient {
  final Dio dio;
  final TokenStorage tokenStorage;

  ApiClient._({required this.dio, required this.tokenStorage});

  factory ApiClient({
    required TokenStorage tokenStorage,
    String? baseUrl,
    bool enableLogging = false,
  }) {
    final dio = Dio(
      BaseOptions(
        baseUrl: baseUrl ?? ApiConstants.prodBaseUrl,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 15),
        headers: {'Content-Type': 'application/json'},
      ),
    );

    dio.interceptors.addAll([
      AuthInterceptor(tokenStorage),
      TenantInterceptor(tokenStorage),
      RetryInterceptor(dio),
      if (enableLogging) LogInterceptor(responseBody: true, requestBody: true),
    ]);

    return ApiClient._(dio: dio, tokenStorage: tokenStorage);
  }
}
```

- [ ] **Step 5: Update barrel exports**

Add to `packages/ozzyl_core/lib/ozzyl_core.dart`:
```dart
export 'src/api/api_client.dart';
export 'src/api/interceptors/auth_interceptor.dart';
export 'src/api/interceptors/tenant_interceptor.dart';
export 'src/api/interceptors/retry_interceptor.dart';
```

- [ ] **Step 6: Run pub get to verify**

Run: `cd packages/ozzyl_core && flutter pub get`
Expected: Resolves successfully

- [ ] **Step 7: Commit**

```bash
git add packages/ozzyl_core/
git commit -m "feat(core): add Dio ApiClient with auth, tenant, retry interceptors"
```

---

### Task 3: Wellness Drift database

**Files:**
- Create: `apps/ozzyl_health/lib/core/database/wellness_database.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/mood_entries.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/water_logs.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/sleep_logs.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/exercise_logs.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/health_goals.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/medication_reminders.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/period_tracking.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/journal_entries.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/assessment_results.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/daily_steps.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/sync_queue.dart`

- [ ] **Step 1: Write all table definitions**

```dart
// apps/ozzyl_health/lib/core/database/tables/mood_entries.dart
import 'package:drift/drift.dart';

class MoodEntries extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get timestamp => dateTime().withDefault(currentDateAndTime)();
  IntColumn get moodLevel => integer().check(moodLevel.isBetweenValues(1, 5))();
  TextColumn get notes => text().nullable()();
  TextColumn get tags => text().nullable()();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/water_logs.dart
import 'package:drift/drift.dart';

class WaterLogs extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get timestamp => dateTime().withDefault(currentDateAndTime)();
  IntColumn get amountMl => integer()();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/sleep_logs.dart
import 'package:drift/drift.dart';

class SleepLogs extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get date => dateTime()();
  DateTimeColumn get bedtime => dateTime()();
  DateTimeColumn get wakeTime => dateTime()();
  IntColumn get quality => integer().check(quality.isBetweenValues(1, 5)).nullable()();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/exercise_logs.dart
import 'package:drift/drift.dart';

class ExerciseLogs extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get timestamp => dateTime().withDefault(currentDateAndTime)();
  TextColumn get type => text()();
  IntColumn get durationMin => integer()();
  IntColumn get calories => integer().nullable()();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/health_goals.dart
import 'package:drift/drift.dart';

class HealthGoals extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get title => text()();
  RealColumn get target => real()();
  RealColumn get current => real().withDefault(const Constant(0))();
  TextColumn get unit => text()();
  DateTimeColumn get deadline => dateTime().nullable()();
  BoolColumn get active => boolean().withDefault(const Constant(true))();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/medication_reminders.dart
import 'package:drift/drift.dart';

class MedicationReminders extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get name => text()();
  TextColumn get dosage => text()();
  TextColumn get frequency => text()();
  TextColumn get times => text()();
  BoolColumn get active => boolean().withDefault(const Constant(true))();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/period_tracking.dart
import 'package:drift/drift.dart';

class PeriodTracking extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get date => dateTime()();
  IntColumn get flowLevel => integer().check(flowLevel.isBetweenValues(0, 4))();
  TextColumn get symptoms => text().nullable()();
  TextColumn get notes => text().nullable()();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/journal_entries.dart
import 'package:drift/drift.dart';

class JournalEntries extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get timestamp => dateTime().withDefault(currentDateAndTime)();
  TextColumn get content => text()();
  TextColumn get moodTag => text().nullable()();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/assessment_results.dart
import 'package:drift/drift.dart';

class AssessmentResults extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get type => text()();
  IntColumn get score => integer()();
  DateTimeColumn get date => dateTime().withDefault(currentDateAndTime)();
  TextColumn get answersJson => text()();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/daily_steps.dart
import 'package:drift/drift.dart';

@DataClassName('DailyStep')
class DailySteps extends Table {
  IntColumn get id => integer().autoIncrement()();
  DateTimeColumn get date => dateTime()();
  IntColumn get count => integer()();
  TextColumn get source => text().withDefault(const Constant('pedometer'))();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/sync_queue.dart
import 'package:drift/drift.dart';

class SyncQueue extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get tableName => text()();
  IntColumn get rowId => integer()();
  TextColumn get action => text()();
  DateTimeColumn get createdAt => dateTime().withDefault(currentDateAndTime)();
  DateTimeColumn get syncedAt => dateTime().nullable()();
}
```

- [ ] **Step 2: Write the WellnessDatabase**

```dart
// apps/ozzyl_health/lib/core/database/wellness_database.dart
import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

import 'tables/mood_entries.dart';
import 'tables/water_logs.dart';
import 'tables/sleep_logs.dart';
import 'tables/exercise_logs.dart';
import 'tables/health_goals.dart';
import 'tables/medication_reminders.dart';
import 'tables/period_tracking.dart';
import 'tables/journal_entries.dart';
import 'tables/assessment_results.dart';
import 'tables/daily_steps.dart';
import 'tables/sync_queue.dart';

part 'wellness_database.g.dart';

@DriftDatabase(tables: [
  MoodEntries,
  WaterLogs,
  SleepLogs,
  ExerciseLogs,
  HealthGoals,
  MedicationReminders,
  PeriodTracking,
  JournalEntries,
  AssessmentResults,
  DailySteps,
  SyncQueue,
])
class WellnessDatabase extends _$WellnessDatabase {
  WellnessDatabase([QueryExecutor? executor])
      : super(executor ?? _openConnection());

  @override
  int get schemaVersion => 1;

  static QueryExecutor _openConnection() {
    return driftDatabase(name: 'wellness');
  }
}
```

- [ ] **Step 3: Run code generation**

Run: `cd apps/ozzyl_health && dart run build_runner build --delete-conflicting-outputs`
Expected: Generates `wellness_database.g.dart`

- [ ] **Step 4: Commit**

```bash
git add apps/ozzyl_health/lib/core/database/
git commit -m "feat: add Drift wellness database with 11 tables"
```

---

### Task 4: Cache Drift database

**Files:**
- Create: `apps/ozzyl_health/lib/core/database/cache_database.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/cached_appointments.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/cached_prescriptions.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/cached_lab_results.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/cached_health_records.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/cached_doctors.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/cached_hospitals.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/cached_articles.dart`
- Create: `apps/ozzyl_health/lib/core/database/tables/cached_profile.dart`

- [ ] **Step 1: Write cache table definitions**

```dart
// apps/ozzyl_health/lib/core/database/tables/cached_appointments.dart
import 'package:drift/drift.dart';

class CachedAppointments extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get remoteId => text()();
  TextColumn get dataJson => text()();
  DateTimeColumn get expiresAt => dateTime()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/cached_prescriptions.dart
import 'package:drift/drift.dart';

class CachedPrescriptions extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get remoteId => text()();
  TextColumn get dataJson => text()();
  DateTimeColumn get expiresAt => dateTime()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/cached_lab_results.dart
import 'package:drift/drift.dart';

class CachedLabResults extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get remoteId => text()();
  TextColumn get dataJson => text()();
  DateTimeColumn get expiresAt => dateTime()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/cached_health_records.dart
import 'package:drift/drift.dart';

class CachedHealthRecords extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get recordType => text()();
  TextColumn get dataJson => text()();
  DateTimeColumn get expiresAt => dateTime()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/cached_doctors.dart
import 'package:drift/drift.dart';

class CachedDoctors extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get remoteId => text()();
  TextColumn get dataJson => text()();
  DateTimeColumn get expiresAt => dateTime()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/cached_hospitals.dart
import 'package:drift/drift.dart';

class CachedHospitals extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get remoteId => text()();
  TextColumn get dataJson => text()();
  DateTimeColumn get expiresAt => dateTime()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/cached_articles.dart
import 'package:drift/drift.dart';

class CachedArticles extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get remoteId => text()();
  TextColumn get dataJson => text()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}
```

```dart
// apps/ozzyl_health/lib/core/database/tables/cached_profile.dart
import 'package:drift/drift.dart';

class CachedProfile extends Table {
  IntColumn get id => integer().autoIncrement()();
  TextColumn get dataJson => text()();
  DateTimeColumn get cachedAt => dateTime().withDefault(currentDateAndTime)();
}
```

- [ ] **Step 2: Write CacheDatabase**

```dart
// apps/ozzyl_health/lib/core/database/cache_database.dart
import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';

import 'tables/cached_appointments.dart';
import 'tables/cached_prescriptions.dart';
import 'tables/cached_lab_results.dart';
import 'tables/cached_health_records.dart';
import 'tables/cached_doctors.dart';
import 'tables/cached_hospitals.dart';
import 'tables/cached_articles.dart';
import 'tables/cached_profile.dart';

part 'cache_database.g.dart';

@DriftDatabase(tables: [
  CachedAppointments,
  CachedPrescriptions,
  CachedLabResults,
  CachedHealthRecords,
  CachedDoctors,
  CachedHospitals,
  CachedArticles,
  CachedProfile,
])
class CacheDatabase extends _$CacheDatabase {
  CacheDatabase([QueryExecutor? executor])
      : super(executor ?? _openConnection());

  @override
  int get schemaVersion => 1;

  static QueryExecutor _openConnection() {
    return driftDatabase(name: 'cache');
  }

  Future<void> clearExpired() async {
    final now = DateTime.now();
    await (delete(cachedAppointments)
          ..where((t) => t.expiresAt.isSmallerThanValue(now)))
        .go();
    await (delete(cachedPrescriptions)
          ..where((t) => t.expiresAt.isSmallerThanValue(now)))
        .go();
    await (delete(cachedLabResults)
          ..where((t) => t.expiresAt.isSmallerThanValue(now)))
        .go();
    await (delete(cachedHealthRecords)
          ..where((t) => t.expiresAt.isSmallerThanValue(now)))
        .go();
    await (delete(cachedDoctors)
          ..where((t) => t.expiresAt.isSmallerThanValue(now)))
        .go();
    await (delete(cachedHospitals)
          ..where((t) => t.expiresAt.isSmallerThanValue(now)))
        .go();
  }
}
```

- [ ] **Step 3: Run code generation**

Run: `cd apps/ozzyl_health && dart run build_runner build --delete-conflicting-outputs`
Expected: Generates `cache_database.g.dart`

- [ ] **Step 4: Register databases in DI**

Update `apps/ozzyl_health/lib/core/di/injection.dart` — add after existing registrations:

```dart
import '../database/wellness_database.dart';
import '../database/cache_database.dart';

// Inside initDependencies():

  // Databases
  sl.registerLazySingleton<WellnessDatabase>(() => WellnessDatabase());
  sl.registerLazySingleton<CacheDatabase>(() => CacheDatabase());
```

- [ ] **Step 5: Commit**

```bash
git add apps/ozzyl_health/lib/core/database/ apps/ozzyl_health/lib/core/di/
git commit -m "feat: add Drift cache database with 8 tables + register in DI"
```

---

### Task 5: Connectivity service

**Files:**
- Create: `packages/ozzyl_core/lib/src/api/connectivity_service.dart`
- Modify: `packages/ozzyl_core/lib/ozzyl_core.dart`

- [ ] **Step 1: Write ConnectivityService**

```dart
// packages/ozzyl_core/lib/src/api/connectivity_service.dart
import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';

class ConnectivityService {
  final Connectivity _connectivity;
  late final StreamController<bool> _controller;

  ConnectivityService([Connectivity? connectivity])
      : _connectivity = connectivity ?? Connectivity() {
    _controller = StreamController<bool>.broadcast();
    _connectivity.onConnectivityChanged.listen((results) {
      final isOnline = !results.contains(ConnectivityResult.none);
      _controller.add(isOnline);
    });
  }

  Stream<bool> get onConnectivityChanged => _controller.stream;

  Future<bool> get isOnline async {
    final results = await _connectivity.checkConnectivity();
    return !results.contains(ConnectivityResult.none);
  }

  void dispose() {
    _controller.close();
  }
}
```

- [ ] **Step 2: Export and register**

Add to `packages/ozzyl_core/lib/ozzyl_core.dart`:
```dart
export 'src/api/connectivity_service.dart';
```

Update DI in `apps/ozzyl_health/lib/core/di/injection.dart`:
```dart
import 'package:ozzyl_core/ozzyl_core.dart';

// Inside initDependencies():
  sl.registerLazySingleton<ConnectivityService>(() => ConnectivityService());
```

- [ ] **Step 3: Commit**

```bash
git add packages/ozzyl_core/ apps/ozzyl_health/lib/core/di/
git commit -m "feat(core): add ConnectivityService for offline detection"
```

---

### Task 6: Wire ApiClient into DI

**Files:**
- Modify: `apps/ozzyl_health/lib/core/di/injection.dart`

- [ ] **Step 1: Update DI to use ApiClient**

Replace the existing Dio registration in `injection.dart` with:

```dart
import 'package:ozzyl_core/ozzyl_core.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:get_it/get_it.dart';
import '../database/wellness_database.dart';
import '../database/cache_database.dart';

final sl = GetIt.instance;

Future<void> initDependencies() async {
  // Storage
  sl.registerLazySingleton<FlutterSecureStorage>(
    () => const FlutterSecureStorage(),
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
      enableLogging: true,
    ),
  );

  // Databases
  sl.registerLazySingleton<WellnessDatabase>(() => WellnessDatabase());
  sl.registerLazySingleton<CacheDatabase>(() => CacheDatabase());
}
```

- [ ] **Step 2: Verify app still builds**

Run: `cd apps/ozzyl_health && flutter build apk --debug`
Expected: BUILD SUCCESSFUL

- [ ] **Step 3: Commit**

```bash
git add apps/ozzyl_health/lib/core/di/
git commit -m "feat: wire ApiClient, TokenStorage, ConnectivityService into DI"
```
