import { getTodayGMT6 } from './date-utils';

export type BillingSchemeAllocationType =
  | 'hospital_discount'
  | 'charity_discount'
  | 'doctor_commission_waiver'
  | 'management_discount'
  | 'reference_discount'
  | 'staff_benefit_discount'
  | 'vip_benefit_discount'
  | 'owner_benefit_discount'
  | 'shareholder_benefit_discount'
  | 'corporate_contract_discount'
  | 'campaign_discount'
  | 'rounding_adjustment';

export type BillingSchemeEligibilityInput = {
  tenantId: string;
  patientId?: number | null;
  schemeId?: number | null;
  schemeCode?: string | null;
  memberCode?: string | null;
  serviceCategory?: string | null;
  subtotal?: number | null;
};

type BillingSchemeRow = {
  id: number;
  scheme_name: string;
  scheme_code: string | null;
  scheme_type: string | null;
  default_discount_percent: number | null;
  default_price_category_id: number | null;
  default_discount_source: string | null;
  valid_from: string | null;
  valid_to: string | null;
  max_discount_amount_per_bill: number | null;
  max_discount_amount_per_month?: number | null;
  max_discount_amount_per_year?: number | null;
  approval_required_over_percent: number | null;
  requires_reference: number | null;
  is_auto_apply: number | null;
  is_active: number | null;
};

type BillingSchemeMemberRow = {
  id: number;
  patient_id: number | null;
  member_code: string | null;
  member_name: string | null;
  relation: string | null;
  valid_from: string | null;
  valid_to: string | null;
  status: string | null;
};

export type BillingSchemeEligibilityPreview = {
  eligible: boolean;
  scheme_id: number | null;
  scheme_name: string | null;
  scheme_code: string | null;
  scheme_type: string | null;
  discount_mode: 'percent';
  discount_value: number;
  default_price_category_id: number | null;
  max_amount_per_bill: number;
  max_amount_per_month: number;
  max_amount_per_year: number;
  cap_remaining_month: number | null;
  cap_remaining_year: number | null;
  suggested_discount: number;
  allocation_type: BillingSchemeAllocationType;
  requires_approval: boolean;
  requires_reference: boolean;
  requires_member: boolean;
  matched_member_id: number | null;
  matched_member_code: string | null;
  matched_member_name: string | null;
  service_category: string | null;
  blockers: string[];
};

const VALID_ALLOCATION_TYPES = new Set<BillingSchemeAllocationType>([
  'hospital_discount',
  'charity_discount',
  'doctor_commission_waiver',
  'management_discount',
  'reference_discount',
  'staff_benefit_discount',
  'vip_benefit_discount',
  'owner_benefit_discount',
  'shareholder_benefit_discount',
  'corporate_contract_discount',
  'campaign_discount',
  'rounding_adjustment',
]);

export function mapBillingSchemeTypeToAllocationType(schemeType?: string | null): BillingSchemeAllocationType {
  switch (String(schemeType ?? '').trim().toLowerCase()) {
    case 'staff':
      return 'staff_benefit_discount';
    case 'vip':
      return 'vip_benefit_discount';
    case 'owner':
      return 'owner_benefit_discount';
    case 'shareholder':
      return 'shareholder_benefit_discount';
    case 'corporate':
    case 'insurance':
    case 'government':
      return 'corporate_contract_discount';
    case 'charity':
      return 'charity_discount';
    case 'campaign':
      return 'campaign_discount';
    default:
      return 'hospital_discount';
  }
}

export function normalizeBillingSchemeAllocationType(source?: string | null, schemeType?: string | null): BillingSchemeAllocationType {
  const normalized = String(source ?? '').trim() as BillingSchemeAllocationType;
  if (VALID_ALLOCATION_TYPES.has(normalized)) return normalized;
  return mapBillingSchemeTypeToAllocationType(schemeType);
}

function normalizeCode(value?: string | null): string {
  return String(value ?? '').trim().toLowerCase();
}

