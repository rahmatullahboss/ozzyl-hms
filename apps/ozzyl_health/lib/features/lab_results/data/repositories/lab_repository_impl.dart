import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/lab_result.dart';
import '../../domain/repositories/lab_repository.dart';
import '../datasources/lab_remote_datasource.dart';

class LabRepositoryImpl implements LabRepository {
  final LabRemoteDatasource _remote;
  final ConnectivityService _connectivity;

  LabRepositoryImpl(this._remote, this._connectivity);

  @override
  Future<List<LabResult>> getAll() async {
    if (await _connectivity.isOnline) {
      return _remote.getAll();
    }
    throw Exception('No internet connection. Please try again later.');
  }

  @override
  Future<LabResult> getDetail(String id) async {
    if (await _connectivity.isOnline) {
      return _remote.getDetail(id);
    }
    throw Exception('No internet connection. Please try again later.');
  }
}
