class VitalEntry {
  final String id;
  final DateTime timestamp;
  final int? systolic;
  final int? diastolic;
  final int? pulse;
  final double? glucose;
  final String glucoseContext;
  final double? weightKg;
  final String? notes;

  const VitalEntry({
    required this.id,
    required this.timestamp,
    this.systolic,
    this.diastolic,
    this.pulse,
    this.glucose,
    this.glucoseContext = 'random',
    this.weightKg,
    this.notes,
  });

  factory VitalEntry.fromJson(Map<String, dynamic> json) {
    return VitalEntry(
      id: json['id'] as String? ?? '',
      timestamp: DateTime.tryParse(json['timestamp'] as String? ?? '') ??
          DateTime.now(),
      systolic: json['systolic'] as int?,
      diastolic: json['diastolic'] as int?,
      pulse: json['pulse'] as int?,
      glucose: (json['glucose'] as num?)?.toDouble(),
      glucoseContext: json['glucoseContext'] as String? ?? 'random',
      weightKg: (json['weightKg'] as num?)?.toDouble(),
      notes: json['notes'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'timestamp': timestamp.toIso8601String(),
      'systolic': systolic,
      'diastolic': diastolic,
      'pulse': pulse,
      'glucose': glucose,
      'glucoseContext': glucoseContext,
      'weightKg': weightKg,
      'notes': notes,
    };
  }
}
