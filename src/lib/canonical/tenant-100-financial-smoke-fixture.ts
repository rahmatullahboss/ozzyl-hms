import type {
  CanonicalBatchDatabase,
  CanonicalPreparedStatement,
} from './command-batch';
import { createRequestFingerprint } from './idempotency';

const TENANT_ID = '100' as const;
const FIXTURE_REASON = 'CDB101_SAFE_REVERSIBLE_SMOKE';
const ACCOUNTING_EVENTS_TABLE = 'accounting_posting_events';

export interface Tenant100FinancialSmokeFixtureInput {
  tenantId: '100';
  runId: string;
  patientId: number;
  actorId: number;
  amountMinor: number;
  atUtc: string;
  businessDate: string;
  expectedWorkerVersionTag: string;
  actualWorkerVersionTag: string;
}

export interface Tenant100FinancialSmokeFixtureResult {
  tenantId: '100';
  runId: string;
  candidateVersionBound: true;
  lifecycleVerified: true;
  cleanupVerified: true;
  patientRowsCreated: 0;
  legacyRemainingRows: 0;
  canonicalRemainingRows: 0;
  accountingRemainingRows: 0;
  fixtureInvoiceNumber: string;
  fixtureReceiptNumber: string;
  sourceEvidenceSha256: string;
}

interface FixtureIds {
  prefix: string;
  invoiceNumber: string;
  invoicePublicId: string;
  linePublicId: string;
  receiptNumber: string;
  receiptPublicId: string;
  tenderPublicId: string;
  allocationPublicId: string;
  reversalPublicId: string;
  refundPublicId: string;
  paymentIdempotencyKey: string;
  externalTransactionId: string;
  incomeDescription: string;
  reversalIncomeDescription: string;
}

interface CollisionRow {
  collision_count: number;
}

interface RemainingStateRow {
  legacy_remaining_rows: number;
  canonical_remaining_rows: number;
  accounting_remaining_rows: number;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function normalizedUtc(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new RangeError('atUtc must be a normalized UTC ISO timestamp');
  }
  return value;
}

function validBusinessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError('businessDate must use YYYY-MM-DD');
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

function fixtureIds(runId: string): FixtureIds {
  if (!/^[a-z0-9][a-z0-9-]{4,62}[a-z0-9]$/.test(runId)) {
    throw new RangeError('runId must use 6-64 lowercase letters, numbers, or hyphens');
  }
  const prefix = `cdb-smoke-${runId}`;
  return {
    prefix,
    invoiceNumber: `CDBSMOKE-I-${runId}`,
    invoicePublicId: `${prefix}-invoice`,
    linePublicId: `${prefix}-line`,
    receiptNumber: `CDBSMOKE-R-${runId}`,
    receiptPublicId: `${prefix}-receipt`,
    tenderPublicId: `${prefix}-tender`,
    allocationPublicId: `${prefix}-allocation`,
    reversalPublicId: `${prefix}-reversal`,
    refundPublicId: `${prefix}-refund`,
    paymentIdempotencyKey: `${prefix}-payment`,
    externalTransactionId: `${prefix}-external`,
    incomeDescription: `${prefix}:payment`,
    reversalIncomeDescription: `${prefix}:reversal`,
  };
}

function bind(
  db: CanonicalBatchDatabase,
  sql: string,
  ...values: unknown[]
): CanonicalPreparedStatement {
  return db.prepare(sql).bind(...values);
}

