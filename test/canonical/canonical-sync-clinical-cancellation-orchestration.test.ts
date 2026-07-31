import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { cancelEncounter, startEncounter } from '../../src/lib/canonical/commands/start-encounter';
import {
  cancelServiceEvent,
  cancelServiceRequest,
  createServiceRequest,
  recordServiceEvent,
} from '../../src/lib/canonical/commands/service-operations';
import { createCanonicalSyncDatabaseDeliveryPort } from '../../src/lib/canonical/local-sync-delivery';
import { convertCanonicalOutboxEventToSyncEnvelope } from '../../src/lib/canonical/local-sync-outbox-converter';
import { runCanonicalSyncOrchestrationOnce } from '../../src/lib/canonical/local-sync-orchestrator';

const TENANT = '100';
const SOURCE_NODE = 'node-clinical-source';

class Statement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]): Statement {
    return new Statement(
      this.sqlite,
      this.sql,
      params.map((value) => value === undefined ? null : value) as SQLInputValue[],
    );
  }

  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return {
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        duration: 0,
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function database(sqlite: DatabaseSync): CanonicalBatchDatabase {
  return {
    prepare(sql: string) {
      return new Statement(sqlite, sql);
    },
    async batch(statements: CanonicalPreparedStatement[]) {
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
}

function apply(sqlite: DatabaseSync, migrations: readonly string[]): void {
  for (const migration of migrations) {
    sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  }
}

function sourceHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sync_key TEXT
    );
  `);
  apply(sqlite, [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0541_canonical_local_sync_protocol.sql',
    '0542_canonical_sync_inbox_lifecycle.sql',
    '0543_canonical_sync_outbox_lifecycle.sql',
    '0544_canonical_tenant_patient_links.sql',
    '0548_canonical_encounter_admission_bed_convergence.sql',
  ]);
  sqlite.exec(`
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
    INSERT INTO canonical_tenant_patient_links (
      tenant_id,patient_link_public_id,legacy_patient_id,link_status,
      verification_level,evidence_type,evidence_sha256,effective_from_utc,version
    ) VALUES (
      '100','ptl-101',101,'unlinked','unverified','no_link_placeholder',
      '${'9'.repeat(64)}','2026-07-25T00:00:00.000Z',1
    );
    INSERT INTO canonical_practitioners (
      tenant_id,practitioner_public_id,practitioner_kind,display_name,status
    ) VALUES ('100','practitioner-1','internal','Synthetic Practitioner','active');
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,canonical_code,display_name,
      unit_code,status,source_evidence_sha256
    ) VALUES (
      '100','service-1','laboratory','LAB-1','Synthetic Lab','service','active',
      '${'b'.repeat(64)}'
    );
  `);
  return { sqlite, db: database(sqlite) };
}

function targetHarness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sync_key TEXT NOT NULL,
      UNIQUE (tenant_id,sync_key)
    );
  `);
  apply(sqlite, [
    '0505_canonical_program_foundation.sql',
    '0506_canonical_practitioners.sql',
    '0507_canonical_encounters.sql',
    '0508_canonical_service_catalog.sql',
    '0509_canonical_service_requests_events.sql',
    '0541_canonical_local_sync_protocol.sql',
    '0542_canonical_sync_inbox_lifecycle.sql',
    '0544_canonical_tenant_patient_links.sql',
    '0548_canonical_encounter_admission_bed_convergence.sql',
  ]);
  sqlite.exec(`
    INSERT INTO patients VALUES (201,'100','uhid:P-001');
    INSERT INTO canonical_service_catalog_items (
      tenant_id,service_public_id,item_kind,canonical_code,display_name,
      unit_code,status,source_evidence_sha256
    ) VALUES (
      '100','service-1','laboratory','LAB-1','Synthetic Lab','service','active',
      '${'b'.repeat(64)}'
    );
  `);
  return { sqlite, db: database(sqlite) };
}

function orchestration(index: number) {
  const minute = index * 10;
  const timestamp = (offset: number) => `2099-01-01T00:${String(minute + offset).padStart(2, '0')}:00Z`;
  return {
    tenantId: TENANT,
    sourceNodePublicId: SOURCE_NODE,
    sourceClaimOwnerPublicId: 'source-worker-clinical',
    targetClaimOwnerPublicId: 'target-worker-clinical',
    sourceMaxAttempts: 3,
    targetMaxAttempts: 3,
    timeline: {
      sourceClaimedAtUtc: timestamp(0),
      sourceClaimExpiresAtUtc: timestamp(8),
      targetReceivedAtUtc: timestamp(1),
      targetClaimedAtUtc: timestamp(2),
      targetClaimExpiresAtUtc: timestamp(7),
      targetAppliedAtUtc: timestamp(3),
      sourcePublishedAtUtc: timestamp(4),
      sourceNextAttemptAtUtc: timestamp(5),
      targetNextAttemptAtUtc: timestamp(6),
    },
  };
}

