import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
} from '../accounting-posting';
import {
  type CanonicalBatchDatabase,
  type CanonicalPreparedStatement,
} from './command-batch';
import type {
  CancelSettlementBillInput,
  CancelSettlementInput,
} from './commands/cancel-settlement';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';

export class SettlementCancellationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SettlementCancellationError';
  }
}

export interface SettlementCancellationSettlementSnapshot {
  id: number;
  patientId: number;
  receiptNo: string;
  payableAmount: number;
  paidAmount: number;
  depositDeducted: number;
  discountAmount: number;
  discountByName: string | null;
  paymentMode: string;
  remarks: string | null;
  createdBy: number;
  counterId: number;
  counterSessionId: number;
  isActive: number;
}

export interface SettlementCancellationBillSnapshot {
  id: number;
  invoiceNo: string;
  patientId: number;
  total: number;
  paid: number;
  due: number;
  status: string;
  settlementId: number | null;
}

export interface SettlementCancellationInput {
  tenantId: string;
  userId: number;
  settlementId: number;
  businessDate: string;
  cancelledAtUtc: string;
  activeCounterId: number;
  activeCounterSessionId: number;
  settlement: SettlementCancellationSettlementSnapshot;
  bills: readonly SettlementCancellationBillSnapshot[];
}

interface LegacyPaymentEvidence {
  id: number;
  billId: number;
  amount: number;
  receiptNo: string;
  paymentType: string | null;
  paymentMethod: string;
  receivedBy: number | null;
  counterId: number | null;
  counterSessionId: number | null;
}

interface LegacyDepositEvidence {
  id: number;
  billId: number;
  patientId: number;
  amount: number;
  receiptNo: string;
  remarks: string | null;
  createdBy: number | null;
  counterId: number | null;
  counterSessionId: number | null;
  isActive: number;
}

interface LegacyDiscountEvidence {
  id: number;
  billId: number;
  amount: number;
  allocationType: string;
  discountReason: string;
  percent: number | null;
  referenceName: string | null;
  note: string | null;
  createdBy: number | null;
}

interface LegacyCashEvidence {
  id: number;
  employeeId: number;
  counterId: number;
  counterSessionId: number;
  transactionType: string;
  amount: number;
  paymentMethod: string | null;
  description: string | null;
}

interface AccountingJournalLineSnapshot {
  lineNo: number;
  accountId: number;
  debit: number;
  credit: number;
  memo: string | null;
}

interface AccountingEventSnapshot {
  id: number;
  sourceEventKey: string;
  sourceType: string;
  sourceId: string;
  eventType: string;
  eventDate: string;
  payloadJson: string;
  status: string;
  postedVoucherId: number | null;
  postedAt: string | null;
  createdBy: string | null;
  expectedAmount: number;
  reversalSourceEventKey: string | null;
  reversalSourceId: string | null;
  reversalPayloadJson: string | null;
  voucherLines: readonly AccountingJournalLineSnapshot[];
}

interface StrictBillContext {
  legacy: SettlementCancellationBillSnapshot;
  payment: LegacyPaymentEvidence | null;
  deposit: LegacyDepositEvidence | null;
  discount: LegacyDiscountEvidence | null;
  command: CancelSettlementBillInput;
}

export interface SettlementCancellationStrictContext {
  input: SettlementCancellationInput;
  bills: readonly StrictBillContext[];
  cash: LegacyCashEvidence | null;
  accountingEvents: readonly AccountingEventSnapshot[];
  commandInput: CancelSettlementInput;
}

export interface SettlementCancellationLegacyResult {
  results: unknown[];
}

type QueryStatement = CanonicalPreparedStatement & {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

type SettlementDbRow = {
  id: number;
  patient_id: number;
  settlement_receipt_no: string;
  payable_amount: number;
  paid_amount: number;
  deposit_deducted: number;
  discount_amount: number;
  discount_by_name: string | null;
  payment_mode: string;
  remarks: string | null;
  created_by: number;
  counter_id: number;
  counter_session_id: number;
  is_active: number;
};

type BillDbRow = {
  id: number;
  invoice_no: string;
  patient_id: number;
  total: number;
  paid: number;
  due: number;
  status: string;
  settlement_id: number | null;
};

type PaymentDbRow = {
  id: number;
  bill_id: number;
  amount: number;
  receipt_no: string;
  payment_type: string | null;
  payment_method: string;
  received_by: number | null;
  counter_id: number | null;
  counter_session_id: number | null;
};

type DepositDbRow = {
  id: number;
  patient_id: number;
  reference_bill_id: number;
  amount: number;
  deposit_receipt_no: string;
  remarks: string | null;
  created_by: number | null;
  counter_id: number | null;
  counter_session_id: number | null;
  is_active: number;
};

type DiscountDbRow = {
  id: number;
  bill_id: number;
  amount: number;
  allocation_type: string;
  discount_reason: string;
  percent: number | null;
  reference_name: string | null;
  note: string | null;
  created_by: number | null;
};

type MappingDbRow = {
  canonical_public_id: string;
  source_type: string;
  source_public_id: string;
  source_table: string;
  mapping_status: string;
};

type CanonicalInvoiceRow = {
  invoice_public_id: string;
  invoice_number: string;
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
};

type CanonicalPaymentMappingRow = {
  canonical_public_id: string;
  source_public_id: string;
};

type CanonicalDepositApplicationRow = {
  application_public_id: string;
  deposit_public_id: string;
  invoice_public_id: string;
  amount_minor: number;
  status: string;
  reversed_at_utc: string | null;
};

type CanonicalCreditNoteRow = {
  credit_note_public_id: string;
  invoice_public_id: string;
  total_minor: number;
  status: string;
  reversed_at_utc: string | null;
};

type CashDbRow = {
  id: number;
  employee_id: number;
  counter_id: number;
  counter_session_id: number;
  transaction_type: string;
  amount: number;
  payment_method: string | null;
  description: string | null;
};

type AccountingEventDbRow = {
  id: number;
  source_event_key: string;
  source_type: string;
  source_id: string;
  event_type: string;
  event_date: string;
  payload_json: string;
  status: string;
  posted_voucher_id: number | null;
  posted_at: string | null;
  created_by: string | null;
};

type VoucherDbRow = {
  id: number;
  source_event_key: string;
  status: string;
};

type JournalLineDbRow = {
  line_no: number;
  account_id: number;
  debit_amount: number;
  credit_amount: number;
  memo: string | null;
};

const ALLOWED_UNPOSTED_ACCOUNTING_STATUSES = new Set([
  'pending',
  'failed',
  'dead_letter',
  'approved',
]);

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
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

function sameMoney(left: number, right: number): boolean {
  return moneyMinor(left, 'left amount') === moneyMinor(right, 'right amount');
}

async function all<T>(statement: CanonicalPreparedStatement): Promise<T[]> {
  const response = await (statement as QueryStatement).all<T>();
  return response.results ?? [];
}

function parsePayload(value: string, label: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} payload is invalid JSON`);
  }
}

function assertInput(input: SettlementCancellationInput): void {
  exact(input.tenantId, 'tenantId');
  positive(input.userId, 'userId');
  positive(input.settlementId, 'settlementId');
  positive(input.activeCounterId, 'activeCounterId');
  positive(input.activeCounterSessionId, 'activeCounterSessionId');
  exact(input.businessDate, 'businessDate');
  exact(input.cancelledAtUtc, 'cancelledAtUtc');
  if (input.settlement.id !== input.settlementId || input.settlement.isActive !== 1) {
    throw new SettlementCancellationError(404, 'Settlement not found or already cancelled');
  }
  if (input.bills.length === 0) {
    throw new SettlementCancellationError(409, 'Settlement has no linked bill evidence');
  }
  const billIds = new Set<number>();
  for (const bill of input.bills) {
    positive(bill.id, 'bill.id');
    exact(bill.invoiceNo, 'bill.invoiceNo');
    if (billIds.has(bill.id)) throw new Error('Duplicate linked settlement bill');
    billIds.add(bill.id);
    if (bill.patientId !== input.settlement.patientId || bill.settlementId !== input.settlementId) {
      throw new Error(`Settlement bill #${bill.id} linkage is inconsistent`);
    }
    if (!sameMoney(bill.total - bill.paid, bill.due)) {
      throw new Error(`Settlement bill #${bill.id} balance is inconsistent`);
    }
  }
}

