import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface AdjustmentBackfillPreparedStatement {
  bind(...values: unknown[]): AdjustmentBackfillPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface AdjustmentBackfillDatabase {
  prepare(sql: string): AdjustmentBackfillPreparedStatement;
  batch(statements: AdjustmentBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface AdjustmentBackfillOptions {
  tenantId: string;
  runPublicId: string;
  currencyCode: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface AdjustmentBackfillCounts {
  scanned: number;
  depositsCreated: number;
  applicationsCreated: number;
  creditNotesCreated: number;
  creditLinesCreated: number;
  refundsCreated: number;
  reversalsCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
}

export interface AdjustmentBackfillResult {
  completed: boolean;
  counts: AdjustmentBackfillCounts;
}

interface RunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}
interface SourceRef { source_kind: 'deposit' | 'credit' | 'refund'; sort_key: number; id: number }
interface DepositRow {
  id: number;
  patient_id: number;
  deposit_receipt_no: string;
  amount: number;
  transaction_type: string;
  payment_method: string | null;
  remarks: string | null;
  reference_bill_id: number | null;
  counter_id: number | null;
  counter_session_id: number | null;
  is_active: number | null;
  created_by: number | null;
  created_at: string | null;
  updated_at: string | null;
}
interface CreditRow {
  id: number;
  credit_note_no: string;
  bill_id: number;
  patient_id: number;
  reason: string;
  total_amount: number;
  refund_amount: number;
  payment_mode: string | null;
  remarks: string | null;
  counter_id: number | null;
  counter_session_id: number | null;
  status: string | null;
  approved_by: number | null;
  approved_at: string | null;
  is_active: number | null;
  created_by: number | null;
  created_at: string | null;
}
interface CreditItemRow {
  id: number;
  credit_note_id: number;
  invoice_item_id: number;
  item_name: string | null;
  unit_price: number | null;
  return_quantity: number;
  total_amount: number;
  remarks: string | null;
  created_at: string | null;
}
interface RefundRow {
  id: number;
  approval_request_id: number;
  bill_id: number;
  patient_id: number;
  amount: number;
  payment_method: string;
  employee_id: number;
  counter_id: number;
  counter_session_id: number;
  status: string;
  idempotency_key: string;
  credit_note_id: number | null;
  held_at: string;
  consumed_at: string | null;
  released_at: string | null;
  resolved_by: number | null;
  resolution_reason: string | null;
  created_at: string;
  updated_at: string;
}
interface ReceiptRow {
  receipt_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  allocated_total_minor: number;
  unallocated_minor: number;
  refunded_minor: number;
  net_received_minor: number;
  status: string;
  received_at_utc: string;
  business_date: string;
  posted_at_utc: string | null;
}
interface InvoiceRow {
  invoice_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}
interface InvoiceLineRow { line_public_id: string; invoice_public_id: string }
interface StartCounts {
  deposits: number;
  applications: number;
  credits: number;
  creditLines: number;
  refunds: number;
  reversals: number;
  mappings: number;
  issues: number;
}
interface Context {
  db: AdjustmentBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  currencyCode: string;
  nowUtc: string;
}

type AdjustmentEntityType = 'deposit' | 'deposit_application' | 'credit_note' | 'credit_note_line' | 'refund' | 'payment_reversal';

const MIGRATION = '0512_canonical_adjustments.sql';
const CHECKPOINT_SOURCE = 'legacy_adjustments';
const SOURCE_DEPOSIT = 'legacy_billing_deposit';
const SOURCE_CREDIT = 'legacy_billing_credit_note';
const SOURCE_CREDIT_ITEM = 'legacy_billing_credit_note_item';
const SOURCE_REFUND = 'legacy_billing_refund_cash_hold';

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function currency(value: string): string {
  exact(value, 'currencyCode');
  if (!/^[A-Z]{3}$/.test(value)) throw new TypeError('currencyCode must be three uppercase letters');
  return value;
}

function positiveLimit(value: number | undefined): number {
  if (value === undefined) return 1000000;
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive safe integer');
  return value;
}

function legacyUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) return toUtcIso(iso);
  return toUtcIso(`${iso}+06:00`);
}

function businessDate(value: string | null | undefined, fallbackUtc: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(value?.trim() ?? '')?.[1] ?? fallbackUtc.slice(0, 10);
}

function exactMajorToMinor(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive and finite`);
  try {
    const minor = toMinorUnits(String(value));
    if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError();
    return Number(minor);
  } catch (error) {
    throw new RangeError(`${label} cannot be converted exactly to minor units`, { cause: error });
  }
}

async function all<T>(statement: AdjustmentBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function tableCount(db: AdjustmentBackfillDatabase, table: string, tenantId: string, tail = ''): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?${tail}`)
    .bind(tenantId).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function capture(db: AdjustmentBackfillDatabase, tenantId: string): Promise<StartCounts> {
  return {
    deposits: await tableCount(db, 'canonical_deposits', tenantId),
    applications: await tableCount(db, 'canonical_deposit_applications', tenantId),
    credits: await tableCount(db, 'canonical_credit_notes', tenantId),
    creditLines: await tableCount(db, 'canonical_credit_note_lines', tenantId),
    refunds: await tableCount(db, 'canonical_refunds', tenantId),
    reversals: await tableCount(db, 'canonical_payment_reversals', tenantId),
    mappings: await tableCount(db, 'canonical_source_mappings', tenantId, " AND entity_type IN ('deposit','deposit_application','credit_note','credit_note_line','refund','payment_reversal')"),
    issues: await tableCount(db, 'canonical_processing_issues', tenantId, " AND issue_type='adjustment_backfill'"),
  };
}

async function result(
  db: AdjustmentBackfillDatabase,
  tenantId: string,
  start: StartCounts,
  scanned: number,
  completed: boolean,
): Promise<AdjustmentBackfillResult> {
  const end = await capture(db, tenantId);
  return {
    completed,
    counts: {
      scanned,
      depositsCreated: end.deposits - start.deposits,
      applicationsCreated: end.applications - start.applications,
      creditNotesCreated: end.credits - start.credits,
      creditLinesCreated: end.creditLines - start.creditLines,
      refundsCreated: end.refunds - start.refunds,
      reversalsCreated: end.reversals - start.reversals,
      mappingsCreated: end.mappings - start.mappings,
      issuesCreated: end.issues - start.issues,
    },
  };
}

async function ensureRun(
  db: AdjustmentBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<RunRow> {
  let row = await db.prepare(`
    SELECT id,status FROM canonical_migration_runs
    WHERE tenant_id=? AND run_public_id=? LIMIT 1
  `).bind(tenantId, runPublicId).first<RunRow>();
  if (!row) {
    await db.prepare(`
      INSERT INTO canonical_migration_runs (
        tenant_id,run_public_id,migration_name,migration_kind,status,
        started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'backfill','running',?,?,?)
    `).bind(tenantId, runPublicId, MIGRATION, nowUtc, nowUtc, nowUtc).run();
    row = await db.prepare(`
      SELECT id,status FROM canonical_migration_runs
      WHERE tenant_id=? AND run_public_id=? LIMIT 1
    `).bind(tenantId, runPublicId).first<RunRow>();
  }
  if (!row) throw new Error('Failed to create adjustment migration run');
  if (row.status === 'failed' || row.status === 'cancelled') {
    throw new Error(`Adjustment backfill run is terminal: ${row.status}`);
  }
  return row;
}

async function ensureCheckpoint(ctx: Context): Promise<CheckpointRow> {
  let row = await ctx.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type='adjustment'
      AND source_type=? AND partition_key='' LIMIT 1
  `).bind(ctx.tenantId, ctx.runId, CHECKPOINT_SOURCE).first<CheckpointRow>();
  if (!row) {
    const checkpointId = await createDeterministicSourceId('chk', ctx.tenantId, 'adjustment_backfill', ctx.runPublicId);
    await ctx.db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,status,started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'adjustment',?,'','running',?,?,?)
    `).bind(ctx.tenantId, checkpointId, ctx.runId, CHECKPOINT_SOURCE, ctx.nowUtc, ctx.nowUtc, ctx.nowUtc).run();
    row = await ctx.db.prepare(`
      SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type='adjustment'
        AND source_type=? AND partition_key='' LIMIT 1
    `).bind(ctx.tenantId, ctx.runId, CHECKPOINT_SOURCE).first<CheckpointRow>();
  }
  if (!row) throw new Error('Failed to create adjustment checkpoint');
  return row;
}

