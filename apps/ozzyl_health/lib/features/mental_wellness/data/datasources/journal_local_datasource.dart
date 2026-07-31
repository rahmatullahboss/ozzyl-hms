import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';

class JournalLocalDatasource {
  final WellnessDatabase _db;
  JournalLocalDatasource(this._db);

  Future<List<JournalEntry>> getEntries({int limit = 20}) async {
    final query = _db.select(_db.journalEntries)
      ..orderBy([(t) => OrderingTerm.desc(t.timestamp)])
      ..limit(limit);
    return query.get();
  }

  Future<void> addEntry(String content, String? moodTag) async {
    await _db.into(_db.journalEntries).insert(
          JournalEntriesCompanion.insert(
            content: content,
            moodTag: Value(moodTag),
          ),
        );
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.journalEntries)..where((t) => t.id.equals(id))).go();
  }
}