function assertSettlementRowMatches(
  input: SettlementCancellationInput,
  row: SettlementDbRow | null,
): void {
  const expected = input.settlement;
  if (!row || (
    Number(row.id) !== expected.id
    || Number(row.patient_id) !== expected.patientId
    || String(row.settlement_receipt_no) !== expected.receiptNo
    || !sameMoney(Number(row.payable_amount), expected.payableAmount)
    || !sameMoney(Number(row.paid_amount), expected.paidAmount)
    || !sameMoney(Number(row.deposit_deducted), expected.depositDeducted)
    || !sameMoney(Number(row.discount_amount), expected.discountAmount)
    || (row.discount_by_name ?? null) !== expected.discountByName
    || String(row.payment_mode) !== expected.paymentMode
    || (row.remarks ?? null) !== expected.remarks
    || Number(row.created_by) !== expected.createdBy
    || Number(row.counter_id) !== expected.counterId
    || Number(row.counter_session_id) !== expected.counterSessionId
    || Number(row.is_active) !== 1
  )) {
    throw new Error('Legacy settlement evidence changed or is incomplete');
  }
}

async function resolveInvoiceAuthority(
  db: CanonicalBatchDatabase,
  input: SettlementCancellationInput,
  bill: SettlementCancellationBillSnapshot,
): Promise<CanonicalInvoiceRow> {
  const mappings = await all<MappingDbRow>(db.prepare(`
    SELECT canonical_public_id,source_type,source_public_id,source_table,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice' AND mapping_status='mapped'
      AND source_table='bills'
      AND (
        (source_type='legacy_bill' AND source_public_id=?)
        OR (source_type='legacy_live_bill' AND source_public_id=?)
      )
    ORDER BY canonical_public_id,source_type
  `).bind(input.tenantId, String(bill.id), bill.invoiceNo));
  const publicIds = [...new Set(mappings.map((mapping) => mapping.canonical_public_id))];
  if (publicIds.length !== 1) {
    throw new Error(`Canonical invoice mapping is missing, duplicate, or conflicting for bill #${bill.id}`);
  }
  const invoice = await db.prepare(`
    SELECT invoice_public_id,invoice_number,legacy_patient_id,currency_code,total_minor,
           paid_minor,due_minor,credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(input.tenantId, publicIds[0]).first<CanonicalInvoiceRow>();
  if (!invoice || invoice.status !== 'posted') {
    throw new Error(`Canonical invoice is unavailable for bill #${bill.id}`);
  }
  const legacyTotalMinor = moneyMinor(bill.total, `bill #${bill.id} total`);
  const legacyPaidMinor = moneyMinor(bill.paid, `bill #${bill.id} paid`);
  const legacyDueMinor = moneyMinor(bill.due, `bill #${bill.id} due`);
  if (
    invoice.invoice_number !== bill.invoiceNo
    || invoice.legacy_patient_id !== bill.patientId
    || invoice.currency_code !== 'BDT'
    || invoice.total_minor !== legacyTotalMinor
    || invoice.paid_minor + invoice.credited_minor !== legacyPaidMinor
    || invoice.net_due_minor !== legacyDueMinor
    || invoice.paid_minor + invoice.due_minor !== invoice.total_minor
    || invoice.net_due_minor !== invoice.due_minor - invoice.credited_minor
  ) {
    throw new Error(`Legacy and canonical invoice balances do not reconcile for bill #${bill.id}`);
  }
  return invoice;
}

async function resolvePaymentPublicId(
  db: CanonicalBatchDatabase,
  tenantId: string,
  receiptNo: string,
): Promise<string> {
  const rows = await all<CanonicalPaymentMappingRow>(db.prepare(`
    SELECT canonical_public_id,source_public_id
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='payment_receipt'
      AND source_type='legacy_settlement_payment' AND source_public_id=?
      AND source_table='payments' AND mapping_status='mapped'
    ORDER BY canonical_public_id
  `).bind(tenantId, receiptNo));
  if (rows.length !== 1 || rows[0].source_public_id !== receiptNo) {
    throw new Error(`Canonical payment mapping is missing, duplicate, or conflicting for ${receiptNo}`);
  }
  return rows[0].canonical_public_id;
}

