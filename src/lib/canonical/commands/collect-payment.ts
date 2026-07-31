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

export type PaymentTenderType =
  | 'cash'
  | 'card'
  | 'mobile_wallet'
  | 'bank_transfer'
  | 'gateway'
  | 'other';

export type PaymentTenderStatus = 'verifying' | 'captured' | 'failed';

export interface CollectPaymentTenderInput {
  tenderPublicId: string;
  tenderType: PaymentTenderType;
  methodCode: string;
  amountMinor: number;
  status: PaymentTenderStatus;
  externalTransactionId?: string | null;
  sourceEvidenceSha256: string;
}

export interface CollectPaymentAllocationInput {
  allocationPublicId: string;
  invoicePublicId: string;
  invoiceLinePublicId?: string | null;
  amountMinor: number;
  sourceEvidenceSha256: string;
}

export interface CollectPaymentInput {
  tenantId: string;
  receiptPublicId: string;
  receiptNumber: string;
  legacyPatientId: number;
  currencyCode: string;
  receivedAtUtc: string;
  businessDate: string;
  legacyCollectorId?: number | null;
  legacyCounterId?: number | null;
  legacyCounterSessionId?: number | null;
  externalTransactionId?: string | null;
  tenders: readonly CollectPaymentTenderInput[];
  allocations: readonly CollectPaymentAllocationInput[];
  unallocatedMinor: number;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
  cashCustodyEventPublicId?: string | null;
}

