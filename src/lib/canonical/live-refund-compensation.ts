import {
  readCanonicalCommandReplay,
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from './command-batch';
import { toMinorUnits, type DecimalAmount } from './money';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
} from './source-mapping';
import { toUtcIso } from './time';

const LEGACY_ACCRUAL_SOURCE_TYPE = 'legacy_doctor_commission_accrual';
const REFUND_RESERVATION_SOURCE_TYPE = 'legacy_refund_commission_reservation';
const REFUND_RELEASE_SOURCE_TYPE = 'legacy_refund_commission_release';

interface QueryPreparedStatement extends CanonicalPreparedStatement {
  bind(...values: unknown[]): QueryPreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
}

interface MappingRow {
  canonical_public_id: string | null;
  mapping_status: string;
}

interface AccrualRow {
  accrual_public_id: string;
  practitioner_public_id: string | null;
  adjusted_minor: number;
  settled_minor: number;
  payable_minor: number;
  status: string;
}

interface ReservationReleaseRow {
  reservation_public_id: string;
  accrual_public_id: string;
  adjustment_public_id: string;
  original_payable_minor: number;
  reserved_payable_minor: number;
  paid_minor: number;
  reversal_minor: number;
  status: string;
  practitioner_public_id: string | null;
  adjusted_minor: number;
  settled_minor: number;
  payable_minor: number;
  accrual_status: string;
}

export interface LiveRefundCompensationReservationRowInput {
  legacyAccrualId: number;
  legacyAccrualSourceKey?: string | null;
  originalCommissionBaseAmount: DecimalAmount;
  reservedCommissionBaseAmount: DecimalAmount;
  originalEarnedAmount: DecimalAmount;
  reservedEarnedAmount: DecimalAmount;
  originalDoctorWaiverAmount: DecimalAmount;
  reservedDoctorWaiverAmount: DecimalAmount;
  originalPayableAmount: DecimalAmount;
  reservedPayableAmount: DecimalAmount;
  paidAmount: DecimalAmount;
  reversalAmount: DecimalAmount;
}

export interface LiveRefundCompensationReservationInput {
  tenantId: string;
  refundSourcePublicId: string;
  legacyApprovalRequestId?: number | null;
  occurredAtUtc: string;
  businessDate: string;
  reasonCode: string;
  rows: readonly LiveRefundCompensationReservationRowInput[];
}

export interface LiveRefundCompensationReleaseInput {
  tenantId: string;
  refundSourcePublicId: string;
  occurredAtUtc: string;
  businessDate: string;
  reasonCode: string;
}

export interface LiveRefundCompensationResult {
  refundSourcePublicId: string;
  affectedAccruals: number;
  totalReversalMinor: number;
}

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function optionalPositiveInteger(value: number | null | undefined, label: string): number | null {
  if (value == null) return null;
  return positiveInteger(value, label);
}

function businessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('businessDate must use YYYY-MM-DD');
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

function statusFor(practitionerPublicId: string | null, settledMinor: number, payableMinor: number): string {
  if (practitionerPublicId == null) return 'unassigned';
  if (payableMinor === 0) return 'settled';
  if (settledMinor > 0) return 'partially_settled';
  return 'accrued';
}

