import type { D1Database } from '@cloudflare/workers-types';
import { resolveReceivableAuthority } from '../services/actionCenter/collections/authority';
import { listCanonicalReceivables } from '../services/actionCenter/collections/canonicalAdapter';
import { listLegacyReceivables, majorToMinor } from '../services/actionCenter/collections/legacyAdapter';
import type {
  ReceivableAuthorityMode,
  ReceivableRecord,
} from '../services/actionCenter/collections/types';

export type OutstandingCategoryCode =
  | 'laboratory'
  | 'consultation'
  | 'admission'
  | 'operation'
  | 'pharmacy'
  | 'other';

export interface OutstandingInvoiceCategory {
  code: OutstandingCategoryCode;
  label: string;
  amountMinor: number;
}

export interface LegacyInvoiceFinancialMetadata {
  legacyBillId: number;
  admissionId: number | null;
  visitId: number | null;
  testAmountMinor: number;
  consultationAmountMinor: number;
  admissionAmountMinor: number;
  operationAmountMinor: number;
  pharmacyAmountMinor: number;
}

export interface OutstandingInvoiceSummary {
  invoiceNumber: string;
  issuedAtUtc: string;
  currencyCode: string;
  totalMinor: number;
  paidMinor: number;
  creditedMinor: number;
  dueMinor: number;
  legacyBillId: number | null;
  canonicalInvoicePublicId: string | null;
  admissionId: number | null;
  visitId: number | null;
  sourceLabel: string;
  categories: OutstandingInvoiceCategory[];
}

export interface PatientOutstandingFinancialClearance {
  authorityMode: ReceivableAuthorityMode;
  currencyCode: string;
  totalOutstandingMinor: number;
  invoiceCount: number;
  inlineSettlementSupported: boolean;
  invoices: OutstandingInvoiceSummary[];
}

const CATEGORY_DEFINITIONS: Array<{
  code: OutstandingCategoryCode;
  label: string;
  read: (row: LegacyInvoiceFinancialMetadata) => number;
}> = [
  { code: 'laboratory', label: 'Laboratory / Test', read: (row) => row.testAmountMinor },
  { code: 'consultation', label: 'OPD / Consultation', read: (row) => row.consultationAmountMinor },
  { code: 'admission', label: 'IPD / Admission', read: (row) => row.admissionAmountMinor },
  { code: 'operation', label: 'Operation', read: (row) => row.operationAmountMinor },
  { code: 'pharmacy', label: 'Pharmacy', read: (row) => row.pharmacyAmountMinor },
];

function assertSafeMinor(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value;
}

function categoriesForInvoice(
  receivable: ReceivableRecord,
  metadata: LegacyInvoiceFinancialMetadata | undefined,
): OutstandingInvoiceCategory[] {
  if (!metadata) {
    return [{ code: 'other', label: 'Other', amountMinor: receivable.totalMinor }];
  }

  const categories = CATEGORY_DEFINITIONS.flatMap((definition) => {
    const amountMinor = assertSafeMinor(definition.read(metadata), `${definition.label} amount`);
    return amountMinor > 0
      ? [{ code: definition.code, label: definition.label, amountMinor }]
      : [];
  });
  const classifiedMinor = categories.reduce((sum, category) => sum + category.amountMinor, 0);
  const unclassifiedMinor = Math.max(0, receivable.totalMinor - classifiedMinor);
  if (unclassifiedMinor > 0) {
    categories.push({ code: 'other', label: 'Other', amountMinor: unclassifiedMinor });
  }

  return categories.length > 0
    ? categories
    : [{ code: 'other', label: 'Other', amountMinor: receivable.totalMinor }];
}

function sourceLabel(categories: OutstandingInvoiceCategory[]): string {
  if (categories.length !== 1) return 'Mixed invoice';
  switch (categories[0].code) {
    case 'laboratory': return 'Laboratory / Test';
    case 'consultation': return 'OPD / Consultation';
    case 'admission': return 'IPD / Admission';
    case 'operation': return 'Operation';
    case 'pharmacy': return 'Pharmacy';
    default: return 'Other invoice';
  }
}

