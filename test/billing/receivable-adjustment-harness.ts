import { readFileSync } from 'node:fs';
import type { D1Database } from '@cloudflare/workers-types';
import { createSqliteD1Harness } from '../helpers/sqlite-d1';

const canonicalMigrations = [
  '0505_canonical_program_foundation.sql',
  '0506_canonical_practitioners.sql',
  '0507_canonical_encounters.sql',
  '0508_canonical_service_catalog.sql',
  '0509_canonical_service_requests_events.sql',
  '0510_canonical_invoices.sql',
  '0511_canonical_payments.sql',
  '0512_canonical_adjustments.sql',
  '0513_canonical_practitioner_compensation.sql',
] as const;

export function createReceivableAdjustmentHarness(options: { canonical?: boolean } = {}) {
  const harness = createSqliteD1Harness();
  const { sqlite } = harness;

  sqlite.exec(`
    CREATE TABLE patients (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      name TEXT,
      mobile TEXT,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE bills (
      id INTEGER NOT NULL,
      tenant_id TEXT NOT NULL,
      invoice_no TEXT NOT NULL,
      patient_id INTEGER NOT NULL,
      total REAL NOT NULL,
      paid REAL NOT NULL,
      due REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, id)
    );

    CREATE TABLE billing_credit_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      credit_note_no TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      patient_id INTEGER NOT NULL,
      reason TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      refund_amount REAL NOT NULL DEFAULT 0,
      payment_mode TEXT,
      remarks TEXT,
      is_active INTEGER DEFAULT 1,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now', '+6 hours')),
      counter_id INTEGER,
      counter_session_id INTEGER,
      status TEXT DEFAULT 'approved',
      approved_by INTEGER,
      approved_at TEXT
    );

    CREATE TABLE income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      source TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      bill_id INTEGER,
      tenant_id TEXT NOT NULL,
      created_by INTEGER
    );

    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      user_id INTEGER,
      action TEXT NOT NULL,
      table_name TEXT NOT NULL,
      record_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT
    );

    CREATE TABLE fiscal_years (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      is_closed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE accounting_period_closes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      fiscal_year_id INTEGER,
      period_name TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE accounting_posting_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      source_event_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id INTEGER,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_by TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      UNIQUE (tenant_id, source_event_key)
    );

    CREATE TABLE diagnostic_performer_reserves (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      bill_id INTEGER NOT NULL,
      invoice_item_id INTEGER,
      settlement_id INTEGER,
      status TEXT NOT NULL
    );

    CREATE TABLE doctor_commission_accruals (
      tenant_id TEXT NOT NULL,
      bill_id INTEGER,
      status TEXT NOT NULL
    );
  `);

  sqlite.exec(readFileSync('migrations/0223_billing_mutation_idempotency.sql', 'utf8'));

  if (options.canonical !== false) {
    for (const migration of canonicalMigrations) {
      sqlite.exec(readFileSync(`migrations/${migration}`, 'utf8'));
    }
  }

  return harness;
}

