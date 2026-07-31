import { getTodayGMT6 } from './date-utils';

export async function getActiveFiscalYear(
  db: D1Database,
  tenantId: string,
  date?: string,
): Promise<{ id: number; prefix: string; insurancePrefix: string; pharmacyPrefix: string } | null> {
  const targetDate = date ?? getTodayGMT6();
  const row = await db
    .prepare(
      `SELECT id, prefix, insurance_prefix, pharmacy_prefix
       FROM fiscal_years
       WHERE tenant_id = ? AND is_active = 1 AND is_closed = 0
         AND start_date <= ? AND end_date >= ?`,
    )
    .bind(tenantId, targetDate, targetDate)
    .first<{ id: number; prefix: string; insurance_prefix: string; pharmacy_prefix: string }>();

  if (!row) return null;
  return {
    id: row.id,
    prefix: row.prefix,
    insurancePrefix: row.insurance_prefix,
    pharmacyPrefix: row.pharmacy_prefix,
  };
}

export async function incrementFiscalSequence(
  db: D1Database,
  tenantId: string,
  fiscalYearId: number,
  sequenceType: string,
): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO fiscal_year_sequences (tenant_id, fiscal_year_id, sequence_type, current_value)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(tenant_id, fiscal_year_id, sequence_type)
       DO UPDATE SET current_value = current_value + 1
       RETURNING current_value`,
    )
    .bind(tenantId, fiscalYearId, sequenceType)
    .first<{ current_value: number }>();

  return row?.current_value ?? 1;
}

export async function getNextFiscalInvoiceNo(
  db: D1Database,
  tenantId: string,
  fiscalYearId: number,
  type: 'BL' | 'INS' | 'PHR',
): Promise<string> {
  const seq = await incrementFiscalSequence(db, tenantId, fiscalYearId, type);
  const padded = String(seq).padStart(6, '0');
  return `${type}-${padded}`;
}
