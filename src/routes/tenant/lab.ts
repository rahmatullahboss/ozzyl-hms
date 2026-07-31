import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  createLabTestSchema,
  updateLabTestSchema,
  createLabOrderSchema,
  updateLabItemResultSchema,
  updateSampleStatusSchema,
  verifyLabItemSchema,
  barcodeScanSchema,
  collectLabSpecimenSchema,
  receiveLabSpecimenSchema,
  createPanelSchema,
  createLabReportSchema,
  reviewLabReportSchema,
  createLabResultSchema,
  bulkResultEntrySchema,
  createLabTestExtendedSchema,
  createLabOrderExtendedSchema,
  rejectSampleSchema,
  recollectSampleSchema,
  cancelLabItemSchema,
} from '../../schemas/lab';
import { validateLabResult } from './labValidation';
import { isLabStatusTransitionAllowed } from '../../lib/lab-workflow';
import { assertLabReportNotRetracted } from '../../lib/lis-retraction-guards';
import { getNextSequence } from '../../lib/sequence';
import { getNextInvoiceNumber } from '../../lib/invoice-sequence';
import { getActiveFiscalYear, getNextFiscalInvoiceNo } from '../../lib/fiscal-year';
import { createAuditLog } from '../../lib/accounting-helpers';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { calculateBillCategoryTotals } from '../../lib/billing-category-totals';
import { getTodayGMT6 } from '../../lib/date-utils';
import { resolveOrderingClinicianDoctorId } from '../../lib/lab-order-attribution';
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../lib/accounting-posting';
import { recordBillFinalizationSideEffects } from '../../lib/billing-finalization';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId, requireSpecificRole } from '../../lib/context-helpers';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../lib/canonical/strict-financial-boundaries';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { isFinancialBatchAssertionError } from '../../lib/canonical/financial-batch-assertion';
import {
  executeLabBillingOriginalLegacy,
  prepareLabBillingStrictStatements,
} from '../../lib/canonical/lab-billing-finalization';
import { createLabOrderBilling } from '../../lib/canonical/commands/create-lab-order-billing';
import { toMinorUnits } from '../../lib/canonical/money';
import { loadCanonicalBillPerformerItems } from '../../lib/diagnostic-performer-reserve';
import {
  canDoctorAccessPatientLabResults,
  fetchDoctorLabInboxSummary,
  fetchDoctorLabResults,
  requireLinkedDoctorId,
} from '../../lib/doctor-lab-inbox';
import { getPagination, paginationMeta } from '../../lib/pagination';
import { getDb } from '../../db';
import { bills, invoiceItems, visitServices } from '../../db/schema';
import { sql } from 'drizzle-orm';

import { requireRole } from '../../middleware/rbac';
import {
  evaluateFormula,
  roundResult,
  determineAbnormalFlag as determineAbnormalFromRange,
  calculateDelta,
  FormulaError,
} from '../../lib/lab-formula-evaluator';
import {
  getDiagnosticBillingClearance,
  getDiagnosticBillingColumns,
  getDiagnosticBillingJoin,
} from '../../lib/diagnostic-billing';
import {
  parseDiagnosticCatalogCsv,
  normalizeDiagnosticCatalogCode,
  resolveLabTestBillingRow,
  syncDiagnosticCatalogFromBillingServiceItem,
  upsertDiagnosticBillingServiceItem,
} from '../../lib/diagnostic-catalog';
import { consumeMappedLabConsumables } from '../../lib/lab-consumables';
import { getLabInventoryPolicy, shouldBlockLabInventoryException, shouldConsumeLabReagentsForEvent } from '../../lib/lab-inventory-policy';
import { accrueLabOrderDoctorCommissions, accrueLabVerificationCommissions } from '../../lib/lab-finance';
import { cancelLabOrderItem } from '../../lib/lab-cancellation';
import { findLabCancellationOperation } from '../../lib/lab-cancellation-operation';
import { recordLabWorkflowEvent } from '../../lib/lab-workflow';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';

const labCatalogRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

interface LabOrderItemVerificationRow {
  patient_id: number;
  visit_id: number | null;
  bill_id: number | null;
  lab_order_id: number;
  lab_test_id: number;
  category: string | null;
  line_total: number | null;
  [key: string]: unknown;
}

interface BulkResultOrderRow {
  id: number;
  patient_id: number;
  gender: string | null;
  date_of_birth: string | null;
  bill_id: number | null;
  bill_status: string | null;
  bill_total: number | null;
  bill_paid: number | null;
}

interface BulkResultOrderItemRow {
  id: number;
  lab_order_id: number;
  lab_test_id: number;
  normal_range: string | null;
  critical_low: number | null;
  critical_high: number | null;
  status: string | null;
}

const LAB_ACCESS_ROLES = ['laboratory', 'lab', 'lab_tech', 'doctor', 'md', 'nurse', 'reception', 'receptionist', 'hospital_admin', 'director', 'accountant'] as const;

labCatalogRoutes.use('*', requireRole(...LAB_ACCESS_ROLES));

// ─── P0-12: granular per-action role gates ────────────────────────────────
// Catalog/panel CRUD was previously reachable by the broad lab access list
// (reception, doctor, etc.). Now only catalog managers can mutate, while
// the wide group above is kept for the read-only dashboards / queues.
// Permission constant names live in `./lab/_permissions.ts`; once
// fix/auth-rbac hoists a real `requirePermission(...)` into src/lib/authz
// we can swap these `requireRole(...)` calls for `requireLabPermission(...)`
// without touching the route handlers themselves.
import {
  LAB_CATALOG_MANAGE_ROLES,
  LAB_ORDER_CREATE_ROLES,
  LAB_RESULT_ENTRY_ROLES,
  LAB_SAMPLE_COLLECT_ROLES,
  LAB_QC_RELEASE_ROLES,
  LAB_REPORT_GOVERNANCE_ROLES,
  requireLabPermission,
} from './lab/_permissions';

function queueLabAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post lab billing accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function isLabCanonicalConflict(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current != null; depth += 1) {
    const message = current instanceof Error ? current.message : String(current);
    if (/canonical|mapping|catalog|invoice|idempotency|constraint|concurrent/i.test(message)) return true;
    if (typeof current !== 'object') return false;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function assertDiagnosticBillCleared(row: Record<string, unknown>, workflow: string): void {
  const clearance = getDiagnosticBillingClearance(row);
  if (!clearance.cleared) {
    throw new HTTPException(409, {
      message: `Diagnostic bill payment required before ${workflow}. Bill #${clearance.billId ?? 'unknown'} is ${clearance.paymentStatus}; outstanding ${clearance.outstanding}.`,
    });
  }
}

const columnCache = new Map<string, Promise<Set<string>>>();

async function getTableColumns(db: D1Database, tableName: string): Promise<Set<string>> {
  const key = tableName;
  if (!columnCache.has(key)) {
    columnCache.set(key, db.prepare(`PRAGMA table_info("${tableName.replace(/"/g, '""')}")`).all<{ name: string }>()
      .then((result) => {
        const names = (result.results ?? []).map((row) => row.name);
        if (names.length === 0 && tableName === 'lab_order_items') {
          return new Set(['source']);
        }
        if (names.length === 0 && tableName === 'lab_orders') {
          return new Set(['bill_id', 'billing_status', 'updated_at']);
        }
        return new Set(names);
      }));
  }
  return columnCache.get(key)!;
}

async function getDiagnosticBillingSql(db: D1Database, tableName: 'lab_orders', alias: string) {
  const columns = await getTableColumns(db, tableName);
  const hasBillingColumns = columns.has('bill_id') && columns.has('billing_status');
  if (!hasBillingColumns) {
    return {
      hasBillingColumns,
      select: "NULL as bill_id, 'not_required' as diagnostic_billing_status, NULL as bill_status, 0 as bill_total, 0 as bill_paid",
      join: '',
      paidPredicate: '1 = 1',
    };
  }

  return {
    hasBillingColumns,
    select: getDiagnosticBillingColumns(alias),
    join: getDiagnosticBillingJoin(alias),
    paidPredicate: `(${alias}.bill_id IS NULL OR b.status = 'paid' OR COALESCE(b.total, 0) <= COALESCE(b.paid, 0))`,
  };
}

// ─── Helper: Auto-detect abnormal flag ────────────────────────────────────────

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function detectAbnormalFlag(
  numericValue: number | undefined,
  normalRange: string | null | undefined,
  criticalLow?: number | null,
  criticalHigh?: number | null
): 'normal' | 'high' | 'low' | 'critical' | 'pending' {
  if (numericValue === undefined || numericValue === null || !normalRange) {
    return 'pending';
  }

  // Parse range: "70-100" or "M:4.5-5.5|F:4.0-5.0" → use first range
  const rangeStr = normalRange.includes('|')
    ? normalRange.split('|')[0].replace(/^[MF]:/, '')
    : normalRange;

  const match = rangeStr.match(/^([\d.]+)-([\d.]+)$/);
  if (!match) return 'pending';

  const low = parseFloat(match[1]);
  const high = parseFloat(match[2]);

  if (isNaN(low) || isNaN(high)) return 'pending';

  // Use per-test critical thresholds if available, otherwise fall back to 2x-range heuristic
  const cLow = (criticalLow != null && !isNaN(criticalLow)) ? criticalLow : low - (high - low);
  const cHigh = (criticalHigh != null && !isNaN(criticalHigh)) ? criticalHigh : high + (high - low);

  if (numericValue < cLow || numericValue > cHigh) return 'critical';
  if (numericValue < low) return 'low';
  if (numericValue > high) return 'high';
  return 'normal';
}

// ─── Helper: Get structured reference range for patient ───────────────────────

async function getStructuredReferenceRange(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  testId: number,
  componentId: number | null | undefined,
  patientGender: string,
  patientAgeMonths: number
): Promise<{ range_low: number | null; range_high: number | null; critical_low: number | null; critical_high: number | null } | null> {
  const genderFilter = patientGender.toLowerCase().startsWith('m') ? 'male' : 'female';

  const row = await db.$client.prepare(`
    SELECT range_low, range_high, critical_low, critical_high
    FROM lab_reference_ranges
    WHERE tenant_id = ? AND lab_test_id = ? AND is_active = 1
      AND (component_id = ? OR (component_id IS NULL AND ? IS NULL))
      AND (gender = ? OR gender = 'both')
      AND age_min_months <= ?
      AND (age_max_months IS NULL OR age_max_months >= ?)
    ORDER BY
      CASE WHEN gender = ? THEN 0 ELSE 1 END,
      age_max_months ASC NULLS LAST
    LIMIT 1
  `).bind(tenantId, testId, componentId ?? null, componentId ?? null, genderFilter, patientAgeMonths, patientAgeMonths, genderFilter).first<{
    range_low: number | null;
    range_high: number | null;
    critical_low: number | null;
    critical_high: number | null;
  }>();

  return row ?? null;
}

// ─── Helper: Get previous result for delta check ──────────────────────────────

async function getPreviousResult(
  db: ReturnType<typeof getDb>,
  tenantId: number,
  patientId: number,
  testId: number,
  componentId: number | null | undefined,
  excludeResultId?: number
): Promise<{ result_numeric: number | null; result_value: string | null } | null> {
  const query = `
    SELECT lr.result_numeric, lr.result_value
    FROM lab_results lr
    JOIN lab_reports lrp ON lr.lab_report_id = lrp.id
    JOIN lab_orders lo ON lrp.lab_order_id = lo.id
    WHERE lo.patient_id = ? AND lr.lab_test_id = ? AND lo.tenant_id = ?
      ${componentId ? 'AND lr.component_id = ?' : 'AND lr.component_id IS NULL'}
      ${excludeResultId ? 'AND lr.id != ?' : ''}
      AND lr.result_numeric IS NOT NULL
    ORDER BY lr.created_at DESC
    LIMIT 1
  `;

  const params: (number | string)[] = [patientId, testId, tenantId];
  if (componentId) params.push(componentId);
  if (excludeResultId) params.push(excludeResultId);

  return await db.$client.prepare(query).bind(...params).first<{ result_numeric: number | null; result_value: string | null }>();
}

type LabCatalogRow = {
  id: number;
  code: string;
  name: string;
  category: string | null;
  price: number;
  billing_service_item_id: number | null;
  unit: string | null;
  normal_range: string | null;
  method: string | null;
  critical_low: number | null;
  critical_high: number | null;
  is_active: number | null;
  is_commissionable: number | null;
};

type LabBillingSyncInput = {
  code: string;
  name: string;
  category: string | null;
  price: number;
  isActive: number;
  serviceItemId?: number | null;
};

function nullableText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeActiveStatus(value: boolean | number | undefined, fallback: unknown): number {
  if (value === undefined) return Number(fallback ?? 1) ? 1 : 0;
  return value ? 1 : 0;
}

async function ensureLabServiceDepartment(d1: D1Database, tenantId: string, userId: string): Promise<number> {
  const existing = await d1.prepare(`
    SELECT id FROM billing_service_departments
    WHERE department_code = 'LAB' AND tenant_id = ? AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(tenantId).first<{ id: number }>();
  if (existing?.id) return Number(existing.id);

  const result = await d1.prepare(`
    INSERT INTO billing_service_departments
      (department_name, department_code, is_active, tenant_id, created_by)
    VALUES ('Laboratory', 'LAB', 1, ?, ?)
  `).bind(tenantId, userId).run();
  return Number(result.meta.last_row_id);
}

async function ensureDefaultBillingPriceCategory(d1: D1Database, tenantId: string): Promise<number> {
  const insertResult = await d1.prepare(`
    INSERT INTO price_categories
      (tenant_id, category_name, category_code, description, is_default, is_active, created_at)
    SELECT ?, 'Normal', 'NOR', 'Standard price', 1, 1, datetime('now', '+6 hours')
    WHERE NOT EXISTS (
      SELECT 1 FROM price_categories
      WHERE tenant_id = ? AND is_active = 1
    )
  `).bind(tenantId, tenantId).run();

  const category = await d1.prepare(`
    SELECT id FROM price_categories
    WHERE tenant_id = ? AND is_active = 1
    ORDER BY is_default DESC, id ASC
    LIMIT 1
  `).bind(tenantId).first<{ id: number }>();

  if (!category?.id && insertResult.meta.last_row_id) return Number(insertResult.meta.last_row_id);
  if (!category?.id) throw new HTTPException(500, { message: 'Default billing price category is not configured' });
  return Number(category.id);
}

async function syncDefaultBillingPriceMap(
  d1: D1Database,
  tenantId: string,
  serviceItemId: number,
  price: number,
): Promise<void> {
  const categoryId = await ensureDefaultBillingPriceCategory(d1, tenantId);
  const existing = await d1.prepare(`
    SELECT id FROM billing_item_price_category_maps
    WHERE tenant_id = ? AND service_item_id = ? AND price_category_id = ?
    LIMIT 1
  `).bind(tenantId, serviceItemId, categoryId).first<{ id: number }>();

  if (existing?.id) {
    await d1.prepare(`
      UPDATE billing_item_price_category_maps
      SET price = ?, is_active = 1, updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(price, existing.id, tenantId).run();
    return;
  }

  await d1.prepare(`
    INSERT INTO billing_item_price_category_maps
      (tenant_id, service_item_id, price_category_id, price, is_discount_applicable, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, 1, datetime('now', '+6 hours'))
  `).bind(tenantId, serviceItemId, categoryId, price).run();
}

async function syncLabTestBillingServiceItem(
  d1: D1Database,
  tenantId: string,
  oldCode: string,
  data: LabBillingSyncInput,
  userId: string,
): Promise<number> {
  return upsertDiagnosticBillingServiceItem(d1, {
    kind: 'lab',
    tenantId,
    userId,
    oldCode,
    serviceItemId: data.serviceItemId,
    code: data.code,
    name: data.name,
    category: data.category,
    price: data.price,
    isActive: data.isActive,
  });
}

// ─── Lab Test Catalog CRUD ────────────────────────────────────────────────────

/**
 * GET /api/lab
 * Retrieves a list of active lab tests from the catalog for the current tenant.
 * Supports searching by test name, code, or category.
 *
 * @param {string} [search] - Optional search query to filter lab tests.
 * @returns {Object} JSON response containing:
 *   - tests: Array of active lab test records.
 *
 * @example
 * // GET /api/lab?search=blood
 */
labCatalogRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const search = c.req.query('search') || '';

  try {
    const status = c.req.query('status') || 'active';
    let query = `
      SELECT ltc.*,
             COALESCE(linked_si.price, code_si.price, ltc.price, 0) as price,
             COALESCE(linked_si.id, code_si.id, ltc.billing_service_item_id) as billing_service_item_id,
             CASE
               WHEN linked_si.id IS NOT NULL OR code_si.id IS NOT NULL THEN 'synced'
               ELSE 'missing_billing_item'
             END as billing_sync_status
      FROM lab_test_catalog ltc
      LEFT JOIN billing_service_items linked_si
        ON linked_si.id = ltc.billing_service_item_id
       AND linked_si.tenant_id = ltc.tenant_id
       AND COALESCE(linked_si.is_active, 1) = 1
      LEFT JOIN billing_service_departments lab_sd
        ON lab_sd.tenant_id = ltc.tenant_id
       AND lab_sd.department_code = 'LAB'
       AND COALESCE(lab_sd.is_active, 1) = 1
      LEFT JOIN billing_service_items code_si
        ON code_si.tenant_id = ltc.tenant_id
       AND code_si.service_department_id = lab_sd.id
       AND code_si.item_code = ltc.code
       AND COALESCE(code_si.is_active, 1) = 1
      WHERE ltc.tenant_id = ?`;
    const params: (string | number)[] = [tenantId!];
    if (status === 'inactive') query += ' AND COALESCE(ltc.is_active, 1) = 0';
    else if (status !== 'all') query += ' AND COALESCE(ltc.is_active, 1) = 1';

    if (search) {
      query += ' AND (ltc.name LIKE ? OR ltc.code LIKE ? OR ltc.category LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY ltc.category, ltc.name';
    const tests = await db.$client.prepare(query).bind(...params).all();
    return c.json({ tests: tests.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch lab tests' });
  }
});

/**
 * POST /api/lab
 * Adds a new lab test to the catalog for the current tenant.
 * Validates the request body against `createLabTestSchema`.
 *
 * @param {Object} body - Validated lab test data (code, name, category, price).
 * @returns {Object} JSON response containing:
 *   - message: Success message.
 *   - id: The ID of the newly created lab test.
 * @throws {HTTPException} 500 if the creation fails.
 *
 * @example
 * // POST /api/lab
 * // Body: { "code": "CBC", "name": "Complete Blood Count", "price": 50 }
 */
labCatalogRoutes.post('/', requireRole(...LAB_CATALOG_MANAGE_ROLES), zValidator('json', createLabTestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const code = normalizeDiagnosticCatalogCode(data.code);

  try {
    const duplicate = await db.$client.prepare(
      'SELECT id FROM lab_test_catalog WHERE tenant_id = ? AND code = ? AND COALESCE(is_active, 1) = 1 LIMIT 1',
    ).bind(tenantId, code).first<{ id: number }>();
    if (duplicate) throw new HTTPException(409, { message: 'Lab test code already exists' });

    const serviceItemId = await syncLabTestBillingServiceItem(c.env.DB, tenantId, code, {
      code,
      name: data.name,
      category: nullableText(data.category),
      price: data.price,
      isActive: 1,
    }, userId);

    const isCommissionable = normalizeActiveStatus(data.is_commissionable, 1);
    const result = await db.$client.prepare(
      `INSERT INTO lab_test_catalog (code, name, category, price, unit, normal_range, method, critical_low, critical_high, is_active, is_commissionable, tenant_id, billing_service_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(code, data.name, data.category ?? null, data.price, data.unit ?? null, data.normal_range ?? null, data.method ?? null, data.critical_low ?? null, data.critical_high ?? null, isCommissionable, tenantId, serviceItemId).run();

    const labTestId = result.meta.last_row_id as number;

    return c.json({ message: 'Lab test added', id: labTestId, billingServiceItemId: serviceItemId }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to add lab test' });
  }
});

/**
 * PUT /api/lab/:id
 * Updates an existing lab test in the catalog for the current tenant.
 * Validates the request body against `updateLabTestSchema`.
 * Only provided fields are updated; missing fields retain their current values.
 *
 * @param {string} id - The ID of the lab test to update.
 * @param {Object} body - Partial lab test data to update.
 * @returns {Object} JSON response indicating success.
 * @throws {HTTPException} 404 if the lab test is not found.
 * @throws {HTTPException} 500 if the update fails.
 *
 * @example
 * // PUT /api/lab/123
 * // Body: { "price": 55 }
 */
labCatalogRoutes.put('/:id', requireRole(...LAB_CATALOG_MANAGE_ROLES), zValidator('json', updateLabTestSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid lab test ID' });
  const data = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(
      'SELECT * FROM lab_test_catalog WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<LabCatalogRow>();
    if (!existing) throw new HTTPException(404, { message: 'Lab test not found' });

    const updated = {
      code: data.code !== undefined ? normalizeDiagnosticCatalogCode(data.code) : existing.code,
      name: data.name ?? existing.name,
      category: data.category !== undefined ? nullableText(data.category) : nullableText(existing.category),
      price: data.price !== undefined ? data.price : Number(existing.price ?? 0),
      unit: data.unit !== undefined ? nullableText(data.unit) : nullableText(existing.unit),
      normalRange: data.normal_range !== undefined ? nullableText(data.normal_range) : nullableText(existing.normal_range),
      method: data.method !== undefined ? nullableText(data.method) : nullableText(existing.method),
      criticalLow: data.critical_low !== undefined ? nullableNumber(data.critical_low) : nullableNumber(existing.critical_low),
      criticalHigh: data.critical_high !== undefined ? nullableNumber(data.critical_high) : nullableNumber(existing.critical_high),
      isActive: normalizeActiveStatus(data.is_active, existing.is_active),
      isCommissionable: normalizeActiveStatus(data.is_commissionable, existing.is_commissionable),
    };

    if (updated.code !== existing.code) {
      const duplicate = await db.$client.prepare(
        'SELECT id FROM lab_test_catalog WHERE tenant_id = ? AND code = ? AND id != ? AND COALESCE(is_active, 1) = 1 LIMIT 1',
      ).bind(tenantId, updated.code, id).first<{ id: number }>();
      if (duplicate) throw new HTTPException(409, { message: 'Lab test code already exists' });
    }

    const serviceItemId = await syncLabTestBillingServiceItem(c.env.DB, tenantId, existing.code, {
      code: updated.code,
      name: updated.name,
      category: updated.category,
      price: updated.price,
      isActive: updated.isActive,
      serviceItemId: existing.billing_service_item_id,
    }, userId);

    await db.$client.prepare(
      `UPDATE lab_test_catalog
       SET code = ?,
           name = ?,
           category = ?,
           price = ?,
           unit = ?,
           normal_range = ?,
           method = ?,
           critical_low = ?,
           critical_high = ?,
           is_active = ?,
           is_commissionable = ?,
           billing_service_item_id = ?
       WHERE id = ? AND tenant_id = ?`,
    ).bind(
      updated.code,
      updated.name,
      updated.category,
      updated.price,
      updated.unit,
      updated.normalRange,
      updated.method,
      updated.criticalLow,
      updated.criticalHigh,
      updated.isActive,
      updated.isCommissionable,
      serviceItemId,
      id,
      tenantId,
    ).run();

    return c.json({ message: 'Lab test updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update lab test' });
  }
});

/**
 * DELETE /api/lab/:id
 * Performs a logical deletion (deactivation) of a lab test in the catalog.
 * Sets `is_active` to 0.
 *
 * @param {string} id - The ID of the lab test to deactivate.
 * @returns {Object} JSON response indicating success.
 * @throws {HTTPException} 404 if the lab test is not found.
 * @throws {HTTPException} 500 if the deactivation fails.
 *
 * @example
 * // DELETE /api/lab/123
 */
labCatalogRoutes.delete('/:id', requireRole(...LAB_CATALOG_MANAGE_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');

  try {
    const existing = await db.$client.prepare(
      'SELECT id, code, name, category, price, billing_service_item_id FROM lab_test_catalog WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<LabCatalogRow>();
    if (!existing) throw new HTTPException(404, { message: 'Lab test not found' });

    // Deactivate in lab_test_catalog
    await db.$client.prepare(
      'UPDATE lab_test_catalog SET is_active = 0 WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).run();

    await syncLabTestBillingServiceItem(c.env.DB, tenantId, existing.code, {
      code: existing.code,
      name: existing.name,
      category: existing.category,
      price: Number(existing.price ?? 0),
      isActive: 0,
      serviceItemId: existing.billing_service_item_id,
    }, userId);

    return c.json({ message: 'Lab test deactivated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to deactivate lab test' });
  }
});

// ─── Lab Orders ───────────────────────────────────────────────────────────────

/**
 * GET /api/lab/orders
 * Retrieves a paginated list of lab orders for the current tenant.
 * Supports filtering by patient ID and order date.
 * Includes aggregates for total items and pending items per order.
 *
 * @param {string} [patientId] - Optional patient ID to filter orders.
 * @param {string} [date] - Optional date (YYYY-MM-DD) to filter orders.
 * @param {string} [page=1] - Pagination: current page number.
 * @param {string} [limit=10] - Pagination: number of records per page.
 * @returns {Object} JSON response containing:
 *   - orders: Array of lab order records with patient details and item counts.
 *   - meta: Pagination metadata.
 *
 * @example
 * // GET /api/lab/orders?date=2024-03-14&page=1
 */
labCatalogRoutes.get('/orders', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { patientId, date, status, from, to } = c.req.query();
  const { page, limit, offset } = getPagination(c);

  try {
    const billingSql = await getDiagnosticBillingSql(c.env.DB, 'lab_orders', 'lo');
    let whereClause = 'WHERE lo.tenant_id = ?';
    const params: (string | number)[] = [tenantId];

    if (patientId) { whereClause += ' AND lo.patient_id = ?'; params.push(patientId); }
    if (date)      { whereClause += ' AND lo.order_date = ?'; params.push(date); }
    if (status)    { whereClause += ' AND lo.status = ?'; params.push(status); }
    if (from)      { whereClause += ' AND lo.order_date >= ?'; params.push(from); }
    if (to)        { whereClause += ' AND lo.order_date <= ?'; params.push(to); }

    const countResult = await db.$client.prepare(
      `SELECT COUNT(*) as total FROM lab_orders lo ${whereClause}`
    ).bind(...params).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const orders = await db.$client.prepare(`
      SELECT lo.*, ${billingSql.select},
             p.name as patient_name, p.patient_code, p.mobile as patient_mobile,
             COUNT(loi.id) as total_items,
             SUM(CASE WHEN loi.status = 'pending' THEN 1 ELSE 0 END) as pending_items
      FROM lab_orders lo
      JOIN patients p ON lo.patient_id = p.id
      ${billingSql.join}
      LEFT JOIN lab_order_items loi ON lo.id = loi.lab_order_id
      ${whereClause}
      GROUP BY lo.id ORDER BY lo.created_at DESC LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return c.json({ orders: orders.results, meta: paginationMeta(page, limit, total) });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch lab orders' });
  }
});

/**
 * GET /api/lab/orders/queue/today
 * Retrieves today's queue of lab test items (for the lab portal) for the current tenant.
 * Includes details about the test, patient, and order, sorted by status and creation time.
 *
 * @returns {Object} JSON response containing:
 *   - queue: Array of lab order items scheduled for today.
 *   - date: Today's date (YYYY-MM-DD).
 *
 * @example
 * // GET /api/lab/orders/queue/today
 */
labCatalogRoutes.get('/orders/queue/today', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();

  try {
    const billingSql = await getDiagnosticBillingSql(c.env.DB, 'lab_orders', 'lo');
    const queue = await db.$client.prepare(`
      SELECT loi.id as item_id, loi.status, loi.result, loi.collected_at, loi.completed_at,
             lo.id as order_id, lo.order_no, lo.order_date, lo.patient_id, lo.priority, lo.created_at,
             ${billingSql.select},
             p.name as patient_name, p.patient_code, p.mobile,
             ltc.name as test_name, ltc.category, ltc.code as test_code, ltc.unit, ltc.normal_range as reference_range, ltc.tat_minutes as target_tat,
             loi.unit_price, loi.line_total
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      ${billingSql.join}
      JOIN patients p ON lo.patient_id = p.id
      JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      WHERE lo.tenant_id = ? AND lo.order_date = ?
      ORDER BY loi.status ASC, lo.created_at ASC
    `).bind(tenantId, today).all();
    const items = queue.results || [];

    // Aggregate stats by status for admin monitor
    const samplePending = items.filter((i: Record<string, unknown>) => i.status === 'sample_pending' || i.status === 'pending').length;
    const processing = items.filter((i: Record<string, unknown>) => i.status === 'processing' || i.status === 'in_progress').length;
    const reportReady = items.filter((i: Record<string, unknown>) => i.status === 'report_ready' || i.status === 'completed').length;
    const now = Date.now();
    const delayed = items.filter((i: Record<string, unknown>) => {
      if (i.status === 'report_ready' || i.status === 'completed') return false;
      const target = Number(i.target_tat ?? 60);
      const created = i.created_at ? new Date(String(i.created_at)).getTime() : now;
      return (now - created) / 60000 > target;
    }).length;
    const critical = items.filter((i: Record<string, unknown>) => i.priority === 'urgent' || i.priority === 'stat').length;

    // Items list (map to frontend shape: id, orderId, patientName, testName, sampleStatus, reportStatus, expectedTime, delayMinutes)
    const mappedItems = items.map((it: Record<string, unknown>) => {
      const created = it.created_at ? new Date(String(it.created_at)).getTime() : now;
      const target = Number(it.target_tat ?? 60);
      const delay = Math.max(0, Math.floor((now - created) / 60000 - target));
      return {
        id: String(it.item_id),
        orderId: String(it.order_id),
        patientName: it.patient_name,
        testName: it.test_name,
        departmentName: it.category,
        sampleStatus: it.status,
        reportStatus: it.status,
        expectedTime: it.target_tat ? `${it.target_tat} min` : '—',
        delayMinutes: delay,
      };
    });

    // Critical alerts — items with critical/panic values
    const criticalAlerts = items
      .filter((i: Record<string, unknown>) => i.result && (String(i.result).toLowerCase().includes('critical') || String(i.result).toLowerCase().includes('panic') || String(i.result).toLowerCase().includes('high')))
      .slice(0, 20)
      .map((i: Record<string, unknown>) => ({
        id: String(i.item_id),
        patientName: i.patient_name,
        testName: i.test_name,
        result: i.result,
        severity: 'critical',
      }));

    return c.json({
      stats: {
        totalToday: items.length,
        samplePending,
        processing,
        reportReady,
        delayed,
        critical,
      },
      items: mappedItems,
      criticalAlerts,
      date: today,
    });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch today\'s queue' });
  }
});

/**
 * GET /api/lab/orders/:id
 * Retrieves the details of a single lab order by its ID, along with its associated test items.
 *
 * @param {string} id - The ID of the lab order.
 * @returns {Object} JSON response containing:
 *   - order: The main lab order record with patient details.
 *   - items: Array of `lab_order_items` associated with the order.
 * @throws {HTTPException} 404 if the lab order is not found.
 *
 * @example
 * // GET /api/lab/orders/456
 */
