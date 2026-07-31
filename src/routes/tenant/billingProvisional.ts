import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getNextSequence } from '../../lib/sequence';
import { getNextBillInvoiceNumber } from '../../lib/invoice-sequence';
import { z } from 'zod';
import { getDb } from '../../db';
import { calculateBillCategoryTotals } from '../../lib/billing-category-totals';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import { recordBillFinalizationSideEffects } from '../../lib/billing-finalization';
import { getPatientDepositBalance } from '../../lib/patient-deposits';
import { postPendingAccountingEvents } from '../../lib/accounting-posting';
import { assertDiscountReferralNameForHighDiscount } from '../../lib/discount-policy';
import {
  evaluateBillingSchemeEligibility,
  recordBillingSchemeUsage,
} from '../../lib/billing-scheme-eligibility';
import { createDoctorPayableAccrualsForProvisionalItems } from '../../lib/provisional-doctor-payables';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../lib/canonical/strict-financial-boundaries';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { issueInvoiceWithSettlement } from '../../lib/canonical/commands/issue-invoice-settlement';
import { buildProvisionalSettlementProjection } from '../../lib/canonical/live-provisional-billing';
import { prepareProvisionalBillingLegacyStatements } from '../../lib/canonical/provisional-billing-finalization';
import { isFinancialBatchAssertionError } from '../../lib/canonical/financial-batch-assertion';


/**
 * Provisional billing routes — operates on the existing `billing_provisional_items` table
 * which has columns: id, tenant_id, patient_id, admission_id, visit_id, item_category,
 * item_name, department, unit_price, quantity, discount_percent, discount_amount,
 * total_amount, doctor_id, doctor_name, reference_id, bill_status, is_insurance,
 * cancelled_by, cancelled_at, cancel_reason, billed_bill_id, is_active, created_by, created_at
 */

const billingProvisional = new Hono<{ Bindings: Env; Variables: Variables }>();

type ProvisionalServiceItem = {
  id: number;
  item_name: string;
  item_code?: string | null;
  price: number;
  service_department_id?: number | null;
  department_name?: string | null;
  allow_discount?: number | null;
  allow_multiple_qty?: number | null;
};

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post provisional billing accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function isProvisionalCanonicalConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current ?? '');
    if (
      /deposit balance is insufficient/i.test(message)
      || /settlement amount exceeds/i.test(message)
      || /canonical.*reconcil/i.test(message)
      || /external transaction authority/i.test(message)
      || /canonical deposit .*changed/i.test(message)
      || /canonical idempotency/i.test(message)
    ) {
      return true;
    }
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function inferProvisionalItemCategory(item: ProvisionalServiceItem): string {
  const haystack = `${item.department_name ?? ''} ${item.item_name ?? ''}`.toLowerCase();
  if (/(lab|test|pathology|radiology|x-?ray|ultra|usg|ct|mri|cbc|blood|urine)/.test(haystack)) return 'test';
  if (/(doctor|consult|opd|visit|follow)/.test(haystack)) return 'doctor_visit';
  if (/(pharmacy|medicine|drug)/.test(haystack)) return 'medicine';
  if (/(operation|surgery|ot|procedure)/.test(haystack)) return 'operation';
  if (/(admission|bed|ward|cabin|room|ipd)/.test(haystack)) return 'admission';
  return 'service';
}

function roundMoney(amount: number): number {
  return Math.round(amount * 100) / 100;
}

async function loadProvisionalServiceItems(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  ids: number[],
): Promise<Map<number, ProvisionalServiceItem>> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) return new Map();
  const placeholders = uniqueIds.map(() => '?').join(',');
  const { results } = await db.$client.prepare(`
    SELECT
      si.id,
      si.item_name,
      si.item_code,
      si.price,
      si.service_department_id,
      sd.department_name,
      si.allow_discount,
      si.allow_multiple_qty
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
     AND sd.tenant_id = si.tenant_id
    WHERE si.tenant_id = ?
      AND si.id IN (${placeholders})
      AND (si.is_active IS NULL OR si.is_active = 1)
      AND (si.service_department_id IS NULL OR (sd.id IS NOT NULL AND COALESCE(sd.is_active, 1) = 1))
  `).bind(tenantId, ...uniqueIds).all<ProvisionalServiceItem>();
  return new Map(results.map((item) => [Number(item.id), item]));
}

