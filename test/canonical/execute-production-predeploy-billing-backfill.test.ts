import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  PREDEPLOY_BILLING_BACKFILL_APPROVAL,
  buildPredeployBillingBackfillExpectedState,
  buildPredeployBillingBackfillSql,
  executePredeployBillingBackfill,
  type PredeployBillingBackfillGateway,
  type PredeployBillingBackfillState,
} from '../../scripts/canonical/execute-production-predeploy-billing-backfill';
import {
  CDB101_PRODUCTION_DATABASE_ID,
  CDB101_PRODUCTION_DATABASE_NAME,
} from '../../scripts/canonical/production-cutover-contract';

function emptyState(): PredeployBillingBackfillState {
  return {
    bill_id: 6917,
    patient_id: 1995,
    invoice_no: 'INV-A-2026-000037',
    invoice_code: 'BL',
    discount: 100,
    discount_reason: null,
    discount_by_name: 'Sir',
    tax_total: null,
    total: 400,
    paid: 400,
    due: 0,
    bill_status: 'paid',
    bill_cancelled_at: null,
    bill_created_by: 103,
    bill_created_at: '2026-07-22 17:07:53',
    bill_updated_at: '2026-07-22 11:07:53',
    referring_doctor_id: null,
    bill_counter_id: 2,
    bill_counter_session_id: 28,
    item_id: 3078,
    item_category: 'doctor_visit',
    item_description: 'Consultation - Dr. Aminul Islam',
    item_quantity: 1,
    item_unit_price: 500,
    item_line_total: 400,
    item_reference_id: 101,
    item_status: 'active',
    item_cancelled_at: null,
    item_tax_amount: null,
    item_created_at: '2026-07-22 17:07:53',
    payment_id: 1907,
    payment_amount: 400,
    payment_type: 'current',
    payment_legacy_type: 'current',
    receipt_no: 'RCP-000269',
    payment_received_by: 103,
    payment_method: 'cash',
    payment_idempotency_key: null,
    payment_external_transaction_id: null,
    payment_counter_id: 2,
    payment_counter_session_id: 28,
    payment_source: 'reception',
    payment_date: '2026-07-22 17:07:53',
    payment_created_at: '2026-07-22 11:07:53',
    invoice_public_id: null,
    invoice_subtotal_minor: null,
    invoice_adjustment_total_minor: null,
    invoice_total_minor: null,
    invoice_paid_minor: null,
    invoice_due_minor: null,
    invoice_net_due_minor: null,
    canonical_invoice_status: null,
    invoice_source_evidence_sha256: null,
    gross_line_public_id: null,
    gross_line_amount_minor: null,
    gross_line_source_evidence_sha256: null,
    discount_line_public_id: null,
    discount_line_amount_minor: null,
    discount_line_source_evidence_sha256: null,
    canonical_invoice_line_count: 0,
    invoice_mapping_count: 0,
    invoice_mapping_public_id: null,
    invoice_mapping_evidence_sha256: null,
    receipt_public_id: null,
    receipt_total_minor: null,
    receipt_allocated_total_minor: null,
    receipt_unallocated_minor: null,
    canonical_receipt_status: null,
    receipt_source_evidence_sha256: null,
    tender_public_id: null,
    tender_amount_minor: null,
    tender_remaining_minor: null,
    tender_source_evidence_sha256: null,
    tender_count: 0,
    allocation_public_id: null,
    allocation_amount_minor: null,
    allocation_due_before_minor: null,
    allocation_due_after_minor: null,
    allocation_balance_guard: null,
    allocation_source_evidence_sha256: null,
    allocation_count: 0,
    payment_mapping_count: 0,
    payment_mapping_public_id: null,
    payment_mapping_evidence_sha256: null,
  };
}

