import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import {
  ACCOUNTING_EVENT_TYPES,
  recordAndPostAccountingEvent,
} from '../../lib/accounting-posting';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';

type MktEnv = { Bindings: Env; Variables: Variables };

// ─── Schemas ────────────────────────────────────────────────────────────────

const createSchemeSchema = z.object({
  SchemeName: z.string().min(1).max(200),
  CommissionPercent: z.number().min(0).max(100),
  Description: z.string().max(1000).optional(),
});

const createOrgSchema = z.object({
  OrganizationName: z.string().min(1).max(300),
  ContactPerson: z.string().max(200).optional(),
  Phone: z.string().max(20).optional(),
  Email: z.string().email().optional(),
  Address: z.string().max(500).optional(),
});

const createGroupSchema = z.object({
  GroupName: z.string().min(1).max(200),
  Description: z.string().max(1000).optional(),
});

const createPartySchema = z.object({
  PartyName: z.string().min(1).max(200),
  GroupId: z.number().int().positive().optional(),
  OrganizationId: z.number().int().positive().optional(),
  ContactNo: z.string().max(20).optional(),
  Email: z.string().email().optional(),
  Address: z.string().max(500).optional(),
  DefaultCommissionPercent: z.number().min(0).max(100).default(0),
});

const createCommissionSchema = z.object({
  BillingTransactionId: z.number().int().positive(),
  PartyId: z.number().int().positive().optional(),
  OrganizationId: z.number().int().positive().optional(),
  SchemeId: z.number().int().positive().optional(),
  CommissionAmount: z.number().positive(),
  Percentage: z.number().min(0).max(100).optional(),
  BillAmount: z.number().min(0).optional(),
});

const payCommissionSchema = z.object({
  PaidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  PaymentMode: z.enum(['cash', 'bank', 'cheque', 'card', 'mobile_banking', 'other']).default('cash'),
  PaymentReferenceNo: z.string().max(100).optional(),
});

// ─── Router ─────────────────────────────────────────────────────────────────

const marketingReferralRoutes = new Hono<MktEnv>();
const MARKETING_REFERRAL_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

marketingReferralRoutes.use('*', requireRole(...MARKETING_REFERRAL_ROLES));

// ═══════════════════════════════════════════════════════════════════
// Referral Schemes
// ═══════════════════════════════════════════════════════════════════

marketingReferralRoutes.get('/schemes', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(
    'SELECT * FROM ReferralScheme WHERE tenant_id = ? AND IsActive = 1 ORDER BY SchemeName'
  ).bind(tenantId).all();

  return c.json({ Results: results });
});

