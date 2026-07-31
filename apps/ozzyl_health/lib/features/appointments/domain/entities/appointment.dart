class Appointment {
  final String id;
  final String patientId;
  final String doctorId;
  final String doctorName;
  final String? doctorSpecialty;
  final DateTime dateTime;
  final String status;
  final String? notes;
  final String? hospitalName;

  const Appointment({
    required this.id,
    required this.patientId,
    required this.doctorId,
    required this.doctorName,
    this.doctorSpecialty,
    required this.dateTime,
    required this.status,
    this.notes,
    this.hospitalName,
  });

  factory Appointment.fromJson(Map<String, dynamic> json) => Appointment(
        id: json['id'] as String,
        patientId: json['patientId'] as String,
        doctorId: json['doctorId'] as String,
        doctorName: json['doctorName'] as String,
        doctorSpecialty: json['doctorSpecialty'] as String?,
        dateTime: DateTime.parse(json['dateTime'] as String),
        status: json['status'] as String,
        notes: json['notes'] as String?,
        hospitalName: json['hospitalName'] as String?,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'patientId': patientId,
        'doctorId': doctorId,
        'doctorName': doctorName,
        'doctorSpecialty': doctorSpecialty,
        'dateTime': dateTime.toIso8601String(),
        'status': status,
        'notes': notes,
        'hospitalName': hospitalName,
      };
}

class TimeSlot {
  final DateTime dateTime;
  final bool available;

  const TimeSlot({required this.dateTime, required this.available});

  factory TimeSlot.fromJson(Map<String, dynamic> json) => TimeSlot(
        dateTime: DateTime.parse(json['dateTime'] as String),
        available: json['available'] as bool,
      );
}