function parseCursor(value: string | null): { sort: number; id: number } {
  if (!value) return { sort: 0, id: 0 };
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid adjustment checkpoint cursor: ${value}`);
  return { sort: Number(match[1]), id: Number(match[2]) };
}

function progress(
  ctx: Context,
  cp: CheckpointRow,
  cursor: string,
  created: number,
  mapped: number,
  skipped: number,
  exceptions: number,
): AdjustmentBackfillPreparedStatement {
  return ctx.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET cursor_value=?,scanned_count=scanned_count+1,
        created_count=created_count+?,mapped_count=mapped_count+?,
        skipped_count=skipped_count+?,exception_count=exception_count+?,
        updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(cursor, created, mapped, skipped, exceptions, ctx.nowUtc, ctx.tenantId, cp.id);
}

async function existing(
  ctx: Context,
  entityType: AdjustmentEntityType,
  sourceType: string,
  sourceId: string,
): Promise<MappingRow | null> {
  return ctx.db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(ctx.tenantId, entityType, sourceType, sourceId).first<MappingRow>();
}

function assertEvidence(mapping: MappingRow | null, evidence: string, label: string): void {
  if (mapping && mapping.evidence_sha256 !== evidence) throw new Error(`${label} source evidence drift detected`);
}

function mapStatement(
  ctx: Context,
  entityType: AdjustmentEntityType,
  sourceType: string,
  sourceTable: string,
  sourceId: string,
  canonicalId: string | null,
  status: 'mapped' | 'ambiguous' | 'rejected',
  evidence: string,
): AdjustmentBackfillPreparedStatement {
  return ctx.db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,1,?,?,?,?)
  `).bind(
    ctx.tenantId,
    entityType,
    canonicalId,
    sourceType,
    sourceId,
    sourceTable,
    status,
    ctx.runId,
    evidence,
    ctx.nowUtc,
    ctx.nowUtc,
  );
}

