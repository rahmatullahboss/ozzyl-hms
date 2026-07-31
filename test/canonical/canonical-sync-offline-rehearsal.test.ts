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
import type {
  CanonicalSyncOrchestrationInput,
  CanonicalSyncOrchestrationTimeline,
} from '../../src/lib/canonical/local-sync-orchestrator';
import {
  runCanonicalSyncOfflineRehearsal,
  type CanonicalSyncOfflineRehearsalInput,
  type CanonicalSyncOfflineRehearsalStep,
} from '../../src/lib/canonical/local-sync-rehearsal';

function timeline(offsetMinutes = 0, overrides: Partial<CanonicalSyncOrchestrationTimeline> = {}): CanonicalSyncOrchestrationTimeline {
  const minute = (value: number) => `2026-07-25T10:${String(value + offsetMinutes).padStart(2, '0')}:00Z`;
  return {
    sourceClaimedAtUtc: minute(0),
    sourceClaimExpiresAtUtc: minute(20),
    targetReceivedAtUtc: minute(1),
    targetClaimedAtUtc: minute(2),
    targetClaimExpiresAtUtc: minute(15),
    targetAppliedAtUtc: minute(3),
    sourcePublishedAtUtc: minute(4),
    sourceNextAttemptAtUtc: minute(10),
    targetNextAttemptAtUtc: minute(11),
    ...overrides,
  };
}

function orchestration(
  offsetMinutes = 0,
  overrides: Partial<CanonicalSyncOrchestrationInput> = {},
): CanonicalSyncOrchestrationInput {
  return {
    tenantId: '100',
    sourceNodePublicId: 'node-source-1',
    sourceClaimOwnerPublicId: 'source-worker-1',
    targetClaimOwnerPublicId: 'target-worker-1',
    sourceMaxAttempts: 3,
    targetMaxAttempts: 3,
    timeline: timeline(offsetMinutes),
    ...overrides,
  };
}

function step(
  stepPublicId: string,
  offsetMinutes: number,
  overrides: Partial<CanonicalSyncOrchestrationInput> = {},
): CanonicalSyncOfflineRehearsalStep {
  return {
    stepPublicId,
    orchestration: orchestration(offsetMinutes, overrides),
  };
}

function guardedHarness() {
  let databaseCalls = 0;
  let deliveryCalls = 0;
  const db: CanonicalBatchDatabase = {
    prepare(): CanonicalPreparedStatement {
      databaseCalls += 1;
      throw new Error('database must not be accessed during invalid rehearsal validation');
    },
    async batch() {
      databaseCalls += 1;
      throw new Error('database must not be mutated during invalid rehearsal validation');
    },
  };
  const port: CanonicalSyncDeliveryPort = {
    async deliver() {
      deliveryCalls += 1;
      throw new Error('delivery must not run during invalid rehearsal validation');
    },
  };
  return {
    db,
    port,
    counts: () => ({ databaseCalls, deliveryCalls }),
  };
}

async function expectValidationFailure(
  input: CanonicalSyncOfflineRehearsalInput,
  pattern: RegExp,
): Promise<void> {
  const harness = guardedHarness();
  await expect(runCanonicalSyncOfflineRehearsal(harness.db, harness.port, input))
    .rejects.toThrow(pattern);
  expect(harness.counts()).toEqual({ databaseCalls: 0, deliveryCalls: 0 });
}

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