async function resolveDepositApplications(
  db: CanonicalBatchDatabase,
  input: SettlementCancellationInput,
  bill: SettlementCancellationBillSnapshot,
  receiptNo: string,
  expectedMinor: number,
): Promise<CancelSettlementBillInput['depositApplications']> {
  const rows = await all<CanonicalDepositApplicationRow>(db.prepare(`
    SELECT a.application_public_id,a.deposit_public_id,a.invoice_public_id,
           a.amount_minor,a.status,a.reversed_at_utc
    FROM canonical_source_mappings m
    JOIN canonical_deposit_applications a
      ON a.tenant_id=m.tenant_id AND a.application_public_id=m.canonical_public_id
    WHERE m.tenant_id=? AND m.entity_type='deposit_application'
      AND m.source_type='legacy_settlement_deposit_adjustment'
      AND m.source_public_id=? AND m.source_table='billing_deposits'
      AND m.mapping_status='mapped'
    ORDER BY a.application_public_id
  `).bind(input.tenantId, receiptNo));
  if (rows.length === 0) {
    throw new Error(`Canonical deposit application mapping is unavailable for bill #${bill.id}`);
  }
  const seen = new Set<string>();
  let total = 0;
  for (const row of rows) {
    if (seen.has(row.application_public_id)) throw new Error('Duplicate canonical deposit application mapping');
    seen.add(row.application_public_id);
    if (row.status !== 'active' || row.reversed_at_utc !== null) {
      throw new Error(`Canonical deposit application is already reversed for bill #${bill.id}`);
    }
    total += Number(row.amount_minor);
  }
  if (total !== expectedMinor) {
    throw new Error(`Canonical deposit application total does not reconcile for bill #${bill.id}`);
  }
  return rows.map((row) => ({
    applicationPublicId: row.application_public_id,
    depositPublicId: row.deposit_public_id,
    amountMinor: Number(row.amount_minor),
  }));
}

async function resolveCreditNote(
  db: CanonicalBatchDatabase,
  input: SettlementCancellationInput,
  bill: SettlementCancellationBillSnapshot,
  receiptNo: string,
  invoicePublicId: string,
  expectedMinor: number,
): Promise<string> {
  const rows = await all<CanonicalCreditNoteRow>(db.prepare(`
    SELECT c.credit_note_public_id,c.invoice_public_id,c.total_minor,c.status,c.reversed_at_utc
    FROM canonical_source_mappings m
    JOIN canonical_credit_notes c
      ON c.tenant_id=m.tenant_id AND c.credit_note_public_id=m.canonical_public_id
    WHERE m.tenant_id=? AND m.entity_type='credit_note'
      AND m.source_type='legacy_settlement_discount'
      AND m.source_public_id=? AND m.source_table='bill_discount_allocations'
      AND m.mapping_status='mapped'
    ORDER BY c.credit_note_public_id
  `).bind(input.tenantId, receiptNo));
  if (rows.length !== 1) {
    throw new Error(`Canonical discount mapping is missing, duplicate, or conflicting for bill #${bill.id}`);
  }
  const row = rows[0];
  if (
    row.invoice_public_id !== invoicePublicId
    || Number(row.total_minor) !== expectedMinor
    || row.status !== 'posted'
    || row.reversed_at_utc !== null
  ) {
    throw new Error(`Canonical discount authority is not reversible for bill #${bill.id}`);
  }
  return row.credit_note_public_id;
}

async function loadAccountingEvent(
  db: CanonicalBatchDatabase,
  input: SettlementCancellationInput,
  bill: SettlementCancellationBillSnapshot,
  expected: {
    sourceType: string;
    sourceId: string;
    eventType: string;
    amount: number;
  },
): Promise<AccountingEventSnapshot> {
  const rows = await all<AccountingEventDbRow>(db.prepare(`
    SELECT id,source_event_key,source_type,source_id,event_type,event_date,payload_json,
           status,posted_voucher_id,posted_at,created_by
    FROM accounting_posting_events
    WHERE tenant_id=? AND source_type=? AND source_id=? AND event_type=?
    ORDER BY id
  `).bind(input.tenantId, expected.sourceType, expected.sourceId, expected.eventType));
  if (rows.length !== 1) {
    throw new Error(`Accounting event evidence is missing, duplicate, or conflicting for ${expected.sourceId}`);
  }
  const row = rows[0];
  const expectedKey = createPostingEventKey(expected.sourceType, expected.sourceId, expected.eventType as never);
  if (row.source_event_key !== expectedKey) throw new Error(`Accounting source key mismatch for ${expected.sourceId}`);
  const payload = parsePayload(row.payload_json, `Accounting event ${expected.sourceId}`);
  if (
    String(payload.settlementReceiptNo ?? '') !== input.settlement.receiptNo
    || String(payload.receiptNo ?? '') !== expected.sourceId
    || Number(payload.billId) !== bill.id
    || Number(payload.patientId) !== input.settlement.patientId
    || !sameMoney(Number(payload.amount ?? NaN), expected.amount)
  ) {
    throw new Error(`Accounting event payload does not reconcile for ${expected.sourceId}`);
  }
  if (row.status === 'processing') {
    throw new Error(`Accounting posting is processing for ${expected.sourceId}; cancellation race detected`);
  }
  if (row.status !== 'posted' && !ALLOWED_UNPOSTED_ACCOUNTING_STATUSES.has(row.status)) {
    throw new Error(`Accounting event status is unsupported for ${expected.sourceId}`);
  }

  let voucherLines: AccountingJournalLineSnapshot[] = [];
  let reversalSourceEventKey: string | null = null;
  let reversalSourceId: string | null = null;
  let reversalPayloadJson: string | null = null;
  if (row.status === 'posted') {
    if (!(Number(row.posted_voucher_id) > 0)) {
      throw new Error(`Posted accounting event has no voucher for ${expected.sourceId}`);
    }
    const voucher = await db.prepare(`
      SELECT id,source_event_key,status
      FROM accounting_vouchers
      WHERE tenant_id=? AND id=?
      LIMIT 1
    `).bind(input.tenantId, row.posted_voucher_id).first<VoucherDbRow>();
    if (!voucher || voucher.status !== 'verified' || voucher.source_event_key !== row.source_event_key) {
      throw new Error(`Posted accounting voucher is unavailable or unverified for ${expected.sourceId}`);
    }
    const lines = await all<JournalLineDbRow>(db.prepare(`
      SELECT line_no,account_id,debit_amount,credit_amount,memo
      FROM accounting_journal_lines
      WHERE tenant_id=? AND voucher_id=?
      ORDER BY line_no
    `).bind(input.tenantId, voucher.id));
    if (lines.length < 2) throw new Error(`Posted accounting voucher is incomplete for ${expected.sourceId}`);
    let debitTotal = 0;
    let creditTotal = 0;
    voucherLines = lines.map((line) => {
      const debit = roundMoney(Number(line.debit_amount));
      const credit = roundMoney(Number(line.credit_amount));
      if (!((debit > 0 && credit === 0) || (credit > 0 && debit === 0))) {
        throw new Error(`Posted accounting voucher line is invalid for ${expected.sourceId}`);
      }
      debitTotal = roundMoney(debitTotal + debit);
      creditTotal = roundMoney(creditTotal + credit);
      return {
        lineNo: Number(line.line_no),
        accountId: Number(line.account_id),
        debit,
        credit,
        memo: line.memo ?? null,
      };
    });
    if (!sameMoney(debitTotal, creditTotal) || !sameMoney(debitTotal, expected.amount)) {
      throw new Error(`Posted accounting voucher does not reconcile for ${expected.sourceId}`);
    }
    reversalSourceId = `${input.settlement.receiptNo}:${row.id}`;
    reversalSourceEventKey = createPostingEventKey(
      'settlement_cancellation_accounting_reversal',
      reversalSourceId,
      ACCOUNTING_EVENT_TYPES.manualJournal,
    );
    const existingReversal = await db.prepare(`
      SELECT id
      FROM accounting_posting_events
      WHERE tenant_id=? AND source_event_key=?
      LIMIT 1
    `).bind(input.tenantId, reversalSourceEventKey).first<{ id: number }>();
    if (existingReversal) throw new Error(`Accounting event is already reversed for ${expected.sourceId}`);
    reversalPayloadJson = JSON.stringify({
      lines: voucherLines.map((line) => ({
        accountId: line.accountId,
        debit: line.credit,
        credit: line.debit,
        memo: `Settlement cancellation reversal: ${line.memo ?? expected.sourceId}`,
      })),
      reversalOfVoucherId: voucher.id,
      reversalOfSourceEventKey: row.source_event_key,
      settlementReceiptNo: input.settlement.receiptNo,
    });
  }

  return {
    id: Number(row.id),
    sourceEventKey: row.source_event_key,
    sourceType: row.source_type,
    sourceId: row.source_id,
    eventType: row.event_type,
    eventDate: row.event_date,
    payloadJson: row.payload_json,
    status: row.status,
    postedVoucherId: row.posted_voucher_id == null ? null : Number(row.posted_voucher_id),
    postedAt: row.posted_at ?? null,
    createdBy: row.created_by ?? null,
    expectedAmount: expected.amount,
    reversalSourceEventKey,
    reversalSourceId,
    reversalPayloadJson,
    voucherLines,
  };
}

