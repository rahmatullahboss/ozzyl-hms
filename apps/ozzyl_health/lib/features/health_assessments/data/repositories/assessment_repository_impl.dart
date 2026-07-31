import '../../domain/entities/assessment.dart' as domain;
import '../../domain/repositories/assessment_repository.dart';
import '../datasources/assessment_local_datasource.dart';

class AssessmentRepositoryImpl implements AssessmentRepository {
  final AssessmentLocalDatasource _local;
  AssessmentRepositoryImpl(this._local);

  @override
  Future<List<domain.AssessmentResult>> getResults({
    String? type,
    int limit = 10,
  }) =>
      _local.getResults(type: type, limit: limit);

  @override
  Future<void> saveResult({
    required String type,
    required int score,
    required List<int> answers,
  }) =>
      _local.saveResult(type: type, score: score, answers: answers);
}
