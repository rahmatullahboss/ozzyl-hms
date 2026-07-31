import 'package:ozzyl_core/ozzyl_core.dart';
import '../../domain/entities/patient_notification.dart';

class NotificationRemoteDatasource {
  final ApiClient _apiClient;

  NotificationRemoteDatasource(this._apiClient);

  Future<NotificationInboxPage> getNotifications({
    required int page,
    required bool unreadOnly,
  }) async {
    final response = await _apiClient.dio.get(
      ApiConstants.patientPortalNotifications,
      queryParameters: {
        'page': page,
        'limit': 20,
        if (unreadOnly) 'unread': 'true',
      },
    );
    final body = response.data;
    if (body is! Map) {
      throw const FormatException('Notification response is invalid');
    }
    final rawData = body['data'];
    final rawPagination = body['pagination'];
    if (rawData is! List || rawPagination is! Map) {
      throw const FormatException('Notification response is incomplete');
    }

    final notifications = rawData
        .map((item) => PatientNotification.fromJson(
              Map<String, dynamic>.from(item as Map),
            ))
        .toList(growable: false);

    return NotificationInboxPage(
      notifications: notifications,
      unreadCount: _nonNegativeInt(body['unreadCount']),
      page: _positiveInt(rawPagination['page'], fallback: page),
      totalPages: _nonNegativeInt(rawPagination['totalPages']),
    );
  }

  Future<void> markRead(int id) async {
    await _apiClient.dio.put(
      '${ApiConstants.patientPortalNotifications}/$id/read',
    );
  }

  static int _positiveInt(dynamic value, {required int fallback}) {
    final parsed = value is int ? value : int.tryParse('$value');
    return parsed != null && parsed > 0 ? parsed : fallback;
  }

  static int _nonNegativeInt(dynamic value) {
    final parsed = value is int ? value : int.tryParse('$value');
    return parsed != null && parsed >= 0 ? parsed : 0;
  }
}