export function seedLegacyBill(
  sqlite: ReturnType<typeof createReceivableAdjustmentHarness>['sqlite'],
  input: {
    tenantId?: string;
    billId?: number;
    invoiceNo?: string;
    patientId?: number;
    total?: number;
    paid?: number;
    due?: number;
    status?: string;
  } = {},
): void {
  const tenantId = input.tenantId ?? 'tenant-a';
  const patientId = input.patientId ?? 101;
  sqlite.prepare(`
    INSERT OR IGNORE INTO patients (tenant_id, id, name, mobile)
    VALUES (?, ?, ?, ?)
  `).run(tenantId, patientId, `Patient ${patientId}`, '01700000000');
  sqlite.prepare(`
    INSERT INTO bills (
      tenant_id, id, invoice_no, patient_id, total, paid, due, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    tenantId,
    input.billId ?? 77,
    input.invoiceNo ?? 'INV-77',
    patientId,
    input.total ?? 100,
    input.paid ?? 20,
    input.due ?? 80,
    input.status ?? 'partially_paid',
    '2026-07-20 10:00:00',
  );
}

export function seedCanonicalInvoice(
  sqlite: ReturnType<typeof createReceivableAdjustmentHarness>['sqlite'],
  input: {
    tenantId?: string;
    invoicePublicId?: string;
    invoiceNumber?: string;
    patientId?: number;
    totalMinor?: number;
    paidMinor?: number;
    creditedMinor?: number;
    status?: 'posted' | 'cancelled' | 'reversed';
    legacyBillId?: number;
  } = {},
): void {
  const tenantId = input.tenantId ?? 'tenant-a';
  const invoicePublicId = input.invoicePublicId ?? 'inv-public-77';
  const patientId = input.patientId ?? 101;
  const totalMinor = input.totalMinor ?? 10000;
  const paidMinor = input.paidMinor ?? 2000;
  const creditedMinor = input.creditedMinor ?? 0;
  const dueMinor = totalMinor - paidMinor;
  const netDueMinor = dueMinor - creditedMinor;
  const status = input.status ?? 'posted';
  const postedAt = '2026-07-20T04:00:00.000Z';
  const cancelledAt = status === 'cancelled' ? '2026-07-21T04:00:00.000Z' : null;
  const reversedAt = status === 'reversed' ? '2026-07-21T04:00:00.000Z' : null;

  sqlite.prepare(`
    INSERT OR IGNORE INTO patients (tenant_id, id, name, mobile)
    VALUES (?, ?, ?, ?)
  `).run(tenantId, patientId, `Patient ${patientId}`, '01700000000');
  sqlite.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id, invoice_public_id, invoice_number, legacy_patient_id, currency_code,
      subtotal_minor, adjustment_total_minor, total_minor, paid_minor, due_minor,
      credited_minor, net_due_minor, adjustment_projection_guard, status,
      issued_at_utc, posted_at_utc, cancelled_at_utc, reversed_at_utc,
      source_evidence_sha256
    ) VALUES (?, ?, ?, ?, 'BDT', ?, 0, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)
  `).run(
    tenantId,
    invoicePublicId,
    input.invoiceNumber ?? 'INV-77',
    patientId,
    totalMinor,
    totalMinor,
    paidMinor,
    dueMinor,
    creditedMinor,
    netDueMinor,
    status,
    '2026-07-20T04:00:00.000Z',
    postedAt,
    cancelledAt,
    reversedAt,
    'a'.repeat(64),
  );

  if (input.legacyBillId !== undefined) {
    sqlite.prepare(`
      INSERT INTO canonical_source_mappings (
        tenant_id, entity_type, canonical_public_id, source_type, source_public_id,
        source_table, mapping_status, mapping_version, evidence_sha256
      ) VALUES (?, 'invoice', ?, 'legacy_bill', ?, 'bills', 'mapped', 1, ?)
    `).run(tenantId, invoicePublicId, String(input.legacyBillId), 'b'.repeat(64));
  }
}

export function setReceivableMode(
  sqlite: ReturnType<typeof createReceivableAdjustmentHarness>['sqlite'],
  mode: 'legacy' | 'shadow' | 'canonical',
  tenantId = 'tenant-a',
): void {
  sqlite.prepare(`
    INSERT INTO canonical_feature_flags (
      tenant_id, flag_key, domain, mode, is_enabled
    ) VALUES (?, 'billing.receivables', 'billing', ?, 1)
    ON CONFLICT(tenant_id, flag_key) DO UPDATE SET mode=excluded.mode, is_enabled=1
  `).run(tenantId, mode);
}

export function baseAdjustmentInput(db: D1Database, overrides: Record<string, unknown> = {}) {
  return {
    db,
    tenantId: 'tenant-a',
    source: { sourceType: 'invoice' as const, legacyBillId: 77 },
    amountMinor: 3000,
    currencyCode: 'BDT',
    reasonCode: 'uncollectible',
    note: 'Collection recovery is no longer reasonably expected.',
    actorId: 12,
    sourceType: 'receivable_write_off' as const,
    sourceRequestId: 9001,
    idempotencyKey: 'receivable-write-off:9001',
    ...overrides,
  };
}
