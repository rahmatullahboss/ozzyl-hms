import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import { allocateOldestAvailableDeposits } from '../deposit-source-allocation';
import { stableCanonicalJson } from '../idempotency';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../source-mapping';
import { toUtcIso } from '../time';
import type { PaymentTenderType } from './collect-payment';
import type { IssueInvoiceInput, IssueInvoiceLineInput } from './issue-invoice';

export interface InvoiceSettlementPaymentInput {
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

export interface InvoiceSettlementDepositInput {
  adjustmentNumber: string;
  amountMinor: number;
  appliedAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourceTable: string;
}

export interface IssueInvoiceWithSettlementInput {
  tenantId: string;
  commandIdempotencyKey: string;
  invoice: IssueInvoiceInput;
  payment?: InvoiceSettlementPaymentInput | null;
  deposit?: InvoiceSettlementDepositInput | null;
}

export interface InvoiceSettlementDepositApplicationResult {
  applicationPublicId: string;
  depositPublicId: string;
  amountMinor: number;
  availableMinor: number;
}

export interface IssueInvoiceWithSettlementResult {
  invoicePublicId: string;
  receiptPublicId: string | null;
  totalMinor: number;
  depositMinor: number;
  paymentMinor: number;
  paidMinor: number;
  dueMinor: number;
  cashTenderMinor: number;
  depositApplications: InvoiceSettlementDepositApplicationResult[];
}

interface DepositRow {
  deposit_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  amount_minor: number;
  applied_minor: number;
  refunded_minor: number;
  available_minor: number;
  status: string;
  received_at_utc: string;
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

function validBusinessDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must use YYYY-MM-DD`);
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

  if (line.serviceEventPublicId != null) throw new TypeError('adjustment line cannot have serviceEventPublicId');
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

function calculateInvoiceTotals(lines: readonly IssueInvoiceLineInput[]) {
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
  if (total <= 0n) throw new RangeError('invoice total must be positive');
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError('invoice total exceeds the safe integer range');
  return {
    lineAmounts,
    subtotalMinor: Number(subtotal),
    adjustmentTotalMinor: Number(adjustments),
    totalMinor: Number(total),
  };
}

function sourceMappingStatement(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    entityType: string;
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

async function loadAvailableDeposits(
  db: CanonicalBatchDatabase,
  tenantId: string,
  legacyPatientId: number,
  currencyCode: string,
): Promise<DepositRow[]> {
  const rows: DepositRow[] = [];
  for (let offset = 0; ; offset += 1) {
    const row = await db.prepare(`
      SELECT deposit_public_id,legacy_patient_id,currency_code,amount_minor,
             applied_minor,refunded_minor,available_minor,status,received_at_utc
      FROM canonical_deposits
      WHERE tenant_id=? AND legacy_patient_id=? AND currency_code=?
        AND status='posted' AND available_minor>0
      ORDER BY received_at_utc ASC,deposit_public_id ASC
      LIMIT 1 OFFSET ?
    `).bind(tenantId, legacyPatientId, currencyCode, offset).first<DepositRow>();
    if (!row) break;
    rows.push(row);
  }
  return rows;
}

export async function issueInvoiceWithSettlement(
  db: CanonicalBatchDatabase,
  input: IssueInvoiceWithSettlementInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<IssueInvoiceWithSettlementResult>> {
  exact(input.tenantId, 'tenantId');
  exact(input.commandIdempotencyKey, 'commandIdempotencyKey');
  if (input.invoice.tenantId !== input.tenantId) throw new Error('invoice tenant must match command tenant');
  exact(input.invoice.invoicePublicId, 'invoice.invoicePublicId');
  exact(input.invoice.invoiceNumber, 'invoice.invoiceNumber');
  positive(input.invoice.legacyPatientId, 'invoice.legacyPatientId');
  exact(input.invoice.currencyCode, 'invoice.currencyCode');
  if (!/^[A-Z]{3}$/.test(input.invoice.currencyCode)) {
    throw new RangeError('invoice currencyCode must be three uppercase letters');
  }
  normalizedUtc(input.invoice.issuedAtUtc, 'invoice.issuedAtUtc');
  validBusinessDate(input.invoice.businessDate, 'invoice.businessDate');
  exact(input.invoice.sourceType, 'invoice.sourceType');
  exact(input.invoice.sourcePublicId, 'invoice.sourcePublicId');
  exact(input.invoice.sourceTable, 'invoice.sourceTable');
  exact(input.invoice.outboxEventPublicId, 'invoice.outboxEventPublicId');
  hash(input.invoice.sourceEvidenceSha256, 'invoice.sourceEvidenceSha256');

  const payment = input.payment ?? null;
  if (payment) {
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
  }

  const deposit = input.deposit ?? null;
  if (deposit) {
    exact(deposit.adjustmentNumber, 'deposit.adjustmentNumber');
    positive(deposit.amountMinor, 'deposit.amountMinor');
    normalizedUtc(deposit.appliedAtUtc, 'deposit.appliedAtUtc');
    validBusinessDate(deposit.businessDate, 'deposit.businessDate');
    exact(deposit.sourceType, 'deposit.sourceType');
    exact(deposit.sourceTable, 'deposit.sourceTable');
    if (deposit.businessDate !== input.invoice.businessDate) {
      throw new Error('deposit business date must match invoice business date');
    }
  }

  const totals = calculateInvoiceTotals(input.invoice.lines);
  const paymentMinor = payment?.amountMinor ?? 0;
  const depositMinor = deposit?.amountMinor ?? 0;
  if (paymentMinor + depositMinor > totals.totalMinor) {
    throw new RangeError('Settlement amount exceeds invoice total');
  }
  const paidMinor = paymentMinor + depositMinor;
  const dueMinor = totals.totalMinor - paidMinor;
  const cashTenderMinor = payment?.tenderType === 'cash' ? paymentMinor : 0;

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
    payment: payment ? {
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
    } : null,
    deposit: deposit ? {
      adjustmentNumber: deposit.adjustmentNumber,
      amountMinor: deposit.amountMinor,
      appliedAtUtc: deposit.appliedAtUtc,
      businessDate: deposit.businessDate,
      sourceType: deposit.sourceType,
      sourceTable: deposit.sourceTable,
    } : null,
  };

  const replay = await readCanonicalCommandReplay<IssueInvoiceWithSettlementResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.invoice.issue_settlement',
    idempotencyKey: input.commandIdempotencyKey,
    request,
  });
  if (replay) return replay;

  const sources = deposit
    ? await loadAvailableDeposits(db, input.tenantId, input.invoice.legacyPatientId, input.invoice.currencyCode)
    : [];
  const allocationPlan = deposit
    ? allocateOldestAvailableDeposits(sources.map((row) => ({
        depositPublicId: row.deposit_public_id,
        availableMinor: row.available_minor,
        receivedAtUtc: row.received_at_utc,
        status: row.status,
      })), depositMinor)
    : [];
  const sourceById = new Map(sources.map((row) => [row.deposit_public_id, row]));

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_invoices (
        tenant_id,invoice_public_id,invoice_number,legacy_patient_id,
        currency_code,subtotal_minor,adjustment_total_minor,total_minor,
        paid_minor,due_minor,credited_minor,net_due_minor,adjustment_projection_guard,
        status,issued_at_utc,posted_at_utc,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,1,'posted',?,?,?)
    `).bind(
      input.tenantId,
      input.invoice.invoicePublicId,
      input.invoice.invoiceNumber,
      input.invoice.legacyPatientId,
      input.invoice.currencyCode,
      totals.subtotalMinor,
      totals.adjustmentTotalMinor,
      totals.totalMinor,
      paidMinor,
      dueMinor,
      dueMinor,
      input.invoice.issuedAtUtc,
      input.invoice.issuedAtUtc,
      input.invoice.sourceEvidenceSha256,
    ),
    ...input.invoice.lines.map((line, index) => db.prepare(`
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
      totals.lineAmounts[index],
      line.sourceEvidenceSha256,
    )),
  ];

  const mappings: CanonicalPreparedStatement[] = [
    sourceMappingStatement(db, {
      tenantId: input.tenantId,
      entityType: 'invoice',
      canonicalPublicId: input.invoice.invoicePublicId,
      sourceType: input.invoice.sourceType,
      sourcePublicId: input.invoice.sourcePublicId,
      sourceTable: input.invoice.sourceTable,
      evidenceSha256: input.invoice.sourceEvidenceSha256,
    }),
  ];
  const depositApplications: InvoiceSettlementDepositApplicationResult[] = [];
  let runningPaid = 0;
  let runningDue = totals.totalMinor;
  let runningNetDue = totals.totalMinor;

  for (let index = 0; index < allocationPlan.length; index += 1) {
    const allocation = allocationPlan[index];
    const source = sourceById.get(allocation.depositPublicId);
    if (!source) throw new Error('Canonical deposit allocation source not found');
    if (source.legacy_patient_id !== input.invoice.legacyPatientId) throw new Error('Canonical deposit patient mismatch');
    if (source.currency_code !== input.invoice.currencyCode) throw new Error('Canonical deposit currency mismatch');
    if (source.status !== 'posted') throw new Error('Canonical deposit is not posted');

    const applicationPublicId = await createDeterministicSourceId(
      'depapp',
      input.tenantId,
      'canonical_deposit_application',
      `${deposit!.adjustmentNumber}:${allocation.depositPublicId}:${index + 1}`,
    );
    const sourcePublicId = `${deposit!.adjustmentNumber}:${index + 1}`;
    const availableAfter = source.available_minor - allocation.amountMinor;
    const appliedAfter = source.applied_minor + allocation.amountMinor;
    const paidBefore = runningPaid;
    const dueBefore = runningDue;
    const netDueBefore = runningNetDue;
    runningPaid += allocation.amountMinor;
    runningDue -= allocation.amountMinor;
    runningNetDue -= allocation.amountMinor;
    const sourceEvidenceSha256 = await createSourceEvidenceSha256({
      sourceType: deposit!.sourceType,
      sourcePublicId,
      sourceTable: deposit!.sourceTable,
      adjustmentNumber: deposit!.adjustmentNumber,
      applicationPublicId,
      depositPublicId: allocation.depositPublicId,
      invoicePublicId: input.invoice.invoicePublicId,
      legacyPatientId: input.invoice.legacyPatientId,
      currencyCode: input.invoice.currencyCode,
      amountMinor: allocation.amountMinor,
      depositAvailableBeforeMinor: source.available_minor,
      depositAvailableAfterMinor: availableAfter,
      invoicePaidBeforeMinor: paidBefore,
      invoicePaidAfterMinor: runningPaid,
      invoiceDueBeforeMinor: dueBefore,
      invoiceDueAfterMinor: runningDue,
      appliedAtUtc: deposit!.appliedAtUtc,
      businessDate: deposit!.businessDate,
      sliceNumber: index + 1,
    });

    statements.push(
      db.prepare(`
        INSERT INTO canonical_deposit_applications (
          tenant_id,application_public_id,deposit_public_id,invoice_public_id,
          invoice_line_public_id,amount_minor,deposit_available_before_minor,
          deposit_available_after_minor,invoice_paid_before_minor,invoice_paid_after_minor,
          invoice_due_before_minor,invoice_due_after_minor,invoice_net_due_before_minor,
          invoice_net_due_after_minor,status,applied_at_utc,balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,NULL,?,?,?,?,?,?,?,?,?,'active',?,1,?)
      `).bind(
        input.tenantId,
        applicationPublicId,
        allocation.depositPublicId,
        input.invoice.invoicePublicId,
        allocation.amountMinor,
        source.available_minor,
        availableAfter,
        paidBefore,
        runningPaid,
        dueBefore,
        runningDue,
        netDueBefore,
        runningNetDue,
        deposit!.appliedAtUtc,
        sourceEvidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_deposits
        SET applied_minor=?,available_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND deposit_public_id=? AND status='posted'
          AND applied_minor=? AND refunded_minor=? AND available_minor=?
      `).bind(
        appliedAfter,
        availableAfter,
        deposit!.appliedAtUtc,
        input.tenantId,
        allocation.depositPublicId,
        source.applied_minor,
        source.refunded_minor,
        source.available_minor,
      ),
      db.prepare(`
        UPDATE canonical_deposit_applications
        SET balance_guard=CASE WHEN EXISTS (
          SELECT 1 FROM canonical_deposits
          WHERE tenant_id=? AND deposit_public_id=?
            AND applied_minor=? AND refunded_minor=? AND available_minor=?
        ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND application_public_id=?
      `).bind(
        input.tenantId,
        allocation.depositPublicId,
        appliedAfter,
        source.refunded_minor,
        availableAfter,
        input.tenantId,
        applicationPublicId,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        await createDeterministicSourceId(
          'outevt',
          input.tenantId,
          'canonical_deposit_application_event',
          `${deposit!.adjustmentNumber}:${allocation.depositPublicId}:${index + 1}`,
        ),
        'canonical_deposit',
        allocation.depositPublicId,
        'canonical.deposit.applied',
        stableCanonicalJson({
          amountMinor: allocation.amountMinor,
          applicationPublicId,
          depositPublicId: allocation.depositPublicId,
          invoicePublicId: input.invoice.invoicePublicId,
        }),
        deposit!.appliedAtUtc,
        deposit!.businessDate,
        `${input.commandIdempotencyKey}:deposit:${index + 1}`,
      ),
    );
    mappings.push(sourceMappingStatement(db, {
      tenantId: input.tenantId,
      entityType: 'deposit_application',
      canonicalPublicId: applicationPublicId,
      sourceType: deposit!.sourceType,
      sourcePublicId,
      sourceTable: deposit!.sourceTable,
      evidenceSha256: sourceEvidenceSha256,
    }));
    depositApplications.push({
      applicationPublicId,
      depositPublicId: allocation.depositPublicId,
      amountMinor: allocation.amountMinor,
      availableMinor: availableAfter,
    });
  }

  if (payment) {
    const paymentDueBefore = totals.totalMinor - depositMinor;
    statements.push(
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
        paymentMinor,
        paymentMinor,
        payment.receivedAtUtc,
        input.invoice.businessDate,
        payment.legacyCollectorId ?? null,
        payment.legacyCounterId ?? null,
        payment.legacyCounterSessionId ?? null,
        payment.externalTransactionId ?? null,
        payment.receivedAtUtc,
        paymentMinor,
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
        paymentMinor,
        payment.externalTransactionId ?? null,
        payment.receivedAtUtc,
        paymentMinor,
        payment.sourceEvidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_payment_allocations (
          tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
          invoice_line_public_id,amount_minor,invoice_due_before_minor,
          invoice_due_after_minor,status,allocated_at_utc,reversed_minor,remaining_minor,
          reversal_projection_guard,balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,NULL,?,?,?,'active',?,0,?,1,1,?)
      `).bind(
        input.tenantId,
        payment.allocationPublicId,
        payment.receiptPublicId,
        input.invoice.invoicePublicId,
        paymentMinor,
        paymentDueBefore,
        dueMinor,
        payment.receivedAtUtc,
        paymentMinor,
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
          allocatedMinor: paymentMinor,
          cashTenderMinor,
          receiptPublicId: payment.receiptPublicId,
          status: 'posted',
          totalMinor: paymentMinor,
          unallocatedMinor: 0,
        }),
        payment.receivedAtUtc,
        input.invoice.businessDate,
        `${input.commandIdempotencyKey}:payment`,
      ),
      db.prepare(`
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
      ),
    );
    mappings.push(sourceMappingStatement(db, {
      tenantId: input.tenantId,
      entityType: 'payment_receipt',
      canonicalPublicId: payment.receiptPublicId,
      sourceType: payment.sourceType,
      sourcePublicId: payment.sourcePublicId,
      sourceTable: payment.sourceTable,
      evidenceSha256: payment.sourceEvidenceSha256,
    }));
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
  }

  const result: IssueInvoiceWithSettlementResult = {
    invoicePublicId: input.invoice.invoicePublicId,
    receiptPublicId: payment?.receiptPublicId ?? null,
    totalMinor: totals.totalMinor,
    depositMinor,
    paymentMinor,
    paidMinor,
    dueMinor,
    cashTenderMinor,
    depositApplications,
  };

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.invoice.issue_settlement',
    idempotencyKey: input.commandIdempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements: mappings,
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

export interface PreparedInvoiceSettlementBatch {
  statements: CanonicalPreparedStatement[];
  result: IssueInvoiceWithSettlementResult;
}

/**
 * Builds the exact canonical invoice-settlement statements without committing them.
 * The captured command claim is intentionally omitted so a larger composite command
 * can own the single idempotency envelope while preserving all domain statements.
 */
export async function prepareInvoiceSettlementBatch(
  db: CanonicalBatchDatabase,
  input: IssueInvoiceWithSettlementInput,
): Promise<PreparedInvoiceSettlementBatch> {
  const capture: { statements: CanonicalPreparedStatement[] | null } = { statements: null };
  const captureDb: CanonicalBatchDatabase = {
    prepare(sql: string) {
      return db.prepare(sql);
    },
    async batch(statements) {
      capture.statements = [...statements];
      return statements.map(() => ({ success: true }));
    },
  };

  const prepared = await issueInvoiceWithSettlement(captureDb, input);
  const captured = capture.statements;
  if (!captured || captured.length === 0) {
    throw new Error('Invoice settlement preparation did not produce a canonical batch');
  }
  const [, ...statements] = captured;
  return {
    statements,
    result: prepared.result,
  };
}
