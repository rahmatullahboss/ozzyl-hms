import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requireRole, resolveUserPermissions } from '../../middleware/rbac';
import { getNextSequence } from '../../lib/sequence';
import { getNextBillInvoiceNumber, getNextInvoiceNumber } from '../../lib/invoice-sequence';
import { calculateBillCategoryTotals } from '../../lib/billing-category-totals';
import { calculateBillPaymentState } from '../../lib/billing-payment-state';
import { resolveBillingCounterInvoiceMode } from '../../lib/billing-counter-invoice-mode';
import { createAuditLog } from '../../lib/accounting-helpers';
import { getPatientDepositBalance } from '../../lib/patient-deposits';
import { formatDoctorName } from '../../lib/doctor-display';
import {
  billingCounterActivateSchema,
  bankDepositRequestSchema,
  billingCounterCloseSchema,
  billingCounterInvoiceSchema,
  billingCounterServiceSearchSchema,
  cashDropSchema,
  pendingLabOrderBillSchema,
} from '../../schemas/billingCounter';
import { getTodayGMT6 } from '../../lib/date-utils';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { normalizeConsultationFee } from '../../lib/doctor-fees';
import { buildInvoiceSearchTerms, escapeLikeWildcards } from '../../lib/invoice-search';
import { triggerBillingCounterInvoiceConsumption } from '../../lib/inventory-consumption-billing-hook';
import { recordBillFinalizationSideEffects } from '../../lib/billing-finalization';
import { quoteDoctorWaiver } from '../../lib/doctor-waiver-quote';
import { splitDiscountAllocation } from '../../lib/discount_allocation';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from '../../lib/accounting-posting';
import {
  calculateBillingCounterSessionCashSummary,
  getBillingWorkstationId,
  isMissingBillingWorkstationColumnError,
  loadActiveBillingCounterSession,
} from '../../lib/billing-counter-session';
import { isRoleAllowed } from '../../lib/authz';
import {
  creditPendingRefundReserveReleasesForSession,
  loadHeldRefundCashHoldsForSession,
  loadRefundReserveReleaseCreditsForSession,
  shadowRefundReserveCustodyTransfer,
  shadowRefundReserveReleased,
} from '../../lib/billing-refund-cash-hold';
import { requirePermission } from '../../middleware/rbac';
import { shadowCreateCashLedgerEntry } from '../../lib/cash-ledger-writer';
import { evaluateBillingSchemeEligibility, recordBillingSchemeUsage } from '../../lib/billing-scheme-eligibility';
import { consumeMappedLabConsumables, recordLabInventoryException } from '../../lib/lab-consumables';
import { getLabInventoryPolicy, shouldBlockLabInventoryException, shouldConsumeLabReagentsForEvent } from '../../lib/lab-inventory-policy';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { projectBillingCounterSettlement } from '../../lib/canonical/billing-counter-settlement';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../lib/canonical/strict-financial-boundaries';
import {
  CanonicalStrictFinancialError,
  resolveStrictFinancialPolicy,
} from '../../lib/canonical/strict-financial-policy';
import {
  ApprovalPolicyError,
  recordSourceApprovalDecision,
} from '../../services/approvals/two-person-policy';


const REASON_TO_ALLOCATION_TYPE: Record<string, string> = {
  normal_hospital_discount: 'hospital_discount',
  poor_patient_charity: 'charity_discount',
  doctor_commission_waiver: 'doctor_commission_waiver',
  management_approved: 'management_discount',
  reference_discount: 'reference_discount',
  staff_benefit_discount: 'staff_benefit_discount',
  vip_benefit_discount: 'vip_benefit_discount',
  owner_benefit_discount: 'owner_benefit_discount',
  shareholder_benefit_discount: 'shareholder_benefit_discount',
  corporate_contract_discount: 'corporate_contract_discount',
  campaign_discount: 'campaign_discount',
  rounding_adjustment: 'rounding_adjustment',
};

function normalizeAllocationReason(value: string | undefined): string {
  return value && Object.prototype.hasOwnProperty.call(REASON_TO_ALLOCATION_TYPE, value) ? value : 'normal_hospital_discount';
}

function roundAmount(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function isCashPaymentMethod(value: unknown): boolean {
  const normalized = String(value ?? 'cash').trim().toLowerCase();
  return normalized === '' || normalized === 'cash' || normalized === 'cash payment';
}

async function shadowWriteBillPaymentCollection(params: {
  db: D1Database;
  tenantId: string;
  billId: number;
  invoiceNo: string;
  receiptNo: string;
  patientId: number;
  amount: number;
  paymentMethod: string;
  userId: string | number;
  counterSessionId: number;
  counterId: number;
  externalTransactionId?: string | null;
}) {
  if (!isCashPaymentMethod(params.paymentMethod)) return;
  await shadowCreateCashLedgerEntry(params.db, {
    tenantId: params.tenantId,
    sourceType: 'payment',
    sourceId: params.receiptNo,
    sourceNo: params.receiptNo,
    eventType: 'BILL_PAYMENT_RECEIVED',
    movementDirection: 'in',
    cashStatus: 'IN_DRAWER',
    status: 'posted',
    amount: params.amount,
    expectedAmount: params.amount,
    receivedAmount: params.amount,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: params.patientId,
    toUserId: Number(params.userId),
    counterSessionId: params.counterSessionId,
    counterId: params.counterId,
    currentLocationType: 'drawer',
    currentLocationLabel: `Counter session #${params.counterSessionId}`,
    referenceType: 'bill',
    referenceId: params.billId,
    note: `Bill payment ${params.receiptNo} for ${params.invoiceNo}`,
    metadata: {
      invoiceNo: params.invoiceNo,
      receiptNo: params.receiptNo,
      patientId: params.patientId,
      externalTransactionId: params.externalTransactionId ?? null,
      shadowSource: 'payments',
    },
    idempotencyKey: `cash-ledger:bill-payment:${params.receiptNo}:received`,
    createdBy: Number(params.userId),
    occurredAt: new Date().toISOString(),
  });
}

type CounterServiceItem = {
  id: number;
  item_name: string;
  item_code: string | null;
  service_department_id: number | null;
  department_name: string | null;
  price: number;
  category_price: number | null;
  tax_applicable: number | null;
  tax_percent: number | null;
  allow_discount: number | null;
  allow_multiple_qty: number | null;
  lab_test_id?: number | null;
};

type CounterDoctor = {
  id: number;
  name: string;
  specialty: string | null;
  department: string | null;
  consultation_fee: number | null;
};

type BillingIdempotencyRow = {
  request_hash: string;
  status: string;
  response_json: string | null;
  bill_id?: number | null;
  invoice_no?: string | null;
};

type HandoverRecipient = {
  id: number;
  name: string;
  email: string | null;
  role: string;
};

type PendingLabOrderRow = {
  order_id: number;
  order_no: string | null;
  prescription_id: number | null;
  rx_no: string | null;
  patient_id: number;
  patient_name: string;
  patient_code: string | null;
  patient_mobile: string | null;
  doctor_id: number | null;
  doctor_name: string | null;
  order_date: string | null;
  created_at?: string | null;
  pending_item_count: number;
  pending_amount: number;
  pending_items: string | null;
};

type LabOrderBillRow = {
  id: number;
  order_no: string | null;
  patient_id: number;
  visit_id: number | null;
  prescription_id: number | null;
  doctor_id: number | null;
};

type LabOrderBillItemRow = {
  id: number;
  lab_order_id: number;
  lab_test_id: number;
  test_name: string;
  unit_price: number | null;
  discount: number | null;
  line_total: number | null;
  billing_service_item_id: number | null;
};

type BankDepositRequestRow = {
  id: number;
  request_no: string;
  requested_amount: number;
  status: string;
  proposed_bank_name: string | null;
  request_note: string | null;
  confirmed_bank_name?: string | null;
  confirmed_reference_no?: string | null;
  confirmed_date?: string | null;
  rejection_reason?: string | null;
  resolution_type?: string | null;
  created_at: string;
  updated_at?: string | null;
};

const billingCounterRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Cash variance above this absolute amount (BDT) requires a separate
 * supervisor approval before the counter close is finalised. Phase 6
 * other-issues spec. Tune per tenant policy later via settings.
 */
const CASH_VARIANCE_APPROVAL_THRESHOLD = 100;

/**
 * Roles that may approve a cash variance without an explicit
 * `billing.counter.variance.approve` permission grant.
 */
const CASH_VARIANCE_SUPERVISOR_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
const CASH_HANDOVER_ADMIN_VERIFICATION_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
const HANDOVER_AUTO_OPEN_RECEIVER_ROLES = ['reception', 'receptionist'] as const;
const MANAGEMENT_CASH_RECEIVER_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
const SHIFT_TRANSFER_PURPOSE = 'shift_transfer';
const MANAGEMENT_COLLECTION_PURPOSE = 'management_collection';
type HandoverPurpose = typeof SHIFT_TRANSFER_PURPOSE | typeof MANAGEMENT_COLLECTION_PURPOSE;
function hasPermissionValue(permissions: readonly string[], permission: string): boolean {
  return permissions.includes('*') || permissions.includes(permission);
}

function hasCounterShiftCapability(permissions: readonly string[], role: string): boolean {
  return hasPermissionValue(permissions, 'billing.counter.shift.auto_open')
    || hasPermissionValue(permissions, 'billing.counter.handover.receive')
    || hasPermissionValue(permissions, 'billing.counter.activate')
    || (HANDOVER_AUTO_OPEN_RECEIVER_ROLES as readonly string[]).includes(role);
}

function hasManagementCashCapability(permissions: readonly string[], role: string): boolean {
  return hasPermissionValue(permissions, 'billing.counter.management_cash.receive')
    || hasPermissionValue(permissions, 'billing.counter.management_cash.read')
    || hasPermissionValue(permissions, 'accounting:write')
    || hasPermissionValue(permissions, 'accounting:read')
    || (MANAGEMENT_CASH_RECEIVER_ROLES as readonly string[]).includes(role);
}

async function resolveTenantUserPermissions(dbBinding: unknown, tenantId: string, userId: number | string, role: string): Promise<string[]> {
  try {
    return await resolveUserPermissions(dbBinding, tenantId, role, String(userId));
  } catch {
    return [];
  }
}

function inferHandoverPurpose(role: string, permissions: readonly string[]): HandoverPurpose {
  if ((HANDOVER_AUTO_OPEN_RECEIVER_ROLES as readonly string[]).includes(role)) return SHIFT_TRANSFER_PURPOSE;
  if ((MANAGEMENT_CASH_RECEIVER_ROLES as readonly string[]).includes(role)
    && !hasPermissionValue(permissions, 'billing.counter.shift.auto_open')) {
    return MANAGEMENT_COLLECTION_PURPOSE;
  }
  if (hasCounterShiftCapability(permissions, role)) return SHIFT_TRANSFER_PURPOSE;
  return MANAGEMENT_COLLECTION_PURPOSE;
}
const HANDOVER_ADMIN_VERIFICATION_PENDING = 'pending_admin';
const HANDOVER_ADMIN_VERIFICATION_VERIFIED = 'verified';

function receiverHandoverVerificationEventStatement(db: D1Database, params: {
  tenantId: string;
  handoverId: number;
  eventType: 'receiver_verified' | 'receiver_disputed';
  actorUserId: string | number;
  actorRole: string;
  countedAmount: number;
  expectedAmount: number;
  variance: number;
  decision: 'verify' | 'dispute';
  remarks: string | null;
  workstationId: string;
}): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO cash_handover_verification_events
      (tenant_id, handover_id, event_type, actor_user_id, actor_role, counted_amount, expected_amount, variance, decision, remarks, workstation_id, created_at)
    SELECT ?, h.id, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours')
    FROM billing_handovers h
    WHERE h.tenant_id = ? AND h.id = ? AND h.status IN ('pending', 'partial')
  `).bind(
    params.tenantId,
    params.eventType,
    Number(params.actorUserId),
    params.actorRole,
    params.countedAmount,
    params.expectedAmount,
    params.variance,
    params.decision,
    params.remarks,
    params.workstationId,
    params.tenantId,
    params.handoverId,
  );
}

function adminHandoverVerificationEventStatement(db: D1Database, params: {
  tenantId: string;
  handoverId: number;
  eventType: 'admin_final_verification' | 'admin_rejected';
  actorUserId: string | number;
  actorRole: string;
  countedAmount: number;
  expectedAmount: number;
  variance: number;
  decision: 'approve' | 'reject';
  remarks: string | null;
}): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO cash_handover_verification_events
      (tenant_id, handover_id, event_type, actor_user_id, actor_role, counted_amount, expected_amount, variance, decision, remarks, workstation_id, created_at)
    SELECT ?, h.id, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now', '+6 hours')
    FROM billing_handovers h
    WHERE h.tenant_id = ?
      AND h.id = ?
      AND h.status IN ('receiver_verified', 'disputed')
      AND COALESCE(h.admin_verification_status, ?) = ?
  `).bind(
    params.tenantId,
    params.eventType,
    Number(params.actorUserId),
    params.actorRole,
    params.countedAmount,
    params.expectedAmount,
    params.variance,
    params.decision,
    params.remarks,
    params.tenantId,
    params.handoverId,
    HANDOVER_ADMIN_VERIFICATION_PENDING,
    HANDOVER_ADMIN_VERIFICATION_PENDING,
  );
}

const BILLING_COUNTER_ACCESS_ROLES = ['hospital_admin', 'reception', 'accountant', 'md', 'director', 'manager'] as const;
const BILLING_COUNTER_DISCOUNT_APPROVAL_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;

/**
 * Fine-grained permission strings for the billing counter module.
 *
 * NOTE for the fix/auth-rbac branch:
 * The `fix/auth-rbac` branch owns `src/middleware/rbac.ts` and
 * `src/lib/authz.ts`, which are forbidden in our scope. To avoid merge
 * conflicts we do NOT modify those files; instead we export the
 * permission strings from this route file. The auth-rbac branch should
 * hoist these into the central `ALL_PERMISSIONS` array / `PERMISSION_GROUPS`
 * (and the per-role static defaults) when it lands. The string
 * constants and ordering below must stay stable to make that
 * deterministic.
 */
export const BILLING_COUNTER_PERMISSIONS = [
  // Open / close / read counter state
  'billing.counter.read',
  'billing.counter.activate',
  'billing.counter.close',
  // Mid-shift / cash management
  'billing.counter.cash_movement',
  'billing.counter.cash_drop',
  'billing.counter.handover.create',
  'billing.counter.handover.receive',
  'billing.counter.shift.read',
  'billing.counter.shift.close',
  'billing.counter.shift.handover.create',
  'billing.counter.shift.handover.receive',
  'billing.counter.shift.auto_open',
  'billing.counter.management_cash.read',
  'billing.counter.management_cash.receive',
  'billing.counter.management_cash.partial_collect',
  'billing.counter.management_cash.dispute',
  // Bank deposit custody
  'billing.counter.bank_deposit.create',
  'billing.counter.bank_deposit.approve',
  // Elevated / supervisor
  'billing.counter.force_close',
  'billing.counter.takeover',
  'billing.counter.discount.approve',
  // Cash variance approval (Phase 6 hardening)
  'billing.counter.variance.approve',
  // Invoice / bill creation
  'billing.counter.invoice.create',
  'billing.counter.invoice.discount',
] as const;

export type BillingCounterPermission = (typeof BILLING_COUNTER_PERMISSIONS)[number];

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post billing counter accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function queueBillingCounterInvoiceConsumption(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  input: Parameters<typeof triggerBillingCounterInvoiceConsumption>[1],
): void {
  const consumption = triggerBillingCounterInvoiceConsumption(c.env.DB, input).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error ?? 'Unknown billing consumption trigger error');
    console.error('Billing consumption trigger failed', {
      tenantId: input.tenantId,
      billId: input.billId,
      invoiceNo: input.invoiceNo,
      error,
    });
    await createAuditLog(c.env, input.tenantId, String(input.userId ?? 'system'), 'UPDATE_STATUS', 'inventory_consumption_billing_hook', Number(input.billId ?? 0), null, {
      invoiceNo: input.invoiceNo,
      billId: input.billId,
      patientId: input.patientId,
      message,
      itemCount: input.items.length,
    });
  });

  try {
    c.executionCtx.waitUntil(consumption);
  } catch {
    void consumption;
  }
}

async function recordCashHandoverEvent(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  tenantId: string,
  sourceId: string | number,
  createdBy: string,
  amount: number,
  payload: Record<string, unknown>,
): Promise<void> {
  if (!Number.isFinite(amount) || amount <= 0) return;

  await recordAccountingPostingEvent(c.env.DB, {
    tenantId,
    sourceType: 'cash_handover',
    sourceId,
    eventType: ACCOUNTING_EVENT_TYPES.cashHandover,
    eventDate: getTodayGMT6(),
    createdBy,
    payload: {
      ...payload,
      amount,
    },
  });
  queueAccountingPosting(c, tenantId);
}

function assertBillingCounterDiscountAllowed(c: Context<{ Bindings: Env; Variables: Variables }>, amount: number): void {
  if (amount > 0 && !isRoleAllowed(c.get('role'), BILLING_COUNTER_DISCOUNT_APPROVAL_ROLES)) {
    throw new HTTPException(403, { message: 'Billing counter discounts require approval from an authorized finance/admin role' });
  }
}

function assertDiscountReferralNameForHighDiscount(subtotal: number, discount: number, discountByName?: string | null): void {
  if (discount <= 0) return;
  if (!discountByName?.trim()) {
    throw new HTTPException(400, { message: 'Discount referred by name is required when discount is applied.' });
  }
}

function isMissingCashVisibilityModeColumnError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /no such column: (bc\.)?cash_visibility_mode|D1_ERROR.*cash_visibility_mode/i.test(message);
}

async function getCounterCashVisibilityMode(d1: D1Database, tenantId: string, counterId: number): Promise<'show_all' | 'blind_close'> {
  try {
    const counter = await d1.prepare(`
      SELECT cash_visibility_mode FROM billing_counters WHERE id = ? AND tenant_id = ?
    `).bind(counterId, tenantId).first<{ cash_visibility_mode: string | null }>();
    return counter?.cash_visibility_mode === 'blind_close' ? 'blind_close' : 'show_all';
  } catch (error) {
    if (!isMissingCashVisibilityModeColumnError(error)) throw error;
    return 'show_all';
  }
}

async function batchWithLegacyWorkstationFallback(
  d1: D1Database,
  withWorkstation: () => D1PreparedStatement[],
  legacy: () => D1PreparedStatement[],
): Promise<D1Result[]> {
  try {
    return await d1.batch(withWorkstation());
  } catch (error) {
    if (!isMissingBillingWorkstationColumnError(error)) throw error;
    return d1.batch(legacy());
  }
}

function stringifyDenominations(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  return JSON.stringify(value);
}

