import '../entities/water_log.dart';

abstract class WaterRepository {
  Future<List<WaterLogEntity>> getTodayLogs();
  Future<int> getTodayTotal();
  Future<void> addLog(int amountMl);
  Future<void> deleteLog(int id);
  Stream<int> watchTodayTotal();
}
