import 'package:freezed_annotation/freezed_annotation.dart';
part 'exercise_event.freezed.dart';

@freezed
sealed class ExerciseEvent with _$ExerciseEvent {
  const factory ExerciseEvent.load() = LoadExercise;
  const factory ExerciseEvent.add({
    required String type,
    required int durationMin,
    int? calories,
  }) = AddExercise;
  const factory ExerciseEvent.delete(int id) = DeleteExercise;
}
