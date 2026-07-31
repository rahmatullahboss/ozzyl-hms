import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from '../command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../financial-batch-assertion';
import { stableCanonicalJson } from '../idempotency';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../source-mapping';
import { toUtcIso } from '../time';

export type SettlementTenderType =
  | 'cash'
  | 'card'
  | 'mobile_wallet'
  | 'bank_transfer'
  | 'gateway'
  | 'other';

export interface FinalizeSettlementBillInput {
  billId: number;
  invoicePublicId: string;
  invoiceNumber: string;
  legacyTotalMinor: number;
  legacyPaidBeforeMinor: number;
  legacyDueBeforeMinor: number;
  canonicalPaidBeforeMinor: number;
  canonicalDueBeforeMinor: number;
  canonicalCreditedBeforeMinor: number;
  canonicalNetDueBeforeMinor: number;
  cashMinor: number;
  depositMinor: number;
  discountMinor: number;
  paymentReceiptNumber: string | null;
  depositAdjustmentReceiptNumber: string | null;
  discountNumber: string | null;
  discountReasonCode: string | null;
  discountAllocationType: string | null;
  discountReferenceName: string | null;
  discountNote: string | null;
}

export interface FinalizeSettlementInput {
  tenantId: string;
  commandIdempotencyKey: string;
  settlementPublicId: string;
  settlementReceiptNumber: string;
  legacyPatientId: number;
  currencyCode: 'BDT';
  occurredAtUtc: string;
  businessDate: string;
  legacyCollectorId: number;
  legacyCounterId: number;
  legacyCounterSessionId: number;
  paymentMethod: string;
  tenderType: SettlementTenderType;
  bills: readonly FinalizeSettlementBillInput[];
}

export interface FinalizeSettlementDepositApplicationResult {
  applicationPublicId: string;
  depositPublicId: string;
  invoicePublicId: string;
  amountMinor: number;
}

export interface FinalizeSettlementBillResult {
  billId: number;
  invoicePublicId: string;
  paymentReceiptPublicId: string | null;
  creditNotePublicId: string | null;
  depositApplications: FinalizeSettlementDepositApplicationResult[];
  paidMinor: number;
  dueMinor: number;
  creditedMinor: number;
  netDueMinor: number;
}

export interface FinalizeSettlementResult {
  settlementPublicId: string;
  settlementReceiptNumber: string;
  cashMinor: number;
  depositMinor: number;
  discountMinor: number;
  bills: FinalizeSettlementBillResult[];
}

interface InvoiceRow {
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}

