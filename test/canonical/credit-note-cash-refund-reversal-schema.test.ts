import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const MIGRATIONS = [
  '0505_canonical_program_foundation.sql',
  '0506_canonical_practitioners.sql',
  '0507_canonical_encounters.sql',
  '0508_canonical_service_catalog.sql',
  '0509_canonical_service_requests_events.sql',
  '0510_canonical_invoices.sql',
  '0511_canonical_payments.sql',
  '0512_canonical_adjustments.sql',
  '0513_canonical_practitioner_compensation.sql',
  '0514_canonical_inventory_links.sql',
  '0515_canonical_accounting_outbox.sql',
  '0533_canonical_credit_note_cash_refunds.sql',
  '0550_canonical_credit_note_cash_refund_reversals.sql',
] as const;

function openDatabase(): DatabaseSync {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of MIGRATIONS) {
    const path = `migrations/${migration}`;
    expect(existsSync(path), `${path} should exist`).toBe(true);
    sqlite.exec(readFileSync(path, 'utf8'));
  }
  return sqlite;
}

function columns(sqlite: DatabaseSync, table: string): string[] {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

describe('canonical credit-note cash-refund reversal schema', () => {
  it('creates immutable tenant-scoped reversal authority', () => {
    const sqlite = openDatabase();
    try {
      expect(columns(sqlite, 'canonical_credit_note_cash_refund_reversals')).toEqual(expect.arrayContaining([
        'tenant_id',
        'reversal_public_id',
        'idempotency_key',
        'refund_public_id',
        'credit_note_public_id',
        'invoice_public_id',
        'amount_minor',
        'currency_code',
        'reason_code',
        'reversed_at_utc',
        'business_date',
        'actor_user_id',
        'source_evidence_sha256',
        'reconciliation_guard',
      ]));

      const indexes = sqlite.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='index' AND tbl_name='canonical_credit_note_cash_refund_reversals'
      `).all() as Array<{ name: string }>;
      expect(indexes.map((row) => row.name)).toEqual(expect.arrayContaining([
        'uq_canonical_credit_note_cash_refund_reversals_public_id',
        'uq_canonical_credit_note_cash_refund_reversals_key',
        'uq_canonical_credit_note_cash_refund_reversals_refund',
      ]));
    } finally {
      sqlite.close();
    }
  });
});
