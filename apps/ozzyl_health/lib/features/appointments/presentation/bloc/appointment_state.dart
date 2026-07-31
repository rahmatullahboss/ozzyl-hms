import '../../domain/entities/appointment.dart';

abstract class AppointmentState {}

class AppointmentInitial extends AppointmentState {}

class AppointmentLoading extends AppointmentState {}

class AppointmentListLoaded extends AppointmentState {
  final List<Appointment> upcoming;
  final List<Appointment> history;
  AppointmentListLoaded({this.upcoming = const [], this.history = const []});
}

class TimeSlotsLoaded extends AppointmentState {
  final List<TimeSlot> slots;
  TimeSlotsLoaded(this.slots);
}

class AppointmentBooked extends AppointmentState {}

class AppointmentError extends AppointmentState {
  final String message;
  AppointmentError(this.message);
}
