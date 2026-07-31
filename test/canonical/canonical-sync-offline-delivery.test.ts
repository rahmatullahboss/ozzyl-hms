import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  claimCanonicalSyncInboxEvent,
  deadLetterCanonicalSyncInboxEvent,
  receiveCanonicalSyncEnvelope,
  scheduleCanonicalSyncRetry,
} from '../../src/lib/canonical/local-sync-inbox';
import { createCanonicalSyncBusinessPayload } from '../../src/lib/canonical/local-sync-business-payload';
import { createCanonicalSyncEnvelope, type CanonicalSyncEnvelope } from '../../src/lib/canonical/local-sync-protocol';
import {
  createCanonicalSyncDatabaseDeliveryPort,
  type CanonicalSyncDeliveryRequest,
} from '../../src/lib/canonical/local-sync-delivery';

const RECEIVED_AT = '2026-07-25T03:00:00Z';
const CLAIMED_AT = '2026-07-25T03:01:00Z';
const CLAIM_EXPIRES = '2026-07-25T04:00:00Z';
const APPLIED_AT = '2026-07-25T03:02:00Z';
const NEXT_ATTEMPT = '2026-07-25T03:10:00Z';
const ERROR_HASH = 'c'.repeat(64);

type RunResult = {
  success: boolean;
  meta: { changes: number; last_row_id: number; duration?: number };
};

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

  async run(): Promise<RunResult> {
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

function harness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      sync_key TEXT NOT NULL,
      UNIQUE (tenant_id,sync_key)
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
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));

  const db: CanonicalBatchDatabase = {
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
  return { sqlite, db };
}

async function encounterEnvelope(overrides: Partial<{
  eventPublicId: string;
  entityPublicId: string;
  patientSyncKey: string;
  payload: Record<string, unknown>;
}> = {}): Promise<CanonicalSyncEnvelope> {
  const entityPublicId = overrides.entityPublicId ?? 'encounter-1';
  return createCanonicalSyncEnvelope({
    tenantId: '100',
    eventPublicId: overrides.eventPublicId ?? 'outbox-encounter-start',
    entityType: 'encounter',
    entityPublicId,
    eventType: 'canonical.encounter.started',
    aggregateVersion: 1,
    operation: 'upsert',
    occurredAtUtc: '2026-07-25T01:00:00Z',
    sourceNodePublicId: 'node-local-1',
    payload: overrides.payload ?? createCanonicalSyncBusinessPayload({
      event: {
        encounterPublicId: entityPublicId,
        encounterType: 'outpatient',
        status: 'in_progress',
      },
      mutation: {
        kind: 'encounter_started',
        entityPublicId,
        patientSyncKey: overrides.patientSyncKey ?? 'uhid:P-001',
        encounterType: 'outpatient',
        startedAtUtc: '2026-07-25T01:00:00Z',
        sourceEvidenceSha256: 'a'.repeat(64),
      },
    }),
    dependencies: [],
  });
}

function request(envelope: CanonicalSyncEnvelope, overrides: Partial<CanonicalSyncDeliveryRequest> = {}): CanonicalSyncDeliveryRequest {
  return {
    envelope,
    receivedAtUtc: RECEIVED_AT,
    targetClaimPublicId: 'target-claim-1',
    targetClaimOwnerPublicId: 'target-worker-1',
    targetClaimedAtUtc: CLAIMED_AT,
    targetClaimExpiresAtUtc: CLAIM_EXPIRES,
    targetAppliedAtUtc: APPLIED_AT,
    targetNextAttemptAtUtc: NEXT_ATTEMPT,
    targetMaxAttempts: 3,
    ...overrides,
  };
}

async function preclaim(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  claimExpiresAtUtc = CLAIM_EXPIRES,
) {
  await receiveCanonicalSyncEnvelope(db, envelope, RECEIVED_AT);
  return claimCanonicalSyncInboxEvent(db, {
    tenantId: envelope.tenantId,
    eventPublicId: envelope.eventPublicId,
    claimPublicId: 'existing-target-claim',
    claimOwnerPublicId: 'existing-target-worker',
    claimedAtUtc: CLAIMED_AT,
    claimExpiresAtUtc,
  });
}

