import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/mood_entry.dart';

part 'mood_state.freezed.dart';

@freezed
sealed class MoodState with _$MoodState {
  const factory MoodState.initial() = MoodInitial;
  const factory MoodState.loading() = MoodLoading;
  const factory MoodState.loaded(List<MoodEntryEntity> entries) = MoodLoaded;
  const factory MoodState.error(String message) = MoodError;
}
