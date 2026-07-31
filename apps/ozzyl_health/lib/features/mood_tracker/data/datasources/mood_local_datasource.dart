import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/mood_entry.dart';

class MoodLocalDatasource {
  final WellnessDatabase _db;

  MoodLocalDatasource(this._db);

  Future<List<MoodEntryEntity>> getEntries({DateTime? from, DateTime? to}) async {
    var query = _db.select(_db.moodEntries);
    if (from != null) {
      query = query..where((t) => t.timestamp.isBiggerOrEqualValue(from));
    }
    if (to != null) {
      query = query..where((t) => t.timestamp.isSmallerOrEqualValue(to));
    }
    query = query..orderBy([(t) => OrderingTerm.desc(t.timestamp)]);

    final rows = await query.get();
    return rows.map(_toEntity).toList();
  }

  Future<MoodEntryEntity?> getLatestEntry() async {
    final query = _db.select(_db.moodEntries)
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)])
      ..limit(1);
    final row = await query.getSingleOrNull();
    return row != null ? _toEntity(row) : null;
  }

  Future<void> addEntry(MoodEntryEntity entry) async {
    await _db.into(_db.moodEntries).insert(
          MoodEntriesCompanion.insert(
            moodLevel: entry.moodLevel,
            notes: Value(entry.notes),
            tags: Value(entry.tags),
          ),
        );
    await _addToSyncQueue('mood_entries', 'insert');
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.moodEntries)..where((t) => t.id.equals(id))).go();
    await _addToSyncQueue('mood_entries', 'delete');
  }

  Stream<List<MoodEntryEntity>> watchTodayEntries() {
    final now = DateTime.now();
    final startOfDay = DateTime(now.year, now.month, now.day);
    final endOfDay = startOfDay.add(const Duration(days: 1));

    final query = _db.select(_db.moodEntries)
      ..where((t) => t.timestamp.isBiggerOrEqualValue(startOfDay))
      ..where((t) => t.timestamp.isSmallerThanValue(endOfDay))
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)]);

    return query.watch().map((rows) => rows.map(_toEntity).toList());
  }

  Future<void> _addToSyncQueue(String table, String action) async {
    await _db.into(_db.syncQueue).insert(
          SyncQueueCompanion.insert(
            targetTable: table,
            rowId: 0,
            action: action,
          ),
        );
  }

  MoodEntryEntity _toEntity(MoodEntry row) {
    return MoodEntryEntity(
      id: row.id,
      timestamp: row.timestamp,
      moodLevel: row.moodLevel,
      notes: row.notes,
      tags: row.tags,
    );
  }
}