labCatalogRoutes.get('/orders/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const order = await db.$client.prepare(`
      SELECT lo.*, p.name as patient_name, p.patient_code, p.mobile
      FROM lab_orders lo JOIN patients p ON lo.patient_id = p.id
      WHERE lo.id = ? AND lo.tenant_id = ?
    `).bind(id, tenantId).first();
    if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

    const items = await db.$client.prepare(`
      SELECT loi.*, ltc.name as test_name, ltc.code, ltc.category
      FROM lab_order_items loi
      JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      WHERE loi.lab_order_id = ?
    `).bind(id).all();

    return c.json({ order, items: items.results });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch lab order' });
  }
});

/**
 * POST /api/lab/orders
 * Creates a new lab order and its associated test items for the current tenant.
 * Generates a unique order number. For each requested item, fetches the current price
 * from the active lab test catalog to compute the line total.
 *
 * @param {Object} body - Validated lab order data (patientId, visitId, items).
 * @returns {Object} JSON response containing:
 *   - message: Success message.
 *   - orderId: The ID of the newly created lab order.
 *   - orderNo: The unique lab order number (e.g., LO-000001).
 * @throws {HTTPException} 400 if a requested lab test is not found or inactive.
 * @throws {HTTPException} 500 if the order creation fails.
 *
 * @example
 * // POST /api/lab/orders
 * // Body: { "patientId": 1, "items": [{ "labTestId": 10, "discount": 0 }] }
 */
labCatalogRoutes.post('/orders', requireRole(...LAB_ORDER_CREATE_ROLES), zValidator('json', createLabOrderSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'lab.billing.create');
  const orderDate = data.orderDate ?? getTodayGMT6();

  // ─── P0-13: tenant-ownership pre-check ─────────────────────────────────
  // Validate patient + (optional) visit ownership before any insert so we
  // never start a bill / order chain for a record owned by another tenant.
  const patientRow = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ? LIMIT 1',
  ).bind(data.patientId, tenantId).first<{ id: number }>();
  if (!patientRow) throw new HTTPException(404, { message: 'Patient not found' });
  if (data.visitId != null) {
    const visitRow = await db.$client.prepare(
      'SELECT id FROM visits WHERE id = ? AND tenant_id = ? LIMIT 1',
    ).bind(data.visitId, tenantId).first<{ id: number }>();
    if (!visitRow) throw new HTTPException(404, { message: 'Visit not found' });
  }

  // ─── P0-13: idempotency ────────────────────────────────────────────────
  const idempotencyKey = data.idempotencyKey
    ?? `lab-order:${tenantId}:${userId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const requestHash = await createIdempotencyRequestHash({
    patientId: data.patientId,
    visitId: data.visitId ?? null,
    orderDate,
    items: data.items,
  });
  const replay = await reserveMutationIdempotencyKey(db.$client, {
    tenantId: String(tenantId),
    mutationType: 'lab_order_create',
    idempotencyKey,
    requestHash,
    createdBy: userId,
    mismatchMessage: 'Lab order idempotency key already used with different payload',
    conflictMessage: 'A duplicate lab order request is already in progress',
  });
  if (replay) {
    return c.json(replay.responseBody, 200);
  }

  try {
    await assertAccountingPeriodOpen(c.env.DB, tenantId, orderDate, 'Lab order billing');
    const labOrderColumns = await getTableColumns(c.env.DB, 'lab_orders');
    const labOrderItemColumns = await getTableColumns(c.env.DB, 'lab_order_items');
    const hasLabOrderUpdatedAt = labOrderColumns.has('updated_at');
    const hasItemSource = labOrderItemColumns.has('source');
    const orderNo = await getNextSequence(c.env.DB, tenantId!, 'lab_order', 'LO');

    // ─── P0-13: resolve test pricing BEFORE opening the order so we can ──
    // fail fast on missing/inactive tests without leaving a half-built order.
    const orderItems: Array<{
      testId: number;
      name: string;
      category: string | null;
      price: number;
      discount: number;
      lineTotal: number;
      billingServiceItemId: number | null;
    }> = [];
    let orderTotal = 0;
    for (const item of data.items) {
      const test = await resolveLabTestBillingRow(c.env.DB, tenantId, item.labTestId);
      if (!test) throw new HTTPException(400, { message: `Lab test ${item.labTestId} not found` });

      const discount = item.discount;
      const lineTotal = Math.max(0, test.price - discount);
      orderTotal += lineTotal;

      orderItems.push({
        testId: test.id,
        name: test.name,
        category: test.category ?? null,
        price: test.price,
        discount,
        lineTotal,
        billingServiceItemId: test.billingServiceItemId,
      });
    }

    // ─── Auto-generate bill from lab order (Danphe-style unified billing) ──
    const activeFy = await getActiveFiscalYear(c.env.DB, tenantId!, orderDate);
    let invoiceNo: string;
    let fiscalYearId: number | null = null;
    const invoiceCode = 'BL';

    if (activeFy) {
      invoiceNo = await getNextFiscalInvoiceNo(c.env.DB, tenantId!, activeFy.id, invoiceCode);
      fiscalYearId = activeFy.id;
    } else {
      invoiceNo = await getNextInvoiceNumber(c.env.DB, tenantId!, 'diagnostic');
      console.warn(`[lab] No active fiscal year for tenant ${tenantId}; falling back to legacy sequence`);
    }

    const categoryTotals = calculateBillCategoryTotals([{ category: 'test', amount: orderTotal }]);
    const orderingClinicianDoctorId = await resolveOrderingClinicianDoctorId(c.env.DB, tenantId, {
      enteredByUserId: userId,
      visitId: data.visitId ?? null,
    });

    const duplicateCounts = new Map<number, number>();
    const resolvedOrderItems = orderItems.map((item, index) => {
      const duplicateOrdinal = duplicateCounts.get(item.testId) ?? 0;
      duplicateCounts.set(item.testId, duplicateOrdinal + 1);
      return { ...item, lineNumber: index + 1, duplicateOrdinal };
    });
    const orderedAtUtc = new Date(`${orderDate}T00:00:00+06:00`).toISOString();
    const billingFinalizationInput = {
      tenantId: String(tenantId),
      operationKey: `lab-billing:${orderNo}:${invoiceNo}`,
      userId: Number(userId),
      patientId: data.patientId,
      visitId: data.visitId ?? null,
      orderNo,
      orderDate,
      orderingClinicianDoctorId,
      invoiceNo,
      fiscalYearId,
      invoiceCode,
      orderTotal,
      categoryTotals: {
        testBill: categoryTotals.testBill ?? 0,
        admissionBill: categoryTotals.admissionBill ?? 0,
        doctorVisitBill: categoryTotals.doctorVisitBill ?? 0,
        operationBill: categoryTotals.operationBill ?? 0,
        medicineBill: categoryTotals.medicineBill ?? 0,
      },
      hasItemSource,
      hasLabOrderUpdatedAt,
      items: resolvedOrderItems,
    };
    const strictAuthoritativeStatements = () => prepareLabBillingStrictStatements(
      db.$client,
      billingFinalizationInput,
    ).statements;

    let financialExecution: Awaited<ReturnType<typeof executeStrictFinancialMutation>>;
    try {
      financialExecution = await executeStrictFinancialMutation({
        db: c.env.DB,
        tenantId: String(tenantId),
        boundary: 'lab.billing.create',
        legacyExecutor: () => executeLabBillingOriginalLegacy(db.$client, billingFinalizationInput),
        strictAuthoritativeStatements,
        canonical: async (execution) => {
          const canonicalItems = resolvedOrderItems.map((item) => {
            if (!item.billingServiceItemId) {
              throw new Error(`Canonical billing service mapping is unavailable for lab test ${item.testId}`);
            }
            return {
              lineNumber: item.lineNumber,
              duplicateOrdinal: item.duplicateOrdinal,
              labTestId: item.testId,
              billingServiceItemId: item.billingServiceItemId,
              name: item.name,
              category: item.category,
              grossMinor: Number(toMinorUnits(item.price)),
              discountMinor: Number(toMinorUnits(item.discount)),
            };
          });
          return createLabOrderBilling(c.env.DB, {
            tenantId: String(tenantId),
            commandIdempotencyKey: `lab-order-billing:${orderNo}:${invoiceNo}`,
            orderNo,
            invoiceNo,
            legacyPatientId: data.patientId,
            legacyVisitId: data.visitId ?? null,
            orderingClinicianDoctorId,
            orderedAtUtc,
            businessDate: orderDate,
            items: canonicalItems,
          }, { authoritativeStatements: execution.authoritativeStatements });
        },
      });
    } catch (error) {
      if (isFinancialBatchAssertionError(error) || isLabCanonicalConflict(error)) {
        await markMutationIdempotencyKeyFailed(db.$client, {
          tenantId: String(tenantId),
          mutationType: 'lab_order_create',
          idempotencyKey,
        });
        throw new HTTPException(409, {
          message: 'Lab billing changed concurrently or canonical authority is unavailable. Refresh and try again.',
        });
      }
      throw error;
    }

    const legacyBatchResults = financialExecution.mode === 'strict'
      ? []
      : financialExecution.result as Array<{ meta?: { last_row_id?: number } }>;
    let orderId = Number(legacyBatchResults[0]?.meta?.last_row_id ?? 0);
    let billId = Number(legacyBatchResults[1]?.meta?.last_row_id ?? 0);
    if (!(orderId > 0)) {
      const orderRow = await db.$client.prepare(
        'SELECT id FROM lab_orders WHERE tenant_id = ? AND order_no = ? ORDER BY id DESC LIMIT 1',
      ).bind(tenantId, orderNo).first<{ id: number }>();
      orderId = Number(orderRow?.id ?? 0);
    }
    if (!(billId > 0)) {
      const billRow = await db.$client.prepare(
        'SELECT id FROM bills WHERE tenant_id = ? AND invoice_no = ? ORDER BY id DESC LIMIT 1',
      ).bind(tenantId, invoiceNo).first<{ id: number }>();
      billId = Number(billRow?.id ?? 0);
    }
    if (!(orderId > 0) || !(billId > 0)) {
      throw new Error('Committed lab order or bill could not be resolved');
    }

    try {
      const actualItemRows = (await db.$client.prepare(`
        SELECT loi.id AS lab_order_item_id,loi.lab_test_id,ii.id AS bill_item_id
        FROM lab_order_items loi
        JOIN invoice_items ii
          ON ii.bill_id=? AND ii.reference_id=loi.id AND ii.tenant_id=?
        WHERE loi.lab_order_id=? AND loi.tenant_id=?
        ORDER BY loi.id
      `).bind(billId, tenantId, orderId, tenantId).all<{
        lab_order_item_id: number;
        lab_test_id: number;
        bill_item_id: number;
      }>()).results ?? [];
      if (actualItemRows.length !== resolvedOrderItems.length) {
        throw new Error('Committed lab order item identities could not be resolved');
      }
      const loadedCanonicalItems = await loadCanonicalBillPerformerItems(c.env.DB, {
        tenantId: String(tenantId),
        billId,
      });
      const canonicalItemsOverride = loadedCanonicalItems.map((item, index) => ({
        ...item,
        referenceId: resolvedOrderItems[index]?.billingServiceItemId ?? item.referenceId,
      }));

      if (orderTotal > 0) {
        await recordBillFinalizationSideEffects(c.env.DB, {
          tenantId,
          userId,
          patientId: data.patientId,
          visitId: data.visitId ?? null,
          billId,
          invoiceNo,
          billDate: orderDate,
          subtotal: orderTotal,
          discount: 0,
          total: orderTotal,
          categoryTotals,
          extraPayload: { labOrderId: orderId },
          skipBillAccountingEvent: financialExecution.mode === 'strict',
          canonicalItemsOverride,
          items: resolvedOrderItems.map((oi, index) => {
            const row = actualItemRows[index];
            const billingServiceItemId = oi.billingServiceItemId;
            return {
              itemCategory: 'test',
              description: oi.name,
              lineTotal: oi.lineTotal,
              grossLineTotal: oi.price,
              referenceId: billingServiceItemId,
              billItemId: Number(row.bill_item_id),
              labTestId: oi.testId,
            };
          }),
        });
      }

      await accrueLabOrderDoctorCommissions(c.env.DB, {
        tenantId,
        userId,
        patientId: data.patientId,
        visitId: data.visitId ?? null,
        billId,
        labOrderId: orderId,
        orderDate,
        items: resolvedOrderItems.map((oi, index) => {
          const row = actualItemRows[index];
          return {
            labOrderItemId: Number(row.lab_order_item_id),
            labTestId: oi.testId,
            category: oi.category,
            lineTotal: oi.lineTotal,
          };
        }),
      });
    } catch (error) {
      console.error('[lab] order billing committed; post-commit reserve or commission side-effect failed:', error);
    }
    queueLabAccountingPosting(c, tenantId);

    void createAuditLog(c.env, tenantId!, userId!, 'CREATE', 'lab_orders', orderId, null, { orderNo, total: orderTotal, itemCount: data.items.length });

    const responseBody: Record<string, unknown> = {
      message: 'Lab order created',
      orderId,
      orderNo,
      billId,
      invoiceNo,
      total: orderTotal,
    };

    await completeMutationIdempotencyKey(db.$client, {
      tenantId: String(tenantId),
      mutationType: 'lab_order_create',
      idempotencyKey,
      sourceId: orderId,
      responseBody,
    });

    return c.json(responseBody, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    await markMutationIdempotencyKeyFailed(db.$client, {
      tenantId: String(tenantId),
      mutationType: 'lab_order_create',
      idempotencyKey,
    });
    console.error('[lab] create order error:', error);
    throw new HTTPException(500, { message: 'Failed to create lab order' });
  }
});

/**
 * PUT /api/lab/items/:itemId/result
 * Records or updates the result for a single lab test item.
 * Marks the item status as 'completed' and sets the completion timestamp.
 *
 * @param {string} itemId - The ID of the lab order item.
 * @param {Object} body - Validated data containing the test result.
 * @returns {Object} JSON response indicating success.
 * @throws {HTTPException} 404 if the lab order item is not found.
 * @throws {HTTPException} 500 if the result update fails.
 *
 * @example
 * // PUT /api/lab/items/789/result
 * // Body: { "result": "Normal" }
 */
labCatalogRoutes.put('/items/:itemId/result', zValidator('json', updateLabItemResultSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const itemId = c.req.param('itemId');
  const data = c.req.valid('json');

  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, lo.patient_id, ${getDiagnosticBillingColumns('lo')},
              p.gender, p.date_of_birth, ltc.normal_range, ltc.critical_low, ltc.critical_high
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       JOIN patients p ON lo.patient_id = p.id
       LEFT JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id AND ltc.tenant_id = lo.tenant_id
       WHERE loi.id = ? AND lo.tenant_id = ?`,
    ).bind(itemId, tenantId).first<LabOrderItemVerificationRow>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'entering lab results');

    // Validate item status allows result entry
    const itemStatusAtEntry = String((item as { status?: string }).status ?? 'pending');
    const allowedForResult = ['collected', 'received', 'processing'];
    if (!allowedForResult.includes(itemStatusAtEntry)) {
      throw new HTTPException(400, {
        message: `Cannot enter results for item in '${itemStatusAtEntry}' status. Item must be in: ${allowedForResult.join(', ')}`,
      });
    }

    // Parse numeric value from result string
    const numericValue = parseFloat(data.result);
    const resultNumeric = isNaN(numericValue) ? null : numericValue;

    // Calculate patient age in months
    const dob = item.date_of_birth as string | null;
    const ageMonths = dob
      ? Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
      : 0;

    // Try structured reference range first
    let abnormalFlag: string;
    if (resultNumeric !== null && item.gender) {
      const structuredRange = await getStructuredReferenceRange(
        db, Number(tenantId), item.lab_test_id as number, data.component_id ?? null,
        item.gender as string, ageMonths
      );
      if (structuredRange && structuredRange.range_low !== null && structuredRange.range_high !== null) {
        abnormalFlag = determineAbnormalFromRange(
          resultNumeric, structuredRange.range_low, structuredRange.range_high,
          structuredRange.critical_low, structuredRange.critical_high
        );
      } else {
        abnormalFlag = detectAbnormalFlag(
          resultNumeric ?? undefined,
          item.normal_range as string | null,
          item.critical_low as number | null,
          item.critical_high as number | null,
        );
      }
    } else {
      abnormalFlag = detectAbnormalFlag(
        resultNumeric ?? undefined,
        item.normal_range as string | null,
        item.critical_low as number | null,
        item.critical_high as number | null,
      );
    }

    // Delta check
    let previousValue: string | null = null;
    let deltaFlag: string | null = null;
    if (resultNumeric !== null) {
      const prev = await getPreviousResult(db, Number(tenantId), item.patient_id as number, item.lab_test_id as number, data.component_id ?? null);
      if (prev && prev.result_numeric !== null && prev.result_numeric !== undefined) {
        previousValue = prev.result_value;
        deltaFlag = calculateDelta(resultNumeric, prev.result_numeric);
      } else {
        deltaFlag = 'new';
      }
    }

    // Run custom validation rules
    const validation = await validateLabResult(
      db, Number(tenantId),
      item.lab_test_id as number,
      data.component_id ?? null,
      data.result,
      resultNumeric,
      (item.patient_id as number) ?? null
    );
    if (validation.blocking.length > 0) {
      throw new HTTPException(400, { message: `Validation failed: ${validation.blocking.join('; ')}` });
    }

    const currentStatus = itemStatusAtEntry;
    const isDraft = data.is_draft === true;

    // Result finalization can trigger reagent usage for full-LIS/result-time tenants.
    // Billing-time no-LIS tenants skip this path; idempotency still prevents double deduction.
    const labInventoryPolicy = await getLabInventoryPolicy(c.env.DB, tenantId);
    const consumeReagentsOnResult = await shouldConsumeLabReagentsForEvent(c.env.DB, tenantId, 'result');
    if (consumeReagentsOnResult && !isDraft && !['completed', 'verified'].includes(currentStatus)) {
      try {
        await consumeMappedLabConsumables(c.env.DB, {
          tenantId,
          userId: requireUserId(c),
          labOrderItemId: Number(itemId),
          labOrderId: item.lab_order_id as number,
          labTestId: item.lab_test_id as number,
          requireMapping: labInventoryPolicy.require_test_mapping_for_completion,
        });
      } catch (error) {
        if (shouldBlockLabInventoryException(labInventoryPolicy, 'result')) throw error;
      }
    }

    if (isDraft) {
      // Draft: save result but keep current status (don't change to completed)
      await db.$client.prepare(
        `UPDATE lab_order_items SET result = ?, result_numeric = ?, abnormal_flag = ?, result_status = 'draft'
         WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`,
      ).bind(data.result, resultNumeric, abnormalFlag, itemId, tenantId).run();

      const entryUserId = requireUserId(c);
      await recordLabWorkflowEvent(c.env.DB, {
        tenantId,
        userId: entryUserId,
        actorRole: c.get('role') ?? null,
        eventType: 'result_draft',
        eventStage: 'result_entry',
        labOrderId: Number(item.lab_order_id ?? 0) || null,
        labOrderItemId: Number(itemId),
        patientId: Number(item.patient_id ?? 0) || null,
        fromStatus: currentStatus,
        toStatus: currentStatus,
        notes: null,
        metadata: { abnormal_flag: abnormalFlag, delta_flag: deltaFlag },
      });

      void createAuditLog(c.env, tenantId!, entryUserId, 'RESULT', 'lab_order_items', Number(itemId), null, { result: data.result, abnormal_flag: abnormalFlag, stage: 'draft' });

      return c.json({ message: 'Draft saved', draft: true, abnormal_flag: abnormalFlag, delta_flag: deltaFlag });
    }

    // Final submission: set status to completed
    await db.$client.prepare(
      `UPDATE lab_order_items SET result = ?, result_numeric = ?, abnormal_flag = ?, status = 'completed', completed_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`,
    ).bind(data.result, resultNumeric, abnormalFlag, itemId, tenantId).run();

    // Also insert/update lab_results record for delta tracking
    let report = await db.$client.prepare(
      'SELECT id FROM lab_reports WHERE lab_order_id = ? AND tenant_id = ?'
    ).bind(item.lab_order_id, tenantId).first<{ id: number }>();
    if (!report) {
      const reportResult = await db.$client.prepare(
        `INSERT INTO lab_reports (lab_order_id, reported_by, review_status, tenant_id, created_at)
         VALUES (?, ?, 'pending', ?, datetime('now', '+6 hours'))`
      ).bind(item.lab_order_id, requireUserId(c), tenantId).run();
      report = { id: reportResult.meta.last_row_id as number };
    }

    await db.$client.prepare(
      `INSERT INTO lab_results (lab_report_id, lab_test_id, component_id, result_value, result_numeric, abnormal_flag, previous_value, delta_flag, result_status, tenant_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'final', ?, datetime('now', '+6 hours'))`
    ).bind(report.id, item.lab_test_id, data.component_id ?? null, data.result, resultNumeric, abnormalFlag, previousValue, deltaFlag, tenantId).run();

    // Auto-update parent lab_orders status when all items are completed/verified
    const orderId = item.lab_order_id as number;
    const counts = await db.$client.prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'completed' OR status = 'verified' THEN 1 ELSE 0 END) as done
       FROM lab_order_items WHERE lab_order_id = ?`
    ).bind(orderId).first<{ total: number; done: number }>();
    if (counts && counts.total === counts.done) {
      await db.$client.prepare(
        `UPDATE lab_orders SET status = 'completed' WHERE id = ? AND tenant_id = ?`
      ).bind(orderId, tenantId).run();
    }

    const entryUserId = requireUserId(c);
    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId: entryUserId,
      actorRole: c.get('role') ?? null,
      eventType: 'result_entered',
      eventStage: 'result_entry',
      labOrderId: Number(item.lab_order_id ?? 0) || null,
      labOrderItemId: Number(itemId),
      patientId: Number(item.patient_id ?? 0) || null,
      fromStatus: currentStatus,
      toStatus: 'completed',
      notes: null,
      metadata: { abnormal_flag: abnormalFlag, delta_flag: deltaFlag },
    });

    void createAuditLog(c.env, tenantId!, entryUserId, 'RESULT', 'lab_order_items', Number(itemId), null, { result: data.result, abnormal_flag: abnormalFlag, delta_flag: deltaFlag });

    return c.json({ message: 'Result entered', abnormal_flag: abnormalFlag, delta_flag: deltaFlag });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update result' });
  }
});