async function issueStatement(
  ctx: Context,
  code: string,
  entityType: string,
  sourceType: string,
  sourceId: string,
  summary: string,
  details?: Record<string, number | string>,
): Promise<AdjustmentBackfillPreparedStatement> {
  const fingerprint = await createDeterministicSourceId('fp', ctx.tenantId, code, `${sourceType}:${sourceId}`);
  const issuePublicId = await createDeterministicSourceId('iss', ctx.tenantId, code, `${sourceType}:${sourceId}`);
  return ctx.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,entity_type,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,
      summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'adjustment_backfill',?,?,?,?,?,'error','open',1,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      migration_run_id=excluded.migration_run_id,
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      details_json=excluded.details_json,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    ctx.tenantId,
    issuePublicId,
    ctx.runId,
    code,
    entityType,
    sourceType,
    sourceId,
    fingerprint,
    summary,
    details ? JSON.stringify(details) : null,
    ctx.nowUtc,
    ctx.nowUtc,
    ctx.nowUtc,
    ctx.nowUtc,
  );
}

async function depositEvidence(row: DepositRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_DEPOSIT,
    sourcePublicId: String(row.id),
    patientId: row.patient_id,
    depositReceiptNo: row.deposit_receipt_no,
    amountMajor: row.amount,
    transactionType: row.transaction_type,
    paymentMethod: row.payment_method,
    referenceBillId: row.reference_bill_id,
    counterId: row.counter_id,
    counterSessionId: row.counter_session_id,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function creditEvidence(row: CreditRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_CREDIT,
    sourcePublicId: String(row.id),
    creditNoteNo: row.credit_note_no,
    billId: row.bill_id,
    patientId: row.patient_id,
    reason: row.reason,
    totalAmountMajor: row.total_amount,
    refundAmountMajor: row.refund_amount,
    paymentMode: row.payment_mode,
    status: row.status,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
  });
}

async function creditItemEvidence(row: CreditItemRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_CREDIT_ITEM,
    sourcePublicId: String(row.id),
    creditNoteId: row.credit_note_id,
    invoiceItemId: row.invoice_item_id,
    unitPriceMajor: row.unit_price,
    returnQuantity: row.return_quantity,
    totalAmountMajor: row.total_amount,
    createdAt: row.created_at,
  });
}

async function refundEvidence(row: RefundRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_REFUND,
    sourcePublicId: String(row.id),
    approvalRequestId: row.approval_request_id,
    billId: row.bill_id,
    patientId: row.patient_id,
    amountMajor: row.amount,
    paymentMethod: row.payment_method,
    employeeId: row.employee_id,
    counterId: row.counter_id,
    counterSessionId: row.counter_session_id,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    creditNoteId: row.credit_note_id,
    heldAt: row.held_at,
    consumedAt: row.consumed_at,
    releasedAt: row.released_at,
    resolvedBy: row.resolved_by,
    resolutionReason: row.resolution_reason,
    updatedAt: row.updated_at,
  });
}

