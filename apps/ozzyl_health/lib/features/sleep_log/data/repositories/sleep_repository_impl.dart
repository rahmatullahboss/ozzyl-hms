import '../../domain/entities/sleep_entry.dart';
import '../../domain/repositories/sleep_repository.dart';
import '../datasources/sleep_local_datasource.dart';

class SleepRepositoryImpl implements SleepRepository {
  final SleepLocalDatasource _local;
  SleepRepositoryImpl(this._local);

  @override
  Future<List<SleepEntry>> getEntries({int limit = 7}) => _local.getEntries(limit: limit);
  @override
  Future<SleepEntry?> getLastNight() => _local.getLastNight();
  @override
  Future<void> addEntry(SleepEntry entry) => _local.addEntry(entry);
  @override
  Future<void> deleteEntry(int id) => _local.deleteEntry(id);
  @override
  Future<double> getAverageHours({int days = 7}) => _local.getAverageHours(days: days);
}
