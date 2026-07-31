import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface InvoiceBackfillPreparedStatement {
  bind(...values: unknown[]): InvoiceBackfillPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface InvoiceBackfillDatabase {
  prepare(sql: string): InvoiceBackfillPreparedStatement;
  batch(statements: InvoiceBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface InvoiceBackfillOptions {
  tenantId: string;
  runPublicId: string;
  currencyCode: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface InvoiceBackfillCounts {
  scanned: number;
  invoicesCreated: number;
  linesCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
}

export interface InvoiceBackfillResult {
  completed: boolean;
  counts: InvoiceBackfillCounts;
}

interface RunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}
interface LiveProjectedInvoiceRow {
  invoice_public_id: string;
  legacy_patient_id: number;
  currency_code: string;
  total_minor: number;
  status: string;
}
interface BillRow {
  id: number;
  patient_id: number;
  invoice_no: string | null;
  invoice_code: string | null;
  discount: number | null;
  tax_total: number | null;
  total: number | null;
  status: string | null;
  cancelled_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}
interface ItemRow {
  id: number;
  item_category: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  reference_id: number | null;
  status: string | null;
  cancelled_at: string | null;
  tax_amount: number | null;
  created_at: string | null;
}
interface StartCounts {
  invoices: number;
  lines: number;
  mappings: number;
  issues: number;
}
interface Context {
  db: InvoiceBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  currencyCode: string;
  nowUtc: string;
  remaining: number;
  scanned: number;
}
interface PreparedLine {
  row: ItemRow;
  evidence: string;
  eventPublicId: string;
  quantity: number;
  unitMinor: number;
  grossMinor: number;
  discountMinor: number;
  taxMinor: number;
  sourceType?: string;
  sourceId?: string;
  sourceTable?: string;
}

const SOURCE_BILL = 'legacy_bill';
const SOURCE_ITEM = 'legacy_invoice_item';
const SOURCE_HEADER_DELIVERY_EVENT = 'legacy_bill_header_delivery';

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
  if (!Number.isInteger(value) || value <= 0) throw new RangeError('maxSourceRecords must be a positive integer');
  return value;
}

function legacyUtc(value: string | null | undefined, fallback: string): string {
  if (!value?.trim()) return fallback;
  const raw = value.trim();
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
  if (/(?:Z|[+-]\d{2}:\d{2})$/i.test(iso)) return toUtcIso(iso);
  return toUtcIso(`${iso}+06:00`);
}

function safeMajorIntegerToMinor(value: number | null, label: string): number {
  if (value == null || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer major-unit amount`);
  }
  const result = BigInt(value) * 100n;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`${label} exceeds safe range`);
  return Number(result);
}

function exactMajorToMinor(value: number | null, label: string): number {
  if (value == null || !Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite amount`);
  }
  try {
    return Number(toMinorUnits(String(value)));
  } catch (error) {
    throw new RangeError(`${label} cannot be converted exactly to minor units`, { cause: error });
  }
}

function safeAdd(total: bigint, value: number, label: string): bigint {
  const result = total + BigInt(value);
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (result > max || result < -max) throw new RangeError(`${label} exceeds safe range`);
  return result;
}

function isCancelledLine(row: ItemRow): boolean {
  return row.cancelled_at != null || (row.status ?? '').trim().toLowerCase() === 'cancelled';
}

async function all<T>(statement: InvoiceBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function tableCount(
  db: InvoiceBackfillDatabase,
  table: string,
  tenantId: string,
  tail = '',
): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?${tail}`)
    .bind(tenantId).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function capture(db: InvoiceBackfillDatabase, tenantId: string): Promise<StartCounts> {
  return {
    invoices: await tableCount(db, 'canonical_invoices', tenantId),
    lines: await tableCount(db, 'canonical_invoice_lines', tenantId),
    mappings: await tableCount(
      db,
      'canonical_source_mappings',
      tenantId,
      " AND entity_type IN ('invoice','invoice_line')",
    ),
    issues: await tableCount(
      db,
      'canonical_processing_issues',
      tenantId,
      " AND issue_type='invoice_backfill'",
    ),
  };
}

async function result(
  db: InvoiceBackfillDatabase,
  tenantId: string,
  start: StartCounts,
  scanned: number,
  completed: boolean,
): Promise<InvoiceBackfillResult> {
  const end = await capture(db, tenantId);
  return {
    completed,
    counts: {
      scanned,
      invoicesCreated: end.invoices - start.invoices,
      linesCreated: end.lines - start.lines,
      mappingsCreated: end.mappings - start.mappings,
      issuesCreated: end.issues - start.issues,
    },
  };
}

async function ensureRun(
  db: InvoiceBackfillDatabase,
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
      ) VALUES (?,?,'0510_canonical_invoices.sql','backfill','running',?,?,?)
    `).bind(tenantId, runPublicId, nowUtc, nowUtc, nowUtc).run();
    row = await db.prepare(
      'SELECT id,status FROM canonical_migration_runs WHERE tenant_id=? AND run_public_id=? LIMIT 1',
    ).bind(tenantId, runPublicId).first<RunRow>();
  }
  if (!row) throw new Error('Failed to create invoice migration run');
  if (row.status === 'failed' || row.status === 'cancelled') {
    throw new Error(`Invoice backfill run is terminal: ${row.status}`);
  }
  return row;
}

