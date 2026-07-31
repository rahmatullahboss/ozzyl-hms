import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import type { Env, Variables } from '../../types';
import { eq, and, sql, asc, desc } from 'drizzle-orm';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import {
  billingSchemes, billingSubSchemes, billingSchemePriceCategoryMap, billingSchemeMembers,
  billingServiceDepartments, billingServiceItems,
  billingCounters, billingFiscalYears, billingCreditOrganizations,
  billingPackages, billingPackageItems, billingDepositHeads,
  billingMembershipTypes, patientMemberships,
  billingItemPriceCategoryMaps
} from '../../db/schema';
import {
  createSchemeSchema, updateSchemeSchema,
  createSubSchemeSchema,
  createPriceCategorySchema, updatePriceCategorySchema,
  createServiceDeptSchema, updateServiceDeptSchema,
  createServiceItemSchema, updateServiceItemSchema, listServiceItemsSchema, performerPayoutRuleSchema,
  createCounterSchema,
  createFiscalYearSchema,
  createCreditOrgSchema, updateCreditOrgSchema,
  createPackageSchema, updatePackageSchema,
  createDepositHeadSchema,
  createMembershipTypeSchema, updateMembershipTypeSchema, assignMembershipSchema,
  createSchemeMemberSchema, updateSchemeMemberSchema, schemePreviewSchema,
  schemeEligibilityQuerySchema, applySchemePreviewSchema,
  schemePriceCategoryMapSchema,
  itemPriceCategoryMapSchema,
  priceMatrixSaveSchema,
} from '../../schemas/billingMaster';
import { getDb } from '../../db';
import { syncDiagnosticCatalogFromBillingServiceItem } from '../../lib/diagnostic-catalog';
import { normalizePerformerRule } from '../../lib/diagnostic-performer-payout';
import { evaluateBillingSchemeEligibility } from '../../lib/billing-scheme-eligibility';
import {
  auditRequestMetadata,
  prepareMasterDataAudit,
  requireMasterDataActorId,
} from '../../lib/master-data-audit';
import { getTodayGMT6 } from '../../lib/date-utils';
import {
  buildDiagnosticPerformerRuleContext,
  createRouteCompensationRule,
  replaceRouteCompensationRule,
  retireRouteCompensationRule,
  type LegacyDiagnosticPerformerRuleSnapshot,
} from '../../lib/canonical/compensation-rule-route-integration';
import {
  applyBillingServiceCatalogMutation,
  applyBillingServiceCategoryPriceMutation,
  billingPriceMapCanonicalSourceKey,
  billingServiceCanonicalSourceKey,
} from '../../lib/canonical/service-catalog-route-integration';

const billingMaster = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── Helper: validate numeric route param ────────────────────────────────────

function parseId(raw: string): number {
  const id = parseInt(raw, 10);
  if (Number.isNaN(id) || id <= 0) throw new HTTPException(400, { message: 'Invalid ID' });
  return id;
}

function assertSchemeDateRange(validFrom?: string | null, validTo?: string | null): void {
  if (validFrom && validTo && validTo < validFrom) {
    throw new HTTPException(400, { message: 'valid_to must be on or after valid_from' });
  }
}

type DiagnosticServiceItemRow = {
  id: number;
  item_name: string;
  item_code: string | null;
  price: number;
  tenant_id: string;
  department_code: 'LAB' | 'RAD';
  diagnostic_kind: 'lab' | 'radiology';
};

type DiagnosticPerformerRuleRow = {
  id: number;
  tenant_id: string;
  billing_service_item_id: number;
  diagnostic_kind: 'lab' | 'radiology';
  rate_type: 'flat' | 'percent';
  rate_value: number;
  effective_from: string;
  effective_to: string | null;
  is_active: number;
  notes: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function assertCalendarDate(value: string): void {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HTTPException(400, { message: 'Date must use a valid YYYY-MM-DD value' });
  }
}

function previousCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function serializePerformerRule(row: DiagnosticPerformerRuleRow | null) {
  if (!row) return null;
  return {
    id: Number(row.id),
    billing_service_item_id: Number(row.billing_service_item_id),
    diagnostic_kind: row.diagnostic_kind,
    rate_type: row.rate_type,
    rate_value: Number(row.rate_value),
    flat_amount: row.rate_type === 'flat' ? Number(row.rate_value) : null,
    percent: row.rate_type === 'percent' ? Number(row.rate_value) / 100 : null,
    effective_from: row.effective_from,
    effective_to: row.effective_to ?? null,
    enabled: Number(row.is_active ?? 0) === 1,
    notes: row.notes ?? null,
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
  };
}

function diagnosticRuleSnapshot(
  row: Pick<DiagnosticPerformerRuleRow,
    'billing_service_item_id' | 'diagnostic_kind' | 'rate_type' | 'rate_value'
    | 'effective_from' | 'effective_to' | 'is_active'>,
): LegacyDiagnosticPerformerRuleSnapshot {
  return {
    serviceItemId: Number(row.billing_service_item_id),
    diagnosticKind: row.diagnostic_kind,
    rateType: row.rate_type,
    rateValue: Number(row.rate_value),
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to ?? null,
    isActive: Number(row.is_active ?? 0) === 1,
  };
}

function billingRuleIdempotencyKey(
  request: { header(name: string): string | undefined },
): string | null {
  const value = request.header('Idempotency-Key')?.trim();
  return value || null;
}

async function loadTenantDiagnosticServiceItem(
  db: D1Database,
  tenantId: string,
  serviceItemId: number,
): Promise<DiagnosticServiceItemRow | null> {
  return db.prepare(`
    SELECT si.id, si.item_name, si.item_code, si.price, si.tenant_id,
           sd.department_code,
           CASE sd.department_code
             WHEN 'LAB' THEN 'lab'
             WHEN 'RAD' THEN 'radiology'
           END AS diagnostic_kind
    FROM billing_service_items si
    JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
     AND sd.tenant_id = si.tenant_id
    WHERE si.id = ?
      AND si.tenant_id = ?
      AND COALESCE(si.is_active, 1) = 1
      AND COALESCE(sd.is_active, 1) = 1
      AND sd.department_code IN ('LAB', 'RAD')
    LIMIT 1
  `).bind(serviceItemId, tenantId).first<DiagnosticServiceItemRow>();
}

function normalizePackageBedFields(packageType?: string | null) {
  return {
    packageType: packageType ?? 'standard',
    includedBedDays: 0,
    extraBedRate: 0,
  };
}

async function ensureServiceDepartmentScope(d1: D1Database, tenantId: string, departmentId?: number | null): Promise<void> {
  if (departmentId == null) return;

  const department = await d1.prepare(`
    SELECT id FROM billing_service_departments
    WHERE id = ?
      AND tenant_id IN (?, '0')
      AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(departmentId, tenantId).first<{ id: number }>();

  if (!department?.id) {
    throw new HTTPException(400, { message: 'Service department not found' });
  }
}

async function ensureServiceItemTenantOverridesTable(d1: D1Database): Promise<void> {
  await d1.prepare(`
    CREATE TABLE IF NOT EXISTS billing_service_item_tenant_overrides (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      global_service_item_id INTEGER NOT NULL REFERENCES billing_service_items(id),
      is_hidden INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now', '+6 hours')),
      updated_at TEXT
    )
  `).run();

  await d1.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_service_item_tenant_override_unique
    ON billing_service_item_tenant_overrides(tenant_id, global_service_item_id)
  `).run();
}

