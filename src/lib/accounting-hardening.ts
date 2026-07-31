import type { D1Database } from '@cloudflare/workers-types';
import { HTTPException } from 'hono/http-exception';

export interface VoucherData {
  id: number;
  tenant_id: string;
  voucher_number: string;
  entry_date: string;
  lines: Array<{
    account_id: number;
    debit: number;
    credit: number;
  }>;
}

/**
 * Calculates a cryptographic hash for a voucher to ensure its integrity.
 * The hash includes the previous voucher's hash to form a chain.
 */
export async function calculateVoucherHash(
  voucher: VoucherData,
  previousHash: string | null
): Promise<string> {
  const data = JSON.stringify({
    tenant_id: voucher.tenant_id,
    voucher_number: voucher.voucher_number,
    entry_date: voucher.entry_date,
    lines: voucher.lines.sort((a, b) => a.account_id - b.account_id),
    previous_hash: previousHash || 'GENESIS'
  });

  const msgUint8 = new TextEncoder().encode(data);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Verifies the integrity of the voucher chain for a tenant.
 * Returns the first corrupted voucher ID if any, or null if all is well.
 */
export async function verifyVoucherChain(
  db: D1Database,
  tenantId: string
): Promise<{ valid: boolean; corruptedVoucherId?: number; error?: string; warning?: string }> {
  try {
    const vouchers = await db.prepare(`
      SELECT id, voucher_number, entry_date, verification_hash, previous_hash
      FROM accounting_vouchers
      WHERE tenant_id = ?
      ORDER BY id ASC
    `).bind(tenantId).all<{ id: number; voucher_number: string; entry_date: string; verification_hash: string; previous_hash: string }>();

    let lastHash: string | null = null;
    let legacyVoucherCount = 0;

    for (const v of vouchers.results) {
      if (!v.verification_hash || !v.previous_hash) {
        legacyVoucherCount += 1;
        lastHash = null;
        continue;
      }

      const { results: lines } = await db.prepare(`
        SELECT account_id, debit_amount as debit, credit_amount as credit
        FROM accounting_journal_lines
        WHERE voucher_id = ?
      `).bind(v.id).all<{ account_id: number; debit: number; credit: number }>();

      const calculatedHash = await calculateVoucherHash(
        { ...v, lines, tenant_id: tenantId },
        v.previous_hash
      );

      if (calculatedHash !== v.verification_hash) {
        return { valid: false, corruptedVoucherId: v.id, error: `Hash mismatch for voucher ${v.voucher_number}` };
      }

      if (v.previous_hash !== (lastHash || 'GENESIS')) {
         return { valid: false, corruptedVoucherId: v.id, error: `Chain break at voucher ${v.voucher_number}` };
      }

      lastHash = v.verification_hash;
    }

    return legacyVoucherCount > 0
      ? { valid: true, warning: `${legacyVoucherCount} legacy voucher(s) predate hash-chain backfill` }
      : { valid: true };
  } catch (error) {
    return { valid: false, error: String(error) };
  }
}

/**
 * Checks if a date falls within a closed accounting period.
 */
export async function isPeriodClosed(
  db: D1Database,
  tenantId: string,
  dateStr: string
): Promise<boolean> {
  // Extract month/year from dateStr (assuming YYYY-MM-DD)
  const periodName = dateStr.substring(0, 7); // 'YYYY-MM'

  const activeFiscalYear = await db.prepare(`
    SELECT id
    FROM fiscal_years
    WHERE tenant_id = ?
      AND is_active = 1
      AND (is_closed = 0 OR is_closed IS NULL)
      AND start_date <= ?
      AND end_date >= ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(tenantId, dateStr, dateStr).first<{ id: number }>();

  const closed = activeFiscalYear
    ? await db.prepare(`
      SELECT status FROM accounting_period_closes
      WHERE tenant_id = ?
        AND (fiscal_year_id = ? OR fiscal_year_id IS NULL)
        AND period_name = ?
        AND status IN ('closed', 'audited')
      LIMIT 1
    `).bind(tenantId, activeFiscalYear.id, periodName).first<{ status?: string }>()
    : await db.prepare(`
    SELECT status FROM accounting_period_closes
    WHERE tenant_id = ? AND period_name = ? AND status IN ('closed', 'audited')
    LIMIT 1
  `).bind(tenantId, periodName).first<{ status?: string }>();

  if (!closed) return false;
  if (typeof closed.status === 'string') {
    const status = closed.status.toLowerCase();
    return status === 'closed' || status === 'audited';
  }
  return true;
}

export async function assertAccountingPeriodOpen(
  db: D1Database,
  tenantId: string,
  dateStr: string,
  action = 'This financial action',
): Promise<void> {
  if (await isPeriodClosed(db, tenantId, dateStr)) {
    const periodName = dateStr.substring(0, 7);
    throw new HTTPException(409, {
      message: `${action} is blocked because accounting period ${periodName} is closed. Create a reversal or use an open period.`,
    });
  }
}

/**
 * Records an audit log entry for accounting actions.
 */
export async function recordAccountingAudit(
  db: D1Database,
  params: {
    tenantId: string;
    entityType: 'mapping' | 'voucher' | 'account' | 'period';
    entityId: string;
    action: 'create' | 'update' | 'void' | 'close';
    oldValue?: any;
    newValue?: any;
    performedBy?: string;
  }
): Promise<void> {
  await db.prepare(`
    INSERT INTO accounting_audit_logs
      (tenant_id, entity_type, entity_id, action, old_value, new_value, performed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    params.tenantId,
    params.entityType,
    params.entityId,
    params.action,
    params.oldValue ? JSON.stringify(params.oldValue) : null,
    params.newValue ? JSON.stringify(params.newValue) : null,
    params.performedBy || 'system'
  ).run();
}
