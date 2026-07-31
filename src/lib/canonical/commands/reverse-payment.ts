import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { stableCanonicalJson } from '../idempotency';
import { toUtcIso } from '../time';

export interface ReversePaymentInput {
  tenantId: string;
  reversalPublicId: string;
  refundPublicId: string;
  receiptPublicId: string;
  tenderPublicId: string;
  allocationPublicId: string;
  amountMinor: number;
  reasonCode: string;
  reversedAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
  cashCustodyEventPublicId?: string | null;
}

export interface ReversePaymentResult {
  reversalPublicId: string;
  refundPublicId: string;
  reversedMinor: number;
  allocationRemainingMinor: number;
  tenderRemainingMinor: number;
  receiptNetReceivedMinor: number;
  invoiceNetDueMinor: number;
}

interface AllocationRow {
  receipt_public_id: string;
  invoice_public_id: string;
  amount_minor: number;
  reversed_minor: number;
  remaining_minor: number;
  status: string;
}

interface TenderRow {
  receipt_public_id: string;
  tender_type: string;
  method_code: string;
  amount_minor: number;
  reversed_minor: number;
  remaining_minor: number;
  status: string;
}

interface ReceiptRow {
  total_minor: number;
  refunded_minor: number;
  net_received_minor: number;
  status: string;
}

interface InvoiceRow {
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  return value;
}

async function assertCompensationSafe(
  db: CanonicalBatchDatabase,
  tenantId: string,
  invoicePublicId: string,
): Promise<void> {
  const blocked = await db.prepare(`
    SELECT 1 present
    WHERE EXISTS (
      SELECT 1 FROM canonical_compensation_accruals c
      WHERE c.tenant_id=? AND c.invoice_public_id=? AND c.settled_minor>0
    ) OR EXISTS (
      SELECT 1
      FROM canonical_source_mappings m
      WHERE m.tenant_id=?
        AND m.entity_type='invoice'
        AND m.canonical_public_id=?
        AND m.mapping_status='mapped'
        AND m.source_table='bills'
        AND (
          EXISTS (
            SELECT 1 FROM diagnostic_performer_reserves r
            WHERE r.tenant_id=m.tenant_id
              AND r.bill_id=CAST(m.source_public_id AS INTEGER)
              AND r.status='paid'
          )
          OR EXISTS (
            SELECT 1 FROM doctor_commission_accruals a
            WHERE a.tenant_id=m.tenant_id
              AND a.bill_id=CAST(m.source_public_id AS INTEGER)
              AND a.status='paid'
          )
        )
    )
    LIMIT 1
  `).bind(tenantId, invoicePublicId, tenantId, invoicePublicId).first<{ present: number }>();
  if (blocked) throw new Error('Paid performer reserve or compensation settlement blocks payment reversal');
}

function mappingStatement(
  db: CanonicalBatchDatabase,
  input: ReversePaymentInput,
  entityType: 'payment_reversal' | 'refund',
  canonicalPublicId: string,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    entityType,
    canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.sourceEvidenceSha256,
  );
}