export async function prepareSettlementCancellationStrictContext(
  db: CanonicalBatchDatabase,
  input: SettlementCancellationInput,
): Promise<SettlementCancellationStrictContext> {
  assertInput(input);
  const settlement = await db.prepare(`
    SELECT id,patient_id,settlement_receipt_no,payable_amount,paid_amount,
           deposit_deducted,discount_amount,discount_by_name,payment_mode,remarks,
           created_by,counter_id,counter_session_id,is_active
    FROM billing_settlements
    WHERE id=? AND CAST(tenant_id AS TEXT)=?
    LIMIT 1
  `).bind(input.settlementId, input.tenantId).first<SettlementDbRow>();
  assertSettlementRowMatches(input, settlement);

  const activeCounter = await db.prepare(`
    SELECT id
    FROM billing_counter_sessions
    WHERE id=? AND CAST(tenant_id AS TEXT)=? AND counter_id=? AND user_id=? AND status='active'
    LIMIT 1
  `).bind(
    input.activeCounterSessionId,
    input.tenantId,
    input.activeCounterId,
    input.userId,
  ).first<{ id: number }>();
  if (!activeCounter) throw new Error('Active cancellation counter session changed');

  const settlementMappings = await all<MappingDbRow>(db.prepare(`
    SELECT canonical_public_id,source_type,source_public_id,source_table,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='settlement'
      AND source_type='legacy_settlement' AND source_public_id=?
      AND source_table='billing_settlements' AND mapping_status='mapped'
    ORDER BY canonical_public_id
  `).bind(input.tenantId, input.settlement.receiptNo));
  if (settlementMappings.length !== 1) {
    throw new Error('Canonical settlement mapping is missing, duplicate, or conflicting');
  }
  const settlementPublicId = settlementMappings[0].canonical_public_id;

  const strictBills: StrictBillContext[] = [];
  const accountingEvents: AccountingEventSnapshot[] = [];
  let cashTotal = 0;
  let depositTotal = 0;
  let discountTotal = 0;

  for (const expectedBill of [...input.bills].sort((a, b) => a.id - b.id)) {
    const bill = await db.prepare(`
      SELECT id,invoice_no,patient_id,total,paid,due,status,settlement_id
      FROM bills
      WHERE id=? AND CAST(tenant_id AS TEXT)=?
      LIMIT 1
    `).bind(expectedBill.id, input.tenantId).first<BillDbRow>();
    if (!bill || (
      Number(bill.patient_id) !== expectedBill.patientId
      || String(bill.invoice_no) !== expectedBill.invoiceNo
      || !sameMoney(Number(bill.total), expectedBill.total)
      || !sameMoney(Number(bill.paid), expectedBill.paid)
      || !sameMoney(Number(bill.due), expectedBill.due)
      || String(bill.status) !== expectedBill.status
      || Number(bill.settlement_id) !== input.settlementId
    )) throw new Error(`Legacy bill evidence changed for bill #${expectedBill.id}`);

    const paymentReceiptNo = `${input.settlement.receiptNo}-B${expectedBill.id}`;
    const paymentRows = await all<PaymentDbRow>(db.prepare(`
      SELECT id,bill_id,amount,receipt_no,payment_type,payment_method,received_by,
             counter_id,counter_session_id
      FROM payments
      WHERE bill_id=? AND CAST(tenant_id AS TEXT)=? AND receipt_no=?
      ORDER BY id
    `).bind(expectedBill.id, input.tenantId, paymentReceiptNo));
    if (paymentRows.length > 1) throw new Error(`Duplicate cash payment evidence for bill #${expectedBill.id}`);
    const payment = paymentRows[0] ? {
      id: Number(paymentRows[0].id),
      billId: Number(paymentRows[0].bill_id),
      amount: roundMoney(Number(paymentRows[0].amount)),
      receiptNo: paymentRows[0].receipt_no,
      paymentType: paymentRows[0].payment_type ?? null,
      paymentMethod: paymentRows[0].payment_method,
      receivedBy: paymentRows[0].received_by == null ? null : Number(paymentRows[0].received_by),
      counterId: paymentRows[0].counter_id == null ? null : Number(paymentRows[0].counter_id),
      counterSessionId: paymentRows[0].counter_session_id == null ? null : Number(paymentRows[0].counter_session_id),
    } satisfies LegacyPaymentEvidence : null;
    if (payment && (
      payment.receiptNo !== paymentReceiptNo
      || payment.paymentMethod !== input.settlement.paymentMode
      || payment.receivedBy !== input.settlement.createdBy
      || payment.counterId !== input.settlement.counterId
      || payment.counterSessionId !== input.settlement.counterSessionId
      || payment.amount <= 0
    )) throw new Error(`Cash payment evidence does not reconcile for bill #${expectedBill.id}`);

    const depositReceiptNo = `${input.settlement.receiptNo}-DAD-B${expectedBill.id}`;
    const depositRows = await all<DepositDbRow>(db.prepare(`
      SELECT id,patient_id,reference_bill_id,amount,deposit_receipt_no,remarks,
             created_by,counter_id,counter_session_id,is_active
      FROM billing_deposits
      WHERE reference_bill_id=? AND CAST(tenant_id AS TEXT)=?
        AND transaction_type='adjustment' AND deposit_receipt_no=?
      ORDER BY id
    `).bind(expectedBill.id, input.tenantId, depositReceiptNo));
    if (depositRows.length > 1) throw new Error(`Duplicate deposit evidence for bill #${expectedBill.id}`);
    const deposit = depositRows[0] ? {
      id: Number(depositRows[0].id),
      billId: Number(depositRows[0].reference_bill_id),
      patientId: Number(depositRows[0].patient_id),
      amount: roundMoney(Number(depositRows[0].amount)),
      receiptNo: depositRows[0].deposit_receipt_no,
      remarks: depositRows[0].remarks ?? null,
      createdBy: depositRows[0].created_by == null ? null : Number(depositRows[0].created_by),
      counterId: depositRows[0].counter_id == null ? null : Number(depositRows[0].counter_id),
      counterSessionId: depositRows[0].counter_session_id == null ? null : Number(depositRows[0].counter_session_id),
      isActive: Number(depositRows[0].is_active),
    } satisfies LegacyDepositEvidence : null;
    if (deposit && (
      deposit.patientId !== input.settlement.patientId
      || deposit.receiptNo !== depositReceiptNo
      || deposit.createdBy !== input.settlement.createdBy
      || deposit.counterId !== input.settlement.counterId
      || deposit.counterSessionId !== input.settlement.counterSessionId
      || deposit.isActive !== 1
      || deposit.amount <= 0
    )) throw new Error(`Deposit evidence does not reconcile for bill #${expectedBill.id}`);

    const discountReceiptNo = `${input.settlement.receiptNo}-DISC-B${expectedBill.id}`;
    const discountRows = await all<DiscountDbRow>(db.prepare(`
      SELECT id,bill_id,amount,allocation_type,discount_reason,percent,
             reference_name,note,created_by
      FROM bill_discount_allocations
      WHERE CAST(tenant_id AS TEXT)=? AND bill_id=? AND settlement_id=?
      ORDER BY id
    `).bind(input.tenantId, expectedBill.id, input.settlementId));
    if (discountRows.length > 1) throw new Error(`Duplicate discount allocation evidence for bill #${expectedBill.id}`);
    const discount = discountRows[0] ? {
      id: Number(discountRows[0].id),
      billId: Number(discountRows[0].bill_id),
      amount: roundMoney(Number(discountRows[0].amount)),
      allocationType: discountRows[0].allocation_type,
      discountReason: discountRows[0].discount_reason,
      percent: discountRows[0].percent == null ? null : Number(discountRows[0].percent),
      referenceName: discountRows[0].reference_name ?? null,
      note: discountRows[0].note ?? null,
      createdBy: discountRows[0].created_by == null ? null : Number(discountRows[0].created_by),
    } satisfies LegacyDiscountEvidence : null;
    if (discount && (discount.amount <= 0 || discount.createdBy !== input.settlement.createdBy)) {
      throw new Error(`Discount allocation evidence does not reconcile for bill #${expectedBill.id}`);
    }

    const cashMinor = moneyMinor(payment?.amount ?? 0, `bill #${expectedBill.id} cash`);
    const depositMinor = moneyMinor(deposit?.amount ?? 0, `bill #${expectedBill.id} deposit`);
    const discountMinor = moneyMinor(discount?.amount ?? 0, `bill #${expectedBill.id} discount`);
    cashTotal = roundMoney(cashTotal + (payment?.amount ?? 0));
    depositTotal = roundMoney(depositTotal + (deposit?.amount ?? 0));
    discountTotal = roundMoney(discountTotal + (discount?.amount ?? 0));
    if (cashMinor + depositMinor + discountMinor <= 0) {
      throw new Error(`Settlement child evidence is missing for bill #${expectedBill.id}`);
    }

    const invoice = await resolveInvoiceAuthority(db, input, expectedBill);
    const paymentReceiptPublicId = payment
      ? await resolvePaymentPublicId(db, input.tenantId, payment.receiptNo)
      : null;
    const depositApplications = deposit
      ? await resolveDepositApplications(
          db,
          input,
          expectedBill,
          deposit.receiptNo,
          depositMinor,
        )
      : [];
    const creditNotePublicId = discount
      ? await resolveCreditNote(
          db,
          input,
          expectedBill,
          discountReceiptNo,
          invoice.invoice_public_id,
          discountMinor,
        )
      : null;

    if (payment) {
      accountingEvents.push(await loadAccountingEvent(db, input, expectedBill, {
        sourceType: 'payment',
        sourceId: payment.receiptNo,
        eventType: ACCOUNTING_EVENT_TYPES.paymentReceived,
        amount: payment.amount,
      }));
    }
    if (deposit) {
      accountingEvents.push(await loadAccountingEvent(db, input, expectedBill, {
        sourceType: 'patient_deposit_adjustment',
        sourceId: deposit.receiptNo,
        eventType: ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
        amount: deposit.amount,
      }));
    }
    if (discount) {
      accountingEvents.push(await loadAccountingEvent(db, input, expectedBill, {
        sourceType: 'settlement_discount',
        sourceId: discountReceiptNo,
        eventType: ACCOUNTING_EVENT_TYPES.settlementDiscount,
        amount: discount.amount,
      }));
    }

    const paidBeforeSettlementMinor = invoice.paid_minor - cashMinor - depositMinor;
    const dueBeforeSettlementMinor = invoice.due_minor + cashMinor + depositMinor;
    const creditedBeforeSettlementMinor = invoice.credited_minor - discountMinor;
    const netDueBeforeSettlementMinor = invoice.net_due_minor + cashMinor + depositMinor + discountMinor;
    if (
      paidBeforeSettlementMinor < 0
      || creditedBeforeSettlementMinor < 0
      || paidBeforeSettlementMinor + dueBeforeSettlementMinor !== invoice.total_minor
      || netDueBeforeSettlementMinor !== dueBeforeSettlementMinor - creditedBeforeSettlementMinor
    ) throw new Error(`Canonical pre-settlement invoice projection is invalid for bill #${expectedBill.id}`);

    strictBills.push({
      legacy: expectedBill,
      payment,
      deposit,
      discount,
      command: {
        billId: expectedBill.id,
        invoicePublicId: invoice.invoice_public_id,
        invoiceNumber: invoice.invoice_number,
        totalMinor: invoice.total_minor,
        paidBeforeSettlementMinor,
        dueBeforeSettlementMinor,
        creditedBeforeSettlementMinor,
        netDueBeforeSettlementMinor,
        paidAfterSettlementMinor: invoice.paid_minor,
        dueAfterSettlementMinor: invoice.due_minor,
        creditedAfterSettlementMinor: invoice.credited_minor,
        netDueAfterSettlementMinor: invoice.net_due_minor,
        cashMinor,
        depositMinor,
        discountMinor,
        paymentReceiptPublicId,
        depositApplications,
        creditNotePublicId,
      },
    });
  }

  if (!sameMoney(cashTotal, input.settlement.paidAmount)) {
    throw new Error('Settlement cash payment evidence does not reconcile to the settlement header');
  }
  if (!sameMoney(depositTotal, input.settlement.depositDeducted)) {
    throw new Error('Settlement deposit adjustment evidence does not reconcile to the settlement header');
  }
  if (!sameMoney(discountTotal, input.settlement.discountAmount)) {
    throw new Error('Settlement discount allocation evidence does not reconcile to the settlement header');
  }

  const cashRows = await all<CashDbRow>(db.prepare(`
    SELECT id,employee_id,counter_id,counter_session_id,transaction_type,
           amount,payment_method,description
    FROM emp_cash_transactions
    WHERE CAST(tenant_id AS TEXT)=? AND reference_id=? AND reference_type='settlement'
    ORDER BY id
  `).bind(input.tenantId, input.settlementId));
  if ((input.settlement.paidAmount > 0 && cashRows.length !== 1) || (input.settlement.paidAmount === 0 && cashRows.length !== 0)) {
    throw new Error('Settlement counter-cash evidence is missing or duplicate');
  }
  const cash = cashRows[0] ? {
    id: Number(cashRows[0].id),
    employeeId: Number(cashRows[0].employee_id),
    counterId: Number(cashRows[0].counter_id),
    counterSessionId: Number(cashRows[0].counter_session_id),
    transactionType: cashRows[0].transaction_type,
    amount: roundMoney(Number(cashRows[0].amount)),
    paymentMethod: cashRows[0].payment_method ?? null,
    description: cashRows[0].description ?? null,
  } satisfies LegacyCashEvidence : null;
  if (cash && (
    cash.employeeId !== input.settlement.createdBy
    || cash.counterId !== input.settlement.counterId
    || cash.counterSessionId !== input.settlement.counterSessionId
    || cash.transactionType !== 'CollectionFromReceivable'
    || !sameMoney(cash.amount, input.settlement.paidAmount)
  )) throw new Error('Settlement counter-cash evidence does not reconcile');

  return {
    input,
    bills: strictBills,
    cash,
    accountingEvents,
    commandInput: {
      tenantId: input.tenantId,
      commandIdempotencyKey: `settlement-cancel:${input.settlement.receiptNo}`,
      settlementPublicId,
      settlementReceiptNumber: input.settlement.receiptNo,
      cancellationSourcePublicId: input.settlement.receiptNo,
      reasonCode: 'SETTLEMENT_CANCELLED',
      cancelledAtUtc: input.cancelledAtUtc,
      businessDate: input.businessDate,
      bills: strictBills.map((bill) => bill.command),
    },
  };
}

