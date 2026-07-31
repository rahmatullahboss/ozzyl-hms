import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface PaymentBackfillPreparedStatement {
  bind(...values: unknown[]): PaymentBackfillPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface PaymentBackfillDatabase {
  prepare(sql: string): PaymentBackfillPreparedStatement;
  batch(statements: PaymentBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface PaymentBackfillOptions {
  tenantId: string;
  runPublicId: string;
  currencyCode: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface PaymentBackfillCounts {
  scanned: number;
  receiptsCreated: number;
  tendersCreated: number;
  allocationsCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
}

export interface PaymentBackfillResult {
  completed: boolean;
  counts: PaymentBackfillCounts;
}

interface RunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}
interface InvoiceMappingRow extends MappingRow {}
interface InvoiceRow {
  invoice_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  paid_minor: number;
  due_minor: number;
  credited_minor: number;
  net_due_minor: number;
  status: string;
}
interface PaymentRow {
  id: number;
  bill_id: number;
  amount: number;
  payment_type: string | null;
  settlement_type_id: number | null;
  receipt_no: string | null;
  idempotency_key: string | null;
  external_transaction_id: string | null;
  received_by: number | null;
  payment_method: string | null;
  counter_id: number | null;
  counter_session_id: number | null;
  date: string | null;
}
interface StartCounts {
  receipts: number;
  tenders: number;
  allocations: number;
  mappings: number;
  issues: number;
}
interface Context {
  db: PaymentBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  currencyCode: string;
  nowUtc: string;
}

const SOURCE_PAYMENT = 'legacy_payment';
const ENTITY_TYPES = ['payment_receipt', 'payment_tender', 'payment_allocation'] as const;
type PaymentEntityType = typeof ENTITY_TYPES[number];

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
  if (value === undefined) return Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('maxSourceRecords must be a positive safe integer');
  }
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
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value?.trim() ?? '');
  return match?.[1] ?? fallbackUtc.slice(0, 10);
}

function exactMajorToMinor(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive finite amount`);
  }
  try {
    const minor = toMinorUnits(String(value));
    if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError();
    return Number(minor);
  } catch (error) {
    throw new RangeError(`${label} cannot be converted exactly to minor units`, { cause: error });
  }
}

async function all<T>(statement: PaymentBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function tableCount(
  db: PaymentBackfillDatabase,
  table: string,
  tenantId: string,
  tail = '',
): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?${tail}`)
    .bind(tenantId).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function capture(db: PaymentBackfillDatabase, tenantId: string): Promise<StartCounts> {
  return {
    receipts: await tableCount(db, 'canonical_payment_receipts', tenantId),
    tenders: await tableCount(db, 'canonical_payment_tenders', tenantId),
    allocations: await tableCount(db, 'canonical_payment_allocations', tenantId),
    mappings: await tableCount(
      db,
      'canonical_source_mappings',
      tenantId,
      " AND entity_type IN ('payment_receipt','payment_tender','payment_allocation')",
    ),
    issues: await tableCount(
      db,
      'canonical_processing_issues',
      tenantId,
      " AND issue_type='payment_backfill'",
    ),
  };
}

async function result(
  db: PaymentBackfillDatabase,
  tenantId: string,
  start: StartCounts,
  scanned: number,
  completed: boolean,
): Promise<PaymentBackfillResult> {
  const end = await capture(db, tenantId);
  return {
    completed,
    counts: {
      scanned,
      receiptsCreated: end.receipts - start.receipts,
      tendersCreated: end.tenders - start.tenders,
      allocationsCreated: end.allocations - start.allocations,
      mappingsCreated: end.mappings - start.mappings,
      issuesCreated: end.issues - start.issues,
    },
  };
}

async function ensureRun(
  db: PaymentBackfillDatabase,
  tenantId: string,
  runPublicId: string,
  nowUtc: string,
): Promise<RunRow> {
  let row = await db.prepare(
    'SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1',
  ).bind(tenantId, runPublicId).first<RunRow>();
  if (!row) {
    await db.prepare(`
      INSERT INTO canonical_migration_runs (
        tenant_id,run_public_id,migration_name,migration_kind,status,
        started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,'0511_canonical_payments.sql','backfill','running',?,?,?)
    `).bind(tenantId, runPublicId, nowUtc, nowUtc, nowUtc).run();
    row = await db.prepare(
      'SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1',
    ).bind(tenantId, runPublicId).first<RunRow>();
  }
  if (!row) throw new Error('Failed to create payment migration run');
  if (row.status === 'failed' || row.status === 'cancelled') {
    throw new Error(`Payment backfill run is terminal: ${row.status}`);
  }
  return row;
}

