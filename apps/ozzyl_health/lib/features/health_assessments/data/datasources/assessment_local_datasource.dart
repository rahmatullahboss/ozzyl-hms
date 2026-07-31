import 'dart:convert';
import 'package:drift/drift.dart';
import '../../../../core/database/wellness_database.dart';
import '../../domain/entities/assessment.dart' as domain;

class AssessmentLocalDatasource {
  final WellnessDatabase _db;
  AssessmentLocalDatasource(this._db);

  Future<List<domain.AssessmentResult>> getResults({
    String? type,
    int limit = 10,
  }) async {
    var query = _db.select(_db.assessmentResults)
      ..orderBy([(t) => OrderingTerm.desc(t.date)])
      ..limit(limit);
    if (type != null) {
      query = query..where((t) => t.type.equals(type));
    }
    final rows = await query.get();
    return rows
        .map(
          (r) => domain.AssessmentResult(
            id: r.id,
            type: r.type,
            score: r.score,
            date: r.date,
            answersJson: r.answersJson,
            severity: _getSeverity(r.type, r.score),
          ),
        )
        .toList();
  }

  Future<void> saveResult({
    required String type,
    required int score,
    required List<int> answers,
  }) async {
    await _db.into(_db.assessmentResults).insert(
          AssessmentResultsCompanion.insert(
            type: type,
            score: score,
            answersJson: jsonEncode(answers),
          ),
        );
  }

  String _getSeverity(String type, int score) {
    if (type == 'PHQ9') {
      if (score <= 4) return 'Minimal';
      if (score <= 9) return 'Mild';
      if (score <= 14) return 'Moderate';
      if (score <= 19) return 'Moderately Severe';
      return 'Severe';
    }
    if (type == 'GAD7') {
      if (score <= 4) return 'Minimal';
      if (score <= 9) return 'Mild';
      if (score <= 14) return 'Moderate';
      return 'Severe';
    }
    return 'N/A';
  }
}