interface NameRow {
  name: string;
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

interface WorkingDeposit extends DepositRow {
  fragmentIndex: number;
}

interface PreparedCashBill {
  input: FinalizeSettlementBillInput;
  receiptPublicId: string;
  tenderPublicId: string;
  allocationPublicId: string;
  paymentEventPublicId: string;
  cashCustodyEventPublicId: string | null;
  evidenceSha256: string;
  paidAfterMinor: number;
  dueAfterMinor: number;
  netDueAfterMinor: number;
}

interface PreparedDiscount {
  bill: FinalizeSettlementBillInput;
  creditNotePublicId: string;
  creditLinePublicId: string;
  eventPublicId: string;
  evidenceSha256: string;
  creditedBeforeMinor: number;
  creditedAfterMinor: number;
  netDueBeforeMinor: number;
  netDueAfterMinor: number;
}

interface PreparedDepositApplication {
  bill: FinalizeSettlementBillInput;
  applicationPublicId: string;
  eventPublicId: string;
  sourcePublicId: string;
  evidenceSha256: string;
  depositPublicId: string;
  depositAmountMinor: number;
  depositReceivedAtUtc: string;
  amountMinor: number;
  depositAppliedBeforeMinor: number;
  depositAppliedAfterMinor: number;
  depositRefundedMinor: number;
  depositAvailableBeforeMinor: number;
  depositAvailableAfterMinor: number;
  invoicePaidBeforeMinor: number;
  invoicePaidAfterMinor: number;
  invoiceDueBeforeMinor: number;
  invoiceDueAfterMinor: number;
  invoiceCreditedMinor: number;
  invoiceNetDueBeforeMinor: number;
  invoiceNetDueAfterMinor: number;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function optionalExact(value: string | null, label: string): string | null {
  if (value == null) return null;
  return exact(value, label);
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegative(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function utc(value: string, label: string): string {
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be normalized UTC`);
  return value;
}

function addSafe(total: bigint, value: number, label: string): bigint {
  const next = total + BigInt(value);
  if (next > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} exceeds safe range`);
  return next;
}

function requestShape(input: FinalizeSettlementInput): Record<string, unknown> {
  return {
    settlementPublicId: input.settlementPublicId,
    settlementReceiptNumber: input.settlementReceiptNumber,
    legacyPatientId: input.legacyPatientId,
    currencyCode: input.currencyCode,
    occurredAtUtc: input.occurredAtUtc,
    businessDate: input.businessDate,
    legacyCollectorId: input.legacyCollectorId,
    legacyCounterId: input.legacyCounterId,
    legacyCounterSessionId: input.legacyCounterSessionId,
    paymentMethod: input.paymentMethod,
    tenderType: input.tenderType,
    bills: input.bills,
  };
}

function validate(input: FinalizeSettlementInput): void {
  exact(input.tenantId, 'tenantId');
  exact(input.commandIdempotencyKey, 'commandIdempotencyKey');
  exact(input.settlementPublicId, 'settlementPublicId');
  exact(input.settlementReceiptNumber, 'settlementReceiptNumber');
  positive(input.legacyPatientId, 'legacyPatientId');
  if (input.currencyCode !== 'BDT') throw new RangeError('Settlement currency must be BDT');
  utc(input.occurredAtUtc, 'occurredAtUtc');
  exact(input.businessDate, 'businessDate');
  positive(input.legacyCollectorId, 'legacyCollectorId');
  positive(input.legacyCounterId, 'legacyCounterId');
  positive(input.legacyCounterSessionId, 'legacyCounterSessionId');
  exact(input.paymentMethod, 'paymentMethod');
  if (!['cash', 'card', 'mobile_wallet', 'bank_transfer', 'gateway', 'other'].includes(input.tenderType)) {
    throw new RangeError('Unsupported settlement tender type');
  }
  if (input.bills.length === 0) throw new RangeError('Settlement requires at least one bill');

  const seen = new Set<number>();
  let priorBillId = 0;
  for (const bill of input.bills) {
    positive(bill.billId, 'bill.billId');
    if (seen.has(bill.billId)) throw new RangeError('duplicate settlement bill');
    if (bill.billId <= priorBillId) throw new RangeError('settlement bills must be ordered by billId');
    seen.add(bill.billId);
    priorBillId = bill.billId;
    exact(bill.invoicePublicId, 'bill.invoicePublicId');
    exact(bill.invoiceNumber, 'bill.invoiceNumber');
    nonNegative(bill.legacyTotalMinor, 'bill.legacyTotalMinor');
    nonNegative(bill.legacyPaidBeforeMinor, 'bill.legacyPaidBeforeMinor');
    nonNegative(bill.legacyDueBeforeMinor, 'bill.legacyDueBeforeMinor');
    nonNegative(bill.canonicalPaidBeforeMinor, 'bill.canonicalPaidBeforeMinor');
    nonNegative(bill.canonicalDueBeforeMinor, 'bill.canonicalDueBeforeMinor');
    nonNegative(bill.canonicalCreditedBeforeMinor, 'bill.canonicalCreditedBeforeMinor');
    nonNegative(bill.canonicalNetDueBeforeMinor, 'bill.canonicalNetDueBeforeMinor');
    nonNegative(bill.cashMinor, 'bill.cashMinor');
    nonNegative(bill.depositMinor, 'bill.depositMinor');
    nonNegative(bill.discountMinor, 'bill.discountMinor');
    optionalExact(bill.paymentReceiptNumber, 'bill.paymentReceiptNumber');
    optionalExact(bill.depositAdjustmentReceiptNumber, 'bill.depositAdjustmentReceiptNumber');
    optionalExact(bill.discountNumber, 'bill.discountNumber');
    optionalExact(bill.discountReasonCode, 'bill.discountReasonCode');
    optionalExact(bill.discountAllocationType, 'bill.discountAllocationType');
    optionalExact(bill.discountReferenceName, 'bill.discountReferenceName');
    optionalExact(bill.discountNote, 'bill.discountNote');

    if (bill.legacyPaidBeforeMinor + bill.legacyDueBeforeMinor !== bill.legacyTotalMinor) {
      throw new Error('Legacy settlement bill balance is inconsistent');
    }
    if (bill.canonicalPaidBeforeMinor + bill.canonicalDueBeforeMinor !== bill.legacyTotalMinor) {
      throw new Error('Canonical settlement invoice balance is inconsistent');
    }
    if (bill.canonicalNetDueBeforeMinor !== bill.canonicalDueBeforeMinor - bill.canonicalCreditedBeforeMinor) {
      throw new Error('Canonical settlement net due is inconsistent');
    }
    if (bill.legacyPaidBeforeMinor !== bill.canonicalPaidBeforeMinor + bill.canonicalCreditedBeforeMinor) {
      throw new Error('Legacy and canonical settlement paid authority do not reconcile');
    }
    if (bill.legacyDueBeforeMinor !== bill.canonicalNetDueBeforeMinor) {
      throw new Error('Legacy and canonical settlement due authority do not reconcile');
    }
    const applied = bill.cashMinor + bill.depositMinor + bill.discountMinor;
    if (!Number.isSafeInteger(applied) || applied > bill.legacyDueBeforeMinor) {
      throw new RangeError('Settlement allocation exceeds bill outstanding balance');
    }
    if ((bill.cashMinor > 0) !== (bill.paymentReceiptNumber != null)) {
      throw new Error('Settlement payment receipt identity does not match cash allocation');
    }
    if ((bill.depositMinor > 0) !== (bill.depositAdjustmentReceiptNumber != null)) {
      throw new Error('Settlement deposit receipt identity does not match deposit allocation');
    }
    if ((bill.discountMinor > 0) !== (bill.discountNumber != null)) {
      throw new Error('Settlement discount identity does not match discount allocation');
    }

  }
}

function paymentSourceMapping(
  db: CanonicalBatchDatabase,
  input: FinalizeSettlementInput,
  prepared: PreparedCashBill,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    )
    SELECT ?,'payment_receipt',?,'legacy_settlement_payment',p.receipt_no,
           'payments','mapped',1,?
    FROM payments p
    JOIN bills b
      ON b.id=p.bill_id AND CAST(b.tenant_id AS TEXT)=CAST(p.tenant_id AS TEXT)
    JOIN billing_settlements s
      ON s.id=b.settlement_id AND CAST(s.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
    WHERE CAST(p.tenant_id AS TEXT)=? AND p.bill_id=? AND p.receipt_no=?
      AND ROUND(p.amount*100)=? AND p.payment_method=?
      AND p.received_by=? AND p.counter_id=? AND p.counter_session_id=?
      AND s.settlement_receipt_no=? AND s.patient_id=? AND s.is_active=1
  `).bind(
    input.tenantId,
    prepared.receiptPublicId,
    prepared.evidenceSha256,
    input.tenantId,
    prepared.input.billId,
    prepared.input.paymentReceiptNumber,
    prepared.input.cashMinor,
    input.paymentMethod,
    input.legacyCollectorId,
    input.legacyCounterId,
    input.legacyCounterSessionId,
    input.settlementReceiptNumber,
    input.legacyPatientId,
  );
}

async function tableExists(
  db: CanonicalBatchDatabase,
  tableName: string,
): Promise<boolean> {
  const row = await db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type='table' AND name=?
    LIMIT 1
  `).bind(tableName).first<NameRow>();
  return row !== null;
}

async function assertCompensationSafe(
  db: CanonicalBatchDatabase,
  tenantId: string,
  invoicePublicId: string,
): Promise<void> {
  const canonicalBlocked = await db.prepare(`
    SELECT 1 present
    FROM canonical_compensation_accruals
    WHERE tenant_id=? AND invoice_public_id=? AND settled_minor>0
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{ present: number }>();
  if (canonicalBlocked) {
    throw new Error('Paid performer reserve or compensation settlement blocks settlement discount');
  }

  const [hasPerformerReserves, hasDoctorAccruals] = await Promise.all([
    tableExists(db, 'diagnostic_performer_reserves'),
    tableExists(db, 'doctor_commission_accruals'),
  ]);
  if (!hasPerformerReserves && !hasDoctorAccruals) return;

  const invalidMapping = await db.prepare(`
    SELECT 1 present
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice'
      AND canonical_public_id=? AND mapping_status='mapped'
      AND source_table='bills'
      AND (
        source_public_id=''
        OR source_public_id GLOB '*[^0-9]*'
        OR CAST(source_public_id AS INTEGER)<=0
      )
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{ present: number }>();
  if (invalidMapping) {
    throw new Error('Canonical invoice has an invalid legacy bill mapping for compensation safety');
  }

  const legacyPredicates: string[] = [];
  if (hasPerformerReserves) {
    legacyPredicates.push(`EXISTS (
      SELECT 1 FROM diagnostic_performer_reserves r
      WHERE r.tenant_id=m.tenant_id
        AND r.bill_id=CAST(m.source_public_id AS INTEGER)
        AND r.status='paid'
    )`);
  }
  if (hasDoctorAccruals) {
    legacyPredicates.push(`EXISTS (
      SELECT 1 FROM doctor_commission_accruals a
      WHERE a.tenant_id=m.tenant_id
        AND a.bill_id=CAST(m.source_public_id AS INTEGER)
        AND a.status='paid'
    )`);
  }

  const legacyBlocked = await db.prepare(`
    SELECT 1 present
    FROM canonical_source_mappings m
    WHERE m.tenant_id=? AND m.entity_type='invoice'
      AND m.canonical_public_id=? AND m.mapping_status='mapped'
      AND m.source_table='bills'
      AND (${legacyPredicates.join(' OR ')})
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{ present: number }>();
  if (legacyBlocked) {
    throw new Error('Paid performer reserve or compensation settlement blocks settlement discount');
  }
}

async function loadAvailableDeposits(
  db: CanonicalBatchDatabase,
  input: FinalizeSettlementInput,
): Promise<WorkingDeposit[]> {
  const rows: WorkingDeposit[] = [];
  for (let offset = 0; ; offset += 1) {
    const row = await db.prepare(`
      SELECT deposit_public_id,legacy_patient_id,currency_code,amount_minor,
             applied_minor,refunded_minor,available_minor,status,received_at_utc
      FROM canonical_deposits
      WHERE tenant_id=? AND legacy_patient_id=? AND currency_code=?
        AND status='posted' AND available_minor>0
      ORDER BY received_at_utc,deposit_public_id
      LIMIT 1 OFFSET ?
    `).bind(
      input.tenantId,
      input.legacyPatientId,
      input.currencyCode,
      offset,
    ).first<DepositRow>();
    if (!row) break;
    if (
      row.legacy_patient_id !== input.legacyPatientId
      || row.currency_code !== input.currencyCode
      || row.status !== 'posted'
      || row.amount_minor !== row.applied_minor + row.refunded_minor + row.available_minor
    ) {
      throw new Error('Canonical settlement deposit snapshot is inconsistent');
    }
    rows.push({ ...row, fragmentIndex: 0 });
  }
  return rows;
}

function depositSourceMapping(
  db: CanonicalBatchDatabase,
  input: FinalizeSettlementInput,
  prepared: PreparedDepositApplication,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    )
    SELECT ?,'deposit_application',?,'legacy_settlement_deposit_adjustment',?,
           'billing_deposits','mapped',1,?
    FROM billing_deposits d
    JOIN bills b
      ON b.id=d.reference_bill_id AND CAST(b.tenant_id AS TEXT)=CAST(d.tenant_id AS TEXT)
    JOIN billing_settlements s
      ON s.id=b.settlement_id AND CAST(s.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
    WHERE CAST(d.tenant_id AS TEXT)=? AND d.patient_id=?
      AND d.deposit_receipt_no=? AND d.transaction_type='adjustment'
      AND d.reference_bill_id=? AND ROUND(d.amount*100)=?
      AND d.created_by=? AND d.counter_id=? AND d.counter_session_id=?
      AND COALESCE(d.is_active,1)=1
      AND s.settlement_receipt_no=? AND s.is_active=1
  `).bind(
    input.tenantId,
    prepared.applicationPublicId,
    prepared.sourcePublicId,
    prepared.evidenceSha256,
    input.tenantId,
    input.legacyPatientId,
    prepared.bill.depositAdjustmentReceiptNumber,
    prepared.bill.billId,
    prepared.bill.depositMinor,
    input.legacyCollectorId,
    input.legacyCounterId,
    input.legacyCounterSessionId,
    input.settlementReceiptNumber,
  );
}

function discountSourceMapping(
  db: CanonicalBatchDatabase,
  input: FinalizeSettlementInput,
  prepared: PreparedDiscount,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    )
    SELECT ?,'credit_note',?,'legacy_settlement_discount',?,
           'bill_discount_allocations','mapped',1,?
    FROM bill_discount_allocations a
    JOIN bills b
      ON b.id=a.bill_id AND CAST(b.tenant_id AS TEXT)=CAST(a.tenant_id AS TEXT)
    JOIN billing_settlements s
      ON s.id=a.settlement_id AND s.id=b.settlement_id
     AND CAST(s.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
    WHERE CAST(a.tenant_id AS TEXT)=? AND a.bill_id=?
      AND a.settlement_id=s.id AND a.allocation_type=? AND a.discount_reason=?
      AND ROUND(a.amount*100)=?
      AND COALESCE(a.reference_name,'')=COALESCE(?,'')
      AND COALESCE(a.note,'')=COALESCE(?,'')
      AND s.settlement_receipt_no=? AND s.patient_id=? AND s.is_active=1
  `).bind(
    input.tenantId,
    prepared.creditNotePublicId,
    prepared.bill.discountNumber,
    prepared.evidenceSha256,
    input.tenantId,
    prepared.bill.billId,
    prepared.bill.discountAllocationType,
    prepared.bill.discountReasonCode,
    prepared.bill.discountMinor,
    prepared.bill.discountReferenceName,
    prepared.bill.discountNote,
    input.settlementReceiptNumber,
    input.legacyPatientId,
  );
}

function settlementSourceMapping(
  db: CanonicalBatchDatabase,
  input: FinalizeSettlementInput,
  evidenceSha256: string,
  payableMinor: number,
  cashMinor: number,
  depositMinor: number,
  discountMinor: number,
): CanonicalPreparedStatement {
  return db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,evidence_sha256
    )
    SELECT ?,'settlement',?,'legacy_settlement',s.settlement_receipt_no,
           'billing_settlements','mapped',1,?
    FROM billing_settlements s
    WHERE CAST(s.tenant_id AS TEXT)=? AND s.settlement_receipt_no=?
      AND s.patient_id=? AND ROUND(s.payable_amount*100)=?
      AND ROUND(s.paid_amount*100)=? AND ROUND(s.deposit_deducted*100)=?
      AND ROUND(s.discount_amount*100)=? AND s.payment_mode=?
      AND s.created_by=? AND s.counter_id=? AND s.counter_session_id=?
      AND s.is_active=1
  `).bind(
    input.tenantId,
    input.settlementPublicId,
    evidenceSha256,
    input.tenantId,
    input.settlementReceiptNumber,
    input.legacyPatientId,
    payableMinor,
    cashMinor,
    depositMinor,
    discountMinor,
    input.paymentMethod,
    input.legacyCollectorId,
    input.legacyCounterId,
    input.legacyCounterSessionId,
  );
}

export async function finalizeSettlement(
  db: CanonicalBatchDatabase,
  input: FinalizeSettlementInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<FinalizeSettlementResult>> {
  validate(input);
  const request = requestShape(input);
  const replay = await readCanonicalCommandReplay<FinalizeSettlementResult>(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.settlement.finalize',
    idempotencyKey: input.commandIdempotencyKey,
    request,
  });
  if (replay) return replay;

  let cashTotal = 0n;
  let depositTotal = 0n;
  let discountTotal = 0n;
  let payableTotal = 0n;
  const requestedDepositMinor = input.bills.reduce((sum, bill) => sum + bill.depositMinor, 0);
  if (!Number.isSafeInteger(requestedDepositMinor)) {
    throw new RangeError('Settlement deposit total exceeds safe range');
  }
  const workingDeposits = requestedDepositMinor > 0 ? await loadAvailableDeposits(db, input) : [];
  const canonicalDepositAvailable = workingDeposits.reduce((sum, row) => sum + row.available_minor, 0);
  if (!Number.isSafeInteger(canonicalDepositAvailable) || canonicalDepositAvailable < requestedDepositMinor) {
    throw new RangeError('Canonical settlement deposit balance is insufficient');
  }
  let depositCursor = 0;
  const preparedCashBills: PreparedCashBill[] = [];
  const preparedDepositApplications: PreparedDepositApplication[] = [];
  const preparedDiscounts: PreparedDiscount[] = [];
  const resultBills: FinalizeSettlementBillResult[] = [];

  for (const bill of input.bills) {
    const invoice = await db.prepare(`
      SELECT legacy_patient_id,currency_code,total_minor,paid_minor,due_minor,
             credited_minor,net_due_minor,status
      FROM canonical_invoices
      WHERE tenant_id=? AND invoice_public_id=?
      LIMIT 1
    `).bind(input.tenantId, bill.invoicePublicId).first<InvoiceRow>();
    if (!invoice) throw new Error('Canonical settlement invoice not found');
    if (invoice.status !== 'posted') throw new Error('Canonical settlement invoice is not posted');
    if (invoice.legacy_patient_id !== input.legacyPatientId) throw new Error('Canonical settlement invoice patient mismatch');
    if (invoice.currency_code !== input.currencyCode) throw new Error('Canonical settlement invoice currency mismatch');
    if (
      invoice.total_minor !== bill.legacyTotalMinor
      || invoice.paid_minor !== bill.canonicalPaidBeforeMinor
      || invoice.due_minor !== bill.canonicalDueBeforeMinor
      || invoice.credited_minor !== bill.canonicalCreditedBeforeMinor
      || invoice.net_due_minor !== bill.canonicalNetDueBeforeMinor
    ) {
      throw new Error('Canonical settlement invoice snapshot changed');
    }

    payableTotal = addSafe(payableTotal, bill.legacyDueBeforeMinor, 'settlement payable total');
    cashTotal = addSafe(cashTotal, bill.cashMinor, 'settlement cash total');
    depositTotal = addSafe(depositTotal, bill.depositMinor, 'settlement deposit total');
    discountTotal = addSafe(discountTotal, bill.discountMinor, 'settlement discount total');

    let paidMinor = bill.canonicalPaidBeforeMinor;
    let dueMinor = bill.canonicalDueBeforeMinor;
    let creditedMinor = bill.canonicalCreditedBeforeMinor;
    let netDueMinor = bill.canonicalNetDueBeforeMinor;
    let paymentReceiptPublicId: string | null = null;

    if (bill.cashMinor > 0) {
      const paidAfterMinor = paidMinor + bill.cashMinor;
      const dueAfterMinor = dueMinor - bill.cashMinor;
      const netDueAfterMinor = netDueMinor - bill.cashMinor;
      if (paidAfterMinor + dueAfterMinor !== bill.legacyTotalMinor || netDueAfterMinor < 0) {
        throw new Error('Canonical settlement payment plan is inconsistent');
      }
      const sourcePublicId = exact(bill.paymentReceiptNumber ?? '', 'bill.paymentReceiptNumber');
      const evidenceSha256 = await createSourceEvidenceSha256({
        sourceType: 'legacy_settlement_payment',
        sourcePublicId,
        sourceTable: 'payments',
        settlementReceiptNumber: input.settlementReceiptNumber,
        billId: bill.billId,
        invoicePublicId: bill.invoicePublicId,
        amountMinor: bill.cashMinor,
        paymentMethod: input.paymentMethod,
        collectorId: input.legacyCollectorId,
        counterId: input.legacyCounterId,
        counterSessionId: input.legacyCounterSessionId,
      });
      paymentReceiptPublicId = await createDeterministicSourceId(
        'payrcpt', input.tenantId, 'legacy_settlement_payment', sourcePublicId,
      );
      preparedCashBills.push({
        input: bill,
        receiptPublicId: paymentReceiptPublicId,
        tenderPublicId: await createDeterministicSourceId(
          'paytnd', input.tenantId, 'legacy_settlement_payment_tender', sourcePublicId,
        ),
        allocationPublicId: await createDeterministicSourceId(
          'payalloc', input.tenantId, 'legacy_settlement_payment_allocation', sourcePublicId,
        ),
        paymentEventPublicId: await createDeterministicSourceId(
          'outevt', input.tenantId, 'legacy_settlement_payment_event', sourcePublicId,
        ),
        cashCustodyEventPublicId: input.tenderType === 'cash'
          ? await createDeterministicSourceId(
              'custody', input.tenantId, 'legacy_settlement_cash_custody', sourcePublicId,
            )
          : null,
        evidenceSha256,
        paidAfterMinor,
        dueAfterMinor,
        netDueAfterMinor,
      });
      paidMinor = paidAfterMinor;
      dueMinor = dueAfterMinor;
      netDueMinor = netDueAfterMinor;
    }

    let remainingDeposit = bill.depositMinor;
    let billFragmentIndex = 0;
    const resultApplications: FinalizeSettlementDepositApplicationResult[] = [];
    while (remainingDeposit > 0) {
      while (depositCursor < workingDeposits.length && workingDeposits[depositCursor].available_minor === 0) {
        depositCursor += 1;
      }
      const deposit = workingDeposits[depositCursor];
      if (!deposit) throw new RangeError('Canonical settlement deposit balance is insufficient');
      const amountMinor = Math.min(remainingDeposit, deposit.available_minor);
      billFragmentIndex += 1;
      deposit.fragmentIndex += 1;
      const sourcePublicId = `${bill.depositAdjustmentReceiptNumber}:${billFragmentIndex}`;
      const evidenceSha256 = await createSourceEvidenceSha256({
        sourceType: 'legacy_settlement_deposit_adjustment',
        sourcePublicId,
        sourceTable: 'billing_deposits',
        settlementReceiptNumber: input.settlementReceiptNumber,
        depositAdjustmentReceiptNumber: bill.depositAdjustmentReceiptNumber,
        billId: bill.billId,
        invoicePublicId: bill.invoicePublicId,
        depositPublicId: deposit.deposit_public_id,
        amountMinor,
        fragmentIndex: billFragmentIndex,
        collectorId: input.legacyCollectorId,
        counterId: input.legacyCounterId,
        counterSessionId: input.legacyCounterSessionId,
      });
      const applicationPublicId = await createDeterministicSourceId(
        'depapp', input.tenantId, 'legacy_settlement_deposit_adjustment', sourcePublicId,
      );
      const invoicePaidAfterMinor = paidMinor + amountMinor;
      const invoiceDueAfterMinor = dueMinor - amountMinor;
      const invoiceNetDueAfterMinor = netDueMinor - amountMinor;
      const depositAppliedAfterMinor = deposit.applied_minor + amountMinor;
      const depositAvailableAfterMinor = deposit.available_minor - amountMinor;
      if (invoiceDueAfterMinor < 0 || invoiceNetDueAfterMinor < 0) {
        throw new RangeError('Settlement deposit application exceeds invoice outstanding balance');
      }
      preparedDepositApplications.push({
        bill,
        applicationPublicId,
        eventPublicId: await createDeterministicSourceId(
          'outevt', input.tenantId, 'legacy_settlement_deposit_application_event', sourcePublicId,
        ),
        sourcePublicId,
        evidenceSha256,
        depositPublicId: deposit.deposit_public_id,
        depositAmountMinor: deposit.amount_minor,
        depositReceivedAtUtc: deposit.received_at_utc,
        amountMinor,
        depositAppliedBeforeMinor: deposit.applied_minor,
        depositAppliedAfterMinor,
        depositRefundedMinor: deposit.refunded_minor,
        depositAvailableBeforeMinor: deposit.available_minor,
        depositAvailableAfterMinor,
        invoicePaidBeforeMinor: paidMinor,
        invoicePaidAfterMinor,
        invoiceDueBeforeMinor: dueMinor,
        invoiceDueAfterMinor,
        invoiceCreditedMinor: creditedMinor,
        invoiceNetDueBeforeMinor: netDueMinor,
        invoiceNetDueAfterMinor,
      });
      resultApplications.push({
        applicationPublicId,
        depositPublicId: deposit.deposit_public_id,
        invoicePublicId: bill.invoicePublicId,
        amountMinor,
      });
      deposit.applied_minor = depositAppliedAfterMinor;
      deposit.available_minor = depositAvailableAfterMinor;
      paidMinor = invoicePaidAfterMinor;
      dueMinor = invoiceDueAfterMinor;
      netDueMinor = invoiceNetDueAfterMinor;
      remainingDeposit -= amountMinor;
    }

    let creditNotePublicId: string | null = null;
    if (bill.discountMinor > 0) {
      if (bill.discountMinor > netDueMinor) {
        throw new RangeError('Settlement discount exceeds invoice net outstanding balance');
      }
      await assertCompensationSafe(db, input.tenantId, bill.invoicePublicId);
      const discountNumber = exact(bill.discountNumber ?? '', 'bill.discountNumber');
      const reasonCode = exact(bill.discountReasonCode ?? '', 'bill.discountReasonCode');
      exact(bill.discountAllocationType ?? '', 'bill.discountAllocationType');
      const evidenceSha256 = await createSourceEvidenceSha256({
        sourceType: 'legacy_settlement_discount',
        sourcePublicId: discountNumber,
        sourceTable: 'bill_discount_allocations',
        settlementReceiptNumber: input.settlementReceiptNumber,
        billId: bill.billId,
        invoicePublicId: bill.invoicePublicId,
        amountMinor: bill.discountMinor,
        reasonCode,
        allocationType: bill.discountAllocationType,
        referenceName: bill.discountReferenceName,
        note: bill.discountNote,
      });
      creditNotePublicId = await createDeterministicSourceId(
        'crnote', input.tenantId, 'legacy_settlement_discount', discountNumber,
      );
      const creditedAfterMinor = creditedMinor + bill.discountMinor;
      const netDueAfterMinor = netDueMinor - bill.discountMinor;
      preparedDiscounts.push({
        bill,
        creditNotePublicId,
        creditLinePublicId: await createDeterministicSourceId(
          'crline', input.tenantId, 'legacy_settlement_discount_line', discountNumber,
        ),
        eventPublicId: await createDeterministicSourceId(
          'outevt', input.tenantId, 'legacy_settlement_discount_event', discountNumber,
        ),
        evidenceSha256,
        creditedBeforeMinor: creditedMinor,
        creditedAfterMinor,
        netDueBeforeMinor: netDueMinor,
        netDueAfterMinor,
      });
      creditedMinor = creditedAfterMinor;
      netDueMinor = netDueAfterMinor;
    }

    const legacyDueAfterMinor = bill.legacyDueBeforeMinor
      - bill.cashMinor
      - bill.depositMinor
      - bill.discountMinor;
    if (legacyDueAfterMinor !== netDueMinor) {
      throw new Error('Legacy and canonical settlement final due do not reconcile');
    }

    resultBills.push({
      billId: bill.billId,
      invoicePublicId: bill.invoicePublicId,
      paymentReceiptPublicId,
      creditNotePublicId,
      depositApplications: resultApplications,
      paidMinor,
      dueMinor,
      creditedMinor,
      netDueMinor,
    });
  }

  const cashMinor = Number(cashTotal);
  const depositMinor = Number(depositTotal);
  const discountMinor = Number(discountTotal);
  const payableMinor = Number(payableTotal);
  const settlementEvidenceSha256 = await createSourceEvidenceSha256({
    sourceType: 'legacy_settlement',
    sourcePublicId: input.settlementReceiptNumber,
    sourceTable: 'billing_settlements',
    settlementPublicId: input.settlementPublicId,
    patientId: input.legacyPatientId,
    payableMinor,
    cashMinor,
    depositMinor,
    discountMinor,
    paymentMethod: input.paymentMethod,
    collectorId: input.legacyCollectorId,
    counterId: input.legacyCounterId,
    counterSessionId: input.legacyCounterSessionId,
  });
  const operationKey = `settlement-finalize:${input.settlementReceiptNumber}`;
  const statements: CanonicalPreparedStatement[] = [];
  const reconciliationStatements: CanonicalPreparedStatement[] = [];

  for (const prepared of preparedCashBills) {
    statements.push(
      db.prepare(`
        INSERT INTO canonical_payment_receipts (
          tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
          total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
          business_date,legacy_collector_id,legacy_counter_id,legacy_counter_session_id,
          posted_at_utc,refunded_minor,net_received_minor,refund_projection_guard,
          reconciliation_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,0,'posted',?,?,?,?,?,?,0,?,1,1,?)
      `).bind(
        input.tenantId,
        prepared.receiptPublicId,
        prepared.input.paymentReceiptNumber,
        input.legacyPatientId,
        input.currencyCode,
        prepared.input.cashMinor,
        prepared.input.cashMinor,
        input.occurredAtUtc,
        input.businessDate,
        input.legacyCollectorId,
        input.legacyCounterId,
        input.legacyCounterSessionId,
        input.occurredAtUtc,
        prepared.input.cashMinor,
        prepared.evidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_payment_tenders (
          tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
          amount_minor,status,captured_at_utc,reversed_minor,remaining_minor,
          reversal_projection_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,'captured',?,0,?,1,?)
      `).bind(
        input.tenantId,
        prepared.tenderPublicId,
        prepared.receiptPublicId,
        input.tenderType,
        input.paymentMethod,
        prepared.input.cashMinor,
        input.occurredAtUtc,
        prepared.input.cashMinor,
        prepared.evidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_payment_allocations (
          tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
          amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,
          allocated_at_utc,reversed_minor,remaining_minor,reversal_projection_guard,
          balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,'active',?,0,?,1,1,?)
      `).bind(
        input.tenantId,
        prepared.allocationPublicId,
        prepared.receiptPublicId,
        prepared.input.invoicePublicId,
        prepared.input.cashMinor,
        prepared.input.canonicalDueBeforeMinor,
        prepared.dueAfterMinor,
        input.occurredAtUtc,
        prepared.input.cashMinor,
        prepared.evidenceSha256,
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
        input.occurredAtUtc,
        input.tenantId,
        prepared.input.invoicePublicId,
        prepared.input.canonicalPaidBeforeMinor,
        prepared.input.canonicalDueBeforeMinor,
        prepared.input.canonicalCreditedBeforeMinor,
        prepared.input.canonicalNetDueBeforeMinor,
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
        prepared.input.invoicePublicId,
        prepared.paidAfterMinor,
        prepared.dueAfterMinor,
        prepared.input.canonicalCreditedBeforeMinor,
        prepared.netDueAfterMinor,
        input.tenantId,
        prepared.allocationPublicId,
      ),
      db.prepare(`
        UPDATE canonical_payment_receipts
        SET reconciliation_guard=CASE WHEN
          total_minor=COALESCE((
            SELECT SUM(amount_minor) FROM canonical_payment_tenders
            WHERE tenant_id=? AND receipt_public_id=?
          ),0)
          AND allocated_total_minor=COALESCE((
            SELECT SUM(amount_minor) FROM canonical_payment_allocations
            WHERE tenant_id=? AND receipt_public_id=? AND status='active'
          ),0)
          AND total_minor=allocated_total_minor+unallocated_minor
          AND NOT EXISTS (
            SELECT 1 FROM canonical_payment_tenders
            WHERE tenant_id=? AND receipt_public_id=? AND status<>'captured'
          )
        THEN 1 ELSE 0 END
        WHERE tenant_id=? AND receipt_public_id=?
      `).bind(
        input.tenantId,
        prepared.receiptPublicId,
        input.tenantId,
        prepared.receiptPublicId,
        input.tenantId,
        prepared.receiptPublicId,
        input.tenantId,
        prepared.receiptPublicId,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        prepared.paymentEventPublicId,
        'canonical_payment_receipt',
        prepared.receiptPublicId,
        'canonical.payment.receipt.posted',
        stableCanonicalJson({
          allocatedMinor: prepared.input.cashMinor,
          receiptPublicId: prepared.receiptPublicId,
          status: 'posted',
          totalMinor: prepared.input.cashMinor,
          unallocatedMinor: 0,
        }),
        input.occurredAtUtc,
        input.businessDate,
        `${input.commandIdempotencyKey}:payment:${prepared.input.billId}`,
      ),
    );

    if (prepared.cashCustodyEventPublicId) {
      statements.push(db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        prepared.cashCustodyEventPublicId,
        'canonical_cash_custody',
        prepared.receiptPublicId,
        'canonical.cash_custody.collection_recorded',
        stableCanonicalJson({
          cashAmountMinor: prepared.input.cashMinor,
          counterId: input.legacyCounterId,
          counterSessionId: input.legacyCounterSessionId,
          receiptPublicId: prepared.receiptPublicId,
        }),
        input.occurredAtUtc,
        input.businessDate,
        `${input.commandIdempotencyKey}:cash-custody:${prepared.input.billId}`,
      ));
    }

    reconciliationStatements.push(
      paymentSourceMapping(db, input, prepared),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `payment-source-${prepared.input.billId}`,
        expectedChanges: 1,
      }),
    );
  }

  for (const prepared of preparedDepositApplications) {
    statements.push(
      db.prepare(`
        INSERT INTO canonical_deposit_applications (
          tenant_id,application_public_id,deposit_public_id,invoice_public_id,
          amount_minor,deposit_available_before_minor,deposit_available_after_minor,
          invoice_paid_before_minor,invoice_paid_after_minor,invoice_due_before_minor,
          invoice_due_after_minor,invoice_net_due_before_minor,invoice_net_due_after_minor,
          status,applied_at_utc,balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,1,?)
      `).bind(
        input.tenantId,
        prepared.applicationPublicId,
        prepared.depositPublicId,
        prepared.bill.invoicePublicId,
        prepared.amountMinor,
        prepared.depositAvailableBeforeMinor,
        prepared.depositAvailableAfterMinor,
        prepared.invoicePaidBeforeMinor,
        prepared.invoicePaidAfterMinor,
        prepared.invoiceDueBeforeMinor,
        prepared.invoiceDueAfterMinor,
        prepared.invoiceNetDueBeforeMinor,
        prepared.invoiceNetDueAfterMinor,
        input.occurredAtUtc,
        prepared.evidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_deposits
        SET applied_minor=?,available_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND deposit_public_id=? AND status='posted'
          AND amount_minor=? AND received_at_utc=?
          AND applied_minor=? AND refunded_minor=? AND available_minor=?
      `).bind(
        prepared.depositAppliedAfterMinor,
        prepared.depositAvailableAfterMinor,
        input.occurredAtUtc,
        input.tenantId,
        prepared.depositPublicId,
        prepared.depositAmountMinor,
        prepared.depositReceivedAtUtc,
        prepared.depositAppliedBeforeMinor,
        prepared.depositRefundedMinor,
        prepared.depositAvailableBeforeMinor,
      ),
      db.prepare(`
        UPDATE canonical_invoices
        SET paid_minor=?,due_minor=?,net_due_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
          AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
      `).bind(
        prepared.invoicePaidAfterMinor,
        prepared.invoiceDueAfterMinor,
        prepared.invoiceNetDueAfterMinor,
        input.occurredAtUtc,
        input.tenantId,
        prepared.bill.invoicePublicId,
        prepared.invoicePaidBeforeMinor,
        prepared.invoiceDueBeforeMinor,
        prepared.invoiceCreditedMinor,
        prepared.invoiceNetDueBeforeMinor,
      ),
      db.prepare(`
        UPDATE canonical_deposit_applications
        SET balance_guard=CASE WHEN
          EXISTS (
            SELECT 1 FROM canonical_deposits
            WHERE tenant_id=? AND deposit_public_id=? AND status='posted'
              AND applied_minor=? AND refunded_minor=? AND available_minor=?
          ) AND EXISTS (
            SELECT 1 FROM canonical_invoices
            WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
              AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
          ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND application_public_id=?
      `).bind(
        input.tenantId,
        prepared.depositPublicId,
        prepared.depositAppliedAfterMinor,
        prepared.depositRefundedMinor,
        prepared.depositAvailableAfterMinor,
        input.tenantId,
        prepared.bill.invoicePublicId,
        prepared.invoicePaidAfterMinor,
        prepared.invoiceDueAfterMinor,
        prepared.invoiceCreditedMinor,
        prepared.invoiceNetDueAfterMinor,
        input.tenantId,
        prepared.applicationPublicId,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        prepared.eventPublicId,
        'canonical_deposit',
        prepared.depositPublicId,
        'canonical.deposit.applied',
        stableCanonicalJson({
          amountMinor: prepared.amountMinor,
          applicationPublicId: prepared.applicationPublicId,
          depositPublicId: prepared.depositPublicId,
          invoicePublicId: prepared.bill.invoicePublicId,
        }),
        input.occurredAtUtc,
        input.businessDate,
        `${input.commandIdempotencyKey}:deposit:${prepared.sourcePublicId}`,
      ),
    );
    reconciliationStatements.push(
      depositSourceMapping(db, input, prepared),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `deposit-source-${prepared.sourcePublicId}`,
        expectedChanges: 1,
      }),
    );
  }

  for (const prepared of preparedDiscounts) {
    const reasonCode = exact(prepared.bill.discountReasonCode ?? '', 'bill.discountReasonCode');
    statements.push(
      db.prepare(`
        INSERT INTO canonical_credit_notes (
          tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
          legacy_patient_id,currency_code,reason_code,total_minor,
          invoice_credited_before_minor,invoice_credited_after_minor,
          invoice_net_due_before_minor,invoice_net_due_after_minor,status,
          issued_at_utc,business_date,posted_at_utc,reconciliation_guard,
          source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'posted',?,?,?,1,?)
      `).bind(
        input.tenantId,
        prepared.creditNotePublicId,
        prepared.bill.discountNumber,
        prepared.bill.invoicePublicId,
        input.legacyPatientId,
        input.currencyCode,
        reasonCode,
        prepared.bill.discountMinor,
        prepared.creditedBeforeMinor,
        prepared.creditedAfterMinor,
        prepared.netDueBeforeMinor,
        prepared.netDueAfterMinor,
        input.occurredAtUtc,
        input.businessDate,
        input.occurredAtUtc,
        prepared.evidenceSha256,
      ),
      db.prepare(`
        INSERT INTO canonical_credit_note_lines (
          tenant_id,credit_line_public_id,credit_note_public_id,invoice_public_id,
          amount_minor,reason_code,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?)
      `).bind(
        input.tenantId,
        prepared.creditLinePublicId,
        prepared.creditNotePublicId,
        prepared.bill.invoicePublicId,
        prepared.bill.discountMinor,
        reasonCode,
        prepared.evidenceSha256,
      ),
      db.prepare(`
        UPDATE canonical_invoices
        SET credited_minor=?,net_due_minor=?,updated_at_utc=?
        WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
          AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
      `).bind(
        prepared.creditedAfterMinor,
        prepared.netDueAfterMinor,
        input.occurredAtUtc,
        input.tenantId,
        prepared.bill.invoicePublicId,
        prepared.bill.canonicalPaidBeforeMinor + prepared.bill.cashMinor + prepared.bill.depositMinor,
        prepared.bill.canonicalDueBeforeMinor - prepared.bill.cashMinor - prepared.bill.depositMinor,
        prepared.creditedBeforeMinor,
        prepared.netDueBeforeMinor,
      ),
      db.prepare(`
        UPDATE canonical_credit_notes
        SET reconciliation_guard=CASE WHEN
          total_minor=COALESCE((
            SELECT SUM(amount_minor) FROM canonical_credit_note_lines
            WHERE tenant_id=? AND credit_note_public_id=?
          ),0)
          AND EXISTS (
            SELECT 1 FROM canonical_invoices
            WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
              AND credited_minor=? AND net_due_minor=?
          ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND credit_note_public_id=?
      `).bind(
        input.tenantId,
        prepared.creditNotePublicId,
        input.tenantId,
        prepared.bill.invoicePublicId,
        prepared.creditedAfterMinor,
        prepared.netDueAfterMinor,
        input.tenantId,
        prepared.creditNotePublicId,
      ),
      db.prepare(`
        INSERT INTO canonical_outbox_events (
          tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
          event_version,payload_json,occurred_at_utc,business_date,idempotency_key,status
        ) VALUES (?,?,?,?,?,1,?,?,?,?,'pending')
      `).bind(
        input.tenantId,
        prepared.eventPublicId,
        'canonical_credit_note',
        prepared.creditNotePublicId,
        'canonical.credit_note.posted',
        stableCanonicalJson({
          creditNotePublicId: prepared.creditNotePublicId,
          invoicePublicId: prepared.bill.invoicePublicId,
          totalMinor: prepared.bill.discountMinor,
        }),
        input.occurredAtUtc,
        input.businessDate,
        `${input.commandIdempotencyKey}:discount:${prepared.bill.billId}`,
      ),
    );
    reconciliationStatements.push(
      discountSourceMapping(db, input, prepared),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `discount-source-${prepared.bill.billId}`,
        expectedChanges: 1,
      }),
    );
  }

  reconciliationStatements.push(
    settlementSourceMapping(
      db,
      input,
      settlementEvidenceSha256,
      payableMinor,
      cashMinor,
      depositMinor,
      discountMinor,
    ),
    prepareFinancialBatchAssertion(db, {
      tenantId: input.tenantId,
      operationKey,
      stepKey: 'settlement-source',
      expectedChanges: 1,
    }),
    prepareClearFinancialBatchAssertions(db, input.tenantId, operationKey),
  );

  const result: FinalizeSettlementResult = {
    settlementPublicId: input.settlementPublicId,
    settlementReceiptNumber: input.settlementReceiptNumber,
    cashMinor,
    depositMinor,
    discountMinor,
    bills: resultBills,
  };
  const eventPublicId = await createDeterministicSourceId(
    'outevt', input.tenantId, 'canonical_settlement_finalized', input.settlementReceiptNumber,
  );

  return runCanonicalBatch(db, {
    tenantId: input.tenantId,
    commandName: 'canonical.settlement.finalize',
    idempotencyKey: input.commandIdempotencyKey,
    authoritativeStatements: execution.authoritativeStatements,
    request,
    statements,
    reconciliationStatements,
    result,
    event: {
      eventPublicId,
      aggregateType: 'canonical_settlement',
      aggregatePublicId: input.settlementPublicId,
      eventType: 'canonical.settlement.finalized',
      occurredAtUtc: input.occurredAtUtc,
      businessDate: input.businessDate,
      payload: {
        settlementPublicId: input.settlementPublicId,
        settlementReceiptNumber: input.settlementReceiptNumber,
        legacyPatientId: input.legacyPatientId,
        cashMinor,
        depositMinor,
        discountMinor,
        billCount: input.bills.length,
      },
    },
  });
}
