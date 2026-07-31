import type { DecimalAmount } from './money';
import { toMinorUnits } from './money';
import {
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from './command-batch';
import { executeStrictFinancialMutation, type FinancialMutationExecution } from './strict-financial-mutation';
import {
  createDeterministicSourceId,
  createSourceEvidenceSha256,
  normalizeIdentityText,
  normalizeRegistrationNumber,
} from './source-mapping';
import { allocateCompensationSettlement } from './compensation-settlement-allocation';
import { toUtcIso } from './time';

const PRACTITIONER_SOURCE_TYPE = 'legacy_doctor';
const SETTLEMENT_SOURCE_TYPE = 'legacy_doctor_commission_settlement';
const ALLOCATION_SOURCE_TYPE = 'legacy_doctor_commission_settlement_item';
const DEDUCTION_SOURCE_TYPE = 'legacy_doctor_commission_settlement_deduction';

export type LiveCompensationAccrualSourceType =
  | 'legacy_doctor_commission_accrual'
  | 'legacy_diagnostic_performer_reserve';

export interface LiveCompensationSettlementAccrualInput {
  sourceType: LiveCompensationAccrualSourceType;
  sourcePublicId: string;
  expectedPayableAmount: DecimalAmount;
  settlementPayableAmount?: DecimalAmount;
  overrideReason?: string | null;
  legacyAccrualSourcePublicId?: string | null;
}

export interface LiveCompensationSettlementInput {
  tenantId: string;
  legacyStatements: CanonicalPreparedStatement[];
  settlementSourceId: string;
  settlementNumber: string;
  practitioner: {
    doctorId: number;
    canonicalSourceKey?: string | null;
    displayName: string;
    specialty?: string | null;
    department?: string | null;
    registrationNumber?: string | null;
    userId?: number | null;
    isActive: boolean;
  };
  paymentMethod: 'cash' | 'bank_transfer' | 'mobile_wallet' | 'card' | 'other';
  grossAmount: DecimalAmount;
  netPaidAmount: DecimalAmount;
  settledAtUtc: string;
  businessDate: string;
  accruals: LiveCompensationSettlementAccrualInput[];
}

export interface LiveCompensationSettlementResult {
  settlementPublicId: string;
  practitionerPublicId: string;
  grossMinor: number;
  deductionMinor: number;
  netPaidMinor: number;
  allocationCount: number;
  accrualPublicIds: string[];
}

type SettlementExecution = FinancialMutationExecution<CanonicalCommandResult<LiveCompensationSettlementResult>>;

type MappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
};

type CanonicalAccrualRow = {
  accrual_public_id: string;
  practitioner_public_id: string | null;
  practitioner_role: string;
  earned_minor: number;
  adjusted_minor: number;
  settled_minor: number;
  payable_minor: number;
  status: string;
  currency_code: string;
};

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
  return value;
}

