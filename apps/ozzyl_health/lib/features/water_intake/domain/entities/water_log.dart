class WaterLogEntity {
  final int? id;
  final DateTime timestamp;
  final int amountMl;

  const WaterLogEntity({this.id, required this.timestamp, required this.amountMl});
}
