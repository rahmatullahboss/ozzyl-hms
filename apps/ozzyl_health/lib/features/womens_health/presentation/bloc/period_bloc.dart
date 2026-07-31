import 'package:flutter_bloc/flutter_bloc.dart';
import '../../data/datasources/period_local_datasource.dart';
import 'period_event.dart';
import 'period_state.dart';

class PeriodBloc extends Bloc<PeriodEvent, PeriodState> {
  final PeriodLocalDatasource _datasource;

  PeriodBloc(this._datasource) : super(PeriodInitial()) {
    on<LoadPeriodData>(_onLoad);
    on<AddPeriodEntry>(_onAdd);
    on<DeletePeriodEntry>(_onDelete);
  }

  Future<void> _onLoad(LoadPeriodData event, Emitter<PeriodState> emit) async {
    emit(PeriodLoading());
    try {
      final entries = await _datasource.getEntries();
      final daysUntilNext = await _datasource.predictNextCycleDay();
      final avgCycle = await _datasource.getAverageCycleLength();
      emit(PeriodLoaded(
        entries: entries,
        daysUntilNext: daysUntilNext,
        avgCycleLength: avgCycle,
      ));
    } catch (e) {
      emit(PeriodError(e.toString()));
    }
  }

  Future<void> _onAdd(AddPeriodEntry event, Emitter<PeriodState> emit) async {
    await _datasource.addEntry(event.entry);
    add(LoadPeriodData());
  }

  Future<void> _onDelete(
      DeletePeriodEntry event, Emitter<PeriodState> emit) async {
    await _datasource.deleteEntry(event.id);
    add(LoadPeriodData());
  }
}
