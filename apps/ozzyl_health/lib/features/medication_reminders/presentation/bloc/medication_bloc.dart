import 'package:flutter_bloc/flutter_bloc.dart';
import '../../data/datasources/medication_local_datasource.dart';
import '../../../../core/services/notification_service.dart';
import 'medication_event.dart';
import 'medication_state.dart';

class MedicationBloc extends Bloc<MedicationEvent, MedicationState> {
  final MedicationLocalDatasource _datasource;
  final NotificationService _notifications;

  MedicationBloc(this._datasource, this._notifications)
      : super(MedicationInitial()) {
    on<LoadMedications>(_onLoad);
    on<AddMedication>(_onAdd);
    on<ToggleMedication>(_onToggle);
    on<DeleteMedication>(_onDelete);
  }

  Future<void> _onLoad(
      LoadMedications event, Emitter<MedicationState> emit) async {
    emit(MedicationLoading());
    try {
      final meds = await _datasource.getAll();
      emit(MedicationLoaded(meds));
    } catch (e) {
      emit(MedicationError(e.toString()));
    }
  }

  Future<void> _onAdd(
      AddMedication event, Emitter<MedicationState> emit) async {
    await _datasource.add(event.medication);
    add(LoadMedications());
  }

  Future<void> _onToggle(
      ToggleMedication event, Emitter<MedicationState> emit) async {
    await _datasource.toggleActive(event.id, event.active);
    if (!event.active) {
      await _notifications.cancelReminder(event.id);
    }
    add(LoadMedications());
  }

  Future<void> _onDelete(
      DeleteMedication event, Emitter<MedicationState> emit) async {
    await _notifications.cancelReminder(event.id);
    await _datasource.delete(event.id);
    add(LoadMedications());
  }
}
