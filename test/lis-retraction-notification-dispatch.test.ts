import { describe, expect, it } from 'vitest';
import {
  buildLisRetractionNotificationContent,
  lisRetractionNotificationBackoffMinutes,
} from '../src/services/lis-retraction-notification-dispatch';

describe('LIS retraction notification dispatch helpers', () => {
  it('uses bounded exponential retry backoff', () => {
    expect(lisRetractionNotificationBackoffMinutes(1)).toBe(1);
    expect(lisRetractionNotificationBackoffMinutes(2)).toBe(5);
    expect(lisRetractionNotificationBackoffMinutes(3)).toBe(15);
    expect(lisRetractionNotificationBackoffMinutes(4)).toBe(60);
    expect(lisRetractionNotificationBackoffMinutes(10)).toBe(360);
  });

  it('builds safety-focused content without repeating the withdrawn result value', () => {
    const content = buildLisRetractionNotificationContent({
      requestId: 701,
      labOrderId: 20,
      labReportId: 501,
      patientId: 40,
      reasonCode: 'wrong_order',
      reason: 'The report was linked to the wrong laboratory order.',
    });

    expect(content.title).toContain('withdrawn');
    expect(content.message).toContain('wrong laboratory order');
    expect(content.message).toContain('Do not use the withdrawn report');
    expect(content.link).toBe('/lab/20/report');
    expect(content.portalLink).toBe('/lab-results');
    expect(content.metadata).toMatchObject({ requestId: 701, labReportId: 501 });
    expect(content.message).not.toMatch(/result value/i);
  });

  it('wires expansion, lease claim, idempotent channel writes, retries, and aggregate status', async () => {
    const source = await import('../src/services/lis-retraction-notification-dispatch?raw');
    expect(source.default).toContain('INSERT OR IGNORE INTO lis_result_retraction_notification_deliveries');
    expect(source.default).toContain("role IN ('pathologist', 'lab_supervisor', 'hospital_admin', 'md', 'laboratory', 'lab')");
    expect(source.default).toContain('lab_order.ordered_by');
    expect(source.default).toContain("status = 'processing'");
    expect(source.default).toContain("DATETIME(CURRENT_TIMESTAMP, '-10 minutes')");
    expect(source.default).toContain('INSERT OR IGNORE INTO notifications');
    expect(source.default).toContain('INSERT OR IGNORE INTO patient_portal_notifications');
    expect(source.default).toContain("status = 'sent'");
    expect(source.default).toContain('next_attempt_at');
    expect(source.default).toContain('UPDATE lis_result_retraction_notification_outbox');
  });
});
