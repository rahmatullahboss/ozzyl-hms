import type { D1Database } from '@cloudflare/workers-types';

export async function getPatientDepositBalance(
  db: D1Database,
  tenantId: string,
  patientId: number,
): Promise<number> {
  const row = await db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0) as balance
    FROM billing_deposits
    WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
  `).bind(tenantId, patientId).first<{ balance: number }>();

  return Math.round(Number(row?.balance ?? 0) * 100) / 100;
}