// ─── Schemas (inline to match existing table) ────────────────────────────────

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

const listProvisionalSchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  patientId: z.coerce.number().int().positive().optional(),
  visit_id: z.coerce.number().int().positive().optional(),
  bill_status: z.enum(['provisional', 'finalized', 'cancelled', 'billed']).optional(),
  status: z.enum(['provisional', 'finalized', 'cancelled', 'billed']).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  per_page: z.coerce.number().int().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const createProvisionalItemSchema = z.object({
  is_manual: z.boolean().optional().default(false),
  manual: z.boolean().optional(),
  source: z.string().optional(),
  service_item_id: z.number().int().positive().optional(),
  reference_id: z.number().int().positive().optional(),
  item_name: z.string().trim().min(1).optional(),
  service_name: z.string().trim().min(1).optional(),
  item_category: z.string().trim().optional(),
  department: z.string().trim().optional(),
  unit_price: z.number().min(0).optional(),
  quantity: z.number().int().min(1).default(1),
  discount_percent: z.number().min(0).max(100).default(0),
  discount_amount: z.number().min(0).optional(),
  doctor_id: z.number().int().positive().optional(),
  doctor_name: z.string().optional(),
  doctor_payable_amount: z.number().min(0).optional(),
  is_insurance: z.boolean().default(false),
}).superRefine((item, ctx) => {
  const manual = item.is_manual || item.manual === true || item.source === 'manual';
  if (!manual) {
    if (!item.service_item_id && !item.reference_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'service_item_id is required so provisional billing uses catalog pricing',
        path: ['service_item_id'],
      });
    }
    return;
  }

  if (!item.item_name || item.item_name.trim().length < 3) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Manual charge description must be at least 3 characters',
      path: ['item_name'],
    });
  }
  if (!item.item_category || item.item_category.trim().length < 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Manual charge category is required',
      path: ['item_category'],
    });
  }
  if (item.unit_price === undefined || item.unit_price <= 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Manual charge unit_price must be greater than 0',
      path: ['unit_price'],
    });
  }
});

const createProvisionalItemsSchema = z.object({
  patient_id: z.number().int().positive(),
  visit_id: z.number().int().positive().optional(),
  admission_id: z.number().int().positive().optional(),
  items: z.array(createProvisionalItemSchema).min(1),
});

function isManualProvisionalItem(item: z.infer<typeof createProvisionalItemSchema>): boolean {
  return item.is_manual || item.manual === true || item.source === 'manual';
}

const cancelProvisionalSchema = z.object({
  cancel_reason: z.string().min(1).max(500),
});

const provisionalSchemeApplicationSchema = z.object({
  schemeId: z.number().int().positive().optional(),
  schemeCode: z.string().trim().min(1).optional(),
  memberCode: z.string().trim().min(1).optional(),
  memberId: z.number().int().positive().optional(),
  serviceCategory: z.string().trim().min(1).optional(),
  allocationType: z.string().trim().min(1).optional(),
  suggestedDiscount: z.number().min(0).optional(),
}).strict().refine((value) => Boolean(value.schemeId || value.schemeCode || value.memberCode || value.memberId), {
  message: 'Scheme or member identifier is required',
});

const payProvisionalSchema = z.object({
  patient_id: z.number().int().positive(),
  provisional_item_ids: z.array(z.number().int().positive()).min(1).optional(),
  discount: z.number().min(0).optional(),
  discount_amount: z.number().min(0).optional(),
  discountByName: z.string().trim().max(200).optional(),
  discount_by_name: z.string().trim().max(200).optional(),
  deposit_deducted: z.number().min(0).optional(),
  paid_amount: z.number().min(0).optional(),
  payment_method: z.string().optional(),
  external_transaction_id: z.string().trim().min(3).max(128).optional(),
  externalTransactionId: z.string().trim().min(3).max(128).optional(),
  remarks: z.string().optional(),
  schemeApplication: provisionalSchemeApplicationSchema.optional(),
});

function normalizeBillStatus(status?: string): 'provisional' | 'finalized' | 'cancelled' | undefined {
  if (!status) return undefined;
  if (status === 'billed') return 'finalized';
  return status as 'provisional' | 'finalized' | 'cancelled';
}

function toFrontendBillStatus(status?: string): string {
  return status === 'finalized' ? 'billed' : status || 'provisional';
}

