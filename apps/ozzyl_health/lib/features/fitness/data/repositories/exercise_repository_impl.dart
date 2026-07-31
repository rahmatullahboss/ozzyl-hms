import '../../domain/entities/exercise_entry.dart';
import '../../domain/repositories/exercise_repository.dart';
import '../datasources/exercise_local_datasource.dart';

class ExerciseRepositoryImpl implements ExerciseRepository {
  final ExerciseLocalDatasource _local;
  ExerciseRepositoryImpl(this._local);

  @override
  Future<List<ExerciseEntry>> getTodayEntries() => _local.getTodayEntries();
  @override
  Future<List<ExerciseEntry>> getEntries({int limit = 14}) => _local.getEntries(limit: limit);
  @override
  Future<void> addEntry(ExerciseEntry entry) => _local.addEntry(entry);
  @override
  Future<void> deleteEntry(int id) => _local.deleteEntry(id);
  @override
  Future<int> getTodayDuration() => _local.getTodayDuration();
}
