import 'package:flutter_test/flutter_test.dart';
import 'package:ozzyl_health/features/notifications/domain/entities/patient_notification.dart';
import 'package:ozzyl_health/features/notifications/presentation/pages/notifications_page.dart';

void main() {
  group('PatientNotification', () {
    test('parses retraction evidence and pagination-safe fields', () {
      final notification = PatientNotification.fromJson({
        'id': 41,
        'category': 'lab_result_retraction',
        'title': 'Laboratory report withdrawn',
        'message': 'Do not use the withdrawn report.',
        'link': '/lab-results',
        'metadata': {'requestId': 701, 'labReportId': 501},
        'is_read': 0,
        'read_at': null,
        'created_at': '2026-07-10T12:00:00Z',
      });

      expect(notification.id, 41);
      expect(notification.isRead, isFalse);
      expect(notification.isRetraction, isTrue);
      expect(notification.metadata['requestId'], 701);
      expect(notification.createdAt.toUtc(), DateTime.utc(2026, 7, 10, 12));
    });

    test('copyWithRead preserves immutable notification evidence', () {
      final original = PatientNotification.fromJson({
        'id': 41,
        'category': 'lab_result_retraction',
        'title': 'Laboratory report withdrawn',
        'message': 'Do not use the withdrawn report.',
        'link': '/lab-results',
        'metadata': {'requestId': 701},
        'is_read': 0,
        'created_at': '2026-07-10T12:00:00Z',
      });
      final readAt = DateTime.utc(2026, 7, 10, 12, 30);
      final updated = original.copyWithRead(readAt);

      expect(updated.isRead, isTrue);
      expect(updated.readAt, readAt);
      expect(updated.title, original.title);
      expect(updated.message, original.message);
      expect(updated.metadata, original.metadata);
    });
  });

  group('notificationRouteForLink', () {
    test('allows only known internal patient routes', () {
      expect(notificationRouteForLink('/lab-results'), '/lab-results');
      expect(notificationRouteForLink('/lab-results/52'), '/lab-results/52');
      expect(notificationRouteForLink('/appointments'), '/appointments');
      expect(notificationRouteForLink('/health-records/timeline'), '/health-records/timeline');
    });

    test('rejects external, traversal, protocol-relative, and staff-only links', () {
      expect(notificationRouteForLink('https://evil.example'), isNull);
      expect(notificationRouteForLink('//evil.example/path'), isNull);
      expect(notificationRouteForLink('/lab-results/../admin'), isNull);
      expect(notificationRouteForLink('/lab-results/%2e%2e/admin'), isNull);
      expect(notificationRouteForLink('/lab/20/report'), isNull);
      expect(notificationRouteForLink('/admin'), isNull);
    });
  });
}
