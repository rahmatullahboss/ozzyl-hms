import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { requireRole } from '../../middleware/rbac';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getTodayGMT6 } from '../../lib/date-utils';
import { getUploadObjectForResponse } from '../../lib/upload-objects';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  postPendingAccountingEvents,
  resolveAccountMappings,
} from '../../lib/accounting-posting';
import type { Env, Variables } from '../../types';

const bankBook = new Hono<{ Bindings: Env; Variables: Variables }>();

bankBook.use('/*', requireRole('hospital_admin', 'md', 'director', 'manager', 'accountant'));
const BANK_DEPOSIT_MUTATION_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
const ALLOWED_DEPOSIT_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_DEPOSIT_PROOF_BYTES = 5 * 1024 * 1024;

const bankDepositConfirmSchema = z.object({
  bankName: z.string().trim().min(1).max(160),
  referenceNo: z.string().trim().min(1).max(128),
  depositDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  confirmedAmount: z.number().positive(),
  proofUrl: z.string().trim().max(500).optional(),
  proofNote: z.string().trim().max(300).optional(),
});

const bankDepositRejectSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

const bankDepositReturnSchema = z.object({
  targetCounterSessionId: z.number().int().positive(),
  note: z.string().trim().min(3).max(300),
});

const manualAdjustmentLineSchema = z.object({
  accountId: z.number().int().positive(),
  debit: z.number().min(0).default(0),
  credit: z.number().min(0).default(0),
  memo: z.string().trim().min(1).max(200),
}).superRefine((line, ctx) => {
  if ((line.debit > 0 && line.credit > 0) || (line.debit === 0 && line.credit === 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Each manual adjustment line must have either debit or credit.',
      path: ['debit'],
    });
  }
});

const bankDepositManualAdjustmentSchema = z.object({
  note: z.string().trim().min(3).max(300),
  lines: z.array(manualAdjustmentLineSchema).min(2),
});

type BankDepositRequestRow = {
  id: number;
  request_no: string;
  counter_session_id: number;
  counter_id: number;
  requested_by: number;
  requested_amount: number;
  proposed_bank_name: string | null;
  request_note: string | null;
  status: string;
  bank_transaction_id?: number | null;
  confirmed_bank_name?: string | null;
  confirmed_reference_no?: string | null;
  confirmed_date?: string | null;
  deposit_proof_url?: string | null;
  deposit_proof_note?: string | null;
  deposit_proof_key?: string | null;
  deposit_proof_uploaded_at?: string | null;
  rejection_reason?: string | null;
  resolution_type?: string | null;
  created_at: string;
  updated_at?: string | null;
  cashier_name?: string | null;
  counter_name?: string | null;
};

function aggValue(row: Record<string, unknown> | null | undefined): number {
  if (!row) return 0;
  return Number(row.total ?? row.amount ?? 0);
}

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post bank deposit accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function mapBankDepositRequest(row: BankDepositRequestRow) {
  return {
    id: Number(row.id),
    requestNo: row.request_no,
    amount: Number(row.requested_amount ?? 0),
    status: row.status,
    proposedBankName: row.proposed_bank_name ?? null,
    note: row.request_note ?? null,
    confirmedBankName: row.confirmed_bank_name ?? null,
    confirmedReferenceNo: row.confirmed_reference_no ?? null,
    confirmedDate: row.confirmed_date ?? null,
    depositProofUrl: row.deposit_proof_url ?? null,
    depositProofNote: row.deposit_proof_note ?? null,
    depositProofKey: row.deposit_proof_key ?? null,
    depositProofUploadedAt: row.deposit_proof_uploaded_at ?? null,
    rejectionReason: row.rejection_reason ?? null,
    resolutionType: row.resolution_type ?? null,
    bankTransactionId: row.bank_transaction_id ?? null,
    cashierName: row.cashier_name ?? null,
    counterName: row.counter_name ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}

function normalizeMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function assertBalancedManualLines(lines: Array<{ debit: number; credit: number }>): void {
  const debit = normalizeMoney(lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0));
  const credit = normalizeMoney(lines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0));
  if (debit <= 0 || debit !== credit) {
    throw new HTTPException(400, { message: 'Manual adjustment lines must be balanced.' });
  }
}

