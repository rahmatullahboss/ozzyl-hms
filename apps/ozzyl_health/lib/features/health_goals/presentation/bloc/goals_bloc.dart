import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/entities/health_goal.dart';
import '../../domain/repositories/goals_repository.dart';
import 'goals_event.dart';
import 'goals_state.dart';

class GoalsBloc extends Bloc<GoalsEvent, GoalsState> {
  final GoalsRepository _repository;
  GoalsBloc(this._repository) : super(const GoalsState.initial()) {
    on<LoadGoals>((event, emit) async {
      emit(const GoalsState.loading());
      try {
        final goals = await _repository.getActiveGoals();
        emit(GoalsState.loaded(goals));
      } catch (e) {
        emit(GoalsState.error(e.toString()));
      }
    });
    on<AddGoal>((event, emit) async {
      await _repository.addGoal(HealthGoalEntity(
        title: event.title, target: event.target, unit: event.unit, deadline: event.deadline,
      ));
      add(const GoalsEvent.load());
    });
    on<UpdateGoalProgress>((event, emit) async {
      await _repository.updateProgress(event.id, event.current);
      add(const GoalsEvent.load());
    });
    on<DeleteGoal>((event, emit) async {
      await _repository.deleteGoal(event.id);
      add(const GoalsEvent.load());
    });
  }
}
