import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  cancelServiceEvent,
  cancelServiceRequest,
  createServiceRequest,
  recordServiceEvent,
} from '../../src/lib/canonical/commands/service-operations';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly database: DatabaseSync,
    readonly sql: string,
    readonly params: SqlValue[] = [],
  ) {}

  bind(...values: unknown[]): Statement {
    return new Statement(
      this.database,
      this.sql,
      values.map((value) => (value === undefined ? null : value)) as SqlValue[],
    );
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.database.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function createHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  for (const migration of [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
  ]) {
    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
  sqlite.exec(`
    INSERT INTO canonical_practitioners (
      tenant_id, practitioner_public_id, practitioner_kind, display_name, status
    ) VALUES ('tenant-a','prc-1','internal','Synthetic Practitioner','active');
    INSERT INTO canonical_encounters (
      tenant_id, encounter_public_id, legacy_patient_id, encounter_type, status,
      started_at_utc, source_evidence_sha256
    ) VALUES (
      'tenant-a','enc-1',101,'outpatient','in_progress',
      '2026-07-14T03:00:00.000Z', '${'a'.repeat(64)}'
    );
    INSERT INTO canonical_service_catalog_items (
      tenant_id, service_public_id, item_kind, canonical_code, display_name,
      unit_code, status, source_evidence_sha256
    ) VALUES (
      'tenant-a','svc-1','laboratory','LAB-1','Synthetic Lab','service','active',
      '${'b'.repeat(64)}'
    );
  `);

  const controls: { beforeNextBatch?: (() => void) | null } = {};
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements) {
      const hook = controls.beforeNextBatch;
      controls.beforeNextBatch = null;
      hook?.();
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return { sqlite, db, controls };
}

function requestInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    requestPublicId: 'req-1',
    legacyPatientId: 101,
    encounterPublicId: 'enc-1',
    servicePublicId: 'svc-1',
    requestedQuantity: 5,
    requestedAtUtc: '2026-07-14T03:10:00.000Z',
    participant: {
      practitionerPublicId: 'prc-1',
      role: 'ordering' as const,
      evidenceType: 'approved_manual' as const,
    },
    sourceType: 'runtime_lab_request',
    sourcePublicId: 'runtime-request-1',
    sourceTable: 'runtime',
    sourceEvidenceSha256: 'c'.repeat(64),
    idempotencyKey: 'create-request-1',
    outboxEventPublicId: 'outbox-create-request-1',
    businessDate: '2026-07-14',
    ...overrides,
  };
}

function eventInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    requestPublicId: 'req-1',
    eventPublicId: 'service-event-1',
    eventType: 'completed' as const,
    quantity: 2,
    occurredAtUtc: '2026-07-14T03:20:00.000Z',
    participant: {
      practitionerPublicId: 'prc-1',
      role: 'performing' as const,
      evidenceType: 'approved_manual' as const,
    },
    sourceType: 'runtime_lab_event',
    sourcePublicId: 'runtime-event-1',
    sourceTable: 'runtime',
    sourceEvidenceSha256: 'd'.repeat(64),
    idempotencyKey: 'record-event-1',
    outboxEventPublicId: 'outbox-record-event-1',
    businessDate: '2026-07-14',
    ...overrides,
  };
}

function cancelRequestInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    requestPublicId: 'req-1',
    cancelledAtUtc: '2026-07-14T03:25:00.000Z',
    idempotencyKey: 'cancel-request-1',
    outboxEventPublicId: 'outbox-cancel-request-1',
    businessDate: '2026-07-14',
    ...overrides,
  };
}

function cancelEventInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: 'tenant-a',
    eventPublicId: 'service-event-1',
    cancelledAtUtc: '2026-07-14T03:25:00.000Z',
    idempotencyKey: 'cancel-event-1',
    outboxEventPublicId: 'outbox-cancel-event-1',
    businessDate: '2026-07-14',
    ...overrides,
  };
}

function scalar(sqlite: DatabaseSync, sql: string): number {
  return Number((sqlite.prepare(sql).get() as { count: number }).count);
}

