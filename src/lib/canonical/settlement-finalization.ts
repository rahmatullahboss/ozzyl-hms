import {
  type CanonicalBatchDatabase,
  type CanonicalPreparedStatement,
} from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  type AccountingEventType,
} from '../accounting-posting';

export class SettlementFinalizationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SettlementFinalizationError';
  }
}

export interface SettlementBillSnapshot {
  id: number;
  invoiceNo: string;
  patientId: number;
  total: number;
  paid: number;
  due: number;
  status: string;
  settlementId: number | null;
}

export interface SettlementPreparationInput {
  tenantId: string;
  userId: number;
  patientId: number;
  requestedBillIds: readonly number[];
  bills: readonly SettlementBillSnapshot[];
  paidAmount: number;
  depositDeducted: number;
  discountAmount: number;
  discountByName: string | null;
  discountReasonCode: string;
  discountAllocationType: string;
  paymentMode: string;
  remarks: string | null;
  businessDate: string;
  occurredAtUtc: string;
  counterId: number;
  counterSessionId: number;
  dependencies: {
    nextReceiptNo(): Promise<string>;
  };
}

export interface SettlementBillPlan extends SettlementBillSnapshot {
  cashApplied: number;
  depositApplied: number;
  discountApplied: number;
  paidAfter: number;
  dueAfter: number;
  statusAfter: 'paid' | 'partially_paid';
  paymentReceiptNo: string | null;
  depositReceiptNo: string | null;
  discountReceiptNo: string | null;
  discountPercent: number | null;
}

export interface SettlementContext extends Omit<SettlementPreparationInput, 'dependencies' | 'bills'> {
  receiptNo: string;
  payableAmount: number;
  billPlans: readonly SettlementBillPlan[];
}

export interface SettlementLegacyResult {
  results: unknown[];
  context: SettlementContext;
  settlementId: number;
}

export interface SettlementCanonicalInvoiceSnapshot {
  invoicePublicId: string;
  legacyPatientId: number;
  currencyCode: string;
  totalMinor: number;
  paidMinor: number;
  dueMinor: number;
  creditedMinor: number;
  netDueMinor: number;
  status: string;
}

export interface SettlementCanonicalDepositSnapshot {
  depositPublicId: string;
  appliedMinor: number;
  refundedMinor: number;
  availableMinor: number;
  receivedAtUtc: string;
  status: string;
}

export interface SettlementStrictContext extends SettlementContext {
  canonicalInvoices: ReadonlyMap<number, SettlementCanonicalInvoiceSnapshot>;
  canonicalDeposits: readonly SettlementCanonicalDepositSnapshot[];
  legacyDepositBalanceMinor: number;
}

type BatchResult = {
  meta?: {
    last_row_id?: string | number | bigint | null;
  };
};

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeMoney(value: number, label: string): number {
  const rounded = roundMoney(value);
  if (!Number.isFinite(rounded) || rounded < 0) {
    throw new RangeError(`${label} must be a non-negative monetary amount`);
  }
  return rounded;
}

function moneyMinor(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  if (!Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.000001) {
    throw new RangeError(`${label} must use exact cent precision`);
  }
  return rounded;
}

function settlementIdLookup(): string {
  return '(SELECT id FROM billing_settlements WHERE tenant_id = ? AND settlement_receipt_no = ? LIMIT 1)';
}

