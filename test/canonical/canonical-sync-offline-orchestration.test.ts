import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import {
  createCanonicalSyncDatabaseDeliveryPort,
  type CanonicalSyncDeliveryPort,
} from '../../src/lib/canonical/local-sync-delivery';
import {
  runCanonicalSyncOrchestrationOnce,
  type CanonicalSyncOrchestrationTimeline,
} from '../../src/lib/canonical/local-sync-orchestrator';

const TENANT = '100';
const SOURCE_NODE = 'node-local-1';
const SOURCE_EVIDENCE = 'a'.repeat(64);
const TARGET_ERROR_HASH = 'b'.repeat(64);

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

function sourceHarness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
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
      '100','encounter-1',101,'outpatient','in_progress',
      '2026-07-25T09:00:00Z',NULL,'${SOURCE_EVIDENCE}'
    );
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0543_canonical_sync_outbox_lifecycle.sql', 'utf8'));
  return { sqlite, db: database(sqlite) };
}

function targetHarness(): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
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
    INSERT INTO patients VALUES (201,'100','uhid:P-001');
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  return { sqlite, db: database(sqlite) };
}

function insertSourceEncounterEvent(sqlite: DatabaseSync): void {
  sqlite.prepare(`
    INSERT INTO canonical_outbox_events (
      tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,event_version,
      payload_json,occurred_at_utc,business_date,idempotency_key,status,available_at_utc,
      processing_attempts,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,1,?,?,?,?, 'pending', ?,0,?,?)
  `).run(
    TENANT,
    'outbox-encounter-start',
    'canonical_encounter',
    'encounter-1',
    'canonical.encounter.started',
    stableCanonicalJson({
      encounterPublicId: 'encounter-1',
      encounterType: 'outpatient',
      status: 'in_progress',
    }),
    '2026-07-25T09:00:00Z',
    '2026-07-25',
    'idem-outbox-encounter-start',
    '2026-07-25T10:00:00Z',
    '2026-07-25T10:00:00Z',
    '2026-07-25T10:00:00Z',
  );
}

function timeline(overrides: Partial<CanonicalSyncOrchestrationTimeline> = {}): CanonicalSyncOrchestrationTimeline {
  return {
    sourceClaimedAtUtc: '2026-07-25T10:00:00Z',
    sourceClaimExpiresAtUtc: '2026-07-25T10:30:00Z',
    targetReceivedAtUtc: '2026-07-25T10:01:00Z',
    targetClaimedAtUtc: '2026-07-25T10:02:00Z',
    targetClaimExpiresAtUtc: '2026-07-25T10:20:00Z',
    targetAppliedAtUtc: '2026-07-25T10:03:00Z',
    sourcePublishedAtUtc: '2026-07-25T10:04:00Z',
    sourceNextAttemptAtUtc: '2026-07-25T10:10:00Z',
    targetNextAttemptAtUtc: '2026-07-25T10:11:00Z',
    ...overrides,
  };
}

function orchestrationInput(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    sourceNodePublicId: SOURCE_NODE,
    sourceClaimOwnerPublicId: 'source-worker-1',
    targetClaimOwnerPublicId: 'target-worker-1',
    sourceMaxAttempts: 3,
    targetMaxAttempts: 3,
    timeline: timeline(),
    ...overrides,
  };
}

