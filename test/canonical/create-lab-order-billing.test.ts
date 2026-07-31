import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import { CanonicalIdempotencyConflictError } from '../../src/lib/canonical/idempotency';
import {
  createLabOrderBilling,
  type CreateLabOrderBillingInput,
} from '../../src/lib/canonical/commands/create-lab-order-billing';

type SqlValue = string | number | bigint | null | Uint8Array;
const NOW = '2026-07-24T03:00:00.000Z';
const DATE = '2026-07-24';
const HASH = 'a'.repeat(64);

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
    CREATE TABLE lab_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,order_no TEXT NOT NULL,tenant_id TEXT NOT NULL
    );
    CREATE TABLE lab_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,lab_order_id INTEGER NOT NULL,lab_test_id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,status TEXT NOT NULL,
      FOREIGN KEY (lab_order_id) REFERENCES lab_orders(id)
    );
    CREATE TABLE legacy_financial (tenant_id TEXT NOT NULL, source_id TEXT NOT NULL UNIQUE);
    INSERT INTO billing_service_departments VALUES (10,'100','LAB','Laboratory',1);
    INSERT INTO billing_service_items VALUES
      (20,'100',10,'CBC','Complete Blood Count',500,1),
      (21,'100',10,'CRP','C Reactive Protein',300,1);
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

function baseInput(overrides: Partial<CreateLabOrderBillingInput> = {}): CreateLabOrderBillingInput {
  const base: CreateLabOrderBillingInput = {
    tenantId: '100',
    commandIdempotencyKey: 'lab-order-billing:LO-1:INV-1',
    orderNo: 'LO-1',
    invoiceNo: 'INV-1',
    legacyPatientId: 501,
    legacyVisitId: null,
    orderingClinicianDoctorId: null,
    orderedAtUtc: NOW,
    businessDate: DATE,
    items: [
      {
        lineNumber: 1,
        duplicateOrdinal: 0,
        labTestId: 301,
        billingServiceItemId: 20,
        name: 'Complete Blood Count',
        category: 'Hematology',
        grossMinor: 50_000,
        discountMinor: 5_000,
      },
      {
        lineNumber: 2,
        duplicateOrdinal: 0,
        labTestId: 302,
        billingServiceItemId: 21,
        name: 'C Reactive Protein',
        category: 'Biochemistry',
        grossMinor: 30_000,
        discountMinor: 0,
      },
    ],
  };
  return { ...base, ...overrides, items: overrides.items ?? base.items };
}

function legacyStatements(db: CanonicalBatchDatabase) {
  return [
    db.prepare("INSERT INTO lab_orders (order_no,tenant_id) VALUES ('LO-1','100')"),
    db.prepare(`
      INSERT INTO lab_order_items (lab_order_id,lab_test_id,tenant_id,status)
      SELECT id,301,'100','pending' FROM lab_orders WHERE tenant_id='100' AND order_no='LO-1'
    `),
    db.prepare(`
      INSERT INTO lab_order_items (lab_order_id,lab_test_id,tenant_id,status)
      SELECT id,302,'100','pending' FROM lab_orders WHERE tenant_id='100' AND order_no='LO-1'
    `),
    db.prepare("INSERT INTO legacy_financial (tenant_id,source_id) VALUES ('100','INV-1')"),
  ];
}

