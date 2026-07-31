class AssessmentResult {
  final int? id;
  final String type;
  final int score;
  final DateTime date;
  final String answersJson;
  final String severity;

  const AssessmentResult({
    this.id,
    required this.type,
    required this.score,
    required this.date,
    required this.answersJson,
    required this.severity,
  });
}
