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

export const CANONICAL_INVOICE_PROVIDER_KEY = 'canonical_invoice_provider_v1';

export interface InvoiceReadInput {
  tenantId: string;
  invoiceNumber: string;
  consumerId: string;
  observedAtUtc: string;
  elapsedMs: number;
  latencyBudgetMs: number;
  buildSha: string;
}

export interface InvoiceReadProjection {
  rowKey: string;
  invoiceNumber: string;
  documentStatus: 'posted' | 'cancelled' | 'reversed';
  settlementStatus: 'unpaid' | 'partial' | 'paid';
  currencyCode: string;
  totalMinor: number;
  paidMinor: number;
  dueMinor: number;
  lineCount: number;
}

export interface InvoiceReadResult {
  mode: FinancialReadProviderMode;
  selectedProvider: 'legacy' | 'canonical';
  projection: InvoiceReadProjection;
  legacy: InvoiceReadProjection;
  canonical: InvoiceReadProjection | null;
  shadowEvidence?: FinancialReadShadowEvidence;
}

interface LegacyInvoiceRow {
  id: number;
  invoice_no: string;
  total: number | string | null;
  paid: number | string | null;
  due: number | string | null;
  deposit_adjusted: number | string | null;
  status: string;
  cancelled_at: string | null;
  line_count: number | string;
}

interface CanonicalInvoiceRow {
  invoice_public_id: string;
  invoice_number: string;
  currency_code: string;
  total_minor: number | string;
  paid_minor: number | string;
  due_minor: number | string;
  status: string;
  line_count: number | string;
}

function documentStatus(status: string, cancelledAt: string | null = null): InvoiceReadProjection['documentStatus'] {
  const normalized = status.trim().toLowerCase();
  if (cancelledAt != null || ['cancelled', 'canceled', 'void', 'voided'].includes(normalized)) return 'cancelled';
  if (normalized === 'reversed') return 'reversed';
  return 'posted';
}

function settlementStatus(paidMinor: number, dueMinor: number): InvoiceReadProjection['settlementStatus'] {
  if (dueMinor === 0) return 'paid';
  if (paidMinor === 0) return 'unpaid';
  return 'partial';
}

async function exactRows<T>(
  db: FinancialReadDatabase,
  sql: string,
  values: unknown[],
  label: string,
): Promise<T> {
  const rows = (await db.prepare(sql).bind(...values).all<T>()).results;
  if (rows.length !== 1) throw new Error(`${label} requires one exact tenant-scoped row`);
  return rows[0];
}

async function readLegacyInvoice(
  db: FinancialReadDatabase,
  tenantId: string,
  invoiceNumber: string,
): Promise<InvoiceReadProjection> {
  const row = await exactRows<LegacyInvoiceRow>(db, `
    SELECT b.id,b.invoice_no,b.total,b.paid,b.due,b.status,b.cancelled_at,
           COALESCE((SELECT SUM(deposit.amount) FROM billing_deposits deposit
            WHERE CAST(deposit.tenant_id AS TEXT)=CAST(b.tenant_id AS TEXT)
              AND deposit.reference_bill_id=b.id
              AND deposit.transaction_type='adjustment'
              AND COALESCE(deposit.is_active,1)=1),0) AS deposit_adjusted,
           (SELECT COUNT(*) FROM invoice_items item
            WHERE item.tenant_id=b.tenant_id AND item.bill_id=b.id
              AND COALESCE(item.status,'active')<>'cancelled') AS line_count
    FROM bills b
    WHERE CAST(b.tenant_id AS TEXT)=? AND b.invoice_no=?
    ORDER BY b.id
    LIMIT 2
  `, [tenantId, invoiceNumber], 'legacy invoice');
  const totalMinor = decimalToMinorUnits(row.total, 'legacy invoice total');
  const cashPaidMinor = decimalToMinorUnits(row.paid, 'legacy invoice cash paid');
  const depositAdjustedMinor = decimalToMinorUnits(row.deposit_adjusted, 'legacy invoice deposit adjusted');
  const boundedDepositMinor = Math.min(totalMinor, depositAdjustedMinor);
  const boundedCashMinor = Math.min(totalMinor - boundedDepositMinor, cashPaidMinor);
  const paidMinor = boundedCashMinor + boundedDepositMinor;
  const dueMinor = totalMinor - paidMinor;
  if (![paidMinor, dueMinor].every(Number.isSafeInteger) || dueMinor < 0) {
    throw new Error('legacy invoice balance is not exact in minor units');
  }
  return {
    rowKey: `bill:${Number(row.id)}`,
    invoiceNumber: String(row.invoice_no),
    documentStatus: documentStatus(String(row.status), row.cancelled_at),
    settlementStatus: settlementStatus(paidMinor, dueMinor),
    currencyCode: 'BDT',
    totalMinor,
    paidMinor,
    dueMinor,
    lineCount: Number(row.line_count),
  };
}