function count(sqlite: DatabaseSync, table: string): number {
  return Number((sqlite.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
}

describe('createLabOrderBilling', () => {
  it('creates service requests, accepted events, gross/discount invoice lines, and actual item mappings', async () => {
    const { sqlite, db } = harness();
    try {
      const result = await createLabOrderBilling(db, baseInput(), {
        authoritativeStatements: legacyStatements(db),
      });
      expect(result.result).toMatchObject({
        orderNo: 'LO-1', invoiceNo: 'INV-1', totalMinor: 75_000,
      });
      expect(count(sqlite, 'canonical_service_requests')).toBe(2);
      expect(count(sqlite, 'canonical_service_events')).toBe(2);
      expect(sqlite.prepare(`
        SELECT status,fulfilled_quantity FROM canonical_service_requests ORDER BY id LIMIT 1
      `).get()).toEqual({ status: 'active', fulfilled_quantity: 0 });
      expect(sqlite.prepare(`
        SELECT event_type,status FROM canonical_service_events ORDER BY id LIMIT 1
      `).get()).toEqual({ event_type: 'accepted', status: 'posted' });
      expect(sqlite.prepare(`
        SELECT subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor
        FROM canonical_invoices
      `).get()).toEqual({
        subtotal_minor: 80_000, adjustment_total_minor: -5_000,
        total_minor: 75_000, paid_minor: 0, due_minor: 75_000,
      });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_invoice_lines WHERE line_type='service'
      `).get()).toEqual({ count: 2 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) count FROM canonical_invoice_lines WHERE line_type='discount'
      `).get()).toEqual({ count: 1 });
      expect(sqlite.prepare(`
        SELECT entity_type,source_public_id FROM canonical_source_mappings
        WHERE source_type='legacy_lab_order_item'
        ORDER BY entity_type,source_public_id
      `).all()).toEqual([
        { entity_type: 'service_event', source_public_id: '1' },
        { entity_type: 'service_event', source_public_id: '2' },
        { entity_type: 'service_request', source_public_id: '1' },
        { entity_type: 'service_request', source_public_id: '2' },
      ]);
    } finally { sqlite.close(); }
  });

  it('links visit encounter and ordering practitioner when exact mappings exist', async () => {
    const { sqlite, db } = harness();
    try {
      sqlite.exec(`
        INSERT INTO canonical_encounters (
          tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,started_at_utc,source_evidence_sha256
        ) VALUES ('100','enc-visit-77',501,'outpatient','in_progress','2026-07-24T02:00:00.000Z','${HASH}');
        INSERT INTO canonical_practitioners (
          tenant_id,practitioner_public_id,practitioner_kind,display_name,status
        ) VALUES ('100','prc-doctor-9','internal','Dr Nine','active');
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,
          mapping_status,mapping_version,evidence_sha256
        ) VALUES
          ('100','encounter','enc-visit-77','legacy_visit','77','visits','mapped',1,'${HASH}'),
          ('100','practitioner','prc-doctor-9','legacy_doctor','9','doctors','mapped',1,'${HASH}');
      `);
      await createLabOrderBilling(db, baseInput({
        legacyVisitId: 77,
        orderingClinicianDoctorId: 9,
      }), { authoritativeStatements: legacyStatements(db) });
      expect(sqlite.prepare(`
        SELECT DISTINCT encounter_public_id FROM canonical_service_requests
      `).get()).toEqual({ encounter_public_id: 'enc-visit-77' });
      expect(sqlite.prepare(`
        SELECT practitioner_public_id,participant_role,evidence_type FROM canonical_service_participants
        ORDER BY id LIMIT 1
      `).get()).toEqual({
        practitioner_public_id: 'prc-doctor-9', participant_role: 'ordering', evidence_type: 'legacy_lab_orderer',
      });
    } finally { sqlite.close(); }
  });

  it('fails before authoritative writes when required encounter or practitioner mapping is missing', async () => {
    const { sqlite, db } = harness();
    try {
      await expect(createLabOrderBilling(db, baseInput({ legacyVisitId: 77 }), {
        authoritativeStatements: legacyStatements(db),
      })).rejects.toThrow(/encounter mapping/i);
      expect(count(sqlite, 'lab_orders')).toBe(0);
      await expect(createLabOrderBilling(db, baseInput({ orderingClinicianDoctorId: 9 }), {
        authoritativeStatements: legacyStatements(db),
      })).rejects.toThrow(/practitioner mapping/i);
      expect(count(sqlite, 'lab_orders')).toBe(0);
    } finally { sqlite.close(); }
  });

  it('replays the same request and rejects changed financial content under the same key', async () => {
    const { sqlite, db } = harness();
    try {
      const first = await createLabOrderBilling(db, baseInput(), {
        authoritativeStatements: legacyStatements(db),
      });
      const replay = await createLabOrderBilling(db, baseInput(), {
        authoritativeStatements: legacyStatements(db),
      });
      expect(first.status).toBe('applied');
      expect(replay.status).toBe('replayed');
      expect(count(sqlite, 'canonical_invoices')).toBe(1);
      await expect(createLabOrderBilling(db, baseInput({
        items: [{ ...baseInput().items[0], grossMinor: 51_000 }],
      }))).rejects.toBeInstanceOf(CanonicalIdempotencyConflictError);
    } finally { sqlite.close(); }
  });
});
