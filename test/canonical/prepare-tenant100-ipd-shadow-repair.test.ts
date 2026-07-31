import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { CanonicalBatchDatabase, CanonicalPreparedStatement } from '../../src/lib/canonical/command-batch';
import {
  applyTenant100IpdShadowRepair,
  type Tenant100IpdShadowRepairDatabase,
} from '../../scripts/canonical/prepare-tenant100-ipd-shadow-repair';

type SqlValue = string | number | bigint | null | Uint8Array;

class Statement implements CanonicalPreparedStatement {
  constructor(private readonly sqlite: DatabaseSync, readonly sql: string, readonly params: SqlValue[] = []) {}
  bind(...values: unknown[]): Statement {
    return new Statement(this.sqlite, this.sql, values.map((value) => value === undefined ? null : value) as SqlValue[]);
  }
  async run() {
    const result = this.sqlite.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes ?? 0), last_row_id: Number(result.lastInsertRowid ?? 0) } };
  }
  async first<T = Record<string, unknown>>(): Promise<T | null> {
    return (this.sqlite.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    return { results: this.sqlite.prepare(this.sql).all(...this.params) as T[] };
  }
}

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
  '0532_canonical_financial_batch_assertions.sql',
  '0535_canonical_invoice_encounter_links.sql',
] as const;

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys=ON');
  for (const migration of MIGRATIONS) sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
  sqlite.exec(`
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL, invoice_no TEXT NOT NULL, subtotal REAL NOT NULL,
      discount REAL NOT NULL, total REAL NOT NULL, paid REAL NOT NULL, due REAL NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE admissions (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, admission_no TEXT NOT NULL,
      patient_id INTEGER NOT NULL, admission_type TEXT NOT NULL, status TEXT NOT NULL,
      admission_date TEXT NOT NULL, discharge_date TEXT NOT NULL
    );
    CREATE TABLE billing_provisional_items (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL, item_category TEXT NOT NULL, item_name TEXT NOT NULL,
      department TEXT, unit_price REAL NOT NULL, quantity INTEGER NOT NULL,
      discount_amount REAL NOT NULL, total_amount REAL NOT NULL, doctor_id INTEGER,
      doctor_name TEXT, reference_id INTEGER, bill_status TEXT NOT NULL, billed_bill_id INTEGER
    );
    CREATE TABLE patient_bed_infos (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      admission_id INTEGER NOT NULL, bed_id INTEGER NOT NULL, ward_name TEXT,
      bed_number TEXT, bed_type TEXT, started_on TEXT NOT NULL, ended_on TEXT,
      charge_amount REAL NOT NULL, is_billed INTEGER NOT NULL, billed_bill_id INTEGER
    );
    CREATE TABLE billing_deposits (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, patient_id INTEGER NOT NULL,
      deposit_receipt_no TEXT NOT NULL, amount REAL NOT NULL, transaction_type TEXT NOT NULL,
      reference_bill_id INTEGER, created_at TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY, tenant_id TEXT NOT NULL, bill_id INTEGER NOT NULL,
      amount REAL NOT NULL, receipt_no TEXT, date TEXT
    );
  `);

  const cases = [
    [7065, 'BL-000025', 13090, 'ADM-000065', 1326, 'planned', '2026-07-22 08:12:03', '2026-07-27 06:05:17', 300, 1608, 58, 12023, 'DEP-000049', 'DAD-000014', null],
    [7069, 'BL-000026', 13099, 'ADM-000068', 1186, 'planned', '2026-07-27 05:58:32', '2026-07-27 12:03:07', 300, 1745, 67, 12025, 'DEP-000052', 'DAD-000015', null],
    [7070, 'BL-000027', 13089, 'ADM-000064', 1262, 'planned', '2026-07-22 08:11:24', '2026-07-27 12:03:56', 300, 1607, 57, 12021, 'DEP-000048', 'DAD-000016', null],
    [7071, 'BL-000028', 13087, 'ADM-000063', 2263, 'emergency', '2026-07-21 15:07:51', '2026-07-27 12:05:05', 40000, 1541, 55, 12014, 'DEP-000046', 'DAD-000017', 'DRF-000005'],
  ] as const;

  for (const [billId, invoiceNo, admissionId, admissionNo, patientId, admissionType, admittedAt, dischargedAt, total, provisionalId, bedInfoId, bedId, depositNo, adjustmentNo, refundNo] of cases) {
    sqlite.prepare(`INSERT INTO bills VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      billId, '100', patientId, admissionId, invoiceNo, total, 0, total, 0, 0, 'paid', dischargedAt,
    );
    sqlite.prepare(`INSERT INTO admissions VALUES (?,?,?,?,?,?,?,?)`).run(
      admissionId, '100', admissionNo, patientId, admissionType, 'discharged', admittedAt, dischargedAt,
    );
    sqlite.prepare(`INSERT INTO billing_provisional_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      provisionalId, '100', patientId, admissionId, billId === 7071 ? 'test' : 'admission',
      billId === 7071 ? 'Diagnostic service' : 'Admission Fee', billId === 7071 ? 'Laboratory' : 'Reception',
      total, 1, 0, total, null, null, billId === 7071 ? 45 : null, 'finalized', billId,
    );
    sqlite.prepare(`INSERT INTO patient_bed_infos VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      bedInfoId, '100', patientId, admissionId, bedId, 'Ward', `B-${bedInfoId}`, 'general', admittedAt, dischargedAt, 0, 1, billId,
    );
    const requested = total + (refundNo ? 10000 : 0);
    sqlite.prepare(`INSERT INTO billing_deposits VALUES (?,?,?,?,?,?,?,?,1)`).run(
      10_000 + billId, '100', patientId, depositNo, requested, 'deposit', null, admittedAt,
    );
    sqlite.prepare(`INSERT INTO billing_deposits VALUES (?,?,?,?,?,?,?,?,1)`).run(
      20_000 + billId, '100', patientId, adjustmentNo, total, 'adjustment', billId, dischargedAt,
    );
    if (refundNo) sqlite.prepare(`INSERT INTO billing_deposits VALUES (?,?,?,?,?,?,?,?,1)`).run(
      30_000 + billId, '100', patientId, refundNo, 10000, 'refund', null, dischargedAt,
    );
    const minor = requested * 100;
    sqlite.prepare(`
      INSERT INTO canonical_payment_receipts (
        tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
        total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
        business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
        refunded_minor,net_received_minor,refund_projection_guard
      ) VALUES (?,?,?,?,?, ?,0,?,'posted',?,?,?,1,?,0,?,1)
    `).run(
      '100', `receipt-${billId}`, depositNo, patientId, 'BDT', minor, minor,
      '2026-07-21T03:00:00.000Z', '2026-07-21', '2026-07-21T03:00:00.000Z', 'a'.repeat(64), minor,
    );
    sqlite.prepare(`
      INSERT INTO canonical_deposits (
        tenant_id,deposit_public_id,deposit_number,receipt_public_id,legacy_patient_id,
        currency_code,amount_minor,applied_minor,refunded_minor,available_minor,status,
        received_at_utc,business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,'BDT',?,0,0,?,'posted',?,?,?,1,?)
    `).run(
      '100', `dep-${billId}`, depositNo, `receipt-${billId}`, patientId,
      minor, minor, '2026-07-21T03:00:00.000Z', '2026-07-21', '2026-07-21T03:00:00.000Z', 'a'.repeat(64),
    );
  }

  sqlite.exec(`
    INSERT INTO canonical_encounters (
      tenant_id,encounter_public_id,legacy_patient_id,encounter_type,status,started_at_utc,source_evidence_sha256
    ) VALUES ('100','enc-existing-emergency',2263,'emergency','in_progress','2026-07-21T09:07:51.000Z','${'b'.repeat(64)}');
    INSERT INTO canonical_encounter_admission_links (
      tenant_id,encounter_public_id,legacy_admission_id,admission_no,link_status,source_evidence_sha256
    ) VALUES ('100','enc-existing-emergency',13087,'ADM-000063','active','${'c'.repeat(64)}');
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES ('100','encounter','enc-existing-emergency','legacy_admission','13087','admissions','mapped',1,'${'c'.repeat(64)}');
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,issue_type,issue_code,entity_type,entity_public_id,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,summary
    ) VALUES (
      '100','issue-ipd','financial_shadow_write','CANONICAL_SHADOW_WRITE_FAILED',
      'financial_boundary','ipd-discharge.billing.finalize','runtime_shadow_write',
      'ipd-discharge.billing.finalize','${'d'.repeat(64)}','error','open',4,'shadow failure'
    );
  `);

  const db: Tenant100IpdShadowRepairDatabase & CanonicalBatchDatabase = {
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

describe('Tenant 100 IPD shadow repair', () => {
  it('repairs exactly four discharge projections and replays with zero new business rows', async () => {
    const { sqlite, db } = fixture();
    try {
      const first = await applyTenant100IpdShadowRepair(db, '2026-07-27T18:45:00.000Z');
      const countsAfterFirst = sqlite.prepare(`
        SELECT
          (SELECT COUNT(*) FROM canonical_invoices WHERE tenant_id='100') AS invoices,
          (SELECT COUNT(*) FROM canonical_invoice_encounter_links WHERE tenant_id='100') AS links,
          (SELECT COUNT(*) FROM canonical_refunds WHERE tenant_id='100') AS refunds,
          (SELECT COUNT(*) FROM canonical_deposit_applications WHERE tenant_id='100') AS applications
      `).get();
      const second = await applyTenant100IpdShadowRepair(db, '2026-07-27T18:45:00.000Z');

      expect(first).toMatchObject({ repairedInvoices: 4, repairedRefunds: 1, resolvedIssues: 1 });
      expect(second).toMatchObject({ repairedInvoices: 0, repairedRefunds: 0, resolvedIssues: 0 });
      expect(countsAfterFirst).toEqual({ invoices: 4, links: 4, refunds: 1, applications: 4 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_invoices
        WHERE tenant_id='100' AND status='posted' AND paid_minor=total_minor AND due_minor=0
      `).get()).toEqual({ count: 4 });
      expect(sqlite.prepare(`
        SELECT SUM(total_minor) AS total, SUM(paid_minor) AS paid
        FROM canonical_invoices WHERE tenant_id='100'
      `).get()).toEqual({ total: 4090000, paid: 4090000 });
      expect(sqlite.prepare(`
        SELECT SUM(amount_minor) AS applied FROM canonical_deposit_applications WHERE tenant_id='100'
      `).get()).toEqual({ applied: 4090000 });
      expect(sqlite.prepare(`
        SELECT SUM(amount_minor) AS refunded FROM canonical_refunds WHERE tenant_id='100'
      `).get()).toEqual({ refunded: 1000000 });
      expect(sqlite.prepare(`
        SELECT COUNT(*) AS count FROM canonical_encounters
        WHERE tenant_id='100' AND status='completed' AND ended_at_utc IS NOT NULL
      `).get()).toEqual({ count: 4 });
      expect(sqlite.prepare(`
        SELECT status,resolution_code FROM canonical_processing_issues WHERE issue_public_id='issue-ipd'
      `).get()).toEqual({ status: 'resolved', resolution_code: 'IPD_SHADOW_REPAIR_RECONCILED' });
    } finally {
      sqlite.close();
    }
  });

  it('fails closed when any exact source bill changes', async () => {
    const { sqlite, db } = fixture();
    try {
      sqlite.prepare(`UPDATE bills SET total=301 WHERE id=7065`).run();
      await expect(applyTenant100IpdShadowRepair(db, '2026-07-27T18:45:00.000Z'))
        .rejects.toThrow(/source contract/i);
      expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM canonical_invoices`).get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });
});
