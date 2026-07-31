import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from '../../src/lib/canonical/source-mapping';
import { allocateCompensationSettlement } from '../../src/lib/canonical/compensation-settlement-allocation';
import { toMinorUnits } from '../../src/lib/canonical/money';
import { toUtcIso } from '../../src/lib/canonical/time';

export interface CompensationBackfillPreparedStatement {
  bind(...values: unknown[]): CompensationBackfillPreparedStatement;
  run(): Promise<unknown>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
}

export interface CompensationBackfillDatabase {
  prepare(sql: string): CompensationBackfillPreparedStatement;
  batch(statements: CompensationBackfillPreparedStatement[]): Promise<unknown[]>;
}

export interface CompensationBackfillOptions {
  tenantId: string;
  runPublicId: string;
  currencyCode: string;
  nowUtc?: string;
  maxSourceRecords?: number;
}

export interface CompensationBackfillCounts {
  scanned: number;
  rulesCreated: number;
  accrualsCreated: number;
  adjustmentsCreated: number;
  settlementsCreated: number;
  settlementAllocationsCreated: number;
  mappingsCreated: number;
  issuesCreated: number;
}

export interface CompensationBackfillResult {
  completed: boolean;
  counts: CompensationBackfillCounts;
}

interface RunRow { id: number; status: string }
interface CheckpointRow { id: number; cursor_value: string | null; status: string }
interface CountRow { count: number }
interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
  evidence_sha256: string | null;
}
interface SourceRef {
  source_kind: 'performer_rule' | 'commission_rule' | 'performer_reserve' | 'commission_accrual' | 'settlement';
  sort_key: number;
  id: number;
}
interface PerformerRuleRow {
  id: number;
  billing_service_item_id: number;
  diagnostic_kind: string;
  rate_type: string;
  rate_value: number;
  effective_from: string;
  effective_to: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}
interface CommissionRuleRow {
  id: number;
  doctor_id: number;
  service_type: string;
  lab_test_id: number | null;
  category: string | null;
  incentive_type: string;
  rate_type: string;
  rate_value: number;
  effective_from: string | null;
  effective_to: string | null;
  is_active: number;
  created_at: string | null;
  updated_at: string | null;
}
interface ReserveRow {
  id: number;
  rule_id: number;
  bill_id: number;
  invoice_item_id: number;
  patient_id: number | null;
  visit_id: number | null;
  billing_service_item_id: number;
  diagnostic_kind: string;
  unit_sequence: number;
  unit_service_amount: number;
  unit_discount_amount: number;
  net_unit_service_amount: number;
  rule_rate_type: string;
  rule_rate_value: number;
  reserved_amount: number;
  status: string;
  assigned_doctor_id: number | null;
  commission_accrual_id: number | null;
  settlement_id: number | null;
  reserved_at: string;
  paid_at: string | null;
  cancelled_at: string | null;
  reversed_at: string | null;
  updated_at: string | null;
  canonical_source_key: string | null;
}
interface LegacyAccrualRow {
  id: number;
  doctor_id: number;
  bill_id: number | null;
  lab_order_item_id: number | null;
  settlement_id: number | null;
  source_type: string;
  incentive_type: string;
  gross_amount: number;
  commission_rule_id: number | null;
  commission_rate_bps: number;
  commission_flat_amount: number;
  commission_amount: number;
  earned_commission_amount: number;
  doctor_waiver_amount: number;
  payable_commission_amount: number;
  paid_amount: number;
  balance_amount: number;
  status: string;
  accrued_date: string | null;
  paid_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  commission_base_amount: number;
  performer_reserve_amount: number;
  performer_reserve_id: number | null;
  canonical_source_key: string | null;
}
interface SettlementRow {
  id: number;
  doctor_id: number;
  settlement_date: string | null;
  total_amount: number;
  payment_mode: string;
  reference_no: string | null;
  created_at: string | null;
  settlement_no: string | null;
  gross_commission_amount: number;
  advance_deduction: number;
  other_adjustment: number;
  rounding_adjustment: number;
  net_paid_amount: number;
  payment_method: string;
  idempotency_key: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
}
interface SettlementItemRow {
  id: number;
  settlement_id: number;
  accrual_id: number;
  doctor_id: number;
  source_type: string;
  bill_id: number | null;
  service_date: string | null;
  gross_amount: number;
  commission_amount: number;
  created_at: string | null;
}
interface SettlementAccrualIdentityRow {
  id: number;
  incentive_type: string;
  performer_reserve_id: number | null;
  canonical_source_key: string | null;
}
interface SettlementReserveIdentityRow {
  id: number;
  canonical_source_key: string | null;
}
interface SettlementAccrualSourceIdentity {
  sourceType: typeof SOURCE_ACCRUAL | typeof SOURCE_RESERVE;
  sourcePublicId: string;
}
interface InvoiceLineRow {
  invoice_public_id: string;
  line_public_id: string;
  service_event_public_id: string | null;
  line_amount_minor: number;
  currency_code: string;
  invoice_status: string;
  service_public_id: string | null;
}
interface CanonicalRuleRow {
  rule_public_id: string;
  rule_version: number;
  scope_type: 'service' | 'category' | 'all';
  service_public_id: string | null;
  category_key: string | null;
  practitioner_public_id: string | null;
  practitioner_role: string;
  accrual_stage: string;
  rate_type: string;
  rate_value: number;
  calculation_basis: string;
}
interface CanonicalAccrualRow {
  accrual_public_id: string;
  invoice_public_id: string;
  invoice_line_public_id: string;
  service_event_public_id: string | null;
  practitioner_public_id: string | null;
  practitioner_role: string;
  currency_code: string;
  earned_minor: number;
  adjusted_minor: number;
  settled_minor: number;
  payable_minor: number;
  status: string;
}
type LegacyAccrualLineAuthority =
  | { status: 'resolved'; line: InvoiceLineRow }
  | {
      status: 'nonimportable';
      issueCode: string;
      resolutionCode: string;
      summary: string;
    }
  | { status: 'unresolved' };

interface StartCounts {
  rules: number;
  accruals: number;
  adjustments: number;
  settlements: number;
  allocations: number;
  mappings: number;
  issues: number;
}
interface Context {
  db: CompensationBackfillDatabase;
  tenantId: string;
  runId: number;
  runPublicId: string;
  currencyCode: string;
  nowUtc: string;
}

type CompensationEntityType =
  | 'compensation_rule'
  | 'compensation_accrual'
  | 'compensation_adjustment'
  | 'compensation_settlement'
  | 'compensation_settlement_allocation';

const MIGRATION = '0513_canonical_practitioner_compensation.sql';
const CHECKPOINT_SOURCE = 'legacy_compensation';
const SOURCE_PERFORMER_RULE = 'legacy_diagnostic_performer_rule';
const SOURCE_COMMISSION_RULE = 'legacy_doctor_commission_rule';
const SOURCE_RESERVE = 'legacy_diagnostic_performer_reserve';
const SOURCE_ACCRUAL = 'legacy_doctor_commission_accrual';
const SOURCE_SETTLEMENT = 'legacy_doctor_commission_settlement';
const SOURCE_SETTLEMENT_ITEM = 'legacy_doctor_commission_settlement_item';
const SOURCE_SETTLEMENT_DEDUCTION = 'legacy_doctor_commission_settlement_deduction';

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
  if (value === undefined) return 1_000_000;
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

function dateOnly(value: string | null | undefined, fallbackUtc: string): string {
  return /^(\d{4}-\d{2}-\d{2})/.exec(value?.trim() ?? '')?.[1] ?? fallbackUtc.slice(0, 10);
}

function exactMajorToMinor(value: number, label: string, allowZero = false): number {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(`${label} must be ${allowZero ? 'non-negative' : 'positive'} and finite`);
  }
  try {
    const minor = toMinorUnits(String(value));
    if (minor < 0n || (!allowZero && minor === 0n) || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError();
    return Number(minor);
  } catch (error) {
    throw new RangeError(`${label} cannot be converted exactly to minor units`, { cause: error });
  }
}

function exactSignedMajorToMinor(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
  try {
    const minor = toMinorUnits(String(value));
    if (minor < BigInt(Number.MIN_SAFE_INTEGER) || minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError();
    return Number(minor);
  } catch (error) {
    throw new RangeError(`${label} cannot be converted exactly to minor units`, { cause: error });
  }
}

function basisPoints(value: number): number {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Legacy percent rate must be non-negative');
  const rounded = Math.round(value);
  if (rounded !== value) throw new RangeError('Legacy percent rate must be integral');
  const normalized = rounded <= 100 ? rounded * 100 : rounded;
  if (!Number.isSafeInteger(normalized) || normalized > 10000) throw new RangeError('Legacy percent rate exceeds 10000 basis points');
  return normalized;
}

function role(value: string): 'performing' | 'referring' | 'prescribing' | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'performer') return 'performing';
  if (normalized === 'referrer') return 'referring';
  if (normalized === 'prescriber') return 'prescribing';
  return null;
}

function paymentMethod(value: string): 'cash' | 'bank_transfer' | 'mobile_wallet' | 'card' | 'other' {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'cash') return 'cash';
  if (normalized === 'bank' || normalized === 'bank_transfer') return 'bank_transfer';
  if (normalized === 'mobile_banking' || normalized === 'mobile_wallet') return 'mobile_wallet';
  if (normalized === 'card') return 'card';
  return 'other';
}

async function all<T>(statement: CompensationBackfillPreparedStatement): Promise<T[]> {
  return (await statement.all<T>()).results;
}