export async function reversePayment(
  db: CanonicalBatchDatabase,
  input: ReversePaymentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<ReversePaymentResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.reversalPublicId, 'reversalPublicId');
  exact(input.refundPublicId, 'refundPublicId');
  exact(input.receiptPublicId, 'receiptPublicId');
  exact(input.tenderPublicId, 'tenderPublicId');
  exact(input.allocationPublicId, 'allocationPublicId');
  positive(input.amountMinor, 'amountMinor');
  exact(input.reasonCode, 'reasonCode');
  utc(input.reversedAtUtc, 'reversedAtUtc');
  exact(input.businessDate, 'businessDate');
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  digest(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');

  const request = {
    reversalPublicId: input.reversalPublicId,
    refundPublicId: input.refundPublicId,
    receiptPublicId: input.receiptPublicId,
    tenderPublicId: input.tenderPublicId,
    allocationPublicId: input.allocationPublicId,
    amountMinor: input.amountMinor,
    reasonCode: input.reasonCode,
    reversedAtUtc: input.reversedAtUtc,
    businessDate: input.businessDate,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
  const replay = await readCanonicalCommandReplay<ReversePaymentResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.payment.reverse',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const allocation = await db.prepare(`
    SELECT receipt_public_id,invoice_public_id,amount_minor,reversed_minor,
           remaining_minor,status
    FROM canonical_payment_allocations
    WHERE tenant_id=? AND allocation_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.allocationPublicId).first<AllocationRow>();
  if (!allocation) throw new Error('Canonical payment allocation not found');
  if (allocation.receipt_public_id !== input.receiptPublicId) throw new Error('Payment allocation receipt mismatch');
  if (allocation.status !== 'active') throw new Error('Payment allocation is not active');
  if (allocation.remaining_minor < input.amountMinor) throw new RangeError('Payment reversal exceeds allocation remaining balance');

  const tender = await db.prepare(`
    SELECT receipt_public_id,tender_type,method_code,amount_minor,reversed_minor,
           remaining_minor,status
    FROM canonical_payment_tenders
    WHERE tenant_id=? AND tender_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.tenderPublicId).first<TenderRow>();
  if (!tender) throw new Error('Canonical payment tender not found');
  if (tender.receipt_public_id !== input.receiptPublicId) throw new Error('Payment tender receipt mismatch');
  if (tender.status !== 'captured') throw new Error('Payment tender is not captured');
  if (tender.remaining_minor < input.amountMinor) throw new RangeError('Payment reversal exceeds tender remaining balance');

  const receipt = await db.prepare(`
    SELECT total_minor,refunded_minor,net_received_minor,status
    FROM canonical_payment_receipts
    WHERE tenant_id=? AND receipt_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.receiptPublicId).first<ReceiptRow>();
  if (!receipt) throw new Error('Canonical payment receipt not found');
  if (receipt.status !== 'posted') throw new Error('Canonical payment receipt is not posted');
  if (receipt.net_received_minor < input.amountMinor) throw new RangeError('Payment reversal exceeds receipt net received balance');

  const invoice = await db.prepare(`
    SELECT paid_minor,due_minor,credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(input.tenantId, allocation.invoice_public_id).first<InvoiceRow>();
  if (!invoice) throw new Error('Canonical invoice not found');
  if (invoice.status !== 'posted') throw new Error('Canonical invoice is not posted');
  if (invoice.paid_minor < input.amountMinor) throw new RangeError('Payment reversal exceeds invoice paid balance');
  if (invoice.net_due_minor !== invoice.due_minor - invoice.credited_minor) {
    throw new Error('Canonical invoice adjustment projection is inconsistent');
  }
  await assertCompensationSafe(db, input.tenantId, allocation.invoice_public_id);
  if (tender.tender_type === 'cash') exact(input.cashCustodyEventPublicId ?? '', 'cashCustodyEventPublicId');

  const allocationReversedAfter = allocation.reversed_minor + input.amountMinor;
  const allocationRemainingAfter = allocation.remaining_minor - input.amountMinor;
  const tenderReversedAfter = tender.reversed_minor + input.amountMinor;
  const tenderRemainingAfter = tender.remaining_minor - input.amountMinor;
  const receiptRefundedAfter = receipt.refunded_minor + input.amountMinor;
  const receiptNetAfter = receipt.net_received_minor - input.amountMinor;
  const invoicePaidAfter = invoice.paid_minor - input.amountMinor;
  const invoiceDueAfter = invoice.due_minor + input.amountMinor;
  const invoiceNetDueAfter = invoice.net_due_minor + input.amountMinor;

  const result: ReversePaymentResult = {
    reversalPublicId: input.reversalPublicId,
    refundPublicId: input.refundPublicId,
    reversedMinor: input.amountMinor,
    allocationRemainingMinor: allocationRemainingAfter,
    tenderRemainingMinor: tenderRemainingAfter,
    receiptNetReceivedMinor: receiptNetAfter,
    invoiceNetDueMinor: invoiceNetDueAfter,
  };

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_payment_reversals (
        tenant_id,reversal_public_id,receipt_public_id,tender_public_id,
        allocation_public_id,invoice_public_id,amount_minor,reason_code,status,
        reversed_at_utc,business_date,allocation_reversed_before_minor,
        allocation_reversed_after_minor,tender_reversed_before_minor,
        tender_reversed_after_minor,receipt_refunded_before_minor,
        receipt_refunded_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
        invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
        invoice_net_due_after_minor,compensation_guard,balance_guard,
        source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,'posted',?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,1,?)
    `).bind(
      input.tenantId,
      input.reversalPublicId,
      input.receiptPublicId,
      input.tenderPublicId,
      input.allocationPublicId,
      allocation.invoice_public_id,
      input.amountMinor,
      input.reasonCode,
      input.reversedAtUtc,
      input.businessDate,
      allocation.reversed_minor,
      allocationReversedAfter,
      tender.reversed_minor,
      tenderReversedAfter,
      receipt.refunded_minor,
      receiptRefundedAfter,
      invoice.paid_minor,
      invoicePaidAfter,
      invoice.due_minor,
      invoiceDueAfter,
      invoice.net_due_minor,
      invoiceNetDueAfter,
      input.sourceEvidenceSha256,
    ),
    db.prepare(`
      INSERT INTO canonical_refunds (
        tenant_id,refund_public_id,source_type,receipt_public_id,tender_public_id,
        allocation_public_id,payment_reversal_public_id,amount_minor,tender_type,
        method_code,status,refunded_at_utc,business_date,liability_guard,
        source_evidence_sha256
      ) VALUES (?,?,'payment',?,?,?,?,?,?,?,'posted',?,?,1,?)
    `).bind(
      input.tenantId,
      input.refundPublicId,
      input.receiptPublicId,
      input.tenderPublicId,
      input.allocationPublicId,
      input.reversalPublicId,
      input.amountMinor,
      tender.tender_type,
      tender.method_code,
      input.reversedAtUtc,
      input.businessDate,
      input.sourceEvidenceSha256,
    ),
    db.prepare(`
      UPDATE canonical_payment_allocations
      SET reversed_minor=?,remaining_minor=?,status=?,reversed_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND allocation_public_id=? AND status='active'
        AND reversed_minor=? AND remaining_minor=?
    `).bind(
      allocationReversedAfter,
      allocationRemainingAfter,
      allocationRemainingAfter === 0 ? 'reversed' : 'active',
      allocationRemainingAfter === 0 ? input.reversedAtUtc : null,
      input.reversedAtUtc,
      input.tenantId,
      input.allocationPublicId,
      allocation.reversed_minor,
      allocation.remaining_minor,
    ),
    db.prepare(`
      UPDATE canonical_payment_tenders
      SET reversed_minor=?,remaining_minor=?,status=?,reversed_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND tender_public_id=? AND status='captured'
        AND reversed_minor=? AND remaining_minor=?
    `).bind(
      tenderReversedAfter,
      tenderRemainingAfter,
      tenderRemainingAfter === 0 ? 'reversed' : 'captured',
      tenderRemainingAfter === 0 ? input.reversedAtUtc : null,
      input.reversedAtUtc,
      input.tenantId,
      input.tenderPublicId,
      tender.reversed_minor,
      tender.remaining_minor,
    ),
    db.prepare(`
      UPDATE canonical_payment_receipts
      SET refunded_minor=?,net_received_minor=?,status=?,reversed_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND receipt_public_id=? AND status='posted'
        AND refunded_minor=? AND net_received_minor=?
    `).bind(
      receiptRefundedAfter,
      receiptNetAfter,
      receiptNetAfter === 0 ? 'reversed' : 'posted',
      receiptNetAfter === 0 ? input.reversedAtUtc : null,
      input.reversedAtUtc,
      input.tenantId,
      input.receiptPublicId,
      receipt.refunded_minor,
      receipt.net_received_minor,
    ),
    db.prepare(`
      UPDATE canonical_invoices
      SET paid_minor=?,due_minor=?,net_due_minor=?,updated_at_utc=?
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
        AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
    `).bind(
      invoicePaidAfter,
      invoiceDueAfter,
      invoiceNetDueAfter,
      input.reversedAtUtc,
      input.tenantId,
      allocation.invoice_public_id,
      invoice.paid_minor,
      invoice.due_minor,
      invoice.credited_minor,
      invoice.net_due_minor,
    ),
    db.prepare(`
      UPDATE canonical_payment_reversals
      SET balance_guard=CASE WHEN
        EXISTS (
          SELECT 1 FROM canonical_payment_allocations
          WHERE tenant_id=? AND allocation_public_id=?
            AND reversed_minor=? AND remaining_minor=? AND status=?
        ) AND EXISTS (
          SELECT 1 FROM canonical_payment_tenders
          WHERE tenant_id=? AND tender_public_id=?
            AND reversed_minor=? AND remaining_minor=? AND status=?
        ) AND EXISTS (
          SELECT 1 FROM canonical_payment_receipts
          WHERE tenant_id=? AND receipt_public_id=?
            AND refunded_minor=? AND net_received_minor=? AND status=?
        ) AND EXISTS (
          SELECT 1 FROM canonical_invoices
          WHERE tenant_id=? AND invoice_public_id=?
            AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
        )
      THEN 1 ELSE 0 END
      WHERE tenant_id=? AND reversal_public_id=?
    `).bind(
      input.tenantId,
      input.allocationPublicId,
      allocationReversedAfter,
      allocationRemainingAfter,
      allocationRemainingAfter === 0 ? 'reversed' : 'active',
      input.tenantId,
      input.tenderPublicId,
      tenderReversedAfter,
      tenderRemainingAfter,
      tenderRemainingAfter === 0 ? 'reversed' : 'captured',
      input.tenantId,
      input.receiptPublicId,
      receiptRefundedAfter,
      receiptNetAfter,
      receiptNetAfter === 0 ? 'reversed' : 'posted',
      input.tenantId,
      allocation.invoice_public_id,
      invoicePaidAfter,
      invoiceDueAfter,
      invoice.credited_minor,
      invoiceNetDueAfter,
      input.tenantId,
      input.reversalPublicId,
    ),
  ];

  if (tender.tender_type === 'cash') {
    statements.push(db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      input.tenantId,
      input.cashCustodyEventPublicId,
      'canonical_cash_custody',
      input.refundPublicId,
      'canonical.cash_custody.refund_recorded',
      stableCanonicalJson({ amountMinor: input.amountMinor, refundPublicId: input.refundPublicId }),
      input.reversedAtUtc,
      input.businessDate,
      `${input.idempotencyKey}:cash-custody`,
    ));
  }

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.payment.reverse',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements: [
      mappingStatement(db, input, 'payment_reversal', input.reversalPublicId),
      mappingStatement(db, input, 'refund', input.refundPublicId),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_payment_receipt',
      aggregatePublicId: input.receiptPublicId,
      eventType: 'canonical.payment.reversed',
      occurredAtUtc: input.reversedAtUtc,
      businessDate: input.businessDate,
      payload: {
        allocationPublicId: input.allocationPublicId,
        amountMinor: input.amountMinor,
        receiptPublicId: input.receiptPublicId,
        refundPublicId: input.refundPublicId,
        reversalPublicId: input.reversalPublicId,
        tenderPublicId: input.tenderPublicId,
      },
    },
  });
}