async function completeState(): Promise<PredeployBillingBackfillState> {
  const expected = await buildPredeployBillingBackfillExpectedState(emptyState());
  return {
    ...emptyState(),
    invoice_public_id: expected.invoice.invoicePublicId,
    invoice_subtotal_minor: 50_000,
    invoice_adjustment_total_minor: -10_000,
    invoice_total_minor: 40_000,
    invoice_paid_minor: 40_000,
    invoice_due_minor: 0,
    invoice_net_due_minor: 0,
    canonical_invoice_status: 'posted',
    invoice_source_evidence_sha256: expected.invoice.sourceEvidenceSha256,
    gross_line_public_id: expected.grossLine.linePublicId,
    gross_line_amount_minor: 50_000,
    gross_line_source_evidence_sha256: expected.grossLine.sourceEvidenceSha256,
    discount_line_public_id: expected.discountLine.linePublicId,
    discount_line_amount_minor: -10_000,
    discount_line_source_evidence_sha256: expected.discountLine.sourceEvidenceSha256,
    canonical_invoice_line_count: 2,
    invoice_mapping_count: 1,
    invoice_mapping_public_id: expected.invoice.invoicePublicId,
    invoice_mapping_evidence_sha256: expected.invoice.sourceEvidenceSha256,
    receipt_public_id: expected.payment.receiptPublicId,
    receipt_total_minor: 40_000,
    receipt_allocated_total_minor: 40_000,
    receipt_unallocated_minor: 0,
    canonical_receipt_status: 'posted',
    receipt_source_evidence_sha256: expected.payment.sourceEvidenceSha256,
    tender_public_id: expected.tender.tenderPublicId,
    tender_amount_minor: 40_000,
    tender_remaining_minor: 40_000,
    tender_source_evidence_sha256: expected.tender.sourceEvidenceSha256,
    tender_count: 1,
    allocation_public_id: expected.allocation.allocationPublicId,
    allocation_amount_minor: 40_000,
    allocation_due_before_minor: 40_000,
    allocation_due_after_minor: 0,
    allocation_balance_guard: 1,
    allocation_source_evidence_sha256: expected.allocation.sourceEvidenceSha256,
    allocation_count: 1,
    payment_mapping_count: 1,
    payment_mapping_public_id: expected.payment.receiptPublicId,
    payment_mapping_evidence_sha256: expected.payment.sourceEvidenceSha256,
  };
}