async function createProvisionalItems(
  db: ReturnType<typeof getDb>,
  tenantId: string | number,
  userId: string | number,
  data: z.infer<typeof createProvisionalItemsSchema>,
) {
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(data.patient_id, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  if (data.admission_id) {
    const admission = await db.$client.prepare(
      `SELECT patient_id, status FROM admissions WHERE id = ? AND tenant_id = ?`
    ).bind(data.admission_id, tenantId).first<{ patient_id: number; status: string }>();
    if (!admission) throw new HTTPException(404, { message: 'Admission not found' });
    if (Number(admission.patient_id) !== Number(data.patient_id)) {
      throw new HTTPException(400, { message: 'patient_id does not match admission_id' });
    }
    if (!['admitted', 'critical', 'transferred'].includes(String(admission.status))) {
      throw new HTTPException(409, { message: 'Cannot add provisional charge to an inactive admission' });
    }
  }

  const serviceIds = data.items
    .filter((item) => !isManualProvisionalItem(item))
    .map((item) => Number(item.service_item_id ?? item.reference_id));
  const catalog = await loadProvisionalServiceItems(db, tenantId, serviceIds);
  const missing = serviceIds.filter((id) => !catalog.has(id));
  if (missing.length > 0) {
    throw new HTTPException(400, { message: `Invalid service item: ${[...new Set(missing)].join(', ')}` });
  }

  const stmts = data.items.map(item => {
    if (isManualProvisionalItem(item)) {
      const unitPrice = roundMoney(Number(item.unit_price ?? 0));
      const subtotal = roundMoney(item.quantity * unitPrice);
      const discountAmount = item.discount_amount ?? roundMoney(subtotal * item.discount_percent / 100);
      const discountPercent = subtotal > 0
        ? roundMoney((discountAmount / subtotal) * 100)
        : item.discount_percent;
      const totalAmount = Math.max(0, roundMoney(subtotal - discountAmount));
      const itemName = item.item_name!.trim();
      const itemCategory = item.item_category!.trim();
      const department = item.department?.trim() || 'Manual';

      return db.$client.prepare(`
        INSERT INTO billing_provisional_items
          (tenant_id, patient_id, admission_id, visit_id, item_category, item_name,
           department, unit_price, quantity, discount_percent, discount_amount, total_amount,
           doctor_id, doctor_name, doctor_payable_amount, reference_id, bill_status, is_insurance, is_active, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisional', ?, 1, ?, datetime('now', '+6 hours'))
      `).bind(
        tenantId, data.patient_id, data.admission_id ?? null, data.visit_id ?? null,
        itemCategory, itemName, department, unitPrice, item.quantity,
        discountPercent, discountAmount, totalAmount,
        item.doctor_id ?? null, item.doctor_name ?? null,
        item.doctor_payable_amount ?? null,
        null,
        item.is_insurance ? 1 : 0, userId
      );
    }

    const serviceItemId = Number(item.service_item_id ?? item.reference_id);
    const serviceItem = catalog.get(serviceItemId)!;
    const unitPrice = Number(serviceItem.price ?? 0);

    if (item.quantity > 1 && Number(serviceItem.allow_multiple_qty ?? 1) !== 1) {
      throw new HTTPException(400, { message: `${serviceItem.item_name} does not allow multiple quantity` });
    }

    const subtotal = item.quantity * unitPrice;
    const discountAmount = item.discount_amount ?? roundMoney(subtotal * item.discount_percent / 100);
    if (discountAmount > 0 && Number(serviceItem.allow_discount ?? 1) !== 1) {
      throw new HTTPException(400, { message: `${serviceItem.item_name} does not allow discount` });
    }
    const discountPercent = subtotal > 0
      ? Math.round((discountAmount / subtotal) * 10000) / 100
      : item.discount_percent;
    const totalAmount = Math.max(0, roundMoney(subtotal - discountAmount));

    return db.$client.prepare(`
      INSERT INTO billing_provisional_items
        (tenant_id, patient_id, admission_id, visit_id, item_category, item_name,
         department, unit_price, quantity, discount_percent, discount_amount, total_amount,
         doctor_id, doctor_name, doctor_payable_amount, reference_id, bill_status, is_insurance, is_active, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisional', ?, 1, ?, datetime('now', '+6 hours'))
    `).bind(
      tenantId, data.patient_id, data.admission_id ?? null, data.visit_id ?? null,
      item.item_category ?? inferProvisionalItemCategory(serviceItem), serviceItem.item_name,
      item.department ?? serviceItem.department_name ?? null, unitPrice, item.quantity,
      discountPercent, discountAmount, totalAmount,
      item.doctor_id ?? null, item.doctor_name ?? null,
      item.doctor_payable_amount ?? null,
      serviceItemId,
      item.is_insurance ? 1 : 0, userId
    );
  });

  await db.$client.batch(stmts);

  // Return created item IDs so frontend can chain with /pay
  const createdIds = await db.$client.prepare(
    `SELECT id FROM billing_provisional_items WHERE patient_id = ? AND tenant_id = ? AND bill_status = 'provisional' AND is_active = 1 ORDER BY created_at DESC LIMIT ?`
  ).bind(data.patient_id, tenantId, data.items.length).all<{ id: number }>();

  return {
    message: `${data.items.length} provisional item(s) created`,
    count: data.items.length,
    item_ids: (createdIds.results ?? []).map(r => r.id),
  };
}

// ─── Helper: validate numeric route param ────────────────────────────────────

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid ID' });
  return id;
}