export function buildSettlementPlan(
  input: SettlementPreparationInput,
  receiptNo: string,
): SettlementContext {
  const tenantId = exact(input.tenantId, 'tenantId');
  const normalizedReceipt = exact(receiptNo, 'receiptNo');
  positive(input.userId, 'userId');
  positive(input.patientId, 'patientId');
  positive(input.counterId, 'counterId');
  positive(input.counterSessionId, 'counterSessionId');
  exact(input.discountReasonCode, 'discountReasonCode');
  exact(input.discountAllocationType, 'discountAllocationType');
  exact(input.businessDate, 'businessDate');
  exact(input.occurredAtUtc, 'occurredAtUtc');
  if (input.bills.length === 0) throw new SettlementFinalizationError(400, 'Settlement requires at least one bill');

  const paidAmount = nonNegativeMoney(input.paidAmount, 'paidAmount');
  const depositDeducted = nonNegativeMoney(input.depositDeducted, 'depositDeducted');
  const discountAmount = nonNegativeMoney(input.discountAmount, 'discountAmount');
  const requestedTotal = roundMoney(paidAmount + depositDeducted + discountAmount);
  if (requestedTotal <= 0) {
    throw new SettlementFinalizationError(
      400,
      'Settlement requires a payment, deposit adjustment, or approved discount.',
    );
  }

  const seen = new Set<number>();
  const sorted = [...input.bills]
    .sort((a, b) => a.id - b.id)
    .map((bill) => {
      positive(bill.id, 'bill.id');
      if (seen.has(bill.id)) throw new SettlementFinalizationError(400, 'Duplicate bill in settlement');
      seen.add(bill.id);
      if (positive(bill.patientId, 'bill.patientId') !== input.patientId) {
        throw new SettlementFinalizationError(400, 'Bill does not belong to patient');
      }
      const total = nonNegativeMoney(bill.total, 'bill.total');
      const paid = nonNegativeMoney(bill.paid, 'bill.paid');
      const due = roundMoney(total - paid);
      if (due < 0) throw new SettlementFinalizationError(409, `Bill #${bill.id} balance changed`);
      return { ...bill, total, paid, due };
    });
  const requestedBillIds = [...input.requestedBillIds];
  if (
    requestedBillIds.length !== input.bills.length
    || new Set(requestedBillIds).size !== requestedBillIds.length
    || requestedBillIds.some((id) => !seen.has(id))
  ) {
    throw new SettlementFinalizationError(400, 'Some bills not found');
  }
  let payableAmount = 0;
  for (const bill of sorted) payableAmount = roundMoney(payableAmount + bill.due);
  if (requestedTotal > payableAmount) {
    throw new SettlementFinalizationError(
      400,
      `Overpayment: due ${payableAmount}, paying ${requestedTotal}`,
    );
  }

  let remainingCash = paidAmount;
  let remainingDeposit = depositDeducted;
  let remainingDiscount = discountAmount;
  const billPlans: SettlementBillPlan[] = [];
  for (const bill of sorted) {
    const due = roundMoney(bill.due);
    if (due <= 0) continue;

    const cashApplied = Math.min(due, remainingCash);
    remainingCash = roundMoney(remainingCash - cashApplied);
    const dueAfterCash = roundMoney(due - cashApplied);

    const depositApplied = Math.min(dueAfterCash, remainingDeposit);
    remainingDeposit = roundMoney(remainingDeposit - depositApplied);
    const dueAfterDeposit = roundMoney(dueAfterCash - depositApplied);

    const discountApplied = Math.min(dueAfterDeposit, remainingDiscount);
    remainingDiscount = roundMoney(remainingDiscount - discountApplied);
    const applied = roundMoney(cashApplied + depositApplied + discountApplied);
    if (applied <= 0) continue;

    const paidAfter = roundMoney(bill.paid + applied);
    const dueAfter = roundMoney(Math.max(0, bill.total - paidAfter));
    const statusAfter = paidAfter >= bill.total ? 'paid' : 'partially_paid';
    billPlans.push({
      ...bill,
      cashApplied,
      depositApplied,
      discountApplied,
      paidAfter,
      dueAfter,
      statusAfter,
      paymentReceiptNo: cashApplied > 0 ? `${normalizedReceipt}-B${bill.id}` : null,
      depositReceiptNo: depositApplied > 0 ? `${normalizedReceipt}-DAD-B${bill.id}` : null,
      discountReceiptNo: discountApplied > 0 ? `${normalizedReceipt}-DISC-B${bill.id}` : null,
      discountPercent: discountApplied > 0 && bill.total > 0
        ? roundMoney((discountApplied / bill.total) * 100)
        : null,
    });
  }

  if (
    remainingCash !== 0
    || remainingDeposit !== 0
    || remainingDiscount !== 0
  ) {
    throw new SettlementFinalizationError(
      409,
      'Settlement allocation does not reconcile to selected bill due',
    );
  }

  return {
    tenantId,
    userId: input.userId,
    patientId: input.patientId,
    requestedBillIds,
    paidAmount,
    depositDeducted,
    discountAmount,
    discountByName: input.discountByName?.trim() || null,
    discountReasonCode: input.discountReasonCode,
    discountAllocationType: input.discountAllocationType,
    paymentMode: input.paymentMode,
    remarks: input.remarks?.trim() || null,
    businessDate: input.businessDate,
    occurredAtUtc: input.occurredAtUtc,
    counterId: input.counterId,
    counterSessionId: input.counterSessionId,
    receiptNo: normalizedReceipt,
    payableAmount,
    billPlans,
  };
}