async function ensureDefaultPriceCategory(d1: D1Database, tenantId: string): Promise<number> {
  await d1.prepare(`
    INSERT INTO price_categories (tenant_id, category_name, category_code, description, is_default, is_active, created_at)
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

  if (!category?.id) throw new HTTPException(500, { message: 'Default price category is not configured' });
  return Number(category.id);
}

async function nextBillingServiceItemId(d1: D1Database): Promise<number> {
  const row = await d1.prepare(`
    SELECT id FROM billing_service_items ORDER BY id DESC LIMIT 1
  `).first<{ id: number }>();
  const id = Number(row?.id ?? 0) + 1;
  if (!Number.isSafeInteger(id) || id <= 0) throw new HTTPException(500, { message: 'Unable to allocate service item identity' });
  return id;
}

async function serviceDepartmentCode(
  d1: D1Database,
  tenantId: string,
  departmentId?: number | null,
): Promise<string | null> {
  if (departmentId == null) return null;
  const row = await d1.prepare(`
    SELECT department_code
    FROM billing_service_departments
    WHERE id=? AND tenant_id IN (?, '0') AND COALESCE(is_active, 1)=1
    LIMIT 1
  `).bind(departmentId, tenantId).first<{ department_code: string | null }>();
  return row?.department_code?.trim() || null;
}

function serviceMutationIdempotencyKey(
  request: { header(name: string): string | undefined },
  operation: string,
  fallback: string,
): string {
  return `route:service-catalog:${operation}:${billingRuleIdempotencyKey(request) ?? fallback}`;
}

async function countFirst(d1: D1Database, sqlText: string, ...params: unknown[]): Promise<number> {
  const row = await d1.prepare(sqlText).bind(...params).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

// ═══════════════════════════════════════════════════════════════════
// BILLING MASTER HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/health-check', async (c) => {
  const tenantId = requireTenantId(c);
  await ensureDefaultPriceCategory(c.env.DB, tenantId);

  const [
    activeServiceItems,
    inactiveServiceItems,
    serviceItemsMissingDepartment,
    duplicateItemCodes,
    serviceItemsWithoutCategoryPrice,
    activeSchemes,
    activeSchemesWithoutPolicy,
    activePackages,
    packagesMissingComponents,
    creditOrganizations,
    counters,
    depositHeads,
    referralHospitals,
    currentFiscalYears,
  ] = await Promise.all([
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM billing_service_items WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`, tenantId),
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM billing_service_items WHERE tenant_id = ? AND COALESCE(is_active, 1) = 0`, tenantId),
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM billing_service_items WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1 AND service_department_id IS NULL`, tenantId),
    countFirst(c.env.DB, `
      SELECT COUNT(*) AS count FROM (
        SELECT item_code
        FROM billing_service_items
        WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1 AND item_code IS NOT NULL AND TRIM(item_code) != ''
        GROUP BY LOWER(TRIM(item_code))
        HAVING COUNT(*) > 1
      )
    `, tenantId),
    countFirst(c.env.DB, `
      SELECT COUNT(*) AS count
      FROM billing_service_items i
      WHERE i.tenant_id = ?
        AND COALESCE(i.is_active, 1) = 1
        AND NOT EXISTS (
          SELECT 1 FROM billing_item_price_category_maps m
          WHERE m.tenant_id = i.tenant_id
            AND m.service_item_id = i.id
            AND COALESCE(m.is_active, 1) = 1
        )
    `, tenantId),
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM billing_schemes WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`, tenantId),
    countFirst(c.env.DB, `
      SELECT COUNT(*) AS count
      FROM billing_schemes
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 1
        AND COALESCE(default_discount_percent, 0) > 0
        AND (default_discount_source IS NULL OR TRIM(default_discount_source) = '')
    `, tenantId),
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM billing_packages WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`, tenantId),
    countFirst(c.env.DB, `
      SELECT COUNT(*) AS count
      FROM billing_packages p
      WHERE p.tenant_id = ?
        AND COALESCE(p.is_active, 1) = 1
        AND NOT EXISTS (
          SELECT 1 FROM billing_package_items pi
          WHERE pi.tenant_id = p.tenant_id AND pi.package_id = p.id
        )
    `, tenantId),
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM billing_credit_organizations WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`, tenantId),
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM billing_counters WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`, tenantId),
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM billing_deposit_heads WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`, tenantId),
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM referral_hospitals WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1`, tenantId),
    countFirst(c.env.DB, `SELECT COUNT(*) AS count FROM billing_fiscal_years WHERE tenant_id = ? AND COALESCE(is_current, 0) = 1 AND COALESCE(is_active, 1) = 1`, tenantId),
  ]);

  const issues = [
    { key: 'duplicate_item_codes', label: 'Duplicate service item codes', count: duplicateItemCodes, severity: 'critical', tab: 'items' },
    { key: 'items_missing_department', label: 'Active service items missing department', count: serviceItemsMissingDepartment, severity: 'warning', tab: 'items' },
    { key: 'items_missing_price_matrix', label: 'Active service items missing category price mapping', count: serviceItemsWithoutCategoryPrice, severity: 'warning', tab: 'items' },
    { key: 'packages_missing_components', label: 'Active packages without components', count: packagesMissingComponents, severity: 'warning', tab: 'packages' },
    { key: 'schemes_missing_source', label: 'Discount schemes missing funding source', count: activeSchemesWithoutPolicy, severity: 'warning', tab: 'schemes' },
    { key: 'fiscal_year_not_current', label: 'Current fiscal year is not configured', count: currentFiscalYears === 1 ? 0 : 1, severity: 'critical', tab: 'fiscal' },
  ];

  return c.json({
    data: {
      summary: {
        active_service_items: activeServiceItems,
        inactive_service_items: inactiveServiceItems,
        active_schemes: activeSchemes,
        active_packages: activePackages,
        active_credit_organizations: creditOrganizations,
        active_counters: counters,
        active_deposit_heads: depositHeads,
        active_referral_hospitals: referralHospitals,
      },
      issues,
      health_score: Math.max(0, 100 - issues.reduce((score, issue) => score + (issue.severity === 'critical' ? issue.count * 15 : issue.count * 5), 0)),
    },
  });
});

// ═══════════════════════════════════════════════════════════════════
// BILLING SCHEMES
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/schemes', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const results = await db.select().from(billingSchemes)
    .where(and(eq(billingSchemes.tenantId, tenantId), eq(billingSchemes.isActive, 1)))
    .orderBy(asc(billingSchemes.schemeName));
  const data = results.map(r => ({
    id: r.id,
    scheme_name: r.schemeName,
    scheme_code: r.schemeCode,
    scheme_type: r.schemeType,
    description: r.description,
    default_discount_percent: r.defaultDiscountPercent,
    default_price_category_id: r.defaultPriceCategoryId,
    default_discount_source: r.defaultDiscountSource ?? 'hospital_discount',
    valid_from: r.validFrom,
    valid_to: r.validTo,
    max_discount_amount_per_bill: r.maxDiscountAmountPerBill ?? 0,
    max_discount_amount_per_month: r.maxDiscountAmountPerMonth ?? 0,
    max_discount_amount_per_year: r.maxDiscountAmountPerYear ?? 0,
    approval_required_over_percent: r.approvalRequiredOverPercent ?? 0,
    requires_reference: Boolean(r.requiresReference),
    is_auto_apply: Boolean(r.isAutoApply),
    is_active: r.isActive,
    tenant_id: r.tenantId,
    created_by: r.createdBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
  return c.json({ data });
});

billingMaster.post('/schemes', zValidator('json', createSchemeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const [result] = await db.insert(billingSchemes).values({
    schemeName: data.scheme_name,
    schemeCode: data.scheme_code ?? null,
    schemeType: data.scheme_type as any,
    description: data.description ?? null,
    defaultDiscountPercent: data.default_discount_percent,
    defaultPriceCategoryId: data.default_price_category_id ?? null,
    defaultDiscountSource: data.default_discount_source,
    validFrom: data.valid_from ?? null,
    validTo: data.valid_to ?? null,
    maxDiscountAmountPerBill: data.max_discount_amount_per_bill ?? 0,
    maxDiscountAmountPerMonth: data.max_discount_amount_per_month ?? 0,
    maxDiscountAmountPerYear: data.max_discount_amount_per_year ?? 0,
    approvalRequiredOverPercent: data.approval_required_over_percent ?? 0,
    requiresReference: data.requires_reference ? 1 : 0,
    isAutoApply: data.is_auto_apply ? 1 : 0,
    tenantId,
    createdBy: Number(userId),
  }).returning({ id: billingSchemes.id });

  return c.json({ id: result.id, message: 'Scheme created' }, 201);
});

billingMaster.put('/schemes/:id', zValidator('json', updateSchemeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const [existing] = await db.select({ id: billingSchemes.id }).from(billingSchemes)
    .where(and(eq(billingSchemes.id, id), eq(billingSchemes.tenantId, tenantId))).limit(1);
  if (!existing) throw new HTTPException(404, { message: 'Scheme not found' });

  const updateData: Record<string, any> = {};
  if (data.scheme_name !== undefined) updateData.schemeName = data.scheme_name;
  if (data.scheme_code !== undefined) updateData.schemeCode = data.scheme_code;
  if (data.scheme_type !== undefined) updateData.schemeType = data.scheme_type;
  if (data.description !== undefined) updateData.description = data.description;
  if (data.default_discount_percent !== undefined) updateData.defaultDiscountPercent = data.default_discount_percent;
  if (data.default_price_category_id !== undefined) updateData.defaultPriceCategoryId = data.default_price_category_id ?? null;
  if (data.default_discount_source !== undefined) updateData.defaultDiscountSource = data.default_discount_source;
  if (data.valid_from !== undefined) updateData.validFrom = data.valid_from ?? null;
  if (data.valid_to !== undefined) updateData.validTo = data.valid_to ?? null;
  if (data.max_discount_amount_per_bill !== undefined) updateData.maxDiscountAmountPerBill = data.max_discount_amount_per_bill ?? 0;
  if (data.max_discount_amount_per_month !== undefined) updateData.maxDiscountAmountPerMonth = data.max_discount_amount_per_month ?? 0;
  if (data.max_discount_amount_per_year !== undefined) updateData.maxDiscountAmountPerYear = data.max_discount_amount_per_year ?? 0;
  if (data.approval_required_over_percent !== undefined) updateData.approvalRequiredOverPercent = data.approval_required_over_percent ?? 0;
  if (data.requires_reference !== undefined) updateData.requiresReference = data.requires_reference ? 1 : 0;
  if (data.is_auto_apply !== undefined) updateData.isAutoApply = data.is_auto_apply ? 1 : 0;

  if (Object.keys(updateData).length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updateData.updatedAt = sql`CURRENT_TIMESTAMP`;

  await db.update(billingSchemes).set(updateData)
    .where(and(eq(billingSchemes.id, id), eq(billingSchemes.tenantId, tenantId)));

  return c.json({ message: 'Scheme updated' });
});

billingMaster.delete('/schemes/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const result = await db.update(billingSchemes).set({ isActive: 0 })
    .where(and(eq(billingSchemes.id, id), eq(billingSchemes.tenantId, tenantId), eq(billingSchemes.isActive, 1)));
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Scheme not found' });
  return c.json({ message: 'Scheme deactivated' });
});

billingMaster.get('/schemes/:schemeId/members', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const schemeId = parseId(c.req.param('schemeId'));
  const results = await db.select().from(billingSchemeMembers)
    .where(and(
      eq(billingSchemeMembers.schemeId, schemeId),
      eq(billingSchemeMembers.tenantId, tenantId)
    ))
    .orderBy(desc(billingSchemeMembers.createdAt));
  const data = results.map((m) => ({
    id: m.id,
    scheme_id: m.schemeId,
    patient_id: m.patientId,
    member_code: m.memberCode,
    member_name: m.memberName,
    relation: m.relation,
    valid_from: m.validFrom,
    valid_to: m.validTo,
    status: m.status ?? 'active',
    notes: m.notes,
    created_at: m.createdAt,
    updated_at: m.updatedAt,
  }));
  return c.json({ data });
});

billingMaster.post('/schemes/:schemeId/members', zValidator('json', createSchemeMemberSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const schemeId = parseId(c.req.param('schemeId'));
  const data = c.req.valid('json');
  const [scheme] = await db.select({ id: billingSchemes.id }).from(billingSchemes)
    .where(and(eq(billingSchemes.id, schemeId), eq(billingSchemes.tenantId, tenantId), eq(billingSchemes.isActive, 1))).limit(1);
  if (!scheme) throw new HTTPException(404, { message: 'Scheme not found' });
  const [result] = await db.insert(billingSchemeMembers).values({
    tenantId,
    schemeId,
    patientId: data.patient_id ?? null,
    memberCode: data.member_code ?? null,
    memberName: data.member_name ?? null,
    relation: data.relation ?? null,
    validFrom: data.valid_from ?? null,
    validTo: data.valid_to ?? null,
    status: data.status ?? 'active',
    notes: data.notes ?? null,
    createdBy: Number(userId),
  }).returning({ id: billingSchemeMembers.id });
  return c.json({ id: result.id, message: 'Scheme member added' }, 201);
});

