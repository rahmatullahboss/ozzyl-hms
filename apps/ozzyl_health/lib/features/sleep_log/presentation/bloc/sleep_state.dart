import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/sleep_entry.dart';
part 'sleep_state.freezed.dart';

@freezed
sealed class SleepState with _$SleepState {
  const factory SleepState.initial() = SleepInitial;
  const factory SleepState.loading() = SleepLoading;
  const factory SleepState.loaded({
    required List<SleepEntry> entries,
    required double avgHours,
  }) = SleepLoaded;
  const factory SleepState.error(String message) = SleepError;
}
