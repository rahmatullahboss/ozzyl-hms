import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/symptom_safety.dart';

class SymptomRemoteDatasource {
  final ApiClient _apiClient;
  SymptomRemoteDatasource(this._apiClient);

  Future<String> analyzeSymptoms(
    List<String> symptoms, {
    String? additionalContext,
  }) async {
    if (SymptomSafety.hasEmergencyRedFlag(symptoms, additionalContext)) {
      return SymptomSafety.emergencyMessage();
    }
    final response = await _apiClient.dio.post(
      ApiConstants.ai,
      data: {
        'action': 'symptom_check',
        'symptoms': symptoms,
        'context': additionalContext,
      },
    );
    return SymptomSafety.safeFallback(
        response.data['analysis'] as String? ?? '');
  }
}
