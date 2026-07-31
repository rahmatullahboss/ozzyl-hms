import 'package:freezed_annotation/freezed_annotation.dart';
import '../../domain/entities/health_goal.dart';
part 'goals_state.freezed.dart';

@freezed
sealed class GoalsState with _$GoalsState {
  const factory GoalsState.initial() = GoalsInitial;
  const factory GoalsState.loading() = GoalsLoading;
  const factory GoalsState.loaded(List<HealthGoalEntity> goals) = GoalsLoaded;
  const factory GoalsState.error(String message) = GoalsError;
}