async function loadBankDepositRequest(db: D1Database, tenantId: string, id: number): Promise<BankDepositRequestRow | null> {
  return db.prepare(`
    SELECT id, request_no, counter_session_id, counter_id, requested_by, requested_amount,
           proposed_bank_name, request_note, status, bank_transaction_id,
           confirmed_bank_name, confirmed_reference_no, confirmed_date,
           deposit_proof_url, deposit_proof_note, deposit_proof_key, deposit_proof_uploaded_at,
           rejection_reason, resolution_type, created_at, updated_at
    FROM bank_deposit_requests
    WHERE tenant_id = ? AND id = ?
    LIMIT 1
  `).bind(tenantId, id).first<BankDepositRequestRow>();
}

async function loadActiveCounterSession(db: D1Database, tenantId: string, sessionId: number): Promise<{ id: number; counter_id: number; employee_id: number } | null> {
  return db.prepare(`
    SELECT id, counter_id, employee_id
    FROM billing_counter_sessions
    WHERE tenant_id = ? AND id = ? AND status = 'active'
    LIMIT 1
  `).bind(tenantId, sessionId).first<{ id: number; counter_id: number; employee_id: number }>();
}

bankBook.get('/', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];

  const deposits = await db
    .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM bank_transactions WHERE tenant_id = ? AND type = ? AND date = ?`)
    .bind(tenantId, 'deposit', date)
    .first();

  const settlements = await db
    .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM bank_transactions WHERE tenant_id = ? AND type = ? AND date = ?`)
    .bind(tenantId, 'card_settlement', date)
    .first();

  const payments = await db
    .prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM bank_transactions WHERE tenant_id = ? AND type = ? AND date = ?`)
    .bind(tenantId, 'supplier_payment', date)
    .first();

  const totalDeposits = aggValue(deposits);
  const totalSettlements = aggValue(settlements);
  const totalPayments = aggValue(payments);

  return c.json({
    data: {
      date,
      totalDeposits,
      totalSettlements,
      totalPayments,
      netBankMovement: totalDeposits - totalPayments,
    },
  });
});

bankBook.get('/deposit-requests', async (c) => {
  const tenantId = requireTenantId(c);
  const status = c.req.query('status')?.trim();
  const params: Array<string | number> = [tenantId];
  let where = 'WHERE tenant_id = ?';
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT id, request_no, counter_session_id, counter_id, requested_by, requested_amount,
           proposed_bank_name, request_note, status, bank_transaction_id,
           confirmed_bank_name, confirmed_reference_no, confirmed_date,
           deposit_proof_url, deposit_proof_note, deposit_proof_key, deposit_proof_uploaded_at,
           rejection_reason, resolution_type, created_at, updated_at
    FROM bank_deposit_requests
    ${where}
    ORDER BY created_at DESC
    LIMIT 100
  `).bind(...params).all<BankDepositRequestRow>();

  return c.json({ requests: (results ?? []).map(mapBankDepositRequest) });
});


bankBook.get('/deposit-requests/:id/proof', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  const request = await db.$client.prepare(`
    SELECT deposit_proof_key FROM bank_deposit_requests WHERE tenant_id = ? AND id = ?
  `).bind(tenantId, id).first<Record<string, unknown>>();

  if (!request?.deposit_proof_key) {
    throw new HTTPException(404, { message: 'Bank deposit proof not found' });
  }

  const key = String(request.deposit_proof_key);
  if (!key.startsWith(`bank-deposits/${tenantId}/`)) {
    throw new HTTPException(403, { message: 'Forbidden' });
  }

  const obj = await getUploadObjectForResponse(c.env, key);
  if (!obj) throw new HTTPException(404, { message: 'Bank deposit proof file not found in storage' });

  const headers = new Headers();
  headers.set('Content-Type', obj.contentType ?? 'application/octet-stream');
  headers.set('Cache-Control', 'private, max-age=3600');
  return new Response(obj.body, { headers });
});