function createSchema(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE bills (
      id INTEGER PRIMARY KEY, tenant_id TEXT, patient_id INTEGER, invoice_no TEXT, invoice_code TEXT,
      discount REAL, discount_reason TEXT, discount_by_name TEXT, tax_total REAL, total REAL,
      paid REAL, due REAL, status TEXT, cancelled_at TEXT, created_by INTEGER, created_at TEXT,
      updated_at TEXT, referring_doctor_id INTEGER, counter_id INTEGER, counter_session_id INTEGER
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY, bill_id INTEGER, tenant_id TEXT, item_category TEXT, description TEXT,
      quantity INTEGER, unit_price INTEGER, line_total INTEGER, reference_id INTEGER, status TEXT,
      cancelled_at TEXT, tax_amount REAL, created_at TEXT
    );
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY, bill_id INTEGER, tenant_id TEXT, amount REAL, payment_type TEXT,
      type TEXT, receipt_no TEXT, received_by INTEGER, payment_method TEXT, idempotency_key TEXT,
      external_transaction_id TEXT, counter_id INTEGER, counter_session_id INTEGER,
      payment_source TEXT, date TEXT, created_at TEXT
    );
    CREATE TABLE canonical_invoices (
      tenant_id TEXT NOT NULL, invoice_public_id TEXT NOT NULL, invoice_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL, currency_code TEXT NOT NULL, subtotal_minor INTEGER NOT NULL,
      adjustment_total_minor INTEGER NOT NULL, total_minor INTEGER NOT NULL, paid_minor INTEGER NOT NULL,
      due_minor INTEGER NOT NULL, credited_minor INTEGER NOT NULL, net_due_minor INTEGER NOT NULL,
      adjustment_projection_guard INTEGER NOT NULL, status TEXT NOT NULL, issued_at_utc TEXT NOT NULL,
      posted_at_utc TEXT, cancelled_at_utc TEXT, reversed_at_utc TEXT,
      source_evidence_sha256 TEXT NOT NULL, created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id, invoice_public_id), UNIQUE (tenant_id, invoice_number)
    );
    CREATE TABLE canonical_invoice_lines (
      tenant_id TEXT NOT NULL, line_public_id TEXT NOT NULL, invoice_public_id TEXT NOT NULL,
      line_type TEXT NOT NULL, service_event_public_id TEXT, adjustment_code TEXT,
      quantity INTEGER NOT NULL, unit_amount_minor INTEGER NOT NULL, line_amount_minor INTEGER NOT NULL,
      source_evidence_sha256 TEXT NOT NULL, created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id, line_public_id)
    );
    CREATE TABLE canonical_payment_receipts (
      tenant_id TEXT NOT NULL, receipt_public_id TEXT NOT NULL, receipt_number TEXT NOT NULL,
      legacy_patient_id INTEGER NOT NULL, currency_code TEXT NOT NULL, total_minor INTEGER NOT NULL,
      allocated_total_minor INTEGER NOT NULL, unallocated_minor INTEGER NOT NULL, status TEXT NOT NULL,
      received_at_utc TEXT NOT NULL, business_date TEXT NOT NULL, legacy_collector_id INTEGER,
      legacy_counter_id INTEGER, legacy_counter_session_id INTEGER, external_transaction_id TEXT,
      posted_at_utc TEXT, failed_at_utc TEXT, refunded_minor INTEGER NOT NULL,
      net_received_minor INTEGER NOT NULL, refund_projection_guard INTEGER NOT NULL,
      reconciliation_guard INTEGER NOT NULL, source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id, receipt_public_id), UNIQUE (tenant_id, receipt_number)
    );
    CREATE TABLE canonical_payment_tenders (
      tenant_id TEXT NOT NULL, tender_public_id TEXT NOT NULL, receipt_public_id TEXT NOT NULL,
      tender_type TEXT NOT NULL, method_code TEXT NOT NULL, amount_minor INTEGER NOT NULL,
      status TEXT NOT NULL, external_transaction_id TEXT, captured_at_utc TEXT, failed_at_utc TEXT,
      reversed_minor INTEGER NOT NULL, remaining_minor INTEGER NOT NULL,
      reversal_projection_guard INTEGER NOT NULL, source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id, tender_public_id)
    );
    CREATE TABLE canonical_payment_allocations (
      tenant_id TEXT NOT NULL, allocation_public_id TEXT NOT NULL, receipt_public_id TEXT NOT NULL,
      invoice_public_id TEXT NOT NULL, invoice_line_public_id TEXT, amount_minor INTEGER NOT NULL,
      invoice_due_before_minor INTEGER NOT NULL, invoice_due_after_minor INTEGER NOT NULL,
      status TEXT NOT NULL, allocated_at_utc TEXT NOT NULL, reversed_minor INTEGER NOT NULL,
      remaining_minor INTEGER NOT NULL, reversal_projection_guard INTEGER NOT NULL,
      balance_guard INTEGER NOT NULL, source_evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id, allocation_public_id)
    );
    CREATE TABLE canonical_source_mappings (
      tenant_id TEXT NOT NULL, entity_type TEXT NOT NULL, canonical_public_id TEXT NOT NULL,
      source_type TEXT NOT NULL, source_public_id TEXT NOT NULL, source_table TEXT NOT NULL,
      mapping_status TEXT NOT NULL, mapping_version INTEGER NOT NULL, evidence_sha256 TEXT NOT NULL,
      created_at_utc TEXT NOT NULL, updated_at_utc TEXT NOT NULL,
      UNIQUE (tenant_id, entity_type, source_type, source_public_id)
    );
  `);
}

function seedSource(database: DatabaseSync): void {
  const row = emptyState();
  database.prepare(`
    INSERT INTO bills VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    row.bill_id, '100', row.patient_id, row.invoice_no, row.invoice_code, row.discount,
    row.discount_reason, row.discount_by_name, row.tax_total, row.total, row.paid, row.due,
    row.bill_status, row.bill_cancelled_at, row.bill_created_by, row.bill_created_at,
    row.bill_updated_at, row.referring_doctor_id, row.bill_counter_id, row.bill_counter_session_id,
  );
  database.prepare(`INSERT INTO invoice_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.item_id, row.bill_id, '100', row.item_category, row.item_description, row.item_quantity,
    row.item_unit_price, row.item_line_total, row.item_reference_id, row.item_status,
    row.item_cancelled_at, row.item_tax_amount, row.item_created_at,
  );
  database.prepare(`INSERT INTO payments VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.payment_id, row.bill_id, '100', row.payment_amount, row.payment_type,
    row.payment_legacy_type, row.receipt_no, row.payment_received_by, row.payment_method,
    row.payment_idempotency_key, row.payment_external_transaction_id, row.payment_counter_id,
    row.payment_counter_session_id, row.payment_source, row.payment_date, row.payment_created_at,
  );
}