/**
 * POST /api/lab/orders/:id/print
 * Increments the print count for a specific lab order and updates the last printed timestamp.
 *
 * @param {string} id - The ID of the lab order.
 * @returns {Object} JSON response indicating success.
 * @throws {HTTPException} 500 if the print count update fails.
 *
 * @example
 * // POST /api/lab/orders/456/print
 */
labCatalogRoutes.post('/orders/:id/print', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    await db.$client.prepare(
      `UPDATE lab_orders SET print_count = print_count + 1, last_printed_at = datetime('now', '+6 hours')
       WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).run();
    return c.json({ message: 'Print count updated' });
  } catch {
    throw new HTTPException(500, { message: 'Failed to update print count' });
  }
});

// ─── ENTERPRISE SPECIMEN / ACCESSION WORKFLOW ───────────────────────────────

labCatalogRoutes.get('/orders/:orderId/specimens', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const orderId = Number(c.req.param('orderId'));

  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new HTTPException(400, { message: 'Invalid lab order ID' });
  }

  const order = await db.$client.prepare(
    'SELECT id FROM lab_orders WHERE id = ? AND tenant_id = ?'
  ).bind(orderId, tenantId).first<{ id: number }>();
  if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

  const { results } = await db.$client.prepare(`
    SELECT s.*,
           u1.name AS collected_by_name,
           u2.name AS received_by_name,
           COUNT(si.id) AS item_count
    FROM lab_specimens s
    LEFT JOIN users u1 ON u1.id = s.collected_by
    LEFT JOIN users u2 ON u2.id = s.received_by
    LEFT JOIN lab_specimen_items si ON si.specimen_id = s.id AND si.tenant_id = s.tenant_id
    WHERE s.lab_order_id = ? AND s.tenant_id = ?
    GROUP BY s.id
    ORDER BY s.created_at DESC
  `).bind(orderId, tenantId).all();

  return c.json({ specimens: results });
});

labCatalogRoutes.get('/specimens/:specimenId/events', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const specimenId = Number(c.req.param('specimenId'));

  if (!Number.isFinite(specimenId) || specimenId <= 0) {
    throw new HTTPException(400, { message: 'Invalid specimen ID' });
  }

  const specimen = await db.$client.prepare(
    'SELECT id FROM lab_specimens WHERE id = ? AND tenant_id = ?'
  ).bind(specimenId, tenantId).first<{ id: number }>();
  if (!specimen) throw new HTTPException(404, { message: 'Specimen not found' });

  const { results } = await db.$client.prepare(`
    SELECT e.*, u.name AS actor_name
    FROM lab_specimen_events e
    LEFT JOIN users u ON u.id = e.actor_user_id
    WHERE e.specimen_id = ? AND e.tenant_id = ?
    ORDER BY e.created_at DESC
  `).bind(specimenId, tenantId).all();

  return c.json({ events: results });
});

labCatalogRoutes.post('/orders/:orderId/specimens/collect', requireRole(...LAB_SAMPLE_COLLECT_ROLES), zValidator('json', collectLabSpecimenSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const orderId = Number(c.req.param('orderId'));
  const data = c.req.valid('json');

  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new HTTPException(400, { message: 'Invalid lab order ID' });
  }

  try {
    const order = await db.$client.prepare(`
      SELECT lo.id, lo.patient_id, lo.order_no, lo.priority, lo.specimen_type, ${getDiagnosticBillingColumns('lo')}
      FROM lab_orders lo
      ${getDiagnosticBillingJoin('lo')}
      WHERE lo.id = ? AND lo.tenant_id = ?
    `).bind(orderId, tenantId).first<Record<string, unknown>>();

    if (!order) throw new HTTPException(404, { message: 'Lab order not found' });
    assertDiagnosticBillCleared(order, 'collecting lab specimen');

    const requestedItemIds = data.labOrderItemIds ?? [];
    const itemBinds: Array<string | number> = [orderId, tenantId];
    let itemFilter = '';
    if (requestedItemIds.length > 0) {
      itemFilter = ` AND loi.id IN (${requestedItemIds.map(() => '?').join(',')})`;
      itemBinds.push(...requestedItemIds);
    }

    const itemRows = await db.$client.prepare(`
      SELECT loi.id, loi.lab_test_id, loi.status, loi.barcode,
             ltc.specimen_type AS catalog_specimen_type,
             ltc.specimen_container AS catalog_container_type
      FROM lab_order_items loi
      JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = loi.tenant_id
      WHERE loi.lab_order_id = ? AND loi.tenant_id = ?
        AND COALESCE(loi.status, 'pending') NOT IN ('cancelled', 'verified')
        ${itemFilter}
      ORDER BY loi.id ASC
    `).bind(...itemBinds).all<Record<string, unknown>>();

    const items = itemRows.results ?? [];
    if (items.length === 0) {
      throw new HTTPException(400, { message: 'No collectible lab order items found' });
    }
    if (requestedItemIds.length > 0 && items.length !== requestedItemIds.length) {
      throw new HTTPException(400, { message: 'One or more selected lab items are not collectible for this order' });
    }

    const accessionNo = await getNextSequence(c.env.DB, tenantId, 'lab_specimen', 'SPC');
    const specimenBarcode = data.specimen_barcode ?? accessionNo;
    const firstItem = items[0] ?? {};
    const specimenType = data.specimen_type ?? String(firstItem.catalog_specimen_type ?? order.specimen_type ?? '');
    const containerType = data.container_type ?? String(firstItem.catalog_container_type ?? '');

    const specimenResult = await db.$client.prepare(`
      INSERT INTO lab_specimens (
        tenant_id, lab_order_id, patient_id, accession_no, specimen_barcode,
        specimen_type, container_type, collection_site, collection_priority,
        fasting_status, collection_status, collected_by, collected_at, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'collected', ?, datetime('now', '+6 hours'), ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      orderId,
      Number(order.patient_id),
      accessionNo,
      specimenBarcode,
      specimenType || null,
      containerType || null,
      data.collection_site ?? null,
      data.collection_priority,
      data.fasting_status ?? null,
      userId,
      data.notes ?? null,
      userId,
    ).run();

    const specimenId = specimenResult.meta.last_row_id as number;

    for (const item of items) {
      const itemId = Number(item.id);
      const testId = Number(item.lab_test_id);
      const fromStatus = String(item.status ?? 'pending');

      await db.$client.prepare(`
        INSERT OR IGNORE INTO lab_specimen_items
          (tenant_id, specimen_id, lab_order_item_id, lab_test_id, is_primary, created_at)
        VALUES (?, ?, ?, ?, 1, datetime('now', '+6 hours'))
      `).bind(tenantId, specimenId, itemId, testId).run();

      await db.$client.prepare(`
        UPDATE lab_order_items
        SET specimen_id = ?,
            accession_no = ?,
            barcode = COALESCE(NULLIF(barcode, ''), ?),
            specimen_type = COALESCE(?, specimen_type),
            sample_container = COALESCE(?, sample_container),
            status = CASE WHEN COALESCE(status, 'pending') IN ('pending', 'rejected') THEN 'collected' ELSE status END,
            collected_at = COALESCE(collected_at, datetime('now', '+6 hours')),
            updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ?
      `).bind(specimenId, accessionNo, specimenBarcode, specimenType || null, containerType || null, itemId, tenantId).run();

      await recordLabWorkflowEvent(c.env.DB, {
        tenantId,
        userId,
        actorRole: role ?? null,
        eventType: 'specimen_collected',
        eventStage: 'specimen',
        labOrderId: orderId,
        labOrderItemId: itemId,
        patientId: Number(order.patient_id),
        fromStatus,
        toStatus: fromStatus === 'pending' || fromStatus === 'rejected' ? 'collected' : fromStatus,
        notes: data.notes ?? null,
        metadata: { specimenId, accessionNo, specimenBarcode },
      });
    }

    await db.$client.prepare(`
      INSERT INTO lab_specimen_events (
        tenant_id, specimen_id, lab_order_id, event_type, to_status,
        actor_user_id, actor_role, location, notes, metadata_json, created_at
      ) VALUES (?, ?, ?, 'specimen_collected', 'collected', ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      specimenId,
      orderId,
      userId,
      role ?? null,
      data.collection_site ?? null,
      data.notes ?? null,
      JSON.stringify({ itemIds: items.map((item) => Number(item.id)), accessionNo, specimenBarcode }),
    ).run();

    void createAuditLog(c.env, tenantId, userId, 'CREATE', 'lab_specimens', specimenId, null, {
      labOrderId: orderId,
      accessionNo,
      specimenBarcode,
      itemCount: items.length,
    });

    return c.json({
      message: 'Specimen collected',
      specimen: {
        id: specimenId,
        accessionNo,
        specimenBarcode,
        status: 'collected',
        itemCount: items.length,
      },
    }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to collect specimen' });
  }
});

labCatalogRoutes.post('/specimens/:specimenId/receive', requireRole(...LAB_SAMPLE_COLLECT_ROLES), zValidator('json', receiveLabSpecimenSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const specimenId = Number(c.req.param('specimenId'));
  const data = c.req.valid('json');

  if (!Number.isFinite(specimenId) || specimenId <= 0) {
    throw new HTTPException(400, { message: 'Invalid specimen ID' });
  }

  try {
    const specimen = await db.$client.prepare(
      'SELECT * FROM lab_specimens WHERE id = ? AND tenant_id = ?'
    ).bind(specimenId, tenantId).first<Record<string, unknown>>();

    if (!specimen) throw new HTTPException(404, { message: 'Specimen not found' });
    if (String(specimen.collection_status) === 'rejected') {
      throw new HTTPException(409, { message: 'Rejected specimens cannot be received without recollection' });
    }

    await db.$client.prepare(`
      UPDATE lab_specimens
      SET collection_status = 'received',
          received_by = ?,
          received_at = COALESCE(received_at, datetime('now', '+6 hours')),
          transport_condition = COALESCE(?, transport_condition),
          storage_location = COALESCE(?, storage_location),
          notes = COALESCE(?, notes),
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(userId, data.transport_condition ?? null, data.storage_location ?? null, data.notes ?? null, specimenId, tenantId).run();

    await db.$client.prepare(`
      UPDATE lab_order_items
      SET status = CASE WHEN status = 'collected' THEN 'received' ELSE status END,
          received_by = COALESCE(received_by, ?),
          received_at = COALESCE(received_at, datetime('now', '+6 hours')),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id IN (
          SELECT lab_order_item_id FROM lab_specimen_items WHERE tenant_id = ? AND specimen_id = ?
        )
    `).bind(userId, tenantId, tenantId, specimenId).run();

    await db.$client.prepare(`
      INSERT INTO lab_specimen_events (
        tenant_id, specimen_id, lab_order_id, event_type, from_status, to_status,
        actor_user_id, actor_role, location, notes, metadata_json, created_at
      ) VALUES (?, ?, ?, 'specimen_received', ?, 'received', ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      specimenId,
      Number(specimen.lab_order_id),
      String(specimen.collection_status ?? 'collected'),
      userId,
      role ?? null,
      data.location ?? null,
      data.notes ?? null,
      JSON.stringify({ transportCondition: data.transport_condition ?? null, storageLocation: data.storage_location ?? null }),
    ).run();

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: role ?? null,
      eventType: 'specimen_received',
      eventStage: 'specimen',
      labOrderId: Number(specimen.lab_order_id),
      patientId: Number(specimen.patient_id ?? 0) || null,
      fromStatus: String(specimen.collection_status ?? 'collected'),
      toStatus: 'received',
      notes: data.notes ?? null,
      metadata: { specimenId },
    });

    void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'lab_specimens', specimenId, specimen, {
      status: 'received',
      location: data.location ?? null,
    });

    return c.json({ message: 'Specimen received', specimenId, status: 'received' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to receive specimen' });
  }
});

// ─── PATCH /api/lab/items/:itemId/sample-status ──────────────────────────────

labCatalogRoutes.patch('/items/:itemId/sample-status', zValidator('json', updateSampleStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const itemId = c.req.param('itemId');
  const data = c.req.valid('json');

  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, ${getDiagnosticBillingColumns('lo')}
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       WHERE loi.id = ? AND lo.tenant_id = ?`
    ).bind(itemId, tenantId).first<{ status: string }>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'updating sample status');

    // Enforce valid state transitions (forward-only workflow)
    const validTransitions: Record<string, string[]> = {
      pending: ['collected', 'rejected'],
      collected: ['received', 'rejected'],
      received: ['processing', 'rejected'],
      processing: ['completed', 'rejected'],
      completed: ['verified'],
      verified: [],
      rejected: [],
    };
    const currentStatus = (item.status as string) || 'pending';
    const allowed = validTransitions[currentStatus] || [];
    if (!allowed.includes(data.status)) {
      throw new HTTPException(400, {
        message: `Invalid transition: ${currentStatus} → ${data.status}. Allowed: ${allowed.join(', ') || 'none'}`,
      });
    }

    await db.$client.prepare(
      `UPDATE lab_order_items SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`
    ).bind(data.status, data.notes ?? null, itemId, tenantId).run();

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: role ?? null,
      eventType: 'sample_status_updated',
      eventStage: 'legacy_status_update',
      labOrderId: Number((item as { lab_order_id?: number }).lab_order_id ?? 0) || null,
      labOrderItemId: Number(itemId),
      patientId: Number((item as { patient_id?: number }).patient_id ?? 0) || null,
      fromStatus: currentStatus,
      toStatus: data.status,
      notes: data.notes ?? null,
    });
    void createAuditLog(c.env, tenantId, userId, 'UPDATE_STATUS', 'lab_order_items', Number(itemId), item, {
      status: data.status,
      notes: data.notes ?? null,
    });
    return c.json({ message: `Sample status updated to ${data.status}` });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update sample status' });
  }
});

// ─── PATCH /api/lab/items/:itemId/cancel ─────────────────────────────────────