async function tableCount(db: CompensationBackfillDatabase, table: string, tenantId: string, tail = ''): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) count FROM ${table} WHERE tenant_id=?${tail}`)
    .bind(tenantId).first<CountRow>();
  return Number(row?.count ?? 0);
}

async function capture(db: CompensationBackfillDatabase, tenantId: string): Promise<StartCounts> {
  return {
    rules: await tableCount(db, 'canonical_compensation_rules', tenantId),
    accruals: await tableCount(db, 'canonical_compensation_accruals', tenantId),
    adjustments: await tableCount(db, 'canonical_compensation_adjustments', tenantId),
    settlements: await tableCount(db, 'canonical_compensation_settlements', tenantId),
    allocations: await tableCount(db, 'canonical_compensation_settlement_allocations', tenantId),
    mappings: await tableCount(db, 'canonical_source_mappings', tenantId, " AND entity_type IN ('compensation_rule','compensation_accrual','compensation_adjustment','compensation_settlement','compensation_settlement_allocation')"),
    issues: await tableCount(db, 'canonical_processing_issues', tenantId, " AND issue_type='compensation_backfill'"),
  };
}

async function result(
  db: CompensationBackfillDatabase,
  tenantId: string,
  start: StartCounts,
  scanned: number,
  completed: boolean,
): Promise<CompensationBackfillResult> {
  const end = await capture(db, tenantId);
  return {
    completed,
    counts: {
      scanned,
      rulesCreated: end.rules - start.rules,
      accrualsCreated: end.accruals - start.accruals,
      adjustmentsCreated: end.adjustments - start.adjustments,
      settlementsCreated: end.settlements - start.settlements,
      settlementAllocationsCreated: end.allocations - start.allocations,
      mappingsCreated: end.mappings - start.mappings,
      issuesCreated: end.issues - start.issues,
    },
  };
}

async function ensureRun(
  db: CompensationBackfillDatabase,
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
  if (!row) throw new Error('Failed to create compensation migration run');
  if (row.status === 'failed' || row.status === 'cancelled') {
    throw new Error(`Compensation backfill run is terminal: ${row.status}`);
  }
  return row;
}

async function ensureCheckpoint(ctx: Context): Promise<CheckpointRow> {
  let row = await ctx.db.prepare(`
    SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
    WHERE tenant_id=? AND migration_run_id=? AND entity_type='compensation'
      AND source_type=? AND partition_key='' LIMIT 1
  `).bind(ctx.tenantId, ctx.runId, CHECKPOINT_SOURCE).first<CheckpointRow>();
  if (!row) {
    const checkpointId = await createDeterministicSourceId('chk', ctx.tenantId, 'compensation_backfill', ctx.runPublicId);
    await ctx.db.prepare(`
      INSERT INTO canonical_backfill_checkpoints (
        tenant_id,checkpoint_public_id,migration_run_id,entity_type,source_type,
        partition_key,status,started_at_utc,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,'compensation',?,'','running',?,?,?)
    `).bind(ctx.tenantId, checkpointId, ctx.runId, CHECKPOINT_SOURCE, ctx.nowUtc, ctx.nowUtc, ctx.nowUtc).run();
    row = await ctx.db.prepare(`
      SELECT id,cursor_value,status FROM canonical_backfill_checkpoints
      WHERE tenant_id=? AND migration_run_id=? AND entity_type='compensation'
        AND source_type=? AND partition_key='' LIMIT 1
    `).bind(ctx.tenantId, ctx.runId, CHECKPOINT_SOURCE).first<CheckpointRow>();
  }
  if (!row) throw new Error('Failed to create compensation checkpoint');
  return row;
}

function parseCursor(value: string | null): { sort: number; id: number } {
  if (!value) return { sort: 0, id: 0 };
  const match = /^(\d+):(\d+)$/.exec(value);
  if (!match) throw new Error(`Invalid compensation checkpoint cursor: ${value}`);
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
): CompensationBackfillPreparedStatement {
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
  entityType: CompensationEntityType,
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
  entityType: CompensationEntityType,
  sourceType: string,
  sourceTable: string,
  sourceId: string,
  canonicalId: string | null,
  status: 'mapped' | 'ambiguous' | 'rejected',
  evidence: string,
): CompensationBackfillPreparedStatement {
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
): Promise<CompensationBackfillPreparedStatement> {
  const fingerprint = await createDeterministicSourceId('fp', ctx.tenantId, code, `${sourceType}:${sourceId}`);
  const issuePublicId = await createDeterministicSourceId('iss', ctx.tenantId, code, `${sourceType}:${sourceId}`);
  return ctx.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,entity_type,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,
      summary,details_json,first_seen_at_utc,last_seen_at_utc,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'compensation_backfill',?,?,?,?,?,'error','open',1,?,?,?,?,?,?)
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

async function classifiedIssueStatement(
  ctx: Context,
  code: string,
  entityType: string,
  sourceType: string,
  sourceId: string,
  summary: string,
  resolutionCode: string,
): Promise<CompensationBackfillPreparedStatement> {
  const fingerprint = await createDeterministicSourceId('fp', ctx.tenantId, code, `${sourceType}:${sourceId}`);
  const issuePublicId = await createDeterministicSourceId('iss', ctx.tenantId, code, `${sourceType}:${sourceId}`);
  return ctx.db.prepare(`
    INSERT INTO canonical_processing_issues (
      tenant_id,issue_public_id,migration_run_id,issue_type,issue_code,entity_type,
      source_type,source_public_id,fingerprint,severity,status,occurrence_count,
      summary,details_json,first_seen_at_utc,last_seen_at_utc,resolved_at_utc,
      resolved_by_public_id,resolution_code,created_at_utc,updated_at_utc
    ) VALUES (?,?,?,'compensation_backfill',?,?,?,?,?,'warning','waived',1,?,NULL,?,?,?,?,?,?,?)
    ON CONFLICT(tenant_id,issue_type,fingerprint) DO UPDATE SET
      migration_run_id=excluded.migration_run_id,
      severity='warning',status='waived',
      occurrence_count=canonical_processing_issues.occurrence_count+1,
      summary=excluded.summary,last_seen_at_utc=excluded.last_seen_at_utc,
      resolved_at_utc=excluded.resolved_at_utc,
      resolved_by_public_id=excluded.resolved_by_public_id,
      resolution_code=excluded.resolution_code,
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
    ctx.nowUtc,
    ctx.nowUtc,
    ctx.nowUtc,
    'system:compensation-backfill',
    resolutionCode,
    ctx.nowUtc,
    ctx.nowUtc,
  );
}

async function mappedId(
  ctx: Context,
  entityType: string,
  sourceType: string,
  sourceId: string | number,
): Promise<string | null> {
  const row = await ctx.db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type=? AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(ctx.tenantId, entityType, sourceType, String(sourceId)).first<MappingRow>();
  return row?.mapping_status === 'mapped' && row.canonical_public_id ? row.canonical_public_id : null;
}

async function practitionerId(ctx: Context, legacyDoctorId: number | null): Promise<string | null> {
  if (legacyDoctorId == null) return null;
  return mappedId(ctx, 'practitioner', 'legacy_doctor', legacyDoctorId);
}

async function invoiceLineByLegacyItem(ctx: Context, legacyItemId: number): Promise<InvoiceLineRow | null> {
  const lineId = await mappedId(ctx, 'invoice_line', 'legacy_invoice_item', legacyItemId);
  if (!lineId) return null;
  return ctx.db.prepare(`
    SELECT l.invoice_public_id,l.line_public_id,l.service_event_public_id,l.line_amount_minor,
           i.currency_code,i.status invoice_status,e.service_public_id
    FROM canonical_invoice_lines l
    JOIN canonical_invoices i
      ON i.tenant_id=l.tenant_id AND i.invoice_public_id=l.invoice_public_id
    LEFT JOIN canonical_service_events e
      ON e.tenant_id=l.tenant_id AND e.event_public_id=l.service_event_public_id
    WHERE l.tenant_id=? AND l.line_public_id=? LIMIT 1
  `).bind(ctx.tenantId, lineId).first<InvoiceLineRow>();
}

async function invoiceLineFromAccrual(ctx: Context, accrualId: string): Promise<InvoiceLineRow | null> {
  return ctx.db.prepare(`
    SELECT a.invoice_public_id,a.invoice_line_public_id line_public_id,
           a.service_event_public_id,l.line_amount_minor,a.currency_code,
           i.status invoice_status,e.service_public_id
    FROM canonical_compensation_accruals a
    JOIN canonical_invoice_lines l
      ON l.tenant_id=a.tenant_id AND l.invoice_public_id=a.invoice_public_id
      AND l.line_public_id=a.invoice_line_public_id
    JOIN canonical_invoices i
      ON i.tenant_id=a.tenant_id AND i.invoice_public_id=a.invoice_public_id
    LEFT JOIN canonical_service_events e
      ON e.tenant_id=a.tenant_id AND e.event_public_id=a.service_event_public_id
    WHERE a.tenant_id=? AND a.accrual_public_id=? LIMIT 1
  `).bind(ctx.tenantId, accrualId).first<InvoiceLineRow>();
}

async function rejectOne(
  ctx: Context,
  cp: CheckpointRow,
  cursor: string,
  entityType: CompensationEntityType,
  sourceType: string,
  sourceTable: string,
  sourceId: string,
  evidence: string,
  code: string,
  summary: string,
): Promise<void> {
  await ctx.db.batch([
    mapStatement(ctx, entityType, sourceType, sourceTable, sourceId, null, 'ambiguous', evidence),
    await issueStatement(ctx, code, entityType, sourceType, sourceId, summary),
    progress(ctx, cp, cursor, 0, 1, 0, 1),
  ]);
}

async function classifyOne(
  ctx: Context,
  cp: CheckpointRow,
  cursor: string,
  entityType: CompensationEntityType,
  sourceType: string,
  sourceTable: string,
  sourceId: string,
  evidence: string,
  code: string,
  summary: string,
  resolutionCode: string,
): Promise<void> {
  await ctx.db.batch([
    mapStatement(ctx, entityType, sourceType, sourceTable, sourceId, null, 'rejected', evidence),
    await classifiedIssueStatement(ctx, code, entityType, sourceType, sourceId, summary, resolutionCode),
    progress(ctx, cp, cursor, 0, 1, 0, 1),
  ]);
}

async function performerRuleEvidence(row: PerformerRuleRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_PERFORMER_RULE,
    sourcePublicId: String(row.id),
    billingServiceItemId: row.billing_service_item_id,
    diagnosticKind: row.diagnostic_kind,
    rateType: row.rate_type,
    rateValue: row.rate_value,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

async function commissionRuleEvidence(row: CommissionRuleRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_COMMISSION_RULE,
    sourcePublicId: String(row.id),
    doctorId: row.doctor_id,
    serviceType: row.service_type,
    labTestId: row.lab_test_id,
    category: row.category,
    incentiveType: row.incentive_type,
    rateType: row.rate_type,
    rateValue: row.rate_value,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  });
}

function reserveSourceId(row: ReserveRow): string {
  return row.canonical_source_key?.trim() || String(row.id);
}

