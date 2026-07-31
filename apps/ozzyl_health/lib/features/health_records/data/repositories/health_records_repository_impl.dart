import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/health_record.dart';
import '../../domain/repositories/health_records_repository.dart';
import '../datasources/health_records_remote_datasource.dart';

class HealthRecordsRepositoryImpl implements HealthRecordsRepository {
  final HealthRecordsRemoteDatasource _remote;
  final ConnectivityService _connectivity;

  HealthRecordsRepositoryImpl(this._remote, this._connectivity);

  @override
  Future<PatientHealthRecords> getRecords() async {
    if (await _connectivity.isOnline) {
      return _remote.getRecords();
    }
    throw Exception('No internet connection. Please try again later.');
  }
}