bankBook.post('/deposit-requests/:id/proof', requireRole(...BANK_DEPOSIT_MUTATION_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  const existing = await db.$client.prepare(`
    SELECT id, request_no, status, deposit_proof_key
    FROM bank_deposit_requests
    WHERE tenant_id = ? AND id = ?
  `).bind(tenantId, id).first<Record<string, unknown>>();

  if (!existing) throw new HTTPException(404, { message: 'Bank deposit request not found' });
  if (!['pending', 'rejected'].includes(String(existing.status ?? 'pending'))) {
    throw new HTTPException(409, { message: 'Proof cannot be replaced after the deposit is finalized' });
  }

  const formData = await c.req.formData();
  const file = formData.get('proof');
  if (!file || typeof file === 'string') throw new HTTPException(400, { message: 'No proof file provided' });

  const proofFile = file as unknown as File;
  if (!ALLOWED_DEPOSIT_PROOF_TYPES.includes(proofFile.type)) {
    throw new HTTPException(400, { message: 'Invalid file type. Allowed: JPG, PNG, WebP, PDF' });
  }
  if (proofFile.size > MAX_DEPOSIT_PROOF_BYTES) {
    throw new HTTPException(400, { message: 'File too large. Maximum 5MB.' });
  }

  const ext = proofFile.type === 'image/png' ? 'png'
    : proofFile.type === 'image/jpeg' ? 'jpg'
      : proofFile.type === 'image/webp' ? 'webp'
        : 'pdf';
  const key = `bank-deposits/${tenantId}/${id}/${crypto.randomUUID()}.${ext}`;
  const proofUrl = `/api/bank-book/deposit-requests/${id}/proof`;
  const uploadedAt = new Date().toISOString();
  const oldKey = existing.deposit_proof_key ? String(existing.deposit_proof_key) : null;

  await c.env.UPLOADS.put(key, proofFile.stream(), {
    httpMetadata: { contentType: proofFile.type },
    customMetadata: { tenantId, uploadedBy: String(userId), depositRequestId: id },
  });

  await db.$client.prepare(`
    UPDATE bank_deposit_requests
    SET deposit_proof_key = ?,
        deposit_proof_url = ?,
        deposit_proof_uploaded_by = ?,
        deposit_proof_uploaded_at = ?,
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND id = ?
  `).bind(key, proofUrl, userId, uploadedAt, tenantId, id).run();

  if (oldKey && oldKey.startsWith(`bank-deposits/${tenantId}/`)) {
    await c.env.UPLOADS.delete(oldKey).catch(() => {});
  }

  await createAuditLog(c.env, tenantId, String(userId), 'UPLOAD_RECEIPT', 'bank_deposit_requests', Number(id), {
    deposit_proof_key: oldKey,
  }, {
    deposit_proof_key: key,
    deposit_proof_url: proofUrl,
    deposit_proof_uploaded_by: userId,
    deposit_proof_uploaded_at: uploadedAt,
  });

  return c.json({ success: true, message: 'Bank deposit proof uploaded', depositProofUrl: proofUrl, depositProofKey: key });
});

