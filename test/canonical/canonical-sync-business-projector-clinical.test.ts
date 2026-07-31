import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  CanonicalSyncBusinessProjectionError,
  projectCanonicalSyncBusinessMutation,
} from '../../src/lib/canonical/local-sync-business-projector';

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}
  bind(...params: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, params.map((value) => value === undefined ? null : value) as SQLInputValue[]);
  }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sync_key TEXT
    );
    CREATE TABLE canonical_encounters (
      tenant_id TEXT NOT NULL,
      encounter_public_id TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      encounter_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at_utc TEXT NOT NULL,
      ended_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (tenant_id,encounter_public_id)
    );
    CREATE TABLE canonical_service_requests (
      tenant_id TEXT NOT NULL,
      request_public_id TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      encounter_public_id TEXT,
      service_public_id TEXT NOT NULL,
      requested_quantity INTEGER NOT NULL,
      fulfilled_quantity INTEGER NOT NULL,
      last_event_public_id TEXT,
      status TEXT NOT NULL,
      requested_at_utc TEXT NOT NULL,
      cancelled_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (tenant_id,request_public_id)
    );
    CREATE TABLE canonical_service_events (
      tenant_id TEXT NOT NULL,
      event_public_id TEXT NOT NULL,
      request_public_id TEXT,
      encounter_public_id TEXT,
      service_public_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL,
      occurred_at_utc TEXT NOT NULL,
      cancelled_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      PRIMARY KEY (tenant_id,event_public_id)
    );
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
    INSERT INTO canonical_encounters VALUES (
      '100','encounter-1',101,'outpatient','completed',
      '2026-07-25T01:00:00Z','2026-07-25T02:00:00Z','${'a'.repeat(64)}'
    );
    INSERT INTO canonical_service_requests VALUES (
      '100','request-1',101,'encounter-1','service-1',2,2,'service-event-1','fulfilled',
      '2026-07-25T01:10:00Z',NULL,'${'b'.repeat(64)}'
    );
    INSERT INTO canonical_service_events VALUES (
      '100','service-event-1','request-1','encounter-1','service-1','completed',2,'posted',
      '2026-07-25T01:20:00Z',NULL,'${'c'.repeat(64)}'
    );
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
    async batch(statements) {
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
  return { sqlite, db };
}

function project(
  db: CanonicalBatchDatabase,
  input: Partial<Parameters<typeof projectCanonicalSyncBusinessMutation>[1]> = {},
) {
  return projectCanonicalSyncBusinessMutation(db, {
    tenantId: '100',
    entityType: 'encounter',
    entityPublicId: 'encounter-1',
    eventType: 'canonical.encounter.started',
    occurredAtUtc: '2026-07-25T01:00:00Z',
    event: {
      encounterPublicId: 'encounter-1',
      encounterType: 'outpatient',
      status: 'in_progress',
    },
    ...input,
  });
}