labCatalogRoutes.patch('/items/:itemId/cancel', zValidator('json', cancelLabItemSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const itemId = Number(c.req.param('itemId'));
  const data = c.req.valid('json');
  const today = getTodayGMT6();

  if (!Number.isFinite(itemId) || itemId <= 0) {
    throw new HTTPException(400, { message: 'Invalid lab item ID' });
  }

  try {
    const existingCancellation = await findLabCancellationOperation(c.env.DB, { tenantId, itemId });
    if (!existingCancellation || existingCancellation.status === 'processing' || existingCancellation.status === 'failed') {
      await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Lab item cancellation');
    }
    const result = await cancelLabOrderItem(c.env.DB, {
      tenantId,
      userId,
      itemId,
      reason: data.reason,
      notes: data.notes ?? null,
    });

    if (result.billId && result.cancelledAmount > 0) {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'billing_item_cancellation',
        sourceId: `${result.billId}:lab-item:${result.itemId}`,
        eventType: ACCOUNTING_EVENT_TYPES.billCancelled,
        eventDate: result.operationDate,
        createdBy: userId,
        payload: {
          billId: result.billId,
          itemIds: [result.itemId],
          labOrderId: result.labOrderId,
          total: result.cancelledAmount,
          discount: 0,
          testBill: result.cancelledAmount,
          doctorVisitBill: 0,
          admissionBill: 0,
          operationBill: 0,
          medicineBill: 0,
          reason: data.reason,
        },
      });
      queueLabAccountingPosting(c, tenantId);
    }

    void createAuditLog(c.env, tenantId, userId, 'CANCEL', 'lab_order_items', result.itemId, null, {
      billId: result.billId,
      labOrderId: result.labOrderId,
      cancelledAmount: result.cancelledAmount,
      reason: data.reason,
    });

    return c.json({
      message: 'Lab item cancelled',
      itemId: result.itemId,
      labOrderId: result.labOrderId,
      billId: result.billId,
      cancelledAmount: result.cancelledAmount,
      newBillTotal: result.newBillTotal,
      orderStatus: result.orderStatus,
      operationDate: result.operationDate,
      replayed: Boolean(result.replayed),
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to cancel lab item' });
  }
});

// ─── PATCH /api/lab/items/:itemId/reject ─────────────────────────────────────

labCatalogRoutes.patch('/items/:itemId/reject', zValidator('json', rejectSampleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const itemId = c.req.param('itemId');
  const data = c.req.valid('json');

  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, ${getDiagnosticBillingColumns('lo')}
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       WHERE loi.id = ? AND lo.tenant_id = ?`
    ).bind(itemId, tenantId).first<{ status: string }>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'rejecting a sample');

    const currentStatus = (item.status as string) || 'pending';
    const allowed = ['pending', 'collected', 'received', 'processing'];
    if (!allowed.includes(currentStatus)) {
      throw new HTTPException(400, {
        message: `Cannot reject sample in status '${currentStatus}'. Only samples in ${allowed.join(', ')} can be rejected.`,
      });
    }

    await db.$client.prepare(
      `UPDATE lab_order_items
       SET status = 'rejected',
           rejection_reason_id = ?,
           rejected_by = ?,
           rejected_at = datetime('now', '+6 hours'),
           rejection_notes = COALESCE(?, rejection_notes),
           updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`
    ).bind(data.rejection_reason_id, userId, data.notes ?? null, itemId, tenantId).run();

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: c.get('role') ?? null,
      eventType: 'sample_rejected',
      eventStage: 'rejection',
      labOrderId: Number((item as { lab_order_id?: number }).lab_order_id ?? 0) || null,
      labOrderItemId: Number(itemId),
      patientId: Number((item as { patient_id?: number }).patient_id ?? 0) || null,
      fromStatus: currentStatus,
      toStatus: 'rejected',
      notes: data.notes ?? null,
      metadata: { rejection_reason_id: data.rejection_reason_id },
    });
    void createAuditLog(c.env, tenantId, userId, 'REJECT', 'lab_order_items', Number(itemId), item, {
      status: 'rejected',
      rejection_reason_id: data.rejection_reason_id,
      notes: data.notes ?? null,
    });

    return c.json({ message: 'Sample rejected' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to reject sample' });
  }
});

// ─── PATCH /api/lab/items/:itemId/recollect ──────────────────────────────────

labCatalogRoutes.patch('/items/:itemId/recollect', zValidator('json', recollectSampleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const itemId = c.req.param('itemId');
  const data = c.req.valid('json');

  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, ${getDiagnosticBillingColumns('lo')}
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       WHERE loi.id = ? AND lo.tenant_id = ?`
    ).bind(itemId, tenantId).first<{ status: string }>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'marking a sample for recollection');

    if ((item.status as string) !== 'rejected') {
      throw new HTTPException(400, {
        message: `Only rejected samples can be marked for recollection. Current status: ${item.status}`,
      });
    }

    await db.$client.prepare(
      `UPDATE lab_order_items
       SET status = 'pending',
           notes = COALESCE(?, notes),
           updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`
    ).bind(data.notes ?? null, itemId, tenantId).run();

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: c.get('role') ?? null,
      eventType: 'sample_recollection_requested',
      eventStage: 'recollection',
      labOrderId: Number((item as { lab_order_id?: number }).lab_order_id ?? 0) || null,
      labOrderItemId: Number(itemId),
      patientId: Number((item as { patient_id?: number }).patient_id ?? 0) || null,
      fromStatus: 'rejected',
      toStatus: 'pending',
      notes: data.notes ?? null,
    });
    void createAuditLog(c.env, tenantId, userId, 'RECOLLECT', 'lab_order_items', Number(itemId), item, {
      status: 'pending',
      notes: data.notes ?? null,
    });

    return c.json({ message: 'Sample marked for recollection' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to mark sample for recollection' });
  }
});

// ─── LIS Enterprise Endpoints ────────────────────────────────────────────────

/**
 * PATCH /api/lab/items/:itemId/verify
 * Restricted to doctors/pathologists. Marks an item as verified.
 */