async function cancelProvisionalItem(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  id: number,
  cancelReason: string,
) {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const item = await db.$client.prepare(
    'SELECT id, bill_status FROM billing_provisional_items WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: number; bill_status: string }>();

  if (!item) throw new HTTPException(404, { message: 'Provisional item not found' });
  if (item.bill_status !== 'provisional') {
    throw new HTTPException(400, { message: `Cannot cancel item with status '${item.bill_status}'` });
  }

  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, String(tenantId), today, 'Provisional item cancellation');

  await db.$client.prepare(`
    UPDATE billing_provisional_items
    SET bill_status = 'cancelled', cancelled_by = ?, cancelled_at = datetime('now', '+6 hours'),
        cancel_reason = ?
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, cancelReason, id, tenantId).run();

  void createAuditLog(c.env, tenantId, userId, 'CANCEL', 'billing_provisional_items', id, null, {
    reason: cancelReason,
  });

  return c.json({ message: 'Provisional item cancelled' });
}

// ─── GET / — list provisional items ──────────────────────────────────────────

billingProvisional.get('/', zValidator('query', listProvisionalSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const query = c.req.valid('query');
  const patientId = query.patient_id ?? query.patientId;
  const billStatus = normalizeBillStatus(query.bill_status ?? query.status);
  const search = query.search?.trim() || '';
  const perPage = query.per_page ?? query.limit ?? 50;
  const page = query.page ?? (query.offset !== undefined ? Math.floor(query.offset / perPage) + 1 : 1);
  const offset = query.offset ?? (page - 1) * perPage;

  let sql = `
    SELECT
      pi.*,
      p.name as patient_name,
      p.patient_code,
      pi.item_name as service_name
    FROM billing_provisional_items pi
    JOIN patients p ON pi.patient_id = p.id AND p.tenant_id = pi.tenant_id
    WHERE pi.tenant_id = ? AND pi.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patientId) { sql += ' AND pi.patient_id = ?'; params.push(patientId); }
  if (query.visit_id) { sql += ' AND pi.visit_id = ?'; params.push(query.visit_id); }
  if (billStatus) { sql += ' AND pi.bill_status = ?'; params.push(billStatus); }
  if (search) {
    sql += ' AND (pi.item_name LIKE ? OR p.name LIKE ? OR p.patient_code LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s);
  }

  sql += ` ORDER BY pi.created_at DESC LIMIT ? OFFSET ?`;
  params.push(perPage, offset);

  let countSql = `
    SELECT COUNT(*) as total
    FROM billing_provisional_items pi
    JOIN patients p ON pi.patient_id = p.id AND p.tenant_id = pi.tenant_id
    WHERE pi.tenant_id = ? AND pi.is_active = 1
  `;
  const countParams: (string | number)[] = [tenantId];
  if (patientId) { countSql += ' AND pi.patient_id = ?'; countParams.push(patientId); }
  if (query.visit_id) { countSql += ' AND pi.visit_id = ?'; countParams.push(query.visit_id); }
  if (billStatus) { countSql += ' AND pi.bill_status = ?'; countParams.push(billStatus); }
  if (search) {
    countSql += ' AND (pi.item_name LIKE ? OR p.name LIKE ? OR p.patient_code LIKE ?)';
    const s = `%${search}%`;
    countParams.push(s, s, s);
  }

  const [{ results }, countRow] = await Promise.all([
    db.$client.prepare(sql).bind(...params).all(),
    db.$client.prepare(countSql).bind(...countParams).first<{ total: number }>(),
  ]);

  return c.json({
    data: results.map((row: any) => ({
      ...row,
      service_name: row.service_name ?? row.item_name,
      bill_status: toFrontendBillStatus(row.bill_status),
    })),
    page,
    per_page: perPage,
    total: countRow?.total ?? results.length,
  });
});

