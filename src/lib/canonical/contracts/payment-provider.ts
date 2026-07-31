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

export const CANONICAL_PAYMENT_PROVIDER_KEY = 'canonical_payment_provider_v1';

export interface PaymentReadInput {
  tenantId: string;
  receiptNumber: string;
  consumerId: string;
  observedAtUtc: string;
  elapsedMs: number;
  latencyBudgetMs: number;
  buildSha: string;
}

export interface PaymentReadProjection {
  rowKey: string;
  receiptNumber: string;
  status: 'posted' | 'cancelled' | 'reversed';
  currencyCode: string;
  totalMinor: number;
  allocatedMinor: number;
  unallocatedMinor: number;
  tenderCount: number;
  allocationCount: number;
}

export interface PaymentReadResult {
  mode: FinancialReadProviderMode;
  selectedProvider: 'legacy' | 'canonical';
  projection: PaymentReadProjection;
  legacy: PaymentReadProjection;
  canonical: PaymentReadProjection | null;
  shadowEvidence?: FinancialReadShadowEvidence;
}

interface LegacyPaymentRow {
  id: number;
  receipt_no: string;
  amount: number | string;
}

interface CanonicalPaymentRow {
  receipt_public_id: string;
  receipt_number: string;
  currency_code: string;
  total_minor: number | string;
  allocated_total_minor: number | string;
  unallocated_minor: number | string;
  status: string;
  tender_count: number | string;
  allocation_count: number | string;
}

function normalizePaymentStatus(value: string): PaymentReadProjection['status'] {
  const normalized = value.trim().toLowerCase();
  if (['cancelled', 'canceled', 'void', 'voided'].includes(normalized)) return 'cancelled';
  if (normalized === 'reversed') return 'reversed';
  return 'posted';
}

async function readLegacyPayment(
  db: FinancialReadDatabase,
  tenantId: string,
  receiptNumber: string,
): Promise<PaymentReadProjection> {
  const rows = (await db.prepare(`
    SELECT id,receipt_no,amount
    FROM payments
    WHERE CAST(tenant_id AS TEXT)=? AND receipt_no=?
    ORDER BY id
    LIMIT 2
  `).bind(tenantId, receiptNumber).all<LegacyPaymentRow>()).results;
  if (rows.length !== 1) throw new Error('legacy payment requires one exact tenant-scoped row');
  const row = rows[0];
  const totalMinor = decimalToMinorUnits(row.amount, 'legacy payment amount');
  return {
    rowKey: `payment:${Number(row.id)}`,
    receiptNumber: String(row.receipt_no),
    status: 'posted',
    currencyCode: 'BDT',
    totalMinor,
    allocatedMinor: totalMinor,
    unallocatedMinor: 0,
    tenderCount: 1,
    allocationCount: 1,
  };
}

async function readCanonicalPayment(
  db: FinancialReadDatabase,
  tenantId: string,
  canonicalPublicId: string,
): Promise<PaymentReadProjection | null> {
  const rows = (await db.prepare(`
    SELECT receipt.receipt_public_id,receipt.receipt_number,receipt.currency_code,
           receipt.total_minor,receipt.allocated_total_minor,receipt.unallocated_minor,
           receipt.status,
           (SELECT COUNT(*) FROM canonical_payment_tenders tender
            WHERE tender.tenant_id=receipt.tenant_id
              AND tender.receipt_public_id=receipt.receipt_public_id
              AND tender.status<>'cancelled') AS tender_count,
           (SELECT COUNT(*) FROM canonical_payment_allocations allocation
            WHERE allocation.tenant_id=receipt.tenant_id
              AND allocation.receipt_public_id=receipt.receipt_public_id
              AND allocation.status='active') AS allocation_count
    FROM canonical_payment_receipts receipt
    WHERE receipt.tenant_id=? AND receipt.receipt_public_id=?
    LIMIT 2
  `).bind(tenantId, canonicalPublicId).all<CanonicalPaymentRow>()).results;
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error('mapped Canonical payment is ambiguous');
  const row = rows[0];
  const totalMinor = Number(row.total_minor);
  const allocatedMinor = Number(row.allocated_total_minor);
  const unallocatedMinor = Number(row.unallocated_minor);
  const tenderCount = Number(row.tender_count);
  const allocationCount = Number(row.allocation_count);
  if (![totalMinor, allocatedMinor, unallocatedMinor, tenderCount, allocationCount].every(Number.isSafeInteger)) {
    throw new Error('Canonical payment contains unsafe integer evidence');
  }
  if (allocatedMinor + unallocatedMinor !== totalMinor) throw new Error('Canonical payment reconciliation is invalid');
  return {
    rowKey: String(row.receipt_public_id),
    receiptNumber: String(row.receipt_number),
    status: normalizePaymentStatus(String(row.status)),
    currencyCode: String(row.currency_code),
    totalMinor,
    allocatedMinor,
    unallocatedMinor,
    tenderCount,
    allocationCount,
  };
}

