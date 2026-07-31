import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/repositories/water_repository.dart';
import 'water_event.dart';
import 'water_state.dart';

class WaterBloc extends Bloc<WaterEvent, WaterState> {
  final WaterRepository _repository;

  WaterBloc(this._repository) : super(const WaterState.initial()) {
    on<LoadTodayWater>(_onLoad);
    on<AddWater>(_onAdd);
    on<DeleteWaterLog>(_onDelete);
  }

  Future<void> _onLoad(LoadTodayWater event, Emitter<WaterState> emit) async {
    emit(const WaterState.loading());
    try {
      final logs = await _repository.getTodayLogs();
      final total = await _repository.getTodayTotal();
      emit(WaterState.loaded(logs: logs, totalMl: total));
    } catch (e) {
      emit(WaterState.error(e.toString()));
    }
  }

  Future<void> _onAdd(AddWater event, Emitter<WaterState> emit) async {
    try {
      await _repository.addLog(event.amountMl);
      add(const WaterEvent.loadToday());
    } catch (e) {
      emit(WaterState.error(e.toString()));
    }
  }

  Future<void> _onDelete(DeleteWaterLog event, Emitter<WaterState> emit) async {
    try {
      await _repository.deleteLog(event.id);
      add(const WaterEvent.loadToday());
    } catch (e) {
      emit(WaterState.error(e.toString()));
    }
  }
}