function roundAmount(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function positiveAmount(value: unknown): number {
  return Math.max(0, roundAmount(value));
}

function addOneMonth(date: string): string {
  const [year, month] = date.split('-').map(Number);
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
}

function nextYearStart(date: string): string {
  const [year] = date.split('-').map(Number);
  return `${year + 1}-01-01`;
}

function dateWithinRange(today: string, startsAt?: string | null, endsAt?: string | null): boolean {
  return (!startsAt || String(startsAt) <= today) && (!endsAt || String(endsAt) >= today);
}

async function loadScheme(db: D1Database, input: BillingSchemeEligibilityInput): Promise<BillingSchemeRow | null> {
  if (input.schemeId) {
    return await db.prepare(`
      SELECT id, scheme_name, scheme_code, scheme_type, default_discount_percent, default_price_category_id,
             default_discount_source, valid_from, valid_to, max_discount_amount_per_bill,
             COALESCE(max_discount_amount_per_month, 0) AS max_discount_amount_per_month,
             COALESCE(max_discount_amount_per_year, 0) AS max_discount_amount_per_year,
             approval_required_over_percent, requires_reference, is_auto_apply, is_active
      FROM billing_schemes
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `).bind(input.tenantId, input.schemeId).first<BillingSchemeRow>();
  }

  const schemeCode = normalizeCode(input.schemeCode);
  if (schemeCode) {
    return await db.prepare(`
      SELECT id, scheme_name, scheme_code, scheme_type, default_discount_percent, default_price_category_id,
             default_discount_source, valid_from, valid_to, max_discount_amount_per_bill,
             COALESCE(max_discount_amount_per_month, 0) AS max_discount_amount_per_month,
             COALESCE(max_discount_amount_per_year, 0) AS max_discount_amount_per_year,
             approval_required_over_percent, requires_reference, is_auto_apply, is_active
      FROM billing_schemes
      WHERE tenant_id = ? AND LOWER(COALESCE(scheme_code, '')) = ?
      ORDER BY COALESCE(is_active, 1) DESC, id ASC
      LIMIT 1
    `).bind(input.tenantId, schemeCode).first<BillingSchemeRow>();
  }

  const memberCode = normalizeCode(input.memberCode);
  if (memberCode) {
    return await db.prepare(`
      SELECT s.id, s.scheme_name, s.scheme_code, s.scheme_type, s.default_discount_percent, s.default_price_category_id,
             s.default_discount_source, s.valid_from, s.valid_to, s.max_discount_amount_per_bill,
             COALESCE(s.max_discount_amount_per_month, 0) AS max_discount_amount_per_month,
             COALESCE(s.max_discount_amount_per_year, 0) AS max_discount_amount_per_year,
             s.approval_required_over_percent, s.requires_reference, s.is_auto_apply, s.is_active
      FROM billing_schemes s
      JOIN billing_scheme_members m
        ON m.tenant_id = s.tenant_id
       AND m.scheme_id = s.id
      WHERE s.tenant_id = ?
        AND LOWER(COALESCE(m.member_code, '')) = ?
      ORDER BY CASE WHEN COALESCE(m.status, 'active') = 'active' THEN 0 ELSE 1 END,
               COALESCE(s.is_active, 1) DESC,
               s.id ASC
      LIMIT 1
    `).bind(input.tenantId, memberCode).first<BillingSchemeRow>();
  }

  return null;
}

async function loadMatchedMember(db: D1Database, tenantId: string, schemeId: number, patientId?: number | null, memberCodeRaw?: string | null): Promise<BillingSchemeMemberRow | null> {
  const memberCode = normalizeCode(memberCodeRaw);
  const clauses: string[] = [];
  const params: Array<string | number> = [tenantId, schemeId];
  if (patientId) {
    clauses.push('patient_id = ?');
    params.push(patientId);
  }
  if (memberCode) {
    clauses.push("LOWER(COALESCE(member_code, '')) = ?");
    params.push(memberCode);
  }
  if (clauses.length === 0) return null;

  return await db.prepare(`
    SELECT id, patient_id, member_code, member_name, relation, valid_from, valid_to, status
    FROM billing_scheme_members
    WHERE tenant_id = ?
      AND scheme_id = ?
      AND (${clauses.join(' OR ')})
    ORDER BY CASE WHEN COALESCE(status, 'active') = 'active' THEN 0 ELSE 1 END, id DESC
    LIMIT 1
  `).bind(...params).first<BillingSchemeMemberRow>();
}

async function countActiveMembers(db: D1Database, tenantId: string, schemeId: number): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(1) AS count
    FROM billing_scheme_members
    WHERE tenant_id = ? AND scheme_id = ? AND COALESCE(status, 'active') = 'active'
  `).bind(tenantId, schemeId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function sumSchemeUsage(db: D1Database, params: {
  tenantId: string;
  schemeId: number;
  memberId?: number | null;
  billPatientId?: number | null;
  fromDate: string;
  toDate: string;
}): Promise<number> {
  const where: string[] = ['tenant_id = ?', 'scheme_id = ?', 'date(used_at) >= ?', 'date(used_at) < ?'];
  const values: Array<string | number> = [params.tenantId, params.schemeId, params.fromDate, params.toDate];
  if (params.memberId) {
    where.push('member_id = ?');
    values.push(params.memberId);
  } else if (params.billPatientId) {
    where.push('patient_id = ?');
    values.push(params.billPatientId);
  }

  const row = await db.prepare(`
    SELECT COALESCE(SUM(discount_amount), 0) AS total
    FROM billing_scheme_usage
    WHERE ${where.join(' AND ')}
  `).bind(...values).first<{ total: number }>();
  return roundAmount(row?.total ?? 0);
}

export async function evaluateBillingSchemeEligibility(db: D1Database, input: BillingSchemeEligibilityInput): Promise<BillingSchemeEligibilityPreview> {
  const subtotal = positiveAmount(input.subtotal);
  const today = getTodayGMT6();
  const serviceCategory = input.serviceCategory?.trim() || null;
  const scheme = await loadScheme(db, input);
  const blockers: string[] = [];

  if (!scheme) {
    return {
      eligible: false,
      scheme_id: null,
      scheme_name: null,
      scheme_code: input.schemeCode?.trim() || null,
      scheme_type: null,
      discount_mode: 'percent',
      discount_value: 0,
      default_price_category_id: null,
      max_amount_per_bill: 0,
      max_amount_per_month: 0,
      max_amount_per_year: 0,
      cap_remaining_month: null,
      cap_remaining_year: null,
      suggested_discount: 0,
      allocation_type: 'hospital_discount',
      requires_approval: false,
      requires_reference: false,
      requires_member: Boolean(input.memberCode || input.patientId),
      matched_member_id: null,
      matched_member_code: input.memberCode?.trim() || null,
      matched_member_name: null,
      service_category: serviceCategory,
      blockers: ['Scheme not found'],
    };
  }

  const activeMemberCount = await countActiveMembers(db, input.tenantId, Number(scheme.id));
  const matchedMember = await loadMatchedMember(db, input.tenantId, Number(scheme.id), input.patientId, input.memberCode);
  const requiresMember = activeMemberCount > 0;
  const allocationType = normalizeBillingSchemeAllocationType(scheme.default_discount_source, scheme.scheme_type);
  const discountValue = Math.max(0, Math.min(100, Number(scheme.default_discount_percent ?? 0)));
  const maxPerBill = positiveAmount(scheme.max_discount_amount_per_bill);
  const maxPerMonth = positiveAmount(scheme.max_discount_amount_per_month);
  const maxPerYear = positiveAmount(scheme.max_discount_amount_per_year);

  if (Number(scheme.is_active ?? 1) !== 1) blockers.push('Scheme is inactive');
  if (!dateWithinRange(today, scheme.valid_from, scheme.valid_to)) blockers.push('Scheme is outside valid date range');
  if (discountValue <= 0) blockers.push('Scheme discount percent is not configured');
  if (allocationType === 'doctor_commission_waiver') blockers.push('Doctor commission waiver is not supported as a Billing Master scheme source');

  if (matchedMember) {
    if (String(matchedMember.status ?? 'active') !== 'active') blockers.push('Matched scheme member is not active');
    if (!dateWithinRange(today, matchedMember.valid_from, matchedMember.valid_to)) blockers.push('Matched scheme member is outside valid date range');
  } else if (requiresMember) {
    blockers.push(input.patientId || input.memberCode ? 'Patient/member is not eligible for this scheme' : 'Member or patient is required for this scheme');
  }

  let suggestedDiscount = Math.round((subtotal * discountValue) / 100);
  if (maxPerBill > 0) suggestedDiscount = Math.min(suggestedDiscount, maxPerBill);

  let capRemainingMonth: number | null = null;
  let capRemainingYear: number | null = null;
  if (maxPerMonth > 0) {
    const monthStart = `${today.slice(0, 7)}-01`;
    const usedThisMonth = await sumSchemeUsage(db, {
      tenantId: input.tenantId,
      schemeId: Number(scheme.id),
      memberId: matchedMember?.id ?? null,
      billPatientId: input.patientId ?? matchedMember?.patient_id ?? null,
      fromDate: monthStart,
      toDate: addOneMonth(monthStart),
    });
    capRemainingMonth = Math.max(0, roundAmount(maxPerMonth - usedThisMonth));
    suggestedDiscount = Math.min(suggestedDiscount, capRemainingMonth);
    if (capRemainingMonth <= 0) blockers.push('Monthly scheme cap is exhausted');
  }
  if (maxPerYear > 0) {
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const usedThisYear = await sumSchemeUsage(db, {
      tenantId: input.tenantId,
      schemeId: Number(scheme.id),
      memberId: matchedMember?.id ?? null,
      billPatientId: input.patientId ?? matchedMember?.patient_id ?? null,
      fromDate: yearStart,
      toDate: nextYearStart(yearStart),
    });
    capRemainingYear = Math.max(0, roundAmount(maxPerYear - usedThisYear));
    suggestedDiscount = Math.min(suggestedDiscount, capRemainingYear);
    if (capRemainingYear <= 0) blockers.push('Yearly scheme cap is exhausted');
  }

  const approvalPercent = Number(scheme.approval_required_over_percent ?? 0);
  const requiresApproval = approvalPercent > 0 && discountValue > approvalPercent;
  const eligible = blockers.length === 0;

  return {
    eligible,
    scheme_id: Number(scheme.id),
    scheme_name: scheme.scheme_name,
    scheme_code: scheme.scheme_code ?? null,
    scheme_type: scheme.scheme_type ?? 'general',
    discount_mode: 'percent',
    discount_value: discountValue,
    default_price_category_id: scheme.default_price_category_id ? Number(scheme.default_price_category_id) : null,
    max_amount_per_bill: maxPerBill,
    max_amount_per_month: maxPerMonth,
    max_amount_per_year: maxPerYear,
    cap_remaining_month: capRemainingMonth,
    cap_remaining_year: capRemainingYear,
    suggested_discount: eligible ? Math.max(0, roundAmount(suggestedDiscount)) : 0,
    allocation_type: allocationType,
    requires_approval: requiresApproval,
    requires_reference: Number(scheme.requires_reference ?? 0) === 1,
    requires_member: requiresMember,
    matched_member_id: matchedMember?.id ?? null,
    matched_member_code: matchedMember?.member_code ?? input.memberCode?.trim() ?? null,
    matched_member_name: matchedMember?.member_name ?? null,
    service_category: serviceCategory,
    blockers,
  };
}

export async function findBillingSchemeUsageAllocationId(db: D1Database, params: {
  tenantId: string;
  billId: number;
  schemeId: number;
}): Promise<number | null> {
  const row = await db.prepare(`
    SELECT id
    FROM bill_discount_allocations
    WHERE tenant_id = ?
      AND bill_id = ?
      AND CAST(json_extract(metadata_json, '$.schemeId') AS INTEGER) = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(params.tenantId, params.billId, params.schemeId).first<{ id: number }>();
  return row?.id ?? null;
}

export async function recordBillingSchemeUsage(db: D1Database, params: {
  tenantId: string;
  schemeId: number;
  memberId?: number | null;
  patientId?: number | null;
  billId?: number | null;
  allocationId?: number | null;
  serviceCategory?: string | null;
  subtotal: number;
  discountAmount: number;
  allocationType: string;
  createdBy: number | string;
}): Promise<void> {
  const amount = positiveAmount(params.discountAmount);
  if (amount <= 0) return;
  const allocationId = params.allocationId ?? (params.billId
    ? await findBillingSchemeUsageAllocationId(db, { tenantId: params.tenantId, billId: params.billId, schemeId: params.schemeId })
    : null);
  await db.prepare(`
    INSERT OR IGNORE INTO billing_scheme_usage
      (tenant_id, scheme_id, member_id, patient_id, bill_id, allocation_id, service_category,
       subtotal, discount_amount, allocation_type, used_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'), ?)
  `).bind(
    params.tenantId,
    params.schemeId,
    params.memberId ?? null,
    params.patientId ?? null,
    params.billId ?? null,
    allocationId,
    params.serviceCategory ?? null,
    roundAmount(params.subtotal),
    amount,
    params.allocationType,
    Number(params.createdBy),
  ).run();
}