labCatalogRoutes.patch('/items/:itemId/verify', requireRole(...LAB_REPORT_GOVERNANCE_ROLES), zValidator('json', verifyLabItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const itemId = c.req.param('itemId');
  
  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, ${getDiagnosticBillingColumns('lo')}
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       WHERE loi.id = ? AND lo.tenant_id = ?`
    ).bind(itemId, tenantId).first<LabOrderItemVerificationRow>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'verifying lab results');

    await db.$client.prepare(
      `UPDATE lab_order_items SET status = 'verified', verified_by = ?, verified_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`
    ).bind(userId, itemId, tenantId).run();

    // Accrue commission for the PERFORMER (verifying doctor)
    c.executionCtx.waitUntil(
      accrueLabVerificationCommissions(c.env.DB, {
        tenantId,
        userId,
        patientId: item.patient_id,
        visitId: item.visit_id,
        billId: item.bill_id,
        labOrderId: item.lab_order_id,
        labOrderItemId: Number(itemId),
        labTestId: item.lab_test_id,
        category: item.category,
        lineTotal: item.line_total ?? 0,
        verificationDate: getTodayGMT6(),
      }).catch(err => console.error('Failed to accrue performer commission:', err))
    );

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: c.get('role') ?? null,
      eventType: 'result_verified_legacy',
      eventStage: 'legacy_verification',
      labOrderId: item.lab_order_id,
      labOrderItemId: Number(itemId),
      patientId: item.patient_id,
      fromStatus: String(item.status ?? 'completed'),
      toStatus: 'verified',
      notes: c.req.valid('json').notes ?? null,
    });
    void createAuditLog(c.env, tenantId, userId, 'VERIFY', 'lab_order_items', Number(itemId), item, {
      status: 'verified',
      notes: c.req.valid('json').notes ?? null,
    });
    
    return c.json({ message: 'Lab result verified successfully' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to verify result' });
  }
});

/**
 * POST /api/lab/barcode/scan
 * Used by physical barcode scanners to quickly update a sample status.
 */
labCatalogRoutes.post('/barcode/scan', zValidator('json', barcodeScanSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  
  const statusMap: Record<string, string> = {
    'collect': 'collected',
    'process': 'processing',
    'complete': 'completed'
  };
  
  try {
    const item = await db.$client.prepare(
      `SELECT loi.id, loi.status, loi.lab_order_id, lo.patient_id, ${getDiagnosticBillingColumns('lo')}
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       WHERE loi.barcode = ? AND lo.tenant_id = ?`
    ).bind(data.barcode, tenantId).first<{ id: number; status: string; lab_order_id: number; patient_id: number }>();
    
    if (!item) throw new HTTPException(404, { message: 'Barcode not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'barcode sample processing');
    
    const newStatus = statusMap[data.action];
    const currentStatus = item.status || 'pending';
    
    if (!isLabStatusTransitionAllowed(currentStatus, newStatus)) {
      throw new HTTPException(409, {
        message: `Cannot transition from "${currentStatus}" to "${newStatus}"`,
      });
    }

    await db.$client.prepare(
      `UPDATE lab_order_items SET status = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND status = ?`
    ).bind(newStatus, item.id, currentStatus).run();

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: c.get('role') ?? null,
      eventType: 'barcode_scan',
      eventStage: 'barcode',
      labOrderId: item.lab_order_id,
      labOrderItemId: item.id,
      patientId: item.patient_id,
      fromStatus: currentStatus,
      toStatus: newStatus,
      notes: `Barcode scan: ${data.action}`,
    });

    void createAuditLog(c.env, tenantId, userId, 'BARCODE_SCAN', 'lab_order_items', item.id, { status: currentStatus }, {
      action: data.action,
      new_status: newStatus,
      barcode: data.barcode,
    });
    
    return c.json({ message: `Sample ${newStatus}`, item_id: item.id, status: newStatus });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Barcode scan failed' });
  }
});

/**
 * POST /api/lab/catalog/bulk-import
 * Imports a CSV file of lab tests.
 * Expects multipart/form-data with a 'file' field.
 */
labCatalogRoutes.post('/catalog/bulk-import', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  
  const body = await c.req.parseBody();
  const file = body['file'];
  const modeRaw = body['mode'] ?? body['import_mode'];
  const importMode = typeof modeRaw === 'string' && modeRaw === 'replace_all' ? 'replace_all' : 'upsert';
  
  if (!file || typeof file === 'string') {
    throw new HTTPException(400, { message: 'CSV file is required' });
  }
  
  try {
    const text = await file.text();
    const parsed = parseDiagnosticCatalogCsv(text);
    if (parsed.rows.length === 0) {
      throw new HTTPException(400, { message: 'CSV does not contain any valid diagnostic catalog rows' });
    }
    if (importMode === 'replace_all' && parsed.errors.length > 0) {
      throw new HTTPException(400, { message: 'Fix CSV row errors before using replace mode' });
    }
    let success = 0;
    let failed = parsed.errors.length;
    let replaced = 0;
    const errors = parsed.errors.map((error) => ({
      rowNumber: error.rowNumber,
      message: error.message,
    }));

    if (importMode === 'replace_all') {
      const existingLab = await db.$client.prepare(`
        SELECT COUNT(*) as total
        FROM lab_test_catalog
        WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
      `).bind(tenantId).first<{ total: number }>();
      const existingRadiology = await db.$client.prepare(`
        SELECT COUNT(*) as total
        FROM radiology_imaging_items
        WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
      `).bind(tenantId).first<{ total: number }>();
      replaced = Number(existingLab?.total ?? 0) + Number(existingRadiology?.total ?? 0);

      await db.$client.prepare(`
        UPDATE billing_service_items
        SET is_active = 0, updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND id IN (
            SELECT billing_service_item_id
            FROM lab_test_catalog
            WHERE tenant_id = ? AND billing_service_item_id IS NOT NULL
            UNION
            SELECT billing_service_item_id
            FROM radiology_imaging_items
            WHERE tenant_id = ? AND billing_service_item_id IS NOT NULL
          )
      `).bind(tenantId, tenantId, tenantId).run();

      await db.$client.prepare(`
        UPDATE lab_test_catalog
        SET is_active = 0
        WHERE tenant_id = ?
      `).bind(tenantId).run();

      await db.$client.prepare(`
        UPDATE radiology_imaging_items
        SET is_active = 0, updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
      `).bind(tenantId).run();
    }

    for (const row of parsed.rows) {
      try {
        const serviceItemId = await upsertDiagnosticBillingServiceItem(c.env.DB, {
          kind: row.kind,
          tenantId,
          userId,
          code: row.code,
          name: row.name,
          category: row.category,
          price: row.price,
          isActive: row.isActive,
        });

        if (row.kind === 'lab') {
          const existing = await db.$client.prepare(`
            SELECT id
            FROM lab_test_catalog
            WHERE tenant_id = ?
              AND (billing_service_item_id = ? OR code = ?)
            ORDER BY CASE WHEN billing_service_item_id = ? THEN 0 ELSE 1 END
            LIMIT 1
          `).bind(tenantId, serviceItemId, row.code, serviceItemId).first<{ id: number }>();

          if (existing?.id) {
            await db.$client.prepare(`
              UPDATE lab_test_catalog
              SET code = ?,
                  name = ?,
                  category = ?,
                  price = ?,
                  unit = ?,
                  normal_range = ?,
                  method = ?,
                  is_active = ?,
                  billing_service_item_id = ?
              WHERE id = ? AND tenant_id = ?
            `).bind(
              row.code,
              row.name,
              row.category,
              row.price,
              row.unit,
              row.normalRange,
              row.method,
              row.isActive,
              serviceItemId,
              existing.id,
              tenantId,
            ).run();
          } else {
            await db.$client.prepare(`
              INSERT INTO lab_test_catalog
                (code, name, category, price, unit, normal_range, method, is_active, tenant_id, billing_service_item_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).bind(
              row.code,
              row.name,
              row.category,
              row.price,
              row.unit,
              row.normalRange,
              row.method,
              row.isActive,
              tenantId,
              serviceItemId,
            ).run();
          }
        } else {
          await syncDiagnosticCatalogFromBillingServiceItem(c.env.DB, tenantId, serviceItemId, userId);
        }
        success++;
      } catch (error) {
        failed++;
        if (errors.length < 50) {
          errors.push({
            rowNumber: row.rowNumber,
            message: error instanceof Error ? error.message : 'Import failed',
          });
        }
      }
    }

    try {
      await db.$client.prepare(
         `INSERT INTO lab_bulk_import_logs (tenant_id, imported_by, file_name, total_records, successful_records, failed_records)
          VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(tenantId, userId, file.name, parsed.totalRows, success, failed).run();
    } catch (error) {
      console.warn('[lab] bulk import log skipped:', error instanceof Error ? error.message : error);
    }

    return c.json({ message: 'Import complete', mode: importMode, success, failed, replaced, total: parsed.totalRows, errors });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Bulk import failed' });
  }
});

/**
 * POST /api/lab/machine/receive
 * Webhook style endpoint to receive machine payloads (HL7 JSON format).
 */
labCatalogRoutes.post('/machine/receive', (c) => c.json({
  error: 'Legacy direct-write machine ingestion is disabled. Use the staged /api/lab-machines receive endpoints.',
  code: 'legacy_machine_endpoint_disabled',
}, 410));

// ─── Panel Management ────────────────────────────────────────────────────────

/**
 * GET /api/lab/panels
 * Lists all panels with their child (component) tests.
 *
 * @returns {Object} JSON response containing:
 *   - panels: Array of panel records, each with a `children` JSON array.
 *   - meta: Pagination metadata.
 */
labCatalogRoutes.get('/panels', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, offset } = getPagination(c);

  try {
    const countResult = await db.$client.prepare(
      `SELECT COUNT(*) as total FROM lab_test_catalog WHERE tenant_id = ? AND test_type = 'panel' AND is_active = 1`
    ).bind(tenantId).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const panels = await db.$client.prepare(`
      SELECT ltc.*,
        (SELECT json_group_array(json_object('id', c.id, 'code', c.code, 'name', c.name, 'unit', c.unit, 'normal_range', c.normal_range))
         FROM lab_test_catalog c WHERE c.parent_id = ltc.id AND c.is_active = 1 ORDER BY c.display_sequence
        ) as children
      FROM lab_test_catalog ltc
      WHERE ltc.tenant_id = ? AND ltc.test_type = 'panel' AND ltc.is_active = 1
      ORDER BY ltc.department, ltc.name
      LIMIT ? OFFSET ?
    `).bind(tenantId, limit, offset).all();

    // Parse children JSON strings
    const results = panels.results.map((p: Record<string, unknown>) => ({
      ...p,
      children: typeof p.children === 'string' ? JSON.parse(p.children as string) : p.children,
    }));

    return c.json({ panels: results, meta: paginationMeta(page, limit, total) });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch panels' });
  }
});

/**
 * GET /api/lab/tests/:testId/components
 * Returns child components of a panel/group test.
 * If the test has no components (single test), returns empty array.
 */
labCatalogRoutes.get('/tests/:testId/components', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const testId = parseInt(c.req.param('testId'), 10);
  if (Number.isNaN(testId) || testId <= 0) {
    throw new HTTPException(400, { message: 'Invalid test ID' });
  }

  const rows = await db.$client.prepare(`
    SELECT
      c.id as component_id,
      c.lab_test_id,
      c.component_name as test_name,
      c.unit,
      c.normal_range as reference_range,
      c.value_type,
      c.display_sequence,
      c.critical_low,
      c.critical_high,
      c.group_name,
      c.indentation_count,
      c.is_mandatory,
      c.is_auto_calculate
    FROM lab_test_components c
    WHERE c.lab_test_id = ? AND c.tenant_id = ? AND c.is_active = 1
    ORDER BY c.display_sequence
  `).bind(testId, tenantId).all();

  return c.json({ data: rows.results });
});

/**
 * POST /api/lab/panels
 * Creates a new panel with child component tests.
 * The parent record is created as test_type='panel', and child tests are
 * updated to set parent_id and test_type='component'.
 *
 * @param {Object} body - Validated panel data including childTestIds.
 * @returns {Object} JSON response with the new panel ID.
 */
labCatalogRoutes.post('/panels', zValidator('json', createPanelSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const serviceItemId = await syncLabTestBillingServiceItem(c.env.DB, tenantId, data.code, {
      code: data.code,
      name: data.name,
      category: nullableText(data.category),
      price: data.price ?? 0,
      isActive: 1,
    }, userId);

    // Create parent panel record
    const result = await db.$client.prepare(
      `INSERT INTO lab_test_catalog (code, name, category, department, price, test_type, is_active, tenant_id, billing_service_item_id)
       VALUES (?, ?, ?, ?, ?, 'panel', 1, ?, ?)`
    ).bind(data.code, data.name, data.category ?? null, data.department ?? null, data.price ?? 0, tenantId, serviceItemId).run();

    const panelId = result.meta.last_row_id;

    // Update child tests to link to this panel
    for (const childId of data.childTestIds) {
      const child = await db.$client.prepare(
        'SELECT id FROM lab_test_catalog WHERE id = ? AND tenant_id = ? AND is_active = 1'
      ).bind(childId, tenantId).first();
      if (!child) throw new HTTPException(400, { message: `Child test ${childId} not found` });

      await db.$client.prepare(
        `UPDATE lab_test_catalog SET parent_id = ?, test_type = 'component' WHERE id = ? AND tenant_id = ?`
      ).bind(panelId, childId, tenantId).run();
    }

    return c.json({ message: 'Panel created', id: panelId }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to create panel' });
  }
});

/**
 * PUT /api/lab/panels/:id
 * Updates an existing panel. Allows modifying panel metadata and
 * adding/removing child tests.
 *
 * @param {string} id - The panel ID.
 * @param {Object} body - Panel update data including optional childTestIds.
 * @returns {Object} JSON response indicating success.
 */
labCatalogRoutes.put('/panels/:id', zValidator('json', createPanelSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(
      `SELECT id, code, billing_service_item_id FROM lab_test_catalog WHERE id = ? AND tenant_id = ? AND test_type = 'panel' AND is_active = 1`
    ).bind(id, tenantId).first<{ id: number; code: string; billing_service_item_id: number | null }>();
    if (!existing) throw new HTTPException(404, { message: 'Panel not found' });

    const serviceItemId = await syncLabTestBillingServiceItem(c.env.DB, tenantId, existing.code, {
      code: data.code,
      name: data.name,
      category: nullableText(data.category),
      price: data.price ?? 0,
      isActive: 1,
      serviceItemId: existing.billing_service_item_id,
    }, userId);

    // Update panel metadata
    await db.$client.prepare(
      `UPDATE lab_test_catalog SET code = ?, name = ?, category = ?, department = ?, price = ?, billing_service_item_id = ?
       WHERE id = ? AND tenant_id = ?`
    ).bind(data.code, data.name, data.category ?? null, data.department ?? null, data.price ?? 0, serviceItemId, id, tenantId).run();

    // Remove existing children from panel
    await db.$client.prepare(
      `UPDATE lab_test_catalog SET parent_id = NULL, test_type = 'single' WHERE parent_id = ? AND tenant_id = ?`
    ).bind(id, tenantId).run();

    // Re-assign new children
    for (const childId of data.childTestIds) {
      const child = await db.$client.prepare(
        'SELECT id FROM lab_test_catalog WHERE id = ? AND tenant_id = ? AND is_active = 1'
      ).bind(childId, tenantId).first();
      if (!child) throw new HTTPException(400, { message: `Child test ${childId} not found` });

      await db.$client.prepare(
        `UPDATE lab_test_catalog SET parent_id = ?, test_type = 'component' WHERE id = ? AND tenant_id = ?`
      ).bind(id, childId, tenantId).run();
    }

    return c.json({ message: 'Panel updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update panel' });
  }
});

// ─── Report & Results (3-level hierarchy) ────────────────────────────────────

/**
 * GET /api/lab/orders/:id/report
 * Retrieves the full report for a lab order, including results grouped by test.
 *
 * @param {string} id - The lab order ID.
 * @returns {Object} JSON response with report and results.
 */
labCatalogRoutes.get('/orders/:id/report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const order = await db.$client.prepare(
      `SELECT lo.*, p.name as patient_name, p.patient_code
       FROM lab_orders lo JOIN patients p ON lo.patient_id = p.id
       WHERE lo.id = ? AND lo.tenant_id = ?`
    ).bind(id, tenantId).first();
    if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

    const report = await db.$client.prepare(
      `SELECT * FROM lab_reports WHERE lab_order_id = ? AND tenant_id = ?`
    ).bind(id, tenantId).first();

    let results: unknown[] = [];
    if (report) {
      const resultsQuery = await db.$client.prepare(`
        SELECT lr.*, ltc.name as test_name, ltc.code as test_code, ltc.unit,
               ltc.normal_range, ltc.test_type, ltc.parent_id
        FROM lab_results lr
        JOIN lab_test_catalog ltc ON lr.lab_test_id = ltc.id
        WHERE lr.lab_report_id = ?
        ORDER BY ltc.parent_id NULLS FIRST, ltc.display_sequence, ltc.name
      `).bind((report as Record<string, unknown>).id).all();
      results = resultsQuery.results;
    }

    return c.json({ order, report, results });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch lab report' });
  }
});

/**
 * POST /api/lab/orders/:id/report
 * Creates a report record for a lab order.
 *
 * @param {string} id - The lab order ID.
 * @param {Object} body - Validated report data.
 * @returns {Object} JSON response with the new report ID.
 */
labCatalogRoutes.post('/orders/:id/report', zValidator('json', createLabReportSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    const order = await db.$client.prepare(
      'SELECT id FROM lab_orders WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first();
    if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

    // Check if report already exists
    const existing = await db.$client.prepare(
      'SELECT id FROM lab_reports WHERE lab_order_id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first();
    if (existing) throw new HTTPException(409, { message: 'Report already exists for this order' });

    const result = await db.$client.prepare(
      `INSERT INTO lab_reports (lab_order_id, reported_by, report_notes, review_status, tenant_id, created_at)
       VALUES (?, ?, ?, 'pending', ?, datetime('now', '+6 hours'))`
    ).bind(id, userId, data.report_notes ?? null, tenantId).run();

    return c.json({ message: 'Report created', id: result.meta.last_row_id }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to create report' });
  }
});

/**
 * PUT /api/lab/reports/:reportId/review
 * Marks a lab report as reviewed.
 *
 * @param {string} reportId - The report ID.
 * @param {Object} body - Validated review data.
 * @returns {Object} JSON response indicating success.
 */
labCatalogRoutes.put('/reports/:reportId/review', zValidator('json', reviewLabReportSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const reportId = c.req.param('reportId');
  const data = c.req.valid('json');

  try {
    const report = await db.$client.prepare(
      'SELECT id, report_status, retracted_at FROM lab_reports WHERE id = ? AND tenant_id = ?'
    ).bind(reportId, tenantId).first<Record<string, unknown>>();
    if (!report) throw new HTTPException(404, { message: 'Report not found' });
    assertLabReportNotRetracted(report, 'reviewed');

    await db.$client.prepare(
      `UPDATE lab_reports SET review_status = 'reviewed', reviewed_by = ?, reviewed_at = datetime('now', '+6 hours'),
       review_notes = ? WHERE id = ? AND tenant_id = ?`
    ).bind(userId, data.notes ?? null, reportId, tenantId).run();

    return c.json({ message: 'Report reviewed successfully' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to review report' });
  }
});

/**
 * GET /api/lab/orders/:id/results
 * Retrieves results hierarchically for a lab order.
 * For panels: shows panel name with indented component results.
 * For single tests: shows result directly.
 *
 * @param {string} id - The lab order ID.
 * @returns {Object} JSON response with hierarchical results.
 */
labCatalogRoutes.get('/orders/:id/results', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const order = await db.$client.prepare(
      'SELECT id FROM lab_orders WHERE id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first();
    if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

    const report = await db.$client.prepare(
      'SELECT id FROM lab_reports WHERE lab_order_id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first<{ id: number }>();

    if (!report) {
      return c.json({ results: [], message: 'No report created yet' });
    }

    // Get all results with test info
    const resultsQuery = await db.$client.prepare(`
      SELECT lr.*, ltc.name as test_name, ltc.code as test_code, ltc.unit,
             ltc.normal_range, ltc.test_type, ltc.parent_id,
             parent.name as panel_name, parent.code as panel_code
      FROM lab_results lr
      JOIN lab_test_catalog ltc ON lr.lab_test_id = ltc.id
      LEFT JOIN lab_test_catalog parent ON ltc.parent_id = parent.id
      WHERE lr.lab_report_id = ?
      ORDER BY COALESCE(ltc.parent_id, ltc.id), ltc.parent_id IS NOT NULL, ltc.display_sequence, ltc.name
    `).bind(report.id).all();

    // Group results: panels contain components
    const grouped: Record<string, { panel: Record<string, unknown> | null; results: unknown[] }> = {};
    for (const r of resultsQuery.results as Record<string, unknown>[]) {
      const parentId = r.parent_id as number | null;
      const key = parentId ? String(parentId) : `single_${r.lab_test_id}`;
      if (!grouped[key]) {
        grouped[key] = {
          panel: parentId ? { id: parentId, name: r.panel_name, code: r.panel_code } : null,
          results: [],
        };
      }
      grouped[key].results.push(r);
    }

    return c.json({ results: Object.values(grouped) });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch results' });
  }
});

/**
 * POST /api/lab/orders/:id/results/bulk
 * Bulk enter results for a lab order.
 * Creates a report if none exists, then inserts result records and
 * auto-detects abnormal flags. Updates order item statuses accordingly.
 *
 * @param {string} id - The lab order ID.
 * @param {Object} body - Validated bulk result data.
 * @returns {Object} JSON response with count of entered results.
 */
labCatalogRoutes.post('/orders/:id/results/bulk', zValidator('json', bulkResultEntrySchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    // 1. Verify order exists, is paid when billing is linked, and get patient context.
    const order = await db.$client.prepare(
      `SELECT lo.id, lo.patient_id, p.gender, p.date_of_birth, ${getDiagnosticBillingColumns('lo')}
       FROM lab_orders lo
       ${getDiagnosticBillingJoin('lo')}
       JOIN patients p ON lo.patient_id = p.id
       WHERE lo.id = ? AND lo.tenant_id = ?`
    ).bind(id, tenantId).first<BulkResultOrderRow>();
    if (!order) throw new HTTPException(404, { message: 'Lab order not found' });
    assertDiagnosticBillCleared(order as unknown as Record<string, unknown>, 'bulk entering lab results');

    // Calculate patient age in months
    const ageMonths = order.date_of_birth
      ? Math.floor((Date.now() - new Date(order.date_of_birth).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
      : 0;

    const resultItems: Array<{
      input: typeof data.results[number];
      orderItem: BulkResultOrderItemRow;
    }> = [];

    for (const item of data.results) {
      const orderItem = await db.$client.prepare(
        `SELECT loi.id, loi.lab_order_id, loi.lab_test_id,
                ltc.normal_range, ltc.critical_low, ltc.critical_high,
                loi.status
         FROM lab_order_items loi
         JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = loi.tenant_id
         WHERE loi.lab_order_id = ?
           AND loi.lab_test_id = ?
           AND loi.tenant_id = ?
           AND COALESCE(loi.status, 'pending') != 'cancelled'
         ORDER BY loi.id ASC
         LIMIT 1`
      ).bind(id, item.lab_test_id, tenantId).first<BulkResultOrderItemRow>();

      if (!orderItem) {
        throw new HTTPException(400, {
          message: `Lab test ${item.lab_test_id} is not part of lab order ${id} or has been cancelled`,
        });
      }

      // Validate item status allows result entry
      const allowedForResult = ['collected', 'received', 'processing'];
      const itemStatus = String(orderItem.status ?? 'pending');
      if (!allowedForResult.includes(itemStatus)) {
        throw new HTTPException(400, {
          message: `Cannot enter results for test ${item.lab_test_id} in '${itemStatus}' status. Must be: ${allowedForResult.join(', ')}`,
        });
      }

      resultItems.push({ input: item, orderItem });
    }

    // 2. Create lab_report if not exists
    let report = await db.$client.prepare(
      'SELECT id FROM lab_reports WHERE lab_order_id = ? AND tenant_id = ?'
    ).bind(id, tenantId).first<{ id: number }>();

    if (!report) {
      const reportResult = await db.$client.prepare(
        `INSERT INTO lab_reports (lab_order_id, reported_by, review_status, tenant_id, created_at)
         VALUES (?, ?, 'pending', ?, datetime('now', '+6 hours'))`
      ).bind(id, userId, tenantId).run();
      report = { id: reportResult.meta.last_row_id as number };
    }

    let entered = 0;
    const savedResults: Array<{ lab_test_id: number; component_id?: number; result_numeric: number | null; result_value: string }> = [];

    // 3. For each result: create lab_results record, detect abnormal flag using structured ranges
    for (const { input: item, orderItem } of resultItems) {
      const numericValue = parseFloat(item.result_value);
      const resultNumeric = isNaN(numericValue) ? null : numericValue;

      // Try structured reference range first (gender + age specific)
      let rangeLow = orderItem.critical_low ?? null;
      let rangeHigh = orderItem.critical_high ?? null;
      let criticalLow = orderItem.critical_low ?? null;
      let criticalHigh = orderItem.critical_high ?? null;

      if (order.gender && resultNumeric !== null) {
        const structuredRange = await getStructuredReferenceRange(
          db, tenantId, item.lab_test_id, item.component_id ?? null, order.gender, ageMonths
        );
        if (structuredRange) {
          if (structuredRange.range_low !== null) rangeLow = structuredRange.range_low;
          if (structuredRange.range_high !== null) rangeHigh = structuredRange.range_high;
          if (structuredRange.critical_low !== null) criticalLow = structuredRange.critical_low;
          if (structuredRange.critical_high !== null) criticalHigh = structuredRange.critical_high;
        }
      }

      // Determine abnormal flag
      let abnormalFlag: string;
      if (resultNumeric !== null && rangeLow !== null && rangeHigh !== null) {
        abnormalFlag = determineAbnormalFromRange(resultNumeric, rangeLow, rangeHigh, criticalLow, criticalHigh);
      } else {
        abnormalFlag = detectAbnormalFlag(
          resultNumeric ?? undefined,
          orderItem.normal_range,
          orderItem.critical_low,
          orderItem.critical_high,
        );
      }

      // Delta check: find previous result
      let previousValue: string | null = null;
      let deltaFlag: string | null = null;
      if (resultNumeric !== null) {
        const prev = await getPreviousResult(db, Number(tenantId), order.patient_id, item.lab_test_id, item.component_id ?? null);
        if (prev && prev.result_numeric !== null && prev.result_numeric !== undefined) {
          previousValue = prev.result_value;
          deltaFlag = calculateDelta(resultNumeric, prev.result_numeric);
        } else {
          deltaFlag = 'new';
        }
      }

      const resultInsert = await db.$client.prepare(
        `INSERT INTO lab_results (lab_report_id, lab_test_id, component_id, result_value, result_numeric, abnormal_flag, previous_value, delta_flag, comments, result_status, tenant_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))`
      ).bind(report.id, item.lab_test_id, item.component_id ?? null, item.result_value, resultNumeric, abnormalFlag, previousValue, deltaFlag, item.comments ?? null, item.result_status, tenantId).run();

      const savedResultId = resultInsert.meta.last_row_id as number;
      savedResults.push({ lab_test_id: item.lab_test_id, component_id: item.component_id, result_numeric: resultNumeric, result_value: item.result_value });

      // 4. Update corresponding lab_order_items status
      await db.$client.prepare(
        `UPDATE lab_order_items SET result = ?, result_numeric = ?, abnormal_flag = ?, status = 'completed', completed_at = datetime('now', '+6 hours')
         WHERE id = ? AND tenant_id = ?`
      ).bind(item.result_value, resultNumeric, abnormalFlag, orderItem.id, tenantId).run();

      entered++;
    }

    // 5. Auto-calculate formula components
    // Build a map of component_code → result_numeric for this order
    const componentValues: Record<string, number> = {};
    for (const sr of savedResults) {
      if (sr.component_id && sr.result_numeric !== null) {
        const compRow = await db.$client.prepare('SELECT component_code FROM lab_test_components WHERE id = ?').bind(sr.component_id).first<{ component_code: string }>();
        if (compRow?.component_code) {
          componentValues[compRow.component_code] = sr.result_numeric;
        }
      }
    }

    // Find auto-calculate components for tests in this order
    const testIds = [...new Set(savedResults.map(r => r.lab_test_id))];
    for (const testId of testIds) {
      const autoComponents = await db.$client.prepare(`
        SELECT id, component_code, component_name, calculation_formula, unit, normal_range, critical_low, critical_high
        FROM lab_test_components
        WHERE lab_test_id = ? AND is_auto_calculate = 1 AND is_active = 1 AND tenant_id = ?
      `).bind(testId, tenantId).all<{
        id: number; component_code: string; component_name: string; calculation_formula: string;
        unit: string | null; normal_range: string | null; critical_low: number | null; critical_high: number | null;
      }>();

      for (const ac of (autoComponents.results ?? [])) {
        try {
          const computedValue = evaluateFormula(ac.calculation_formula, componentValues);
          const roundedValue = roundResult(computedValue, 2);

          // Determine abnormal flag for computed value
          let abnormalFlag: string;
          if (ac.normal_range) {
            abnormalFlag = detectAbnormalFlag(roundedValue, ac.normal_range, ac.critical_low, ac.critical_high);
          } else {
            const structuredRange = await getStructuredReferenceRange(db, tenantId, testId, ac.id, order.gender ?? 'both', ageMonths);
            if (structuredRange && structuredRange.range_low !== null && structuredRange.range_high !== null) {
              abnormalFlag = determineAbnormalFromRange(roundedValue, structuredRange.range_low, structuredRange.range_high, structuredRange.critical_low, structuredRange.critical_high);
            } else {
              abnormalFlag = 'normal';
            }
          }

          // Delta check for computed
          let previousValue: string | null = null;
          let deltaFlag: string | null = null;
          const prev2 = await getPreviousResult(db, Number(tenantId), order.patient_id, testId, ac.id);
          if (prev2 && prev2.result_numeric !== null && prev2.result_numeric !== undefined) {
            previousValue = prev2.result_value;
            deltaFlag = calculateDelta(roundedValue, prev2.result_numeric);
          } else {
            deltaFlag = 'new';
          }

          await db.$client.prepare(
            `INSERT INTO lab_results (lab_report_id, lab_test_id, component_id, result_value, result_numeric, abnormal_flag, previous_value, delta_flag, units, is_auto_computed, formula_used, result_status, tenant_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'final', ?, datetime('now', '+6 hours'))`
          ).bind(report.id, testId, ac.id, String(roundedValue), roundedValue, abnormalFlag, previousValue, deltaFlag, ac.unit ?? null, ac.calculation_formula, tenantId).run();

          entered++;
        } catch (e) {
          // Formula evaluation failed (missing component values) — skip silently
          console.warn(`Auto-calculation failed for component ${ac.component_code}:`, e instanceof Error ? e.message : e);
        }
      }
    }

    // 6. Auto-update parent order status if all items done
    const counts = await db.$client.prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'completed' OR status = 'verified' THEN 1 ELSE 0 END) as done
       FROM lab_order_items WHERE lab_order_id = ?`
    ).bind(id).first<{ total: number; done: number }>();
    if (counts && counts.total === counts.done) {
      await db.$client.prepare(
        `UPDATE lab_orders SET status = 'completed' WHERE id = ? AND tenant_id = ?`
      ).bind(id, tenantId).run();
    }

    return c.json({ message: 'Bulk results entered', entered }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to enter bulk results' });
  }
});