bankBook.post('/deposit-requests/:id/confirm', requireRole(...BANK_DEPOSIT_MUTATION_ROLES), zValidator('json', bankDepositConfirmSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const requestId = Number(c.req.param('id'));
  if (!Number.isInteger(requestId) || requestId <= 0) throw new HTTPException(400, { message: 'Invalid bank deposit request' });
  const data = c.req.valid('json');

  const request = await loadBankDepositRequest(c.env.DB, tenantId, requestId);
  if (!request) throw new HTTPException(404, { message: 'Bank deposit request not found' });
  if (!['pending', 'rejected'].includes(request.status)) {
    throw new HTTPException(409, { message: `Bank deposit request is already ${request.status}` });
  }
  const requestedAmount = Number(request.requested_amount ?? 0);
  if (data.confirmedAmount !== requestedAmount) {
    throw new HTTPException(400, { message: 'Confirmed amount must exactly match the custody amount. Reject and reconcile mismatches.' });
  }

  const sourceEventKey = createPostingEventKey('bank_deposit_request', request.request_no, ACCOUNTING_EVENT_TYPES.bankDepositConfirmed);
  const batch = await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO bank_transactions
        (tenant_id, type, amount, bank_name, reference_no, description, date, bank_deposit_request_id, created_by)
      VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      data.confirmedAmount,
      data.bankName,
      data.referenceNo,
      `Bank deposit request ${request.request_no}`,
      data.depositDate,
      requestId,
      userId,
    ),
    c.env.DB.prepare(`
      UPDATE bank_deposit_requests
      SET status = ?,
          bank_transaction_id = ?,
          confirmed_bank_name = ?,
          confirmed_reference_no = ?,
          confirmed_date = ?,
          deposit_proof_url = ?,
          deposit_proof_note = ?,
          confirmed_by = ?,
          confirmed_at = datetime('now', '+6 hours'),
          resolution_type = 'deposited',
          resolution_note = ?,
          resolved_by = ?,
          resolved_at = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND id = ? AND status IN ('pending', 'rejected')
    `).bind(
      'approved',
      0,
      data.bankName,
      data.referenceNo,
      data.depositDate,
      data.proofUrl || null,
      data.proofNote || null,
      userId,
      `Deposited to ${data.bankName} with reference ${data.referenceNo}${data.proofUrl ? ' (proof attached)' : ''}`,
      userId,
      tenantId,
      requestId,
    ),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      VALUES (?, ?, 'bank_deposit_request', ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      sourceEventKey,
      request.request_no,
      ACCOUNTING_EVENT_TYPES.bankDepositConfirmed,
      data.depositDate || getTodayGMT6(),
      JSON.stringify({ amount: data.confirmedAmount, requestNo: request.request_no, bankName: data.bankName, referenceNo: data.referenceNo, proofUrl: data.proofUrl || null }),
      String(userId),
    ),
  ]);

  const bankTransactionId = Number(batch[0]?.meta?.last_row_id ?? 0) || 0;
  if (bankTransactionId > 0) {
    await c.env.DB.prepare(`
      UPDATE bank_deposit_requests
      SET bank_transaction_id = ?
      WHERE tenant_id = ? AND id = ?
    `).bind(bankTransactionId, tenantId, requestId).run();
  }

  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'bank_deposit_requests', requestId, {
    status: request.status,
  }, {
    status: 'approved',
    bankTransactionId,
    bankName: data.bankName,
    referenceNo: data.referenceNo,
    amount: data.confirmedAmount,
    proofUrl: data.proofUrl || null,
  });
  queueAccountingPosting(c, tenantId);

  return c.json({ message: 'Bank deposit confirmed', requestId, bankTransactionId, status: 'approved' });
});

bankBook.post('/deposit-requests/:id/reject', requireRole(...BANK_DEPOSIT_MUTATION_ROLES), zValidator('json', bankDepositRejectSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const requestId = Number(c.req.param('id'));
  if (!Number.isInteger(requestId) || requestId <= 0) throw new HTTPException(400, { message: 'Invalid bank deposit request' });
  const { reason } = c.req.valid('json');

  const request = await loadBankDepositRequest(c.env.DB, tenantId, requestId);
  if (!request) throw new HTTPException(404, { message: 'Bank deposit request not found' });
  if (request.status !== 'pending') {
    throw new HTTPException(409, { message: `Only pending bank deposit requests can be rejected. Current status: ${request.status}` });
  }

  await c.env.DB.prepare(`
    UPDATE bank_deposit_requests
    SET status = ?,
        rejection_reason = ?,
        rejected_by = ?,
        rejected_at = datetime('now', '+6 hours'),
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND id = ? AND status = 'pending'
  `).bind('rejected', reason, userId, tenantId, requestId).run();

  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'bank_deposit_requests', requestId, {
    status: request.status,
  }, {
    status: 'rejected',
    reason,
  });

  return c.json({ message: 'Bank deposit request rejected', requestId, status: 'rejected' });
});

