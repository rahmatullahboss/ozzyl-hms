import type { D1PreparedStatement } from '@cloudflare/workers-types';
import {
  prepareCompensationAdjustment,
  type AdjustCompensationResult,
} from './commands/accrue-compensation';
import type {
  CanonicalBatchDatabase,
  CanonicalCommandExecutionOptions,
  CanonicalPreparedStatement,
} from './command-batch';
import {
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from './financial-batch-assertion';
import { toMinorUnits } from './money';
import { executeStrictFinancialMutation } from './strict-financial-mutation';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import { prepareMasterDataAudit } from '../master-data-audit';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
} from '../accounting-posting';

const RESERVE_SOURCE_TYPE = 'legacy_diagnostic_performer_reserve';
const CANCELLATION_SOURCE_TYPE = 'legacy_diagnostic_performer_reserve_cancellation';

interface QueryStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): QueryStatement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

interface PerformerReserveCancellationRow {
  id: number;
  bill_id: number;
  invoice_item_id: number;
  unit_sequence: number;
  reserved_amount: number;
  status: string;
  canonical_source_key: string | null;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

export interface PerformerReserveCancellationQuantity {
  invoiceItemId: number;
  quantity: number;
}

export interface CancelPerformerReserveInput {
  tenantId: string;
  billId: number;
  invoiceItemIds?: readonly number[];
  quantities?: readonly PerformerReserveCancellationQuantity[];
  reason: string;
  userId: string | number;
  cancelledAtUtc: string;
  businessDate: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function exact(value: string, label: string): string {
  if (!value || value.trim() !== value) {
    throw new TypeError(`${label} must be non-empty without surrounding whitespace`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function normalizedIds(values: readonly number[] | undefined): number[] {
  return [...new Set((values ?? []).map((value) => positiveInteger(Number(value), 'invoiceItemId')))]
    .sort((a, b) => a - b);
}

function normalizedQuantities(
  values: readonly PerformerReserveCancellationQuantity[] | undefined,
): Map<number, number> {
  const normalized = new Map<number, number>();
  for (const value of values ?? []) {
    const invoiceItemId = positiveInteger(Number(value.invoiceItemId), 'quantity.invoiceItemId');
    const quantity = positiveInteger(Number(value.quantity), 'quantity.quantity');
    normalized.set(invoiceItemId, (normalized.get(invoiceItemId) ?? 0) + quantity);
  }
  return normalized;
}

function assertDate(value: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`${label} must use YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError(`${label} must be a valid calendar date`);
  }
  return value;
}

function assertUtc(value: string, label: string): string {
  if (new Date(value).toISOString() !== value) {
    throw new RangeError(`${label} must be a normalized UTC ISO timestamp`);
  }
  return value;
}

async function loadEligibleReserves(
  db: CanonicalBatchDatabase,
  input: CancelPerformerReserveInput,
): Promise<PerformerReserveCancellationRow[]> {
  const itemIds = normalizedIds(input.invoiceItemIds);
  const quantityByItem = normalizedQuantities(input.quantities);
  if (itemIds.length > 0 && quantityByItem.size > 0) {
    throw new Error('Use invoiceItemIds or quantities, not both');
  }

  const scopedIds = quantityByItem.size > 0 ? [...quantityByItem.keys()].sort((a, b) => a - b) : itemIds;
  const placeholders = scopedIds.map(() => '?').join(',');
  const statement = db.prepare(`
    SELECT id,bill_id,invoice_item_id,unit_sequence,reserved_amount,status,canonical_source_key
    FROM diagnostic_performer_reserves
    WHERE tenant_id=? AND bill_id=? AND status='reserved'
      ${scopedIds.length > 0 ? `AND invoice_item_id IN (${placeholders})` : ''}
    ORDER BY invoice_item_id ASC,unit_sequence ASC,id ASC
  `) as QueryStatement;
  const { results = [] } = await statement
    .bind(input.tenantId, input.billId, ...scopedIds)
    .all<PerformerReserveCancellationRow>();

  if (quantityByItem.size === 0) return results;
  const selected: PerformerReserveCancellationRow[] = [];
  const selectedCounts = new Map<number, number>();
  for (const row of results) {
    const invoiceItemId = Number(row.invoice_item_id);
    const requested = quantityByItem.get(invoiceItemId) ?? 0;
    const current = selectedCounts.get(invoiceItemId) ?? 0;
    if (current >= requested) continue;
    selected.push(row);
    selectedCounts.set(invoiceItemId, current + 1);
  }
  for (const [invoiceItemId, requested] of quantityByItem) {
    if ((selectedCounts.get(invoiceItemId) ?? 0) !== requested) {
      throw new Error(`Insufficient reserved performer units for invoice item ${invoiceItemId}`);
    }
  }
  return selected;
}

async function resolveAccrualPublicId(
  db: CanonicalBatchDatabase,
  tenantId: string,
  sourceKey: string,
): Promise<string> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='compensation_accrual'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, RESERVE_SOURCE_TYPE, sourceKey).first<MappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error(`Exact Canonical performer reserve mapping not found for ${sourceKey}`);
  }
  return mapping.canonical_public_id;
}

function legacyStatementsForRows(
  db: CanonicalBatchDatabase,
  input: CancelPerformerReserveInput,
  rows: readonly PerformerReserveCancellationRow[],
): CanonicalPreparedStatement[] {
  const operationKey = `performer-reserve-cancel:${input.billId}:${rows.map((row) => row.id).join(',')}`;
  const statements: CanonicalPreparedStatement[] = [];
  for (const row of rows) {
    const sourceKey = row.canonical_source_key?.trim() || null;
    statements.push(
      db.prepare(`
        UPDATE diagnostic_performer_reserves
        SET status='cancelled',cancelled_at=datetime('now','+6 hours'),cancelled_by=?,
            cancel_reason=?,updated_at=datetime('now','+6 hours')
        WHERE tenant_id=? AND id=? AND bill_id=? AND invoice_item_id=? AND unit_sequence=?
          AND reserved_amount=? AND status='reserved'
          AND COALESCE(canonical_source_key,'')=COALESCE(?,'')
      `).bind(
        Number(input.userId),
        input.reason,
        input.tenantId,
        row.id,
        row.bill_id,
        row.invoice_item_id,
        row.unit_sequence,
        row.reserved_amount,
        sourceKey,
      ),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `reserve:${row.id}`,
        expectedChanges: 1,
      }),
      prepareMasterDataAudit(db as unknown as D1Database, {
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'UPDATE',
        tableName: 'diagnostic_performer_reserves',
        recordId: row.id,
        oldValue: {
          billId: row.bill_id,
          invoiceItemId: row.invoice_item_id,
          unitSequence: row.unit_sequence,
          reservedAmountMinor: Number(toMinorUnits(row.reserved_amount)),
          status: row.status,
          canonicalSourceKey: sourceKey,
        },
        newValue: {
          status: 'cancelled',
          reasonCode: 'service_cancellation',
          canonicalSourceKey: sourceKey,
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      }) as unknown as CanonicalPreparedStatement,
    );
  }
  statements.push(prepareClearFinancialBatchAssertions(db, input.tenantId, operationKey));
  return statements;
}

async function applyCanonicalCancellations(
  db: CanonicalBatchDatabase,
  input: CancelPerformerReserveInput,
  rows: readonly PerformerReserveCancellationRow[],
  execution: CanonicalCommandExecutionOptions,
): Promise<AdjustCompensationResult[]> {
  const statements: CanonicalPreparedStatement[] = [];
  const results: AdjustCompensationResult[] = [];
  const seenAccruals = new Set<string>();
  let authoritativeEmbedded = false;

  for (const row of rows) {
    const sourceKey = exact(String(row.canonical_source_key ?? ''), 'canonicalSourceKey');
    const accrualPublicId = await resolveAccrualPublicId(db, input.tenantId, sourceKey);
    if (seenAccruals.has(accrualPublicId)) {
      throw new Error(`Multiple performer reserve rows map to Canonical accrual ${accrualPublicId}`);
    }
    seenAccruals.add(accrualPublicId);
    const sourcePublicId = `${sourceKey}:cancel`;
    const amountMinor = Number(toMinorUnits(row.reserved_amount));
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      throw new RangeError(`Performer reserve ${row.id} has no positive minor-unit amount`);
    }
    const sourceEvidenceSha256 = await createSourceEvidenceSha256({
      sourceType: CANCELLATION_SOURCE_TYPE,
      sourcePublicId,
      reserveId: row.id,
      billId: row.bill_id,
      invoiceItemId: row.invoice_item_id,
      unitSequence: row.unit_sequence,
      reserveSourceKey: sourceKey,
      accrualPublicId,
      amountMinor,
      reason: input.reason,
      cancelledAtUtc: input.cancelledAtUtc,
      businessDate: input.businessDate,
    });
    const prepared = await prepareCompensationAdjustment(db, {
      tenantId: input.tenantId,
      adjustmentPublicId: await createDeterministicSourceId(
        'compadj', input.tenantId, CANCELLATION_SOURCE_TYPE, sourcePublicId,
      ),
      accrualPublicId,
      adjustmentType: 'service_cancellation',
      amountMinor,
      reasonCode: 'service_cancellation',
      occurredAtUtc: input.cancelledAtUtc,
      businessDate: input.businessDate,
      sourceType: CANCELLATION_SOURCE_TYPE,
      sourcePublicId,
      sourceTable: 'diagnostic_performer_reserves',
      sourceEvidenceSha256,
      idempotencyKey: `${CANCELLATION_SOURCE_TYPE}:${sourcePublicId}`,
      outboxEventPublicId: await createDeterministicSourceId(
        'outevt', input.tenantId, CANCELLATION_SOURCE_TYPE, sourcePublicId,
      ),
    }, {
      authoritativeStatements: !authoritativeEmbedded
        ? execution.authoritativeStatements
        : undefined,
    });
    if (prepared.status === 'replayed') {
      throw new Error(`Performer reserve ${row.id} is still reserved after its Canonical cancellation replay`);
    }
    authoritativeEmbedded = authoritativeEmbedded || Boolean(execution.authoritativeStatements?.length);
    statements.push(...prepared.statements);
    results.push(prepared.result);
  }

  if (statements.length > 0) await db.batch(statements);
  return results;
}

export async function cancelPerformerReservesWithCanonicalAdjustment(
  db: D1Database & CanonicalBatchDatabase,
  input: CancelPerformerReserveInput,
): Promise<number> {
  exact(input.tenantId, 'tenantId');
  positiveInteger(input.billId, 'billId');
  exact(input.reason, 'reason');
  positiveInteger(Number(input.userId), 'userId');
  assertUtc(input.cancelledAtUtc, 'cancelledAtUtc');
  assertDate(input.businessDate, 'businessDate');

  const rows = await loadEligibleReserves(db, input);
  if (rows.length === 0) return 0;
  const legacyStatements = legacyStatementsForRows(db, input, rows);
  await executeStrictFinancialMutation({
    db,
    tenantId: input.tenantId,
    boundary: 'doctor-compensation.adjust',
    legacyStatements,
    canonical: (execution) => applyCanonicalCancellations(db, input, rows, execution),
  });
  return rows.length;
}

interface DoctorCommissionCancellationRow {
  id: number;
  doctor_id: number;
  patient_id: number | null;
  visit_id: number | null;
  bill_id: number;
  source_type: string;
  gross_amount: number;
  commission_amount: number;
  earned_commission_amount: number;
  doctor_waiver_amount: number;
  payable_commission_amount: number;
  paid_amount: number;
  status: string;
  canonical_source_key: string | null;
}

interface CanonicalAccrualBalanceRow {
  accrual_public_id: string;
  adjusted_minor: number;
  settled_minor: number;
  payable_minor: number;
  status: string;
}

export interface CancelDoctorCommissionAccrualInput {
  tenantId: string;
  billId: number;
  sourceTypes: readonly string[];
  reason: string;
  userId: string | number;
  cancelledAtUtc: string;
  businessDate: string;
}

function effectiveLegacyPayable(row: DoctorCommissionCancellationRow): number {
  const reconciled = Number(row.earned_commission_amount ?? 0) !== 0
    || Number(row.doctor_waiver_amount ?? 0) !== 0
    || Number(row.payable_commission_amount ?? 0) !== 0;
  return reconciled
    ? Number(row.payable_commission_amount ?? 0)
    : Number(row.commission_amount ?? 0);
}

async function loadDoctorCommissionRows(
  db: CanonicalBatchDatabase,
  input: CancelDoctorCommissionAccrualInput,
): Promise<DoctorCommissionCancellationRow[]> {
  const sourceTypes = [...new Set(input.sourceTypes.map((value) => exact(value, 'sourceType')))].sort();
  if (sourceTypes.length === 0) return [];
  const statement = db.prepare(`
    SELECT id,doctor_id,patient_id,visit_id,bill_id,source_type,gross_amount,
           commission_amount,earned_commission_amount,doctor_waiver_amount,
           payable_commission_amount,paid_amount,status,canonical_source_key
    FROM doctor_commission_accruals
    WHERE tenant_id=? AND bill_id=? AND source_type IN (${sourceTypes.map(() => '?').join(',')})
      AND status='accrued'
    ORDER BY id ASC
  `) as QueryStatement;
  const { results = [] } = await statement
    .bind(input.tenantId, input.billId, ...sourceTypes)
    .all<DoctorCommissionCancellationRow>();
  return results;
}

function doctorCommissionLegacyStatements(
  db: CanonicalBatchDatabase,
  input: CancelDoctorCommissionAccrualInput,
  rows: readonly DoctorCommissionCancellationRow[],
): CanonicalPreparedStatement[] {
  const operationKey = `doctor-commission-cancel:${input.billId}:${rows.map((row) => row.id).join(',')}`;
  const statements: CanonicalPreparedStatement[] = [];
  for (const row of rows) {
    const sourceKey = row.canonical_source_key?.trim() || null;
    const payableMinor = Number(toMinorUnits(effectiveLegacyPayable(row)));
    const sourceEventKey = createPostingEventKey(
      'doctor_commission_accrual',
      row.id,
      ACCOUNTING_EVENT_TYPES.commissionCancelled,
    );
    statements.push(
      db.prepare(`
        UPDATE doctor_commission_accruals
        SET status='cancelled',notes=COALESCE(notes,'') || ?,updated_at=datetime('now','+6 hours')
        WHERE tenant_id=? AND id=? AND bill_id=? AND doctor_id=? AND source_type=?
          AND gross_amount=? AND commission_amount=?
          AND COALESCE(earned_commission_amount,0)=?
          AND COALESCE(doctor_waiver_amount,0)=?
          AND COALESCE(payable_commission_amount,0)=?
          AND COALESCE(paid_amount,0)=? AND status='accrued'
          AND COALESCE(canonical_source_key,'')=COALESCE(?,'')
      `).bind(
        ` | Item Cancelled: ${input.reason}`,
        input.tenantId,
        row.id,
        row.bill_id,
        row.doctor_id,
        row.source_type,
        row.gross_amount,
        row.commission_amount,
        Number(row.earned_commission_amount ?? 0),
        Number(row.doctor_waiver_amount ?? 0),
        Number(row.payable_commission_amount ?? 0),
        Number(row.paid_amount ?? 0),
        sourceKey,
      ),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `accrual:${row.id}`,
        expectedChanges: 1,
      }),
      db.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events(
          tenant_id,source_event_key,source_type,source_id,event_type,event_date,
          payload_json,created_by
        ) VALUES (? ,?,'doctor_commission_accrual',?,?,?, ?,?)
      `).bind(
        input.tenantId,
        sourceEventKey,
        String(row.id),
        ACCOUNTING_EVENT_TYPES.commissionCancelled,
        input.businessDate,
        JSON.stringify({
          accrualId: row.id,
          doctorId: row.doctor_id,
          patientId: row.patient_id,
          visitId: row.visit_id,
          billId: row.bill_id,
          commissionSourceType: row.source_type,
          grossAmount: row.gross_amount,
          amount: effectiveLegacyPayable(row),
          reason: input.reason,
        }),
        String(input.userId),
      ),
      prepareFinancialBatchAssertion(db, {
        tenantId: input.tenantId,
        operationKey,
        stepKey: `accounting:${row.id}`,
        expectedChanges: 1,
      }),
      prepareMasterDataAudit(db as unknown as D1Database, {
        tenantId: input.tenantId,
        userId: input.userId,
        action: 'UPDATE',
        tableName: 'doctor_commission_accruals',
        recordId: row.id,
        oldValue: {
          status: row.status,
          billId: row.bill_id,
          doctorId: row.doctor_id,
          sourceType: row.source_type,
          payableMinor,
          canonicalSourceKey: sourceKey,
        },
        newValue: {
          status: 'cancelled',
          reasonCode: 'service_cancellation',
          canonicalSourceKey: sourceKey,
        },
      }) as unknown as CanonicalPreparedStatement,
    );
  }
  statements.push(prepareClearFinancialBatchAssertions(db, input.tenantId, operationKey));
  return statements;
}

async function resolveDoctorAccrual(
  db: CanonicalBatchDatabase,
  tenantId: string,
  sourceKey: string,
): Promise<CanonicalAccrualBalanceRow> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='compensation_accrual'
      AND source_type='legacy_doctor_commission_accrual' AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, sourceKey).first<MappingRow>();
  if (mapping?.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error(`Exact Canonical doctor commission mapping not found for ${sourceKey}`);
  }
  const accrual = await db.prepare(`
    SELECT accrual_public_id,adjusted_minor,settled_minor,payable_minor,status
    FROM canonical_compensation_accruals
    WHERE tenant_id=? AND accrual_public_id=?
    LIMIT 1
  `).bind(tenantId, mapping.canonical_public_id).first<CanonicalAccrualBalanceRow>();
  if (!accrual) throw new Error(`Canonical doctor commission accrual not found for ${sourceKey}`);
  return accrual;
}

