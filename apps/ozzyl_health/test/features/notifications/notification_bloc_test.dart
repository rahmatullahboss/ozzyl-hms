import 'package:bloc_test/bloc_test.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:ozzyl_health/features/notifications/domain/entities/patient_notification.dart';
import 'package:ozzyl_health/features/notifications/domain/repositories/notification_repository.dart';
import 'package:ozzyl_health/features/notifications/presentation/bloc/notification_bloc.dart';
import 'package:ozzyl_health/features/notifications/presentation/bloc/notification_event.dart';
import 'package:ozzyl_health/features/notifications/presentation/bloc/notification_state.dart';

class MockNotificationRepository extends Mock implements NotificationRepository {}

PatientNotification notification({required int id, bool isRead = false}) {
  return PatientNotification(
    id: id,
    category: 'lab_result_retraction',
    title: 'Laboratory report withdrawn',
    message: 'Do not use the withdrawn report.',
    link: '/lab-results',
    metadata: const {'requestId': 701},
    isRead: isRead,
    readAt: null,
    createdAt: DateTime.utc(2026, 7, 10, 12),
  );
}

void main() {
  late MockNotificationRepository repository;

  setUp(() {
    repository = MockNotificationRepository();
  });

  blocTest<NotificationBloc, NotificationState>(
    'loads first page with unread count and pagination',
    build: () {
      when(() => repository.getNotifications(page: 1, unreadOnly: false))
          .thenAnswer((_) async => NotificationInboxPage(
                notifications: [notification(id: 1)],
                unreadCount: 1,
                page: 1,
                totalPages: 2,
              ));
      return NotificationBloc(repository);
    },
    act: (bloc) => bloc.add(const LoadNotifications()),
    expect: () => [
      isA<NotificationState>()
          .having((state) => state.status, 'status', NotificationStatus.loading),
      isA<NotificationState>()
          .having((state) => state.status, 'status', NotificationStatus.loaded)
          .having((state) => state.notifications.length, 'count', 1)
          .having((state) => state.unreadCount, 'unreadCount', 1)
          .having((state) => state.hasMore, 'hasMore', isTrue),
    ],
  );

  blocTest<NotificationBloc, NotificationState>(
    'marks an unread notification read and decrements unread count once',
    build: () {
      when(() => repository.getNotifications(page: 1, unreadOnly: false))
          .thenAnswer((_) async => NotificationInboxPage(
                notifications: [notification(id: 1)],
                unreadCount: 1,
                page: 1,
                totalPages: 1,
              ));
      when(() => repository.markRead(1)).thenAnswer((_) async {});
      return NotificationBloc(repository);
    },
    act: (bloc) async {
      bloc.add(const LoadNotifications());
      await Future<void>.delayed(Duration.zero);
      bloc.add(const MarkNotificationRead(1));
    },
    skip: 2,
    expect: () => [
      isA<NotificationState>()
          .having((state) => state.markingReadId, 'markingReadId', 1)
          .having((state) => state.notifications.single.isRead, 'isRead', isFalse),
      isA<NotificationState>()
          .having((state) => state.notifications.single.isRead, 'isRead', isTrue)
          .having((state) => state.unreadCount, 'unreadCount', 0)
          .having((state) => state.markingReadId, 'markingReadId', isNull),
    ],
    verify: (_) => verify(() => repository.markRead(1)).called(1),
  );

  blocTest<NotificationBloc, NotificationState>(
    'keeps existing evidence and exposes an error when load-more fails',
    build: () {
      when(() => repository.getNotifications(page: 1, unreadOnly: false))
          .thenAnswer((_) async => NotificationInboxPage(
                notifications: [notification(id: 1)],
                unreadCount: 1,
                page: 1,
                totalPages: 2,
              ));
      when(() => repository.getNotifications(page: 2, unreadOnly: false))
          .thenThrow(Exception('network unavailable'));
      return NotificationBloc(repository);
    },
    act: (bloc) async {
      bloc.add(const LoadNotifications());
      await Future<void>.delayed(Duration.zero);
      bloc.add(const LoadMoreNotifications());
    },
    skip: 2,
    expect: () => [
      isA<NotificationState>()
          .having((state) => state.isLoadingMore, 'isLoadingMore', isTrue)
          .having((state) => state.notifications.length, 'preserved count', 1),
      isA<NotificationState>()
          .having((state) => state.notifications.length, 'preserved count', 1)
          .having((state) => state.isLoadingMore, 'isLoadingMore', isFalse)
          .having((state) => state.loadMoreError, 'loadMoreError', contains('network unavailable')),
    ],
  );
}
