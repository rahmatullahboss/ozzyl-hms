import { z } from 'zod';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { createJournalEntrySchema } from '../../schemas/accounting';
import { getDb } from '../../db';
import { recordAndPostAccountingEvent, ACCOUNTING_EVENT_TYPES } from '../../lib/accounting-posting';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { requireRole } from '../../middleware/rbac';


type JournalEnv = {
  Bindings: {
    DB: D1Database;
    KV: KVNamespace;
    UPLOADS: R2Bucket;
    ENVIRONMENT: string;
  };
  Variables: {
    tenantId: string;
    userId: string;
    role: string;
  };
};

const journalRoutes = new Hono<JournalEnv>();

journalRoutes.use('*', requireRole('hospital_admin', 'md', 'director', 'accountant'));

journalRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { startDate, endDate, accountId } = c.req.query();

  let voucherQuery = `
    SELECT
           v.id,
           v.entry_date,
           v.voucher_number as reference,
           v.voucher_number,
           v.description,
           v.status,
           MAX(CASE WHEN jl.debit_amount > 0 THEN jl.account_id END) as debit_account_id,
           MAX(CASE WHEN jl.credit_amount > 0 THEN jl.account_id END) as credit_account_id,
           MAX(CASE WHEN jl.debit_amount > 0 THEN da.code END) as debit_code,
           MAX(CASE WHEN jl.debit_amount > 0 THEN da.name END) as debit_name,
           MAX(CASE WHEN jl.credit_amount > 0 THEN ca.code END) as credit_code,
           MAX(CASE WHEN jl.credit_amount > 0 THEN ca.name END) as credit_name,
           COALESCE(SUM(jl.debit_amount), 0) as amount,
           u.name as created_by_name,
           vt.code as voucher_type_code,
           vt.name as voucher_type_name
    FROM accounting_vouchers v
    JOIN accounting_journal_lines jl ON jl.voucher_id = v.id AND jl.tenant_id = v.tenant_id
    LEFT JOIN chart_of_accounts da ON jl.account_id = da.id AND jl.debit_amount > 0
    LEFT JOIN chart_of_accounts ca ON jl.account_id = ca.id AND jl.credit_amount > 0
    LEFT JOIN users u ON CAST(u.id AS TEXT) = v.created_by
    LEFT JOIN voucher_types vt ON v.voucher_type_id = vt.id AND vt.tenant_id = v.tenant_id
    WHERE v.tenant_id = ? AND v.event_type = 'manual_journal'
  `;
  const voucherParams: any[] = [tenantId];

  if (startDate) {
    voucherQuery += ' AND v.entry_date >= ?';
    voucherParams.push(startDate);
  }
  if (endDate) {
    voucherQuery += ' AND v.entry_date <= ?';
    voucherParams.push(endDate);
  }
  if (accountId) {
    voucherQuery += `
      AND EXISTS (
        SELECT 1
        FROM accounting_journal_lines match_line
        WHERE match_line.voucher_id = v.id
          AND match_line.tenant_id = v.tenant_id
          AND match_line.account_id = ?
      )
    `;
    voucherParams.push(accountId);
  }

  voucherQuery += ' GROUP BY v.id ORDER BY v.entry_date DESC, v.id DESC';

  let legacyQuery = `
    SELECT j.*,
           da.code as debit_code, da.name as debit_name,
           ca.code as credit_code, ca.name as credit_name,
           u.name as created_by_name,
           vt.code as voucher_type_code, vt.name as voucher_type_name
    FROM journal_entries j
    LEFT JOIN chart_of_accounts da ON j.debit_account_id = da.id
    LEFT JOIN chart_of_accounts ca ON j.credit_account_id = ca.id
    LEFT JOIN users u ON j.created_by = u.id
    LEFT JOIN voucher_types vt ON j.voucher_type_id = vt.id
    WHERE j.tenant_id = ? AND j.is_deleted = 0
  `;
  const legacyParams: any[] = [tenantId];

  if (startDate) {
    legacyQuery += ' AND j.entry_date >= ?';
    legacyParams.push(startDate);
  }
  if (endDate) {
    legacyQuery += ' AND j.entry_date <= ?';
    legacyParams.push(endDate);
  }
  if (accountId) {
    legacyQuery += ' AND (j.debit_account_id = ? OR j.credit_account_id = ?)';
    legacyParams.push(accountId, accountId);
  }

  legacyQuery += ' ORDER BY j.entry_date DESC, j.id DESC';

  try {
    const [voucherResult, legacyResult] = await Promise.all([
      db.$client.prepare(voucherQuery).bind(...voucherParams).all(),
      db.$client.prepare(legacyQuery).bind(...legacyParams).all(),
    ]);
    const journalEntries = [...voucherResult.results, ...legacyResult.results]
      .sort((a: any, b: any) => {
        const dateCompare = String(b.entry_date || '').localeCompare(String(a.entry_date || ''));
        if (dateCompare !== 0) return dateCompare;
        return Number(b.id || 0) - Number(a.id || 0);
      });

    return c.json({ journalEntries });
  } catch (error) {
    console.error('Error fetching journal entries:', error);
    return c.json({ error: 'Failed to fetch journal entries' }, 500);
  }
});