function assertion(
  db: Pick<CanonicalBatchDatabase, 'prepare'>,
  tenantId: string,
  operationKey: string,
  stepKey: string,
): CanonicalPreparedStatement {
  return prepareFinancialBatchAssertion(db, {
    tenantId,
    operationKey,
    stepKey,
    expectedChanges: 1,
  });
}

export function prepareSettlementCancellationStrictStatements(
  db: Pick<CanonicalBatchDatabase, 'prepare'>,
  context: SettlementCancellationStrictContext,
): readonly CanonicalPreparedStatement[] {
  const { input } = context;
  const operationKey = `settlement-cancel-legacy:${input.settlement.receiptNo}`;
  const statements: CanonicalPreparedStatement[] = [];
  const asserted = (statement: CanonicalPreparedStatement, stepKey: string) => {
    statements.push(statement, assertion(db, input.tenantId, operationKey, stepKey));
  };

  for (const bill of context.bills) {
    const settlementApplied = roundMoney(
      (bill.payment?.amount ?? 0) + (bill.deposit?.amount ?? 0) + (bill.discount?.amount ?? 0),
    );
    const paidBefore = roundMoney(bill.legacy.paid - settlementApplied);
    const dueBefore = roundMoney(bill.legacy.total - paidBefore);
    const statusBefore = paidBefore <= 0
      ? 'open'
      : paidBefore < bill.legacy.total
        ? 'partially_paid'
        : 'paid';
    asserted(db.prepare(`
      UPDATE bills
      SET paid=?,due=?,status=?,settlement_id=NULL
      WHERE id=? AND CAST(tenant_id AS TEXT)=? AND patient_id=? AND invoice_no=?
        AND total=? AND paid=? AND due=? AND status=? AND settlement_id=?
    `).bind(
      paidBefore,
      dueBefore,
      statusBefore,
      bill.legacy.id,
      input.tenantId,
      bill.legacy.patientId,
      bill.legacy.invoiceNo,
      bill.legacy.total,
      bill.legacy.paid,
      bill.legacy.due,
      bill.legacy.status,
      input.settlementId,
    ), `bill-${bill.legacy.id}`);

    if (bill.payment) {
      asserted(db.prepare(`
        DELETE FROM payments
        WHERE id=? AND CAST(tenant_id AS TEXT)=? AND bill_id=? AND amount=?
          AND receipt_no=? AND payment_method=? AND received_by=?
          AND counter_id=? AND counter_session_id=?
      `).bind(
        bill.payment.id,
        input.tenantId,
        bill.payment.billId,
        bill.payment.amount,
        bill.payment.receiptNo,
        bill.payment.paymentMethod,
        bill.payment.receivedBy,
        bill.payment.counterId,
        bill.payment.counterSessionId,
      ), `payment-${bill.legacy.id}`);
    }
    if (bill.deposit) {
      asserted(db.prepare(`
        DELETE FROM billing_deposits
        WHERE id=? AND CAST(tenant_id AS TEXT)=? AND patient_id=?
          AND reference_bill_id=? AND transaction_type='adjustment'
          AND deposit_receipt_no=? AND amount=? AND created_by=?
          AND counter_id=? AND counter_session_id=? AND is_active=?
      `).bind(
        bill.deposit.id,
        input.tenantId,
        bill.deposit.patientId,
        bill.deposit.billId,
        bill.deposit.receiptNo,
        bill.deposit.amount,
        bill.deposit.createdBy,
        bill.deposit.counterId,
        bill.deposit.counterSessionId,
        bill.deposit.isActive,
      ), `deposit-${bill.legacy.id}`);
    }
    if (bill.discount) {
      asserted(db.prepare(`
        DELETE FROM bill_discount_allocations
        WHERE id=? AND CAST(tenant_id AS TEXT)=? AND bill_id=? AND settlement_id=?
          AND allocation_type=? AND discount_reason=? AND amount=?
          AND created_by=? AND reference_name IS ? AND note IS ?
      `).bind(
        bill.discount.id,
        input.tenantId,
        bill.discount.billId,
        input.settlementId,
        bill.discount.allocationType,
        bill.discount.discountReason,
        bill.discount.amount,
        bill.discount.createdBy,
        bill.discount.referenceName,
        bill.discount.note,
      ), `discount-${bill.legacy.id}`);
    }
  }

  statements.push(db.prepare(`
    UPDATE billing_credit_bill_status
    SET settlement_status='Pending',settlement_id=NULL,updated_at=datetime('now','+6 hours')
    WHERE CAST(tenant_id AS TEXT)=? AND settlement_id=? AND settlement_status='Completed'
  `).bind(input.tenantId, input.settlementId));

  if (context.cash) {
    asserted(db.prepare(`
      DELETE FROM emp_cash_transactions
      WHERE id=? AND CAST(tenant_id AS TEXT)=? AND employee_id=? AND counter_id=?
        AND counter_session_id=? AND transaction_type='CollectionFromReceivable'
        AND amount=? AND reference_id=? AND reference_type='settlement'
        AND payment_method IS ? AND description IS ?
    `).bind(
      context.cash.id,
      input.tenantId,
      context.cash.employeeId,
      context.cash.counterId,
      context.cash.counterSessionId,
      context.cash.amount,
      input.settlementId,
      context.cash.paymentMethod,
      context.cash.description,
    ), 'counter-cash');
  }

  for (const event of context.accountingEvents) {
    if (event.status !== 'posted') {
      asserted(db.prepare(`
        DELETE FROM accounting_posting_events
        WHERE id=? AND CAST(tenant_id AS TEXT)=? AND source_event_key=?
          AND source_type=? AND source_id=? AND event_type=? AND event_date=?
          AND payload_json=? AND status=? AND posted_voucher_id IS NULL
      `).bind(
        event.id,
        input.tenantId,
        event.sourceEventKey,
        event.sourceType,
        event.sourceId,
        event.eventType,
        event.eventDate,
        event.payloadJson,
        event.status,
      ), `accounting-delete-${event.id}`);
      continue;
    }

    if (
      !event.reversalSourceEventKey
      || !event.reversalSourceId
      || !event.reversalPayloadJson
      || !event.postedVoucherId
      || event.voucherLines.length === 0
    ) throw new Error(`Posted accounting reversal context is incomplete for event #${event.id}`);
    const lineGuards = event.voucherLines.map(() => `
      AND EXISTS (
        SELECT 1 FROM accounting_journal_lines l
        WHERE CAST(l.tenant_id AS TEXT)=? AND l.voucher_id=? AND l.line_no=?
          AND l.account_id=? AND l.debit_amount=? AND l.credit_amount=? AND l.memo IS ?
      )
    `).join('');
    const lineParams = event.voucherLines.flatMap((line) => [
      input.tenantId,
      event.postedVoucherId,
      line.lineNo,
      line.accountId,
      line.debit,
      line.credit,
      line.memo,
    ]);
    asserted(db.prepare(`
      INSERT INTO accounting_posting_events (
        tenant_id,source_event_key,source_type,source_id,event_type,
        event_date,payload_json,status,attempts,created_by
      )
      SELECT ?,?,'settlement_cancellation_accounting_reversal',?,
             'manual_journal',?,?, 'pending',0,?
      WHERE EXISTS (
        SELECT 1 FROM accounting_posting_events e
        WHERE e.id=? AND CAST(e.tenant_id AS TEXT)=? AND e.source_event_key=?
          AND e.source_type=? AND e.source_id=? AND e.event_type=?
          AND e.event_date=? AND e.payload_json=? AND e.status='posted'
          AND e.posted_voucher_id=? AND e.posted_at IS ?
      )
        AND EXISTS (
          SELECT 1 FROM accounting_vouchers v
          WHERE v.id=? AND CAST(v.tenant_id AS TEXT)=?
            AND v.source_event_key=? AND v.status='verified'
        )
        AND (SELECT COUNT(*) FROM accounting_journal_lines l
             WHERE CAST(l.tenant_id AS TEXT)=? AND l.voucher_id=?)=?
        ${lineGuards}
        AND NOT EXISTS (
          SELECT 1 FROM accounting_posting_events
          WHERE CAST(tenant_id AS TEXT)=? AND source_event_key=?
        )
    `).bind(
      input.tenantId,
      event.reversalSourceEventKey,
      event.reversalSourceId,
      input.businessDate,
      event.reversalPayloadJson,
      String(input.userId),
      event.id,
      input.tenantId,
      event.sourceEventKey,
      event.sourceType,
      event.sourceId,
      event.eventType,
      event.eventDate,
      event.payloadJson,
      event.postedVoucherId,
      event.postedAt,
      event.postedVoucherId,
      input.tenantId,
      event.sourceEventKey,
      input.tenantId,
      event.postedVoucherId,
      event.voucherLines.length,
      ...lineParams,
      input.tenantId,
      event.reversalSourceEventKey,
    ), `accounting-reversal-${event.id}`);
  }

  asserted(db.prepare(`
    UPDATE billing_settlements
    SET is_active=0,updated_at=datetime('now','+6 hours')
    WHERE id=? AND CAST(tenant_id AS TEXT)=? AND patient_id=?
      AND settlement_receipt_no=? AND payable_amount=? AND paid_amount=?
      AND deposit_deducted=? AND discount_amount=? AND discount_by_name IS ?
      AND payment_mode=? AND remarks IS ? AND created_by=?
      AND counter_id=? AND counter_session_id=? AND is_active=1
      AND EXISTS (
        SELECT 1 FROM billing_counter_sessions s
        WHERE s.id=? AND CAST(s.tenant_id AS TEXT)=?
          AND s.counter_id=? AND s.user_id=? AND s.status='active'
      )
  `).bind(
    input.settlementId,
    input.tenantId,
    input.settlement.patientId,
    input.settlement.receiptNo,
    input.settlement.payableAmount,
    input.settlement.paidAmount,
    input.settlement.depositDeducted,
    input.settlement.discountAmount,
    input.settlement.discountByName,
    input.settlement.paymentMode,
    input.settlement.remarks,
    input.settlement.createdBy,
    input.settlement.counterId,
    input.settlement.counterSessionId,
    input.activeCounterSessionId,
    input.tenantId,
    input.activeCounterId,
    input.userId,
  ), 'settlement');

  asserted(db.prepare(`
    INSERT INTO audit_logs (
      tenant_id,user_id,action,table_name,record_id,old_value,new_value,
      ip_address,user_agent,created_at
    )
    SELECT ?,?,'CANCEL','billing_settlements',?,?,?,NULL,NULL,datetime('now','+6 hours')
    WHERE EXISTS (
      SELECT 1 FROM billing_settlements
      WHERE id=? AND CAST(tenant_id AS TEXT)=? AND is_active=0
    )
  `).bind(
    input.tenantId,
    input.userId,
    input.settlementId,
    JSON.stringify({
      receiptNo: input.settlement.receiptNo,
      paidAmount: input.settlement.paidAmount,
      depositDeducted: input.settlement.depositDeducted,
      discountAmount: input.settlement.discountAmount,
    }),
    JSON.stringify({ cancelled_at: input.businessDate, reason: 'Settlement cancelled' }),
    input.settlementId,
    input.tenantId,
  ), 'audit');

  statements.push(prepareClearFinancialBatchAssertions(db, input.tenantId, operationKey));
  return statements;
}

