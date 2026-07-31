import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/prescription.dart';

class PrescriptionRemoteDatasource {
  final ApiClient _apiClient;

  PrescriptionRemoteDatasource(this._apiClient);

  Future<List<Prescription>> getAll() async {
    final response = await _apiClient.dio.get(ApiConstants.prescriptions);
    final list = response.data['prescriptions'] as List;
    return list
        .map((j) => Prescription.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<List<Prescription>> getActive() async {
    final response = await _apiClient.dio.get(
      ApiConstants.prescriptions,
      queryParameters: {'status': 'active'},
    );
    final list = response.data['prescriptions'] as List;
    return list
        .map((j) => Prescription.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<void> requestRefill(String id) async {
    await _apiClient.dio.post('${ApiConstants.prescriptions}/$id/refill');
  }
}