async function reserveEvidence(row: ReserveRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_RESERVE,
    sourcePublicId: reserveSourceId(row),
    ruleId: row.rule_id,
    billId: row.bill_id,
    invoiceItemId: row.invoice_item_id,
    billingServiceItemId: row.billing_service_item_id,
    diagnosticKind: row.diagnostic_kind,
    unitSequence: row.unit_sequence,
    unitServiceAmountMajor: row.unit_service_amount,
    unitDiscountAmountMajor: row.unit_discount_amount,
    netUnitServiceAmountMajor: row.net_unit_service_amount,
    ruleRateType: row.rule_rate_type,
    ruleRateValue: row.rule_rate_value,
    reservedAmountMajor: row.reserved_amount,
    reservedAt: row.reserved_at,
  });
}

function legacyAccrualSourceId(row: LegacyAccrualRow): string {
  return row.canonical_source_key?.trim() || String(row.id);
}

async function accrualEvidence(row: LegacyAccrualRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_ACCRUAL,
    sourcePublicId: legacyAccrualSourceId(row),
    doctorId: row.doctor_id,
    billId: row.bill_id,
    legacySourceType: row.source_type,
    incentiveType: row.incentive_type,
    grossAmountMajor: row.gross_amount,
    commissionRuleId: row.commission_rule_id,
    commissionRateBps: row.commission_rate_bps,
    commissionFlatAmountMajor: row.commission_flat_amount,
    commissionAmountMajor: row.commission_amount,
    earnedAmountMajor: row.earned_commission_amount,
    waiverAmountMajor: row.doctor_waiver_amount,
    payableAmountMajor: row.payable_commission_amount,
    accruedDate: row.accrued_date,
    commissionBaseAmountMajor: row.commission_base_amount,
    performerReserveAmountMajor: row.performer_reserve_amount,
  });
}

async function historicalAccrualEvidence(row: LegacyAccrualRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_ACCRUAL,
    sourcePublicId: String(row.id),
    doctorId: row.doctor_id,
    billId: row.bill_id,
    labOrderItemId: row.lab_order_item_id,
    settlementId: row.settlement_id,
    legacySourceType: row.source_type,
    incentiveType: row.incentive_type,
    grossAmountMajor: row.gross_amount,
    commissionRuleId: row.commission_rule_id,
    commissionRateBps: row.commission_rate_bps,
    commissionFlatAmountMajor: row.commission_flat_amount,
    commissionAmountMajor: row.commission_amount,
    earnedAmountMajor: row.earned_commission_amount,
    waiverAmountMajor: row.doctor_waiver_amount,
    payableAmountMajor: row.payable_commission_amount,
    paidAmountMajor: row.paid_amount,
    balanceAmountMajor: row.balance_amount,
    status: row.status,
    accruedDate: row.accrued_date,
    paidDate: row.paid_date,
    baseAmountMajor: row.commission_base_amount,
    performerReserveAmountMajor: row.performer_reserve_amount,
    performerReserveId: row.performer_reserve_id,
    updatedAt: row.updated_at,
  });
}

function settlementSourceId(row: SettlementRow): string {
  return row.idempotency_key?.trim() || String(row.id);
}

function settlementAllocationSourceId(
  settlementSourcePublicId: string,
  accrualSourceType: string,
  accrualSourcePublicId: string,
): string {
  return `${settlementSourcePublicId}:${accrualSourceType}:${accrualSourcePublicId}`;
}

async function fallbackSettlementEvidence(row: SettlementRow): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_SETTLEMENT,
    sourcePublicId: settlementSourceId(row),
    doctorId: row.doctor_id,
    settlementDate: row.settlement_date,
    totalAmountMajor: row.total_amount,
    paymentMode: row.payment_mode,
    referenceNo: row.reference_no,
    settlementNo: row.settlement_no,
    grossCommissionAmountMajor: row.gross_commission_amount,
    advanceDeductionMajor: row.advance_deduction,
    otherAdjustmentMajor: row.other_adjustment,
    roundingAdjustmentMajor: row.rounding_adjustment,
    netPaidAmountMajor: row.net_paid_amount,
    paymentMethod: row.payment_method,
    idempotencyKey: row.idempotency_key,
    reversedAt: row.reversed_at,
    reversalReason: row.reversal_reason,
    createdAt: row.created_at,
  });
}

async function reserveSourcePublicId(ctx: Context, reserveId: number): Promise<string | null> {
  const reserve = await ctx.db.prepare(`
    SELECT id,canonical_source_key
    FROM diagnostic_performer_reserves
    WHERE CAST(tenant_id AS TEXT)=? AND id=?
    LIMIT 1
  `).bind(ctx.tenantId, reserveId).first<SettlementReserveIdentityRow>();
  return reserve ? reserve.canonical_source_key?.trim() || String(reserve.id) : null;
}

async function settlementAccrualSourceIdentity(
  ctx: Context,
  accrualId: number,
): Promise<SettlementAccrualSourceIdentity | null> {
  const accrual = await ctx.db.prepare(`
    SELECT id,incentive_type,performer_reserve_id,canonical_source_key
    FROM doctor_commission_accruals
    WHERE CAST(tenant_id AS TEXT)=? AND id=?
    LIMIT 1
  `).bind(ctx.tenantId, accrualId).first<SettlementAccrualIdentityRow>();
  if (!accrual) return null;
  if (accrual.performer_reserve_id != null && accrual.incentive_type.trim().toLowerCase() === 'performer') {
    const reserveSourceId = await reserveSourcePublicId(ctx, accrual.performer_reserve_id);
    if (!reserveSourceId) return null;
    return {
      sourceType: SOURCE_RESERVE,
      sourcePublicId: reserveSourceId,
    };
  }
  return {
    sourceType: SOURCE_ACCRUAL,
    sourcePublicId: accrual.canonical_source_key?.trim() || String(accrual.id),
  };
}

async function fallbackSettlementItemEvidence(
  row: SettlementItemRow,
  sourcePublicId = String(row.id),
): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_SETTLEMENT_ITEM,
    sourcePublicId,
    settlementId: row.settlement_id,
    accrualId: row.accrual_id,
    doctorId: row.doctor_id,
    legacySourceType: row.source_type,
    billId: row.bill_id,
    serviceDate: row.service_date,
    grossAmountMajor: row.gross_amount,
    commissionAmountMajor: row.commission_amount,
    createdAt: row.created_at,
  });
}

async function canonicalSettlementEvidence(input: {
  row: SettlementRow;
  sourceId: string;
  grossMinor: number;
  deductionMinor: number;
  netMinor: number;
  settledAtUtc: string;
  businessDate: string;
  accrualSources: Array<{
    sourceType: string;
    sourcePublicId: string;
    grossMinor: number;
    adjustmentMinor: number;
    allocationMinor: number;
  }>;
}): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_SETTLEMENT,
    sourcePublicId: input.sourceId,
    doctorId: input.row.doctor_id,
    settlementNumber: input.row.settlement_no?.trim() || `LEGACY-COMP-${input.row.id}`,
    paymentMethod: paymentMethod(input.row.payment_method || input.row.payment_mode),
    grossAmountMajor: input.grossMinor / 100,
    deductionAmountMajor: input.deductionMinor / 100,
    netPaidAmountMajor: input.netMinor / 100,
    settledAtUtc: input.settledAtUtc,
    businessDate: input.businessDate,
    accrualSources: input.accrualSources,
  });
}

async function canonicalSettlementAllocationEvidence(input: {
  sourcePublicId: string;
  settlementPublicId: string;
  accrualPublicId: string;
  amountMinor: number;
  adjustedMinor: number;
  allocatedAtUtc: string;
}): Promise<string> {
  return createSourceEvidenceSha256({
    sourceType: SOURCE_SETTLEMENT_ITEM,
    sourcePublicId: input.sourcePublicId,
    settlementPublicId: input.settlementPublicId,
    accrualPublicId: input.accrualPublicId,
    amountMinor: input.amountMinor,
    adjustedMinor: input.adjustedMinor,
    allocatedAtUtc: input.allocatedAtUtc,
  });
}

