import { existsSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migrationPath = 'migrations/0501_collection_cases.sql';

function openMigratedDatabase(): DatabaseSync {
  expect(existsSync(migrationPath), `${migrationPath} should exist`).toBe(true);

  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  sqlite.exec(readFileSync(migrationPath, 'utf8'));
  return sqlite;
}

function insertCase(
  sqlite: DatabaseSync,
  input: {
    tenantId: string;
    canonicalInvoicePublicId?: string | null;
    legacyBillId?: number | null;
    status?: string;
    promiseAmountMinor?: number | null;
    currencyCode?: string | null;
    nextFollowupAtUtc?: string | null;
  },
): number {
  const result = sqlite.prepare(`
    INSERT INTO collection_cases (
      tenant_id,
      canonical_invoice_public_id,
      legacy_bill_id,
      status,
      promise_amount_minor,
      currency_code,
      next_followup_at_utc
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.tenantId,
    input.canonicalInvoicePublicId ?? null,
    input.legacyBillId ?? null,
    input.status ?? 'new',
    input.promiseAmountMinor ?? null,
    input.currencyCode ?? null,
    input.nextFollowupAtUtc ?? null,
  );

  return Number(result.lastInsertRowid);
}

describe('collection case migration', () => {
  it('creates canonical-ready workflow tables without storing authoritative balances', () => {
    const sqlite = openMigratedDatabase();
    const rows = sqlite.prepare(`
      SELECT name, sql
      FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('collection_cases', 'collection_case_events')
      ORDER BY name
    `).all() as Array<{ name: string; sql: string }>;

    expect(rows.map((row) => row.name)).toEqual([
      'collection_case_events',
      'collection_cases',
    ]);

    const caseSql = rows.find((row) => row.name === 'collection_cases')?.sql ?? '';
    const normalizedCaseSql = caseSql.replace(/\s+/g, ' ');

    expect(normalizedCaseSql).toContain("source_type TEXT NOT NULL DEFAULT 'invoice' CHECK(source_type = 'invoice')");
    expect(normalizedCaseSql).toContain('canonical_invoice_public_id TEXT');
    expect(normalizedCaseSql).toContain('legacy_bill_id INTEGER');
    expect(normalizedCaseSql).toContain('promise_amount_minor INTEGER');
    expect(normalizedCaseSql).toContain('currency_code TEXT');
    expect(normalizedCaseSql).toContain(
      "CHECK(status IN ( 'new','contact_due','contacted','promised','disputed','escalated','write_off_requested','closed' ))",
    );
    expect(normalizedCaseSql).toContain(
      'CHECK(canonical_invoice_public_id IS NOT NULL OR legacy_bill_id IS NOT NULL)',
    );
    expect(normalizedCaseSql).toContain('CHECK(legacy_bill_id IS NULL OR legacy_bill_id > 0)');
    expect(normalizedCaseSql).toContain(
      'CHECK(promise_amount_minor IS NULL OR promise_amount_minor > 0)',
    );
    expect(normalizedCaseSql).toContain(
      'CHECK(currency_code IS NULL OR (length(currency_code) = 3 AND currency_code = upper(currency_code)))',
    );
    expect(normalizedCaseSql).toContain('UNIQUE(tenant_id, id)');

    expect(caseSql).not.toContain('total_minor');
    expect(caseSql).not.toContain('paid_minor');
    expect(caseSql).not.toContain('due_minor');
    expect(caseSql).not.toContain('total REAL');
    expect(caseSql).not.toContain('paid REAL');
    expect(caseSql).not.toContain('due REAL');
    expect(caseSql).not.toContain('promise_amount REAL');

    const eventSql = rows.find((row) => row.name === 'collection_case_events')?.sql ?? '';
    const normalizedEventSql = eventSql.replace(/\s+/g, ' ');
    expect(normalizedEventSql).toContain('CHECK(json_valid(metadata_json))');
    expect(normalizedEventSql).toContain(
      'FOREIGN KEY(tenant_id, case_id) REFERENCES collection_cases(tenant_id, id)',
    );
  });

  it('enforces one workflow case per canonical or legacy invoice within a tenant', () => {
    const sqlite = openMigratedDatabase();

    insertCase(sqlite, {
      tenantId: 'tenant-a',
      canonicalInvoicePublicId: 'inv-public-001',
      legacyBillId: 101,
    });

    expect(() => insertCase(sqlite, {
      tenantId: 'tenant-a',
      canonicalInvoicePublicId: 'inv-public-001',
      legacyBillId: 102,
    })).toThrow(/UNIQUE constraint failed/);

    expect(() => insertCase(sqlite, {
      tenantId: 'tenant-a',
      canonicalInvoicePublicId: 'inv-public-002',
      legacyBillId: 101,
    })).toThrow(/UNIQUE constraint failed/);

    insertCase(sqlite, {
      tenantId: 'tenant-b',
      canonicalInvoicePublicId: 'inv-public-001',
      legacyBillId: 101,
    });
  });

  it('rejects missing source identity, invalid lifecycle money, currency, and UTC values', () => {
    const sqlite = openMigratedDatabase();

    expect(() => insertCase(sqlite, { tenantId: 'tenant-a' })).toThrow(/CHECK constraint failed/);
    expect(() => insertCase(sqlite, {
      tenantId: 'tenant-a',
      legacyBillId: 0,
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertCase(sqlite, {
      tenantId: 'tenant-a',
      legacyBillId: 1,
      status: 'overdue',
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertCase(sqlite, {
      tenantId: 'tenant-a',
      legacyBillId: 2,
      promiseAmountMinor: 0,
      currencyCode: 'BDT',
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertCase(sqlite, {
      tenantId: 'tenant-a',
      legacyBillId: 3,
      promiseAmountMinor: 1000,
      currencyCode: 'bdt',
    })).toThrow(/CHECK constraint failed/);
    expect(() => insertCase(sqlite, {
      tenantId: 'tenant-a',
      legacyBillId: 4,
      nextFollowupAtUtc: '2026-07-15 10:00:00',
    })).toThrow(/CHECK constraint failed/);

    insertCase(sqlite, {
      tenantId: 'tenant-a',
      legacyBillId: 5,
      promiseAmountMinor: 1000,
      currencyCode: 'BDT',
      nextFollowupAtUtc: '2026-07-15T04:00:00.000Z',
    });
  });

  it('enforces event JSON validity and the composite tenant boundary', () => {
    const sqlite = openMigratedDatabase();
    const caseId = insertCase(sqlite, {
      tenantId: 'tenant-a',
      canonicalInvoicePublicId: 'inv-public-001',
      legacyBillId: 101,
    });

    const insertEvent = sqlite.prepare(`
      INSERT INTO collection_case_events (
        tenant_id,
        case_id,
        event_type,
        metadata_json
      ) VALUES (?, ?, ?, ?)
    `);

    expect(() => insertEvent.run(
      'tenant-a',
      caseId,
      'contacted',
      '{invalid',
    )).toThrow(/CHECK constraint failed/);

    expect(() => insertEvent.run(
      'tenant-b',
      caseId,
      'contacted',
      '{}',
    )).toThrow(/FOREIGN KEY constraint failed/);

    insertEvent.run(
      'tenant-a',
      caseId,
      'contacted',
      JSON.stringify({ channel: 'phone' }),
    );
  });

  it('creates tenant queue, source, and timeline indexes', () => {
    const sqlite = openMigratedDatabase();
    const indexes = sqlite.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'index'
        AND (
          name LIKE 'idx_collection_%'
          OR name LIKE 'uq_collection_%'
        )
      ORDER BY name
    `).all() as Array<{ name: string }>;

    expect(indexes.map((row) => row.name)).toEqual([
      'idx_collection_case_events_case_created',
      'idx_collection_cases_assignee_status',
      'idx_collection_cases_status_followup',
      'uq_collection_cases_canonical_invoice',
      'uq_collection_cases_legacy_bill',
    ]);
  });
});