bankBook.post('/deposit-requests/:id/return-to-counter', requireRole(...BANK_DEPOSIT_MUTATION_ROLES), zValidator('json', bankDepositReturnSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const requestId = Number(c.req.param('id'));
  if (!Number.isInteger(requestId) || requestId <= 0) throw new HTTPException(400, { message: 'Invalid bank deposit request' });
  const data = c.req.valid('json');

  const request = await loadBankDepositRequest(c.env.DB, tenantId, requestId);
  if (!request) throw new HTTPException(404, { message: 'Bank deposit request not found' });
  if (request.status !== 'rejected') {
    throw new HTTPException(409, { message: `Only rejected bank deposit requests can be returned to a counter. Current status: ${request.status}` });
  }

  const targetSession = await loadActiveCounterSession(c.env.DB, tenantId, data.targetCounterSessionId);
  if (!targetSession) throw new HTTPException(404, { message: 'Active target counter session not found' });

  const mappings = await resolveAccountMappings(c.env.DB, tenantId, ['admin_cash', 'cash']);
  const amount = Number(request.requested_amount ?? 0);
  const lines = [
    { accountId: Number(mappings.cash), debit: amount, credit: 0, memo: `Return bank deposit custody ${request.request_no} to counter` },
    { accountId: Number(mappings.admin_cash), debit: 0, credit: amount, memo: `Clear finance custody for ${request.request_no}` },
  ];
  const sourceEventKey = createPostingEventKey('bank_deposit_request_return', request.request_no, ACCOUNTING_EVENT_TYPES.manualJournal);

  await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO cash_drawer_movements
        (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method,
         reference_type, reference_id, description, created_by)
      VALUES (?, ?, ?, ?, 'cash_in', ?, 'cash', 'bank_deposit_request_return', ?, ?, ?)
    `).bind(tenantId, targetSession.id, targetSession.counter_id, targetSession.employee_id, amount, request.request_no, data.note, userId),
    c.env.DB.prepare(`
      UPDATE bank_deposit_requests
      SET status = ?,
          resolution_type = ?,
          resolution_note = ?,
          resolved_by = ?,
          resolved_at = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND id = ? AND status = 'rejected'
    `).bind('resolved', 'returned_to_counter', data.note, userId, tenantId, requestId),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      VALUES (?, ?, 'bank_deposit_request_return', ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      sourceEventKey,
      request.request_no,
      ACCOUNTING_EVENT_TYPES.manualJournal,
      getTodayGMT6(),
      JSON.stringify({ lines }),
      String(userId),
    ),
  ]);

  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'bank_deposit_requests', requestId, {
    status: request.status,
  }, {
    status: 'resolved',
    resolutionType: 'returned_to_counter',
    targetCounterSessionId: data.targetCounterSessionId,
  });
  queueAccountingPosting(c, tenantId);

  return c.json({ message: 'Bank deposit custody returned to counter', requestId, status: 'resolved' });
});

bankBook.post('/deposit-requests/:id/manual-adjustment', requireRole(...BANK_DEPOSIT_MUTATION_ROLES), zValidator('json', bankDepositManualAdjustmentSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const requestId = Number(c.req.param('id'));
  if (!Number.isInteger(requestId) || requestId <= 0) throw new HTTPException(400, { message: 'Invalid bank deposit request' });
  const data = c.req.valid('json');
  assertBalancedManualLines(data.lines);

  const request = await loadBankDepositRequest(c.env.DB, tenantId, requestId);
  if (!request) throw new HTTPException(404, { message: 'Bank deposit request not found' });
  if (request.status !== 'rejected') {
    throw new HTTPException(409, { message: `Only rejected bank deposit requests can be manually adjusted. Current status: ${request.status}` });
  }

  const sourceEventKey = createPostingEventKey('bank_deposit_request_adjustment', request.request_no, ACCOUNTING_EVENT_TYPES.manualJournal);
  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE bank_deposit_requests
      SET status = ?,
          resolution_type = ?,
          resolution_note = ?,
          resolved_by = ?,
          resolved_at = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND id = ? AND status = 'rejected'
    `).bind('resolved', 'manual_adjustment', data.note, userId, tenantId, requestId),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      VALUES (?, ?, 'bank_deposit_request_adjustment', ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      sourceEventKey,
      request.request_no,
      ACCOUNTING_EVENT_TYPES.manualJournal,
      getTodayGMT6(),
      JSON.stringify({ lines: data.lines }),
      String(userId),
    ),
  ]);

  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'bank_deposit_requests', requestId, {
    status: request.status,
  }, {
    status: 'resolved',
    resolutionType: 'manual_adjustment',
  });
  queueAccountingPosting(c, tenantId);

  return c.json({ message: 'Bank deposit custody manually adjusted', requestId, status: 'resolved' });
});

bankBook.get('/transactions', async (c) => {
  const tenantId = requireTenantId(c);
  const db = c.env.DB;
  const date = c.req.query('date') || new Date().toISOString().split('T')[0];

  const { results } = await db
    .prepare(`SELECT * FROM bank_transactions WHERE tenant_id = ? AND date = ? ORDER BY created_at LIMIT 500`)
    .bind(tenantId, date)
    .all();

  return c.json({ data: results });
});

export default bankBook;
