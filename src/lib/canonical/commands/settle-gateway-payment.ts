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
import type { CollectPaymentInput } from './collect-payment';
import type { RecordDepositInput } from './apply-deposit';

export interface SettleGatewayPaymentInput {
  tenantId: string;
  commandIdempotencyKey: string;
  commandOutboxEventPublicId: string;
  occurredAtUtc: string;
  businessDate: string;
  payment: CollectPaymentInput | null;
  advanceDeposit: RecordDepositInput | null;
}

export interface SettleGatewayPaymentResult {
  paymentReceiptPublicId: string | null;
  advanceDepositPublicId: string | null;
  appliedToBillMinor: number;
  depositMinor: number;
  totalMinor: number;
}

interface StoredInvoiceRow {
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}

interface PreparedPayment {
  input: CollectPaymentInput;
  amountMinor: number;
  paidBeforeMinor: number;
  paidAfterMinor: number;
  dueBeforeMinor: number;
  dueAfterMinor: number;
  creditedMinor: number;
  netDueBeforeMinor: number;
  netDueAfterMinor: number;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function optionalExact(value: string | null | undefined, label: string): string | null {
  if (value == null) return null;
  return exact(value, label);
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function optionalPositive(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  return positive(value, label);
}

function digest(value: string, label: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new RangeError(`${label} must be a lowercase SHA-256 hex digest`);
  }
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) {
    throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  }
  return value;
}

function businessDate(value: string, label: string): string {
  exact(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError(`${label} must use YYYY-MM-DD`);
  }
  return value;
}

function safeSum(left: number, right: number, label: string): number {
  const total = BigInt(left) + BigInt(right);
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return Number(total);
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    sourceType: string;
    sourcePublicId: string;
    sourceTable: string;
    sourceEvidenceSha256: string;
  },
  entityType: string,
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

function childOutboxStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    aggregateType: string;
    aggregatePublicId: string;
    eventType: string;
    payload: unknown;
    occurredAtUtc: string;
    businessDate: string;
    idempotencyKey: string;
  },
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_outbox_events (
      tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
      event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
    ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
  `).bind(
    input.tenantId,
    input.eventPublicId,
    input.aggregateType,
    input.aggregatePublicId,
    input.eventType,
    stableCanonicalJson(input.payload),
    input.occurredAtUtc,
    input.businessDate,
    input.idempotencyKey,
  );
}

function receiptReconciliationStatement(
  db: CanonicalBatchDatabase,
  tenantId: string,
  receiptPublicId: string,
): CanonicalPreparedStatement {
  return db.prepare(`
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
    tenantId,
    receiptPublicId,
    tenantId,
    receiptPublicId,
    tenantId,
    receiptPublicId,
    tenantId,
    receiptPublicId,
  );
}

