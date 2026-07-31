import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/exercise_entry.dart';

class ExerciseLocalDatasource {
  final WellnessDatabase _db;
  ExerciseLocalDatasource(this._db);

  Future<List<ExerciseEntry>> getTodayEntries() async {
    final now = DateTime.now();
    final start = DateTime(now.year, now.month, now.day);
    final end = start.add(const Duration(days: 1));
    final query = _db.select(_db.exerciseLogs)
      ..where((t) => t.timestamp.isBiggerOrEqualValue(start))
      ..where((t) => t.timestamp.isSmallerThanValue(end))
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)]);
    final rows = await query.get();
    return rows.map(_toEntity).toList();
  }

  Future<List<ExerciseEntry>> getEntries({int limit = 14}) async {
    final query = _db.select(_db.exerciseLogs)
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)])
      ..limit(limit);
    final rows = await query.get();
    return rows.map(_toEntity).toList();
  }

  Future<void> addEntry(ExerciseEntry entry) async {
    await _db.into(_db.exerciseLogs).insert(ExerciseLogsCompanion.insert(
      type: entry.type,
      durationMin: entry.durationMin,
      calories: Value(entry.calories),
    ));
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.exerciseLogs)..where((t) => t.id.equals(id))).go();
  }

  Future<int> getTodayDuration() async {
    final entries = await getTodayEntries();
    return entries.fold<int>(0, (sum, e) => sum + e.durationMin);
  }

  ExerciseEntry _toEntity(ExerciseLog row) {
    return ExerciseEntry(
      id: row.id, timestamp: row.timestamp, type: row.type,
      durationMin: row.durationMin, calories: row.calories,
    );
  }
}