async function rejectDeposit(
  ctx: Context,
  cp: CheckpointRow,
  row: DepositRow,
  evidence: string,
  code: string,
  summary: string,
): Promise<void> {
  await ctx.db.batch([
    mapStatement(ctx, 'deposit', SOURCE_DEPOSIT, 'billing_deposits', String(row.id), null, 'ambiguous', evidence),
    await issueStatement(ctx, code, 'deposit', SOURCE_DEPOSIT, String(row.id), summary),
    progress(ctx, cp, `1:${row.id}`, 0, 1, 0, 1),
  ]);
}

async function processDeposit(ctx: Context, cp: CheckpointRow, id: number): Promise<void> {
  const row = await ctx.db.prepare(`
    SELECT id,patient_id,deposit_receipt_no,amount,transaction_type,payment_method,
           remarks,reference_bill_id,counter_id,counter_session_id,is_active,
           created_by,created_at,updated_at
    FROM billing_deposits WHERE tenant_id=? AND id=? LIMIT 1
  `).bind(ctx.tenantId, id).first<DepositRow>();
  if (!row) throw new Error(`Legacy deposit not found: ${id}`);
  const sourceId = String(row.id);
  const evidence = await depositEvidence(row);
  const transactionType = (row.transaction_type ?? '').trim().toLowerCase();
  if (transactionType === 'adjustment' || transactionType === 'refund') {
    const lifecycle = await ctx.db.prepare(`
      SELECT canonical_public_id,mapping_status
      FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='deposit_lifecycle_transaction'
        AND source_type='legacy_billing_deposit_lifecycle'
        AND source_public_id=? LIMIT 1
    `).bind(ctx.tenantId, sourceId).first<MappingRow>();
    if (lifecycle?.mapping_status === 'mapped' && lifecycle.canonical_public_id) {
      await ctx.db.batch([progress(ctx, cp, `1:${row.id}`, 0, 0, 1, 0)]);
      return;
    }
  }
  const mapping = await existing(ctx, 'deposit', SOURCE_DEPOSIT, sourceId);
  assertEvidence(mapping, evidence, 'Deposit');
  if (mapping) {
    await ctx.db.batch([progress(ctx, cp, `1:${row.id}`, 0, 0, 1, 0)]);
    return;
  }
  if ((row.transaction_type ?? '').trim().toLowerCase() !== 'deposit' || row.is_active === 0) {
    await rejectDeposit(ctx, cp, row, evidence, 'DEPOSIT_TRANSACTION_TYPE_UNSUPPORTED', 'Legacy deposit row is not an active deposit liability.');
    return;
  }

  let amountMinor: number;
  try { amountMinor = exactMajorToMinor(row.amount, 'billing_deposits.amount'); }
  catch {
    await rejectDeposit(ctx, cp, row, evidence, 'DEPOSIT_AMOUNT_UNRESOLVED', 'Legacy deposit amount cannot be converted exactly to positive minor units.');
    return;
  }
  const receiptMapping = await ctx.db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='payment_receipt' AND source_type=?
      AND source_public_id=? LIMIT 1
  `).bind(ctx.tenantId, SOURCE_DEPOSIT, sourceId).first<MappingRow>();
  if (receiptMapping?.mapping_status !== 'mapped' || !receiptMapping.canonical_public_id) {
    await rejectDeposit(ctx, cp, row, evidence, 'DEPOSIT_RECEIPT_UNRESOLVED', 'Legacy deposit has no exact canonical receipt authority.');
    return;
  }
  const receipt = await ctx.db.prepare(`
    SELECT receipt_public_id,legacy_patient_id,currency_code,total_minor,
           allocated_total_minor,unallocated_minor,refunded_minor,net_received_minor,
           status,received_at_utc,business_date,posted_at_utc
    FROM canonical_payment_receipts
    WHERE tenant_id=? AND receipt_public_id=? LIMIT 1
  `).bind(ctx.tenantId, receiptMapping.canonical_public_id).first<ReceiptRow>();
  if (
    !receipt
    || receipt.status !== 'posted'
    || receipt.posted_at_utc == null
    || receipt.legacy_patient_id !== row.patient_id
    || receipt.currency_code !== ctx.currencyCode
    || receipt.total_minor !== amountMinor
    || receipt.allocated_total_minor !== 0
    || receipt.unallocated_minor !== amountMinor
    || receipt.refunded_minor !== 0
    || receipt.net_received_minor !== amountMinor
  ) {
    await rejectDeposit(ctx, cp, row, evidence, 'DEPOSIT_RECEIPT_MISMATCH', 'Mapped canonical receipt does not exactly match deposit liability evidence.');
    return;
  }

  const depositId = await createDeterministicSourceId('dep', ctx.tenantId, SOURCE_DEPOSIT, sourceId);
  const receivedAt = legacyUtc(row.created_at, ctx.nowUtc);
  await ctx.db.batch([
    ctx.db.prepare(`
      INSERT INTO canonical_deposits (
        tenant_id,deposit_public_id,deposit_number,receipt_public_id,
        legacy_patient_id,currency_code,amount_minor,applied_minor,refunded_minor,
        available_minor,status,received_at_utc,business_date,posted_at_utc,
        reconciliation_guard,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,0,0,?,'posted',?,?,?,1,?,?,?)
    `).bind(
      ctx.tenantId,
      depositId,
      row.deposit_receipt_no.trim(),
      receipt.receipt_public_id,
      row.patient_id,
      ctx.currencyCode,
      amountMinor,
      amountMinor,
      receivedAt,
      businessDate(row.created_at, receivedAt),
      receipt.posted_at_utc,
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
    mapStatement(ctx, 'deposit', SOURCE_DEPOSIT, 'billing_deposits', sourceId, depositId, 'mapped', evidence),
    progress(ctx, cp, `1:${row.id}`, 1, 1, 0, 0),
  ]);
}

async function rejectCredit(
  ctx: Context,
  cp: CheckpointRow,
  row: CreditRow,
  items: CreditItemRow[],
  evidence: string,
  itemEvidence: string[],
  code: string,
  summary: string,
): Promise<void> {
  const statements: AdjustmentBackfillPreparedStatement[] = [
    mapStatement(ctx, 'credit_note', SOURCE_CREDIT, 'billing_credit_notes', String(row.id), null, 'ambiguous', evidence),
  ];
  for (let index = 0; index < items.length; index += 1) {
    statements.push(mapStatement(
      ctx,
      'credit_note_line',
      SOURCE_CREDIT_ITEM,
      'billing_credit_note_items',
      String(items[index].id),
      null,
      'ambiguous',
      itemEvidence[index],
    ));
  }
  statements.push(await issueStatement(ctx, code, 'credit_note', SOURCE_CREDIT, String(row.id), summary));
  statements.push(progress(ctx, cp, `2:${row.id}`, 0, 1 + items.length, 0, 1));
  await ctx.db.batch(statements);
}

async function compensationPaid(ctx: Context, billId: number): Promise<boolean> {
  const found = await ctx.db.prepare(`
    SELECT 1 present WHERE
      EXISTS (SELECT 1 FROM diagnostic_performer_reserves WHERE tenant_id=? AND bill_id=? AND status='paid')
      OR EXISTS (SELECT 1 FROM doctor_commission_accruals WHERE tenant_id=? AND bill_id=? AND status='paid')
  `).bind(ctx.tenantId, billId, ctx.tenantId, billId).first<{ present: number }>();
  return Boolean(found);
}

async function processCredit(ctx: Context, cp: CheckpointRow, id: number): Promise<void> {
  const row = await ctx.db.prepare(`
    SELECT id,credit_note_no,bill_id,patient_id,reason,total_amount,refund_amount,
           payment_mode,remarks,counter_id,counter_session_id,status,approved_by,
           approved_at,is_active,created_by,created_at
    FROM billing_credit_notes WHERE tenant_id=? AND id=? LIMIT 1
  `).bind(ctx.tenantId, id).first<CreditRow>();
  if (!row) throw new Error(`Legacy credit note not found: ${id}`);
  const items = await all<CreditItemRow>(ctx.db.prepare(`
    SELECT id,credit_note_id,invoice_item_id,item_name,unit_price,return_quantity,
           total_amount,remarks,created_at
    FROM billing_credit_note_items
    WHERE tenant_id=? AND credit_note_id=? ORDER BY id
  `).bind(ctx.tenantId, row.id));
  const evidence = await creditEvidence(row);
  const itemEvidence = await Promise.all(items.map(creditItemEvidence));
  const headerMapping = await existing(ctx, 'credit_note', SOURCE_CREDIT, String(row.id));
  assertEvidence(headerMapping, evidence, 'Credit note');
  for (let index = 0; index < items.length; index += 1) {
    assertEvidence(
      await existing(ctx, 'credit_note_line', SOURCE_CREDIT_ITEM, String(items[index].id)),
      itemEvidence[index],
      'Credit note line',
    );
  }
  if (headerMapping) {
    await ctx.db.batch([progress(ctx, cp, `2:${row.id}`, 0, 0, 1, 0)]);
    return;
  }
  if (row.is_active === 0 || !['approved', 'posted'].includes((row.status ?? '').trim().toLowerCase())) {
    await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_NOT_APPROVED', 'Legacy credit note is not active and approved.');
    return;
  }
  if (items.length === 0) {
    await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_LINES_MISSING', 'Legacy credit note has no item-level evidence.');
    return;
  }
  const invoiceMapping = await ctx.db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice' AND source_type='legacy_bill'
      AND source_public_id=? LIMIT 1
  `).bind(ctx.tenantId, String(row.bill_id)).first<MappingRow>();
  if (invoiceMapping?.mapping_status !== 'mapped' || !invoiceMapping.canonical_public_id) {
    await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_INVOICE_UNRESOLVED', 'Legacy credit note has no exact canonical invoice authority.');
    return;
  }
  const invoice = await ctx.db.prepare(`
    SELECT invoice_public_id,legacy_patient_id,currency_code,paid_minor,due_minor,
           credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=? LIMIT 1
  `).bind(ctx.tenantId, invoiceMapping.canonical_public_id).first<InvoiceRow>();
  if (!invoice || invoice.status !== 'posted' || invoice.legacy_patient_id !== row.patient_id || invoice.currency_code !== ctx.currencyCode) {
    await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_INVOICE_MISMATCH', 'Mapped canonical invoice does not match credit-note patient, currency, or lifecycle.');
    return;
  }
  if (await compensationPaid(ctx, row.bill_id)) {
    await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_COMPENSATION_SETTLED', 'Paid performer reserve or commission liability blocks automatic credit-note authority.');
    return;
  }

  let totalMinor: number;
  const itemMinor: number[] = [];
  try {
    totalMinor = exactMajorToMinor(row.total_amount, 'billing_credit_notes.total_amount');
    for (const item of items) itemMinor.push(exactMajorToMinor(item.total_amount, 'billing_credit_note_items.total_amount'));
  } catch {
    await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_AMOUNT_UNRESOLVED', 'Legacy credit-note money cannot be converted exactly to positive minor units.');
    return;
  }
  if (itemMinor.reduce((sum, value) => sum + value, 0) !== totalMinor) {
    await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_TOTAL_MISMATCH', 'Legacy credit-note header does not equal item totals.');
    return;
  }
  if (invoice.net_due_minor < totalMinor) {
    await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_EXCEEDS_NET_DUE', 'Legacy credit note exceeds canonical invoice net outstanding balance.');
    return;
  }

  const lineRows: InvoiceLineRow[] = [];
  for (const item of items) {
    const lineMapping = await ctx.db.prepare(`
      SELECT canonical_public_id,mapping_status,evidence_sha256
      FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='invoice_line' AND source_type='legacy_invoice_item'
        AND source_public_id=? LIMIT 1
    `).bind(ctx.tenantId, String(item.invoice_item_id)).first<MappingRow>();
    if (lineMapping?.mapping_status !== 'mapped' || !lineMapping.canonical_public_id) {
      await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_LINE_UNRESOLVED', 'Legacy credit-note item has no exact canonical invoice-line authority.');
      return;
    }
    const line = await ctx.db.prepare(`
      SELECT line_public_id,invoice_public_id FROM canonical_invoice_lines
      WHERE tenant_id=? AND line_public_id=? LIMIT 1
    `).bind(ctx.tenantId, lineMapping.canonical_public_id).first<InvoiceLineRow>();
    if (!line || line.invoice_public_id !== invoice.invoice_public_id) {
      await rejectCredit(ctx, cp, row, items, evidence, itemEvidence, 'CREDIT_NOTE_LINE_MISMATCH', 'Mapped canonical invoice line belongs to a different invoice.');
      return;
    }
    lineRows.push(line);
  }

  const creditId = await createDeterministicSourceId('crnote', ctx.tenantId, SOURCE_CREDIT, String(row.id));
  const issuedAt = legacyUtc(row.approved_at ?? row.created_at, ctx.nowUtc);
  const creditedAfter = invoice.credited_minor + totalMinor;
  const netDueAfter = invoice.net_due_minor - totalMinor;
  const statements: AdjustmentBackfillPreparedStatement[] = [
    ctx.db.prepare(`
      INSERT INTO canonical_credit_notes (
        tenant_id,credit_note_public_id,credit_note_number,invoice_public_id,
        legacy_patient_id,currency_code,reason_code,total_minor,
        invoice_credited_before_minor,invoice_credited_after_minor,
        invoice_net_due_before_minor,invoice_net_due_after_minor,status,
        issued_at_utc,business_date,posted_at_utc,reconciliation_guard,
        source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'posted',?,?,?,1,?,?,?)
    `).bind(
      ctx.tenantId,
      creditId,
      row.credit_note_no.trim(),
      invoice.invoice_public_id,
      row.patient_id,
      ctx.currencyCode,
      row.reason.trim(),
      totalMinor,
      invoice.credited_minor,
      creditedAfter,
      invoice.net_due_minor,
      netDueAfter,
      issuedAt,
      businessDate(row.approved_at ?? row.created_at, issuedAt),
      issuedAt,
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
  ];
  for (let index = 0; index < items.length; index += 1) {
    const lineId = await createDeterministicSourceId('crline', ctx.tenantId, SOURCE_CREDIT_ITEM, String(items[index].id));
    statements.push(ctx.db.prepare(`
      INSERT INTO canonical_credit_note_lines (
        tenant_id,credit_line_public_id,credit_note_public_id,invoice_public_id,
        invoice_line_public_id,amount_minor,reason_code,source_evidence_sha256,
        created_at_utc
      ) VALUES (?,?,?,?,?,?,?,?,?)
    `).bind(
      ctx.tenantId,
      lineId,
      creditId,
      invoice.invoice_public_id,
      lineRows[index].line_public_id,
      itemMinor[index],
      row.reason.trim(),
      itemEvidence[index],
      ctx.nowUtc,
    ));
    statements.push(mapStatement(
      ctx,
      'credit_note_line',
      SOURCE_CREDIT_ITEM,
      'billing_credit_note_items',
      String(items[index].id),
      lineId,
      'mapped',
      itemEvidence[index],
    ));
  }
  statements.push(
    ctx.db.prepare(`
      UPDATE canonical_invoices
      SET credited_minor=?,net_due_minor=?,updated_at_utc=?
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
        AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
    `).bind(
      creditedAfter,
      netDueAfter,
      issuedAt,
      ctx.tenantId,
      invoice.invoice_public_id,
      invoice.paid_minor,
      invoice.due_minor,
      invoice.credited_minor,
      invoice.net_due_minor,
    ),
    ctx.db.prepare(`
      UPDATE canonical_credit_notes
      SET reconciliation_guard=CASE WHEN
        total_minor=COALESCE((
          SELECT SUM(amount_minor) FROM canonical_credit_note_lines
          WHERE tenant_id=? AND credit_note_public_id=?
        ),0)
        AND EXISTS (
          SELECT 1 FROM canonical_invoices
          WHERE tenant_id=? AND invoice_public_id=?
            AND credited_minor=? AND net_due_minor=?
        )
      THEN 1 ELSE 0 END
      WHERE tenant_id=? AND credit_note_public_id=?
    `).bind(
      ctx.tenantId,
      creditId,
      ctx.tenantId,
      invoice.invoice_public_id,
      creditedAfter,
      netDueAfter,
      ctx.tenantId,
      creditId,
    ),
    mapStatement(ctx, 'credit_note', SOURCE_CREDIT, 'billing_credit_notes', String(row.id), creditId, 'mapped', evidence),
    progress(ctx, cp, `2:${row.id}`, 1 + items.length, 1 + items.length, 0, 0),
  );
  await ctx.db.batch(statements);
}