async function readCanonicalInvoice(
  db: FinancialReadDatabase,
  tenantId: string,
  canonicalPublicId: string,
): Promise<InvoiceReadProjection | null> {
  const rows = (await db.prepare(`
    SELECT invoice.invoice_public_id,invoice.invoice_number,invoice.currency_code,
           invoice.total_minor,invoice.paid_minor,invoice.due_minor,invoice.status,
           (SELECT COUNT(*) FROM canonical_invoice_lines line
            WHERE line.tenant_id=invoice.tenant_id
              AND line.invoice_public_id=invoice.invoice_public_id) AS line_count
    FROM canonical_invoices invoice
    WHERE invoice.tenant_id=? AND invoice.invoice_public_id=?
    LIMIT 2
  `).bind(tenantId, canonicalPublicId).all<CanonicalInvoiceRow>()).results;
  if (rows.length === 0) return null;
  if (rows.length !== 1) throw new Error('mapped Canonical invoice is ambiguous');
  const row = rows[0];
  const totalMinor = Number(row.total_minor);
  const paidMinor = Number(row.paid_minor);
  const dueMinor = Number(row.due_minor);
  if (![totalMinor, paidMinor, dueMinor, Number(row.line_count)].every(Number.isSafeInteger)) {
    throw new Error('Canonical invoice contains unsafe integer evidence');
  }
  if (paidMinor + dueMinor !== totalMinor) throw new Error('Canonical invoice balance is invalid');
  return {
    rowKey: String(row.invoice_public_id),
    invoiceNumber: String(row.invoice_number),
    documentStatus: documentStatus(String(row.status)),
    settlementStatus: settlementStatus(paidMinor, dueMinor),
    currencyCode: String(row.currency_code),
    totalMinor,
    paidMinor,
    dueMinor,
    lineCount: Number(row.line_count),
  };
}

export function resolveInvoiceProviderMode(
  db: FinancialReadDatabase,
  tenantId: string,
): Promise<FinancialReadProviderMode> {
  return resolveFinancialReadProviderMode(db, tenantId, CANONICAL_INVOICE_PROVIDER_KEY);
}

export async function provideInvoiceRead(
  db: FinancialReadDatabase,
  raw: InvoiceReadInput,
): Promise<InvoiceReadResult> {
  const tenantId = exactFinancialReadValue(raw.tenantId, 'tenantId');
  const invoiceNumber = exactFinancialReadValue(raw.invoiceNumber, 'invoiceNumber');
  const mode = await resolveInvoiceProviderMode(db, tenantId);
  const legacy = await readLegacyInvoice(db, tenantId, invoiceNumber);
  if (mode === 'legacy') {
    return { mode, selectedProvider: 'legacy', projection: legacy, legacy, canonical: null };
  }

  const canonicalPublicId = await resolveExactFinancialSourceMapping(db, {
    tenantId,
    entityType: 'invoice',
    sourceType: 'legacy_live_bill',
    sourcePublicId: invoiceNumber,
  });
  const canonical = canonicalPublicId == null
    ? null
    : await readCanonicalInvoice(db, tenantId, canonicalPublicId);
  if (mode === 'canonical') {
    if (canonical == null) throw new Error('canonical mode requires one exact mapped Canonical invoice');
    return { mode, selectedProvider: 'canonical', projection: canonical, legacy, canonical };
  }

  const comparisons: FinancialReadComparison[] = [
    { varianceClass: 'MAPPING_MISSING', matches: canonicalPublicId != null && canonical != null, expected: invoiceNumber, actual: canonicalPublicId },
    { varianceClass: 'ROW_KEY_MISMATCH', matches: canonical?.invoiceNumber === legacy.invoiceNumber, expected: legacy.invoiceNumber, actual: canonical?.invoiceNumber ?? null },
    { varianceClass: 'STATUS_MISMATCH', matches: canonical?.documentStatus === legacy.documentStatus, expected: legacy.documentStatus, actual: canonical?.documentStatus ?? null },
    { varianceClass: 'SETTLEMENT_STATUS_MISMATCH', matches: canonical?.settlementStatus === legacy.settlementStatus, expected: legacy.settlementStatus, actual: canonical?.settlementStatus ?? null },
    { varianceClass: 'TOTAL_MINOR_MISMATCH', matches: canonical?.totalMinor === legacy.totalMinor, expected: legacy.totalMinor, actual: canonical?.totalMinor ?? null },
    { varianceClass: 'PAID_MINOR_MISMATCH', matches: canonical?.paidMinor === legacy.paidMinor, expected: legacy.paidMinor, actual: canonical?.paidMinor ?? null },
    { varianceClass: 'DUE_MINOR_MISMATCH', matches: canonical?.dueMinor === legacy.dueMinor, expected: legacy.dueMinor, actual: canonical?.dueMinor ?? null },
    { varianceClass: 'ROW_COUNT_MISMATCH', matches: canonical?.lineCount === legacy.lineCount, expected: legacy.lineCount, actual: canonical?.lineCount ?? null },
  ];
  const shadowEvidence = await persistFinancialReadShadowEvidence(db, {
    tenantId,
    providerKey: CANONICAL_INVOICE_PROVIDER_KEY,
    domain: 'finance_invoice',
    consumerId: raw.consumerId,
    sourceRowKey: legacy.rowKey,
    canonicalRowKey: canonical?.rowKey ?? null,
    sourcePublicId: invoiceNumber,
    legacyStatus: legacy.documentStatus,
    canonicalStatus: canonical?.documentStatus ?? null,
    legacyTotalMinor: legacy.totalMinor,
    canonicalTotalMinor: canonical?.totalMinor ?? null,
    expectedMinor: legacy.dueMinor,
    actualMinor: canonical?.dueMinor ?? null,
    currencyCode: legacy.currencyCode,
    comparisons,
    elapsedMs: raw.elapsedMs,
    latencyBudgetMs: raw.latencyBudgetMs,
    observedAtUtc: raw.observedAtUtc,
    buildSha: raw.buildSha,
    metadata: {
      legacySettlementStatus: legacy.settlementStatus,
      canonicalSettlementStatus: canonical?.settlementStatus ?? null,
      legacyPaidMinor: legacy.paidMinor,
      canonicalPaidMinor: canonical?.paidMinor ?? null,
      legacyDueMinor: legacy.dueMinor,
      canonicalDueMinor: canonical?.dueMinor ?? null,
      legacyLineCount: legacy.lineCount,
      canonicalLineCount: canonical?.lineCount ?? null,
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
