import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/entities/sleep_entry.dart';
import '../../domain/repositories/sleep_repository.dart';
import 'sleep_event.dart';
import 'sleep_state.dart';

class SleepBloc extends Bloc<SleepEvent, SleepState> {
  final SleepRepository _repository;

  SleepBloc(this._repository) : super(const SleepState.initial()) {
    on<LoadSleep>(_onLoad);
    on<AddSleep>(_onAdd);
    on<DeleteSleep>(_onDelete);
  }

  Future<void> _onLoad(LoadSleep event, Emitter<SleepState> emit) async {
    emit(const SleepState.loading());
    try {
      final entries = await _repository.getEntries();
      final avg = await _repository.getAverageHours();
      emit(SleepState.loaded(entries: entries, avgHours: avg));
    } catch (e) {
      emit(SleepState.error(e.toString()));
    }
  }

  Future<void> _onAdd(AddSleep event, Emitter<SleepState> emit) async {
    try {
      await _repository.addEntry(SleepEntry(
        date: DateTime.now(),
        bedtime: event.bedtime,
        wakeTime: event.wakeTime,
        quality: event.quality,
      ));
      add(const SleepEvent.load());
    } catch (e) {
      emit(SleepState.error(e.toString()));
    }
  }

  Future<void> _onDelete(DeleteSleep event, Emitter<SleepState> emit) async {
    try {
      await _repository.deleteEntry(event.id);
      add(const SleepEvent.load());
    } catch (e) {
      emit(SleepState.error(e.toString()));
    }
  }
}