function validatePaymentShape(
  outer: SettleGatewayPaymentInput,
  payment: CollectPaymentInput,
): void {
  if (payment.tenantId !== outer.tenantId) throw new Error('Gateway payment tenant does not match command');
  exact(payment.receiptPublicId, 'payment.receiptPublicId');
  exact(payment.receiptNumber, 'payment.receiptNumber');
  positive(payment.legacyPatientId, 'payment.legacyPatientId');
  if (!/^[A-Z]{3}$/.test(payment.currencyCode)) throw new RangeError('payment.currencyCode must be uppercase ISO currency');
  utc(payment.receivedAtUtc, 'payment.receivedAtUtc');
  businessDate(payment.businessDate, 'payment.businessDate');
  if (payment.receivedAtUtc !== outer.occurredAtUtc || payment.businessDate !== outer.businessDate) {
    throw new Error('Gateway payment timestamp must match settlement');
  }
  optionalPositive(payment.legacyCollectorId, 'payment.legacyCollectorId');
  optionalPositive(payment.legacyCounterId, 'payment.legacyCounterId');
  optionalPositive(payment.legacyCounterSessionId, 'payment.legacyCounterSessionId');
  optionalExact(payment.externalTransactionId, 'payment.externalTransactionId');
  exact(payment.sourceType, 'payment.sourceType');
  exact(payment.sourcePublicId, 'payment.sourcePublicId');
  exact(payment.sourceTable, 'payment.sourceTable');
  digest(payment.sourceEvidenceSha256, 'payment.sourceEvidenceSha256');
  exact(payment.idempotencyKey, 'payment.idempotencyKey');
  exact(payment.outboxEventPublicId, 'payment.outboxEventPublicId');
  if (payment.cashCustodyEventPublicId != null) {
    throw new RangeError('Gateway payment cannot create a cash custody event');
  }
  if (payment.unallocatedMinor !== 0) throw new RangeError('Gateway invoice payment must be fully allocated');
  if (payment.tenders.length !== 1) throw new RangeError('Gateway invoice payment requires exactly one tender');
  if (payment.allocations.length !== 1) throw new RangeError('Gateway invoice payment requires exactly one allocation');

  const tender = payment.tenders[0];
  exact(tender.tenderPublicId, 'payment.tender.tenderPublicId');
  exact(tender.methodCode, 'payment.tender.methodCode');
  positive(tender.amountMinor, 'payment.tender.amountMinor');
  digest(tender.sourceEvidenceSha256, 'payment.tender.sourceEvidenceSha256');
  optionalExact(tender.externalTransactionId, 'payment.tender.externalTransactionId');
  if (tender.tenderType !== 'gateway' || tender.status !== 'captured') {
    throw new RangeError('Gateway invoice payment requires one captured gateway tender');
  }

  const allocation = payment.allocations[0];
  exact(allocation.allocationPublicId, 'payment.allocation.allocationPublicId');
  exact(allocation.invoicePublicId, 'payment.allocation.invoicePublicId');
  optionalExact(allocation.invoiceLinePublicId, 'payment.allocation.invoiceLinePublicId');
  positive(allocation.amountMinor, 'payment.allocation.amountMinor');
  digest(allocation.sourceEvidenceSha256, 'payment.allocation.sourceEvidenceSha256');
  if (tender.amountMinor !== allocation.amountMinor) {
    throw new RangeError('Gateway tender amount must equal invoice allocation amount');
  }
}

function validateAdvanceShape(
  outer: SettleGatewayPaymentInput,
  advance: RecordDepositInput,
): void {
  if (advance.tenantId !== outer.tenantId) throw new Error('Gateway advance tenant does not match command');
  exact(advance.depositPublicId, 'advanceDeposit.depositPublicId');
  exact(advance.depositNumber, 'advanceDeposit.depositNumber');
  exact(advance.receiptPublicId, 'advanceDeposit.receiptPublicId');
  exact(advance.sourceType, 'advanceDeposit.sourceType');
  exact(advance.sourcePublicId, 'advanceDeposit.sourcePublicId');
  exact(advance.sourceTable, 'advanceDeposit.sourceTable');
  digest(advance.sourceEvidenceSha256, 'advanceDeposit.sourceEvidenceSha256');
  exact(advance.idempotencyKey, 'advanceDeposit.idempotencyKey');
  exact(advance.outboxEventPublicId, 'advanceDeposit.outboxEventPublicId');
  const authority = advance.receiptAuthority;
  if (!authority) throw new Error('Gateway advance requires receipt authority');
  positive(authority.legacyPatientId, 'advanceDeposit.receiptAuthority.legacyPatientId');
  if (!/^[A-Z]{3}$/.test(authority.currencyCode)) {
    throw new RangeError('advanceDeposit receipt currency must be uppercase ISO currency');
  }
  positive(authority.amountMinor, 'advanceDeposit.receiptAuthority.amountMinor');
  exact(authority.tenderPublicId, 'advanceDeposit.receiptAuthority.tenderPublicId');
  exact(authority.methodCode, 'advanceDeposit.receiptAuthority.methodCode');
  utc(authority.receivedAtUtc, 'advanceDeposit.receiptAuthority.receivedAtUtc');
  businessDate(authority.businessDate, 'advanceDeposit.receiptAuthority.businessDate');
  digest(authority.sourceEvidenceSha256, 'advanceDeposit.receiptAuthority.sourceEvidenceSha256');
  if (authority.tenderType !== 'gateway') throw new RangeError('Gateway advance requires a gateway tender');
  if (authority.receivedAtUtc !== outer.occurredAtUtc || authority.businessDate !== outer.businessDate) {
    throw new Error('Gateway advance timestamp must match settlement');
  }
}

