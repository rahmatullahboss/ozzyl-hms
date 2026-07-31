import 'package:freezed_annotation/freezed_annotation.dart';
part 'goals_event.freezed.dart';

@freezed
sealed class GoalsEvent with _$GoalsEvent {
  const factory GoalsEvent.load() = LoadGoals;
  const factory GoalsEvent.add({
    required String title, required double target,
    required String unit, DateTime? deadline,
  }) = AddGoal;
  const factory GoalsEvent.updateProgress({required int id, required double current}) = UpdateGoalProgress;
  const factory GoalsEvent.delete(int id) = DeleteGoal;
}
