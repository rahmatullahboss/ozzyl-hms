sealed class NotificationEvent {
  const NotificationEvent();
}

class LoadNotifications extends NotificationEvent {
  final bool unreadOnly;

  const LoadNotifications({this.unreadOnly = false});
}

class LoadMoreNotifications extends NotificationEvent {
  const LoadMoreNotifications();
}

class MarkNotificationRead extends NotificationEvent {
  final int id;

  const MarkNotificationRead(this.id);
}
