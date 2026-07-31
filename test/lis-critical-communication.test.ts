import { describe, expect, it } from 'vitest';
import {
  acknowledgeLisCriticalEvent,
  escalateOverdueLisCriticalEvents,
  LisCriticalEventError,
} from '../src/services/lis-critical-events';
import { createMockDB } from './integration/helpers/mock-db';

const openEvent = {
  id: 901,
  tenant_id: 'tenant-1',
  lis_analyzer_inbox_id: 80,
  status: 'delivered',
  acknowledgement_deadline: '2026-07-10T08:15:00.000Z',
  acknowledged_by: null,
  acknowledged_at: null,
};

function createEventDb(
  event: Record<string, unknown> | null = openEvent,
  options: { updateChanges?: number } = {},
) {
  return createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from lis_critical_event_outbox') && lower.includes('limit 1')) {
        return { first: event };
      }
      if (lower.includes('update lis_critical_event_outbox')) {
        return { meta: { changes: options.updateChanges ?? 1 } };
      }
      return null;
    },
  });
}

describe('LIS critical-result communication lifecycle', () => {
  it('allows an accountable clinical role to acknowledge an open critical event', async () => {
    const mock = createEventDb();

    const result = await acknowledgeLisCriticalEvent(mock.db, {
      tenantId: 'tenant-1',
      eventId: 901,
      actorUserId: 15,
      actorRole: 'doctor',
      note: 'Consultant informed by phone',
    });

    expect(result).toEqual({
      acknowledged: true,
      eventId: 901,
      inboxId: 80,
      previousStatus: 'delivered',
    });
    const update = mock.queries.find(({ sql }) => sql.includes('UPDATE lis_critical_event_outbox'));
    expect(update?.sql).toContain("status = 'acknowledged'");
    expect(update?.params).toContain(15);
    expect(update?.params).toContain('Consultant informed by phone');
  });

  it('rejects non-clinical roles from acknowledging critical events', async () => {
    const mock = createEventDb();

    await expect(acknowledgeLisCriticalEvent(mock.db, {
      tenantId: 'tenant-1',
      eventId: 901,
      actorUserId: 15,
      actorRole: 'reception',
    })).rejects.toMatchObject({ code: 'forbidden', status: 403 });
    expect(mock.queries).toHaveLength(0);
  });

  it('does not allow an acknowledged or cancelled event to be acknowledged again', async () => {
    for (const status of ['acknowledged', 'cancelled']) {
      const mock = createEventDb({ ...openEvent, status });
      await expect(acknowledgeLisCriticalEvent(mock.db, {
        tenantId: 'tenant-1',
        eventId: 901,
        actorUserId: 15,
        actorRole: 'pathologist',
      })).rejects.toBeInstanceOf(LisCriticalEventError);
      expect(mock.queries.some(({ sql }) => sql.includes('UPDATE lis_critical_event_outbox'))).toBe(false);
    }
  });

  it('detects an optimistic acknowledgement conflict', async () => {
    const mock = createEventDb(openEvent, { updateChanges: 0 });

    await expect(acknowledgeLisCriticalEvent(mock.db, {
      tenantId: 'tenant-1',
      eventId: 901,
      actorUserId: 15,
      actorRole: 'lab_supervisor',
    })).rejects.toMatchObject({ code: 'acknowledgement_conflict', status: 409 });
  });

  it('escalates only overdue unresolved critical events and records an attempt', async () => {
    const mock = createEventDb();

    const result = await escalateOverdueLisCriticalEvents(
      mock.db,
      'tenant-1',
      new Date('2026-07-10T08:20:00.000Z'),
    );

    expect(result).toEqual({ escalated: 1 });
    const update = mock.queries.find(({ sql }) => sql.includes('UPDATE lis_critical_event_outbox'));
    expect(update?.sql).toContain("status = 'escalated'");
    expect(update?.sql).toContain('attempt_count = attempt_count + 1');
    expect(update?.sql).toContain("status IN ('pending', 'processing', 'delivered', 'failed')");
    expect(update?.params).toContain('2026-07-10T08:20:00.000Z');
  });
});
