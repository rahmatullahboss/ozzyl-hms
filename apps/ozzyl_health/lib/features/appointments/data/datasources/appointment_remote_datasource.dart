import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/appointment.dart';

class AppointmentRemoteDatasource {
  final ApiClient _apiClient;
  AppointmentRemoteDatasource(this._apiClient);

  Future<List<Appointment>> getUpcoming() async {
    final response = await _apiClient.dio.get(
      ApiConstants.appointments,
      queryParameters: {'status': 'scheduled', 'upcoming': true},
    );
    final list = response.data['appointments'] as List;
    return list
        .map((j) => Appointment.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<Appointment>> getHistory() async {
    final response = await _apiClient.dio.get(
      ApiConstants.appointments,
      queryParameters: {'status': 'completed,cancelled'},
    );
    final list = response.data['appointments'] as List;
    return list
        .map((j) => Appointment.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<TimeSlot>> getSlots(String doctorId, DateTime date) async {
    final response = await _apiClient.dio.get(
      '${ApiConstants.appointments}/slots',
      queryParameters: {
        'doctorId': doctorId,
        'date': date.toIso8601String().split('T').first,
      },
    );
    final list = response.data['slots'] as List;
    return list
        .map((j) => TimeSlot.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<void> book(String doctorId, DateTime dateTime, String? notes) async {
    await _apiClient.dio.post(
      ApiConstants.appointments,
      data: {
        'doctorId': doctorId,
        'dateTime': dateTime.toIso8601String(),
        if (notes != null) 'notes': notes,
      },
    );
  }

  Future<void> cancel(String appointmentId) async {
    await _apiClient.dio.patch(
      '${ApiConstants.appointments}/$appointmentId',
      data: {'status': 'cancelled'},
    );
  }
}
