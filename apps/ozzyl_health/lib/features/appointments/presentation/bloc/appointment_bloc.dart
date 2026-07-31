import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/repositories/appointment_repository.dart';
import 'appointment_event.dart';
import 'appointment_state.dart';

class AppointmentBloc extends Bloc<AppointmentEvent, AppointmentState> {
  final AppointmentRepository _repository;

  AppointmentBloc(this._repository) : super(AppointmentInitial()) {
    on<LoadUpcomingAppointments>(_onLoadUpcoming);
    on<LoadAppointmentHistory>(_onLoadHistory);
    on<LoadTimeSlots>(_onLoadSlots);
    on<BookAppointment>(_onBook);
    on<CancelAppointment>(_onCancel);
  }

  Future<void> _onLoadUpcoming(
    LoadUpcomingAppointments event,
    Emitter<AppointmentState> emit,
  ) async {
    emit(AppointmentLoading());
    try {
      final upcoming = await _repository.getUpcoming();
      final history =
          state is AppointmentListLoaded
              ? (state as AppointmentListLoaded).history
              : <dynamic>[];
      emit(AppointmentListLoaded(
        upcoming: upcoming,
        history: List.from(history),
      ));
    } catch (e) {
      emit(AppointmentError(e.toString()));
    }
  }

  Future<void> _onLoadHistory(
    LoadAppointmentHistory event,
    Emitter<AppointmentState> emit,
  ) async {
    emit(AppointmentLoading());
    try {
      final upcoming = await _repository.getUpcoming();
      final history = await _repository.getHistory();
      emit(AppointmentListLoaded(upcoming: upcoming, history: history));
    } catch (e) {
      emit(AppointmentError(e.toString()));
    }
  }

  Future<void> _onLoadSlots(
    LoadTimeSlots event,
    Emitter<AppointmentState> emit,
  ) async {
    emit(AppointmentLoading());
    try {
      final slots = await _repository.getSlots(event.doctorId, event.date);
      emit(TimeSlotsLoaded(slots));
    } catch (e) {
      emit(AppointmentError(e.toString()));
    }
  }

  Future<void> _onBook(
    BookAppointment event,
    Emitter<AppointmentState> emit,
  ) async {
    emit(AppointmentLoading());
    try {
      await _repository.book(event.doctorId, event.dateTime, event.notes);
      emit(AppointmentBooked());
    } catch (e) {
      emit(AppointmentError(e.toString()));
    }
  }

  Future<void> _onCancel(
    CancelAppointment event,
    Emitter<AppointmentState> emit,
  ) async {
    try {
      await _repository.cancel(event.appointmentId);
      add(LoadUpcomingAppointments());
    } catch (e) {
      emit(AppointmentError(e.toString()));
    }
  }
}
