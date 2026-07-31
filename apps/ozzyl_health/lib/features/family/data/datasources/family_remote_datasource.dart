import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/family_member.dart';

class FamilyRemoteDatasource {
  final ApiClient _apiClient;
  FamilyRemoteDatasource(this._apiClient);

  Future<List<FamilyMember>> getMembers() async {
    final response = await _apiClient.dio.get(ApiConstants.patientFamily);
    final list = response.data['members'] as List;
    return list
        .map((j) => FamilyMember.fromJson(j as Map<String, dynamic>))
        .toList();
  }

  Future<FamilyMember> addMember({
    required String name,
    required String relationship,
    String? email,
  }) async {
    final response = await _apiClient.dio.post(
      ApiConstants.patientFamily,
      data: {
        'name': name,
        'relationship': relationship,
        if (email != null) 'email': email,
      },
    );
    return FamilyMember.fromJson(response.data as Map<String, dynamic>);
  }
}
