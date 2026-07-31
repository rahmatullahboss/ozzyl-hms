import '../entities/period_entry.dart';

abstract class PeriodRepository {
  Future<List<PeriodEntry>> getEntries({int limit = 90});
  Future<void> addEntry(PeriodEntry entry);
  Future<void> deleteEntry(int id);
  Future<int?> predictNextCycleDay();
  Future<int> getAverageCycleLength();
}