// ─── Clinical Intelligence ───────────────────────────────────────────────────

/**
 * GET /api/lab/cumulative/:patientId
 * Retrieves cumulative lab results for a patient over time (for trending).
 *
 * @param {string} patientId - The patient ID.
 * @param {string} [testId] - Optional test ID to filter results.
 * @param {string} [fromDate] - Optional start date (YYYY-MM-DD).
 * @param {string} [toDate] - Optional end date (YYYY-MM-DD).
 * @param {string} [limit=50] - Maximum number of results.
 * @returns {Object} JSON response with cumulative results array.
 */
labCatalogRoutes.get('/cumulative/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const testId = c.req.query('testId');
  const fromDate = c.req.query('fromDate');
  const toDate = c.req.query('toDate');
  const resultLimit = parseInt(c.req.query('limit') || '50', 10);

  try {
    let query = `
      SELECT lr.*, ltc.name as test_name, ltc.unit, ltc.normal_range, lo.order_date
      FROM lab_results lr
      JOIN lab_reports lrp ON lr.lab_report_id = lrp.id
      JOIN lab_orders lo ON lrp.lab_order_id = lo.id
      JOIN lab_test_catalog ltc ON lr.lab_test_id = ltc.id
      WHERE lo.patient_id = ? AND lo.tenant_id = ?
    `;
    const params: (string | number)[] = [patientId, tenantId];

    if (testId) {
      query += ' AND lr.lab_test_id = ?';
      params.push(testId);
    }
    if (fromDate) {
      query += ' AND lo.order_date >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      query += ' AND lo.order_date <= ?';
      params.push(toDate);
    }

    query += ' ORDER BY lo.order_date DESC, ltc.name LIMIT ?';
    params.push(resultLimit);

    const results = await db.$client.prepare(query).bind(...params).all();
    return c.json({ results: results.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch cumulative results' });
  }
});

/**
 * GET /api/lab/pending-review
 * Retrieves orders that are completed but not yet reviewed by a pathologist.
 *
 * @returns {Object} JSON response with pending review orders and pagination meta.
 */
labCatalogRoutes.get('/pending-review', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, offset } = getPagination(c);

  try {
    const countResult = await db.$client.prepare(`
      SELECT COUNT(DISTINCT lo.id) as total
      FROM lab_orders lo
      LEFT JOIN lab_reports lr ON lo.id = lr.lab_order_id
      WHERE lo.tenant_id = ? AND lo.status = 'completed'
        AND (lr.review_status IS NULL OR lr.review_status = 'pending')
    `).bind(tenantId).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const orders = await db.$client.prepare(`
      SELECT lo.*, p.name as patient_name, p.patient_code,
        COUNT(loi.id) as total_items
      FROM lab_orders lo
      JOIN patients p ON lo.patient_id = p.id
      JOIN lab_order_items loi ON lo.id = loi.lab_order_id
      LEFT JOIN lab_reports lr ON lo.id = lr.lab_order_id
      WHERE lo.tenant_id = ? AND lo.status = 'completed'
        AND (lr.review_status IS NULL OR lr.review_status = 'pending')
      GROUP BY lo.id ORDER BY lo.created_at ASC
      LIMIT ? OFFSET ?
    `).bind(tenantId, limit, offset).all();

    return c.json({ orders: orders.results, meta: paginationMeta(page, limit, total) });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch pending review orders' });
  }
});

/**
 * GET /api/lab/critical-alerts
 * Retrieves lab items with critical abnormal flags that need immediate attention.
 *
 * @returns {Object} JSON response with critical alert items and pagination meta.
 */
labCatalogRoutes.get('/critical-alerts', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { page, limit, offset } = getPagination(c);

  try {
    const countResult = await db.$client.prepare(`
      SELECT COUNT(*) as total
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      WHERE lo.tenant_id = ? AND loi.abnormal_flag = 'critical'
        AND loi.status IN ('completed', 'verified')
    `).bind(tenantId).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const alerts = await db.$client.prepare(`
      SELECT loi.*, lo.order_no, lo.order_date,
        p.name as patient_name, p.patient_code, p.mobile,
        ltc.name as test_name, ltc.code as test_code
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      JOIN patients p ON lo.patient_id = p.id
      JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      WHERE lo.tenant_id = ? AND loi.abnormal_flag = 'critical'
        AND loi.status IN ('completed', 'verified')
      ORDER BY loi.completed_at DESC
      LIMIT ? OFFSET ?
    `).bind(tenantId, limit, offset).all();

    return c.json({ alerts: alerts.results, meta: paginationMeta(page, limit, total) });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch critical alerts' });
  }
});

/**
 * GET /api/lab/tat-report
 * Turnaround time analytics — average TAT per test, department, category.
 * Shows orders exceeding expected TAT.
 *
 * @param {string} [fromDate] - Optional start date filter (YYYY-MM-DD).
 * @param {string} [toDate] - Optional end date filter (YYYY-MM-DD).
 * @returns {Object} JSON response with TAT statistics per test.
 */
labCatalogRoutes.get('/tat-report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const fromDate = c.req.query('fromDate');
  const toDate = c.req.query('toDate');
  const { page, limit, offset } = getPagination(c);

  try {
    let dateFilter = '';
    const params: (string | number)[] = [tenantId];

    if (fromDate) {
      dateFilter += ' AND lo.order_date >= ?';
      params.push(fromDate);
    }
    if (toDate) {
      dateFilter += ' AND lo.order_date <= ?';
      params.push(toDate);
    }

    const countResult = await db.$client.prepare(`
      SELECT COUNT(DISTINCT ltc.id) as total
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      WHERE lo.tenant_id = ? AND loi.completed_at IS NOT NULL ${dateFilter}
    `).bind(...params).first<{ total: number }>();
    const total = countResult?.total ?? 0;

    const tatData = await db.$client.prepare(`
      SELECT ltc.department, ltc.category, ltc.name as test_name,
        COUNT(*) as total_orders,
        AVG(CAST((julianday(loi.completed_at) - julianday(lo.created_at)) * 24 * 60 AS INTEGER)) as avg_tat_minutes,
        MAX(CAST((julianday(loi.completed_at) - julianday(lo.created_at)) * 24 * 60 AS INTEGER)) as max_tat_minutes,
        ltc.tat_minutes as expected_tat
      FROM lab_order_items loi
      JOIN lab_orders lo ON loi.lab_order_id = lo.id
      JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      WHERE lo.tenant_id = ? AND loi.completed_at IS NOT NULL ${dateFilter}
      GROUP BY ltc.id
      ORDER BY avg_tat_minutes DESC
      LIMIT ? OFFSET ?
    `).bind(...params, limit, offset).all();

    return c.json({ tatReport: tatData.results, meta: paginationMeta(page, limit, total) });
  } catch {
    throw new HTTPException(500, { message: 'Failed to generate TAT report' });
  }
});

// ─── Enhanced Order Creation ─────────────────────────────────────────────────

/**
 * POST /api/lab/orders/extended
 * Creates a lab order with extended fields: priority, specimen info,
 * clinical history, vendor, and notes. When ordering a panel, auto-expands
 * to create items for all child component tests.
 *
 * @param {Object} body - Validated extended order data.
 * @returns {Object} JSON response with orderId and orderNo.
 */
