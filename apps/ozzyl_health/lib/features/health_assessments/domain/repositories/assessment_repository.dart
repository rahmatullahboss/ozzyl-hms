import '../entities/assessment.dart' as domain;

abstract class AssessmentRepository {
  Future<List<domain.AssessmentResult>> getResults({
    String? type,
    int limit = 10,
  });
  Future<void> saveResult({
    required String type,
    required int score,
    required List<int> answers,
  });
}
