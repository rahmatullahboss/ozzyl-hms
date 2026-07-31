import '../entities/mood_entry.dart';

abstract class MoodRepository {
  Future<List<MoodEntryEntity>> getEntries({DateTime? from, DateTime? to});
  Future<MoodEntryEntity?> getLatestEntry();
  Future<void> addEntry(MoodEntryEntity entry);
  Future<void> deleteEntry(int id);
  Stream<List<MoodEntryEntity>> watchTodayEntries();
}