async function applyCanonicalDoctorCommissionCancellations(
  db: CanonicalBatchDatabase,
  input: CancelDoctorCommissionAccrualInput,
  rows: readonly DoctorCommissionCancellationRow[],
  execution: CanonicalCommandExecutionOptions,
): Promise<AdjustCompensationResult[]> {
  const statements: CanonicalPreparedStatement[] = [];
  const results: AdjustCompensationResult[] = [];
  let authoritativeEmbedded = false;
  const seen = new Set<string>();

  for (const row of rows) {
    const sourceKey = exact(String(row.canonical_source_key ?? ''), 'canonicalSourceKey');
    const accrual = await resolveDoctorAccrual(db, input.tenantId, sourceKey);
    if (seen.has(accrual.accrual_public_id)) {
      throw new Error(`Multiple doctor commission rows map to ${accrual.accrual_public_id}`);
    }
    seen.add(accrual.accrual_public_id);
    const amountMinor = Number(toMinorUnits(effectiveLegacyPayable(row)));
    if (amountMinor === 0) {
      if (accrual.payable_minor !== 0 || accrual.settled_minor !== 0) {
        throw new Error(`Zero legacy payable does not match Canonical accrual ${accrual.accrual_public_id}`);
      }
      continue;
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
      throw new RangeError(`Doctor commission accrual ${row.id} has invalid payable amount`);
    }
    const sourcePublicId = `${sourceKey}:cancel`;
    const sourceEvidenceSha256 = await createSourceEvidenceSha256({
      sourceType: 'legacy_doctor_commission_cancellation',
      sourcePublicId,
      accrualId: row.id,
      accrualPublicId: accrual.accrual_public_id,
      billId: row.bill_id,
      doctorId: row.doctor_id,
      legacySourceType: row.source_type,
      amountMinor,
      paidMinor: Number(toMinorUnits(row.paid_amount ?? 0)),
      reason: input.reason,
      cancelledAtUtc: input.cancelledAtUtc,
      businessDate: input.businessDate,
    });
    const prepared = await prepareCompensationAdjustment(db, {
      tenantId: input.tenantId,
      adjustmentPublicId: await createDeterministicSourceId(
        'compadj', input.tenantId, 'legacy_doctor_commission_cancellation', sourcePublicId,
      ),
      accrualPublicId: accrual.accrual_public_id,
      adjustmentType: 'service_cancellation',
      amountMinor,
      reasonCode: 'service_cancellation',
      occurredAtUtc: input.cancelledAtUtc,
      businessDate: input.businessDate,
      sourceType: 'legacy_doctor_commission_cancellation',
      sourcePublicId,
      sourceTable: 'doctor_commission_accruals',
      sourceEvidenceSha256,
      idempotencyKey: `legacy_doctor_commission_cancellation:${sourcePublicId}`,
      outboxEventPublicId: await createDeterministicSourceId(
        'outevt', input.tenantId, 'legacy_doctor_commission_cancellation', sourcePublicId,
      ),
    }, {
      authoritativeStatements: !authoritativeEmbedded
        ? execution.authoritativeStatements
        : undefined,
    });
    if (prepared.status === 'replayed') {
      throw new Error(`Doctor commission accrual ${row.id} remains accrued after Canonical replay`);
    }
    authoritativeEmbedded = authoritativeEmbedded || Boolean(execution.authoritativeStatements?.length);
    statements.push(...prepared.statements);
    results.push(prepared.result);
  }

  if (statements.length > 0) {
    await db.batch(statements);
  } else if (execution.authoritativeStatements?.length) {
    await db.batch([...execution.authoritativeStatements]);
  }
  return results;
}

export async function cancelDoctorCommissionAccrualsWithCanonicalAdjustment(
  db: D1Database & CanonicalBatchDatabase,
  input: CancelDoctorCommissionAccrualInput,
): Promise<number> {
  exact(input.tenantId, 'tenantId');
  positiveInteger(input.billId, 'billId');
  exact(input.reason, 'reason');
  positiveInteger(Number(input.userId), 'userId');
  assertUtc(input.cancelledAtUtc, 'cancelledAtUtc');
  assertDate(input.businessDate, 'businessDate');
  const rows = await loadDoctorCommissionRows(db, input);
  if (rows.length === 0) return 0;
  const legacyStatements = doctorCommissionLegacyStatements(db, input, rows);
  await executeStrictFinancialMutation({
    db,
    tenantId: input.tenantId,
    boundary: 'doctor-compensation.adjust',
    legacyStatements,
    canonical: (execution) => applyCanonicalDoctorCommissionCancellations(db, input, rows, execution),
  });
  return rows.length;
}

export type PerformerReserveCancellationDatabase = D1Database & CanonicalBatchDatabase;
export type PerformerReserveCancellationStatement = D1PreparedStatement;
