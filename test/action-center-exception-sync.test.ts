import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { syncExceptionCases } from '../src/services/actionCenter/exceptions/sync';
import type {
  ExceptionDetector,
  ExceptionObservation,
} from '../src/services/actionCenter/exceptions/types';
import { createSqliteD1Harness } from './helpers/sqlite-d1';

const migrationSql = readFileSync('migrations/0500_admin_exception_cases.sql', 'utf8');

function observation(overrides: Partial<ExceptionObservation> = {}): ExceptionObservation {
  return {
    ruleKey: 'cash.stale_handover',
    fingerprint: 'handover:42',
    sourceType: 'cash_handover',
    sourceId: '42',
    module: 'cash',
    severity: 'warning',
    title: 'Stale cash handover',
    description: 'Pending handover is older than 24 hours.',
    sourceHref: '/cash/handover/42',
    metadata: { amount: 100, sourceTimestamp: '2026-07-13 08:00:00' },
    autoResolvable: true,
    allowRecurrence: true,
    ...overrides,
  };
}

function detector(...observations: ExceptionObservation[]): ExceptionDetector {
  return async () => observations;
}

function setup() {
  const harness = createSqliteD1Harness();
  harness.sqlite.exec(migrationSql);
  return harness;
}

function getCase(harness: ReturnType<typeof setup>) {
  return harness.sqlite.prepare(`
    SELECT * FROM admin_exception_cases ORDER BY id LIMIT 1
  `).get() as Record<string, unknown> | undefined;
}

function eventTypes(harness: ReturnType<typeof setup>): string[] {
  return (harness.sqlite.prepare(`
    SELECT event_type FROM admin_exception_events ORDER BY id
  `).all() as Array<{ event_type: string }>).map((row) => row.event_type);
}

describe('exception case synchronization', () => {
  it('creates one case for the same observation and updates last_detected_at on later syncs', async () => {
    const harness = setup();
    const detectors = [detector(observation())];

    const first = await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      actorId: 10,
      now: '2026-07-14 12:00:00',
      detectors,
    });
    const second = await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      actorId: 10,
      now: '2026-07-14 13:00:00',
      detectors,
    });

    expect(first).toEqual({ observed: 1, created: 1, updated: 0, autoResolved: 0 });
    expect(second).toEqual({ observed: 1, created: 0, updated: 1, autoResolved: 0 });
    expect(harness.sqlite.prepare('SELECT COUNT(*) AS count FROM admin_exception_cases').get()).toEqual({ count: 1 });
    expect(getCase(harness)?.last_detected_at).toBe('2026-07-14 13:00:00');
    expect(eventTypes(harness)).toEqual(['created']);
  });

  it('auto-resolves an active auto-resolvable case when the observation clears', async () => {
    const harness = setup();
    await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      now: '2026-07-14 12:00:00',
      detectors: [detector(observation())],
    });

    const result = await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      now: '2026-07-14 14:00:00',
      detectors: [detector()],
    });

    expect(result).toEqual({ observed: 0, created: 0, updated: 0, autoResolved: 1 });
    expect(getCase(harness)?.status).toBe('resolved');
    expect(getCase(harness)?.resolution_code).toBe('source_cleared');
    expect(eventTypes(harness)).toEqual(['created', 'auto_resolved']);
  });

  it('reopens a resolved recurring case when the same fingerprint is observed again', async () => {
    const harness = setup();
    await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      now: '2026-07-14 12:00:00',
      detectors: [detector(observation())],
    });
    harness.sqlite.exec(`
      UPDATE admin_exception_cases
      SET status = 'resolved', resolution_code = 'manual', resolved_at = '2026-07-14 12:30:00'
    `);

    const result = await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      now: '2026-07-14 15:00:00',
      detectors: [detector(observation())],
    });

    expect(result.updated).toBe(1);
    expect(getCase(harness)?.status).toBe('open');
    expect(getCase(harness)?.resolution_code).toBeNull();
    expect(eventTypes(harness)).toEqual(['created', 'reopened']);
  });

  it('keeps a resolved non-recurring case resolved when it is observed again', async () => {
    const harness = setup();
    const nonRecurring = observation({
      ruleKey: 'billing.same_day_cancellation',
      fingerprint: 'bill:8:cancel',
      sourceType: 'bill',
      sourceId: '8',
      autoResolvable: false,
      allowRecurrence: false,
    });
    await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      now: '2026-07-14 12:00:00',
      detectors: [detector(nonRecurring)],
    });
    harness.sqlite.exec(`UPDATE admin_exception_cases SET status = 'resolved'`);

    await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      now: '2026-07-14 16:00:00',
      detectors: [detector(nonRecurring)],
    });

    expect(getCase(harness)?.status).toBe('resolved');
    expect(eventTypes(harness)).toEqual(['created']);
  });

  it('keeps a dismissed fingerprint suppressed while the fingerprint remains unchanged', async () => {
    const harness = setup();
    await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      now: '2026-07-14 12:00:00',
      detectors: [detector(observation())],
    });
    harness.sqlite.exec(`
      UPDATE admin_exception_cases
      SET status = 'dismissed', dismissal_reason = 'Known test transaction'
    `);

    const result = await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-example',
      now: '2026-07-14 17:00:00',
      detectors: [detector(observation())],
    });

    expect(result.created).toBe(0);
    expect(getCase(harness)?.status).toBe('dismissed');
    expect(eventTypes(harness)).toEqual(['created']);
  });

  it('isolates synchronization by tenant', async () => {
    const harness = setup();
    await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-a',
      now: '2026-07-14 12:00:00',
      detectors: [detector(observation())],
    });
    await syncExceptionCases({
      db: harness.db,
      tenantId: 'tenant-b',
      now: '2026-07-14 12:00:00',
      detectors: [detector(observation())],
    });

    expect(harness.sqlite.prepare(`
      SELECT tenant_id, COUNT(*) AS count
      FROM admin_exception_cases
      GROUP BY tenant_id
      ORDER BY tenant_id
    `).all()).toEqual([
      { tenant_id: 'tenant-a', count: 1 },
      { tenant_id: 'tenant-b', count: 1 },
    ]);
  });
});
