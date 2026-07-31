import {
  CanonicalIdempotencyConflictError,
  createRequestFingerprint,
  parseCanonicalCommandEnvelope,
} from './idempotency';
import { createDeterministicSourceId } from './source-mapping';
import { toUtcIso } from './time';

export interface CanonicalAccountingPreparedStatement {
  bind(...values: unknown[]): CanonicalAccountingPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface CanonicalAccountingDatabase {
  prepare(sql: string): CanonicalAccountingPreparedStatement;
  batch(statements: CanonicalAccountingPreparedStatement[]): Promise<unknown[]>;
}

export interface PostCanonicalAccountingEventInput {
  tenantId: string;
  outboxEventPublicId: string;
  nowUtc: string;
  maxAttempts?: number;
}

export interface PostPendingCanonicalAccountingEventsInput {
  tenantId: string;
  limit?: number;
  nowUtc: string;
  maxAttempts?: number;
}

export interface ReverseCanonicalAccountingVoucherInput {
  tenantId: string;
  originalVoucherPublicId: string;
  reversalPublicId: string;
  reasonCode: string;
  occurredAtUtc: string;
  businessDate: string;
  idempotencyKey: string;
  sourceEvidenceSha256: string;
}

export type CanonicalAccountingPostResult = {
  status: 'posted' | 'replayed' | 'skipped' | 'retry' | 'dead_letter';
  postingKind: 'voucher' | 'cash_custody' | 'skip';
  voucherPublicId: string | null;
  custodyMovementPublicId: string | null;
  debitTotalMinor: number;
  creditTotalMinor: number;
  skipCode?: string;
  errorCode?: string;
};

export type PostPendingCanonicalAccountingEventsResult = {
  scanned: number;
  posted: number;
  skipped: number;
  retry: number;
  deadLetter: number;
};

interface OutboxRow {
  event_public_id: string;
  aggregate_type: string;
  aggregate_public_id: string;
  event_type: string;
  event_version: number;
  payload_json: string;
  occurred_at_utc: string;
  business_date: string | null;
  status: string;
}

interface JobRow {
  posting_job_public_id: string;
  source_event_type: string;
  source_fingerprint: string;
  posting_kind: 'voucher' | 'cash_custody' | 'skip';
  status: 'pending' | 'processing' | 'retry' | 'posted' | 'skipped' | 'dead_letter';
  attempts: number;
  max_attempts: number;
  voucher_public_id: string | null;
  custody_movement_public_id: string | null;
  skip_code: string | null;
  last_error_code: string | null;
}

interface PeriodRow {
  period_public_id: string;
  status: 'open' | 'closed' | 'reopened';
}

interface MappingRow {
  account_public_id: string;
}

interface VoucherLine {
  mappingKey: string;
  debitMinor: number;
  creditMinor: number;
  memoCode: string;
}

interface ResolvedVoucherLine extends VoucherLine {
  accountPublicId: string;
}

interface VoucherPreparation {
  postingKind: 'voucher';
  voucherType: 'journal' | 'receipt' | 'payment' | 'credit';
  currencyCode: string;
  lines: VoucherLine[];
}

interface SkipPreparation {
  postingKind: 'skip';
  skipCode: string;
}

interface CustodyPreparation {
  postingKind: 'cash_custody';
  custodyPublicId: string;
  custodyType: 'counter_session' | 'user' | 'safe' | 'bank_transit' | 'other';
  movementType: 'collection' | 'refund' | 'expense' | 'payroll' | 'practitioner_payout' | 'handover' | 'adjustment' | 'shadow';
  direction: 'in' | 'out' | 'neutral';
  amountMinor: number;
  legacyCounterId: number | null;
  legacyCounterSessionId: number | null;
}

type Preparation = VoucherPreparation | SkipPreparation | CustodyPreparation;

interface BalanceRow {
  balance_minor: number;
  version: number;
}

interface OriginalVoucherRow {
  voucher_public_id: string;
  currency_code: string;
  debit_total_minor: number;
  credit_total_minor: number;
  entry_count: number;
}

interface OriginalEntryRow {
  account_public_id: string;
  debit_minor: number;
  credit_minor: number;
  memo_code: string;
  line_no: number;
}

class AccountingPostingError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = 'AccountingPostingError';
  }
}

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const DEFAULT_MAX_ATTEMPTS = 3;
const SUPPORTED_EVENT_TYPES = [
  'canonical.invoice.issued',
  'canonical.invoice.cancelled',
  'canonical.payment.receipt.posted',
  'canonical.deposit.recorded',
  'canonical.deposit.applied',
  'canonical.deposit.refunded',
  'canonical.credit_note.posted',
  'canonical.payment.reversed',
  'canonical.compensation.settled',
  'canonical.accounting.expense.paid',
  'canonical.accounting.payroll.paid',
  'canonical.accounting.inventory_receipt.posted',
  'canonical.accounting.manual.posted',
  'canonical.cash_custody.collection_recorded',
  'canonical.cash_custody.refund_recorded',
  'canonical.cash_custody.shadow_recorded',
] as const;

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function utc(value: string, label: string): string {
  exact(value, label);
  if (toUtcIso(value) !== value) throw new RangeError(`${label} must be a normalized UTC timestamp`);
  return value;
}