async function processPerformerRule(ctx: Context, cp: CheckpointRow, id: number): Promise<void> {
  const row = await ctx.db.prepare(`
    SELECT id,billing_service_item_id,diagnostic_kind,rate_type,rate_value,
           effective_from,effective_to,is_active,created_at,updated_at
    FROM diagnostic_performer_payout_rules WHERE CAST(tenant_id AS TEXT)=? AND id=? LIMIT 1
  `).bind(ctx.tenantId, id).first<PerformerRuleRow>();
  if (!row) throw new Error(`Legacy performer rule not found: ${id}`);
  const sourceId = String(row.id);
  const cursor = `1:${row.id}`;
  const evidence = await performerRuleEvidence(row);
  const prior = await existing(ctx, 'compensation_rule', SOURCE_PERFORMER_RULE, sourceId);
  assertEvidence(prior, evidence, 'Performer rule');
  if (prior) {
    await ctx.db.batch([progress(ctx, cp, cursor, 0, 0, 1, 0)]);
    return;
  }
  const serviceId = await mappedId(ctx, 'service_catalog_item', 'legacy_billing_service_item', row.billing_service_item_id);
  if (!serviceId) {
    await rejectOne(ctx, cp, cursor, 'compensation_rule', SOURCE_PERFORMER_RULE, 'diagnostic_performer_payout_rules', sourceId, evidence, 'COMPENSATION_SERVICE_UNRESOLVED', 'Performer payout rule has no exact canonical service mapping.');
    return;
  }
  let rateType: 'fixed' | 'basis_points';
  let rateValue: number;
  try {
    if (row.rate_type === 'flat') {
      rateType = 'fixed';
      rateValue = exactMajorToMinor(row.rate_value, 'performer rule flat amount', true);
    } else if (row.rate_type === 'percent') {
      rateType = 'basis_points';
      rateValue = basisPoints(row.rate_value);
    } else throw new RangeError();
  } catch {
    await rejectOne(ctx, cp, cursor, 'compensation_rule', SOURCE_PERFORMER_RULE, 'diagnostic_performer_payout_rules', sourceId, evidence, 'COMPENSATION_RULE_RATE_UNRESOLVED', 'Performer payout rule rate cannot be normalized exactly.');
    return;
  }
  const ruleId = await createDeterministicSourceId('comprule', ctx.tenantId, SOURCE_PERFORMER_RULE, sourceId);
  await ctx.db.batch([
    ctx.db.prepare(`
      INSERT INTO canonical_compensation_rules (
        tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
        practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
        calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
        priority,effective_from,effective_to,status,source_evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,1,'service',?,NULL,NULL,'performing','performer_reserve',?,?,
                'net_after_discount','deduct','exclude',0,NULL,10,?,?,?, ?,?,?)
    `).bind(
      ctx.tenantId,
      ruleId,
      serviceId,
      rateType,
      rateValue,
      row.effective_from,
      row.effective_to,
      row.is_active === 1 ? 'active' : 'inactive',
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
    mapStatement(ctx, 'compensation_rule', SOURCE_PERFORMER_RULE, 'diagnostic_performer_payout_rules', sourceId, ruleId, 'mapped', evidence),
    progress(ctx, cp, cursor, 1, 1, 0, 0),
  ]);
}

async function processCommissionRule(ctx: Context, cp: CheckpointRow, id: number): Promise<void> {
  const row = await ctx.db.prepare(`
    SELECT id,doctor_id,service_type,lab_test_id,category,incentive_type,rate_type,
           rate_value,effective_from,effective_to,is_active,created_at,updated_at
    FROM doctor_commission_rules WHERE CAST(tenant_id AS TEXT)=? AND id=? LIMIT 1
  `).bind(ctx.tenantId, id).first<CommissionRuleRow>();
  if (!row) throw new Error(`Legacy commission rule not found: ${id}`);
  const sourceId = String(row.id);
  const cursor = `2:${row.id}`;
  const evidence = await commissionRuleEvidence(row);
  const prior = await existing(ctx, 'compensation_rule', SOURCE_COMMISSION_RULE, sourceId);
  assertEvidence(prior, evidence, 'Commission rule');
  if (prior) {
    await ctx.db.batch([progress(ctx, cp, cursor, 0, 0, 1, 0)]);
    return;
  }
  const practitionerPublicId = await practitionerId(ctx, row.doctor_id);
  if (!practitionerPublicId) {
    await rejectOne(ctx, cp, cursor, 'compensation_rule', SOURCE_COMMISSION_RULE, 'doctor_commission_rules', sourceId, evidence, 'COMPENSATION_PRACTITIONER_UNRESOLVED', 'Doctor-specific commission rule has no exact canonical practitioner mapping.');
    return;
  }
  const practitionerRole = role(row.incentive_type);
  if (!practitionerRole) {
    await rejectOne(ctx, cp, cursor, 'compensation_rule', SOURCE_COMMISSION_RULE, 'doctor_commission_rules', sourceId, evidence, 'COMPENSATION_ROLE_UNRESOLVED', 'Legacy commission incentive type cannot be mapped to a canonical practitioner role.');
    return;
  }
  let scopeType: 'service' | 'category' | 'all' = 'all';
  let servicePublicId: string | null = null;
  let categoryKey: string | null = null;
  if (row.lab_test_id != null) {
    servicePublicId = await mappedId(ctx, 'service_catalog_item', 'legacy_lab_test', row.lab_test_id);
    if (!servicePublicId) {
      await rejectOne(ctx, cp, cursor, 'compensation_rule', SOURCE_COMMISSION_RULE, 'doctor_commission_rules', sourceId, evidence, 'COMPENSATION_SERVICE_UNRESOLVED', 'Doctor commission rule has no exact canonical service mapping.');
      return;
    }
    scopeType = 'service';
  } else if (row.category?.trim()) {
    scopeType = 'category';
    categoryKey = row.category.trim().toLocaleLowerCase('en-US');
  }
  let rateType: 'fixed' | 'basis_points';
  let rateValue: number;
  try {
    if (row.rate_type === 'flat') {
      rateType = 'fixed';
      rateValue = exactMajorToMinor(row.rate_value, 'commission rule flat amount', true);
    } else if (row.rate_type === 'percent') {
      rateType = 'basis_points';
      rateValue = basisPoints(row.rate_value);
    } else throw new RangeError();
  } catch {
    await rejectOne(ctx, cp, cursor, 'compensation_rule', SOURCE_COMMISSION_RULE, 'doctor_commission_rules', sourceId, evidence, 'COMPENSATION_RULE_RATE_UNRESOLVED', 'Doctor commission rule rate cannot be normalized exactly.');
    return;
  }
  const ruleId = await createDeterministicSourceId('comprule', ctx.tenantId, SOURCE_COMMISSION_RULE, sourceId);
  const basis = practitionerRole === 'referring' || practitionerRole === 'prescribing'
    ? 'remaining_after_performer'
    : 'net_after_discount';
  await ctx.db.batch([
    ctx.db.prepare(`
      INSERT INTO canonical_compensation_rules (
        tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
        practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
        calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
        priority,effective_from,effective_to,status,source_evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,1,?,?,?,?,?,'commission',?,?,?,'deduct','exclude',0,NULL,20,
                ?,?,?, ?,?,?)
    `).bind(
      ctx.tenantId,
      ruleId,
      scopeType,
      servicePublicId,
      categoryKey,
      practitionerPublicId,
      practitionerRole,
      rateType,
      rateValue,
      basis,
      row.effective_from ?? '1970-01-01',
      row.effective_to,
      row.is_active === 1 ? 'active' : 'inactive',
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
    mapStatement(ctx, 'compensation_rule', SOURCE_COMMISSION_RULE, 'doctor_commission_rules', sourceId, ruleId, 'mapped', evidence),
    progress(ctx, cp, cursor, 1, 1, 0, 0),
  ]);
}

async function hasExactReserveSettlementEvidence(ctx: Context, row: ReserveRow): Promise<boolean> {
  if (
    row.commission_accrual_id == null
    || row.settlement_id == null
    || row.assigned_doctor_id == null
  ) return false;
  const found = await ctx.db.prepare(`
    SELECT 1 present
    FROM doctor_commission_accruals a
    JOIN doctor_commission_settlement_items i
      ON i.tenant_id=a.tenant_id AND i.accrual_id=a.id AND i.settlement_id=a.settlement_id
    JOIN doctor_commission_settlements s
      ON s.tenant_id=a.tenant_id AND s.id=a.settlement_id AND s.doctor_id=a.doctor_id
    WHERE CAST(a.tenant_id AS TEXT)=?
      AND a.id=?
      AND a.performer_reserve_id=?
      AND a.settlement_id=?
      AND a.doctor_id=?
      AND a.incentive_type='performer'
      AND a.status='paid'
      AND i.doctor_id=a.doctor_id
      AND s.reversed_at IS NULL
    LIMIT 1
  `).bind(
    ctx.tenantId,
    row.commission_accrual_id,
    row.id,
    row.settlement_id,
    row.assigned_doctor_id,
  ).first<{ present: number }>();
  return Boolean(found);
}

async function processReserve(ctx: Context, cp: CheckpointRow, id: number): Promise<void> {
  const row = await ctx.db.prepare(`
    SELECT id,rule_id,bill_id,invoice_item_id,patient_id,visit_id,billing_service_item_id,
           diagnostic_kind,unit_sequence,unit_service_amount,unit_discount_amount,
           net_unit_service_amount,rule_rate_type,rule_rate_value,reserved_amount,status,
           assigned_doctor_id,commission_accrual_id,settlement_id,reserved_at,paid_at,
           cancelled_at,reversed_at,updated_at,canonical_source_key
    FROM diagnostic_performer_reserves WHERE CAST(tenant_id AS TEXT)=? AND id=? LIMIT 1
  `).bind(ctx.tenantId, id).first<ReserveRow>();
  if (!row) throw new Error(`Legacy performer reserve not found: ${id}`);
  const sourceId = reserveSourceId(row);
  const cursor = `3:${row.id}`;
  const evidence = await reserveEvidence(row);
  const prior = await existing(ctx, 'compensation_accrual', SOURCE_RESERVE, sourceId);
  assertEvidence(prior, evidence, 'Performer reserve');
  if (prior) {
    await ctx.db.batch([progress(ctx, cp, cursor, 0, 0, 1, 0)]);
    return;
  }
  const line = await invoiceLineByLegacyItem(ctx, row.invoice_item_id);
  if (!line || line.invoice_status !== 'posted') {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_RESERVE, 'diagnostic_performer_reserves', sourceId, evidence, 'COMPENSATION_INVOICE_LINE_UNRESOLVED', 'Performer reserve has no exact posted canonical invoice-line authority.');
    return;
  }
  if (row.status === 'paid' && !(await hasExactReserveSettlementEvidence(ctx, row))) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_RESERVE, 'diagnostic_performer_reserves', sourceId, evidence, 'COMPENSATION_PAID_SETTLEMENT_UNRESOLVED', 'Paid performer reserve requires exact linked accrual and settlement-item authority.');
    return;
  }
  if (!['reserved', 'paid'].includes(row.status)) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_RESERVE, 'diagnostic_performer_reserves', sourceId, evidence, 'COMPENSATION_TERMINAL_SOURCE_UNRESOLVED', 'Cancelled or reversed performer reserve requires an explicit compensation adjustment workflow.');
    return;
  }
  const ruleId = await mappedId(ctx, 'compensation_rule', SOURCE_PERFORMER_RULE, row.rule_id);
  if (!ruleId) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_RESERVE, 'diagnostic_performer_reserves', sourceId, evidence, 'COMPENSATION_RULE_UNRESOLVED', 'Performer reserve has no exact canonical compensation rule.');
    return;
  }
  const canonicalRule = await ctx.db.prepare(`
    SELECT rule_public_id,rule_version,practitioner_public_id,practitioner_role,
           accrual_stage,rate_type,rate_value,calculation_basis
    FROM canonical_compensation_rules
    WHERE tenant_id=? AND rule_public_id=? AND rule_version=1 LIMIT 1
  `).bind(ctx.tenantId, ruleId).first<CanonicalRuleRow>();
  if (!canonicalRule) throw new Error('Mapped canonical performer rule not found');
  const practitionerPublicId = await practitionerId(ctx, row.assigned_doctor_id);
  if (row.assigned_doctor_id != null && !practitionerPublicId) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_RESERVE, 'diagnostic_performer_reserves', sourceId, evidence, 'COMPENSATION_PRACTITIONER_UNRESOLVED', 'Assigned performer has no exact canonical practitioner mapping.');
    return;
  }
  let grossMinor: number;
  let discountMinor: number;
  let netMinor: number;
  let earnedMinor: number;
  try {
    grossMinor = exactMajorToMinor(row.unit_service_amount, 'reserve unit service amount', true);
    discountMinor = exactMajorToMinor(row.unit_discount_amount, 'reserve unit discount amount', true);
    netMinor = exactMajorToMinor(row.net_unit_service_amount, 'reserve net unit service amount', true);
    earnedMinor = exactMajorToMinor(row.reserved_amount, 'reserve amount');
  } catch {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_RESERVE, 'diagnostic_performer_reserves', sourceId, evidence, 'COMPENSATION_AMOUNT_UNRESOLVED', 'Performer reserve money cannot be converted exactly to minor units.');
    return;
  }
  if (
    grossMinor !== line.line_amount_minor
    || netMinor !== grossMinor - discountMinor
    || (canonicalRule.rate_type === 'fixed' && canonicalRule.rate_value !== earnedMinor)
  ) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_RESERVE, 'diagnostic_performer_reserves', sourceId, evidence, 'COMPENSATION_AMOUNT_MISMATCH', 'Performer reserve financial snapshot does not reconcile to canonical line and rule authority.');
    return;
  }
  const accrualId = await createDeterministicSourceId('compacc', ctx.tenantId, SOURCE_RESERVE, sourceId);
  const accruedAt = legacyUtc(row.reserved_at, ctx.nowUtc);
  const status = practitionerPublicId == null ? 'unassigned' : 'accrued';
  await ctx.db.batch([
    ctx.db.prepare(`
      INSERT INTO canonical_compensation_accruals (
        tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
        service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
        rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
        gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
        earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
        business_date,payable_projection_guard,source_evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,'performer_reserve',?,1,'net_after_discount',?,?,?,
                ?,?,0,0,?,?,0,0,?,?,?,?,1,?,?,?)
    `).bind(
      ctx.tenantId,
      accrualId,
      line.invoice_public_id,
      line.line_public_id,
      line.service_event_public_id,
      practitionerPublicId,
      'performing',
      ruleId,
      canonicalRule.rate_type,
      canonicalRule.rate_value,
      line.currency_code,
      grossMinor,
      discountMinor,
      netMinor,
      earnedMinor,
      earnedMinor,
      status,
      accruedAt,
      dateOnly(row.reserved_at, accruedAt),
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
    mapStatement(ctx, 'compensation_accrual', SOURCE_RESERVE, 'diagnostic_performer_reserves', sourceId, accrualId, 'mapped', evidence),
    progress(ctx, cp, cursor, 1, 1, 0, 0),
  ]);
}

