class LabResult {
  final String id;
  final String testName;
  final DateTime date;
  final String status; // 'pending' | 'completed'
  final String? result;
  final String? unit;
  final String? referenceRange;
  final bool? isAbnormal;
  final String? pdfUrl;
  final String? orderedBy;

  const LabResult({
    required this.id,
    required this.testName,
    required this.date,
    required this.status,
    this.result,
    this.unit,
    this.referenceRange,
    this.isAbnormal,
    this.pdfUrl,
    this.orderedBy,
  });

  factory LabResult.fromJson(Map<String, dynamic> json) {
    return LabResult(
      id: json['id'] as String,
      testName: json['testName'] as String,
      date: DateTime.parse(json['date'] as String),
      status: json['status'] as String,
      result: json['result'] as String?,
      unit: json['unit'] as String?,
      referenceRange: json['referenceRange'] as String?,
      isAbnormal: json['isAbnormal'] as bool?,
      pdfUrl: json['pdfUrl'] as String?,
      orderedBy: json['orderedBy'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'testName': testName,
      'date': date.toIso8601String(),
      'status': status,
      'result': result,
      'unit': unit,
      'referenceRange': referenceRange,
      'isAbnormal': isAbnormal,
      'pdfUrl': pdfUrl,
      'orderedBy': orderedBy,
    };
  }

  bool get isPending => status == 'pending';
  bool get isCompleted => status == 'completed';
}