async function processRefund(ctx: Context, cp: CheckpointRow, id: number): Promise<void> {
  const row = await ctx.db.prepare(`
    SELECT id,approval_request_id,bill_id,patient_id,amount,payment_method,
           employee_id,counter_id,counter_session_id,status,idempotency_key,
           credit_note_id,held_at,consumed_at,released_at,resolved_by,
           resolution_reason,created_at,updated_at
    FROM billing_refund_cash_holds WHERE tenant_id=? AND id=? LIMIT 1
  `).bind(ctx.tenantId, id).first<RefundRow>();
  if (!row) throw new Error(`Legacy refund hold not found: ${id}`);
  const evidence = await refundEvidence(row);
  const refundMapping = await existing(ctx, 'refund', SOURCE_REFUND, String(row.id));
  const reversalMapping = await existing(ctx, 'payment_reversal', SOURCE_REFUND, String(row.id));
  assertEvidence(refundMapping, evidence, 'Refund');
  assertEvidence(reversalMapping, evidence, 'Payment reversal');
  if (refundMapping && reversalMapping) {
    await ctx.db.batch([progress(ctx, cp, `3:${row.id}`, 0, 0, 1, 0)]);
    return;
  }
  const code = row.status === 'consumed'
    ? 'REFUND_PAYMENT_AUTHORITY_UNRESOLVED'
    : 'REFUND_HOLD_NOT_CONSUMED';
  const summary = row.status === 'consumed'
    ? 'Legacy cash refund hold lacks exact receipt, tender, and allocation identities.'
    : 'Legacy cash refund hold is not a completed refund settlement.';
  await ctx.db.batch([
    mapStatement(ctx, 'refund', SOURCE_REFUND, 'billing_refund_cash_holds', String(row.id), null, 'ambiguous', evidence),
    mapStatement(ctx, 'payment_reversal', SOURCE_REFUND, 'billing_refund_cash_holds', String(row.id), null, 'ambiguous', evidence),
    await issueStatement(ctx, code, 'refund', SOURCE_REFUND, String(row.id), summary),
    progress(ctx, cp, `3:${row.id}`, 0, 2, 0, 1),
  ]);
}

