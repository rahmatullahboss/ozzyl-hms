import '../../domain/entities/period_entry.dart';
import '../../domain/repositories/period_repository.dart';
import '../datasources/period_local_datasource.dart';

class PeriodRepositoryImpl implements PeriodRepository {
  final PeriodLocalDatasource _local;
  PeriodRepositoryImpl(this._local);

  @override
  Future<List<PeriodEntry>> getEntries({int limit = 90}) =>
      _local.getEntries(limit: limit);

  @override
  Future<void> addEntry(PeriodEntry entry) => _local.addEntry(entry);

  @override
  Future<void> deleteEntry(int id) => _local.deleteEntry(id);

  @override
  Future<int?> predictNextCycleDay() => _local.predictNextCycleDay();

  @override
  Future<int> getAverageCycleLength() => _local.getAverageCycleLength();
}
