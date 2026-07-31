import { z } from 'zod';

// ─── Billing Schemes ─────────────────────────────────────────────────────────

export const discountSourceSchema = z.enum([
  'hospital_discount',
  'charity_discount',
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

export const schemeTypeSchema = z.enum([
  'general',
  'insurance',
  'government',
  'corporate',
  'staff',
  'vip',
  'owner',
  'shareholder',
  'charity',
  'campaign',
]);

const schemeBooleanInput = z.preprocess((value) => {
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return value;
}, z.boolean());

const dateOnlyInput = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable();

export const createSchemeSchema = z.object({
  scheme_name: z.string().min(1).max(200),
  scheme_code: z.string().max(50).optional(),
  scheme_type: schemeTypeSchema.default('general'),
  description: z.string().max(500).optional(),
  default_discount_percent: z.number().min(0).max(100).default(0),
  default_price_category_id: z.number().int().positive().optional().nullable(),
  default_discount_source: discountSourceSchema.default('hospital_discount'),
  valid_from: dateOnlyInput,
  valid_to: dateOnlyInput,
  max_discount_amount_per_bill: z.number().min(0).default(0),
  max_discount_amount_per_month: z.number().min(0).default(0),
  max_discount_amount_per_year: z.number().min(0).default(0),
  approval_required_over_percent: z.number().min(0).max(100).default(0),
  requires_reference: schemeBooleanInput.default(false),
  is_auto_apply: schemeBooleanInput.default(false),
});

export const updateSchemeSchema = createSchemeSchema.partial();

// ─── Sub Schemes ─────────────────────────────────────────────────────────────

export const createSubSchemeSchema = z.object({
  scheme_id: z.number().int().positive(),
  sub_scheme_name: z.string().min(1).max(200),
  sub_scheme_code: z.string().max(50).optional(),
  discount_percent: z.number().min(0).max(100).default(0),
});

// ─── Price Categories ────────────────────────────────────────────────────────

export const createPriceCategorySchema = z.object({
  category_name: z.string().min(1).max(200),
  category_code: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  is_default: z.boolean().default(false),
});

export const updatePriceCategorySchema = createPriceCategorySchema.partial();

// ─── Service Departments ─────────────────────────────────────────────────────

export const createServiceDeptSchema = z.object({
  department_name: z.string().min(1).max(200),
  department_code: z.string().max(50).optional(),
  parent_id: z.number().int().positive().optional(),
});

export const updateServiceDeptSchema = createServiceDeptSchema.partial();

// ─── Service Items ───────────────────────────────────────────────────────────

const booleanInput = z.preprocess((value) => {
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0') return false;
  return value;
}, z.boolean());

export const createServiceItemSchema = z.object({
  item_name: z.string().min(1).max(300),
  item_code: z.string().max(50).optional(),
  service_department_id: z.number().int().positive().optional(),
  price: z.number().min(0),
  tax_applicable: booleanInput.default(false),
  tax_percent: z.number().min(0).max(100).default(0),
  allow_discount: booleanInput.default(true),
  allow_multiple_qty: booleanInput.default(true),
  is_commissionable: booleanInput.optional(),
  description: z.string().max(500).optional(),
  display_order: z.number().int().default(0),
});

export const updateServiceItemSchema = createServiceItemSchema.partial();

const performerRuleDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must use YYYY-MM-DD');

export const performerPayoutRuleSchema = z.union([
  z.object({
    enabled: z.literal(true),
    rate_type: z.literal('flat'),
    flat_amount: z.number().min(0),
    effective_from: performerRuleDate,
    notes: z.string().max(500).optional(),
  }),
  z.object({
    enabled: z.literal(true),
    rate_type: z.literal('percent'),
    percent: z.number().min(0).max(100),
    effective_from: performerRuleDate,
    notes: z.string().max(500).optional(),
  }),
  z.object({
    enabled: z.literal(false),
    effective_from: performerRuleDate,
    notes: z.string().max(500).optional(),
  }),
]);

export const listServiceItemsSchema = z.object({
  search: z.string().optional(),
  department_id: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  per_page: z.coerce.number().int().min(1).max(200).default(50),
});

// ─── Counters ────────────────────────────────────────────────────────────────

export const createCounterSchema = z.object({
  counter_name: z.string().min(1).max(200),
  counter_code: z.string().max(50).optional(),
  counter_type: z.enum(['billing', 'pharmacy', 'lab', 'ipd', 'opd', 'emergency', 'general', 'other']).default('billing'),
  location: z.string().max(200).optional(),
  description: z.string().max(500).optional(),
  cash_visibility_mode: z.enum(['show_all', 'blind_close']).default('show_all'),
});

// ─── Fiscal Years ────────────────────────────────────────────────────────────

export const createFiscalYearSchema = z.object({
  fiscal_year_name: z.string().min(1).max(100),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  is_current: z.boolean().default(false),
});

// ─── Credit Organizations ────────────────────────────────────────────────────

export const createCreditOrgSchema = z.object({
  organization_name: z.string().min(1).max(300),
  organization_code: z.string().max(50).optional(),
  contact_person: z.string().max(200).optional(),
  contact_no: z.string().max(20).optional(),
  email: z.string().email().optional(),
  address: z.string().max(500).optional(),
  credit_limit: z.number().min(0).default(0),
});

export const updateCreditOrgSchema = createCreditOrgSchema.partial();

// ─── Packages ────────────────────────────────────────────────────────────────

export const createPackageSchema = z.object({
  package_name: z.string().min(1).max(300),
  package_code: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
  total_price: z.number().min(0),
  discount_percent: z.number().min(0).max(100).default(0),
  package_type: z.enum(['standard', 'package_plus_bed', 'package_included_days']).default('standard'),
  included_bed_days: z.number().int().min(0).default(0),
  extra_bed_rate: z.number().min(0).default(0),
  items: z.array(z.object({
    service_item_id: z.number().int().positive().optional(),
    item_name: z.string().min(1),
    quantity: z.number().int().min(1).default(1),
    price: z.number().min(0),
  })).optional(),
});

export const updatePackageSchema = createPackageSchema.partial();

// ─── Deposit Heads ───────────────────────────────────────────────────────────

export const createDepositHeadSchema = z.object({
  head_name: z.string().min(1).max(200),
  head_code: z.string().max(50).optional(),
  description: z.string().max(500).optional(),
});

// ─── Membership Types ────────────────────────────────────────────────────────

export const createMembershipTypeSchema = z.object({
  membership_name: z.string().min(1).max(200),
  membership_code: z.string().max(50).optional(),
  community_name: z.string().max(200).optional(),
  discount_percent: z.number().min(0).max(100).default(0),
  description: z.string().max(500).optional(),
});

export const updateMembershipTypeSchema = createMembershipTypeSchema.partial();

export const assignMembershipSchema = z.object({
  patient_id: z.number().int().positive(),
  membership_type_id: z.number().int().positive(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const schemeMemberBaseSchema = z.object({
  patient_id: z.number().int().positive().optional().nullable(),
  member_code: z.string().trim().max(80).optional().nullable(),
  member_name: z.string().trim().max(200).optional().nullable(),
  relation: z.string().trim().max(80).optional().nullable(),
  valid_from: dateOnlyInput,
  valid_to: dateOnlyInput,
  status: z.enum(['active', 'inactive', 'suspended']).default('active'),
  notes: z.string().trim().max(500).optional().nullable(),
});

export const createSchemeMemberSchema = schemeMemberBaseSchema.refine((value) => Boolean(value.patient_id || value.member_code || value.member_name), {
  message: 'Provide patient, member code, or member name',
});

export const updateSchemeMemberSchema = schemeMemberBaseSchema.partial().refine((value) => Boolean(value.patient_id || value.member_code || value.member_name), {
  message: 'Provide patient, member code, or member name',
});

export const schemePreviewSchema = z.object({
  scheme_id: z.coerce.number().int().positive(),
  patient_id: z.coerce.number().int().positive().optional(),
  gross_amount: z.coerce.number().min(0).default(0),
});

const schemeLookupBaseSchema = z.object({
  patient_id: z.coerce.number().int().positive().optional(),
  scheme_id: z.coerce.number().int().positive().optional(),
  scheme_code: z.string().trim().max(80).optional(),
  member_code: z.string().trim().max(80).optional(),
  service_category: z.string().trim().max(80).optional(),
  subtotal: z.coerce.number().min(0).default(0),
});

const schemeLookupHasIdentifier = (value: z.infer<typeof schemeLookupBaseSchema>) => Boolean(value.scheme_id || value.scheme_code || value.member_code);

export const schemeEligibilityQuerySchema = schemeLookupBaseSchema.refine(schemeLookupHasIdentifier, {
  message: 'Provide scheme_id, scheme_code, or member_code',
});
export const applySchemePreviewSchema = schemeLookupBaseSchema.extend({
  requested_discount: z.coerce.number().min(0).optional(),
}).refine(schemeLookupHasIdentifier, {
  message: 'Provide scheme_id, scheme_code, or member_code',
});

// ─── Scheme ↔ Price Category Mapping ─────────────────────────────────────────

export const schemePriceCategoryMapSchema = z.object({
  scheme_id: z.number().int().positive(),
  price_category_id: z.number().int().positive(),
});

// ─── Item ↔ Price Category Mapping ───────────────────────────────────────────

export const itemPriceCategoryMapSchema = z.object({
  service_item_id: z.number().int().positive(),
  price_category_id: z.number().int().positive(),
  price: z.number().min(0),
  discount_percent: z.number().min(0).max(100).default(0),
});

export const priceMatrixSaveSchema = z.object({
  mappings: z.array(z.object({
    service_item_id: z.coerce.number().int().positive(),
    price_category_id: z.coerce.number().int().positive(),
    price: z.coerce.number().min(0),
    is_discount_applicable: z.boolean().optional().default(true),
  })).min(1).max(500),
});
