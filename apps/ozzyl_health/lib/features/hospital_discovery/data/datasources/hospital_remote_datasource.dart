import 'package:ozzyl_core/ozzyl_core.dart';

class HospitalRemoteDatasource {
  final ApiClient _apiClient;
  HospitalRemoteDatasource(this._apiClient);

  Future<List<Hospital>> getNearby({
    double? lat,
    double? lng,
    String? city,
    int limit = 20,
  }) async {
    final response = await _apiClient.dio.get(
      ApiConstants.publicHospitals,
      queryParameters: {
        if (lat != null) 'lat': lat,
        if (lng != null) 'lng': lng,
        if (city != null) 'city': city,
        'limit': limit,
      },
    );
    final list = response.data['hospitals'] as List;
    return list
        .map((j) => Hospital.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<HospitalDetail> getDetail(String hospitalId) async {
    final response = await _apiClient.dio.get(
      '${ApiConstants.publicHospitals}/$hospitalId',
    );
    return HospitalDetail.fromJson(response.data as Map<String, dynamic>);
  }

  Future<void> linkHospital(String hospitalId) async {
    await _apiClient.dio.post(
      ApiConstants.linkHospital,
      data: {'hospitalId': hospitalId},
    );
  }

  Future<void> unlinkHospital(String hospitalId) async {
    await _apiClient.dio.delete(
      '${ApiConstants.linkHospital}/$hospitalId',
    );
  }
}
