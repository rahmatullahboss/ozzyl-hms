import type { DecimalAmount } from './money';
import { toMinorUnits } from './money';
import {
  runCanonicalBatch,
  type CanonicalBatchDatabase,
  type CanonicalCommandExecutionOptions,
  type CanonicalCommandResult,
  type CanonicalPreparedStatement,
} from './command-batch';
import {
  buildCanonicalCompensationReportingContextStatement,
  type CanonicalCompensationReportingContextInput,
} from './compensation-reporting-context';
import { resolveLegacyLiveInvoiceLineAuthority } from './legacy-live-invoice-line-authority';
import { ensureCanonicalBillingServiceMapping } from './live-service-catalog-recovery';
import { executeStrictFinancialMutation, type FinancialMutationExecution } from './strict-financial-mutation';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from './source-mapping';
import { toUtcIso } from './time';

const RULE_SOURCE_TYPE = 'legacy_diagnostic_performer_rule';
const RESERVE_SOURCE_TYPE = 'legacy_diagnostic_performer_reserve';

export interface LivePerformerReserveRuleInput {
  id: number;
  billingServiceItemId: number;
  diagnosticKind: 'lab' | 'radiology';
  rateType: 'flat' | 'percent';
  rateValue: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface LivePerformerReserveAccrualInput {
  tenantId: string;
  legacyStatement: CanonicalPreparedStatement;
  legacyReserveSourceKey: string;
  billId: number;
  billItemId: number;
  invoiceNo: string;
  invoiceSourceLineId: string;
  unitSequence: number;
  rule: LivePerformerReserveRuleInput;
  lineGrossAmount: DecimalAmount;
  lineNetAmount: DecimalAmount;
  grossAmount: DecimalAmount;
  discountAmount: DecimalAmount;
  netAmount: DecimalAmount;
  reservedAmount: DecimalAmount;
  accruedAtUtc: string;
  businessDate: string;
  reportingContext?: CanonicalCompensationReportingContextInput;
}

export interface LivePerformerReserveCanonicalResult {
  accrualPublicId: string;
  rulePublicId: string;
  ruleVersion: number;
  invoicePublicId: string;
  invoiceLinePublicId: string;
  grossMinor: number;
  discountMinor: number;
  eligibleBaseMinor: number;
  earnedMinor: number;
  payableMinor: number;
  status: 'unassigned';
}

type LivePerformerReserveExecution = FinancialMutationExecution<CanonicalCommandResult<LivePerformerReserveCanonicalResult>>;

type RuleRow = {
  rule_version: number;
  source_evidence_sha256: string;
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

function businessDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError('businessDate must use YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    throw new RangeError('businessDate must be a valid calendar date');
  }
  return value;
}

function canonicalRate(rule: LivePerformerReserveRuleInput): { rateType: 'fixed' | 'basis_points'; rateValue: number } {
  if (rule.rateType === 'percent') {
    if (!Number.isSafeInteger(rule.rateValue) || rule.rateValue < 0 || rule.rateValue > 10_000) {
      throw new RangeError('Performer percentage must be basis points between 0 and 10000');
    }
    return { rateType: 'basis_points', rateValue: rule.rateValue };
  }
  return { rateType: 'fixed', rateValue: Number(toMinorUnits(rule.rateValue)) };
}

function expectedReserveMinor(
  netMinor: number,
  rate: { rateType: 'fixed' | 'basis_points'; rateValue: number },
): number {
  if (rate.rateType === 'fixed') return rate.rateValue;
  return Math.min(netMinor, Number((BigInt(netMinor) * BigInt(rate.rateValue) + 5000n) / 10_000n));
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

async function applyCanonicalReserve(
  db: CanonicalBatchDatabase,
  input: LivePerformerReserveAccrualInput,
  execution: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<LivePerformerReserveCanonicalResult>> {
  const tenantId = exact(input.tenantId, 'tenantId');
  const sourceKey = exact(input.legacyReserveSourceKey, 'legacyReserveSourceKey');
  const invoiceNo = exact(input.invoiceNo, 'invoiceNo');
  const sourceLineId = exact(input.invoiceSourceLineId, 'invoiceSourceLineId');
  const billId = positive(input.billId, 'billId');
  const billItemId = positive(input.billItemId, 'billItemId');
  const unitSequence = positive(input.unitSequence, 'unitSequence');
  const ruleId = positive(input.rule.id, 'rule.id');
  const serviceItemId = positive(input.rule.billingServiceItemId, 'rule.billingServiceItemId');
  if (!input.rule.isActive) throw new Error('Inactive performer rule cannot accrue a reserve');
  const accruedAtUtc = toUtcIso(input.accruedAtUtc);
  if (accruedAtUtc !== input.accruedAtUtc) throw new RangeError('accruedAtUtc must be a normalized UTC ISO timestamp');
  const date = businessDate(input.businessDate);

  const lineGrossMinor = Number(toMinorUnits(input.lineGrossAmount));
  const lineNetMinor = Number(toMinorUnits(input.lineNetAmount));
  const grossMinor = Number(toMinorUnits(input.grossAmount));
  const discountMinor = Number(toMinorUnits(input.discountAmount));
  const netMinor = Number(toMinorUnits(input.netAmount));
  const reservedMinor = Number(toMinorUnits(input.reservedAmount));
  if (grossMinor - discountMinor !== netMinor) {
    throw new RangeError('Performer reserve net amount must equal gross less discount');
  }
  const rate = canonicalRate(input.rule);
  if (reservedMinor !== expectedReserveMinor(netMinor, rate)) {
    throw new RangeError('Performer reserve does not match the configured rule');
  }

  const invoiceAuthority = await resolveLegacyLiveInvoiceLineAuthority(db, {
    tenantId,
    billId,
    invoiceNo,
    invoiceSourceLineId: sourceLineId,
  });
  const invoicePublicId = invoiceAuthority.invoicePublicId;
  const invoiceLinePublicId = invoiceAuthority.invoiceLinePublicId;
  if (invoiceAuthority.invoiceStatus !== 'posted') throw new Error('Canonical invoice is not posted');
  const expectedLineMinor = invoiceAuthority.authority === 'legacy_recovered_net'
    ? lineNetMinor
    : lineGrossMinor;
  if (invoiceAuthority.lineAmountMinor !== expectedLineMinor) {
    throw new Error('Canonical invoice line amount does not match performer reserve authority');
  }

  const servicePublicId = await ensureCanonicalBillingServiceMapping(db, {
    tenantId,
    billingServiceItemId: serviceItemId,
  });

  const rulePublicId = await createDeterministicSourceId('comprule', tenantId, RULE_SOURCE_TYPE, String(ruleId));
  const accrualPublicId = await createDeterministicSourceId('compacc', tenantId, RESERVE_SOURCE_TYPE, sourceKey);
  const ruleEvidence = await createSourceEvidenceSha256({
    sourceType: RULE_SOURCE_TYPE,
    sourcePublicId: String(ruleId),
    billingServiceItemId: serviceItemId,
    diagnosticKind: input.rule.diagnosticKind,
    rateType: input.rule.rateType,
    rateValue: input.rule.rateValue,
    effectiveFrom: input.rule.effectiveFrom,
    effectiveTo: input.rule.effectiveTo,
    isActive: input.rule.isActive ? 1 : 0,
    createdAt: input.rule.createdAt,
    updatedAt: input.rule.updatedAt,
  });
  const latestRule = await db.prepare(`
    SELECT rule_version,source_evidence_sha256
    FROM canonical_compensation_rules
    WHERE tenant_id=? AND rule_public_id=?
    ORDER BY rule_version DESC
    LIMIT 1
  `).bind(tenantId, rulePublicId).first<RuleRow>();
  const reuseRule = latestRule?.source_evidence_sha256 === ruleEvidence;
  const ruleVersion = reuseRule ? latestRule.rule_version : (latestRule?.rule_version ?? 0) + 1;
  const reserveEvidence = await createSourceEvidenceSha256({
    sourceType: RESERVE_SOURCE_TYPE,
    sourcePublicId: sourceKey,
    ruleId,
    billId,
    invoiceItemId: billItemId,
    billingServiceItemId: serviceItemId,
    diagnosticKind: input.rule.diagnosticKind,
    unitSequence,
    unitServiceAmountMajor: input.grossAmount,
    unitDiscountAmountMajor: input.discountAmount,
    netUnitServiceAmountMajor: input.netAmount,
    ruleRateType: input.rule.rateType,
    ruleRateValue: input.rule.rateValue,
    reservedAmountMajor: input.reservedAmount,
    reservedAt: accruedAtUtc,
  });
  const result: LivePerformerReserveCanonicalResult = {
    accrualPublicId,
    rulePublicId,
    ruleVersion,
    invoicePublicId,
    invoiceLinePublicId,
    grossMinor,
    discountMinor,
    eligibleBaseMinor: netMinor,
    earnedMinor: reservedMinor,
    payableMinor: reservedMinor,
    status: 'unassigned',
  };

  const reportingContextStatements: CanonicalPreparedStatement[] = input.reportingContext ? [
    await buildCanonicalCompensationReportingContextStatement(db, {
      tenantId,
      accrualPublicId,
      legacyBillId: billId,
      doctorWaiverMinor: 0,
      context: input.reportingContext,
    }),
  ] : [];
  const ruleStatements: CanonicalPreparedStatement[] = reuseRule ? [] : [
    db.prepare(`
      INSERT INTO canonical_compensation_rules (
        tenant_id,rule_public_id,rule_version,scope_type,service_public_id,category_key,
        practitioner_public_id,practitioner_role,accrual_stage,rate_type,rate_value,
        calculation_basis,discount_treatment,tax_treatment,minimum_minor,cap_minor,
        priority,effective_from,effective_to,status,source_evidence_sha256
      ) VALUES (?,?,?,'service',?,NULL,NULL,'performing','performer_reserve',?,?,
        'net_after_discount','deduct','exclude',0,NULL,10,?,?,'active',?)
    `).bind(
      tenantId,
      rulePublicId,
      ruleVersion,
      servicePublicId,
      rate.rateType,
      rate.rateValue,
      input.rule.effectiveFrom,
      input.rule.effectiveTo,
      ruleEvidence,
    ),
  ];

  return runCanonicalBatch(db, {
    tenantId,
    commandName: 'canonical.compensation.performer-reserve.accrue',
    idempotencyKey: `${RESERVE_SOURCE_TYPE}:${sourceKey}`,
    request: {
      sourceKey,
      invoicePublicId,
      invoiceLinePublicId,
      servicePublicId,
      rulePublicId,
      ruleVersion,
      unitSequence,
      grossMinor,
      discountMinor,
      netMinor,
      reservedMinor,
      accruedAtUtc,
      businessDate: date,
    },
    authoritativeStatements: execution.authoritativeStatements,
    statements: [
      ...ruleStatements,
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_rule',
        canonicalPublicId: rulePublicId,
        sourceType: RULE_SOURCE_TYPE,
        sourcePublicId: String(ruleId),
        sourceTable: 'diagnostic_performer_payout_rules',
        evidenceSha256: ruleEvidence,
      }),
      db.prepare(`
        INSERT INTO canonical_compensation_accruals (
          tenant_id,accrual_public_id,invoice_public_id,invoice_line_public_id,
          service_event_public_id,practitioner_public_id,practitioner_role,accrual_stage,
          rule_public_id,rule_version,calculation_basis,rate_type,rate_value,currency_code,
          gross_minor,discount_minor,tax_minor,performer_reserve_minor,eligible_base_minor,
          earned_minor,adjusted_minor,settled_minor,payable_minor,status,accrued_at_utc,
          business_date,payable_projection_guard,source_evidence_sha256
        ) VALUES (?,?,?,?,NULL,NULL,'performing','performer_reserve',?,?,
          'net_after_discount',?,?,'BDT',?,?,0,0,?,?,0,0,?,'unassigned',?,?,1,?)
      `).bind(
        tenantId,
        accrualPublicId,
        invoicePublicId,
        invoiceLinePublicId,
        rulePublicId,
        ruleVersion,
        rate.rateType,
        rate.rateValue,
        grossMinor,
        discountMinor,
        netMinor,
        reservedMinor,
        reservedMinor,
        accruedAtUtc,
        date,
        reserveEvidence,
      ),
      ...reportingContextStatements,
      mappingStatement(db, {
        tenantId,
        entityType: 'compensation_accrual',
        canonicalPublicId: accrualPublicId,
        sourceType: RESERVE_SOURCE_TYPE,
        sourcePublicId: sourceKey,
        sourceTable: 'diagnostic_performer_reserves',
        evidenceSha256: reserveEvidence,
      }),
    ],
    result,
    event: {
      eventPublicId: await createDeterministicSourceId('outevt', tenantId, RESERVE_SOURCE_TYPE, sourceKey),
      aggregateType: 'compensation_accrual',
      aggregatePublicId: accrualPublicId,
      eventType: 'canonical.compensation.performer-reserve.accrued',
      payload: {
        accrualPublicId,
        invoiceLinePublicId,
        servicePublicId,
        unitSequence,
        earnedMinor: reservedMinor,
        currencyCode: 'BDT',
      },
      occurredAtUtc: accruedAtUtc,
      businessDate: date,
    },
  });
}

export async function executeLivePerformerReserveAccrual(
  db: CanonicalBatchDatabase,
  input: LivePerformerReserveAccrualInput,
): Promise<LivePerformerReserveExecution> {
  return executeStrictFinancialMutation({
    db,
    tenantId: input.tenantId,
    boundary: 'doctor-compensation.accrue',
    legacyStatements: [input.legacyStatement],
    canonical: (execution) => applyCanonicalReserve(db, input, execution),
  });
}