billingMaster.put('/scheme-members/:id', zValidator('json', updateSchemeMemberSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');
  const updateData: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP` };
  if (data.patient_id !== undefined) updateData.patientId = data.patient_id ?? null;
  if (data.member_code !== undefined) updateData.memberCode = data.member_code ?? null;
  if (data.member_name !== undefined) updateData.memberName = data.member_name ?? null;
  if (data.relation !== undefined) updateData.relation = data.relation ?? null;
  if (data.valid_from !== undefined) updateData.validFrom = data.valid_from ?? null;
  if (data.valid_to !== undefined) updateData.validTo = data.valid_to ?? null;
  if (data.status !== undefined) updateData.status = data.status;
  if (data.notes !== undefined) updateData.notes = data.notes ?? null;
  const result = await db.update(billingSchemeMembers).set(updateData)
    .where(and(eq(billingSchemeMembers.id, id), eq(billingSchemeMembers.tenantId, tenantId)));
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Scheme member not found' });
  return c.json({ message: 'Scheme member updated' });
});

billingMaster.delete('/scheme-members/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const result = await db.update(billingSchemeMembers).set({ status: 'inactive', updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(billingSchemeMembers.id, id), eq(billingSchemeMembers.tenantId, tenantId)));
  if (!result.meta.changes) throw new HTTPException(404, { message: 'Scheme member not found' });
  return c.json({ message: 'Scheme member deactivated' });
});

billingMaster.get('/scheme-eligibility', zValidator('query', schemeEligibilityQuerySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('query');
  const preview = await evaluateBillingSchemeEligibility(c.env.DB, {
    tenantId,
    patientId: data.patient_id ?? null,
    schemeId: data.scheme_id ?? null,
    schemeCode: data.scheme_code ?? null,
    memberCode: data.member_code ?? null,
    serviceCategory: data.service_category ?? null,
    subtotal: data.subtotal,
  });
  return c.json(preview);
});

billingMaster.post('/apply-scheme-preview', zValidator('json', applySchemePreviewSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const preview = await evaluateBillingSchemeEligibility(c.env.DB, {
    tenantId,
    patientId: data.patient_id ?? null,
    schemeId: data.scheme_id ?? null,
    schemeCode: data.scheme_code ?? null,
    memberCode: data.member_code ?? null,
    serviceCategory: data.service_category ?? null,
    subtotal: data.subtotal,
  });
  const requestedDiscount = Number(data.requested_discount ?? 0);
  const exceedsCap = preview.eligible && requestedDiscount > 0 && requestedDiscount - preview.suggested_discount > 0.01;
  return c.json({
    ...preview,
    requested_discount: requestedDiscount || null,
    applied_discount: preview.eligible ? Math.min(requestedDiscount || preview.suggested_discount, preview.suggested_discount) : 0,
    eligible: preview.eligible && !exceedsCap,
    blockers: exceedsCap ? [...preview.blockers, 'Requested discount exceeds scheme cap'] : preview.blockers,
  });
});

billingMaster.get('/scheme-preview', zValidator('query', schemePreviewSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('query');
  const today = new Date().toISOString().slice(0, 10);
  const [scheme] = await db.select().from(billingSchemes)
    .where(and(eq(billingSchemes.id, data.scheme_id), eq(billingSchemes.tenantId, tenantId), eq(billingSchemes.isActive, 1))).limit(1);
  if (!scheme) throw new HTTPException(404, { message: 'Scheme not found' });
  const isValidNow = (!scheme.validFrom || String(scheme.validFrom) <= today) && (!scheme.validTo || String(scheme.validTo) >= today);
  const memberRows = await db.select().from(billingSchemeMembers)
    .where(and(eq(billingSchemeMembers.schemeId, data.scheme_id), eq(billingSchemeMembers.tenantId, tenantId), eq(billingSchemeMembers.status, 'active')))
    .limit(25);
  const eligibleMember = data.patient_id
    ? memberRows.find((m) => Number(m.patientId ?? 0) === data.patient_id && (!m.validFrom || String(m.validFrom) <= today) && (!m.validTo || String(m.validTo) >= today))
    : null;
  const requiresMember = memberRows.length > 0;
  const eligible = isValidNow && (!requiresMember || Boolean(eligibleMember));
  const percentDiscount = Math.round((Number(data.gross_amount || 0) * Number(scheme.defaultDiscountPercent || 0)) / 100);
  const cap = Number(scheme.maxDiscountAmountPerBill || 0);
  const suggestedDiscountAmount = cap > 0 ? Math.min(percentDiscount, cap) : percentDiscount;
  return c.json({
    eligible,
    reason: !isValidNow ? 'Scheme is outside valid date range' : requiresMember && !eligibleMember ? 'Patient is not listed as an active scheme member' : null,
    scheme: {
      id: scheme.id,
      scheme_name: scheme.schemeName,
      scheme_type: scheme.schemeType,
      default_discount_percent: scheme.defaultDiscountPercent ?? 0,
      default_price_category_id: scheme.defaultPriceCategoryId ?? null,
      default_discount_source: scheme.defaultDiscountSource ?? 'hospital_discount',
      max_discount_amount_per_bill: cap,
      approval_required_over_percent: scheme.approvalRequiredOverPercent ?? 0,
      requires_reference: Boolean(scheme.requiresReference),
      is_auto_apply: Boolean(scheme.isAutoApply),
    },
    suggested_discount_amount: suggestedDiscountAmount,
    requires_member: requiresMember,
    matched_member_id: eligibleMember?.id ?? null,
  });
});

// Sub-schemes
billingMaster.get('/schemes/:schemeId/sub-schemes', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const schemeId = c.req.param('schemeId');
  const results = await db.select().from(billingSubSchemes)
    .where(and(
      eq(billingSubSchemes.schemeId, Number(schemeId)),
      eq(billingSubSchemes.tenantId, tenantId),
      eq(billingSubSchemes.isActive, 1)
    ));
  const data = results.map(r => ({
    id: r.id,
    scheme_id: r.schemeId,
    sub_scheme_name: r.subSchemeName,
    sub_scheme_code: r.subSchemeCode,
    discount_percent: r.discountPercent,
    is_active: r.isActive,
    tenant_id: r.tenantId,
    created_at: r.createdAt,
  }));
  return c.json({ data });
});

billingMaster.post('/sub-schemes', zValidator('json', createSubSchemeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const [result] = await db.insert(billingSubSchemes).values({
    schemeId: data.scheme_id,
    subSchemeName: data.sub_scheme_name,
    subSchemeCode: data.sub_scheme_code ?? null,
    discountPercent: data.discount_percent,
    tenantId,
  }).returning({ id: billingSubSchemes.id });
  return c.json({ id: result.id, message: 'Sub-scheme created' }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// PRICE CATEGORIES
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/price-categories', async (c) => {
  const tenantId = requireTenantId(c);
  await ensureDefaultPriceCategory(c.env.DB, tenantId);
  const { results } = await c.env.DB.prepare(`
    SELECT id, category_name, category_code, description, is_default, is_active, created_at, updated_at
    FROM price_categories
    WHERE tenant_id = ? AND is_active = 1
    ORDER BY is_default DESC, category_name ASC
  `).bind(tenantId).all();
  return c.json({ data: results });
});

billingMaster.post('/price-categories', zValidator('json', createPriceCategorySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  if (data.is_default) {
    await c.env.DB.prepare('UPDATE price_categories SET is_default = 0 WHERE tenant_id = ?')
      .bind(tenantId).run();
  }
  const result = await c.env.DB.prepare(`
    INSERT INTO price_categories (tenant_id, category_name, category_code, description, is_default, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    data.category_name,
    data.category_code ?? null,
    data.description ?? null,
    data.is_default ? 1 : 0,
  ).run();
  return c.json({ id: result.meta.last_row_id, message: 'Price category created' }, 201);
});

billingMaster.put('/price-categories/:id', zValidator('json', updatePriceCategorySchema), async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM price_categories WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(id, tenantId).first();
  if (!existing) throw new HTTPException(404, { message: 'Price category not found' });

  if (data.is_default) {
    await c.env.DB.prepare('UPDATE price_categories SET is_default = 0 WHERE tenant_id = ? AND id != ?')
      .bind(tenantId, id).run();
  }

  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (data.category_name !== undefined) { updates.push('category_name = ?'); params.push(data.category_name); }
  if (data.category_code !== undefined) { updates.push('category_code = ?'); params.push(data.category_code ?? null); }
  if (data.description !== undefined) { updates.push('description = ?'); params.push(data.description ?? null); }
  if (data.is_default !== undefined) { updates.push('is_default = ?'); params.push(data.is_default ? 1 : 0); }

  if (updates.length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updates.push("updated_at = datetime('now', '+6 hours')");
  params.push(id, tenantId);

  await c.env.DB.prepare(`
    UPDATE price_categories SET ${updates.join(', ')}
    WHERE id = ? AND tenant_id = ?
  `).bind(...params).run();
  return c.json({ message: 'Price category updated' });
});

