import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/period_entry.dart';

class PeriodLocalDatasource {
  final WellnessDatabase _db;
  PeriodLocalDatasource(this._db);

  Future<List<PeriodEntry>> getEntries({int limit = 90}) async {
    final query = _db.select(_db.periodTracking)
      ..orderBy([(t) => OrderingTerm.desc(t.date)])
      ..limit(limit);
    final rows = await query.get();
    return rows
        .map(
          (r) => PeriodEntry(
            id: r.id,
            date: r.date,
            flowLevel: r.flowLevel,
            symptoms: r.symptoms,
            notes: r.notes,
          ),
        )
        .toList();
  }

  Future<void> addEntry(PeriodEntry entry) async {
    await _db.into(_db.periodTracking).insert(
          PeriodTrackingCompanion.insert(
            date: entry.date,
            flowLevel: entry.flowLevel,
            symptoms: Value(entry.symptoms),
            notes: Value(entry.notes),
          ),
        );
  }

  Future<void> deleteEntry(int id) async {
    await (_db.delete(_db.periodTracking)..where((t) => t.id.equals(id))).go();
  }

  Future<int> getAverageCycleLength() async {
    final entries = await getEntries(limit: 180);
    if (entries.length < 2) return 28;
    final starts = <DateTime>[];
    DateTime? lastDate;
    for (final e in entries.reversed) {
      if (lastDate == null || e.date.difference(lastDate).inDays > 3) {
        starts.add(e.date);
      }
      lastDate = e.date;
    }
    if (starts.length < 2) return 28;
    int totalDays = 0;
    for (int i = 1; i < starts.length; i++) {
      totalDays += starts[i].difference(starts[i - 1]).inDays;
    }
    return totalDays ~/ (starts.length - 1);
  }

  Future<int?> predictNextCycleDay() async {
    final entries = await getEntries(limit: 90);
    if (entries.isEmpty) return null;
    final avgCycle = await getAverageCycleLength();
    final lastPeriodStart = entries.first.date;
    final nextStart = lastPeriodStart.add(Duration(days: avgCycle));
    return nextStart.difference(DateTime.now()).inDays;
  }
}