export interface CollectPaymentResult {
  receiptPublicId: string;
  status: 'pending' | 'posted' | 'failed';
  totalMinor: number;
  allocatedMinor: number;
  unallocatedMinor: number;
  cashTenderMinor: number;
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

interface PreparedAllocation extends CollectPaymentAllocationInput {
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

function nonNegative(value: number, label: string): number {
  safeInteger(value, label);
  if (value < 0) throw new RangeError(`${label} must be non-negative`);
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

function addSafe(total: bigint, value: number, label: string): bigint {
  const next = total + BigInt(value);
  if (next > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${label} exceeds the safe integer range`);
  }
  return next;
}

function requestShape(input: CollectPaymentInput): Record<string, unknown> {
  return {
    receiptPublicId: input.receiptPublicId,
    receiptNumber: input.receiptNumber,
    legacyPatientId: input.legacyPatientId,
    currencyCode: input.currencyCode,
    receivedAtUtc: input.receivedAtUtc,
    businessDate: input.businessDate,
    legacyCollectorId: input.legacyCollectorId ?? null,
    legacyCounterId: input.legacyCounterId ?? null,
    legacyCounterSessionId: input.legacyCounterSessionId ?? null,
    externalTransactionId: input.externalTransactionId ?? null,
    tenders: input.tenders,
    allocations: input.allocations,
    unallocatedMinor: input.unallocatedMinor,
    sourceType: input.sourceType,
    sourcePublicId: input.sourcePublicId,
    sourceTable: input.sourceTable,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  };
}

function tenderStatement(
  db: CanonicalBatchDatabase,
  input: CollectPaymentInput,
  tender: CollectPaymentTenderInput,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_payment_tenders (
      tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
      amount_minor,status,external_transaction_id,captured_at_utc,failed_at_utc,
      reversed_minor,remaining_minor,reversal_projection_guard,source_evidence_sha256
    ) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,1,?)
  `).bind(
    input.tenantId,
    tender.tenderPublicId,
    input.receiptPublicId,
    tender.tenderType,
    tender.methodCode,
    tender.amountMinor,
    tender.status,
    tender.externalTransactionId ?? null,
    tender.status === 'captured' ? input.receivedAtUtc : null,
    tender.status === 'failed' ? input.receivedAtUtc : null,
    tender.amountMinor,
    tender.sourceEvidenceSha256,
  );
}

function allocationStatements(
  db: CanonicalBatchDatabase,
  input: CollectPaymentInput,
  allocation: PreparedAllocation,
): CanonicalPreparedStatement[] {
  return [
    db.prepare(`
      INSERT INTO canonical_payment_allocations (
        tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
        invoice_line_public_id,amount_minor,invoice_due_before_minor,
        invoice_due_after_minor,status,allocated_at_utc,reversed_minor,remaining_minor,
        reversal_projection_guard,balance_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?, 'active',?,0,?,1,1,?)
    `).bind(
      input.tenantId,
      allocation.allocationPublicId,
      input.receiptPublicId,
      allocation.invoicePublicId,
      allocation.invoiceLinePublicId ?? null,
      allocation.amountMinor,
      allocation.dueBeforeMinor,
      allocation.dueAfterMinor,
      input.receivedAtUtc,
      allocation.amountMinor,
      allocation.sourceEvidenceSha256,
    ),
    db.prepare(`
      UPDATE canonical_invoices
      SET paid_minor=?,due_minor=?,net_due_minor=?,updated_at_utc=?
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
        AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
    `).bind(
      allocation.paidAfterMinor,
      allocation.dueAfterMinor,
      allocation.netDueAfterMinor,
      input.receivedAtUtc,
      input.tenantId,
      allocation.invoicePublicId,
      allocation.paidBeforeMinor,
      allocation.dueBeforeMinor,
      allocation.creditedMinor,
      allocation.netDueBeforeMinor,
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
      input.tenantId,
      allocation.invoicePublicId,
      allocation.paidAfterMinor,
      allocation.dueAfterMinor,
      allocation.creditedMinor,
      allocation.netDueAfterMinor,
      input.tenantId,
      allocation.allocationPublicId,
    ),
  ];
}

function receiptReconciliationStatement(
  db: CanonicalBatchDatabase,
  input: CollectPaymentInput,
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
      AND (
        (status='posted' AND NOT EXISTS (
          SELECT 1 FROM canonical_payment_tenders
          WHERE tenant_id=? AND receipt_public_id=? AND status<>'captured'
        ))
        OR (status='pending' AND allocated_total_minor=0 AND unallocated_minor=total_minor
          AND NOT EXISTS (
            SELECT 1 FROM canonical_payment_tenders
            WHERE tenant_id=? AND receipt_public_id=? AND status<>'verifying'
          ))
        OR (status='failed' AND allocated_total_minor=0 AND unallocated_minor=total_minor
          AND NOT EXISTS (
            SELECT 1 FROM canonical_payment_tenders
            WHERE tenant_id=? AND receipt_public_id=? AND status<>'failed'
          ))
      )
    ) THEN 1 ELSE 0 END
    WHERE tenant_id=? AND receipt_public_id=?
  `).bind(
    input.tenantId,
    input.receiptPublicId,
    input.tenantId,
    input.receiptPublicId,
    input.tenantId,
    input.receiptPublicId,
    input.tenantId,
    input.receiptPublicId,
    input.tenantId,
    input.receiptPublicId,
    input.tenantId,
    input.receiptPublicId,
  );
}

export async function collectPayment(
  db: CanonicalBatchDatabase,
  input: CollectPaymentInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<CollectPaymentResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.receiptPublicId, 'receiptPublicId');
  exact(input.receiptNumber, 'receiptNumber');
  positive(input.legacyPatientId, 'legacyPatientId');
  exact(input.currencyCode, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(input.currencyCode)) {
    throw new RangeError('currencyCode must be three uppercase letters');
  }
  normalizedUtc(input.receivedAtUtc, 'receivedAtUtc');
  exact(input.businessDate, 'businessDate');
  optionalPositive(input.legacyCollectorId, 'legacyCollectorId');
  optionalPositive(input.legacyCounterId, 'legacyCounterId');
  optionalPositive(input.legacyCounterSessionId, 'legacyCounterSessionId');
  nullableExact(input.externalTransactionId, 'externalTransactionId');
  exact(input.sourceType, 'sourceType');
  exact(input.sourcePublicId, 'sourcePublicId');
  exact(input.sourceTable, 'sourceTable');
  hash(input.sourceEvidenceSha256, 'sourceEvidenceSha256');
  exact(input.idempotencyKey, 'idempotencyKey');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  nonNegative(input.unallocatedMinor, 'unallocatedMinor');
  if (input.tenders.length === 0) throw new RangeError('payment receipt must contain at least one tender');

  const tenderIds = new Set<string>();
  const tenderStatuses = new Set<PaymentTenderStatus>();
  let tenderTotal = 0n;
  let cashTotal = 0n;
  for (const tender of input.tenders) {
    exact(tender.tenderPublicId, 'tender.tenderPublicId');
    if (tenderIds.has(tender.tenderPublicId)) throw new RangeError('duplicate tenderPublicId in receipt');
    tenderIds.add(tender.tenderPublicId);
    exact(tender.methodCode, 'tender.methodCode');
    positive(tender.amountMinor, 'tender.amountMinor');
    hash(tender.sourceEvidenceSha256, 'tender.sourceEvidenceSha256');
    nullableExact(tender.externalTransactionId, 'tender.externalTransactionId');
    if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(tender.tenderType)) {
      throw new RangeError(`Unsupported tenderType: ${tender.tenderType}`);
    }
    if (!['verifying', 'captured', 'failed'].includes(tender.status)) {
      throw new RangeError(`Unsupported tender status: ${tender.status}`);
    }
    tenderStatuses.add(tender.status);
    tenderTotal = addSafe(tenderTotal, tender.amountMinor, 'tender total');
    if (tender.tenderType === 'cash' && tender.status === 'captured') {
      cashTotal = addSafe(cashTotal, tender.amountMinor, 'cash tender total');
    }
  }
  if (tenderStatuses.size !== 1) throw new RangeError('all tender statuses must agree');

  const allocationIds = new Set<string>();
  const allocationByInvoice = new Map<string, bigint>();
  let allocationTotal = 0n;
  for (const allocation of input.allocations) {
    exact(allocation.allocationPublicId, 'allocation.allocationPublicId');
    if (allocationIds.has(allocation.allocationPublicId)) {
      throw new RangeError('duplicate allocationPublicId in receipt');
    }
    allocationIds.add(allocation.allocationPublicId);
    exact(allocation.invoicePublicId, 'allocation.invoicePublicId');
    nullableExact(allocation.invoiceLinePublicId, 'allocation.invoiceLinePublicId');
    positive(allocation.amountMinor, 'allocation.amountMinor');
    hash(allocation.sourceEvidenceSha256, 'allocation.sourceEvidenceSha256');
    allocationTotal = addSafe(allocationTotal, allocation.amountMinor, 'allocation total');
    allocationByInvoice.set(
      allocation.invoicePublicId,
      addSafe(allocationByInvoice.get(allocation.invoicePublicId) ?? 0n, allocation.amountMinor, 'invoice allocation total'),
    );
  }

  const statusValue = [...tenderStatuses][0];
  const receiptStatus: CollectPaymentResult['status'] = statusValue === 'captured'
    ? 'posted'
    : statusValue === 'verifying'
      ? 'pending'
      : 'failed';

  if (receiptStatus !== 'posted' && input.allocations.length > 0) {
    throw new RangeError('pending or failed receipt cannot contain allocations');
  }
  if (receiptStatus !== 'posted' && BigInt(input.unallocatedMinor) !== tenderTotal) {
    throw new RangeError('pending or failed receipt must remain fully unallocated');
  }
  if (receiptStatus === 'posted' && tenderTotal !== allocationTotal + BigInt(input.unallocatedMinor)) {
    throw new RangeError('receipt total must equal allocations plus unallocated balance');
  }
  if (cashTotal > 0n) exact(input.cashCustodyEventPublicId ?? '', 'cashCustodyEventPublicId');

  const request = requestShape(input);
  const replay = await readCanonicalCommandReplay<CollectPaymentResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.payment.collect',
    idempotencyKey: input.idempotencyKey,
    request,
  });
  if (replay) return replay;

  const invoiceRows = new Map<string, StoredInvoiceRow>();
  if (receiptStatus === 'posted') {
    for (const [invoicePublicId, amount] of allocationByInvoice) {
      const invoice = await db.prepare(`
        SELECT legacy_patient_id,currency_code,total_minor,paid_minor,due_minor,
               credited_minor,net_due_minor,status
        FROM canonical_invoices
        WHERE tenant_id=? AND invoice_public_id=?
        LIMIT 1
      `).bind(input.tenantId, invoicePublicId).first<StoredInvoiceRow>();
      if (!invoice) throw new Error('Canonical invoice not found');
      if (invoice.status !== 'posted') throw new Error('Canonical invoice is not posted');
      if (invoice.legacy_patient_id !== input.legacyPatientId) {
        throw new Error('Canonical invoice patient does not match receipt');
      }
      if (invoice.currency_code !== input.currencyCode) {
        throw new Error('Canonical invoice currency does not match receipt');
      }
      if (
        invoice.paid_minor + invoice.due_minor !== invoice.total_minor
        || invoice.net_due_minor !== invoice.due_minor - invoice.credited_minor
      ) {
        throw new Error('Canonical invoice balance is inconsistent');
      }
      if (amount > BigInt(invoice.due_minor) || amount > BigInt(invoice.net_due_minor)) {
        throw new RangeError('Payment allocation exceeds invoice outstanding balance');
      }
      invoiceRows.set(invoicePublicId, invoice);
    }

    for (const allocation of input.allocations) {
      if (allocation.invoiceLinePublicId == null) continue;
      const line = await db.prepare(`
        SELECT 1 present
        FROM canonical_invoice_lines
        WHERE tenant_id=? AND invoice_public_id=? AND line_public_id=?
        LIMIT 1
      `).bind(
        input.tenantId,
        allocation.invoicePublicId,
        allocation.invoiceLinePublicId,
      ).first<{ present: number }>();
      if (!line) throw new Error('Canonical invoice line not found');
    }
  }

  const workingBalances = new Map(
    [...invoiceRows.entries()].map(([invoicePublicId, invoice]) => [
      invoicePublicId,
      {
        paidMinor: invoice.paid_minor,
        dueMinor: invoice.due_minor,
        creditedMinor: invoice.credited_minor,
        netDueMinor: invoice.net_due_minor,
      },
    ]),
  );
  const preparedAllocations: PreparedAllocation[] = input.allocations.map((allocation) => {
    const balance = workingBalances.get(allocation.invoicePublicId);
    if (!balance) throw new Error('Canonical invoice balance was not prepared');
    const dueAfterMinor = balance.dueMinor - allocation.amountMinor;
    const netDueAfterMinor = balance.netDueMinor - allocation.amountMinor;
    const paidAfterMinor = balance.paidMinor + allocation.amountMinor;
    if (dueAfterMinor < 0 || netDueAfterMinor < 0 || !Number.isSafeInteger(paidAfterMinor)) {
      throw new RangeError('Payment allocation exceeds invoice outstanding balance');
    }
    const prepared: PreparedAllocation = {
      ...allocation,
      paidBeforeMinor: balance.paidMinor,
      paidAfterMinor,
      dueBeforeMinor: balance.dueMinor,
      dueAfterMinor,
      creditedMinor: balance.creditedMinor,
      netDueBeforeMinor: balance.netDueMinor,
      netDueAfterMinor,
    };
    workingBalances.set(allocation.invoicePublicId, {
      paidMinor: paidAfterMinor,
      dueMinor: dueAfterMinor,
      creditedMinor: balance.creditedMinor,
      netDueMinor: netDueAfterMinor,
    });
    return prepared;
  });

  const totalMinor = Number(tenderTotal);
  const allocatedMinor = Number(allocationTotal);
  const cashTenderMinor = Number(cashTotal);
  const result: CollectPaymentResult = {
    receiptPublicId: input.receiptPublicId,
    status: receiptStatus,
    totalMinor,
    allocatedMinor,
    unallocatedMinor: input.unallocatedMinor,
    cashTenderMinor,
  };

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_payment_receipts (
        tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
        total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
        business_date,legacy_collector_id,legacy_counter_id,legacy_counter_session_id,
        external_transaction_id,posted_at_utc,failed_at_utc,refunded_minor,
        net_received_minor,refund_projection_guard,reconciliation_guard,
        source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,1,1,?)
    `).bind(
      input.tenantId,
      input.receiptPublicId,
      input.receiptNumber,
      input.legacyPatientId,
      input.currencyCode,
      totalMinor,
      allocatedMinor,
      input.unallocatedMinor,
      receiptStatus,
      input.receivedAtUtc,
      input.businessDate,
      input.legacyCollectorId ?? null,
      input.legacyCounterId ?? null,
      input.legacyCounterSessionId ?? null,
      input.externalTransactionId ?? null,
      receiptStatus === 'posted' ? input.receivedAtUtc : null,
      receiptStatus === 'failed' ? input.receivedAtUtc : null,
      totalMinor,
      input.sourceEvidenceSha256,
    ),
    ...input.tenders.map((tender) => tenderStatement(db, input, tender)),
    ...preparedAllocations.flatMap((allocation) => allocationStatements(db, input, allocation)),
  ];

