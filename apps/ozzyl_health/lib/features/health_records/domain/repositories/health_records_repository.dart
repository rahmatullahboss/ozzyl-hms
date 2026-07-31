import '../entities/health_record.dart';

abstract class HealthRecordsRepository {
  Future<PatientHealthRecords> getRecords();
}
