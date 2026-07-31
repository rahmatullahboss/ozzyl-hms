import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from '../../src/lib/canonical/command-batch';
import { stableCanonicalJson } from '../../src/lib/canonical/idempotency';
import { createCanonicalSyncLocalOutboxConsumerConnection } from '../../src/lib/canonical/local-sync-consumer';
import { createCanonicalSyncDatabaseDeliveryPort } from '../../src/lib/canonical/local-sync-delivery';
import {
  createCanonicalSyncNetworkDeliveryPort,
  handleCanonicalSyncNetworkDeliveryExchange,
} from '../../src/lib/canonical/local-sync-network-delivery';
import {
  createCanonicalSyncAuthenticatedNetworkExchangePort,
  handleCanonicalSyncAuthenticatedNetworkExchange,
  type CanonicalSyncAuthenticationReplayStore,
} from '../../src/lib/canonical/local-sync-network-auth';

const TENANT = '100';
const SOURCE_EVIDENCE = 'a'.repeat(64);

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

function sourceHarness() {
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
      '2026-07-26T02:00:00Z',NULL,'${SOURCE_EVIDENCE}'
    );
  `);
  sqlite.exec(readFileSync('migrations/0541_canonical_local_sync_protocol.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0542_canonical_sync_inbox_lifecycle.sql', 'utf8'));
  sqlite.exec(readFileSync('migrations/0543_canonical_sync_outbox_lifecycle.sql', 'utf8'));
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
    '2026-07-26T02:00:00Z',
    '2026-07-26',
    'idem-outbox-encounter-start',
    '2026-07-26T03:00:00Z',
    '2026-07-26T03:00:00Z',
    '2026-07-26T03:00:00Z',
  );
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

function orchestrationInput() {
  return {
    tenantId: TENANT,
    sourceNodePublicId: 'node-local-consumer-1',
    sourceClaimOwnerPublicId: 'source-consumer-1',
    targetClaimOwnerPublicId: 'target-consumer-1',
    sourceMaxAttempts: 3,
    targetMaxAttempts: 3,
    timeline: {
      sourceClaimedAtUtc: '2026-07-26T03:00:00Z',
      sourceClaimExpiresAtUtc: '2026-07-26T03:30:00Z',
      targetReceivedAtUtc: '2026-07-26T03:01:00Z',
      targetClaimedAtUtc: '2026-07-26T03:02:00Z',
      targetClaimExpiresAtUtc: '2026-07-26T03:20:00Z',
      targetAppliedAtUtc: '2026-07-26T03:03:00Z',
      sourcePublishedAtUtc: '2026-07-26T03:04:00Z',
      sourceNextAttemptAtUtc: '2026-07-26T03:10:00Z',
      targetNextAttemptAtUtc: '2026-07-26T03:11:00Z',
    },
  };
}

describe('canonical local outbox consumer connection integration', () => {
  it('claims, delivers, applies, publishes, and then drains without duplication', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    try {
      const connection = createCanonicalSyncLocalOutboxConsumerConnection(
        source.db,
        createCanonicalSyncDatabaseDeliveryPort(target.db),
      );

      await expect(connection.consumeOnce(orchestrationInput())).resolves.toEqual({
        status: 'published',
        eventPublicId: 'outbox-encounter-start',
        sourceAttemptCount: 1,
        targetAttemptCount: 1,
        targetReplayed: false,
      });
      expect(source.sqlite.prepare(`
        SELECT status,published_at_utc,processing_attempts
        FROM canonical_outbox_events WHERE event_public_id='outbox-encounter-start'
      `).get()).toEqual({
        status: 'published',
        published_at_utc: '2026-07-26T03:04:00Z',
        processing_attempts: 1,
      });
      expect(target.sqlite.prepare(`
        SELECT encounter_public_id,status,started_at_utc
        FROM canonical_encounters WHERE encounter_public_id='encounter-1'
      `).get()).toEqual({
        encounter_public_id: 'encounter-1',
        status: 'in_progress',
        started_at_utc: '2026-07-26T02:00:00Z',
      });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 1 });

      const later = orchestrationInput();
      later.timeline = {
        sourceClaimedAtUtc: '2026-07-26T04:00:00Z',
        sourceClaimExpiresAtUtc: '2026-07-26T04:30:00Z',
        targetReceivedAtUtc: '2026-07-26T04:01:00Z',
        targetClaimedAtUtc: '2026-07-26T04:02:00Z',
        targetClaimExpiresAtUtc: '2026-07-26T04:20:00Z',
        targetAppliedAtUtc: '2026-07-26T04:03:00Z',
        sourcePublishedAtUtc: '2026-07-26T04:04:00Z',
        sourceNextAttemptAtUtc: '2026-07-26T04:10:00Z',
        targetNextAttemptAtUtc: '2026-07-26T04:11:00Z',
      };
      await expect(connection.consumeOnce(later)).resolves.toEqual({ status: 'idle' });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get())
        .toEqual({ count: 1 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 1 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('converges through the digest-bound in-memory network exchange without duplication', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    try {
      const targetPort = createCanonicalSyncDatabaseDeliveryPort(target.db);
      const networkPort = createCanonicalSyncNetworkDeliveryPort({
        endpoint: 'https://sync.example.test/v1/canonical/deliver',
        exchange: {
          exchange(request) {
            return handleCanonicalSyncNetworkDeliveryExchange(targetPort, request);
          },
        },
      });
      const connection = createCanonicalSyncLocalOutboxConsumerConnection(source.db, networkPort);

      await expect(connection.consumeOnce(orchestrationInput())).resolves.toEqual({
        status: 'published',
        eventPublicId: 'outbox-encounter-start',
        sourceAttemptCount: 1,
        targetAttemptCount: 1,
        targetReplayed: false,
      });
      expect(source.sqlite.prepare(`
        SELECT status,published_at_utc,processing_attempts
        FROM canonical_outbox_events WHERE event_public_id='outbox-encounter-start'
      `).get()).toEqual({
        status: 'published',
        published_at_utc: '2026-07-26T03:04:00Z',
        processing_attempts: 1,
      });
      expect(target.sqlite.prepare(`
        SELECT encounter_public_id,status,started_at_utc
        FROM canonical_encounters WHERE encounter_public_id='encounter-1'
      `).get()).toEqual({
        encounter_public_id: 'encounter-1',
        status: 'in_progress',
        started_at_utc: '2026-07-26T02:00:00Z',
      });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 1 });

      const later = orchestrationInput();
      later.timeline = {
        sourceClaimedAtUtc: '2026-07-26T04:00:00Z',
        sourceClaimExpiresAtUtc: '2026-07-26T04:30:00Z',
        targetReceivedAtUtc: '2026-07-26T04:01:00Z',
        targetClaimedAtUtc: '2026-07-26T04:02:00Z',
        targetClaimExpiresAtUtc: '2026-07-26T04:20:00Z',
        targetAppliedAtUtc: '2026-07-26T04:03:00Z',
        sourcePublishedAtUtc: '2026-07-26T04:04:00Z',
        sourceNextAttemptAtUtc: '2026-07-26T04:10:00Z',
        targetNextAttemptAtUtc: '2026-07-26T04:11:00Z',
      };
      await expect(connection.consumeOnce(later)).resolves.toEqual({ status: 'idle' });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get())
        .toEqual({ count: 1 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 1 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('converges through authenticated wire evidence and accepts exact network replay after response loss', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    try {
      const signature = 'S'.repeat(43);
      const signedMessages = new Set<string>();
      const reservations = new Map<string, string>();
      const replayStatuses: string[] = [];
      const replayStore: CanonicalSyncAuthenticationReplayStore = {
        async reserve(input) {
          const key = `${input.keyId}:${input.noncePublicId}`;
          const identity = stableCanonicalJson({
            requestSha256: input.requestSha256,
            eventPublicId: input.eventPublicId,
            signedAtUtc: input.signedAtUtc,
          });
          const existing = reservations.get(key);
          if (existing == null) {
            reservations.set(key, identity);
            return 'reserved';
          }
          return existing === identity ? 'exact_replay' : 'conflict';
        },
      };
      const targetPort = createCanonicalSyncDatabaseDeliveryPort(target.db);
      const authenticatedReceiver = {
        async exchange(request: Parameters<typeof handleCanonicalSyncAuthenticatedNetworkExchange>[1]) {
          const response = await handleCanonicalSyncAuthenticatedNetworkExchange({
            verifier: {
              async verify(input) {
                return input.signature === signature
                  && signedMessages.has(`${input.keyId}:${input.canonicalMessage}`);
              },
            },
            replayStore,
            targetExchange: {
              exchange(baseRequest) {
                return handleCanonicalSyncNetworkDeliveryExchange(targetPort, baseRequest);
              },
            },
            acceptedAtUtc: '2026-07-26T03:01:30Z',
            maxClockSkewSeconds: 300,
          }, request);
          replayStatuses.push(response.headers['x-canonical-sync-auth-replay']);
          return response;
        },
      };
      const authenticatedSender = createCanonicalSyncAuthenticatedNetworkExchangePort({
        innerExchange: authenticatedReceiver,
        evidenceProvider: {
          async provide() {
            return {
              keyId: 'key-sync-integration-1',
              signedAtUtc: '2026-07-26T03:01:00Z',
              noncePublicId: 'nonce-sync-integration-1',
            };
          },
        },
        signer: {
          async sign(input) {
            signedMessages.add(`${input.keyId}:${input.canonicalMessage}`);
            return signature;
          },
        },
      });
      let capturedBaseRequest: Parameters<typeof authenticatedSender.exchange>[0] | null = null;
      const networkPort = createCanonicalSyncNetworkDeliveryPort({
        endpoint: 'https://sync.example.test/v1/canonical/deliver',
        exchange: {
          exchange(request) {
            capturedBaseRequest = request;
            return authenticatedSender.exchange(request);
          },
        },
      });
      const connection = createCanonicalSyncLocalOutboxConsumerConnection(source.db, networkPort);

      await expect(connection.consumeOnce(orchestrationInput())).resolves.toEqual({
        status: 'published',
        eventPublicId: 'outbox-encounter-start',
        sourceAttemptCount: 1,
        targetAttemptCount: 1,
        targetReplayed: false,
      });
      expect(replayStatuses).toEqual(['reserved']);
      expect(capturedBaseRequest).not.toBeNull();

      const replayResponse = await authenticatedSender.exchange(capturedBaseRequest!);
      expect(replayStatuses).toEqual(['reserved', 'exact_replay']);
      expect(JSON.parse(replayResponse.body)).toMatchObject({
        result: {
          status: 'applied',
          eventPublicId: 'outbox-encounter-start',
          replayed: true,
        },
      });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get())
        .toEqual({ count: 1 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 1 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });

  it('turns a non-200 network exchange into source retry evidence without target mutation', async () => {
    const source = sourceHarness();
    const target = targetHarness();
    try {
      const networkPort = createCanonicalSyncNetworkDeliveryPort({
        endpoint: 'https://sync.example.test/v1/canonical/deliver',
        exchange: {
          async exchange() {
            return { statusCode: 503, headers: {}, body: '' };
          },
        },
      });
      const connection = createCanonicalSyncLocalOutboxConsumerConnection(source.db, networkPort);

      await expect(connection.consumeOnce(orchestrationInput())).resolves.toMatchObject({
        status: 'retry',
        eventPublicId: 'outbox-encounter-start',
        sourceAttemptCount: 1,
        retryAtUtc: '2026-07-26T03:10:00Z',
        errorCode: 'CANONICAL_SYNC_TRANSPORT_FAILURE',
      });
      expect(source.sqlite.prepare(`
        SELECT status,available_at_utc,processing_attempts,published_at_utc
        FROM canonical_outbox_events WHERE event_public_id='outbox-encounter-start'
      `).get()).toEqual({
        status: 'retry',
        available_at_utc: '2026-07-26T03:10:00Z',
        processing_attempts: 1,
        published_at_utc: null,
      });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_encounters`).get())
        .toEqual({ count: 0 });
      expect(target.sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_sync_inbox_events`).get())
        .toEqual({ count: 0 });
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  });
});
