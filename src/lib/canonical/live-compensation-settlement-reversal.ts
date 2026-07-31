import {
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from './command-batch';
import { executeStrictFinancialMutation, type FinancialMutationExecution } from './strict-financial-mutation';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from './source-mapping';
import { toUtcIso } from './time';

const SETTLEMENT_SOURCE_TYPE = 'legacy_doctor_commission_settlement';
const REVERSAL_SOURCE_TYPE = 'legacy_doctor_commission_settlement_reversal';
const CANCELLATION_SOURCE_TYPE = 'legacy_doctor_commission_settlement_reversal_cancellation';

export interface LiveCancelledCompensationSettlementReversalInput {
  tenantId: string;
  legacyStatements: CanonicalPreparedStatement[];
  settlementSourceId: string;
  reversalSourceId: string;
  reasonCode: string;
  reversedAtUtc: string;
  businessDate: string;
}

export interface LiveCancelledCompensationSettlementReversalResult {
  settlementPublicId: string;
  reversedMinor: number;
  allocationCount: number;
  accrualPublicIds: string[];
}

type ReversalExecution = FinancialMutationExecution<
  CanonicalCommandResult<LiveCancelledCompensationSettlementReversalResult>
>;

type CanonicalQueryStatement = CanonicalPreparedStatement & {
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
};

type MappingRow = {
  canonical_public_id: string | null;
  mapping_status: string;
};

type SettlementRow = {
  settlement_public_id: string;
  total_minor: number;
  allocated_minor: number;
  reversed_minor: number;
  net_paid_minor: number;
  status: string;
};

type AllocationRow = {
  allocation_public_id: string;
  accrual_public_id: string;
  amount_minor: number;
  reversed_minor: number;
  remaining_minor: number;
  status: string;
  earned_minor: number;
  adjusted_minor: number;
  settled_minor: number;
  payable_minor: number;
  accrual_status: string;
};

function exact(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label} cannot be empty`);
  if (trimmed !== value) throw new TypeError(`${label} cannot contain surrounding whitespace`);
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

async function applyCanonicalReversal(
  db: CanonicalBatchDatabase,
  input: LiveCancelledCompensationSettlementReversalInput,
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<LiveCancelledCompensationSettlementReversalResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const settlementSourceId = exact(input.settlementSourceId, 'settlementSourceId');
  const reversalSourceId = exact(input.reversalSourceId, 'reversalSourceId');
  const reasonCode = exact(input.reasonCode, 'reasonCode');
  const reversedAtUtc = toUtcIso(input.reversedAtUtc);
  if (reversedAtUtc !== input.reversedAtUtc) throw new RangeError('reversedAtUtc must be a normalized UTC ISO timestamp');
  const businessDate = validDate(input.businessDate);

  const mapping = await db.prepare(`
    SELECT canonical_public_id,mapping_status
    FROM canonical_source_mappings
    WHERE tenant_id=? AND entity_type='compensation_settlement'
      AND source_type=? AND source_public_id=?
    LIMIT 1
  `).bind(tenantId, SETTLEMENT_SOURCE_TYPE, settlementSourceId).first<MappingRow>();
  if (!mapping || mapping.mapping_status !== 'mapped' || !mapping.canonical_public_id) {
    throw new Error('Canonical compensation settlement mapping not found');
  }
  const settlementPublicId = mapping.canonical_public_id;
  const settlement = await db.prepare(`
    SELECT settlement_public_id,total_minor,allocated_minor,reversed_minor,net_paid_minor,status
    FROM canonical_compensation_settlements
    WHERE tenant_id=? AND settlement_public_id=?
    LIMIT 1
  `).bind(tenantId, settlementPublicId).first<SettlementRow>();
  if (!settlement) throw new Error('Canonical compensation settlement not found');
  if (settlement.status !== 'posted' || settlement.reversed_minor !== 0) {
    throw new Error('Canonical compensation settlement is not fully reversible');
  }
  if (
    settlement.total_minor <= 0
    || settlement.total_minor !== settlement.allocated_minor
    || settlement.total_minor !== settlement.net_paid_minor
  ) {
    throw new Error('Canonical compensation settlement balances do not reconcile');
  }

  const allocationStatement = db.prepare(`
    SELECT
      a.allocation_public_id,a.accrual_public_id,a.amount_minor,a.reversed_minor,
      a.remaining_minor,a.status,
      c.earned_minor,c.adjusted_minor,c.settled_minor,c.payable_minor,
      c.status accrual_status
    FROM canonical_compensation_settlement_allocations a
    JOIN canonical_compensation_accruals c
      ON c.tenant_id=a.tenant_id AND c.accrual_public_id=a.accrual_public_id
    WHERE a.tenant_id=? AND a.settlement_public_id=?
    ORDER BY a.id ASC
  `).bind(tenantId, settlementPublicId) as CanonicalQueryStatement;
  const allocationResult = await allocationStatement.all<AllocationRow>();
  const allocations = allocationResult.results ?? [];
  if (allocations.length === 0) throw new Error('Canonical settlement has no allocations');
  if (allocations.reduce((sum, row) => sum + Number(row.amount_minor), 0) !== settlement.total_minor) {
    throw new Error('Canonical settlement allocation total does not reconcile');
  }
  for (const row of allocations) {
    if (
      row.status !== 'active'
      || row.reversed_minor !== 0
      || row.remaining_minor !== row.amount_minor
      || row.accrual_status !== 'settled'
      || row.payable_minor !== 0
      || row.settled_minor !== row.amount_minor
      || row.adjusted_minor + row.settled_minor !== row.earned_minor
    ) {
      throw new Error('Canonical settlement allocation or accrual is not fully reversible');
    }
  }

  const statements: CanonicalPreparedStatement[] = [];
  for (const row of allocations) {
    const reversalAdjustmentSourceId = `${reversalSourceId}:settlement:${row.allocation_public_id}`;
    const reversalAdjustmentPublicId = await createDeterministicSourceId(
      'compadj',
      tenantId,
      REVERSAL_SOURCE_TYPE,
      reversalAdjustmentSourceId,
    );
    const reversalEvidence = await createSourceEvidenceSha256({
      sourceType: REVERSAL_SOURCE_TYPE,
      sourcePublicId: reversalAdjustmentSourceId,
      settlementPublicId,
      allocationPublicId: row.allocation_public_id,
      accrualPublicId: row.accrual_public_id,
      amountMinor: row.amount_minor,
      reasonCode,
      reversedAtUtc,
      businessDate,
    });
    const cancellationAdjustmentSourceId = `${reversalSourceId}:cancel:${row.accrual_public_id}`;
    const cancellationAdjustmentPublicId = await createDeterministicSourceId(
      'compadj',
      tenantId,
      CANCELLATION_SOURCE_TYPE,
      cancellationAdjustmentSourceId,
    );
    const cancellationEvidence = await createSourceEvidenceSha256({
      sourceType: CANCELLATION_SOURCE_TYPE,
      sourcePublicId: cancellationAdjustmentSourceId,
      settlementPublicId,
      allocationPublicId: row.allocation_public_id,
      accrualPublicId: row.accrual_public_id,
      amountMinor: row.amount_minor,
      reasonCode,
      reversedAtUtc,
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
        ) VALUES (?,?,?,?,?,'settlement_reversal',?,?,?,?,?,?,?,?,?,?,1,?)
      `).bind(
        tenantId,
        reversalAdjustmentPublicId,
        row.accrual_public_id,
        settlementPublicId,
        row.allocation_public_id,
        reasonCode,
        row.amount_minor,
        row.adjusted_minor,
        row.adjusted_minor,
        row.settled_minor,
        0,
        row.payable_minor,
        row.amount_minor,
        reversedAtUtc,
        businessDate,
        reversalEvidence,
      ),
      db.prepare(`
        INSERT INTO canonical_compensation_adjustments (
          tenant_id,adjustment_public_id,accrual_public_id,settlement_public_id,
          settlement_allocation_public_id,adjustment_type,reason_code,amount_minor,
          accrual_adjusted_before_minor,accrual_adjusted_after_minor,
          accrual_settled_before_minor,accrual_settled_after_minor,
          accrual_payable_before_minor,accrual_payable_after_minor,
          occurred_at_utc,business_date,balance_guard,source_evidence_sha256
        ) VALUES (?,?,?,NULL,NULL,'manual_recovery','payout_reversal_cancelled',?,?,?,?,?,?,?,?,?,1,?)
      `).bind(
        tenantId,
        cancellationAdjustmentPublicId,
        row.accrual_public_id,
        row.amount_minor,
        row.adjusted_minor,
        row.earned_minor,
        0,
        0,
        row.amount_minor,
        0,
        reversedAtUtc,
        businessDate,
        cancellationEvidence,
      ),
      db.prepare(`
        UPDATE canonical_compensation_settlement_allocations
        SET reversed_minor=amount_minor,
            remaining_minor=0,
            status='reversed',
            reversed_at_utc=?,
            updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE tenant_id=? AND allocation_public_id=?
          AND reversed_minor=0 AND remaining_minor=amount_minor AND status='active'
      `).bind(reversedAtUtc, tenantId, row.allocation_public_id),
      db.prepare(`
        UPDATE canonical_compensation_accruals
        SET adjusted_minor=earned_minor,
            settled_minor=0,
            payable_minor=0,
            status='reversed',
            updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE tenant_id=? AND accrual_public_id=?
          AND adjusted_minor=? AND settled_minor=? AND payable_minor=0 AND status='settled'
      `).bind(
        tenantId,
        row.accrual_public_id,
        row.adjusted_minor,
        row.settled_minor,
      ),
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_adjustment',
        canonicalPublicId: reversalAdjustmentPublicId,
        sourceType: REVERSAL_SOURCE_TYPE,
        sourcePublicId: reversalAdjustmentSourceId,
        sourceTable: 'doctor_commission_settlements',
        evidenceSha256: reversalEvidence,
      }),
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_adjustment',
        canonicalPublicId: cancellationAdjustmentPublicId,
        sourceType: CANCELLATION_SOURCE_TYPE,
        sourcePublicId: cancellationAdjustmentSourceId,
        sourceTable: 'doctor_commission_settlements',
        evidenceSha256: cancellationEvidence,
      }),
    );
  }

  const reversalEvidence = await createSourceEvidenceSha256({
    sourceType: REVERSAL_SOURCE_TYPE,
    sourcePublicId: reversalSourceId,
    settlementSourceId,
    settlementPublicId,
    amountMinor: settlement.total_minor,
    reasonCode,
    reversedAtUtc,
    businessDate,
    allocationPublicIds: allocations.map((row) => row.allocation_public_id),
  });
  statements.push(
    db.prepare(`
      UPDATE canonical_compensation_settlements
      SET reversed_minor=total_minor,
          net_paid_minor=0,
          status='reversed',
          reversed_at_utc=?,
          updated_at_utc=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE tenant_id=? AND settlement_public_id=?
        AND reversed_minor=0 AND net_paid_minor=total_minor AND status='posted'
    `).bind(reversedAtUtc, tenantId, settlementPublicId),
    mappingStatement(db, {
      tenantId,
      entityType: 'compensation_settlement_reversal',
      canonicalPublicId: settlementPublicId,
      sourceType: REVERSAL_SOURCE_TYPE,
      sourcePublicId: reversalSourceId,
      sourceTable: 'doctor_commission_settlements',
      evidenceSha256: reversalEvidence,
    }),
  );

  const result: LiveCancelledCompensationSettlementReversalResult = {
    settlementPublicId,
    reversedMinor: settlement.total_minor,
    allocationCount: allocations.length,
    accrualPublicIds: allocations.map((row) => row.accrual_public_id),
  };

  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.compensation.settlement.cancel.live',
    idempotencyKey: `${REVERSAL_SOURCE_TYPE}:${reversalSourceId}`,
    request: {
      settlementSourceId,
      reversalSourceId,
      settlementPublicId,
      reasonCode,
      reversedAtUtc,
      businessDate,
      amountMinor: settlement.total_minor,
      allocations: allocations.map((row) => ({
        allocationPublicId: row.allocation_public_id,
        accrualPublicId: row.accrual_public_id,
        amountMinor: row.amount_minor,
      })),
    },
    authoritativeStatements: execution.authoritativeStatements,
    statements,
    result,
    event: {
      eventPublicId: await createDeterministicSourceId('outevt', tenantId, REVERSAL_SOURCE_TYPE, reversalSourceId),
      aggregateType: 'compensation_settlement',
      aggregatePublicId: settlementPublicId,
      eventType: 'canonical.compensation.settlement.cancelled',
      payload: {
        settlementPublicId,
        reversedMinor: settlement.total_minor,
        allocationCount: allocations.length,
        currencyCode: 'BDT',
        reasonCode,
      },
      occurredAtUtc: reversedAtUtc,
      businessDate,
    },
  });
}

export async function executeLiveCancelledCompensationSettlementReversal(
  db: CanonicalBatchDatabase,
  input: LiveCancelledCompensationSettlementReversalInput,
): Promise<ReversalExecution> {
  return executeStrictFinancialMutation({
    db,
    tenantId: input.tenantId,
    boundary: 'doctor-compensation.reverse',
    legacyStatements: input.legacyStatements,
    canonical: (execution) => applyCanonicalReversal(db, input, execution),
  });
}
