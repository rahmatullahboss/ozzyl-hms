abstract class AppointmentEvent {}

class LoadUpcomingAppointments extends AppointmentEvent {}

class LoadAppointmentHistory extends AppointmentEvent {}

class LoadTimeSlots extends AppointmentEvent {
  final String doctorId;
  final DateTime date;
  LoadTimeSlots(this.doctorId, this.date);
}

class BookAppointment extends AppointmentEvent {
  final String doctorId;
  final DateTime dateTime;
  final String? notes;
  BookAppointment(this.doctorId, this.dateTime, {this.notes});
}

class CancelAppointment extends AppointmentEvent {
  final String appointmentId;
  CancelAppointment(this.appointmentId);
}