function insertCounterSessionStatement(
  d1: D1Database,
  params: {
    tenantId: string;
    counterId: number;
    employeeId: string;
    sessionNo: string;
    counterType: string;
    openingCash: number;
    openingDenominations: unknown | null;
    remarks: string | null;
    workstationId: string | null;
  },
  includeWorkstation: boolean,
): D1PreparedStatement {
  if (!includeWorkstation) {
    return d1.prepare(`
      INSERT INTO billing_counter_sessions
        (tenant_id, counter_id, employee_id, session_no, counter_type, opening_cash, opening_denominations, remarks)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      params.tenantId,
      params.counterId,
      params.employeeId,
      params.sessionNo,
      params.counterType,
      params.openingCash,
      stringifyDenominations(params.openingDenominations),
      params.remarks,
    );
  }

  return d1.prepare(`
    INSERT INTO billing_counter_sessions
      (tenant_id, counter_id, employee_id, session_no, counter_type, opening_cash, opening_denominations, remarks, workstation_id, heartbeat_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
  `).bind(
    params.tenantId,
    params.counterId,
    params.employeeId,
    params.sessionNo,
    params.counterType,
    params.openingCash,
    stringifyDenominations(params.openingDenominations),
    params.remarks,
    params.workstationId,
  );
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeBillingRequestHashValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeBillingRequestHashValue(item));
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, itemValue] of Object.entries(record)) {
    if (itemValue === undefined) {
      normalized[key] = itemValue;
      continue;
    }
    if (key === 'discountPercent' && Number(itemValue) === 0) continue;
    normalized[key] = normalizeBillingRequestHashValue(itemValue);
  }
  return normalized;
}

async function createBillingRequestHash(data: unknown): Promise<string> {
  return sha256Hex(stableStringify(normalizeBillingRequestHashValue(data)));
}

function inferCounterItemCategory(item: CounterServiceItem): string {
  const haystack = `${item.department_name ?? ''} ${item.item_name ?? ''}`.toLowerCase();
  if (/(lab|test|pathology|radiology|x-?ray|ultra|usg|ct|mri|cbc|blood|urine)/.test(haystack)) return 'test';
  if (/(doctor|consult|opd|visit|follow)/.test(haystack)) return 'doctor_visit';
  if (/(pharmacy|medicine|drug)/.test(haystack)) return 'medicine';
  if (/(operation|surgery|ot|procedure)/.test(haystack)) return 'operation';
  if (/(admission|bed|ward|cabin|room|ipd)/.test(haystack)) return 'admission';
  return 'other';
}

function toVisitServiceType(category: string): string {
  if (category === 'operation') return 'procedure';
  if (['doctor_visit', 'test', 'admission', 'medicine'].includes(category)) return category;
  return 'other';
}

type BillingCounterResolvedLabCandidate = {
  sourceType: 'service_item' | 'doctor';
  serviceItemId?: number | null;
  itemCategory: string;
  department?: string | null;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  labTestId?: number | null;
};

type BillingCounterLabOrderItem = {
  labOrderItemId: number;
  labTestId: number;
  testName: string;
  lineTotal: number;
};

type BillingCounterLabOrderCreateResult = {
  labOrderId: number | null;
  labOrderNo: string | null;
  labOrderItems: BillingCounterLabOrderItem[];
};

type ReagentUsageWarning = { itemId: number; message: string };

function getLabTestIdForBillingItem(item: Pick<BillingCounterResolvedLabCandidate, 'labTestId'>): number | null {
  const labTestId = Number(item.labTestId ?? 0);
  return Number.isInteger(labTestId) && labTestId > 0 ? labTestId : null;
}

function isLabReagentBillingCandidate(item: BillingCounterResolvedLabCandidate): boolean {
  if (item.sourceType !== 'service_item' || item.itemCategory !== 'test') return false;
  if (getLabTestIdForBillingItem(item)) return true;
  const haystack = `${item.department ?? ''} ${item.description ?? ''}`.toLowerCase();
  if (/(radiology|x-?ray|ultra|ultrason|usg|ct|mri|imaging)/.test(haystack)) return false;
  return /(lab|pathology|cbc|blood|urine|glucose|rbs|creatinine|lipid|hemoglobin|haematology|hematology|biochemistry)/.test(haystack);
}

function buildBillingLabOrderItems(items: BillingCounterResolvedLabCandidate[]): Array<{
  labTestId: number;
  testName: string;
  billingServiceItemId: number | null;
  unitPrice: number;
  discount: number;
  lineTotal: number;
}> {
  const rows: Array<{
    labTestId: number;
    testName: string;
    billingServiceItemId: number | null;
    unitPrice: number;
    discount: number;
    lineTotal: number;
  }> = [];

  for (const item of items) {
    const labTestId = getLabTestIdForBillingItem(item);
    if (!isLabReagentBillingCandidate(item) || !labTestId) continue;
    const quantity = Math.max(1, Math.floor(Number(item.quantity ?? 1)));
    let allocatedDiscount = 0;
    let allocatedLineTotal = 0;
    for (let index = 0; index < quantity; index += 1) {
      const isLast = index === quantity - 1;
      const unitDiscount = isLast ? roundAmount(item.discount - allocatedDiscount) : roundAmount(item.discount / quantity);
      const unitLineTotal = isLast ? roundAmount(item.lineTotal - allocatedLineTotal) : roundAmount(item.lineTotal / quantity);
      allocatedDiscount += unitDiscount;
      allocatedLineTotal += unitLineTotal;
      rows.push({
        labTestId,
        testName: item.description,
        billingServiceItemId: item.serviceItemId ? Number(item.serviceItemId) : null,
        unitPrice: item.unitPrice,
        discount: unitDiscount,
        lineTotal: unitLineTotal,
      });
    }
  }

  return rows;
}

async function createBillingCounterLabOrderForInvoice(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string;
    patientId: number;
    visitId: number | null;
    billId: number;
    billStatus: string;
    items: BillingCounterResolvedLabCandidate[];
  },
): Promise<BillingCounterLabOrderCreateResult> {
  const labItems = buildBillingLabOrderItems(input.items);
  if (labItems.length === 0) return { labOrderId: null, labOrderNo: null, labOrderItems: [] };

  const orderNo = await getNextSequence(db, input.tenantId, 'lab_order', 'LO');
  const orderIdLookup = '(SELECT id FROM lab_orders WHERE tenant_id = ? AND order_no = ? LIMIT 1)';
  const statements: D1PreparedStatement[] = [
    db.prepare(`
      INSERT INTO lab_orders (order_no, patient_id, visit_id, ordered_by, order_date, tenant_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(orderNo, input.patientId, input.visitId, input.userId, getTodayGMT6(), input.tenantId),
  ];

  for (const item of labItems) {
    statements.push(db.prepare(`
      INSERT INTO lab_order_items
        (lab_order_id, lab_test_id, test_name, unit_price, discount, line_total, status, tenant_id, source)
      SELECT ${orderIdLookup}, ?, ?, ?, ?, ?, 'pending', ?, 'billing_counter'
    `).bind(
      input.tenantId,
      orderNo,
      item.labTestId,
      item.testName,
      item.unitPrice,
      item.discount,
      item.lineTotal,
      input.tenantId,
    ));
  }

  statements.push(db.prepare(`
    UPDATE lab_orders
    SET bill_id = ?, billing_status = ?, updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND order_no = ?
  `).bind(input.billId, input.billStatus === 'paid' ? 'paid' : 'unpaid', input.tenantId, orderNo));
  await db.batch(statements);

  const order = await db.prepare(`
    SELECT id FROM lab_orders WHERE tenant_id = ? AND order_no = ? LIMIT 1
  `).bind(input.tenantId, orderNo).first<{ id: number }>();
  const labOrderId = Number(order?.id ?? 0);
  if (!Number.isFinite(labOrderId) || labOrderId <= 0) {
    throw new HTTPException(500, { message: 'Billing counter lab order was not created' });
  }

  const { results } = await db.prepare(`
    SELECT id, lab_test_id, test_name, line_total
    FROM lab_order_items
    WHERE tenant_id = ? AND lab_order_id = ?
    ORDER BY id ASC
  `).bind(input.tenantId, labOrderId).all<{
    id: number;
    lab_test_id: number;
    test_name: string;
    line_total: number;
  }>();
  const labOrderItems = results.map((item) => ({
    labOrderItemId: Number(item.id),
    labTestId: Number(item.lab_test_id),
    testName: item.test_name,
    lineTotal: Number(item.line_total ?? 0),
  }));

  return { labOrderId, labOrderNo: orderNo, labOrderItems };
}

async function recordUnresolvedBillingLabTestExceptions(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string;
    billId: number;
    invoiceNo: string;
    items: BillingCounterResolvedLabCandidate[];
  },
): Promise<ReagentUsageWarning[]> {
  const warnings: ReagentUsageWarning[] = [];
  for (const item of input.items) {
    if (!isLabReagentBillingCandidate(item) || getLabTestIdForBillingItem(item)) continue;
    const message = `Lab test mapping is missing for billed service item ${item.description}. Link it to lab_test_catalog before automatic reagent deduction.`;
    await recordLabInventoryException(db, {
      tenantId: input.tenantId,
      userId: input.userId,
      labOrderId: null,
      labOrderItemId: null,
      labTestId: null,
      sourceEvent: 'billing_counter_invoice',
      reason: 'missing_lab_test_catalog_mapping',
      message,
      metadata: { billId: input.billId, invoiceNo: input.invoiceNo, serviceItemId: item.serviceItemId ?? null },
    });
    warnings.push({ itemId: Number(item.serviceItemId ?? 0), message });
  }
  return warnings;
}

async function consumeBillingCounterLabOrderReagents(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string;
    billId: number;
    invoiceNo: string;
    labOrderId: number | null;
    labOrderItems: BillingCounterLabOrderItem[];
  },
): Promise<ReagentUsageWarning[]> {
  if (!input.labOrderId || input.labOrderItems.length === 0) return [];
  const labInventoryPolicy = await getLabInventoryPolicy(db, input.tenantId);
  if (labInventoryPolicy.lab_inventory_mode === 'disabled'
    || labInventoryPolicy.reagent_consumption_timing !== 'billing') return [];

  const warnings: ReagentUsageWarning[] = [];
  for (const item of input.labOrderItems) {
    try {
      await consumeMappedLabConsumables(db, {
        tenantId: input.tenantId,
        userId: input.userId,
        labOrderItemId: item.labOrderItemId,
        labOrderId: input.labOrderId,
        labTestId: item.labTestId,
        requireMapping: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to record billing-time reagent usage';
      await recordLabInventoryException(db, {
        tenantId: input.tenantId,
        userId: input.userId,
        labOrderId: input.labOrderId,
        labOrderItemId: item.labOrderItemId,
        labTestId: item.labTestId,
        sourceEvent: 'billing_counter_invoice',
        reason: 'billing_time_consumption_failed',
        message,
        metadata: { billId: input.billId, invoiceNo: input.invoiceNo, testName: item.testName },
      });
      if (shouldBlockLabInventoryException(labInventoryPolicy, 'billing')) {
        throw error;
      }
      warnings.push({ itemId: item.labOrderItemId, message });
    }
  }

  return warnings;
}

function resolveReferredByType(data: {
  referredByType?: 'self' | 'hospital' | 'doctor' | 'other';
  referringDoctorId?: number | null;
  referredByHospitalId?: number | null;
}): 'self' | 'hospital' | 'doctor' | 'other' {
  return data.referredByType
    ?? (data.referringDoctorId != null ? 'doctor' : data.referredByHospitalId != null ? 'hospital' : 'self');
}

function parsePendingLabItems(value: string | null): Array<{ id: number; testName: string; lineTotal: number }> {
  if (!value) return [];
  return value.split('||')
    .map((chunk) => {
      const [id, testName, lineTotal] = chunk.split('::');
      return {
        id: Number(id),
        testName: testName ?? '',
        lineTotal: Number(lineTotal ?? 0),
      };
    })
    .filter((item) => Number.isFinite(item.id) && item.id > 0 && item.testName.trim());
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
    rejectionReason: row.rejection_reason ?? null,
    resolutionType: row.resolution_type ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? null,
  };
}

billingCounterRoutes.use('*', requireRole(...BILLING_COUNTER_ACCESS_ROLES));

async function loadCounterServiceItems(
  d1: D1Database,
  tenantId: string,
  ids: number[],
  priceCategoryId?: number,
): Promise<Map<number, CounterServiceItem>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const params: Array<string | number> = [tenantId, tenantId];
  let priceJoin = '';
  if (priceCategoryId) {
    priceJoin = `
      LEFT JOIN billing_item_price_category_maps pcm
        ON pcm.service_item_id = si.id
       AND pcm.tenant_id = si.tenant_id
       AND pcm.price_category_id = ?
       AND COALESCE(pcm.is_active, 1) = 1
    `;
    params.push(priceCategoryId);
  }
  params.push(tenantId, ...ids);

  const { results } = await d1.prepare(`
    SELECT
      si.id,
      si.item_name,
      si.item_code,
      si.service_department_id,
      sd.department_name,
      si.price,
      ${priceCategoryId ? 'pcm.price' : 'NULL'} as category_price,
      si.tax_applicable,
      si.tax_percent,
      si.allow_discount,
      si.allow_multiple_qty,
      (
        SELECT ltc.id
        FROM lab_test_catalog ltc
        WHERE ltc.billing_service_item_id = si.id
          AND ltc.tenant_id IN (?, '0')
          AND COALESCE(ltc.is_active, 1) = 1
        ORDER BY CASE WHEN ltc.tenant_id = ? THEN 0 ELSE 1 END, ltc.id DESC
        LIMIT 1
      ) AS lab_test_id
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
     AND sd.tenant_id IN (si.tenant_id, '0')
    ${priceJoin}
    WHERE si.tenant_id = ?
      AND si.id IN (${placeholders})
      AND COALESCE(si.is_active, 1) = 1
  `).bind(...params).all<CounterServiceItem>();

  return new Map(results.map((item) => [Number(item.id), item]));
}

async function loadCounterDoctors(
  d1: D1Database,
  tenantId: string,
  ids: number[],
): Promise<Map<number, CounterDoctor>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => '?').join(',');
  const { results } = await d1.prepare(`
    SELECT id, name, specialty, department, consultation_fee
    FROM doctors
    WHERE tenant_id = ?
      AND id IN (${placeholders})
      AND COALESCE(is_active, 1) = 1
  `).bind(tenantId, ...ids).all<CounterDoctor>();

  return new Map(results.map((doctor) => [
    Number(doctor.id),
    { ...doctor, consultation_fee: normalizeConsultationFee(doctor.consultation_fee) },
  ]));
}

billingCounterRoutes.get('/pending-due-worklist', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const selectedDate = c.req.query('date');
  const beforeDate = c.req.query('beforeDate');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 8), 1), 50);
  const page = Math.max(Number(c.req.query('page') ?? 1), 1);
  const offset = (page - 1) * limit;

  const scopedDateClause = (expression: string): { sql: string; value: string | null } => {
    if (selectedDate) return { sql: `AND date(${expression}) = date(?)`, value: selectedDate };
    if (beforeDate) return { sql: `AND date(${expression}) < date(?)`, value: beforeDate };
    return { sql: '', value: null };
  };
  const billDate = scopedDateClause('b.created_at');
  const appointmentDate = scopedDateClause('a.appt_date');
  const visitDate = scopedDateClause('COALESCE(v.visit_date, v.created_at)');
  const bindings: Array<string | number> = [tenantId];
  if (billDate.value) bindings.push(billDate.value);
  bindings.push(tenantId);
  if (appointmentDate.value) bindings.push(appointmentDate.value);
  bindings.push(tenantId);
  if (visitDate.value) bindings.push(visitDate.value);

  const depositAdjustedExpression = `COALESCE((
    SELECT SUM(bd.amount)
    FROM billing_deposits bd
    WHERE bd.tenant_id = b.tenant_id
      AND bd.reference_bill_id = b.id
      AND bd.transaction_type = 'adjustment'
      AND bd.is_active = 1
  ), 0)`;
  const settledAmountExpression = `(COALESCE(b.paid, 0) + ${depositAdjustedExpression})`;
  const calculatedPendingExpression = `MAX(0, COALESCE(b.total, 0) - ${settledAmountExpression})`;
  const pendingAmountExpression = `MIN(MAX(0, COALESCE(b.due, ${calculatedPendingExpression})), ${calculatedPendingExpression})`;
  const worklistCtes = `
    WITH bill_rows AS (
      SELECT
        'bill' AS source_type,
        b.id AS source_id,
        b.id AS bill_id,
        NULL AS appointment_id,
        b.visit_id AS visit_id,
        b.patient_id,
        p.name AS patient_name,
        p.patient_code,
        d.id AS doctor_id,
        d.name AS doctor_name,
        NULL AS token_no,
        NULL AS appt_time,
        b.invoice_no,
        COALESCE(
          NULLIF(GROUP_CONCAT(DISTINCT ii.description), ''),
          CASE
            WHEN COALESCE(b.test_bill, 0) > 0 THEN 'Lab / diagnostic test'
            WHEN COALESCE(b.doctor_visit_bill, 0) > 0 THEN 'Doctor consultation'
            WHEN COALESCE(b.operation_bill, 0) > 0 THEN 'Procedure / operation'
            WHEN COALESCE(b.admission_bill, 0) > 0 THEN 'Admission / bed charge'
            WHEN COALESCE(b.medicine_bill, 0) > 0 THEN 'Medicine'
            ELSE 'Service bill'
          END
        ) AS service_summary,
        ${pendingAmountExpression} AS amount,
        b.created_at AS occurred_at,
        u.name AS created_by_name,
        b.status AS billing_status
      FROM bills b
      JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
      LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
      LEFT JOIN doctors d ON d.id = COALESCE(b.referring_doctor_id, v.doctor_id) AND d.tenant_id = b.tenant_id
      LEFT JOIN users u ON u.id = b.created_by AND u.tenant_id = b.tenant_id
      LEFT JOIN invoice_items ii ON ii.bill_id = b.id AND ii.tenant_id = b.tenant_id
      WHERE b.tenant_id = ?
        ${billDate.sql}
        AND COALESCE(b.status, 'open') NOT IN ('paid', 'cancelled', 'refunded', 'draft')
        AND ${pendingAmountExpression} > 0
        AND (v.appointment_id IS NULL
          OR COALESCE(b.test_bill, 0) > 0
          OR COALESCE(b.operation_bill, 0) > 0
          OR COALESCE(b.admission_bill, 0) > 0
          OR COALESCE(b.medicine_bill, 0) > 0)
      GROUP BY b.id
    ), appointment_rows AS (
      SELECT
        'appointment' AS source_type,
        a.id AS source_id,
        NULL AS bill_id,
        a.id AS appointment_id,
        NULL AS visit_id,
        a.patient_id,
        p.name AS patient_name,
        p.patient_code,
        d.id AS doctor_id,
        d.name AS doctor_name,
        a.token_no,
        a.appt_time,
        NULL AS invoice_no,
        'Doctor consultation' AS service_summary,
        COALESCE(SUM(pi.total_amount), a.fee, 0) AS amount,
        COALESCE(a.appt_date || ' ' || NULLIF(a.appt_time, ''), a.appt_date) AS occurred_at,
        NULL AS created_by_name,
        a.billing_status
      FROM appointments a
      JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      LEFT JOIN billing_provisional_items pi
        ON pi.appointment_id = a.id
       AND pi.tenant_id = a.tenant_id
       AND pi.bill_status = 'provisional'
       AND COALESCE(pi.is_active, 1) = 1
      WHERE a.tenant_id = ?
        ${appointmentDate.sql}
        AND a.status NOT IN ('cancelled', 'completed', 'no_show')
        AND a.billing_status IN ('pending', 'unpaid', 'partial_paid')
      GROUP BY a.id
      HAVING amount > 0
    ), visit_rows AS (
      SELECT
        'visit' AS source_type,
        v.id AS source_id,
        NULL AS bill_id,
        v.appointment_id AS appointment_id,
        v.id AS visit_id,
        v.patient_id,
        p.name AS patient_name,
        p.patient_code,
        d.id AS doctor_id,
        d.name AS doctor_name,
        NULL AS token_no,
        NULL AS appt_time,
        NULL AS invoice_no,
        'Doctor consultation' AS service_summary,
        SUM(vs.total_amount) AS amount,
        COALESCE(v.visit_date, v.created_at) AS occurred_at,
        NULL AS created_by_name,
        v.status AS billing_status
      FROM visits v
      JOIN patients p ON p.id = v.patient_id AND p.tenant_id = v.tenant_id
      LEFT JOIN doctors d ON d.id = v.doctor_id AND d.tenant_id = v.tenant_id
      JOIN visit_services vs
        ON vs.visit_id = v.id
       AND vs.tenant_id = v.tenant_id
       AND vs.status = 'pending'
       AND vs.service_type = 'doctor_visit'
      WHERE v.tenant_id = ?
        ${visitDate.sql}
        AND COALESCE(v.status, 'active') <> 'cancelled'
        AND (
          v.appointment_id IS NULL
          OR NOT EXISTS (
            SELECT 1
            FROM appointments linked_appointment
            WHERE linked_appointment.id = v.appointment_id
              AND linked_appointment.tenant_id = v.tenant_id
              AND linked_appointment.status NOT IN ('cancelled', 'completed', 'no_show')
              AND linked_appointment.billing_status IN ('pending', 'unpaid', 'partial_paid')
          )
        )
      GROUP BY v.id
      HAVING amount > 0
    ), pending_rows AS (
      SELECT * FROM bill_rows
      UNION ALL
      SELECT * FROM appointment_rows
      UNION ALL
      SELECT * FROM visit_rows
    )
  `;

  const [countResult, pageResult] = await c.env.DB.batch([
    c.env.DB.prepare(`${worklistCtes} SELECT COUNT(*) AS count FROM pending_rows`).bind(...bindings),
    c.env.DB.prepare(`
      ${worklistCtes}
      SELECT *
      FROM pending_rows
      ORDER BY amount DESC, occurred_at ASC, source_type ASC, source_id ASC
      LIMIT ? OFFSET ?
    `).bind(...bindings, limit, offset),
  ]);
  const total = Number((countResult.results?.[0] as { count?: number } | undefined)?.count ?? 0);
  return c.json({
    data: pageResult.results ?? [],
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    date: selectedDate ?? null,
    beforeDate: beforeDate ?? null,
  });
});

billingCounterRoutes.get('/pending-appointment-charges', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date');
  const beforeDate = c.req.query('beforeDate');
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 25), 1), 100);
  const page = Math.max(Number(c.req.query('page') ?? 1), 1);
  const offset = (page - 1) * limit;

  const appointmentFilters: string[] = ['a.tenant_id = ?'];
  const appointmentParams: Array<string | number> = [tenantId];
  if (date) {
    appointmentFilters.push('a.appt_date = ?');
    appointmentParams.push(date);
  } else if (beforeDate) {
    appointmentFilters.push('a.appt_date < ?');
    appointmentParams.push(beforeDate);
  }

  const totalResult = await c.env.DB.prepare(`
    SELECT COUNT(*) AS cnt
    FROM (
      SELECT a.id,
        COALESCE(SUM(pi.total_amount), a.fee, 0) AS pending_amount
      FROM appointments a
      LEFT JOIN billing_provisional_items pi
        ON pi.appointment_id = a.id
       AND pi.tenant_id = a.tenant_id
       AND pi.bill_status = 'provisional'
       AND COALESCE(pi.is_active, 1) = 1
      WHERE ${appointmentFilters.join(' AND ')}
        AND a.status NOT IN ('cancelled', 'completed', 'no_show')
        AND a.billing_status IN ('pending', 'unpaid', 'partial_paid')
      GROUP BY a.id
      HAVING pending_amount > 0
    ) pending
  `).bind(...appointmentParams).first<{ cnt: number }>();

  const { results } = await c.env.DB.prepare(`
    SELECT
      a.id AS appointment_id,
      a.appt_no,
      a.token_no,
      a.appt_date,
      a.appt_time,
      a.status AS appointment_status,
      a.billing_status,
      a.fee AS appointment_fee,
      p.id AS patient_id,
      p.name AS patient_name,
      p.patient_code,
      p.mobile AS patient_mobile,
      d.id AS doctor_id,
      d.name AS doctor_name,
      d.specialty AS doctor_specialty,
      COALESCE(SUM(pi.total_amount), a.fee, 0) AS pending_amount,
      COUNT(pi.id) AS pending_item_count
    FROM appointments a
    JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
    LEFT JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
    LEFT JOIN billing_provisional_items pi
      ON pi.appointment_id = a.id
     AND pi.tenant_id = a.tenant_id
     AND pi.bill_status = 'provisional'
     AND COALESCE(pi.is_active, 1) = 1
    WHERE ${appointmentFilters.join(' AND ')}
      AND a.status NOT IN ('cancelled', 'completed', 'no_show')
      AND a.billing_status IN ('pending', 'unpaid', 'partial_paid')
    GROUP BY a.id
    HAVING pending_amount > 0
    ORDER BY a.appt_date ASC, a.appt_time ASC, a.token_no ASC, a.id ASC
    LIMIT ? OFFSET ?
  `).bind(...appointmentParams, limit, offset).all();

  const normalizedResults = (results ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    appointment_id: row.appointment_id ?? row.id,
  }));

  return c.json({
    data: normalizedResults,
    date: date ?? null,
    beforeDate: beforeDate ?? null,
    pagination: {
      page,
      limit,
      total: Number(totalResult?.cnt ?? 0),
      pages: Math.ceil(Number(totalResult?.cnt ?? 0) / limit),
    },
  });
});

