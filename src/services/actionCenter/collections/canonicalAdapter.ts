import type { D1Database } from '@cloudflare/workers-types';
import type {
  ReceivableAdapterInput,
  ReceivableFinancialStatus,
  ReceivableRecord,
  ReceivableSourceRef,
} from './types';

interface NameRow {
  name: string;
}

interface CanonicalReceivableRow {
  canonicalInvoicePublicId: string;
  legacyBillSourceId: string | null;
  invoiceNumber: string;
  patientId: number;
  patientName: string | null;
  patientMobile: string | null;
  currencyCode: string;
  totalMinor: number | string;
  paidMinor: number | string;
  creditedMinor: number | string;
  dueMinor: number | string;
  status: string;
  issuedAtUtc: string;
}

const REQUIRED_COLUMNS = [
  'tenant_id',
  'invoice_public_id',
  'invoice_number',
  'legacy_patient_id',
  'currency_code',
  'total_minor',
  'paid_minor',
  'due_minor',
  'status',
  'issued_at_utc',
] as const;

async function tableExists(db: D1Database, tableName: string): Promise<boolean> {
  const row = await db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
    LIMIT 1
  `).bind(tableName).first<NameRow>();
  return row !== null;
}

async function tableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  if (!await tableExists(db, tableName)) return new Set();
  const result = await db.prepare(`PRAGMA table_info('${tableName}')`).all<NameRow>();
  return new Set((result.results ?? []).map((row) => row.name));
}

function toSafeMinor(value: number | string, field: string): number {
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new Error(`Canonical invoice ${field} must be a non-negative safe integer`);
  }
  return numeric;
}

function canonicalTimestampToUtc(value: string): string {
  if (!value?.endsWith('Z')) {
    throw new Error('Canonical invoice issued_at_utc must be a UTC timestamp');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Canonical invoice issued_at_utc is invalid');
  }
  return parsed.toISOString();
}

function canonicalFinancialStatus(
  status: string,
  dueMinor: number,
): ReceivableFinancialStatus {
  const normalized = status.trim().toLowerCase();
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'reversed') return 'reversed';
  if (normalized === 'posted' && dueMinor <= 0) return 'paid';
  return 'open';
}

function sourceReference(row: CanonicalReceivableRow): ReceivableSourceRef {
  const source: ReceivableSourceRef = {
    sourceType: 'invoice',
    canonicalInvoicePublicId: row.canonicalInvoicePublicId,
  };

  if (row.legacyBillSourceId && /^\d+$/.test(row.legacyBillSourceId)) {
    const legacyBillId = Number(row.legacyBillSourceId);
    if (Number.isSafeInteger(legacyBillId) && legacyBillId > 0) {
      source.legacyBillId = legacyBillId;
    }
  }

  return source;
}

interface CanonicalQueryParts {
  selectSql: string;
  hasNetDueMinor: boolean;
}

async function canonicalQueryParts(db: D1Database): Promise<CanonicalQueryParts> {
  const columns = await tableColumns(db, 'canonical_invoices');
  const missing = REQUIRED_COLUMNS.filter((column) => !columns.has(column));
  if (missing.length > 0) {
    throw new Error(`Canonical receivable schema is missing: ${missing.join(', ')}`);
  }

  const hasCreditedMinor = columns.has('credited_minor');
  const hasNetDueMinor = columns.has('net_due_minor');
  const hasMappings = await tableExists(db, 'canonical_source_mappings');
  const patientColumns = await tableColumns(db, 'patients');
  const canJoinPatients = patientColumns.has('id') && patientColumns.has('tenant_id');
  const creditedExpression = hasCreditedMinor ? 'ci.credited_minor' : '0';
  const dueExpression = hasNetDueMinor ? 'ci.net_due_minor' : 'ci.due_minor';
  const patientNameExpression = canJoinPatients && patientColumns.has('name')
    ? "COALESCE(p.name, 'Unknown')"
    : "'Unknown'";
  const patientMobileExpression = canJoinPatients && patientColumns.has('mobile')
    ? 'p.mobile'
    : 'NULL';
  const patientJoin = canJoinPatients
    ? `LEFT JOIN patients p
        ON p.id = ci.legacy_patient_id
       AND p.tenant_id = ci.tenant_id`
    : '';
  const legacyMappingExpression = hasMappings
    ? `(
        SELECT m.source_public_id
        FROM canonical_source_mappings m
        WHERE m.tenant_id = ci.tenant_id
          AND m.entity_type = 'invoice'
          AND m.canonical_public_id = ci.invoice_public_id
          AND m.source_table = 'bills'
          AND m.mapping_status = 'mapped'
        ORDER BY m.id ASC
        LIMIT 1
      )`
    : 'NULL';

  return {
    hasNetDueMinor,
    selectSql: `
      SELECT
        ci.invoice_public_id AS "canonicalInvoicePublicId",
        ${legacyMappingExpression} AS "legacyBillSourceId",
        ci.invoice_number AS "invoiceNumber",
        ci.legacy_patient_id AS "patientId",
        ${patientNameExpression} AS "patientName",
        ${patientMobileExpression} AS "patientMobile",
        ci.currency_code AS "currencyCode",
        ci.total_minor AS "totalMinor",
        ci.paid_minor AS "paidMinor",
        ${creditedExpression} AS "creditedMinor",
        ${dueExpression} AS "dueMinor",
        ci.status AS status,
        ci.issued_at_utc AS "issuedAtUtc"
      FROM canonical_invoices ci
      ${patientJoin}
    `,
  };
}

function mapCanonicalReceivable(
  row: CanonicalReceivableRow,
  hasNetDueMinor: boolean,
): ReceivableRecord {
  const totalMinor = toSafeMinor(row.totalMinor, 'total_minor');
  const paidMinor = toSafeMinor(row.paidMinor, 'paid_minor');
  const creditedMinor = toSafeMinor(row.creditedMinor, 'credited_minor');
  const dueMinor = toSafeMinor(row.dueMinor, hasNetDueMinor ? 'net_due_minor' : 'due_minor');
  const patientId = Number(row.patientId);

  if (!row.canonicalInvoicePublicId?.trim()) {
    throw new Error('Canonical invoice is missing invoice_public_id');
  }
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new Error('Canonical invoice has an invalid legacy patient identifier');
  }
  if (!/^[A-Z]{3}$/.test(row.currencyCode)) {
    throw new Error('Canonical invoice has an invalid currency code');
  }

  return {
    source: sourceReference(row),
    invoiceNumber: row.invoiceNumber.trim(),
    patientId,
    patientName: row.patientName?.trim() || 'Unknown',
    patientMobile: row.patientMobile?.trim() || null,
    currencyCode: row.currencyCode,
    totalMinor,
    paidMinor,
    creditedMinor,
    dueMinor,
    issuedAtUtc: canonicalTimestampToUtc(row.issuedAtUtc),
    financialStatus: canonicalFinancialStatus(row.status, dueMinor),
  };
}

export async function getCanonicalReceivable(input: ReceivableAdapterInput & {
  canonicalInvoicePublicId: string;
}): Promise<ReceivableRecord | null> {
  const query = await canonicalQueryParts(input.db);
  const row = await input.db.prepare(`${query.selectSql}
    WHERE ci.tenant_id = ?
      AND ci.invoice_public_id = ?
      AND ci.status <> 'draft'
    LIMIT 1
  `).bind(input.tenantId, input.canonicalInvoicePublicId).first<CanonicalReceivableRow>();

  return row ? mapCanonicalReceivable(row, query.hasNetDueMinor) : null;
}

export async function listCanonicalReceivables(
  input: ReceivableAdapterInput,
): Promise<ReceivableRecord[]> {
  const query = await canonicalQueryParts(input.db);
  const patientClause = input.patientId === undefined ? '' : 'AND ci.legacy_patient_id = ?';
  const params = input.patientId === undefined
    ? [input.tenantId]
    : [input.tenantId, input.patientId];
  const result = await input.db.prepare(`${query.selectSql}
    WHERE ci.tenant_id = ?
      ${patientClause}
      AND ci.status <> 'draft'
    ORDER BY ci.id ASC
  `).bind(...params).all<CanonicalReceivableRow>();

  return (result.results ?? []).map((row) => mapCanonicalReceivable(row, query.hasNetDueMinor));
}