async function checkpoint(ctx: Context): Promise<CheckpointRow> {
  let row = await ctx.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type='invoice'
      AND source_type=? AND partition_key='' LIMIT 1
  `).bind(ctx.tenantId, ctx.runId, SOURCE_BILL).first<CheckpointRow>();
  if (!row) {
    const publicId = await createDeterministicSourceId(
      'chk', ctx.tenantId, 'invoice_backfill', ctx.runPublicId,
    );
    await ctx.db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,status,started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'invoice',?,'','running',?,?,?)
    `).bind(
      ctx.tenantId, publicId, ctx.runId, SOURCE_BILL,
      ctx.nowUtc, ctx.nowUtc, ctx.nowUtc,
    ).run();
    row = await ctx.db.prepare(`
      SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type='invoice'
        AND source_type=? AND partition_key='' LIMIT 1
    `).bind(ctx.tenantId, ctx.runId, SOURCE_BILL).first<CheckpointRow>();
  }
  if (!row) throw new Error('Failed to create invoice checkpoint');
  if (row.status === 'paused') {
    await ctx.db.prepare(`
      UPDATE canonical_backfill_checkpoints
      SET status='running',completed_at_utc=NULL,updated_at_utc=?
      WHERE tenant_id=? AND id=?
    `).bind(ctx.nowUtc, ctx.tenantId, row.id).run();
    row.status = 'running';
  }
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
): InvoiceBackfillPreparedStatement {
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
  entityType: 'invoice' | 'invoice_line',
  sourceType: string,
  sourceId: string,
): Promise<MappingRow | null> {
  return ctx.db.prepare(`
    SELECT canonical_public_id,mapping_status,evidence_sha256
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=? LIMIT 1
  `).bind(ctx.tenantId, entityType, sourceType, sourceId).first<MappingRow>();
}

function mapStatement(
  ctx: Context,
  entityType: 'invoice' | 'invoice_line',
  canonicalId: string | null,
  sourceType: string,
  sourceId: string,
  sourceTable: string,
  status: 'mapped' | 'ambiguous' | 'rejected',
  evidence: string,
): InvoiceBackfillPreparedStatement {
  return ctx.db.prepare(`
    INSERT INTO canonical_source_mappings (
      tenant_id,entity_type,canonical_public_id,source_type,source_public_id,
      source_table,mapping_status,mapping_version,migration_run_id,evidence_sha256,
      created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,1,?,?,?,?)
    ON CONFLICT(tenant_id,entity_type,source_type,source_public_id) DO UPDATE SET
      canonical_public_id=excluded.canonical_public_id,
      source_table=excluded.source_table,
      mapping_status=excluded.mapping_status,
      mapping_version=canonical_source_mappings.mapping_version+1,
      migration_run_id=excluded.migration_run_id,
      evidence_sha256=excluded.evidence_sha256,
      updated_at_utc=excluded.updated_at_utc
    WHERE canonical_source_mappings.mapping_status='ambiguous'
      AND canonical_source_mappings.evidence_sha256=excluded.evidence_sha256
  `).bind(
    ctx.tenantId, entityType, canonicalId, sourceType, sourceId, sourceTable,
    status, ctx.runId, evidence, ctx.nowUtc, ctx.nowUtc,
  );
}

function resolvePriorIssues(
  ctx: Context,
  billId: string,
): InvoiceBackfillPreparedStatement {
  return ctx.db.prepare(`
    UPDATE canonical_processing_issues
    SET status='resolved',resolved_at_utc=?,resolved_by_public_id='canonical-backfill',
        resolution_code='RETRIED_WITH_TYPED_EVENT',updated_at_utc=?
    WHERE tenant_id=? AND issue_type='invoice_backfill'
      AND source_type=? AND source_public_id=?
      AND issue_code IN (
        'INVOICE_TYPED_LINE_UNRESOLVED',
        'INVOICE_SERVICE_EVENT_ALREADY_BILLED',
        'INVOICE_FINANCIAL_VARIANCE'
      )
      AND status IN ('open','acknowledged')
  `).bind(ctx.nowUtc, ctx.nowUtc, ctx.tenantId, SOURCE_BILL, billId);
}