billingCounterRoutes.get('/pending-bills', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date');
  const beforeDate = c.req.query('beforeDate');
  const patientId = Number(c.req.query('patient_id') ?? 0);
  const visitId = Number(c.req.query('visit_id') ?? 0);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 25), 1), 100);
  const page = Math.max(Number(c.req.query('page') ?? 1), 1);
  const offset = (page - 1) * limit;
  const search = (c.req.query('search') ?? '').trim();

  const params: Array<string | number> = [tenantId];
  const safe = search ? escapeLikeWildcards(search) : '';
  const invoiceTerms = search ? buildInvoiceSearchTerms(safe) : null;
  const depositAdjustedExpression = `COALESCE((
    SELECT SUM(bd.amount)
    FROM billing_deposits bd
    WHERE bd.tenant_id = b.tenant_id
      AND bd.reference_bill_id = b.id
      AND bd.transaction_type = 'adjustment'
      AND bd.is_active = 1
  ), 0)`;
  const settledAmountExpression = `(COALESCE(b.paid, 0) + ${depositAdjustedExpression})`;
  const calculatedPendingExpression = `MAX(0, COALESCE(b.total, 0) - ${settledAmountExpression})`;
  const pendingAmountExpression = `MIN(MAX(0, COALESCE(b.due, ${calculatedPendingExpression})), ${calculatedPendingExpression})`;
  const optionalClauses: string[] = [];
  if (date) {
    optionalClauses.push('AND date(b.created_at) = ?');
    params.push(date);
  } else if (beforeDate) {
    optionalClauses.push('AND date(b.created_at) < ?');
    params.push(beforeDate);
  }
  if (Number.isFinite(patientId) && patientId > 0) {
    optionalClauses.push('AND b.patient_id = ?');
    params.push(patientId);
  }
  if (Number.isFinite(visitId) && visitId > 0) {
    optionalClauses.push('AND b.visit_id = ?');
    params.push(visitId);
  }
  if (invoiceTerms) {
    optionalClauses.push(`AND (b.invoice_no LIKE ? ESCAPE '\\' OR b.invoice_no LIKE ? ESCAPE '\\' OR b.invoice_no LIKE ? ESCAPE '\\')`);
    params.push(invoiceTerms.original, invoiceTerms.normalized, invoiceTerms.padded);
  }
  const optionalWhereClause = optionalClauses.join(' ');

  const countParams: Array<string | number> = [tenantId];
  if (date) countParams.push(date);
  else if (beforeDate) countParams.push(beforeDate);
  if (Number.isFinite(patientId) && patientId > 0) countParams.push(patientId);
  if (Number.isFinite(visitId) && visitId > 0) countParams.push(visitId);
  if (invoiceTerms) {
    countParams.push(invoiceTerms.original, invoiceTerms.normalized, invoiceTerms.padded);
  }

  const totalResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as cnt FROM bills b
    LEFT JOIN visits v_appt ON v_appt.id = b.visit_id AND v_appt.tenant_id = b.tenant_id
    WHERE b.tenant_id = ? ${optionalWhereClause}
      AND COALESCE(b.status, 'open') NOT IN ('paid', 'cancelled', 'refunded', 'draft')
      AND ${pendingAmountExpression} > 0
      AND (v_appt.appointment_id IS NULL
        OR COALESCE(b.test_bill, 0) > 0
        OR COALESCE(b.operation_bill, 0) > 0
        OR COALESCE(b.admission_bill, 0) > 0
        OR COALESCE(b.medicine_bill, 0) > 0
      )
  `).bind(...countParams).first<{ cnt: number }>();

  const queryParams: Array<string | number> = [...params, limit, offset];
  const { results } = await c.env.DB.prepare(`
    SELECT
      b.id AS bill_id,
      b.invoice_no,
      b.patient_id,
      b.visit_id,
      p.name AS patient_name,
      p.patient_code,
      p.mobile AS patient_mobile,
      COALESCE(b.total, 0) AS total_amount,
      COALESCE(b.paid, 0) AS cash_paid_amount,
      ${depositAdjustedExpression} AS deposit_adjusted,
      ${settledAmountExpression} AS settled_amount,
      ${settledAmountExpression} AS paid_amount,
      ${pendingAmountExpression} AS pending_amount,
      ${pendingAmountExpression} AS outstanding,
      b.status,
      b.created_at,
      COALESCE(b.test_bill, 0) AS test_bill,
      COALESCE(b.doctor_visit_bill, 0) AS doctor_visit_bill,
      COALESCE(b.operation_bill, 0) AS operation_bill,
      COALESCE(b.admission_bill, 0) AS admission_bill,
      COALESCE(b.medicine_bill, 0) AS medicine_bill,
      u.name AS created_by_name,
      date(b.created_at) AS bill_date,
      COUNT(ii.id) AS item_count,
      (
        SELECT COUNT(*)
        FROM visit_services vs
        WHERE vs.tenant_id = b.tenant_id
          AND vs.bill_id = b.id
      ) AS visit_service_count,
      COALESCE(
        NULLIF(GROUP_CONCAT(DISTINCT ii.description), ''),
        (
          SELECT NULLIF(GROUP_CONCAT(vs.description), '')
          FROM visit_services vs
          WHERE vs.tenant_id = b.tenant_id
            AND vs.bill_id = b.id
        ),
        CASE
          WHEN COALESCE(b.test_bill, 0) > 0 THEN 'Lab / diagnostic test'
          WHEN COALESCE(b.doctor_visit_bill, 0) > 0 THEN 'Doctor consultation'
          WHEN COALESCE(b.operation_bill, 0) > 0 THEN 'Procedure / operation'
          WHEN COALESCE(b.admission_bill, 0) > 0 THEN 'Admission / bed charge'
          WHEN COALESCE(b.medicine_bill, 0) > 0 THEN 'Medicine'
          ELSE 'Service bill'
        END
      ) AS service_summary,
      v.visit_no,
      d.name AS doctor_name
    FROM bills b
    JOIN patients p ON p.id = b.patient_id AND p.tenant_id = b.tenant_id
    LEFT JOIN visits v ON v.id = b.visit_id AND v.tenant_id = b.tenant_id
    LEFT JOIN doctors d ON d.id = COALESCE(b.referring_doctor_id, v.doctor_id) AND d.tenant_id = b.tenant_id
    LEFT JOIN users u ON u.id = b.created_by AND u.tenant_id = b.tenant_id
    LEFT JOIN invoice_items ii ON ii.bill_id = b.id AND ii.tenant_id = b.tenant_id
    WHERE b.tenant_id = ?
      ${optionalWhereClause}
      AND COALESCE(b.status, 'open') NOT IN ('paid', 'cancelled', 'refunded', 'draft')
      AND ${pendingAmountExpression} > 0
      AND (v.appointment_id IS NULL
        OR COALESCE(b.test_bill, 0) > 0
        OR COALESCE(b.operation_bill, 0) > 0
        OR COALESCE(b.admission_bill, 0) > 0
        OR COALESCE(b.medicine_bill, 0) > 0
      )
    GROUP BY b.id
    ORDER BY b.created_at ASC, b.id ASC
    LIMIT ? OFFSET ?
  `).bind(...queryParams).all();

  const normalized = (results ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    item_count: Math.max(Number(row.item_count ?? 0), Number(row.visit_service_count ?? 0)),
  }));

  return c.json({
    data: normalized,
    date: date ?? null,
    beforeDate: beforeDate ?? null,
    pagination: {
      page,
      limit,
      total: totalResult?.cnt ?? 0,
      pages: Math.ceil((totalResult?.cnt ?? 0) / limit),
    },
  });
});

billingCounterRoutes.get('/pending-lab-orders', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 25), 1), 100);

  const { results } = await c.env.DB.prepare(`
    SELECT
      lo.id AS order_id,
      lo.order_no,
      lo.prescription_id,
      p.rx_no,
      lo.patient_id,
      pt.name AS patient_name,
      pt.patient_code,
      pt.mobile AS patient_mobile,
      d.id AS doctor_id,
      d.name AS doctor_name,
      lo.order_date,
      lo.created_at,
      COUNT(loi.id) AS pending_item_count,
      COALESCE(SUM(COALESCE(NULLIF(loi.line_total, 0), loi.unit_price, ltc.price, 0)), 0) AS pending_amount,
      GROUP_CONCAT(
        loi.id || '::' || COALESCE(NULLIF(loi.test_name, ''), ltc.name, 'Test #' || loi.lab_test_id) || '::' ||
        COALESCE(NULLIF(loi.line_total, 0), loi.unit_price, ltc.price, 0),
        '||'
      ) AS pending_items
    FROM lab_orders lo
    JOIN patients pt ON pt.id = lo.patient_id AND pt.tenant_id = lo.tenant_id
    JOIN lab_order_items loi ON loi.lab_order_id = lo.id AND loi.tenant_id = lo.tenant_id
    LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = lo.tenant_id
    LEFT JOIN prescriptions p ON p.id = lo.prescription_id AND p.tenant_id = lo.tenant_id
    LEFT JOIN doctors d ON d.id = p.doctor_id AND d.tenant_id = lo.tenant_id
    WHERE lo.tenant_id = ?
      AND lo.prescription_id IS NOT NULL
      AND COALESCE(loi.status, 'pending') NOT IN ('cancelled', 'completed')
      AND NOT EXISTS (
        SELECT 1
        FROM invoice_items ii
        JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
        WHERE ii.tenant_id = lo.tenant_id
          AND ii.reference_id = loi.id
          AND ii.item_category = 'test'
          AND COALESCE(ii.status, 'active') = 'active'
          AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      )
    GROUP BY lo.id
    HAVING pending_item_count > 0
    ORDER BY lo.created_at DESC, lo.id DESC
    LIMIT ?
  `).bind(tenantId, limit).all<PendingLabOrderRow>();

  const data = (results ?? []).map((row) => ({
    orderId: Number(row.order_id),
    orderNo: row.order_no,
    prescriptionId: row.prescription_id != null ? Number(row.prescription_id) : null,
    rxNo: row.rx_no,
    patientId: Number(row.patient_id),
    patientName: row.patient_name,
    patientCode: row.patient_code,
    patientMobile: row.patient_mobile,
    doctorId: row.doctor_id != null ? Number(row.doctor_id) : null,
    doctorName: row.doctor_name,
    orderDate: row.order_date,
    createdAt: row.created_at ?? null,
    pendingItemCount: Number(row.pending_item_count ?? 0),
    pendingAmount: Number(row.pending_amount ?? 0),
    items: parsePendingLabItems(row.pending_items),
  }));

  return c.json({ data });
});

billingCounterRoutes.post('/lab-orders/:id/bill', zValidator('json', pendingLabOrderBillSchema), requirePermission('billing.counter.invoice.create'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const orderId = Number(c.req.param('id'));
  if (!Number.isFinite(orderId) || orderId <= 0) {
    throw new HTTPException(400, { message: 'Invalid lab order id' });
  }
  const data = c.req.valid('json');
  const requestedItemIds = [...new Set(data.itemIds.map(Number))];

  const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before creating bills.' });
  }

  const order = await c.env.DB.prepare(`
    SELECT lo.id, lo.order_no, lo.patient_id, lo.visit_id, lo.prescription_id, p.doctor_id
    FROM lab_orders lo
    LEFT JOIN prescriptions p ON p.id = lo.prescription_id AND p.tenant_id = lo.tenant_id
    WHERE lo.id = ? AND lo.tenant_id = ?
    LIMIT 1
  `).bind(orderId, tenantId).first<LabOrderBillRow>();
  if (!order) throw new HTTPException(404, { message: 'Lab order not found' });

  const placeholders = requestedItemIds.map(() => '?').join(',');
  const { results: selectedItems } = await c.env.DB.prepare(`
    SELECT
      loi.id,
      loi.lab_order_id,
      loi.lab_test_id,
      COALESCE(NULLIF(loi.test_name, ''), ltc.name, 'Test #' || loi.lab_test_id) AS test_name,
      COALESCE(loi.unit_price, ltc.price, 0) AS unit_price,
      COALESCE(loi.discount, 0) AS discount,
      COALESCE(NULLIF(loi.line_total, 0), loi.unit_price, ltc.price, 0) AS line_total,
      ltc.billing_service_item_id
    FROM lab_order_items loi
    LEFT JOIN lab_test_catalog ltc ON ltc.id = loi.lab_test_id AND ltc.tenant_id = loi.tenant_id
    WHERE loi.tenant_id = ?
      AND loi.lab_order_id = ?
      AND loi.id IN (${placeholders})
      AND COALESCE(loi.status, 'pending') NOT IN ('cancelled', 'completed')
      AND NOT EXISTS (
        SELECT 1
        FROM invoice_items ii
        JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
        WHERE ii.tenant_id = loi.tenant_id
          AND ii.reference_id = loi.id
          AND ii.item_category = 'test'
          AND COALESCE(ii.status, 'active') = 'active'
          AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
      )
  `).bind(tenantId, orderId, ...requestedItemIds).all<LabOrderBillItemRow>();

  if ((selectedItems ?? []).length !== requestedItemIds.length) {
    throw new HTTPException(409, { message: 'Some selected lab tests are already billed, cancelled, or unavailable' });
  }

  const total = (selectedItems ?? []).reduce((sum, item) => sum + Number(item.line_total ?? 0), 0);
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Prescription lab order billing');

  const invoiceMode = resolveBillingCounterInvoiceMode({
    requestedMode: data.billMode,
    total,
    paidAmount: data.payment.paidAmount,
    depositDeducted: 0,
  });
  const payment = calculateBillPaymentState({
    total,
    paidAmount: invoiceMode.paidAmount,
    depositDeducted: 0,
  });
  const effectiveDue = invoiceMode.effectiveMode === 'credit' ? total : payment.due;
  const effectiveStatus = invoiceMode.effectiveMode === 'credit'
    ? (effectiveDue <= 0 ? 'paid' : 'open')
    : payment.status;
  const invoiceNo = await getNextInvoiceNumber(c.env.DB, tenantId, 'diagnostic');
  const categoryTotals = calculateBillCategoryTotals([{ category: 'test', amount: total }]);
  const billIdLookupSql = `(SELECT id FROM bills WHERE invoice_no = ? AND tenant_id = ? LIMIT 1)`;
  const batch: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO bills
        (patient_id, visit_id, invoice_no, referring_doctor_id, referred_by_type,
         test_bill, doctor_visit_bill, admission_bill, operation_bill, medicine_bill,
         discount, total, paid, due, status, tenant_id, created_by, counter_id, counter_session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      order.patient_id,
      order.visit_id ?? null,
      invoiceNo,
      order.doctor_id ?? null,
      order.doctor_id ? 'doctor' : 'self',
      categoryTotals.testBill,
      categoryTotals.doctorVisitBill,
      categoryTotals.admissionBill,
      categoryTotals.operationBill,
      categoryTotals.medicineBill,
      total,
      payment.paid,
      effectiveDue,
      effectiveStatus,
      tenantId,
      userId,
      Number(activeSession.counter_id),
      Number(activeSession.id),
    ),
  ];

  for (const item of selectedItems ?? []) {
    batch.push(c.env.DB.prepare(`
      INSERT INTO invoice_items (bill_id, item_category, description, quantity, unit_price, line_total, tax_amount, reference_id, tenant_id, created_at)
      VALUES (${billIdLookupSql}, 'test', ?, 1, ?, ?, 0, ?, ?, datetime('now', '+6 hours'))
    `).bind(invoiceNo, tenantId, item.test_name, Number(item.unit_price ?? item.line_total ?? 0), Number(item.line_total ?? 0), item.id, tenantId));

    batch.push(c.env.DB.prepare(`
      INSERT INTO visit_services
        (tenant_id, visit_id, patient_id, service_type, description, service_item_id, doctor_id, amount,
         discount_amount, quantity, total_amount, reference_type, reference_id, status, bill_id, created_by)
      VALUES (?, ?, ?, 'test', ?, ?, ?, ?, ?, 1, ?, 'lab_order_item', ?, 'billed', ${billIdLookupSql}, ?)
    `).bind(
      tenantId,
      order.visit_id ?? null,
      order.patient_id,
      item.test_name,
      item.billing_service_item_id ?? null,
      order.doctor_id ?? null,
      Number(item.unit_price ?? item.line_total ?? 0),
      Number(item.discount ?? 0),
      Number(item.line_total ?? 0),
      item.id,
      invoiceNo,
      tenantId,
      userId,
    ));
  }

  batch.push(c.env.DB.prepare(`
    UPDATE lab_orders
    SET bill_id = ${billIdLookupSql},
        billing_status = CASE
          WHEN EXISTS (
            SELECT 1
            FROM lab_order_items remaining
            WHERE remaining.tenant_id = lab_orders.tenant_id
              AND remaining.lab_order_id = lab_orders.id
              AND COALESCE(remaining.status, 'pending') NOT IN ('cancelled', 'completed')
              AND NOT EXISTS (
                SELECT 1
                FROM invoice_items ii
                JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
                WHERE ii.tenant_id = remaining.tenant_id
                  AND ii.reference_id = remaining.id
                  AND ii.item_category = 'test'
                  AND COALESCE(ii.status, 'active') = 'active'
                  AND COALESCE(b.status, 'open') NOT IN ('cancelled', 'refunded', 'draft')
              )
          ) THEN 'partial_billed'
          WHEN ? <= 0 THEN 'paid'
          ELSE 'unpaid'
        END,
        updated_at = datetime('now', '+6 hours')
    WHERE id = ? AND tenant_id = ?
  `).bind(invoiceNo, tenantId, effectiveDue, orderId, tenantId));

  if (payment.paid > 0) {
    const receiptNo = await getNextSequence(c.env.DB, tenantId, 'receipt', 'RCP');
    batch.push(c.env.DB.prepare(`
      INSERT INTO payments
        (bill_id, amount, payment_type, receipt_no, received_by, payment_method, external_transaction_id, tenant_id, counter_id, counter_session_id, date)
      VALUES (${billIdLookupSql}, ?, 'current', ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      invoiceNo,
      tenantId,
      payment.paid,
      receiptNo,
      userId,
      data.payment.paymentMethod,
      data.payment.externalTransactionId ?? null,
      tenantId,
      Number(activeSession.counter_id),
      Number(activeSession.id),
    ));
  }

  await c.env.DB.batch(batch);

  const bill = await c.env.DB.prepare(`
    SELECT id
    FROM bills
    WHERE tenant_id = ? AND invoice_no = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(tenantId, invoiceNo).first<{ id: number }>();
  const billId = Number(bill?.id);
  if (!Number.isFinite(billId) || billId <= 0) {
    throw new HTTPException(500, { message: 'Prescription lab bill was not created' });
  }

  const reagentUsageWarnings: Array<{ itemId: number; message: string }> = [];
  const labInventoryPolicy = await getLabInventoryPolicy(c.env.DB, tenantId);
  const consumeReagentsOnBilling = await shouldConsumeLabReagentsForEvent(c.env.DB, tenantId, 'billing');
  if (consumeReagentsOnBilling) {
    for (const item of selectedItems ?? []) {
      try {
        await consumeMappedLabConsumables(c.env.DB, {
          tenantId,
          userId,
          labOrderItemId: Number(item.id),
          labOrderId: orderId,
          labTestId: Number(item.lab_test_id),
          requireMapping: labInventoryPolicy.require_test_mapping_for_completion,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to record reagent usage';
        await recordLabInventoryException(c.env.DB, {
          tenantId,
          userId,
          labOrderId: orderId,
          labOrderItemId: Number(item.id),
          labTestId: Number(item.lab_test_id),
          sourceEvent: 'billing_finalization',
          reason: 'billing_time_consumption_failed',
          message,
          metadata: { billId, invoiceNo },
        });
        if (shouldBlockLabInventoryException(labInventoryPolicy, 'billing')) {
          throw error;
        }
        reagentUsageWarnings.push({
          itemId: Number(item.id),
          message,
        });
      }
    }
  }

  await recordBillFinalizationSideEffects(c.env.DB, {
    tenantId,
    userId,
    patientId: Number(order.patient_id),
    visitId: order.visit_id ?? null,
    billId,
    invoiceNo,
    referringDoctorId: order.doctor_id ?? null,
    billDate: today,
    subtotal: total,
    discount: 0,
    total,
    categoryTotals,
    counterId: Number(activeSession.counter_id),
    counterSessionId: Number(activeSession.id),
    extraPayload: { labOrderId: orderId, prescriptionId: order.prescription_id ?? null },
    items: (selectedItems ?? []).map((item) => ({
      itemCategory: 'test',
      description: item.test_name,
      lineTotal: Number(item.line_total ?? 0),
      referenceId: Number(item.id),
      labTestId: Number(item.lab_test_id) || null,
    })),
  });
  queueAccountingPosting(c, tenantId);

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'bills', billId, null, {
    action: 'prescription_lab_order_bill',
    labOrderId: orderId,
    itemIds: requestedItemIds,
    invoiceNo,
    requestedMode: invoiceMode.requestedMode,
    mode: invoiceMode.effectiveMode,
    modeAdjusted: invoiceMode.modeAdjusted,
    modeAdjustmentReason: invoiceMode.modeAdjustmentReason,
    total,
    paidAmount: payment.paid,
    dueAmount: effectiveDue,
    status: effectiveStatus,
  });

  return c.json({
    billId,
    invoiceNo,
    requestedMode: invoiceMode.requestedMode,
    mode: invoiceMode.effectiveMode,
    modeAdjusted: invoiceMode.modeAdjusted,
    modeAdjustmentReason: invoiceMode.modeAdjustmentReason,
    total,
    paidAmount: payment.paid,
    dueAmount: effectiveDue,
    status: effectiveStatus,
    itemCount: selectedItems?.length ?? 0,
    reagentUsageWarnings,
  }, 201);
});

billingCounterRoutes.get('/handover-recipients', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const purpose = c.req.query('purpose') === MANAGEMENT_COLLECTION_PURPOSE
    ? MANAGEMENT_COLLECTION_PURPOSE
    : c.req.query('purpose') === SHIFT_TRANSFER_PURPOSE
      ? SHIFT_TRANSFER_PURPOSE
      : null;

  const { results } = await c.env.DB.prepare(`
    SELECT id, name, email, role
    FROM users
    WHERE tenant_id = ?
      AND role IN ('hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist', 'manager')
    ORDER BY
      CASE role
        WHEN 'reception' THEN 1
        WHEN 'receptionist' THEN 2
        WHEN 'manager' THEN 3
        WHEN 'accountant' THEN 4
        WHEN 'hospital_admin' THEN 5
        WHEN 'md' THEN 6
        WHEN 'director' THEN 7
        ELSE 8
      END,
      name ASC
  `).bind(tenantId).all<HandoverRecipient>();

  const users = results ?? [];
  const recipients = [] as HandoverRecipient[];
  for (const user of users) {
    const role = String(user.role ?? '');
    const permissions = await resolveTenantUserPermissions(c.env.DB, tenantId, user.id, role);
    const canShift = hasCounterShiftCapability(permissions, role);
    const canManagement = hasManagementCashCapability(permissions, role);
    if (purpose === SHIFT_TRANSFER_PURPOSE && !canShift) continue;
    if (purpose === MANAGEMENT_COLLECTION_PURPOSE && !canManagement) continue;
    if (!purpose && !canShift && !canManagement) continue;
    recipients.push(user);
  }

  return c.json({ recipients });
});

billingCounterRoutes.get('/handovers/pending', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));

  const { results } = await c.env.DB.prepare(`
    SELECT h.id,
           h.handover_amount,
           h.due_amount,
           h.status,
           h.remarks,
           h.created_at,
           h.counter_session_id,
           u.name AS handover_by_name,
           s.counter_id,
           s.counter_type,
           bc.counter_name,
           bc.counter_code
    FROM billing_handovers h
    JOIN users u ON u.id = h.handover_by AND u.tenant_id = h.tenant_id
    LEFT JOIN billing_counter_sessions s ON s.id = h.counter_session_id AND s.tenant_id = h.tenant_id
    LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = h.tenant_id
    WHERE h.tenant_id = ?
      AND h.handover_to = ?
      AND h.handover_type = 'counter'
      AND COALESCE(h.handover_purpose, 'shift_transfer') = 'shift_transfer'
      AND h.status IN ('pending', 'partial')
    ORDER BY h.created_at DESC
    LIMIT 5
  `).bind(tenantId, userId).all();

  return c.json({ handovers: results ?? [] });
});

billingCounterRoutes.post('/handovers/:handoverId/accept', requirePermission('billing.counter.handover.receive'), zValidator('json', z.object({
  receivedAmount: z.number().min(0),
  remarks: z.string().optional(),
  disputeReason: z.string().optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = String(c.get('role') ?? '');
  const handoverId = Number(c.req.param('handoverId'));
  if (!Number.isInteger(handoverId) || handoverId <= 0) throw new HTTPException(400, { message: 'Invalid handover ID' });
  const data = c.req.valid('json');
  const workstationId = getBillingWorkstationId(c);
  if (!workstationId) {
    throw new HTTPException(400, { message: 'Workstation identity is required before accepting a counter handover.' });
  }

  const handover = await c.env.DB.prepare(`
    SELECT h.id, h.handover_by, h.handover_to, h.handover_amount, h.due_amount, h.status,
           h.counter_session_id, h.admin_verification_status, h.handover_purpose,
           s.counter_id, s.counter_type, bc.counter_name, bc.counter_code
    FROM billing_handovers h
    LEFT JOIN billing_counter_sessions s ON s.id = h.counter_session_id AND s.tenant_id = h.tenant_id
    LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = h.tenant_id
    WHERE h.id = ? AND h.tenant_id = ? AND h.handover_type = 'counter'
  `).bind(handoverId, tenantId).first<{
    id: number;
    handover_by: number;
    handover_to: number | null;
    handover_amount: number;
    due_amount: number | null;
    status: string;
    admin_verification_status: string | null;
    handover_purpose: string | null;
    counter_session_id: number | null;
    counter_id: number | null;
    counter_type: string | null;
    counter_name: string | null;
    counter_code: string | null;
  }>();

  if (!handover) throw new HTTPException(404, { message: 'Pending handover not found' });
  if (Number(handover.handover_to) !== Number(userId)) {
    throw new HTTPException(403, { message: 'Only the handover recipient can accept this counter handover' });
  }
  if (!['pending', 'partial'].includes(handover.status)) {
    throw new HTTPException(400, { message: `Handover already ${handover.status}` });
  }
  if (!handover.counter_session_id || !handover.counter_id) {
    throw new HTTPException(409, { message: 'Counter handover is missing counter session context' });
  }

  const receiverPermissions = await resolveTenantUserPermissions(c.env.DB, tenantId, userId, role);
  const handoverPurpose = (handover.handover_purpose === MANAGEMENT_COLLECTION_PURPOSE
    ? MANAGEMENT_COLLECTION_PURPOSE
    : handover.handover_purpose === SHIFT_TRANSFER_PURPOSE
      ? SHIFT_TRANSFER_PURPOSE
      : (MANAGEMENT_CASH_RECEIVER_ROLES as readonly string[]).includes(role)
        ? MANAGEMENT_COLLECTION_PURPOSE
        : SHIFT_TRANSFER_PURPOSE) as HandoverPurpose;

  const expectedReceived = Math.max(0, Number(handover.handover_amount ?? 0) - Number(handover.due_amount ?? 0));
  const variance = Math.round((Number(data.receivedAmount) - expectedReceived) * 100) / 100;
  const hasDispute = variance !== 0 || Boolean(data.disputeReason?.trim());
  if (hasDispute && !data.disputeReason?.trim()) {
    throw new HTTPException(400, { message: 'Dispute reason is required when cash does not match.' });
  }

  const existingSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId,
    requireCurrentWorkstation: true,
  });

  const receivedRemarks = [
    data.remarks?.trim(),
    hasDispute ? `DISPUTE: expected ${expectedReceived}, received ${data.receivedAmount}, variance ${variance}. ${data.disputeReason?.trim()}` : null,
  ].filter(Boolean).join(' | ') || null;
  const receiverStatus = hasDispute ? 'disputed' : 'received';
  const adminVerificationStatus = hasDispute ? HANDOVER_ADMIN_VERIFICATION_PENDING : null;
  const responseVerificationStatus = hasDispute ? HANDOVER_ADMIN_VERIFICATION_PENDING : 'not_required';

  if (existingSession) {
    const activeCounter = await c.env.DB.prepare(`
      SELECT id, employee_id FROM billing_counter_sessions
      WHERE tenant_id = ? AND counter_id = ? AND status = 'active'
      LIMIT 1
    `).bind(tenantId, handover.counter_id).first<{ id: number; employee_id: number }>();
    if (activeCounter && Number(activeCounter.id) !== Number(existingSession.id)) {
      throw new HTTPException(409, { message: 'This billing counter is already active for another user.' });
    }

    const existingSessionId = Number(existingSession.id);
    const existingCounterId = Number(existingSession.counter_id);
    const absVariance = Math.abs(variance);
    const requiresApproval = absVariance > CASH_VARIANCE_APPROVAL_THRESHOLD;
    const batchResults = await c.env.DB.batch([
      receiverHandoverVerificationEventStatement(c.env.DB, {
        tenantId,
        handoverId,
        eventType: hasDispute ? 'receiver_disputed' : 'receiver_verified',
        actorUserId: userId,
        actorRole: role,
        countedAmount: Number(data.receivedAmount),
        expectedAmount: expectedReceived,
        variance,
        decision: hasDispute ? 'dispute' : 'verify',
        remarks: receivedRemarks,
        workstationId,
      }),
      c.env.DB.prepare(`
        UPDATE billing_handovers
        SET status = ?,
            received_by = ?,
            received_at = datetime('now', '+6 hours'),
            received_remarks = ?,
            receiver_counted_amount = ?,
            receiver_variance = ?,
            admin_verification_status = ?,
            admin_verification_remarks = NULL
        WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'partial')
      `).bind(receiverStatus, userId, receivedRemarks, Number(data.receivedAmount), variance, adminVerificationStatus, handoverId, tenantId),
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
        VALUES (?, ?, ?, ?, 'cash_in', ?, 'cash', 'counter_handover', ?, ?, ?)
      `).bind(
        tenantId,
        existingSessionId,
        existingCounterId,
        userId,
        Number(data.receivedAmount),
        String(handoverId),
        `Cash handover received from session ${handover.counter_session_id}`,
        userId,
      ),
      ...(requiresApproval
        ? [c.env.DB.prepare(`
            INSERT INTO cash_variance_approvals
              (tenant_id, counter_session_id, variance, threshold, requested_by, handover_to, handover_amount, handover_due_amount, handover_total, handover_status, status, reason)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
          `).bind(
            tenantId,
            existingSessionId,
            variance,
            CASH_VARIANCE_APPROVAL_THRESHOLD,
            Number(userId),
            handover.handover_to,
            Number(handover.handover_amount ?? 0),
            Number(handover.due_amount ?? 0),
            expectedReceived,
            hasDispute ? 'disputed' : 'pending',
            hasDispute ? data.disputeReason?.trim() || 'Handover variance above threshold' : 'Handover variance above threshold',
          )]
        : []),
    ]);

    if ((batchResults[1]?.meta?.changes ?? 0) === 0) {
      throw new HTTPException(409, { message: 'Handover was already accepted.' });
    }

    await recordCashHandoverEvent(c, tenantId, `receive-${handoverId}`, userId, Number(data.receivedAmount), {
      handoverId,
      handoverBy: handover.handover_by,
      handoverTo: handover.handover_to,
      expectedReceived,
      receivedAmount: data.receivedAmount,
      variance,
      dispute: hasDispute,
      mode: 'added_to_existing_session',
      existingCounterSessionId: existingSessionId,
    });

    await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_handovers', handoverId, {
      status: handover.status,
      dueAmount: Number(handover.due_amount ?? 0),
    }, {
      status: receiverStatus,
      adminVerificationStatus,
      receivedBy: userId,
      expectedReceived,
      receivedAmount: data.receivedAmount,
      variance,
      dispute: hasDispute,
      mode: 'added_to_existing_session',
      existingCounterSessionId: existingSessionId,
      cashMovementType: 'cash_in',
    });

    return c.json({
      message: hasDispute ? 'Handover receiver verified with dispute; waiting admin final verification' : 'Handover received with no variance; admin approval not required',
      mode: 'added_to_existing_session',
      handoverId,
      counterSessionId: existingSessionId,
      status: receiverStatus,
      finalVerificationStatus: responseVerificationStatus,
      expectedReceived,
      receivedAmount: data.receivedAmount,
      variance,
      dispute: hasDispute,
    });
  }

  if (handoverPurpose === SHIFT_TRANSFER_PURPOSE && hasCounterShiftCapability(receiverPermissions, role)) {
    const activeCounter = await c.env.DB.prepare(`
      SELECT id, employee_id FROM billing_counter_sessions
      WHERE tenant_id = ? AND counter_id = ? AND status = 'active'
      LIMIT 1
    `).bind(tenantId, handover.counter_id).first<{ id: number; employee_id: number }>();
    if (activeCounter) {
      throw new HTTPException(409, { message: 'This billing counter is already active for another user.' });
    }

    const sessionNo = await getNextSequence(c.env.DB, tenantId, 'counter_session', 'BCS');
    const openingCash = Number(data.receivedAmount);
    const absVariance = Math.abs(variance);
    const requiresApproval = absVariance > CASH_VARIANCE_APPROVAL_THRESHOLD;
    const sessionRemarks = receivedRemarks ?? `Counter session opened from received handover ${handoverId}`;
    const autoSessionParams = {
      tenantId,
      counterId: Number(handover.counter_id),
      employeeId: userId,
      sessionNo,
      counterType: handover.counter_type ?? 'billing',
      openingCash,
      openingDenominations: null,
      remarks: sessionRemarks,
      workstationId,
    };

    const buildAutoOpenBatch = (includeWorkstation: boolean) => [
      receiverHandoverVerificationEventStatement(c.env.DB, {
        tenantId,
        handoverId,
        eventType: hasDispute ? 'receiver_disputed' : 'receiver_verified',
        actorUserId: userId,
        actorRole: role,
        countedAmount: openingCash,
        expectedAmount: expectedReceived,
        variance,
        decision: hasDispute ? 'dispute' : 'verify',
        remarks: receivedRemarks,
        workstationId,
      }),
      c.env.DB.prepare(`
        UPDATE billing_handovers
        SET status = ?,
            received_by = ?,
            received_at = datetime('now', '+6 hours'),
            received_remarks = ?,
            receiver_counted_amount = ?,
            receiver_variance = ?,
            admin_verification_status = ?,
            admin_verification_remarks = NULL
        WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'partial')
      `).bind(receiverStatus, userId, receivedRemarks, openingCash, variance, adminVerificationStatus, handoverId, tenantId),
      insertCounterSessionStatement(c.env.DB, autoSessionParams, includeWorkstation),
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
        SELECT ?, s.id, ?, ?, 'opening', ?, 'cash', 'counter_handover', ?, ?, ?
        FROM billing_counter_sessions s
        WHERE s.tenant_id = ? AND s.session_no = ?
      `).bind(
        tenantId,
        Number(handover.counter_id),
        userId,
        openingCash,
        String(handoverId),
        `Counter session ${sessionNo} opened from received handover ${handover.counter_session_id}`,
        userId,
        tenantId,
        sessionNo,
      ),
      ...(requiresApproval
        ? [c.env.DB.prepare(`
            INSERT INTO cash_variance_approvals
              (tenant_id, counter_session_id, variance, threshold, requested_by, handover_to, handover_amount, handover_due_amount, handover_total, handover_status, status, reason)
            SELECT ?, s.id, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?
            FROM billing_counter_sessions s
            WHERE s.tenant_id = ? AND s.session_no = ?
          `).bind(
            tenantId,
            variance,
            CASH_VARIANCE_APPROVAL_THRESHOLD,
            Number(userId),
            handover.handover_to,
            Number(handover.handover_amount ?? 0),
            Number(handover.due_amount ?? 0),
            expectedReceived,
            hasDispute ? 'disputed' : 'pending',
            hasDispute ? data.disputeReason?.trim() || 'Handover variance above threshold' : 'Handover variance above threshold',
            tenantId,
            sessionNo,
          )]
        : []),
    ];

    const batchResults = await batchWithLegacyWorkstationFallback(
      c.env.DB,
      () => buildAutoOpenBatch(true),
      () => buildAutoOpenBatch(false),
    );

    if ((batchResults[1]?.meta?.changes ?? 0) === 0) {
      throw new HTTPException(409, { message: 'Handover was already accepted.' });
    }

    let newSessionId = Number(batchResults[2]?.meta?.last_row_id);
    if (!Number.isFinite(newSessionId) || newSessionId <= 0) {
      const createdSession = await c.env.DB.prepare(`
        SELECT id FROM billing_counter_sessions
        WHERE tenant_id = ? AND session_no = ?
      `).bind(tenantId, sessionNo).first<{ id: number }>();
      newSessionId = Number(createdSession?.id);
    }
    if (!Number.isFinite(newSessionId) || newSessionId <= 0) {
      throw new HTTPException(500, { message: 'Billing counter session was not created from handover' });
    }

    await recordCashHandoverEvent(c, tenantId, `receive-${handoverId}`, userId, openingCash, {
      handoverId,
      handoverBy: handover.handover_by,
      handoverTo: handover.handover_to,
      expectedReceived,
      receivedAmount: data.receivedAmount,
      variance,
      dispute: hasDispute,
      mode: 'started_new_session',
      counterSessionId: newSessionId,
    });

    await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_handovers', handoverId, {
      status: handover.status,
      dueAmount: Number(handover.due_amount ?? 0),
    }, {
      status: receiverStatus,
      adminVerificationStatus,
      receivedBy: userId,
      expectedReceived,
      receivedAmount: data.receivedAmount,
      variance,
      dispute: hasDispute,
      mode: 'started_new_session',
      counterSessionId: newSessionId,
      sessionNo,
      cashMovementType: 'opening',
    });

    return c.json({
      message: hasDispute ? 'Handover received and shift started with dispute; waiting admin final verification' : 'Handover received and shift started with no variance; admin approval not required',
      mode: 'started_new_session',
      handoverId,
      counterSessionId: newSessionId,
      status: receiverStatus,
      finalVerificationStatus: responseVerificationStatus,
      expectedReceived,
      receivedAmount: data.receivedAmount,
      variance,
      dispute: hasDispute,
      session: {
        id: newSessionId,
        sessionNo,
        counterId: Number(handover.counter_id),
        counterName: handover.counter_name,
        counterCode: handover.counter_code,
        counterType: handover.counter_type ?? 'billing',
        openingCash,
      },
    });
  }

  const batchResults = await c.env.DB.batch([
    receiverHandoverVerificationEventStatement(c.env.DB, {
      tenantId,
      handoverId,
      eventType: hasDispute ? 'receiver_disputed' : 'receiver_verified',
      actorUserId: userId,
      actorRole: role,
      countedAmount: Number(data.receivedAmount),
      expectedAmount: expectedReceived,
      variance,
      decision: hasDispute ? 'dispute' : 'verify',
      remarks: receivedRemarks,
      workstationId,
    }),
    c.env.DB.prepare(`
      UPDATE billing_handovers
      SET status = ?,
          received_by = ?,
          received_at = datetime('now', '+6 hours'),
          received_remarks = ?,
          receiver_counted_amount = ?,
          receiver_variance = ?,
          admin_verification_status = ?,
          admin_verification_remarks = NULL
      WHERE id = ? AND tenant_id = ? AND status IN ('pending', 'partial')
    `).bind(receiverStatus, userId, receivedRemarks, Number(data.receivedAmount), variance, adminVerificationStatus, handoverId, tenantId),
  ]);

  if ((batchResults[1]?.meta?.changes ?? 0) === 0) {
    throw new HTTPException(409, { message: 'Handover was already accepted.' });
  }

  await recordCashHandoverEvent(c, tenantId, `receive-${handoverId}`, userId, Number(data.receivedAmount), {
    handoverId,
    handoverBy: handover.handover_by,
    handoverTo: handover.handover_to,
    expectedReceived,
    receivedAmount: data.receivedAmount,
    variance,
    dispute: hasDispute,
    mode: 'received_without_session',
  });

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_handovers', handoverId, {
    status: handover.status,
    dueAmount: Number(handover.due_amount ?? 0),
  }, {
    status: receiverStatus,
    adminVerificationStatus,
    receivedBy: userId,
    expectedReceived,
    receivedAmount: data.receivedAmount,
    variance,
    dispute: hasDispute,
    mode: 'received_without_session',
  });

  return c.json({
    message: hasDispute ? 'Handover receiver verified with dispute; waiting admin final verification' : 'Handover received with no variance; admin approval not required',
    mode: 'received_without_session',
    handoverId,
    status: receiverStatus,
    finalVerificationStatus: responseVerificationStatus,
    expectedReceived,
    receivedAmount: data.receivedAmount,
    variance,
    dispute: hasDispute,
  });

});

billingCounterRoutes.on(['POST', 'PUT'], '/handovers/:handoverId/admin-verify', zValidator('json', z.object({
  decision: z.enum(['approve', 'reject']),
  remarks: z.string().trim().max(500).optional(),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const adminUserId = requireUserId(c);
  const role = c.get('role');
  const handoverId = Number(c.req.param('handoverId'));
  const data = c.req.valid('json');

  if (!isRoleAllowed(role, CASH_HANDOVER_ADMIN_VERIFICATION_ROLES)) {
    throw new HTTPException(403, { message: 'Admin final verification requires hospital admin, MD, director, or accountant role' });
  }
  if (!Number.isInteger(handoverId) || handoverId <= 0) {
    throw new HTTPException(400, { message: 'Invalid handover ID' });
  }

  const handover = await c.env.DB.prepare(`
    SELECT id, handover_amount, due_amount, status, handover_by, handover_to, received_by, receiver_counted_amount, receiver_variance, admin_verification_status
    FROM billing_handovers
    WHERE tenant_id = ? AND id = ? AND handover_type = 'counter'
    LIMIT 1
  `).bind(tenantId, handoverId).first<{
    id: number;
    handover_amount: number;
    due_amount: number | null;
    status: string;
    handover_by: number;
    handover_to: number | null;
    received_by: number | null;
    receiver_counted_amount: number | null;
    receiver_variance: number | null;
    admin_verification_status: string | null;
  }>();

  if (!handover) {
    throw new HTTPException(404, { message: 'Handover not found' });
  }
  if (!['receiver_verified', 'disputed'].includes(String(handover.status))) {
    throw new HTTPException(409, { message: `Handover must be receiver verified before admin final verification. Current status: ${handover.status}` });
  }
  if ((handover.admin_verification_status ?? HANDOVER_ADMIN_VERIFICATION_PENDING) !== HANDOVER_ADMIN_VERIFICATION_PENDING) {
    throw new HTTPException(409, { message: `Handover admin verification already ${handover.admin_verification_status}` });
  }

  const adminId = Number(adminUserId);
  const custodyActorIds = [handover.handover_by, handover.handover_to, handover.received_by]
    .filter((id): id is number => id !== null && id !== undefined)
    .map(Number);
  if (custodyActorIds.includes(adminId)) {
    throw new HTTPException(403, { message: 'Separation of duties: the cash sender or receiver cannot approve their own handover' });
  }

  const expectedReceivedAmount = Math.max(0, Number(handover.handover_amount ?? 0) - Number(handover.due_amount ?? 0));
  const receiverCountedAmount = Number(handover.receiver_counted_amount ?? expectedReceivedAmount);
  const receiverVariance = handover.receiver_counted_amount !== null && handover.receiver_counted_amount !== undefined
    ? Math.round((receiverCountedAmount - expectedReceivedAmount) * 100) / 100
    : Math.round(Number(handover.receiver_variance ?? 0) * 100) / 100;
  const requiresAdminDecision = String(handover.status) === 'disputed' || receiverVariance !== 0;
  if (!requiresAdminDecision) {
    throw new HTTPException(409, { message: 'Cash handover has no variance or dispute; admin approval is not required' });
  }

  const approved = data.decision === 'approve';
  let approvalDecision: Awaited<ReturnType<typeof recordSourceApprovalDecision>> | null = null;

  if (approved) {
    try {
      approvalDecision = await recordSourceApprovalDecision(c.env.DB, {
        tenantId,
        approvalSource: 'billing_handovers',
        approvalRequestId: handoverId,
        requesterId: Number(handover.handover_by ?? 0),
        subjectStatus: 'pending',
        actorId: adminId,
        actorRole: String(role ?? ''),
        notes: data.remarks ?? null,
      });
    } catch (error) {
      if (error instanceof ApprovalPolicyError) {
        const status = error.code === 'SELF_APPROVAL_BLOCKED' || error.code === 'UNAUTHORIZED_APPROVER'
          ? 403
          : error.code === 'APPROVAL_NOT_FOUND'
            ? 404
            : 409;
        throw new HTTPException(status, { message: error.message });
      }
      throw error;
    }

    if (!approvalDecision.becameFullyApproved) {
      await createAuditLog(c.env, tenantId, adminUserId, 'APPROVE', 'billing_handovers', handoverId, {
        status: handover.status,
        adminVerificationStatus: handover.admin_verification_status,
        receiverCountedAmount,
        receiverVariance,
      }, {
        status: approvalDecision.status,
        adminVerificationStatus: HANDOVER_ADMIN_VERIFICATION_PENDING,
        approvalCount: approvalDecision.approvalCount,
        requiredApprovals: approvalDecision.requiredApprovals,
        remainingApprovals: approvalDecision.remainingApprovals,
        decisionId: approvalDecision.decisionId,
        remarks: data.remarks ?? null,
      });

      return c.json({
        message: `Handover approval recorded (${approvalDecision.approvalCount}/${approvalDecision.requiredApprovals}). One more distinct approver is required.`,
        handoverId,
        status: approvalDecision.status,
        finalVerificationStatus: HANDOVER_ADMIN_VERIFICATION_PENDING,
        adminVerifiedBy: null,
        receiverCountedAmount,
        receiverVariance,
        decision: data.decision,
        approvalCount: approvalDecision.approvalCount,
        requiredApprovals: approvalDecision.requiredApprovals,
        remainingApprovals: approvalDecision.remainingApprovals,
        approvalStage: approvalDecision.label,
      });
    }
  }

  const finalStatus = approved ? 'received' : 'pending';
  const finalVerificationStatus = approved ? HANDOVER_ADMIN_VERIFICATION_VERIFIED : 'rejected';

  const adminBatchResults = await c.env.DB.batch([
    adminHandoverVerificationEventStatement(c.env.DB, {
      tenantId,
      handoverId,
      eventType: approved ? 'admin_final_verification' : 'admin_rejected',
      actorUserId: adminUserId,
      actorRole: String(role ?? ''),
      countedAmount: receiverCountedAmount,
      expectedAmount: expectedReceivedAmount,
      variance: receiverVariance,
      decision: data.decision,
      remarks: data.remarks ?? null,
    }),
    c.env.DB.prepare(`
      UPDATE billing_handovers
      SET status = ?,
          admin_verification_status = ?,
          admin_verified_by = ?,
          admin_verified_at = datetime('now', '+6 hours'),
          admin_verification_remarks = COALESCE(?, admin_verification_remarks),
          due_amount = CASE WHEN ? THEN 0 ELSE due_amount END
      WHERE tenant_id = ?
        AND id = ?
        AND status IN ('receiver_verified', 'disputed')
        AND COALESCE(admin_verification_status, ?) = ?
    `).bind(
      finalStatus,
      finalVerificationStatus,
      Number(adminUserId),
      data.remarks ?? null,
      approved ? 1 : 0,
      tenantId,
      handoverId,
      HANDOVER_ADMIN_VERIFICATION_PENDING,
      HANDOVER_ADMIN_VERIFICATION_PENDING,
    ),
  ]);

  const updateResult = adminBatchResults[1];
  if (Number(updateResult?.meta?.changes ?? 0) !== 1) {
    throw new HTTPException(409, { message: 'Handover admin verification was already updated. Please refresh.' });
  }

  await createAuditLog(c.env, tenantId, adminUserId, approved ? 'APPROVE' : 'REJECT', 'billing_handovers', handoverId, {
    status: handover.status,
    adminVerificationStatus: handover.admin_verification_status,
    receiverCountedAmount,
    receiverVariance,
  }, {
    status: finalStatus,
    adminVerificationStatus: finalVerificationStatus,
    adminVerifiedBy: Number(adminUserId),
    decision: data.decision,
    remarks: data.remarks ?? null,
    approvalCount: approvalDecision?.approvalCount ?? null,
    requiredApprovals: approvalDecision?.requiredApprovals ?? null,
    remainingApprovals: approvalDecision?.remainingApprovals ?? null,
    decisionId: approvalDecision?.decisionId ?? null,
  });

  return c.json({
    message: approved ? 'Handover admin final verification completed' : 'Handover rejected for receiver recount',
    handoverId,
    status: finalStatus,
    finalVerificationStatus,
    adminVerifiedBy: Number(adminUserId),
    receiverCountedAmount,
    receiverVariance,
    decision: data.decision,
    approvalCount: approvalDecision?.approvalCount,
    requiredApprovals: approvalDecision?.requiredApprovals,
    remainingApprovals: approvalDecision?.remainingApprovals,
    approvalStage: approvalDecision?.label,
  });
});

billingCounterRoutes.get('/sessions/active', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!session) return c.json({ active: false, session: null });

  const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, Number(session.id));

  const cashVisibilityMode = await getCounterCashVisibilityMode(c.env.DB, tenantId, Number(session.counter_id));
  const isBlindClose = cashVisibilityMode === 'blind_close';

  const sessionData: Record<string, unknown> = {
    id: Number(session.id),
    counterId: Number(session.counter_id),
    counterName: session.counter_name,
    counterCode: session.counter_code,
    counterType: session.counter_type,
    openingCash: Number(session.opening_cash ?? 0),
    openedAt: session.opened_at,
    cashVisibilityMode,
  };

  if (isBlindClose) {
    // Blind mode: do NOT reveal expectedCash, cashIn, or cashOut to cashier
    sessionData.expectedCashHidden = true;
  } else {
    // Normal mode: show everything
    Object.assign(sessionData, summary);
    sessionData.expectedCashHidden = false;
  }

  return c.json({ active: true, session: sessionData });
});

// List ALL active counter sessions (so cashier can see who has which counter)
billingCounterRoutes.get('/sessions/active-all', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const { results } = await c.env.DB.prepare(`
    SELECT s.id, s.session_no, s.employee_id, s.opening_cash, s.opened_at,
           u.name as cashier_name, u.role as cashier_role,
           bc.counter_name, bc.counter_code, bc.counter_type
    FROM billing_counter_sessions s
    JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
    LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = s.tenant_id
    WHERE s.tenant_id = ? AND s.status = 'active'
    ORDER BY s.opened_at DESC
  `).bind(tenantId).all();
  return c.json({ sessions: results ?? [] });
});

// List all counters with their active session info (for counter status dropdown)
billingCounterRoutes.get('/sessions/all-with-counters', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);

  const { results } = await c.env.DB.prepare(`
    SELECT
      bc.id,
      bc.counter_name,
      bc.counter_code,
      bc.counter_type,
      bc.location,
      bc.is_active,
      s.id AS session_id,
      s.employee_id,
      s.opening_cash,
      s.expected_cash,
      s.opened_at,
      s.session_no,
      u.name AS cashier_name,
      u.role AS cashier_role
    FROM billing_counters bc
    LEFT JOIN billing_counter_sessions s
      ON s.counter_id = bc.id
     AND s.tenant_id = bc.tenant_id
     AND s.status = 'active'
    LEFT JOIN users u
      ON u.id = s.employee_id
     AND u.tenant_id = s.tenant_id
    WHERE bc.tenant_id = ?
      AND (bc.is_active = 1 OR bc.is_active IS NULL)
    ORDER BY bc.counter_name ASC
  `).bind(tenantId).all<{
    id: number;
    counter_name: string;
    counter_code: string | null;
    counter_type: string | null;
    location: string | null;
    is_active: number | null;
    session_id: number | null;
    employee_id: number | null;
    opening_cash: number | null;
    expected_cash: number | null;
    opened_at: string | null;
    session_no: string | null;
    cashier_name: string | null;
    cashier_role: string | null;
  }>();

  const counters = await Promise.all((results ?? []).map(async (row) => {
    const hasSession = row.session_id != null;
    const expectedCash = hasSession
      ? (await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, Number(row.session_id))).expectedCash
      : Number(row.expected_cash ?? 0);

    return {
      id: Number(row.id),
      counter_name: row.counter_name,
      counter_code: row.counter_code,
      counter_type: row.counter_type,
      location: row.location,
      active_session: hasSession ? {
        id: Number(row.session_id),
        employee_id: Number(row.employee_id),
        employee_name: row.cashier_name,
        employee_role: row.cashier_role,
        opening_cash: Number(row.opening_cash ?? 0),
        expected_cash: expectedCash,
        opened_at: row.opened_at,
        session_no: row.session_no,
      } : null,
    };
  }));

  return c.json({ counters });
});

// Force take-over an active counter session
billingCounterRoutes.post('/sessions/:id/take-over', requirePermission('billing.counter.takeover'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const targetSessionId = Number(c.req.param('id'));
  if (!Number.isInteger(targetSessionId) || targetSessionId <= 0) {
    throw new HTTPException(400, { message: 'Invalid session ID' });
  }
  const workstationId = getBillingWorkstationId(c);
  if (!workstationId) {
    throw new HTTPException(400, { message: 'Workstation identity is required before taking over a counter.' });
  }

  // 1. Load the target session
  const targetSession = await c.env.DB.prepare(`
    SELECT s.id, s.counter_id, s.employee_id, s.opening_cash, s.status, s.session_no,
           s.counter_type, bc.counter_name, bc.counter_code,
           u.name AS cashier_name
    FROM billing_counter_sessions s
    JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = s.tenant_id
    LEFT JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
    WHERE s.tenant_id = ? AND s.id = ? AND s.status = 'active'
  `).bind(tenantId, targetSessionId).first<{
    id: number;
    counter_id: number;
    employee_id: number;
    opening_cash: number;
    status: string;
    session_no: string;
    counter_type: string;
    counter_name: string;
    counter_code: string | null;
    cashier_name: string | null;
  }>();

  if (!targetSession) {
    throw new HTTPException(404, { message: 'Active counter session not found' });
  }

  // 2. Cannot take over own session
  if (String(targetSession.employee_id) === userId) {
    throw new HTTPException(409, { message: 'Cannot take over your own counter session' });
  }

  // 3. Calculate expected cash from the target session
  const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, targetSessionId);
  const handoverAmount = summary.expectedCash;

  // 4. Check if current user already has an active session
  const existingSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, String(userId), {
    workstationId,
    requireCurrentWorkstation: true,
  });
  if (existingSession) {
    throw new HTTPException(409, {
      message: `You already have an active session on ${existingSession.counter_name}. Close it first before taking over another counter.`,
    });
  }

  // 5. Validate handover amount
  if (handoverAmount < 0) {
    throw new HTTPException(400, { message: 'Counter has negative cash balance. Cannot take over.' });
  }

  // 6. Generate new session number
  const sessionNo = await getNextSequence(c.env.DB, tenantId, 'counter_session', 'BCS');

  // 7. Execute take-over as a batch (all-or-nothing)
  let batchResults: D1Result[];
  try {
    const takeOverSessionParams = {
      tenantId,
      counterId: Number(targetSession.counter_id),
      employeeId: userId,
      sessionNo,
      counterType: targetSession.counter_type ?? 'billing',
      openingCash: handoverAmount,
      openingDenominations: null,
      remarks: `Take-over from ${targetSession.cashier_name ?? 'previous user'} (session ${targetSession.session_no})`,
      workstationId,
    };
    const buildTakeOverBatch = (includeWorkstation: boolean) => [
      // a) Close the target session
      c.env.DB.prepare(`
        UPDATE billing_counter_sessions
        SET status = 'closed',
            closing_cash_declared = ?,
            expected_cash = ?,
            variance = 0,
            closed_at = datetime('now', '+6 hours'),
            closed_by = ?,
            remarks = 'Force take-over by another user',
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ? AND id = ? AND status = 'active'
      `).bind(handoverAmount, handoverAmount, userId, tenantId, targetSessionId),

      // b) Create handover record (auto-received)
      c.env.DB.prepare(`
        INSERT INTO billing_handovers
          (tenant_id, counter_session_id, handover_type, handover_purpose, handover_by, handover_to, handover_amount, due_amount, status, received_by, received_at, remarks)
        VALUES (?, ?, 'counter', 'shift_transfer', ?, ?, ?, 0, 'received', ?, datetime('now', '+6 hours'), 'Force take-over')
      `).bind(tenantId, targetSessionId, targetSession.employee_id, userId, handoverAmount, userId),

      // c) Cash drawer movement for handover
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
        VALUES (?, ?, ?, ?, 'handover', ?, 'cash', 'Force take-over handover', ?)
      `).bind(tenantId, targetSessionId, targetSession.counter_id, targetSession.employee_id, handoverAmount, userId),

      // d) Create new session for current user
      insertCounterSessionStatement(c.env.DB, takeOverSessionParams, includeWorkstation),

      // e) Opening cash movement for new session (via subquery)
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
        SELECT ?, s.id, ?, ?, 'opening', ?, 'cash', ?, ?
        FROM billing_counter_sessions s
        WHERE s.tenant_id = ? AND s.session_no = ?
      `).bind(
        tenantId,
        targetSession.counter_id,
        userId,
        handoverAmount,
        `Counter opened via take-over from session ${targetSession.session_no}`,
        userId,
        tenantId,
        sessionNo,
      ),
    ];
    batchResults = await batchWithLegacyWorkstationFallback(
      c.env.DB,
      () => buildTakeOverBatch(true),
      () => buildTakeOverBatch(false),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) {
      throw new HTTPException(409, { message: 'Counter session conflict. Another take-over may have been in progress.' });
    }
    throw error;
  }

  // 8. Get the new session ID
  let newSessionId = Number(batchResults[3]?.meta?.last_row_id);
  if (!Number.isFinite(newSessionId) || newSessionId <= 0) {
    const createdSession = await c.env.DB.prepare(`
      SELECT id FROM billing_counter_sessions
      WHERE tenant_id = ? AND session_no = ?
    `).bind(tenantId, sessionNo).first<{ id: number }>();
    newSessionId = Number(createdSession?.id);
  }

  // 9. Record accounting event (opening movement is already in the batch)
  await recordCashHandoverEvent(c, tenantId, `takeover-${targetSessionId}`, String(userId), handoverAmount, {
    sourceSessionId: targetSessionId,
    newSessionId,
    counterId: targetSession.counter_id,
    handoverBy: targetSession.employee_id,
    handoverTo: userId,
    source: 'force_takeover',
  });

  // 10. Audit log
  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_counter_sessions', targetSessionId, {
    status: 'active',
    employee_id: targetSession.employee_id,
  }, {
    status: 'closed',
    reason: 'force_takeover',
    closed_by: userId,
    handoverAmount,
  });

  return c.json({
    message: 'Counter taken over successfully',
    session: {
      id: newSessionId,
      sessionNo,
      counterId: targetSession.counter_id,
      counterName: targetSession.counter_name,
      counterCode: targetSession.counter_code,
      counterType: targetSession.counter_type,
      openingCash: handoverAmount,
    },
    previousSession: {
      id: targetSessionId,
      employeeName: targetSession.cashier_name,
      handoverAmount,
    },
  }, 201);
});

billingCounterRoutes.post('/sessions/activate', zValidator('json', billingCounterActivateSchema), requirePermission('billing.counter.activate'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  const workstationId = getBillingWorkstationId(c);
  const existing = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId,
    requireCurrentWorkstation: true,
  });
  if (existing) {
    throw new HTTPException(409, { message: 'Close the active billing counter before activating another counter.' });
  }

  const counter = await c.env.DB.prepare(`
    SELECT id, counter_name, counter_code, counter_type
    FROM billing_counters
    WHERE tenant_id = ?
      AND id = ?
      AND (is_active = 1 OR is_active IS NULL)
      AND (counter_type IS NULL OR counter_type IN ('billing', 'pharmacy', 'opd', 'ipd', 'lab', 'emergency', 'general', 'other'))
  `).bind(tenantId, data.counterId).first<{
    id: number;
    counter_name: string;
    counter_code: string | null;
    counter_type: string;
  }>();
  if (!counter) throw new HTTPException(404, { message: 'Active billing counter not found' });

  const activeCounter = await c.env.DB.prepare(`
    SELECT s.id, s.employee_id, s.session_no, s.opened_at,
           u.name as cashier_name, u.role as cashier_role,
           bc.counter_name, bc.counter_code
    FROM billing_counter_sessions s
    JOIN users u ON u.id = s.employee_id AND u.tenant_id = s.tenant_id
    LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = s.tenant_id
    WHERE s.tenant_id = ?
      AND s.counter_id = ?
      AND s.status = 'active'
    LIMIT 1
  `).bind(tenantId, data.counterId).first<{
    id: number;
    employee_id: number;
    session_no: string;
    opened_at: string;
    cashier_name: string;
    cashier_role: string;
    counter_name: string;
    counter_code: string | null;
  }>();
  if (activeCounter) {
    throw new HTTPException(409, {
      message: `Counter "${activeCounter.counter_name}" is already open by ${activeCounter.cashier_name} (${activeCounter.cashier_role}) since ${activeCounter.opened_at}. Session: ${activeCounter.session_no}`,
    });
  }

  // Safety net: pre-fill opening_cash from the most recent accepted handover if the
  // cashier hits the activate endpoint with a default 0 (frontend bug or forgetfulness).
  // Industry best practice (Xenia, Retaildogma): the drawer always opens with the
  // physical cash that was actually received. A variance approval row is queued for
  // async supervisor review when the cashier's stated amount differs.
  const HANDOVER_PREFILL_WINDOW_MIN = 5;
  const recentHandover = await c.env.DB.prepare(`
    SELECT id, handover_amount, due_amount, status, handover_to, receiver_counted_amount
    FROM billing_handovers
    WHERE tenant_id = ?
      AND handover_to = ?
      AND handover_type = 'counter'
      AND status IN ('received', 'receiver_verified', 'disputed')
      AND received_at IS NOT NULL
      AND datetime(received_at) >= datetime('now', '+6 hours', '-' || ? || ' minutes')
    ORDER BY received_at DESC
    LIMIT 1
  `).bind(tenantId, String(userId), HANDOVER_PREFILL_WINDOW_MIN).first<{
    id: number;
    handover_amount: number;
    due_amount: number | null;
    status: string;
    handover_to: number | null;
    receiver_counted_amount: number | null;
  }>();

  const hasRemarks = Boolean(data.remarks?.trim());
  const openingCashRaw = Number(data.openingCash);
  let effectiveOpeningCash = openingCashRaw;
  let openingVarianceWarning: {
    handoverId: number;
    expected: number;
    received: number;
    variance: number;
    autoFilled: boolean;
  } | null = null;

  if (recentHandover) {
    const expectedFromHandover = Math.max(
      0,
      recentHandover.receiver_counted_amount == null
        ? Number(recentHandover.handover_amount ?? 0) - Number(recentHandover.due_amount ?? 0)
        : Number(recentHandover.receiver_counted_amount),
    );
    const looksLikeDefault = openingCashRaw === 0 && !hasRemarks;
    if (looksLikeDefault) {
      // Frontend sent 0 with no remarks — treat as a missed pre-fill and use the
      // physical handover amount. Session continues normally; nothing flagged.
      effectiveOpeningCash = expectedFromHandover;
    } else if (openingCashRaw !== expectedFromHandover) {
      // Cashier explicitly stated a different amount. Honour the cashier's value
      // (the shift continues), but queue an async variance approval for supervisor
      // review and surface a warning in the response.
      openingVarianceWarning = {
        handoverId: Number(recentHandover.id),
        expected: expectedFromHandover,
        received: openingCashRaw,
        variance: openingCashRaw - expectedFromHandover,
        autoFilled: false,
      };
    }
  }

  const sessionNo = await getNextSequence(c.env.DB, tenantId, 'counter_session', 'BCS');
  let batchResults: D1Result[];
  try {
    const activationSessionParams = {
      tenantId,
      counterId: data.counterId,
      employeeId: userId,
      sessionNo,
      counterType: counter.counter_type ?? 'billing',
      openingCash: effectiveOpeningCash,
      openingDenominations: data.openingDenominations ?? null,
      remarks: data.remarks ?? null,
      workstationId,
    };
    const buildActivationBatch = (includeWorkstation: boolean) => [
      insertCounterSessionStatement(c.env.DB, activationSessionParams, includeWorkstation),
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
        SELECT ?, s.id, ?, ?, 'opening', ?, 'cash', ?, ?
        FROM billing_counter_sessions s
        WHERE s.tenant_id = ? AND s.session_no = ?
      `).bind(
        tenantId,
        data.counterId,
        userId,
        effectiveOpeningCash,
        `Counter session ${sessionNo} opened`,
        userId,
        tenantId,
        sessionNo,
      ),
      ...(openingVarianceWarning
        ? [c.env.DB.prepare(`
            INSERT INTO cash_variance_approvals
              (tenant_id, counter_session_id, variance, threshold, requested_by, handover_to, handover_amount, handover_due_amount, handover_total, handover_status, status, reason)
            SELECT ?, s.id, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?
            FROM billing_counter_sessions s
            WHERE s.tenant_id = ? AND s.session_no = ?
          `).bind(
            tenantId,
            openingVarianceWarning.variance,
            CASH_VARIANCE_APPROVAL_THRESHOLD,
            Number(userId),
            Number(recentHandover?.handover_to ?? userId),
            Number(recentHandover?.handover_amount ?? openingVarianceWarning.expected),
            Number(recentHandover?.due_amount ?? 0),
            openingVarianceWarning.expected,
            'pending',
            `Activate opening cash ${openingVarianceWarning.received} differs from expected ${openingVarianceWarning.expected} (handover ${openingVarianceWarning.handoverId})`,
            tenantId,
            sessionNo,
          )]
        : []),
    ];
    batchResults = await batchWithLegacyWorkstationFallback(
      c.env.DB,
      () => buildActivationBatch(true),
      () => buildActivationBatch(false),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unique|constraint/i.test(message)) {
      throw new HTTPException(409, { message: 'Close the active billing counter session before activating another counter.' });
    }
    throw error;
  }

  let sessionId = Number(batchResults[0]?.meta?.last_row_id);
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    const createdSession = await c.env.DB.prepare(`
      SELECT id FROM billing_counter_sessions
      WHERE tenant_id = ? AND session_no = ?
    `).bind(tenantId, sessionNo).first<{ id: number }>();
    sessionId = Number(createdSession?.id);
  }
  if (!Number.isFinite(sessionId) || sessionId <= 0) {
    throw new HTTPException(500, { message: 'Billing counter session was not created' });
  }

  const releasedRefundReserveCredits = await creditPendingRefundReserveReleasesForSession(c.env.DB, {
    tenantId,
    custodyUserId: Number(userId),
    counterSessionId: sessionId,
    counterId: Number(data.counterId),
    createdBy: Number(userId),
  });
  if (releasedRefundReserveCredits > 0) {
    const creditedHolds = await loadRefundReserveReleaseCreditsForSession(c.env.DB, tenantId, sessionId);
    await Promise.all(creditedHolds.map((hold) => (
      shadowRefundReserveReleased(c.env.DB, tenantId, hold, Number(userId))
    )));
  }

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'billing_counter_sessions', sessionId, null, {
    sessionNo,
    counterId: data.counterId,
    openingCash: data.openingCash,
  });

  return c.json({
    message: 'Billing counter activated',
    releasedRefundReserveCredits,
    session: {
      id: sessionId,
      sessionNo,
      counterId: data.counterId,
      counterName: counter.counter_name,
      counterCode: counter.counter_code,
      counterType: counter.counter_type,
      openingCash: effectiveOpeningCash,
    },
    ...(openingVarianceWarning
      ? {
          openingVarianceWarning: {
            handoverId: openingVarianceWarning.handoverId,
            expected: openingVarianceWarning.expected,
            received: openingVarianceWarning.received,
            variance: openingVarianceWarning.variance,
            threshold: CASH_VARIANCE_APPROVAL_THRESHOLD,
            message: 'Opening cash differs from a recent handover. A variance approval row has been queued for supervisor review.',
          },
        }
      : {}),
  }, 201);
});

