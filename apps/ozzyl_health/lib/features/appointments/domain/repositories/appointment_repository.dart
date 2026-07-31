import '../entities/appointment.dart';

abstract class AppointmentRepository {
  Future<List<Appointment>> getUpcoming();
  Future<List<Appointment>> getHistory();
  Future<List<TimeSlot>> getSlots(String doctorId, DateTime date);
  Future<void> book(String doctorId, DateTime dateTime, String? notes);
  Future<void> cancel(String appointmentId);
}