function mappingStatement(
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

async function resolveCanonicalAccrual(
  db: CanonicalBatchDatabase,
  tenantId: string,
  row: LiveRefundCompensationReservationRowInput,
): Promise<AccrualRow> {
  const sourceIds = [row.legacyAccrualSourceKey?.trim() || null, String(row.legacyAccrualId)]
    .filter((value): value is string => Boolean(value));
  let canonicalPublicId: string | null = null;
  for (const sourcePublicId of sourceIds) {
    const mapping = await db.prepare(`
      SELECT canonical_public_id,mapping_status
      FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='compensation_accrual'
        AND source_type=? AND source_public_id=?
      LIMIT 1
    `).bind(
      tenantId,
      LEGACY_ACCRUAL_SOURCE_TYPE,
      sourcePublicId,
    ).first<MappingRow>();
    if (mapping?.mapping_status === 'mapped' && mapping.canonical_public_id) {
      canonicalPublicId = mapping.canonical_public_id;
      break;
    }
  }
  if (!canonicalPublicId) {
    throw new Error(`Canonical compensation accrual mapping not found for legacy accrual ${row.legacyAccrualId}`);
  }
  const accrual = await db.prepare(`
    SELECT accrual_public_id,practitioner_public_id,adjusted_minor,settled_minor,payable_minor,status
    FROM canonical_compensation_accruals
    WHERE tenant_id=? AND accrual_public_id=?
    LIMIT 1
  `).bind(tenantId, canonicalPublicId).first<AccrualRow>();
  if (!accrual) throw new Error(`Canonical compensation accrual not found for legacy accrual ${row.legacyAccrualId}`);
  return accrual;
}

function reservationAmounts(row: LiveRefundCompensationReservationRowInput) {
  const originalBaseMinor = Number(toMinorUnits(row.originalCommissionBaseAmount));
  const reservedBaseMinor = Number(toMinorUnits(row.reservedCommissionBaseAmount));
  const originalEarnedMinor = Number(toMinorUnits(row.originalEarnedAmount));
  const reservedEarnedMinor = Number(toMinorUnits(row.reservedEarnedAmount));
  const originalWaiverMinor = Number(toMinorUnits(row.originalDoctorWaiverAmount));
  const reservedWaiverMinor = Number(toMinorUnits(row.reservedDoctorWaiverAmount));
  const originalPayableMinor = Number(toMinorUnits(row.originalPayableAmount));
  const reservedPayableMinor = Number(toMinorUnits(row.reservedPayableAmount));
  const paidMinor = Number(toMinorUnits(row.paidAmount));
  const reversalMinor = Number(toMinorUnits(row.reversalAmount));
  if (reservedBaseMinor > originalBaseMinor) throw new Error('Refund reserved base exceeds original base');
  if (reservedEarnedMinor > originalEarnedMinor) throw new Error('Refund reserved earned exceeds original earned');
  if (originalPayableMinor !== originalEarnedMinor - originalWaiverMinor) {
    throw new Error('Original refund commission payable does not reconcile');
  }
  if (reservedPayableMinor !== reservedEarnedMinor - reservedWaiverMinor) {
    throw new Error('Reserved refund commission payable does not reconcile');
  }
  if (reversalMinor !== originalPayableMinor - reservedPayableMinor || reversalMinor <= 0) {
    throw new Error('Refund commission reversal does not reconcile');
  }
  if (paidMinor > reservedPayableMinor) throw new Error('Refund commission reservation would reduce already-paid compensation');
  return {
    originalBaseMinor,
    reservedBaseMinor,
    originalEarnedMinor,
    reservedEarnedMinor,
    originalWaiverMinor,
    reservedWaiverMinor,
    originalPayableMinor,
    reservedPayableMinor,
    paidMinor,
    reversalMinor,
  };
}

export async function executeLiveRefundCompensationReservation(
  db: CanonicalBatchDatabase,
  input: LiveRefundCompensationReservationInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<LiveRefundCompensationResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const refundSourcePublicId = exact(input.refundSourcePublicId, 'refundSourcePublicId');
  const occurredAtUtc = toUtcIso(input.occurredAtUtc);
  const exactBusinessDate = businessDate(input.businessDate);
  const reasonCode = exact(input.reasonCode, 'reasonCode');
  const legacyApprovalRequestId = optionalPositiveInteger(
    input.legacyApprovalRequestId,
    'legacyApprovalRequestId',
  );
  if (input.rows.length === 0) throw new Error('Refund commission reservation requires at least one row');
  const request = { ...input, occurredAtUtc, businessDate: exactBusinessDate };
  const idempotencyKey = `${REFUND_RESERVATION_SOURCE_TYPE}:${refundSourcePublicId}`;
  const replay = await readCanonicalCommandReplay<LiveRefundCompensationResult>(db, {
    tenantId,
    commandName: 'canonical.compensation.refund.reserve',
    idempotencyKey,
    request,
  });
  if (replay) return replay;

  const statements: CanonicalPreparedStatement[] = [];
  const seenAccruals = new Set<string>();
  let totalReversalMinor = 0;
  for (const rowInput of input.rows) {
    positiveInteger(rowInput.legacyAccrualId, 'legacyAccrualId');
    const accrual = await resolveCanonicalAccrual(db, tenantId, rowInput);
    if (seenAccruals.has(accrual.accrual_public_id)) {
      throw new Error(`Refund commission reservation duplicates accrual ${accrual.accrual_public_id}`);
    }
    seenAccruals.add(accrual.accrual_public_id);
    const amounts = reservationAmounts(rowInput);
    const expectedOutstandingBefore = amounts.originalPayableMinor - amounts.paidMinor;
    const expectedOutstandingAfter = amounts.reservedPayableMinor - amounts.paidMinor;
    if (accrual.settled_minor !== amounts.paidMinor || accrual.payable_minor !== expectedOutstandingBefore) {
      throw new Error(`Canonical refund commission balance mismatch for ${accrual.accrual_public_id}`);
    }
    if (amounts.reversalMinor !== expectedOutstandingBefore - expectedOutstandingAfter) {
      throw new Error(`Canonical refund outstanding reduction mismatch for ${accrual.accrual_public_id}`);
    }
    const sourcePublicId = `${refundSourcePublicId}:${rowInput.legacyAccrualId}`;
    const reservationPublicId = await createDeterministicSourceId(
      'comprefres', tenantId, REFUND_RESERVATION_SOURCE_TYPE, sourcePublicId,
    );
    const adjustmentPublicId = await createDeterministicSourceId(
      'compadj', tenantId, REFUND_RESERVATION_SOURCE_TYPE, sourcePublicId,
    );
    const adjustedAfter = accrual.adjusted_minor + amounts.reversalMinor;
    const payableAfter = accrual.payable_minor - amounts.reversalMinor;
    const statusAfter = statusFor(accrual.practitioner_public_id, accrual.settled_minor, payableAfter);
    const evidence = await createSourceEvidenceSha256({
      sourceType: REFUND_RESERVATION_SOURCE_TYPE,
      sourcePublicId,
      refundSourcePublicId,
      legacyAccrualId: rowInput.legacyAccrualId,
      accrualPublicId: accrual.accrual_public_id,
      reasonCode,
      ...amounts,
      occurredAtUtc,
      businessDate: exactBusinessDate,
    });
    totalReversalMinor += amounts.reversalMinor;
    statements.push(
      db.prepare(`
        INSERT INTO canonical_compensation_adjustments (
          tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
          settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
          accrual_adjusted_before_minor,accrual_adjusted_after_minor,
          accrual_settled_before_minor,accrual_settled_after_minor,
          accrual_payable_before_minor,accrual_payable_after_minor,
          occurred_at_utc,business_date,balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,NULL,NULL,'refund',?,?,?,?,?,?,?,?,?,?,1,?)
      `).bind(
        tenantId,
        adjustmentPublicId,
        accrual.accrual_public_id,
        reasonCode,
        amounts.reversalMinor,
        accrual.adjusted_minor,
        adjustedAfter,
        accrual.settled_minor,
        accrual.settled_minor,
        accrual.payable_minor,
        payableAfter,
        occurredAtUtc,
        exactBusinessDate,
        evidence,
      ),
      db.prepare(`
        UPDATE canonical_compensation_accruals
        SET adjusted_minor=?,payable_minor=?,status=?,updated_at_utc=?
        WHERE tenant_id=? AND accrual_public_id=?
          AND adjusted_minor=? AND settled_minor=? AND payable_minor=? AND status=?
      `).bind(
        adjustedAfter,
        payableAfter,
        statusAfter,
        occurredAtUtc,
        tenantId,
        accrual.accrual_public_id,
        accrual.adjusted_minor,
        accrual.settled_minor,
        accrual.payable_minor,
        accrual.status,
      ),
      db.prepare(`
        UPDATE canonical_compensation_adjustments
        SET balance_guard=CASE WHEN EXISTS (
          SELECT 1 FROM canonical_compensation_accruals
          WHERE tenant_id=? AND accrual_public_id=?
            AND adjusted_minor=? AND settled_minor=? AND payable_minor=? AND status=?
        ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND adjustment_public_id=?
      `).bind(
        tenantId,
        accrual.accrual_public_id,
        adjustedAfter,
        accrual.settled_minor,
        payableAfter,
        statusAfter,
        tenantId,
        adjustmentPublicId,
      ),
      db.prepare(`
        INSERT INTO canonical_compensation_refund_reservations (
          tenant_id,reservation_public_id,accrual_public_id,adjustment_public_id,
          refund_source_public_id,legacy_approval_request_id,legacy_accrual_id,
          original_base_minor,reserved_base_minor,original_earned_minor,reserved_earned_minor,
          original_waiver_minor,reserved_waiver_minor,original_payable_minor,
          reserved_payable_minor,paid_minor,reversal_minor,status,source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'held',?)
      `).bind(
        tenantId,
        reservationPublicId,
        accrual.accrual_public_id,
        adjustmentPublicId,
        refundSourcePublicId,
        legacyApprovalRequestId,
        rowInput.legacyAccrualId,
        amounts.originalBaseMinor,
        amounts.reservedBaseMinor,
        amounts.originalEarnedMinor,
        amounts.reservedEarnedMinor,
        amounts.originalWaiverMinor,
        amounts.reservedWaiverMinor,
        amounts.originalPayableMinor,
        amounts.reservedPayableMinor,
        amounts.paidMinor,
        amounts.reversalMinor,
        evidence,
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_adjustment',
        canonicalPublicId: adjustmentPublicId,
        sourceType: REFUND_RESERVATION_SOURCE_TYPE,
        sourcePublicId,
        sourceTable: 'billing_refund_commission_reservations',
        evidenceSha256: evidence,
      }),
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_refund_reservation',
        canonicalPublicId: reservationPublicId,
        sourceType: REFUND_RESERVATION_SOURCE_TYPE,
        sourcePublicId,
        sourceTable: 'billing_refund_commission_reservations',
        evidenceSha256: evidence,
      }),
    );
  }

  const result: LiveRefundCompensationResult = {
    refundSourcePublicId,
    affectedAccruals: seenAccruals.size,
    totalReversalMinor,
  };
  const eventPublicId = await createDeterministicSourceId(
    'outevt', tenantId, REFUND_RESERVATION_SOURCE_TYPE, refundSourcePublicId,
  );
  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.compensation.refund.reserve',
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId,
      aggregateType: 'compensation_refund_reservation',
      aggregatePublicId: refundSourcePublicId,
      eventType: 'canonical.compensation.refund_reserved',
      payload: result,
      occurredAtUtc,
      businessDate: exactBusinessDate,
    },
  });
}