billingProvisional.get('/summary', zValidator('query', listProvisionalSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const query = c.req.valid('query');
  const patientId = query.patient_id ?? query.patientId;
  const billStatus = normalizeBillStatus(query.bill_status ?? query.status);

  let sql = `
    SELECT
      COUNT(*) as total_items,
      COALESCE(SUM(total_amount), 0) as total_amount,
      COALESCE(SUM(CASE WHEN bill_status = 'finalized' THEN 1 ELSE 0 END), 0) as billed_count,
      COALESCE(SUM(CASE WHEN bill_status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count,
      COALESCE(SUM(CASE WHEN bill_status = 'provisional' THEN 1 ELSE 0 END), 0) as provisional_count
    FROM billing_provisional_items
    WHERE tenant_id = ? AND is_active = 1
  `;
  const params: (string | number)[] = [tenantId];
  if (patientId) { sql += ' AND patient_id = ?'; params.push(patientId); }
  if (billStatus) { sql += ' AND bill_status = ?'; params.push(billStatus); }

  const summary = await db.$client.prepare(sql).bind(...params).first();
  return c.json(summary ?? { total_items: 0, total_amount: 0, billed_count: 0, cancelled_count: 0, provisional_count: 0 });
});

// ─── GET /patient/:patientId/summary — provisional summary ──────────────────

billingProvisional.get('/patient/:patientId/summary', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseId(c.req.param('patientId'));

  const summary = await db.$client.prepare(`
    SELECT
      COUNT(*) as total_items,
      COALESCE(SUM(CASE WHEN bill_status = 'provisional' THEN total_amount ELSE 0 END), 0) as pending_amount,
      COALESCE(SUM(CASE WHEN bill_status = 'finalized' THEN total_amount ELSE 0 END), 0) as finalized_amount,
      COALESCE(SUM(CASE WHEN bill_status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count
    FROM billing_provisional_items
    WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
  `).bind(tenantId, patientId).first();

  return c.json({ data: summary });
});

// ─── POST / — create provisional items (batch) ──────────────────────────────

billingProvisional.post('/', zValidator('json', createProvisionalItemsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, String(tenantId), today, 'Provisional item creation');
  const result = await createProvisionalItems(db, tenantId, userId, data);
  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'billing_provisional_items', Number(result.item_ids[0] ?? 0), null, {
    action: 'provisional_item_creation',
    patient_id: data.patient_id,
    admission_id: data.admission_id ?? null,
    count: result.count,
    manual_count: data.items.filter(isManualProvisionalItem).length,
  });
  return c.json(result, 201);
});

billingProvisional.post('/batch', zValidator('json', createProvisionalItemsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, String(tenantId), today, 'Provisional item creation');
  const result = await createProvisionalItems(db, tenantId, userId, data);
  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'billing_provisional_items', Number(result.item_ids[0] ?? 0), null, {
    action: 'provisional_item_creation',
    patient_id: data.patient_id,
    admission_id: data.admission_id ?? null,
    count: result.count,
    manual_count: data.items.filter(isManualProvisionalItem).length,
  });
  return c.json(result, 201);
});

// ─── PATCH /:id/cancel — cancel a provisional item ──────────────────────────

billingProvisional.patch('/:id/cancel', zValidator('json', cancelProvisionalSchema), async (c) => {
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');
  return cancelProvisionalItem(c, id, data.cancel_reason);
});

billingProvisional.put('/:id/cancel', zValidator('json', cancelProvisionalSchema), async (c) => {
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');
  return cancelProvisionalItem(c, id, data.cancel_reason);
});