function originalLegacyStatements(
  db: Pick<CanonicalBatchDatabase, 'prepare'>,
  context: SettlementContext,
): CanonicalPreparedStatement[] {
  const lookup = settlementIdLookup();
  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO billing_settlements (
        tenant_id, patient_id, settlement_receipt_no, payable_amount, paid_amount,
        deposit_deducted, discount_amount, discount_by_name, payment_mode, remarks,
        created_by, counter_id, counter_session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      context.tenantId,
      context.patientId,
      context.receiptNo,
      context.payableAmount,
      context.paidAmount,
      context.depositDeducted,
      context.discountAmount,
      context.discountByName,
      context.paymentMode,
      context.remarks,
      context.userId,
      context.counterId,
      context.counterSessionId,
    ),
  ];

  const paymentEvents: Array<{ billId: number; receiptNo: string; amount: number }> = [];
  const depositEvents: Array<{ billId: number; receiptNo: string; amount: number }> = [];
  const discountEvents: Array<{ billId: number; receiptNo: string; amount: number }> = [];
  const sourceAllocations: Array<{
    billId: number;
    amount: number;
    allocationType: string;
    reasonCode: string;
    percent: number | null;
    referenceName: string | null;
    note: string | null;
  }> = [];

  for (const bill of context.billPlans) {
    statements.push(db.prepare(`
      UPDATE bills
      SET paid = ?, due = MAX(0, total - ?), status = ?, settlement_id = ${lookup}
      WHERE id = ? AND tenant_id = ?
    `).bind(
      bill.paidAfter,
      bill.paidAfter,
      bill.statusAfter,
      context.tenantId,
      context.receiptNo,
      bill.id,
      context.tenantId,
    ));

    if (bill.cashApplied > 0 && bill.paymentReceiptNo) {
      statements.push(db.prepare(`
        INSERT INTO payments (
          bill_id, amount, payment_type, receipt_no, payment_method, received_by,
          counter_id, counter_session_id, tenant_id, date
        ) VALUES (?, ?, 'due', ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
      `).bind(
        bill.id,
        bill.cashApplied,
        bill.paymentReceiptNo,
        context.paymentMode,
        context.userId,
        context.counterId,
        context.counterSessionId,
        context.tenantId,
      ));
      paymentEvents.push({
        billId: bill.id,
        receiptNo: bill.paymentReceiptNo,
        amount: bill.cashApplied,
      });
    }

    if (bill.depositApplied > 0 && bill.depositReceiptNo) {
      statements.push(db.prepare(`
        INSERT INTO billing_deposits (
          tenant_id, patient_id, deposit_receipt_no, amount, transaction_type,
          reference_bill_id, remarks, created_by, counter_id, counter_session_id
        ) VALUES (?, ?, ?, ?, 'adjustment', ?, 'Settlement deduction', ?, ?, ?)
      `).bind(
        context.tenantId,
        context.patientId,
        bill.depositReceiptNo,
        bill.depositApplied,
        bill.id,
        context.userId,
        context.counterId,
        context.counterSessionId,
      ));
      depositEvents.push({
        billId: bill.id,
        receiptNo: bill.depositReceiptNo,
        amount: bill.depositApplied,
      });
    }

    if (bill.discountApplied > 0 && bill.discountReceiptNo) {
      discountEvents.push({
        billId: bill.id,
        receiptNo: bill.discountReceiptNo,
        amount: bill.discountApplied,
      });
      sourceAllocations.push({
        billId: bill.id,
        amount: bill.discountApplied,
        allocationType: context.discountAllocationType,
        reasonCode: context.discountReasonCode,
        percent: bill.discountPercent,
        referenceName: context.discountByName,
        note: context.remarks,
      });
    }
  }

  for (const allocation of sourceAllocations) {
    statements.push(db.prepare(`
      INSERT INTO bill_discount_allocations (
        tenant_id, bill_id, settlement_id, allocation_type, discount_reason,
        amount, percent, reference_name, note, created_by
      ) VALUES (?, ?, ${lookup}, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      context.tenantId,
      allocation.billId,
      context.tenantId,
      context.receiptNo,
      allocation.allocationType,
      allocation.reasonCode,
      allocation.amount,
      allocation.percent,
      allocation.referenceName,
      allocation.note,
      context.userId,
    ));
  }

  const billIds = [...context.requestedBillIds];
  const placeholders = billIds.map(() => '?').join(',');
  statements.push(db.prepare(`
    UPDATE billing_credit_bill_status
    SET settlement_status = 'Completed', settlement_id = ${lookup},
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND patient_id = ? AND settlement_status = 'Pending'
      AND is_active = 1 AND bill_id IN (${placeholders})
  `).bind(
    context.tenantId,
    context.receiptNo,
    context.tenantId,
    context.patientId,
    ...billIds,
  ));

  if (context.paidAmount > 0) {
    statements.push(db.prepare(`
      INSERT INTO emp_cash_transactions (
        tenant_id, employee_id, counter_id, counter_session_id, transaction_type,
        amount, reference_id, reference_type, payment_method, description
      ) VALUES (?, ?, ?, ?, 'CollectionFromReceivable', ?, ${lookup}, 'settlement', ?, ?)
    `).bind(
      context.tenantId,
      context.userId,
      context.counterId,
      context.counterSessionId,
      context.paidAmount,
      context.tenantId,
      context.receiptNo,
      context.paymentMode || null,
      `Settlement ${context.receiptNo}`,
    ));
  }

  for (const event of paymentEvents) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events (
        tenant_id, source_event_key, source_type, source_id, event_type,
        event_date, payload_json, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      context.tenantId,
      createPostingEventKey('payment', event.receiptNo, ACCOUNTING_EVENT_TYPES.paymentReceived),
      'payment',
      event.receiptNo,
      ACCOUNTING_EVENT_TYPES.paymentReceived,
      context.businessDate,
      JSON.stringify({
        settlementId: null,
        settlementReceiptNo: context.receiptNo,
        receiptNo: event.receiptNo,
        billId: event.billId,
        patientId: context.patientId,
        amount: event.amount,
        paymentMethod: context.paymentMode,
        paymentType: 'due',
      }),
      String(context.userId),
    ));
  }

  for (const event of depositEvents) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events (
        tenant_id, source_event_key, source_type, source_id, event_type,
        event_date, payload_json, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      context.tenantId,
      createPostingEventKey(
        'patient_deposit_adjustment',
        event.receiptNo,
        ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
      ),
      'patient_deposit_adjustment',
      event.receiptNo,
      ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
      context.businessDate,
      JSON.stringify({
        settlementId: null,
        settlementReceiptNo: context.receiptNo,
        receiptNo: event.receiptNo,
        billId: event.billId,
        patientId: context.patientId,
        amount: event.amount,
      }),
      String(context.userId),
    ));
  }

  for (const event of discountEvents) {
    statements.push(db.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events (
        tenant_id, source_event_key, source_type, source_id, event_type,
        event_date, payload_json, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      context.tenantId,
      createPostingEventKey(
        'settlement_discount',
        event.receiptNo,
        ACCOUNTING_EVENT_TYPES.settlementDiscount,
      ),
      'settlement_discount',
      event.receiptNo,
      ACCOUNTING_EVENT_TYPES.settlementDiscount,
      context.businessDate,
      JSON.stringify({
        settlementId: null,
        settlementReceiptNo: context.receiptNo,
        receiptNo: event.receiptNo,
        billId: event.billId,
        patientId: context.patientId,
        amount: event.amount,
        discountAllocations: sourceAllocations
          .filter((allocation) => allocation.billId === event.billId)
          .map((allocation) => ({
            allocationType: allocation.allocationType,
            amount: allocation.amount,
          })),
      }),
      String(context.userId),
    ));
  }

  statements.push(db.prepare(`
    INSERT INTO audit_logs (
      tenant_id, user_id, action, table_name, record_id,
      old_value, new_value, ip_address, user_agent, created_at
    ) VALUES (
      ?, ?, 'CREATE', 'billing_settlements', ${lookup},
      NULL, ?, NULL, NULL, datetime('now', '+6 hours')
    )
  `).bind(
    context.tenantId,
    context.userId,
    context.tenantId,
    context.receiptNo,
    JSON.stringify({
      receiptNo: context.receiptNo,
      patientId: context.patientId,
      billIds,
      paidAmount: context.paidAmount,
      depositDeducted: context.depositDeducted,
      discountAmount: context.discountAmount,
    }),
  ));

  return statements;
}

export async function executeSettlementOriginalLegacy(
  db: CanonicalBatchDatabase,
  input: SettlementPreparationInput,
): Promise<SettlementLegacyResult> {
  const receiptNo = await input.dependencies.nextReceiptNo();
  const context = buildSettlementPlan(input, receiptNo);
  const statements = originalLegacyStatements(db, context);
  const results = await db.batch(statements);
  let settlementId = Number((results[0] as BatchResult | undefined)?.meta?.last_row_id ?? 0);
  if (!settlementId) {
    const row = await db.prepare(`
      SELECT id
      FROM billing_settlements
      WHERE tenant_id = ? AND settlement_receipt_no = ?
      LIMIT 1
    `).bind(context.tenantId, context.receiptNo).first<{ id: number }>();
    settlementId = Number(row?.id ?? 0);
  }
  if (!(settlementId > 0)) {
    throw new SettlementFinalizationError(
      409,
      'Settlement changed concurrently. Please refresh and try again.',
    );
  }
  return { results: [...results], context, settlementId };
}

type StrictMappingRow = {
  canonical_public_id: string;
};

type StrictInvoiceRow = {
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
};

type StrictDepositRow = {
  deposit_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  amount_minor: number;
  applied_minor: number;
  refunded_minor: number;
  available_minor: number;
  status: string;
  received_at_utc: string;
};

async function resolveStrictInvoice(
  db: CanonicalBatchDatabase,
  input: SettlementPreparationInput,
  bill: SettlementBillSnapshot,
): Promise<SettlementCanonicalInvoiceSnapshot> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice' AND mapping_status='mapped'
      AND source_table='bills'
      AND (
        (source_type='legacy_live_bill' AND source_public_id=?)
        OR (source_type='legacy_bill' AND source_public_id=?)
      )
    ORDER BY canonical_public_id
    LIMIT 1
  `).bind(
    input.tenantId,
    bill.invoiceNo,
    String(bill.id),
  ).first<StrictMappingRow>();
  if (!mapping?.canonical_public_id) {
    throw new Error(`Canonical invoice mapping is unavailable for bill #${bill.id}`);
  }

  const conflict = await db.prepare(`
    SELECT canonical_public_id
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice' AND mapping_status='mapped'
      AND source_table='bills'
      AND (
        (source_type='legacy_live_bill' AND source_public_id=?)
        OR (source_type='legacy_bill' AND source_public_id=?)
      )
      AND canonical_public_id<>?
    LIMIT 1
  `).bind(
    input.tenantId,
    bill.invoiceNo,
    String(bill.id),
    mapping.canonical_public_id,
  ).first<StrictMappingRow>();
  if (conflict) throw new Error(`Conflicting canonical invoice mappings exist for bill #${bill.id}`);

  const invoice = await db.prepare(`
    SELECT legacy_patient_id,currency_code,total_minor,paid_minor,due_minor,
           credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(input.tenantId, mapping.canonical_public_id).first<StrictInvoiceRow>();
  if (!invoice) throw new Error(`Canonical invoice is unavailable for bill #${bill.id}`);
  if (invoice.status !== 'posted') throw new Error(`Canonical invoice is not posted for bill #${bill.id}`);
  if (invoice.legacy_patient_id !== input.patientId) {
    throw new Error(`Canonical invoice patient mismatch for bill #${bill.id}`);
  }
  if (invoice.currency_code !== 'BDT') {
    throw new Error(`Canonical invoice currency mismatch for bill #${bill.id}`);
  }

  const legacyTotalMinor = moneyMinor(bill.total, `bill #${bill.id} total`);
  const legacyPaidMinor = moneyMinor(bill.paid, `bill #${bill.id} paid`);
  const legacyDueMinor = moneyMinor(bill.due, `bill #${bill.id} due`);
  if (
    invoice.total_minor !== legacyTotalMinor
    || invoice.paid_minor + invoice.credited_minor !== legacyPaidMinor
    || invoice.net_due_minor !== legacyDueMinor
    || invoice.paid_minor + invoice.due_minor !== invoice.total_minor
    || invoice.net_due_minor !== invoice.due_minor - invoice.credited_minor
  ) {
    throw new Error(`Legacy and canonical invoice balances do not reconcile for bill #${bill.id}`);
  }

  return {
    invoicePublicId: mapping.canonical_public_id,
    legacyPatientId: invoice.legacy_patient_id,
    currencyCode: invoice.currency_code,
    totalMinor: invoice.total_minor,
    paidMinor: invoice.paid_minor,
    dueMinor: invoice.due_minor,
    creditedMinor: invoice.credited_minor,
    netDueMinor: invoice.net_due_minor,
    status: invoice.status,
  };
}

async function loadStrictDeposits(
  db: CanonicalBatchDatabase,
  input: SettlementPreparationInput,
): Promise<SettlementCanonicalDepositSnapshot[]> {
  const deposits: SettlementCanonicalDepositSnapshot[] = [];
  for (let offset = 0; ; offset += 1) {
    const row = await db.prepare(`
      SELECT deposit_public_id,legacy_patient_id,currency_code,amount_minor,
             applied_minor,refunded_minor,available_minor,status,received_at_utc
      FROM canonical_deposits
      WHERE tenant_id=? AND legacy_patient_id=? AND currency_code='BDT'
        AND status='posted' AND available_minor>0
      ORDER BY received_at_utc,deposit_public_id
      LIMIT 1 OFFSET ?
    `).bind(input.tenantId, input.patientId, offset).first<StrictDepositRow>();
    if (!row) break;
    if (
      row.legacy_patient_id !== input.patientId
      || row.currency_code !== 'BDT'
      || row.status !== 'posted'
      || row.amount_minor !== row.applied_minor + row.refunded_minor + row.available_minor
      || row.available_minor <= 0
    ) {
      throw new Error('Canonical settlement deposit authority is inconsistent');
    }
    deposits.push({
      depositPublicId: row.deposit_public_id,
      appliedMinor: row.applied_minor,
      refundedMinor: row.refunded_minor,
      availableMinor: row.available_minor,
      receivedAtUtc: row.received_at_utc,
      status: row.status,
    });
  }
  return deposits;
}

async function prepareSettlementCanonicalAuthority(
  db: CanonicalBatchDatabase,
  input: SettlementPreparationInput,
  options: { legacyDepositAlreadyDeducted: boolean },
): Promise<{
  canonicalInvoices: ReadonlyMap<number, SettlementCanonicalInvoiceSnapshot>;
  canonicalDeposits: readonly SettlementCanonicalDepositSnapshot[];
  legacyDepositBalanceMinor: number;
}> {
  const canonicalInvoices = new Map<number, SettlementCanonicalInvoiceSnapshot>();
  for (const bill of input.bills) {
    exact(bill.invoiceNo, 'bill.invoiceNo');
    const expectedDue = roundMoney(
      nonNegativeMoney(bill.total, 'bill.total') - nonNegativeMoney(bill.paid, 'bill.paid'),
    );
    if (expectedDue !== nonNegativeMoney(bill.due, 'bill.due')) {
      throw new Error(`Bill #${bill.id} balance changed`);
    }
    if (bill.settlementId != null) {
      throw new Error(`Bill #${bill.id} is already linked to a settlement`);
    }
    canonicalInvoices.set(bill.id, await resolveStrictInvoice(db, input, bill));
  }

  const legacyDeposit = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type='deposit' THEN amount ELSE 0 END),0)
      - COALESCE(SUM(CASE WHEN transaction_type IN ('refund','adjustment') THEN amount ELSE 0 END),0)
      AS balance
    FROM billing_deposits
    WHERE tenant_id=? AND patient_id=? AND is_active=1
  `).bind(input.tenantId, input.patientId).first<{ balance: number }>();
  const observedLegacyBalanceMinor = moneyMinor(
    Number(legacyDeposit?.balance ?? 0),
    'legacy deposit balance',
  );
  if (observedLegacyBalanceMinor < 0) {
    throw new Error('Legacy settlement deposit balance is negative');
  }

  const canonicalDeposits = await loadStrictDeposits(db, input);
  const canonicalAvailableMinor = canonicalDeposits.reduce(
    (sum, deposit) => sum + deposit.availableMinor,
    0,
  );
  if (!Number.isSafeInteger(canonicalAvailableMinor)) {
    throw new RangeError('Canonical settlement deposit balance exceeds safe range');
  }
  const requestedDepositMinor = moneyMinor(input.depositDeducted, 'depositDeducted');
  const legacyDepositBalanceMinor = observedLegacyBalanceMinor
    + (options.legacyDepositAlreadyDeducted ? requestedDepositMinor : 0);
  if (!Number.isSafeInteger(legacyDepositBalanceMinor)) {
    throw new RangeError('Legacy settlement deposit balance exceeds safe range');
  }
  if (canonicalAvailableMinor !== legacyDepositBalanceMinor) {
    throw new Error('Legacy and canonical deposit balances do not reconcile');
  }
  if (requestedDepositMinor > canonicalAvailableMinor) {
    throw new Error('Canonical settlement deposit balance is insufficient');
  }

  return { canonicalInvoices, canonicalDeposits, legacyDepositBalanceMinor };
}

export async function prepareSettlementStrictContext(
  db: CanonicalBatchDatabase,
  input: SettlementPreparationInput,
): Promise<SettlementStrictContext> {
  buildSettlementPlan(input, 'STRICT-PREFLIGHT');
  const authority = await prepareSettlementCanonicalAuthority(db, input, {
    legacyDepositAlreadyDeducted: false,
  });
  const receiptNo = await input.dependencies.nextReceiptNo();
  return {
    ...buildSettlementPlan(input, receiptNo),
    ...authority,
  };
}

export async function prepareSettlementShadowCanonicalContext(
  db: CanonicalBatchDatabase,
  input: SettlementPreparationInput,
  legacyContext: SettlementContext,
): Promise<SettlementStrictContext> {
  const authority = await prepareSettlementCanonicalAuthority(db, input, {
    legacyDepositAlreadyDeducted: true,
  });
  return {
    ...legacyContext,
    ...authority,
  };
}

export function prepareSettlementStrictStatements(
  db: Pick<CanonicalBatchDatabase, 'prepare'>,
  context: SettlementStrictContext,
): readonly CanonicalPreparedStatement[] {
  const lookup = settlementIdLookup();
  const operationKey = `settlement-finalize:${context.receiptNo}`;
  const statements: CanonicalPreparedStatement[] = [];
  const asserted = (statement: CanonicalPreparedStatement, stepKey: string) => {
    statements.push(
      statement,
      prepareFinancialBatchAssertion(db, {
        tenantId: context.tenantId,
        operationKey,
        stepKey,
        expectedChanges: 1,
      }),
    );
  };

  asserted(db.prepare(`
    INSERT INTO billing_settlements (
      tenant_id, patient_id, settlement_receipt_no, payable_amount, paid_amount,
      deposit_deducted, discount_amount, discount_by_name, payment_mode, remarks,
      created_by, counter_id, counter_session_id
    )
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
    WHERE NOT EXISTS (
      SELECT 1 FROM billing_settlements
      WHERE tenant_id=? AND settlement_receipt_no=?
    )
      AND EXISTS (
        SELECT 1 FROM billing_counter_sessions s
        WHERE s.id=? AND CAST(s.tenant_id AS TEXT)=?
          AND s.counter_id=? AND s.user_id=? AND s.status='active'
      )
      AND ROUND((
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type='deposit' THEN amount ELSE 0 END),0)
          - COALESCE(SUM(CASE WHEN transaction_type IN ('refund','adjustment') THEN amount ELSE 0 END),0)
        FROM billing_deposits
        WHERE tenant_id=? AND patient_id=? AND is_active=1
      )*100)=?
      AND COALESCE((
        SELECT SUM(available_minor)
        FROM canonical_deposits
        WHERE tenant_id=? AND legacy_patient_id=? AND currency_code='BDT'
          AND status='posted' AND available_minor>0
      ),0)=?
  `).bind(
    context.tenantId,
    context.patientId,
    context.receiptNo,
    context.payableAmount,
    context.paidAmount,
    context.depositDeducted,
    context.discountAmount,
    context.discountByName,
    context.paymentMode,
    context.remarks,
    context.userId,
    context.counterId,
    context.counterSessionId,
    context.tenantId,
    context.receiptNo,
    context.counterSessionId,
    context.tenantId,
    context.counterId,
    context.userId,
    context.tenantId,
    context.patientId,
    context.legacyDepositBalanceMinor,
    context.tenantId,
    context.patientId,
    context.legacyDepositBalanceMinor,
  ), 'settlement-insert');

  const paymentEvents: Array<{ billId: number; receiptNo: string; amount: number }> = [];
  const depositEvents: Array<{ billId: number; receiptNo: string; amount: number }> = [];
  const discountEvents: Array<{ billId: number; receiptNo: string; amount: number }> = [];

  for (const bill of context.billPlans) {
    const canonicalInvoice = context.canonicalInvoices.get(bill.id);
    if (!canonicalInvoice) {
      throw new Error(`Canonical invoice context is unavailable for bill #${bill.id}`);
    }
    asserted(db.prepare(`
      UPDATE bills
      SET paid=?, due=?, status=?, settlement_id=${lookup}
      WHERE id=? AND CAST(tenant_id AS TEXT)=?
        AND patient_id=? AND invoice_no=?
        AND total=? AND paid=? AND due=? AND status=?
        AND settlement_id IS NULL
        AND EXISTS (
          SELECT 1 FROM billing_settlements
          WHERE tenant_id=? AND settlement_receipt_no=?
        )
        AND EXISTS (
          SELECT 1
          FROM canonical_source_mappings m
          JOIN canonical_invoices i
            ON i.tenant_id=m.tenant_id
           AND i.invoice_public_id=m.canonical_public_id
          WHERE m.tenant_id=? AND m.entity_type='invoice'
            AND m.mapping_status='mapped' AND m.source_table='bills'
            AND m.canonical_public_id=?
            AND (
              (m.source_type='legacy_live_bill' AND m.source_public_id=?)
              OR (m.source_type='legacy_bill' AND m.source_public_id=?)
            )
            AND i.legacy_patient_id=? AND i.currency_code=? AND i.status=?
            AND i.total_minor=? AND i.paid_minor=? AND i.due_minor=?
            AND i.credited_minor=? AND i.net_due_minor=?
        )
        AND NOT EXISTS (
          SELECT 1
          FROM canonical_source_mappings conflict
          WHERE conflict.tenant_id=? AND conflict.entity_type='invoice'
            AND conflict.mapping_status='mapped' AND conflict.source_table='bills'
            AND conflict.canonical_public_id<>?
            AND (
              (conflict.source_type='legacy_live_bill' AND conflict.source_public_id=?)
              OR (conflict.source_type='legacy_bill' AND conflict.source_public_id=?)
            )
        )
    `).bind(
      bill.paidAfter,
      bill.dueAfter,
      bill.statusAfter,
      context.tenantId,
      context.receiptNo,
      bill.id,
      context.tenantId,
      context.patientId,
      bill.invoiceNo,
      bill.total,
      bill.paid,
      bill.due,
      bill.status,
      context.tenantId,
      context.receiptNo,
      context.tenantId,
      canonicalInvoice.invoicePublicId,
      bill.invoiceNo,
      String(bill.id),
      canonicalInvoice.legacyPatientId,
      canonicalInvoice.currencyCode,
      canonicalInvoice.status,
      canonicalInvoice.totalMinor,
      canonicalInvoice.paidMinor,
      canonicalInvoice.dueMinor,
      canonicalInvoice.creditedMinor,
      canonicalInvoice.netDueMinor,
      context.tenantId,
      canonicalInvoice.invoicePublicId,
      bill.invoiceNo,
      String(bill.id),
    ), `bill-update-${bill.id}`);

    if (bill.cashApplied > 0 && bill.paymentReceiptNo) {
      asserted(db.prepare(`
        INSERT INTO payments (
          bill_id,amount,payment_type,receipt_no,payment_method,received_by,
          counter_id,counter_session_id,tenant_id,date
        )
        SELECT ?,?,'due',?,?,?,?,?,?,datetime('now','+6 hours')
        WHERE NOT EXISTS (
          SELECT 1 FROM payments WHERE tenant_id=? AND receipt_no=?
        )
          AND EXISTS (
            SELECT 1 FROM bills b
            JOIN billing_settlements s
              ON s.id=b.settlement_id AND CAST(s.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
            WHERE b.id=? AND CAST(b.tenant_id AS TEXT)=?
              AND b.patient_id=? AND b.paid=? AND b.due=? AND b.status=?
              AND s.settlement_receipt_no=?
          )
      `).bind(
        bill.id,
        bill.cashApplied,
        bill.paymentReceiptNo,
        context.paymentMode,
        context.userId,
        context.counterId,
        context.counterSessionId,
        context.tenantId,
        context.tenantId,
        bill.paymentReceiptNo,
        bill.id,
        context.tenantId,
        context.patientId,
        bill.paidAfter,
        bill.dueAfter,
        bill.statusAfter,
        context.receiptNo,
      ), `payment-insert-${bill.id}`);
      paymentEvents.push({
        billId: bill.id,
        receiptNo: bill.paymentReceiptNo,
        amount: bill.cashApplied,
      });
    }

    if (bill.depositApplied > 0 && bill.depositReceiptNo) {
      asserted(db.prepare(`
        INSERT INTO billing_deposits (
          tenant_id,patient_id,deposit_receipt_no,amount,transaction_type,
          reference_bill_id,remarks,created_by,counter_id,counter_session_id
        )
        SELECT ?,?,?,?,'adjustment',?,'Settlement deduction',?,?,?
        WHERE NOT EXISTS (
          SELECT 1 FROM billing_deposits
          WHERE tenant_id=? AND deposit_receipt_no=?
        )
          AND EXISTS (
            SELECT 1 FROM bills b
            JOIN billing_settlements s
              ON s.id=b.settlement_id AND CAST(s.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
            WHERE b.id=? AND CAST(b.tenant_id AS TEXT)=?
              AND b.patient_id=? AND b.paid=? AND b.due=? AND b.status=?
              AND s.settlement_receipt_no=?
          )
      `).bind(
        context.tenantId,
        context.patientId,
        bill.depositReceiptNo,
        bill.depositApplied,
        bill.id,
        context.userId,
        context.counterId,
        context.counterSessionId,
        context.tenantId,
        bill.depositReceiptNo,
        bill.id,
        context.tenantId,
        context.patientId,
        bill.paidAfter,
        bill.dueAfter,
        bill.statusAfter,
        context.receiptNo,
      ), `deposit-insert-${bill.id}`);
      depositEvents.push({
        billId: bill.id,
        receiptNo: bill.depositReceiptNo,
        amount: bill.depositApplied,
      });
    }

    if (bill.discountApplied > 0 && bill.discountReceiptNo) {
      asserted(db.prepare(`
        INSERT INTO bill_discount_allocations (
          tenant_id,bill_id,settlement_id,allocation_type,discount_reason,
          amount,percent,reference_name,note,created_by
        )
        SELECT ?,?,${lookup},?,?,?,?,?,?,?
        WHERE NOT EXISTS (
          SELECT 1 FROM bill_discount_allocations
          WHERE tenant_id=? AND bill_id=?
            AND allocation_type=? AND discount_reason=?
            AND settlement_id=${lookup}
        )
          AND EXISTS (
            SELECT 1 FROM bills b
            JOIN billing_settlements s
              ON s.id=b.settlement_id AND CAST(s.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
            WHERE b.id=? AND CAST(b.tenant_id AS TEXT)=?
              AND b.patient_id=? AND b.paid=? AND b.due=? AND b.status=?
              AND s.settlement_receipt_no=?
          )
      `).bind(
        context.tenantId,
        bill.id,
        context.tenantId,
        context.receiptNo,
        context.discountAllocationType,
        context.discountReasonCode,
        bill.discountApplied,
        bill.discountPercent,
        context.discountByName,
        context.remarks,
        context.userId,
        context.tenantId,
        bill.id,
        context.discountAllocationType,
        context.discountReasonCode,
        context.tenantId,
        context.receiptNo,
        bill.id,
        context.tenantId,
        context.patientId,
        bill.paidAfter,
        bill.dueAfter,
        bill.statusAfter,
        context.receiptNo,
      ), `discount-insert-${bill.id}`);
      discountEvents.push({
        billId: bill.id,
        receiptNo: bill.discountReceiptNo,
        amount: bill.discountApplied,
      });
    }
  }

  const billIds = [...context.requestedBillIds];
  const placeholders = billIds.map(() => '?').join(',');
  statements.push(db.prepare(`
    UPDATE billing_credit_bill_status
    SET settlement_status='Completed', settlement_id=${lookup},
        updated_at=datetime('now','+6 hours')
    WHERE tenant_id=? AND patient_id=? AND settlement_status='Pending'
      AND is_active=1 AND bill_id IN (${placeholders})
  `).bind(
    context.tenantId,
    context.receiptNo,
    context.tenantId,
    context.patientId,
    ...billIds,
  ));

  if (context.paidAmount > 0) {
    asserted(db.prepare(`
      INSERT INTO emp_cash_transactions (
        tenant_id,employee_id,counter_id,counter_session_id,transaction_type,
        amount,reference_id,reference_type,payment_method,description
      )
      SELECT ?,?,?,?,'CollectionFromReceivable',?,${lookup},'settlement',?,?
      WHERE EXISTS (
        SELECT 1 FROM billing_counter_sessions s
        WHERE s.id=? AND CAST(s.tenant_id AS TEXT)=?
          AND s.counter_id=? AND s.user_id=? AND s.status='active'
      )
        AND EXISTS (
          SELECT 1 FROM billing_settlements
          WHERE tenant_id=? AND settlement_receipt_no=?
        )
    `).bind(
      context.tenantId,
      context.userId,
      context.counterId,
      context.counterSessionId,
      context.paidAmount,
      context.tenantId,
      context.receiptNo,
      context.paymentMode || null,
      `Settlement ${context.receiptNo}`,
      context.counterSessionId,
      context.tenantId,
      context.counterId,
      context.userId,
      context.tenantId,
      context.receiptNo,
    ), 'counter-cash-insert');
  }

  const appendAccountingEvent = (
    sourceType: string,
    sourceId: string,
    eventType: AccountingEventType,
    payload: Record<string, unknown>,
    stepKey: string,
  ) => {
    const sourceEventKey = createPostingEventKey(sourceType, sourceId, eventType);
    asserted(db.prepare(`
      INSERT INTO accounting_posting_events (
        tenant_id,source_event_key,source_type,source_id,event_type,
        event_date,payload_json,created_by
      )
      SELECT ?,?,?,?,?,?,?,?
      WHERE NOT EXISTS (
        SELECT 1 FROM accounting_posting_events
        WHERE tenant_id=? AND source_event_key=?
      )
    `).bind(
      context.tenantId,
      sourceEventKey,
      sourceType,
      sourceId,
      eventType,
      context.businessDate,
      JSON.stringify(payload),
      String(context.userId),
      context.tenantId,
      sourceEventKey,
    ), stepKey);
  };

  for (const event of paymentEvents) {
    appendAccountingEvent(
      'payment',
      event.receiptNo,
      ACCOUNTING_EVENT_TYPES.paymentReceived,
      {
        settlementId: null,
        settlementReceiptNo: context.receiptNo,
        receiptNo: event.receiptNo,
        billId: event.billId,
        patientId: context.patientId,
        amount: event.amount,
        paymentMethod: context.paymentMode,
        paymentType: 'due',
      },
      `payment-event-${event.billId}`,
    );
  }
  for (const event of depositEvents) {
    appendAccountingEvent(
      'patient_deposit_adjustment',
      event.receiptNo,
      ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
      {
        settlementId: null,
        settlementReceiptNo: context.receiptNo,
        receiptNo: event.receiptNo,
        billId: event.billId,
        patientId: context.patientId,
        amount: event.amount,
      },
      `deposit-event-${event.billId}`,
    );
  }
  for (const event of discountEvents) {
    appendAccountingEvent(
      'settlement_discount',
      event.receiptNo,
      ACCOUNTING_EVENT_TYPES.settlementDiscount,
      {
        settlementId: null,
        settlementReceiptNo: context.receiptNo,
        receiptNo: event.receiptNo,
        billId: event.billId,
        patientId: context.patientId,
        amount: event.amount,
        discountAllocations: [{
          allocationType: context.discountAllocationType,
          amount: event.amount,
        }],
      },
      `discount-event-${event.billId}`,
    );
  }

  asserted(db.prepare(`
    INSERT INTO audit_logs (
      tenant_id,user_id,action,table_name,record_id,
      old_value,new_value,ip_address,user_agent,created_at
    )
    SELECT ?,?,'CREATE','billing_settlements',${lookup},
           NULL,?,NULL,NULL,datetime('now','+6 hours')
    WHERE EXISTS (
      SELECT 1 FROM billing_settlements
      WHERE tenant_id=? AND settlement_receipt_no=?
    )
  `).bind(
    context.tenantId,
    context.userId,
    context.tenantId,
    context.receiptNo,
    JSON.stringify({
      receiptNo: context.receiptNo,
      patientId: context.patientId,
      billIds,
      paidAmount: context.paidAmount,
      depositDeducted: context.depositDeducted,
      discountAmount: context.discountAmount,
    }),
    context.tenantId,
    context.receiptNo,
  ), 'audit-insert');

  statements.push(prepareClearFinancialBatchAssertions(db, context.tenantId, operationKey));
  return statements;
}
