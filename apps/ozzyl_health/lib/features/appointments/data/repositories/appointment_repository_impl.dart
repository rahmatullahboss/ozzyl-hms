import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/appointment.dart';
import '../../domain/repositories/appointment_repository.dart';
import '../datasources/appointment_remote_datasource.dart';
import '../datasources/appointment_cache_datasource.dart';

class AppointmentRepositoryImpl implements AppointmentRepository {
  final AppointmentRemoteDatasource _remote;
  final AppointmentCacheDatasource _cache;
  final ConnectivityService _connectivity;

  AppointmentRepositoryImpl(this._remote, this._cache, this._connectivity);

  @override
  Future<List<Appointment>> getUpcoming() async {
    if (await _connectivity.isOnline) {
      try {
        final list = await _remote.getUpcoming();
        await _cache.cache(list);
        return list;
      } catch (_) {
        return _cache.getCached();
      }
    }
    return _cache.getCached();
  }

  @override
  Future<List<Appointment>> getHistory() async {
    if (await _connectivity.isOnline) {
      try {
        return await _remote.getHistory();
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  @override
  Future<List<TimeSlot>> getSlots(String doctorId, DateTime date) =>
      _remote.getSlots(doctorId, date);

  @override
  Future<void> book(String doctorId, DateTime dateTime, String? notes) =>
      _remote.book(doctorId, dateTime, notes);

  @override
  Future<void> cancel(String appointmentId) =>
      _remote.cancel(appointmentId);
}
