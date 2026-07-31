import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { completeCanonicalSyncBusinessEvent } from '../../src/lib/canonical/local-sync-business-apply';
import { createCanonicalSyncBusinessPayload } from '../../src/lib/canonical/local-sync-business-payload';
import {
  claimCanonicalSyncInboxEvent,
  receiveCanonicalSyncEnvelope,
} from '../../src/lib/canonical/local-sync-inbox';
import {
  createCanonicalSyncEnvelope,
  type CanonicalSyncEnvelope,
} from '../../src/lib/canonical/local-sync-protocol';

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
      },
    };
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    PRAGMA foreign_keys=ON;
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

async function startEnvelope(
  mutation: Record<string, unknown> = {
    kind: 'encounter_started',
    entityPublicId: 'encounter-1',
    patientSyncKey: 'uhid:P-001',
    encounterType: 'outpatient',
    startedAtUtc: '2026-07-25T01:00:00Z',
    sourceEvidenceSha256: 'a'.repeat(64),
  },
): Promise<CanonicalSyncEnvelope> {
  return createCanonicalSyncEnvelope({
    tenantId: '100',
    eventPublicId: 'outbox-encounter-start',
    entityType: 'encounter',
    entityPublicId: 'encounter-1',
    eventType: 'canonical.encounter.started',
    aggregateVersion: 1,
    operation: 'upsert',
    occurredAtUtc: '2026-07-25T01:00:00Z',
    sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({
      event: {
        encounterPublicId: 'encounter-1',
        encounterType: 'outpatient',
        status: 'in_progress',
      },
      mutation,
    }),
  });
}

async function completionEnvelope(): Promise<CanonicalSyncEnvelope> {
  return createCanonicalSyncEnvelope({
    tenantId: '100',
    eventPublicId: 'outbox-encounter-complete',
    entityType: 'encounter',
    entityPublicId: 'encounter-1',
    eventType: 'canonical.encounter.completed',
    aggregateVersion: 2,
    operation: 'upsert',
    occurredAtUtc: '2026-07-25T02:00:00Z',
    sourceNodePublicId: 'node-local-1',
    payload: createCanonicalSyncBusinessPayload({
      event: { encounterPublicId: 'encounter-1', status: 'completed' },
      mutation: {
        kind: 'encounter_completed',
        entityPublicId: 'encounter-1',
        encounterType: 'outpatient',
        startedAtUtc: '2026-07-25T01:00:00Z',
        completedAtUtc: '2026-07-25T02:00:00Z',
        sourceEvidenceSha256: 'a'.repeat(64),
      },
    }),
  });
}

async function receiveAndClaim(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  claimPublicId: string,
  claimExpiresAtUtc = '2026-07-25T04:00:00Z',
) {
  await receiveCanonicalSyncEnvelope(db, envelope, '2026-07-25T03:00:00Z');
  return claimCanonicalSyncInboxEvent(db, {
    tenantId: envelope.tenantId,
    eventPublicId: envelope.eventPublicId,
    claimPublicId,
    claimOwnerPublicId: 'worker-offline-1',
    claimedAtUtc: '2026-07-25T03:00:10Z',
    claimExpiresAtUtc,
  });
}

function completionState(sqlite: DatabaseSync, eventPublicId: string) {
  return {
    encounter: sqlite.prepare(`
      SELECT status,ended_at_utc FROM canonical_encounters
      WHERE encounter_public_id='encounter-1'
    `).get(),
    version: sqlite.prepare(`
      SELECT applied_version,last_event_public_id FROM canonical_sync_entity_versions
      WHERE entity_type='encounter' AND entity_public_id='encounter-1'
    `).get(),
    inbox: sqlite.prepare(`
      SELECT status,applied_at_utc FROM canonical_sync_inbox_events
      WHERE event_public_id=?
    `).get(eventPublicId),
  };
}

function sourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(entry)) files.push(path);
  }
  return files;
}