async function checkpoint(ctx: Context): Promise<CheckpointRow> {
  let row = await ctx.db.prepare(`
    SELECT id,cursor_value,status
    FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type='payment_receipt'
      AND source_type=? AND partition_key='' LIMIT 1
  `).bind(ctx.tenantId, ctx.runId, SOURCE_PAYMENT).first<CheckpointRow>();
  if (!row) {
    const publicId = await createDeterministicSourceId(
      'chk', ctx.tenantId, 'payment_backfill', ctx.runPublicId,
    );
    await ctx.db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,status,started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'payment_receipt',?,'','running',?,?,?)
    `).bind(
      ctx.tenantId,
      publicId,
      ctx.runId,
      SOURCE_PAYMENT,
      ctx.nowUtc,
      ctx.nowUtc,
      ctx.nowUtc,
    ).run();
    row = await ctx.db.prepare(`
      SELECT id,cursor_value,status
      FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type='payment_receipt'
        AND source_type=? AND partition_key='' LIMIT 1
    `).bind(ctx.tenantId, ctx.runId, SOURCE_PAYMENT).first<CheckpointRow>();
  }
  if (!row) throw new Error('Failed to create payment checkpoint');
  return row;
}

function progress(
  ctx: Context,
  cp: CheckpointRow,
  cursor: string,
  created: number,
  mapped: number,
  skipped: number,
  exceptions: number,
): PaymentBackfillPreparedStatement {
  return ctx.db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET cursor_value=?,scanned_count=scanned_count+1,
        created_count=created_count+?,mapped_count=mapped_count+?,
        skipped_count=skipped_count+?,exception_count=exception_count+?,
        updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(cursor, created, mapped, skipped, exceptions, ctx.nowUtc, ctx.tenantId, cp.id);
}

async function paymentEvidence(row: PaymentRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_PAYMENT,
    sourcePublicId: String(row.id),
    billId: row.bill_id,
    amountMajor: row.amount,
    paymentType: row.payment_type,
    settlementTypeId: row.settlement_type_id,
    receiptNo: row.receipt_no,
    idempotencyKey: row.idempotency_key,
    externalTransactionId: row.external_transaction_id,
    receivedBy: row.received_by,
    paymentMethod: row.payment_method,
    counterId: row.counter_id,
    counterSessionId: row.counter_session_id,
    date: row.date,
  });
}

async function existing(
  ctx: Context,
  entityType: PaymentEntityType,
  sourceId: string,
): Promise<MappingRow | null> {
  return ctx.db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(ctx.tenantId, entityType, SOURCE_PAYMENT, sourceId).first<MappingRow>();
}

function mapStatement(
  ctx: Context,
  entityType: PaymentEntityType,
  canonicalId: string | null,
  sourceId: string,
  status: 'mapped' | 'ambiguous' | 'rejected',
  evidence: string,
): PaymentBackfillPreparedStatement {
  return ctx.db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,'payments',?,1,?,?,?,?)
  `).bind(
    ctx.tenantId,
    entityType,
    canonicalId,
    SOURCE_PAYMENT,
    sourceId,
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
  sourceId: string,
  summary: string,
  details?: Record<string, number | string>,
): Promise<PaymentBackfillPreparedStatement> {
  const fingerprint = await createDeterministicSourceId('fp', ctx.tenantId, code, sourceId);
  const issuePublicId = await createDeterministicSourceId('iss', ctx.tenantId, code, sourceId);
  return ctx.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,entity_type,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,
      summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'payment_backfill',?,'payment_receipt',?,?,?,
              'error','open',1,?,?,?,?,?,?)
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
    SOURCE_PAYMENT,
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

function identityKeys(row: PaymentRow): string[] {
  const keys: string[] = [];
  const idempotency = row.idempotency_key?.trim();
  if (idempotency) keys.push(`idempotency:${idempotency}`);
  const external = row.external_transaction_id?.trim();
  if (external) keys.push(`external:${external}`);
  const receipt = row.receipt_no?.trim();
  if (receipt) keys.push(`receipt:${receipt}`);
  return keys;
}

