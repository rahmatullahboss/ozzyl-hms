class ExerciseEntry {
  final int? id;
  final DateTime timestamp;
  final String type;
  final int durationMin;
  final int? calories;

  const ExerciseEntry({
    this.id,
    required this.timestamp,
    required this.type,
    required this.durationMin,
    this.calories,
  });
}
