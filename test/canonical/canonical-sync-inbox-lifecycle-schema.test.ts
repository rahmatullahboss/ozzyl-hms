import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const FOUNDATION = 'migrations/0541_canonical_local_sync_protocol.sql';
const LIFECYCLE = 'migrations/0542_canonical_sync_inbox_lifecycle.sql';
const HASH = 'a'.repeat(64);
const KEY = 'b'.repeat(64);
const NOW = '2026-07-25T00:00:00Z';

function harness(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(FOUNDATION, 'utf8'));
  sqlite.exec(readFileSync(LIFECYCLE, 'utf8'));
  return sqlite;
}

function insertPending(sqlite: DatabaseSync, eventPublicId = 'event-1'): void {
  sqlite.prepare(`
    INSERT INTO canonical_sync_inbox_events (
      tenant_id,inbox_public_id,event_public_id,protocol_version,
      entity_type,entity_public_id,event_type,aggregate_version,operation,
      payload_json,payload_sha256,idempotency_key,source_node_public_id,
      status,attempt_count,received_at_utc,updated_at_utc
    ) VALUES ('100', ?, ?, 1, 'invoice', 'invoice-1',
      'canonical.invoice.issued', 1, 'upsert', '{"amount":100}', ?, ?,
      'node-local-1', 'pending', 0, ?, ?)
  `).run(`inbox-${eventPublicId}`, eventPublicId, HASH, KEY, NOW, NOW);
}

describe('canonical sync inbox lifecycle schema', () => {
  it('adds lease/retry columns, claimable index, lifecycle triggers, and assertion table', () => {
    const sqlite = harness();
    try {
      const columns = sqlite.prepare(`PRAGMA table_info(canonical_sync_inbox_events)`).all() as Array<{ name: string }>;
      expect(columns.map((row) => row.name)).toEqual(expect.arrayContaining([
        'occurred_at_utc',
        'claim_public_id',
        'claim_owner_public_id',
        'claim_expires_at_utc',
        'next_attempt_at_utc',
      ]));

      const objects = sqlite.prepare(`
        SELECT type,name FROM sqlite_schema
        WHERE name IN (
          'canonical_sync_batch_assertions',
          'idx_canonical_sync_inbox_claimable',
          'trg_canonical_sync_inbox_lifecycle_insert',
          'trg_canonical_sync_inbox_lifecycle_update'
        ) ORDER BY name
      `).all() as Array<{ type: string; name: string }>;
      expect(objects).toEqual([
        { type: 'table', name: 'canonical_sync_batch_assertions' },
        { type: 'index', name: 'idx_canonical_sync_inbox_claimable' },
        { type: 'trigger', name: 'trg_canonical_sync_inbox_lifecycle_insert' },
        { type: 'trigger', name: 'trg_canonical_sync_inbox_lifecycle_update' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('requires a complete stable claim triple only while applying', () => {
    const sqlite = harness();
    try {
      insertPending(sqlite);
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events SET status='applying' WHERE tenant_id='100' AND event_public_id='event-1'
      `).run()).toThrow(/claim evidence/i);
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events
        SET status='applying', claim_public_id='123', claim_owner_public_id='node-1',
            claim_expires_at_utc='2026-07-25T00:05:00Z'
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run()).toThrow(/check/i);
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events
        SET status='applying', claim_public_id='claim-1', claim_owner_public_id='node-1',
            claim_expires_at_utc='2026-07-25 00:05:00'
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run()).toThrow(/check/i);
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events
        SET status='applying', claim_public_id='claim-1', claim_owner_public_id='node-1',
            claim_expires_at_utc='2026-07-25T00:05:00Z'
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run()).not.toThrow();
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events SET status='applied', applied_at_utc=?, updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run(NOW, NOW)).toThrow(/claim evidence/i);
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events
        SET status='applied', claim_public_id=NULL, claim_owner_public_id=NULL,
            claim_expires_at_utc=NULL, applied_at_utc=?, updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run(NOW, NOW)).not.toThrow();
    } finally {
      sqlite.close();
    }
  });

  it('requires retry timing only for retry rows and valid UTC evidence', () => {
    const sqlite = harness();
    try {
      insertPending(sqlite);
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events SET status='retry' WHERE tenant_id='100' AND event_public_id='event-1'
      `).run()).toThrow(/retry evidence/i);
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events SET status='retry', next_attempt_at_utc='2026-07-25 00:10:00'
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run()).toThrow(/retry evidence|check/i);
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events SET status='retry', next_attempt_at_utc='2026-07-25T00:10:00Z',
            error_code='SYNC_RETRY', error_hash='cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run()).not.toThrow();
      expect(() => sqlite.prepare(`
        UPDATE canonical_sync_inbox_events SET status='pending'
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run()).toThrow(/retry evidence/i);
    } finally {
      sqlite.close();
    }
  });

  it('rejects zero assertions and accepts exact successful assertion evidence', () => {
    const sqlite = harness();
    try {
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_sync_batch_assertions (
          tenant_id,operation_key,step_key,assertion_value,created_at_utc
        ) VALUES ('100','op-1','claim',0,?)
      `).run(NOW)).toThrow(/check/i);
      expect(() => sqlite.prepare(`
        INSERT INTO canonical_sync_batch_assertions (
          tenant_id,operation_key,step_key,assertion_value,created_at_utc
        ) VALUES ('100','op-1','claim',1,?)
      `).run(NOW)).not.toThrow();
    } finally {
      sqlite.close();
    }
  });
});
