import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  claimCanonicalSyncInboxEvent,
  receiveCanonicalSyncEnvelope,
} from '../../src/lib/canonical/local-sync-inbox';
import {
  completeCanonicalSyncBusinessEvent,
  prepareCanonicalSyncBusinessApplyStatements,
} from '../../src/lib/canonical/local-sync-business-apply';
import { createCanonicalSyncBusinessPayload } from '../../src/lib/canonical/local-sync-business-payload';
import { createCanonicalSyncEnvelope, type CanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-protocol';

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
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sync_key TEXT NOT NULL,
      UNIQUE (tenant_id,sync_key)
    );
    CREATE TABLE canonical_service_catalog_items (
      tenant_id TEXT NOT NULL,
      service_public_id TEXT NOT NULL,
      PRIMARY KEY (tenant_id,service_public_id)
    );
    CREATE TABLE canonical_encounters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      encounter_public_id TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL,
      encounter_type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at_utc TEXT NOT NULL,
      ended_at_utc TEXT,
      signed_snapshot_sha256 TEXT,
      signed_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id,encounter_public_id)
    );
    CREATE TABLE canonical_service_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id,request_public_id)
    );
    CREATE TABLE canonical_service_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id,event_public_id)
    );
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  sqlite.exec(`
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
    INSERT INTO canonical_service_catalog_items VALUES ('100','service-1');
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

async function businessEnvelope(input: {
  eventPublicId: string;
  entityType: string;
  entityPublicId: string;
  eventType: string;
  aggregateVersion: number;
  occurredAtUtc: string;
  event: Record<string, unknown>;
  mutation: Record<string, unknown>;
  dependencies?: CanonicalSyncEnvelope['dependencies'];
}) {
  return createCanonicalSyncEnvelope({
    tenantId: '100',
    eventPublicId: input.eventPublicId,
    entityType: input.entityType,
    entityPublicId: input.entityPublicId,
    eventType: input.eventType,
    aggregateVersion: input.aggregateVersion,
    operation: input.eventType === 'canonical.invoice.cancelled' || input.eventType === 'canonical.payment.reversed'
      ? 'tombstone'
      : 'upsert',
    occurredAtUtc: input.occurredAtUtc,
    sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({ event: input.event, mutation: input.mutation }),
    dependencies: input.dependencies ?? [],
  });
}

async function claim(db: CanonicalBatchDatabase, envelope: CanonicalSyncEnvelope, index = 1) {
  await receiveCanonicalSyncEnvelope(db, envelope, `2026-07-25T03:0${index}:00Z`);
  return claimCanonicalSyncInboxEvent(db, {
    tenantId: envelope.tenantId,
    eventPublicId: envelope.eventPublicId,
    claimPublicId: `claim-${index}`,
    claimOwnerPublicId: 'worker-offline-1',
    claimedAtUtc: `2026-07-25T03:0${index}:10Z`,
    claimExpiresAtUtc: `2026-07-25T04:0${index}:10Z`,
  });
}

function encounterStart() {
  return businessEnvelope({
    eventPublicId: 'outbox-encounter-start',
    entityType: 'encounter',
    entityPublicId: 'encounter-1',
    eventType: 'canonical.encounter.started',
    aggregateVersion: 1,
    occurredAtUtc: '2026-07-25T01:00:00Z',
    event: { encounterPublicId: 'encounter-1', encounterType: 'outpatient', status: 'in_progress' },
    mutation: {
      kind: 'encounter_started',
      entityPublicId: 'encounter-1',
      patientSyncKey: 'uhid:P-001',
      encounterType: 'outpatient',
      startedAtUtc: '2026-07-25T01:00:00Z',
      sourceEvidenceSha256: 'a'.repeat(64),
    },
  });
}

describe('canonical sync clinical business apply', () => {
  it('applies encounter start and completion with atomic inbox/entity-version receipts', async () => {
    const { sqlite, db } = harness();
    try {
      const start = await encounterStart();
      const startClaim = await claim(db, start, 1);
      await completeCanonicalSyncBusinessEvent(db, {
        envelope: start,
        claimPublicId: startClaim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:01:20Z',
      });
      expect(sqlite.prepare(`SELECT encounter_public_id,status,started_at_utc,ended_at_utc FROM canonical_encounters`).get())
        .toEqual({ encounter_public_id: 'encounter-1', status: 'in_progress', started_at_utc: '2026-07-25T01:00:00Z', ended_at_utc: null });

      const completed = await businessEnvelope({
        eventPublicId: 'outbox-encounter-complete',
        entityType: 'encounter',
        entityPublicId: 'encounter-1',
        eventType: 'canonical.encounter.completed',
        aggregateVersion: 2,
        occurredAtUtc: '2026-07-25T02:00:00Z',
        event: { encounterPublicId: 'encounter-1', status: 'completed' },
        mutation: {
          kind: 'encounter_completed',
          entityPublicId: 'encounter-1',
          encounterType: 'outpatient',
          startedAtUtc: '2026-07-25T01:00:00Z',
          completedAtUtc: '2026-07-25T02:00:00Z',
          sourceEvidenceSha256: 'a'.repeat(64),
        },
      });
      const completedClaim = await claim(db, completed, 2);
      await completeCanonicalSyncBusinessEvent(db, {
        envelope: completed,
        claimPublicId: completedClaim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:02:20Z',
      });

      expect(sqlite.prepare(`SELECT status,ended_at_utc FROM canonical_encounters WHERE encounter_public_id='encounter-1'`).get())
        .toEqual({ status: 'completed', ended_at_utc: '2026-07-25T02:00:00Z' });
      expect(sqlite.prepare(`SELECT applied_version,last_event_public_id FROM canonical_sync_entity_versions WHERE entity_type='encounter'`).get())
        .toEqual({ applied_version: 2, last_event_public_id: 'outbox-encounter-complete' });
      expect(sqlite.prepare(`SELECT status FROM canonical_sync_inbox_events WHERE event_public_id='outbox-encounter-complete'`).get())
        .toEqual({ status: 'applied' });
    } finally { sqlite.close(); }
  });

  it('applies service-request cancellation before encounter cancellation as ordered lifecycle upserts', async () => {
    const { sqlite, db } = harness();
    try {
      const start = await encounterStart();
      const startClaim = await claim(db, start, 1);
      await completeCanonicalSyncBusinessEvent(db, {
        envelope: start,
        claimPublicId: startClaim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:01:20Z',
      });

      const request = await businessEnvelope({
        eventPublicId: 'outbox-request-create',
        entityType: 'service_request',
        entityPublicId: 'request-1',
        eventType: 'canonical.service_request.created',
        aggregateVersion: 1,
        occurredAtUtc: '2026-07-25T01:10:00Z',
        event: { requestPublicId: 'request-1', servicePublicId: 'service-1', requestedQuantity: 2, status: 'active' },
        mutation: {
          kind: 'service_request_created',
          entityPublicId: 'request-1',
          patientSyncKey: 'uhid:P-001',
          encounterPublicId: 'encounter-1',
          servicePublicId: 'service-1',
          requestedQuantity: 2,
          requestedAtUtc: '2026-07-25T01:10:00Z',
          sourceEvidenceSha256: 'b'.repeat(64),
        },
      });
      const requestClaim = await claim(db, request, 2);
      await completeCanonicalSyncBusinessEvent(db, {
        envelope: request,
        claimPublicId: requestClaim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:02:20Z',
      });

      const requestCancellation = await businessEnvelope({
        eventPublicId: 'outbox-request-cancel',
        entityType: 'service_request',
        entityPublicId: 'request-1',
        eventType: 'canonical.service_request.cancelled',
        aggregateVersion: 2,
        occurredAtUtc: '2026-07-25T01:30:00Z',
        event: { requestPublicId: 'request-1', status: 'cancelled', fulfilledQuantity: 0 },
        mutation: {
          kind: 'service_request_cancelled',
          entityPublicId: 'request-1',
          encounterPublicId: 'encounter-1',
          servicePublicId: 'service-1',
          requestedQuantity: 2,
          fulfilledQuantity: 0,
          requestedAtUtc: '2026-07-25T01:10:00Z',
          cancelledAtUtc: '2026-07-25T01:30:00Z',
          sourceEvidenceSha256: 'b'.repeat(64),
        },
      });
      const requestCancelClaim = await claim(db, requestCancellation, 3);
      await completeCanonicalSyncBusinessEvent(db, {
        envelope: requestCancellation,
        claimPublicId: requestCancelClaim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:03:20Z',
      });

      const encounterCancellation = await businessEnvelope({
        eventPublicId: 'outbox-encounter-cancel',
        entityType: 'encounter',
        entityPublicId: 'encounter-1',
        eventType: 'canonical.encounter.cancelled',
        aggregateVersion: 2,
        occurredAtUtc: '2026-07-25T02:00:00Z',
        event: { encounterPublicId: 'encounter-1', status: 'cancelled' },
        mutation: {
          kind: 'encounter_cancelled',
          entityPublicId: 'encounter-1',
          encounterType: 'outpatient',
          startedAtUtc: '2026-07-25T01:00:00Z',
          cancelledAtUtc: '2026-07-25T02:00:00Z',
          sourceEvidenceSha256: 'a'.repeat(64),
        },
      });
      const encounterCancelClaim = await claim(db, encounterCancellation, 4);
      await completeCanonicalSyncBusinessEvent(db, {
        envelope: encounterCancellation,
        claimPublicId: encounterCancelClaim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:04:20Z',
      });

      expect(sqlite.prepare(`
        SELECT fulfilled_quantity,status,cancelled_at_utc
        FROM canonical_service_requests WHERE request_public_id='request-1'
      `).get()).toEqual({
        fulfilled_quantity: 0,
        status: 'cancelled',
        cancelled_at_utc: '2026-07-25T01:30:00Z',
      });
      expect(sqlite.prepare(`
        SELECT status,ended_at_utc FROM canonical_encounters WHERE encounter_public_id='encounter-1'
      `).get()).toEqual({ status: 'cancelled', ended_at_utc: '2026-07-25T02:00:00Z' });
      expect(sqlite.prepare(`
        SELECT entity_type,applied_version,last_event_public_id
        FROM canonical_sync_entity_versions
        WHERE entity_type IN ('encounter','service_request')
        ORDER BY entity_type
      `).all()).toEqual([
        { entity_type: 'encounter', applied_version: 2, last_event_public_id: 'outbox-encounter-cancel' },
        { entity_type: 'service_request', applied_version: 2, last_event_public_id: 'outbox-request-cancel' },
      ]);
    } finally { sqlite.close(); }
  });

  it('applies service request and service event in dependency order', async () => {
    const { sqlite, db } = harness();
    try {
      const start = await encounterStart();
      const startClaim = await claim(db, start, 1);
      await completeCanonicalSyncBusinessEvent(db, { envelope: start, claimPublicId: startClaim.claimPublicId, appliedAtUtc: '2026-07-25T03:01:20Z' });

      const request = await businessEnvelope({
        eventPublicId: 'outbox-request-1',
        entityType: 'service_request',
        entityPublicId: 'request-1',
        eventType: 'canonical.service_request.created',
        aggregateVersion: 1,
        occurredAtUtc: '2026-07-25T01:10:00Z',
        event: { requestPublicId: 'request-1', servicePublicId: 'service-1', requestedQuantity: 2, status: 'active' },
        mutation: {
          kind: 'service_request_created',
          entityPublicId: 'request-1',
          patientSyncKey: 'uhid:P-001',
          encounterPublicId: 'encounter-1',
          servicePublicId: 'service-1',
          requestedQuantity: 2,
          requestedAtUtc: '2026-07-25T01:10:00Z',
          sourceEvidenceSha256: 'b'.repeat(64),
        },
      });
      const requestClaim = await claim(db, request, 2);
      await completeCanonicalSyncBusinessEvent(db, { envelope: request, claimPublicId: requestClaim.claimPublicId, appliedAtUtc: '2026-07-25T03:02:20Z' });

      const serviceEvent = await businessEnvelope({
        eventPublicId: 'outbox-service-event-1',
        entityType: 'service_event',
        entityPublicId: 'service-event-1',
        eventType: 'canonical.service_event.recorded',
        aggregateVersion: 1,
        occurredAtUtc: '2026-07-25T01:20:00Z',
        event: { eventPublicId: 'service-event-1', requestPublicId: 'request-1', eventType: 'completed', quantity: 2, requestStatus: 'fulfilled' },
        mutation: {
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
        },
      });
      const eventClaim = await claim(db, serviceEvent, 3);
      await completeCanonicalSyncBusinessEvent(db, { envelope: serviceEvent, claimPublicId: eventClaim.claimPublicId, appliedAtUtc: '2026-07-25T03:03:20Z' });

      expect(sqlite.prepare(`SELECT fulfilled_quantity,status,last_event_public_id FROM canonical_service_requests WHERE request_public_id='request-1'`).get())
        .toEqual({ fulfilled_quantity: 2, status: 'fulfilled', last_event_public_id: 'service-event-1' });
      expect(sqlite.prepare(`SELECT request_public_id,event_type,quantity,status FROM canonical_service_events WHERE event_public_id='service-event-1'`).get())
        .toEqual({ request_public_id: 'request-1', event_type: 'completed', quantity: 2, status: 'posted' });

      const cancellation = await businessEnvelope({
        eventPublicId: 'outbox-service-event-cancel',
        entityType: 'service_event',
        entityPublicId: 'service-event-1',
        eventType: 'canonical.service_event.cancelled',
        aggregateVersion: 2,
        occurredAtUtc: '2026-07-25T01:30:00Z',
        event: {
          eventPublicId: 'service-event-1',requestPublicId: 'request-1',status: 'cancelled',
          fulfilledQuantityBefore: 2,fulfilledQuantityAfter: 0,
          requestStatusAfter: 'active',previousEventPublicId: null,
        },
        mutation: {
          kind: 'service_event_cancelled',entityPublicId: 'service-event-1',requestPublicId: 'request-1',
          encounterPublicId: 'encounter-1',servicePublicId: 'service-1',serviceEventType: 'completed',
          quantity: 2,requestedQuantity: 2,fulfilledQuantityBefore: 2,fulfilledQuantityAfter: 0,
          requestStatusBefore: 'fulfilled',requestStatusAfter: 'active',previousEventPublicId: null,
          occurredAtUtc: '2026-07-25T01:20:00Z',cancelledAtUtc: '2026-07-25T01:30:00Z',
          sourceEvidenceSha256: 'c'.repeat(64),
        },
      });
      const cancellationClaim = await claim(db, cancellation, 4);
      await completeCanonicalSyncBusinessEvent(db, {
        envelope: cancellation,
        claimPublicId: cancellationClaim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:04:20Z',
      });
      expect(sqlite.prepare(`
        SELECT fulfilled_quantity,status,last_event_public_id
        FROM canonical_service_requests WHERE request_public_id='request-1'
      `).get()).toEqual({ fulfilled_quantity: 0, status: 'active', last_event_public_id: null });
      expect(sqlite.prepare(`
        SELECT status,cancelled_at_utc FROM canonical_service_events WHERE event_public_id='service-event-1'
      `).get()).toEqual({ status: 'cancelled', cancelled_at_utc: '2026-07-25T01:30:00Z' });
      expect(sqlite.prepare(`
        SELECT applied_version,last_event_public_id FROM canonical_sync_entity_versions
        WHERE entity_type='service_event' AND entity_public_id='service-event-1'
      `).get()).toEqual({ applied_version: 2, last_event_public_id: 'outbox-service-event-cancel' });
    } finally { sqlite.close(); }
  });

  it('rolls back service-event cancellation when request authority is stale', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_service_requests VALUES (
          NULL,'100','request-1',101,'encounter-1','service-1',2,1,'external-event','partially_fulfilled',
          '2026-07-25T01:10:00Z',NULL,'${'b'.repeat(64)}','2026-07-25T01:10:00Z','2026-07-25T01:25:00Z'
        );
        INSERT INTO canonical_service_events VALUES (
          NULL,'100','service-event-1','request-1','encounter-1','service-1','completed',2,'posted',
          '2026-07-25T01:20:00Z',NULL,'${'c'.repeat(64)}','2026-07-25T01:20:00Z','2026-07-25T01:20:00Z'
        );
        INSERT INTO canonical_sync_entity_versions VALUES (
          '100','service_event','service-event-1',1,'outbox-service-event-1','upsert',
          '${'d'.repeat(64)}','2026-07-25T03:00:00Z'
        );
      `);
      const cancellation = await businessEnvelope({
        eventPublicId: 'outbox-service-event-cancel-stale',
        entityType: 'service_event',
        entityPublicId: 'service-event-1',
        eventType: 'canonical.service_event.cancelled',
        aggregateVersion: 2,
        occurredAtUtc: '2026-07-25T01:30:00Z',
        event: {
          eventPublicId: 'service-event-1',requestPublicId: 'request-1',status: 'cancelled',
          fulfilledQuantityBefore: 2,fulfilledQuantityAfter: 0,
          requestStatusAfter: 'active',previousEventPublicId: null,
        },
        mutation: {
          kind: 'service_event_cancelled',entityPublicId: 'service-event-1',requestPublicId: 'request-1',
          encounterPublicId: 'encounter-1',servicePublicId: 'service-1',serviceEventType: 'completed',
          quantity: 2,requestedQuantity: 2,fulfilledQuantityBefore: 2,fulfilledQuantityAfter: 0,
          requestStatusBefore: 'fulfilled',requestStatusAfter: 'active',previousEventPublicId: null,
          occurredAtUtc: '2026-07-25T01:20:00Z',cancelledAtUtc: '2026-07-25T01:30:00Z',
          sourceEvidenceSha256: 'c'.repeat(64),
        },
      });
      const receipt = await claim(db, cancellation, 5);
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope: cancellation,
        claimPublicId: receipt.claimPublicId,
        appliedAtUtc: '2026-07-25T03:05:20Z',
      })).rejects.toThrow();
      expect(sqlite.prepare(`
        SELECT fulfilled_quantity,status,last_event_public_id
        FROM canonical_service_requests WHERE request_public_id='request-1'
      `).get()).toEqual({ fulfilled_quantity: 1, status: 'partially_fulfilled', last_event_public_id: 'external-event' });
      expect(sqlite.prepare(`
        SELECT status,cancelled_at_utc FROM canonical_service_events WHERE event_public_id='service-event-1'
      `).get()).toEqual({ status: 'posted', cancelled_at_utc: null });
      expect(sqlite.prepare(`
        SELECT applied_version,last_event_public_id FROM canonical_sync_entity_versions
        WHERE entity_type='service_event' AND entity_public_id='service-event-1'
      `).get()).toEqual({ applied_version: 1, last_event_public_id: 'outbox-service-event-1' });
      expect(sqlite.prepare(`
        SELECT status FROM canonical_sync_inbox_events WHERE event_public_id='outbox-service-event-cancel-stale'
      `).get()).toEqual({ status: 'applying' });
    } finally { sqlite.close(); }
  });

  it('rolls back inbox/version/business mutations when patient identity is missing', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.prepare(`DELETE FROM patients`).run();
      const start = await encounterStart();
      const receipt = await claim(db, start, 1);
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope: start,
        claimPublicId: receipt.claimPublicId,
        appliedAtUtc: '2026-07-25T03:01:20Z',
      })).rejects.toThrow();
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_entity_versions`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT status FROM canonical_sync_inbox_events WHERE event_public_id='outbox-encounter-start'`).get())
        .toEqual({ status: 'applying' });
    } finally { sqlite.close(); }
  });

  it('rolls back stale service-event fulfillment and preserves the claim for retry handling', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_encounters VALUES (
          NULL,'100','encounter-1',101,'outpatient','in_progress','2026-07-25T01:00:00Z',NULL,NULL,NULL,
          '${'a'.repeat(64)}','2026-07-25T01:00:00Z','2026-07-25T01:00:00Z'
        );
        INSERT INTO canonical_service_requests VALUES (
          NULL,'100','request-1',101,'encounter-1','service-1',2,1,'prior-event','partially_fulfilled',
          '2026-07-25T01:10:00Z',NULL,'${'b'.repeat(64)}','2026-07-25T01:10:00Z','2026-07-25T01:15:00Z'
        );
      `);
      const serviceEvent = await businessEnvelope({
        eventPublicId: 'outbox-service-event-stale',
        entityType: 'service_event',
        entityPublicId: 'service-event-stale',
        eventType: 'canonical.service_event.recorded',
        aggregateVersion: 1,
        occurredAtUtc: '2026-07-25T01:20:00Z',
        event: { eventPublicId: 'service-event-stale', requestPublicId: 'request-1', eventType: 'completed', quantity: 2, requestStatus: 'fulfilled' },
        mutation: {
          kind: 'service_event_recorded',
          entityPublicId: 'service-event-stale',
          requestPublicId: 'request-1',
          encounterPublicId: 'encounter-1',
          servicePublicId: 'service-1',
          serviceEventType: 'completed',
          quantity: 2,
          requestStatusAfter: 'fulfilled',
          occurredAtUtc: '2026-07-25T01:20:00Z',
          sourceEvidenceSha256: 'c'.repeat(64),
        },
      });
      const receipt = await claim(db, serviceEvent, 1);
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope: serviceEvent,
        claimPublicId: receipt.claimPublicId,
        appliedAtUtc: '2026-07-25T03:01:20Z',
      })).rejects.toThrow();
      expect(sqlite.prepare(`SELECT fulfilled_quantity,last_event_public_id FROM canonical_service_requests WHERE request_public_id='request-1'`).get())
        .toEqual({ fulfilled_quantity: 1, last_event_public_id: 'prior-event' });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_service_events`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT status FROM canonical_sync_inbox_events WHERE event_public_id='outbox-service-event-stale'`).get())
        .toEqual({ status: 'applying' });
    } finally { sqlite.close(); }
  });

  it('prepares no runtime side effects and returns deterministic statement ownership', async () => {
    const { sqlite, db } = harness();
    try {
      const start = await encounterStart();
      const first = await prepareCanonicalSyncBusinessApplyStatements(db, { envelope: start, appliedAtUtc: '2026-07-25T03:01:20Z' });
      const second = await prepareCanonicalSyncBusinessApplyStatements(db, { envelope: start, appliedAtUtc: '2026-07-25T03:01:20Z' });
      expect(first.length).toBeGreaterThanOrEqual(4);
      expect(first.map((statement) => statement.sql)).toEqual(second.map((statement) => statement.sql));
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get()).toEqual({ count: 0 });
    } finally { sqlite.close(); }
  });
});