function isDeferredCdb061Payment(row: PaymentRow): boolean {
  const value = (row.payment_type ?? '').trim().toLowerCase();
  return ['deposit', 'advance', 'credit', 'refund', 'reversal', 'reverse']
    .some((token) => value.includes(token));
}

function tenderType(row: PaymentRow): {
  type: 'cash' | 'card' | 'mobile_wallet' | 'bank_transfer' | 'gateway' | 'other';
  methodCode: string;
} | null {
  const value = (row.payment_method ?? row.payment_type ?? '').trim().toLowerCase();
  if (value === 'cash') return { type: 'cash', methodCode: 'cash' };
  if (value === 'card' || value === 'credit_card' || value === 'debit_card') {
    return { type: 'card', methodCode: value };
  }
  if (['mobile', 'mobile_banking', 'mobile_wallet', 'bkash', 'nagad', 'rocket'].includes(value)) {
    return { type: 'mobile_wallet', methodCode: value };
  }
  if (value === 'bank' || value === 'bank_transfer') {
    return { type: 'bank_transfer', methodCode: value };
  }
  if (value === 'gateway' || value === 'online') {
    return { type: 'gateway', methodCode: value };
  }
  if (value === 'other') return { type: 'other', methodCode: value };
  return null;
}

async function invoiceForPayment(
  ctx: Context,
  row: PaymentRow,
): Promise<InvoiceRow | null> {
  const mapping = await ctx.db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='invoice' AND source_type='legacy_bill'
      AND source_public_id=? LIMIT 1
  `).bind(ctx.tenantId, String(row.bill_id)).first<InvoiceMappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) return null;
  return ctx.db.prepare(`
    SELECT invoice_public_id,legacy_patient_id,currency_code,total_minor,paid_minor,due_minor,
           credited_minor,net_due_minor,status
    FROM canonical_invoices
    WHERE tenant_id=? AND invoice_public_id=? LIMIT 1
  `).bind(ctx.tenantId, mapping.canonical_public_id).first<InvoiceRow>();
}

async function rejectPayment(
  ctx: Context,
  cp: CheckpointRow,
  row: PaymentRow,
  evidence: string,
  code: string,
  summary: string,
): Promise<void> {
  const sourceId = String(row.id);
  await ctx.db.batch([
    ...ENTITY_TYPES.map((entityType) => mapStatement(
      ctx, entityType, null, sourceId, 'ambiguous', evidence,
    )),
    await issueStatement(ctx, code, sourceId, summary, { billId: row.bill_id }),
    progress(ctx, cp, sourceId, 0, 3, 0, 1),
  ]);
}

async function processPayment(
  ctx: Context,
  cp: CheckpointRow,
  row: PaymentRow,
  duplicateSourceIds: ReadonlySet<number>,
): Promise<void> {
  const sourceId = String(row.id);
  const evidence = await paymentEvidence(row);
  const prior = await existing(ctx, 'payment_receipt', sourceId);
  if (prior) {
    if (prior.evidence_sha256 !== evidence) {
      throw new Error(`Payment source evidence drift detected for payment ${sourceId}`);
    }
    await ctx.db.batch([progress(ctx, cp, sourceId, 0, 0, 1, 0)]);
    return;
  }

  if (duplicateSourceIds.has(row.id)) {
    await rejectPayment(
      ctx, cp, row, evidence,
      'PAYMENT_DUPLICATE_RECEIPT_GROUP',
      'Legacy payment identity is shared by multiple source rows and cannot be promoted to one canonical receipt.',
    );
    return;
  }

  if (isDeferredCdb061Payment(row)) {
    await rejectPayment(
      ctx, cp, row, evidence,
      'PAYMENT_SCOPE_DEFERRED_CDB061',
      'Legacy deposit, credit, refund, or reversal remains outside CDB-060 collection authority.',
    );
    return;
  }

  const invoice = await invoiceForPayment(ctx, row);
  if (!invoice) {
    await rejectPayment(
      ctx, cp, row, evidence,
      'PAYMENT_INVOICE_UNRESOLVED',
      'Legacy payment does not have one mapped canonical invoice.',
    );
    return;
  }
  if (invoice.status !== 'posted' || invoice.currency_code !== ctx.currencyCode) {
    await rejectPayment(
      ctx, cp, row, evidence,
      'PAYMENT_INVOICE_UNRESOLVED',
      'Mapped canonical invoice is not eligible for payment allocation.',
    );
    return;
  }

  const tender = tenderType(row);
  if (!tender) {
    await rejectPayment(
      ctx, cp, row, evidence,
      'PAYMENT_METHOD_UNRESOLVED',
      'Legacy payment method cannot be mapped to an approved canonical tender type.',
    );
    return;
  }

  let amountMinor: number;
  try {
    amountMinor = exactMajorToMinor(row.amount, 'payment.amount');
  } catch {
    await rejectPayment(
      ctx, cp, row, evidence,
      'PAYMENT_AMOUNT_UNRESOLVED',
      'Legacy payment amount cannot be converted exactly to positive minor units.',
    );
    return;
  }
  if (amountMinor > invoice.due_minor || amountMinor > invoice.net_due_minor) {
    await rejectPayment(
      ctx, cp, row, evidence,
      'PAYMENT_ALLOCATION_EXCEEDS_OUTSTANDING',
      'Legacy payment exceeds the mapped canonical invoice outstanding balance.',
    );
    return;
  }

  const receiptId = await createDeterministicSourceId('payrcpt', ctx.tenantId, SOURCE_PAYMENT, sourceId);
  const tenderId = await createDeterministicSourceId('paytndr', ctx.tenantId, SOURCE_PAYMENT, sourceId);
  const allocationId = await createDeterministicSourceId('payalloc', ctx.tenantId, SOURCE_PAYMENT, sourceId);
  const receivedAt = legacyUtc(row.date, ctx.nowUtc);
  const receiptNumber = row.receipt_no?.trim() || `LEGACY-PAY-${sourceId}`;

  const paidAfterMinor = invoice.paid_minor + amountMinor;
  const dueAfterMinor = invoice.due_minor - amountMinor;
  const netDueAfterMinor = invoice.net_due_minor - amountMinor;
  await ctx.db.batch([
    ctx.db.prepare(`
      INSERT INTO canonical_payment_receipts (
        tenant_id,receipt_public_id,receipt_number,legacy_patient_id,currency_code,
        total_minor,allocated_total_minor,unallocated_minor,status,received_at_utc,
        business_date,legacy_collector_id,legacy_counter_id,legacy_counter_session_id,
        external_transaction_id,posted_at_utc,refunded_minor,net_received_minor,
        refund_projection_guard,reconciliation_guard,source_evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,0,'posted',?,?,?,?,?,?,?,0,?,1,1,?,?,?)
    `).bind(
      ctx.tenantId,
      receiptId,
      receiptNumber,
      invoice.legacy_patient_id,
      ctx.currencyCode,
      amountMinor,
      amountMinor,
      receivedAt,
      businessDate(row.date, receivedAt),
      row.received_by,
      row.counter_id,
      row.counter_session_id,
      row.external_transaction_id?.trim() || null,
      receivedAt,
      amountMinor,
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
    ctx.db.prepare(`
      INSERT INTO canonical_payment_tenders (
        tenant_id,tender_public_id,receipt_public_id,tender_type,method_code,
        amount_minor,status,external_transaction_id,captured_at_utc,reversed_minor,
        remaining_minor,reversal_projection_guard,source_evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,'captured',?,?,0,?,1,?,?,?)
    `).bind(
      ctx.tenantId,
      tenderId,
      receiptId,
      tender.type,
      tender.methodCode,
      amountMinor,
      row.external_transaction_id?.trim() || null,
      receivedAt,
      amountMinor,
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
    ctx.db.prepare(`
      INSERT INTO canonical_payment_allocations (
        tenant_id,allocation_public_id,receipt_public_id,invoice_public_id,
        amount_minor,invoice_due_before_minor,invoice_due_after_minor,status,
        allocated_at_utc,reversed_minor,remaining_minor,reversal_projection_guard,
        balance_guard,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,'active',?,0,?,1,1,?,?,?)
    `).bind(
      ctx.tenantId,
      allocationId,
      receiptId,
      invoice.invoice_public_id,
      amountMinor,
      invoice.due_minor,
      dueAfterMinor,
      receivedAt,
      amountMinor,
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
    ctx.db.prepare(`
      UPDATE canonical_invoices
      SET paid_minor=?,due_minor=?,net_due_minor=?,updated_at_utc=?
      WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
        AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
    `).bind(
      paidAfterMinor,
      dueAfterMinor,
      netDueAfterMinor,
      receivedAt,
      ctx.tenantId,
      invoice.invoice_public_id,
      invoice.paid_minor,
      invoice.due_minor,
      invoice.credited_minor,
      invoice.net_due_minor,
    ),
    ctx.db.prepare(`
      UPDATE canonical_payment_allocations
      SET balance_guard=CASE WHEN EXISTS (
        SELECT 1 FROM canonical_invoices
        WHERE tenant_id=? AND invoice_public_id=? AND status='posted'
          AND paid_minor=? AND due_minor=? AND credited_minor=? AND net_due_minor=?
      ) THEN 1 ELSE 0 END
      WHERE tenant_id=? AND allocation_public_id=?
    `).bind(
      ctx.tenantId,
      invoice.invoice_public_id,
      paidAfterMinor,
      dueAfterMinor,
      invoice.credited_minor,
      netDueAfterMinor,
      ctx.tenantId,
      allocationId,
    ),
    mapStatement(ctx, 'payment_receipt', receiptId, sourceId, 'mapped', evidence),
    mapStatement(ctx, 'payment_tender', tenderId, sourceId, 'mapped', evidence),
    mapStatement(ctx, 'payment_allocation', allocationId, sourceId, 'mapped', evidence),
    ctx.db.prepare(`
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
        AND NOT EXISTS (
          SELECT 1 FROM canonical_payment_tenders
          WHERE tenant_id=? AND receipt_public_id=? AND status<>'captured'
        )
      ) THEN 1 ELSE 0 END
      WHERE tenant_id=? AND receipt_public_id=?
    `).bind(
      ctx.tenantId,
      receiptId,
      ctx.tenantId,
      receiptId,
      ctx.tenantId,
      receiptId,
      ctx.tenantId,
      receiptId,
    ),
    progress(ctx, cp, sourceId, 3, 3, 0, 0),
  ]);
}

async function finish(ctx: Context, cp: CheckpointRow): Promise<void> {
  const summary = JSON.stringify({ domain: 'payments', completed: true });
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

export async function backfillPayments(
  db: PaymentBackfillDatabase,
  options: PaymentBackfillOptions,
): Promise<PaymentBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const currencyCode = currency(options.currencyCode);
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
  const limit = positiveLimit(options.maxSourceRecords);
  const start = await capture(db, tenantId);
  const run = await ensureRun(db, tenantId, runPublicId, nowUtc);
  if (run.status === 'succeeded') return result(db, tenantId, start, 0, true);

  const ctx: Context = {
    db,
    tenantId,
    runId: run.id,
    runPublicId,
    currencyCode,
    nowUtc,
  };
  const cp = await checkpoint(ctx);
  const rows = await all<PaymentRow>(db.prepare(`
    SELECT id,bill_id,amount,payment_type,settlement_type_id,receipt_no,
           idempotency_key,external_transaction_id,received_by,payment_method,
           counter_id,counter_session_id,date
    FROM payments
    WHERE CAST(tenant_id AS TEXT)=?
    ORDER BY id
  `).bind(tenantId));

  const identityCounts = new Map<string, number>();
  for (const row of rows) {
    for (const key of identityKeys(row)) {
      identityCounts.set(key, (identityCounts.get(key) ?? 0) + 1);
    }
  }
  const duplicateSourceIds = new Set(
    rows
      .filter((row) => identityKeys(row).some((key) => (identityCounts.get(key) ?? 0) > 1))
      .map((row) => row.id),
  );

  const cursor = Number(cp.cursor_value ?? 0);
  const pending = rows.filter((row) => row.id > cursor).slice(0, limit);
  let scanned = 0;
  for (const row of pending) {
    await processPayment(ctx, cp, row, duplicateSourceIds);
    scanned += 1;
  }

  const remaining = rows.some((row) => row.id > Number(pending.at(-1)?.id ?? cursor));
  if (!remaining) await finish(ctx, cp);
  return result(db, tenantId, start, scanned, !remaining);
}
