import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  createRadiologyRequisitionBilling,
  type CreateRadiologyRequisitionBillingInput,
} from '../../src/lib/canonical/commands/create-radiology-requisition-billing';

type SqlValue = string | number | bigint | null | Uint8Array;
const NOW = '2026-07-24T03:00:00.000Z';
const DATE = '2026-07-24';

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, values.map((value) => value === undefined ? null : value) as SqlValue[]);
  }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
}

function harness() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of [
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
    '0532_canonical_financial_batch_assertions.sql',
  ]) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE billing_service_departments (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,department_code TEXT,department_name TEXT,is_active INTEGER
    );
    CREATE TABLE billing_service_items (
      id INTEGER PRIMARY KEY,tenant_id TEXT NOT NULL,service_department_id INTEGER NOT NULL,
      item_code TEXT NOT NULL,item_name TEXT NOT NULL,price REAL NOT NULL,is_active INTEGER NOT NULL
    );
    CREATE TABLE radiology_requisitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,accession_no TEXT NOT NULL,tenant_id TEXT NOT NULL
    );
    CREATE TABLE legacy_financial (tenant_id TEXT NOT NULL, source_id TEXT NOT NULL UNIQUE);
    INSERT INTO billing_service_departments VALUES (10,'100','RAD','Radiology',1);
    INSERT INTO billing_service_items VALUES (20,'100',10,'XR-CHEST','Chest X-Ray',1200,1);
  `);
  const db: CanonicalBatchDatabase = {
    prepare(sql: string) { return new Statement(sqlite, sql); },
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

function baseInput(overrides: Partial<CreateRadiologyRequisitionBillingInput> = {}): CreateRadiologyRequisitionBillingInput {
  return {
    tenantId: '100',
    commandIdempotencyKey: 'radiology-requisition-billing:RADACC-1:INV-1',
    accessionNo: 'RADACC-1',
    invoiceNo: 'INV-1',
    legacyPatientId: 501,
    imagingItemId: 301,
    billingServiceItemId: 20,
    displayName: 'Chest X-Ray',
    totalMinor: 120_000,
    requestedAtUtc: NOW,
    businessDate: DATE,
    ...overrides,
  };
}

function authoritativeStatements(db: CanonicalBatchDatabase) {
  return [
    db.prepare("INSERT INTO radiology_requisitions (accession_no,tenant_id) VALUES ('RADACC-1','100')"),
    db.prepare("INSERT INTO legacy_financial (tenant_id,source_id) VALUES ('100','INV-1')"),
  ];
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('createRadiologyRequisitionBilling', () => {
  it('creates request, accepted event, positive invoice and actual requisition mappings', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await createRadiologyRequisitionBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      });
      expect(result.result).toMatchObject({
        accessionNo: 'RADACC-1', invoiceNo: 'INV-1', totalMinor: 120_000,
      });
      expect(count(sqlite, 'canonical_service_requests')).toBe(1);
      expect(count(sqlite, 'canonical_service_events')).toBe(1);
      expect(sqlite.prepare(`
        SELECT status,fulfilled_quantity FROM canonical_service_requests
      `).get()).toEqual({ status: 'active', fulfilled_quantity: 0 });
      expect(sqlite.prepare(`
        SELECT event_type,status FROM canonical_service_events
      `).get()).toEqual({ event_type: 'accepted', status: 'posted' });
      expect(sqlite.prepare(`
        SELECT subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor
        FROM canonical_invoices
      `).get()).toEqual({
        subtotal_minor: 120_000, adjustment_total_minor: 0,
        total_minor: 120_000, paid_minor: 0, due_minor: 120_000,
      });
      expect(sqlite.prepare(`
        SELECT entity_type,source_public_id FROM canonical_source_mappings
        WHERE source_type='legacy_radiology_requisition'
        ORDER BY entity_type
      `).all()).toEqual([
        { entity_type: 'service_event', source_public_id: '1' },
        { entity_type: 'service_request', source_public_id: '1' },
      ]);
    } finally { sqlite.close(); }
  });

  it('replays identical evidence and rejects changed financial content under the same key', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await createRadiologyRequisitionBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      });
      const replay = await createRadiologyRequisitionBilling(db, baseInput(), {
        authoritativeStatements: authoritativeStatements(db),
      });
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      await expect(createRadiologyRequisitionBilling(db, baseInput({ totalMinor: 121_000 })))
        .rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally { sqlite.close(); }
  });

  it('rolls back requisition and canonical facts when an authoritative statement fails', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(createRadiologyRequisitionBilling(db, baseInput(), {
        authoritativeStatements: [
          db.prepare("INSERT INTO radiology_requisitions (accession_no,tenant_id) VALUES ('RADACC-1','100')"),
          db.prepare('INSERT INTO missing_authority VALUES (1)'),
        ],
      })).rejects.toThrow();
      expect(count(sqlite, 'radiology_requisitions')).toBe(0);
      expect(count(sqlite, 'canonical_service_requests')).toBe(0);
      expect(count(sqlite, 'canonical_invoices')).toBe(0);
      expect(count(sqlite, 'canonical_outbox_events')).toBe(0);
    } finally { sqlite.close(); }
  });
});
