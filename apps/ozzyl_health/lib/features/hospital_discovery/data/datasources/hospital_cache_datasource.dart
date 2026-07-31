import 'dart:convert';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/database/cache_database.dart';

class HospitalCacheDatasource {
  final CacheDatabase _db;
  HospitalCacheDatasource(this._db);

  Future<List<Hospital>> getCachedHospitals() async {
    final rows = await _db.select(_db.cachedHospitals).get();
    return rows
        .map((r) =>
            Hospital.fromJson(jsonDecode(r.dataJson) as Map<String, dynamic>))
        .toList();
  }

  Future<void> cacheHospitals(List<Hospital> hospitals) async {
    await _db.delete(_db.cachedHospitals).go();
    final ttl = DateTime.now().add(AppConstants.cacheTtl);
    for (final h in hospitals) {
      await _db.into(_db.cachedHospitals).insert(
            CachedHospitalsCompanion.insert(
              remoteId: h.id,
              dataJson: jsonEncode(h.toJson()),
              expiresAt: ttl,
            ),
          );
    }
  }
}