export async function executeLiveRefundCompensationRelease(
  db: CanonicalBatchDatabase,
  input: LiveRefundCompensationReleaseInput,
  execution: CanonicalCommandExecutionOptions = {},
): Promise<CanonicalCommandResult<LiveRefundCompensationResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const refundSourcePublicId = exact(input.refundSourcePublicId, 'refundSourcePublicId');
  const occurredAtUtc = toUtcIso(input.occurredAtUtc);
  const exactBusinessDate = businessDate(input.businessDate);
  const reasonCode = exact(input.reasonCode, 'reasonCode');
  const request = { ...input, occurredAtUtc, businessDate: exactBusinessDate };
  const idempotencyKey = `${REFUND_RELEASE_SOURCE_TYPE}:${refundSourcePublicId}`;
  const replay = await readCanonicalCommandReplay<LiveRefundCompensationResult>(db, {
    tenantId,
    commandName: 'canonical.compensation.refund.release',
    idempotencyKey,
    request,
  });
  if (replay) return replay;

  const statement = db.prepare(`
    SELECT
      reservation.reservation_public_id,reservation.accrual_public_id,
      reservation.adjustment_public_id,reservation.original_payable_minor,
      reservation.reserved_payable_minor,reservation.paid_minor,
      reservation.reversal_minor,reservation.status,
      accrual.practitioner_public_id,accrual.adjusted_minor,accrual.settled_minor,
      accrual.payable_minor,accrual.status AS accrual_status
    FROM canonical_compensation_refund_reservations reservation
    JOIN canonical_compensation_accruals accrual
      ON accrual.tenant_id=reservation.tenant_id
     AND accrual.accrual_public_id=reservation.accrual_public_id
    WHERE reservation.tenant_id=?
      AND reservation.refund_source_public_id=?
      AND reservation.status <> 'released'
    ORDER BY reservation.id
  `) as QueryPreparedStatement;
  const { results = [] } = await statement.bind(tenantId, refundSourcePublicId).all<ReservationReleaseRow>();
  if (results.length === 0) throw new Error('Canonical refund commission reservation not found for release');

  const statements: CanonicalPreparedStatement[] = [];
  let totalReversalMinor = 0;
  for (const row of results) {
    if (row.adjusted_minor < row.reversal_minor) {
      throw new Error(`Canonical refund adjustment balance is insufficient for ${row.accrual_public_id}`);
    }
    const expectedReservedOutstanding = row.reserved_payable_minor - row.paid_minor;
    const expectedOriginalOutstanding = row.original_payable_minor - row.paid_minor;
    if (row.settled_minor !== row.paid_minor || row.payable_minor !== expectedReservedOutstanding) {
      throw new Error(`Canonical refund release balance mismatch for ${row.accrual_public_id}`);
    }
    const adjustedAfter = row.adjusted_minor - row.reversal_minor;
    const payableAfter = row.payable_minor + row.reversal_minor;
    if (payableAfter !== expectedOriginalOutstanding) {
      throw new Error(`Canonical refund release does not restore original outstanding for ${row.accrual_public_id}`);
    }
    const statusAfter = statusFor(row.practitioner_public_id, row.settled_minor, payableAfter);
    const sourcePublicId = `${refundSourcePublicId}:${row.reservation_public_id}`;
    const reversalPublicId = await createDeterministicSourceId(
      'compadjrev', tenantId, REFUND_RELEASE_SOURCE_TYPE, sourcePublicId,
    );
    const evidence = await createSourceEvidenceSha256({
      sourceType: REFUND_RELEASE_SOURCE_TYPE,
      sourcePublicId,
      refundSourcePublicId,
      reservationPublicId: row.reservation_public_id,
      adjustmentPublicId: row.adjustment_public_id,
      accrualPublicId: row.accrual_public_id,
      amountMinor: row.reversal_minor,
      reasonCode,
      occurredAtUtc,
      businessDate: exactBusinessDate,
    });
    totalReversalMinor += row.reversal_minor;
    statements.push(
      db.prepare(`
        INSERT INTO canonical_compensation_adjustment_reversals (
          tenant_id,reversal_public_id,adjustment_public_id,accrual_public_id,
          amount_minor,reason_code,accrual_adjusted_before_minor,
          accrual_adjusted_after_minor,accrual_settled_before_minor,
          accrual_settled_after_minor,accrual_payable_before_minor,
          accrual_payable_after_minor,occurred_at_utc,business_date,balance_guard,
          source_evidence_sha256
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)
      `).bind(
        tenantId,
        reversalPublicId,
        row.adjustment_public_id,
        row.accrual_public_id,
        row.reversal_minor,
        reasonCode,
        row.adjusted_minor,
        adjustedAfter,
        row.settled_minor,
        row.settled_minor,
        row.payable_minor,
        payableAfter,
        occurredAtUtc,
        exactBusinessDate,
        evidence,
      ),
      db.prepare(`
        UPDATE canonical_compensation_accruals
        SET adjusted_minor=?,payable_minor=?,status=?,updated_at_utc=?
        WHERE tenant_id=? AND accrual_public_id=?
          AND adjusted_minor=? AND settled_minor=? AND payable_minor=? AND status=?
      `).bind(
        adjustedAfter,
        payableAfter,
        statusAfter,
        occurredAtUtc,
        tenantId,
        row.accrual_public_id,
        row.adjusted_minor,
        row.settled_minor,
        row.payable_minor,
        row.accrual_status,
      ),
      db.prepare(`
        UPDATE canonical_compensation_adjustment_reversals
        SET balance_guard=CASE WHEN EXISTS (
          SELECT 1 FROM canonical_compensation_accruals
          WHERE tenant_id=? AND accrual_public_id=?
            AND adjusted_minor=? AND settled_minor=? AND payable_minor=? AND status=?
        ) THEN 1 ELSE 0 END
        WHERE tenant_id=? AND reversal_public_id=?
      `).bind(
        tenantId,
        row.accrual_public_id,
        adjustedAfter,
        row.settled_minor,
        payableAfter,
        statusAfter,
        tenantId,
        reversalPublicId,
      ),
      db.prepare(`
        UPDATE canonical_compensation_refund_reservations
        SET status='released',reversal_public_id=?,resolved_at_utc=?,updated_at_utc=?
        WHERE tenant_id=? AND reservation_public_id=? AND status <> 'released'
          AND reversal_public_id IS NULL
      `).bind(
        reversalPublicId,
        occurredAtUtc,
        occurredAtUtc,
        tenantId,
        row.reservation_public_id,
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_adjustment_reversal',
        canonicalPublicId: reversalPublicId,
        sourceType: REFUND_RELEASE_SOURCE_TYPE,
        sourcePublicId,
        sourceTable: 'billing_refund_commission_reservations',
        evidenceSha256: evidence,
      }),
    );
  }

  const result: LiveRefundCompensationResult = {
    refundSourcePublicId,
    affectedAccruals: results.length,
    totalReversalMinor,
  };
  const eventPublicId = await createDeterministicSourceId(
    'outevt', tenantId, REFUND_RELEASE_SOURCE_TYPE, refundSourcePublicId,
  );
  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.compensation.refund.release',
    idempotencyKey,
    request,
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId,
      aggregateType: 'compensation_refund_reservation',
      aggregatePublicId: refundSourcePublicId,
      eventType: 'canonical.compensation.refund_released',
      payload: result,
      occurredAtUtc,
      businessDate: exactBusinessDate,
    },
  });
}