export function summarizePatientOutstandingReceivables(input: {
  authorityMode: ReceivableAuthorityMode;
  patientId: number;
  receivables: ReceivableRecord[];
  legacyMetadataByBillId: Map<number, LegacyInvoiceFinancialMetadata>;
}): PatientOutstandingFinancialClearance {
  const open = input.receivables.filter((record) => (
    record.patientId === input.patientId
    && record.financialStatus === 'open'
    && record.dueMinor > 0
  ));
  const currencies = new Set(open.map((record) => record.currencyCode));
  if (currencies.size > 1) {
    throw new Error('Patient outstanding invoices use multiple currencies and cannot be combined');
  }

  const invoices = open.map((record): OutstandingInvoiceSummary => {
    const legacyBillId = record.source.legacyBillId ?? null;
    const metadata = legacyBillId == null
      ? undefined
      : input.legacyMetadataByBillId.get(legacyBillId);
    const categories = categoriesForInvoice(record, metadata);

    return {
      invoiceNumber: record.invoiceNumber,
      issuedAtUtc: record.issuedAtUtc,
      currencyCode: record.currencyCode,
      totalMinor: assertSafeMinor(record.totalMinor, 'Invoice total'),
      paidMinor: assertSafeMinor(record.paidMinor, 'Invoice paid amount'),
      creditedMinor: assertSafeMinor(record.creditedMinor, 'Invoice credited amount'),
      dueMinor: assertSafeMinor(record.dueMinor, 'Invoice due amount'),
      legacyBillId,
      canonicalInvoicePublicId: record.source.canonicalInvoicePublicId ?? null,
      admissionId: metadata?.admissionId ?? null,
      visitId: metadata?.visitId ?? null,
      sourceLabel: sourceLabel(categories),
      categories,
    };
  });

  return {
    authorityMode: input.authorityMode,
    currencyCode: currencies.values().next().value ?? 'BDT',
    totalOutstandingMinor: invoices.reduce((sum, invoice) => sum + invoice.dueMinor, 0),
    invoiceCount: invoices.length,
    inlineSettlementSupported: input.authorityMode !== 'canonical'
      && invoices.every((invoice) => invoice.legacyBillId !== null),
    invoices,
  };
}

interface LegacyMetadataRow {
  legacyBillId: number;
  admissionId: number | null;
  visitId: number | null;
  testAmount: number | string | null;
  consultationAmount: number | string | null;
  admissionAmount: number | string | null;
  operationAmount: number | string | null;
  pharmacyAmount: number | string | null;
}

async function loadLegacyInvoiceMetadata(input: {
  db: D1Database;
  tenantId: string;
  legacyBillIds: number[];
}): Promise<Map<number, LegacyInvoiceFinancialMetadata>> {
  if (input.legacyBillIds.length === 0) return new Map();
  const placeholders = input.legacyBillIds.map(() => '?').join(',');
  const result = await input.db.prepare(`
    SELECT
      id AS "legacyBillId",
      admission_id AS "admissionId",
      visit_id AS "visitId",
      COALESCE(test_bill, 0) AS "testAmount",
      COALESCE(doctor_visit_bill, 0) AS "consultationAmount",
      COALESCE(admission_bill, 0) AS "admissionAmount",
      COALESCE(operation_bill, 0) AS "operationAmount",
      COALESCE(medicine_bill, 0) AS "pharmacyAmount"
    FROM bills
    WHERE tenant_id = ?
      AND id IN (${placeholders})
  `).bind(input.tenantId, ...input.legacyBillIds).all<LegacyMetadataRow>();

  return new Map((result.results ?? []).map((row) => [
    Number(row.legacyBillId),
    {
      legacyBillId: Number(row.legacyBillId),
      admissionId: row.admissionId == null ? null : Number(row.admissionId),
      visitId: row.visitId == null ? null : Number(row.visitId),
      testAmountMinor: majorToMinor(row.testAmount ?? 0),
      consultationAmountMinor: majorToMinor(row.consultationAmount ?? 0),
      admissionAmountMinor: majorToMinor(row.admissionAmount ?? 0),
      operationAmountMinor: majorToMinor(row.operationAmount ?? 0),
      pharmacyAmountMinor: majorToMinor(row.pharmacyAmount ?? 0),
    },
  ]));
}

export async function loadPatientOutstandingFinancialClearance(input: {
  db: D1Database;
  tenantId: string;
  patientId: number;
}): Promise<PatientOutstandingFinancialClearance> {
  const authority = await resolveReceivableAuthority({ db: input.db, tenantId: input.tenantId });
  const receivables = authority.mode === 'canonical'
    ? await listCanonicalReceivables({
        db: input.db,
        tenantId: input.tenantId,
        patientId: input.patientId,
      })
    : await listLegacyReceivables({
        db: input.db,
        tenantId: input.tenantId,
        patientId: input.patientId,
      });
  const patientReceivables = receivables.filter((record) => record.patientId === input.patientId);
  const legacyBillIds = patientReceivables.flatMap((record) => (
    record.source.legacyBillId === undefined ? [] : [record.source.legacyBillId]
  ));
  const metadata = await loadLegacyInvoiceMetadata({
    db: input.db,
    tenantId: input.tenantId,
    legacyBillIds,
  });

  return summarizePatientOutstandingReceivables({
    authorityMode: authority.mode,
    patientId: input.patientId,
    receivables: patientReceivables,
    legacyMetadataByBillId: metadata,
  });
}

export function minorToMajor(minor: number): number {
  return assertSafeMinor(minor, 'Money') / 100;
}
