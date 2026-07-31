import '../../domain/entities/mood_entry.dart';
import '../../domain/repositories/mood_repository.dart';
import '../datasources/mood_local_datasource.dart';

class MoodRepositoryImpl implements MoodRepository {
  final MoodLocalDatasource _localDatasource;

  MoodRepositoryImpl(this._localDatasource);

  @override
  Future<List<MoodEntryEntity>> getEntries({DateTime? from, DateTime? to}) =>
      _localDatasource.getEntries(from: from, to: to);

  @override
  Future<MoodEntryEntity?> getLatestEntry() => _localDatasource.getLatestEntry();

  @override
  Future<void> addEntry(MoodEntryEntity entry) => _localDatasource.addEntry(entry);

  @override
  Future<void> deleteEntry(int id) => _localDatasource.deleteEntry(id);

  @override
  Stream<List<MoodEntryEntity>> watchTodayEntries() =>
      _localDatasource.watchTodayEntries();
}