export function resolvePaymentProviderMode(
  db: FinancialReadDatabase,
  tenantId: string,
): Promise<FinancialReadProviderMode> {
  return resolveFinancialReadProviderMode(db, tenantId, CANONICAL_PAYMENT_PROVIDER_KEY);
}

export async function providePaymentRead(
  db: FinancialReadDatabase,
  raw: PaymentReadInput,
): Promise<PaymentReadResult> {
  const tenantId = exactFinancialReadValue(raw.tenantId, 'tenantId');
  const receiptNumber = exactFinancialReadValue(raw.receiptNumber, 'receiptNumber');
  const mode = await resolvePaymentProviderMode(db, tenantId);
  const legacy = await readLegacyPayment(db, tenantId, receiptNumber);
  if (mode === 'legacy') {
    return { mode, selectedProvider: 'legacy', projection: legacy, legacy, canonical: null };
  }

  const canonicalPublicId = await resolveExactFinancialSourceMapping(db, {
    tenantId,
    entityType: 'payment_receipt',
    sourceType: 'legacy_live_payment',
    sourcePublicId: receiptNumber,
  });
  const canonical = canonicalPublicId == null
    ? null
    : await readCanonicalPayment(db, tenantId, canonicalPublicId);
  if (mode === 'canonical') {
    if (canonical == null) throw new Error('canonical mode requires one exact mapped Canonical payment');
    return { mode, selectedProvider: 'canonical', projection: canonical, legacy, canonical };
  }

  const comparisons: FinancialReadComparison[] = [
    { varianceClass: 'MAPPING_MISSING', matches: canonicalPublicId != null && canonical != null, expected: receiptNumber, actual: canonicalPublicId },
    { varianceClass: 'ROW_KEY_MISMATCH', matches: canonical?.receiptNumber === legacy.receiptNumber, expected: legacy.receiptNumber, actual: canonical?.receiptNumber ?? null },
    { varianceClass: 'STATUS_MISMATCH', matches: canonical?.status === legacy.status, expected: legacy.status, actual: canonical?.status ?? null },
    { varianceClass: 'TOTAL_MINOR_MISMATCH', matches: canonical?.totalMinor === legacy.totalMinor, expected: legacy.totalMinor, actual: canonical?.totalMinor ?? null },
    { varianceClass: 'ALLOCATED_MINOR_MISMATCH', matches: canonical?.allocatedMinor === legacy.allocatedMinor, expected: legacy.allocatedMinor, actual: canonical?.allocatedMinor ?? null },
    { varianceClass: 'UNALLOCATED_MINOR_MISMATCH', matches: canonical?.unallocatedMinor === legacy.unallocatedMinor, expected: legacy.unallocatedMinor, actual: canonical?.unallocatedMinor ?? null },
    { varianceClass: 'ROW_COUNT_MISMATCH', matches: canonical?.tenderCount === legacy.tenderCount && canonical?.allocationCount === legacy.allocationCount, expected: legacy.tenderCount + legacy.allocationCount, actual: canonical == null ? null : canonical.tenderCount + canonical.allocationCount },
  ];
  const shadowEvidence = await persistFinancialReadShadowEvidence(db, {
    tenantId,
    providerKey: CANONICAL_PAYMENT_PROVIDER_KEY,
    domain: 'finance_payment',
    consumerId: raw.consumerId,
    sourceRowKey: legacy.rowKey,
    canonicalRowKey: canonical?.rowKey ?? null,
    sourcePublicId: receiptNumber,
    legacyStatus: legacy.status,
    canonicalStatus: canonical?.status ?? null,
    legacyTotalMinor: legacy.totalMinor,
    canonicalTotalMinor: canonical?.totalMinor ?? null,
    expectedMinor: legacy.totalMinor,
    actualMinor: canonical?.totalMinor ?? null,
    currencyCode: legacy.currencyCode,
    comparisons,
    elapsedMs: raw.elapsedMs,
    latencyBudgetMs: raw.latencyBudgetMs,
    observedAtUtc: raw.observedAtUtc,
    buildSha: raw.buildSha,
    metadata: {
      legacyAllocatedMinor: legacy.allocatedMinor,
      canonicalAllocatedMinor: canonical?.allocatedMinor ?? null,
      legacyUnallocatedMinor: legacy.unallocatedMinor,
      canonicalUnallocatedMinor: canonical?.unallocatedMinor ?? null,
      legacyTenderCount: legacy.tenderCount,
      canonicalTenderCount: canonical?.tenderCount ?? null,
      legacyAllocationCount: legacy.allocationCount,
      canonicalAllocationCount: canonical?.allocationCount ?? null,
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
