import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import {
  CanonicalSyncOutboxPublicationConflictError,
  CanonicalSyncOutboxStateError,
  claimNextCanonicalSyncOutboxEnvelope,
  completeCanonicalSyncOutboxPublication,
  deadLetterCanonicalSyncOutboxPublication,
  failCanonicalSyncOutboxPublication,
  recoverExpiredCanonicalSyncOutboxLease,
} from '../../src/lib/canonical/local-sync-outbox-lifecycle';
import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';

const TENANT = '100';
const NOW = '2026-07-25T10:00:00Z';
const CLAIM_EXPIRES = '2026-07-25T10:05:00Z';
const SOURCE_NODE = 'node-local-1';
const HASH = 'a'.repeat(64);

type RunResult = {
  success: boolean;
  meta: { changes: number; last_row_id: number; duration: number };
};

class SqliteStatement implements CanonicalPreparedStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    readonly sql: string,
    readonly params: SQLInputValue[] = [],
  ) {}

  bind(...params: unknown[]): SqliteStatement {
    return new SqliteStatement(
      this.sqlite,
      this.sql,
      params.map((value) => (value === undefined ? null : value)) as SQLInputValue[],
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
    CREATE TABLE canonical_outbox_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      event_public_id TEXT NOT NULL,
      aggregate_type TEXT NOT NULL,
      aggregate_public_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_version INTEGER NOT NULL DEFAULT 1,
      payload_json TEXT NOT NULL,
      occurred_at_utc TEXT NOT NULL,
      business_date TEXT,
      idempotency_key TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      available_at_utc TEXT NOT NULL,
      processing_attempts INTEGER NOT NULL DEFAULT 0,
      locked_at_utc TEXT,
      locked_by TEXT,
      published_at_utc TEXT,
      last_error_code TEXT,
      last_error_summary TEXT,
      created_at_utc TEXT NOT NULL,
      updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id,event_public_id),
      UNIQUE (tenant_id,idempotency_key)
    );
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
    INSERT INTO patients VALUES (101,'100','uhid:P-001');
    INSERT INTO canonical_encounters VALUES (
      '100','encounter-1',101,'outpatient','in_progress','${NOW}',NULL,'${HASH}'
    );
    INSERT INTO canonical_encounters VALUES (
      '100','encounter-2',101,'outpatient','in_progress','${NOW}',NULL,'${HASH}'
    );
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0543_canonical_sync_outbox_lifecycle.sql', 'utf8'));

  const db: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return new SqliteStatement(sqlite, sql);
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