// ─── POST /pay — convert provisional items to invoice (ATOMIC) ──────────────

billingProvisional.post('/pay', zValidator('json', payProvisionalSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'billing-provisional.finalize');
  const itemIds = data.provisional_item_ids;
  const discount = data.discount ?? data.discount_amount ?? 0;

  const activeCounterSession = await loadActiveBillingCounterSession(c.env.DB, String(tenantId), String(userId), {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeCounterSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before converting provisional items to invoice.' });
  }
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, String(tenantId), today, 'Provisional invoice conversion');

  // Fetch all provisional items
  let items: any[] = [];
  if (itemIds && itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(',');
    const response = await db.$client.prepare(
      `SELECT * FROM billing_provisional_items WHERE id IN (${placeholders}) AND tenant_id = ? AND bill_status = 'provisional'`
    ).bind(...itemIds, tenantId).all<any>();
    items = response.results;
    if (items.length !== itemIds.length) {
      throw new HTTPException(400, { message: 'Some provisional items not found or already processed' });
    }
  } else {
    const response = await db.$client.prepare(
      `SELECT * FROM billing_provisional_items WHERE patient_id = ? AND tenant_id = ? AND bill_status = 'provisional' AND is_active = 1`
    ).bind(data.patient_id, tenantId).all<any>();
    items = response.results;
  }

  if (items.length === 0) {
    throw new HTTPException(400, { message: 'No provisional items found for this patient' });
  }

  // Verify all items belong to the same patient
  if (items.some(item => item.patient_id !== data.patient_id)) {
    throw new HTTPException(400, { message: 'All items must belong to the same patient' });
  }

  // Calculate totals
  const subtotal = items.reduce((sum, item) => sum + (item.total_amount || 0), 0);
  let schemeEligibility: Awaited<ReturnType<typeof evaluateBillingSchemeEligibility>> | null = null;
  if (data.schemeApplication && discount > 0) {
    schemeEligibility = await evaluateBillingSchemeEligibility(c.env.DB, {
      tenantId: String(tenantId),
      patientId: data.patient_id,
      schemeId: data.schemeApplication.schemeId,
      schemeCode: data.schemeApplication.schemeCode,
      memberCode: data.schemeApplication.memberCode,
      serviceCategory: data.schemeApplication.serviceCategory ?? 'provisional_bill',
      subtotal,
    });
    if (!schemeEligibility.eligible) {
      throw new HTTPException(400, { message: `Scheme is not eligible: ${schemeEligibility.blockers.join(', ') || 'policy blocked'}` });
    }
    if (discount > Number(schemeEligibility.suggested_discount ?? 0)) {
      throw new HTTPException(400, { message: 'Scheme discount exceeds eligible scheme cap.' });
    }
  }
  const discountByName = data.discountByName ?? data.discount_by_name ?? null;
  const effectiveDiscountByName = discountByName ?? schemeEligibility?.matched_member_name ?? schemeEligibility?.matched_member_code ?? schemeEligibility?.scheme_name ?? null;
  assertDiscountReferralNameForHighDiscount(subtotal, discount, effectiveDiscountByName);
  const totalAmount = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const categoryTotals = calculateBillCategoryTotals(
    items.map((item) => ({ category: item.item_category, amount: Number(item.total_amount ?? 0) })),
  );

  // Handle deposit deduction
  const requestedDepositDeducted = data.deposit_deducted ?? 0;
  let depositDeducted = 0;
  let depositAdjustmentReceiptNo: string | null = null;

  if (requestedDepositDeducted > 0) {
    const depositBalance = await getPatientDepositBalance(c.env.DB, String(tenantId), data.patient_id);
    depositDeducted = Math.min(requestedDepositDeducted, totalAmount, depositBalance);
    if (depositDeducted <= 0) {
      throw new HTTPException(400, { message: `Insufficient deposit balance (available: ${depositBalance})` });
    }
    depositAdjustmentReceiptNo = await getNextSequence(c.env.DB, String(tenantId), 'deposit_adj', 'DAD');
  }

  // Generate invoice number before the batch
  const invoiceNo = await getNextBillInvoiceNumber(c.env.DB, String(tenantId), categoryTotals);
  const normalizedPaymentMethod = String(data.payment_method ?? 'credit').toLowerCase();
  const isCredit = normalizedPaymentMethod === 'credit' || normalizedPaymentMethod === 'due';
  const amountAfterDeposit = Math.max(0, totalAmount - depositDeducted);
  const paidAmount = data.paid_amount !== undefined
    ? Math.min(amountAfterDeposit, Math.max(0, data.paid_amount))
    : isCredit ? 0 : amountAfterDeposit;
  const dueAmount = Math.max(0, amountAfterDeposit - paidAmount);
  const billStatus = dueAmount > 0 ? 'open' : 'paid';
  const paymentReceiptNo = paidAmount > 0
    ? await getNextSequence(c.env.DB, String(tenantId), 'receipt', 'RCP')
    : null;

  const externalTransactionId = data.external_transaction_id ?? data.externalTransactionId ?? null;
  const issuedAtUtc = new Date().toISOString();
  const projectionItems = items.map((item) => ({
    provisionalItemId: Number(item.id),
    patientId: Number(item.patient_id),
    visitId: item.visit_id == null ? null : Number(item.visit_id),
    admissionId: item.admission_id == null ? null : Number(item.admission_id),
    category: item.item_category || 'provisional',
    description: String(item.item_name),
    department: item.department ?? null,
    quantity: Number(item.quantity || 1),
    unitPrice: Number(item.unit_price || item.total_amount),
    discountAmount: Number(item.discount_amount ?? 0),
    totalAmount: Number(item.total_amount ?? 0),
    doctorId: item.doctor_id == null ? null : Number(item.doctor_id),
    doctorName: item.doctor_name ?? null,
    referenceId: item.reference_id == null ? null : Number(item.reference_id),
    isManual: item.reference_id == null,
  }));
  const projectionInput = {
    tenantId: String(tenantId),
    patientId: data.patient_id,
    invoiceNo,
    issuedAtUtc,
    businessDate: today,
    globalDiscount: discount,
    items: projectionItems,
    paymentAmount: paidAmount,
    depositAmount: depositDeducted,
    paymentMethod: normalizedPaymentMethod,
    receiptNo: paymentReceiptNo,
    depositAdjustmentNo: depositAdjustmentReceiptNo,
    externalTransactionId,
    collectorId: Number(userId),
    counterId: Number(activeCounterSession.counter_id),
    counterSessionId: Number(activeCounterSession.id),
  };
  const legacyStatements = prepareProvisionalBillingLegacyStatements(c.env.DB, {
    tenantId: String(tenantId),
    userId: String(userId),
    patientId: data.patient_id,
    visitId: items[0]?.visit_id == null ? null : Number(items[0].visit_id),
    invoiceNo,
    categoryTotals,
    subtotal,
    discount,
    discountByName: effectiveDiscountByName?.trim() || null,
    total: totalAmount,
    paid: paidAmount,
    due: dueAmount,
    billStatus,
    paymentMethod: normalizedPaymentMethod,
    remarks: data.remarks ?? null,
    counterId: Number(activeCounterSession.counter_id),
    counterSessionId: Number(activeCounterSession.id),
    paymentReceiptNo,
    depositAdjustmentReceiptNo,
    depositDeducted,
    businessDate: today,
    items: items.map((item) => ({
      id: Number(item.id),
      patientId: Number(item.patient_id),
      admissionId: item.admission_id == null ? null : Number(item.admission_id),
      visitId: item.visit_id == null ? null : Number(item.visit_id),
      itemCategory: item.item_category || 'provisional',
      description: String(item.item_name),
      department: item.department ?? null,
      quantity: Number(item.quantity || 1),
      unitPrice: Number(item.unit_price || item.total_amount),
      discountAmount: Number(item.discount_amount ?? 0),
      lineTotal: Number(item.total_amount ?? 0),
      doctorId: item.doctor_id == null ? null : Number(item.doctor_id),
      doctorName: item.doctor_name ?? null,
      referenceId: item.reference_id == null ? null : Number(item.reference_id),
    })),
    schemeAllocation: schemeEligibility && discount > 0 ? {
      allocationType: schemeEligibility.allocation_type,
      amount: discount,
      referenceName: effectiveDiscountByName?.trim() || null,
      note: `Scheme: ${schemeEligibility.scheme_name ?? 'Benefit'}`,
      metadataJson: JSON.stringify({
        source: 'provisional_bill',
        schemeId: schemeEligibility.scheme_id,
        schemeMemberId: schemeEligibility.matched_member_id ?? null,
      }),
    } : null,
    accountingExtraPayload: {
      source: 'provisional_bill',
      schemeId: schemeEligibility?.scheme_id ?? null,
      schemeMemberId: schemeEligibility?.matched_member_id ?? null,
      schemeAllocationType: schemeEligibility?.allocation_type ?? null,
    },
  });

  let insertedBillId: number | null = null;
  try {
    const financialExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'billing-provisional.finalize',
      legacyStatements,
      canonical: async (execution) => {
        const projection = await buildProvisionalSettlementProjection({ ...projectionInput });
        return issueInvoiceWithSettlement(c.env.DB, projection, execution);
      },
    });
    if (financialExecution.mode !== 'strict') {
      const firstLegacyResult = financialExecution.result[0] as {
        meta?: { last_row_id?: number | string };
      } | undefined;
      const candidateBillId = Number(firstLegacyResult?.meta?.last_row_id ?? 0);
      if (Number.isSafeInteger(candidateBillId) && candidateBillId > 0) {
        insertedBillId = candidateBillId;
      }
    }
  } catch (error) {
    if (isFinancialBatchAssertionError(error) || isProvisionalCanonicalConflict(error)) {
      throw new HTTPException(409, {
        message: 'Provisional billing changed concurrently or canonical settlement is unavailable. Refresh and try again.',
      });
    }
    throw error;
  }

  // Legacy and canonical financial authority have committed together.
  // Prefer the authoritative legacy batch insert ID; strict mode falls back to lookup.
  const bill = insertedBillId
    ? { id: insertedBillId }
    : await db.$client.prepare(
        'SELECT id FROM bills WHERE invoice_no = ? AND tenant_id = ?'
      ).bind(invoiceNo, tenantId).first<{ id: number }>();
  if (!bill?.id) {
    throw new HTTPException(500, { message: 'Provisional invoice was not created' });
  }

  await createDoctorPayableAccrualsForProvisionalItems({
    db: c.env.DB,
    tenantId,
    userId,
    billId: bill.id,
    items,
  });

  if (schemeEligibility && discount > 0) {
    await recordBillingSchemeUsage(c.env.DB, {
      tenantId: String(tenantId),
      schemeId: Number(schemeEligibility.scheme_id),
      memberId: schemeEligibility.matched_member_id ?? null,
      patientId: data.patient_id,
      billId: bill.id,
      serviceCategory: schemeEligibility.service_category ?? 'provisional_bill',
      subtotal,
      discountAmount: discount,
      allocationType: schemeEligibility.allocation_type,
      createdBy: userId,
    });
  }

  if (totalAmount > 0 || discount > 0) {
    await recordBillFinalizationSideEffects(c.env.DB, {
      tenantId,
      userId,
      patientId: data.patient_id,
      visitId: items[0]?.visit_id ?? null,
      billId: bill.id,
      invoiceNo,
      referringDoctorId: null,
      billDate: today,
      subtotal,
      discount,
      total: totalAmount,
      categoryTotals,
      counterId: Number(activeCounterSession.counter_id),
      counterSessionId: Number(activeCounterSession.id),
      skipBillAccountingEvent: true,
      items: items.map((item) => ({
        itemCategory: item.item_category || 'provisional',
        description: item.item_name ?? null,
        lineTotal: Number(item.total_amount ?? 0),
        referenceId: item.reference_id ?? null,
      })),
    });
  }

  queueAccountingPosting(c, String(tenantId));

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'bills', bill.id, null, {
    action: 'provisional_to_invoice',
    invoiceNo,
    patientId: data.patient_id,
    subtotal,
    discount,
    total: totalAmount,
    depositDeducted,
    paid: paidAmount,
    due: dueAmount,
    paymentMethod: normalizedPaymentMethod,
    counterId: activeCounterSession.counter_id,
    counterSessionId: activeCounterSession.id,
  });

  return c.json({
    message: 'Provisional items converted to invoice',
    bill_id: bill.id,
    invoice_no: invoiceNo,
    total: totalAmount,
    deposit_deducted: depositDeducted,
    paid: paidAmount,
    due: dueAmount,
    status: billStatus,
    items_count: items.length,
  }, 201);
});

export default billingProvisional;
