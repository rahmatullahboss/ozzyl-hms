import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const FOUNDATION = 'migrations/0505_canonical_program_foundation.sql';
const SYNC_PROTOCOL = 'migrations/0541_canonical_local_sync_protocol.sql';
const SYNC_ASSERTIONS = 'migrations/0542_canonical_sync_inbox_lifecycle.sql';
const OUTBOX_LIFECYCLE = 'migrations/0543_canonical_sync_outbox_lifecycle.sql';
const NOW = '2026-07-25T10:00:00Z';
const HASH = 'a'.repeat(64);

function harness(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(FOUNDATION, 'utf8'));
  sqlite.exec(readFileSync(SYNC_PROTOCOL, 'utf8'));
  sqlite.exec(readFileSync(SYNC_ASSERTIONS, 'utf8'));
  sqlite.exec(readFileSync(OUTBOX_LIFECYCLE, 'utf8'));
  return sqlite;
}

function insertPending(sqlite: DatabaseSync, eventPublicId = 'event-1'): void {
  sqlite.prepare(`
    INSERT INTO canonical_outbox_events (
      tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
      event_version,payload_json,occurred_at_utc,business_date,idempotency_key,
      status,available_at_utc,processing_attempts,created_at_utc,updated_at_utc
    ) VALUES (
      '100',?,'canonical_invoice','invoice-1','canonical.invoice.issued',1,
      '{"invoicePublicId":"invoice-1"}',?,'2026-07-25',?,
      'pending',?,0,?,?
    )
  `).run(eventPublicId, NOW, `idem-${eventPublicId}`, NOW, NOW, NOW);
}

describe('canonical sync source outbox lifecycle migration', () => {
  it('adds lease/evidence columns, claimable index, and lifecycle triggers', () => {
    const sqlite = harness();
    try {
      const columns = sqlite.prepare(`PRAGMA table_info(canonical_outbox_events)`).all() as Array<{ name: string }>;
      expect(columns.map((row) => row.name)).toEqual(expect.arrayContaining([
        'claim_public_id',
        'claim_expires_at_utc',
        'last_error_sha256',
        'published_envelope_sha256',
      ]));

      const objects = sqlite.prepare(`
        SELECT type,name FROM sqlite_schema
        WHERE name IN (
          'idx_canonical_outbox_sync_claimable',
          'trg_canonical_outbox_sync_lifecycle_insert',
          'trg_canonical_outbox_sync_lifecycle_update',
          'trg_canonical_outbox_sync_semantic_immutable'
        ) ORDER BY name
      `).all() as Array<{ type: string; name: string }>;
      expect(objects).toEqual([
        { type: 'index', name: 'idx_canonical_outbox_sync_claimable' },
        { type: 'trigger', name: 'trg_canonical_outbox_sync_lifecycle_insert' },
        { type: 'trigger', name: 'trg_canonical_outbox_sync_lifecycle_update' },
        { type: 'trigger', name: 'trg_canonical_outbox_sync_semantic_immutable' },
      ]);
    } finally {
      sqlite.close();
    }
  });

  it('requires complete claim evidence only while processing', () => {
    const sqlite = harness();
    try {
      insertPending(sqlite);
      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events
        SET status='processing',locked_at_utc=?,locked_by='worker-1',updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run(NOW, NOW)).toThrow(/claim evidence/i);

      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events
        SET status='processing',claim_public_id='123',locked_at_utc=?,locked_by='worker-1',
            claim_expires_at_utc='2026-07-25T10:05:00Z',updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run(NOW, NOW)).toThrow(/check/i);

      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events
        SET status='processing',claim_public_id='claim-1',locked_at_utc=?,locked_by='worker-1',
            claim_expires_at_utc='2026-07-25T09:59:59Z',updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run(NOW, NOW)).toThrow(/claim evidence/i);

      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events
        SET status='processing',claim_public_id='claim-1',locked_at_utc=?,locked_by='worker-1',
            claim_expires_at_utc='2026-07-25T10:05:00Z',updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run(NOW, NOW)).not.toThrow();

      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events SET status='pending',updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run(NOW)).toThrow(/claim evidence/i);
    } finally {
      sqlite.close();
    }
  });

  it('requires exact publication and failure evidence for terminal/retry states', () => {
    const sqlite = harness();
    try {
      insertPending(sqlite);
      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events
        SET status='published',published_at_utc=?,updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run(NOW, NOW)).toThrow(/publication evidence/i);

      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events
        SET status='published',published_at_utc=?,published_envelope_sha256=?,updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-1'
      `).run(NOW, HASH, NOW)).not.toThrow();

      insertPending(sqlite, 'event-2');
      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events SET status='retry',available_at_utc='2026-07-25T10:10:00Z',
          updated_at_utc=? WHERE tenant_id='100' AND event_public_id='event-2'
      `).run(NOW)).toThrow(/error evidence/i);
      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events SET status='retry',available_at_utc='2026-07-25T10:10:00Z',
          last_error_code='SYNC_DELIVERY_FAILED',last_error_summary='sanitized',last_error_sha256=?,
          updated_at_utc=? WHERE tenant_id='100' AND event_public_id='event-2'
      `).run(HASH, NOW)).not.toThrow();

      insertPending(sqlite, 'event-3');
      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events SET status='dead_letter',
          last_error_code='SYNC_DELIVERY_FAILED',last_error_sha256=?,updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-3'
      `).run(HASH, NOW)).not.toThrow();

      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events SET status='pending',updated_at_utc=?
        WHERE tenant_id='100' AND event_public_id='event-2'
      `).run(NOW)).toThrow(/error evidence/i);
    } finally {
      sqlite.close();
    }
  });

  it('prevents lifecycle updates from mutating semantic outbox authority', () => {
    const sqlite = harness();
    try {
      insertPending(sqlite);
      for (const sql of [
        `UPDATE canonical_outbox_events SET payload_json='{"changed":true}' WHERE event_public_id='event-1'`,
        `UPDATE canonical_outbox_events SET aggregate_public_id='invoice-2' WHERE event_public_id='event-1'`,
        `UPDATE canonical_outbox_events SET event_type='canonical.invoice.cancelled' WHERE event_public_id='event-1'`,
        `UPDATE canonical_outbox_events SET idempotency_key='changed-idem' WHERE event_public_id='event-1'`,
      ]) {
        expect(() => sqlite.prepare(sql).run()).toThrow(/semantic authority is immutable/i);
      }
      expect(() => sqlite.prepare(`
        UPDATE canonical_outbox_events SET available_at_utc='2026-07-25T10:10:00Z',updated_at_utc=?
        WHERE event_public_id='event-1'
      `).run(NOW)).not.toThrow();
    } finally {
      sqlite.close();
    }
  });
});