async function hasExactSettlementEvidence(ctx: Context, row: LegacyAccrualRow): Promise<boolean> {
  if (row.settlement_id == null) return false;
  const found = await ctx.db.prepare(`
    SELECT 1 present
    FROM doctor_commission_settlement_items i
    JOIN doctor_commission_settlements s
      ON s.tenant_id=i.tenant_id AND s.id=i.settlement_id
    WHERE CAST(i.tenant_id AS TEXT)=? AND i.accrual_id=? AND i.settlement_id=?
      AND s.reversed_at IS NULL
    LIMIT 1
  `).bind(ctx.tenantId, row.id, row.settlement_id).first<{ present: number }>();
  return Boolean(found);
}

function canonicalCategoryKind(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 'test' || normalized === 'lab_test') return 'laboratory';
  if (normalized === 'doctor_visit' || normalized === 'consultation_fee') return 'consultation';
  if (normalized === 'operation') return 'procedure';
  if (normalized === 'medicine') return 'product';
  return normalized;
}

function legacySourceItemKind(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'lab_test' || normalized === 'referral') return 'laboratory';
  if (normalized === 'consultation_fee') return 'consultation';
  if (normalized === 'procedure' || normalized === 'operation') return 'procedure';
  if (normalized === 'pharmacy' || normalized === 'medicine') return 'product';
  return null;
}

async function resolveAccrualRuleSourceId(ctx: Context, row: LegacyAccrualRow): Promise<number | null> {
  if (row.commission_rule_id != null) return row.commission_rule_id;
  const authorityDate = dateOnly(row.accrued_date ?? row.created_at, ctx.nowUtc);
  const candidates = await all<{ id: number }>(ctx.db.prepare(`
    SELECT id
    FROM doctor_commission_rules
    WHERE CAST(tenant_id AS TEXT)=?
      AND doctor_id=?
      AND incentive_type=?
      AND service_type=?
      AND COALESCE(is_active,1)=1
      AND (effective_from IS NULL OR date(effective_from)<=date(?))
      AND (effective_to IS NULL OR date(effective_to)>=date(?))
    ORDER BY id
    LIMIT 2
  `).bind(
    ctx.tenantId,
    row.doctor_id,
    row.incentive_type,
    row.source_type,
    authorityDate,
    authorityDate,
  ));
  return candidates.length === 1 ? candidates[0].id : null;
}

function nonimportableLineAuthority(
  issueCode: string,
  resolutionCode: string,
  summary: string,
): LegacyAccrualLineAuthority {
  return { status: 'nonimportable', issueCode, resolutionCode, summary };
}

function validateResolvedLine(line: InvoiceLineRow): LegacyAccrualLineAuthority {
  if (line.invoice_status !== 'posted') {
    return nonimportableLineAuthority(
      'COMPENSATION_LINE_AUTHORITY_NOT_IMPORTABLE',
      'DETERMINISTIC_NONIMPORTABLE_LINE_AUTHORITY',
      'Legacy compensation accrual is linked to a non-posted invoice line.',
    );
  }
  return { status: 'resolved', line };
}

async function resolveLegacyAccrualLineAuthority(
  ctx: Context,
  row: LegacyAccrualRow,
  canonicalRule: CanonicalRuleRow,
): Promise<LegacyAccrualLineAuthority> {
  if (row.performer_reserve_id != null) {
    const reserveSourceId = await reserveSourcePublicId(ctx, row.performer_reserve_id);
    const reserveAccrualId = reserveSourceId
      ? await mappedId(ctx, 'compensation_accrual', SOURCE_RESERVE, reserveSourceId)
      : null;
    if (reserveAccrualId) {
      const line = await invoiceLineFromAccrual(ctx, reserveAccrualId);
      return line ? validateResolvedLine(line) : { status: 'unresolved' };
    }
  }

  if (row.lab_order_item_id != null) {
    const eventId = await mappedId(ctx, 'service_event', 'legacy_lab_order_item', row.lab_order_item_id);
    if (eventId) {
      const rows = await all<InvoiceLineRow>(ctx.db.prepare(`
        SELECT l.invoice_public_id,l.line_public_id,l.service_event_public_id,l.line_amount_minor,
               i.currency_code,i.status invoice_status,e.service_public_id
        FROM canonical_invoice_lines l
        JOIN canonical_invoices i
          ON i.tenant_id=l.tenant_id AND i.invoice_public_id=l.invoice_public_id
        LEFT JOIN canonical_service_events e
          ON e.tenant_id=l.tenant_id AND e.event_public_id=l.service_event_public_id
        WHERE l.tenant_id=? AND l.service_event_public_id=? LIMIT 2
      `).bind(ctx.tenantId, eventId));
      if (rows.length === 1) return validateResolvedLine(rows[0]);
      if (rows.length > 1) {
        return nonimportableLineAuthority(
          'COMPENSATION_AGGREGATE_ACCRUAL_NOT_LINE_IMPORTABLE',
          'DETERMINISTIC_NONIMPORTABLE_LEGACY_AGGREGATE',
          'Legacy compensation accrual resolves to more than one canonical invoice line.',
        );
      }
    }
  }

  if (row.bill_id == null) return { status: 'unresolved' };
  const invoiceId = await mappedId(ctx, 'invoice', 'legacy_bill', row.bill_id);
  if (!invoiceId) return { status: 'unresolved' };
  const lines = await all<InvoiceLineRow & { item_kind: string | null }>(ctx.db.prepare(`
    SELECT l.invoice_public_id,l.line_public_id,l.service_event_public_id,l.line_amount_minor,
           i.currency_code,i.status invoice_status,e.service_public_id,s.item_kind
    FROM canonical_invoice_lines l
    JOIN canonical_invoices i
      ON i.tenant_id=l.tenant_id AND i.invoice_public_id=l.invoice_public_id
    LEFT JOIN canonical_service_events e
      ON e.tenant_id=l.tenant_id AND e.event_public_id=l.service_event_public_id
    LEFT JOIN canonical_service_catalog_items s
      ON s.tenant_id=e.tenant_id AND s.service_public_id=e.service_public_id
    WHERE l.tenant_id=? AND l.invoice_public_id=?
      AND l.line_type IN ('service','other_adjustment')
      AND l.line_amount_minor>=0
    ORDER BY l.id
  `).bind(ctx.tenantId, invoiceId));

  let candidates = lines;
  if (canonicalRule.scope_type === 'service' && canonicalRule.service_public_id) {
    candidates = lines.filter((line) => line.service_public_id === canonicalRule.service_public_id);
  } else {
    const itemKind = canonicalRule.scope_type === 'category'
      ? canonicalCategoryKind(canonicalRule.category_key)
      : legacySourceItemKind(row.source_type);
    if (itemKind) candidates = lines.filter((line) => line.item_kind === itemKind);
  }

  if (candidates.length === 1) return validateResolvedLine(candidates[0]);
  if (candidates.length > 1) {
    return nonimportableLineAuthority(
      'COMPENSATION_AGGREGATE_ACCRUAL_NOT_LINE_IMPORTABLE',
      'DETERMINISTIC_NONIMPORTABLE_LEGACY_AGGREGATE',
      'Legacy compensation accrual aggregates multiple canonical invoice lines without an exact allocation.',
    );
  }
  if (lines.length === 1) return validateResolvedLine(lines[0]);
  if (lines.length > 1) {
    return nonimportableLineAuthority(
      'COMPENSATION_AGGREGATE_ACCRUAL_NOT_LINE_IMPORTABLE',
      'DETERMINISTIC_NONIMPORTABLE_LEGACY_AGGREGATE',
      'Legacy compensation accrual has multiple canonical invoice lines and no exact line allocation.',
    );
  }
  return { status: 'unresolved' };
}

