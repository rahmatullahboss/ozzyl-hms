class MoodEntryEntity {
  final int? id;
  final DateTime timestamp;
  final int moodLevel;
  final String? notes;
  final String? tags;

  const MoodEntryEntity({
    this.id,
    required this.timestamp,
    required this.moodLevel,
    this.notes,
    this.tags,
  });
}
