import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/repositories/lab_repository.dart';
import 'lab_event.dart';
import 'lab_state.dart';

class LabBloc extends Bloc<LabEvent, LabState> {
  final LabRepository _repository;

  LabBloc(this._repository) : super(LabInitial()) {
    on<LoadLabResults>(_onLoadAll);
    on<LoadLabResultDetail>(_onLoadDetail);
  }

  Future<void> _onLoadAll(
    LoadLabResults event,
    Emitter<LabState> emit,
  ) async {
    emit(LabLoading());
    try {
      final results = await _repository.getAll();
      emit(LabListLoaded(results));
    } catch (e) {
      emit(LabError(e.toString()));
    }
  }

  Future<void> _onLoadDetail(
    LoadLabResultDetail event,
    Emitter<LabState> emit,
  ) async {
    emit(LabLoading());
    try {
      final result = await _repository.getDetail(event.id);
      emit(LabDetailLoaded(result));
    } catch (e) {
      emit(LabError(e.toString()));
    }
  }
}