billingCounterRoutes.post('/sessions/:id/close', zValidator('json', billingCounterCloseSchema), requirePermission('billing.counter.close'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new HTTPException(400, { message: 'Invalid counter session' });
  const data = c.req.valid('json');
  const closingCash = roundAmount(data.closingCash);
  const handoverAmount = roundAmount(data.handoverAmount ?? closingCash);
  if (handoverAmount > closingCash) {
    throw new HTTPException(400, { message: 'Handover amount cannot exceed declared closing cash.' });
  }
  const handoverTotal = closingCash;
  const handoverDueAmount = roundAmount(Math.max(0, closingCash - handoverAmount));
  const handoverStatus = handoverDueAmount > 0 ? 'partial' : 'pending';
  const handoverRecipientId = data.handoverTo ?? null;
  const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!session || Number(session.id) !== sessionId) {
    throw new HTTPException(404, { message: 'Active billing counter session not found for this workstation' });
  }

  const activeRefundHolds = await c.env.DB.prepare(`
    SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
    FROM billing_refund_cash_holds
    WHERE tenant_id = ? AND counter_session_id = ? AND status = 'held'
  `).bind(tenantId, sessionId).first<{ count?: number | null; amount?: number | null }>();
  const heldRefundCash = Number(activeRefundHolds?.amount ?? 0);
  const requiresHandoverRecipient = handoverTotal > 0 || handoverAmount > 0;
  if (requiresHandoverRecipient && !handoverRecipientId) {
    throw new HTTPException(400, { message: 'Cash handover recipient is required before closing the counter.' });
  }

  const cashVisibilityMode = await getCounterCashVisibilityMode(c.env.DB, tenantId, Number(session.counter_id));
  const isBlindClose = cashVisibilityMode === 'blind_close';

  const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, sessionId);
  const availableCash = roundAmount(summary.expectedCash - heldRefundCash);
  const variance = roundAmount(closingCash - availableCash);
  const closingDenominations = stringifyDenominations(data.closingDenominations ?? null);
  const nonCashSettlementJson = data.nonCashSettlements ? JSON.stringify(data.nonCashSettlements) : null;
  const nonCashRemarks = data.nonCashRemarks?.trim() || null;
  const remarks = data.remarks?.trim() ?? '';
  // In blind close mode, skip variance-based remarks requirement
  if (variance !== 0 && remarks.length === 0 && !isBlindClose) {
    throw new HTTPException(400, { message: 'Closing variance requires shortage/excess remarks.' });
  }
  let handoverPurpose: HandoverPurpose = data.handoverPurpose === MANAGEMENT_COLLECTION_PURPOSE
    ? MANAGEMENT_COLLECTION_PURPOSE
    : data.handoverPurpose === SHIFT_TRANSFER_PURPOSE
      ? SHIFT_TRANSFER_PURPOSE
      : SHIFT_TRANSFER_PURPOSE;
  if (handoverRecipientId) {
    const recipient = await c.env.DB.prepare(`
      SELECT id, role
      FROM users
      WHERE tenant_id = ?
        AND id = ?
        AND role IN ('hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist', 'manager')
      LIMIT 1
    `).bind(tenantId, handoverRecipientId).first<{ id: number; role: string }>();
    if (!recipient) {
      throw new HTTPException(400, { message: 'Cash handover recipient must be an active reception or finance/admin user.' });
    }
    const recipientRole = String(recipient.role ?? '');
    const recipientPermissions = await resolveTenantUserPermissions(c.env.DB, tenantId, recipient.id, recipientRole);
    handoverPurpose = data.handoverPurpose ? handoverPurpose : inferHandoverPurpose(recipientRole, recipientPermissions);
    if (handoverPurpose === SHIFT_TRANSFER_PURPOSE && !hasCounterShiftCapability(recipientPermissions, recipientRole)) {
      throw new HTTPException(400, { message: 'Selected recipient cannot receive a reception shift handover.' });
    }
    if (handoverPurpose === MANAGEMENT_COLLECTION_PURPOSE && !hasManagementCashCapability(recipientPermissions, recipientRole)) {
      throw new HTTPException(400, { message: 'Selected recipient cannot receive management cash collection.' });
    }
  }

  // Phase 6 hardening: variance approval gate. If the absolute variance
  // exceeds the supervisor threshold we must not mark the session
  // 'closed' yet; we move it to 'pending' approval and create a row in
  // cash_variance_approvals. The session is hidden from the cashier
  // until the approver acts.
  const absVariance = Math.abs(variance);
  const requiresApproval = absVariance > CASH_VARIANCE_APPROVAL_THRESHOLD;
  const approvalStatus = requiresApproval ? 'pending' : 'approved';
  const newStatus = requiresApproval ? 'active' : 'closed';
  const approverUserId = requiresApproval ? null : Number(userId);

  const closeStatements = [
    c.env.DB.prepare(`
      UPDATE billing_counter_sessions
      SET status = ?,
          closing_cash_declared = ?,
          expected_cash = ?,
          variance = ?,
          refund_reserve_at_close = ?,
          available_cash_at_close = ?,
          total_physical_cash_at_close = ?,
          closing_denominations = ?,
          non_cash_settlement_json = ?,
          non_cash_remarks = ?,
          closed_at = CASE WHEN ? = 'closed' THEN datetime('now', '+6 hours') ELSE closed_at END,
          closed_by = CASE WHEN ? = 'closed' THEN ? ELSE closed_by END,
          approver_user_id = ?,
          variance_approval_required = ?,
          variance_approval_status = ?,
          variance_approval_at = CASE WHEN ? = 'approved' THEN datetime('now', '+6 hours') ELSE NULL END,
          remarks = COALESCE(?, remarks),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND id = ? AND status = 'active'
    `).bind(
      newStatus, closingCash, roundAmount(summary.expectedCash), variance,
      heldRefundCash, availableCash, roundAmount(closingCash + heldRefundCash),
      closingDenominations,
      nonCashSettlementJson,
      nonCashRemarks,
      newStatus, newStatus, userId,
      approverUserId,
      requiresApproval ? 1 : 0,
      approvalStatus,
      approvalStatus,
      remarks || null, tenantId, sessionId,
    ),
    c.env.DB.prepare(`
      INSERT INTO cash_variance_approvals
        (tenant_id, counter_session_id, variance, threshold, requested_by, status, reason,
         handover_to, handover_amount, handover_due_amount, handover_total, handover_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      sessionId,
      variance,
      CASH_VARIANCE_APPROVAL_THRESHOLD,
      Number(userId),
      approvalStatus,
      remarks || null,
      handoverRecipientId,
      handoverAmount,
      handoverDueAmount,
      handoverTotal,
      handoverStatus,
    ),
  ];

  if (!requiresApproval) {
    closeStatements.push(
      // Record handover as cash_drawer_movement
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
        VALUES (?, ?, ?, ?, 'handover', ?, 'cash', ?, ?)
      `).bind(tenantId, sessionId, session.counter_id, userId, handoverAmount, remarks || 'Counter closed - handover', userId),
      // Create billing_handovers record for admin collection tracking
      c.env.DB.prepare(`
      INSERT INTO billing_handovers
        (tenant_id, counter_session_id, handover_type, handover_purpose, handover_by, handover_to, handover_amount, due_amount, status, remarks)
      VALUES (?, ?, 'counter', ?, ?, ?, ?, ?, ?, ?)
      `).bind(tenantId, sessionId, handoverPurpose, userId, handoverRecipientId, handoverTotal, handoverDueAmount, handoverStatus, remarks || 'Counter session closed'),
    );
    if (heldRefundCash > 0) { // Held refund custody survives counter closure.
      closeStatements.push(c.env.DB.prepare(`
        UPDATE billing_refund_cash_holds
        SET custody_user_id = COALESCE(?, employee_id),
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND counter_session_id = ?
          AND status = 'held'
      `).bind(handoverRecipientId, tenantId, sessionId));
    }
  }

  await c.env.DB.batch(closeStatements);

  if (!requiresApproval) {
    if (heldRefundCash > 0 && handoverRecipientId) {
      const custodyHolds = await loadHeldRefundCashHoldsForSession(c.env.DB, tenantId, sessionId);
      await Promise.all(custodyHolds.map((hold) => (
        shadowRefundReserveCustodyTransfer(
          c.env.DB,
          tenantId,
          hold,
          Number(handoverRecipientId),
          Number(userId),
        )
      )));
    }
    await recordCashHandoverEvent(c, tenantId, `counter-close-${sessionId}`, userId, handoverAmount, {
      counterSessionId: sessionId,
      counterId: session.counter_id,
      handoverBy: userId,
      handoverTo: handoverRecipientId,
      handoverTotal,
      handoverDueAmount,
      source: 'counter_close',
    });
  }

  void createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_counter_sessions', sessionId, {
    status: 'active',
    openingCash: session.opening_cash,
  }, {
    status: newStatus,
    closingCash,
    expectedCash: summary.expectedCash,
    variance,
    heldRefundCash,
    availableCash,
    totalPhysicalCashUnderCustody: roundAmount(closingCash + heldRefundCash),
    handoverAmount,
    handoverTotal,
    handoverDueAmount,
    handoverStatus,
    handoverTo: handoverRecipientId,
    varianceApprovalStatus: approvalStatus,
  });

  const responseBody: Record<string, unknown> = {
    message: requiresApproval
      ? 'Counter close parked: cash variance requires supervisor approval'
      : 'Billing counter closed',
    sessionId,
    closingCash,
    heldRefundCash,
    availableCash,
    totalPhysicalCashUnderCustody: roundAmount(closingCash + heldRefundCash),
    handoverAmount,
    handoverTotal,
    handoverDueAmount,
    handoverStatus,
    handoverCreated: !requiresApproval,
    blindClose: isBlindClose,
    varianceApprovalRequired: requiresApproval,
    varianceApprovalStatus: approvalStatus,
    varianceThreshold: CASH_VARIANCE_APPROVAL_THRESHOLD,
    nonCashSettlementSaved: Boolean(nonCashSettlementJson),
    settlementNoteSaved: Boolean(nonCashRemarks),
  };
  // Only include expectedCash/variance when NOT blind close
  if (!isBlindClose) {
    responseBody.expectedCash = summary.expectedCash;
    responseBody.variance = variance;
  }
  return c.json(responseBody, requiresApproval ? 202 : 200);
});