describe('production pre-deploy billing backfill', () => {
  it('creates the exact live-compatible invoice, lines, receipt, tender, allocation and mappings', async () => {
    let state = emptyState();
    let writes = 0;
    const gateway: PredeployBillingBackfillGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readState() {
        return state;
      },
      async writeRepair(sql) {
        writes += 1;
        expect(sql).toContain("b.id=6917");
        expect(sql).toContain("p.id=1907");
        expect(sql).toContain("ii.id=3078");
        state = await completeState();
        return { changes: 1, rowsWritten: 8 };
      },
    };

    const result = await executePredeployBillingBackfill({
      approval: PREDEPLOY_BILLING_BACKFILL_APPROVAL,
      execute: true,
    }, gateway);

    expect(result).toMatchObject({ repaired: true, execution: 'created', canonicalRowsCreated: 8 });
    expect(writes).toBe(1);
  });

  it('verifies exact existing state without another write and rejects partial state', async () => {
    let writes = 0;
    const exactGateway: PredeployBillingBackfillGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readState() {
        return completeState();
      },
      async writeRepair() {
        writes += 1;
        return { changes: 0, rowsWritten: 0 };
      },
    };
    await expect(executePredeployBillingBackfill({
      approval: PREDEPLOY_BILLING_BACKFILL_APPROVAL,
      execute: true,
    }, exactGateway)).resolves.toMatchObject({ repaired: true, execution: 'verified_existing' });
    expect(writes).toBe(0);

    const partialGateway: PredeployBillingBackfillGateway = {
      ...exactGateway,
      async readState() {
        return { ...emptyState(), invoice_mapping_count: 1 };
      },
    };
    await expect(executePredeployBillingBackfill({
      approval: PREDEPLOY_BILLING_BACKFILL_APPROVAL,
      execute: true,
    }, partialGateway)).rejects.toThrow(/partial canonical state/i);
  });

  it('executes guarded SQL against SQLite and creates final reconciled balances', async () => {
    const database = new DatabaseSync(':memory:');
    createSchema(database);
    seedSource(database);

    database.exec(await buildPredeployBillingBackfillSql(emptyState(), '2026-07-22T11:45:00.000Z'));

    expect(database.prepare("SELECT COUNT(*) count FROM canonical_invoices WHERE tenant_id='100'").get()).toMatchObject({ count: 1 });
    expect(database.prepare("SELECT subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,net_due_minor FROM canonical_invoices").get()).toMatchObject({
      subtotal_minor: 50_000,
      adjustment_total_minor: -10_000,
      total_minor: 40_000,
      paid_minor: 40_000,
      due_minor: 0,
      net_due_minor: 0,
    });
    expect(database.prepare("SELECT COUNT(*) count FROM canonical_invoice_lines").get()).toMatchObject({ count: 2 });
    expect(database.prepare("SELECT SUM(line_amount_minor) total FROM canonical_invoice_lines").get()).toMatchObject({ total: 40_000 });
    expect(database.prepare("SELECT total_minor,allocated_total_minor,unallocated_minor,status FROM canonical_payment_receipts").get()).toMatchObject({
      total_minor: 40_000,
      allocated_total_minor: 40_000,
      unallocated_minor: 0,
      status: 'posted',
    });
    expect(database.prepare("SELECT amount_minor,remaining_minor,status FROM canonical_payment_tenders").get()).toMatchObject({
      amount_minor: 40_000,
      remaining_minor: 40_000,
      status: 'captured',
    });
    expect(database.prepare("SELECT amount_minor,invoice_due_before_minor,invoice_due_after_minor,balance_guard FROM canonical_payment_allocations").get()).toMatchObject({
      amount_minor: 40_000,
      invoice_due_before_minor: 40_000,
      invoice_due_after_minor: 0,
      balance_guard: 1,
    });
    expect(database.prepare("SELECT COUNT(*) count FROM canonical_source_mappings").get()).toMatchObject({ count: 2 });
    database.close();
  });

  it('fails before write for wrong approval or source drift', async () => {
    let writes = 0;
    const gateway: PredeployBillingBackfillGateway = {
      async readDatabaseIdentity() {
        return { uuid: CDB101_PRODUCTION_DATABASE_ID, name: CDB101_PRODUCTION_DATABASE_NAME };
      },
      async readState() {
        return { ...emptyState(), payment_amount: 401 };
      },
      async writeRepair() {
        writes += 1;
        return { changes: 1, rowsWritten: 8 };
      },
    };
    await expect(executePredeployBillingBackfill({ approval: 'wrong', execute: true }, gateway)).rejects.toThrow(/approval/i);
    await expect(executePredeployBillingBackfill({
      approval: PREDEPLOY_BILLING_BACKFILL_APPROVAL,
      execute: true,
    }, gateway)).rejects.toThrow(/source state/i);
    expect(writes).toBe(0);
  });
});
