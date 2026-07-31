import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/prescription.dart';
import '../../domain/repositories/prescription_repository.dart';
import '../datasources/prescription_remote_datasource.dart';

class PrescriptionRepositoryImpl implements PrescriptionRepository {
  final PrescriptionRemoteDatasource _remote;
  final ConnectivityService _connectivity;

  PrescriptionRepositoryImpl(this._remote, this._connectivity);

  @override
  Future<List<Prescription>> getAll() async {
    if (await _connectivity.isOnline) {
      try {
        return await _remote.getAll();
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  @override
  Future<List<Prescription>> getActive() async {
    if (await _connectivity.isOnline) {
      try {
        return await _remote.getActive();
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  @override
  Future<void> requestRefill(String id) async {
    await _remote.requestRefill(id);
  }
}
