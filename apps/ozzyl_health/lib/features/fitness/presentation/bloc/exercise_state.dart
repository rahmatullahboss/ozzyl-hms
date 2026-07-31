import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/exercise_entry.dart';
part 'exercise_state.freezed.dart';

@freezed
sealed class ExerciseState with _$ExerciseState {
  const factory ExerciseState.initial() = ExerciseInitial;
  const factory ExerciseState.loading() = ExerciseLoading;
  const factory ExerciseState.loaded({
    required List<ExerciseEntry> entries,
    required int todayMinutes,
  }) = ExerciseLoaded;
  const factory ExerciseState.error(String message) = ExerciseError;
}