/**
 * Supervisor approval for a cash variance that exceeded
 * CASH_VARIANCE_APPROVAL_THRESHOLD. The route is intentionally narrow:
 * only the four fields are mutated, and the approver must hold either
 * the `billing.counter.variance.approve` permission or a supervisor
 * role. Idempotent: re-approving an already-approved session is a no-op.
 */
billingCounterRoutes.post('/sessions/:id/variance-approvals', zValidator('json', z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).optional(),
})), requirePermission('billing.counter.variance.approve'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const sessionId = Number(c.req.param('id'));
  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    throw new HTTPException(400, { message: 'Invalid session id' });
  }
  const data = c.req.valid('json');

  const session = await c.env.DB.prepare(`
    SELECT id, status, counter_id, employee_id, variance, variance_approval_required, variance_approval_status
    FROM billing_counter_sessions
    WHERE tenant_id = ? AND id = ? LIMIT 1
  `).bind(tenantId, sessionId).first<{
    id: number;
    status: string;
    counter_id: number | null;
    employee_id: number;
    variance: number | null;
    variance_approval_required: number | null;
    variance_approval_status: string | null;
  }>();
  if (!session) throw new HTTPException(404, { message: 'Counter session not found' });
  if (!session.variance_approval_required) {
    throw new HTTPException(409, { message: 'This session did not require variance approval' });
  }
  if (session.variance_approval_status === 'approved') {
    return c.json({ message: 'Variance already approved', sessionId, status: session.status }, 200);
  }
  if (session.variance_approval_status === 'rejected') {
    throw new HTTPException(409, { message: 'Variance was already rejected' });
  }

  const approverUserId = userId;
  const decision = data.decision;
  const newStatus = decision === 'approve' ? 'closed' : 'active';
  const approvedAt = decision === 'approve' ? new Date().toISOString() : null;

  const approval = await c.env.DB.prepare(`
    SELECT id, requested_by, handover_to, handover_amount, handover_due_amount, handover_total, handover_status, reason
    FROM cash_variance_approvals
    WHERE tenant_id = ? AND counter_session_id = ? AND status = 'pending'
    ORDER BY id DESC
    LIMIT 1
  `).bind(tenantId, sessionId).first<{
    id: number;
    requested_by: number;
    handover_to: number | null;
    handover_amount: number | null;
    handover_due_amount: number | null;
    handover_total: number | null;
    handover_status: string | null;
    reason: string | null;
  }>();
  if (!approval) {
    throw new HTTPException(409, { message: 'Pending variance approval was not found' });
  }

  const pendingHandoverAmount = Number(approval.handover_amount ?? 0);
  const pendingHandoverDueAmount = Number(approval.handover_due_amount ?? 0);
  const pendingHandoverTotal = Number(approval.handover_total ?? pendingHandoverAmount + pendingHandoverDueAmount);
  const pendingHandoverStatus = approval.handover_status === 'partial' ? 'partial' : 'pending';
  const hasPendingHandover = pendingHandoverTotal > 0 || pendingHandoverAmount > 0;

  const decisionStatements = [
    decision === 'approve'
      ? c.env.DB.prepare(`
        UPDATE billing_counter_sessions
        SET status = 'closed',
            approver_user_id = ?,
            variance_approval_required = 1,
            variance_approval_status = 'approved',
            variance_approval_at = ?,
            variance_approval_reason = ?,
            closed_at = datetime('now', '+6 hours'),
            closed_by = ?,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ? AND id = ? AND variance_approval_status = 'pending'
      `).bind(approverUserId, approvedAt, data.reason ?? null, approverUserId, tenantId, sessionId)
      : c.env.DB.prepare(`
        UPDATE billing_counter_sessions
        SET status = 'active',
            closing_cash_declared = NULL,
            expected_cash = NULL,
            variance = NULL,
            refund_reserve_at_close = NULL,
            available_cash_at_close = NULL,
            total_physical_cash_at_close = NULL,
            closing_denominations = NULL,
            non_cash_settlement_json = NULL,
            non_cash_remarks = NULL,
            approver_user_id = NULL,
            variance_approval_required = 0,
            variance_approval_status = NULL,
            variance_approval_at = NULL,
            variance_approval_reason = ?,
            closed_at = NULL,
            closed_by = NULL,
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ? AND id = ? AND variance_approval_status = 'pending'
      `).bind(data.reason ?? null, tenantId, sessionId),
    c.env.DB.prepare(`
      UPDATE cash_variance_approvals
      SET status = ?, approver_user_id = ?, approved_at = ?, reason = COALESCE(?, reason)
      WHERE tenant_id = ? AND counter_session_id = ? AND status = 'pending'
    `).bind(decision === 'approve' ? 'approved' : 'rejected', approverUserId, approvedAt, data.reason ?? null, tenantId, sessionId),
  ];

  if (decision === 'approve' && hasPendingHandover) {
    if (!session.counter_id || !approval.handover_to) {
      throw new HTTPException(409, { message: 'Pending variance approval is missing counter handover context' });
    }
    decisionStatements.push(
      c.env.DB.prepare(`
        INSERT INTO billing_handovers
          (tenant_id, counter_session_id, handover_type, handover_by, handover_to, handover_amount, due_amount, status, remarks)
        VALUES (?, ?, 'counter', ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        sessionId,
        session.employee_id,
        approval.handover_to,
        pendingHandoverTotal,
        pendingHandoverDueAmount,
        pendingHandoverStatus,
        data.reason ?? approval.reason ?? 'Counter variance approved',
      ),
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
        VALUES (?, ?, ?, ?, 'handover', ?, 'cash', ?, ?)
      `).bind(
        tenantId,
        sessionId,
        session.counter_id,
        session.employee_id,
        pendingHandoverAmount,
        data.reason ?? approval.reason ?? 'Counter variance approved - handover',
        approverUserId,
      ),
      c.env.DB.prepare(`
        UPDATE billing_refund_cash_holds
        SET custody_user_id = COALESCE(?, employee_id),
            updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ?
          AND counter_session_id = ?
          AND status = 'held'
      `).bind(approval.handover_to, tenantId, sessionId),
    );
  }

  await c.env.DB.batch(decisionStatements);

  if (decision === 'approve' && hasPendingHandover) {
    if (approval.handover_to) {
      const custodyHolds = await loadHeldRefundCashHoldsForSession(c.env.DB, tenantId, sessionId);
      await Promise.all(custodyHolds.map((hold) => (
        shadowRefundReserveCustodyTransfer(
          c.env.DB,
          tenantId,
          hold,
          Number(approval.handover_to),
          approverUserId,
        )
      )));
    }
    await recordCashHandoverEvent(c, tenantId, `counter-close-${sessionId}`, String(session.employee_id), pendingHandoverAmount, {
      counterSessionId: sessionId,
      counterId: session.counter_id,
      handoverBy: session.employee_id,
      handoverTo: approval.handover_to,
      handoverTotal: pendingHandoverTotal,
      handoverDueAmount: pendingHandoverDueAmount,
      source: 'counter_close_variance_approved',
    });
  }

  void createAuditLog(c.env, tenantId, String(approverUserId), decision === 'approve' ? 'APPROVE' : 'REJECT', 'billing_counter_sessions', sessionId, {
    status: session.status,
    variance: session.variance,
  }, {
    status: newStatus,
    decision,
    reason: data.reason ?? null,
  });

  return c.json({
    message: decision === 'approve' ? 'Variance approved; counter closed' : 'Variance rejected; counter remains active',
    sessionId,
    status: newStatus,
    decision,
    approverUserId,
    handoverCreated: decision === 'approve' && hasPendingHandover,
  });
});