marketingReferralRoutes.post('/schemes', zValidator('json', createSchemeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO ReferralScheme (tenant_id, SchemeName, CommissionPercent, Description, CreatedBy)
    VALUES (?, ?, ?, ?, ?)
  `).bind(tenantId, data.SchemeName, data.CommissionPercent, data.Description ?? null, userId).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// Referring Organizations
// ═══════════════════════════════════════════════════════════════════

marketingReferralRoutes.get('/organizations', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(
    'SELECT * FROM ReferringOrganization WHERE tenant_id = ? AND IsActive = 1 ORDER BY OrganizationName'
  ).bind(tenantId).all();

  return c.json({ Results: results });
});

marketingReferralRoutes.post('/organizations', zValidator('json', createOrgSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO ReferringOrganization (tenant_id, OrganizationName, ContactPerson, Phone, Email, Address, CreatedBy)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.OrganizationName, data.ContactPerson ?? null,
    data.Phone ?? null, data.Email ?? null, data.Address ?? null, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

marketingReferralRoutes.put('/organizations/:id', zValidator('json', createOrgSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT OrganizationId FROM ReferringOrganization WHERE tenant_id = ? AND OrganizationId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Organization not found' });

  const fields: Record<string, string> = {
    OrganizationName: 'OrganizationName', ContactPerson: 'ContactPerson',
    Phone: 'Phone', Email: 'Email', Address: 'Address',
  };

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, col] of Object.entries(fields)) {
    if ((data as Record<string, unknown>)[key] !== undefined) {
      updates.push(`${col} = ?`);
      params.push((data as Record<string, unknown>)[key] as string | null);
    }
  }

  if (updates.length === 0) return c.json({ Results: { success: true } });

  updates.push("ModifiedOn = datetime('now', '+6 hours')", 'ModifiedBy = ?');
  params.push(userId, tenantId, id);

  await db.$client.prepare(
    `UPDATE ReferringOrganization SET ${updates.join(', ')} WHERE tenant_id = ? AND OrganizationId = ?`
  ).bind(...params).run();

  return c.json({ Results: { success: true } });
});

marketingReferralRoutes.put('/organizations/:id/toggle', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const org = await db.$client.prepare(
    'SELECT OrganizationId, IsActive FROM ReferringOrganization WHERE tenant_id = ? AND OrganizationId = ?'
  ).bind(tenantId, id).first<{ OrganizationId: number; IsActive: number }>();
  if (!org) throw new HTTPException(404, { message: 'Organization not found' });

  await db.$client.prepare(
    "UPDATE ReferringOrganization SET IsActive = ?, ModifiedBy = ?, ModifiedOn = datetime('now', '+6 hours') WHERE tenant_id = ? AND OrganizationId = ?"
  ).bind(org.IsActive ? 0 : 1, userId, tenantId, id).run();

  return c.json({ Results: { success: true, isActive: !org.IsActive } });
});

// ═══════════════════════════════════════════════════════════════════
// Referring Party Groups
// ═══════════════════════════════════════════════════════════════════

marketingReferralRoutes.get('/groups', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  const { results } = await db.$client.prepare(
    'SELECT * FROM ReferringPartyGroup WHERE tenant_id = ? ORDER BY GroupName'
  ).bind(tenantId).all();

  return c.json({ Results: results });
});

marketingReferralRoutes.post('/groups', zValidator('json', createGroupSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(
    'INSERT INTO ReferringPartyGroup (tenant_id, GroupName, Description) VALUES (?, ?, ?)'
  ).bind(tenantId, data.GroupName, data.Description ?? null).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// Referring Parties
// ═══════════════════════════════════════════════════════════════════

marketingReferralRoutes.get('/parties', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { organizationId, groupId } = c.req.query();

  let query = `
    SELECT p.*, g.GroupName, o.OrganizationName
    FROM ReferringParty p
    LEFT JOIN ReferringPartyGroup g ON p.GroupId = g.GroupId AND g.tenant_id = p.tenant_id
    LEFT JOIN ReferringOrganization o ON p.OrganizationId = o.OrganizationId AND o.tenant_id = p.tenant_id
    WHERE p.tenant_id = ? AND p.IsActive = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (organizationId) { query += ' AND p.OrganizationId = ?'; params.push(Number(organizationId)); }
  if (groupId) { query += ' AND p.GroupId = ?'; params.push(Number(groupId)); }
  query += ' ORDER BY p.PartyName';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

marketingReferralRoutes.post('/parties', zValidator('json', createPartySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const result = await db.$client.prepare(`
    INSERT INTO ReferringParty (
      tenant_id, PartyName, GroupId, OrganizationId,
      ContactNo, Email, Address, DefaultCommissionPercent, CreatedBy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    tenantId, data.PartyName, data.GroupId ?? null, data.OrganizationId ?? null,
    data.ContactNo ?? null, data.Email ?? null, data.Address ?? null,
    data.DefaultCommissionPercent, userId,
  ).run();

  return c.json({ Results: { id: result.meta.last_row_id } }, 201);
});

marketingReferralRoutes.put('/parties/:id', zValidator('json', createPartySchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.$client.prepare(
    'SELECT PartyId FROM ReferringParty WHERE tenant_id = ? AND PartyId = ? AND IsActive = 1'
  ).bind(tenantId, id).first();
  if (!existing) throw new HTTPException(404, { message: 'Party not found' });

  const fields: Record<string, string> = {
    PartyName: 'PartyName', GroupId: 'GroupId', OrganizationId: 'OrganizationId',
    ContactNo: 'ContactNo', Email: 'Email', Address: 'Address',
    DefaultCommissionPercent: 'DefaultCommissionPercent',
  };

  const updates: string[] = [];
  const params: (string | number | null)[] = [];

  for (const [key, col] of Object.entries(fields)) {
    if ((data as Record<string, unknown>)[key] !== undefined) {
      updates.push(`${col} = ?`);
      params.push((data as Record<string, unknown>)[key] as string | number | null);
    }
  }

  if (updates.length === 0) return c.json({ Results: { success: true } });

  updates.push("ModifiedOn = datetime('now', '+6 hours')", 'ModifiedBy = ?');
  params.push(userId, tenantId, id);

  await db.$client.prepare(
    `UPDATE ReferringParty SET ${updates.join(', ')} WHERE tenant_id = ? AND PartyId = ?`
  ).bind(...params).run();

  return c.json({ Results: { success: true } });
});

marketingReferralRoutes.put('/parties/:id/toggle', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));

  const party = await db.$client.prepare(
    'SELECT PartyId, IsActive FROM ReferringParty WHERE tenant_id = ? AND PartyId = ?'
  ).bind(tenantId, id).first<{ PartyId: number; IsActive: number }>();
  if (!party) throw new HTTPException(404, { message: 'Party not found' });

  await db.$client.prepare(
    "UPDATE ReferringParty SET IsActive = ?, ModifiedBy = ?, ModifiedOn = datetime('now', '+6 hours') WHERE tenant_id = ? AND PartyId = ?"
  ).bind(party.IsActive ? 0 : 1, userId, tenantId, id).run();

  return c.json({ Results: { success: true, isActive: !party.IsActive } });
});

// ═══════════════════════════════════════════════════════════════════
// Referral Commissions
// ═══════════════════════════════════════════════════════════════════

marketingReferralRoutes.get('/commissions', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { fromDate, toDate, partyId, billingTransactionId, status } = c.req.query();

  let query = `
    SELECT rc.*, rp.PartyName, ro.OrganizationName, rs.SchemeName
    FROM ReferralCommission rc
    LEFT JOIN ReferringParty rp ON rc.PartyId = rp.PartyId AND rp.tenant_id = rc.tenant_id
    LEFT JOIN ReferringOrganization ro ON rc.OrganizationId = ro.OrganizationId AND ro.tenant_id = rc.tenant_id
    LEFT JOIN ReferralScheme rs ON rc.SchemeId = rs.SchemeId AND rs.tenant_id = rc.tenant_id
    WHERE rc.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (billingTransactionId) { query += ' AND rc.BillingTransactionId = ?'; params.push(Number(billingTransactionId)); }
  if (partyId) { query += ' AND rc.PartyId = ?'; params.push(Number(partyId)); }
  if (status) { query += ' AND COALESCE(rc.Status, ?) = ?'; params.push('accrued', status); }
  if (fromDate) { query += ' AND date(rc.CreatedOn) >= date(?)'; params.push(fromDate); }
  if (toDate) { query += ' AND date(rc.CreatedOn) <= date(?)'; params.push(toDate); }
  query += ' ORDER BY rc.CreatedOn DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

marketingReferralRoutes.post('/commissions', zValidator('json', createCommissionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const eventDate = getTodayGMT6();
  const amount = Number(data.CommissionAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HTTPException(400, { message: 'Referral commission amount must be positive' });
  }

  await assertAccountingPeriodOpen(c.env.DB, tenantId, eventDate, 'Referral commission creation');

  const result = await db.$client.prepare(`
    INSERT INTO ReferralCommission (
      tenant_id, BillingTransactionId, PartyId, OrganizationId,
      SchemeId, CommissionAmount, Percentage, BillAmount, Status, CreatedBy
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'accrued', ?)
  `).bind(
    tenantId, data.BillingTransactionId,
    data.PartyId ?? null, data.OrganizationId ?? null,
    data.SchemeId ?? null, data.CommissionAmount,
    data.Percentage ?? null, data.BillAmount ?? null, userId,
  ).run();

  const commissionId = Number(result.meta.last_row_id);
  const postResult = await recordAndPostAccountingEvent(c.env.DB, {
    tenantId,
    sourceType: 'referral_commission',
    sourceId: commissionId,
    eventType: ACCOUNTING_EVENT_TYPES.agentCommissionAccrued,
    eventDate,
    createdBy: userId,
    payload: {
      commissionId,
      billingTransactionId: data.BillingTransactionId,
      partyId: data.PartyId ?? null,
      organizationId: data.OrganizationId ?? null,
      schemeId: data.SchemeId ?? null,
      amount,
      billAmount: data.BillAmount ?? null,
      percentage: data.Percentage ?? null,
    },
  });

  await createAuditLog(
    c.env,
    tenantId,
    userId,
    'CREATE',
    'ReferralCommission',
    commissionId,
    null,
    { commissionId, amount, voucherId: postResult.voucherId ?? null },
    c.req.header('CF-Connecting-IP'),
    c.req.header('User-Agent'),
  );

  return c.json({ Results: { id: commissionId, voucherId: postResult.voucherId ?? null } }, 201);
});

marketingReferralRoutes.delete('/commissions/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const reason = c.req.query('reason') || 'Cancelled from referral commission screen';
  const eventDate = getTodayGMT6();

  const existing = await db.$client.prepare(
    `SELECT CommissionId, CommissionAmount, Status
     FROM ReferralCommission
     WHERE tenant_id = ? AND CommissionId = ?`
  ).bind(tenantId, id).first<{ CommissionId: number; CommissionAmount: number; Status?: string | null }>();
  if (!existing) throw new HTTPException(404, { message: 'Commission not found' });
  const status = String(existing.Status ?? 'accrued').toLowerCase();
  if (status === 'paid') {
    throw new HTTPException(409, { message: 'Paid referral commission must be reversed through payment reversal' });
  }
  if (status === 'cancelled') {
    throw new HTTPException(409, { message: 'Referral commission is already cancelled' });
  }
  const amount = Number(existing.CommissionAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HTTPException(400, { message: 'Referral commission amount must be positive' });
  }

  await assertAccountingPeriodOpen(c.env.DB, tenantId, eventDate, 'Referral commission cancellation');

  const updateResult = await db.$client.prepare(`
    UPDATE ReferralCommission
    SET Status = 'cancelled',
        CancelledBy = ?,
        CancelledOn = datetime('now', '+6 hours'),
        CancellationReason = ?,
        ModifiedOn = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND CommissionId = ? AND COALESCE(Status, 'accrued') = 'accrued'
  `).bind(userId, reason, tenantId, id).run();
  if (Number(updateResult.meta.changes ?? 0) !== 1) {
    throw new HTTPException(409, { message: 'Referral commission is already paid or cancelled' });
  }

  const postResult = await recordAndPostAccountingEvent(c.env.DB, {
    tenantId,
    sourceType: 'referral_commission',
    sourceId: id,
    eventType: ACCOUNTING_EVENT_TYPES.agentCommissionCancelled,
    eventDate,
    createdBy: userId,
    payload: {
      commissionId: id,
      amount,
      reason,
    },
  });

  await createAuditLog(
    c.env,
    tenantId,
    userId,
    'CANCEL',
    'ReferralCommission',
    id,
    existing,
    { reason, voucherId: postResult.voucherId ?? null },
    c.req.header('CF-Connecting-IP'),
    c.req.header('User-Agent'),
  );

  return c.json({ Results: { success: true, voucherId: postResult.voucherId ?? null } });
});

marketingReferralRoutes.post('/commissions/:id/pay', zValidator('json', payCommissionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  const data = c.req.valid('json');
  const paidDate = data.PaidDate ?? getTodayGMT6();

  const existing = await db.$client.prepare(
    `SELECT CommissionId, CommissionAmount, Status
     FROM ReferralCommission
     WHERE tenant_id = ? AND CommissionId = ?`
  ).bind(tenantId, id).first<{ CommissionId: number; CommissionAmount: number; Status?: string | null }>();
  if (!existing) throw new HTTPException(404, { message: 'Commission not found' });
  if (String(existing.Status ?? 'accrued').toLowerCase() !== 'accrued') {
    throw new HTTPException(409, { message: 'Referral commission is already paid or cancelled' });
  }
  const amount = Number(existing.CommissionAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new HTTPException(400, { message: 'Referral commission amount must be positive' });
  }

  await assertAccountingPeriodOpen(c.env.DB, tenantId, paidDate, 'Referral commission payment');

  const updateResult = await db.$client.prepare(`
    UPDATE ReferralCommission
    SET Status = 'paid',
        PaidDate = ?,
        PaidBy = ?,
        PaymentMode = ?,
        PaymentReferenceNo = ?,
        ModifiedOn = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND CommissionId = ? AND COALESCE(Status, 'accrued') = 'accrued'
  `).bind(paidDate, userId, data.PaymentMode, data.PaymentReferenceNo ?? null, tenantId, id).run();
  if (Number(updateResult.meta.changes ?? 0) !== 1) {
    throw new HTTPException(409, { message: 'Referral commission is already paid or cancelled' });
  }

  const postResult = await recordAndPostAccountingEvent(c.env.DB, {
    tenantId,
    sourceType: 'referral_commission',
    sourceId: id,
    eventType: ACCOUNTING_EVENT_TYPES.agentCommissionSettled,
    eventDate: paidDate,
    createdBy: userId,
    payload: {
      commissionId: id,
      amount,
      paymentMethod: data.PaymentMode,
      referenceNo: data.PaymentReferenceNo ?? null,
    },
  });

  await createAuditLog(
    c.env,
    tenantId,
    userId,
    'PAYMENT',
    'ReferralCommission',
    id,
    existing,
    { paidDate, paymentMode: data.PaymentMode, voucherId: postResult.voucherId ?? null },
    c.req.header('CF-Connecting-IP'),
    c.req.header('User-Agent'),
  );

  return c.json({ Results: { success: true, paidDate, voucherId: postResult.voucherId ?? null } });
});

// ═══════════════════════════════════════════════════════════════════
// Reports
// ═══════════════════════════════════════════════════════════════════

marketingReferralRoutes.get('/report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { fromDate, toDate, partyId } = c.req.query();

  if (!fromDate || !toDate) {
    throw new HTTPException(400, { message: 'fromDate and toDate required' });
  }

  let query = `
    SELECT
      rp.PartyId, rp.PartyName, ro.OrganizationName,
      COUNT(rc.CommissionId) as TotalTransactions,
      SUM(rc.BillAmount) as TotalBillAmount,
      SUM(rc.CommissionAmount) as TotalCommission,
      AVG(rc.Percentage) as AvgCommissionPercent
    FROM ReferralCommission rc
    LEFT JOIN ReferringParty rp ON rc.PartyId = rp.PartyId AND rp.tenant_id = rc.tenant_id
    LEFT JOIN ReferringOrganization ro ON rc.OrganizationId = ro.OrganizationId AND ro.tenant_id = rc.tenant_id
    WHERE rc.tenant_id = ?
      AND COALESCE(rc.Status, 'accrued') <> 'cancelled'
      AND date(rc.CreatedOn) BETWEEN date(?) AND date(?)
  `;
  const params: (string | number)[] = [tenantId, fromDate, toDate];

  if (partyId) { query += ' AND rc.PartyId = ?'; params.push(Number(partyId)); }
  query += ' GROUP BY rp.PartyId, rp.PartyName, ro.OrganizationName ORDER BY TotalCommission DESC';

  const { results } = await db.$client.prepare(query).bind(...params).all();
  return c.json({ Results: results });
});

export default marketingReferralRoutes;
