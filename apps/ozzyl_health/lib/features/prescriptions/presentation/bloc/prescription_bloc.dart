import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/repositories/prescription_repository.dart';
import 'prescription_event.dart';
import 'prescription_state.dart';

class PrescriptionBloc extends Bloc<PrescriptionEvent, PrescriptionState> {
  final PrescriptionRepository _repository;

  PrescriptionBloc(this._repository) : super(PrescriptionInitial()) {
    on<LoadPrescriptions>(_onLoad);
    on<RequestRefill>(_onRequestRefill);
  }

  Future<void> _onLoad(
    LoadPrescriptions event,
    Emitter<PrescriptionState> emit,
  ) async {
    emit(PrescriptionLoading());
    try {
      final prescriptions = await _repository.getAll();
      final active =
          prescriptions.where((p) => p.status == 'active').toList();
      final completed =
          prescriptions.where((p) => p.status != 'active').toList();
      emit(PrescriptionLoaded(active: active, completed: completed));
    } catch (e) {
      emit(PrescriptionError(e.toString()));
    }
  }

  Future<void> _onRequestRefill(
    RequestRefill event,
    Emitter<PrescriptionState> emit,
  ) async {
    try {
      await _repository.requestRefill(event.id);
      add(LoadPrescriptions());
    } catch (e) {
      emit(PrescriptionError(e.toString()));
    }
  }
}
