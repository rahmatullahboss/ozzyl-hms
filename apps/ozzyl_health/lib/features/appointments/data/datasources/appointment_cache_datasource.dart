import 'dart:convert';
import 'package:ozzyl_core/ozzyl_core.dart';
import '../../../../core/database/cache_database.dart';
import '../../domain/entities/appointment.dart';

class AppointmentCacheDatasource {
  final CacheDatabase _db;
  AppointmentCacheDatasource(this._db);

  Future<List<Appointment>> getCached() async {
    final rows = await _db.select(_db.cachedAppointments).get();
    return rows
        .map((r) => Appointment.fromJson(
            jsonDecode(r.dataJson) as Map<String, dynamic>))
        .toList();
  }

  Future<void> cache(List<Appointment> appointments) async {
    await _db.delete(_db.cachedAppointments).go();
    final ttl = DateTime.now().add(AppConstants.cacheTtl);
    for (final a in appointments) {
      await _db.into(_db.cachedAppointments).insert(
            CachedAppointmentsCompanion.insert(
              remoteId: a.id,
              dataJson: jsonEncode(a.toJson()),
              expiresAt: ttl,
            ),
          );
    }
  }
}
