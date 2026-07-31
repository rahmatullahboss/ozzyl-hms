import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const MIGRATION = 'migrations/0541_canonical_local_sync_protocol.sql';
const HASH = 'a'.repeat(64);
const IDEMPOTENCY = 'b'.repeat(64);
const NOW = '2026-07-25T00:00:00Z';

function harness(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(MIGRATION, 'utf8'));
  return sqlite;
}

function insertInbox(
  sqlite: DatabaseSync,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const row = {
    tenantId: '100',
    inboxPublicId: 'inbox-1',
    eventPublicId: 'event-1',
    protocolVersion: 1,
    entityType: 'invoice',
    entityPublicId: 'invoice-1',
    eventType: 'canonical.invoice.issued',
    aggregateVersion: 1,
    operation: 'upsert',
    payloadJson: '{"amount":100}',
    payloadSha256: HASH,
    idempotencyKey: IDEMPOTENCY,
    sourceNodePublicId: 'node-1',
    status: 'pending',
    attemptCount: 0,
    receivedAtUtc: NOW,
    updatedAtUtc: NOW,
    ...overrides,
  };
  sqlite.prepare(`
    INSERT INTO canonical_sync_inbox_events (
      tenant_id,inbox_public_id,event_public_id,protocol_version,
      entity_type,entity_public_id,event_type,aggregate_version,operation,
      payload_json,payload_sha256,idempotency_key,source_node_public_id,
      status,attempt_count,received_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.tenantId,row.inboxPublicId,row.eventPublicId,row.protocolVersion,
    row.entityType,row.entityPublicId,row.eventType,row.aggregateVersion,row.operation,
    row.payloadJson,row.payloadSha256,row.idempotencyKey,row.sourceNodePublicId,
    row.status,row.attemptCount,row.receivedAtUtc,row.updatedAtUtc,
  );
}

describe('canonical local sync protocol schema', () => {
  it('creates tenant-scoped inbox, dependency, and entity-version tables with indexes', () => {
    const sqlite = harness();
    try {
      const tables = sqlite.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='table' AND name LIKE 'canonical_sync_%'
        ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(tables.map((row) => row.name)).toEqual([
        'canonical_sync_entity_versions',
        'canonical_sync_inbox_dependencies',
        'canonical_sync_inbox_events',
      ]);

      const indexes = sqlite.prepare(`
        SELECT name FROM sqlite_schema
        WHERE type='index' AND name IN (
          'idx_canonical_sync_inbox_pending',
          'idx_canonical_sync_dependency_lookup'
        ) ORDER BY name
      `).all() as Array<{ name: string }>;
      expect(indexes.map((row) => row.name)).toEqual([
        'idx_canonical_sync_dependency_lookup',
        'idx_canonical_sync_inbox_pending',
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('enforces tenant event/idempotency uniqueness and inbox lifecycle constraints', () => {
    const sqlite = harness();
    try {
      insertInbox(sqlite);
      expect(() => insertInbox(sqlite, { inboxPublicId: 'inbox-2', idempotencyKey: 'c'.repeat(64) })).toThrow(/unique/i);
      expect(() => insertInbox(sqlite, { inboxPublicId: 'inbox-3', eventPublicId: 'event-3' })).toThrow(/unique/i);
      expect(() => insertInbox(sqlite, {
        tenantId: '200',
        inboxPublicId: 'inbox-4',
        idempotencyKey: 'd'.repeat(64),
      })).not.toThrow();

      for (const [index, overrides] of [
        { protocolVersion: 2 },
        { aggregateVersion: 0 },
        { operation: 'delete' },
        { status: 'done' },
        { attemptCount: -1 },
        { payloadSha256: 'bad' },
        { idempotencyKey: 'bad' },
        { payloadJson: 'not-json' },
        { receivedAtUtc: '2026-07-25 00:00:00' },
        { eventPublicId: '123' },
        { entityPublicId: '456' },
        { sourceNodePublicId: '789' },
      ].entries()) {
        expect(() => insertInbox(sqlite, {
          inboxPublicId: `bad-${index}`,
          eventPublicId: `bad-event-${index}`,
          idempotencyKey: `${(index + 1).toString(16)}`.repeat(64).slice(0, 64),
          ...overrides,
        })).toThrow(/check/i);
      }
    } finally {
      sqlite.close();
    }
  });

  it('enforces exact dependency uniqueness and tenant-scoped inbox lineage', () => {
    const sqlite = harness();
    try {
      insertInbox(sqlite);
      sqlite.prepare(`
        INSERT INTO canonical_sync_inbox_dependencies (
          tenant_id,inbox_event_public_id,dependency_entity_type,
          dependency_entity_public_id,minimum_version
        ) VALUES ('100','event-1','encounter','encounter-1',1)
      `).run();
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_sync_inbox_dependencies (
          tenant_id,inbox_event_public_id,dependency_entity_type,
          dependency_entity_public_id,minimum_version
        ) VALUES ('100','event-1','encounter','encounter-1',1)
      `).run()).toThrow(/unique/i);
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_sync_inbox_dependencies (
          tenant_id,inbox_event_public_id,dependency_entity_type,
          dependency_entity_public_id,minimum_version
        ) VALUES ('200','event-1','encounter','encounter-2',1)
      `).run()).toThrow(/foreign key/i);
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_sync_inbox_dependencies (
          tenant_id,inbox_event_public_id,dependency_entity_type,
          dependency_entity_public_id,minimum_version
        ) VALUES ('100','event-1','encounter','encounter-2',0)
      `).run()).toThrow(/check/i);
    } finally {
      sqlite.close();
    }
  });

  it('enforces tenant/entity/public-ID version authority constraints', () => {
    const sqlite = harness();
    try {
      sqlite.prepare(`
        INSERT INTO canonical_sync_entity_versions (
          tenant_id,entity_type,entity_public_id,applied_version,
          last_event_public_id,last_operation,last_payload_sha256,updated_at_utc
        ) VALUES ('100','invoice','invoice-1',1,'event-1','upsert',?,?)
      `).run(HASH, NOW);
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_sync_entity_versions (
          tenant_id,entity_type,entity_public_id,applied_version,
          last_event_public_id,last_operation,last_payload_sha256,updated_at_utc
        ) VALUES ('100','invoice','invoice-1',2,'event-2','upsert',?,?)
      `).run(HASH, NOW)).toThrow(/unique/i);
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_sync_entity_versions (
          tenant_id,entity_type,entity_public_id,applied_version,
          last_event_public_id,last_operation,last_payload_sha256,updated_at_utc
        ) VALUES ('100','invoice','invoice-2',-1,NULL,NULL,NULL,?)
      `).run(NOW)).toThrow(/check/i);
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_sync_entity_versions (
          tenant_id,entity_type,entity_public_id,applied_version,
          last_event_public_id,last_operation,last_payload_sha256,updated_at_utc
        ) VALUES ('100','invoice','invoice-3',1,'event-3','delete',?,?)
      `).run(HASH, NOW)).toThrow(/check/i);
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_sync_entity_versions (
          tenant_id,entity_type,entity_public_id,applied_version,
          last_event_public_id,last_operation,last_payload_sha256,updated_at_utc
        ) VALUES ('100','invoice','invoice-4',0,NULL,NULL,NULL,?)
      `).run(NOW)).not.toThrow();
    } finally {
      sqlite.close();
    }
  });
});
