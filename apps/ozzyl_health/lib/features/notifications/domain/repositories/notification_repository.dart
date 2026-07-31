import '../entities/patient_notification.dart';

abstract class NotificationRepository {
  Future<NotificationInboxPage> getNotifications({
    required int page,
    required bool unreadOnly,
  });

  Future<void> markRead(int id);
}