// Scheme ↔ Price Category mapping
billingMaster.post('/scheme-price-category-map', zValidator('json', schemePriceCategoryMapSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const [result] = await db.insert(billingSchemePriceCategoryMap).values({
    schemeId: data.scheme_id,
    priceCategoryId: data.price_category_id,
    tenantId,
  }).returning({ id: billingSchemePriceCategoryMap.id });
  return c.json({ id: result.id, message: 'Mapping created' }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE DEPARTMENTS
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/service-departments', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { results } = await db.$client.prepare(`
    SELECT id, department_name, department_code, parent_id, is_active, tenant_id, created_by, created_at, updated_at
    FROM billing_service_departments sd
    WHERE sd.tenant_id IN (?, '0')
      AND COALESCE(sd.is_active, 1) = 1
    ORDER BY CASE WHEN sd.tenant_id = ? THEN 0 ELSE 1 END, sd.department_name
  `).bind(tenantId, tenantId).all<Record<string, unknown>>();
  const data = (results ?? []).map(r => ({
    id: r.id,
    department_name: r.department_name,
    department_code: r.department_code,
    parent_id: r.parent_id,
    is_active: r.is_active,
    tenant_id: r.tenant_id,
    created_by: r.created_by,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
  return c.json({ data });
});

billingMaster.post('/service-departments', zValidator('json', createServiceDeptSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const [result] = await db.insert(billingServiceDepartments).values({
    departmentName: data.department_name,
    departmentCode: data.department_code ?? null,
    parentId: data.parent_id ?? null,
    tenantId,
    createdBy: Number(userId),
  }).returning({ id: billingServiceDepartments.id });
  return c.json({ id: result.id, message: 'Service department created' }, 201);
});

billingMaster.put('/service-departments/:id', zValidator('json', updateServiceDeptSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const updateData: Record<string, any> = {};
  if (data.department_name !== undefined) updateData.departmentName = data.department_name;
  if (data.department_code !== undefined) updateData.departmentCode = data.department_code;
  if (data.parent_id !== undefined) updateData.parentId = data.parent_id;

  if (Object.keys(updateData).length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updateData.updatedAt = sql`CURRENT_TIMESTAMP`;

  await db.update(billingServiceDepartments).set(updateData)
    .where(and(eq(billingServiceDepartments.id, id), eq(billingServiceDepartments.tenantId, tenantId)));
  return c.json({ message: 'Service department updated' });
});

// ═══════════════════════════════════════════════════════════════════
// SERVICE ITEMS
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/service-items', zValidator('query', listServiceItemsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { search, department_id, page, per_page } = c.req.valid('query');
  const offset = (page - 1) * per_page;
  await ensureServiceItemTenantOverridesTable(c.env.DB);

  let sql = `
    SELECT si.*, sd.department_name,
           CASE WHEN sd.department_code = 'LAB' THEN COALESCE((
             SELECT ltc.is_commissionable
             FROM lab_test_catalog ltc
             WHERE ltc.tenant_id = si.tenant_id
               AND (
                 ltc.billing_service_item_id = si.id
                 OR (ltc.billing_service_item_id IS NULL AND ltc.code = si.item_code)
               )
             ORDER BY CASE WHEN ltc.billing_service_item_id IS NOT NULL THEN 0 ELSE 1 END, ltc.id
             LIMIT 1
           ), 1) ELSE NULL END AS is_commissionable
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON si.service_department_id = sd.id
     AND sd.tenant_id IN (si.tenant_id, '0')
     AND COALESCE(sd.is_active, 1) = 1
    WHERE si.tenant_id IN (?, '0') AND si.is_active = 1
      AND (si.service_department_id IS NULL OR sd.id IS NOT NULL)
      AND (
        si.tenant_id != '0'
        OR NOT EXISTS (
          SELECT 1 FROM billing_service_item_tenant_overrides sio
          WHERE ? = sio.tenant_id
            AND sio.global_service_item_id = si.id
            AND sio.is_hidden = 1
        )
      )
  `;
  const params: (string | number)[] = [tenantId, tenantId];

  if (search) {
    sql += ' AND (si.item_name LIKE ? OR si.item_code LIKE ?)';
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }
  if (department_id) {
    sql += ' AND si.service_department_id = ?';
    params.push(department_id);
  }

  sql += ` ORDER BY CASE WHEN si.tenant_id = ? THEN 0 ELSE 1 END, si.display_order, si.item_name LIMIT ? OFFSET ?`;
  params.push(tenantId);
  params.push(per_page, offset);

  const { results } = await db.$client.prepare(sql).bind(...params).all();

  // Count total
  let countSql = `
    SELECT COUNT(*) as total
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON si.service_department_id = sd.id
     AND sd.tenant_id IN (si.tenant_id, '0')
     AND COALESCE(sd.is_active, 1) = 1
    WHERE si.tenant_id IN (?, '0') AND si.is_active = 1
      AND (si.service_department_id IS NULL OR sd.id IS NOT NULL)
      AND (
        si.tenant_id != '0'
        OR NOT EXISTS (
          SELECT 1 FROM billing_service_item_tenant_overrides sio
          WHERE ? = sio.tenant_id
            AND sio.global_service_item_id = si.id
            AND sio.is_hidden = 1
        )
      )
  `;
  const countParams: (string | number)[] = [tenantId, tenantId];
  if (search) { countSql += ' AND (si.item_name LIKE ? OR si.item_code LIKE ?)'; const p = `%${search}%`; countParams.push(p, p); }
  if (department_id) { countSql += ' AND si.service_department_id = ?'; countParams.push(department_id); }
  const total = await db.$client.prepare(countSql).bind(...countParams).first<{ total: number }>();

  return c.json({ data: results, pagination: { page, per_page, total: total?.total ?? 0 } });
});

billingMaster.get('/service-items/:id/performer-payout-rule', async (c) => {
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const item = await loadTenantDiagnosticServiceItem(c.env.DB, tenantId, id);
  if (!item) {
    throw new HTTPException(400, { message: 'Performer payout rules are available only for tenant LAB or RAD service items' });
  }

  const current = await c.env.DB.prepare(`
    SELECT id, tenant_id, billing_service_item_id, diagnostic_kind, rate_type, rate_value,
           effective_from, effective_to, is_active, notes, created_at, updated_at
    FROM diagnostic_performer_payout_rules
    WHERE tenant_id = ?
      AND billing_service_item_id = ?
      AND is_active = 1
      AND date(effective_from) <= date('now', '+6 hours')
      AND (effective_to IS NULL OR date(effective_to) >= date('now', '+6 hours'))
    ORDER BY effective_from DESC, id DESC
    LIMIT 1
  `).bind(tenantId, id).first<DiagnosticPerformerRuleRow>();

  const { results: history } = await c.env.DB.prepare(`
    SELECT id, tenant_id, billing_service_item_id, diagnostic_kind, rate_type, rate_value,
           effective_from, effective_to, is_active, notes, created_at, updated_at
    FROM diagnostic_performer_payout_rules
    WHERE tenant_id = ? AND billing_service_item_id = ?
    ORDER BY effective_from DESC, id DESC
    LIMIT 25
  `).bind(tenantId, id).all<DiagnosticPerformerRuleRow>();

  return c.json({
    service_item: {
      id: Number(item.id),
      item_name: item.item_name,
      item_code: item.item_code,
      price: Number(item.price ?? 0),
      diagnostic_kind: item.diagnostic_kind,
    },
    current: serializePerformerRule(current ?? null),
    history: (history ?? []).map((row) => serializePerformerRule(row)),
  });
});

billingMaster.put(
  '/service-items/:id/performer-payout-rule',
  zValidator('json', performerPayoutRuleSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    const actorId = requireMasterDataActorId(c.get('userId'));
    const id = parseId(c.req.param('id'));
    const data = c.req.valid('json');
    assertCalendarDate(data.effective_from);

    const item = await loadTenantDiagnosticServiceItem(c.env.DB, tenantId, id);
    if (!item) {
      throw new HTTPException(400, { message: 'Performer payout rules are available only for tenant LAB or RAD service items' });
    }

    const latest = await c.env.DB.prepare(`
      SELECT id, tenant_id, billing_service_item_id, diagnostic_kind, rate_type, rate_value,
             effective_from, effective_to, is_active, notes, created_at, updated_at
      FROM diagnostic_performer_payout_rules
      WHERE tenant_id = ? AND billing_service_item_id = ?
      ORDER BY effective_from DESC, id DESC
      LIMIT 1
    `).bind(tenantId, id).first<DiagnosticPerformerRuleRow>();

    const normalizedRule = data.enabled
      ? data.rate_type === 'flat'
        ? normalizePerformerRule({ rateType: 'flat', flatAmount: data.flat_amount })
        : normalizePerformerRule({ rateType: 'percent', percent: data.percent })
      : null;
    const normalizedNotes = data.notes?.trim() || null;
    const unchangedSameDateRule = Boolean(
      latest
      && latest.diagnostic_kind === item.diagnostic_kind
      && data.effective_from === latest.effective_from
      && (
        (!data.enabled && Number(latest.is_active ?? 0) === 0)
        || (
          data.enabled
          && Number(latest.is_active ?? 0) === 1
          && normalizedRule
          && latest.rate_type === normalizedRule.rateType
          && Number(latest.rate_value) === normalizedRule.rateValue
          && (latest.notes?.trim() || null) === normalizedNotes
        )
      ),
    );
    if (unchangedSameDateRule && latest) {
      return c.json({
        message: 'Performer payout rule unchanged',
        data: serializePerformerRule(latest),
        unchanged: true,
      });
    }

    if (latest && data.effective_from <= latest.effective_from) {
      throw new HTTPException(409, { message: 'New rule effective date must be after the latest rule version' });
    }

    const authoritativeStatements: D1PreparedStatement[] = [];
    if (latest) {
      authoritativeStatements.push(c.env.DB.prepare(`
        UPDATE diagnostic_performer_payout_rules
        SET effective_to = ?, is_active = 0, updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ? AND billing_service_item_id = ?
      `).bind(previousCalendarDate(data.effective_from), latest.id, tenantId, id));
    }

    let responseRule: ReturnType<typeof serializePerformerRule> = null;
    let nextSnapshot: LegacyDiagnosticPerformerRuleSnapshot | null = null;
    if (data.enabled) {
      const normalized = normalizedRule!;
      authoritativeStatements.push(c.env.DB.prepare(`
        INSERT INTO diagnostic_performer_payout_rules (
          tenant_id, billing_service_item_id, diagnostic_kind, rate_type, rate_value,
          effective_from, effective_to, is_active, notes, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
      `).bind(
        tenantId,
        id,
        item.diagnostic_kind,
        normalized.rateType,
        normalized.rateValue,
        data.effective_from,
        data.notes?.trim() || null,
        actorId,
      ));
      const nextRuleRow: DiagnosticPerformerRuleRow = {
        id: 0,
        tenant_id: tenantId,
        billing_service_item_id: id,
        diagnostic_kind: item.diagnostic_kind,
        rate_type: normalized.rateType,
        rate_value: normalized.rateValue,
        effective_from: data.effective_from,
        effective_to: null,
        is_active: 1,
        notes: data.notes?.trim() || null,
      };
      responseRule = serializePerformerRule(nextRuleRow);
      nextSnapshot = diagnosticRuleSnapshot(nextRuleRow);
    }

    const audit = prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId: actorId,
      action: latest ? 'UPDATE' : 'CREATE',
      tableName: 'diagnostic_performer_payout_rules',
      recordId: latest?.id,
      oldValue: latest ?? null,
      newValue: {
        serviceItemId: id,
        diagnosticKind: item.diagnostic_kind,
        ...data,
        normalizedRule: responseRule,
      },
      ...auditRequestMetadata(c),
    });
    authoritativeStatements.push(audit);

    const serviceReference = {
      id,
      itemCode: item.item_code ?? null,
      itemName: item.item_name,
      diagnosticKind: item.diagnostic_kind,
      isActive: true,
    };
    const occurredAtUtc = new Date().toISOString();
    const businessDate = getTodayGMT6();
    const suppliedIdempotencyKey = billingRuleIdempotencyKey(c.req);

    if (latest && data.enabled && nextSnapshot) {
      const currentContext = await buildDiagnosticPerformerRuleContext(c.env.DB, {
        tenantId,
        rule: diagnosticRuleSnapshot(latest),
        service: serviceReference,
      });
      const nextContext = await buildDiagnosticPerformerRuleContext(c.env.DB, {
        tenantId,
        rule: nextSnapshot,
        service: serviceReference,
      });
      await replaceRouteCompensationRule(c.env.DB, currentContext, nextContext, {
        authoritativeStatements,
        occurredAtUtc,
        businessDate,
        idempotencyKey: `route:diagnostic-performer:replace:${suppliedIdempotencyKey ?? `${id}:${nextContext.snapshot.sourceEvidenceSha256}`}`,
      });
    } else if (!latest && data.enabled && nextSnapshot) {
      const nextContext = await buildDiagnosticPerformerRuleContext(c.env.DB, {
        tenantId,
        rule: nextSnapshot,
        service: serviceReference,
      });
      await createRouteCompensationRule(c.env.DB, nextContext, {
        authoritativeStatements,
        occurredAtUtc,
        businessDate,
        idempotencyKey: `route:diagnostic-performer:create:${suppliedIdempotencyKey ?? `${id}:${nextContext.snapshot.sourceEvidenceSha256}`}`,
      });
    } else if (latest && !data.enabled) {
      const currentContext = await buildDiagnosticPerformerRuleContext(c.env.DB, {
        tenantId,
        rule: diagnosticRuleSnapshot(latest),
        service: serviceReference,
      });
      await retireRouteCompensationRule(c.env.DB, currentContext, {
        authoritativeStatements,
        occurredAtUtc,
        businessDate,
        idempotencyKey: `route:diagnostic-performer:retire:${suppliedIdempotencyKey ?? `${id}:${currentContext.snapshot.sourceEvidenceSha256}:${data.effective_from}`}`,
        reasonCode: 'legacy-route-disable',
      });
    } else {
      await c.env.DB.batch(authoritativeStatements);
    }
    return c.json({
      message: data.enabled ? 'Performer payout rule saved' : 'Performer payout rule disabled',
      data: responseRule,
    });
  },
);

billingMaster.get('/service-items/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const item = await db.$client.prepare(`
    SELECT si.*, sd.department_name,
           CASE WHEN sd.department_code = 'LAB' THEN COALESCE((
             SELECT ltc.is_commissionable
             FROM lab_test_catalog ltc
             WHERE ltc.tenant_id = si.tenant_id
               AND (
                 ltc.billing_service_item_id = si.id
                 OR (ltc.billing_service_item_id IS NULL AND ltc.code = si.item_code)
               )
             ORDER BY CASE WHEN ltc.billing_service_item_id IS NOT NULL THEN 0 ELSE 1 END, ltc.id
             LIMIT 1
           ), 1) ELSE NULL END AS is_commissionable
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON si.service_department_id = sd.id
     AND sd.tenant_id IN (si.tenant_id, '0')
     AND COALESCE(sd.is_active, 1) = 1
    WHERE si.id = ? AND si.tenant_id = ?
  `).bind(id, tenantId).first();
  if (!item) throw new HTTPException(404, { message: 'Service item not found' });
  return c.json({ data: item });
});

billingMaster.post('/service-items', zValidator('json', createServiceItemSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  await ensureServiceDepartmentScope(c.env.DB, tenantId, data.service_department_id);

  const serviceItemId = await nextBillingServiceItemId(c.env.DB);
  const defaultCategoryId = await ensureDefaultPriceCategory(c.env.DB, tenantId);
  const canonicalSourceKey = billingServiceCanonicalSourceKey(serviceItemId);
  const priceMapSourceKey = billingPriceMapCanonicalSourceKey(serviceItemId, defaultCategoryId);
  const occurredAtUtc = new Date().toISOString();
  const departmentCode = await serviceDepartmentCode(c.env.DB, tenantId, data.service_department_id);
  const serviceInsert = c.env.DB.prepare(`
    INSERT INTO billing_service_items (
      id,item_name,item_code,service_department_id,price,tax_applicable,tax_percent,
      allow_discount,allow_multiple_qty,description,display_order,is_active,tenant_id,
      canonical_source_key,created_by,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
  `).bind(
    serviceItemId,
    data.item_name,
    data.item_code ?? null,
    data.service_department_id ?? null,
    data.price,
    data.tax_applicable ? 1 : 0,
    data.tax_percent,
    data.allow_discount ? 1 : 0,
    data.allow_multiple_qty ? 1 : 0,
    data.description ?? null,
    data.display_order,
    1,
    tenantId,
    canonicalSourceKey,
    Number(userId),
  );
  const priceMapInsert = c.env.DB.prepare(`
    INSERT INTO billing_item_price_category_maps (
      tenant_id,service_item_id,price_category_id,price,is_discount_applicable,is_active,
      canonical_source_key,created_at,updated_at
    ) VALUES (?,?,?,?,?,1,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
  `).bind(
    tenantId,
    serviceItemId,
    defaultCategoryId,
    data.price,
    data.allow_discount ? 1 : 0,
    priceMapSourceKey,
  );

  await applyBillingServiceCatalogMutation(c.env.DB, {
    tenantId,
    canonicalSourceKey,
    snapshot: {
      serviceItemId,
      itemName: data.item_name,
      itemCode: data.item_code ?? null,
      departmentCode,
      price: data.price,
      isActive: true,
    },
    defaultPriceCategoryId: defaultCategoryId,
    occurredAtUtc,
    businessDate: getTodayGMT6(),
    idempotencyKey: serviceMutationIdempotencyKey(
      c.req,
      'create',
      `${serviceItemId}:${canonicalSourceKey}`,
    ),
  }, {
    authoritativeStatements: [serviceInsert, priceMapInsert],
  });
  await syncDiagnosticCatalogFromBillingServiceItem(c.env.DB, tenantId, serviceItemId, userId, {
    isCommissionable: data.is_commissionable,
  });

  return c.json({ id: serviceItemId, message: 'Service item created' }, 201);
});

billingMaster.put('/service-items/:id', zValidator('json', updateServiceItemSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');
  await ensureServiceDepartmentScope(c.env.DB, tenantId, data.service_department_id);

  const existingItem = await c.env.DB.prepare(`
    SELECT *
    FROM billing_service_items
    WHERE id = ?
      AND tenant_id IN (?, '0')
      AND COALESCE(is_active, 1) = 1
    LIMIT 1
  `).bind(id, tenantId).first<Record<string, any>>();
  if (!existingItem?.id) throw new HTTPException(404, { message: 'Service item not found' });

  const suppliedFields = [
    data.item_name,
    data.item_code,
    data.service_department_id,
    data.price,
    data.tax_applicable,
    data.tax_percent,
    data.allow_discount,
    data.allow_multiple_qty,
    data.description,
    data.display_order,
  ];
  if (suppliedFields.every((value) => value === undefined)) {
    throw new HTTPException(400, { message: 'No fields to update' });
  }

  const itemName = data.item_name ?? String(existingItem.item_name ?? '');
  const itemCode = data.item_code !== undefined ? (data.item_code ?? null) : (existingItem.item_code ?? null);
  const serviceDepartmentId = data.service_department_id !== undefined
    ? (data.service_department_id ?? null)
    : (existingItem.service_department_id ?? null);
  const price = data.price !== undefined ? data.price : Number(existingItem.price ?? 0);
  const taxApplicable = data.tax_applicable !== undefined
    ? (data.tax_applicable ? 1 : 0)
    : Number(existingItem.tax_applicable ?? 0);
  const taxPercent = data.tax_percent !== undefined ? data.tax_percent : Number(existingItem.tax_percent ?? 0);
  const allowDiscount = data.allow_discount !== undefined
    ? (data.allow_discount ? 1 : 0)
    : Number(existingItem.allow_discount ?? 1);
  const allowMultipleQty = data.allow_multiple_qty !== undefined
    ? (data.allow_multiple_qty ? 1 : 0)
    : Number(existingItem.allow_multiple_qty ?? 1);
  const description = data.description !== undefined ? (data.description ?? null) : (existingItem.description ?? null);
  const displayOrder = data.display_order !== undefined ? data.display_order : Number(existingItem.display_order ?? 0);
  const occurredAtUtc = new Date().toISOString();
  const departmentCode = await serviceDepartmentCode(c.env.DB, tenantId, serviceDepartmentId);

  if (String(existingItem.tenant_id) === '0' && String(tenantId) !== '0') {
    await ensureServiceItemTenantOverridesTable(c.env.DB);
    const tenantServiceItemId = await nextBillingServiceItemId(c.env.DB);
    const defaultCategoryId = await ensureDefaultPriceCategory(c.env.DB, tenantId);
    const canonicalSourceKey = billingServiceCanonicalSourceKey(tenantServiceItemId);
    const priceMapSourceKey = billingPriceMapCanonicalSourceKey(tenantServiceItemId, defaultCategoryId);
    const serviceInsert = c.env.DB.prepare(`
      INSERT INTO billing_service_items (
        id,item_name,item_code,service_department_id,price,tax_applicable,tax_percent,
        allow_discount,allow_multiple_qty,description,display_order,is_active,tenant_id,
        canonical_source_key,created_by,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
    `).bind(
      tenantServiceItemId,
      itemName,
      itemCode,
      serviceDepartmentId,
      price,
      taxApplicable,
      taxPercent,
      allowDiscount,
      allowMultipleQty,
      description,
      displayOrder,
      1,
      tenantId,
      canonicalSourceKey,
      Number(userId),
    );
    const priceMapInsert = c.env.DB.prepare(`
      INSERT INTO billing_item_price_category_maps (
        tenant_id,service_item_id,price_category_id,price,is_discount_applicable,is_active,
        canonical_source_key,created_at,updated_at
      ) VALUES (?,?,?,?,?,1,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
    `).bind(
      tenantId,
      tenantServiceItemId,
      defaultCategoryId,
      price,
      allowDiscount,
      priceMapSourceKey,
    );
    const overrideStatement = c.env.DB.prepare(`
      INSERT INTO billing_service_item_tenant_overrides
        (tenant_id, global_service_item_id, is_hidden, created_by, created_at, updated_at)
      VALUES (?, ?, 1, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
      ON CONFLICT(tenant_id, global_service_item_id)
      DO UPDATE SET is_hidden = 1, updated_at = datetime('now', '+6 hours')
    `).bind(tenantId, id, Number(userId));

    await applyBillingServiceCatalogMutation(c.env.DB, {
      tenantId,
      canonicalSourceKey,
      snapshot: {
        serviceItemId: tenantServiceItemId,
        itemName,
        itemCode,
        departmentCode,
        price,
        isActive: true,
      },
      defaultPriceCategoryId: defaultCategoryId,
      occurredAtUtc,
      businessDate: getTodayGMT6(),
      idempotencyKey: serviceMutationIdempotencyKey(
        c.req,
        'copy-global',
        `${id}:${tenantServiceItemId}:${price}`,
      ),
    }, {
      authoritativeStatements: [serviceInsert, priceMapInsert, overrideStatement],
    });
    await syncDiagnosticCatalogFromBillingServiceItem(c.env.DB, tenantId, tenantServiceItemId, userId, {
      isCommissionable: data.is_commissionable,
    });
    return c.json({ id: tenantServiceItemId, message: 'Default service item copied and customized for this hospital' });
  }

  const canonicalSourceKey = String(existingItem.canonical_source_key || billingServiceCanonicalSourceKey(id));
  const authoritativeStatements = [c.env.DB.prepare(`
    UPDATE billing_service_items
    SET item_name=?,item_code=?,service_department_id=?,price=?,tax_applicable=?,tax_percent=?,
        allow_discount=?,allow_multiple_qty=?,description=?,display_order=?,canonical_source_key=?,
        updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND tenant_id=? AND COALESCE(is_active,1)=1
  `).bind(
    itemName,
    itemCode,
    serviceDepartmentId,
    price,
    taxApplicable,
    taxPercent,
    allowDiscount,
    allowMultipleQty,
    description,
    displayOrder,
    canonicalSourceKey,
    id,
    tenantId,
  )];
  let defaultCategoryId: number | null = null;
  if (data.price !== undefined) {
    defaultCategoryId = await ensureDefaultPriceCategory(c.env.DB, tenantId);
    authoritativeStatements.push(c.env.DB.prepare(`
      INSERT INTO billing_item_price_category_maps (
        tenant_id,service_item_id,price_category_id,price,is_discount_applicable,is_active,
        canonical_source_key,created_at,updated_at
      ) VALUES (?,?,?,?,?,1,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
      ON CONFLICT(tenant_id,service_item_id,price_category_id)
      DO UPDATE SET price=excluded.price,
                    is_discount_applicable=excluded.is_discount_applicable,
                    is_active=1,
                    canonical_source_key=COALESCE(billing_item_price_category_maps.canonical_source_key, excluded.canonical_source_key),
                    updated_at=datetime('now', '+6 hours')
    `).bind(
      tenantId,
      id,
      defaultCategoryId,
      price,
      allowDiscount,
      billingPriceMapCanonicalSourceKey(id, defaultCategoryId),
    ));
  }

  await applyBillingServiceCatalogMutation(c.env.DB, {
    tenantId,
    canonicalSourceKey,
    snapshot: {
      serviceItemId: id,
      itemName,
      itemCode,
      departmentCode,
      price,
      isActive: true,
    },
    defaultPriceCategoryId: defaultCategoryId,
    occurredAtUtc,
    businessDate: getTodayGMT6(),
    idempotencyKey: serviceMutationIdempotencyKey(
      c.req,
      'update',
      `${id}:${occurredAtUtc}:${price}`,
    ),
  }, { authoritativeStatements });
  await syncDiagnosticCatalogFromBillingServiceItem(c.env.DB, tenantId, id, userId, {
    isCommissionable: data.is_commissionable,
  });

  return c.json({ message: 'Service item updated' });
});

billingMaster.delete('/service-items/:id', async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = parseId(c.req.param('id'));
  await ensureServiceItemTenantOverridesTable(c.env.DB);

  const item = await c.env.DB.prepare(`
    SELECT si.*,
           (SELECT sd.department_code
            FROM billing_service_departments sd
            WHERE sd.id=si.service_department_id AND sd.tenant_id IN (si.tenant_id,'0')
            LIMIT 1) AS department_code
    FROM billing_service_items si
    WHERE si.id = ? AND si.tenant_id IN (?, '0') AND COALESCE(si.is_active,1)=1
    LIMIT 1
  `).bind(id, tenantId).first<Record<string, any>>();

  if (!item?.id) throw new HTTPException(404, { message: 'Service item not found' });

  if (String(item.tenant_id) === '0') {
    await c.env.DB.prepare(`
      INSERT INTO billing_service_item_tenant_overrides
        (tenant_id, global_service_item_id, is_hidden, created_by, created_at, updated_at)
      VALUES (?, ?, 1, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'))
      ON CONFLICT(tenant_id, global_service_item_id)
      DO UPDATE SET is_hidden = 1,
                    updated_at = datetime('now', '+6 hours')
    `).bind(tenantId, id, Number(userId)).run();
    return c.json({ message: 'Default service item hidden for this hospital' });
  }

  const canonicalSourceKey = String(item.canonical_source_key || billingServiceCanonicalSourceKey(id));
  const occurredAtUtc = new Date().toISOString();
  await applyBillingServiceCatalogMutation(c.env.DB, {
    tenantId,
    canonicalSourceKey,
    snapshot: {
      serviceItemId: id,
      itemName: String(item.item_name ?? ''),
      itemCode: item.item_code == null ? null : String(item.item_code),
      departmentCode: item.department_code == null ? null : String(item.department_code),
      price: Number(item.price ?? 0),
      isActive: false,
    },
    occurredAtUtc,
    businessDate: getTodayGMT6(),
    idempotencyKey: serviceMutationIdempotencyKey(
      c.req,
      'deactivate',
      `${id}:${occurredAtUtc}`,
    ),
  }, {
    authoritativeStatements: [c.env.DB.prepare(`
      UPDATE billing_service_items
      SET is_active=0,canonical_source_key=?,updated_at=CURRENT_TIMESTAMP
      WHERE id=? AND tenant_id=? AND COALESCE(is_active,1)=1
    `).bind(canonicalSourceKey, id, tenantId)],
  });
  await syncDiagnosticCatalogFromBillingServiceItem(c.env.DB, tenantId, id, userId);
  return c.json({ message: 'Service item deactivated' });
});

// Price Matrix
billingMaster.get('/price-matrix', async (c) => {
  const tenantId = requireTenantId(c);
  await ensureDefaultPriceCategory(c.env.DB, tenantId);

  const url = new URL(c.req.url);
  const search = url.searchParams.get('search')?.trim() ?? '';
  const departmentId = Number(url.searchParams.get('department_id') ?? 0);
  const limit = Math.min(300, Math.max(25, Number(url.searchParams.get('limit') ?? 150)));

  const categoryResult = await c.env.DB.prepare(`
    SELECT id, category_name, category_code, is_default
    FROM price_categories
    WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1
    ORDER BY is_default DESC, category_name ASC
  `).bind(tenantId).all<Record<string, unknown>>();

  let itemSql = `
    SELECT si.id, si.item_name, si.item_code, si.price, si.allow_discount, sd.department_name
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON si.service_department_id = sd.id
     AND sd.tenant_id IN (si.tenant_id, '0')
     AND COALESCE(sd.is_active, 1) = 1
    WHERE si.tenant_id = ?
      AND COALESCE(si.is_active, 1) = 1
  `;
  const itemParams: Array<string | number> = [tenantId];
  if (search) {
    itemSql += ` AND (LOWER(si.item_name) LIKE ? OR LOWER(COALESCE(si.item_code, '')) LIKE ?)`;
    const pattern = `%${search.toLowerCase()}%`;
    itemParams.push(pattern, pattern);
  }
  if (Number.isFinite(departmentId) && departmentId > 0) {
    itemSql += ` AND si.service_department_id = ?`;
    itemParams.push(departmentId);
  }
  itemSql += ` ORDER BY COALESCE(sd.department_name, ''), si.item_name ASC LIMIT ?`;
  itemParams.push(limit);

  const itemResult = await c.env.DB.prepare(itemSql).bind(...itemParams).all<Record<string, unknown>>();
  const rows = (itemResult.results ?? []);
  const itemIds = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));

  let mapRows: Record<string, unknown>[] = [];
  if (itemIds.length > 0) {
    const placeholders = itemIds.map(() => '?').join(',');
    const mapResult = await c.env.DB.prepare(`
      SELECT id, service_item_id, price_category_id, price, is_discount_applicable
      FROM billing_item_price_category_maps
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 1
        AND service_item_id IN (${placeholders})
    `).bind(tenantId, ...itemIds).all<Record<string, unknown>>();
    mapRows = mapResult.results ?? [];
  }

  const mappingByItemCategory = new Map<string, Record<string, unknown>>();
  for (const mapping of mapRows) {
    mappingByItemCategory.set(`${mapping.service_item_id}:${mapping.price_category_id}`, mapping);
  }

  const categories = (categoryResult.results ?? []).map((category) => ({
    id: Number(category.id),
    category_name: String(category.category_name ?? ''),
    category_code: category.category_code ?? null,
    is_default: Boolean(category.is_default),
  }));

  return c.json({
    data: {
      categories,
      rows: rows.map((item) => {
        const basePrice = Number(item.price ?? 0);
        return {
          service_item_id: Number(item.id),
          item_name: item.item_name,
          item_code: item.item_code,
          department_name: item.department_name,
          base_price: basePrice,
          allow_discount: Boolean(item.allow_discount),
          prices: categories.map((category) => {
            const mapping = mappingByItemCategory.get(`${item.id}:${category.id}`);
            return {
              price_category_id: category.id,
              mapping_id: mapping?.id ? Number(mapping.id) : null,
              price: mapping?.price != null ? Number(mapping.price) : basePrice,
              is_discount_applicable: mapping?.is_discount_applicable == null ? Boolean(item.allow_discount) : Boolean(mapping.is_discount_applicable),
              inherited_from_base: !mapping,
            };
          }),
        };
      }),
    },
  });
});

billingMaster.put('/price-matrix', zValidator('json', priceMatrixSaveSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const occurredAtUtc = new Date().toISOString();

  for (const mapping of data.mappings) {
    const sourceKey = billingPriceMapCanonicalSourceKey(
      mapping.service_item_id,
      mapping.price_category_id,
    );
    const authoritative = c.env.DB.prepare(`
      INSERT INTO billing_item_price_category_maps (
        tenant_id,service_item_id,price_category_id,price,is_discount_applicable,is_active,
        canonical_source_key,created_at,updated_at
      ) VALUES (?,?,?,?,?,1,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
      ON CONFLICT(tenant_id,service_item_id,price_category_id)
      DO UPDATE SET price=excluded.price,
                    is_discount_applicable=excluded.is_discount_applicable,
                    is_active=1,
                    canonical_source_key=COALESCE(billing_item_price_category_maps.canonical_source_key, excluded.canonical_source_key),
                    updated_at=datetime('now', '+6 hours')
    `).bind(
      tenantId,
      mapping.service_item_id,
      mapping.price_category_id,
      mapping.price,
      mapping.is_discount_applicable ? 1 : 0,
      sourceKey,
    );
    await applyBillingServiceCategoryPriceMutation(c.env.DB, {
      tenantId,
      serviceItemId: mapping.service_item_id,
      priceCategoryId: mapping.price_category_id,
      price: mapping.price,
      isActive: true,
      occurredAtUtc,
      businessDate: getTodayGMT6(),
      idempotencyKey: serviceMutationIdempotencyKey(
        c.req,
        `price-matrix:${mapping.service_item_id}:${mapping.price_category_id}`,
        `${sourceKey}:${mapping.price}`,
      ),
    }, { authoritativeStatements: [authoritative] });
  }

  return c.json({ message: 'Price matrix saved', saved: data.mappings.length });
});

// Item ↔ Price Category mapping
billingMaster.post('/item-price-category-map', zValidator('json', itemPriceCategoryMapSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const sourceKey = billingPriceMapCanonicalSourceKey(data.service_item_id, data.price_category_id);
  const occurredAtUtc = new Date().toISOString();
  const authoritative = c.env.DB.prepare(`
    INSERT INTO billing_item_price_category_maps (
      tenant_id,service_item_id,price_category_id,price,is_discount_applicable,is_active,
      canonical_source_key,created_at,updated_at
    ) VALUES (?,?,?,?,?,1,?,datetime('now', '+6 hours'),datetime('now', '+6 hours'))
    ON CONFLICT(tenant_id,service_item_id,price_category_id)
    DO UPDATE SET price=excluded.price,
                  is_discount_applicable=excluded.is_discount_applicable,
                  is_active=1,
                  canonical_source_key=COALESCE(billing_item_price_category_maps.canonical_source_key, excluded.canonical_source_key),
                  updated_at=datetime('now', '+6 hours')
  `).bind(
    tenantId,
    data.service_item_id,
    data.price_category_id,
    data.price,
    data.discount_percent >= 100 ? 0 : 1,
    sourceKey,
  );
  await applyBillingServiceCategoryPriceMutation(c.env.DB, {
    tenantId,
    serviceItemId: data.service_item_id,
    priceCategoryId: data.price_category_id,
    price: data.price,
    isActive: true,
    occurredAtUtc,
    businessDate: getTodayGMT6(),
    idempotencyKey: serviceMutationIdempotencyKey(
      c.req,
      `item-price-map:${data.service_item_id}:${data.price_category_id}`,
      `${sourceKey}:${data.price}`,
    ),
  }, { authoritativeStatements: [authoritative] });
  const row = await c.env.DB.prepare(`
    SELECT id FROM billing_item_price_category_maps
    WHERE tenant_id=? AND service_item_id=? AND price_category_id=?
    LIMIT 1
  `).bind(tenantId, data.service_item_id, data.price_category_id).first<{ id: number }>();
  return c.json({ id: Number(row?.id ?? 0), message: 'Price mapping saved' }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// COUNTERS
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/counters', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const results = await db.select().from(billingCounters)
    .where(and(eq(billingCounters.tenantId, tenantId), eq(billingCounters.isActive, 1)))
    .orderBy(asc(billingCounters.counterName));

  // Transform camelCase to snake_case for frontend
  const data = results.map(r => ({
    id: r.id,
    counter_name: r.counterName,
    counter_code: r.counterCode,
    counter_type: r.counterType,
    location: r.location,
    description: r.description,
    cash_visibility_mode: r.cashVisibilityMode ?? 'show_all',
    is_active: r.isActive,
    tenant_id: r.tenantId,
    created_at: r.createdAt,
  }));

  return c.json({ data });
});

billingMaster.post('/counters', zValidator('json', createCounterSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const [result] = await db.insert(billingCounters).values({
    counterName: data.counter_name,
    counterCode: data.counter_code || null,
    counterType: data.counter_type,
    location: data.location || null,
    description: data.description || null,
    cashVisibilityMode: data.cash_visibility_mode ?? 'show_all',
    tenantId,
  }).returning({ id: billingCounters.id });
  return c.json({ id: result.id, message: 'Counter created' }, 201);
});

billingMaster.put('/counters/:id', zValidator('json', createCounterSchema.partial()), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const existing = await db.select().from(billingCounters)
    .where(and(eq(billingCounters.id, id), eq(billingCounters.tenantId, tenantId), eq(billingCounters.isActive, 1)))
    .limit(1);
  if (existing.length === 0) throw new HTTPException(404, { message: 'Counter not found' });

  await db.update(billingCounters).set({
    counterName: data.counter_name ?? existing[0].counterName,
    counterCode: data.counter_code ?? existing[0].counterCode,
    counterType: data.counter_type ?? existing[0].counterType,
    location: data.location ?? existing[0].location,
    description: data.description ?? existing[0].description,
    cashVisibilityMode: data.cash_visibility_mode ?? existing[0].cashVisibilityMode,
  }).where(and(eq(billingCounters.id, id), eq(billingCounters.tenantId, tenantId)));

  return c.json({ message: 'Counter updated' });
});

billingMaster.delete('/counters/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const existing = await db.select().from(billingCounters)
    .where(and(eq(billingCounters.id, id), eq(billingCounters.tenantId, tenantId), eq(billingCounters.isActive, 1)))
    .limit(1);
  if (existing.length === 0) throw new HTTPException(404, { message: 'Counter not found' });

  await db.update(billingCounters).set({ isActive: 0 })
    .where(and(eq(billingCounters.id, id), eq(billingCounters.tenantId, tenantId)));

  return c.json({ message: 'Counter deactivated' });
});

// ═══════════════════════════════════════════════════════════════════
// FISCAL YEARS
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/fiscal-years', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const results = await db.select().from(billingFiscalYears)
    .where(and(eq(billingFiscalYears.tenantId, tenantId), eq(billingFiscalYears.isActive, 1)))
    .orderBy(desc(billingFiscalYears.startDate));
  const data = results.map(r => ({
    id: r.id,
    fiscal_year_name: r.fiscalYearName,
    start_date: r.startDate,
    end_date: r.endDate,
    is_current: r.isCurrent,
    is_active: r.isActive,
    tenant_id: r.tenantId,
    created_at: r.createdAt,
  }));
  return c.json({ data });
});

billingMaster.post('/fiscal-years', zValidator('json', createFiscalYearSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');

  const batchStmts: any[] = [];

  if (data.is_current) {
    batchStmts.push(
      db.update(billingFiscalYears).set({ isCurrent: 0 })
        .where(and(eq(billingFiscalYears.tenantId, tenantId), eq(billingFiscalYears.isCurrent, 1)))
    );
  }

  if (data.is_current && batchStmts.length > 0) {
    await db.batch(batchStmts as any);
  }
  
  const [result] = await db.insert(billingFiscalYears).values({
    fiscalYearName: data.fiscal_year_name,
    startDate: data.start_date,
    endDate: data.end_date,
    isCurrent: data.is_current ? 1 : 0,
    tenantId,
  }).returning({ id: billingFiscalYears.id });

  return c.json({ id: result.id, message: 'Fiscal year created' }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// CREDIT ORGANIZATIONS
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/credit-organizations', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const results = await db.select().from(billingCreditOrganizations)
    .where(and(eq(billingCreditOrganizations.tenantId, tenantId), eq(billingCreditOrganizations.isActive, 1)))
    .orderBy(asc(billingCreditOrganizations.organizationName));
  const data = results.map(r => ({
    id: r.id,
    organization_name: r.organizationName,
    organization_code: r.organizationCode,
    contact_person: r.contactPerson,
    contact_no: r.contactNo,
    email: r.email,
    credit_limit: r.creditLimit,
    address: r.address,
    is_active: r.isActive,
    tenant_id: r.tenantId,
    created_by: r.createdBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
  return c.json({ data });
});

billingMaster.post('/credit-organizations', zValidator('json', createCreditOrgSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const [result] = await db.insert(billingCreditOrganizations).values({
    organizationName: data.organization_name,
    organizationCode: data.organization_code ?? null,
    contactPerson: data.contact_person ?? null,
    contactNo: data.contact_no ?? null,
    email: data.email ?? null,
    address: data.address ?? null,
    creditLimit: data.credit_limit,
    tenantId,
    createdBy: Number(userId),
  }).returning({ id: billingCreditOrganizations.id });
  return c.json({ id: result.id, message: 'Credit organization created' }, 201);
});

billingMaster.put('/credit-organizations/:id', zValidator('json', updateCreditOrgSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const updateData: Record<string, any> = {};
  if (data.organization_name !== undefined) updateData.organizationName = data.organization_name;
  if (data.organization_code !== undefined) updateData.organizationCode = data.organization_code;
  if (data.contact_person !== undefined) updateData.contactPerson = data.contact_person;
  if (data.contact_no !== undefined) updateData.contactNo = data.contact_no;
  if (data.email !== undefined) updateData.email = data.email;
  if (data.address !== undefined) updateData.address = data.address;
  if (data.credit_limit !== undefined) updateData.creditLimit = data.credit_limit;

  if (Object.keys(updateData).length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updateData.updatedAt = sql`CURRENT_TIMESTAMP`;

  await db.update(billingCreditOrganizations).set(updateData)
    .where(and(eq(billingCreditOrganizations.id, id), eq(billingCreditOrganizations.tenantId, tenantId)));
  return c.json({ message: 'Credit organization updated' });
});

// ═══════════════════════════════════════════════════════════════════
// PACKAGES
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/packages', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const results = await db.select().from(billingPackages)
    .where(and(eq(billingPackages.tenantId, tenantId), eq(billingPackages.isActive, 1)))
    .orderBy(asc(billingPackages.packageName));
  const data = results.map(r => ({
    id: r.id,
    package_name: r.packageName,
    package_code: r.packageCode,
    total_price: r.totalPrice,
    discount_percent: r.discountPercent,
    description: r.description,
    is_active: r.isActive,
    included_bed_days: r.includedBedDays ?? 0,
    extra_bed_rate: r.extraBedRate ?? 0,
    package_type: r.packageType ?? 'standard',
    tenant_id: r.tenantId,
    created_by: r.createdBy,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
  return c.json({ data });
});

billingMaster.get('/packages/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const [pkg] = await db.select().from(billingPackages)
    .where(and(eq(billingPackages.id, id), eq(billingPackages.tenantId, tenantId)))
    .limit(1);
  if (!pkg) throw new HTTPException(404, { message: 'Package not found' });

  const items = await db.select().from(billingPackageItems)
    .where(and(eq(billingPackageItems.packageId, id), eq(billingPackageItems.tenantId, tenantId)));

  const data = {
    id: pkg.id,
    package_name: pkg.packageName,
    package_code: pkg.packageCode,
    total_price: pkg.totalPrice,
    discount_percent: pkg.discountPercent,
    description: pkg.description,
    is_active: pkg.isActive,
    included_bed_days: pkg.includedBedDays ?? 0,
    extra_bed_rate: pkg.extraBedRate ?? 0,
    package_type: pkg.packageType ?? 'standard',
    tenant_id: pkg.tenantId,
    created_by: pkg.createdBy,
    created_at: pkg.createdAt,
    updated_at: pkg.updatedAt,
    items: items.map(i => ({
      id: i.id,
      package_id: i.packageId,
      service_item_id: i.serviceItemId,
      item_name: i.itemName,
      quantity: i.quantity,
      price: i.price,
      tenant_id: i.tenantId,
      created_at: i.createdAt,
    })),
  };

  return c.json({ data });
});

billingMaster.post('/packages', zValidator('json', createPackageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const packageBedFields = normalizePackageBedFields(data.package_type);

  const [pkgResult] = await db.insert(billingPackages).values({
    packageName: data.package_name,
    packageCode: data.package_code ?? null,
    description: data.description ?? null,
    totalPrice: data.total_price,
    discountPercent: data.discount_percent,
    packageType: packageBedFields.packageType,
    includedBedDays: packageBedFields.includedBedDays,
    extraBedRate: packageBedFields.extraBedRate,
    tenantId,
    createdBy: Number(userId),
  }).returning({ id: billingPackages.id });

  const pkgId = pkgResult.id;

  if (data.items && data.items.length > 0) {
    const itemStmts = data.items.map((item) =>
      db.insert(billingPackageItems).values({
        packageId: pkgId,
        serviceItemId: item.service_item_id ?? null,
        itemName: item.item_name,
        quantity: item.quantity,
        price: item.price,
        tenantId,
      })
    );
    await db.batch(itemStmts as any);
  }

  return c.json({ id: pkgId, message: 'Package created' }, 201);
});

billingMaster.put('/packages/:id', zValidator('json', updatePackageSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const [existing] = await db.select({ id: billingPackages.id }).from(billingPackages)
    .where(and(eq(billingPackages.id, id), eq(billingPackages.tenantId, tenantId)))
    .limit(1);
  if (!existing) throw new HTTPException(404, { message: 'Package not found' });

  const update: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP` };
  if (data.package_name !== undefined) update.packageName = data.package_name;
  if (data.package_code !== undefined) update.packageCode = data.package_code ?? null;
  if (data.description !== undefined) update.description = data.description ?? null;
  if (data.total_price !== undefined) update.totalPrice = data.total_price;
  if (data.discount_percent !== undefined) update.discountPercent = data.discount_percent;
  if (
    data.package_type !== undefined ||
    data.included_bed_days !== undefined ||
    data.extra_bed_rate !== undefined
  ) {
    const packageBedFields = normalizePackageBedFields(data.package_type);
    if (data.package_type !== undefined) update.packageType = packageBedFields.packageType;
    update.includedBedDays = packageBedFields.includedBedDays;
    update.extraBedRate = packageBedFields.extraBedRate;
  }

  await db.update(billingPackages).set(update)
    .where(and(eq(billingPackages.id, id), eq(billingPackages.tenantId, tenantId)));

  return c.json({ id, message: 'Package updated' });
});

billingMaster.delete('/packages/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));

  const [existing] = await db.select({ id: billingPackages.id }).from(billingPackages)
    .where(and(eq(billingPackages.id, id), eq(billingPackages.tenantId, tenantId)))
    .limit(1);
  if (!existing) throw new HTTPException(404, { message: 'Package not found' });

  await db.update(billingPackages).set({ isActive: 0, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(billingPackages.id, id), eq(billingPackages.tenantId, tenantId)));

  return c.json({ id, message: 'Package deactivated' });
});

// ═══════════════════════════════════════════════════════════════════
// DEPOSIT HEADS
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/deposit-heads', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const results = await db.select().from(billingDepositHeads)
    .where(and(eq(billingDepositHeads.tenantId, tenantId), eq(billingDepositHeads.isActive, 1)))
    .orderBy(asc(billingDepositHeads.headName));
  const data = results.map(r => ({
    id: r.id,
    head_name: r.headName,
    head_code: r.headCode,
    description: r.description,
    is_active: r.isActive,
    tenant_id: r.tenantId,
    created_at: r.createdAt,
  }));
  return c.json({ data });
});

billingMaster.post('/deposit-heads', zValidator('json', createDepositHeadSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const [result] = await db.insert(billingDepositHeads).values({
    headName: data.head_name,
    headCode: data.head_code ?? null,
    description: data.description ?? null,
    tenantId,
  }).returning({ id: billingDepositHeads.id });
  return c.json({ id: result.id, message: 'Deposit head created' }, 201);
});

// ═══════════════════════════════════════════════════════════════════
// MEMBERSHIP TYPES
// ═══════════════════════════════════════════════════════════════════

billingMaster.get('/membership-types', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const results = await db.select().from(billingMembershipTypes)
    .where(and(eq(billingMembershipTypes.tenantId, tenantId), eq(billingMembershipTypes.isActive, 1)))
    .orderBy(asc(billingMembershipTypes.membershipName));
  const data = results.map(r => ({
    id: r.id,
    membership_name: r.membershipName,
    membership_code: r.membershipCode,
    community_name: r.communityName,
    discount_percent: r.discountPercent,
    description: r.description,
    is_active: r.isActive,
    tenant_id: r.tenantId,
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  }));
  return c.json({ data });
});

billingMaster.post('/membership-types', zValidator('json', createMembershipTypeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const data = c.req.valid('json');
  const [result] = await db.insert(billingMembershipTypes).values({
    membershipName: data.membership_name,
    membershipCode: data.membership_code ?? null,
    communityName: data.community_name ?? null,
    discountPercent: data.discount_percent,
    description: data.description ?? null,
    tenantId,
  }).returning({ id: billingMembershipTypes.id });
  return c.json({ id: result.id, message: 'Membership type created' }, 201);
});

billingMaster.put('/membership-types/:id', zValidator('json', updateMembershipTypeSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  const data = c.req.valid('json');

  const updateData: Record<string, any> = {};
  if (data.membership_name !== undefined) updateData.membershipName = data.membership_name;
  if (data.membership_code !== undefined) updateData.membershipCode = data.membership_code;
  if (data.community_name !== undefined) updateData.communityName = data.community_name;
  if (data.discount_percent !== undefined) updateData.discountPercent = data.discount_percent;
  if (data.description !== undefined) updateData.description = data.description;

  if (Object.keys(updateData).length === 0) throw new HTTPException(400, { message: 'No fields to update' });
  updateData.updatedAt = sql`CURRENT_TIMESTAMP`;

  await db.update(billingMembershipTypes).set(updateData)
    .where(and(eq(billingMembershipTypes.id, id), eq(billingMembershipTypes.tenantId, tenantId)));
  return c.json({ message: 'Membership type updated' });
});

billingMaster.delete('/membership-types/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseId(c.req.param('id'));
  await db.update(billingMembershipTypes).set({ isActive: 0, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(billingMembershipTypes.id, id), eq(billingMembershipTypes.tenantId, tenantId)));
  return c.json({ message: 'Membership type deactivated' });
});

// Patient membership assignment
billingMaster.get('/patient-memberships/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.param('patientId');
  const { results } = await db.$client.prepare(`
    SELECT pm.*, mt.membership_name, mt.discount_percent
    FROM patient_memberships pm
    JOIN billing_membership_types mt ON pm.membership_type_id = mt.id
    WHERE pm.patient_id = ? AND pm.tenant_id = ? AND pm.is_active = 1
  `).bind(patientId, tenantId).all();
  return c.json({ data: results });
});

billingMaster.post('/patient-memberships', zValidator('json', assignMembershipSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const [result] = await db.insert(patientMemberships).values({
    patientId: data.patient_id,
    membershipTypeId: data.membership_type_id,
    startDate: data.start_date,
    endDate: data.end_date ?? null,
    tenantId,
    createdBy: Number(userId),
  }).returning({ id: patientMemberships.id });
  return c.json({ id: result.id, message: 'Membership assigned' }, 201);
});

export default billingMaster;