function date(value: string, label: string): string {
  exact(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must use YYYY-MM-DD`);
  return value;
}

function currency(value: unknown): string {
  const parsed = exact(String(value ?? ''), 'currencyCode');
  if (!/^[A-Z]{3}$/.test(parsed)) throw new AccountingPostingError('ACCOUNTING_CURRENCY_INVALID', false, 'Accounting currency must use three uppercase letters');
  return parsed;
}

function positiveMinor(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_SAFE) {
    throw new AccountingPostingError('ACCOUNTING_AMOUNT_INVALID', false, `${label} must be a positive safe integer`);
  }
  return parsed;
}

function nonNegativeMinor(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_SAFE) {
    throw new AccountingPostingError('ACCOUNTING_AMOUNT_INVALID', false, `${label} must be a non-negative safe integer`);
  }
  return parsed;
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1000) throw new RangeError(`${label} must be a positive safe integer at most 1000`);
  return value;
}

function payload(row: OutboxRow): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion === 1 && record.command && Object.prototype.hasOwnProperty.call(record, 'event')) {
      const envelope = parseCanonicalCommandEnvelope<unknown>(row.payload_json);
      if (!envelope.event || typeof envelope.event !== 'object' || Array.isArray(envelope.event)) {
        throw new Error('command event is not an object');
      }
      return envelope.event as Record<string, unknown>;
    }
    return record;
  } catch (error) {
    throw new AccountingPostingError('ACCOUNTING_PAYLOAD_INVALID', false, 'Canonical accounting event payload is not a valid object');
  }
}

function paymentMapping(method: string): 'cash_on_hand' | 'bank_and_wallet' {
  return method === 'cash' ? 'cash_on_hand' : 'bank_and_wallet';
}

function postingKindForEvent(eventType: string): 'voucher' | 'cash_custody' | 'skip' {
  if (eventType.startsWith('canonical.cash_custody.')) return 'cash_custody';
  if (eventType === 'canonical.deposit.recorded') return 'skip';
  return 'voucher';
}

function sourceShape(row: OutboxRow, parsedPayload: Record<string, unknown>): Record<string, unknown> {
  return {
    aggregatePublicId: row.aggregate_public_id,
    aggregateType: row.aggregate_type,
    businessDate: row.business_date,
    eventPublicId: row.event_public_id,
    eventType: row.event_type,
    eventVersion: row.event_version,
    occurredAtUtc: row.occurred_at_utc,
    payload: parsedPayload,
  };
}

async function loadOutbox(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  eventPublicId: string,
): Promise<OutboxRow> {
  const row = await db.prepare(`
    SELECT event_public_id,aggregate_type,aggregate_public_id,event_type,event_version,
           payload_json,occurred_at_utc,business_date,status
    FROM canonical_outbox_events
    WHERE tenant_id=? AND event_public_id=?
    LIMIT 1
  `).bind(tenantId, eventPublicId).first<OutboxRow>();
  if (!row) throw new Error('Canonical accounting outbox event not found for tenant');
  if (!row.business_date) throw new AccountingPostingError('ACCOUNTING_BUSINESS_DATE_MISSING', false, 'Accounting event business date is required');
  utc(row.occurred_at_utc, 'outbox occurredAtUtc');
  date(row.business_date, 'outbox businessDate');
  return row;
}

async function loadJob(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  eventPublicId: string,
): Promise<JobRow | null> {
  return db.prepare(`
    SELECT posting_job_public_id,source_event_type,source_fingerprint,posting_kind,status,
           attempts,max_attempts,voucher_public_id,custody_movement_public_id,
           skip_code,last_error_code
    FROM canonical_accounting_posting_jobs
    WHERE tenant_id=? AND outbox_event_public_id=?
    LIMIT 1
  `).bind(tenantId, eventPublicId).first<JobRow>();
}

async function recordSourceDriftIssue(
  db: CanonicalAccountingDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    eventType: string;
    storedFingerprint: string;
    currentFingerprint: string;
    nowUtc: string;
  },
): Promise<void> {
  const fingerprint = await createRequestFingerprint({
    code: 'ACCOUNTING_SOURCE_DRIFT',
    eventPublicId: input.eventPublicId,
    storedFingerprint: input.storedFingerprint,
    currentFingerprint: input.currentFingerprint,
  });
  const issuePublicId = await createDeterministicSourceId(
    'acctissue',
    input.tenantId,
    'accounting_source_drift',
    input.eventPublicId,
  );
  await db.prepare(`
    INSERT OR IGNORE INTO canonical_processing_issues (
      tenant_id,issue_public_id,issue_type,issue_code,entity_type,entity_public_id,
      source_type,source_public_id,fingerprint,severity,status,summary,details_json,
      first_seen_at_utc,last_seen_at_utc
    ) VALUES (?,?,'accounting_posting','ACCOUNTING_SOURCE_DRIFT','outbox_event',
      ?,?,?,?,'critical','open','Canonical accounting source evidence changed after posting.',?,?,?)
  `).bind(
    input.tenantId,
    issuePublicId,
    input.eventPublicId,
    input.eventType,
    input.eventPublicId,
    fingerprint,
    JSON.stringify({
      currentFingerprint: input.currentFingerprint,
      storedFingerprint: input.storedFingerprint,
    }),
    input.nowUtc,
    input.nowUtc,
  ).run();
}

async function ensureJob(
  db: CanonicalAccountingDatabase,
  input: {
    tenantId: string;
    row: OutboxRow;
    fingerprint: string;
    maxAttempts: number;
    nowUtc: string;
  },
): Promise<JobRow> {
  const existing = await loadJob(db, input.tenantId, input.row.event_public_id);
  if (existing) {
    if (existing.source_fingerprint !== input.fingerprint || existing.source_event_type !== input.row.event_type) {
      await recordSourceDriftIssue(db, {
        tenantId: input.tenantId,
        eventPublicId: input.row.event_public_id,
        eventType: input.row.event_type,
        storedFingerprint: existing.source_fingerprint,
        currentFingerprint: input.fingerprint,
        nowUtc: input.nowUtc,
      });
      throw new CanonicalIdempotencyConflictError(input.tenantId, input.row.event_public_id);
    }
    return existing;
  }
  const postingJobPublicId = await createDeterministicSourceId(
    'acctjob',
    input.tenantId,
    input.row.event_type,
    input.row.event_public_id,
  );
  await db.prepare(`
    INSERT INTO canonical_accounting_posting_jobs (
      tenant_id,posting_job_public_id,outbox_event_public_id,source_event_type,
      source_fingerprint,posting_kind,status,attempts,max_attempts,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,'pending',0,?,?,?)
  `).bind(
    input.tenantId,
    postingJobPublicId,
    input.row.event_public_id,
    input.row.event_type,
    input.fingerprint,
    postingKindForEvent(input.row.event_type),
    input.maxAttempts,
    input.nowUtc,
    input.nowUtc,
  ).run();
  const created = await loadJob(db, input.tenantId, input.row.event_public_id);
  if (!created) throw new Error('Canonical accounting posting job was not created');
  return created;
}

async function assertPeriodOpen(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  businessDate: string,
): Promise<PeriodRow> {
  const period = await db.prepare(`
    SELECT period_public_id,status
    FROM canonical_accounting_periods
    WHERE tenant_id=? AND start_date<=? AND end_date>=?
    ORDER BY start_date DESC,id DESC
    LIMIT 1
  `).bind(tenantId, businessDate, businessDate).first<PeriodRow>();
  if (!period) throw new AccountingPostingError('ACCOUNTING_PERIOD_MISSING', true, 'Canonical accounting period is not configured');
  if (!['open', 'reopened'].includes(period.status)) {
    throw new AccountingPostingError('ACCOUNTING_PERIOD_CLOSED', true, 'Canonical accounting period is closed');
  }
  return period;
}

async function resolveLines(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  lines: VoucherLine[],
): Promise<ResolvedVoucherLine[]> {
  const activeLines = lines.filter((line) => line.debitMinor > 0 || line.creditMinor > 0);
  if (activeLines.length < 2) throw new AccountingPostingError('ACCOUNTING_LINES_INVALID', false, 'Accounting voucher requires at least two non-zero lines');
  const resolved: ResolvedVoucherLine[] = [];
  for (const line of activeLines) {
    nonNegativeMinor(line.debitMinor, 'debitMinor');
    nonNegativeMinor(line.creditMinor, 'creditMinor');
    if ((line.debitMinor > 0) === (line.creditMinor > 0)) {
      throw new AccountingPostingError('ACCOUNTING_LINES_INVALID', false, 'Every accounting line must contain exactly one debit or credit amount');
    }
    const mapping = await db.prepare(`
      SELECT m.account_public_id
      FROM canonical_accounting_mappings m
      JOIN canonical_accounting_accounts a
        ON a.tenant_id=m.tenant_id AND a.account_public_id=m.account_public_id
      WHERE m.tenant_id=? AND m.mapping_key=? AND m.status='active' AND a.status='active'
      LIMIT 1
    `).bind(tenantId, line.mappingKey).first<MappingRow>();
    if (!mapping) {
      throw new AccountingPostingError('ACCOUNT_MAPPING_MISSING', true, `Canonical accounting mapping is missing: ${line.mappingKey}`);
    }
    resolved.push({ ...line, accountPublicId: mapping.account_public_id });
  }
  const debitTotal = resolved.reduce((sum, line) => sum + line.debitMinor, 0);
  const creditTotal = resolved.reduce((sum, line) => sum + line.creditMinor, 0);
  if (!Number.isSafeInteger(debitTotal) || !Number.isSafeInteger(creditTotal) || debitTotal <= 0 || debitTotal !== creditTotal) {
    throw new AccountingPostingError('ACCOUNTING_UNBALANCED', false, 'Canonical accounting voucher debit and credit totals must match exactly');
  }
  return resolved;
}

async function prepareInvoice(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  invoicePublicId: string,
): Promise<VoucherPreparation> {
  const row = await db.prepare(`
    SELECT total_minor,currency_code,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{ total_minor: number; currency_code: string; status: string }>();
  if (!row || row.status !== 'posted') throw new AccountingPostingError('ACCOUNTING_SOURCE_INVALID', false, 'Posted canonical invoice not found');
  const amount = positiveMinor(row.total_minor, 'invoice totalMinor');
  return {
    postingKind: 'voucher',
    voucherType: 'journal',
    currencyCode: currency(row.currency_code),
    lines: [
      { mappingKey: 'accounts_receivable', debitMinor: amount, creditMinor: 0, memoCode: 'invoice_receivable' },
      { mappingKey: 'patient_revenue', debitMinor: 0, creditMinor: amount, memoCode: 'invoice_revenue' },
    ],
  };
}

async function prepareInvoiceCancellation(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  invoicePublicId: string,
): Promise<VoucherPreparation> {
  const row = await db.prepare(`
    SELECT total_minor,currency_code,status,cancelled_at_utc,paid_minor,credited_minor
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=?
    LIMIT 1
  `).bind(tenantId, invoicePublicId).first<{
    total_minor: number;
    currency_code: string;
    status: string;
    cancelled_at_utc: string | null;
    paid_minor: number;
    credited_minor: number;
  }>();
  if (
    !row
    || row.status !== 'cancelled'
    || !row.cancelled_at_utc
    || Number(row.paid_minor) !== 0
    || Number(row.credited_minor) !== 0
  ) {
    throw new AccountingPostingError(
      'ACCOUNTING_SOURCE_INVALID',
      false,
      'Cancelled unpaid canonical invoice not found',
    );
  }
  const amount = positiveMinor(row.total_minor, 'invoice cancellation totalMinor');
  return {
    postingKind: 'voucher',
    voucherType: 'journal',
    currencyCode: currency(row.currency_code),
    lines: [
      { mappingKey: 'patient_revenue', debitMinor: amount, creditMinor: 0, memoCode: 'invoice_cancellation_revenue' },
      { mappingKey: 'accounts_receivable', debitMinor: 0, creditMinor: amount, memoCode: 'invoice_cancellation_receivable' },
    ],
  };
}

async function preparePayment(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  receiptPublicId: string,
): Promise<VoucherPreparation> {
  const receipt = await db.prepare(`
    SELECT total_minor,allocated_total_minor,unallocated_minor,currency_code,status,posted_at_utc
    FROM canonical_payment_receipts
    WHERE tenant_id=? AND receipt_public_id=?
    LIMIT 1
  `).bind(tenantId, receiptPublicId).first<{
    total_minor: number;
    allocated_total_minor: number;
    unallocated_minor: number;
    currency_code: string;
    status: string;
    posted_at_utc: string | null;
  }>();
  if (!receipt || !receipt.posted_at_utc || !['posted', 'reversed'].includes(receipt.status)) {
    throw new AccountingPostingError('ACCOUNTING_SOURCE_INVALID', false, 'Posted canonical payment receipt not found');
  }
  const tenders = (await db.prepare(`
    SELECT tender_type,amount_minor,captured_at_utc
    FROM canonical_payment_tenders
    WHERE tenant_id=? AND receipt_public_id=? AND captured_at_utc IS NOT NULL
    ORDER BY id
  `).bind(tenantId, receiptPublicId).all<{ tender_type: string; amount_minor: number; captured_at_utc: string }>()).results;
  let cashMinor = 0;
  let bankMinor = 0;
  for (const tender of tenders) {
    const amount = positiveMinor(tender.amount_minor, 'tender amountMinor');
    if (tender.tender_type === 'cash') cashMinor += amount;
    else bankMinor += amount;
  }
  const total = positiveMinor(receipt.total_minor, 'receipt totalMinor');
  const allocated = nonNegativeMinor(receipt.allocated_total_minor, 'receipt allocatedTotalMinor');
  const unallocated = nonNegativeMinor(receipt.unallocated_minor, 'receipt unallocatedMinor');
  if (cashMinor + bankMinor !== total || allocated + unallocated !== total) {
    throw new AccountingPostingError('ACCOUNTING_SOURCE_RECONCILIATION_FAILED', false, 'Canonical payment receipt totals do not reconcile');
  }
  return {
    postingKind: 'voucher',
    voucherType: 'receipt',
    currencyCode: currency(receipt.currency_code),
    lines: [
      { mappingKey: 'cash_on_hand', debitMinor: cashMinor, creditMinor: 0, memoCode: 'payment_cash' },
      { mappingKey: 'bank_and_wallet', debitMinor: bankMinor, creditMinor: 0, memoCode: 'payment_non_cash' },
      { mappingKey: 'accounts_receivable', debitMinor: 0, creditMinor: allocated, memoCode: 'payment_receivable' },
      { mappingKey: 'patient_deposit_liability', debitMinor: 0, creditMinor: unallocated, memoCode: 'payment_unallocated_liability' },
    ],
  };
}

async function prepareDepositApplication(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  applicationPublicId: string,
): Promise<VoucherPreparation> {
  const row = await db.prepare(`
    SELECT a.amount_minor,a.status,d.currency_code
    FROM canonical_deposit_applications a
    JOIN canonical_deposits d
      ON d.tenant_id=a.tenant_id AND d.deposit_public_id=a.deposit_public_id
    WHERE a.tenant_id=? AND a.application_public_id=?
    LIMIT 1
  `).bind(tenantId, applicationPublicId).first<{ amount_minor: number; status: string; currency_code: string }>();
  if (!row || row.status !== 'active') throw new AccountingPostingError('ACCOUNTING_SOURCE_INVALID', false, 'Active canonical deposit application not found');
  const amount = positiveMinor(row.amount_minor, 'deposit application amountMinor');
  return {
    postingKind: 'voucher',
    voucherType: 'journal',
    currencyCode: currency(row.currency_code),
    lines: [
      { mappingKey: 'patient_deposit_liability', debitMinor: amount, creditMinor: 0, memoCode: 'deposit_application_liability' },
      { mappingKey: 'accounts_receivable', debitMinor: 0, creditMinor: amount, memoCode: 'deposit_application_receivable' },
    ],
  };
}

async function prepareDepositRefund(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  refundPublicId: string,
): Promise<VoucherPreparation> {
  const row = await db.prepare(`
    SELECT r.amount_minor,r.tender_type,r.status,d.currency_code
    FROM canonical_refunds r
    JOIN canonical_deposits d
      ON d.tenant_id=r.tenant_id AND d.deposit_public_id=r.deposit_public_id
    WHERE r.tenant_id=? AND r.refund_public_id=? AND r.source_type='deposit'
    LIMIT 1
  `).bind(tenantId, refundPublicId).first<{ amount_minor: number; tender_type: string; status: string; currency_code: string }>();
  if (!row || row.status !== 'posted') throw new AccountingPostingError('ACCOUNTING_SOURCE_INVALID', false, 'Posted canonical deposit refund not found');
  const amount = positiveMinor(row.amount_minor, 'deposit refund amountMinor');
  return {
    postingKind: 'voucher',
    voucherType: 'payment',
    currencyCode: currency(row.currency_code),
    lines: [
      { mappingKey: 'patient_deposit_liability', debitMinor: amount, creditMinor: 0, memoCode: 'deposit_refund_liability' },
      { mappingKey: paymentMapping(row.tender_type), debitMinor: 0, creditMinor: amount, memoCode: 'deposit_refund_settlement' },
    ],
  };
}

async function prepareCreditNote(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  creditNotePublicId: string,
): Promise<VoucherPreparation> {
  const row = await db.prepare(`
    SELECT c.total_minor,c.status,c.currency_code
    FROM canonical_credit_notes c
    WHERE c.tenant_id=? AND c.credit_note_public_id=?
    LIMIT 1
  `).bind(tenantId, creditNotePublicId).first<{ total_minor: number; status: string; currency_code: string }>();
  if (!row || row.status !== 'posted') throw new AccountingPostingError('ACCOUNTING_SOURCE_INVALID', false, 'Posted canonical credit note not found');
  const amount = positiveMinor(row.total_minor, 'credit note totalMinor');
  return {
    postingKind: 'voucher',
    voucherType: 'credit',
    currencyCode: currency(row.currency_code),
    lines: [
      { mappingKey: 'sales_returns', debitMinor: amount, creditMinor: 0, memoCode: 'credit_note_returns' },
      { mappingKey: 'accounts_receivable', debitMinor: 0, creditMinor: amount, memoCode: 'credit_note_receivable' },
    ],
  };
}

async function prepareCreditNoteCashRefund(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  refundPublicId: string,
): Promise<VoucherPreparation> {
  const row = await db.prepare(`
    SELECT r.amount_minor,r.status,i.currency_code
    FROM canonical_credit_note_cash_refunds r
    JOIN canonical_invoices i
      ON i.tenant_id=r.tenant_id AND i.invoice_public_id=r.invoice_public_id
    WHERE r.tenant_id=? AND r.refund_public_id=?
    LIMIT 1
  `).bind(tenantId, refundPublicId).first<{
    amount_minor: number;
    status: string;
    currency_code: string;
  }>();
  if (!row || row.status !== 'posted') {
    throw new AccountingPostingError(
      'ACCOUNTING_SOURCE_INVALID',
      false,
      'Posted canonical credit-note cash refund not found',
    );
  }
  const amount = positiveMinor(row.amount_minor, 'credit-note cash refund amountMinor');
  return {
    postingKind: 'voucher',
    voucherType: 'payment',
    currencyCode: currency(row.currency_code),
    lines: [
      { mappingKey: 'accounts_receivable', debitMinor: amount, creditMinor: 0, memoCode: 'credit_note_cash_refund_receivable' },
      { mappingKey: 'cash_on_hand', debitMinor: 0, creditMinor: amount, memoCode: 'credit_note_cash_refund_cash' },
    ],
  };
}

async function preparePaymentReversal(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  reversalPublicId: string,
): Promise<VoucherPreparation> {
  const row = await db.prepare(`
    SELECT r.amount_minor,r.status,i.currency_code,t.tender_type
    FROM canonical_payment_reversals r
    JOIN canonical_invoices i
      ON i.tenant_id=r.tenant_id AND i.invoice_public_id=r.invoice_public_id
    JOIN canonical_payment_tenders t
      ON t.tenant_id=r.tenant_id AND t.tender_public_id=r.tender_public_id
    WHERE r.tenant_id=? AND r.reversal_public_id=?
    LIMIT 1
  `).bind(tenantId, reversalPublicId).first<{ amount_minor: number; status: string; currency_code: string; tender_type: string }>();
  if (!row || row.status !== 'posted') throw new AccountingPostingError('ACCOUNTING_SOURCE_INVALID', false, 'Posted canonical payment reversal not found');
  const amount = positiveMinor(row.amount_minor, 'payment reversal amountMinor');
  return {
    postingKind: 'voucher',
    voucherType: 'payment',
    currencyCode: currency(row.currency_code),
    lines: [
      { mappingKey: 'accounts_receivable', debitMinor: amount, creditMinor: 0, memoCode: 'payment_reversal_receivable' },
      { mappingKey: paymentMapping(row.tender_type), debitMinor: 0, creditMinor: amount, memoCode: 'payment_reversal_settlement' },
    ],
  };
}

async function prepareCompensationSettlement(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  settlementPublicId: string,
): Promise<VoucherPreparation> {
  const row = await db.prepare(`
    SELECT total_minor,currency_code,payment_method,status
    FROM canonical_compensation_settlements
    WHERE tenant_id=? AND settlement_public_id=?
    LIMIT 1
  `).bind(tenantId, settlementPublicId).first<{
    total_minor: number;
    currency_code: string;
    payment_method: string;
    status: string;
  }>();
  if (!row || !['posted', 'partially_reversed', 'reversed'].includes(row.status)) {
    throw new AccountingPostingError('ACCOUNTING_SOURCE_INVALID', false, 'Posted canonical practitioner settlement not found');
  }
  const amount = positiveMinor(row.total_minor, 'practitioner settlement totalMinor');
  return {
    postingKind: 'voucher',
    voucherType: 'payment',
    currencyCode: currency(row.currency_code),
    lines: [
      { mappingKey: 'practitioner_payable', debitMinor: amount, creditMinor: 0, memoCode: 'practitioner_settlement_payable' },
      { mappingKey: paymentMapping(row.payment_method), debitMinor: 0, creditMinor: amount, memoCode: 'practitioner_settlement_payment' },
    ],
  };
}

function prepareExpense(parsed: Record<string, unknown>): VoucherPreparation {
  const amount = positiveMinor(parsed.amountMinor, 'expense amountMinor');
  const method = exact(String(parsed.paymentMethod ?? ''), 'paymentMethod');
  const expenseMappingKey = exact(String(parsed.expenseMappingKey ?? 'expense_default'), 'expenseMappingKey');
  return {
    postingKind: 'voucher',
    voucherType: 'payment',
    currencyCode: currency(parsed.currencyCode),
    lines: [
      { mappingKey: expenseMappingKey, debitMinor: amount, creditMinor: 0, memoCode: 'expense_paid' },
      { mappingKey: paymentMapping(method), debitMinor: 0, creditMinor: amount, memoCode: 'expense_settlement' },
    ],
  };
}

function preparePayroll(parsed: Record<string, unknown>): VoucherPreparation {
  const amount = positiveMinor(parsed.amountMinor, 'payroll amountMinor');
  const method = exact(String(parsed.paymentMethod ?? ''), 'paymentMethod');
  return {
    postingKind: 'voucher',
    voucherType: 'payment',
    currencyCode: currency(parsed.currencyCode),
    lines: [
      { mappingKey: 'payroll_payable', debitMinor: amount, creditMinor: 0, memoCode: 'payroll_payable_settlement' },
      { mappingKey: paymentMapping(method), debitMinor: 0, creditMinor: amount, memoCode: 'payroll_payment' },
    ],
  };
}

function prepareInventoryReceipt(parsed: Record<string, unknown>): VoucherPreparation {
  const amount = positiveMinor(parsed.amountMinor, 'inventory receipt amountMinor');
  const settlementMode = exact(String(parsed.settlementMode ?? ''), 'settlementMode');
  const creditMapping = settlementMode === 'credit'
    ? 'accounts_payable'
    : paymentMapping(settlementMode);
  return {
    postingKind: 'voucher',
    voucherType: settlementMode === 'credit' ? 'journal' : 'payment',
    currencyCode: currency(parsed.currencyCode),
    lines: [
      { mappingKey: 'inventory_asset', debitMinor: amount, creditMinor: 0, memoCode: 'inventory_receipt_asset' },
      { mappingKey: creditMapping, debitMinor: 0, creditMinor: amount, memoCode: 'inventory_receipt_settlement' },
    ],
  };
}

function prepareManual(parsed: Record<string, unknown>): VoucherPreparation {
  if (!Array.isArray(parsed.lines)) throw new AccountingPostingError('ACCOUNTING_LINES_INVALID', false, 'Manual accounting event requires lines');
  const lines = parsed.lines.map((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new AccountingPostingError('ACCOUNTING_LINES_INVALID', false, 'Manual accounting line is invalid');
    const line = raw as Record<string, unknown>;
    return {
      mappingKey: exact(String(line.mappingKey ?? ''), `lines[${index}].mappingKey`),
      debitMinor: nonNegativeMinor(line.debitMinor ?? 0, `lines[${index}].debitMinor`),
      creditMinor: nonNegativeMinor(line.creditMinor ?? 0, `lines[${index}].creditMinor`),
      memoCode: exact(String(line.memoCode ?? `manual_line_${index + 1}`), `lines[${index}].memoCode`),
    };
  });
  return {
    postingKind: 'voucher',
    voucherType: 'journal',
    currencyCode: currency(parsed.currencyCode),
    lines,
  };
}

function prepareCustody(row: OutboxRow, parsed: Record<string, unknown>): CustodyPreparation {
  const sessionRaw = parsed.counterSessionId;
  const counterRaw = parsed.counterId;
  const sessionId = sessionRaw == null ? null : Number(sessionRaw);
  const counterId = counterRaw == null ? null : Number(counterRaw);
  if (sessionId != null && (!Number.isSafeInteger(sessionId) || sessionId <= 0)) {
    throw new AccountingPostingError('CASH_CUSTODY_ID_INVALID', false, 'Cash custody counter session must be a positive integer');
  }
  if (counterId != null && (!Number.isSafeInteger(counterId) || counterId <= 0)) {
    throw new AccountingPostingError('CASH_CUSTODY_ID_INVALID', false, 'Cash custody counter must be a positive integer');
  }
  const payloadCustodyPublicId = parsed.custodyPublicId == null
    ? null
    : exact(String(parsed.custodyPublicId), 'custodyPublicId');
  const payloadCustodyType = parsed.custodyType == null
    ? null
    : String(parsed.custodyType);
  if (payloadCustodyType != null && ![
    'counter_session', 'user', 'safe', 'bank_transit', 'other',
  ].includes(payloadCustodyType)) {
    throw new AccountingPostingError('CASH_CUSTODY_TYPE_INVALID', false, 'Cash custody type is invalid');
  }
  const custodyPublicId = payloadCustodyPublicId
    ?? (sessionId != null
      ? `counter-session:${sessionId}`
      : counterId != null
        ? `counter:${counterId}`
        : `aggregate:${row.aggregate_public_id}`);
  const custodyType = (payloadCustodyType
    ?? (sessionId != null ? 'counter_session' : 'other')) as CustodyPreparation['custodyType'];
  if (row.event_type === 'canonical.cash_custody.collection_recorded') {
    return {
      postingKind: 'cash_custody',
      custodyPublicId,
      custodyType,
      movementType: 'collection',
      direction: 'in',
      amountMinor: positiveMinor(parsed.cashAmountMinor, 'cashAmountMinor'),
      legacyCounterId: counterId,
      legacyCounterSessionId: sessionId,
    };
  }
  if (row.event_type === 'canonical.cash_custody.refund_recorded') {
    return {
      postingKind: 'cash_custody',
      custodyPublicId,
      custodyType,
      movementType: 'refund',
      direction: 'out',
      amountMinor: positiveMinor(parsed.amountMinor, 'amountMinor'),
      legacyCounterId: counterId,
      legacyCounterSessionId: sessionId,
    };
  }
  const direction = String(parsed.direction ?? 'neutral');
  if (!['in', 'out', 'neutral'].includes(direction)) throw new AccountingPostingError('CASH_CUSTODY_DIRECTION_INVALID', false, 'Cash custody direction is invalid');
  const movementType = String(parsed.movementType ?? 'shadow');
  if (![
    'collection', 'refund', 'expense', 'payroll', 'practitioner_payout',
    'handover', 'adjustment', 'shadow',
  ].includes(movementType)) {
    throw new AccountingPostingError('CASH_CUSTODY_MOVEMENT_TYPE_INVALID', false, 'Cash custody movement type is invalid');
  }
  return {
    postingKind: 'cash_custody',
    custodyPublicId,
    custodyType,
    movementType: movementType as CustodyPreparation['movementType'],
    direction: direction as 'in' | 'out' | 'neutral',
    amountMinor: positiveMinor(parsed.amountMinor, 'amountMinor'),
    legacyCounterId: counterId,
    legacyCounterSessionId: sessionId,
  };
}

async function prepare(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  row: OutboxRow,
  parsed: Record<string, unknown>,
): Promise<Preparation> {
  if (row.event_type === 'canonical.deposit.recorded') {
    return { postingKind: 'skip', skipCode: 'DERIVED_DEPOSIT_RECEIPT' };
  }
  if (row.event_type === 'canonical.cash_custody.session_closed') {
    return { postingKind: 'skip', skipCode: 'CASH_CUSTODY_SESSION_CLOSED' };
  }
  if (row.event_type.startsWith('canonical.cash_custody.')) return prepareCustody(row, parsed);
  if (row.event_type === 'canonical.invoice.issued') return prepareInvoice(db, tenantId, row.aggregate_public_id);
  if (row.event_type === 'canonical.invoice.cancelled') return prepareInvoiceCancellation(db, tenantId, row.aggregate_public_id);
  if (row.event_type === 'canonical.payment.receipt.posted') return preparePayment(db, tenantId, row.aggregate_public_id);
  if (row.event_type === 'canonical.deposit.applied') {
    return prepareDepositApplication(db, tenantId, exact(String(parsed.applicationPublicId ?? ''), 'applicationPublicId'));
  }
  if (row.event_type === 'canonical.deposit.refunded') return prepareDepositRefund(db, tenantId, row.aggregate_public_id);
  if (row.event_type === 'canonical.credit_note.posted') return prepareCreditNote(db, tenantId, row.aggregate_public_id);
  if (row.event_type === 'canonical.credit_note.cash_refunded') {
    return prepareCreditNoteCashRefund(db, tenantId, row.aggregate_public_id);
  }
  if (row.event_type === 'canonical.payment.reversed') {
    return preparePaymentReversal(db, tenantId, exact(String(parsed.reversalPublicId ?? ''), 'reversalPublicId'));
  }
  if (row.event_type === 'canonical.compensation.settled') return prepareCompensationSettlement(db, tenantId, row.aggregate_public_id);
  if (row.event_type === 'canonical.accounting.expense.paid') return prepareExpense(parsed);
  if (row.event_type === 'canonical.accounting.payroll.paid') return preparePayroll(parsed);
  if (row.event_type === 'canonical.accounting.inventory_receipt.posted') return prepareInventoryReceipt(parsed);
  if (row.event_type === 'canonical.accounting.manual.posted') return prepareManual(parsed);
  throw new AccountingPostingError('ACCOUNTING_EVENT_UNSUPPORTED', false, `Unsupported canonical accounting event: ${row.event_type}`);
}

function claimJobStatement(
  db: CanonicalAccountingDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    fingerprint: string;
    attemptsBefore: number;
    attemptsAfter: number;
    maxAttempts: number;
    nowUtc: string;
  },
): CanonicalAccountingPreparedStatement {
  return db.prepare(`
    UPDATE canonical_accounting_posting_jobs
    SET status='processing',attempts=?,max_attempts=?,
        first_attempt_at_utc=COALESCE(first_attempt_at_utc,?),
        last_attempt_at_utc=?,last_error_code=NULL,last_error_summary=NULL,
        next_attempt_at_utc=NULL,updated_at_utc=?
    WHERE tenant_id=? AND outbox_event_public_id=? AND source_fingerprint=?
      AND status IN ('pending','retry') AND attempts=?
  `).bind(
    input.attemptsAfter,
    input.maxAttempts,
    input.nowUtc,
    input.nowUtc,
    input.nowUtc,
    input.tenantId,
    input.eventPublicId,
    input.fingerprint,
    input.attemptsBefore,
  );
}