async function assertPreconditions(
  db: CanonicalBatchDatabase,
  input: Tenant100FinancialSmokeFixtureInput,
  ids: FixtureIds,
): Promise<void> {
  if (input.tenantId !== TENANT_ID) {
    throw new Error('Safe financial smoke fixture is restricted to tenant 100');
  }
  if (exact(input.expectedWorkerVersionTag, 'expectedWorkerVersionTag')
      !== exact(input.actualWorkerVersionTag, 'actualWorkerVersionTag')) {
    throw new Error('Candidate Worker version tag does not match the protected expected Worker version tag');
  }

  const patient = await db.prepare(`
    SELECT 1 AS present
    FROM patients
    WHERE id=? AND CAST(tenant_id AS TEXT)=?
    LIMIT 1
  `).bind(input.patientId, TENANT_ID).first<{ present: number }>();
  if (!patient) throw new Error('Existing tenant-100 smoke patient was not found');

  const collision = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?)
      + (SELECT COUNT(*) FROM invoice_items WHERE CAST(tenant_id AS TEXT)=? AND description=?)
      + (SELECT COUNT(*) FROM payments WHERE CAST(tenant_id AS TEXT)=? AND receipt_no=?)
      + (SELECT COUNT(*) FROM income WHERE CAST(tenant_id AS TEXT)=? AND description IN (?,?))
      + (SELECT COUNT(*) FROM ${ACCOUNTING_EVENTS_TABLE}
         WHERE tenant_id=? AND source_type='billing' AND event_type='bill_created'
           AND json_extract(payload_json,'$.invoiceNo')=?)
      + (SELECT COUNT(*) FROM canonical_invoices WHERE tenant_id=? AND invoice_public_id=?)
      + (SELECT COUNT(*) FROM canonical_invoice_lines WHERE tenant_id=? AND line_public_id=?)
      + (SELECT COUNT(*) FROM canonical_payment_receipts WHERE tenant_id=? AND receipt_public_id=?)
      + (SELECT COUNT(*) FROM canonical_payment_tenders WHERE tenant_id=? AND tender_public_id=?)
      + (SELECT COUNT(*) FROM canonical_payment_allocations WHERE tenant_id=? AND allocation_public_id=?)
      + (SELECT COUNT(*) FROM canonical_payment_reversals WHERE tenant_id=? AND reversal_public_id=?)
      + (SELECT COUNT(*) FROM canonical_refunds WHERE tenant_id=? AND refund_public_id=?)
      AS collision_count
  `).bind(
    TENANT_ID, ids.invoiceNumber,
    TENANT_ID, `${ids.prefix}:fixture-item`,
    TENANT_ID, ids.receiptNumber,
    TENANT_ID, ids.incomeDescription, ids.reversalIncomeDescription,
    TENANT_ID, ids.invoiceNumber,
    TENANT_ID, ids.invoicePublicId,
    TENANT_ID, ids.linePublicId,
    TENANT_ID, ids.receiptPublicId,
    TENANT_ID, ids.tenderPublicId,
    TENANT_ID, ids.allocationPublicId,
    TENANT_ID, ids.reversalPublicId,
    TENANT_ID, ids.refundPublicId,
  ).first<CollisionRow>();
  if (Number(collision?.collision_count ?? 0) !== 0) {
    throw new Error('Financial smoke runId already exists or collides with prior fixture evidence');
  }
}

function lifecycleStatements(
  db: CanonicalBatchDatabase,
  input: Tenant100FinancialSmokeFixtureInput,
  ids: FixtureIds,
  evidenceSha256: string,
): CanonicalPreparedStatement[] {
  const amountMajor = input.amountMinor / 100;
  return [
    bind(db, `
      INSERT INTO bills (
        patient_id,invoice_no,total,paid,due,status,tenant_id,created_by
      ) VALUES (?,?,?,0,?,'open',?,?)
    `, input.patientId, ids.invoiceNumber, amountMajor, amountMajor, TENANT_ID, input.actorId),

    bind(db, `
      INSERT INTO invoice_items (
        bill_id,item_category,description,quantity,unit_price,line_total,status,tenant_id
      )
      SELECT id,'other',?,1,?,?,'active',?
      FROM bills
      WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?
    `, `${ids.prefix}:fixture-item`, amountMajor, amountMajor, TENANT_ID, TENANT_ID, ids.invoiceNumber),

    bind(db, `
      INSERT INTO canonical_invoices (
        tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
        subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,
        credited_minor,net_due_minor,status,issued_at_utc,posted_at_utc,
        source_evidence_sha256
      ) VALUES (?,?,?,?,?, ?,0,?,0,?, 0,?,'posted',?,?,?)
    `,
    TENANT_ID, ids.invoicePublicId, ids.invoiceNumber, input.patientId, 'BDT',
    input.amountMinor, input.amountMinor, input.amountMinor,
    input.amountMinor, input.atUtc, input.atUtc, evidenceSha256),

    bind(db, `
      INSERT INTO canonical_invoice_lines (
        tenant_id,line_public_id,invoice_public_id,line_type,adjustment_code,
        quantity,unit_amount_minor,line_amount_minor,source_evidence_sha256
      ) VALUES (?,?,?,'other_adjustment','CDB101_SMOKE',1,?,?,?)
    `, TENANT_ID, ids.linePublicId, ids.invoicePublicId, input.amountMinor, input.amountMinor, evidenceSha256),

    bind(db, `
      INSERT INTO payments (
        bill_id,amount,payment_type,receipt_no,idempotency_key,
        external_transaction_id,received_by,payment_method,date,tenant_id
      )
      SELECT id,?,'current',?,?,?,?,? ,?,?
      FROM bills
      WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?
    `,
    amountMajor, ids.receiptNumber, ids.paymentIdempotencyKey,
    ids.externalTransactionId, input.actorId, 'bank_transfer', input.businessDate,
    TENANT_ID, TENANT_ID, ids.invoiceNumber),

    bind(db, `
      INSERT INTO income (date,source,amount,description,bill_id,tenant_id,created_by)
      SELECT ?,'other',?,?,id,?,?
      FROM bills
      WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?
    `, input.businessDate, amountMajor, ids.incomeDescription, TENANT_ID, input.actorId, TENANT_ID, ids.invoiceNumber),

    bind(db, `
      UPDATE bills
      SET paid=?,due=0,status='paid'
      WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=? AND paid=0 AND due=?
    `, amountMajor, TENANT_ID, ids.invoiceNumber, amountMajor),

    bind(db, `
      INSERT INTO canonical_payment_receipts (
        tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
        total_minor,allocated_total_minor,unallocated_minor,refunded_minor,
        net_received_minor,status,received_at_utc,business_date,legacy_collector_id,
        external_transaction_id,posted_at_utc,reconciliation_guard,
        refund_projection_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?, ?,?,0,0,?, 'posted',?,?,?,?,?,1,1,?)
    `,
    TENANT_ID, ids.receiptPublicId, ids.receiptNumber, input.patientId, 'BDT',
    input.amountMinor, input.amountMinor, input.amountMinor,
    input.atUtc, input.businessDate, input.actorId, ids.externalTransactionId,
    input.atUtc, evidenceSha256),

    bind(db, `
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,reversed_minor,remaining_minor,status,external_transaction_id,
        captured_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,'bank_transfer','cdb_smoke',?,0,?,'captured',?,?,?)
    `,
    TENANT_ID, ids.tenderPublicId, ids.receiptPublicId,
    input.amountMinor, input.amountMinor, ids.externalTransactionId,
    input.atUtc, evidenceSha256),

    bind(db, `
      INSERT INTO canonical_payment_allocations (
        tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
        amount_minor,invoice_due_before_minor,invoice_due_after_minor,
        reversed_minor,remaining_minor,status,allocated_at_utc,balance_guard,
        source_evidence_sha256
      ) VALUES (?,?,?,?, ?,?,0, 0,?,'active',?,1,?)
    `,
    TENANT_ID, ids.allocationPublicId, ids.receiptPublicId, ids.invoicePublicId,
    input.amountMinor, input.amountMinor, input.amountMinor, input.atUtc, evidenceSha256),

    bind(db, `
      UPDATE canonical_invoices
      SET paid_minor=?,due_minor=0,net_due_minor=0
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
        AND paid_minor=0 AND due_minor=? AND net_due_minor=?
    `, input.amountMinor, TENANT_ID, ids.invoicePublicId, input.amountMinor, input.amountMinor),

    bind(db, `
      INSERT INTO canonical_payment_reversals (
        tenant_id,reversal_public_id,receipt_public_id,tender_public_id,
        allocation_public_id,invoice_public_id,amount_minor,reason_code,status,
        reversed_at_utc,business_date,allocation_reversed_before_minor,
        allocation_reversed_after_minor,tender_reversed_before_minor,
        tender_reversed_after_minor,receipt_refunded_before_minor,
        receipt_refunded_after_minor,invoice_paid_before_minor,
        invoice_paid_after_minor,invoice_due_before_minor,invoice_due_after_minor,
        invoice_net_due_before_minor,invoice_net_due_after_minor,
        compensation_guard,balance_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,'posted',?,?, 0,?,0,?,0,?, ?,0,0,?,0,?,1,1,?)
    `,
    TENANT_ID, ids.reversalPublicId, ids.receiptPublicId, ids.tenderPublicId,
    ids.allocationPublicId, ids.invoicePublicId, input.amountMinor, FIXTURE_REASON,
    input.atUtc, input.businessDate,
    input.amountMinor, input.amountMinor, input.amountMinor,
    input.amountMinor, input.amountMinor, input.amountMinor,
    evidenceSha256),

    bind(db, `
      INSERT INTO canonical_refunds (
        tenant_id,refund_public_id,source_type,receipt_public_id,tender_public_id,
        allocation_public_id,payment_reversal_public_id,amount_minor,tender_type,
        method_code,status,refunded_at_utc,business_date,liability_guard,
        source_evidence_sha256
      ) VALUES (?,?,'payment',?,?,?,?,?,'bank_transfer','cdb_smoke','posted',?,?,1,?)
    `,
    TENANT_ID, ids.refundPublicId, ids.receiptPublicId, ids.tenderPublicId,
    ids.allocationPublicId, ids.reversalPublicId, input.amountMinor,
    input.atUtc, input.businessDate, evidenceSha256),

    bind(db, `
      UPDATE canonical_payment_allocations
      SET reversed_minor=?,remaining_minor=0,status='reversed',reversed_at_utc=?
      WHERE tenant_id=? AND allocation_public_id=? AND status='active'
        AND reversed_minor=0 AND remaining_minor=?
    `, input.amountMinor, input.atUtc, TENANT_ID, ids.allocationPublicId, input.amountMinor),

    bind(db, `
      UPDATE canonical_payment_tenders
      SET reversed_minor=?,remaining_minor=0,status='reversed',reversed_at_utc=?
      WHERE tenant_id=? AND tender_public_id=? AND status='captured'
        AND reversed_minor=0 AND remaining_minor=?
    `, input.amountMinor, input.atUtc, TENANT_ID, ids.tenderPublicId, input.amountMinor),

    bind(db, `
      UPDATE canonical_payment_receipts
      SET refunded_minor=?,net_received_minor=0,status='reversed',reversed_at_utc=?
      WHERE tenant_id=? AND receipt_public_id=? AND status='posted'
        AND refunded_minor=0 AND net_received_minor=?
    `, input.amountMinor, input.atUtc, TENANT_ID, ids.receiptPublicId, input.amountMinor),

    bind(db, `
      UPDATE canonical_invoices
      SET paid_minor=0,due_minor=?,net_due_minor=?,status='cancelled',cancelled_at_utc=?
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
        AND paid_minor=? AND due_minor=0 AND net_due_minor=0
    `,
    input.amountMinor, input.amountMinor, input.atUtc,
    TENANT_ID, ids.invoicePublicId, input.amountMinor),

    bind(db, `
      UPDATE bills
      SET paid=0,due=?,status='cancelled',cancelled_by=?,cancelled_at=?,cancel_reason=?
      WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=? AND status='paid'
        AND paid=? AND due=0
    `,
    amountMajor, input.actorId, input.atUtc, FIXTURE_REASON,
    TENANT_ID, ids.invoiceNumber, amountMajor),

    bind(db, `
      UPDATE invoice_items
      SET status='cancelled',cancelled_by=?,cancelled_at=?,cancel_reason=?
      WHERE CAST(tenant_id AS TEXT)=?
        AND bill_id=(SELECT id FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=? LIMIT 1)
    `, input.actorId, input.atUtc, FIXTURE_REASON, TENANT_ID, TENANT_ID, ids.invoiceNumber),

    bind(db, `
      INSERT INTO income (date,source,amount,description,bill_id,tenant_id,created_by)
      SELECT ?,'other',?,?,id,?,?
      FROM bills
      WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?
    `,
    input.businessDate, -amountMajor, ids.reversalIncomeDescription,
    TENANT_ID, input.actorId, TENANT_ID, ids.invoiceNumber),

    bind(db, `
      UPDATE bills
      SET status=status
      WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?
        AND status='cancelled' AND ROUND(COALESCE(paid,0)*100)=0
        AND ROUND(COALESCE(due,0)*100)=? AND cancel_reason=?
        AND 1=(
          SELECT COUNT(*) FROM invoice_items ii
          WHERE CAST(ii.tenant_id AS TEXT)=? AND ii.bill_id=bills.id
            AND ii.status='cancelled' AND ii.cancel_reason=?
        )
        AND 1=(
          SELECT COUNT(*) FROM payments p
          WHERE CAST(p.tenant_id AS TEXT)=? AND p.bill_id=bills.id
            AND p.receipt_no=? AND ROUND(COALESCE(p.amount,0)*100)=?
        )
        AND 2=(
          SELECT COUNT(*) FROM income i
          WHERE CAST(i.tenant_id AS TEXT)=? AND i.bill_id=bills.id
            AND i.description IN (?,?)
        )
        AND 0=COALESCE((
          SELECT ROUND(SUM(COALESCE(i.amount,0))*100) FROM income i
          WHERE CAST(i.tenant_id AS TEXT)=? AND i.bill_id=bills.id
            AND i.description IN (?,?)
        ),0)
        AND 1=(
          SELECT COUNT(*) FROM canonical_invoices ci
          WHERE ci.tenant_id=? AND ci.invoice_public_id=?
            AND ci.status='cancelled' AND ci.total_minor=?
            AND ci.paid_minor=0 AND ci.due_minor=? AND ci.credited_minor=0
            AND ci.net_due_minor=?
        )
        AND 1=(
          SELECT COUNT(*) FROM canonical_invoice_lines cil
          WHERE cil.tenant_id=? AND cil.line_public_id=?
            AND cil.invoice_public_id=? AND cil.line_amount_minor=?
        )
        AND 1=(
          SELECT COUNT(*) FROM canonical_payment_receipts cpr
          WHERE cpr.tenant_id=? AND cpr.receipt_public_id=?
            AND cpr.status='reversed' AND cpr.total_minor=?
            AND cpr.allocated_total_minor=? AND cpr.unallocated_minor=0
            AND cpr.refunded_minor=? AND cpr.net_received_minor=0
        )
        AND 1=(
          SELECT COUNT(*) FROM canonical_payment_tenders cpt
          WHERE cpt.tenant_id=? AND cpt.tender_public_id=?
            AND cpt.receipt_public_id=? AND cpt.status='reversed'
            AND cpt.amount_minor=? AND cpt.reversed_minor=? AND cpt.remaining_minor=0
        )
        AND 1=(
          SELECT COUNT(*) FROM canonical_payment_allocations cpa
          WHERE cpa.tenant_id=? AND cpa.allocation_public_id=?
            AND cpa.receipt_public_id=? AND cpa.invoice_public_id=?
            AND cpa.status='reversed' AND cpa.amount_minor=?
            AND cpa.reversed_minor=? AND cpa.remaining_minor=0
        )
        AND 1=(
          SELECT COUNT(*) FROM canonical_payment_reversals cprv
          WHERE cprv.tenant_id=? AND cprv.reversal_public_id=?
            AND cprv.receipt_public_id=? AND cprv.tender_public_id=?
            AND cprv.allocation_public_id=? AND cprv.invoice_public_id=?
            AND cprv.status='posted' AND cprv.amount_minor=?
            AND cprv.allocation_reversed_after_minor=?
            AND cprv.tender_reversed_after_minor=?
            AND cprv.receipt_refunded_after_minor=?
            AND cprv.invoice_paid_after_minor=0
            AND cprv.invoice_due_after_minor=?
            AND cprv.invoice_net_due_after_minor=?
        )
        AND 1=(
          SELECT COUNT(*) FROM canonical_refunds cr
          WHERE cr.tenant_id=? AND cr.refund_public_id=?
            AND cr.source_type='payment' AND cr.status='posted'
            AND cr.receipt_public_id=? AND cr.tender_public_id=?
            AND cr.allocation_public_id=? AND cr.payment_reversal_public_id=?
            AND cr.amount_minor=?
        )
        AND 1=(
          SELECT COUNT(*) FROM ${ACCOUNTING_EVENTS_TABLE} ape
          WHERE ape.tenant_id=? AND ape.source_type='billing' AND ape.event_type='bill_created'
            AND ape.source_id=CAST(bills.id AS TEXT)
            AND ape.source_event_key='billing:' || bills.id || ':bill_created'
            AND ape.status='pending'
            AND json_extract(ape.payload_json,'$.invoiceNo')=?
            AND json_extract(ape.payload_json,'$.source')='db_trigger'
        )
    `,
    TENANT_ID, ids.invoiceNumber, input.amountMinor, FIXTURE_REASON,
    TENANT_ID, FIXTURE_REASON,
    TENANT_ID, ids.receiptNumber, input.amountMinor,
    TENANT_ID, ids.incomeDescription, ids.reversalIncomeDescription,
    TENANT_ID, ids.incomeDescription, ids.reversalIncomeDescription,
    TENANT_ID, ids.invoicePublicId, input.amountMinor, input.amountMinor, input.amountMinor,
    TENANT_ID, ids.linePublicId, ids.invoicePublicId, input.amountMinor,
    TENANT_ID, ids.receiptPublicId, input.amountMinor, input.amountMinor, input.amountMinor,
    TENANT_ID, ids.tenderPublicId, ids.receiptPublicId, input.amountMinor, input.amountMinor,
    TENANT_ID, ids.allocationPublicId, ids.receiptPublicId, ids.invoicePublicId,
    input.amountMinor, input.amountMinor,
    TENANT_ID, ids.reversalPublicId, ids.receiptPublicId, ids.tenderPublicId,
    ids.allocationPublicId, ids.invoicePublicId, input.amountMinor,
    input.amountMinor, input.amountMinor, input.amountMinor, input.amountMinor, input.amountMinor,
    TENANT_ID, ids.refundPublicId, ids.receiptPublicId, ids.tenderPublicId,
    ids.allocationPublicId, ids.reversalPublicId, input.amountMinor,
    TENANT_ID, ids.invoiceNumber),
  ];
}

function statementChangeCount(result: unknown): number {
  if (!result || typeof result !== 'object') return Number.NaN;
  const record = result as {
    changes?: unknown;
    meta?: { changes?: unknown };
  };
  const count = Number(record.meta?.changes ?? record.changes);
  return Number.isSafeInteger(count) && count >= 0 ? count : Number.NaN;
}

function assertAtomicFixtureBatchChanges(
  results: unknown[],
  lifecycleCount: number,
  cleanupCount: number,
): void {
  if (results.length !== lifecycleCount + cleanupCount) {
    throw new Error('Financial smoke atomic batch returned an unexpected result count');
  }
  for (let index = 0; index < results.length; index += 1) {
    const cleanupIndex = index - lifecycleCount;
    const expectedChanges = index === 0 || cleanupIndex === 8 ? 2 : 1;
    const actualChanges = statementChangeCount(results[index]);
    if (actualChanges !== expectedChanges) {
      throw new Error(
        `Financial smoke atomic batch invariant failed at statement ${index + 1}: expected ${expectedChanges} change(s), received ${String(actualChanges)}`,
      );
    }
  }
}

function cleanupStatements(
  db: CanonicalBatchDatabase,
  ids: FixtureIds,
): CanonicalPreparedStatement[] {
  return [
    bind(db, 'DELETE FROM canonical_refunds WHERE tenant_id=? AND refund_public_id=?', TENANT_ID, ids.refundPublicId),
    bind(db, 'DELETE FROM canonical_payment_reversals WHERE tenant_id=? AND reversal_public_id=?', TENANT_ID, ids.reversalPublicId),
    bind(db, 'DELETE FROM canonical_payment_allocations WHERE tenant_id=? AND allocation_public_id=?', TENANT_ID, ids.allocationPublicId),
    bind(db, 'DELETE FROM canonical_payment_tenders WHERE tenant_id=? AND tender_public_id=?', TENANT_ID, ids.tenderPublicId),
    bind(db, 'DELETE FROM canonical_payment_receipts WHERE tenant_id=? AND receipt_public_id=?', TENANT_ID, ids.receiptPublicId),
    bind(db, 'DELETE FROM canonical_invoice_lines WHERE tenant_id=? AND line_public_id=?', TENANT_ID, ids.linePublicId),
    bind(db, 'DELETE FROM canonical_invoices WHERE tenant_id=? AND invoice_public_id=?', TENANT_ID, ids.invoicePublicId),
    bind(db, `
      DELETE FROM ${ACCOUNTING_EVENTS_TABLE}
      WHERE tenant_id=? AND source_type='billing' AND event_type='bill_created'
        AND source_id=CAST((SELECT id FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=? LIMIT 1) AS TEXT)
        AND source_event_key='billing:' || (SELECT id FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=? LIMIT 1) || ':bill_created'
        AND json_extract(payload_json,'$.invoiceNo')=?
        AND json_extract(payload_json,'$.source')='db_trigger'
    `, TENANT_ID, TENANT_ID, ids.invoiceNumber, TENANT_ID, ids.invoiceNumber, ids.invoiceNumber),
    bind(db, `
      DELETE FROM income
      WHERE CAST(tenant_id AS TEXT)=?
        AND bill_id=(SELECT id FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=? LIMIT 1)
        AND description IN (?,?)
    `, TENANT_ID, TENANT_ID, ids.invoiceNumber, ids.incomeDescription, ids.reversalIncomeDescription),
    bind(db, 'DELETE FROM payments WHERE CAST(tenant_id AS TEXT)=? AND receipt_no=?', TENANT_ID, ids.receiptNumber),
    bind(db, `
      DELETE FROM invoice_items
      WHERE CAST(tenant_id AS TEXT)=?
        AND bill_id=(SELECT id FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=? LIMIT 1)
    `, TENANT_ID, TENANT_ID, ids.invoiceNumber),
    bind(db, 'DELETE FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?', TENANT_ID, ids.invoiceNumber),
  ];
}

async function readRemainingState(
  db: CanonicalBatchDatabase,
  ids: FixtureIds,
): Promise<RemainingStateRow> {
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM bills WHERE CAST(tenant_id AS TEXT)=? AND invoice_no=?)
      + (SELECT COUNT(*) FROM invoice_items WHERE CAST(tenant_id AS TEXT)=? AND description=?)
      + (SELECT COUNT(*) FROM payments WHERE CAST(tenant_id AS TEXT)=? AND receipt_no=?)
      + (SELECT COUNT(*) FROM income WHERE CAST(tenant_id AS TEXT)=? AND description IN (?,?))
      AS legacy_remaining_rows,
      (SELECT COUNT(*) FROM canonical_invoices WHERE tenant_id=? AND invoice_public_id=?)
      + (SELECT COUNT(*) FROM canonical_invoice_lines WHERE tenant_id=? AND line_public_id=?)
      + (SELECT COUNT(*) FROM canonical_payment_receipts WHERE tenant_id=? AND receipt_public_id=?)
      + (SELECT COUNT(*) FROM canonical_payment_tenders WHERE tenant_id=? AND tender_public_id=?)
      + (SELECT COUNT(*) FROM canonical_payment_allocations WHERE tenant_id=? AND allocation_public_id=?)
      + (SELECT COUNT(*) FROM canonical_payment_reversals WHERE tenant_id=? AND reversal_public_id=?)
      + (SELECT COUNT(*) FROM canonical_refunds WHERE tenant_id=? AND refund_public_id=?)
      AS canonical_remaining_rows,
      (SELECT COUNT(*) FROM ${ACCOUNTING_EVENTS_TABLE}
       WHERE tenant_id=? AND source_type='billing' AND event_type='bill_created'
         AND json_extract(payload_json,'$.invoiceNo')=?
         AND json_extract(payload_json,'$.source')='db_trigger')
      AS accounting_remaining_rows
  `).bind(
    TENANT_ID, ids.invoiceNumber,
    TENANT_ID, `${ids.prefix}:fixture-item`,
    TENANT_ID, ids.receiptNumber,
    TENANT_ID, ids.incomeDescription, ids.reversalIncomeDescription,
    TENANT_ID, ids.invoicePublicId,
    TENANT_ID, ids.linePublicId,
    TENANT_ID, ids.receiptPublicId,
    TENANT_ID, ids.tenderPublicId,
    TENANT_ID, ids.allocationPublicId,
    TENANT_ID, ids.reversalPublicId,
    TENANT_ID, ids.refundPublicId,
    TENANT_ID, ids.invoiceNumber,
  ).first<RemainingStateRow>();
  if (!row) throw new Error('Financial smoke cleanup state query returned no row');
  return row;
}