describe('canonical offline one-event orchestration', () => {
  it('claims source, applies target authority, and acknowledges exact source publication', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    try {
      insertSourceEncounterEvent(source.sqlite);
      const result = await runCanonicalSyncOrchestrationOnce(
        source.db,
        createCanonicalSyncDatabaseDeliveryPort(target.db),
        orchestrationInput(),
      );
      expect(result).toEqual({
        status: 'published',
        eventPublicId: 'outbox-encounter-start',
        sourceAttemptCount: 1,
        targetAttemptCount: 1,
        targetReplayed: false,
      });
      expect(source.sqlite.prepare(`
        SELECT status,processing_attempts,published_at_utc,claim_public_id,
               published_envelope_sha256,last_error_code
        FROM canonical_outbox_events
      `).get()).toMatchObject({
        status: 'published',
        processing_attempts: 1,
        published_at_utc: '2026-07-25T10:04:00Z',
        claim_public_id: null,
        last_error_code: null,
      });
      expect(source.sqlite.prepare(`SELECT published_envelope_sha256 FROM canonical_outbox_events`).get())
        .toMatchObject({ published_envelope_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
      expect(target.sqlite.prepare(`
        SELECT encounter_public_id,status,legacy_patient_id FROM canonical_encounters
      `).get()).toEqual({
        encounter_public_id: 'encounter-1',
        status: 'in_progress',
        legacy_patient_id: 201,
      });
      expect(target.sqlite.prepare(`
        SELECT status,attempt_count FROM canonical_sync_inbox_events
      `).get()).toEqual({ status: 'applied', attempt_count: 1 });
      expect(target.sqlite.prepare(`
        SELECT applied_version,last_event_public_id FROM canonical_sync_entity_versions
      `).get()).toEqual({ applied_version: 1, last_event_public_id: 'outbox-encounter-start' });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('returns idle without mutating either node when no source event is claimable', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    try {
      await expect(runCanonicalSyncOrchestrationOnce(
        source.db,
        createCanonicalSyncDatabaseDeliveryPort(target.db),
        orchestrationInput(),
      )).resolves.toEqual({ status: 'idle' });
      expect(source.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_outbox_events`).get())
        .toEqual({ count: 0 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 0 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('propagates a no-earlier target retry to the exact source claim', async () => {
    const source = sourceHarness();
    try {
      insertSourceEncounterEvent(source.sqlite);
      const port: CanonicalSyncDeliveryPort = {
        async deliver(request) {
          return {
            status: 'retry',
            eventPublicId: request.envelope.eventPublicId,
            targetAttemptCount: 1,
            retryAtUtc: '2026-07-25T10:15:00Z',
            errorCode: 'CANONICAL_SYNC_TARGET_RETRY',
            errorHash: TARGET_ERROR_HASH,
          };
        },
      };
      await expect(runCanonicalSyncOrchestrationOnce(source.db, port, orchestrationInput()))
        .resolves.toEqual({
          status: 'retry',
          eventPublicId: 'outbox-encounter-start',
          sourceAttemptCount: 1,
          retryAtUtc: '2026-07-25T10:15:00Z',
          errorCode: 'CANONICAL_SYNC_TARGET_RETRY',
          errorHash: TARGET_ERROR_HASH,
        });
      expect(source.sqlite.prepare(`
        SELECT status,available_at_utc,processing_attempts,claim_public_id,last_error_code,last_error_sha256
        FROM canonical_outbox_events
      `).get()).toEqual({
        status: 'retry',
        available_at_utc: '2026-07-25T10:15:00Z',
        processing_attempts: 1,
        claim_public_id: null,
        last_error_code: 'CANONICAL_SYNC_TARGET_RETRY',
        last_error_sha256: TARGET_ERROR_HASH,
      });
    } finally {
      source.sqlite.close();
    }
  });

  it('dead-letters the exact source claim when the target returns permanent evidence', async () => {
    const source = sourceHarness();
    try {
      insertSourceEncounterEvent(source.sqlite);
      const port: CanonicalSyncDeliveryPort = {
        async deliver(request) {
          return {
            status: 'dead_letter',
            eventPublicId: request.envelope.eventPublicId,
            targetAttemptCount: 1,
            errorCode: 'CANONICAL_SYNC_TARGET_PERMANENT',
            errorHash: TARGET_ERROR_HASH,
          };
        },
      };
      await expect(runCanonicalSyncOrchestrationOnce(source.db, port, orchestrationInput()))
        .resolves.toEqual({
          status: 'dead_letter',
          eventPublicId: 'outbox-encounter-start',
          sourceAttemptCount: 1,
          errorCode: 'CANONICAL_SYNC_TARGET_PERMANENT',
          errorHash: TARGET_ERROR_HASH,
        });
      expect(source.sqlite.prepare(`
        SELECT status,processing_attempts,claim_public_id,last_error_code,last_error_sha256
        FROM canonical_outbox_events
      `).get()).toEqual({
        status: 'dead_letter',
        processing_attempts: 1,
        claim_public_id: null,
        last_error_code: 'CANONICAL_SYNC_TARGET_PERMANENT',
        last_error_sha256: TARGET_ERROR_HASH,
      });
    } finally {
      source.sqlite.close();
    }
  });

  it('schedules source retry for transport failure and dead-letters its final attempt', async () => {
    const retrySource = sourceHarness();
    const terminalSource = sourceHarness();
    const port: CanonicalSyncDeliveryPort = {
      async deliver() {
        throw new Error('simulated offline transport failure');
      },
    };
    try {
      insertSourceEncounterEvent(retrySource.sqlite);
      const retryResult = await runCanonicalSyncOrchestrationOnce(
        retrySource.db,
        port,
        orchestrationInput(),
      );
      expect(retryResult).toMatchObject({
        status: 'retry',
        eventPublicId: 'outbox-encounter-start',
        sourceAttemptCount: 1,
        retryAtUtc: '2026-07-25T10:10:00Z',
        errorCode: 'CANONICAL_SYNC_TRANSPORT_FAILURE',
      });
      expect(retryResult.status === 'retry' ? retryResult.errorHash : '').toMatch(/^[a-f0-9]{64}$/);
      expect(retrySource.sqlite.prepare(`SELECT status,last_error_code FROM canonical_outbox_events`).get())
        .toEqual({ status: 'retry', last_error_code: 'CANONICAL_SYNC_TRANSPORT_FAILURE' });

      insertSourceEncounterEvent(terminalSource.sqlite);
      const terminalResult = await runCanonicalSyncOrchestrationOnce(
        terminalSource.db,
        port,
        orchestrationInput({ sourceMaxAttempts: 1 }),
      );
      expect(terminalResult).toMatchObject({
        status: 'dead_letter',
        eventPublicId: 'outbox-encounter-start',
        sourceAttemptCount: 1,
        errorCode: 'CANONICAL_SYNC_TRANSPORT_FAILURE',
      });
      expect(terminalSource.sqlite.prepare(`SELECT status,last_error_code FROM canonical_outbox_events`).get())
        .toEqual({ status: 'dead_letter', last_error_code: 'CANONICAL_SYNC_TRANSPORT_FAILURE' });
    } finally {
      retrySource.sqlite.close();
      terminalSource.sqlite.close();
    }
  });

  it('recovers when the target applied but its first response was lost', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    try {
      insertSourceEncounterEvent(source.sqlite);
      const databasePort = createCanonicalSyncDatabaseDeliveryPort(target.db);
      let first = true;
      const responseLossPort: CanonicalSyncDeliveryPort = {
        async deliver(request) {
          const result = await databasePort.deliver(request);
          if (first) {
            first = false;
            throw new Error('simulated response loss after target commit');
          }
          return result;
        },
      };
      const firstResult = await runCanonicalSyncOrchestrationOnce(
        source.db,
        responseLossPort,
        orchestrationInput(),
      );
      expect(firstResult).toMatchObject({
        status: 'retry',
        sourceAttemptCount: 1,
        errorCode: 'CANONICAL_SYNC_TRANSPORT_FAILURE',
      });
      expect(target.sqlite.prepare(`SELECT status,attempt_count FROM canonical_sync_inbox_events`).get())
        .toEqual({ status: 'applied', attempt_count: 1 });

      const secondTimeline = timeline({
        sourceClaimedAtUtc: '2026-07-25T10:11:00Z',
        sourceClaimExpiresAtUtc: '2026-07-25T10:45:00Z',
        targetReceivedAtUtc: '2026-07-25T10:12:00Z',
        targetClaimedAtUtc: '2026-07-25T10:13:00Z',
        targetClaimExpiresAtUtc: '2026-07-25T10:35:00Z',
        targetAppliedAtUtc: '2026-07-25T10:14:00Z',
        sourcePublishedAtUtc: '2026-07-25T10:15:00Z',
        sourceNextAttemptAtUtc: '2026-07-25T10:21:00Z',
        targetNextAttemptAtUtc: '2026-07-25T10:22:00Z',
      });
      await expect(runCanonicalSyncOrchestrationOnce(
        source.db,
        responseLossPort,
        orchestrationInput({ timeline: secondTimeline }),
      )).resolves.toEqual({
        status: 'published',
        eventPublicId: 'outbox-encounter-start',
        sourceAttemptCount: 2,
        targetAttemptCount: 1,
        targetReplayed: true,
      });
      expect(source.sqlite.prepare(`SELECT status,processing_attempts FROM canonical_outbox_events`).get())
        .toEqual({ status: 'published', processing_attempts: 2 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get())
        .toEqual({ count: 1 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('returns source_ack_pending when target applied but source ownership raced', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    try {
      insertSourceEncounterEvent(source.sqlite);
      const databasePort = createCanonicalSyncDatabaseDeliveryPort(target.db);
      const racingPort: CanonicalSyncDeliveryPort = {
        async deliver(request) {
          const result = await databasePort.deliver(request);
          source.sqlite.prepare(`
            UPDATE canonical_outbox_events
            SET claim_public_id='raced-source-claim'
            WHERE event_public_id='outbox-encounter-start' AND status='processing'
          `).run();
          return result;
        },
      };
      const result = await runCanonicalSyncOrchestrationOnce(
        source.db,
        racingPort,
        orchestrationInput(),
      );
      expect(result).toMatchObject({
        status: 'source_ack_pending',
        eventPublicId: 'outbox-encounter-start',
        sourceAttemptCount: 1,
        targetAttemptCount: 1,
        recoverAfterUtc: '2026-07-25T10:30:00Z',
        errorCode: 'CANONICAL_SYNC_SOURCE_ACK_PENDING',
      });
      expect(result.status === 'source_ack_pending' ? result.errorHash : '').toMatch(/^[a-f0-9]{64}$/);
      expect(source.sqlite.prepare(`
        SELECT status,claim_public_id,last_error_code FROM canonical_outbox_events
      `).get()).toEqual({
        status: 'processing',
        claim_public_id: 'raced-source-claim',
        last_error_code: null,
      });
      expect(target.sqlite.prepare(`SELECT status FROM canonical_sync_inbox_events`).get())
        .toEqual({ status: 'applied' });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('propagates active target ownership as a no-earlier source retry', async () => {
    const source = sourceHarness();
    try {
      insertSourceEncounterEvent(source.sqlite);
      const port: CanonicalSyncDeliveryPort = {
        async deliver(request) {
          return {
            status: 'busy',
            eventPublicId: request.envelope.eventPublicId,
            targetAttemptCount: 2,
            retryAtUtc: '2026-07-25T10:16:00Z',
            errorCode: 'CANONICAL_SYNC_TARGET_BUSY',
            errorHash: TARGET_ERROR_HASH,
          };
        },
      };
      await expect(runCanonicalSyncOrchestrationOnce(source.db, port, orchestrationInput()))
        .resolves.toEqual({
          status: 'retry',
          eventPublicId: 'outbox-encounter-start',
          sourceAttemptCount: 1,
          retryAtUtc: '2026-07-25T10:16:00Z',
          errorCode: 'CANONICAL_SYNC_TARGET_BUSY',
          errorHash: TARGET_ERROR_HASH,
        });
      expect(source.sqlite.prepare(`SELECT status,available_at_utc,last_error_code FROM canonical_outbox_events`).get())
        .toEqual({
          status: 'retry',
          available_at_utc: '2026-07-25T10:16:00Z',
          last_error_code: 'CANONICAL_SYNC_TARGET_BUSY',
        });
    } finally {
      source.sqlite.close();
    }
  });

  it('derives deterministic source/target claim IDs and stable transport hashes', async () => {
    const firstSource = sourceHarness();
    const secondSource = sourceHarness();
    const captured: Array<{ sourceClaimPublicId: string; targetClaimPublicId: string }> = [];
    const makePort = (sqlite: DatabaseSync): CanonicalSyncDeliveryPort => ({
      async deliver(request) {
        const sourceClaim = sqlite.prepare(`
          SELECT claim_public_id FROM canonical_outbox_events
          WHERE event_public_id='outbox-encounter-start'
        `).get() as { claim_public_id: string };
        captured.push({
          sourceClaimPublicId: sourceClaim.claim_public_id,
          targetClaimPublicId: request.targetClaimPublicId,
        });
        return {
          status: 'retry',
          eventPublicId: request.envelope.eventPublicId,
          targetAttemptCount: 1,
          retryAtUtc: '2026-07-25T10:15:00Z',
          errorCode: 'CANONICAL_SYNC_TARGET_RETRY',
          errorHash: TARGET_ERROR_HASH,
        };
      },
    });
    try {
      insertSourceEncounterEvent(firstSource.sqlite);
      insertSourceEncounterEvent(secondSource.sqlite);
      await runCanonicalSyncOrchestrationOnce(firstSource.db, makePort(firstSource.sqlite), orchestrationInput());
      await runCanonicalSyncOrchestrationOnce(secondSource.db, makePort(secondSource.sqlite), orchestrationInput());
      expect(captured).toHaveLength(2);
      expect(captured[0]).toEqual(captured[1]);
      expect(captured[0].sourceClaimPublicId).toMatch(/^sync-source-claim-[a-f0-9]{40}$/);
      expect(captured[0].targetClaimPublicId).toMatch(/^sync-target-claim-[a-f0-9]{40}$/);

      const errorSourceA = sourceHarness();
      const errorSourceB = sourceHarness();
      try {
        insertSourceEncounterEvent(errorSourceA.sqlite);
        insertSourceEncounterEvent(errorSourceB.sqlite);
        const throwingPort: CanonicalSyncDeliveryPort = {
          async deliver() {
            throw new Error('same deterministic transport failure');
          },
        };
        const first = await runCanonicalSyncOrchestrationOnce(errorSourceA.db, throwingPort, orchestrationInput());
        const second = await runCanonicalSyncOrchestrationOnce(errorSourceB.db, throwingPort, orchestrationInput());
        expect(first.status).toBe('retry');
        expect(second.status).toBe('retry');
        expect(first.status === 'retry' ? first.errorHash : null)
          .toBe(second.status === 'retry' ? second.errorHash : null);
      } finally {
        errorSourceA.sqlite.close();
        errorSourceB.sqlite.close();
      }
    } finally {
      firstSource.sqlite.close();
      secondSource.sqlite.close();
    }
  });

  it('rejects a non-monotonic timeline before claiming the source event', async () => {
    const source = sourceHarness();
    try {
      insertSourceEncounterEvent(source.sqlite);
      const invalid = timeline({ targetReceivedAtUtc: '2026-07-25T09:59:00Z' });
      const port: CanonicalSyncDeliveryPort = {
        async deliver() {
          throw new Error('must not run');
        },
      };
      await expect(runCanonicalSyncOrchestrationOnce(
        source.db,
        port,
        orchestrationInput({ timeline: invalid }),
      )).rejects.toThrow(/targetReceivedAtUtc/i);
      expect(source.sqlite.prepare(`
        SELECT status,processing_attempts,claim_public_id FROM canonical_outbox_events
      `).get()).toEqual({ status: 'pending', processing_attempts: 0, claim_public_id: null });
    } finally {
      source.sqlite.close();
    }
  });
});