export async function executeSettlementCancellationOriginalLegacy(
  db: CanonicalBatchDatabase,
  input: SettlementCancellationInput,
): Promise<SettlementCancellationLegacyResult> {
  assertInput(input);
  const batchStmts: CanonicalPreparedStatement[] = [];
  const settlementReceiptPrefix = input.settlement.receiptNo || '';
  const escapedPrefix = settlementReceiptPrefix.replace(/[%_]/g, '\\$&');
  const totalSettlementDiscount = Number(input.settlement.discountAmount ?? 0);
  let remainingDiscount = roundMoney(totalSettlementDiscount);
  const sortedBills = [...input.bills].sort((a, b) => a.id - b.id);

  for (const bill of sortedBills) {
    const settlementPayments = await all<{ total: number }>(db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE bill_id = ? AND tenant_id = ? AND receipt_no LIKE ? ESCAPE '\\'",
    ).bind(bill.id, input.tenantId, `${escapedPrefix}%`));
    const cashFromSettlement = Number(settlementPayments?.[0]?.total ?? 0);
    const settlementDeposits = await all<{ total: number }>(db.prepare(
      "SELECT COALESCE(SUM(amount), 0) as total FROM billing_deposits WHERE reference_bill_id = ? AND tenant_id = ? AND transaction_type = 'adjustment' AND deposit_receipt_no LIKE ? ESCAPE '\\'",
    ).bind(bill.id, input.tenantId, `${escapedPrefix}%`));
    const depositFromSettlement = Number(settlementDeposits?.[0]?.total ?? 0);
    const settlementDiscounts = await all<{ total: number }>(db.prepare(`
      SELECT COALESCE(SUM(COALESCE(json_extract(payload_json, '$.amount'), 0)), 0) as total
      FROM accounting_posting_events
      WHERE tenant_id = ? AND source_type = 'settlement_discount'
        AND source_id = ? AND json_extract(payload_json, '$.billId') = ?
    `).bind(input.tenantId, `${settlementReceiptPrefix}-DISC-B${bill.id}`, bill.id));
    const discountEventAmount = roundMoney(Number(settlementDiscounts?.[0]?.total ?? 0));
    const currentDue = roundMoney(Number(bill.total ?? 0) - Number(bill.paid ?? 0));
    const currentPaid = Number(bill.paid ?? 0);
    const nonDiscountSettlement = roundMoney(cashFromSettlement + depositFromSettlement);
    let discountForBill: number;
    if (discountEventAmount > 0) {
      discountForBill = roundMoney(Math.min(remainingDiscount, discountEventAmount));
    } else if (totalSettlementDiscount > 0 && remainingDiscount > 0) {
      console.warn(`[settlement] Discount events missing for bill ${bill.id}, using heuristic fallback`);
      discountForBill = currentDue > 0
        ? remainingDiscount
        : roundMoney(Math.min(remainingDiscount, Math.max(0, currentPaid - nonDiscountSettlement)));
    } else {
      discountForBill = 0;
    }
    remainingDiscount = roundMoney(remainingDiscount - discountForBill);
    const settlementAmount = roundMoney(nonDiscountSettlement + discountForBill);
    if (settlementAmount <= 0) continue;
    const newPaid = roundMoney(Math.max(0, currentPaid - settlementAmount));
    const newDue = roundMoney(Number(bill.total ?? 0) - newPaid);
    const newStatus = newPaid <= 0 ? 'open' : newPaid < Number(bill.total ?? 0) ? 'partially_paid' : 'paid';
    batchStmts.push(db.prepare(
      'UPDATE bills SET paid = ?, due = ?, status = ?, settlement_id = NULL WHERE id = ? AND tenant_id = ?',
    ).bind(newPaid, newDue, newStatus, bill.id, input.tenantId));
    if (cashFromSettlement > 0) {
      batchStmts.push(db.prepare(
        "DELETE FROM payments WHERE bill_id = ? AND tenant_id = ? AND receipt_no LIKE ? ESCAPE '\\'",
      ).bind(bill.id, input.tenantId, `${escapedPrefix}%`));
    }
    if (depositFromSettlement > 0) {
      batchStmts.push(db.prepare(
        "DELETE FROM billing_deposits WHERE reference_bill_id = ? AND tenant_id = ? AND transaction_type = 'adjustment' AND deposit_receipt_no LIKE ? ESCAPE '\\'",
      ).bind(bill.id, input.tenantId, `${escapedPrefix}%`));
    }
  }

  batchStmts.push(
    db.prepare(`
      UPDATE billing_credit_bill_status
      SET settlement_status = 'Pending', settlement_id = NULL, updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND settlement_id = ?
    `).bind(input.tenantId, input.settlementId),
    db.prepare(
      "DELETE FROM emp_cash_transactions WHERE tenant_id = ? AND reference_id = ? AND reference_type = 'settlement'",
    ).bind(input.tenantId, input.settlementId),
    db.prepare(
      "DELETE FROM accounting_posting_events WHERE tenant_id = ? AND json_extract(payload_json, '$.settlementReceiptNo') = ?",
    ).bind(input.tenantId, settlementReceiptPrefix),
    db.prepare(
      "UPDATE billing_settlements SET is_active = 0, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?",
    ).bind(input.settlementId, input.tenantId),
    db.prepare(`
      INSERT INTO audit_logs (tenant_id, user_id, action, table_name, record_id, new_value, created_at)
      VALUES (?, ?, 'CANCEL', 'billing_settlements', ?, ?, datetime('now', '+6 hours'))
    `).bind(
      input.tenantId,
      input.userId,
      input.settlementId,
      JSON.stringify({ cancelled_at: input.businessDate, reason: 'Settlement cancelled' }),
    ),
  );

  return { results: await db.batch(batchStmts) };
}
