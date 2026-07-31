class HealthGoalEntity {
  final int? id;
  final String title;
  final double target;
  final double current;
  final String unit;
  final DateTime? deadline;
  final bool active;

  const HealthGoalEntity({
    this.id, required this.title, required this.target,
    this.current = 0, required this.unit, this.deadline, this.active = true,
  });

  double get progress => target > 0 ? (current / target).clamp(0.0, 1.0) : 0;
  bool get isCompleted => current >= target;
}