describe('canonical sync business completion boundary', () => {
  it('commits business mutation, entity version, and applied receipt atomically', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await startEnvelope();
      const claim = await receiveAndClaim(db, envelope, 'claim-success');
      await completeCanonicalSyncBusinessEvent(db, {
        envelope,
        claimPublicId: claim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:10:00Z',
      });
      expect(completionState(sqlite, envelope.eventPublicId)).toEqual({
        encounter: { status: 'in_progress', ended_at_utc: null },
        version: { applied_version: 1, last_event_public_id: 'outbox-encounter-start' },
        inbox: { status: 'applied', applied_at_utc: '2026-07-25T03:10:00Z' },
      });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back every layer when the claim has expired', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await startEnvelope();
      const claim = await receiveAndClaim(
        db,
        envelope,
        'claim-expired',
        '2026-07-25T03:05:00Z',
      );
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope,
        claimPublicId: claim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:05:00Z',
      })).rejects.toThrow();
      expect(completionState(sqlite, envelope.eventPublicId)).toEqual({
        encounter: undefined,
        version: undefined,
        inbox: { status: 'applying', applied_at_utc: null },
      });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back a business mutation when aggregate version has a gap', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_encounters VALUES (
          NULL,'100','encounter-1',101,'outpatient','in_progress',
          '2026-07-25T01:00:00Z',NULL,NULL,NULL,'${'a'.repeat(64)}',
          '2026-07-25T01:00:00Z','2026-07-25T01:00:00Z'
        );
      `);
      const envelope = await completionEnvelope();
      const claim = await receiveAndClaim(db, envelope, 'claim-gap');
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope,
        claimPublicId: claim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:10:00Z',
      })).rejects.toThrow();
      expect(completionState(sqlite, envelope.eventPublicId)).toEqual({
        encounter: { status: 'in_progress', ended_at_utc: null },
        version: undefined,
        inbox: { status: 'applying', applied_at_utc: null },
      });
    } finally {
      sqlite.close();
    }
  });

  it('rolls back version and inbox receipt on business assertion failure', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec('DELETE FROM patients');
      const envelope = await startEnvelope();
      const claim = await receiveAndClaim(db, envelope, 'claim-business-failure');
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope,
        claimPublicId: claim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:10:00Z',
      })).rejects.toThrow();
      expect(completionState(sqlite, envelope.eventPublicId)).toEqual({
        encounter: undefined,
        version: undefined,
        inbox: { status: 'applying', applied_at_utc: null },
      });
    } finally {
      sqlite.close();
    }
  });

  it('rejects authenticated semantic tampering before any business batch runs', async () => {
    const { sqlite, db } = harness();
    try {
      const envelope = await startEnvelope({
        kind: 'encounter_completed',
        entityPublicId: 'encounter-1',
        encounterType: 'outpatient',
        startedAtUtc: '2026-07-25T01:00:00Z',
        completedAtUtc: '2026-07-25T02:00:00Z',
        sourceEvidenceSha256: 'a'.repeat(64),
      });
      const claim = await receiveAndClaim(db, envelope, 'claim-tampered');
      await expect(completeCanonicalSyncBusinessEvent(db, {
        envelope,
        claimPublicId: claim.claimPublicId,
        appliedAtUtc: '2026-07-25T03:10:00Z',
      })).rejects.toThrow(/mutation kind mismatch/i);
      expect(completionState(sqlite, envelope.eventPublicId)).toEqual({
        encounter: undefined,
        version: undefined,
        inbox: { status: 'applying', applied_at_utc: null },
      });
    } finally {
      sqlite.close();
    }
  });

  it('remains offline-only with no route, worker, or runtime consumer reference', () => {
    const approvedOfflineModules = new Set([
      'src/lib/canonical/local-sync-business-apply.ts',
      'src/lib/canonical/local-sync-delivery.ts',
      'src/lib/canonical/local-sync-orchestrator.ts',
    ]);
    const runtimeReferences = sourceFiles('src')
      .filter((path) => !approvedOfflineModules.has(path))
      .filter((path) => {
        const body = readFileSync(path, 'utf8');
        return body.includes('completeCanonicalSyncBusinessEvent')
          || body.includes('prepareCanonicalSyncBusinessApplyStatements')
          || body.includes('local-sync-business-apply');
      });
    expect(runtimeReferences).toEqual([]);
  });
});
