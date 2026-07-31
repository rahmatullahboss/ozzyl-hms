import '../../domain/entities/patient_notification.dart';

enum NotificationStatus { initial, loading, loaded, error }

class NotificationState {
  final NotificationStatus status;
  final List<PatientNotification> notifications;
  final int unreadCount;
  final int page;
  final int totalPages;
  final bool unreadOnly;
  final bool isLoadingMore;
  final int? markingReadId;
  final String? errorMessage;
  final String? loadMoreError;
  final String? markReadError;

  const NotificationState({
    this.status = NotificationStatus.initial,
    this.notifications = const [],
    this.unreadCount = 0,
    this.page = 0,
    this.totalPages = 0,
    this.unreadOnly = false,
    this.isLoadingMore = false,
    this.markingReadId,
    this.errorMessage,
    this.loadMoreError,
    this.markReadError,
  });

  bool get hasMore => page < totalPages;

  NotificationState copyWith({
    NotificationStatus? status,
    List<PatientNotification>? notifications,
    int? unreadCount,
    int? page,
    int? totalPages,
    bool? unreadOnly,
    bool? isLoadingMore,
    int? markingReadId,
    bool clearMarkingReadId = false,
    String? errorMessage,
    bool clearErrorMessage = false,
    String? loadMoreError,
    bool clearLoadMoreError = false,
    String? markReadError,
    bool clearMarkReadError = false,
  }) {
    return NotificationState(
      status: status ?? this.status,
      notifications: notifications ?? this.notifications,
      unreadCount: unreadCount ?? this.unreadCount,
      page: page ?? this.page,
      totalPages: totalPages ?? this.totalPages,
      unreadOnly: unreadOnly ?? this.unreadOnly,
      isLoadingMore: isLoadingMore ?? this.isLoadingMore,
      markingReadId:
          clearMarkingReadId ? null : markingReadId ?? this.markingReadId,
      errorMessage:
          clearErrorMessage ? null : errorMessage ?? this.errorMessage,
      loadMoreError:
          clearLoadMoreError ? null : loadMoreError ?? this.loadMoreError,
      markReadError:
          clearMarkReadError ? null : markReadError ?? this.markReadError,
    );
  }
}
