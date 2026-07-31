import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/entities/mood_entry.dart';
import '../../domain/repositories/mood_repository.dart';
import 'mood_event.dart';
import 'mood_state.dart';

class MoodBloc extends Bloc<MoodEvent, MoodState> {
  final MoodRepository _repository;

  MoodBloc(this._repository) : super(const MoodState.initial()) {
    on<LoadMoodEntries>(_onLoad);
    on<AddMoodEntry>(_onAdd);
    on<DeleteMoodEntry>(_onDelete);
  }

  Future<void> _onLoad(LoadMoodEntries event, Emitter<MoodState> emit) async {
    emit(const MoodState.loading());
    try {
      final entries = await _repository.getEntries(from: event.from, to: event.to);
      emit(MoodState.loaded(entries));
    } catch (e) {
      emit(MoodState.error(e.toString()));
    }
  }

  Future<void> _onAdd(AddMoodEntry event, Emitter<MoodState> emit) async {
    try {
      await _repository.addEntry(
        MoodEntryEntity(
          timestamp: DateTime.now(),
          moodLevel: event.moodLevel,
          notes: event.notes,
          tags: event.tags,
        ),
      );
      add(const MoodEvent.loadEntries());
    } catch (e) {
      emit(MoodState.error(e.toString()));
    }
  }

  Future<void> _onDelete(DeleteMoodEntry event, Emitter<MoodState> emit) async {
    try {
      await _repository.deleteEntry(event.id);
      add(const MoodEvent.loadEntries());
    } catch (e) {
      emit(MoodState.error(e.toString()));
    }
  }
}
