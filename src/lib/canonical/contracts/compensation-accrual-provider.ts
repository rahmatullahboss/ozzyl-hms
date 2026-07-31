import {
  decimalToMinorUnits,
  exactFinancialReadValue,
  persistFinancialReadShadowEvidence,
  resolveExactFinancialSourceMapping,
  resolveFinancialReadProviderMode,
  type FinancialReadComparison,
  type FinancialReadDatabase,
  type FinancialReadProviderMode,
  type FinancialReadShadowEvidence,
} from '../financial-read-provider';

export const COMPENSATION_ACCRUAL_PROVIDER_KEY = 'canonical_compensation_accrual_provider_v1';
const SOURCE_TYPE = 'legacy_doctor_commission_accrual';

export interface CompensationAccrualReadInput {
  tenantId: string;
  legacyAccrualId: number;
  consumerId: string;
  observedAtUtc: string;
  elapsedMs: number;
  latencyBudgetMs: number;
  buildSha: string;
}

export interface CompensationAccrualProjection {
  legacyAccrualId: number;
  canonicalAccrualPublicId: string | null;
  legacyDoctorId: number;
  sourceType: string;
  status: 'accrued' | 'partially_settled' | 'settled' | 'reversed';
  businessDate: string | null;
  currencyCode: 'BDT';
  earnedMinor: number;
  adjustedMinor: number;
  settledMinor: number;
  payableMinor: number;
}

export interface CanonicalCompensationAccrualProjection extends CompensationAccrualProjection {
  accrualPublicId: string;
  practitionerPublicId: string | null;
  practitionerRole: string;
  accrualStage: string;
}

export interface CompensationAccrualReadResult {
  providerKey: typeof COMPENSATION_ACCRUAL_PROVIDER_KEY;
  mode: FinancialReadProviderMode;
  selectedProvider: 'legacy' | 'canonical';
  selected: CompensationAccrualProjection | CanonicalCompensationAccrualProjection;
  legacy: CompensationAccrualProjection;
  canonical: CanonicalCompensationAccrualProjection | null;
  shadowEvidence?: FinancialReadShadowEvidence;
  rollbackMode: 'legacy';
}

interface LegacyAccrualRow {
  id: number;
  canonical_source_key: string | null;
  doctor_id: number;
  source_type: string;
  status: string;
  accrued_date: string | null;
  commission_amount: number | string | null;
  earned_commission_amount: number | string | null;
  doctor_waiver_amount: number | string | null;
  payable_commission_amount: number | string | null;
  paid_amount: number | string | null;
  balance_amount: number | string | null;
}

