import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/entities/exercise_entry.dart';
import '../../domain/repositories/exercise_repository.dart';
import 'exercise_event.dart';
import 'exercise_state.dart';

class ExerciseBloc extends Bloc<ExerciseEvent, ExerciseState> {
  final ExerciseRepository _repository;
  ExerciseBloc(this._repository) : super(const ExerciseState.initial()) {
    on<LoadExercise>(_onLoad);
    on<AddExercise>(_onAdd);
    on<DeleteExercise>(_onDelete);
  }

  Future<void> _onLoad(LoadExercise event, Emitter<ExerciseState> emit) async {
    emit(const ExerciseState.loading());
    try {
      final entries = await _repository.getTodayEntries();
      final mins = await _repository.getTodayDuration();
      emit(ExerciseState.loaded(entries: entries, todayMinutes: mins));
    } catch (e) {
      emit(ExerciseState.error(e.toString()));
    }
  }

  Future<void> _onAdd(AddExercise event, Emitter<ExerciseState> emit) async {
    try {
      await _repository.addEntry(ExerciseEntry(
        timestamp: DateTime.now(), type: event.type,
        durationMin: event.durationMin, calories: event.calories,
      ));
      add(const ExerciseEvent.load());
    } catch (e) {
      emit(ExerciseState.error(e.toString()));
    }
  }

  Future<void> _onDelete(DeleteExercise event, Emitter<ExerciseState> emit) async {
    try {
      await _repository.deleteEntry(event.id);
      add(const ExerciseEvent.load());
    } catch (e) {
      emit(ExerciseState.error(e.toString()));
    }
  }
}
