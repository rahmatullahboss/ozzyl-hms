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

export const CANONICAL_DEPOSIT_PROVIDER_KEY = 'canonical_deposit_provider_v1';

export interface DepositReadInput {
  tenantId: string;
  depositNumber: string;
  consumerId: string;
  observedAtUtc: string;
  elapsedMs: number;
  latencyBudgetMs: number;
  buildSha: string;
}

export interface DepositReadProjection {
  rowKey: string;
  depositNumber: string;
  status: 'posted' | 'closed' | 'cancelled' | 'reversed';
  currencyCode: string;
  amountMinor: number;
  appliedMinor: number;
  refundedMinor: number;
  availableMinor: number;
  applicationCount: number;
}

export interface DepositReadResult {
  mode: FinancialReadProviderMode;
  selectedProvider: 'legacy' | 'canonical';
  projection: DepositReadProjection;
  legacy: DepositReadProjection;
  canonical: DepositReadProjection | null;
  shadowEvidence?: FinancialReadShadowEvidence;
}

interface LegacyDepositRow {
  id: number;
  transaction_type: string;
  amount: number | string;
  is_active: number | string;
}

interface CanonicalDepositRow {
  deposit_public_id: string;
  deposit_number: string;
  currency_code: string;
  amount_minor: number | string;
  applied_minor: number | string;
  refunded_minor: number | string;
  available_minor: number | string;
  status: string;
  application_count: number | string;
}

function normalizeDepositStatus(value: string, availableMinor: number): DepositReadProjection['status'] {
  const normalized = value.trim().toLowerCase();
  if (['cancelled', 'canceled', 'void', 'voided'].includes(normalized)) return 'cancelled';
  if (normalized === 'reversed') return 'reversed';
  if (['closed', 'exhausted', 'refunded'].includes(normalized) || availableMinor === 0) return 'closed';
  return 'posted';
}

async function readLegacyDeposit(
  db: FinancialReadDatabase,
  tenantId: string,
  depositNumber: string,
): Promise<DepositReadProjection> {
  const rows = (await db.prepare(`
    SELECT id,transaction_type,amount,is_active
    FROM billing_deposits
    WHERE CAST(tenant_id AS TEXT)=? AND deposit_receipt_no=?
      AND COALESCE(is_active,1)=1
    ORDER BY id
  `).bind(tenantId, depositNumber).all<LegacyDepositRow>()).results;
  const deposits = rows.filter((row) => String(row.transaction_type).toLowerCase() === 'deposit');
  if (deposits.length !== 1) throw new Error('legacy deposit requires one exact tenant-scoped deposit row');
  const amountMinor = decimalToMinorUnits(deposits[0].amount, 'legacy deposit amount');
  const adjustmentRows = rows.filter((row) => String(row.transaction_type).toLowerCase() === 'adjustment');
  const refundRows = rows.filter((row) => String(row.transaction_type).toLowerCase() === 'refund');
  const appliedMinor = adjustmentRows.reduce(
    (sum, row) => sum + decimalToMinorUnits(row.amount, 'legacy deposit adjustment'),
    0,
  );
  const refundedMinor = refundRows.reduce(
    (sum, row) => sum + decimalToMinorUnits(row.amount, 'legacy deposit refund'),
    0,
  );
  const availableMinor = amountMinor - appliedMinor - refundedMinor;
  if (!Number.isSafeInteger(availableMinor) || availableMinor < 0) {
    throw new Error('legacy deposit balance is invalid in minor units');
  }
  return {
    rowKey: `deposit:${Number(deposits[0].id)}`,
    depositNumber,
    status: normalizeDepositStatus('posted', availableMinor),
    currencyCode: 'BDT',
    amountMinor,
    appliedMinor,
    refundedMinor,
    availableMinor,
    applicationCount: adjustmentRows.length,
  };
}

async function readCanonicalDeposit(
  db: FinancialReadDatabase,
  tenantId: string,
  canonicalPublicId: string,
): Promise<DepositReadProjection | null> {
  const rows = (await db.prepare(`
    SELECT deposit.deposit_public_id,deposit.deposit_number,deposit.currency_code,
           deposit.amount_minor,deposit.applied_minor,deposit.refunded_minor,
           deposit.available_minor,deposit.status,
           (SELECT COUNT(*) FROM canonical_deposit_applications application
            WHERE application.tenant_id=deposit.tenant_id
              AND application.deposit_public_id=deposit.deposit_public_id
              AND application.status='active') AS application_count
    FROM canonical_deposits deposit
    WHERE deposit.tenant_id=? AND deposit.deposit_public_id=?
    LIMIT 2
  `).bind(tenantId, canonicalPublicId).all<CanonicalDepositRow>()).results;
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error('mapped Canonical deposit is ambiguous');
  const row = rows[0];
  const amountMinor = Number(row.amount_minor);
  const appliedMinor = Number(row.applied_minor);
  const refundedMinor = Number(row.refunded_minor);
  const availableMinor = Number(row.available_minor);
  const applicationCount = Number(row.application_count);
  if (![amountMinor, appliedMinor, refundedMinor, availableMinor, applicationCount].every(Number.isSafeInteger)) {
    throw new Error('Canonical deposit contains unsafe integer evidence');
  }
  if (appliedMinor + refundedMinor + availableMinor !== amountMinor) {
    throw new Error('Canonical deposit reconciliation is invalid');
  }
  return {
    rowKey: String(row.deposit_public_id),
    depositNumber: String(row.deposit_number),
    status: normalizeDepositStatus(String(row.status), availableMinor),
    currencyCode: String(row.currency_code),
    amountMinor,
    appliedMinor,
    refundedMinor,
    availableMinor,
    applicationCount,
  };
}

