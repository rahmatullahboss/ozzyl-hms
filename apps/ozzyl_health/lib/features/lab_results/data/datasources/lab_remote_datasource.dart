import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/lab_result.dart';

class LabRemoteDatasource {
  final ApiClient _apiClient;
  LabRemoteDatasource(this._apiClient);

  Future<List<LabResult>> getAll() async {
    final response = await _apiClient.dio.get(ApiConstants.labResults);
    final list = response.data['results'] as List;
    return list
        .map((j) => LabResult.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<LabResult> getDetail(String id) async {
    final response = await _apiClient.dio.get(
      '${ApiConstants.labResults}/$id',
    );
    return LabResult.fromJson(response.data as Map<String, dynamic>);
  }
}