  if (cashTenderMinor > 0) {
    const cashPayload = stableCanonicalJson({
      cashAmountMinor: cashTenderMinor,
      counterId: input.legacyCounterId ?? null,
      counterSessionId: input.legacyCounterSessionId ?? null,
      receiptPublicId: input.receiptPublicId,
    });
    statements.push(db.prepare(`
      INSERT INTO canonical_outbox_events (
        tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
        event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
      ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
    `).bind(
      input.tenantId,
      input.cashCustodyEventPublicId,
      'canonical_cash_custody',
      input.receiptPublicId,
      'canonical.cash_custody.collection_recorded',
      cashPayload,
      input.receivedAtUtc,
      input.businessDate,
      `${input.idempotencyKey}:cash-custody`,
    ));
  }
  statements.push(receiptReconciliationStatement(db, input));

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.payment.collect',
    idempotencyKey: input.idempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements: [
      db.prepare(`
        INSERT INTO canonical_source_mappings (
          tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
          source_table,mapping_status,mapping_version,evidence_sha256
        ) VALUES (?,'payment_receipt',?,?,?,?,'mapped',1,?)
      `).bind(
        input.tenantId,
        input.receiptPublicId,
        input.sourceType,
        input.sourcePublicId,
        input.sourceTable,
        input.sourceEvidenceSha256,
      ),
    ],
    result,
    event: {
      eventPublicId: input.outboxEventPublicId,
      aggregateType: 'canonical_payment_receipt',
      aggregatePublicId: input.receiptPublicId,
      eventType: receiptStatus === 'posted'
        ? 'canonical.payment.receipt.posted'
        : receiptStatus === 'pending'
          ? 'canonical.payment.receipt.pending'
          : 'canonical.payment.receipt.failed',
      occurredAtUtc: input.receivedAtUtc,
      businessDate: input.businessDate,
      payload: {
        allocatedMinor,
        cashTenderMinor,
        receiptPublicId: input.receiptPublicId,
        status: receiptStatus,
        totalMinor,
        unallocatedMinor: input.unallocatedMinor,
      },
    },
  });
}
