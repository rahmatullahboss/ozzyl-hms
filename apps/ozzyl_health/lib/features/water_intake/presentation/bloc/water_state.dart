import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/water_log.dart';

part 'water_state.freezed.dart';

@freezed
sealed class WaterState with _$WaterState {
  const factory WaterState.initial() = WaterInitial;
  const factory WaterState.loading() = WaterLoading;
  const factory WaterState.loaded({
    required List<WaterLogEntity> logs,
    required int totalMl,
    @Default(2500) int goalMl,
  }) = WaterLoaded;
  const factory WaterState.error(String message) = WaterError;
}
