class Medication {
  final int? id;
  final String name;
  final String dosage;
  final String frequency; // daily, twice_daily, weekly
  final String times; // JSON array of HH:mm strings
  final bool active;

  const Medication({
    this.id,
    required this.name,
    required this.dosage,
    required this.frequency,
    required this.times,
    this.active = true,
  });
}
