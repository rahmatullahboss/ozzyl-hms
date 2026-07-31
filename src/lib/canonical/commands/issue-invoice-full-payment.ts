import {
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { stableCanonicalJson } from '../idempotency';
import { toUtcIso } from '../time';
import type {
  IssueInvoiceInput,
  IssueInvoiceLineInput,
} from './issue-invoice';
import type { PaymentTenderType } from './collect-payment';

export interface FullPaymentAuthorityInput {
  receiptPublicId: string;
  receiptNumber: string;
  tenderPublicId: string;
  allocationPublicId: string;
  tenderType: PaymentTenderType;
  methodCode: string;
  amountMinor: number;
  externalTransactionId?: string | null;
  legacyCollectorId?: number | null;
  legacyCounterId?: number | null;
  legacyCounterSessionId?: number | null;
  receivedAtUtc: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  paymentOutboxEventPublicId: string;
  cashCustodyEventPublicId?: string | null;
}

export interface IssueInvoiceWithFullPaymentInput {
  tenantId: string;
  commandIdempotencyKey: string;
  invoice: IssueInvoiceInput;
  payment: FullPaymentAuthorityInput;
}

export interface IssueInvoiceWithFullPaymentResult {
  invoicePublicId: string;
  receiptPublicId: string;
  invoiceTotalMinor: number;
  paidMinor: number;
  cashTenderMinor: number;
  status: 'paid';
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function nullableExact(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return exact(value, label);
}

function safeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
  return value;
}

function positive(value: number, label: string): number {
  safeInteger(value, label);
  if (value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function optionalPositive(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  return positive(value, label);
}

function hash(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function normalizedUtc(value: string, label: string): string {
  if (toUtcIso(value) !== value) {
    throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  }
  return value;
}

function lineAmount(line: IssueInvoiceLineInput): number {
  exact(line.linePublicId, 'invoice.line.linePublicId');
  hash(line.sourceEvidenceSha256, 'invoice.line.sourceEvidenceSha256');
  positive(line.quantity, 'invoice.line.quantity');
  safeInteger(line.unitAmountMinor, 'invoice.line.unitAmountMinor');

  if (line.lineType === 'service') {
    exact(line.serviceEventPublicId ?? '', 'invoice.line.serviceEventPublicId');
    if (line.adjustmentCode != null) throw new TypeError('service line cannot have adjustmentCode');
    if (line.unitAmountMinor < 0) throw new RangeError('service line amount cannot be negative');
    const amount = BigInt(line.quantity) * BigInt(line.unitAmountMinor);
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError('service line amount exceeds the safe integer range');
    }
    return Number(amount);
  }

  if (line.serviceEventPublicId != null) {
    throw new TypeError('adjustment line cannot have serviceEventPublicId');
  }
  exact(line.adjustmentCode ?? '', 'invoice.line.adjustmentCode');
  if (line.quantity !== 1) throw new RangeError('adjustment line quantity must be 1');
  if ((line.lineType === 'discount' || line.lineType === 'waiver') && line.unitAmountMinor > 0) {
    throw new RangeError(`${line.lineType} must be negative or zero`);
  }
  if ((line.lineType === 'tax' || line.lineType === 'surcharge') && line.unitAmountMinor < 0) {
    throw new RangeError(`${line.lineType} must be positive or zero`);
  }
  return line.unitAmountMinor;
}

function calculateInvoiceTotals(lines: readonly IssueInvoiceLineInput[]): {
  lineAmounts: number[];
  subtotalMinor: number;
  adjustmentTotalMinor: number;
  totalMinor: number;
} {
  if (lines.length === 0) throw new RangeError('invoice must contain at least one line');
  const lineIds = new Set<string>();
  const serviceEvents = new Set<string>();
  let subtotal = 0n;
  let adjustments = 0n;
  const lineAmounts = lines.map((line) => {
    if (lineIds.has(line.linePublicId)) throw new RangeError('duplicate linePublicId in invoice');
    lineIds.add(line.linePublicId);
    if (line.lineType === 'service') {
      const eventId = line.serviceEventPublicId ?? '';
      if (serviceEvents.has(eventId)) throw new RangeError('duplicate serviceEventPublicId in invoice');
      serviceEvents.add(eventId);
    }
    const amount = lineAmount(line);
    if (line.lineType === 'service' || (line.lineType === 'other_adjustment' && amount > 0)) {
      subtotal += BigInt(amount);
    } else {
      adjustments += BigInt(amount);
    }
    const max = BigInt(Number.MAX_SAFE_INTEGER);
    if (subtotal > max || subtotal < -max || adjustments > max || adjustments < -max) {
      throw new RangeError('invoice total exceeds the safe integer range');
    }
    return amount;
  });
  const total = subtotal + adjustments;
  if (total <= 0n) throw new RangeError('fully paid invoice total must be positive');
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('invoice total exceeds the safe integer range');
  }
  return {
    lineAmounts,
    subtotalMinor: Number(subtotal),
    adjustmentTotalMinor: Number(adjustments),
    totalMinor: Number(total),
  };
}

function invoiceLineStatement(
  db: CanonicalBatchDatabase,
  input: IssueInvoiceWithFullPaymentInput,
  line: IssueInvoiceLineInput,
  amountMinor: number,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,
      service_event_public_id,adjustment_code,quantity,unit_amount_minor,
      line_amount_minor,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    line.linePublicId,
    input.invoice.invoicePublicId,
    line.lineType,
    line.serviceEventPublicId ?? null,
    line.adjustmentCode ?? null,
    line.quantity,
    line.unitAmountMinor,
    amountMinor,
    line.sourceEvidenceSha256,
  );
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: 'invoice' | 'payment_receipt';
    canonicalPublicId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    evidenceSha256: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    ) VALUES (?,?,?,?,?,?,'mapped',1,?)
  `).bind(
    input.tenantId,
    input.entityType,
    input.canonicalPublicId,
    input.sourceType,
    input.sourcePublicId,
    input.sourceTable,
    input.evidenceSha256,
  );
}

export async function issueInvoiceWithFullPayment(
  db: CanonicalBatchDatabase,
  input: IssueInvoiceWithFullPaymentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<IssueInvoiceWithFullPaymentResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.commandIdempotencyKey, 'commandIdempotencyKey');
  if (input.invoice.tenantId !== input.tenantId) {
    throw new Error('invoice tenant must match command tenant');
  }
  exact(input.invoice.invoicePublicId, 'invoice.invoicePublicId');
  exact(input.invoice.invoiceNumber, 'invoice.invoiceNumber');
  positive(input.invoice.legacyPatientId, 'invoice.legacyPatientId');
  exact(input.invoice.currencyCode, 'invoice.currencyCode');
  if (!/^[A-Z]{3}$/.test(input.invoice.currencyCode)) {
    throw new RangeError('invoice currencyCode must be three uppercase letters');
  }
  normalizedUtc(input.invoice.issuedAtUtc, 'invoice.issuedAtUtc');
  exact(input.invoice.businessDate, 'invoice.businessDate');
  exact(input.invoice.sourceType, 'invoice.sourceType');
  exact(input.invoice.sourcePublicId, 'invoice.sourcePublicId');
  exact(input.invoice.sourceTable, 'invoice.sourceTable');
  exact(input.invoice.outboxEventPublicId, 'invoice.outboxEventPublicId');
  hash(input.invoice.sourceEvidenceSha256, 'invoice.sourceEvidenceSha256');

  const payment = input.payment;
  exact(payment.receiptPublicId, 'payment.receiptPublicId');
  exact(payment.receiptNumber, 'payment.receiptNumber');
  exact(payment.tenderPublicId, 'payment.tenderPublicId');
  exact(payment.allocationPublicId, 'payment.allocationPublicId');
  exact(payment.methodCode, 'payment.methodCode');
  positive(payment.amountMinor, 'payment.amountMinor');
  normalizedUtc(payment.receivedAtUtc, 'payment.receivedAtUtc');
  exact(payment.sourceType, 'payment.sourceType');
  exact(payment.sourcePublicId, 'payment.sourcePublicId');
  exact(payment.sourceTable, 'payment.sourceTable');
  exact(payment.paymentOutboxEventPublicId, 'payment.paymentOutboxEventPublicId');
  hash(payment.sourceEvidenceSha256, 'payment.sourceEvidenceSha256');
  optionalPositive(payment.legacyCollectorId, 'payment.legacyCollectorId');
  optionalPositive(payment.legacyCounterId, 'payment.legacyCounterId');
  optionalPositive(payment.legacyCounterSessionId, 'payment.legacyCounterSessionId');
  nullableExact(payment.externalTransactionId, 'payment.externalTransactionId');
  if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(payment.tenderType)) {
    throw new RangeError(`Unsupported tenderType: ${payment.tenderType}`);
  }
  if (payment.tenderType !== 'cash' && !payment.externalTransactionId) {
    throw new RangeError('Non-cash payment requires external transaction authority');
  }
  if (payment.tenderType === 'cash') {
    exact(payment.cashCustodyEventPublicId ?? '', 'payment.cashCustodyEventPublicId');
  }

  const totals = calculateInvoiceTotals(input.invoice.lines);
  if (payment.amountMinor !== totals.totalMinor) {
    throw new RangeError('Payment amount must equal invoice total');
  }

  const cashTenderMinor = payment.tenderType === 'cash' ? payment.amountMinor : 0;
  const result: IssueInvoiceWithFullPaymentResult = {
    invoicePublicId: input.invoice.invoicePublicId,
    receiptPublicId: payment.receiptPublicId,
    invoiceTotalMinor: totals.totalMinor,
    paidMinor: totals.totalMinor,
    cashTenderMinor,
    status: 'paid',
  };

  const request = {
    invoice: {
      invoicePublicId: input.invoice.invoicePublicId,
      invoiceNumber: input.invoice.invoiceNumber,
      legacyPatientId: input.invoice.legacyPatientId,
      currencyCode: input.invoice.currencyCode,
      issuedAtUtc: input.invoice.issuedAtUtc,
      businessDate: input.invoice.businessDate,
      lines: input.invoice.lines,
      sourceType: input.invoice.sourceType,
      sourcePublicId: input.invoice.sourcePublicId,
      sourceTable: input.invoice.sourceTable,
      sourceEvidenceSha256: input.invoice.sourceEvidenceSha256,
    },
    payment: {
      receiptPublicId: payment.receiptPublicId,
      receiptNumber: payment.receiptNumber,
      tenderPublicId: payment.tenderPublicId,
      allocationPublicId: payment.allocationPublicId,
      tenderType: payment.tenderType,
      methodCode: payment.methodCode,
      amountMinor: payment.amountMinor,
      externalTransactionId: payment.externalTransactionId ?? null,
      legacyCollectorId: payment.legacyCollectorId ?? null,
      legacyCounterId: payment.legacyCounterId ?? null,
      legacyCounterSessionId: payment.legacyCounterSessionId ?? null,
      receivedAtUtc: payment.receivedAtUtc,
      sourceType: payment.sourceType,
      sourcePublicId: payment.sourcePublicId,
      sourceTable: payment.sourceTable,
      sourceEvidenceSha256: payment.sourceEvidenceSha256,
    },
  };

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_invoices (
        tenant_id,invoice_public_id,invoice_number,legacy_patient_id,
        currency_code,subtotal_minor,adjustment_total_minor,total_minor,
        paid_minor,due_minor,credited_minor,net_due_minor,adjustment_projection_guard,
        status,issued_at_utc,posted_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?,0,0,0,1,'posted',?,?,?)
    `).bind(
      input.tenantId,
      input.invoice.invoicePublicId,
      input.invoice.invoiceNumber,
      input.invoice.legacyPatientId,
      input.invoice.currencyCode,
      totals.subtotalMinor,
      totals.adjustmentTotalMinor,
      totals.totalMinor,
      totals.totalMinor,
      input.invoice.issuedAtUtc,
      input.invoice.issuedAtUtc,
      input.invoice.sourceEvidenceSha256,
    ),
    ...input.invoice.lines.map((line, index) => invoiceLineStatement(
      db,
      input,
      line,
      totals.lineAmounts[index],
    )),
    db.prepare(`
      INSERT INTO canonical_payment_receipts (
        tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
        total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
        business_date,legacy_collector_id,legacy_counter_id,legacy_counter_session_id,
        external_transaction_id,posted_at_utc,failed_at_utc,refunded_minor,
        net_received_minor,refund_projection_guard,reconciliation_guard,
        source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,0,'posted',?,?,?,?,?,?,?,NULL,0,?,1,1,?)
    `).bind(
      input.tenantId,
      payment.receiptPublicId,
      payment.receiptNumber,
      input.invoice.legacyPatientId,
      input.invoice.currencyCode,
      totals.totalMinor,
      totals.totalMinor,
      payment.receivedAtUtc,
      input.invoice.businessDate,
      payment.legacyCollectorId ?? null,
      payment.legacyCounterId ?? null,
      payment.legacyCounterSessionId ?? null,
      payment.externalTransactionId ?? null,
      payment.receivedAtUtc,
      totals.totalMinor,
      payment.sourceEvidenceSha256,
    ),
    db.prepare(`
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,status,external_transaction_id,captured_at_utc,failed_at_utc,
        reversed_minor,remaining_minor,reversal_projection_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,'captured',?,?,NULL,0,?,1,?)
    `).bind(
      input.tenantId,
      payment.tenderPublicId,
      payment.receiptPublicId,
      payment.tenderType,
      payment.methodCode,
      totals.totalMinor,
      payment.externalTransactionId ?? null,
      payment.receivedAtUtc,
      totals.totalMinor,
      payment.sourceEvidenceSha256,
    ),
    db.prepare(`
      INSERT INTO canonical_payment_allocations (
        tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
        invoice_line_public_id,amount_minor,invoice_due_before_minor,
        invoice_due_after_minor,status,allocated_at_utc,reversed_minor,remaining_minor,
        reversal_projection_guard,balance_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,NULL,?,?,0,'active',?,0,?,1,1,?)
    `).bind(
      input.tenantId,
      payment.allocationPublicId,
      payment.receiptPublicId,
      input.invoice.invoicePublicId,
      totals.totalMinor,
      totals.totalMinor,
      payment.receivedAtUtc,
      totals.totalMinor,
      payment.sourceEvidenceSha256,
    ),
    db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      input.tenantId,
      payment.paymentOutboxEventPublicId,
      'canonical_payment_receipt',
      payment.receiptPublicId,
      'canonical.payment.receipt.posted',
      stableCanonicalJson({
        allocatedMinor: totals.totalMinor,
        cashTenderMinor,
        receiptPublicId: payment.receiptPublicId,
        status: 'posted',
        totalMinor: totals.totalMinor,
        unallocatedMinor: 0,
      }),
      payment.receivedAtUtc,
      input.invoice.businessDate,
      `${input.commandIdempotencyKey}:payment`,
    ),
  ];

  if (cashTenderMinor > 0) {
    statements.push(db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      input.tenantId,
      payment.cashCustodyEventPublicId,
      'canonical_cash_custody',
      payment.receiptPublicId,
      'canonical.cash_custody.collection_recorded',
      stableCanonicalJson({
        cashAmountMinor: cashTenderMinor,
        counterId: payment.legacyCounterId ?? null,
        counterSessionId: payment.legacyCounterSessionId ?? null,
        receiptPublicId: payment.receiptPublicId,
      }),
      payment.receivedAtUtc,
      input.invoice.businessDate,
      `${input.commandIdempotencyKey}:cash-custody`,
    ));
  }

  statements.push(db.prepare(`
    UPDATE canonical_payment_receipts
    SET reconciliation_guard=CASE WHEN (
      total_minor=COALESCE((
        SELECT SUM(amount_minor) FROM canonical_payment_tenders
        WHERE tenant_id=? AND receipt_public_id=?
      ),0)
      AND allocated_total_minor=COALESCE((
        SELECT SUM(amount_minor) FROM canonical_payment_allocations
        WHERE tenant_id=? AND receipt_public_id=? AND status='active'
      ),0)
      AND total_minor=allocated_total_minor+unallocated_minor
      AND status='posted'
      AND NOT EXISTS (
        SELECT 1 FROM canonical_payment_tenders
        WHERE tenant_id=? AND receipt_public_id=? AND status<>'captured'
      )
    ) THEN 1 ELSE 0 END
    WHERE tenant_id=? AND receipt_public_id=?
  `).bind(
    input.tenantId,
    payment.receiptPublicId,
    input.tenantId,
    payment.receiptPublicId,
    input.tenantId,
    payment.receiptPublicId,
    input.tenantId,
    payment.receiptPublicId,
  ));

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.invoice.issue_full_payment',
    idempotencyKey: input.commandIdempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements: [
      sourceMappingStatement(db, {
        tenantId: input.tenantId,
        entityType: 'invoice',
        canonicalPublicId: input.invoice.invoicePublicId,
        sourceType: input.invoice.sourceType,
        sourcePublicId: input.invoice.sourcePublicId,
        sourceTable: input.invoice.sourceTable,
        evidenceSha256: input.invoice.sourceEvidenceSha256,
      }),
      sourceMappingStatement(db, {
        tenantId: input.tenantId,
        entityType: 'payment_receipt',
        canonicalPublicId: payment.receiptPublicId,
        sourceType: payment.sourceType,
        sourcePublicId: payment.sourcePublicId,
        sourceTable: payment.sourceTable,
        evidenceSha256: payment.sourceEvidenceSha256,
      }),
    ],
    result,
    event: {
      eventPublicId: input.invoice.outboxEventPublicId,
      aggregateType: 'canonical_invoice',
      aggregatePublicId: input.invoice.invoicePublicId,
      eventType: 'canonical.invoice.issued',
      occurredAtUtc: input.invoice.issuedAtUtc,
      businessDate: input.invoice.businessDate,
      payload: {
        invoicePublicId: input.invoice.invoicePublicId,
        status: 'posted',
        subtotalMinor: totals.subtotalMinor,
        adjustmentTotalMinor: totals.adjustmentTotalMinor,
        totalMinor: totals.totalMinor,
      },
    },
  });
}