function sourceHarness(withEvents = true): { sqlite: DatabaseSync; db: CanonicalBatchDatabase } {
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
      sync_key TEXT,
      UNIQUE (tenant_id,sync_key)
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
      '100','encounter-a',101,'outpatient','completed',
      '2026-07-25T09:00:00Z','2026-07-25T09:30:00Z','${'a'.repeat(64)}'
    );
    INSERT INTO canonical_encounters VALUES (
      '100','encounter-b',101,'outpatient','in_progress',
      '2026-07-25T09:05:00Z',NULL,'${'b'.repeat(64)}'
    );
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0543_canonical_sync_outbox_lifecycle.sql', 'utf8'));

  if (withEvents) {
    const insert = sqlite.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,event_version,
        payload_json,occurred_at_utc,business_date,idempotency_key,status,available_at_utc,
        processing_attempts,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,1,?,?,?,?, 'pending', ?,0,?,?)
    `);
    insert.run(
      '100','event-a-start','canonical_encounter','encounter-a','canonical.encounter.started',
      stableCanonicalJson({ encounterPublicId: 'encounter-a', encounterType: 'outpatient', status: 'in_progress' }),
      '2026-07-25T09:00:00Z','2026-07-25','idem-event-a-start',
      '2026-07-25T10:00:00Z','2026-07-25T10:00:00Z','2026-07-25T10:00:00Z',
    );
    insert.run(
      '100','event-a-complete','canonical_encounter','encounter-a','canonical.encounter.completed',
      stableCanonicalJson({ encounterPublicId: 'encounter-a', status: 'completed' }),
      '2026-07-25T09:30:00Z','2026-07-25','idem-event-a-complete',
      '2026-07-25T10:00:00Z','2026-07-25T10:00:00Z','2026-07-25T10:00:00Z',
    );
    insert.run(
      '100','event-b-start','canonical_encounter','encounter-b','canonical.encounter.started',
      stableCanonicalJson({ encounterPublicId: 'encounter-b', encounterType: 'outpatient', status: 'in_progress' }),
      '2026-07-25T09:05:00Z','2026-07-25','idem-event-b-start',
      '2026-07-25T10:00:00Z','2026-07-25T10:00:00Z','2026-07-25T10:00:00Z',
    );
  }
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

function primarySteps(): CanonicalSyncOfflineRehearsalStep[] {
  return [
    step('step-response-loss', 0),
    step('step-unrelated-progress', 5),
    step('step-replay-recovery', 11),
    step('step-same-aggregate-v2', 21),
    step('step-drain', 31),
  ];
}

describe('canonical disconnected multi-event rehearsal validation', () => {
  it('rejects malformed complete plans before database or delivery access', async () => {
    await expectValidationFailure({ rehearsalPublicId: '123', steps: [step('step-1', 0)] }, /rehearsalPublicId/i);
    await expectValidationFailure({ rehearsalPublicId: 'rehearsal-1', steps: [] }, /1.*100/i);
    await expectValidationFailure({
      rehearsalPublicId: 'rehearsal-1',
      steps: [step('step-1', 0), step('step-1', 21)],
    }, /duplicate.*stepPublicId/i);
    await expectValidationFailure({
      rehearsalPublicId: 'rehearsal-1',
      steps: [
        step('step-1', 0),
        step('step-2', 21, { tenantId: '200' }),
      ],
    }, /same tenant/i);
    await expectValidationFailure({
      rehearsalPublicId: 'rehearsal-1',
      steps: [
        step('step-1', 0),
        step('step-2', 21, { sourceNodePublicId: 'node-source-2' }),
      ],
    }, /same source node/i);
    await expectValidationFailure({
      rehearsalPublicId: 'rehearsal-1',
      steps: [
        step('step-1', 0),
        step('step-2', 21, { sourceClaimOwnerPublicId: 'source-worker-2' }),
      ],
    }, /same source claim owner/i);
    await expectValidationFailure({
      rehearsalPublicId: 'rehearsal-1',
      steps: [
        step('step-1', 0),
        step('step-2', 21, { targetClaimOwnerPublicId: 'target-worker-2' }),
      ],
    }, /same target claim owner/i);
    await expectValidationFailure({
      rehearsalPublicId: 'rehearsal-1',
      steps: [step('step-1', 0), step('step-2', 0)],
    }, /strictly increasing/i);
    await expectValidationFailure({
      rehearsalPublicId: 'rehearsal-1',
      steps: [
        step('step-1', 0),
        step('step-2', 21, {
          timeline: timeline(21, { targetReceivedAtUtc: '2026-07-25T10:20:00Z' }),
        }),
      ],
    }, /targetReceivedAtUtc/i);
    await expectValidationFailure({
      rehearsalPublicId: 'rehearsal-1',
      steps: Array.from({ length: 101 }, (_, index) => step(`step-${index + 1}`, index * 21)),
    }, /1.*100/i);
  });
});

describe('canonical disconnected multi-event rehearsal execution', () => {
  it('stops at the first idle step and returns only aggregate-safe evidence', async () => {
    const source = sourceHarness(false);
    const target = targetHarness();
    let deliveryCalls = 0;
    const databasePort = createCanonicalSyncDatabaseDeliveryPort(target.db);
    const port: CanonicalSyncDeliveryPort = {
      async deliver(request) {
        deliveryCalls += 1;
        return databasePort.deliver(request);
      },
    };
    try {
      const receipt = await runCanonicalSyncOfflineRehearsal(source.db, port, {
        rehearsalPublicId: 'rehearsal-idle',
        steps: [step('step-idle', 0), step('step-not-run', 21)],
      });
      expect(receipt).toMatchObject({
        rehearsalPublicId: 'rehearsal-idle',
        tenantId: '100',
        sourceNodePublicId: 'node-source-1',
        plannedStepCount: 2,
        executedStepCount: 1,
        drained: true,
        publishedCount: 0,
        retryCount: 0,
        deadLetterCount: 0,
        sourceAckPendingCount: 0,
        idleCount: 1,
        uniqueEventCount: 0,
        eventPublicIds: [],
        stepReceipts: [{
          stepPublicId: 'step-idle',
          status: 'idle',
          eventPublicId: null,
          sourceAttemptCount: null,
          targetAttemptCount: null,
          targetReplayed: null,
          retryAtUtc: null,
          recoverAfterUtc: null,
          errorCode: null,
          errorHash: null,
        }],
      });
      expect(receipt.transcriptSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(deliveryCalls).toBe(0);
      const serialized = JSON.stringify(receipt);
      for (const forbidden of ['payload', 'mutation', 'patientSyncKey', 'claimOwnerPublicId', 'stack', 'message', 'sql']) {
        expect(serialized).not.toContain(forbidden);
      }
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('proves response-loss recovery, same-aggregate ordering, unrelated progress, and drain', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    const databasePort = createCanonicalSyncDatabaseDeliveryPort(target.db);
    let loseFirstResponse = true;
    const port: CanonicalSyncDeliveryPort = {
      async deliver(request) {
        const result = await databasePort.deliver(request);
        if (loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error('simulated response loss after target commit');
        }
        return result;
      },
    };
    try {
      const receipt = await runCanonicalSyncOfflineRehearsal(source.db, port, {
        rehearsalPublicId: 'rehearsal-response-loss',
        steps: primarySteps(),
      });
      expect(receipt.stepReceipts.map((item) => [item.status, item.eventPublicId])).toEqual([
        ['retry', 'event-a-start'],
        ['published', 'event-b-start'],
        ['published', 'event-a-start'],
        ['published', 'event-a-complete'],
        ['idle', null],
      ]);
      expect(receipt.stepReceipts[2]).toMatchObject({
        sourceAttemptCount: 2,
        targetAttemptCount: 1,
        targetReplayed: true,
      });
      expect(receipt).toMatchObject({
        plannedStepCount: 5,
        executedStepCount: 5,
        drained: true,
        publishedCount: 3,
        retryCount: 1,
        deadLetterCount: 0,
        sourceAckPendingCount: 0,
        idleCount: 1,
        uniqueEventCount: 3,
        eventPublicIds: ['event-a-complete', 'event-a-start', 'event-b-start'],
      });
      expect(receipt.transcriptSha256).toMatch(/^[a-f0-9]{64}$/);

      expect(source.sqlite.prepare(`
        SELECT event_public_id,status,processing_attempts
        FROM canonical_outbox_events ORDER BY id
      `).all()).toEqual([
        { event_public_id: 'event-a-start', status: 'published', processing_attempts: 2 },
        { event_public_id: 'event-a-complete', status: 'published', processing_attempts: 1 },
        { event_public_id: 'event-b-start', status: 'published', processing_attempts: 1 },
      ]);
      expect(target.sqlite.prepare(`
        SELECT encounter_public_id,status,ended_at_utc
        FROM canonical_encounters ORDER BY encounter_public_id
      `).all()).toEqual([
        { encounter_public_id: 'encounter-a', status: 'completed', ended_at_utc: '2026-07-25T09:30:00Z' },
        { encounter_public_id: 'encounter-b', status: 'in_progress', ended_at_utc: null },
      ]);
      expect(target.sqlite.prepare(`
        SELECT entity_public_id,applied_version,last_event_public_id
        FROM canonical_sync_entity_versions ORDER BY entity_public_id
      `).all()).toEqual([
        { entity_public_id: 'encounter-a', applied_version: 2, last_event_public_id: 'event-a-complete' },
        { entity_public_id: 'encounter-b', applied_version: 1, last_event_public_id: 'event-b-start' },
      ]);
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events WHERE status='applied'`).get())
        .toEqual({ count: 3 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('produces an identical aggregate transcript for identical isolated rehearsals', async () => {
    async function runOne() {
      const source = sourceHarness();
      const target = targetHarness();
      const databasePort = createCanonicalSyncDatabaseDeliveryPort(target.db);
      let loseFirstResponse = true;
      const port: CanonicalSyncDeliveryPort = {
        async deliver(request) {
          const result = await databasePort.deliver(request);
          if (loseFirstResponse) {
            loseFirstResponse = false;
            throw new Error('simulated response loss after target commit');
          }
          return result;
        },
      };
      try {
        return await runCanonicalSyncOfflineRehearsal(source.db, port, {
          rehearsalPublicId: 'rehearsal-deterministic',
          steps: primarySteps(),
        });
      } finally {
        source.sqlite.close();
        target.sqlite.close();
      }
    }

    const first = await runOne();
    const second = await runOne();
    expect(first).toEqual(second);
    expect(first.transcriptSha256).toBe(second.transcriptSha256);
  });

  it('continues to unrelated work after a terminal predecessor while later same-aggregate work stays blocked', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    const databasePort = createCanonicalSyncDatabaseDeliveryPort(target.db);
    let first = true;
    const terminalHash = 'c'.repeat(64);
    const port: CanonicalSyncDeliveryPort = {
      async deliver(request) {
        if (first) {
          first = false;
          return {
            status: 'dead_letter',
            eventPublicId: request.envelope.eventPublicId,
            targetAttemptCount: 1,
            errorCode: 'CANONICAL_SYNC_TARGET_PERMANENT',
            errorHash: terminalHash,
          };
        }
        return databasePort.deliver(request);
      },
    };
    try {
      const receipt = await runCanonicalSyncOfflineRehearsal(source.db, port, {
        rehearsalPublicId: 'rehearsal-terminal-unrelated',
        steps: [step('step-terminal-a', 0), step('step-publish-b', 5), step('step-drain', 11)],
      });
      expect(receipt.stepReceipts.map((item) => [item.status, item.eventPublicId])).toEqual([
        ['dead_letter', 'event-a-start'],
        ['published', 'event-b-start'],
        ['idle', null],
      ]);
      expect(receipt).toMatchObject({
        drained: true,
        publishedCount: 1,
        retryCount: 0,
        deadLetterCount: 1,
        idleCount: 1,
        uniqueEventCount: 2,
      });
      expect(source.sqlite.prepare(`
        SELECT event_public_id,status FROM canonical_outbox_events ORDER BY id
      `).all()).toEqual([
        { event_public_id: 'event-a-start', status: 'dead_letter' },
        { event_public_id: 'event-a-complete', status: 'pending' },
        { event_public_id: 'event-b-start', status: 'published' },
      ]);
      expect(target.sqlite.prepare(`SELECT encounter_public_id FROM canonical_encounters`).all())
        .toEqual([{ encounter_public_id: 'encounter-b' }]);
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });
});