describe('canonical clinical cancellation offline orchestration', () => {
  it('publishes request cancellation before encounter cancellation and converges replay-safely', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    const delivery = createCanonicalSyncDatabaseDeliveryPort(target.db);
    try {
      await startEncounter(source.db, {
        tenantId: TENANT,
        encounterPublicId: 'encounter-1',
        legacyPatientId: 101,
        patientLinkPublicId: 'ptl-101',
        encounterType: 'outpatient',
        startedAtUtc: '2026-07-25T09:00:00.000Z',
        practitionerPublicId: 'practitioner-1',
        participantRole: 'treating',
        sourceType: 'runtime_visit',
        sourcePublicId: 'visit-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'a'.repeat(64),
        idempotencyKey: 'start-encounter-1',
        eventPublicId: 'outbox-encounter-start',
        businessDate: '2026-07-25',
      });
      await createServiceRequest(source.db, {
        tenantId: TENANT,
        requestPublicId: 'request-1',
        legacyPatientId: 101,
        encounterPublicId: 'encounter-1',
        servicePublicId: 'service-1',
        requestedQuantity: 2,
        requestedAtUtc: '2026-07-25T09:10:00.000Z',
        participant: {
          practitionerPublicId: 'practitioner-1',
          role: 'ordering',
          evidenceType: 'approved_manual',
        },
        sourceType: 'runtime_lab_request',
        sourcePublicId: 'request-source-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'c'.repeat(64),
        idempotencyKey: 'create-request-1',
        outboxEventPublicId: 'outbox-request-create',
        businessDate: '2026-07-25',
      });

      await expect(cancelEncounter(source.db, {
        tenantId: TENANT,
        encounterPublicId: 'encounter-1',
        expectedVersion: 1,
        cancelledAtUtc: '2026-07-25T09:30:00.000Z',
        sourceEvidenceSha256: 'd'.repeat(64),
        idempotencyKey: 'cancel-encounter-blocked',
        eventPublicId: 'outbox-encounter-cancel-blocked',
        businessDate: '2026-07-25',
      })).rejects.toThrow(/active service request/i);

      const requestCancellationInput = {
        tenantId: TENANT,
        requestPublicId: 'request-1',
        cancelledAtUtc: '2026-07-25T09:20:00.000Z',
        idempotencyKey: 'cancel-request-1',
        outboxEventPublicId: 'outbox-request-cancel',
        businessDate: '2026-07-25',
      } as const;
      const encounterCancellationInput = {
        tenantId: TENANT,
        encounterPublicId: 'encounter-1',
        expectedVersion: 1,
        cancelledAtUtc: '2026-07-25T09:30:00.000Z',
        sourceEvidenceSha256: 'd'.repeat(64),
        idempotencyKey: 'cancel-encounter-1',
        eventPublicId: 'outbox-encounter-cancel',
        businessDate: '2026-07-25',
      } as const;
      await cancelServiceRequest(source.db, requestCancellationInput);
      await cancelEncounter(source.db, encounterCancellationInput);

      expect(source.sqlite.prepare(`
        SELECT event_public_id,event_type FROM canonical_outbox_events ORDER BY id
      `).all()).toEqual([
        { event_public_id: 'outbox-encounter-start', event_type: 'canonical.encounter.started' },
        { event_public_id: 'outbox-request-create', event_type: 'canonical.service_request.created' },
        { event_public_id: 'outbox-request-cancel', event_type: 'canonical.service_request.cancelled' },
        { event_public_id: 'outbox-encounter-cancel', event_type: 'canonical.encounter.cancelled' },
      ]);

      const results = [];
      for (let index = 0; index < 4; index += 1) {
        results.push(await runCanonicalSyncOrchestrationOnce(
          source.db,
          delivery,
          orchestration(index),
        ));
      }
      expect(results.map((result) => [result.status, result.status === 'idle' ? null : result.eventPublicId]))
        .toEqual([
          ['published', 'outbox-encounter-start'],
          ['published', 'outbox-request-create'],
          ['published', 'outbox-request-cancel'],
          ['published', 'outbox-encounter-cancel'],
        ]);
      await expect(runCanonicalSyncOrchestrationOnce(source.db, delivery, orchestration(4)))
        .resolves.toEqual({ status: 'idle' });

      expect(target.sqlite.prepare(`
        SELECT status,ended_at_utc FROM canonical_encounters WHERE encounter_public_id='encounter-1'
      `).get()).toEqual({ status: 'cancelled', ended_at_utc: '2026-07-25T09:30:00.000Z' });
      expect(target.sqlite.prepare(`
        SELECT requested_quantity,fulfilled_quantity,status,cancelled_at_utc
        FROM canonical_service_requests WHERE request_public_id='request-1'
      `).get()).toEqual({
        requested_quantity: 2,
        fulfilled_quantity: 0,
        status: 'cancelled',
        cancelled_at_utc: '2026-07-25T09:20:00.000Z',
      });
      expect(target.sqlite.prepare(`
        SELECT entity_type,applied_version,last_event_public_id
        FROM canonical_sync_entity_versions
        WHERE entity_type IN ('encounter','service_request')
        ORDER BY entity_type
      `).all()).toEqual([
        { entity_type: 'encounter', applied_version: 2, last_event_public_id: 'outbox-encounter-cancel' },
        { entity_type: 'service_request', applied_version: 2, last_event_public_id: 'outbox-request-cancel' },
      ]);

      await expect(cancelServiceRequest(source.db, requestCancellationInput))
        .resolves.toMatchObject({ status: 'replayed' });
      await expect(cancelEncounter(source.db, encounterCancellationInput))
        .resolves.toMatchObject({ status: 'replayed' });
      expect(source.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_outbox_events`).get())
        .toEqual({ count: 4 });

      for (const [index, eventPublicId] of ['outbox-request-cancel', 'outbox-encounter-cancel'].entries()) {
        const envelope = await convertCanonicalOutboxEventToSyncEnvelope(source.db, {
          tenantId: TENANT,
          eventPublicId,
          sourceNodePublicId: SOURCE_NODE,
        });
        await expect(delivery.deliver({
          envelope,
          receivedAtUtc: `2099-01-01T02:0${index}:00Z`,
          targetClaimPublicId: `replay-claim-${index + 1}`,
          targetClaimOwnerPublicId: 'target-worker-clinical',
          targetClaimedAtUtc: `2099-01-01T02:0${index}:10Z`,
          targetClaimExpiresAtUtc: `2099-01-01T02:1${index}:10Z`,
          targetAppliedAtUtc: `2099-01-01T02:0${index}:20Z`,
          targetNextAttemptAtUtc: `2099-01-01T02:2${index}:00Z`,
          targetMaxAttempts: 3,
        })).resolves.toMatchObject({ status: 'applied', replayed: true });
      }
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 4 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get())
        .toEqual({ count: 1 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_service_requests`).get())
        .toEqual({ count: 1 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('converges service-event cancellation and replays source and target delivery exactly', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    const delivery = createCanonicalSyncDatabaseDeliveryPort(target.db);
    try {
      await startEncounter(source.db, {
        tenantId: TENANT,
        encounterPublicId: 'encounter-event-1',
        legacyPatientId: 101,
        patientLinkPublicId: 'ptl-101',
        encounterType: 'outpatient',
        startedAtUtc: '2026-07-25T10:00:00.000Z',
        practitionerPublicId: 'practitioner-1',
        participantRole: 'treating',
        sourceType: 'runtime_visit',
        sourcePublicId: 'visit-event-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'e'.repeat(64),
        idempotencyKey: 'start-encounter-event-1',
        eventPublicId: 'outbox-encounter-event-start',
        businessDate: '2026-07-25',
      });
      await createServiceRequest(source.db, {
        tenantId: TENANT,
        requestPublicId: 'request-event-1',
        legacyPatientId: 101,
        encounterPublicId: 'encounter-event-1',
        servicePublicId: 'service-1',
        requestedQuantity: 2,
        requestedAtUtc: '2026-07-25T10:10:00.000Z',
        participant: {
          practitionerPublicId: 'practitioner-1',
          role: 'ordering',
          evidenceType: 'approved_manual',
        },
        sourceType: 'runtime_lab_request',
        sourcePublicId: 'request-event-source-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: 'f'.repeat(64),
        idempotencyKey: 'create-request-event-1',
        outboxEventPublicId: 'outbox-request-event-create',
        businessDate: '2026-07-25',
      });
      await recordServiceEvent(source.db, {
        tenantId: TENANT,
        requestPublicId: 'request-event-1',
        eventPublicId: 'service-event-1',
        eventType: 'completed',
        quantity: 2,
        occurredAtUtc: '2026-07-25T10:20:00.000Z',
        participant: {
          practitionerPublicId: 'practitioner-1',
          role: 'performing',
          evidenceType: 'approved_manual',
        },
        sourceType: 'runtime_lab_result',
        sourcePublicId: 'service-event-source-1',
        sourceTable: 'runtime',
        sourceEvidenceSha256: '1'.repeat(64),
        idempotencyKey: 'record-service-event-1',
        outboxEventPublicId: 'outbox-service-event-record',
        businessDate: '2026-07-25',
      });
      const cancellationInput = {
        tenantId: TENANT,
        eventPublicId: 'service-event-1',
        cancelledAtUtc: '2026-07-25T10:30:00.000Z',
        idempotencyKey: 'cancel-service-event-1',
        outboxEventPublicId: 'outbox-service-event-cancel',
        businessDate: '2026-07-25',
      } as const;
      await cancelServiceEvent(source.db, cancellationInput);

      expect(source.sqlite.prepare(`
        SELECT event_public_id,event_type FROM canonical_outbox_events ORDER BY id
      `).all()).toEqual([
        { event_public_id: 'outbox-encounter-event-start', event_type: 'canonical.encounter.started' },
        { event_public_id: 'outbox-request-event-create', event_type: 'canonical.service_request.created' },
        { event_public_id: 'outbox-service-event-record', event_type: 'canonical.service_event.recorded' },
        { event_public_id: 'outbox-service-event-cancel', event_type: 'canonical.service_event.cancelled' },
      ]);

      const results = [];
      for (let index = 0; index < 4; index += 1) {
        results.push(await runCanonicalSyncOrchestrationOnce(
          source.db,
          delivery,
          orchestration(index),
        ));
      }
      expect(results.map((result) => [result.status, result.status === 'idle' ? null : result.eventPublicId]))
        .toEqual([
          ['published', 'outbox-encounter-event-start'],
          ['published', 'outbox-request-event-create'],
          ['published', 'outbox-service-event-record'],
          ['published', 'outbox-service-event-cancel'],
        ]);
      await expect(runCanonicalSyncOrchestrationOnce(source.db, delivery, orchestration(4)))
        .resolves.toEqual({ status: 'idle' });

      expect(target.sqlite.prepare(`
        SELECT fulfilled_quantity,status,last_event_public_id
        FROM canonical_service_requests WHERE request_public_id='request-event-1'
      `).get()).toEqual({ fulfilled_quantity: 0, status: 'active', last_event_public_id: null });
      expect(target.sqlite.prepare(`
        SELECT status,cancelled_at_utc,event_type,quantity
        FROM canonical_service_events WHERE event_public_id='service-event-1'
      `).get()).toEqual({
        status: 'cancelled',
        cancelled_at_utc: '2026-07-25T10:30:00.000Z',
        event_type: 'completed',
        quantity: 2,
      });
      expect(target.sqlite.prepare(`
        SELECT entity_type,applied_version,last_event_public_id
        FROM canonical_sync_entity_versions
        WHERE entity_type IN ('encounter','service_request','service_event')
        ORDER BY entity_type
      `).all()).toEqual([
        { entity_type: 'encounter', applied_version: 1, last_event_public_id: 'outbox-encounter-event-start' },
        { entity_type: 'service_event', applied_version: 2, last_event_public_id: 'outbox-service-event-cancel' },
        { entity_type: 'service_request', applied_version: 1, last_event_public_id: 'outbox-request-event-create' },
      ]);

      await expect(cancelServiceEvent(source.db, cancellationInput))
        .resolves.toMatchObject({ status: 'replayed' });
      expect(source.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_outbox_events`).get())
        .toEqual({ count: 4 });

      const cancellationEnvelope = await convertCanonicalOutboxEventToSyncEnvelope(source.db, {
        tenantId: TENANT,
        eventPublicId: 'outbox-service-event-cancel',
        sourceNodePublicId: SOURCE_NODE,
      });
      await expect(delivery.deliver({
        envelope: cancellationEnvelope,
        receivedAtUtc: '2099-01-01T02:30:00Z',
        targetClaimPublicId: 'replay-service-event-cancel',
        targetClaimOwnerPublicId: 'target-worker-clinical',
        targetClaimedAtUtc: '2099-01-01T02:30:10Z',
        targetClaimExpiresAtUtc: '2099-01-01T02:40:10Z',
        targetAppliedAtUtc: '2099-01-01T02:30:20Z',
        targetNextAttemptAtUtc: '2099-01-01T02:50:00Z',
        targetMaxAttempts: 3,
      })).resolves.toMatchObject({ status: 'applied', replayed: true });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_service_events`).get())
        .toEqual({ count: 1 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 4 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });
});
