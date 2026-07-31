class PrescriptionItem {
  final String medicineName;
  final String dosage;
  final String frequency;
  final String duration;
  final String? instructions;

  const PrescriptionItem({
    required this.medicineName,
    required this.dosage,
    required this.frequency,
    required this.duration,
    this.instructions,
  });

  factory PrescriptionItem.fromJson(Map<String, dynamic> json) {
    return PrescriptionItem(
      medicineName: json['medicineName'] as String,
      dosage: json['dosage'] as String,
      frequency: json['frequency'] as String,
      duration: json['duration'] as String,
      instructions: json['instructions'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'medicineName': medicineName,
      'dosage': dosage,
      'frequency': frequency,
      'duration': duration,
      if (instructions != null) 'instructions': instructions,
    };
  }
}

class Prescription {
  final String id;
  final String patientId;
  final String doctorName;
  final DateTime date;
  final String status; // active, completed, cancelled
  final List<PrescriptionItem> items;
  final String? pdfUrl;
  final String? hospitalName;

  const Prescription({
    required this.id,
    required this.patientId,
    required this.doctorName,
    required this.date,
    required this.status,
    required this.items,
    this.pdfUrl,
    this.hospitalName,
  });

  factory Prescription.fromJson(Map<String, dynamic> json) {
    return Prescription(
      id: json['id'] as String,
      patientId: json['patientId'] as String,
      doctorName: json['doctorName'] as String,
      date: DateTime.parse(json['date'] as String),
      status: json['status'] as String,
      items: (json['items'] as List)
          .map((e) => PrescriptionItem.fromJson(e as Map<String, dynamic>))
          .toList(),
      pdfUrl: json['pdfUrl'] as String?,
      hospitalName: json['hospitalName'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'patientId': patientId,
      'doctorName': doctorName,
      'date': date.toIso8601String(),
      'status': status,
      'items': items.map((e) => e.toJson()).toList(),
      if (pdfUrl != null) 'pdfUrl': pdfUrl,
      if (hospitalName != null) 'hospitalName': hospitalName,
    };
  }

  bool get isActive => status == 'active';
  bool get isCompleted => status == 'completed';
  bool get isCancelled => status == 'cancelled';
}