interface CanonicalAccrualRow {
  accrual_public_id: string;
  practitioner_public_id: string | null;
  practitioner_role: string;
  accrual_stage: string;
  currency_code: string;
  earned_minor: number | string;
  adjusted_minor: number | string;
  settled_minor: number | string;
  payable_minor: number | string;
  status: string;
  business_date: string;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive safe integer`);
  }
  return value;
}

function canonicalMinor(value: number | string, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
  return parsed;
}

function normalizeLegacyStatus(value: string): CompensationAccrualProjection['status'] {
  switch (value) {
    case 'accrued':
    case 'approved':
      return 'accrued';
    case 'paid':
      return 'settled';
    case 'cancelled':
      return 'reversed';
    default:
      throw new RangeError(`unsupported legacy compensation accrual status: ${value}`);
  }
}

function normalizeCanonicalStatus(value: string): CompensationAccrualProjection['status'] {
  switch (value) {
    case 'accrued':
    case 'partially_settled':
    case 'settled':
    case 'reversed':
      return value;
    default:
      throw new RangeError(`unsupported Canonical compensation accrual status: ${value}`);
  }
}

async function readLegacyAccrual(
  db: FinancialReadDatabase,
  tenantId: string,
  legacyAccrualId: number,
): Promise<{ projection: CompensationAccrualProjection; sourcePublicId: string }> {
  const row = await db.prepare(`
    SELECT id,canonical_source_key,doctor_id,source_type,status,accrued_date,
           commission_amount,earned_commission_amount,doctor_waiver_amount,
           payable_commission_amount,paid_amount,balance_amount
    FROM doctor_commission_accruals
    WHERE tenant_id=? AND id=?
    LIMIT 1
  `).bind(tenantId, legacyAccrualId).first<LegacyAccrualRow>();
  if (!row) throw new Error('legacy doctor commission accrual not found');

  const earnedMinor = decimalToMinorUnits(
    row.earned_commission_amount ?? row.commission_amount ?? 0,
    'legacy earned compensation',
  );
  const adjustedMinor = decimalToMinorUnits(row.doctor_waiver_amount ?? 0, 'legacy adjusted compensation');
  const settledMinor = decimalToMinorUnits(row.paid_amount ?? 0, 'legacy settled compensation');
  const calculatedPayableMinor = Math.max(0, earnedMinor - adjustedMinor - settledMinor);
  const storedPayableMinor = decimalToMinorUnits(
    row.balance_amount ?? row.payable_commission_amount ?? calculatedPayableMinor / 100,
    'legacy payable compensation',
  );

  return {
    projection: {
      legacyAccrualId: Number(row.id),
      canonicalAccrualPublicId: null,
      legacyDoctorId: Number(row.doctor_id),
      sourceType: String(row.source_type),
      status: normalizeLegacyStatus(String(row.status)),
      businessDate: row.accrued_date == null ? null : String(row.accrued_date),
      currencyCode: 'BDT',
      earnedMinor,
      adjustedMinor,
      settledMinor,
      payableMinor: storedPayableMinor,
    },
    sourcePublicId: row.canonical_source_key?.trim() || String(row.id),
  };
}

async function readCanonicalAccrual(
  db: FinancialReadDatabase,
  tenantId: string,
  canonicalPublicId: string,
  legacy: CompensationAccrualProjection,
): Promise<CanonicalCompensationAccrualProjection | null> {
  const row = await db.prepare(`
    SELECT accrual_public_id,practitioner_public_id,practitioner_role,accrual_stage,
           currency_code,earned_minor,adjusted_minor,settled_minor,payable_minor,
           status,business_date
    FROM canonical_compensation_accruals
    WHERE tenant_id=? AND accrual_public_id=?
    LIMIT 1
  `).bind(tenantId, canonicalPublicId).first<CanonicalAccrualRow>();
  if (!row) return null;
  if (String(row.currency_code) !== 'BDT') {
    throw new Error('Canonical compensation accrual currency must be BDT');
  }
  return {
    legacyAccrualId: legacy.legacyAccrualId,
    canonicalAccrualPublicId: String(row.accrual_public_id),
    accrualPublicId: String(row.accrual_public_id),
    legacyDoctorId: legacy.legacyDoctorId,
    sourceType: legacy.sourceType,
    practitionerPublicId: row.practitioner_public_id == null ? null : String(row.practitioner_public_id),
    practitionerRole: String(row.practitioner_role),
    accrualStage: String(row.accrual_stage),
    status: normalizeCanonicalStatus(String(row.status)),
    businessDate: String(row.business_date),
    currencyCode: 'BDT',
    earnedMinor: canonicalMinor(row.earned_minor, 'Canonical earned compensation'),
    adjustedMinor: canonicalMinor(row.adjusted_minor, 'Canonical adjusted compensation'),
    settledMinor: canonicalMinor(row.settled_minor, 'Canonical settled compensation'),
    payableMinor: canonicalMinor(row.payable_minor, 'Canonical payable compensation'),
  };
}

function comparisons(
  legacy: CompensationAccrualProjection,
  canonical: CanonicalCompensationAccrualProjection | null,
  mappedPublicId: string | null,
): FinancialReadComparison[] {
  return [
    {
      varianceClass: 'MAPPING_MISSING',
      matches: mappedPublicId != null && canonical != null,
      expected: mappedPublicId,
      actual: canonical?.accrualPublicId ?? null,
    },
    {
      varianceClass: 'STATUS_MISMATCH',
      matches: canonical != null && legacy.status === canonical.status,
      expected: legacy.status,
      actual: canonical?.status ?? null,
    },
    {
      varianceClass: 'EARNED_MINOR_MISMATCH',
      matches: canonical != null && legacy.earnedMinor === canonical.earnedMinor,
      expected: legacy.earnedMinor,
      actual: canonical?.earnedMinor ?? null,
    },
    {
      varianceClass: 'ADJUSTED_MINOR_MISMATCH',
      matches: canonical != null && legacy.adjustedMinor === canonical.adjustedMinor,
      expected: legacy.adjustedMinor,
      actual: canonical?.adjustedMinor ?? null,
    },
    {
      varianceClass: 'SETTLED_MINOR_MISMATCH',
      matches: canonical != null && legacy.settledMinor === canonical.settledMinor,
      expected: legacy.settledMinor,
      actual: canonical?.settledMinor ?? null,
    },
    {
      varianceClass: 'PAYABLE_MINOR_MISMATCH',
      matches: canonical != null && legacy.payableMinor === canonical.payableMinor,
      expected: legacy.payableMinor,
      actual: canonical?.payableMinor ?? null,
    },
  ];
}

export async function resolveCompensationAccrualProviderMode(
  db: FinancialReadDatabase,
  tenantId: string,
): Promise<FinancialReadProviderMode> {
  return resolveFinancialReadProviderMode(db, tenantId, COMPENSATION_ACCRUAL_PROVIDER_KEY);
}

export async function provideCompensationAccrualRead(
  db: FinancialReadDatabase,
  raw: CompensationAccrualReadInput,
): Promise<CompensationAccrualReadResult> {
  const startedAtMs = Date.now();
  const tenantId = exactFinancialReadValue(raw.tenantId, 'tenantId');
  const legacyAccrualId = positiveInteger(raw.legacyAccrualId, 'legacyAccrualId');
  const consumerId = exactFinancialReadValue(raw.consumerId, 'consumerId');
  const mode = await resolveCompensationAccrualProviderMode(db, tenantId);
  const { projection: legacy, sourcePublicId } = await readLegacyAccrual(db, tenantId, legacyAccrualId);

  if (mode === 'legacy') {
    return {
      providerKey: COMPENSATION_ACCRUAL_PROVIDER_KEY,
      mode,
      selectedProvider: 'legacy',
      selected: legacy,
      legacy,
      canonical: null,
      rollbackMode: 'legacy',
    };
  }

  const mappedPublicId = await resolveExactFinancialSourceMapping(db, {
    tenantId,
    entityType: 'compensation_accrual',
    sourceType: SOURCE_TYPE,
    sourcePublicId,
  });
  const canonical = mappedPublicId == null
    ? null
    : await readCanonicalAccrual(db, tenantId, mappedPublicId, legacy);

  if (mode === 'canonical' && canonical == null) {
    throw new Error('canonical compensation accrual mode requires one exact mapped Canonical accrual');
  }

  const comparisonRows = comparisons(legacy, canonical, mappedPublicId);
  const shadowEvidence = mode === 'shadow'
    ? await persistFinancialReadShadowEvidence(db, {
      tenantId,
      providerKey: COMPENSATION_ACCRUAL_PROVIDER_KEY,
      domain: 'practitioner_compensation',
      consumerId,
      sourceRowKey: `doctor_commission_accruals:${legacyAccrualId}`,
      canonicalRowKey: canonical == null
        ? null
        : `canonical_compensation_accruals:${canonical.accrualPublicId}`,
      sourcePublicId,
      legacyStatus: legacy.status,
      canonicalStatus: canonical?.status ?? null,
      legacyTotalMinor: legacy.earnedMinor,
      canonicalTotalMinor: canonical?.earnedMinor ?? null,
      expectedMinor: legacy.payableMinor,
      actualMinor: canonical?.payableMinor ?? null,
      currencyCode: 'BDT',
      comparisons: comparisonRows,
      elapsedMs: Math.max(raw.elapsedMs, Date.now() - startedAtMs),
      latencyBudgetMs: raw.latencyBudgetMs,
      observedAtUtc: raw.observedAtUtc,
      buildSha: raw.buildSha,
      metadata: {
        legacyAccrualId,
        legacyDoctorId: legacy.legacyDoctorId,
        sourceType: legacy.sourceType,
        earnedMinor: legacy.earnedMinor,
        adjustedMinor: legacy.adjustedMinor,
        settledMinor: legacy.settledMinor,
        payableMinor: legacy.payableMinor,
      },
    })
    : undefined;

  return {
    providerKey: COMPENSATION_ACCRUAL_PROVIDER_KEY,
    mode,
    selectedProvider: mode === 'canonical' ? 'canonical' : 'legacy',
    selected: mode === 'canonical' ? canonical! : legacy,
    legacy,
    canonical,
    shadowEvidence,
    rollbackMode: 'legacy',
  };
}