async function processAccrual(ctx: Context, cp: CheckpointRow, id: number): Promise<void> {
  const row = await ctx.db.prepare(`
    SELECT id,doctor_id,bill_id,lab_order_item_id,settlement_id,source_type,incentive_type,
           gross_amount,commission_rule_id,commission_rate_bps,commission_flat_amount,
           commission_amount,earned_commission_amount,doctor_waiver_amount,
           payable_commission_amount,paid_amount,balance_amount,status,accrued_date,
           paid_date,created_at,updated_at,commission_base_amount,
           performer_reserve_amount,performer_reserve_id,canonical_source_key
    FROM doctor_commission_accruals WHERE CAST(tenant_id AS TEXT)=? AND id=? LIMIT 1
  `).bind(ctx.tenantId, id).first<LegacyAccrualRow>();
  if (!row) throw new Error(`Legacy commission accrual not found: ${id}`);
  const sourceId = legacyAccrualSourceId(row);
  const cursor = `4:${row.id}`;
  const evidence = await accrualEvidence(row);
  const historicalEvidence = await historicalAccrualEvidence(row);
  const prior = await existing(ctx, 'compensation_accrual', SOURCE_ACCRUAL, sourceId);
  if (
    prior
    && prior.evidence_sha256 !== evidence
    && prior.evidence_sha256 !== historicalEvidence
  ) {
    throw new Error(`Commission accrual ${sourceId} source evidence drift detected`);
  }
  if (prior) {
    await ctx.db.batch([progress(ctx, cp, cursor, 0, 0, 1, 0)]);
    return;
  }
  if (row.status === 'paid' && !(await hasExactSettlementEvidence(ctx, row))) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, evidence, 'COMPENSATION_PAID_SETTLEMENT_UNRESOLVED', 'Paid legacy compensation accrual has no exact settlement item authority.');
    return;
  }
  if (!['accrued', 'approved', 'paid'].includes(row.status)) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, evidence, 'COMPENSATION_TERMINAL_SOURCE_UNRESOLVED', 'Cancelled legacy compensation requires an explicit adjustment workflow.');
    return;
  }
  const practitionerPublicId = await practitionerId(ctx, row.doctor_id);
  if (!practitionerPublicId) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, evidence, 'COMPENSATION_PRACTITIONER_UNRESOLVED', 'Legacy compensation accrual doctor has no exact canonical practitioner mapping.');
    return;
  }
  const practitionerRole = role(row.incentive_type);
  if (!practitionerRole) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, evidence, 'COMPENSATION_ROLE_UNRESOLVED', 'Legacy compensation accrual incentive type cannot be mapped.');
    return;
  }
  if (row.performer_reserve_id != null && practitionerRole === 'performing') {
    const reserveSourceId = await reserveSourcePublicId(ctx, row.performer_reserve_id);
    const reserveAccrualId = reserveSourceId
      ? await mappedId(ctx, 'compensation_accrual', SOURCE_RESERVE, reserveSourceId)
      : null;
    const reserveAccrual = reserveAccrualId
      ? await ctx.db.prepare(`
          SELECT accrual_public_id,invoice_public_id,invoice_line_public_id,
                 service_event_public_id,practitioner_public_id,practitioner_role,
                 currency_code,earned_minor,adjusted_minor,settled_minor,payable_minor,status
          FROM canonical_compensation_accruals
          WHERE tenant_id=? AND accrual_public_id=? LIMIT 1
        `).bind(ctx.tenantId, reserveAccrualId).first<CanonicalAccrualRow>()
      : null;
    let earnedMinor = -1;
    try { earnedMinor = exactMajorToMinor(row.earned_commission_amount || row.commission_amount, 'linked reserve accrual amount'); } catch { /* handled below */ }
    if (
      reserveAccrual
      && reserveAccrual.practitioner_public_id === practitionerPublicId
      && reserveAccrual.earned_minor === earnedMinor
    ) {
      await ctx.db.batch([
        mapStatement(ctx, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, reserveAccrual.accrual_public_id, 'mapped', evidence),
        progress(ctx, cp, cursor, 0, 1, 0, 0),
      ]);
      return;
    }
  }
  const ruleSourceId = await resolveAccrualRuleSourceId(ctx, row);
  if (ruleSourceId == null) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, evidence, 'COMPENSATION_RULE_UNRESOLVED', 'Legacy compensation accrual has no single exact applicable rule identity.');
    return;
  }
  const ruleId = await mappedId(ctx, 'compensation_rule', SOURCE_COMMISSION_RULE, ruleSourceId);
  if (!ruleId) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, evidence, 'COMPENSATION_RULE_UNRESOLVED', 'Legacy compensation accrual rule has no exact canonical mapping.');
    return;
  }
  const canonicalRule = await ctx.db.prepare(`
    SELECT rule_public_id,rule_version,scope_type,service_public_id,category_key,
           practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
           calculation_basis
    FROM canonical_compensation_rules
    WHERE tenant_id=? AND rule_public_id=? AND rule_version=1 LIMIT 1
  `).bind(ctx.tenantId, ruleId).first<CanonicalRuleRow>();
  if (!canonicalRule || canonicalRule.practitioner_public_id !== practitionerPublicId || canonicalRule.practitioner_role !== practitionerRole) {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, evidence, 'COMPENSATION_RULE_MISMATCH', 'Canonical compensation rule beneficiary or role does not match legacy accrual.');
    return;
  }
  const lineAuthority = await resolveLegacyAccrualLineAuthority(ctx, row, canonicalRule);
  if (lineAuthority.status === 'nonimportable') {
    await classifyOne(
      ctx,
      cp,
      cursor,
      'compensation_accrual',
      SOURCE_ACCRUAL,
      'doctor_commission_accruals',
      sourceId,
      evidence,
      lineAuthority.issueCode,
      lineAuthority.summary,
      lineAuthority.resolutionCode,
    );
    return;
  }
  if (lineAuthority.status === 'unresolved') {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, evidence, 'COMPENSATION_INVOICE_LINE_UNRESOLVED', 'Legacy compensation accrual has no exact posted canonical invoice line.');
    return;
  }
  const line = lineAuthority.line;
  let grossMinor: number;
  let baseMinor: number;
  let performerReserveMinor: number;
  let earnedMinor: number;
  let adjustedMinor: number;
  let payableSnapshotMinor: number;
  let paidMinor: number;
  let balanceMinor: number;
  try {
    grossMinor = exactMajorToMinor(row.gross_amount, 'legacy accrual gross amount', true);
    baseMinor = exactMajorToMinor(row.commission_base_amount, 'legacy accrual base amount', true);
    performerReserveMinor = exactMajorToMinor(row.performer_reserve_amount, 'legacy accrual performer reserve', true);
    earnedMinor = exactMajorToMinor(row.earned_commission_amount || row.commission_amount, 'legacy accrual earned amount');
    adjustedMinor = exactMajorToMinor(row.doctor_waiver_amount, 'legacy accrual waiver amount', true);
    payableSnapshotMinor = exactMajorToMinor(row.payable_commission_amount, 'legacy accrual payable amount', true);
    paidMinor = exactMajorToMinor(row.paid_amount, 'legacy accrual paid amount', true);
    balanceMinor = exactMajorToMinor(row.balance_amount, 'legacy accrual balance amount', true);
  } catch {
    await rejectOne(ctx, cp, cursor, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, evidence, 'COMPENSATION_AMOUNT_UNRESOLVED', 'Legacy compensation accrual money cannot be converted exactly to minor units.');
    return;
  }
  const expectedPayable = earnedMinor - adjustedMinor;
  if (
    grossMinor !== line.line_amount_minor
    || baseMinor < 0
    || baseMinor > grossMinor
    || performerReserveMinor > grossMinor
    || expectedPayable !== payableSnapshotMinor
    || (row.status === 'paid' && (paidMinor !== payableSnapshotMinor || balanceMinor !== 0))
    || (row.status !== 'paid' && (paidMinor !== 0 || balanceMinor !== payableSnapshotMinor))
  ) {
    await classifyOne(
      ctx,
      cp,
      cursor,
      'compensation_accrual',
      SOURCE_ACCRUAL,
      'doctor_commission_accruals',
      sourceId,
      evidence,
      'COMPENSATION_SNAPSHOT_CONFLICT_NOT_IMPORTABLE',
      'Legacy compensation snapshots conflict with exact canonical invoice-line authority and cannot be imported without rewriting source history.',
      'DETERMINISTIC_NONIMPORTABLE_SNAPSHOT_CONFLICT',
    );
    return;
  }
  const accrualId = await createDeterministicSourceId('compacc', ctx.tenantId, SOURCE_ACCRUAL, sourceId);
  const accruedAt = legacyUtc(row.created_at ?? row.accrued_date, ctx.nowUtc);
  await ctx.db.batch([
    ctx.db.prepare(`
      INSERT INTO canonical_compensation_accruals (
        tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
        service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
        rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
        gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
        earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
        business_date,payable_projection_guard,source_evidence_sha256,
        created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?,'commission',?,1,?,?,?,?,?,0,0,?,?,?,?,0,?,'accrued',?,?,1,?,?,?)
    `).bind(
      ctx.tenantId,
      accrualId,
      line.invoice_public_id,
      line.line_public_id,
      line.service_event_public_id,
      practitionerPublicId,
      practitionerRole,
      ruleId,
      canonicalRule.calculation_basis,
      canonicalRule.rate_type,
      canonicalRule.rate_value,
      line.currency_code,
      grossMinor,
      performerReserveMinor,
      baseMinor,
      earnedMinor,
      adjustedMinor,
      expectedPayable,
      accruedAt,
      dateOnly(row.accrued_date ?? row.created_at, accruedAt),
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
    mapStatement(ctx, 'compensation_accrual', SOURCE_ACCRUAL, 'doctor_commission_accruals', sourceId, accrualId, 'mapped', evidence),
    progress(ctx, cp, cursor, 1, 1, 0, 0),
  ]);
}

async function rejectSettlement(
  ctx: Context,
  cp: CheckpointRow,
  row: SettlementRow,
  items: SettlementItemRow[],
  evidence: string,
  itemEvidence: string[],
  code: string,
  summary: string,
): Promise<void> {
  const sourceId = settlementSourceId(row);
  const statements: CompensationBackfillPreparedStatement[] = [
    mapStatement(ctx, 'compensation_settlement', SOURCE_SETTLEMENT, 'doctor_commission_settlements', sourceId, null, 'ambiguous', evidence),
  ];
  for (let index = 0; index < items.length; index += 1) {
    statements.push(mapStatement(
      ctx,
      'compensation_settlement_allocation',
      SOURCE_SETTLEMENT_ITEM,
      'doctor_commission_settlement_items',
      String(items[index].id),
      null,
      'ambiguous',
      itemEvidence[index],
    ));
  }
  statements.push(await issueStatement(ctx, code, 'compensation_settlement', SOURCE_SETTLEMENT, sourceId, summary));
  statements.push(progress(ctx, cp, `5:${row.id}`, 0, 1 + items.length, 0, 1));
  await ctx.db.batch(statements);
}