export async function executeTenant100FinancialSmokeFixture(
  db: CanonicalBatchDatabase,
  input: Tenant100FinancialSmokeFixtureInput,
): Promise<Tenant100FinancialSmokeFixtureResult> {
  const ids = fixtureIds(input.runId);
  positiveInteger(input.patientId, 'patientId');
  positiveInteger(input.actorId, 'actorId');
  positiveInteger(input.amountMinor, 'amountMinor');
  normalizedUtc(input.atUtc);
  validBusinessDate(input.businessDate);
  await assertPreconditions(db, input, ids);

  const evidenceSha256 = await createRequestFingerprint({
    tenantId: input.tenantId,
    runId: input.runId,
    patientId: input.patientId,
    actorId: input.actorId,
    amountMinor: input.amountMinor,
    atUtc: input.atUtc,
    businessDate: input.businessDate,
    expectedWorkerVersionTag: input.expectedWorkerVersionTag,
  });

  const lifecycle = lifecycleStatements(db, input, ids, evidenceSha256);
  const cleanup = cleanupStatements(db, ids);
  const results = await db.batch([...lifecycle, ...cleanup]);
  assertAtomicFixtureBatchChanges(results, lifecycle.length, cleanup.length);

  const remaining = await readRemainingState(db, ids);
  if (
    Number(remaining.legacy_remaining_rows) !== 0
    || Number(remaining.canonical_remaining_rows) !== 0
    || Number(remaining.accounting_remaining_rows) !== 0
  ) {
    throw new Error('Financial smoke atomic cleanup left fixture-tagged rows behind');
  }

  return {
    tenantId: TENANT_ID,
    runId: input.runId,
    candidateVersionBound: true,
    lifecycleVerified: true,
    cleanupVerified: true,
    patientRowsCreated: 0,
    legacyRemainingRows: 0,
    canonicalRemainingRows: 0,
    accountingRemainingRows: 0,
    fixtureInvoiceNumber: ids.invoiceNumber,
    fixtureReceiptNumber: ids.receiptNumber,
    sourceEvidenceSha256: evidenceSha256,
  };
}
