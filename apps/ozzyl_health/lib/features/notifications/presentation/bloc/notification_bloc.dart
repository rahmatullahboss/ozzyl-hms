import 'package:flutter_bloc/flutter_bloc.dart';
import '../../domain/repositories/notification_repository.dart';
import 'notification_event.dart';
import 'notification_state.dart';

class NotificationBloc extends Bloc<NotificationEvent, NotificationState> {
  final NotificationRepository _repository;

  NotificationBloc(this._repository) : super(const NotificationState()) {
    on<LoadNotifications>(_onLoad);
    on<LoadMoreNotifications>(_onLoadMore);
    on<MarkNotificationRead>(_onMarkRead);
  }

  Future<void> _onLoad(
    LoadNotifications event,
    Emitter<NotificationState> emit,
  ) async {
    emit(NotificationState(
      status: NotificationStatus.loading,
      unreadOnly: event.unreadOnly,
    ));
    try {
      final page = await _repository.getNotifications(
        page: 1,
        unreadOnly: event.unreadOnly,
      );
      emit(NotificationState(
        status: NotificationStatus.loaded,
        notifications: page.notifications,
        unreadCount: page.unreadCount,
        page: page.page,
        totalPages: page.totalPages,
        unreadOnly: event.unreadOnly,
      ));
    } catch (error) {
      emit(NotificationState(
        status: NotificationStatus.error,
        unreadOnly: event.unreadOnly,
        errorMessage: _message(error),
      ));
    }
  }

  Future<void> _onLoadMore(
    LoadMoreNotifications event,
    Emitter<NotificationState> emit,
  ) async {
    if (state.status != NotificationStatus.loaded ||
        state.isLoadingMore ||
        !state.hasMore) {
      return;
    }
    emit(state.copyWith(
      isLoadingMore: true,
      clearLoadMoreError: true,
    ));
    try {
      final next = await _repository.getNotifications(
        page: state.page + 1,
        unreadOnly: state.unreadOnly,
      );
      final merged = [...state.notifications];
      final existingIds = merged.map((item) => item.id).toSet();
      for (final item in next.notifications) {
        if (existingIds.add(item.id)) merged.add(item);
      }
      emit(state.copyWith(
        notifications: merged,
        unreadCount: next.unreadCount,
        page: next.page,
        totalPages: next.totalPages,
        isLoadingMore: false,
        clearLoadMoreError: true,
      ));
    } catch (error) {
      emit(state.copyWith(
        isLoadingMore: false,
        loadMoreError: _message(error),
      ));
    }
  }

  Future<void> _onMarkRead(
    MarkNotificationRead event,
    Emitter<NotificationState> emit,
  ) async {
    final index = state.notifications.indexWhere((item) => item.id == event.id);
    if (index < 0 || state.notifications[index].isRead || state.markingReadId != null) {
      return;
    }

    emit(state.copyWith(
      markingReadId: event.id,
      clearMarkReadError: true,
    ));
    try {
      await _repository.markRead(event.id);
      final readAt = DateTime.now().toUtc();
      final updated = [...state.notifications];
      if (state.unreadOnly) {
        updated.removeWhere((item) => item.id == event.id);
      } else {
        final currentIndex = updated.indexWhere((item) => item.id == event.id);
        if (currentIndex >= 0) {
          updated[currentIndex] = updated[currentIndex].copyWithRead(readAt);
        }
      }
      emit(state.copyWith(
        notifications: updated,
        unreadCount: state.unreadCount > 0 ? state.unreadCount - 1 : 0,
        clearMarkingReadId: true,
        clearMarkReadError: true,
      ));
    } catch (error) {
      emit(state.copyWith(
        clearMarkingReadId: true,
        markReadError: _message(error),
      ));
    }
  }

  static String _message(Object error) {
    return error.toString().replaceFirst(RegExp(r'^Exception:\s*'), '');
  }
}