describe('canonical sync clinical business projection', () => {
  it('projects encounter start from immutable facts even when current encounter is completed', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db)).resolves.toEqual({
        kind: 'encounter_started',
        entityPublicId: 'encounter-1',
        patientSyncKey: 'uhid:P-001',
        encounterType: 'outpatient',
        startedAtUtc: '2026-07-25T01:00:00Z',
        sourceEvidenceSha256: 'a'.repeat(64),
      });
    } finally { sqlite.close(); }
  });

  it('projects encounter completion only when exact ended-at evidence matches the event', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db, {
        eventType: 'canonical.encounter.completed',
        occurredAtUtc: '2026-07-25T02:00:00Z',
        event: { encounterPublicId: 'encounter-1', status: 'completed' },
      })).resolves.toEqual({
        kind: 'encounter_completed',
        entityPublicId: 'encounter-1',
        encounterType: 'outpatient',
        startedAtUtc: '2026-07-25T01:00:00Z',
        completedAtUtc: '2026-07-25T02:00:00Z',
        sourceEvidenceSha256: 'a'.repeat(64),
      });

      await expect(project(db, {
        eventType: 'canonical.encounter.completed',
        occurredAtUtc: '2026-07-25T02:05:00Z',
        event: { encounterPublicId: 'encounter-1', status: 'completed' },
      })).rejects.toThrow(/completion evidence/i);
    } finally { sqlite.close(); }
  });

  it('projects service request creation from immutable source authority and patient sync identity', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db, {
        entityType: 'service_request',
        entityPublicId: 'request-1',
        eventType: 'canonical.service_request.created',
        occurredAtUtc: '2026-07-25T01:10:00Z',
        event: {
          requestPublicId: 'request-1',
          servicePublicId: 'service-1',
          requestedQuantity: 2,
          status: 'active',
        },
      })).resolves.toEqual({
        kind: 'service_request_created',
        entityPublicId: 'request-1',
        patientSyncKey: 'uhid:P-001',
        encounterPublicId: 'encounter-1',
        servicePublicId: 'service-1',
        requestedQuantity: 2,
        requestedAtUtc: '2026-07-25T01:10:00Z',
        sourceEvidenceSha256: 'b'.repeat(64),
      });
    } finally { sqlite.close(); }
  });

  it('projects encounter and service-request cancellations from exact terminal source authority', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`
        UPDATE canonical_encounters
        SET status='cancelled',ended_at_utc='2026-07-25T02:30:00Z'
        WHERE tenant_id='100' AND encounter_public_id='encounter-1'
      `).run();
      await expect(project(db, {
        eventType: 'canonical.encounter.cancelled',
        occurredAtUtc: '2026-07-25T02:30:00Z',
        event: { encounterPublicId: 'encounter-1', status: 'cancelled' },
      })).resolves.toEqual({
        kind: 'encounter_cancelled',
        entityPublicId: 'encounter-1',
        encounterType: 'outpatient',
        startedAtUtc: '2026-07-25T01:00:00Z',
        cancelledAtUtc: '2026-07-25T02:30:00Z',
        sourceEvidenceSha256: 'a'.repeat(64),
      });
      await expect(project(db)).resolves.toMatchObject({ kind: 'encounter_started' });

      sqlite.prepare(`
        UPDATE canonical_service_requests
        SET fulfilled_quantity=1,status='cancelled',cancelled_at_utc='2026-07-25T01:30:00Z'
        WHERE tenant_id='100' AND request_public_id='request-1'
      `).run();
      await expect(project(db, {
        entityType: 'service_request',
        entityPublicId: 'request-1',
        eventType: 'canonical.service_request.cancelled',
        occurredAtUtc: '2026-07-25T01:30:00Z',
        event: { requestPublicId: 'request-1', status: 'cancelled', fulfilledQuantity: 1 },
      })).resolves.toEqual({
        kind: 'service_request_cancelled',
        entityPublicId: 'request-1',
        encounterPublicId: 'encounter-1',
        servicePublicId: 'service-1',
        requestedQuantity: 2,
        fulfilledQuantity: 1,
        requestedAtUtc: '2026-07-25T01:10:00Z',
        cancelledAtUtc: '2026-07-25T01:30:00Z',
        sourceEvidenceSha256: 'b'.repeat(64),
      });
      await expect(project(db, {
        entityType: 'service_request',
        entityPublicId: 'request-1',
        eventType: 'canonical.service_request.created',
        occurredAtUtc: '2026-07-25T01:10:00Z',
        event: {
          requestPublicId: 'request-1',
          servicePublicId: 'service-1',
          requestedQuantity: 2,
          status: 'active',
        },
      })).resolves.toMatchObject({ kind: 'service_request_created' });
    } finally { sqlite.close(); }
  });

  it('rejects terminal projection when source status, time, or quantity evidence conflicts', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db, {
        eventType: 'canonical.encounter.cancelled',
        occurredAtUtc: '2026-07-25T02:00:00Z',
        event: { encounterPublicId: 'encounter-1', status: 'cancelled' },
      })).rejects.toThrow(/cancellation evidence/i);
      sqlite.prepare(`
        UPDATE canonical_service_requests
        SET fulfilled_quantity=1,status='cancelled',cancelled_at_utc='2026-07-25T01:30:00Z'
      `).run();
      await expect(project(db, {
        entityType: 'service_request',
        entityPublicId: 'request-1',
        eventType: 'canonical.service_request.cancelled',
        occurredAtUtc: '2026-07-25T01:30:00Z',
        event: { requestPublicId: 'request-1', status: 'cancelled', fulfilledQuantity: 0 },
      })).rejects.toThrow(/event payload/i);
    } finally { sqlite.close(); }
  });

  it('projects service event from immutable event fact and event-time request status', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db, {
        entityType: 'service_event',
        entityPublicId: 'service-event-1',
        eventType: 'canonical.service_event.recorded',
        occurredAtUtc: '2026-07-25T01:20:00Z',
        event: {
          eventPublicId: 'service-event-1',
          requestPublicId: 'request-1',
          eventType: 'completed',
          quantity: 2,
          requestStatus: 'fulfilled',
        },
      })).resolves.toEqual({
        kind: 'service_event_recorded',
        entityPublicId: 'service-event-1',
        requestPublicId: 'request-1',
        encounterPublicId: 'encounter-1',
        servicePublicId: 'service-1',
        serviceEventType: 'completed',
        quantity: 2,
        requestStatusAfter: 'fulfilled',
        occurredAtUtc: '2026-07-25T01:20:00Z',
        sourceEvidenceSha256: 'c'.repeat(64),
      });
    } finally { sqlite.close(); }
  });

  it('projects service-event cancellation and preserves historical recorded projection', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        UPDATE canonical_service_events
        SET status='cancelled',cancelled_at_utc='2026-07-25T01:30:00Z'
        WHERE event_public_id='service-event-1';
        UPDATE canonical_service_requests
        SET fulfilled_quantity=0,last_event_public_id=NULL,status='active'
        WHERE request_public_id='request-1';
      `);
      const cancellationEvent = {
        eventPublicId: 'service-event-1',
        requestPublicId: 'request-1',
        status: 'cancelled',
        fulfilledQuantityBefore: 2,
        fulfilledQuantityAfter: 0,
        requestStatusAfter: 'active',
        previousEventPublicId: null,
      };
      await expect(project(db, {
        entityType: 'service_event',
        entityPublicId: 'service-event-1',
        eventType: 'canonical.service_event.cancelled',
        occurredAtUtc: '2026-07-25T01:30:00Z',
        event: cancellationEvent,
      })).resolves.toEqual({
        kind: 'service_event_cancelled',
        entityPublicId: 'service-event-1',
        requestPublicId: 'request-1',
        encounterPublicId: 'encounter-1',
        servicePublicId: 'service-1',
        serviceEventType: 'completed',
        quantity: 2,
        requestedQuantity: 2,
        fulfilledQuantityBefore: 2,
        fulfilledQuantityAfter: 0,
        requestStatusBefore: 'fulfilled',
        requestStatusAfter: 'active',
        previousEventPublicId: null,
        occurredAtUtc: '2026-07-25T01:20:00Z',
        cancelledAtUtc: '2026-07-25T01:30:00Z',
        sourceEvidenceSha256: 'c'.repeat(64),
      });
      await expect(project(db, {
        entityType: 'service_event',
        entityPublicId: 'service-event-1',
        eventType: 'canonical.service_event.recorded',
        occurredAtUtc: '2026-07-25T01:20:00Z',
        event: {
          eventPublicId: 'service-event-1',
          requestPublicId: 'request-1',
          eventType: 'completed',
          quantity: 2,
          requestStatus: 'fulfilled',
        },
      })).resolves.toMatchObject({ kind: 'service_event_recorded', requestStatusAfter: 'fulfilled' });

      await expect(project(db, {
        entityType: 'service_event',
        entityPublicId: 'service-event-1',
        eventType: 'canonical.service_event.cancelled',
        occurredAtUtc: '2026-07-25T01:30:00Z',
        event: { ...cancellationEvent, fulfilledQuantityAfter: 1 },
      })).rejects.toThrow(/event payload/i);
    } finally { sqlite.close(); }
  });

  it('fails closed for missing patient sync identity or compact-event mismatch', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`UPDATE patients SET sync_key=NULL WHERE id=101`).run();
      await expect(project(db)).rejects.toThrow(/patient sync identity/i);
      sqlite.prepare(`UPDATE patients SET sync_key='uhid:P-001' WHERE id=101`).run();
      await expect(project(db, {
        event: {
          encounterPublicId: 'encounter-1',
          encounterType: 'inpatient',
          status: 'in_progress',
        },
      })).rejects.toThrow(/event payload/i);
    } finally { sqlite.close(); }
  });

  it('rejects unsupported entity-event pairs with a stable projection error', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(project(db, {
        entityType: 'credit_note',
        entityPublicId: 'credit-note-1',
        eventType: 'canonical.credit_note.posted',
        event: { creditNotePublicId: 'credit-note-1' },
      })).rejects.toBeInstanceOf(CanonicalSyncBusinessProjectionError);
    } finally { sqlite.close(); }
  });
});