function insertEncounterEvent(
  sqlite: DatabaseSync,
  overrides: Partial<{
    eventPublicId: string;
    aggregatePublicId: string;
    aggregateType: string;
    eventType: string;
    payloadJson: string;
    status: string;
    availableAtUtc: string;
    processingAttempts: number;
    claimPublicId: string | null;
    lockedAtUtc: string | null;
    lockedBy: string | null;
    claimExpiresAtUtc: string | null;
    lastErrorCode: string | null;
    lastErrorSummary: string | null;
    lastErrorSha256: string | null;
    updatedAtUtc: string;
  }> = {},
): void {
  const aggregatePublicId = overrides.aggregatePublicId ?? 'encounter-1';
  const eventPublicId = overrides.eventPublicId ?? `outbox-${aggregatePublicId}`;
  const status = overrides.status ?? 'pending';
  sqlite.prepare(`
    INSERT INTO canonical_outbox_events (
      tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,event_version,
      payload_json,occurred_at_utc,business_date,idempotency_key,status,available_at_utc,
      processing_attempts,claim_public_id,locked_at_utc,locked_by,claim_expires_at_utc,
      last_error_code,last_error_summary,last_error_sha256,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    TENANT,
    eventPublicId,
    overrides.aggregateType ?? 'canonical_encounter',
    aggregatePublicId,
    overrides.eventType ?? 'canonical.encounter.started',
    overrides.payloadJson ?? stableCanonicalJson({
      encounterPublicId: aggregatePublicId,
      encounterType: 'outpatient',
      status: 'in_progress',
    }),
    NOW,
    '2026-07-25',
    `idem-${eventPublicId}`,
    status,
    overrides.availableAtUtc ?? NOW,
    overrides.processingAttempts ?? 0,
    overrides.claimPublicId ?? null,
    overrides.lockedAtUtc ?? null,
    overrides.lockedBy ?? null,
    overrides.claimExpiresAtUtc ?? null,
    overrides.lastErrorCode ?? null,
    overrides.lastErrorSummary ?? null,
    overrides.lastErrorSha256 ?? null,
    NOW,
    overrides.updatedAtUtc ?? NOW,
  );
}

function claimInput(overrides: Partial<Parameters<typeof claimNextCanonicalSyncOutboxEnvelope>[1]> = {}) {
  return {
    tenantId: TENANT,
    sourceNodePublicId: SOURCE_NODE,
    claimPublicId: 'claim-1',
    claimOwnerPublicId: 'worker-1',
    claimedAtUtc: NOW,
    claimExpiresAtUtc: CLAIM_EXPIRES,
    maxAttempts: 3,
    ...overrides,
  };
}

describe('canonical sync source outbox claim lifecycle', () => {
  it('converts and claims the first pending allowlisted event', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      expect(receipt).toMatchObject({
        tenantId: TENANT,
        eventPublicId: 'outbox-encounter-1',
        claimPublicId: 'claim-1',
        claimOwnerPublicId: 'worker-1',
        claimExpiresAtUtc: CLAIM_EXPIRES,
        attemptCount: 1,
        envelope: {
          eventPublicId: 'outbox-encounter-1',
          sourceNodePublicId: SOURCE_NODE,
          entityPublicId: 'encounter-1',
        },
      });
      expect(receipt.envelopeSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(sqlite.prepare(`
        SELECT status,processing_attempts,claim_public_id,locked_by,claim_expires_at_utc
        FROM canonical_outbox_events WHERE event_public_id='outbox-encounter-1'
      `).get()).toEqual({
        status: 'processing',
        processing_attempts: 1,
        claim_public_id: 'claim-1',
        locked_by: 'worker-1',
        claim_expires_at_utc: CLAIM_EXPIRES,
      });
    } finally {
      sqlite.close();
    }
  });

  it('skips unsupported events and claims an unrelated allowlisted aggregate', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite, {
        eventPublicId: 'unsupported-1',
        aggregatePublicId: 'unsupported-aggregate',
        aggregateType: 'unsupported_type',
        eventType: 'unsupported.event',
        payloadJson: '{}',
      });
      insertEncounterEvent(sqlite, { eventPublicId: 'outbox-encounter-2', aggregatePublicId: 'encounter-2' });
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      expect(receipt.eventPublicId).toBe('outbox-encounter-2');
      expect(sqlite.prepare(`SELECT status FROM canonical_outbox_events WHERE event_public_id='unsupported-1'`).get())
        .toEqual({ status: 'pending' });
    } finally {
      sqlite.close();
    }
  });

  it('blocks a later event for the same aggregate until its predecessor is published', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite, { eventPublicId: 'encounter-1-v1' });
      insertEncounterEvent(sqlite, { eventPublicId: 'encounter-1-v2' });
      const first = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      expect(first.eventPublicId).toBe('encounter-1-v1');
      await expect(claimNextCanonicalSyncOutboxEnvelope(db, claimInput({ claimPublicId: 'claim-2' })))
        .rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      expect(sqlite.prepare(`SELECT status FROM canonical_outbox_events WHERE event_public_id='encounter-1-v2'`).get())
        .toEqual({ status: 'pending' });
    } finally {
      sqlite.close();
    }
  });

  it('claims due retry but not a future retry', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite, {
        eventPublicId: 'future-retry',
        status: 'retry',
        availableAtUtc: '2026-07-25T10:30:00Z',
        processingAttempts: 1,
        lastErrorCode: 'SYNC_FAILED',
        lastErrorSha256: HASH,
      });
      insertEncounterEvent(sqlite, {
        eventPublicId: 'due-retry',
        aggregatePublicId: 'encounter-2',
        status: 'retry',
        availableAtUtc: '2026-07-25T09:59:00Z',
        processingAttempts: 1,
        lastErrorCode: 'SYNC_FAILED',
        lastErrorSha256: HASH,
        updatedAtUtc: '2026-07-25T09:50:00Z',
      });
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      expect(receipt.eventPublicId).toBe('due-retry');
      expect(receipt.attemptCount).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('reclaims an expired processing lease and rejects an active lease', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite, {
        eventPublicId: 'active-lease',
        status: 'processing',
        processingAttempts: 1,
        claimPublicId: 'old-active-claim',
        lockedAtUtc: '2026-07-25T09:59:00Z',
        lockedBy: 'worker-old',
        claimExpiresAtUtc: '2026-07-25T10:30:00Z',
      });
      insertEncounterEvent(sqlite, {
        eventPublicId: 'expired-lease',
        aggregatePublicId: 'encounter-2',
        status: 'processing',
        processingAttempts: 1,
        claimPublicId: 'old-expired-claim',
        lockedAtUtc: '2026-07-25T09:50:00Z',
        lockedBy: 'worker-old',
        claimExpiresAtUtc: '2026-07-25T09:59:00Z',
      });
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      expect(receipt.eventPublicId).toBe('expired-lease');
      expect(receipt.attemptCount).toBe(2);
      expect(sqlite.prepare(`SELECT claim_public_id FROM canonical_outbox_events WHERE event_public_id='active-lease'`).get())
        .toEqual({ claim_public_id: 'old-active-claim' });
    } finally {
      sqlite.close();
    }
  });

  it('leaves the source row untouched when conversion fails', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite, {
        payloadJson: stableCanonicalJson({
          encounterPublicId: 'wrong-encounter',
          encounterType: 'outpatient',
          status: 'in_progress',
        }),
      });
      await expect(claimNextCanonicalSyncOutboxEnvelope(db, claimInput())).rejects.toThrow(/identity mismatch/i);
      expect(sqlite.prepare(`
        SELECT status,processing_attempts,claim_public_id FROM canonical_outbox_events
        WHERE event_public_id='outbox-encounter-1'
      `).get()).toEqual({ status: 'pending', processing_attempts: 0, claim_public_id: null });
    } finally {
      sqlite.close();
    }
  });

  it('rejects a second claim while the first lease is active without mutating attempts', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      await expect(claimNextCanonicalSyncOutboxEnvelope(db, claimInput({ claimPublicId: 'claim-2' })))
        .rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      expect(sqlite.prepare(`SELECT processing_attempts,claim_public_id FROM canonical_outbox_events`).get())
        .toEqual({ processing_attempts: 1, claim_public_id: 'claim-1' });
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical sync source outbox publication acknowledgement', () => {
  it('publishes only the exact authenticated claimed envelope', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      await completeCanonicalSyncOutboxPublication(db, {
        receipt,
        sourceNodePublicId: SOURCE_NODE,
        envelope: receipt.envelope,
        publishedAtUtc: '2026-07-25T10:01:00Z',
      });
      expect(sqlite.prepare(`
        SELECT status,published_at_utc,published_envelope_sha256,claim_public_id,
               claim_expires_at_utc,locked_at_utc,locked_by,last_error_code,last_error_sha256
        FROM canonical_outbox_events WHERE event_public_id='outbox-encounter-1'
      `).get()).toEqual({
        status: 'published',
        published_at_utc: '2026-07-25T10:01:00Z',
        published_envelope_sha256: receipt.envelopeSha256,
        claim_public_id: null,
        claim_expires_at_utc: null,
        locked_at_utc: null,
        locked_by: null,
        last_error_code: null,
        last_error_sha256: null,
      });
    } finally {
      sqlite.close();
    }
  });

  it('rejects tampered publication envelope and leaves the claim active', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      const tampered = structuredClone(receipt.envelope);
      tampered.entityPublicId = 'encounter-tampered';
      await expect(completeCanonicalSyncOutboxPublication(db, {
        receipt,
        sourceNodePublicId: SOURCE_NODE,
        envelope: tampered,
        publishedAtUtc: '2026-07-25T10:01:00Z',
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxPublicationConflictError);
      expect(sqlite.prepare(`
        SELECT status,claim_public_id,published_at_utc FROM canonical_outbox_events
        WHERE event_public_id='outbox-encounter-1'
      `).get()).toEqual({ status: 'processing', claim_public_id: 'claim-1', published_at_utc: null });
    } finally {
      sqlite.close();
    }
  });

  it('rejects stale receipt ownership or attempt evidence', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      await expect(completeCanonicalSyncOutboxPublication(db, {
        receipt: { ...receipt, claimPublicId: 'claim-stale' },
        sourceNodePublicId: SOURCE_NODE,
        envelope: receipt.envelope,
        publishedAtUtc: '2026-07-25T10:01:00Z',
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      await expect(completeCanonicalSyncOutboxPublication(db, {
        receipt: { ...receipt, attemptCount: 2 },
        sourceNodePublicId: SOURCE_NODE,
        envelope: receipt.envelope,
        publishedAtUtc: '2026-07-25T10:01:00Z',
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      expect(sqlite.prepare(`SELECT status,processing_attempts FROM canonical_outbox_events`).get())
        .toEqual({ status: 'processing', processing_attempts: 1 });
    } finally {
      sqlite.close();
    }
  });

  it('rejects publication after the claim lease expires and rejects replay', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      await expect(completeCanonicalSyncOutboxPublication(db, {
        receipt,
        sourceNodePublicId: SOURCE_NODE,
        envelope: receipt.envelope,
        publishedAtUtc: '2026-07-25T10:06:00Z',
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      await completeCanonicalSyncOutboxPublication(db, {
        receipt,
        sourceNodePublicId: SOURCE_NODE,
        envelope: receipt.envelope,
        publishedAtUtc: '2026-07-25T10:01:00Z',
      });
      await expect(completeCanonicalSyncOutboxPublication(db, {
        receipt,
        sourceNodePublicId: SOURCE_NODE,
        envelope: receipt.envelope,
        publishedAtUtc: '2026-07-25T10:02:00Z',
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical sync source outbox failure and lease recovery', () => {
  it('schedules retry below max attempts and clears the active claim', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      await expect(failCanonicalSyncOutboxPublication(db, {
        receipt,
        failedAtUtc: '2026-07-25T10:01:00Z',
        nextAttemptAtUtc: '2026-07-25T10:10:00Z',
        maxAttempts: 3,
        errorCode: 'SYNC_DELIVERY_FAILED',
        errorSha256: HASH,
        errorSummary: 'delivery failed',
      })).resolves.toBe('retry');
      expect(sqlite.prepare(`
        SELECT status,available_at_utc,claim_public_id,locked_by,last_error_code,
               last_error_summary,last_error_sha256
        FROM canonical_outbox_events WHERE event_public_id='outbox-encounter-1'
      `).get()).toEqual({
        status: 'retry',
        available_at_utc: '2026-07-25T10:10:00Z',
        claim_public_id: null,
        locked_by: null,
        last_error_code: 'SYNC_DELIVERY_FAILED',
        last_error_summary: 'delivery failed',
        last_error_sha256: HASH,
      });
    } finally {
      sqlite.close();
    }
  });

  it('dead-letters at the maximum attempt and blocks later same-aggregate events', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite, { eventPublicId: 'encounter-1-v1' });
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput({ maxAttempts: 1 }));
      await expect(failCanonicalSyncOutboxPublication(db, {
        receipt,
        failedAtUtc: '2026-07-25T10:01:00Z',
        nextAttemptAtUtc: '2026-07-25T10:10:00Z',
        maxAttempts: 1,
        errorCode: 'SYNC_DELIVERY_FAILED',
        errorSha256: HASH,
      })).resolves.toBe('dead_letter');
      insertEncounterEvent(sqlite, { eventPublicId: 'encounter-1-v2' });
      insertEncounterEvent(sqlite, { eventPublicId: 'encounter-2-v1', aggregatePublicId: 'encounter-2' });
      const unrelated = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput({ claimPublicId: 'claim-2' }));
      expect(unrelated.eventPublicId).toBe('encounter-2-v1');
      expect(sqlite.prepare(`SELECT status FROM canonical_outbox_events WHERE event_public_id='encounter-1-v2'`).get())
        .toEqual({ status: 'pending' });
    } finally {
      sqlite.close();
    }
  });

  it('rejects failure transition from stale or expired ownership', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      await expect(failCanonicalSyncOutboxPublication(db, {
        receipt: { ...receipt, claimOwnerPublicId: 'worker-stale' },
        failedAtUtc: '2026-07-25T10:01:00Z',
        nextAttemptAtUtc: '2026-07-25T10:10:00Z',
        maxAttempts: 3,
        errorCode: 'SYNC_DELIVERY_FAILED',
        errorSha256: HASH,
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      await expect(failCanonicalSyncOutboxPublication(db, {
        receipt,
        failedAtUtc: '2026-07-25T10:06:00Z',
        nextAttemptAtUtc: '2026-07-25T10:10:00Z',
        maxAttempts: 3,
        errorCode: 'SYNC_DELIVERY_FAILED',
        errorSha256: HASH,
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      expect(sqlite.prepare(`SELECT status,claim_public_id FROM canonical_outbox_events`).get())
        .toEqual({ status: 'processing', claim_public_id: 'claim-1' });
    } finally {
      sqlite.close();
    }
  });

  it('recovers an expired lease to immediately due retry below max attempts', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite, {
        status: 'processing',
        processingAttempts: 1,
        claimPublicId: 'old-claim',
        lockedAtUtc: '2026-07-25T09:50:00Z',
        lockedBy: 'worker-old',
        claimExpiresAtUtc: '2026-07-25T09:59:00Z',
      });
      await expect(recoverExpiredCanonicalSyncOutboxLease(db, {
        tenantId: TENANT,
        eventPublicId: 'outbox-encounter-1',
        recoveredAtUtc: NOW,
        maxAttempts: 3,
        errorCode: 'SYNC_LEASE_EXPIRED',
        errorSha256: HASH,
        errorSummary: 'claim lease expired',
      })).resolves.toBe('retry');
      expect(sqlite.prepare(`
        SELECT status,available_at_utc,claim_public_id,last_error_code
        FROM canonical_outbox_events
      `).get()).toEqual({
        status: 'retry',
        available_at_utc: NOW,
        claim_public_id: null,
        last_error_code: 'SYNC_LEASE_EXPIRED',
      });
      const reclaimed = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput({ claimPublicId: 'claim-new' }));
      expect(reclaimed.attemptCount).toBe(2);
    } finally {
      sqlite.close();
    }
  });

  it('dead-letters an expired final-attempt lease and rejects active lease recovery', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite, {
        eventPublicId: 'expired-final',
        status: 'processing',
        processingAttempts: 3,
        claimPublicId: 'old-claim',
        lockedAtUtc: '2026-07-25T09:50:00Z',
        lockedBy: 'worker-old',
        claimExpiresAtUtc: '2026-07-25T09:59:00Z',
      });
      await expect(recoverExpiredCanonicalSyncOutboxLease(db, {
        tenantId: TENANT,
        eventPublicId: 'expired-final',
        recoveredAtUtc: NOW,
        maxAttempts: 3,
        errorCode: 'SYNC_LEASE_EXPIRED',
        errorSha256: HASH,
      })).resolves.toBe('dead_letter');
      expect(sqlite.prepare(`SELECT status,claim_public_id FROM canonical_outbox_events WHERE event_public_id='expired-final'`).get())
        .toEqual({ status: 'dead_letter', claim_public_id: null });

      insertEncounterEvent(sqlite, {
        eventPublicId: 'active-recovery',
        aggregatePublicId: 'encounter-2',
        status: 'processing',
        processingAttempts: 1,
        claimPublicId: 'active-claim',
        lockedAtUtc: '2026-07-25T09:59:00Z',
        lockedBy: 'worker-old',
        claimExpiresAtUtc: '2026-07-25T10:30:00Z',
      });
      await expect(recoverExpiredCanonicalSyncOutboxLease(db, {
        tenantId: TENANT,
        eventPublicId: 'active-recovery',
        recoveredAtUtc: NOW,
        maxAttempts: 3,
        errorCode: 'SYNC_LEASE_EXPIRED',
        errorSha256: HASH,
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
    } finally {
      sqlite.close();
    }
  });
});

describe('canonical sync source permanent dead-letter', () => {
  it('dead-letters the exact active source receipt with stable evidence', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      await expect(deadLetterCanonicalSyncOutboxPublication(db, {
        receipt,
        failedAtUtc: '2026-07-25T10:01:00Z',
        errorCode: 'CANONICAL_SYNC_TARGET_PERMANENT',
        errorSha256: HASH,
        errorSummary: 'target permanent failure',
      })).resolves.toBeUndefined();
      expect(sqlite.prepare(`
        SELECT status,available_at_utc,claim_public_id,claim_expires_at_utc,
               locked_at_utc,locked_by,published_at_utc,published_envelope_sha256,
               last_error_code,last_error_summary,last_error_sha256
        FROM canonical_outbox_events
      `).get()).toEqual({
        status: 'dead_letter',
        available_at_utc: '2026-07-25T10:01:00Z',
        claim_public_id: null,
        claim_expires_at_utc: null,
        locked_at_utc: null,
        locked_by: null,
        published_at_utc: null,
        published_envelope_sha256: null,
        last_error_code: 'CANONICAL_SYNC_TARGET_PERMANENT',
        last_error_summary: 'target permanent failure',
        last_error_sha256: HASH,
      });
    } finally {
      sqlite.close();
    }
  });

  it('rejects stale owner, attempt, expired claim, invalid evidence, and replay', async () => {
    const { sqlite, db } = harness();
    try {
      insertEncounterEvent(sqlite);
      const receipt = await claimNextCanonicalSyncOutboxEnvelope(db, claimInput());
      const base = {
        failedAtUtc: '2026-07-25T10:01:00Z',
        errorCode: 'CANONICAL_SYNC_TARGET_PERMANENT',
        errorSha256: HASH,
      };
      await expect(deadLetterCanonicalSyncOutboxPublication(db, {
        receipt: { ...receipt, claimOwnerPublicId: 'worker-stale' },
        ...base,
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      await expect(deadLetterCanonicalSyncOutboxPublication(db, {
        receipt: { ...receipt, attemptCount: 2 },
        ...base,
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      await expect(deadLetterCanonicalSyncOutboxPublication(db, {
        receipt,
        ...base,
        failedAtUtc: '2026-07-25T10:06:00Z',
      })).rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      await expect(deadLetterCanonicalSyncOutboxPublication(db, {
        receipt,
        ...base,
        errorCode: 'invalid code',
      })).rejects.toThrow(/errorCode/i);
      await expect(deadLetterCanonicalSyncOutboxPublication(db, {
        receipt,
        ...base,
        errorSha256: 'bad-hash',
      })).rejects.toThrow(/errorSha256/i);
      expect(sqlite.prepare(`SELECT status,claim_public_id,processing_attempts FROM canonical_outbox_events`).get())
        .toEqual({ status: 'processing', claim_public_id: 'claim-1', processing_attempts: 1 });

      await deadLetterCanonicalSyncOutboxPublication(db, { receipt, ...base });
      await expect(deadLetterCanonicalSyncOutboxPublication(db, { receipt, ...base }))
        .rejects.toBeInstanceOf(CanonicalSyncOutboxStateError);
      expect(sqlite.prepare(`SELECT status,processing_attempts FROM canonical_outbox_events`).get())
        .toEqual({ status: 'dead_letter', processing_attempts: 1 });
    } finally {
      sqlite.close();
    }
  });
});
