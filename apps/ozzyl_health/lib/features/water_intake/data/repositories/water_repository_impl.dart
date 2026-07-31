import '../../domain/entities/water_log.dart';
import '../../domain/repositories/water_repository.dart';
import '../datasources/water_local_datasource.dart';

class WaterRepositoryImpl implements WaterRepository {
  final WaterLocalDatasource _local;

  WaterRepositoryImpl(this._local);

  @override
  Future<List<WaterLogEntity>> getTodayLogs() => _local.getTodayLogs();

  @override
  Future<int> getTodayTotal() => _local.getTodayTotal();

  @override
  Future<void> addLog(int amountMl) => _local.addLog(amountMl);

  @override
  Future<void> deleteLog(int id) => _local.deleteLog(id);

  @override
  Stream<int> watchTodayTotal() => _local.watchTodayTotal();
}
