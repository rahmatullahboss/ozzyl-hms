import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/sleep_entry.dart';

class SleepLocalDatasource {
  final WellnessDatabase _db;

  SleepLocalDatasource(this._db);

  Future<List<SleepEntry>> getEntries({int limit = 7}) async {
    final query = _db.select(_db.sleepLogs)
      ..orderBy([(t) => OrderingTerm.desc(t.date)])
      ..limit(limit);
    final rows = await query.get();
    return rows.map(_toEntity).toList();
  }

  Future<SleepEntry?> getLastNight() async {
    final query = _db.select(_db.sleepLogs)
      ..orderBy([(t) => OrderingTerm.desc(t.date)])
      ..limit(1);
    final row = await query.getSingleOrNull();
    return row != null ? _toEntity(row) : null;
  }

  Future<void> addEntry(SleepEntry entry) async {
    await _db.into(_db.sleepLogs).insert(
          SleepLogsCompanion.insert(
            date: entry.date,
            bedtime: entry.bedtime,
            wakeTime: entry.wakeTime,
            quality: Value(entry.quality),
          ),
        );
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.sleepLogs)..where((t) => t.id.equals(id))).go();
  }

  Future<double> getAverageHours({int days = 7}) async {
    final entries = await getEntries(limit: days);
    if (entries.isEmpty) return 0;
    final totalHours = entries.fold<double>(0, (sum, e) => sum + e.hours);
    return totalHours / entries.length;
  }

  SleepEntry _toEntity(SleepLog row) {
    return SleepEntry(
      id: row.id,
      date: row.date,
      bedtime: row.bedtime,
      wakeTime: row.wakeTime,
      quality: row.quality,
    );
  }
}
