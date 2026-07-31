import '../entities/sleep_entry.dart';

abstract class SleepRepository {
  Future<List<SleepEntry>> getEntries({int limit = 7});
  Future<SleepEntry?> getLastNight();
  Future<void> addEntry(SleepEntry entry);
  Future<void> deleteEntry(int id);
  Future<double> getAverageHours({int days = 7});
}
