class PatientNotification {
  final int id;
  final String category;
  final String title;
  final String message;
  final String? link;
  final Map<String, dynamic> metadata;
  final bool isRead;
  final DateTime? readAt;
  final DateTime createdAt;

  const PatientNotification({
    required this.id,
    required this.category,
    required this.title,
    required this.message,
    required this.link,
    required this.metadata,
    required this.isRead,
    required this.readAt,
    required this.createdAt,
  });

  factory PatientNotification.fromJson(Map<String, dynamic> json) {
    final rawMetadata = json['metadata'];
    final metadata = Map<String, dynamic>.unmodifiable(
      rawMetadata is Map
          ? rawMetadata.map((key, value) => MapEntry(key.toString(), value))
          : <String, dynamic>{},
    );
    final createdAt = DateTime.tryParse('${json['created_at'] ?? ''}');
    if (createdAt == null) {
      throw const FormatException('Notification created_at is invalid');
    }

    return PatientNotification(
      id: _requiredPositiveInt(json['id'], 'id'),
      category: '${json['category'] ?? 'system'}',
      title: '${json['title'] ?? ''}',
      message: '${json['message'] ?? ''}',
      link: json['link'] == null ? null : '${json['link']}',
      metadata: metadata,
      isRead: _asBool(json['is_read']),
      readAt: json['read_at'] == null
          ? null
          : DateTime.tryParse('${json['read_at']}'),
      createdAt: createdAt,
    );
  }

  bool get isRetraction => category == 'lab_result_retraction';

  PatientNotification copyWithRead(DateTime readAt) {
    return PatientNotification(
      id: id,
      category: category,
      title: title,
      message: message,
      link: link,
      metadata: metadata,
      isRead: true,
      readAt: readAt,
      createdAt: createdAt,
    );
  }

  static int _requiredPositiveInt(dynamic value, String field) {
    final parsed = value is int ? value : int.tryParse('$value');
    if (parsed == null || parsed <= 0) {
      throw FormatException('Notification $field is invalid');
    }
    return parsed;
  }

  static bool _asBool(dynamic value) {
    if (value is bool) return value;
    if (value is num) return value != 0;
    return '$value'.toLowerCase() == 'true';
  }
}

class NotificationInboxPage {
  final List<PatientNotification> notifications;
  final int unreadCount;
  final int page;
  final int totalPages;

  const NotificationInboxPage({
    required this.notifications,
    required this.unreadCount,
    required this.page,
    required this.totalPages,
  });

  bool get hasMore => page < totalPages;
}