export function resolveDepositProviderMode(
  db: FinancialReadDatabase,
  tenantId: string,
): Promise<FinancialReadProviderMode> {
  return resolveFinancialReadProviderMode(db, tenantId, CANONICAL_DEPOSIT_PROVIDER_KEY);
}

export async function provideDepositRead(
  db: FinancialReadDatabase,
  raw: DepositReadInput,
): Promise<DepositReadResult> {
  const tenantId = exactFinancialReadValue(raw.tenantId, 'tenantId');
  const depositNumber = exactFinancialReadValue(raw.depositNumber, 'depositNumber');
  const mode = await resolveDepositProviderMode(db, tenantId);
  const legacy = await readLegacyDeposit(db, tenantId, depositNumber);
  if (mode === 'legacy') {
    return { mode, selectedProvider: 'legacy', projection: legacy, legacy, canonical: null };
  }

  const canonicalPublicId = await resolveExactFinancialSourceMapping(db, {
    tenantId,
    entityType: 'deposit',
    sourceType: 'legacy_live_deposit',
    sourcePublicId: depositNumber,
  });
  const canonical = canonicalPublicId == null
    ? null
    : await readCanonicalDeposit(db, tenantId, canonicalPublicId);
  if (mode === 'canonical') {
    if (canonical == null) throw new Error('canonical mode requires one exact mapped Canonical deposit');
    return { mode, selectedProvider: 'canonical', projection: canonical, legacy, canonical };
  }

  const comparisons: FinancialReadComparison[] = [
    { varianceClass: 'MAPPING_MISSING', matches: canonicalPublicId != null && canonical != null, expected: depositNumber, actual: canonicalPublicId },
    { varianceClass: 'ROW_KEY_MISMATCH', matches: canonical?.depositNumber === legacy.depositNumber, expected: legacy.depositNumber, actual: canonical?.depositNumber ?? null },
    { varianceClass: 'STATUS_MISMATCH', matches: canonical?.status === legacy.status, expected: legacy.status, actual: canonical?.status ?? null },
    { varianceClass: 'TOTAL_MINOR_MISMATCH', matches: canonical?.amountMinor === legacy.amountMinor, expected: legacy.amountMinor, actual: canonical?.amountMinor ?? null },
    { varianceClass: 'APPLIED_MINOR_MISMATCH', matches: canonical?.appliedMinor === legacy.appliedMinor, expected: legacy.appliedMinor, actual: canonical?.appliedMinor ?? null },
    { varianceClass: 'REFUNDED_MINOR_MISMATCH', matches: canonical?.refundedMinor === legacy.refundedMinor, expected: legacy.refundedMinor, actual: canonical?.refundedMinor ?? null },
    { varianceClass: 'AVAILABLE_MINOR_MISMATCH', matches: canonical?.availableMinor === legacy.availableMinor, expected: legacy.availableMinor, actual: canonical?.availableMinor ?? null },
    { varianceClass: 'ROW_COUNT_MISMATCH', matches: canonical?.applicationCount === legacy.applicationCount, expected: legacy.applicationCount, actual: canonical?.applicationCount ?? null },
  ];
  const shadowEvidence = await persistFinancialReadShadowEvidence(db, {
    tenantId,
    providerKey: CANONICAL_DEPOSIT_PROVIDER_KEY,
    domain: 'finance_deposit',
    consumerId: raw.consumerId,
    sourceRowKey: legacy.rowKey,
    canonicalRowKey: canonical?.rowKey ?? null,
    sourcePublicId: depositNumber,
    legacyStatus: legacy.status,
    canonicalStatus: canonical?.status ?? null,
    legacyTotalMinor: legacy.amountMinor,
    canonicalTotalMinor: canonical?.amountMinor ?? null,
    expectedMinor: legacy.availableMinor,
    actualMinor: canonical?.availableMinor ?? null,
    currencyCode: legacy.currencyCode,
    comparisons,
    elapsedMs: raw.elapsedMs,
    latencyBudgetMs: raw.latencyBudgetMs,
    observedAtUtc: raw.observedAtUtc,
    buildSha: raw.buildSha,
    metadata: {
      legacyAppliedMinor: legacy.appliedMinor,
      canonicalAppliedMinor: canonical?.appliedMinor ?? null,
      legacyRefundedMinor: legacy.refundedMinor,
      canonicalRefundedMinor: canonical?.refundedMinor ?? null,
      legacyAvailableMinor: legacy.availableMinor,
      canonicalAvailableMinor: canonical?.availableMinor ?? null,
      legacyApplicationCount: legacy.applicationCount,
      canonicalApplicationCount: canonical?.applicationCount ?? null,
    },
  });
  return {
    mode,
    selectedProvider: 'legacy',
    projection: legacy,
    legacy,
    canonical,
    shadowEvidence,
  };
}