async function classifySettlement(
  ctx: Context,
  cp: CheckpointRow,
  row: SettlementRow,
  items: SettlementItemRow[],
  evidence: string,
  itemEvidence: string[],
  code: string,
  summary: string,
  resolutionCode: string,
): Promise<void> {
  const sourceId = settlementSourceId(row);
  const statements: CompensationBackfillPreparedStatement[] = [
    mapStatement(ctx, 'compensation_settlement', SOURCE_SETTLEMENT, 'doctor_commission_settlements', sourceId, null, 'rejected', evidence),
  ];
  for (let index = 0; index < items.length; index += 1) {
    statements.push(mapStatement(
      ctx,
      'compensation_settlement_allocation',
      SOURCE_SETTLEMENT_ITEM,
      'doctor_commission_settlement_items',
      String(items[index].id),
      null,
      'rejected',
      itemEvidence[index],
    ));
  }
  statements.push(await classifiedIssueStatement(
    ctx,
    code,
    'compensation_settlement',
    SOURCE_SETTLEMENT,
    sourceId,
    summary,
    resolutionCode,
  ));
  statements.push(progress(ctx, cp, `5:${row.id}`, 0, 1 + items.length, 0, 1));
  await ctx.db.batch(statements);
}

async function processSettlement(ctx: Context, cp: CheckpointRow, id: number): Promise<void> {
  const row = await ctx.db.prepare(`
    SELECT id,doctor_id,settlement_date,total_amount,payment_mode,reference_no,
           created_at,settlement_no,gross_commission_amount,advance_deduction,
           other_adjustment,rounding_adjustment,net_paid_amount,payment_method,
           idempotency_key,reversed_at,reversal_reason
    FROM doctor_commission_settlements WHERE CAST(tenant_id AS TEXT)=? AND id=? LIMIT 1
  `).bind(ctx.tenantId, id).first<SettlementRow>();
  if (!row) throw new Error(`Legacy compensation settlement not found: ${id}`);
  const items = await all<SettlementItemRow>(ctx.db.prepare(`
    SELECT id,settlement_id,accrual_id,doctor_id,source_type,bill_id,service_date,
           gross_amount,commission_amount,created_at
    FROM doctor_commission_settlement_items
    WHERE CAST(tenant_id AS TEXT)=? AND settlement_id=? ORDER BY id
  `).bind(ctx.tenantId, row.id));
  const sourceId = settlementSourceId(row);
  let evidence = await fallbackSettlementEvidence(row);
  const itemEvidence = await Promise.all(items.map(fallbackSettlementItemEvidence));
  const prior = await existing(ctx, 'compensation_settlement', SOURCE_SETTLEMENT, sourceId);
  if (prior) {
    if (prior.mapping_status === 'mapped' && prior.canonical_public_id) {
      const canonicalSettlement = await ctx.db.prepare(`
        SELECT settlement_public_id,status,settlement_projection_guard
        FROM canonical_compensation_settlements
        WHERE tenant_id=? AND settlement_public_id=?
        LIMIT 1
      `).bind(ctx.tenantId, prior.canonical_public_id).first<{
        settlement_public_id: string;
        status: string;
        settlement_projection_guard: number;
      }>();
      if (!canonicalSettlement) throw new Error('Mapped canonical compensation settlement not found');
      if (Number(canonicalSettlement.settlement_projection_guard) !== 1) {
        throw new Error('Mapped canonical compensation settlement projection is invalid');
      }
      const sourceIsReversed = row.reversed_at != null;
      const canonicalIsReversed = canonicalSettlement.status === 'reversed';
      if (sourceIsReversed !== canonicalIsReversed) {
        throw new Error('Mapped canonical compensation settlement reversal state differs from legacy');
      }
    } else {
      assertEvidence(prior, evidence, 'Compensation settlement');
    }
    await ctx.db.batch([progress(ctx, cp, `5:${row.id}`, 0, 0, 1, 0)]);
    return;
  }
  if (row.reversed_at != null) {
    await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_SETTLEMENT_REVERSAL_UNRESOLVED', 'Reversed legacy settlement requires explicit canonical settlement-reversal facts.');
    return;
  }
  if (items.length === 0) {
    await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_SETTLEMENT_ITEMS_MISSING', 'Legacy compensation settlement has no allocation items.');
    return;
  }
  const practitionerPublicId = await practitionerId(ctx, row.doctor_id);
  if (!practitionerPublicId) {
    await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_PRACTITIONER_UNRESOLVED', 'Legacy compensation settlement doctor has no exact canonical practitioner mapping.');
    return;
  }
  let totalMinor: number;
  let grossMinor: number;
  let netMinor: number;
  let advanceMinor: number;
  let otherMinor: number;
  let roundingMinor: number;
  const itemMinor: number[] = [];
  try {
    totalMinor = exactMajorToMinor(row.total_amount, 'settlement total');
    grossMinor = exactMajorToMinor(row.gross_commission_amount, 'settlement gross', true);
    netMinor = exactMajorToMinor(row.net_paid_amount, 'settlement net paid');
    advanceMinor = exactMajorToMinor(row.advance_deduction, 'settlement advance deduction', true);
    otherMinor = exactSignedMajorToMinor(row.other_adjustment, 'settlement other adjustment');
    roundingMinor = exactSignedMajorToMinor(row.rounding_adjustment, 'settlement rounding adjustment');
    for (const item of items) itemMinor.push(exactMajorToMinor(item.commission_amount, 'settlement item amount'));
  } catch {
    await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_AMOUNT_UNRESOLVED', 'Legacy compensation settlement money cannot be converted exactly to minor units.');
    return;
  }
  const itemTotalMinor = itemMinor.reduce((sum, value) => sum + value, 0);
  if (
    totalMinor !== netMinor
    || grossMinor < netMinor
    || grossMinor - advanceMinor + otherMinor + roundingMinor !== netMinor
    || itemTotalMinor !== grossMinor
  ) {
    await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_SETTLEMENT_ADJUSTMENT_UNRESOLVED', 'Legacy settlement deductions or item totals do not reconcile to one exact canonical settlement.');
    return;
  }
  const deductionMinor = grossMinor - netMinor;
  const accruals: CanonicalAccrualRow[] = [];
  const accrualSources: SettlementAccrualSourceIdentity[] = [];
  const allocationSourceIds: string[] = [];
  const resolvedAccrualPublicIds = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const accrualSource = await settlementAccrualSourceIdentity(ctx, item.accrual_id);
    if (!accrualSource) {
      await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_SETTLEMENT_ACCRUAL_UNRESOLVED', 'Legacy settlement item has no exact canonical accrual source identity.');
      return;
    }
    const allocationSourceId = settlementAllocationSourceId(
      sourceId,
      accrualSource.sourceType,
      accrualSource.sourcePublicId,
    );
    itemEvidence[index] = await fallbackSettlementItemEvidence(item, allocationSourceId);
    const priorAllocation = await existing(
      ctx,
      'compensation_settlement_allocation',
      SOURCE_SETTLEMENT_ITEM,
      allocationSourceId,
    );
    if (priorAllocation) {
      throw new Error('Canonical settlement allocation mapping exists without settlement mapping');
    }
    const accrualMapping = await existing(
      ctx,
      'compensation_accrual',
      accrualSource.sourceType,
      accrualSource.sourcePublicId,
    );
    const accrualId = accrualMapping?.mapping_status === 'mapped'
      ? accrualMapping.canonical_public_id
      : null;
    if (!accrualId) {
      if (accrualMapping?.mapping_status === 'rejected') {
        await classifySettlement(
          ctx,
          cp,
          row,
          items,
          evidence,
          itemEvidence,
          'COMPENSATION_SETTLEMENT_CONTAINS_NONIMPORTABLE_ACCRUAL',
          'Legacy settlement contains at least one deterministically non-importable compensation accrual.',
          'DETERMINISTIC_NONIMPORTABLE_SETTLEMENT',
        );
      } else {
        await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_SETTLEMENT_ACCRUAL_UNRESOLVED', 'Legacy settlement item has no exact canonical accrual mapping.');
      }
      return;
    }
    const accrual = await ctx.db.prepare(`
      SELECT accrual_public_id,invoice_public_id,invoice_line_public_id,
             service_event_public_id,practitioner_public_id,practitioner_role,
             currency_code,earned_minor,adjusted_minor,settled_minor,payable_minor,status
      FROM canonical_compensation_accruals
      WHERE tenant_id=? AND accrual_public_id=? LIMIT 1
    `).bind(ctx.tenantId, accrualId).first<CanonicalAccrualRow>();
    if (
      !accrual
      || (accrual.practitioner_public_id != null && accrual.practitioner_public_id !== practitionerPublicId)
      || accrual.currency_code !== ctx.currencyCode
      || item.doctor_id !== row.doctor_id
      || itemMinor[index] !== accrual.payable_minor
      || !['unassigned', 'accrued', 'approved'].includes(accrual.status)
    ) {
      await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_SETTLEMENT_ACCRUAL_MISMATCH', 'Legacy settlement item does not match canonical accrual beneficiary, currency, or payable balance.');
      return;
    }
    if (resolvedAccrualPublicIds.has(accrual.accrual_public_id)) {
      await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_SETTLEMENT_DUPLICATE_ACCRUAL', 'Legacy settlement contains the same canonical compensation accrual more than once.');
      return;
    }
    resolvedAccrualPublicIds.add(accrual.accrual_public_id);
    accruals.push(accrual);
    accrualSources.push(accrualSource);
    allocationSourceIds.push(allocationSourceId);
  }
  let allocationPlan: ReturnType<typeof allocateCompensationSettlement>;
  try {
    allocationPlan = allocateCompensationSettlement(itemMinor, netMinor);
  } catch {
    await rejectSettlement(ctx, cp, row, items, evidence, itemEvidence, 'COMPENSATION_SETTLEMENT_ADJUSTMENT_UNRESOLVED', 'Legacy settlement deduction allocation cannot retain a reversible canonical allocation for every accrual.');
    return;
  }
  const adjustmentMinorByItem = allocationPlan.map((entry) => entry.adjustmentMinor);
  const allocationMinorByItem = allocationPlan.map((entry) => entry.allocationMinor);
  const settlementId = await createDeterministicSourceId('compset', ctx.tenantId, SOURCE_SETTLEMENT, sourceId);
  const settledAt = legacyUtc(row.created_at ?? row.settlement_date, ctx.nowUtc);
  const businessDate = dateOnly(row.settlement_date ?? row.created_at, settledAt);
  evidence = await canonicalSettlementEvidence({
    row,
    sourceId,
    grossMinor,
    deductionMinor,
    netMinor,
    settledAtUtc: settledAt,
    businessDate,
    accrualSources: accrualSources.map((accrualSource, index) => ({
      sourceType: accrualSource.sourceType,
      sourcePublicId: accrualSource.sourcePublicId,
      grossMinor: itemMinor[index],
      adjustmentMinor: adjustmentMinorByItem[index],
      allocationMinor: allocationMinorByItem[index],
    })),
  });
  for (let index = 0; index < items.length; index += 1) {
    itemEvidence[index] = await canonicalSettlementAllocationEvidence({
      sourcePublicId: allocationSourceIds[index],
      settlementPublicId: settlementId,
      accrualPublicId: accruals[index].accrual_public_id,
      amountMinor: allocationMinorByItem[index],
      adjustedMinor: adjustmentMinorByItem[index],
      allocatedAtUtc: settledAt,
    });
  }
  const statements: CompensationBackfillPreparedStatement[] = [
    ctx.db.prepare(`
      INSERT INTO canonical_compensation_settlements (
        tenant_id,settlement_public_id,settlement_number,practitioner_public_id,
        currency_code,payment_method,total_minor,allocated_minor,reversed_minor,
        net_paid_minor,status,settled_at_utc,business_date,reversed_at_utc,
        settlement_projection_guard,source_evidence_sha256,created_at_utc,updated_at_utc
      ) VALUES (?,?,?,?,?,?,?, ?,0,?,'posted',?,?,NULL,1,?,?,?)
    `).bind(
      ctx.tenantId,
      settlementId,
      row.settlement_no?.trim() || `LEGACY-COMP-${row.id}`,
      practitionerPublicId,
      ctx.currencyCode,
      paymentMethod(row.payment_method || row.payment_mode),
      netMinor,
      netMinor,
      netMinor,
      settledAt,
      businessDate,
      evidence,
      ctx.nowUtc,
      ctx.nowUtc,
    ),
  ];
  let createdFactCount = 1;
  let mappedFactCount = 1;
  for (let index = 0; index < items.length; index += 1) {
    const accrual = accruals[index];
    const accrualSource = accrualSources[index];
    const grossItemMinor = itemMinor[index];
    const adjustmentMinor = adjustmentMinorByItem[index];
    const allocationMinor = allocationMinorByItem[index];
    const adjustedAfter = accrual.adjusted_minor + adjustmentMinor;
    const settledAfter = accrual.settled_minor + allocationMinor;
    const allocationSourceId = allocationSourceIds[index];

    if (adjustmentMinor > 0) {
      const deductionSourceId = `${sourceId}:deduction:${accrualSource.sourceType}:${accrualSource.sourcePublicId}`;
      const adjustmentId = await createDeterministicSourceId(
        'compadj',
        ctx.tenantId,
        SOURCE_SETTLEMENT_DEDUCTION,
        deductionSourceId,
      );
      const adjustmentEvidence = await createSourceEvidenceSha256({
        sourceType: SOURCE_SETTLEMENT_DEDUCTION,
        sourcePublicId: deductionSourceId,
        settlementPublicId: settlementId,
        accrualPublicId: accrual.accrual_public_id,
        amountMinor: adjustmentMinor,
        occurredAtUtc: settledAt,
        businessDate,
      });
      statements.push(
        ctx.db.prepare(`
          INSERT INTO canonical_compensation_adjustments (
            tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
            settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
            accrual_adjusted_before_minor,accrual_adjusted_after_minor,
            accrual_settled_before_minor,accrual_settled_after_minor,
            accrual_payable_before_minor,accrual_payable_after_minor,
            occurred_at_utc,business_date,balance_guard,source_evidence_sha256
          ) VALUES (?,?,?,NULL,NULL,'manual_recovery','settlement_deduction',?,?,?,?,?,?,?,?,?,1,?)
        `).bind(
          ctx.tenantId,
          adjustmentId,
          accrual.accrual_public_id,
          adjustmentMinor,
          accrual.adjusted_minor,
          adjustedAfter,
          accrual.settled_minor,
          accrual.settled_minor,
          grossItemMinor,
          grossItemMinor - adjustmentMinor,
          settledAt,
          businessDate,
          adjustmentEvidence,
        ),
        mapStatement(
          ctx,
          'compensation_adjustment',
          SOURCE_SETTLEMENT_DEDUCTION,
          'doctor_commission_settlements',
          deductionSourceId,
          adjustmentId,
          'mapped',
          adjustmentEvidence,
        ),
      );
      createdFactCount += 1;
      mappedFactCount += 1;
    }

    statements.push(ctx.db.prepare(`
      UPDATE canonical_compensation_accruals
      SET practitioner_public_id=?,adjusted_minor=?,settled_minor=?,payable_minor=0,
          status='settled',updated_at_utc=?
      WHERE tenant_id=? AND accrual_public_id=?
        AND adjusted_minor=? AND settled_minor=? AND payable_minor=?
        AND status IN ('unassigned','accrued','approved')
    `).bind(
      practitionerPublicId,
      adjustedAfter,
      settledAfter,
      settledAt,
      ctx.tenantId,
      accrual.accrual_public_id,
      accrual.adjusted_minor,
      accrual.settled_minor,
      grossItemMinor,
    ));

    if (allocationMinor <= 0) continue;
    const allocationId = await createDeterministicSourceId(
      'compalloc',
      ctx.tenantId,
      SOURCE_SETTLEMENT_ITEM,
      allocationSourceId,
    );
    statements.push(
      ctx.db.prepare(`
        INSERT INTO canonical_compensation_settlement_allocations (
          tenant_id,allocation_public_id,settlement_public_id,accrual_public_id,
          amount_minor,reversed_minor,remaining_minor,accrual_settled_before_minor,
          accrual_settled_after_minor,accrual_payable_before_minor,accrual_payable_after_minor,
          status,allocated_at_utc,reversed_at_utc,balance_guard,source_evidence_sha256,
          created_at_utc,updated_at_utc
        ) VALUES (?,?,?,?,?,0,?,?,?,?,0,'active',?,NULL,1,?,?,?)
      `).bind(
        ctx.tenantId,
        allocationId,
        settlementId,
        accrual.accrual_public_id,
        allocationMinor,
        allocationMinor,
        accrual.settled_minor,
        settledAfter,
        grossItemMinor - adjustmentMinor,
        settledAt,
        itemEvidence[index],
        ctx.nowUtc,
        ctx.nowUtc,
      ),
      ctx.db.prepare(`
        UPDATE canonical_compensation_settlement_allocations
        SET balance_guard=CASE WHEN EXISTS (
          SELECT 1 FROM canonical_compensation_accruals
          WHERE tenant_id=? AND accrual_public_id=?
            AND adjusted_minor=? AND settled_minor=? AND payable_minor=0 AND status='settled'
        ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND allocation_public_id=?
      `).bind(
        ctx.tenantId,
        accrual.accrual_public_id,
        adjustedAfter,
        settledAfter,
        ctx.tenantId,
        allocationId,
      ),
      mapStatement(
        ctx,
        'compensation_settlement_allocation',
        SOURCE_SETTLEMENT_ITEM,
        'doctor_commission_settlement_items',
        allocationSourceId,
        allocationId,
        'mapped',
        itemEvidence[index],
      ),
    );
    createdFactCount += 1;
    mappedFactCount += 1;
  }
  statements.push(
    ctx.db.prepare(`
      UPDATE canonical_compensation_settlements
      SET settlement_projection_guard=CASE WHEN allocated_minor=COALESCE((
        SELECT SUM(amount_minor)
        FROM canonical_compensation_settlement_allocations
        WHERE tenant_id=? AND settlement_public_id=?
      ),0) THEN 1 ELSE 0 END
      WHERE tenant_id=? AND settlement_public_id=?
    `).bind(ctx.tenantId, settlementId, ctx.tenantId, settlementId),
    mapStatement(ctx, 'compensation_settlement', SOURCE_SETTLEMENT, 'doctor_commission_settlements', sourceId, settlementId, 'mapped', evidence),
    progress(ctx, cp, `5:${row.id}`, createdFactCount, mappedFactCount, 0, 0),
  );
  await ctx.db.batch(statements);
}

