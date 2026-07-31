class VaultDocument {
  final int id;
  final String title;
  final String documentType;
  final DateTime? documentDate;
  final String? notes;
  final String? documentUrl;
  final String? fileName;
  final String? mimeType;
  final int? fileSize;
  final String sourceKind;

  const VaultDocument({
    required this.id,
    required this.title,
    required this.documentType,
    this.documentDate,
    this.notes,
    this.documentUrl,
    this.fileName,
    this.mimeType,
    this.fileSize,
    required this.sourceKind,
  });

  factory VaultDocument.fromJson(Map<String, dynamic> json) {
    return VaultDocument(
      id: _toInt(json['id']),
      title: json['title'] as String? ?? 'Untitled document',
      documentType: json['document_type'] as String? ?? 'other',
      documentDate: DateTime.tryParse(json['document_date'] as String? ?? ''),
      notes: json['notes'] as String?,
      documentUrl: json['document_url'] as String?,
      fileName: json['file_name'] as String?,
      mimeType: json['mime_type'] as String?,
      fileSize: json['file_size'] == null ? null : _toInt(json['file_size']),
      sourceKind: json['source_kind'] as String? ?? 'external_link',
    );
  }

  static int _toInt(Object? value) {
    if (value is int) return value;
    if (value is num) return value.toInt();
    if (value is String) return int.tryParse(value) ?? 0;
    return 0;
  }
}
