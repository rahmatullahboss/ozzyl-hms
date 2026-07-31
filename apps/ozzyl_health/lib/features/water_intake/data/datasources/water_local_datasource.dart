import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/water_log.dart';

class WaterLocalDatasource {
  final WellnessDatabase _db;

  WaterLocalDatasource(this._db);

  Future<List<WaterLogEntity>> getTodayLogs() async {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));

    final query = _db.select(_db.waterLogs)
      ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
      ..where((t) => t.timestamp.isSmallerThanValue(end))
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)]);

    final rows = await query.get();
    return rows
        .map((r) => WaterLogEntity(id: r.id, timestamp: r.timestamp, amountMl: r.amountMl))
        .toList();
  }

  Future<int> getTodayTotal() async {
    final logs = await getTodayLogs();
    return logs.fold<int>(0, (sum, log) => sum + log.amountMl);
  }

  Future<void> addLog(int amountMl) async {
    await _db.into(_db.waterLogs).insert(
          WaterLogsCompanion.insert(amountMl: amountMl),
        );
  }

  Future<void> deleteLog(int id) async {
    await (_db.delete(_db.waterLogs)..where((t) => t.id.equals(id))).go();
  }

  Stream<int> watchTodayTotal() {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));

    final query = _db.select(_db.waterLogs)
      ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
      ..where((t) => t.timestamp.isSmallerThanValue(end));

    return query.watch().map(
          (rows) => rows.fold<int>(0, (sum, r) => sum + r.amountMl),
        );
  }
}