billingCounterRoutes.post('/sessions/:id/cash-movement', requirePermission('billing.counter.cash_movement'), zValidator('json', z.object({
  amount: z.number().positive(),
  movementType: z.enum(['cash_in', 'cash_out']),
  reason: z.string().min(3),
})), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new HTTPException(400, { message: 'Invalid session' });
  const { amount, movementType, reason } = c.req.valid('json');

  const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!session || Number(session.id) !== sessionId) throw new HTTPException(404, { message: 'Active counter session not found for this workstation' });

  const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, sessionId);
  if (movementType === 'cash_out' && amount > summary.expectedCash) {
    throw new HTTPException(400, { message: `Cannot withdraw ${amount}. Available cash is ${summary.expectedCash.toFixed(2)}` });
  }

  await c.env.DB.prepare(`
    INSERT INTO cash_drawer_movements
      (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 'cash', ?, ?)
  `).bind(tenantId, sessionId, session.counter_id, userId, movementType, amount, reason, userId).run();

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'cash_drawer_movements', sessionId, null, {
    movementType,
    amount,
    reason,
    sessionId,
  });

  return c.json({ success: true, movementType, amount, reason });
});

billingCounterRoutes.get('/sessions/:id/movements', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new HTTPException(400, { message: 'Invalid session' });

  const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!session || Number(session.id) !== sessionId) throw new HTTPException(404, { message: 'Active counter session not found for this workstation' });

  const { results } = await c.env.DB.prepare(`
    SELECT id, movement_type, amount, description, created_at
    FROM cash_drawer_movements
    WHERE tenant_id = ?
      AND counter_session_id = ?
      AND movement_type IN ('cash_in', 'cash_out')
    ORDER BY created_at DESC
    LIMIT 10
  `).bind(tenantId, sessionId).all<{ id: number; movement_type: string; amount: number; description: string; created_at: string }>();

  const movements = (results ?? []).map((m) => ({
    id: m.id,
    movementType: m.movement_type,
    amount: m.amount,
    description: m.description,
    createdAt: m.created_at,
  }));

  return c.json({ movements });
});

