import type {
  ReceivableAdapterInput,
  ReceivableFinancialStatus,
  ReceivableRecord,
} from './types';

interface LegacyReceivableRow {
  legacyBillId: number;
  invoiceNumber: string | null;
  patientId: number;
  patientName: string | null;
  patientMobile: string | null;
  total: number | string | null;
  paid: number | string | null;
  due: number | string | null;
  status: string | null;
  issuedAt: string | null;
}

const LEGACY_CURRENCY_CODE = 'BDT';

export function majorToMinor(value: number | string): number {
  const raw = String(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) {
    throw new Error(`Expected a valid monetary value, received ${raw}`);
  }

  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? '';
  const firstTwo = (fraction.slice(0, 2) + '00').slice(0, 2);
  let absoluteMinor = whole * 100n + BigInt(firstTwo);

  if (Number(fraction[2] ?? '0') >= 5) {
    absoluteMinor += 1n;
  }

  const signedMinor = sign * absoluteMinor;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (signedMinor > max || signedMinor < -max) {
    throw new Error('Monetary value exceeds the JavaScript safe integer range');
  }

  return Number(signedMinor);
}

function nullableMajorToMinor(value: number | string | null): number {
  return majorToMinor(value ?? 0);
}

function legacyTimestampToUtc(value: string | null): string {
  if (!value?.trim()) {
    throw new Error('Legacy invoice is missing its creation timestamp');
  }

  const trimmed = value.trim();
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
    ? trimmed
    : `${trimmed.replace(' ', 'T')}+06:00`;
  const parsed = new Date(zoned);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Legacy invoice has an invalid creation timestamp: ${value}`);
  }

  return parsed.toISOString();
}

function legacyFinancialStatus(status: string | null, dueMinor: number): ReceivableFinancialStatus {
  const normalized = (status ?? 'open').trim().toLowerCase();
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'refunded' || normalized === 'reversed') return 'reversed';
  if (normalized === 'paid' || dueMinor <= 0) return 'paid';
  return 'open';
}

const legacySelect = `
  SELECT
    b.id AS "legacyBillId",
    b.invoice_no AS "invoiceNumber",
    b.patient_id AS "patientId",
    COALESCE(p.name, 'Unknown') AS "patientName",
    p.mobile AS "patientMobile",
    COALESCE(b.total, 0) AS total,
    COALESCE(b.paid, 0) AS paid,
    COALESCE(b.due, 0) AS due,
    COALESCE(b.status, 'open') AS status,
    b.created_at AS "issuedAt"
  FROM bills b
  LEFT JOIN patients p
    ON p.id = b.patient_id
   AND p.tenant_id = b.tenant_id
`;

function mapLegacyReceivable(row: LegacyReceivableRow): ReceivableRecord {
  const totalMinor = nullableMajorToMinor(row.total);
  const paidMinor = nullableMajorToMinor(row.paid);
  const dueMinor = nullableMajorToMinor(row.due);
  const legacyBillId = Number(row.legacyBillId);
  const patientId = Number(row.patientId);

  if (!Number.isSafeInteger(legacyBillId) || legacyBillId <= 0) {
    throw new Error('Legacy invoice has an invalid bill identifier');
  }
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    throw new Error('Legacy invoice has an invalid patient identifier');
  }

  return {
    source: {
      sourceType: 'invoice',
      legacyBillId,
    },
    invoiceNumber: row.invoiceNumber?.trim() || `Bill #${legacyBillId}`,
    patientId,
    patientName: row.patientName?.trim() || 'Unknown',
    patientMobile: row.patientMobile?.trim() || null,
    currencyCode: LEGACY_CURRENCY_CODE,
    totalMinor,
    paidMinor,
    creditedMinor: 0,
    dueMinor,
    issuedAtUtc: legacyTimestampToUtc(row.issuedAt),
    financialStatus: legacyFinancialStatus(row.status, dueMinor),
  };
}

export async function getLegacyReceivable(input: ReceivableAdapterInput & {
  legacyBillId: number;
}): Promise<ReceivableRecord | null> {
  const row = await input.db.prepare(`${legacySelect}
    WHERE b.tenant_id = ?
      AND b.id = ?
      AND lower(COALESCE(b.status, 'open')) <> 'draft'
    LIMIT 1
  `).bind(input.tenantId, input.legacyBillId).first<LegacyReceivableRow>();

  return row ? mapLegacyReceivable(row) : null;
}

export async function listLegacyReceivables(
  input: ReceivableAdapterInput,
): Promise<ReceivableRecord[]> {
  const patientClause = input.patientId === undefined ? '' : 'AND b.patient_id = ?';
  const params = input.patientId === undefined
    ? [input.tenantId]
    : [input.tenantId, input.patientId];
  const result = await input.db.prepare(`${legacySelect}
    WHERE b.tenant_id = ?
      ${patientClause}
      AND lower(COALESCE(b.status, 'open')) <> 'draft'
    ORDER BY b.id ASC
  `).bind(...params).all<LegacyReceivableRow>();

  return (result.results ?? []).map(mapLegacyReceivable);
}