async function issue(
  ctx: Context,
  code: string,
  billId: string,
  summary: string,
  details?: Record<string, number | string>,
): Promise<InvoiceBackfillPreparedStatement> {
  const fingerprint = await createDeterministicSourceId('fp', ctx.tenantId, code, billId);
  const issuePublicId = await createDeterministicSourceId('iss', ctx.tenantId, code, billId);
  return ctx.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,entity_type,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,
      summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'invoice_backfill',?,'invoice',?,?,?,
              'error','open',1,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      migration_run_id=excluded.migration_run_id,
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      last_seen_at_utc=excluded.last_seen_at_utc,
      details_json=excluded.details_json,
      updated_at_utc=excluded.updated_at_utc
  `).bind(
    ctx.tenantId, issuePublicId, ctx.runId, code, SOURCE_BILL, billId,
    fingerprint, summary, details ? JSON.stringify(details) : null,
    ctx.nowUtc, ctx.nowUtc, ctx.nowUtc, ctx.nowUtc,
  );
}

async function mappedEvent(
  ctx: Context,
  row: ItemRow,
): Promise<{ eventId: string | null; ambiguous: boolean }> {
  const historicalDelivery = await ctx.db.prepare(`
    SELECT canonical_public_id
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='service_event'
      AND source_type='legacy_invoice_item_delivery'
      AND source_public_id=? AND mapping_status='mapped'
    LIMIT 1
  `).bind(ctx.tenantId, String(row.id)).first<{ canonical_public_id: string | null }>();
  if (historicalDelivery?.canonical_public_id) {
    return { eventId: historicalDelivery.canonical_public_id, ambiguous: false };
  }
  if (row.reference_id == null) return { eventId: null, ambiguous: false };
  const candidates: Array<{ sourceType: string; sourceTable: string; joinSql: string }> = [];
  switch ((row.item_category ?? '').toLowerCase()) {
    case 'test':
      candidates.push(
        { sourceType: 'legacy_lab_order_item', sourceTable: 'lab_order_items', joinSql: 'SELECT COUNT(*) count FROM lab_order_items WHERE id=? AND CAST(tenant_id AS TEXT)=?' },
        { sourceType: 'legacy_radiology_requisition', sourceTable: 'radiology_requisitions', joinSql: 'SELECT COUNT(*) count FROM radiology_requisitions WHERE id=? AND CAST(tenant_id AS TEXT)=?' },
      );
      break;
    case 'procedure':
    case 'operation':
      candidates.push({ sourceType: 'legacy_procedure_order', sourceTable: 'procedure_orders', joinSql: 'SELECT COUNT(*) count FROM procedure_orders WHERE id=? AND CAST(tenant_id AS TEXT)=?' });
      break;
    case 'admission':
      candidates.push({ sourceType: 'legacy_bed_stay_operation', sourceTable: 'patient_bed_infos', joinSql: 'SELECT COUNT(*) count FROM patient_bed_infos WHERE id=? AND CAST(tenant_id AS TEXT)=?' });
      break;
    case 'medicine':
      candidates.push({ sourceType: 'legacy_prescription_item', sourceTable: 'prescription_items', joinSql: 'SELECT COUNT(*) count FROM prescription_items i JOIN prescriptions p ON p.id=i.prescription_id WHERE i.id=? AND CAST(p.tenant_id AS TEXT)=?' });
      break;
    case 'doctor_visit':
      candidates.push({ sourceType: 'legacy_consultation_operation', sourceTable: 'consultations', joinSql: 'SELECT COUNT(*) count FROM consultations WHERE id=? AND CAST(tenant_id AS TEXT)=?' });
      break;
    default:
      return { eventId: null, ambiguous: false };
  }

  const eventIds = new Set<string>();
  for (const candidate of candidates) {
    const exists = await ctx.db.prepare(candidate.joinSql)
      .bind(row.reference_id, ctx.tenantId).first<CountRow>();
    if (Number(exists?.count ?? 0) !== 1) continue;
    const mapping = await ctx.db.prepare(`
      SELECT canonical_public_id FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='service_event' AND source_type=?
        AND source_public_id=? AND mapping_status='mapped'
    `).bind(ctx.tenantId, candidate.sourceType, String(row.reference_id))
      .first<{ canonical_public_id: string | null }>();
    if (mapping?.canonical_public_id) eventIds.add(mapping.canonical_public_id);
  }
  if (eventIds.size === 1) return { eventId: [...eventIds][0], ambiguous: false };
  return { eventId: null, ambiguous: eventIds.size > 1 };
}

async function lineEvidence(row: ItemRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_ITEM,
    sourcePublicId: String(row.id),
    category: row.item_category,
    quantity: row.quantity,
    unitPriceMajor: row.unit_price,
    lineTotalMajor: row.line_total,
    referenceId: row.reference_id,
    status: row.status,
    cancelledAt: row.cancelled_at,
    taxMajor: row.tax_amount,
  });
}

async function classifyLines(
  ctx: Context,
  rows: ItemRow[],
): Promise<{
  prepared: PreparedLine[];
  lineEvidenceById: Map<number, string>;
  failure: 'typed' | 'financial' | 'event_claim' | null;
}> {
  const prepared: PreparedLine[] = [];
  const lineEvidenceById = new Map<number, string>();
  const events = new Set<string>();

  for (const row of rows) {
    const evidence = await lineEvidence(row);
    lineEvidenceById.set(row.id, evidence);
    let quantity: number;
    let unitMinor: number;
    let netMinor: number;
    let taxMinor: number;
    try {
      if (!Number.isSafeInteger(row.quantity) || Number(row.quantity) <= 0) throw new Error();
      quantity = Number(row.quantity);
      unitMinor = safeMajorIntegerToMinor(row.unit_price, 'unit_price');
      netMinor = safeMajorIntegerToMinor(row.line_total, 'line_total');
      taxMinor = exactMajorToMinor(row.tax_amount ?? 0, 'tax_amount');
    } catch {
      return { prepared, lineEvidenceById, failure: 'financial' };
    }
    const gross = BigInt(quantity) * BigInt(unitMinor);
    if (gross > BigInt(Number.MAX_SAFE_INTEGER) || BigInt(netMinor) > gross) {
      return { prepared, lineEvidenceById, failure: 'financial' };
    }
    const resolved = await mappedEvent(ctx, row);
    if (!resolved.eventId || resolved.ambiguous) {
      return { prepared, lineEvidenceById, failure: 'typed' };
    }
    if (events.has(resolved.eventId)) {
      return { prepared, lineEvidenceById, failure: 'event_claim' };
    }
    events.add(resolved.eventId);
    const claimed = await ctx.db.prepare(`
      SELECT COUNT(*) count FROM canonical_invoice_lines
      WHERE tenant_id=? AND service_event_public_id=?
    `).bind(ctx.tenantId, resolved.eventId).first<CountRow>();
    if (Number(claimed?.count ?? 0) > 0) {
      return { prepared, lineEvidenceById, failure: 'event_claim' };
    }
    prepared.push({
      row,
      evidence,
      eventPublicId: resolved.eventId,
      quantity,
      unitMinor,
      grossMinor: Number(gross),
      discountMinor: Number(gross) - netMinor,
      taxMinor,
    });
  }
  return { prepared, lineEvidenceById, failure: null };
}

async function rejectBill(
  ctx: Context,
  cp: CheckpointRow,
  bill: BillRow,
  rows: ItemRow[],
  evidence: string,
  lineEvidenceById: Map<number, string>,
  code: string,
  summary: string,
  details?: Record<string, number | string>,
): Promise<void> {
  const statements: InvoiceBackfillPreparedStatement[] = [
    mapStatement(ctx, 'invoice', null, SOURCE_BILL, String(bill.id), 'bills', 'ambiguous', evidence),
  ];
  for (const row of rows) {
    statements.push(mapStatement(
      ctx,
      'invoice_line',
      null,
      SOURCE_ITEM,
      String(row.id),
      'invoice_items',
      isCancelledLine(row) ? 'rejected' : 'ambiguous',
      lineEvidenceById.get(row.id) ?? await lineEvidence(row),
    ));
  }
  statements.push(
    await issue(ctx, code, String(bill.id), summary, details),
    progress(ctx, cp, String(bill.id), 0, 1 + rows.length, 0, 1),
  );
  await ctx.db.batch(statements);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

function invoiceStatement(
  ctx: Context,
  input: {
    publicId: string;
    number: string;
    patientId: number;
    subtotalMinor: number;
    adjustmentMinor: number;
    totalMinor: number;
    status: string;
    issuedAtUtc: string;
    cancelledAtUtc: string | null;
    evidence: string;
  },
): InvoiceBackfillPreparedStatement {
  return ctx.db.prepare(`
    INSERT INTO canonical_invoices (
      tenant_id,invoice_public_id,invoice_number,legacy_patient_id,currency_code,
      subtotal_minor,adjustment_total_minor,total_minor,paid_minor,due_minor,credited_minor,
      net_due_minor,adjustment_projection_guard,status,issued_at_utc,posted_at_utc,
      cancelled_at_utc,source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,?,?,?)
  `).bind(
    ctx.tenantId, input.publicId, input.number, input.patientId, ctx.currencyCode,
    input.subtotalMinor, input.adjustmentMinor, input.totalMinor, 0, input.totalMinor,
    0, input.totalMinor, input.status, input.issuedAtUtc,
    input.status === 'draft' ? null : input.issuedAtUtc,
    input.cancelledAtUtc, input.evidence, ctx.nowUtc, ctx.nowUtc,
  );
}

function invoiceLineStatement(
  ctx: Context,
  input: {
    lineId: string;
    invoiceId: string;
    type: string;
    eventId?: string | null;
    adjustmentCode?: string | null;
    quantity: number;
    unitMinor: number;
    amountMinor: number;
    evidence: string;
  },
): InvoiceBackfillPreparedStatement {
  return ctx.db.prepare(`
    INSERT INTO canonical_invoice_lines (
      tenant_id,line_public_id,invoice_public_id,line_type,service_event_public_id,
      adjustment_code,quantity,unit_amount_minor,line_amount_minor,
      source_evidence_sha256,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    ctx.tenantId, input.lineId, input.invoiceId, input.type,
    input.eventId ?? null, input.adjustmentCode ?? null, input.quantity,
    input.unitMinor, input.amountMinor, input.evidence, ctx.nowUtc, ctx.nowUtc,
  );
}

