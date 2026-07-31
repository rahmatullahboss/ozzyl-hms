class PeriodEntry {
  final int? id;
  final DateTime date;
  final int flowLevel; // 0=spotting, 1=light, 2=medium, 3=heavy, 4=very heavy
  final String? symptoms;
  final String? notes;

  const PeriodEntry({
    this.id,
    required this.date,
    required this.flowLevel,
    this.symptoms,
    this.notes,
  });
}
