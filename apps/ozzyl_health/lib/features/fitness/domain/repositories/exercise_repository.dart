import '../entities/exercise_entry.dart';

abstract class ExerciseRepository {
  Future<List<ExerciseEntry>> getTodayEntries();
  Future<List<ExerciseEntry>> getEntries({int limit = 14});
  Future<void> addEntry(ExerciseEntry entry);
  Future<void> deleteEntry(int id);
  Future<int> getTodayDuration();
}
