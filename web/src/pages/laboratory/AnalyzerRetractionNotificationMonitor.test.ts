import { describe, expect, it } from 'vitest';
import {
  analyzerRetractionNotificationOutboxUrl,
  canRetryAnalyzerRetractionNotification,
  notificationDeliveryStatusBadge,
} from './AnalyzerRetractionNotificationMonitor';

describe('AnalyzerRetractionNotificationMonitor helpers', () => {
  it('builds a machine-scoped monitoring URL with delivery evidence', () => {
    expect(analyzerRetractionNotificationOutboxUrl({ machineId: 4, status: 'failed' })).toBe(
      '/api/lab-machines/retraction-notification-outbox?machineId=4&status=failed&includeDeliveries=true',
    );
  });

  it('permits manual retry only for terminal events with failed recipient deliveries', () => {
    expect(canRetryAnalyzerRetractionNotification({ status: 'failed', delivery_failed: 1 })).toBe(true);
    expect(canRetryAnalyzerRetractionNotification({ status: 'failed', delivery_failed: 0 })).toBe(false);
    expect(canRetryAnalyzerRetractionNotification({ status: 'pending', delivery_failed: 1 })).toBe(false);
  });

  it('maps delivery status to operational badges', () => {
    expect(notificationDeliveryStatusBadge('sent')).toBe('badge-success');
    expect(notificationDeliveryStatusBadge('failed')).toBe('badge-danger');
    expect(notificationDeliveryStatusBadge('processing')).toBe('badge-warning');
    expect(notificationDeliveryStatusBadge('pending')).toBe('badge-secondary');
  });

  it('wires accountable retry and never offers blind retry for no-recipient terminal events', async () => {
    const source = await import('./AnalyzerRetractionNotificationMonitor?raw');
    expect(source.default).toContain('/api/lab-machines/retraction-notification-outbox/${selected.id}/retry');
    expect(source.default).toContain('reason: retryReason.trim()');
    expect(source.default).toContain('No recoverable recipient delivery exists');
    expect(source.default).toContain('delivery.last_error');
  });
});
