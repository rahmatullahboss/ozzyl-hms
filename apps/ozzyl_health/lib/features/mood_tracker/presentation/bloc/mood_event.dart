import 'package:freezed_annotation/freezed_annotation.dart';

part 'mood_event.freezed.dart';

@freezed
sealed class MoodEvent with _$MoodEvent {
  const factory MoodEvent.loadEntries({DateTime? from, DateTime? to}) = LoadMoodEntries;
  const factory MoodEvent.addEntry({
    required int moodLevel,
    String? notes,
    String? tags,
  }) = AddMoodEntry;
  const factory MoodEvent.deleteEntry(int id) = DeleteMoodEntry;
}