async function postVoucher(
  db: CanonicalAccountingDatabase,
  input: {
    tenantId: string;
    row: OutboxRow;
    job: JobRow;
    fingerprint: string;
    maxAttempts: number;
    nowUtc: string;
    preparation: VoucherPreparation;
  },
): Promise<CanonicalAccountingPostResult> {
  await assertPeriodOpen(db, input.tenantId, input.row.business_date!);
  const lines = await resolveLines(db, input.tenantId, input.preparation.lines);
  const debitTotal = lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const creditTotal = lines.reduce((sum, line) => sum + line.creditMinor, 0);
  const voucherPublicId = await createDeterministicSourceId(
    'acctvchr',
    input.tenantId,
    input.row.event_type,
    input.row.event_public_id,
  );
  const voucherNumber = `CAV-${voucherPublicId.slice(-16)}`;
  const attemptsAfter = input.job.attempts + 1;
  const statements: CanonicalAccountingPreparedStatement[] = [
    claimJobStatement(db, {
      tenantId: input.tenantId,
      eventPublicId: input.row.event_public_id,
      fingerprint: input.fingerprint,
      attemptsBefore: input.job.attempts,
      attemptsAfter,
      maxAttempts: input.maxAttempts,
      nowUtc: input.nowUtc,
    }),
    db.prepare(`
      INSERT INTO canonical_accounting_vouchers (
        tenant_id,voucher_public_id,voucher_number,voucher_type,outbox_event_public_id,
        source_event_type,source_aggregate_type,source_aggregate_public_id,currency_code,
        business_date,occurred_at_utc,status,debit_total_minor,credit_total_minor,
        entry_count,posting_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,'posted',?,?,?,
        CASE WHEN EXISTS(
          SELECT 1 FROM canonical_accounting_posting_jobs
          WHERE tenant_id=? AND outbox_event_public_id=? AND source_fingerprint=?
            AND status='processing' AND attempts=?
        ) THEN 1 ELSE 0 END,?)
    `).bind(
      input.tenantId,
      voucherPublicId,
      voucherNumber,
      input.preparation.voucherType,
      input.row.event_public_id,
      input.row.event_type,
      input.row.aggregate_type,
      input.row.aggregate_public_id,
      input.preparation.currencyCode,
      input.row.business_date,
      input.row.occurred_at_utc,
      debitTotal,
      creditTotal,
      lines.length,
      input.tenantId,
      input.row.event_public_id,
      input.fingerprint,
      attemptsAfter,
      input.fingerprint,
    ),
  ];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const entryPublicId = await createDeterministicSourceId(
      'acctentry',
      input.tenantId,
      voucherPublicId,
      String(index + 1),
    );
    statements.push(db.prepare(`
      INSERT INTO canonical_accounting_entries (
        tenant_id,entry_public_id,voucher_public_id,line_no,account_public_id,
        debit_minor,credit_minor,memo_code,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      input.tenantId,
      entryPublicId,
      voucherPublicId,
      index + 1,
      line.accountPublicId,
      line.debitMinor,
      line.creditMinor,
      line.memoCode,
      input.fingerprint,
    ));
  }
  statements.push(db.prepare(`
    UPDATE canonical_accounting_posting_jobs
    SET status='posted',voucher_public_id=?,posted_at_utc=?,updated_at_utc=?
    WHERE tenant_id=? AND outbox_event_public_id=? AND source_fingerprint=?
      AND status='processing' AND attempts=?
  `).bind(
    voucherPublicId,
    input.nowUtc,
    input.nowUtc,
    input.tenantId,
    input.row.event_public_id,
    input.fingerprint,
    attemptsAfter,
  ));
  await db.batch(statements);
  return {
    status: 'posted',
    postingKind: 'voucher',
    voucherPublicId,
    custodyMovementPublicId: null,
    debitTotalMinor: debitTotal,
    creditTotalMinor: creditTotal,
  };
}

async function postCustody(
  db: CanonicalAccountingDatabase,
  input: {
    tenantId: string;
    row: OutboxRow;
    job: JobRow;
    fingerprint: string;
    maxAttempts: number;
    nowUtc: string;
    preparation: CustodyPreparation;
  },
): Promise<CanonicalAccountingPostResult> {
  const balance = (await db.prepare(`
    SELECT balance_minor,version
    FROM canonical_cash_custody_balances
    WHERE tenant_id=? AND custody_public_id=?
    LIMIT 1
  `).bind(input.tenantId, input.preparation.custodyPublicId).first<BalanceRow>()) ?? { balance_minor: 0, version: 0 };
  const signedAmount = input.preparation.direction === 'in'
    ? input.preparation.amountMinor
    : input.preparation.direction === 'out'
      ? -input.preparation.amountMinor
      : 0;
  const balanceAfter = balance.balance_minor + signedAmount;
  if (!Number.isSafeInteger(balanceAfter)) throw new AccountingPostingError('CASH_CUSTODY_BALANCE_INVALID', false, 'Cash custody balance exceeds safe integer range');
  const movementPublicId = await createDeterministicSourceId(
    'cashmove',
    input.tenantId,
    input.row.event_type,
    input.row.event_public_id,
  );
  const attemptsAfter = input.job.attempts + 1;
  await db.batch([
    claimJobStatement(db, {
      tenantId: input.tenantId,
      eventPublicId: input.row.event_public_id,
      fingerprint: input.fingerprint,
      attemptsBefore: input.job.attempts,
      attemptsAfter,
      maxAttempts: input.maxAttempts,
      nowUtc: input.nowUtc,
    }),
    db.prepare(`
      INSERT INTO canonical_cash_custody_balances (
        tenant_id,custody_public_id,custody_type,legacy_counter_id,
        legacy_counter_session_id,balance_minor,version,projection_guard,
        source_evidence_sha256,updated_at_utc
      ) VALUES (?,?,?,?,?,0,0,1,?,?)
      ON CONFLICT(tenant_id,custody_public_id) DO NOTHING
    `).bind(
      input.tenantId,
      input.preparation.custodyPublicId,
      input.preparation.custodyType,
      input.preparation.legacyCounterId,
      input.preparation.legacyCounterSessionId,
      input.fingerprint,
      input.nowUtc,
    ),
    db.prepare(`
      UPDATE canonical_cash_custody_balances
      SET balance_minor=?,version=?,projection_guard=1,
          source_evidence_sha256=?,updated_at_utc=?
      WHERE tenant_id=? AND custody_public_id=? AND balance_minor=? AND version=?
    `).bind(
      balanceAfter,
      balance.version + 1,
      input.fingerprint,
      input.nowUtc,
      input.tenantId,
      input.preparation.custodyPublicId,
      balance.balance_minor,
      balance.version,
    ),
    db.prepare(`
      INSERT INTO canonical_cash_custody_movements (
        tenant_id,custody_movement_public_id,outbox_event_public_id,custody_public_id,
        movement_type,direction,amount_minor,signed_amount_minor,balance_before_minor,
        balance_after_minor,legacy_counter_id,legacy_counter_session_id,occurred_at_utc,
        business_date,balance_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,
        CASE WHEN EXISTS(
          SELECT 1 FROM canonical_cash_custody_balances
          WHERE tenant_id=? AND custody_public_id=? AND balance_minor=? AND version=?
        ) THEN 1 ELSE 0 END,?)
    `).bind(
      input.tenantId,
      movementPublicId,
      input.row.event_public_id,
      input.preparation.custodyPublicId,
      input.preparation.movementType,
      input.preparation.direction,
      input.preparation.amountMinor,
      signedAmount,
      balance.balance_minor,
      balanceAfter,
      input.preparation.legacyCounterId,
      input.preparation.legacyCounterSessionId,
      input.row.occurred_at_utc,
      input.row.business_date,
      input.tenantId,
      input.preparation.custodyPublicId,
      balanceAfter,
      balance.version + 1,
      input.fingerprint,
    ),
    db.prepare(`
      UPDATE canonical_accounting_posting_jobs
      SET status='posted',custody_movement_public_id=?,posted_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND outbox_event_public_id=? AND source_fingerprint=?
        AND status='processing' AND attempts=?
    `).bind(
      movementPublicId,
      input.nowUtc,
      input.nowUtc,
      input.tenantId,
      input.row.event_public_id,
      input.fingerprint,
      attemptsAfter,
    ),
  ]);
  return {
    status: 'posted',
    postingKind: 'cash_custody',
    voucherPublicId: null,
    custodyMovementPublicId: movementPublicId,
    debitTotalMinor: 0,
    creditTotalMinor: 0,
  };
}

async function postSkip(
  db: CanonicalAccountingDatabase,
  input: {
    tenantId: string;
    row: OutboxRow;
    job: JobRow;
    fingerprint: string;
    maxAttempts: number;
    nowUtc: string;
    preparation: SkipPreparation;
  },
): Promise<CanonicalAccountingPostResult> {
  const attemptsAfter = input.job.attempts + 1;
  await db.batch([
    claimJobStatement(db, {
      tenantId: input.tenantId,
      eventPublicId: input.row.event_public_id,
      fingerprint: input.fingerprint,
      attemptsBefore: input.job.attempts,
      attemptsAfter,
      maxAttempts: input.maxAttempts,
      nowUtc: input.nowUtc,
    }),
    db.prepare(`
      UPDATE canonical_accounting_posting_jobs
      SET status='skipped',posting_kind='skip',skip_code=?,posted_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND outbox_event_public_id=? AND source_fingerprint=?
        AND status='processing' AND attempts=?
    `).bind(
      input.preparation.skipCode,
      input.nowUtc,
      input.nowUtc,
      input.tenantId,
      input.row.event_public_id,
      input.fingerprint,
      attemptsAfter,
    ),
  ]);
  return {
    status: 'skipped',
    postingKind: 'skip',
    voucherPublicId: null,
    custodyMovementPublicId: null,
    debitTotalMinor: 0,
    creditTotalMinor: 0,
    skipCode: input.preparation.skipCode,
  };
}

async function failureResult(
  db: CanonicalAccountingDatabase,
  input: {
    tenantId: string;
    row: OutboxRow;
    job: JobRow;
    nowUtc: string;
    maxAttempts: number;
    error: AccountingPostingError;
  },
): Promise<CanonicalAccountingPostResult> {
  const attemptsAfter = input.job.attempts + 1;
  const deadLetter = !input.error.retryable || attemptsAfter >= input.maxAttempts;
  const status = deadLetter ? 'dead_letter' : 'retry';
  await db.prepare(`
    UPDATE canonical_accounting_posting_jobs
    SET status=?,attempts=?,max_attempts=?,
        first_attempt_at_utc=COALESCE(first_attempt_at_utc,?),last_attempt_at_utc=?,
        last_error_code=?,last_error_summary=?,
        next_attempt_at_utc=CASE WHEN ?='retry' THEN ? ELSE NULL END,
        updated_at_utc=?
    WHERE tenant_id=? AND outbox_event_public_id=? AND source_fingerprint=?
      AND status IN ('pending','retry') AND attempts=?
  `).bind(
    status,
    attemptsAfter,
    input.maxAttempts,
    input.nowUtc,
    input.nowUtc,
    input.error.code,
    input.error.code,
    status,
    input.nowUtc,
    input.nowUtc,
    input.tenantId,
    input.row.event_public_id,
    input.job.source_fingerprint,
    input.job.attempts,
  ).run();
  return {
    status,
    postingKind: input.job.posting_kind,
    voucherPublicId: null,
    custodyMovementPublicId: null,
    debitTotalMinor: 0,
    creditTotalMinor: 0,
    errorCode: input.error.code,
  };
}

async function replayResult(
  db: CanonicalAccountingDatabase,
  tenantId: string,
  job: JobRow,
): Promise<CanonicalAccountingPostResult> {
  if (job.status === 'skipped') {
    return {
      status: 'skipped',
      postingKind: 'skip',
      voucherPublicId: null,
      custodyMovementPublicId: null,
      debitTotalMinor: 0,
      creditTotalMinor: 0,
      skipCode: job.skip_code ?? undefined,
    };
  }
  if (job.status === 'dead_letter') {
    return {
      status: 'dead_letter',
      postingKind: job.posting_kind,
      voucherPublicId: null,
      custodyMovementPublicId: null,
      debitTotalMinor: 0,
      creditTotalMinor: 0,
      errorCode: job.last_error_code ?? undefined,
    };
  }
  if (job.status !== 'posted') throw new Error('Canonical accounting posting job is not replayable');
  if (job.posting_kind === 'voucher' && job.voucher_public_id) {
    const voucher = await db.prepare(`
      SELECT debit_total_minor,credit_total_minor
      FROM canonical_accounting_vouchers
      WHERE tenant_id=? AND voucher_public_id=?
      LIMIT 1
    `).bind(tenantId, job.voucher_public_id).first<{ debit_total_minor: number; credit_total_minor: number }>();
    if (!voucher) throw new Error('Posted canonical accounting voucher is missing');
    return {
      status: 'replayed',
      postingKind: 'voucher',
      voucherPublicId: job.voucher_public_id,
      custodyMovementPublicId: null,
      debitTotalMinor: voucher.debit_total_minor,
      creditTotalMinor: voucher.credit_total_minor,
    };
  }
  if (job.posting_kind === 'cash_custody' && job.custody_movement_public_id) {
    return {
      status: 'replayed',
      postingKind: 'cash_custody',
      voucherPublicId: null,
      custodyMovementPublicId: job.custody_movement_public_id,
      debitTotalMinor: 0,
      creditTotalMinor: 0,
    };
  }
  throw new Error('Posted canonical accounting job has incomplete result references');
}

export async function postCanonicalAccountingEvent(
  db: CanonicalAccountingDatabase,
  input: PostCanonicalAccountingEventInput,
): Promise<CanonicalAccountingPostResult> {
  exact(input.tenantId, 'tenantId');
  exact(input.outboxEventPublicId, 'outboxEventPublicId');
  utc(input.nowUtc, 'nowUtc');
  const maxAttempts = positiveLimit(input.maxAttempts, DEFAULT_MAX_ATTEMPTS, 'maxAttempts');
  const row = await loadOutbox(db, input.tenantId, input.outboxEventPublicId);
  const parsed = payload(row);
  const fingerprint = await createRequestFingerprint(sourceShape(row, parsed));
  let job = await ensureJob(db, {
    tenantId: input.tenantId,
    row,
    fingerprint,
    maxAttempts,
    nowUtc: input.nowUtc,
  });
  if (['posted', 'skipped', 'dead_letter'].includes(job.status)) return replayResult(db, input.tenantId, job);
  if (job.status === 'processing') throw new Error('Canonical accounting posting job is already processing');
  try {
    const preparation = await prepare(db, input.tenantId, row, parsed);
    if (preparation.postingKind === 'voucher') {
      return await postVoucher(db, {
        tenantId: input.tenantId,
        row,
        job,
        fingerprint,
        maxAttempts: job.max_attempts,
        nowUtc: input.nowUtc,
        preparation,
      });
    }
    if (preparation.postingKind === 'cash_custody') {
      return await postCustody(db, {
        tenantId: input.tenantId,
        row,
        job,
        fingerprint,
        maxAttempts: job.max_attempts,
        nowUtc: input.nowUtc,
        preparation,
      });
    }
    return await postSkip(db, {
      tenantId: input.tenantId,
      row,
      job,
      fingerprint,
      maxAttempts: job.max_attempts,
      nowUtc: input.nowUtc,
      preparation,
    });
  } catch (error) {
    if (!(error instanceof AccountingPostingError)) throw error;
    job = (await loadJob(db, input.tenantId, input.outboxEventPublicId)) ?? job;
    return failureResult(db, {
      tenantId: input.tenantId,
      row,
      job,
      nowUtc: input.nowUtc,
      maxAttempts: job.max_attempts,
      error,
    });
  }
}

export async function postPendingCanonicalAccountingEvents(
  db: CanonicalAccountingDatabase,
  input: PostPendingCanonicalAccountingEventsInput,
): Promise<PostPendingCanonicalAccountingEventsResult> {
  exact(input.tenantId, 'tenantId');
  utc(input.nowUtc, 'nowUtc');
  const limit = positiveLimit(input.limit, 100, 'limit');
  const maxAttempts = positiveLimit(input.maxAttempts, DEFAULT_MAX_ATTEMPTS, 'maxAttempts');
  const placeholders = SUPPORTED_EVENT_TYPES.map(() => '?').join(',');
  const rows = (await db.prepare(`
    SELECT e.event_public_id
    FROM canonical_outbox_events e
    LEFT JOIN canonical_accounting_posting_jobs j
      ON j.tenant_id=e.tenant_id AND j.outbox_event_public_id=e.event_public_id
    WHERE e.tenant_id=? AND e.event_type IN (${placeholders})
      AND (
        j.id IS NULL
        OR (j.status='retry' AND j.attempts<j.max_attempts
          AND (j.next_attempt_at_utc IS NULL OR j.next_attempt_at_utc<=?))
      )
    ORDER BY e.id
    LIMIT ?
  `).bind(
    input.tenantId,
    ...SUPPORTED_EVENT_TYPES,
    input.nowUtc,
    limit,
  ).all<{ event_public_id: string }>()).results;
  const result: PostPendingCanonicalAccountingEventsResult = {
    scanned: rows.length,
    posted: 0,
    skipped: 0,
    retry: 0,
    deadLetter: 0,
  };
  for (const row of rows) {
    const posted = await postCanonicalAccountingEvent(db, {
      tenantId: input.tenantId,
      outboxEventPublicId: row.event_public_id,
      nowUtc: input.nowUtc,
      maxAttempts,
    });
    if (posted.status === 'posted') result.posted += 1;
    else if (posted.status === 'skipped') result.skipped += 1;
    else if (posted.status === 'retry') result.retry += 1;
    else if (posted.status === 'dead_letter') result.deadLetter += 1;
  }
  return result;
}

export async function reverseCanonicalAccountingVoucher(
  db: CanonicalAccountingDatabase,
  input: ReverseCanonicalAccountingVoucherInput,
): Promise<CanonicalAccountingPostResult> {
  exact(input.tenantId, 'tenantId');
  exact(input.originalVoucherPublicId, 'originalVoucherPublicId');
  exact(input.reversalPublicId, 'reversalPublicId');
  exact(input.reasonCode, 'reasonCode');
  exact(input.idempotencyKey, 'idempotencyKey');
  utc(input.occurredAtUtc, 'occurredAtUtc');
  date(input.businessDate, 'businessDate');
  if (!/^[a-f0-9]{64}$/.test(input.sourceEvidenceSha256)) throw new RangeError('sourceEvidenceSha256 must be a lowercase SHA-256 digest');
  const requestFingerprint = await createRequestFingerprint({
    businessDate: input.businessDate,
    occurredAtUtc: input.occurredAtUtc,
    originalVoucherPublicId: input.originalVoucherPublicId,
    reasonCode: input.reasonCode,
    reversalPublicId: input.reversalPublicId,
    sourceEvidenceSha256: input.sourceEvidenceSha256,
  });
  const existing = await db.prepare(`
    SELECT voucher_public_id,request_fingerprint,debit_total_minor,credit_total_minor
    FROM canonical_accounting_vouchers
    WHERE tenant_id=? AND idempotency_key=?
    LIMIT 1
  `).bind(input.tenantId, input.idempotencyKey).first<{
    voucher_public_id: string;
    request_fingerprint: string;
    debit_total_minor: number;
    credit_total_minor: number;
  }>();
  if (existing) {
    if (existing.request_fingerprint !== requestFingerprint) {
      throw new CanonicalIdempotencyConflictError(input.tenantId, input.idempotencyKey);
    }
    return {
      status: 'replayed',
      postingKind: 'voucher',
      voucherPublicId: existing.voucher_public_id,
      custodyMovementPublicId: null,
      debitTotalMinor: existing.debit_total_minor,
      creditTotalMinor: existing.credit_total_minor,
    };
  }
  await assertPeriodOpen(db, input.tenantId, input.businessDate);
  const original = await db.prepare(`
    SELECT voucher_public_id,currency_code,debit_total_minor,credit_total_minor,entry_count
    FROM canonical_accounting_vouchers
    WHERE tenant_id=? AND voucher_public_id=? AND status='posted'
    LIMIT 1
  `).bind(input.tenantId, input.originalVoucherPublicId).first<OriginalVoucherRow>();
  if (!original) throw new Error('Original canonical accounting voucher not found');
  const lines = (await db.prepare(`
    SELECT account_public_id,debit_minor,credit_minor,memo_code,line_no
    FROM canonical_accounting_entries
    WHERE tenant_id=? AND voucher_public_id=?
    ORDER BY line_no
  `).bind(input.tenantId, input.originalVoucherPublicId).all<OriginalEntryRow>()).results;
  if (lines.length !== original.entry_count) throw new Error('Original canonical accounting voucher entries do not reconcile');
  const voucherPublicId = await createDeterministicSourceId(
    'acctrev',
    input.tenantId,
    'accounting_reversal',
    input.reversalPublicId,
  );
  const voucherNumber = `REV-${voucherPublicId.slice(-16)}`;
  const statements: CanonicalAccountingPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_accounting_vouchers (
        tenant_id,voucher_public_id,voucher_number,voucher_type,outbox_event_public_id,
        source_event_type,source_aggregate_type,source_aggregate_public_id,currency_code,
        business_date,occurred_at_utc,status,debit_total_minor,credit_total_minor,
        entry_count,reversal_of_voucher_public_id,reversal_reason_code,idempotency_key,
        request_fingerprint,posting_guard,source_evidence_sha256
      ) VALUES (?,?,?,'reversal',NULL,'canonical.accounting.voucher.reversed',
        'canonical_accounting_voucher',?,?,?,?,'posted',?,?,?,?,?,?,?,1,?)
    `).bind(
      input.tenantId,
      voucherPublicId,
      voucherNumber,
      input.originalVoucherPublicId,
      original.currency_code,
      input.businessDate,
      input.occurredAtUtc,
      original.credit_total_minor,
      original.debit_total_minor,
      original.entry_count,
      input.originalVoucherPublicId,
      input.reasonCode,
      input.idempotencyKey,
      requestFingerprint,
      input.sourceEvidenceSha256,
    ),
  ];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const entryPublicId = await createDeterministicSourceId(
      'acctentry',
      input.tenantId,
      voucherPublicId,
      String(index + 1),
    );
    statements.push(db.prepare(`
      INSERT INTO canonical_accounting_entries (
        tenant_id,entry_public_id,voucher_public_id,line_no,account_public_id,
        debit_minor,credit_minor,memo_code,source_evidence_sha256
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      input.tenantId,
      entryPublicId,
      voucherPublicId,
      index + 1,
      line.account_public_id,
      line.credit_minor,
      line.debit_minor,
      `reversal_${line.memo_code}`,
      input.sourceEvidenceSha256,
    ));
  }
  await db.batch(statements);
  return {
    status: 'posted',
    postingKind: 'voucher',
    voucherPublicId,
    custodyMovementPublicId: null,
    debitTotalMinor: original.credit_total_minor,
    creditTotalMinor: original.debit_total_minor,
  };
}
