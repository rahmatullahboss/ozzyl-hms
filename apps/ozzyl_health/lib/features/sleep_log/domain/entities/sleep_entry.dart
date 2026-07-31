class SleepEntry {
  final int? id;
  final DateTime date;
  final DateTime bedtime;
  final DateTime wakeTime;
  final int? quality;

  const SleepEntry({
    this.id,
    required this.date,
    required this.bedtime,
    required this.wakeTime,
    this.quality,
  });

  Duration get duration => wakeTime.difference(bedtime);
  double get hours => duration.inMinutes / 60.0;
}