billingCounterRoutes.get('/bank-deposit-requests', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const mine = c.req.query('mine') !== 'false';
  const status = c.req.query('status')?.trim();

  const params: Array<string | number> = [tenantId];
  let where = 'WHERE tenant_id = ?';
  if (mine) {
    where += ' AND requested_by = ?';
    params.push(userId);
  }
  if (status) {
    where += ' AND status = ?';
    params.push(status);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT id, request_no, requested_amount, status, proposed_bank_name, request_note,
           confirmed_bank_name, confirmed_reference_no, confirmed_date,
           rejection_reason, resolution_type, created_at, updated_at
    FROM bank_deposit_requests
    ${where}
    ORDER BY created_at DESC
    LIMIT 25
  `).bind(...params).all<BankDepositRequestRow>();

  return c.json({ requests: (results ?? []).map(mapBankDepositRequest) });
});

billingCounterRoutes.post('/sessions/:id/bank-deposit-requests', zValidator('json', bankDepositRequestSchema), requirePermission('billing.counter.bank_deposit.create'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new HTTPException(400, { message: 'Invalid session' });
  const data = c.req.valid('json');

  const existing = await c.env.DB.prepare(`
    SELECT id, request_no, requested_amount, status, proposed_bank_name, request_note,
           confirmed_bank_name, confirmed_reference_no, confirmed_date,
           rejection_reason, resolution_type, created_at, updated_at
    FROM bank_deposit_requests
    WHERE tenant_id = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(tenantId, data.idempotencyKey).first<BankDepositRequestRow>();
  if (existing) {
    return c.json({ request: mapBankDepositRequest(existing), idempotent: true });
  }

  const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!session || Number(session.id) !== sessionId) {
    throw new HTTPException(404, { message: 'Active counter session not found for this workstation' });
  }

  const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, sessionId);
  if (data.amount > summary.expectedCash) {
    throw new HTTPException(400, { message: `Bank deposit amount (${data.amount}) exceeds expected cash (${summary.expectedCash.toFixed(2)})` });
  }

  const requestNo = await getNextSequence(c.env.DB, tenantId, 'bank_deposit_request', 'BDR');
  const sourceEventKey = createPostingEventKey('bank_deposit_request', requestNo, ACCOUNTING_EVENT_TYPES.bankDepositCustody);
  const note = data.note?.trim() || null;
  const proposedBankName = data.proposedBankName?.trim() || null;
  const description = note || `Bank deposit request ${requestNo}`;

  const batch = await c.env.DB.batch([
    c.env.DB.prepare(`
      INSERT INTO bank_deposit_requests
        (tenant_id, request_no, counter_session_id, counter_id, requested_by, requested_amount,
         proposed_bank_name, request_note, status, idempotency_key)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).bind(tenantId, requestNo, sessionId, session.counter_id, userId, data.amount, proposedBankName, note, data.idempotencyKey),
    c.env.DB.prepare(`
      INSERT INTO cash_drawer_movements
        (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method,
         reference_type, reference_id, description, created_by)
      VALUES (?, ?, ?, ?, 'cash_drop', ?, 'cash', 'bank_deposit_request', ?, ?, ?)
    `).bind(tenantId, sessionId, session.counter_id, userId, data.amount, requestNo, description, userId),
    c.env.DB.prepare(`
      UPDATE billing_counter_sessions
      SET cash_drop_total = COALESCE(cash_drop_total, 0) + ?,
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND tenant_id = ?
    `).bind(data.amount, sessionId, tenantId),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO accounting_posting_events
        (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
      VALUES (?, ?, 'bank_deposit_request', ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      sourceEventKey,
      requestNo,
      ACCOUNTING_EVENT_TYPES.bankDepositCustody,
      getTodayGMT6(),
      JSON.stringify({ amount: data.amount, requestNo, counterSessionId: sessionId, counterId: session.counter_id }),
      String(userId),
    ),
  ]);

  const requestId = Number(batch[0]?.meta?.last_row_id ?? 0) || 0;
  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'bank_deposit_requests', requestId, null, {
    requestNo,
    amount: data.amount,
    counterSessionId: sessionId,
    proposedBankName,
  });
  queueAccountingPosting(c, tenantId);

  return c.json({
    request: {
      id: requestId,
      requestNo,
      amount: data.amount,
      status: 'pending',
      proposedBankName,
      note,
      createdAt: null,
    },
    remainingCash: summary.expectedCash - data.amount,
  }, 201);
});

// POST /sessions/:id/cash-drop — mid-shift cash drop to safe
billingCounterRoutes.post('/sessions/:id/cash-drop', zValidator('json', cashDropSchema), requirePermission('billing.counter.cash_drop'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new HTTPException(400, { message: 'Invalid session' });
  const { amount, reason, denominations } = c.req.valid('json');

  const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!session || Number(session.id) !== sessionId) throw new HTTPException(404, { message: 'Active counter session not found for this workstation' });

  const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, sessionId);
  if (amount > summary.expectedCash) {
    throw new HTTPException(400, { message: `Cash drop amount (${amount}) exceeds expected cash (${summary.expectedCash.toFixed(2)})` });
  }

  await c.env.DB.prepare(`
    INSERT INTO cash_drawer_movements
      (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, description, created_by)
    VALUES (?, ?, ?, ?, 'cash_drop', ?, 'cash', ?, ?)
  `).bind(tenantId, sessionId, session.counter_id, userId, amount, reason, userId).run();

  // Update session cash drop total
  await c.env.DB.prepare(`
    UPDATE billing_counter_sessions
    SET cash_drop_total = COALESCE(cash_drop_total, 0) + ?
    WHERE id = ? AND tenant_id = ?
  `).bind(amount, sessionId, tenantId).run();

  void createAuditLog(c.env, tenantId, userId, 'CREATE', 'cash_drawer_movements', sessionId, null, {
    type: 'cash_drop', amount, reason, denominations,
  });

  return c.json({
    success: true,
    amount,
    remainingCash: summary.expectedCash - amount,
  });
});

// GET /x-report — mid-shift snapshot (X Report)
billingCounterRoutes.get('/x-report', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);

  const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!session) {
    throw new HTTPException(400, { message: 'No active counter session found' });
  }

  const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, session.id);

  // Get payment method breakdown
  const paymentBreakdown = await c.env.DB.prepare(`
    SELECT
      COALESCE(payment_method, 'cash') as method,
      COUNT(*) as count,
      SUM(amount) as total
    FROM emp_cash_transactions
    WHERE tenant_id = ? AND counter_session_id = ?
    GROUP BY COALESCE(payment_method, 'cash')
  `).bind(tenantId, session.id).all();

  // Get transaction type breakdown
  const typeBreakdown = await c.env.DB.prepare(`
    SELECT
      transaction_type,
      COUNT(*) as count,
      SUM(amount) as total
    FROM emp_cash_transactions
    WHERE tenant_id = ? AND counter_session_id = ?
    GROUP BY transaction_type
  `).bind(tenantId, session.id).all();

  // Get bill count
  const billStats = await c.env.DB.prepare(`
    SELECT
      COUNT(*) as total_bills,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_bills,
      SUM(discount) as total_discount
    FROM bills
    WHERE tenant_id = ? AND counter_session_id = ?
  `).bind(tenantId, session.id).first();

  const operatorName = await c.env.DB.prepare('SELECT name FROM users WHERE id = ?').bind(userId).first();

  return c.json({
    report: {
      sessionId: session.id,
      counterName: session.counter_name,
      operatorName: operatorName?.name || 'Unknown',
      openedAt: session.opened_at,
      reportTime: new Date().toISOString(),
      cashSummary: summary,
      paymentBreakdown: (paymentBreakdown.results || []).map((row: any) => ({
        method: row.method,
        count: Number(row.count),
        total: Number(row.total ?? 0),
      })),
      typeBreakdown: (typeBreakdown.results || []).map((row: any) => ({
        type: row.transaction_type,
        count: Number(row.count),
        total: Number(row.total ?? 0),
      })),
      billStats: {
        totalBills: Number(billStats?.total_bills ?? 0),
        cancelledBills: Number(billStats?.cancelled_bills ?? 0),
        totalDiscount: Number(billStats?.total_discount ?? 0),
      },
    },
  });
});

billingCounterRoutes.get('/service-items', zValidator('query', billingCounterServiceSearchSchema), requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const query = c.req.valid('query');
  const search = query.search?.trim() ?? '';
  const explicitIds = (query.ids ?? '')
    .split(',')
    .map((id) => Number(id.trim()))
    .filter((id) => Number.isInteger(id) && id > 0)
    .slice(0, 50);
  const limit = explicitIds.length > 0 ? Math.max(query.limit, explicitIds.length) : query.limit;

  const params: Array<string | number> = [];
  let priceJoin = '';
  if (query.price_category_id) {
    priceJoin = `
      LEFT JOIN billing_item_price_category_maps pcm
        ON pcm.service_item_id = si.id
       AND pcm.tenant_id = si.tenant_id
       AND pcm.price_category_id = ?
       AND COALESCE(pcm.is_active, 1) = 1
    `;
    params.push(query.price_category_id);
  }

  let whereClause = `WHERE si.tenant_id = ? AND COALESCE(si.is_active, 1) = 1
    AND (si.service_department_id IS NULL OR (sd.id IS NOT NULL AND COALESCE(sd.is_active, 1) = 1))`;
  params.push(tenantId);
  if (explicitIds.length > 0) {
    whereClause += ` AND si.id IN (${explicitIds.map(() => '?').join(',')})`;
    params.push(...explicitIds);
  } else if (search) {
    whereClause += ` AND (si.item_name LIKE ? OR si.item_code LIKE ?)`;
    const p = `%${search}%`;
    params.push(p, p);
  }
  if (query.department_id && explicitIds.length === 0) {
    whereClause += ` AND si.service_department_id = ?`;
    params.push(query.department_id);
  }

  params.push(limit);

  const sql = `
    SELECT
      si.id,
      si.item_name,
      si.item_code,
      si.service_department_id,
      sd.department_name,
      COALESCE(${query.price_category_id ? 'pcm.price' : 'NULL'}, si.price) as price,
      si.tax_applicable,
      si.tax_percent,
      si.allow_discount,
      si.allow_multiple_qty,
      0 as is_lab_catalog
    FROM billing_service_items si
    LEFT JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
     AND sd.tenant_id IN (si.tenant_id, '0')
    ${priceJoin}
    ${whereClause}
    ORDER BY department_name, item_name
    LIMIT ?
  `;

  const { results } = await c.env.DB.prepare(sql).bind(...params).all();

  return c.json({ data: results });
});

billingCounterRoutes.post('/invoices', zValidator('json', billingCounterInvoiceSchema), requirePermission('billing.counter.invoice.create'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  const requestedDiscountAmount = data.items.reduce((sum, item) => sum + Number(item.discountAmount ?? 0), 0);
  assertBillingCounterDiscountAllowed(c, requestedDiscountAmount);
  const requestHash = data.idempotencyKey ? await createBillingRequestHash({ ...data, idempotencyKey: undefined }) : null;

  if (data.idempotencyKey && requestHash) {
    const existing = await c.env.DB.prepare(`
      SELECT request_hash, status, response_json
        , bill_id, invoice_no
      FROM billing_invoice_idempotency_keys
      WHERE tenant_id = ? AND idempotency_key = ?
    `).bind(tenantId, data.idempotencyKey).first<BillingIdempotencyRow>();

    if (existing) {
      if (
        existing.request_hash !== requestHash
        && !(existing.status === 'failed' && !existing.bill_id && !existing.invoice_no)
      ) {
        throw new HTTPException(409, { message: 'Idempotency key was already used for a different billing request' });
      }
      if (existing.status === 'completed' && existing.response_json) {
        return c.json({ ...JSON.parse(existing.response_json), idempotent: true }, 201);
      }
      if (existing.status === 'failed' && !existing.bill_id && !existing.invoice_no) {
        await c.env.DB.prepare(`
          DELETE FROM billing_invoice_idempotency_keys
          WHERE tenant_id = ? AND idempotency_key = ? AND status = 'failed'
        `).bind(tenantId, data.idempotencyKey).run();
      } else {
      throw new HTTPException(409, { message: 'Billing request is already being processed. Please retry shortly.' });
      }
    }
  }

  const activeSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before creating bills.' });
  }

  let idempotencyReserved = false;
  let coreCommitted = false;

  if (data.idempotencyKey && requestHash) {
    await c.env.DB.prepare(`
      INSERT INTO billing_invoice_idempotency_keys
        (tenant_id, idempotency_key, request_hash, status, created_by)
      VALUES (?, ?, ?, 'pending', ?)
    `).bind(tenantId, data.idempotencyKey, requestHash, userId).run();
    idempotencyReserved = true;
  }

  try {
  const patient = await c.env.DB.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?',
  ).bind(data.patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const consultationDoctorIds = [...new Set(data.items.flatMap((item) => item.doctorId ? [item.doctorId] : []))];
  const consultationDoctorId = consultationDoctorIds[0] ?? null;
  const doctors = await loadCounterDoctors(c.env.DB, tenantId, consultationDoctorIds);
  const missingDoctors = consultationDoctorIds.filter((id) => !doctors.has(id));
  if (missingDoctors.length > 0) throw new HTTPException(400, { message: `Invalid doctor: ${missingDoctors.join(', ')}` });
  const invalidFeeDoctor = consultationDoctorIds.find((id) => Number(doctors.get(id)?.consultation_fee ?? 0) <= 0);
  if (invalidFeeDoctor) throw new HTTPException(400, { message: 'Selected doctor has no consultation fee configured' });

  let visitId = data.visitId ?? null;
  let visitDoctorId: number | null = null;
  if (visitId) {
    const visit = await c.env.DB.prepare(
      'SELECT id, doctor_id FROM visits WHERE id = ? AND patient_id = ? AND tenant_id = ?',
    ).bind(visitId, data.patientId, tenantId).first<{ id: number; doctor_id: number | null }>();
    if (!visit) throw new HTTPException(404, { message: 'Visit not found for patient' });
    visitDoctorId = visit.doctor_id ? Number(visit.doctor_id) : null;
    if (!visitDoctorId && consultationDoctorId) {
      await c.env.DB.prepare(
        "UPDATE visits SET doctor_id = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?",
      ).bind(consultationDoctorId, visitId, tenantId).run();
      visitDoctorId = consultationDoctorId;
    }
  } else if (data.createWalkInVisit) {
    const visitNo = await getNextSequence(c.env.DB, tenantId, 'visit', 'V');
    const visitResult = await c.env.DB.prepare(`
      INSERT INTO visits (tenant_id, patient_id, doctor_id, visit_no, visit_type, visit_date, status, created_by, created_at)
      VALUES (?, ?, ?, ?, 'opd', date('now'), 'checked_in', ?, datetime('now', '+6 hours'))
    `).bind(tenantId, data.patientId, consultationDoctorId, visitNo, userId).run();
    visitId = Number(visitResult.meta.last_row_id);
    visitDoctorId = consultationDoctorId;
  } else {
    throw new HTTPException(400, { message: 'Visit context is required. Select a visit or create a walk-in visit.' });
  }

  const requestedIds = [...new Set(data.items.flatMap((item) => item.serviceItemId ? [item.serviceItemId] : []))];
  const catalog = await loadCounterServiceItems(c.env.DB, tenantId, requestedIds, data.priceCategoryId);
  const missing = requestedIds.filter((id) => !catalog.has(id));
  if (missing.length > 0) throw new HTTPException(400, { message: `Invalid service item: ${missing.join(', ')}` });

  const resolvedItems = data.items.map((input) => {
    if (input.doctorId) {
      const doctor = doctors.get(input.doctorId)!;
      const unitPrice = Number(doctor.consultation_fee ?? 0);
      const gross = unitPrice * input.quantity;
      const discountFromPercent = input.discountPercent > 0 ? Math.round(gross * input.discountPercent / 100) : 0;
      const discount = Math.min(input.discountAmount || discountFromPercent, gross);
      const lineTotal = Math.max(0, gross - discount);
      return {
        ...input,
        sourceType: 'doctor' as const,
        serviceItemId: null,
        doctorId: input.doctorId,
        description: `Consultation - ${formatDoctorName(doctor.name)}`,
        department: doctor.department ?? doctor.specialty ?? 'Doctor',
        itemCategory: 'doctor_visit',
        unitPrice,
        gross,
        discount,
        discountPercent: input.discountPercent,
        taxAmount: 0,
        lineTotal,
        referenceId: input.doctorId,
      };
    }

    const service = catalog.get(input.serviceItemId!)!;
    if (input.quantity > 1 && Number(service.allow_multiple_qty ?? 1) !== 1) {
      throw new HTTPException(400, { message: `${service.item_name} does not allow multiple quantity` });
    }
    if ((input.discountAmount > 0 || input.discountPercent > 0) && Number(service.allow_discount ?? 1) !== 1) {
      throw new HTTPException(400, { message: `${service.item_name} does not allow discount` });
    }

    const unitPrice = Number(service.category_price ?? service.price ?? 0);
    const gross = unitPrice * input.quantity;
    const discountFromPercent = input.discountPercent > 0 ? Math.round(gross * input.discountPercent / 100) : 0;
    const discount = Math.min(input.discountAmount || discountFromPercent, gross);
    const taxable = Number(service.tax_applicable ?? 0) === 1;
    const taxAmount = taxable ? Math.round(((gross - discount) * Number(service.tax_percent ?? 0)) / 100) : 0;
    const lineTotal = Math.max(0, gross - discount + taxAmount);
    const itemCategory = inferCounterItemCategory(service);
    const mappedLabTestId = Number(input.labTestId ?? service.lab_test_id ?? 0);

    return {
      ...input,
      labTestId: Number.isInteger(mappedLabTestId) && mappedLabTestId > 0 ? mappedLabTestId : input.labTestId,
      sourceType: 'service_item' as const,
      serviceItemId: input.serviceItemId!,
      doctorId: input.performerDoctorId ?? input.prescriberDoctorId ?? null,
      description: service.item_name,
      department: service.department_name ?? null,
      itemCategory,
      unitPrice,
      gross,
      discount,
      discountPercent: input.discountPercent,
      taxAmount,
      lineTotal,
      referenceId: input.serviceItemId!,
    };
  });

  const subtotal = roundAmount(resolvedItems.reduce((sum, item) => sum + item.gross, 0));
  const discount = roundAmount(resolvedItems.reduce((sum, item) => sum + item.discount, 0));
  const taxTotal = roundAmount(resolvedItems.reduce((sum, item) => sum + item.taxAmount, 0));
  const total = roundAmount(resolvedItems.reduce((sum, item) => sum + item.lineTotal, 0));
  assertBillingCounterDiscountAllowed(c, discount);
  assertDiscountReferralNameForHighDiscount(subtotal, discount, data.discountByName);

  const schemeApplication = data.schemeApplication ?? (data.schemeId ? { schemeId: data.schemeId } : null);
  const schemeEligibility = schemeApplication && discount > 0
    ? await evaluateBillingSchemeEligibility(c.env.DB, {
      tenantId,
      patientId: data.patientId,
      schemeId: schemeApplication.schemeId ?? data.schemeId ?? null,
      schemeCode: schemeApplication.schemeCode ?? null,
      memberCode: schemeApplication.memberCode ?? null,
      serviceCategory: schemeApplication.serviceCategory ?? null,
      subtotal,
    })
    : null;

  if (schemeEligibility && !schemeEligibility.eligible) {
    throw new HTTPException(400, { message: ['Scheme is not eligible', ...schemeEligibility.blockers].join(': ') });
  }
  if (schemeEligibility && discount - schemeEligibility.suggested_discount > 0.01) {
    throw new HTTPException(400, { message: 'Scheme discount exceeds eligible scheme cap.' });
  }

  const requestedDiscountAllocations = (data.discountAllocations ?? [])
    .map((allocation) => {
      const reason = normalizeAllocationReason(allocation.reason);
      const amount = roundAmount(allocation.amount);
      return amount > 0
        ? {
          reason,
          allocationType: REASON_TO_ALLOCATION_TYPE[reason],
          amount,
          doctorId: allocation.doctorId ?? null,
          note: allocation.note?.trim() || null,
        }
        : null;
    })
    .filter((row): row is { reason: string; allocationType: string; amount: number; doctorId: number | null; note: string | null } => Boolean(row));
  const hasRequestedDoctorWaiver = requestedDiscountAllocations.some(
    (allocation) => allocation.allocationType === 'doctor_commission_waiver',
  );
  if (data.discountSourceIntent === 'doctor_commission_waiver' && !hasRequestedDoctorWaiver) {
    throw new HTTPException(400, { message: 'Doctor Waiver was selected, but no matching doctor waiver allocation was submitted.' });
  }
  if (data.discountSourceIntent && data.discountSourceIntent !== 'doctor_commission_waiver' && hasRequestedDoctorWaiver) {
    throw new HTTPException(400, { message: 'Doctor waiver allocation does not match the selected discount source.' });
  }
  if (schemeEligibility && schemeEligibility.allocation_type !== 'doctor_commission_waiver' && hasRequestedDoctorWaiver) {
    throw new HTTPException(400, { message: 'Doctor commission waiver cannot be mixed with a Billing Master scheme discount. Remove the scheme or remove the doctor waiver allocation.' });
  }

  const normalizedRequestedDiscountAllocations: Array<{
    reason: string;
    allocationType: string;
    amount: number;
    doctorId: number | null;
    note: string | null;
  }> = [];
  const remainingDoctorWaiverByDoctor = new Map<number, number>();
  for (const allocation of requestedDiscountAllocations) {
    if (allocation.allocationType !== 'doctor_commission_waiver') {
      normalizedRequestedDiscountAllocations.push(allocation);
      continue;
    }

    const doctorId = Number(allocation.doctorId ?? data.referringDoctorId ?? visitDoctorId ?? 0);
    if (!doctorId) {
      throw new HTTPException(400, { message: 'Select a referring doctor before applying Doctor Waiver.' });
    }
    if (allocation.doctorId && data.referringDoctorId && Number(allocation.doctorId) !== Number(data.referringDoctorId)) {
      throw new HTTPException(400, { message: 'Doctor waiver allocation does not match the selected referring doctor.' });
    }

    let eligibleRemaining = remainingDoctorWaiverByDoctor.get(doctorId);
    if (eligibleRemaining === undefined) {
      const quote = await quoteDoctorWaiver(c.env.DB, {
        tenantId,
        doctorId,
        billDate: getTodayGMT6(),
        totalDiscount: 0,
        items: resolvedItems.map((item) => ({
          itemCategory: item.itemCategory,
          description: item.description,
          lineTotal: item.lineTotal,
          grossLineTotal: item.gross,
          referenceId: item.referenceId,
          labTestId: item.labTestId,
          quantity: item.quantity,
        })),
      });
      eligibleRemaining = roundAmount(quote.maximumDoctorWaiverAmount);
    }

    if (eligibleRemaining <= 0) {
      throw new HTTPException(400, { message: 'The selected doctor has no eligible commission to waive for this bill.' });
    }

    const split = splitDiscountAllocation({
      billGrossAmount: subtotal,
      totalDiscount: allocation.amount,
      discountReason: 'doctor_commission_waiver',
      discountDoctorId: doctorId,
      eligibleDoctorCommission: eligibleRemaining,
      requestedDoctorWaiverAmount: allocation.amount,
      note: allocation.note,
    });
    remainingDoctorWaiverByDoctor.set(doctorId, roundAmount(eligibleRemaining - split.doctorWaiverAmount));
    normalizedRequestedDiscountAllocations.push(...split.allocations.map((row) => ({
      reason: row.discountReason,
      allocationType: row.allocationType,
      amount: row.amount,
      doctorId: row.doctorId,
      note: row.note,
    })));
  }

  const discountAllocationRows = discount > 0
    ? (normalizedRequestedDiscountAllocations.length > 0
      ? normalizedRequestedDiscountAllocations
      : [{
        reason: schemeEligibility?.allocation_type ?? 'normal_hospital_discount',
        allocationType: schemeEligibility?.allocation_type ?? 'hospital_discount',
        amount: roundAmount(discount),
        doctorId: null,
        note: schemeEligibility?.scheme_name ? `Scheme: ${schemeEligibility.scheme_name}` : null,
      }])
    : [];
  const allocationTotal = roundAmount(discountAllocationRows.reduce((sum, row) => sum + row.amount, 0));
  if (discount > 0 && Math.abs(allocationTotal - roundAmount(discount)) > 0.01) {
    throw new HTTPException(400, { message: 'Discount allocation total must match bill discount.' });
  }
  const categoryTotals = calculateBillCategoryTotals(
    resolvedItems.map((item) => ({ category: item.itemCategory, amount: item.lineTotal })),
  );
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Billing counter invoice creation');

  if (data.billMode === 'provisional') {
    await assertStrictFinancialBoundaryDisabledOrSupported(
      c.env.DB,
      String(tenantId),
      'billing-counter.invoice.provisional',
    );
    const statements = resolvedItems.map((item) => c.env.DB.prepare(`
      INSERT INTO billing_provisional_items
        (tenant_id, patient_id, visit_id, item_category, item_name, department, unit_price, quantity,
         discount_amount, total_amount, doctor_id, reference_id, bill_status, is_active, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisional', 1, ?)
    `).bind(
      tenantId,
      data.patientId,
      visitId,
      item.itemCategory,
      item.description,
      item.department,
      item.unitPrice,
      item.quantity,
      item.discount,
      item.lineTotal,
      item.doctorId,
      item.referenceId,
      userId,
    ));
    await c.env.DB.batch(statements);
    const responseBody = { message: 'Provisional billing items created', mode: 'provisional', total, itemCount: resolvedItems.length };
    if (data.idempotencyKey) {
      await c.env.DB.prepare(`
        UPDATE billing_invoice_idempotency_keys
        SET status = 'completed', response_json = ?, updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ? AND idempotency_key = ?
      `).bind(JSON.stringify(responseBody), tenantId, data.idempotencyKey).run();
    }
    return c.json(responseBody, 201);
  }

  const invoiceMode = resolveBillingCounterInvoiceMode({
    requestedMode: data.billMode,
    total,
    paidAmount: data.payment.paidAmount,
    depositDeducted: data.payment.depositDeducted,
  });
  const payment = calculateBillPaymentState({
    total,
    paidAmount: invoiceMode.paidAmount,
    depositDeducted: invoiceMode.depositDeducted,
  });
  const effectiveDue = invoiceMode.effectiveMode === 'credit' ? total : payment.due;
  const effectiveStatus = invoiceMode.effectiveMode === 'credit'
    ? (effectiveDue <= 0 ? 'paid' : 'open')
    : payment.status;

  const strictPolicy = await resolveStrictFinancialPolicy(c.env.DB, String(tenantId));
  if (
    strictPolicy.enabled && strictPolicy.writePolicy === 'strict'
    && (payment.paid > 0 || payment.depositDeducted > 0)
  ) {
    throw new CanonicalStrictFinancialError(
      'CANONICAL_STRICT_BOUNDARY_UNSUPPORTED',
      'Billing-counter canonical verification requires credit-only creation',
    );
  }

  if (payment.depositDeducted > 0) {
    const depositBalance = await getPatientDepositBalance(c.env.DB, tenantId, data.patientId);
    if (payment.depositDeducted > depositBalance) {
      throw new HTTPException(400, { message: `Insufficient deposit balance (available: ${depositBalance})` });
    }
  }

  const invoiceNo = await getNextBillInvoiceNumber(c.env.DB, tenantId, categoryTotals);
  const referredByType = resolveReferredByType(data);
  const billIdLookupSql = `(SELECT id FROM bills WHERE invoice_no = ? AND tenant_id = ? LIMIT 1)`;
  const batch: D1PreparedStatement[] = [
    c.env.DB.prepare(`
      INSERT INTO bills
        (patient_id, visit_id, invoice_no, referring_doctor_id, referred_by_type, referred_by_hospital_id, referred_by_name,
         test_bill, doctor_visit_bill,
         admission_bill, operation_bill, medicine_bill, discount, discount_by_name, total, tax_total, paid, due, status,
         tenant_id, created_by, counter_id, counter_session_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      data.patientId,
      visitId,
      invoiceNo,
      data.referringDoctorId ?? null,
      referredByType,
      data.referredByHospitalId ?? null,
      data.referredByName?.trim() || null,
      categoryTotals.testBill,
      categoryTotals.doctorVisitBill,
      categoryTotals.admissionBill,
      categoryTotals.operationBill,
      categoryTotals.medicineBill,
      discount,
      data.discountByName?.trim() || null,
      total,
      taxTotal,
      payment.paid,
      effectiveDue,
      effectiveStatus,
      tenantId,
      userId,
      Number(activeSession.counter_id),
      Number(activeSession.id),
    ),
  ];
  let paymentReceiptNo: string | null = null;
  let depositAdjustmentReceiptNo: string | null = null;

  for (const item of resolvedItems) {
    batch.push(c.env.DB.prepare(`
      INSERT INTO invoice_items (bill_id, item_category, description, quantity, unit_price, line_total, tax_amount, reference_id, tenant_id, created_at)
      VALUES (${billIdLookupSql}, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(invoiceNo, tenantId, item.itemCategory, item.description, item.quantity, item.unitPrice, item.lineTotal, item.taxAmount, item.referenceId, tenantId));

    batch.push(c.env.DB.prepare(`
      INSERT INTO visit_services
        (tenant_id, visit_id, patient_id, service_type, description, service_item_id, doctor_id, amount,
         discount_amount, quantity, total_amount, reference_type, reference_id, status, bill_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'billed', ${billIdLookupSql}, ?)
    `).bind(
      tenantId,
      visitId,
      data.patientId,
      toVisitServiceType(item.itemCategory),
      item.description,
      item.sourceType === 'service_item' ? item.serviceItemId : null,
      item.doctorId,
      item.unitPrice,
      item.discount,
      item.quantity,
      item.lineTotal,
      item.sourceType === 'doctor' ? 'doctor' : 'billing_service_item',
      item.referenceId,
      invoiceNo,
      tenantId,
      userId,
    ));

    if (item.sourceType === 'service_item' && item.serviceItemId) {
      batch.push(c.env.DB.prepare(`
        INSERT INTO billing_service_item_usage_stats
          (tenant_id, service_item_id, usage_count, last_used_at, created_at, updated_at)
        VALUES (?, ?, ?, datetime('now', '+6 hours'), datetime('now', '+6 hours'), datetime('now', '+6 hours'))
        ON CONFLICT(tenant_id, service_item_id) DO UPDATE SET
          usage_count = usage_count + excluded.usage_count,
          last_used_at = excluded.last_used_at,
          updated_at = excluded.updated_at
      `).bind(
        tenantId,
        item.serviceItemId,
        Math.max(1, Number(item.quantity ?? 1)),
      ));
    }
  }

  if (payment.depositDeducted > 0) {
    const receiptNo = await getNextSequence(c.env.DB, tenantId, 'deposit_adj', 'DAD');
    depositAdjustmentReceiptNo = receiptNo;
    batch.push(c.env.DB.prepare(`
      INSERT INTO billing_deposits
        (tenant_id, patient_id, deposit_receipt_no, amount, transaction_type, payment_method,
         reference_bill_id, remarks, created_by, counter_id, counter_session_id)
      VALUES (?, ?, ?, ?, 'adjustment', ?, ${billIdLookupSql}, 'Billing counter deposit deduction', ?, ?, ?)
    `).bind(
      tenantId,
      data.patientId,
      receiptNo,
      payment.depositDeducted,
      data.payment.paymentMethod,
      invoiceNo,
      tenantId,
      userId,
      Number(activeSession.counter_id),
      Number(activeSession.id),
    ));
  }

  if (payment.paid > 0) {
    const receiptNo = await getNextSequence(c.env.DB, tenantId, 'receipt', 'RCP');
    paymentReceiptNo = receiptNo;
    batch.push(c.env.DB.prepare(`
      INSERT INTO payments
        (bill_id, amount, payment_type, receipt_no, received_by, payment_method, external_transaction_id, tenant_id, counter_id, counter_session_id, date)
      VALUES (${billIdLookupSql}, ?, 'current', ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      invoiceNo,
      tenantId,
      payment.paid,
      receiptNo,
      userId,
      data.payment.paymentMethod,
      data.payment.externalTransactionId ?? null,
      tenantId,
      Number(activeSession.counter_id),
      Number(activeSession.id),
    ));
    batch.push(c.env.DB.prepare(`
      INSERT INTO emp_cash_transactions
        (tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount, reference_id, reference_type, payment_method, description)
      VALUES (?, ?, ?, ?, 'CashSales', ?, ${billIdLookupSql}, 'bill', ?, ?)
    `).bind(
      tenantId,
      userId,
      Number(activeSession.counter_id),
      Number(activeSession.id),
      payment.paid,
      invoiceNo,
      tenantId,
      data.payment.paymentMethod,
      `Billing counter payment ${receiptNo}`,
    ));
  }

  for (const allocation of discountAllocationRows) {
    batch.push(c.env.DB.prepare(`
      INSERT INTO bill_discount_allocations
        (tenant_id, bill_id, allocation_type, discount_reason, doctor_id, amount, reference_name, note, metadata_json, created_by)
      VALUES (?, ${billIdLookupSql}, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      invoiceNo,
      tenantId,
      allocation.allocationType,
      allocation.reason,
      allocation.doctorId,
      allocation.amount,
      data.discountByName?.trim() || null,
      allocation.note,
      JSON.stringify({
        source: 'billing_counter_invoice',
        schemeId: schemeEligibility?.scheme_id ?? null,
        schemeMemberId: schemeEligibility?.matched_member_id ?? null,
      }),
      userId,
    ));
  }

  const canonicalOccurredAtUtc = new Date().toISOString();
  const execution = await executeStrictFinancialMutation({
    db: c.env.DB,
    tenantId: String(tenantId),
    boundary: 'billing-counter.invoice.create',
    legacyStatements: batch,
    canonical: async (options) => projectBillingCounterSettlement(c.env.DB, {
      tenantId: String(tenantId),
      patientId: data.patientId,
      invoiceNo,
      issuedAtUtc: canonicalOccurredAtUtc,
      items: resolvedItems.map((item, index) => ({
        sourceLineId: `${index + 1}:${item.itemCategory}:${item.referenceId ?? item.serviceItemId ?? item.doctorId ?? 'none'}`,
        lineType: 'other_adjustment' as const,
        adjustmentCode: `LEGACY_${String(item.itemCategory).toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
        quantity: 1,
        unitAmount: item.lineTotal,
      })),
      payment: payment.paid > 0 && paymentReceiptNo
        ? {
          receiptNo: paymentReceiptNo,
          amount: payment.paid,
          paymentMethod: data.payment.paymentMethod,
          receivedAtUtc: canonicalOccurredAtUtc,
          collectorId: Number(userId),
          counterId: Number(activeSession.counter_id),
          counterSessionId: Number(activeSession.id),
          externalTransactionId: data.payment.externalTransactionId ?? null,
        }
        : null,
      depositApplication: payment.depositDeducted > 0 && depositAdjustmentReceiptNo
        ? {
          applicationNo: depositAdjustmentReceiptNo,
          amount: payment.depositDeducted,
          appliedAtUtc: canonicalOccurredAtUtc,
        }
        : null,
    }, options),
  });
  coreCommitted = true;

  const bill = await c.env.DB.prepare(`
    SELECT id
    FROM bills
    WHERE tenant_id = ? AND invoice_no = ?
    ORDER BY id DESC
    LIMIT 1
  `).bind(tenantId, invoiceNo).first<{ id: number }>();
  const billId = Number(bill?.id);
  if (!Number.isFinite(billId) || billId <= 0) {
    throw new HTTPException(500, { message: 'Billing counter invoice was not created' });
  }

  let labOrderResult: BillingCounterLabOrderCreateResult = {
    labOrderId: null,
    labOrderNo: null,
    labOrderItems: [],
  };
  const reagentUsageWarnings: ReagentUsageWarning[] = [];
  try {
    labOrderResult = await createBillingCounterLabOrderForInvoice(c.env.DB, {
      tenantId,
      userId,
      patientId: data.patientId,
      visitId,
      billId,
      billStatus: effectiveDue <= 0 ? 'paid' : 'unpaid',
      items: resolvedItems,
    });
  } catch (error) {
    console.error('Failed to create billing counter lab order after invoice commit:', error);
    reagentUsageWarnings.push({ itemId: 0, message: 'Invoice created, but lab order creation needs review.' });
  }

  try {
    reagentUsageWarnings.push(...await recordUnresolvedBillingLabTestExceptions(c.env.DB, {
      tenantId,
      userId,
      billId,
      invoiceNo,
      items: resolvedItems,
    }));
  } catch (error) {
    console.error('Failed to record unresolved billing lab test exceptions:', error);
    reagentUsageWarnings.push({ itemId: 0, message: 'Lab exception review could not be recorded.' });
  }

  try {
    reagentUsageWarnings.push(...await consumeBillingCounterLabOrderReagents(c.env.DB, {
      tenantId,
      userId,
      billId,
      invoiceNo,
      labOrderId: labOrderResult.labOrderId,
      labOrderItems: labOrderResult.labOrderItems,
    }));
  } catch (error) {
    console.error('Failed to consume billing counter lab reagents:', error);
    const message = error instanceof HTTPException && error.status < 500
      ? error.message
      : 'Reagent usage could not be posted automatically.';
    reagentUsageWarnings.push({ itemId: 0, message });
  }

  queueBillingCounterInvoiceConsumption(c, {
    tenantId,
    userId,
    patientId: data.patientId,
    visitId,
    billId,
    invoiceNo,
    items: resolvedItems.map((item) => ({
      sourceType: item.sourceType,
      serviceItemId: item.sourceType === 'service_item' ? item.serviceItemId : null,
      department: item.department,
      description: item.description,
      lineTotal: item.lineTotal,
    })),
  });

  const responseBody = {
    message: 'Billing counter invoice created',
    billId,
    invoiceNo,
    requestedMode: invoiceMode.requestedMode,
    mode: invoiceMode.effectiveMode,
    modeAdjusted: invoiceMode.modeAdjusted,
    modeAdjustmentReason: invoiceMode.modeAdjustmentReason,
    subtotal,
    discount,
    taxTotal,
    total,
    paidAmount: payment.paid,
    depositDeducted: payment.depositDeducted,
    dueAmount: effectiveDue,
    status: effectiveStatus,
    labOrderId: labOrderResult.labOrderId,
    labOrderNo: labOrderResult.labOrderNo,
    labOrderItemCount: labOrderResult.labOrderItems.length,
    reagentUsageWarnings,
  };

  if (data.idempotencyKey) {
    await c.env.DB.prepare(`
      UPDATE billing_invoice_idempotency_keys
      SET status = 'completed', bill_id = ?, invoice_no = ?, response_json = ?, updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ? AND idempotency_key = ?
    `).bind(billId, invoiceNo, JSON.stringify(responseBody), tenantId, data.idempotencyKey).run()
      .catch((error) => console.error('Failed to complete billing invoice idempotency key:', error));
  }

  const postCommitSideEffects: Promise<unknown>[] = [
    recordBillFinalizationSideEffects(c.env.DB, {
      tenantId,
      userId,
      patientId: data.patientId,
      visitId,
      billId,
      invoiceNo,
      referringDoctorId: data.referringDoctorId ?? null,
      billDate: today,
      subtotal,
      discount,
      total,
      categoryTotals,
      counterId: Number(activeSession.counter_id),
      counterSessionId: Number(activeSession.id),
      doctorCommissionWaivers: discountAllocationRows
        .filter((allocation) => allocation.allocationType === 'doctor_commission_waiver' && allocation.doctorId)
        .map((allocation) => ({ doctorId: Number(allocation.doctorId), amount: allocation.amount })),
      extraPayload: {
        labOrderId: labOrderResult.labOrderId,
        labOrderNo: labOrderResult.labOrderNo,
        reagentUsageWarnings,
        discountAllocations: discountAllocationRows.map((allocation) => ({
          allocationType: allocation.allocationType,
          doctorId: allocation.doctorId,
          amount: allocation.amount,
        })),
      },
      items: resolvedItems.map((item) => ({
        itemCategory: item.itemCategory,
        description: item.description,
        lineTotal: item.lineTotal,
        referenceId: item.referenceId,
        performerDoctorId: item.performerDoctorId ?? null,
        prescriberDoctorId: item.prescriberDoctorId ?? null,
        labTestId: 'labTestId' in item && item.labTestId ? Number(item.labTestId) : null,
      })),
    }),
    createAuditLog(c.env, tenantId, userId, 'CREATE', 'bills', billId, null, {
      invoiceNo,
      requestedMode: invoiceMode.requestedMode,
      mode: invoiceMode.effectiveMode,
      modeAdjusted: invoiceMode.modeAdjusted,
      modeAdjustmentReason: invoiceMode.modeAdjustmentReason,
      total,
      subtotal,
      discount,
      taxTotal,
      itemCount: resolvedItems.length,
      labOrderId: labOrderResult.labOrderId,
      labOrderItemCount: labOrderResult.labOrderItems.length,
      reagentUsageWarnings,
      schemeId: data.schemeId ?? null,
      priceCategoryId: data.priceCategoryId ?? null,
      counterId: Number(activeSession.counter_id),
      counterSessionId: Number(activeSession.id),
    }),
  ];

  if (schemeEligibility?.eligible && schemeEligibility.scheme_id && discount > 0) {
    postCommitSideEffects.push(recordBillingSchemeUsage(c.env.DB, {
      tenantId,
      schemeId: schemeEligibility.scheme_id,
      memberId: schemeEligibility.matched_member_id,
      patientId: data.patientId,
      billId,
      serviceCategory: schemeEligibility.service_category,
      subtotal,
      discountAmount: discount,
      allocationType: schemeEligibility.allocation_type,
      createdBy: userId,
    }));
  }

  if (paymentReceiptNo && payment.paid > 0) {
    postCommitSideEffects.push(
      recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'payment',
        sourceId: paymentReceiptNo,
        eventType: ACCOUNTING_EVENT_TYPES.paymentReceived,
        eventDate: today,
        createdBy: userId,
        payload: {
          billId,
          receiptNo: paymentReceiptNo,
          patientId: data.patientId,
          amount: payment.paid,
          paymentMethod: data.payment.paymentMethod,
          paymentType: 'current',
          externalTransactionId: data.payment.externalTransactionId ?? null,
        },
      }),
      shadowWriteBillPaymentCollection({
        db: c.env.DB,
        tenantId,
        billId,
        invoiceNo,
        receiptNo: paymentReceiptNo,
        patientId: data.patientId,
        amount: payment.paid,
        paymentMethod: data.payment.paymentMethod,
        userId,
        counterSessionId: Number(activeSession.id),
        counterId: Number(activeSession.counter_id),
        externalTransactionId: data.payment.externalTransactionId ?? null,
      }),
    );
  }

  if (depositAdjustmentReceiptNo && payment.depositDeducted > 0) {
    postCommitSideEffects.push(recordAccountingPostingEvent(c.env.DB, {
      tenantId,
      sourceType: 'patient_deposit_adjustment',
      sourceId: depositAdjustmentReceiptNo,
      eventType: ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
      eventDate: today,
      createdBy: userId,
      payload: {
        billId,
        receiptNo: depositAdjustmentReceiptNo,
        patientId: data.patientId,
        amount: payment.depositDeducted,
        paymentMethod: data.payment.paymentMethod,
      },
    }));
  }

  const postCommitTask = Promise.allSettled(postCommitSideEffects).then((results) => {
    results.forEach((result) => {
      if (result.status === 'rejected') {
        console.error('Billing counter invoice post-commit side effect failed:', result.reason);
      }
    });
    queueAccountingPosting(c, tenantId);
  });
  try {
    c.executionCtx.waitUntil(postCommitTask);
  } catch {
    await postCommitTask;
  }

  return c.json(responseBody, 201);
  } catch (error) {
    console.error('Billing counter invoice creation failed:', error instanceof Error ? error.message : String(error));
    if (!coreCommitted && idempotencyReserved && data.idempotencyKey) {
      await c.env.DB.prepare(`
        UPDATE billing_invoice_idempotency_keys
        SET status = 'failed', updated_at = datetime('now', '+6 hours')
        WHERE tenant_id = ? AND idempotency_key = ? AND status = 'pending'
      `).bind(tenantId, data.idempotencyKey).run().catch((markError) => {
        console.error('Failed to mark billing invoice idempotency key failed:', markError);
      });
    }
    throw error;
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN: Counter Cash Collection Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

const ADMIN_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
const CUSTODY_TRANSFER_ADMIN_ID_OFFSET = 1_000_000_000;

billingCounterRoutes.get('/admin/pending-handovers', requirePermission('billing.counter.management_cash.read'), async (c) => {
  const tenantId = requireTenantId(c);

  // Get pending admin cash from legacy counter handovers and new drawer custody transfers.
  const handovers = await c.env.DB.prepare(`
    SELECT * FROM (
      SELECT
        h.id AS id,
        h.id AS raw_id,
        'counter_handover' AS source_type,
        h.counter_session_id,
        h.handover_amount,
        h.due_amount,
        h.status as handover_status,
        h.created_at as handover_date,
        h.remarks as handover_remarks,
        s.session_no,
        c.counter_name,
        c.counter_code,
        u.name as cashier_name,
        e.name as handover_to_name,
        s.opening_cash,
        s.closing_cash_declared,
        s.expected_cash,
        s.variance,
        s.closed_at,
        NULL AS transfer_no
      FROM billing_handovers h
      JOIN billing_counter_sessions s ON h.counter_session_id = s.id AND s.tenant_id = h.tenant_id
      JOIN billing_counters c ON s.counter_id = c.id AND c.tenant_id = h.tenant_id
      JOIN users u ON h.handover_by = u.id AND u.tenant_id = h.tenant_id
      LEFT JOIN users e ON h.handover_to = e.id AND e.tenant_id = h.tenant_id
      WHERE h.tenant_id = ?
        AND h.handover_type = 'counter'
        AND h.status IN ('pending', 'partial')
        AND COALESCE(h.handover_purpose, 'management_collection') = 'management_collection'
        AND (CASE WHEN h.status = 'partial' THEN COALESCE(h.due_amount, 0) ELSE COALESCE(h.handover_amount, 0) END) > 0
      UNION ALL
      SELECT
        (? + t.id) AS id,
        t.id AS raw_id,
        'cash_custody_transfer' AS source_type,
        t.counter_session_id,
        t.amount AS handover_amount,
        COALESCE(t.due_amount, t.amount) AS due_amount,
        t.status AS handover_status,
        t.created_at AS handover_date,
        t.note AS handover_remarks,
        s.session_no,
        c.counter_name,
        c.counter_code,
        u.name AS cashier_name,
        e.name AS handover_to_name,
        s.opening_cash,
        NULL AS closing_cash_declared,
        NULL AS expected_cash,
        CASE WHEN t.status = 'disputed' THEN COALESCE(t.due_amount, 0) ELSE 0 END AS variance,
        NULL AS closed_at,
        t.transfer_no
      FROM billing_counter_cash_transfers t
      LEFT JOIN billing_counter_sessions s ON s.id = t.counter_session_id AND s.tenant_id = t.tenant_id
      LEFT JOIN billing_counters c ON c.id = t.counter_id AND c.tenant_id = t.tenant_id
      LEFT JOIN users u ON t.transfer_by = u.id AND u.tenant_id = t.tenant_id
      LEFT JOIN users e ON t.transfer_to = e.id AND e.tenant_id = t.tenant_id
      WHERE t.tenant_id = ?
        AND t.status IN ('pending', 'partial', 'disputed')
        AND (t.destination_type = 'admin_custody' OR e.role IN ('hospital_admin', 'md', 'director', 'accountant'))
        AND COALESCE(t.due_amount, t.amount, 0) > 0
    ) pending_admin_cash
    ORDER BY datetime(handover_date) DESC, id DESC
  `).bind(tenantId, CUSTODY_TRANSFER_ADMIN_ID_OFFSET, tenantId).all();

  // Transform camelCase
  const data = (handovers.results || []).map((h: any) => ({
    id: h.id,
    rawId: h.raw_id,
    sourceType: h.source_type,
    sourceId: String(h.raw_id ?? h.id),
    sourceNo: h.transfer_no ?? h.session_no ?? null,
    transferNo: h.transfer_no,
    counterSessionId: h.counter_session_id,
    handoverAmount: h.handover_amount,
    dueAmount: h.due_amount,
    status: h.handover_status,
    handoverDate: h.handover_date,
    handoverRemarks: h.handover_remarks,
    sessionNo: h.session_no,
    counterName: h.counter_name,
    counterCode: h.counter_code,
    cashierName: h.cashier_name,
    handoverToName: h.handover_to_name,
    openingCash: h.opening_cash,
    closingCashDeclared: h.closing_cash_declared,
    expectedCash: h.expected_cash,
    variance: h.variance,
    closedAt: h.closed_at,
  }));

  const totalPending = data.reduce((sum: number, h: any) => sum + (h.status === 'partial' ? Number(h.dueAmount ?? 0) : Number(h.handoverAmount ?? 0)), 0);

  return c.json({ handovers: data, totalPending, count: data.length });
});

billingCounterRoutes.get('/admin/collection-summary', requirePermission('billing.counter.management_cash.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();

  // Today's actual handover cash movements. Handover rows can remain partial,
  // so the admin cash total must come from movement evidence, not row status.
  const todayCollections = await c.env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM cash_drawer_movements
    WHERE tenant_id = ?
      AND movement_type = 'handover'
      AND COALESCE(payment_method, 'cash') = 'cash'
      AND date(created_at) = ?
  `).bind(tenantId, date).first<{ total: number }>();

  // Pending admin cash count and amount from legacy handovers and custody transfers.
  const pendingStats = await c.env.DB.prepare(`
    SELECT
      COALESCE(SUM(count), 0) AS count,
      COALESCE(SUM(total), 0) AS total
    FROM (
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(CASE WHEN h.status = 'partial' THEN COALESCE(h.due_amount, 0) ELSE h.handover_amount END), 0) AS total
      FROM billing_handovers h
      LEFT JOIN users e ON h.handover_to = e.id AND e.tenant_id = h.tenant_id
      WHERE h.tenant_id = ?
        AND h.handover_type = 'counter'
        AND h.status IN ('pending', 'partial')
        AND COALESCE(h.handover_purpose, 'management_collection') = 'management_collection'
        AND (CASE WHEN h.status = 'partial' THEN COALESCE(h.due_amount, 0) ELSE COALESCE(h.handover_amount, 0) END) > 0
      UNION ALL
      SELECT
        COUNT(*) AS count,
        COALESCE(SUM(COALESCE(t.due_amount, t.amount)), 0) AS total
      FROM billing_counter_cash_transfers t
      LEFT JOIN users e ON t.transfer_to = e.id AND e.tenant_id = t.tenant_id
      WHERE t.tenant_id = ?
        AND t.status IN ('pending', 'partial', 'disputed')
        AND (t.destination_type = 'admin_custody' OR e.role IN ('hospital_admin', 'md', 'director', 'accountant'))
        AND COALESCE(t.due_amount, t.amount, 0) > 0
    ) pending_cash
  `).bind(tenantId, tenantId).first<{ count: number; total: number }>();

  // Per-counter breakdown for today
  const counterBreakdown = await c.env.DB.prepare(`
    SELECT
      c.counter_name,
      c.counter_code,
      COUNT(*) as session_count,
      COALESCE(SUM(s.closing_cash_declared), 0) as total_collected
    FROM billing_counter_sessions s
    JOIN billing_counters c ON s.counter_id = c.id
    WHERE s.tenant_id = ?
      AND s.status = 'closed'
      AND date(s.closed_at) = ?
    GROUP BY c.id
    ORDER BY total_collected DESC
  `).bind(tenantId, date).all();

  return c.json({
    date,
    todayCollection: todayCollections?.total ?? 0,
    pendingCount: pendingStats?.count ?? 0,
    pendingAmount: pendingStats?.total ?? 0,
    counterBreakdown: counterBreakdown.results || [],
  });
});

billingCounterRoutes.post('/admin/collect/:handoverId', requirePermission('billing.counter.management_cash.receive'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const handoverId = Number(c.req.param('handoverId'));

  if (!Number.isInteger(handoverId) || handoverId <= 0) {
    throw new HTTPException(400, { message: 'Invalid handover ID' });
  }

  if (handoverId > CUSTODY_TRANSFER_ADMIN_ID_OFFSET) {
    const transferId = handoverId - CUSTODY_TRANSFER_ADMIN_ID_OFFSET;
    const transfer = await c.env.DB.prepare(`
      SELECT id, transfer_no, amount, received_amount, due_amount, status, counter_session_id, counter_id, transfer_by, transfer_to
      FROM billing_counter_cash_transfers
      WHERE tenant_id = ? AND id = ?
      LIMIT 1
    `).bind(tenantId, transferId).first<any>();

    if (!transfer) {
      throw new HTTPException(404, { message: 'Cash custody transfer not found' });
    }
    if (!['pending', 'partial', 'disputed'].includes(String(transfer.status))) {
      throw new HTTPException(400, { message: `Transfer already ${transfer.status}` });
    }

    const transferAmount = Number(transfer.amount ?? 0);
    const collectedAmount = Number(transfer.due_amount ?? transfer.amount ?? 0);
    if (!Number.isFinite(collectedAmount) || collectedAmount <= 0) {
      throw new HTTPException(400, { message: 'No pending cash left to collect' });
    }

    await c.env.DB.prepare(`
      UPDATE billing_counter_cash_transfers
      SET received_amount = ?, due_amount = 0, status = 'received', receiver_note = COALESCE(receiver_note, ?), received_by = ?, received_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id = ?
        AND status IN ('pending', 'partial', 'disputed')
    `).bind(transferAmount, 'Admin cash collection confirmed', userId, tenantId, transferId).run();

    await recordCashHandoverEvent(c, tenantId, 'admin-custody-transfer-collect-' + transferId, userId, collectedAmount, {
      transferId,
      transferNo: transfer.transfer_no,
      counterSessionId: transfer.counter_session_id,
      transferBy: transfer.transfer_by,
      transferTo: transfer.transfer_to,
      source: 'cash_custody_transfer_admin_collect',
    });

    await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_counter_cash_transfers', transferId, {
      status: transfer.status,
      dueAmount: Number(transfer.due_amount ?? 0),
    }, {
      status: 'received',
      receivedBy: userId,
      collectedAmount,
      dueAmount: 0,
    });

    return c.json({ message: 'Cash custody transfer collected successfully', handoverId, transferId, status: 'received' });
  }

  // Verify handover exists and is pending
  const handover = await c.env.DB.prepare(`
    SELECT h.id, h.handover_amount, h.due_amount, h.status, h.counter_session_id, h.handover_by, h.handover_to,
      s.counter_id
    FROM billing_handovers h
    LEFT JOIN billing_counter_sessions s ON h.counter_session_id = s.id AND s.tenant_id = h.tenant_id
    WHERE h.id = ? AND h.tenant_id = ? AND h.handover_type = 'counter'
      AND COALESCE(h.handover_purpose, 'management_collection') = 'management_collection'
  `).bind(handoverId, tenantId).first<{
    id: number;
    handover_amount: number;
    due_amount: number | null;
    status: string;
    counter_session_id: number;
    counter_id: number | null;
    handover_by: number;
    handover_to: number | null;
  }>();

  if (!handover) {
    throw new HTTPException(404, { message: 'Handover not found' });
  }

  if (!['pending', 'partial'].includes(handover.status)) {
    throw new HTTPException(400, { message: `Handover already ${handover.status}` });
  }

  const collectedAmount = handover.status === 'partial'
    ? Number(handover.due_amount ?? handover.handover_amount ?? 0)
    : Number(handover.handover_amount ?? 0);
  const updateStatement = c.env.DB.prepare(`
    UPDATE billing_handovers
    SET status = 'collected', received_by = ?, received_at = datetime('now', '+6 hours'), due_amount = 0
    WHERE id = ? AND tenant_id = ?
  `).bind(userId, handoverId, tenantId);

  if (collectedAmount > 0) {
    if (!handover.counter_session_id || !handover.counter_id) {
      throw new HTTPException(409, { message: 'Counter handover is missing counter session context' });
    }
    await c.env.DB.batch([
      updateStatement,
      c.env.DB.prepare(`
        INSERT OR IGNORE INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
        VALUES (?, ?, ?, ?, 'handover', ?, 'cash', 'billing_handover', ?, ?, ?)
      `).bind(
        tenantId,
        handover.counter_session_id,
        handover.counter_id,
        handover.handover_by,
        collectedAmount,
        String(handoverId),
        `Admin collected remaining handover ${handoverId}`,
        userId,
      ),
    ]);
  } else {
    await updateStatement.run();
  }

  await recordCashHandoverEvent(c, tenantId, `admin-collect-${handoverId}`, userId, collectedAmount, {
    handoverId,
    counterSessionId: handover.counter_session_id,
    handoverBy: handover.handover_by,
    handoverTo: handover.handover_to,
    source: 'admin_collect',
  });

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_handovers', handoverId, {
    status: handover.status,
    dueAmount: Number(handover.due_amount ?? 0),
  }, {
    status: 'collected',
    receivedBy: userId,
    collectedAmount,
  });

  return c.json({ message: 'Cash collected successfully', handoverId, status: 'collected' });
});

billingCounterRoutes.post('/admin/partial-collect/:handoverId', requirePermission('billing.counter.management_cash.partial_collect'), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const handoverId = Number(c.req.param('handoverId'));
  const { collectedAmount, remarks } = await c.req.json();

  if (!Number.isInteger(handoverId) || handoverId <= 0) {
    throw new HTTPException(400, { message: 'Invalid handover ID' });
  }

  const handover = await c.env.DB.prepare(`
    SELECT h.id, h.handover_amount, h.due_amount, h.status, h.counter_session_id, h.handover_by,
      s.counter_id
    FROM billing_handovers h
    LEFT JOIN billing_counter_sessions s ON h.counter_session_id = s.id AND s.tenant_id = h.tenant_id
    WHERE h.id = ? AND h.tenant_id = ? AND h.handover_type = 'counter'
      AND COALESCE(h.handover_purpose, 'management_collection') = 'management_collection'
  `).bind(handoverId, tenantId).first<{
    id: number;
    handover_amount: number;
    due_amount: number | null;
    status: string;
    counter_session_id: number | null;
    counter_id: number | null;
    handover_by: number;
  }>();

  if (!handover) {
    throw new HTTPException(404, { message: 'Handover not found' });
  }
  if (['collected', 'received', 'verified'].includes(String(handover.status))) {
    return c.json({ message: `Handover already ${handover.status}`, handoverId, status: handover.status, alreadySettled: true });
  }
  if (!['pending', 'partial', 'disputed'].includes(String(handover.status))) {
    throw new HTTPException(409, { message: `Handover cannot be collected while ${handover.status}` });
  }

  const currentDue = handover.status === 'partial'
    ? Number(handover.due_amount ?? handover.handover_amount)
    : Number(handover.handover_amount);
  if (!Number.isFinite(Number(collectedAmount)) || Number(collectedAmount) <= 0) {
    throw new HTTPException(400, { message: 'Collected amount must be greater than zero' });
  }
  if (Number(collectedAmount) > currentDue) {
    throw new HTTPException(400, { message: 'Collected amount cannot exceed handover amount' });
  }

  const remaining = currentDue - Number(collectedAmount);
  const newStatus = remaining === 0 ? 'collected' : 'partial';

  if (!handover.counter_session_id || !handover.counter_id) {
    throw new HTTPException(409, { message: 'Counter handover is missing counter session context' });
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`
      UPDATE billing_handovers
      SET status = ?, received_by = ?, received_at = datetime('now', '+6 hours'), due_amount = ?, remarks = COALESCE(?, remarks)
      WHERE id = ? AND tenant_id = ?
    `).bind(newStatus, userId, remaining, remarks ?? `Partial collection: ${collectedAmount}`, handoverId, tenantId),
    c.env.DB.prepare(`
      INSERT OR IGNORE INTO cash_drawer_movements
        (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
      VALUES (?, ?, ?, ?, 'handover', ?, 'cash', 'billing_handover', ?, ?, ?)
    `).bind(
      tenantId,
      handover.counter_session_id,
      handover.counter_id,
      handover.handover_by,
      Number(collectedAmount),
      String(handoverId),
      remarks ?? `Partial admin collection for handover ${handoverId}`,
      userId,
    ),
  ]);

  await recordCashHandoverEvent(c, tenantId, `admin-partial-collect-${handoverId}-${currentDue}-${Number(collectedAmount)}-${remaining}`, userId, Number(collectedAmount), {
    handoverId,
    handoverTotal: Number(handover.handover_amount ?? 0),
    previousDueAmount: currentDue,
    remainingAmount: remaining,
    source: 'admin_partial_collect',
  });

  await createAuditLog(c.env, tenantId, userId, 'UPDATE', 'billing_handovers', handoverId, {
    status: handover.status,
    dueAmount: currentDue,
  }, {
    status: newStatus,
    receivedBy: userId,
    collectedAmount: Number(collectedAmount),
    remainingAmount: remaining,
  });

  return c.json({
    message: `${newStatus === 'collected' ? 'Fully' : 'Partially'} collected`,
    handoverId,
    status: newStatus,
    collectedAmount,
    remainingAmount: remaining,
  });
});

billingCounterRoutes.get('/sessions/history', async (c) => {
  const tenantId = requireTenantId(c);
  const date = c.req.query('date') || getTodayGMT6();
  const staffId = c.req.query('staff_id');
  const status = c.req.query('status');

  let where = 'WHERE s.tenant_id = ? AND date(s.closed_at) = ?';
  const params: (string | number)[] = [tenantId, date];

  if (staffId) {
    where += ' AND s.employee_id = ?';
    params.push(Number(staffId));
  }
  if (status) {
    where += ' AND s.status = ?';
    params.push(status);
  }

  const sessions = await c.env.DB.prepare(`
    SELECT
      s.id,
      s.session_no,
      c.counter_name,
      c.counter_code,
      u.name as cashier_name,
      s.opening_cash,
      s.closing_cash_declared,
      s.expected_cash,
      s.variance,
      s.status,
      s.opened_at,
      s.closed_at,
      h.status as handover_status,
      h.handover_amount,
      h.received_by
    FROM billing_counter_sessions s
    JOIN billing_counters c ON s.counter_id = c.id
    JOIN users u ON s.employee_id = u.id
    LEFT JOIN billing_handovers h ON h.counter_session_id = s.id AND h.handover_type = 'counter'
    ${where}
    ORDER BY s.closed_at DESC
    LIMIT 50
  `).bind(...params).all();

  const data = (sessions.results || []).map((s: any) => ({
    id: s.id,
    sessionNo: s.session_no,
    counterName: s.counter_name,
    counterCode: s.counter_code,
    cashierName: s.cashier_name,
    openingCash: s.opening_cash,
    closingCashDeclared: s.closing_cash_declared,
    expectedCash: s.expected_cash,
    variance: s.variance,
    status: s.status,
    openedAt: s.opened_at,
    closedAt: s.closed_at,
    handoverStatus: s.handover_status,
    handoverAmount: s.handover_amount,
    handoverReceivedBy: s.received_by,
  }));

  return c.json({ sessions: data, date, count: data.length });
});

billingCounterRoutes.get('/performer-payout-rules', requirePermission('billing.counter.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const serviceItemIds = Array.from(new Set(
    (c.req.query('service_item_ids') ?? '')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  )).slice(0, 100);

  if (serviceItemIds.length === 0) return c.json({ data: [] });

  const placeholders = serviceItemIds.map(() => '?').join(',');
  const { results } = await c.env.DB.prepare(`
    SELECT
      r.id,
      r.billing_service_item_id,
      r.rate_type,
      r.rate_value,
      r.effective_from,
      si.price
    FROM diagnostic_performer_payout_rules r
    JOIN billing_service_items si
      ON si.id = r.billing_service_item_id
     AND si.tenant_id = r.tenant_id
     AND COALESCE(si.is_active, 1) = 1
    JOIN billing_service_departments sd
      ON sd.id = si.service_department_id
     AND sd.tenant_id = si.tenant_id
     AND COALESCE(sd.is_active, 1) = 1
    WHERE r.tenant_id = ?
      AND r.billing_service_item_id IN (${placeholders})
      AND r.is_active = 1
      AND date(r.effective_from) <= date('now', '+6 hours')
      AND (r.effective_to IS NULL OR date(r.effective_to) >= date('now', '+6 hours'))
      AND sd.department_code IN ('LAB', 'RAD')
    ORDER BY r.billing_service_item_id ASC, r.effective_from DESC, r.id DESC
  `).bind(tenantId, ...serviceItemIds).all<{
    id: number;
    billing_service_item_id: number;
    rate_type: 'flat' | 'percent';
    rate_value: number;
    effective_from: string;
    price: number;
  }>();

  const latestByItem = new Map<number, {
    billingServiceItemId: number;
    rateType: 'flat' | 'percent';
    rateValue: number;
    displayAmount: number;
    effectiveFrom: string;
  }>();

  for (const row of results ?? []) {
    const serviceItemId = Number(row.billing_service_item_id);
    if (latestByItem.has(serviceItemId)) continue;
    const rateValue = Number(row.rate_value ?? 0);
    const price = Number(row.price ?? 0);
    const displayAmount = row.rate_type === 'percent'
      ? Math.max(0, roundAmount((price * rateValue) / 10_000))
      : Math.max(0, roundAmount(rateValue));
    latestByItem.set(serviceItemId, {
      billingServiceItemId: serviceItemId,
      rateType: row.rate_type,
      rateValue,
      displayAmount: Math.min(Math.max(0, price), displayAmount),
      effectiveFrom: row.effective_from,
    });
  }

  return c.json({ data: Array.from(latestByItem.values()) });
});

export default billingCounterRoutes;
