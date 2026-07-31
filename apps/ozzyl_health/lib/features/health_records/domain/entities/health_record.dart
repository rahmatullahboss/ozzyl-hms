class PatientHealthRecords {
  final List<Allergy> allergies;
  final List<ActiveMedication> medications;
  final List<Diagnosis> diagnoses;
  final List<Immunization> immunizations;

  const PatientHealthRecords({
    this.allergies = const [],
    this.medications = const [],
    this.diagnoses = const [],
    this.immunizations = const [],
  });

  factory PatientHealthRecords.fromParts({
    required List<Allergy> allergies,
    required List<ActiveMedication> medications,
    required List<Diagnosis> diagnoses,
    required List<Immunization> immunizations,
  }) {
    return PatientHealthRecords(
      allergies: allergies,
      medications: medications,
      diagnoses: diagnoses,
      immunizations: immunizations,
    );
  }
}

class Allergy {
  final String name;
  final String? severity;
  final String? reaction;

  const Allergy({
    required this.name,
    this.severity,
    this.reaction,
  });

  factory Allergy.fromJson(Map<String, dynamic> json) {
    return Allergy(
      name: json['name'] as String? ?? '',
      severity: json['severity'] as String?,
      reaction: json['reaction'] as String?,
    );
  }
}

class ActiveMedication {
  final String name;
  final String? dosage;
  final String? frequency;
  final String? prescribedBy;

  const ActiveMedication({
    required this.name,
    this.dosage,
    this.frequency,
    this.prescribedBy,
  });

  factory ActiveMedication.fromJson(Map<String, dynamic> json) {
    return ActiveMedication(
      name: json['name'] as String? ?? '',
      dosage: json['dosage'] as String?,
      frequency: json['frequency'] as String?,
      prescribedBy: json['prescribedBy'] as String?,
    );
  }
}

class Diagnosis {
  final String name;
  final String? icdCode;
  final DateTime? date;
  final String? status;

  const Diagnosis({
    required this.name,
    this.icdCode,
    this.date,
    this.status,
  });

  factory Diagnosis.fromJson(Map<String, dynamic> json) {
    return Diagnosis(
      name: json['name'] as String? ?? '',
      icdCode: json['icdCode'] as String?,
      date: json['date'] != null ? DateTime.tryParse(json['date'] as String) : null,
      status: json['status'] as String?,
    );
  }
}

class Immunization {
  final String name;
  final DateTime? date;
  final String? provider;

  const Immunization({
    required this.name,
    this.date,
    this.provider,
  });

  factory Immunization.fromJson(Map<String, dynamic> json) {
    return Immunization(
      name: json['name'] as String? ?? '',
      date: json['date'] != null ? DateTime.tryParse(json['date'] as String) : null,
      provider: json['provider'] as String?,
    );
  }
}
