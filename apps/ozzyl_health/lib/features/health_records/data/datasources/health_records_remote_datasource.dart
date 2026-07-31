import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/health_record.dart';

class HealthRecordsRemoteDatasource {
  final ApiClient _apiClient;

  HealthRecordsRemoteDatasource(this._apiClient);

  Future<PatientHealthRecords> getRecords() async {
    final results = await Future.wait([
      _apiClient.dio.get('${ApiConstants.patientPhr}/allergies'),
      _apiClient.dio.get('${ApiConstants.patientPhr}/medications'),
      _apiClient.dio.get('${ApiConstants.patientPhr}/diagnoses'),
      _apiClient.dio.get('${ApiConstants.patientPhr}/immunizations'),
    ]);

    final allergiesJson = results[0].data['allergies'] as List? ?? [];
    final medicationsJson = results[1].data['medications'] as List? ?? [];
    final diagnosesJson = results[2].data['diagnoses'] as List? ?? [];
    final immunizationsJson = results[3].data['immunizations'] as List? ?? [];

    return PatientHealthRecords.fromParts(
      allergies: allergiesJson
          .map((j) => Allergy.fromJson(j as Map<String, dynamic>))
          .toList(),
      medications: medicationsJson
          .map((j) => ActiveMedication.fromJson(j as Map<String, dynamic>))
          .toList(),
      diagnoses: diagnosesJson
          .map((j) => Diagnosis.fromJson(j as Map<String, dynamic>))
          .toList(),
      immunizations: immunizationsJson
          .map((j) => Immunization.fromJson(j as Map<String, dynamic>))
          .toList(),
    );
  }
}