async function processBill(
  ctx: Context,
  cp: CheckpointRow,
  bill: BillRow,
  duplicateNumbers: Set<string>,
): Promise<void> {
  const sourceId = String(bill.id);
  const rows = await all<ItemRow>(ctx.db.prepare(`
    SELECT id,item_category,quantity,unit_price,line_total,reference_id,status,
           cancelled_at,tax_amount,created_at
    FROM invoice_items
    WHERE bill_id=? AND CAST(tenant_id AS TEXT)=?
    ORDER BY id
  `).bind(bill.id, ctx.tenantId));
  const activeRows = rows.filter((row) => !isCancelledLine(row));
  const cancelledRows = rows.filter(isCancelledLine);
  const evidence = await createSourceEvidenceSha256({
    sourceType: SOURCE_BILL,
    sourcePublicId: sourceId,
    patientId: bill.patient_id,
    invoiceNo: bill.invoice_no,
    invoiceCode: bill.invoice_code,
    discountMajor: bill.discount,
    taxMajor: bill.tax_total,
    totalMajor: bill.total,
    status: bill.status,
    cancelledAt: bill.cancelled_at,
    lines: rows.map((row) => ({
      id: row.id,
      category: row.item_category,
      quantity: row.quantity,
      unitPriceMajor: row.unit_price,
      lineTotalMajor: row.line_total,
      referenceId: row.reference_id,
      status: row.status,
      cancelledAt: row.cancelled_at,
      taxMajor: row.tax_amount,
    })),
  });
  const prior = await existing(ctx, 'invoice', SOURCE_BILL, sourceId);
  if (prior) {
    if (prior.evidence_sha256 !== evidence) {
      await ctx.db.batch([
        await issue(
          ctx,
          'INVOICE_SOURCE_EVIDENCE_CHANGED',
          sourceId,
          'Previously mapped invoice source evidence changed and requires review.',
        ),
        progress(ctx, cp, sourceId, 0, 0, 1, 1),
      ]);
      ctx.scanned += 1;
      ctx.remaining -= 1;
      return;
    }
    if (prior.mapping_status !== 'ambiguous') {
      await ctx.db.batch([progress(ctx, cp, sourceId, 0, 0, 1, 0)]);
      ctx.scanned += 1;
      ctx.remaining -= 1;
      return;
    }
  }

  const number = (bill.invoice_no ?? bill.invoice_code ?? '').trim();
  let headerDiscount: number;
  let headerTax: number;
  let headerTotal: number;
  try {
    headerDiscount = exactMajorToMinor(bill.discount ?? 0, 'bill discount');
    headerTax = exactMajorToMinor(bill.tax_total ?? 0, 'bill tax');
    headerTotal = exactMajorToMinor(bill.total, 'bill total');
  } catch {
    await rejectBill(
      ctx, cp, bill, rows, evidence, new Map<number, string>(),
      'INVOICE_FINANCIAL_VARIANCE',
      'Invoice header amounts cannot be converted exactly to minor units.',
    );
    return;
  }

  let lineClassification: Awaited<ReturnType<typeof classifyLines>>;
  if (activeRows.length === 0) {
    const headerDelivery = await ctx.db.prepare(`
      SELECT m.canonical_public_id,m.evidence_sha256
      FROM canonical_source_mappings m
      JOIN canonical_service_events e
        ON e.tenant_id=m.tenant_id AND e.event_public_id=m.canonical_public_id
      WHERE m.tenant_id=? AND m.entity_type='service_event'
        AND m.source_type=? AND m.source_public_id=?
        AND m.mapping_status='mapped'
      LIMIT 1
    `).bind(ctx.tenantId, SOURCE_HEADER_DELIVERY_EVENT, sourceId)
      .first<{ canonical_public_id: string | null; evidence_sha256: string | null }>();
    const headerGross = headerTotal + headerDiscount - headerTax;
    const claimed = headerDelivery?.canonical_public_id
      ? await ctx.db.prepare(`
          SELECT COUNT(*) count FROM canonical_invoice_lines
          WHERE tenant_id=? AND service_event_public_id=?
        `).bind(ctx.tenantId, headerDelivery.canonical_public_id).first<CountRow>()
      : null;
    const syntheticRow: ItemRow = {
      id: bill.id,
      item_category: 'other',
      quantity: 1,
      unit_price: 0,
      line_total: 0,
      reference_id: null,
      status: 'active',
      cancelled_at: null,
      tax_amount: 0,
      created_at: bill.created_at,
    };
    lineClassification = headerDelivery?.canonical_public_id
      && headerDelivery.evidence_sha256
      && Number.isSafeInteger(headerGross)
      && headerGross >= 0
      ? {
          prepared: [{
            row: syntheticRow,
            evidence: headerDelivery.evidence_sha256,
            eventPublicId: headerDelivery.canonical_public_id,
            quantity: 1,
            unitMinor: headerGross,
            grossMinor: headerGross,
            discountMinor: 0,
            taxMinor: 0,
            sourceType: SOURCE_HEADER_DELIVERY_EVENT,
            sourceId,
            sourceTable: 'bills',
          }],
          lineEvidenceById: new Map<number, string>(),
          failure: Number(claimed?.count ?? 0) > 0 ? 'event_claim' : null,
        }
      : {
          prepared: [],
          lineEvidenceById: new Map<number, string>(),
          failure: 'typed',
        };
  } else {
    lineClassification = await classifyLines(ctx, activeRows);
  }

  if (!number || duplicateNumbers.has(number)) {
    await rejectBill(
      ctx, cp, bill, rows, evidence, lineClassification.lineEvidenceById,
      'INVOICE_DUPLICATE_OR_MISSING_NUMBER',
      'Invoice number is missing or duplicated within the tenant.',
    );
    return;
  }
  if (lineClassification.failure === 'typed') {
    await rejectBill(
      ctx, cp, bill, rows, evidence, lineClassification.lineEvidenceById,
      'INVOICE_TYPED_LINE_UNRESOLVED',
      'One or more invoice lines have no unique typed delivered service event.',
    );
    return;
  }
  if (lineClassification.failure === 'event_claim') {
    await rejectBill(
      ctx, cp, bill, rows, evidence, lineClassification.lineEvidenceById,
      'INVOICE_SERVICE_EVENT_ALREADY_BILLED',
      'A delivered service event is duplicated within the invoice or already claimed.',
    );
    return;
  }
  if (lineClassification.failure === 'financial') {
    await rejectBill(
      ctx, cp, bill, rows, evidence, lineClassification.lineEvidenceById,
      'INVOICE_FINANCIAL_VARIANCE',
      'Invoice line quantities or stored amounts cannot be reconciled exactly.',
    );
    return;
  }

  let subtotal = 0n;
  let discounts = 0n;
  let taxes = 0n;
  for (const line of lineClassification.prepared) {
    subtotal = safeAdd(subtotal, line.grossMinor, 'invoice subtotal');
    discounts = safeAdd(discounts, line.discountMinor, 'invoice discount');
    taxes = safeAdd(taxes, line.taxMinor, 'invoice tax');
  }
  const effectiveDiscount = Math.max(headerDiscount, Number(discounts));
  const effectiveTax = Math.max(headerTax, Number(taxes));
  const headerOnlyDiscount = effectiveDiscount - Number(discounts);
  const headerOnlyTax = effectiveTax - Number(taxes);
  const calculatedTotal = subtotal - BigInt(effectiveDiscount) + BigInt(effectiveTax);
  if (headerTotal !== Number(calculatedTotal)) {
    await rejectBill(
      ctx, cp, bill, rows, evidence, lineClassification.lineEvidenceById,
      'INVOICE_FINANCIAL_VARIANCE',
      'Invoice header does not reconcile exactly to typed lines and explicit header adjustments.',
      {
        headerTotalMinor: headerTotal,
        calculatedTotalMinor: Number(calculatedTotal),
      },
    );
    return;
  }

  const issuedAt = legacyUtc(bill.created_at, ctx.nowUtc);
  const cancelled = bill.cancelled_at != null
    || (bill.status ?? '').toLowerCase() === 'cancelled';
  const status = cancelled ? 'cancelled' : 'posted';
  const liveProjected = await ctx.db.prepare(`
    SELECT ci.invoice_public_id,ci.legacy_patient_id,ci.currency_code,ci.total_minor,ci.status
    FROM canonical_invoices ci
    JOIN canonical_source_mappings m
      ON m.tenant_id=ci.tenant_id
     AND m.entity_type='invoice'
     AND m.canonical_public_id=ci.invoice_public_id
     AND m.source_type='legacy_live_bill'
     AND m.source_public_id=?
     AND m.mapping_status='mapped'
    WHERE ci.tenant_id=? AND ci.invoice_number=?
    LIMIT 1
  `).bind(number, ctx.tenantId, number).first<LiveProjectedInvoiceRow>();
  if (liveProjected) {
    const compatible = Number(liveProjected.legacy_patient_id) === Number(bill.patient_id)
      && liveProjected.currency_code === ctx.currencyCode
      && Number(liveProjected.total_minor) === headerTotal
      && liveProjected.status === status;
    if (!compatible) {
      await rejectBill(
        ctx, cp, bill, rows, evidence, lineClassification.lineEvidenceById,
        'INVOICE_LIVE_PROJECTION_CONFLICT',
        'A live-projected canonical invoice with this number conflicts with the legacy invoice authority.',
        {
          legacyPatientId: Number(bill.patient_id),
          canonicalPatientId: Number(liveProjected.legacy_patient_id),
          legacyTotalMinor: headerTotal,
          canonicalTotalMinor: Number(liveProjected.total_minor),
        },
      );
      return;
    }
    await ctx.db.batch([
      mapStatement(ctx, 'invoice', liveProjected.invoice_public_id, SOURCE_BILL, sourceId, 'bills', 'mapped', evidence),
      progress(ctx, cp, sourceId, 0, 1, 0, 0),
    ]);
    ctx.scanned += 1;
    ctx.remaining -= 1;
    return;
  }

  const invoiceId = await createDeterministicSourceId('inv', ctx.tenantId, SOURCE_BILL, sourceId);
  const statements: InvoiceBackfillPreparedStatement[] = [
    invoiceStatement(ctx, {
      publicId: invoiceId,
      number,
      patientId: bill.patient_id,
      subtotalMinor: Number(subtotal),
      adjustmentMinor: -effectiveDiscount + effectiveTax,
      totalMinor: headerTotal,
      status,
      issuedAtUtc: issuedAt,
      cancelledAtUtc: cancelled ? legacyUtc(bill.cancelled_at ?? bill.updated_at, ctx.nowUtc) : null,
      evidence,
    }),
    mapStatement(ctx, 'invoice', invoiceId, SOURCE_BILL, sourceId, 'bills', 'mapped', evidence),
  ];
  let createdLines = 0;
  for (const line of lineClassification.prepared) {
    const sourceLineId = line.sourceId ?? String(line.row.id);
    const sourceLineType = line.sourceType ?? SOURCE_ITEM;
    const sourceLineTable = line.sourceTable ?? 'invoice_items';
    const serviceLineId = await createDeterministicSourceId(
      'invl', ctx.tenantId, sourceLineType, `${sourceLineId}:service`,
    );
    statements.push(
      invoiceLineStatement(ctx, {
        lineId: serviceLineId,
        invoiceId,
        type: 'service',
        eventId: line.eventPublicId,
        quantity: line.quantity,
        unitMinor: line.unitMinor,
        amountMinor: line.grossMinor,
        evidence: line.evidence,
      }),
      mapStatement(
        ctx, 'invoice_line', serviceLineId, sourceLineType, sourceLineId,
        sourceLineTable, 'mapped', line.evidence,
      ),
    );
    createdLines += 1;
    if (line.discountMinor > 0) {
      const discountId = await createDeterministicSourceId(
        'invl', ctx.tenantId, sourceLineType, `${sourceLineId}:discount`,
      );
      statements.push(invoiceLineStatement(ctx, {
        lineId: discountId,
        invoiceId,
        type: 'discount',
        adjustmentCode: 'LEGACY_LINE_DISCOUNT',
        quantity: 1,
        unitMinor: -line.discountMinor,
        amountMinor: -line.discountMinor,
        evidence: line.evidence,
      }));
      createdLines += 1;
    }
    if (line.taxMinor > 0) {
      const taxId = await createDeterministicSourceId(
        'invl', ctx.tenantId, sourceLineType, `${sourceLineId}:tax`,
      );
      statements.push(invoiceLineStatement(ctx, {
        lineId: taxId,
        invoiceId,
        type: 'tax',
        adjustmentCode: 'LEGACY_LINE_TAX',
        quantity: 1,
        unitMinor: line.taxMinor,
        amountMinor: line.taxMinor,
        evidence: line.evidence,
      }));
      createdLines += 1;
    }
  }
  if (headerOnlyDiscount > 0) {
    const headerDiscountId = await createDeterministicSourceId(
      'invl', ctx.tenantId, SOURCE_BILL, `${sourceId}:header-discount`,
    );
    statements.push(invoiceLineStatement(ctx, {
      lineId: headerDiscountId,
      invoiceId,
      type: 'discount',
      adjustmentCode: 'LEGACY_HEADER_DISCOUNT',
      quantity: 1,
      unitMinor: -headerOnlyDiscount,
      amountMinor: -headerOnlyDiscount,
      evidence,
    }));
    createdLines += 1;
  }
  if (headerOnlyTax > 0) {
    const headerTaxId = await createDeterministicSourceId(
      'invl', ctx.tenantId, SOURCE_BILL, `${sourceId}:header-tax`,
    );
    statements.push(invoiceLineStatement(ctx, {
      lineId: headerTaxId,
      invoiceId,
      type: 'tax',
      adjustmentCode: 'LEGACY_HEADER_TAX',
      quantity: 1,
      unitMinor: headerOnlyTax,
      amountMinor: headerOnlyTax,
      evidence,
    }));
    createdLines += 1;
  }
  for (const row of cancelledRows) {
    statements.push(mapStatement(
      ctx,
      'invoice_line',
      null,
      SOURCE_ITEM,
      String(row.id),
      'invoice_items',
      'rejected',
      await lineEvidence(row),
    ));
  }
  if (cancelledRows.length > 0) {
    statements.push(await issue(
      ctx,
      'INVOICE_CANCELLED_LINE_EXCLUDED',
      sourceId,
      'Cancelled legacy invoice lines were classified but excluded from active invoice authority.',
      { cancelledLineCount: cancelledRows.length },
    ));
  }
  if (prior?.mapping_status === 'ambiguous') {
    statements.push(resolvePriorIssues(ctx, sourceId));
  }
  statements.push(progress(
    ctx, cp, sourceId,
    1 + createdLines,
    1 + lineClassification.prepared.length + cancelledRows.length,
    0,
    cancelledRows.length > 0 ? 1 : 0,
  ));
  await ctx.db.batch(statements);
  ctx.scanned += 1;
  ctx.remaining -= 1;
}

