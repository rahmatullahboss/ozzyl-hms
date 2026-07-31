import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:ozzyl_health/features/notifications/domain/entities/patient_notification.dart';
import 'package:ozzyl_health/features/notifications/domain/repositories/notification_repository.dart';
import 'package:ozzyl_health/features/notifications/presentation/pages/notifications_page.dart';

class FakeNotificationRepository implements NotificationRepository {
  final List<PatientNotification> notifications;
  final List<int> markedRead = [];
  final List<bool> unreadRequests = [];
  int failuresRemaining;

  FakeNotificationRepository({
    required this.notifications,
    this.failuresRemaining = 0,
  });

  @override
  Future<NotificationInboxPage> getNotifications({
    required int page,
    required bool unreadOnly,
  }) async {
    unreadRequests.add(unreadOnly);
    if (failuresRemaining > 0) {
      failuresRemaining -= 1;
      throw Exception('temporary notification outage');
    }
    final rows = unreadOnly
        ? notifications.where((item) => !item.isRead).toList()
        : notifications;
    return NotificationInboxPage(
      notifications: rows,
      unreadCount: notifications.where((item) => !item.isRead).length,
      page: 1,
      totalPages: 1,
    );
  }

  @override
  Future<void> markRead(int id) async {
    markedRead.add(id);
  }
}

PatientNotification retractionNotification() {
  return PatientNotification(
    id: 41,
    category: 'lab_result_retraction',
    title: 'Laboratory report withdrawn',
    message: 'The report was linked to the wrong laboratory order.',
    link: '/lab-results',
    metadata: const {'requestId': 701, 'labReportId': 501},
    isRead: false,
    readAt: null,
    createdAt: DateTime.utc(2026, 7, 10, 12),
  );
}

Widget appFor(FakeNotificationRepository repository) {
  final router = GoRouter(
    initialLocation: '/notifications',
    routes: [
      GoRoute(
        path: '/notifications',
        builder: (_, __) => NotificationsPage(repository: repository),
      ),
      GoRoute(
        path: '/lab-results',
        builder: (_, __) => const Scaffold(body: Text('Lab Results Destination')),
      ),
    ],
  );
  return MaterialApp.router(routerConfig: router);
}

void main() {
  testWidgets('renders withdrawal warning, marks read, and opens safe lab route',
      (tester) async {
    final repository = FakeNotificationRepository(
      notifications: [retractionNotification()],
    );

    await tester.pumpWidget(appFor(repository));
    await tester.pumpAndSettle();

    expect(find.text('Laboratory report withdrawn'), findsOneWidget);
    expect(
      find.text(
        'Do not use the withdrawn report. Open Lab Results for the approved correction.',
      ),
      findsOneWidget,
    );
    expect(find.byKey(const ValueKey('notification-unread-41')), findsOneWidget);
    expect(find.text('1'), findsOneWidget);

    await tester.tap(find.text('Laboratory report withdrawn'));
    await tester.pumpAndSettle();

    expect(repository.markedRead, [41]);
    expect(find.text('Lab Results Destination'), findsOneWidget);
  });

  testWidgets('unread filter reloads the inbox with unreadOnly enabled',
      (tester) async {
    final repository = FakeNotificationRepository(
      notifications: [retractionNotification()],
    );

    await tester.pumpWidget(appFor(repository));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Unread'));
    await tester.pumpAndSettle();

    expect(repository.unreadRequests, containsAllInOrder([false, true]));
  });

  testWidgets('shows recoverable load error and retries successfully',
      (tester) async {
    final repository = FakeNotificationRepository(
      notifications: [retractionNotification()],
      failuresRemaining: 1,
    );

    await tester.pumpWidget(appFor(repository));
    await tester.pumpAndSettle();

    expect(find.text('temporary notification outage'), findsOneWidget);
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();

    expect(find.text('Laboratory report withdrawn'), findsOneWidget);
    expect(repository.unreadRequests.length, 2);
  });
}