describe('canonical service operation commands', () => {
  it('atomically creates a request, participant, mapping, and PHI-free outbox result', async () => {
    const { sqlite, db } = createHarness();
    try {
      expect(await createServiceRequest(db, requestInput())).toEqual({
        status: 'applied',
        result: { requestPublicId: 'req-1', status: 'active' },
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_requests')).toBe(1);
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_participants')).toBe(1);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='service_request'")).toBe(1);

      const outbox = sqlite.prepare(
        `SELECT payload_json FROM canonical_outbox_events
         WHERE idempotency_key='create-request-1'`,
      ).get() as { payload_json: string };
      expect(outbox.payload_json).not.toContain('legacyPatientId');
      expect(JSON.parse(outbox.payload_json).event).toEqual({
        requestPublicId: 'req-1',
        requestedQuantity: 5,
        servicePublicId: 'svc-1',
        status: 'active',
      });

      expect(await createServiceRequest(db, requestInput())).toEqual({
        status: 'replayed',
        result: { requestPublicId: 'req-1', status: 'active' },
      });
      await expect(
        createServiceRequest(db, requestInput({ requestedQuantity: 6 })),
      ).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('records partial and final delivery atomically and replays after fulfillment', async () => {
    const { sqlite, db } = createHarness();
    try {
      await createServiceRequest(db, requestInput());
      expect(await recordServiceEvent(db, eventInput())).toEqual({
        status: 'applied',
        result: {
          eventPublicId: 'service-event-1',
          requestPublicId: 'req-1',
          requestStatus: 'partially_fulfilled',
          fulfilledQuantity: 2,
        },
      });
      expect(await recordServiceEvent(db, eventInput())).toEqual({
        status: 'replayed',
        result: {
          eventPublicId: 'service-event-1',
          requestPublicId: 'req-1',
          requestStatus: 'partially_fulfilled',
          fulfilledQuantity: 2,
        },
      });

      const finalInput = eventInput({
        eventPublicId: 'service-event-2',
        quantity: 3,
        occurredAtUtc: '2026-07-14T03:30:00.000Z',
        sourcePublicId: 'runtime-event-2',
        sourceEvidenceSha256: 'e'.repeat(64),
        idempotencyKey: 'record-event-2',
        outboxEventPublicId: 'outbox-record-event-2',
      });
      expect(await recordServiceEvent(db, finalInput)).toEqual({
        status: 'applied',
        result: {
          eventPublicId: 'service-event-2',
          requestPublicId: 'req-1',
          requestStatus: 'fulfilled',
          fulfilledQuantity: 5,
        },
      });
      expect(await recordServiceEvent(db, finalInput)).toEqual({
        status: 'replayed',
        result: {
          eventPublicId: 'service-event-2',
          requestPublicId: 'req-1',
          requestStatus: 'fulfilled',
          fulfilledQuantity: 5,
        },
      });

      expect(sqlite.prepare(`
        SELECT fulfilled_quantity,status,last_event_public_id
        FROM canonical_service_requests
      `).get()).toEqual({
        fulfilled_quantity: 5,
        status: 'fulfilled',
        last_event_public_id: 'service-event-2',
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_events')).toBe(2);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_source_mappings WHERE entity_type='service_event'")).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('rejects over-fulfillment without writing an event or idempotency claim', async () => {
    const { sqlite, db } = createHarness();
    try {
      await createServiceRequest(db, requestInput({ requestedQuantity: 1 }));
      await expect(recordServiceEvent(db, eventInput({ quantity: 2 }))).rejects.toThrow(
        /exceeds the unfulfilled request quantity/,
      );
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_events')).toBe(0);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE idempotency_key='record-event-1'")).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back a stale concurrent delivery batch using the last-event guard', async () => {
    const { sqlite, db, controls } = createHarness();
    try {
      await createServiceRequest(db, requestInput());
      controls.beforeNextBatch = () => {
        sqlite.prepare(`
          UPDATE canonical_service_requests
          SET fulfilled_quantity=1,last_event_public_id='external-event'
          WHERE tenant_id='tenant-a' AND request_public_id='req-1'
        `).run();
      };

      await expect(recordServiceEvent(db, eventInput())).rejects.toThrow(
        /NOT NULL constraint failed: canonical_service_events.service_public_id/,
      );
      expect(sqlite.prepare(`
        SELECT fulfilled_quantity,last_event_public_id
        FROM canonical_service_requests
      `).get()).toEqual({
        fulfilled_quantity: 1,
        last_event_public_id: 'external-event',
      });
      expect(scalar(sqlite, 'SELECT COUNT(*) count FROM canonical_service_events')).toBe(0);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE idempotency_key='record-event-1'")).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('cancels the current service event, restores request authority, and replays exactly', async () => {
    const { sqlite, db } = createHarness();
    try {
      await createServiceRequest(db, requestInput());
      await recordServiceEvent(db, eventInput());
      await recordServiceEvent(db, eventInput({
        eventPublicId: 'service-event-2',
        quantity: 3,
        occurredAtUtc: '2026-07-14T03:30:00.000Z',
        sourcePublicId: 'runtime-event-2',
        sourceEvidenceSha256: 'e'.repeat(64),
        idempotencyKey: 'record-event-2',
        outboxEventPublicId: 'outbox-record-event-2',
      }));

      const input = cancelEventInput({
        eventPublicId: 'service-event-2',
        cancelledAtUtc: '2026-07-14T03:40:00.000Z',
        idempotencyKey: 'cancel-event-2',
        outboxEventPublicId: 'outbox-cancel-event-2',
      });
      expect(await cancelServiceEvent(db, input)).toEqual({
        status: 'applied',
        result: {
          eventPublicId: 'service-event-2',
          requestPublicId: 'req-1',
          status: 'cancelled',
          requestStatus: 'partially_fulfilled',
          fulfilledQuantity: 2,
        },
      });
      expect(sqlite.prepare(`
        SELECT fulfilled_quantity,status,last_event_public_id
        FROM canonical_service_requests WHERE request_public_id='req-1'
      `).get()).toEqual({
        fulfilled_quantity: 2,
        status: 'partially_fulfilled',
        last_event_public_id: 'service-event-1',
      });
      expect(sqlite.prepare(`
        SELECT status,cancelled_at_utc,event_type,quantity
        FROM canonical_service_events WHERE event_public_id='service-event-2'
      `).get()).toEqual({
        status: 'cancelled',
        cancelled_at_utc: '2026-07-14T03:40:00.000Z',
        event_type: 'completed',
        quantity: 3,
      });
      const outbox = sqlite.prepare(`
        SELECT event_type,aggregate_public_id,payload_json
        FROM canonical_outbox_events WHERE idempotency_key='cancel-event-2'
      `).get() as { event_type: string; aggregate_public_id: string; payload_json: string };
      expect(outbox.event_type).toBe('canonical.service_event.cancelled');
      expect(outbox.aggregate_public_id).toBe('service-event-2');
      expect(JSON.parse(outbox.payload_json).event).toEqual({
        eventPublicId: 'service-event-2',
        fulfilledQuantityAfter: 2,
        fulfilledQuantityBefore: 5,
        previousEventPublicId: 'service-event-1',
        requestPublicId: 'req-1',
        requestStatusAfter: 'partially_fulfilled',
        status: 'cancelled',
      });
      expect(await cancelServiceEvent(db, input)).toEqual({
        status: 'replayed',
        result: {
          eventPublicId: 'service-event-2',
          requestPublicId: 'req-1',
          status: 'cancelled',
          requestStatus: 'partially_fulfilled',
          fulfilledQuantity: 2,
        },
      });
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.service_event.cancelled'")).toBe(1);
      await expect(cancelServiceEvent(db, {
        ...input,
        cancelledAtUtc: '2026-07-14T03:41:00.000Z',
      })).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('keeps accepted-event fulfillment unchanged and rejects non-current or invalid cancellation', async () => {
    const { sqlite, db } = createHarness();
    try {
      await createServiceRequest(db, requestInput());
      await recordServiceEvent(db, eventInput());
      await recordServiceEvent(db, eventInput({
        eventPublicId: 'service-event-accepted',
        eventType: 'accepted',
        quantity: 1,
        occurredAtUtc: '2026-07-14T03:22:00.000Z',
        sourcePublicId: 'runtime-event-accepted',
        sourceEvidenceSha256: 'f'.repeat(64),
        idempotencyKey: 'record-event-accepted',
        outboxEventPublicId: 'outbox-record-event-accepted',
      }));
      await expect(cancelServiceEvent(db, cancelEventInput()))
        .rejects.toThrow(/current last event/i);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.service_event.cancelled'")).toBe(0);

      expect(await cancelServiceEvent(db, cancelEventInput({
        eventPublicId: 'service-event-accepted',
        cancelledAtUtc: '2026-07-14T03:23:00.000Z',
        idempotencyKey: 'cancel-event-accepted',
        outboxEventPublicId: 'outbox-cancel-event-accepted',
      }))).toEqual({
        status: 'applied',
        result: {
          eventPublicId: 'service-event-accepted',
          requestPublicId: 'req-1',
          status: 'cancelled',
          requestStatus: 'partially_fulfilled',
          fulfilledQuantity: 2,
        },
      });
      expect(sqlite.prepare(`
        SELECT fulfilled_quantity,status,last_event_public_id
        FROM canonical_service_requests WHERE request_public_id='req-1'
      `).get()).toEqual({
        fulfilled_quantity: 2,
        status: 'partially_fulfilled',
        last_event_public_id: 'service-event-1',
      });

      await expect(cancelServiceEvent(db, cancelEventInput({
        eventPublicId: 'service-event-1',
        cancelledAtUtc: '2026-07-14 03:25:00',
        idempotencyKey: 'cancel-event-invalid-time',
        outboxEventPublicId: 'outbox-cancel-event-invalid-time',
      }))).rejects.toThrow(/explicit ISO timestamp|normalized UTC/i);
    } finally {
      sqlite.close();
    }
  });

  it('rolls back a stale concurrent service-event cancellation batch', async () => {
    const { sqlite, db, controls } = createHarness();
    try {
      await createServiceRequest(db, requestInput());
      await recordServiceEvent(db, eventInput());
      controls.beforeNextBatch = () => {
        sqlite.prepare(`
          UPDATE canonical_service_requests
          SET last_event_public_id='external-event'
          WHERE tenant_id='tenant-a' AND request_public_id='req-1'
        `).run();
      };
      await expect(cancelServiceEvent(db, cancelEventInput())).rejects.toThrow();
      expect(sqlite.prepare(`
        SELECT fulfilled_quantity,status,last_event_public_id
        FROM canonical_service_requests WHERE request_public_id='req-1'
      `).get()).toEqual({
        fulfilled_quantity: 2,
        status: 'partially_fulfilled',
        last_event_public_id: 'external-event',
      });
      expect(sqlite.prepare(`
        SELECT status,cancelled_at_utc
        FROM canonical_service_events WHERE event_public_id='service-event-1'
      `).get()).toEqual({ status: 'posted', cancelled_at_utc: null });
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.service_event.cancelled'")).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it('cancels active and partially fulfilled requests while preserving fulfilled authority', async () => {
    const { sqlite, db } = createHarness();
    try {
      await createServiceRequest(db, requestInput());
      await recordServiceEvent(db, eventInput());
      expect(await cancelServiceRequest(db, cancelRequestInput())).toEqual({
        status: 'applied',
        result: { requestPublicId: 'req-1', status: 'cancelled', fulfilledQuantity: 2 },
      });
      expect(sqlite.prepare(`
        SELECT requested_quantity,fulfilled_quantity,status,cancelled_at_utc,last_event_public_id
        FROM canonical_service_requests
      `).get()).toEqual({
        requested_quantity: 5,
        fulfilled_quantity: 2,
        status: 'cancelled',
        cancelled_at_utc: '2026-07-14T03:25:00.000Z',
        last_event_public_id: 'service-event-1',
      });
      const outbox = sqlite.prepare(`
        SELECT event_type,aggregate_public_id,payload_json
        FROM canonical_outbox_events WHERE idempotency_key='cancel-request-1'
      `).get() as { event_type: string; aggregate_public_id: string; payload_json: string };
      expect(outbox.event_type).toBe('canonical.service_request.cancelled');
      expect(outbox.aggregate_public_id).toBe('req-1');
      expect(JSON.parse(outbox.payload_json).event).toEqual({
        requestPublicId: 'req-1',
        status: 'cancelled',
        fulfilledQuantity: 2,
      });
      expect(await cancelServiceRequest(db, cancelRequestInput())).toEqual({
        status: 'replayed',
        result: { requestPublicId: 'req-1', status: 'cancelled', fulfilledQuantity: 2 },
      });
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.service_request.cancelled'")).toBe(1);
      await expect(cancelServiceRequest(db, cancelRequestInput({ cancelledAtUtc: '2026-07-14T03:26:00.000Z' })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally {
      sqlite.close();
    }
  });

  it('rejects cancellation after fulfilment and invalid timestamps without an outbox claim', async () => {
    const { sqlite, db } = createHarness();
    try {
      await createServiceRequest(db, requestInput({ requestedQuantity: 2 }));
      await recordServiceEvent(db, eventInput({ quantity: 2 }));
      await expect(cancelServiceRequest(db, cancelRequestInput())).rejects.toThrow(/cannot be cancelled in status: fulfilled/i);
      await expect(cancelServiceRequest(db, cancelRequestInput({
        idempotencyKey: 'cancel-request-invalid-time',
        outboxEventPublicId: 'outbox-cancel-request-invalid-time',
        cancelledAtUtc: '2026-07-14 03:25:00',
      }))).rejects.toThrow(/explicit ISO timestamp|normalized UTC/i);
      expect(scalar(sqlite, "SELECT COUNT(*) count FROM canonical_outbox_events WHERE event_type='canonical.service_request.cancelled'")).toBe(0);
    } finally {
      sqlite.close();
    }
  });
});
