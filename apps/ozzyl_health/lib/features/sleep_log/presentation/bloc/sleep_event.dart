import 'package:freezed_annotation/freezed_annotation.dart';
part 'sleep_event.freezed.dart';

@freezed
sealed class SleepEvent with _$SleepEvent {
  const factory SleepEvent.load() = LoadSleep;
  const factory SleepEvent.add({
    required DateTime bedtime,
    required DateTime wakeTime,
    int? quality,
  }) = AddSleep;
  const factory SleepEvent.delete(int id) = DeleteSleep;
}