async function fetchSources(
  ctx: Context,
  cp: CheckpointRow,
  limit: number,
): Promise<SourceRef[]> {
  const cursor = parseCursor(cp.cursor_value);
  return all<SourceRef>(ctx.db.prepare(`
    SELECT source_kind,sort_key,id FROM (
      SELECT 'deposit' source_kind,1 sort_key,id FROM billing_deposits WHERE tenant_id=?
      UNION ALL
      SELECT 'credit' source_kind,2 sort_key,id FROM billing_credit_notes WHERE tenant_id=?
      UNION ALL
      SELECT 'refund' source_kind,3 sort_key,id FROM billing_refund_cash_holds WHERE tenant_id=?
    ) sources
    WHERE sort_key>? OR (sort_key=? AND id>?)
    ORDER BY sort_key,id
    LIMIT ?
  `).bind(ctx.tenantId, ctx.tenantId, ctx.tenantId, cursor.sort, cursor.sort, cursor.id, limit));
}

async function finish(ctx: Context, cp: CheckpointRow): Promise<void> {
  const summary = JSON.stringify({ domain: 'adjustments', completed: true });
  await ctx.db.batch([
    ctx.db.prepare(`
      UPDATE canonical_backfill_checkpoints
      SET status='completed',completed_at_utc=?,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(ctx.nowUtc, ctx.nowUtc, ctx.tenantId, cp.id),
    ctx.db.prepare(`
      UPDATE canonical_migration_runs
      SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=?
      WHERE tenant_id=? AND id=? AND status='running'
    `).bind(ctx.nowUtc, summary, ctx.nowUtc, ctx.tenantId, ctx.runId),
  ]);
}

export async function backfillAdjustments(
  db: AdjustmentBackfillDatabase,
  options: AdjustmentBackfillOptions,
): Promise<AdjustmentBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const currencyCode = currency(options.currencyCode);
  const nowUtc = options.nowUtc ? toUtcIso(options.nowUtc) : new Date().toISOString();
  const maxSourceRecords = positiveLimit(options.maxSourceRecords);
  const start = await capture(db, tenantId);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  if (run.status === 'succeeded') return result(db, tenantId, start, 0, true);
  const ctx: Context = { db, tenantId, runId: run.id, runPublicId, currencyCode, nowUtc };
  const cp = await ensureCheckpoint(ctx);
  if (cp.status === 'completed') {
    await finish(ctx, cp);
    return result(db, tenantId, start, 0, true);
  }

  const refs = await fetchSources(ctx, cp, maxSourceRecords + 1);
  const selected = refs.slice(0, maxSourceRecords);
  let scanned = 0;
  for (const ref of selected) {
    if (ref.source_kind === 'deposit') await processDeposit(ctx, cp, ref.id);
    else if (ref.source_kind === 'credit') await processCredit(ctx, cp, ref.id);
    else await processRefund(ctx, cp, ref.id);
    scanned += 1;
  }
  const completed = refs.length <= maxSourceRecords;
  if (completed) await finish(ctx, cp);
  return result(db, tenantId, start, scanned, completed);
}
