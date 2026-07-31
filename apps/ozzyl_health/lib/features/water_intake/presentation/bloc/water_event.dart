import 'package:freezed_annotation/freezed_annotation.dart';

part 'water_event.freezed.dart';

@freezed
sealed class WaterEvent with _$WaterEvent {
  const factory WaterEvent.loadToday() = LoadTodayWater;
  const factory WaterEvent.addWater(int amountMl) = AddWater;
  const factory WaterEvent.deleteLog(int id) = DeleteWaterLog;
}