describe('canonical offline database delivery port', () => {
  it('receives, claims, applies, and replays an already-applied envelope without duplicate business rows', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await encounterEnvelope();
      const port = createCanonicalSyncDatabaseDeliveryPort(db);
      await expect(port.deliver(request(envelope))).resolves.toEqual({
        status: 'applied',
        eventPublicId: envelope.eventPublicId,
        targetAttemptCount: 1,
        replayed: false,
      });
      expect(sqlite.prepare(`SELECT encounter_public_id,status FROM canonical_encounters`).get())
        .toEqual({ encounter_public_id: 'encounter-1', status: 'in_progress' });
      expect(sqlite.prepare(`SELECT status,attempt_count FROM canonical_sync_inbox_events`).get())
        .toEqual({ status: 'applied', attempt_count: 1 });
      expect(sqlite.prepare(`SELECT applied_version FROM canonical_sync_entity_versions`).get())
        .toEqual({ applied_version: 1 });

      await expect(port.deliver(request(envelope, {
        targetClaimPublicId: 'target-claim-2',
        targetClaimedAtUtc: '2026-07-25T03:03:00Z',
        targetClaimExpiresAtUtc: '2026-07-25T04:03:00Z',
        targetAppliedAtUtc: '2026-07-25T03:04:00Z',
        targetNextAttemptAtUtc: '2026-07-25T03:20:00Z',
      }))).resolves.toEqual({
        status: 'applied',
        eventPublicId: envelope.eventPublicId,
        targetAttemptCount: 1,
        replayed: true,
      });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get()).toEqual({ count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('returns busy for an active target claim without changing ownership', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await encounterEnvelope();
      await preclaim(db, envelope);
      const port = createCanonicalSyncDatabaseDeliveryPort(db);
      const result = await port.deliver(request(envelope, {
        targetClaimedAtUtc: '2026-07-25T03:10:00Z',
        targetClaimExpiresAtUtc: '2026-07-25T04:10:00Z',
        targetAppliedAtUtc: '2026-07-25T03:11:00Z',
        targetNextAttemptAtUtc: '2026-07-25T03:20:00Z',
      }));
      expect(result).toMatchObject({
        status: 'busy',
        eventPublicId: envelope.eventPublicId,
        targetAttemptCount: 1,
        retryAtUtc: CLAIM_EXPIRES,
        errorCode: 'CANONICAL_SYNC_TARGET_BUSY',
      });
      expect(result.errorHash).toMatch(/^[a-f0-9]{64}$/);
      expect(sqlite.prepare(`SELECT claim_public_id,attempt_count FROM canonical_sync_inbox_events`).get())
        .toEqual({ claim_public_id: 'existing-target-claim', attempt_count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('returns a future target retry without claiming it', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await encounterEnvelope();
      const existing = await preclaim(db, envelope);
      await scheduleCanonicalSyncRetry(db, {
        tenantId: envelope.tenantId,
        eventPublicId: envelope.eventPublicId,
        claimPublicId: existing.claimPublicId,
        updatedAtUtc: APPLIED_AT,
        nextAttemptAtUtc: '2026-07-25T03:30:00Z',
        errorCode: 'CANONICAL_SYNC_TARGET_RETRY',
        errorHash: ERROR_HASH,
      });
      const port = createCanonicalSyncDatabaseDeliveryPort(db);
      await expect(port.deliver(request(envelope, {
        targetClaimedAtUtc: '2026-07-25T03:10:00Z',
        targetClaimExpiresAtUtc: '2026-07-25T04:10:00Z',
        targetAppliedAtUtc: '2026-07-25T03:11:00Z',
        targetNextAttemptAtUtc: '2026-07-25T03:40:00Z',
      }))).resolves.toEqual({
        status: 'retry',
        eventPublicId: envelope.eventPublicId,
        targetAttemptCount: 1,
        retryAtUtc: '2026-07-25T03:30:00Z',
        errorCode: 'CANONICAL_SYNC_TARGET_RETRY',
        errorHash: ERROR_HASH,
      });
      expect(sqlite.prepare(`SELECT status,attempt_count FROM canonical_sync_inbox_events`).get())
        .toEqual({ status: 'retry', attempt_count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('returns existing target dead-letter evidence without re-claiming', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await encounterEnvelope();
      const existing = await preclaim(db, envelope);
      await deadLetterCanonicalSyncInboxEvent(db, {
        tenantId: envelope.tenantId,
        eventPublicId: envelope.eventPublicId,
        claimPublicId: existing.claimPublicId,
        updatedAtUtc: APPLIED_AT,
        errorCode: 'CANONICAL_SYNC_TARGET_DEAD_LETTER',
        errorHash: ERROR_HASH,
      });
      const port = createCanonicalSyncDatabaseDeliveryPort(db);
      await expect(port.deliver(request(envelope))).resolves.toEqual({
        status: 'dead_letter',
        eventPublicId: envelope.eventPublicId,
        targetAttemptCount: 1,
        errorCode: 'CANONICAL_SYNC_TARGET_DEAD_LETTER',
        errorHash: ERROR_HASH,
      });
      expect(sqlite.prepare(`SELECT status,attempt_count FROM canonical_sync_inbox_events`).get())
        .toEqual({ status: 'dead_letter', attempt_count: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('schedules target retry for a retryable business apply failure below max attempts', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await encounterEnvelope({
        eventPublicId: 'outbox-missing-patient',
        entityPublicId: 'encounter-missing-patient',
        patientSyncKey: 'uhid:missing',
      });
      const result = await createCanonicalSyncDatabaseDeliveryPort(db).deliver(request(envelope));
      expect(result).toMatchObject({
        status: 'retry',
        eventPublicId: envelope.eventPublicId,
        targetAttemptCount: 1,
        retryAtUtc: NEXT_ATTEMPT,
        errorCode: 'CANONICAL_SYNC_INBOX_STATE',
      });
      expect(result.errorHash).toMatch(/^[a-f0-9]{64}$/);
      expect(sqlite.prepare(`SELECT status,attempt_count,error_code,error_hash FROM canonical_sync_inbox_events`).get())
        .toMatchObject({ status: 'retry', attempt_count: 1, error_code: 'CANONICAL_SYNC_INBOX_STATE' });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get()).toEqual({ count: 0 });
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_entity_versions`).get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it('dead-letters a retryable business apply failure on the final target attempt', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await encounterEnvelope({
        eventPublicId: 'outbox-final-missing-patient',
        entityPublicId: 'encounter-final-missing-patient',
        patientSyncKey: 'uhid:missing',
      });
      const result = await createCanonicalSyncDatabaseDeliveryPort(db).deliver(request(envelope, {
        targetMaxAttempts: 1,
      }));
      expect(result).toMatchObject({
        status: 'dead_letter',
        eventPublicId: envelope.eventPublicId,
        targetAttemptCount: 1,
        errorCode: 'CANONICAL_SYNC_INBOX_STATE',
      });
      expect(result.errorHash).toMatch(/^[a-f0-9]{64}$/);
      expect(sqlite.prepare(`SELECT status,attempt_count,error_code FROM canonical_sync_inbox_events`).get())
        .toEqual({ status: 'dead_letter', attempt_count: 1, error_code: 'CANONICAL_SYNC_INBOX_STATE' });
    } finally {
      sqlite.close();
    }
  });

  it('dead-letters an authenticated but malformed business payload immediately', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await encounterEnvelope({
        eventPublicId: 'outbox-malformed-business',
        entityPublicId: 'encounter-malformed-business',
        payload: { malformed: true },
      });
      const result = await createCanonicalSyncDatabaseDeliveryPort(db).deliver(request(envelope));
      expect(result).toMatchObject({
        status: 'dead_letter',
        eventPublicId: envelope.eventPublicId,
        targetAttemptCount: 1,
        errorCode: 'CANONICAL_SYNC_BUSINESS_PAYLOAD',
      });
      expect(result.errorHash).toMatch(/^[a-f0-9]{64}$/);
      expect(sqlite.prepare(`SELECT status,error_code FROM canonical_sync_inbox_events`).get())
        .toEqual({ status: 'dead_letter', error_code: 'CANONICAL_SYNC_BUSINESS_PAYLOAD' });
    } finally {
      sqlite.close();
    }
  });
});