export async function backfillInvoices(
  db: InvoiceBackfillDatabase,
  options: InvoiceBackfillOptions,
): Promise<InvoiceBackfillResult> {
  const tenantId = exact(options.tenantId, 'tenantId');
  const runPublicId = exact(options.runPublicId, 'runPublicId');
  const currencyCode = currency(options.currencyCode);
  const nowUtc = toUtcIso(options.nowUtc ?? new Date());
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
    remaining: positiveLimit(options.maxSourceRecords),
    scanned: 0,
  };
  const cp = await checkpoint(ctx);
  const bills = await all<BillRow>(db.prepare(`
    SELECT id,patient_id,invoice_no,invoice_code,discount,tax_total,total,status,
           cancelled_at,created_at,updated_at
    FROM bills WHERE CAST(tenant_id AS TEXT)=? ORDER BY id
  `).bind(tenantId));
  const numberCounts = new Map<string, number>();
  for (const bill of bills) {
    const number = (bill.invoice_no ?? bill.invoice_code ?? '').trim();
    if (number) numberCounts.set(number, (numberCounts.get(number) ?? 0) + 1);
  }
  const duplicates = new Set(
    [...numberCounts].filter(([, count]) => count > 1).map(([number]) => number),
  );
  const cursor = Number(cp.cursor_value ?? 0);
  for (const bill of bills.filter((candidate) => candidate.id > cursor)) {
    if (ctx.remaining <= 0) {
      await db.prepare(`
        UPDATE canonical_backfill_checkpoints
        SET status='paused',completed_at_utc=NULL,updated_at_utc=?
        WHERE tenant_id=? AND id=?
      `).bind(nowUtc, tenantId, cp.id).run();
      return result(db, tenantId, start, ctx.scanned, false);
    }
    await processBill(ctx, cp, bill, duplicates);
  }
  await db.prepare(`
    UPDATE canonical_backfill_checkpoints
    SET status='completed',completed_at_utc=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(nowUtc, nowUtc, tenantId, cp.id).run();
  const out = await result(db, tenantId, start, ctx.scanned, true);
  await db.prepare(`
    UPDATE canonical_migration_runs
    SET status='succeeded',completed_at_utc=?,result_summary_json=?,updated_at_utc=?
    WHERE tenant_id=? AND id=?
  `).bind(nowUtc, JSON.stringify(out.counts), nowUtc, tenantId, run.id).run();
  return out;
}
