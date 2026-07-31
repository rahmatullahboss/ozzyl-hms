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