function positive(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${label} must be a positive safe integer`);
  return value;
}

function validDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('businessDate must use YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

function sourceTable(sourceType: LiveCompensationAccrualSourceType): string {
  return sourceType === 'legacy_diagnostic_performer_reserve'
    ? 'diagnostic_performer_reserves'
    : 'doctor_commission_accruals';
}

async function mappedPractitionerPublicId(
  db: CanonicalBatchDatabase,
  tenantId: string,
  sourcePublicId: string,
): Promise<string | null> {
  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='practitioner'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, PRACTITIONER_SOURCE_TYPE, sourcePublicId).first<MappingRow>();
  return mapping?.mapping_status === 'mapped' && mapping.canonical_public_id
    ? mapping.canonical_public_id
    : null;
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
    ON CONFLICT(tenant_id,entity_type,source_type,source_public_id) DO UPDATE SET
      canonical_public_id=excluded.canonical_public_id,
      source_table=excluded.source_table,
      mapping_status='mapped',
      mapping_version=canonical_source_mappings.mapping_version+1,
      evidence_sha256=excluded.evidence_sha256,
      updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
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

async function applyCanonicalSettlement(
  db: CanonicalBatchDatabase,
  input: LiveCompensationSettlementInput,
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<LiveCompensationSettlementResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const settlementSourceId = exact(input.settlementSourceId, 'settlementSourceId');
  const settlementNumber = exact(input.settlementNumber, 'settlementNumber');
  const doctorId = positive(input.practitioner.doctorId, 'practitioner.doctorId');
  const displayName = exact(input.practitioner.displayName, 'practitioner.displayName');
  const settledAtUtc = toUtcIso(input.settledAtUtc);
  if (settledAtUtc !== input.settledAtUtc) throw new RangeError('settledAtUtc must be a normalized UTC ISO timestamp');
  const businessDate = validDate(input.businessDate);
  if (input.accruals.length === 0) throw new RangeError('At least one canonical compensation accrual is required');

  const grossMinor = Number(toMinorUnits(input.grossAmount));
  const netPaidMinor = Number(toMinorUnits(input.netPaidAmount));
  if (grossMinor <= 0 || netPaidMinor <= 0) throw new RangeError('Compensation settlement amounts must be positive');
  if (netPaidMinor > grossMinor) {
    throw new RangeError('Canonical compensation settlement cannot pay more than selected gross payable');
  }
  const deductionMinor = grossMinor - netPaidMinor;
  const practitionerRouteSourceKey = input.practitioner.canonicalSourceKey?.trim() || null;
  const practitionerSourcePublicId = practitionerRouteSourceKey ?? String(doctorId);
  const practitionerPublicId = await mappedPractitionerPublicId(
    db,
    tenantId,
    practitionerSourcePublicId,
  ) ?? await createDeterministicSourceId(
    practitionerRouteSourceKey ? 'pract' : 'prc',
    tenantId,
    PRACTITIONER_SOURCE_TYPE,
    practitionerSourcePublicId,
  );
  const practitionerEvidence = await createSourceEvidenceSha256({
    sourceType: PRACTITIONER_SOURCE_TYPE,
    sourcePublicId: practitionerSourcePublicId,
    displayName: normalizeIdentityText(displayName),
    specialty: normalizeIdentityText(input.practitioner.specialty ?? null),
    department: normalizeIdentityText(input.practitioner.department ?? null),
    registrationNumber: normalizeRegistrationNumber(input.practitioner.registrationNumber ?? null),
    userId: input.practitioner.userId ?? null,
    isActive: input.practitioner.isActive,
  });

  const resolved: Array<{
    input: LiveCompensationSettlementAccrualInput;
    row: CanonicalAccrualRow;
    expectedMinor: number;
    settlementMinor: number;
    overrideDifferenceMinor: number;
  }> = [];
  const resolvedAccrualPublicIds = new Set<string>();
  for (const accrualInput of input.accruals) {
    const sourcePublicId = exact(accrualInput.sourcePublicId, 'accrual.sourcePublicId');
    const mapping = await db.prepare(`
      SELECT canonical_public_id,mapping_status
      FROM canonical_source_mappings
      WHERE tenant_id=? AND entity_type='compensation_accrual'
        AND source_type=? AND source_public_id=?
      LIMIT 1
    `).bind(tenantId, accrualInput.sourceType, sourcePublicId).first<MappingRow>();
    if (!mapping || mapping.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
      throw new Error(`Canonical compensation accrual mapping not found for ${sourcePublicId}`);
    }
    const row = await db.prepare(`
      SELECT accrual_public_id,practitioner_public_id,practitioner_role,
             earned_minor,adjusted_minor,settled_minor,payable_minor,status,currency_code
      FROM canonical_compensation_accruals
      WHERE tenant_id=? AND accrual_public_id=?
      LIMIT 1
    `).bind(tenantId, mapping.canonical_public_id).first<CanonicalAccrualRow>();
    if (!row) throw new Error(`Canonical compensation accrual not found for ${sourcePublicId}`);
    if (resolvedAccrualPublicIds.has(row.accrual_public_id)) {
      throw new Error('Canonical compensation accrual cannot be selected more than once');
    }
    resolvedAccrualPublicIds.add(row.accrual_public_id);
    if (row.currency_code !== 'BDT') throw new Error('Canonical compensation currency mismatch');
    if (!['unassigned', 'accrued', 'approved'].includes(row.status)) {
      throw new Error('Canonical compensation accrual is not payable');
    }
    if (row.practitioner_public_id && row.practitioner_public_id !== practitionerPublicId) {
      throw new Error('Canonical compensation accrual belongs to another practitioner');
    }
    const expectedMinor = Number(toMinorUnits(accrualInput.expectedPayableAmount));
    if (expectedMinor !== row.payable_minor) {
      throw new Error('Canonical compensation payable differs from selected legacy payable');
    }
    const settlementMinor = Number(toMinorUnits(
      accrualInput.settlementPayableAmount ?? accrualInput.expectedPayableAmount,
    ));
    if (settlementMinor <= 0) throw new RangeError('Canonical settlement line payable must be positive');
    const overrideDifferenceMinor = settlementMinor - expectedMinor;
    if (overrideDifferenceMinor !== 0 && (accrualInput.overrideReason?.trim().length ?? 0) < 3) {
      throw new Error('Canonical payout override reason is required');
    }
    resolved.push({ input: accrualInput, row, expectedMinor, settlementMinor, overrideDifferenceMinor });
  }
  if (resolved.reduce((sum, entry) => sum + entry.settlementMinor, 0) !== grossMinor) {
    throw new Error('Canonical selected accruals do not reconcile to gross settlement amount');
  }

  const allocationPlan = allocateCompensationSettlement(
    resolved.map((entry) => entry.settlementMinor),
    netPaidMinor,
  );
  const allocations = resolved.map((entry, index) => ({
    ...entry,
    adjustmentMinor: allocationPlan[index].adjustmentMinor,
    allocationMinor: allocationPlan[index].allocationMinor,
  }));

  const settlementPublicId = await createDeterministicSourceId(
    'compset',
    tenantId,
    SETTLEMENT_SOURCE_TYPE,
    settlementSourceId,
  );
  const settlementEvidence = await createSourceEvidenceSha256({
    sourceType: SETTLEMENT_SOURCE_TYPE,
    sourcePublicId: settlementSourceId,
    doctorId,
    settlementNumber,
    paymentMethod: input.paymentMethod,
    grossAmountMajor: input.grossAmount,
    deductionAmountMajor: deductionMinor / 100,
    netPaidAmountMajor: input.netPaidAmount,
    settledAtUtc,
    businessDate,
    accrualSources: allocations.map((entry) => ({
      sourceType: entry.input.sourceType,
      sourcePublicId: entry.input.sourcePublicId,
      calculatedMinor: entry.expectedMinor,
      settlementMinor: entry.settlementMinor,
      overrideDifferenceMinor: entry.overrideDifferenceMinor,
      overrideReason: entry.input.overrideReason?.trim() || null,
      adjustmentMinor: entry.adjustmentMinor,
      allocationMinor: entry.allocationMinor,
    })),
  });

  const statements: CanonicalPreparedStatement[] = [
    db.prepare(`
      INSERT INTO canonical_practitioners (
        tenant_id,practitioner_public_id,practitioner_kind,display_name,status
      ) VALUES (?,?,?,?,?)
      ON CONFLICT(tenant_id,practitioner_public_id) DO UPDATE SET
        practitioner_kind=excluded.practitioner_kind,
        display_name=excluded.display_name,
        status=excluded.status,
        updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    `).bind(
      tenantId,
      practitionerPublicId,
      input.practitioner.userId == null ? 'external' : 'internal',
      displayName,
      input.practitioner.isActive ? 'active' : 'inactive',
    ),
    mappingStatement(db, {
      tenantId,
      entityType: 'practitioner',
      canonicalPublicId: practitionerPublicId,
      sourceType: PRACTITIONER_SOURCE_TYPE,
      sourcePublicId: practitionerSourcePublicId,
      sourceTable: 'doctors',
      evidenceSha256: practitionerEvidence,
    }),
    db.prepare(`
      INSERT INTO canonical_compensation_settlements (
        tenant_id,settlement_public_id,settlement_number,practitioner_public_id,
        currency_code,payment_method,total_minor,allocated_minor,reversed_minor,
        net_paid_minor,status,settled_at_utc,business_date,reversed_at_utc,
        settlement_projection_guard,source_evidence_sha256
      ) VALUES (?,?,?,?,'BDT',?,?,?,0,?,'posted',?,?,NULL,1,?)
    `).bind(
      tenantId,
      settlementPublicId,
      settlementNumber,
      practitionerPublicId,
      input.paymentMethod,
      netPaidMinor,
      netPaidMinor,
      netPaidMinor,
      settledAtUtc,
      businessDate,
      settlementEvidence,
    ),
    mappingStatement(db, {
      tenantId,
      entityType: 'compensation_settlement',
      canonicalPublicId: settlementPublicId,
      sourceType: SETTLEMENT_SOURCE_TYPE,
      sourcePublicId: settlementSourceId,
      sourceTable: 'doctor_commission_settlements',
      evidenceSha256: settlementEvidence,
    }),
  ];

  for (const allocation of allocations) {
    const overrideIncreaseMinor = Math.max(0, allocation.overrideDifferenceMinor);
    const overrideDecreaseMinor = Math.max(0, -allocation.overrideDifferenceMinor);
    const earnedAfterOverride = allocation.row.earned_minor + overrideIncreaseMinor;
    const adjustedAfterOverride = allocation.row.adjusted_minor + overrideDecreaseMinor;
    const adjustedAfter = adjustedAfterOverride + allocation.adjustmentMinor;
    const settledAfter = allocation.row.settled_minor + allocation.allocationMinor;

    if (allocation.overrideDifferenceMinor !== 0) {
      const overrideSourceType = 'legacy_performer_payout_override';
      const overrideSourceId = `${settlementSourceId}:override:${allocation.input.sourceType}:${allocation.input.sourcePublicId}`;
      const overrideEvidence = await createSourceEvidenceSha256({
        sourceType: overrideSourceType,
        sourcePublicId: overrideSourceId,
        settlementPublicId,
        accrualPublicId: allocation.row.accrual_public_id,
        direction: allocation.overrideDifferenceMinor > 0 ? 'increase' : 'decrease',
        calculatedMinor: allocation.expectedMinor,
        settlementMinor: allocation.settlementMinor,
        amountMinor: Math.abs(allocation.overrideDifferenceMinor),
        reason: allocation.input.overrideReason?.trim() || null,
        earnedBeforeMinor: allocation.row.earned_minor,
        earnedAfterMinor: earnedAfterOverride,
        adjustedBeforeMinor: allocation.row.adjusted_minor,
        adjustedAfterMinor: adjustedAfterOverride,
        occurredAtUtc: settledAtUtc,
        businessDate,
      });

      if (allocation.overrideDifferenceMinor < 0) {
        const overrideAdjustmentPublicId = await createDeterministicSourceId(
          'compadj',
          tenantId,
          overrideSourceType,
          overrideSourceId,
        );
        statements.push(
          db.prepare(`
            INSERT INTO canonical_compensation_adjustments (
              tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
              settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
              accrual_adjusted_before_minor,accrual_adjusted_after_minor,
              accrual_settled_before_minor,accrual_settled_after_minor,
              accrual_payable_before_minor,accrual_payable_after_minor,
              occurred_at_utc,business_date,balance_guard,source_evidence_sha256
            ) VALUES (?,?,?,NULL,NULL,'manual_recovery','payout_override_decrease',?,?,?,?,?,?,?,?,?,1,?)
          `).bind(
            tenantId,
            overrideAdjustmentPublicId,
            allocation.row.accrual_public_id,
            overrideDecreaseMinor,
            allocation.row.adjusted_minor,
            adjustedAfterOverride,
            allocation.row.settled_minor,
            allocation.row.settled_minor,
            allocation.expectedMinor,
            allocation.settlementMinor,
            settledAtUtc,
            businessDate,
            overrideEvidence,
          ),
          mappingStatement(db, {
            tenantId,
            entityType: 'compensation_adjustment',
            canonicalPublicId: overrideAdjustmentPublicId,
            sourceType: overrideSourceType,
            sourcePublicId: overrideSourceId,
            sourceTable: 'doctor_commission_settlement_items',
            evidenceSha256: overrideEvidence,
          }),
        );
      } else {
        statements.push(mappingStatement(db, {
          tenantId,
          entityType: 'compensation_accrual_override',
          canonicalPublicId: allocation.row.accrual_public_id,
          sourceType: overrideSourceType,
          sourcePublicId: overrideSourceId,
          sourceTable: 'doctor_commission_settlement_items',
          evidenceSha256: overrideEvidence,
        }));
      }
    }

    if (allocation.adjustmentMinor > 0) {
      const deductionSourceId = `${settlementSourceId}:deduction:${allocation.input.sourceType}:${allocation.input.sourcePublicId}`;
      const adjustmentPublicId = await createDeterministicSourceId(
        'compadj',
        tenantId,
        DEDUCTION_SOURCE_TYPE,
        deductionSourceId,
      );
      const adjustmentEvidence = await createSourceEvidenceSha256({
        sourceType: DEDUCTION_SOURCE_TYPE,
        sourcePublicId: deductionSourceId,
        settlementPublicId,
        accrualPublicId: allocation.row.accrual_public_id,
        amountMinor: allocation.adjustmentMinor,
        occurredAtUtc: settledAtUtc,
        businessDate,
      });
      statements.push(
        db.prepare(`
          INSERT INTO canonical_compensation_adjustments (
            tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
            settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
            accrual_adjusted_before_minor,accrual_adjusted_after_minor,
            accrual_settled_before_minor,accrual_settled_after_minor,
            accrual_payable_before_minor,accrual_payable_after_minor,
            occurred_at_utc,business_date,balance_guard,source_evidence_sha256
          ) VALUES (?,?,?,NULL,NULL,'manual_recovery','settlement_deduction',?,?,?,?,?,?,?,?,?,1,?)
        `).bind(
          tenantId,
          adjustmentPublicId,
          allocation.row.accrual_public_id,
          allocation.adjustmentMinor,
          adjustedAfterOverride,
          adjustedAfter,
          allocation.row.settled_minor,
          allocation.row.settled_minor,
          allocation.settlementMinor,
          allocation.settlementMinor - allocation.adjustmentMinor,
          settledAtUtc,
          businessDate,
          adjustmentEvidence,
        ),
        mappingStatement(db, {
          tenantId,
          entityType: 'compensation_adjustment',
          canonicalPublicId: adjustmentPublicId,
          sourceType: DEDUCTION_SOURCE_TYPE,
          sourcePublicId: deductionSourceId,
          sourceTable: 'doctor_commission_settlements',
          evidenceSha256: adjustmentEvidence,
        }),
      );
    }
    statements.push(db.prepare(`
      UPDATE canonical_compensation_accruals
      SET practitioner_public_id=?,
          earned_minor=?,
          adjusted_minor=?,
          settled_minor=?,
          payable_minor=0,
          status='settled',
          updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant_id=? AND accrual_public_id=?
        AND earned_minor=? AND adjusted_minor=? AND settled_minor=? AND payable_minor=?
        AND status IN ('unassigned','accrued','approved')
    `).bind(
      practitionerPublicId,
      earnedAfterOverride,
      adjustedAfter,
      settledAfter,
      tenantId,
      allocation.row.accrual_public_id,
      allocation.row.earned_minor,
      allocation.row.adjusted_minor,
      allocation.row.settled_minor,
      allocation.expectedMinor,
    ));

    if (allocation.input.legacyAccrualSourcePublicId) {
      statements.push(mappingStatement(db, {
        tenantId,
        entityType: 'compensation_accrual',
        canonicalPublicId: allocation.row.accrual_public_id,
        sourceType: 'legacy_doctor_commission_accrual',
        sourcePublicId: allocation.input.legacyAccrualSourcePublicId,
        sourceTable: 'doctor_commission_accruals',
        evidenceSha256: await createSourceEvidenceSha256({
          sourceType: 'legacy_doctor_commission_accrual',
          sourcePublicId: allocation.input.legacyAccrualSourcePublicId,
          canonicalAccrualPublicId: allocation.row.accrual_public_id,
        }),
      }));
    }

    if (allocation.allocationMinor <= 0) continue;
    const allocationSourceId = `${settlementSourceId}:${allocation.input.sourceType}:${allocation.input.sourcePublicId}`;
    const allocationPublicId = await createDeterministicSourceId(
      'compalloc',
      tenantId,
      ALLOCATION_SOURCE_TYPE,
      allocationSourceId,
    );
    const allocationEvidence = await createSourceEvidenceSha256({
      sourceType: ALLOCATION_SOURCE_TYPE,
      sourcePublicId: allocationSourceId,
      settlementPublicId,
      accrualPublicId: allocation.row.accrual_public_id,
      amountMinor: allocation.allocationMinor,
      adjustedMinor: allocation.adjustmentMinor,
      allocatedAtUtc: settledAtUtc,
    });
    statements.push(
      db.prepare(`
        INSERT INTO canonical_compensation_settlement_allocations (
          tenant_id,allocation_public_id,settlement_public_id,accrual_public_id,
          amount_minor,reversed_minor,remaining_minor,accrual_settled_before_minor,
          accrual_settled_after_minor,accrual_payable_before_minor,
          accrual_payable_after_minor,status,allocated_at_utc,reversed_at_utc,
          balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,?,0,?,?,?,?,0,'active',?,NULL,1,?)
      `).bind(
        tenantId,
        allocationPublicId,
        settlementPublicId,
        allocation.row.accrual_public_id,
        allocation.allocationMinor,
        allocation.allocationMinor,
        allocation.row.settled_minor,
        settledAfter,
        allocation.settlementMinor - allocation.adjustmentMinor,
        settledAtUtc,
        allocationEvidence,
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_settlement_allocation',
        canonicalPublicId: allocationPublicId,
        sourceType: ALLOCATION_SOURCE_TYPE,
        sourcePublicId: allocationSourceId,
        sourceTable: 'doctor_commission_settlement_items',
        evidenceSha256: allocationEvidence,
      }),
    );
  }

  const result: LiveCompensationSettlementResult = {
    settlementPublicId,
    practitionerPublicId,
    grossMinor,
    deductionMinor,
    netPaidMinor,
    allocationCount: allocations.filter((entry) => entry.allocationMinor > 0).length,
    accrualPublicIds: allocations.map((entry) => entry.row.accrual_public_id),
  };

  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.compensation.settle.live',
    idempotencyKey: `${SETTLEMENT_SOURCE_TYPE}:${settlementSourceId}`,
    request: {
      settlementSourceId,
      settlementNumber,
      practitionerPublicId,
      paymentMethod: input.paymentMethod,
      grossMinor,
      deductionMinor,
      netPaidMinor,
      settledAtUtc,
      businessDate,
      accruals: allocations.map((entry) => ({
        accrualPublicId: entry.row.accrual_public_id,
        adjustmentMinor: entry.adjustmentMinor,
        allocationMinor: entry.allocationMinor,
      })),
    },
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: await createDeterministicSourceId('outevt', tenantId, SETTLEMENT_SOURCE_TYPE, settlementSourceId),
      aggregateType: 'compensation_settlement',
      aggregatePublicId: settlementPublicId,
      eventType: 'canonical.compensation.settled',
      payload: {
        settlementPublicId,
        practitionerPublicId,
        grossMinor,
        deductionMinor,
        netPaidMinor,
        currencyCode: 'BDT',
      },
      occurredAtUtc: settledAtUtc,
      businessDate,
    },
  });
}

export async function executeLiveCompensationSettlement(
  db: CanonicalBatchDatabase,
  input: LiveCompensationSettlementInput,
): Promise<SettlementExecution> {
  return executeStrictFinancialMutation({
    db,
    tenantId: input.tenantId,
    boundary: 'doctor-compensation.settle',
    legacyStatements: input.legacyStatements,
    canonical: (execution) => applyCanonicalSettlement(db, input, execution),
  });
}