labCatalogRoutes.post('/orders/extended', zValidator('json', createLabOrderExtendedSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const orderDate = data.orderDate ?? getTodayGMT6();

  try {
    await assertAccountingPeriodOpen(c.env.DB, tenantId, orderDate, 'Extended lab order billing');
    const orderNo = await getNextSequence(c.env.DB, tenantId!, 'lab_order', 'LO');
    const orderingClinicianDoctorId = await resolveOrderingClinicianDoctorId(c.env.DB, tenantId, {
      enteredByUserId: userId,
      visitId: data.visitId ?? null,
    });

    const orderResult = await db.$client.prepare(`
      INSERT INTO lab_orders (
        order_no, patient_id, visit_id, ordered_by, ordering_clinician_doctor_id,
        order_date, priority, specimen_type, specimen_fasting, clinical_history,
        vendor_id, notes, tenant_id
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      orderNo, data.patientId, data.visitId ?? null, userId, orderingClinicianDoctorId, orderDate,
      data.priority ?? 'routine', data.specimen_type ?? null,
      data.specimen_fasting ?? null, data.clinical_history ?? null,
      data.vendor_id ?? null, data.notes ?? null, tenantId
    ).run();

    const orderId = orderResult.meta.last_row_id;
    let orderTotal = 0;
    const orderItems: Array<{
      labOrderItemId: number;
      testId: number;
      name: string;
      category: string | null;
      price: number;
      discount: number;
      lineTotal: number;
      billingServiceItemId: number | null;
    }> = [];

    for (const item of data.items) {
      const test = await db.$client.prepare(
        'SELECT id, name, price, category, test_type FROM lab_test_catalog WHERE id = ? AND tenant_id = ? AND is_active = 1'
      ).bind(item.labTestId, tenantId).first<{ id: number; name: string; price: number; category: string | null; test_type: string }>();
      if (!test) throw new HTTPException(400, { message: `Lab test ${item.labTestId} not found` });

      if (test.test_type === 'panel') {
        // Auto-expand panel: create items for all child component tests
        const children = await db.$client.prepare(
          'SELECT id FROM lab_test_catalog WHERE parent_id = ? AND tenant_id = ? AND is_active = 1'
        ).bind(test.id, tenantId).all<{ id: number }>();

        for (const child of children.results) {
          const childBilling = await resolveLabTestBillingRow(c.env.DB, tenantId, child.id);
          if (!childBilling) throw new HTTPException(400, { message: `Child test ${child.id} not found` });
          const discount = item.discount ?? 0;
          const lineTotal = Math.max(0, childBilling.price - discount);
          orderTotal += lineTotal;
          const itemResult = await db.$client.prepare(`
            INSERT INTO lab_order_items (lab_order_id, lab_test_id, unit_price, discount, line_total, status, tenant_id, source)
            VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
          `).bind(orderId, childBilling.id, childBilling.price, discount, lineTotal, tenantId, 'lab').run();
          orderItems.push({
            labOrderItemId: itemResult.meta.last_row_id as number,
            testId: childBilling.id,
            name: childBilling.name,
            category: childBilling.category ?? null,
            price: childBilling.price,
            discount,
            lineTotal,
            billingServiceItemId: childBilling.billingServiceItemId,
          });
        }
      } else {
        const billingTest = await resolveLabTestBillingRow(c.env.DB, tenantId, item.labTestId);
        if (!billingTest) throw new HTTPException(400, { message: `Lab test ${item.labTestId} not found` });
        const discount = item.discount ?? 0;
        const lineTotal = Math.max(0, billingTest.price - discount);
        orderTotal += lineTotal;
        const itemResult = await db.$client.prepare(`
          INSERT INTO lab_order_items (lab_order_id, lab_test_id, unit_price, discount, line_total, status, tenant_id, source)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        `).bind(orderId, item.labTestId, billingTest.price, discount, lineTotal, tenantId, 'lab').run();
        orderItems.push({
          labOrderItemId: itemResult.meta.last_row_id as number,
          testId: item.labTestId,
          name: billingTest.name,
          category: billingTest.category ?? null,
          price: billingTest.price,
          discount,
          lineTotal,
          billingServiceItemId: billingTest.billingServiceItemId,
        });
      }
    }

    const activeFy = await getActiveFiscalYear(c.env.DB, tenantId!, orderDate);
    let invoiceNo: string;
    let fiscalYearId: number | null = null;
    const invoiceCode = 'BL';

    if (activeFy) {
      invoiceNo = await getNextFiscalInvoiceNo(c.env.DB, tenantId!, activeFy.id, invoiceCode);
      fiscalYearId = activeFy.id;
    } else {
      invoiceNo = await getNextInvoiceNumber(c.env.DB, tenantId!, 'diagnostic');
      console.warn(`[lab] No active fiscal year for tenant ${tenantId}; falling back to legacy sequence`);
    }

    const categoryTotals = calculateBillCategoryTotals([{ category: 'test', amount: orderTotal }]);
    const [billResult] = await db.insert(bills).values({
      patientId: data.patientId,
      visitId: data.visitId ?? null,
      invoiceNo,
      ...categoryTotals,
      discount: 0,
      total: orderTotal,
      paid: 0,
      due: orderTotal,
      status: orderTotal <= 0 ? 'paid' : 'open',
      tenantId,
      fiscalYearId,
      invoiceCode,
      isInsuranceBilling: 0,
      coPaymentAmount: 0,
      createdBy: Number(userId),
    }).returning({ id: bills.id });

    const billId = billResult.id;

    await db.$client.prepare(
      `UPDATE lab_orders
       SET bill_id = ?, billing_status = CASE WHEN ? <= 0 THEN 'paid' ELSE 'unpaid' END, updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND tenant_id = ?`
    ).bind(billId, orderTotal, orderId, tenantId).run();

    const itemStmts = orderItems.map((oi) =>
      db.insert(invoiceItems).values({
        billId,
        itemCategory: 'test',
        description: oi.name,
        quantity: 1,
        unitPrice: oi.price,
        lineTotal: oi.lineTotal,
        referenceId: oi.labOrderItemId,
        tenantId,
      })
    );
    if (itemStmts.length > 0) await db.batch(itemStmts as any);

    if (data.visitId) {
      const vsStmts = orderItems.map((oi) =>
        db.insert(visitServices).values({
          tenantId,
          visitId: data.visitId!,
          patientId: data.patientId,
          serviceType: 'test',
          description: oi.name,
          serviceItemId: oi.billingServiceItemId,
          amount: oi.price,
          discountAmount: oi.discount,
          quantity: 1,
          totalAmount: oi.lineTotal,
          referenceType: 'lab_order_item',
          referenceId: oi.labOrderItemId,
          status: 'billed',
          billId,
          createdBy: Number(userId),
        })
      );
      if (vsStmts.length > 0) await db.batch(vsStmts as any);
    }

    if (orderTotal > 0) {
      await recordBillFinalizationSideEffects(c.env.DB, {
        tenantId,
        userId,
        patientId: data.patientId,
        visitId: data.visitId ?? null,
        billId,
        invoiceNo,
        billDate: orderDate,
        subtotal: orderTotal,
        discount: 0,
        total: orderTotal,
        categoryTotals,
        extraPayload: { labOrderId: orderId },
        items: orderItems.map((oi) => ({
          itemCategory: 'test',
          description: oi.name,
          lineTotal: oi.lineTotal,
          referenceId: oi.labOrderItemId,
        })),
      });
    }

    await accrueLabOrderDoctorCommissions(c.env.DB, {
      tenantId,
      userId,
      patientId: data.patientId,
      visitId: data.visitId ?? null,
      billId,
      labOrderId: orderId,
      orderDate,
      items: orderItems.map((oi) => ({
        labOrderItemId: oi.labOrderItemId,
        labTestId: oi.testId,
        category: oi.category,
        lineTotal: oi.lineTotal,
      })),
    });
    queueLabAccountingPosting(c, tenantId);

    void createAuditLog(c.env, tenantId!, userId!, 'CREATE', 'lab_orders', orderId, null, {
      action: 'extended_lab_order',
      orderNo,
      total: orderTotal,
      itemCount: orderItems.length,
    });

    return c.json({ message: 'Extended lab order created', orderId, orderNo, billId, invoiceNo, total: orderTotal }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to create extended lab order' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LAB REPORT PDF / HTML GENERATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/lab/orders/:id/report/print
 * Generates printable HTML lab report with signatories and letterhead.
 * Add ?autoprint=1 for auto window.print().
 */
labCatalogRoutes.get('/orders/:id/report/print', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const autoprint = c.req.query('autoprint') === '1';

  try {
    // Fetch order + patient
    const order = await db.$client.prepare(`
      SELECT lo.*, p.name as patient_name, p.patient_code, p.mobile, p.date_of_birth, p.gender,
             p.blood_group, p.national_id
      FROM lab_orders lo
      JOIN patients p ON lo.patient_id = p.id
      WHERE lo.id = ? AND lo.tenant_id = ?
    `).bind(id, tenantId).first() as any;
    if (!order) throw new HTTPException(404, { message: 'Order not found' });

    // Fetch items with results
    const { results: items } = await db.$client.prepare(`
      SELECT loi.*, ltc.name as test_name, ltc.code as test_code, ltc.category,
             ltc.unit, ltc.normal_range, ltc.department, ltc.test_type,
             ltc.parent_id, ltc.specimen_type as catalog_specimen
      FROM lab_order_items loi
      JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id
      WHERE loi.lab_order_id = ? AND loi.tenant_id = ?
      ORDER BY ltc.department, ltc.display_sequence, ltc.name
    `).bind(id, tenantId).all() as any;

    // Fetch signatories
    const { results: signatories } = await db.$client.prepare(
      `SELECT * FROM lab_report_signatories WHERE tenant_id = ? AND is_active = 1 ORDER BY display_order`
    ).bind(tenantId).all().catch(() => ({ results: [] })) as any;

    // Fetch tenant/hospital info for letterhead
    const tenant = await db.$client.prepare(
      'SELECT * FROM tenants WHERE id = ?'
    ).bind(tenantId).first() as any;

    // Group items by department for display
    const departments: Record<string, any[]> = {};
    for (const item of items || []) {
      const dept = item.department || item.category || 'General';
      if (!departments[dept]) departments[dept] = [];
      departments[dept].push(item);
    }

    // Calculate age
    let age = '';
    if (order.date_of_birth) {
      const birthDate = new Date(order.date_of_birth);
      const now = new Date();
      const years = now.getFullYear() - birthDate.getFullYear();
      age = `${years}Y`;
    }

    // Build HTML
    const html = `<!DOCTYPE html>
<html lang="bn">
<head>
<meta charset="UTF-8">
<title>Lab Report - ${escapeHtml(order.order_no)}</title>
<style>
  @page { size: A4; margin: 10mm 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; font-size: 11px; color: #333; line-height: 1.4; }
  .header { text-align: center; border-bottom: 2px solid #1a5276; padding-bottom: 8px; margin-bottom: 10px; }
  .header h1 { font-size: 18px; color: #1a5276; }
  .header p { font-size: 10px; color: #666; }
  .patient-info { display: flex; flex-wrap: wrap; gap: 5px; border: 1px solid #ddd; padding: 8px; margin-bottom: 10px; background: #f8f9fa; }
  .patient-info .field { flex: 1 1 30%; font-size: 10px; }
  .patient-info .field strong { color: #1a5276; }
  .dept-header { background: #1a5276; color: white; padding: 4px 8px; font-size: 11px; font-weight: bold; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 5px; }
  th { background: #ecf0f1; text-align: left; padding: 4px 6px; font-size: 10px; border-bottom: 1px solid #bdc3c7; }
  td { padding: 3px 6px; font-size: 10px; border-bottom: 1px solid #eee; }
  .abnormal-high { color: #e74c3c; font-weight: bold; }
  .abnormal-low { color: #2980b9; font-weight: bold; }
  .abnormal-critical { color: #fff; background: #e74c3c; font-weight: bold; padding: 1px 4px; }
  .signatories { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 10px; }
  .signatory { text-align: center; min-width: 150px; }
  .signatory .name { font-weight: bold; border-top: 1px solid #333; padding-top: 3px; }
  .signatory .designation { font-size: 9px; color: #666; }
  .signatory .qualification { font-size: 8px; color: #999; }
  .footer { text-align: center; font-size: 8px; color: #999; margin-top: 15px; border-top: 1px solid #ddd; padding-top: 5px; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(tenant?.name || tenant?.hospital_name || 'Hospital Laboratory')}</h1>
    <p>${escapeHtml(tenant?.address || '')} ${tenant?.phone ? '| Phone: ' + escapeHtml(tenant.phone) : ''}</p>
    <p style="font-size:12px; font-weight:bold; margin-top:4px;">LABORATORY REPORT</p>
  </div>

  <div class="patient-info">
    <div class="field"><strong>Patient:</strong> ${escapeHtml(order.patient_name)}</div>
    <div class="field"><strong>ID:</strong> ${escapeHtml(order.patient_code)}</div>
    <div class="field"><strong>Age/Sex:</strong> ${escapeHtml(age)} / ${escapeHtml(order.gender || '')}</div>
    <div class="field"><strong>Order No:</strong> ${escapeHtml(order.order_no)}</div>
    <div class="field"><strong>Date:</strong> ${escapeHtml(order.order_date)}</div>
    <div class="field"><strong>Specimen:</strong> ${escapeHtml(order.specimen_type || 'Blood')}</div>
    ${order.clinical_history ? `<div class="field" style="flex:1 1 100%"><strong>Clinical History:</strong> ${escapeHtml(order.clinical_history)}</div>` : ''}
  </div>

  ${Object.entries(departments).map(([dept, deptItems]) => `
    <div class="dept-header">${escapeHtml(dept)}</div>
    <table>
      <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference Range</th><th>Flag</th></tr></thead>
      <tbody>
        ${(deptItems as any[]).map((item: any) => {
          const flagClass = item.abnormal_flag === 'critical' ? 'abnormal-critical'
            : item.abnormal_flag === 'high' ? 'abnormal-high'
            : item.abnormal_flag === 'low' ? 'abnormal-low' : '';
          const flagText = item.abnormal_flag === 'critical' ? '⚠ CRITICAL'
            : item.abnormal_flag === 'high' ? '↑ High'
            : item.abnormal_flag === 'low' ? '↓ Low'
            : item.abnormal_flag === 'normal' ? 'Normal' : '';
          return `<tr>
            <td>${item.test_type === 'panel' ? `<strong>${escapeHtml(item.test_name)}</strong>` : escapeHtml(item.test_name)}</td>
            <td><strong>${escapeHtml(item.result || '-')}</strong></td>
            <td>${escapeHtml(item.unit || '')}</td>
            <td>${escapeHtml(item.normal_range || '')}</td>
            <td class="${flagClass}">${flagText}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  `).join('')}

  <div class="signatories">
    ${(signatories || []).map((s: any) => `
      <div class="signatory">
        ${s.signature_image ? `<img src="${escapeHtml(s.signature_image)}" style="height:40px;margin-bottom:2px;" />` : '<div style="height:40px;"></div>'}
        <div class="name">${escapeHtml(s.signatory_name)}</div>
        <div class="designation">${escapeHtml(s.designation)}</div>
        <div class="qualification">${escapeHtml(s.qualification || '')} ${s.registration_no ? '(Reg: ' + escapeHtml(s.registration_no) + ')' : ''}</div>
      </div>
    `).join('')}
  </div>

  <div class="footer">
    Printed: ${new Date().toLocaleString()} | This is a computer-generated report.
  </div>

  ${autoprint ? `<script>
    window.onload = function() { setTimeout(function() { window.print(); }, 500); };
  </script>` : ''}
</body>
</html>`;

    // Update print count
    await db.$client.prepare(
      "UPDATE lab_orders SET print_count = print_count + 1, last_printed_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?"
    ).bind(id, tenantId).run();

    return c.html(html);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to generate lab report' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// LAB REPORT SIGNATORIES CRUD
// ═══════════════════════════════════════════════════════════════════════════

/** GET /api/lab/signatories — List signatories */
labCatalogRoutes.get('/signatories', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(
    'SELECT * FROM lab_report_signatories WHERE tenant_id = ? AND is_active = 1 ORDER BY display_order'
  ).bind(tenantId).all().catch(() => ({ results: [] }));
  return c.json({ data: results });
});

/** POST /api/lab/signatories — Add signatory */
labCatalogRoutes.post('/signatories', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = await c.req.json() as any;

  const result = await db.$client.prepare(`
    INSERT INTO lab_report_signatories (signatory_name, designation, qualification, registration_no, signature_image, display_order, is_default, tenant_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    data.signatory_name, data.designation, data.qualification ?? null,
    data.registration_no ?? null, data.signature_image ?? null,
    data.display_order ?? 0, data.is_default ? 1 : 0, tenantId,
  ).run();
  return c.json({ id: result.meta.last_row_id, message: 'Signatory added' }, 201);
});

/** DELETE /api/lab/signatories/:id */
labCatalogRoutes.delete('/signatories/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  await db.$client.prepare(
    'UPDATE lab_report_signatories SET is_active = 0 WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).run();
  return c.json({ message: 'Signatory removed' });
});

// ═══════════════════════════════════════════════════════════════════════════
// DOCTOR LAB INBOX — scoped results + summary for doctor module
// ═══════════════════════════════════════════════════════════════════════════

labCatalogRoutes.get('/doctor/summary', async (c) => {
  requireSpecificRole(c, 'doctor', 'md');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const doctorId = await requireLinkedDoctorId(c.env.DB, tenantId, userId);
  const summary = await fetchDoctorLabInboxSummary(c.env.DB, tenantId, doctorId, userId);
  return c.json(summary);
});

labCatalogRoutes.get('/results', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const scope = c.req.query('scope');
  const patientId = c.req.query('patient');

  if (patientId) {
    const numericPatientId = Number(patientId);
    if (!Number.isFinite(numericPatientId) || numericPatientId <= 0) {
      throw new HTTPException(400, { message: 'Valid patient id is required' });
    }

    const role = c.get('role');
    if (role === 'doctor' || role === 'md') {
      const userId = requireUserId(c);
      const doctorId = await requireLinkedDoctorId(c.env.DB, tenantId, userId);
      const allowed = await canDoctorAccessPatientLabResults(c.env.DB, tenantId, numericPatientId, doctorId, userId);
      if (!allowed) {
        throw new HTTPException(403, { message: 'Patient lab results are outside this doctor scope' });
      }
    }

    const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
    const { results } = await db.$client.prepare(`
      SELECT
        loi.id,
        lo.patient_id,
        p.name AS patient_name,
        p.patient_code,
        COALESCE(ltc.name, 'Lab test') AS test_name,
        loi.result AS result_value,
        ltc.unit,
        loi.abnormal_flag,
        loi.status,
        lo.id AS order_id,
        lo.order_no,
        loi.completed_at AS collected_at,
        COALESCE(lo.order_date, lo.created_at) AS ordered_at,
        CASE WHEN COALESCE(loi.abnormal_flag, '') NOT IN ('', 'normal', 'N') THEN 1 ELSE 0 END AS is_abnormal
      FROM lab_order_items loi
      JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
      JOIN patients p ON p.id = lo.patient_id AND p.tenant_id = lo.tenant_id
      LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = loi.tenant_id
      WHERE lo.tenant_id = ? AND lo.patient_id = ?
      ORDER BY COALESCE(loi.completed_at, lo.order_date, lo.created_at) DESC, loi.id DESC
      LIMIT ?
    `).bind(tenantId, numericPatientId, limit).all();
    return c.json({ results: results ?? [] });
  }

  if (scope !== 'doctor') {
    throw new HTTPException(400, { message: 'Provide patient= or scope=doctor' });
  }

  requireSpecificRole(c, 'doctor', 'md');
  const userId = requireUserId(c);
  const doctorId = await requireLinkedDoctorId(c.env.DB, tenantId, userId);
  const abnormalQuery = c.req.query('abnormal_flag');
  const abnormalFlags = abnormalQuery
    ? abnormalQuery.split(',').map((flag) => flag.trim()).filter(Boolean)
    : null;

  const results = await fetchDoctorLabResults(c.env.DB, {
    tenantId,
    doctorId,
    userId,
    limit: Number(c.req.query('limit') ?? 50),
    status: c.req.query('status') ?? null,
    abnormalFlags,
    search: c.req.query('search') ?? null,
    needsReviewOnly: c.req.query('needs_review') === '1',
  });

  return c.json({ results });
});

labCatalogRoutes.post('/results/:itemId/acknowledge', async (c) => {
  requireSpecificRole(c, 'doctor', 'md');
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const doctorId = await requireLinkedDoctorId(c.env.DB, tenantId, userId);
  const itemId = Number(c.req.param('itemId'));
  const body = await c.req.json().catch(() => ({})) as { notes?: string; acknowledged_to?: string };

  const item = await db.$client.prepare(`
    SELECT loi.id, loi.abnormal_flag, lo.patient_id, lo.id AS order_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
    WHERE loi.id = ? AND lo.tenant_id = ?
      AND (
        EXISTS (SELECT 1 FROM prescriptions pr WHERE pr.id = lo.prescription_id AND pr.doctor_id = ? AND pr.tenant_id = lo.tenant_id)
        OR lo.ordered_by = ?
        OR EXISTS (
          SELECT 1 FROM appointments ap
          WHERE ap.patient_id = lo.patient_id AND ap.doctor_id = ? AND ap.tenant_id = lo.tenant_id
            AND ap.appt_date >= date('now', '-90 days')
        )
      )
  `).bind(itemId, tenantId, doctorId, userId, doctorId).first<{
    id: number;
    abnormal_flag: string | null;
    patient_id: number;
    order_id: number;
  }>();

  if (!item) {
    throw new HTTPException(404, { message: 'Lab result not found for this doctor scope' });
  }

  const flag = String(item.abnormal_flag ?? '').toLowerCase();
  if (!['high', 'low', 'critical', 'critical_high', 'critical_low', 'abnormal'].includes(flag)) {
    throw new HTTPException(400, { message: 'Only abnormal or critical results can be acknowledged' });
  }

  await db.$client.prepare(`
    INSERT INTO lab_critical_acknowledgements (
      lab_order_item_id, acknowledged_by, acknowledged_to, notes, tenant_id, created_at
    ) VALUES (?, ?, ?, ?, ?, datetime('now', '+6 hours'))
  `).bind(itemId, userId, body.acknowledged_to ?? null, body.notes ?? null, tenantId).run();

  await createAuditLog(c.env, tenantId, userId, 'ACK_RESULT', 'lab_order_items', itemId, null, {
    patient_id: item.patient_id,
    order_id: item.order_id,
    abnormal_flag: flag,
    notes: body.notes ?? null,
  });

  return c.json({ success: true, item_id: itemId, status: 'acknowledged' });
});

export default labCatalogRoutes;