async function preparePayment(
  db: CanonicalBatchDatabase,
  payment: CollectPaymentInput,
): Promise<PreparedPayment> {
  const allocation = payment.allocations[0];
  const invoice = await db.prepare(`
    SELECT legacy_patient_id,currency_code,total_minor,paid_minor,due_minor,
           credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(payment.tenantId, allocation.invoicePublicId).first<StoredInvoiceRow>();
  if (!invoice) throw new Error('Canonical invoice not found');
  if (invoice.status !== 'posted') throw new Error('Canonical invoice is not posted');
  if (invoice.legacy_patient_id !== payment.legacyPatientId) {
    throw new Error('Canonical invoice patient does not match gateway payment');
  }
  if (invoice.currency_code !== payment.currencyCode) {
    throw new Error('Canonical invoice currency does not match gateway payment');
  }
  if (
    invoice.paid_minor + invoice.due_minor !== invoice.total_minor
    || invoice.net_due_minor !== invoice.due_minor - invoice.credited_minor
  ) {
    throw new Error('Canonical invoice balance is inconsistent');
  }
  const amountMinor = allocation.amountMinor;
  if (amountMinor > invoice.due_minor || amountMinor > invoice.net_due_minor) {
    throw new RangeError('Gateway payment exceeds invoice outstanding balance');
  }
  const paidAfterMinor = safeSum(invoice.paid_minor, amountMinor, 'invoice paid amount');
  return {
    input: payment,
    amountMinor,
    paidBeforeMinor: invoice.paid_minor,
    paidAfterMinor,
    dueBeforeMinor: invoice.due_minor,
    dueAfterMinor: invoice.due_minor - amountMinor,
    creditedMinor: invoice.credited_minor,
    netDueBeforeMinor: invoice.net_due_minor,
    netDueAfterMinor: invoice.net_due_minor - amountMinor,
  };
}

function paymentStatements(
  db: CanonicalBatchDatabase,
  prepared: PreparedPayment,
): CanonicalPreparedStatement[] {
  const payment = prepared.input;
  const tender = payment.tenders[0];
  const allocation = payment.allocations[0];
  return [
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
      payment.tenantId,
      payment.receiptPublicId,
      payment.receiptNumber,
      payment.legacyPatientId,
      payment.currencyCode,
      prepared.amountMinor,
      prepared.amountMinor,
      payment.receivedAtUtc,
      payment.businessDate,
      payment.legacyCollectorId ?? null,
      payment.legacyCounterId ?? null,
      payment.legacyCounterSessionId ?? null,
      payment.externalTransactionId ?? null,
      payment.receivedAtUtc,
      prepared.amountMinor,
      payment.sourceEvidenceSha256,
    ),
    db.prepare(`
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,status,external_transaction_id,captured_at_utc,failed_at_utc,
        reversed_minor,remaining_minor,reversal_projection_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,'captured',?,?,NULL,0,?,1,?)
    `).bind(
      payment.tenantId,
      tender.tenderPublicId,
      payment.receiptPublicId,
      tender.tenderType,
      tender.methodCode,
      tender.amountMinor,
      tender.externalTransactionId ?? null,
      payment.receivedAtUtc,
      tender.amountMinor,
      tender.sourceEvidenceSha256,
    ),
    db.prepare(`
      INSERT INTO canonical_payment_allocations (
        tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
        invoice_line_public_id,amount_minor,invoice_due_before_minor,
        invoice_due_after_minor,status,allocated_at_utc,reversed_minor,remaining_minor,
        reversal_projection_guard,balance_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,'active',?,0,?,1,1,?)
    `).bind(
      payment.tenantId,
      allocation.allocationPublicId,
      payment.receiptPublicId,
      allocation.invoicePublicId,
      allocation.invoiceLinePublicId ?? null,
      prepared.amountMinor,
      prepared.dueBeforeMinor,
      prepared.dueAfterMinor,
      payment.receivedAtUtc,
      prepared.amountMinor,
      allocation.sourceEvidenceSha256,
    ),
    db.prepare(`
      UPDATE canonical_invoices
      SET paid_minor=?,due_minor=?,net_due_minor=?,updated_at_utc=?
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
        AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
    `).bind(
      prepared.paidAfterMinor,
      prepared.dueAfterMinor,
      prepared.netDueAfterMinor,
      payment.receivedAtUtc,
      payment.tenantId,
      allocation.invoicePublicId,
      prepared.paidBeforeMinor,
      prepared.dueBeforeMinor,
      prepared.creditedMinor,
      prepared.netDueBeforeMinor,
    ),
    db.prepare(`
      UPDATE canonical_payment_allocations
      SET balance_guard=CASE WHEN EXISTS (
        SELECT 1 FROM canonical_invoices
        WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
          AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
      ) THEN 1 ELSE 0 END
      WHERE tenant_id=? AND allocation_public_id=?
    `).bind(
      payment.tenantId,
      allocation.invoicePublicId,
      prepared.paidAfterMinor,
      prepared.dueAfterMinor,
      prepared.creditedMinor,
      prepared.netDueAfterMinor,
      payment.tenantId,
      allocation.allocationPublicId,
    ),
    receiptReconciliationStatement(db, payment.tenantId, payment.receiptPublicId),
    childOutboxStatement(db, {
      tenantId: payment.tenantId,
      eventPublicId: payment.outboxEventPublicId,
      aggregateType: 'canonical_payment_receipt',
      aggregatePublicId: payment.receiptPublicId,
      eventType: 'canonical.payment.receipt.posted',
      payload: {
        allocatedMinor: prepared.amountMinor,
        cashTenderMinor: 0,
        receiptPublicId: payment.receiptPublicId,
        status: 'posted',
        totalMinor: prepared.amountMinor,
        unallocatedMinor: 0,
      },
      occurredAtUtc: payment.receivedAtUtc,
      businessDate: payment.businessDate,
      idempotencyKey: payment.idempotencyKey,
    }),
  ];
}

function advanceStatements(
  db: CanonicalBatchDatabase,
  advance: RecordDepositInput,
): CanonicalPreparedStatement[] {
  const authority = advance.receiptAuthority!;
  return [
    db.prepare(`
      INSERT INTO canonical_payment_receipts (
        tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
        total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
        business_date,posted_at_utc,reconciliation_guard,source_evidence_sha256,
        refunded_minor,net_received_minor,refund_projection_guard
      ) VALUES (?,?,?,?,?,?,0,?,'posted',?,?,?,1,?,0,?,1)
    `).bind(
      advance.tenantId,
      advance.receiptPublicId,
      advance.depositNumber,
      authority.legacyPatientId,
      authority.currencyCode,
      authority.amountMinor,
      authority.amountMinor,
      authority.receivedAtUtc,
      authority.businessDate,
      authority.receivedAtUtc,
      authority.sourceEvidenceSha256,
      authority.amountMinor,
    ),
    db.prepare(`
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,status,captured_at_utc,source_evidence_sha256,
        reversed_minor,remaining_minor,reversal_projection_guard
      ) VALUES (?,?,?,?,?,?,'captured',?,?,0,?,1)
    `).bind(
      advance.tenantId,
      authority.tenderPublicId,
      advance.receiptPublicId,
      authority.tenderType,
      authority.methodCode,
      authority.amountMinor,
      authority.receivedAtUtc,
      authority.sourceEvidenceSha256,
      authority.amountMinor,
    ),
    receiptReconciliationStatement(db, advance.tenantId, advance.receiptPublicId),
    db.prepare(`
      INSERT INTO canonical_deposits (
        tenant_id,deposit_public_id,deposit_number,receipt_public_id,
        legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
        available_minor,status,received_at_utc,business_date,posted_at_utc,
        reconciliation_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,0,0,?,'posted',?,?,?,1,?)
    `).bind(
      advance.tenantId,
      advance.depositPublicId,
      advance.depositNumber,
      advance.receiptPublicId,
      authority.legacyPatientId,
      authority.currencyCode,
      authority.amountMinor,
      authority.amountMinor,
      authority.receivedAtUtc,
      authority.businessDate,
      authority.receivedAtUtc,
      advance.sourceEvidenceSha256,
    ),
    childOutboxStatement(db, {
      tenantId: advance.tenantId,
      eventPublicId: advance.outboxEventPublicId,
      aggregateType: 'canonical_deposit',
      aggregatePublicId: advance.depositPublicId,
      eventType: 'canonical.deposit.recorded',
      payload: {
        amountMinor: authority.amountMinor,
        depositPublicId: advance.depositPublicId,
        receiptPublicId: advance.receiptPublicId,
      },
      occurredAtUtc: authority.receivedAtUtc,
      businessDate: authority.businessDate,
      idempotencyKey: advance.idempotencyKey,
    }),
  ];
}

export async function settleGatewayPayment(
  db: CanonicalBatchDatabase,
  input: SettleGatewayPaymentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<SettleGatewayPaymentResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.commandIdempotencyKey, 'commandIdempotencyKey');
  exact(input.commandOutboxEventPublicId, 'commandOutboxEventPublicId');
  utc(input.occurredAtUtc, 'occurredAtUtc');
  businessDate(input.businessDate, 'businessDate');
  if (!input.payment && !input.advanceDeposit) {
    throw new RangeError('Gateway settlement requires payment or advance deposit authority');
  }
  if (input.payment) validatePaymentShape(input, input.payment);
  if (input.advanceDeposit) validateAdvanceShape(input, input.advanceDeposit);
  if (input.payment && input.advanceDeposit) {
    const advanceAuthority = input.advanceDeposit.receiptAuthority!;
    if (
      input.payment.legacyPatientId !== advanceAuthority.legacyPatientId
      || input.payment.currencyCode !== advanceAuthority.currencyCode
    ) {
      throw new Error('Gateway payment and advance deposit patient or currency do not match');
    }
    if (input.payment.receiptPublicId === input.advanceDeposit.receiptPublicId) {
      throw new RangeError('Gateway payment and advance require separate receipts');
    }
    if (input.payment.tenders[0].tenderPublicId === advanceAuthority.tenderPublicId) {
      throw new RangeError('Gateway payment and advance require separate tenders');
    }
  }

  const request = {
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    payment: input.payment,
    advanceDeposit: input.advanceDeposit,
  };
  const replay = await readCanonicalCommandReplay<SettleGatewayPaymentResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.gateway_payment.settle',
    idempotencyKey: input.commandIdempotencyKey,
    request,
  });
  if (replay) return replay;

  const preparedPayment = input.payment ? await preparePayment(db, input.payment) : null;
  const appliedToBillMinor = preparedPayment?.amountMinor ?? 0;
  const depositMinor = input.advanceDeposit?.receiptAuthority?.amountMinor ?? 0;
  const result: SettleGatewayPaymentResult = {
    paymentReceiptPublicId: input.payment?.receiptPublicId ?? null,
    advanceDepositPublicId: input.advanceDeposit?.depositPublicId ?? null,
    appliedToBillMinor,
    depositMinor,
    totalMinor: safeSum(appliedToBillMinor, depositMinor, 'gateway settlement total'),
  };

  const statements: CanonicalPreparedStatement[] = [
    ...(preparedPayment ? paymentStatements(db, preparedPayment) : []),
    ...(input.advanceDeposit ? advanceStatements(db, input.advanceDeposit) : []),
  ];
  const reconciliationStatements: CanonicalPreparedStatement[] = [
    ...(input.payment ? [
      sourceMappingStatement(db, input.payment, 'payment_receipt', input.payment.receiptPublicId),
    ] : []),
    ...(input.advanceDeposit ? [
      sourceMappingStatement(db, input.advanceDeposit, 'payment_receipt', input.advanceDeposit.receiptPublicId),
      sourceMappingStatement(db, input.advanceDeposit, 'deposit', input.advanceDeposit.depositPublicId),
    ] : []),
  ];

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.gateway_payment.settle',
    idempotencyKey: input.commandIdempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements,
    result,
    event: {
      eventPublicId: input.commandOutboxEventPublicId,
      aggregateType: 'canonical_gateway_payment',
      aggregatePublicId: input.commandIdempotencyKey,
      eventType: 'canonical.gateway_payment.settled',
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: result,
    },
  });
}