async function fetchSources(ctx: Context, cp: CheckpointRow, limit: number): Promise<SourceRef[]> {
  const cursor = parseCursor(cp.cursor_value);
  return all<SourceRef>(ctx.db.prepare(`
    SELECT source_kind,sort_key,id FROM (
      SELECT 'performer_rule' source_kind,1 sort_key,id
      FROM diagnostic_performer_payout_rules WHERE CAST(tenant_id AS TEXT)=?
      UNION ALL
      SELECT 'commission_rule',2,id
      FROM doctor_commission_rules WHERE CAST(tenant_id AS TEXT)=?
      UNION ALL
      SELECT 'performer_reserve',3,id
      FROM diagnostic_performer_reserves WHERE CAST(tenant_id AS TEXT)=?
      UNION ALL
      SELECT 'commission_accrual',4,id
      FROM doctor_commission_accruals WHERE CAST(tenant_id AS TEXT)=?
      UNION ALL
      SELECT 'settlement',5,id
      FROM doctor_commission_settlements WHERE CAST(tenant_id AS TEXT)=?
    ) sources
    WHERE sort_key>? OR (sort_key=? AND id>?)
    ORDER BY sort_key,id
    LIMIT ?
  `).bind(
    ctx.tenantId,
    ctx.tenantId,
    ctx.tenantId,
    ctx.tenantId,
    ctx.tenantId,
    cursor.sort,
    cursor.sort,
    cursor.id,
    limit,
  ));
}

async function finish(ctx: Context, cp: CheckpointRow): Promise<void> {
  const summary = JSON.stringify({ domain: 'practitioner_compensation', completed: true });
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

export async function backfillCompensation(
  db: CompensationBackfillDatabase,
  options: CompensationBackfillOptions,
): Promise<CompensationBackfillResult> {
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
    if (ref.source_kind === 'performer_rule') await processPerformerRule(ctx, cp, ref.id);
    else if (ref.source_kind === 'commission_rule') await processCommissionRule(ctx, cp, ref.id);
    else if (ref.source_kind === 'performer_reserve') await processReserve(ctx, cp, ref.id);
    else if (ref.source_kind === 'commission_accrual') await processAccrual(ctx, cp, ref.id);
    else await processSettlement(ctx, cp, ref.id);
    scanned += 1;
  }
  const completed = refs.length <= maxSourceRecords;
  if (completed) await finish(ctx, cp);
  return result(db, tenantId, start, scanned, completed);
}