journalRoutes.post('/', zValidator('json', createJournalEntrySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const { entry_date, reference, description, debit_account_id, credit_account_id, amount } = c.req.valid('json');

  if (debit_account_id === credit_account_id) {
    return c.json({ error: 'Debit and credit accounts must be different' }, 400);
  }

  try {
    await assertAccountingPeriodOpen(c.env.DB, tenantId, entry_date, 'Manual journal entry creation');

    const debitAccount = await db.$client.prepare(`
      SELECT id, is_active FROM chart_of_accounts WHERE id = ? AND tenant_id = ?
    `).bind(debit_account_id, tenantId).first();

    const creditAccount = await db.$client.prepare(`
      SELECT id, is_active FROM chart_of_accounts WHERE id = ? AND tenant_id = ?
    `).bind(credit_account_id, tenantId).first();

    if (!debitAccount || !creditAccount) {
      return c.json({ error: 'Invalid account ID' }, 400);
    }

    if (!debitAccount.is_active || !creditAccount.is_active) {
      return c.json({ error: 'Cannot use inactive accounts' }, 400);
    }

    const activeFY = await db.$client.prepare(`
      SELECT id, fiscal_year_name, start_date, end_date, is_closed
      FROM fiscal_years WHERE tenant_id = ? AND is_active = 1 LIMIT 1
    `).bind(tenantId).first<{ id: number; fiscal_year_name: string; start_date: string; end_date: string; is_closed: number }>();

    if (!activeFY) {
      return c.json({ error: 'No active fiscal year found. Please activate a fiscal year before creating journal entries.' }, 400);
    }

    if (activeFY.is_closed) {
      return c.json({ error: `Fiscal year ${activeFY.fiscal_year_name} is closed. Cannot create entries.` }, 400);
    }

    const entryDateObj = new Date(entry_date);
    const fyStart = new Date(activeFY.start_date);
    const fyEnd = new Date(activeFY.end_date);
    if (entryDateObj < fyStart || entryDateObj > fyEnd) {
      return c.json({
        error: `Entry date must be within fiscal year ${activeFY.fiscal_year_name} (${activeFY.start_date} to ${activeFY.end_date})`,
      }, 400);
    }

    const eventResult = await recordAndPostAccountingEvent(c.env.DB, {
      tenantId,
      sourceType: 'manual_journal',
      sourceId: reference || `MAN-${Date.now()}`,
      eventType: ACCOUNTING_EVENT_TYPES.manualJournal,
      eventDate: entry_date,
      payload: {
        lines: [
          {
            accountId: debit_account_id,
            debit: amount,
            credit: 0,
            memo: description || 'Manual journal debit',
          },
          {
            accountId: credit_account_id,
            debit: 0,
            credit: amount,
            memo: description || 'Manual journal credit',
          },
        ],
      },
      createdBy: userId,
    });

    if (!eventResult.posted || !eventResult.voucherId) {
      return c.json({ error: eventResult.skippedReason || 'Failed to post journal entry' }, 400);
    }

    const entryId = eventResult.voucherId;
    const voucherNumber = eventResult.voucherNumber;

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'CREATE',
      'journal_vouchers',
      entryId,
      null,
      { entry_date, reference, description, debit_account_id, credit_account_id, amount, voucher_number: voucherNumber }
    );

    return c.json({ success: true, id: entryId, voucher_number: voucherNumber, message: 'Journal entry created successfully via posting engine' }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error creating journal entry:', error);
    return c.json({ error: 'Failed to create journal entry' }, 500);
  }
});

async function listPendingVouchers(c: Context<JournalEnv>) {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role = c.get('role');

  if (role !== 'director' && role !== 'md') {
    return c.json({ error: 'Only director or MD can view pending vouchers' }, 403);
  }

  try {
    const result = await db.$client.prepare(`
      SELECT j.*,
             da.code as debit_code, da.name as debit_name,
             ca.code as credit_code, ca.name as credit_name,
             u.name as created_by_name
      FROM journal_entries j
      LEFT JOIN chart_of_accounts da ON j.debit_account_id = da.id
      LEFT JOIN chart_of_accounts ca ON j.credit_account_id = ca.id
      LEFT JOIN users u ON j.created_by = u.id
      WHERE j.tenant_id = ? AND j.is_deleted = 0 AND j.status = 'pending'
      ORDER BY j.entry_date DESC, j.id DESC
    `).bind(tenantId).all();

    return c.json({ pendingEntries: result.results });
  } catch (error) {
    console.error('Error fetching pending entries:', error);
    return c.json({ error: 'Failed to fetch pending vouchers' }, 500);
  }
}

// Pending vouchers - defined BEFORE /:id so it matches before the dynamic parameter.
journalRoutes.get('/pending', listPendingVouchers);
journalRoutes.get('/pending-vouchers', listPendingVouchers);

journalRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const result = await db.$client.prepare(`
      SELECT j.*,
             da.code as debit_code, da.name as debit_name,
             ca.code as credit_code, ca.name as credit_name,
             u.name as created_by_name,
             vt.code as voucher_type_code, vt.name as voucher_type_name
      FROM journal_entries j
      LEFT JOIN chart_of_accounts da ON j.debit_account_id = da.id
      LEFT JOIN chart_of_accounts ca ON j.credit_account_id = ca.id
      LEFT JOIN users u ON j.created_by = u.id
      LEFT JOIN voucher_types vt ON j.voucher_type_id = vt.id
      WHERE j.id = ? AND j.tenant_id = ?
    `).bind(id, tenantId).first();

    if (!result) {
      return c.json({ error: 'Journal entry not found' }, 404);
    }

    return c.json({ journalEntry: result });
  } catch (error) {
    console.error('Error fetching journal entry:', error);
    return c.json({ error: 'Failed to fetch journal entry' }, 500);
  }
});

journalRoutes.delete('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const id = c.req.param('id');

  if (role !== 'director') {
    return c.json({ error: 'Unauthorized. Director access required.' }, 403);
  }

  try {
    const existing = await db.$client.prepare(`
      SELECT * FROM journal_entries WHERE id = ? AND tenant_id = ? AND is_deleted = 0
    `).bind(id, tenantId).first();

    if (!existing) {
      const voucher = await db.$client.prepare(`
        SELECT id, status, entry_date FROM accounting_vouchers WHERE id = ? AND tenant_id = ?
      `).bind(id, tenantId).first<{ id: number; status?: string | null; entry_date?: string | null }>();

      if (voucher) {
        return c.json({
          error: 'Posted accounting vouchers are immutable. Create a reversal entry instead of deleting the voucher.',
        }, 409);
      }

      return c.json({ error: 'Journal entry not found' }, 404);
    }

    const status = String((existing as { status?: string | null }).status ?? 'verified').toLowerCase();
    if (status === 'verified') {
      return c.json({
        error: 'Verified journal vouchers are immutable. Create a reversal entry instead of deleting the posted voucher.',
      }, 409);
    }

    const entryDate = String((existing as { entry_date?: string | null }).entry_date || new Date().toISOString().slice(0, 10));
    await assertAccountingPeriodOpen(c.env.DB, tenantId, entryDate, 'Journal voucher deletion');

    await db.$client.prepare(`
      UPDATE journal_entries SET is_deleted = 1 WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'DELETE',
      'journal_entries',
      parseInt(id),
      existing,
      { is_deleted: 1 }
    );

    return c.json({ success: true, message: 'Journal entry deleted successfully' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Error deleting journal entry:', error);
    return c.json({ error: 'Failed to delete journal entry' }, 500);
  }
});

journalRoutes.post('/:id/verify', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const id = c.req.param('id');

  if (role !== 'director' && role !== 'md') {
    return c.json({ error: 'Only director or MD can verify vouchers' }, 403);
  }

  try {
    const existing = await db.$client.prepare(`
      SELECT id FROM journal_entries WHERE id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(id, tenantId).first();

    if (!existing) {
      return c.json({ error: 'Pending voucher not found' }, 404);
    }

    await db.$client.prepare(`
      UPDATE journal_entries 
      SET status = 'verified', verified_by = ?, verified_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(userId, id, tenantId).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'VERIFY',
      'journal_entries',
      parseInt(id),
      { status: 'pending' },
      { status: 'verified', verified_by: userId, verified_at: new Date().toISOString() }
    );

    return c.json({ message: 'Voucher verified successfully' });
  } catch (error) {
    console.error('Error verifying voucher:', error);
    return c.json({ error: 'Failed to verify voucher' }, 500);
  }
});

journalRoutes.post('/:id/reject', zValidator('json', z.object({
  reason: z.string().min(1)
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const id = c.req.param('id');
  const { reason } = c.req.valid('json');

  if (role !== 'director' && role !== 'md') {
    return c.json({ error: 'Only director or MD can reject vouchers' }, 403);
  }

  try {
    const existing = await db.$client.prepare(`
      SELECT id FROM journal_entries WHERE id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(id, tenantId).first();

    if (!existing) {
      return c.json({ error: 'Pending voucher not found' }, 404);
    }

    await db.$client.prepare(`
      UPDATE journal_entries 
      SET status = 'rejected', verified_by = ?, verified_at = datetime('now', '+6 hours'), rejection_reason = ?
      WHERE id = ? AND tenant_id = ? AND status = 'pending'
    `).bind(userId, reason, id, tenantId).run();

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'REJECT',
      'journal_entries',
      parseInt(id),
      { status: 'pending' },
      { status: 'rejected', verified_by: userId, rejection_reason: reason }
    );

    return c.json({ message: 'Voucher rejected' });
  } catch (error) {
    console.error('Error rejecting voucher:', error);
    return c.json({ error: 'Failed to reject voucher' }, 500);
  }
});

export default journalRoutes;
