import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import {
  createCommissionSchema,
  doctorCommissionRuleSchema,
  markCommissionPaidSchema,
  updateDoctorCommissionRuleSchema,
  approveDoctorCommissionsSchema,
  settleDoctorCommissionsSchema,
} from '../../schemas/commission';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { createAuditLog } from '../../lib/accounting-helpers';
import { requireRole } from '../../middleware/rbac';
import {
  ACCOUNTING_EVENT_TYPES,
  recordAndPostAccountingEvent,
} from '../../lib/accounting-posting';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import { normalizeCommissionRuleRateValue } from '../../lib/lab-finance';
import { normalizeDoctorCommissionWaiverConfiguration } from '../../lib/doctor-commission-waiver-policy';
import { prepareDoctorCommissionRecoveryStatements } from '../../lib/doctor-commission-recovery';
import { executeLiveCompensationSettlement } from '../../lib/canonical/live-compensation-settlement';
import {
  buildDoctorCommissionRuleContext,
  createRouteCompensationRule,
  replaceRouteCompensationRule,
  retireRouteCompensationRule,
  type LegacyDoctorCommissionRuleSnapshot,
  type LegacyDoctorReference,
  type LegacyLabServiceReference,
} from '../../lib/canonical/compensation-rule-route-integration';
import { createDeterministicSourceId } from '../../lib/canonical/source-mapping';
import {
  provideCompensationAccrualRead,
  resolveCompensationAccrualProviderMode,
} from '../../lib/canonical/contracts/compensation-accrual-provider';
import { auditRequestMetadata, prepareMasterDataAudit } from '../../lib/master-data-audit';
import {
  isFinancialBatchAssertionError,
  prepareClearFinancialBatchAssertions,
  prepareFinancialBatchAssertion,
} from '../../lib/canonical/financial-batch-assertion';

const commissionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const COMMISSION_ADMIN_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

const billPaidPredicate = (billAlias = 'b') => `(
  ${billAlias}.id IS NOT NULL
  AND (
    COALESCE(${billAlias}.status, 'open') = 'paid'
    OR (
      COALESCE(${billAlias}.total, 0) > 0
      AND COALESCE(${billAlias}.paid, 0) >= COALESCE(${billAlias}.total, 0)
    )
  )
)`;

interface DoctorPayableLedgerRow {
  doctor_id: number;
  doctor_name: string;
  doctor_specialization: string | null;
  payable_gross_amount: number;
  payable_amount: number;
  paid_amount: number;
  cancelled_amount: number;
  outstanding_count: number;
  paid_count: number;
  cancelled_count: number;
  settlement_count: number;
  settled_amount: number;
  last_accrued_date: string | null;
  last_settlement_date: string | null;
}

interface CommissionPayoutAccrualRow {
  id: number;
  doctor_id: number;
  doctor_canonical_source_key: string | null;
  doctor_name: string;
  doctor_specialization: string | null;
  doctor_department: string | null;
  doctor_registration_number: string | null;
  doctor_user_id: number | null;
  doctor_is_active: number;
  gross_amount: number;
  commission_amount: number;
  payable_amount: number;
  canonical_source_key: string | null;
  status: string;
  bill_is_paid: number;
}

const effectivePayableCommission = (alias = 'a') => `MAX(0, CASE
  WHEN COALESCE(${alias}.earned_commission_amount, 0) != 0
    OR COALESCE(${alias}.doctor_waiver_amount, 0) != 0
    OR COALESCE(${alias}.payable_commission_amount, 0) != 0
  THEN COALESCE(${alias}.payable_commission_amount, 0)
  ELSE COALESCE(${alias}.commission_amount, 0)
END)`;

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function legacyCompensationStatusFromCanonical(
  status: 'accrued' | 'partially_settled' | 'settled' | 'reversed',
  current: unknown,
): 'accrued' | 'approved' | 'paid' | 'cancelled' {
  if (status === 'settled') return 'paid';
  if (status === 'reversed') return 'cancelled';
  if (status === 'partially_settled') return 'approved';
  return current === 'approved' ? 'approved' : 'accrued';
}

type DoctorCommissionRuleLegacyRow = {
  id: number;
  canonical_source_key: string | null;
  doctor_id: number;
  service_type: 'lab_test' | 'consultation_fee' | 'referral' | 'procedure' | 'ipd_round';
  lab_test_id: number | null;
  category: string | null;
  rate_type: 'percent' | 'flat';
  rate_value: number;
  waiver_policy: 'full_earned' | 'protected_floor' | 'no_doctor_waiver';
  protected_rate_bps: number;
  protected_flat_amount: number;
  incentive_type: 'performer' | 'prescriber' | 'referrer';
  effective_from: string | null;
  effective_to: string | null;
  is_active: number;
  rule_version: number;
  notes: string | null;
};

function requestIdempotencyKey(
  request: { header(name: string): string | undefined },
): string | null {
  const value = request.header('Idempotency-Key')?.trim();
  return value || null;
}

async function createDoctorRuleSourceKey(
  tenantId: string,
  suppliedIdempotencyKey: string | null,
): Promise<string> {
  if (suppliedIdempotencyKey) {
    return createDeterministicSourceId(
      'dcr',
      tenantId,
      'doctor_commission_rule_route',
      suppliedIdempotencyKey,
    );
  }
  return `dcr_${crypto.randomUUID().replace(/-/g, '')}`;
}

async function loadDoctorRuleReference(
  db: D1Database,
  tenantId: string,
  doctorId: number,
): Promise<LegacyDoctorReference> {
  const row = await db.prepare(`
    SELECT id,name,is_active
    FROM doctors
    WHERE id=? AND tenant_id=?
    LIMIT 1
  `).bind(doctorId, tenantId).first<{ id: number; name: string; is_active: number }>();
  if (!row) throw new HTTPException(400, { message: 'Doctor not found' });
  return { id: Number(row.id), name: row.name, isActive: Number(row.is_active ?? 1) === 1 };
}

async function loadLabRuleReference(
  db: D1Database,
  tenantId: string,
  labTestId: number | null,
): Promise<LegacyLabServiceReference | null> {
  if (labTestId == null) return null;
  const row = await db.prepare(`
    SELECT id,code,name,is_active
    FROM lab_test_catalog
    WHERE id=? AND tenant_id=?
    LIMIT 1
  `).bind(labTestId, tenantId).first<{ id: number; code: string | null; name: string; is_active: number }>();
  if (!row) throw new HTTPException(400, { message: 'Lab test not found' });
  return {
    id: Number(row.id),
    code: row.code ?? null,
    name: row.name,
    isActive: Number(row.is_active ?? 1) === 1,
  };
}

function doctorRuleSnapshot(input: {
  doctorId: number;
  serviceType: DoctorCommissionRuleLegacyRow['service_type'];
  labTestId: number | null;
  category: string | null;
  rateType: DoctorCommissionRuleLegacyRow['rate_type'];
  rateValue: number;
  waiverPolicy: DoctorCommissionRuleLegacyRow['waiver_policy'];
  protectedRateBps: number;
  protectedFlatAmount: number;
  incentiveType: DoctorCommissionRuleLegacyRow['incentive_type'];
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
}): LegacyDoctorCommissionRuleSnapshot {
  return {
    doctorId: Number(input.doctorId),
    serviceType: input.serviceType,
    labTestId: input.labTestId == null ? null : Number(input.labTestId),
    category: input.category ?? null,
    rateType: input.rateType,
    rateValue: Number(input.rateValue),
    waiverPolicy: input.waiverPolicy,
    protectedRateBps: Number(input.protectedRateBps ?? 0),
    protectedFlatAmount: Number(input.protectedFlatAmount ?? 0),
    incentiveType: input.incentiveType,
    effectiveFrom: input.effectiveFrom ?? '1970-01-01',
    effectiveTo: input.effectiveTo ?? null,
    isActive: input.isActive,
  };
}

type CommissionManagementPaymentMode = 'cash' | 'bank' | 'cheque' | 'card' | 'mobile_banking' | 'other';

function settlementPaymentMethod(paymentMode: CommissionManagementPaymentMode): 'cash' | 'bank' | 'mobile_banking' {
  if (paymentMode === 'cash') return 'cash';
  if (paymentMode === 'mobile_banking') return 'mobile_banking';
  return 'bank';
}

function canonicalCompensationPaymentMethod(
  paymentMode: CommissionManagementPaymentMode,
): 'cash' | 'bank_transfer' | 'mobile_wallet' | 'card' | 'other' {
  if (paymentMode === 'cash') return 'cash';
  if (paymentMode === 'bank' || paymentMode === 'cheque') return 'bank_transfer';
  if (paymentMode === 'mobile_banking') return 'mobile_wallet';
  if (paymentMode === 'card') return 'card';
  return 'other';
}

async function executeCommissionManagementPayout(input: {
  db: D1Database;
  tenantId: string;
  userId: string | number;
  accruals: CommissionPayoutAccrualRow[];
  settlementDate: string;
  paymentMode: CommissionManagementPaymentMode;
  referenceNo?: string | null;
  notes?: string | null;
}): Promise<{
  settlementId: number;
  settlementNumber: string;
  grossCommissionAmount: number;
  clawbackDeduction: number;
  netPaidAmount: number;
  clawbackApplications: Array<{ adjustmentId: number; amount: number }>;
  voucherId: number | null;
}> {
  const first = input.accruals[0];
  if (!first) throw new HTTPException(400, { message: 'At least one doctor commission accrual is required' });
  const doctorId = Number(first.doctor_id);
  if (input.accruals.some((row) => Number(row.doctor_id) !== doctorId)) {
    throw new HTTPException(400, { message: 'Selected accruals do not belong to one doctor' });
  }

  const grossCommissionAmount = money(input.accruals.reduce((sum, row) => sum + money(row.payable_amount), 0));
  if (grossCommissionAmount <= 0) {
    throw new HTTPException(400, { message: 'Doctor commission settlement amount must be positive' });
  }

  const settlementSourceId = `commission-management-${crypto.randomUUID()}`;
  const settlementNumber = input.referenceNo?.trim()
    || `DCS-${input.settlementDate.replaceAll('-', '')}-${settlementSourceId.slice(-8).toUpperCase()}`;
  const recovery = await prepareDoctorCommissionRecoveryStatements(input.db, {
    tenantId: input.tenantId,
    doctorId,
    settlementIdempotencyKey: settlementSourceId,
    maxDeduction: Math.max(0, money(grossCommissionAmount - 0.01)),
    createdBy: input.userId,
  });
  const clawbackDeduction = recovery.totalDeduction;
  const netPaidAmount = money(grossCommissionAmount - clawbackDeduction);
  if (netPaidAmount <= 0) {
    throw new HTTPException(400, { message: 'Doctor commission payout must remain positive after recovery' });
  }

  const settlementInsert = input.db.prepare(`
    INSERT INTO doctor_commission_settlements (
      tenant_id,doctor_id,settlement_date,total_amount,payment_mode,payment_method,
      reference_no,settlement_no,gross_commission_amount,net_paid_amount,
      idempotency_key,notes,created_by
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    input.tenantId,
    doctorId,
    input.settlementDate,
    netPaidAmount,
    input.paymentMode,
    settlementPaymentMethod(input.paymentMode),
    input.referenceNo ?? null,
    settlementNumber,
    grossCommissionAmount,
    netPaidAmount,
    settlementSourceId,
    input.notes ?? null,
    input.userId,
  );

  const settlementItemInserts = input.accruals.map((row) => input.db.prepare(`
    INSERT INTO doctor_commission_settlement_items (
      tenant_id,settlement_id,accrual_id,doctor_id,source_type,bill_id,patient_id,
      service_date,gross_amount,commission_amount,calculated_commission_amount
    )
    SELECT a.tenant_id,s.id,a.id,a.doctor_id,a.source_type,a.bill_id,a.patient_id,
           a.accrued_date,COALESCE(a.gross_amount,0),?,?
    FROM doctor_commission_accruals a
    JOIN doctor_commission_settlements s
      ON s.tenant_id = a.tenant_id
     AND s.doctor_id = a.doctor_id
     AND s.idempotency_key = ?
    LEFT JOIN bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
    WHERE a.tenant_id = ?
      AND a.doctor_id = ?
      AND a.id = ?
      AND a.status = 'approved'
      AND ${billPaidPredicate('b')}
  `).bind(
    money(row.payable_amount),
    money(row.payable_amount),
    settlementSourceId,
    input.tenantId,
    doctorId,
    row.id,
  ));

  const accrualUpdates = input.accruals.map((row) => input.db.prepare(`
    UPDATE doctor_commission_accruals
    SET status = 'paid',
        paid_date = ?,
        paid_amount = ?,
        balance_amount = 0,
        settlement_id = (
          SELECT s.id FROM doctor_commission_settlements s
          WHERE s.tenant_id = ? AND s.idempotency_key = ? LIMIT 1
        ),
        notes = COALESCE(?, notes),
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND doctor_id = ?
      AND id = ?
      AND status = 'approved'
  `).bind(
    input.settlementDate,
    money(row.payable_amount),
    input.tenantId,
    settlementSourceId,
    input.notes ?? null,
    input.tenantId,
    doctorId,
    row.id,
  ));

  const placeholders = input.accruals.map(() => '?').join(',');
  const transitionGuard = input.db.prepare(`
    INSERT INTO doctor_commission_settlement_items (
      tenant_id,settlement_id,accrual_id,doctor_id,source_type,gross_amount,commission_amount
    )
    SELECT NULL,s.id,-1,s.doctor_id,'transition_guard',0,0
    FROM doctor_commission_settlements s
    WHERE s.tenant_id = ?
      AND s.idempotency_key = ?
      AND (
        (SELECT COUNT(*) FROM doctor_commission_settlement_items item
         WHERE item.tenant_id = ? AND item.settlement_id = s.id) <> ?
        OR (SELECT COUNT(*) FROM doctor_commission_accruals accrual
            WHERE accrual.tenant_id = ?
              AND accrual.doctor_id = ?
              AND accrual.id IN (${placeholders})
              AND accrual.status = 'paid'
              AND accrual.settlement_id = s.id) <> ?
        OR ROUND(COALESCE((SELECT SUM(item.commission_amount)
                           FROM doctor_commission_settlement_items item
                           WHERE item.tenant_id = ? AND item.settlement_id = s.id),0),2) <> ?
      )
  `).bind(
    input.tenantId,
    settlementSourceId,
    input.tenantId,
    input.accruals.length,
    input.tenantId,
    doctorId,
    ...input.accruals.map((row) => row.id),
    input.accruals.length,
    input.tenantId,
    grossCommissionAmount,
  );

  const legacyStatements = [
    settlementInsert,
    ...recovery.statements,
    ...settlementItemInserts,
    ...accrualUpdates,
    transitionGuard,
  ];

  await executeLiveCompensationSettlement(input.db, {
    tenantId: input.tenantId,
    legacyStatements,
    settlementSourceId,
    settlementNumber,
    practitioner: {
      doctorId,
      canonicalSourceKey: first.doctor_canonical_source_key,
      displayName: first.doctor_name || `Doctor #${doctorId}`,
      specialty: first.doctor_specialization,
      department: first.doctor_department,
      registrationNumber: first.doctor_registration_number,
      userId: first.doctor_user_id,
      isActive: Number(first.doctor_is_active ?? 1) === 1,
    },
    paymentMethod: canonicalCompensationPaymentMethod(input.paymentMode),
    grossAmount: grossCommissionAmount,
    netPaidAmount,
    settledAtUtc: new Date().toISOString(),
    businessDate: input.settlementDate,
    accruals: input.accruals.map((row) => ({
      sourceType: 'legacy_doctor_commission_accrual' as const,
      sourcePublicId: row.canonical_source_key?.trim() || String(row.id),
      expectedPayableAmount: money(row.payable_amount),
      settlementPayableAmount: money(row.payable_amount),
    })),
  });

  const settlement = await input.db.prepare(`
    SELECT id FROM doctor_commission_settlements
    WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1
  `).bind(input.tenantId, settlementSourceId).first<{ id: number }>();
  const settlementId = Number(settlement?.id ?? 0);
  if (!Number.isSafeInteger(settlementId) || settlementId <= 0) {
    throw new HTTPException(500, { message: 'Doctor commission settlement failed to allocate id' });
  }

  const postResult = await recordAndPostAccountingEvent(input.db, {
    tenantId: input.tenantId,
    sourceType: 'doctor_commission_settlement',
    sourceId: settlementId,
    eventType: ACCOUNTING_EVENT_TYPES.commissionSettled,
    eventDate: input.settlementDate,
    createdBy: input.userId,
    payload: {
      settlementId,
      settlementNo: settlementNumber,
      doctorId,
      accrualIds: input.accruals.map((row) => row.id),
      amount: netPaidAmount,
      grossCommissionAmount,
      clawbackDeduction,
      netPaidAmount,
      paymentMethod: input.paymentMode,
      referenceNo: input.referenceNo ?? null,
    },
  });

  if (postResult.voucherId) {
    await input.db.prepare(`
      UPDATE doctor_commission_settlements
      SET voucher_id = ?, accounting_voucher_id = ?
      WHERE id = ? AND tenant_id = ?
    `).bind(postResult.voucherId, postResult.voucherId, settlementId, input.tenantId).run();
  }

  return {
    settlementId,
    settlementNumber,
    grossCommissionAmount,
    clawbackDeduction,
    netPaidAmount,
    clawbackApplications: recovery.applications,
    voucherId: postResult.voucherId ?? null,
  };
}

// GET /api/commissions/doctor-rules — list doctor incentive rules
commissionRoutes.get('/doctor-rules', requireRole(...COMMISSION_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { doctorId, serviceType, active } = c.req.query();

  try {
    let query = `
      SELECT
        r.*,
        d.name as doctor_name,
        d.specialty as doctor_specialization,
        ltc.name as lab_test_name,
        ltc.code as lab_test_code
      FROM doctor_commission_rules r
      JOIN doctors d ON d.id = r.doctor_id AND d.tenant_id = r.tenant_id
      LEFT JOIN lab_test_catalog ltc ON ltc.id = r.lab_test_id AND ltc.tenant_id = r.tenant_id
      WHERE r.tenant_id = ?`;
    const params: (string | number)[] = [tenantId];

    if (doctorId) { query += ' AND r.doctor_id = ?'; params.push(Number(doctorId)); }
    if (serviceType) { query += ' AND r.service_type = ?'; params.push(serviceType); }
    if (active === 'true') { query += ' AND r.is_active = 1'; }
    if (active === 'false') { query += ' AND r.is_active = 0'; }

    query += ' ORDER BY r.is_active DESC, r.service_type ASC, d.name ASC, r.id DESC';
    const rules = await db.$client.prepare(query).bind(...params).all();
    return c.json({ rules: rules.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch doctor commission rules' });
  }
});

// POST /api/commissions/doctor-rules — create doctor incentive rule
commissionRoutes.post('/doctor-rules', requireRole(...COMMISSION_ADMIN_ROLES), zValidator('json', doctorCommissionRuleSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const normalizedRateValue = normalizeCommissionRuleRateValue(data.rateType, data.rateValue);
    const waiverConfig = normalizeDoctorCommissionWaiverConfiguration({
      rateType: data.rateType,
      commissionRateValue: normalizedRateValue,
      waiverPolicy: data.waiverPolicy,
      protectedRate: data.protectedRate,
      protectedFlatAmount: data.protectedFlatAmount,
    });
    const suppliedIdempotencyKey = requestIdempotencyKey(c.req);
    const sourcePublicId = await createDoctorRuleSourceKey(tenantId, suppliedIdempotencyKey);
    const effectiveFrom = data.effectiveFrom ?? getTodayGMT6();
    const doctor = await loadDoctorRuleReference(c.env.DB, tenantId, data.doctorId);
    const labService = await loadLabRuleReference(c.env.DB, tenantId, data.labTestId ?? null);
    const snapshot = doctorRuleSnapshot({
      doctorId: data.doctorId,
      serviceType: data.serviceType,
      labTestId: data.labTestId ?? null,
      category: data.category ?? null,
      rateType: data.rateType,
      rateValue: normalizedRateValue,
      waiverPolicy: waiverConfig.waiverPolicy,
      protectedRateBps: waiverConfig.protectedRateBps,
      protectedFlatAmount: waiverConfig.protectedFlatAmount,
      incentiveType: data.incentiveType,
      effectiveFrom,
      effectiveTo: data.effectiveTo ?? null,
      isActive: data.isActive !== false,
    });
    const context = await buildDoctorCommissionRuleContext(c.env.DB, {
      tenantId,
      sourcePublicId,
      rule: snapshot,
      doctor,
      labService,
    });
    const legacyInsert = c.env.DB.prepare(`
      INSERT INTO doctor_commission_rules
        (tenant_id, doctor_id, service_type, lab_test_id, category, rate_type, rate_value,
         waiver_policy, protected_rate_bps, protected_flat_amount, canonical_source_key,
         incentive_type, effective_from, effective_to, is_active, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      tenantId,
      data.doctorId,
      data.serviceType,
      data.labTestId ?? null,
      data.category ?? null,
      data.rateType,
      normalizedRateValue,
      waiverConfig.waiverPolicy,
      waiverConfig.protectedRateBps,
      waiverConfig.protectedFlatAmount,
      sourcePublicId,
      data.incentiveType,
      effectiveFrom,
      data.effectiveTo ?? null,
      data.isActive === false ? 0 : 1,
      data.notes ?? null,
      userId,
    );
    const audit = prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'CREATE',
      tableName: 'doctor_commission_rules',
      recordId: sourcePublicId,
      oldValue: null,
      newValue: {
        canonicalSourceKey: sourcePublicId,
        doctorId: data.doctorId,
        serviceType: data.serviceType,
        waiverPolicy: waiverConfig.waiverPolicy,
        protectedRateBps: waiverConfig.protectedRateBps,
        protectedFlatAmount: waiverConfig.protectedFlatAmount,
      },
      ...auditRequestMetadata(c),
    });
    await createRouteCompensationRule(c.env.DB, context, {
      authoritativeStatements: [legacyInsert, audit],
      occurredAtUtc: new Date().toISOString(),
      businessDate: getTodayGMT6(),
      idempotencyKey: `route:doctor-rule:create:${suppliedIdempotencyKey ?? sourcePublicId}`,
    });
    const created = await c.env.DB.prepare(`
      SELECT id FROM doctor_commission_rules
      WHERE tenant_id=? AND canonical_source_key=?
      LIMIT 1
    `).bind(tenantId, sourcePublicId).first<{ id: number }>();
    if (!created?.id) throw new Error('Created doctor commission rule could not be resolved');

    return c.json({ message: 'Doctor commission rule saved', id: Number(created.id) }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (error instanceof RangeError || error instanceof TypeError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw new HTTPException(500, { message: 'Failed to save doctor commission rule' });
  }
});

// PUT /api/commissions/doctor-rules/:id — update doctor incentive rule
commissionRoutes.put('/doctor-rules/:id', requireRole(...COMMISSION_ADMIN_ROLES), zValidator('json', updateDoctorCommissionRuleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(`
      SELECT
        id,
        canonical_source_key,
        doctor_id,
        service_type,
        lab_test_id,
        category,
        rate_type,
        rate_value,
        waiver_policy,
        protected_rate_bps,
        protected_flat_amount,
        incentive_type,
        effective_from,
        effective_to,
        is_active,
        rule_version,
        notes
      FROM doctor_commission_rules
      WHERE id = ? AND tenant_id = ?
    `).bind(id, tenantId).first<DoctorCommissionRuleLegacyRow>();
    if (!existing) throw new HTTPException(404, { message: 'Doctor commission rule not found' });

    const nextRateType = data.rateType ?? existing.rate_type;
    const nextRateValue = data.rateValue !== undefined
      ? normalizeCommissionRuleRateValue(nextRateType, data.rateValue)
      : existing.rate_value;
    const waiverConfig = normalizeDoctorCommissionWaiverConfiguration({
      rateType: nextRateType,
      commissionRateValue: nextRateValue,
      waiverPolicy: data.waiverPolicy ?? existing.waiver_policy,
      protectedRate: data.protectedRate,
      protectedRateBps: data.protectedRate === undefined ? existing.protected_rate_bps : undefined,
      protectedFlatAmount: data.protectedFlatAmount ?? existing.protected_flat_amount,
    });
    const sourcePublicId = existing.canonical_source_key ?? String(existing.id);
    const currentSnapshot = doctorRuleSnapshot({
      doctorId: existing.doctor_id,
      serviceType: existing.service_type,
      labTestId: existing.lab_test_id,
      category: existing.category,
      rateType: existing.rate_type,
      rateValue: existing.rate_value,
      waiverPolicy: existing.waiver_policy,
      protectedRateBps: existing.protected_rate_bps,
      protectedFlatAmount: existing.protected_flat_amount,
      incentiveType: existing.incentive_type,
      effectiveFrom: existing.effective_from,
      effectiveTo: existing.effective_to,
      isActive: Number(existing.is_active) === 1,
    });
    const nextSnapshot = doctorRuleSnapshot({
      doctorId: data.doctorId ?? existing.doctor_id,
      serviceType: data.serviceType ?? existing.service_type,
      labTestId: data.labTestId !== undefined ? data.labTestId : existing.lab_test_id,
      category: data.category !== undefined ? data.category : existing.category,
      rateType: nextRateType,
      rateValue: nextRateValue,
      waiverPolicy: waiverConfig.waiverPolicy,
      protectedRateBps: waiverConfig.protectedRateBps,
      protectedFlatAmount: waiverConfig.protectedFlatAmount,
      incentiveType: data.incentiveType ?? existing.incentive_type,
      effectiveFrom: data.effectiveFrom !== undefined ? data.effectiveFrom : existing.effective_from,
      effectiveTo: data.effectiveTo !== undefined ? data.effectiveTo : existing.effective_to,
      isActive: data.isActive !== undefined ? data.isActive : Number(existing.is_active) === 1,
    });
    const currentDoctor = await loadDoctorRuleReference(c.env.DB, tenantId, currentSnapshot.doctorId);
    const nextDoctor = currentSnapshot.doctorId === nextSnapshot.doctorId
      ? currentDoctor
      : await loadDoctorRuleReference(c.env.DB, tenantId, nextSnapshot.doctorId);
    const currentLab = await loadLabRuleReference(c.env.DB, tenantId, currentSnapshot.labTestId);
    const nextLab = currentSnapshot.labTestId === nextSnapshot.labTestId
      ? currentLab
      : await loadLabRuleReference(c.env.DB, tenantId, nextSnapshot.labTestId);
    const currentContext = await buildDoctorCommissionRuleContext(c.env.DB, {
      tenantId,
      sourcePublicId,
      rule: currentSnapshot,
      doctor: currentDoctor,
      labService: currentLab,
    });
    const nextContext = await buildDoctorCommissionRuleContext(c.env.DB, {
      tenantId,
      sourcePublicId,
      rule: nextSnapshot,
      doctor: nextDoctor,
      labService: nextLab,
    });

    const assignments = [
      'canonical_source_key = COALESCE(canonical_source_key, ?)',
      'rate_type = ?',
      'rate_value = ?',
      'waiver_policy = ?',
      'protected_rate_bps = ?',
      'protected_flat_amount = ?',
    ];
    const params: Array<string | number | null> = [
      sourcePublicId,
      nextRateType,
      nextRateValue,
      waiverConfig.waiverPolicy,
      waiverConfig.protectedRateBps,
      waiverConfig.protectedFlatAmount,
    ];
    const addAssignment = (column: string, value: string | number | null) => {
      assignments.push(`${column} = ?`);
      params.push(value);
    };

    if (data.doctorId !== undefined) addAssignment('doctor_id', data.doctorId);
    if (data.serviceType !== undefined) addAssignment('service_type', data.serviceType);
    if (data.labTestId !== undefined) addAssignment('lab_test_id', data.labTestId);
    if (data.category !== undefined) addAssignment('category', data.category);
    if (data.incentiveType !== undefined) addAssignment('incentive_type', data.incentiveType);
    if (data.effectiveFrom !== undefined) addAssignment('effective_from', data.effectiveFrom);
    if (data.effectiveTo !== undefined) addAssignment('effective_to', data.effectiveTo);
    if (data.isActive !== undefined) addAssignment('is_active', data.isActive ? 1 : 0);
    if (data.notes !== undefined) addAssignment('notes', data.notes);
    assignments.push('rule_version = rule_version + 1');
    assignments.push("updated_at = datetime('now', '+6 hours')");

    const legacyUpdate = c.env.DB.prepare(`
      UPDATE doctor_commission_rules
      SET ${assignments.join(', ')}
      WHERE id = ? AND tenant_id = ?
    `).bind(
      ...params,
      id,
      tenantId,
    );
    const audit = prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'UPDATE',
      tableName: 'doctor_commission_rules',
      recordId: Number(id),
      oldValue: existing,
      newValue: { ruleId: Number(id), canonicalSourceKey: sourcePublicId, changes: data },
      ...auditRequestMetadata(c),
    });
    const suppliedIdempotencyKey = requestIdempotencyKey(c.req);
    await replaceRouteCompensationRule(c.env.DB, currentContext, nextContext, {
      authoritativeStatements: [legacyUpdate, audit],
      occurredAtUtc: new Date().toISOString(),
      businessDate: getTodayGMT6(),
      idempotencyKey: `route:doctor-rule:replace:${suppliedIdempotencyKey ?? `${sourcePublicId}:${nextContext.snapshot.sourceEvidenceSha256}`}`,
    });

    return c.json({ message: 'Doctor commission rule updated' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (error instanceof RangeError || error instanceof TypeError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw new HTTPException(500, { message: 'Failed to update doctor commission rule' });
  }
});

// DELETE /api/commissions/doctor-rules/:id — delete doctor incentive rule
commissionRoutes.delete('/doctor-rules/:id', requireRole(...COMMISSION_ADMIN_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id <= 0) {
    throw new HTTPException(400, { message: 'Invalid doctor commission rule id' });
  }

  try {
    const existing = await c.env.DB.prepare(`
      SELECT id,canonical_source_key,doctor_id,service_type,lab_test_id,category,
             rate_type,rate_value,waiver_policy,protected_rate_bps,protected_flat_amount,
             incentive_type,effective_from,effective_to,is_active,notes
      FROM doctor_commission_rules
      WHERE id=? AND tenant_id=?
      LIMIT 1
    `).bind(id, tenantId).first<DoctorCommissionRuleLegacyRow>();
    if (!existing) throw new HTTPException(404, { message: 'Doctor commission rule not found' });

    const sourcePublicId = existing.canonical_source_key ?? String(existing.id);
    const snapshot = doctorRuleSnapshot({
      doctorId: existing.doctor_id,
      serviceType: existing.service_type,
      labTestId: existing.lab_test_id,
      category: existing.category,
      rateType: existing.rate_type,
      rateValue: existing.rate_value,
      waiverPolicy: existing.waiver_policy,
      protectedRateBps: existing.protected_rate_bps,
      protectedFlatAmount: existing.protected_flat_amount,
      incentiveType: existing.incentive_type,
      effectiveFrom: existing.effective_from,
      effectiveTo: existing.effective_to,
      isActive: Number(existing.is_active) === 1,
    });
    const doctor = await loadDoctorRuleReference(c.env.DB, tenantId, snapshot.doctorId);
    const labService = await loadLabRuleReference(c.env.DB, tenantId, snapshot.labTestId);
    const context = await buildDoctorCommissionRuleContext(c.env.DB, {
      tenantId,
      sourcePublicId,
      rule: snapshot,
      doctor,
      labService,
    });
    const legacyDelete = c.env.DB.prepare(
      'DELETE FROM doctor_commission_rules WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId);
    const audit = prepareMasterDataAudit(c.env.DB, {
      tenantId,
      userId,
      action: 'DELETE',
      tableName: 'doctor_commission_rules',
      recordId: id,
      oldValue: existing,
      newValue: { ruleId: id, canonicalSourceKey: sourcePublicId, retired: true },
      ...auditRequestMetadata(c),
    });
    const suppliedIdempotencyKey = requestIdempotencyKey(c.req);
    await retireRouteCompensationRule(c.env.DB, context, {
      authoritativeStatements: [legacyDelete, audit],
      occurredAtUtc: new Date().toISOString(),
      businessDate: getTodayGMT6(),
      idempotencyKey: `route:doctor-rule:retire:${suppliedIdempotencyKey ?? `${sourcePublicId}:${context.snapshot.sourceEvidenceSha256}`}`,
      reasonCode: 'legacy-route-delete',
    });

    return c.json({ message: 'Doctor commission rule deleted successfully' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (error instanceof RangeError || error instanceof TypeError) {
      throw new HTTPException(400, { message: error.message });
    }
    console.error('Delete commission rule error:', error);
    throw new HTTPException(500, { message: 'Failed to delete doctor commission rule' });
  }
});

// GET /api/commissions/doctor-accruals — item-level doctor incentive ledger
// GET /api/commissions/doctor-payables — doctor-wise payable ledger summary
commissionRoutes.get('/doctor-payables', requireRole(...COMMISSION_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { doctorId, sourceType, startDate, endDate, outstandingOnly } = c.req.query();

  try {
    const ledgerFilters: string[] = ['a.tenant_id = ?'];
    const ledgerParams: (string | number)[] = [tenantId];
    const settlementFilters: string[] = ['s.tenant_id = ?'];
    const settlementParams: (string | number)[] = [tenantId];

    if (doctorId) {
      ledgerFilters.push('a.doctor_id = ?');
      ledgerParams.push(Number(doctorId));
      settlementFilters.push('s.doctor_id = ?');
      settlementParams.push(Number(doctorId));
    }
    if (sourceType) {
      ledgerFilters.push('a.source_type = ?');
      ledgerParams.push(sourceType);
    }
    if (startDate) {
      ledgerFilters.push('a.accrued_date >= ?');
      ledgerParams.push(startDate);
      settlementFilters.push('s.settlement_date >= ?');
      settlementParams.push(startDate);
    }
    if (endDate) {
      ledgerFilters.push('a.accrued_date <= ?');
      ledgerParams.push(endDate);
      settlementFilters.push('s.settlement_date <= ?');
      settlementParams.push(endDate);
    }

    const query = `
      WITH doctor_payable_ledger AS (
        SELECT
          a.doctor_id,
          COALESCE(SUM(CASE WHEN a.status IN ('accrued', 'approved') THEN a.gross_amount ELSE 0 END), 0) as payable_gross_amount,
          COALESCE(SUM(CASE WHEN a.status IN ('accrued', 'approved') THEN a.commission_amount ELSE 0 END), 0) as payable_amount,
          COALESCE(SUM(CASE WHEN a.status = 'paid' THEN a.commission_amount ELSE 0 END), 0) as paid_amount,
          COALESCE(SUM(CASE WHEN a.status = 'cancelled' THEN a.commission_amount ELSE 0 END), 0) as cancelled_amount,
          COALESCE(SUM(CASE WHEN a.status IN ('accrued', 'approved') THEN 1 ELSE 0 END), 0) as outstanding_count,
          COALESCE(SUM(CASE WHEN a.status = 'paid' THEN 1 ELSE 0 END), 0) as paid_count,
          COALESCE(SUM(CASE WHEN a.status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_count,
          MAX(CASE WHEN a.status IN ('accrued', 'approved') THEN a.accrued_date ELSE NULL END) as last_accrued_date
        FROM doctor_commission_accruals a
        LEFT JOIN bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
        WHERE ${ledgerFilters.join(' AND ')}
          AND ${billPaidPredicate('b')}
        GROUP BY a.doctor_id
      ),
      settlement_totals AS (
        SELECT
          s.doctor_id,
          COUNT(*) as settlement_count,
          COALESCE(SUM(s.total_amount), 0) as settled_amount,
          MAX(s.settlement_date) as last_settlement_date
        FROM doctor_commission_settlements s
        WHERE ${settlementFilters.join(' AND ')}
        GROUP BY s.doctor_id
      )
      SELECT
        l.doctor_id,
        d.name as doctor_name,
        d.specialty as doctor_specialization,
        l.payable_gross_amount,
        l.payable_amount,
        l.paid_amount,
        l.cancelled_amount,
        l.outstanding_count,
        l.paid_count,
        l.cancelled_count,
        COALESCE(st.settlement_count, 0) as settlement_count,
        COALESCE(st.settled_amount, 0) as settled_amount,
        l.last_accrued_date,
        st.last_settlement_date
      FROM doctor_payable_ledger l
      JOIN doctors d ON d.id = l.doctor_id AND d.tenant_id = ?
      LEFT JOIN settlement_totals st ON st.doctor_id = l.doctor_id
      ${outstandingOnly === 'true' ? 'WHERE l.payable_amount > 0' : ''}
      ORDER BY l.payable_amount DESC, d.name ASC
    `;

    const result = await db.$client.prepare(query).bind(
      ...ledgerParams,
      ...settlementParams,
      tenantId,
    ).all<DoctorPayableLedgerRow>();

    const payables = result.results.map((row) => ({
      ...row,
      payable_gross_amount: Number(row.payable_gross_amount ?? 0),
      payable_amount: Number(row.payable_amount ?? 0),
      paid_amount: Number(row.paid_amount ?? 0),
      cancelled_amount: Number(row.cancelled_amount ?? 0),
      outstanding_count: Number(row.outstanding_count ?? 0),
      paid_count: Number(row.paid_count ?? 0),
      cancelled_count: Number(row.cancelled_count ?? 0),
      settlement_count: Number(row.settlement_count ?? 0),
      settled_amount: Number(row.settled_amount ?? 0),
    }));

    return c.json({
      payables,
      summary: {
        payableAmount: payables.reduce((sum, row) => sum + row.payable_amount, 0),
        paidAmount: payables.reduce((sum, row) => sum + row.paid_amount, 0),
        cancelledAmount: payables.reduce((sum, row) => sum + row.cancelled_amount, 0),
        settledAmount: payables.reduce((sum, row) => sum + row.settled_amount, 0),
        doctorCount: payables.length,
        outstandingCount: payables.reduce((sum, row) => sum + row.outstanding_count, 0),
      },
    });
  } catch (error) {
    console.error('Fetch doctor payable ledger error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch doctor payable ledger' });
  }
});

commissionRoutes.get('/doctor-accruals', requireRole(...COMMISSION_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { doctorId, status, sourceType, startDate, endDate, includeUnpaid } = c.req.query();

  try {
    let query = `
      SELECT
        a.*,
        d.name as doctor_name,
        d.specialty as doctor_specialization,
        p.name as patient_name,
        p.patient_code,
        ltc.name as lab_test_name,
        ltc.code as lab_test_code,
        b.invoice_no,
        CASE WHEN ${billPaidPredicate('b')} THEN 1 ELSE 0 END as bill_is_paid
      FROM doctor_commission_accruals a
      JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      LEFT JOIN patients p ON p.id = a.patient_id AND p.tenant_id = a.tenant_id
      LEFT JOIN lab_test_catalog ltc ON ltc.id = a.lab_test_id AND ltc.tenant_id = a.tenant_id
      LEFT JOIN bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
      WHERE a.tenant_id = ?`;
    const params: (string | number)[] = [tenantId];

    if (includeUnpaid !== 'true') { query += ` AND ${billPaidPredicate('b')}`; }
    if (doctorId) { query += ' AND a.doctor_id = ?'; params.push(Number(doctorId)); }
    if (status) { query += ' AND a.status = ?'; params.push(status); }
    if (sourceType) { query += ' AND a.source_type = ?'; params.push(sourceType); }
    if (startDate) { query += ' AND a.accrued_date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND a.accrued_date <= ?'; params.push(endDate); }

    query += ' ORDER BY a.accrued_date DESC, a.id DESC';
    const accruals = await db.$client.prepare(query).bind(...params).all<Record<string, unknown>>();
    const accrualRows = accruals.results ?? [];
    const providerMode = await resolveCompensationAccrualProviderMode(c.env.DB, tenantId);
    if (providerMode === 'legacy') return c.json({ accruals: accrualRows });
    if (accrualRows.length > 100) {
      throw new HTTPException(409, { message: 'Canonical compensation comparison is limited to 100 accruals per request' });
    }

    const observedAtUtc = new Date().toISOString();
    const buildSha = c.env.CF_VERSION_METADATA?.id ?? 'local-development';
    const providerResults = await Promise.all(accrualRows.map((row) => provideCompensationAccrualRead(c.env.DB, {
      tenantId,
      legacyAccrualId: Number(row.id),
      consumerId: 'cdb040c.commission-accrual-admin',
      observedAtUtc,
      elapsedMs: 0,
      latencyBudgetMs: 250,
      buildSha,
    })));

    if (providerMode === 'shadow') {
      const failedEvidence = providerResults
        .map((result) => result.shadowEvidence)
        .filter((evidence) => evidence && (!evidence.parity || evidence.criticalUnexplainedVarianceCount > 0));
      if (failedEvidence.length > 0) {
        console.error('Commission accrual Canonical shadow comparison failed closed:', {
          tenantId,
          failedCount: failedEvidence.length,
          varianceIds: failedEvidence.flatMap((evidence) => evidence?.varianceIds ?? []),
        });
      }
      return c.json({ accruals: accrualRows });
    }

    const canonicalRows = accrualRows.map((row, index) => {
      const selected = providerResults[index]?.selected;
      if (!selected || providerResults[index]?.selectedProvider !== 'canonical') {
        throw new Error(`Canonical compensation accrual selection failed for legacy accrual ${String(row.id)}`);
      }
      return {
        ...row,
        status: legacyCompensationStatusFromCanonical(selected.status, row.status),
        commission_amount: selected.earnedMinor / 100,
        earned_commission_amount: selected.earnedMinor / 100,
        doctor_waiver_amount: selected.adjustedMinor / 100,
        payable_commission_amount: selected.payableMinor / 100,
        paid_amount: selected.settledMinor / 100,
        balance_amount: selected.payableMinor / 100,
      };
    });
    return c.json({ accruals: canonicalRows });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Fetch doctor commission accruals error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch doctor commission accruals' });
  }
});

// POST /api/commissions/doctor-accruals/approve — approve payable doctor commission accruals
commissionRoutes.post('/doctor-accruals/approve', requireRole(...COMMISSION_ADMIN_ROLES), zValidator('json', approveDoctorCommissionsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const placeholders = data.accrualIds.map(() => '?').join(',');
    const accruals = await db.$client.prepare(`
      SELECT a.id, a.status, a.doctor_id,
             CASE WHEN ${billPaidPredicate('b')} THEN 1 ELSE 0 END as bill_is_paid
      FROM doctor_commission_accruals a
      LEFT JOIN bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
      WHERE a.id IN (${placeholders}) AND a.tenant_id = ?
    `).bind(...data.accrualIds, tenantId).all<{ id: number; status: string; doctor_id: number; bill_is_paid: number }>();

    if (accruals.results.length !== data.accrualIds.length) {
      throw new HTTPException(400, { message: 'Some doctor commission accruals were not found' });
    }

    const notFullyPaid = accruals.results.filter((row) => Number(row.bill_is_paid ?? 0) !== 1);
    if (notFullyPaid.length > 0) {
      throw new HTTPException(409, { message: 'Some selected invoices still have due amount. Doctor commission can be approved only after bills are fully paid.' });
    }

    const notAccrued = accruals.results.filter((row) => row.status !== 'accrued');
    if (notAccrued.length > 0) {
      throw new HTTPException(409, { message: 'Only newly accrued doctor commissions can be approved' });
    }

    const operationKey = `doctor-commission-approve:${[...data.accrualIds].sort((a, b) => a - b).join(',')}`;
    try {
      await c.env.DB.batch([
        db.$client.prepare(`
          UPDATE doctor_commission_accruals
          SET status = 'approved',
              updated_at = datetime('now', '+6 hours')
          WHERE id IN (${placeholders}) AND tenant_id = ? AND status = 'accrued'
        `).bind(...data.accrualIds, tenantId),
        prepareFinancialBatchAssertion(c.env.DB, {
          tenantId,
          operationKey,
          stepKey: 'approval_transition',
          expectedChanges: data.accrualIds.length,
        }),
        prepareMasterDataAudit(c.env.DB, {
          tenantId,
          userId,
          action: 'UPDATE',
          tableName: 'doctor_commission_accruals',
          recordId: data.accrualIds[0],
          oldValue: {
            status: 'accrued',
            accrualIds: [...data.accrualIds].sort((a, b) => a - b),
            count: data.accrualIds.length,
          },
          newValue: {
            status: 'approved',
            accrualIds: [...data.accrualIds].sort((a, b) => a - b),
            count: data.accrualIds.length,
          },
          ...auditRequestMetadata(c),
        }),
        prepareClearFinancialBatchAssertions(c.env.DB, tenantId, operationKey),
      ]);
    } catch (error) {
      if (isFinancialBatchAssertionError(error)) {
        throw new HTTPException(409, { message: 'Some selected accruals were already changed' });
      }
      throw error;
    }

    return c.json({ message: 'Doctor commission accruals approved', count: data.accrualIds.length });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Approve doctor commission accruals error:', error);
    throw new HTTPException(500, { message: 'Failed to approve doctor commission accruals' });
  }
});

// POST /api/commissions/doctor-accruals/:id/pay — mark doctor accrual paid
commissionRoutes.post('/doctor-accruals/:id/pay', requireRole(...COMMISSION_ADMIN_ROLES), zValidator('json', markCommissionPaidSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(`
      SELECT a.id,a.doctor_id,a.gross_amount,a.commission_amount,a.canonical_source_key,a.status,
             ${effectivePayableCommission('a')} AS payable_amount,
             d.canonical_source_key AS doctor_canonical_source_key,
             d.name AS doctor_name,d.specialty AS doctor_specialization,
             d.department AS doctor_department,d.bmdc_reg_no AS doctor_registration_number,
             d.user_id AS doctor_user_id,d.is_active AS doctor_is_active,
             CASE WHEN ${billPaidPredicate('b')} THEN 1 ELSE 0 END AS bill_is_paid
      FROM doctor_commission_accruals a
      JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      LEFT JOIN bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
      WHERE a.id = ? AND a.tenant_id = ?
    `).bind(id, tenantId).first<CommissionPayoutAccrualRow>();
    if (!existing) throw new HTTPException(404, { message: 'Doctor commission accrual not found' });
    if (Number(existing.bill_is_paid ?? 0) !== 1) {
      throw new HTTPException(409, { message: 'This invoice still has due amount. Doctor commission can be paid only after the bill is fully paid.' });
    }
    if (String(existing.status) !== 'approved') {
      throw new HTTPException(409, { message: 'Doctor commission accrual must be approved before payment' });
    }

    const paidDate = data.paidDate ?? getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, paidDate, 'Doctor commission payment');
    const paymentMode = data.paymentMode ?? 'cash';
    const payout = await executeCommissionManagementPayout({
      db: c.env.DB,
      tenantId,
      userId,
      accruals: [existing],
      settlementDate: paidDate,
      paymentMode,
      referenceNo: data.referenceNo ?? null,
      notes: data.notes ?? null,
    });

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'PAYMENT',
      'doctor_commission_accruals',
      Number(id),
      existing,
      { ...payout, paidDate, paymentMode },
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent')
    );

    return c.json({
      message: 'Doctor commission accrual marked as paid',
      paidDate,
      ...payout,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/UNIQUE constraint|constraint failed|FOREIGN KEY|NOT NULL/i.test(message)) {
      throw new HTTPException(409, { message: 'Doctor commission accrual changed during payment. Refresh and try again.' });
    }
    throw new HTTPException(500, { message: 'Failed to mark doctor commission accrual as paid' });
  }
});

// POST /api/commissions/settle — bulk settle doctor commissions
commissionRoutes.post('/settle', requireRole(...COMMISSION_ADMIN_ROLES), zValidator('json', settleDoctorCommissionsSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    const settlementDate = data.settlementDate ?? getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, settlementDate, 'Doctor commission settlement');

    const placeholders = data.accrualIds.map(() => '?').join(',');
    const accruals = await db.$client.prepare(`
      SELECT a.id,a.doctor_id,a.gross_amount,a.commission_amount,a.canonical_source_key,a.status,
             ${effectivePayableCommission('a')} AS payable_amount,
             d.canonical_source_key AS doctor_canonical_source_key,
             d.name AS doctor_name,d.specialty AS doctor_specialization,
             d.department AS doctor_department,d.bmdc_reg_no AS doctor_registration_number,
             d.user_id AS doctor_user_id,d.is_active AS doctor_is_active,
             CASE WHEN ${billPaidPredicate('b')} THEN 1 ELSE 0 END AS bill_is_paid
      FROM doctor_commission_accruals a
      JOIN doctors d ON d.id = a.doctor_id AND d.tenant_id = a.tenant_id
      LEFT JOIN bills b ON b.id = a.bill_id AND b.tenant_id = a.tenant_id
      WHERE a.id IN (${placeholders}) AND a.tenant_id = ? AND a.doctor_id = ?
    `).bind(...data.accrualIds, tenantId, data.doctorId).all<CommissionPayoutAccrualRow>();

    if (accruals.results.length !== data.accrualIds.length) {
      throw new HTTPException(400, { message: 'Some accruals were not found or do not belong to this doctor' });
    }
    if (accruals.results.some((row) => Number(row.bill_is_paid ?? 0) !== 1)) {
      throw new HTTPException(409, { message: 'Some selected invoices still have due amount. Doctor commission can be settled only after bills are fully paid.' });
    }
    if (accruals.results.some((row) => row.status !== 'approved')) {
      throw new HTTPException(409, { message: 'Some selected accruals are not approved for payment' });
    }

    const payout = await executeCommissionManagementPayout({
      db: c.env.DB,
      tenantId,
      userId,
      accruals: accruals.results,
      settlementDate,
      paymentMode: data.paymentMode,
      referenceNo: data.referenceNo ?? null,
      notes: data.notes ?? null,
    });

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'PAYMENT',
      'doctor_commission_settlements',
      payout.settlementId,
      null,
      { ...payout, doctorId: data.doctorId, accrualCount: data.accrualIds.length },
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent')
    );

    return c.json({
      message: 'Settlement completed successfully',
      ...payout,
      totalAmount: payout.netPaidAmount,
      count: data.accrualIds.length,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (/UNIQUE constraint|constraint failed|FOREIGN KEY|NOT NULL/i.test(message)) {
      throw new HTTPException(409, { message: 'Selected doctor commissions changed during settlement. Refresh and try again.' });
    }
    console.error('Settlement error:', error);
    throw new HTTPException(500, { message: 'Failed to complete settlement' });
  }
});

// GET /api/commissions/settlements — list settlements
commissionRoutes.get('/settlements', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { doctorId, startDate, endDate } = c.req.query();

  try {
    let query = `
      SELECT s.*, d.name as doctor_name, d.specialty as doctor_specialization
      FROM doctor_commission_settlements s
      JOIN doctors d ON d.id = s.doctor_id AND d.tenant_id = s.tenant_id
      WHERE s.tenant_id = ?`;
    const params: (string | number)[] = [tenantId];

    if (doctorId) { query += ' AND s.doctor_id = ?'; params.push(Number(doctorId)); }
    if (startDate) { query += ' AND s.settlement_date >= ?'; params.push(startDate); }
    if (endDate) { query += ' AND s.settlement_date <= ?'; params.push(endDate); }

    query += ' ORDER BY s.settlement_date DESC, s.id DESC';

    const result = await db.$client.prepare(query).bind(...params).all();
    return c.json({ settlements: result.results });
  } catch (error) {
    console.error('Fetch settlements error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch settlements' });
  }
});

// GET /api/commissions/settlements/:id — get settlement detail (for slip)
commissionRoutes.get('/settlements/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    const settlement = await db.$client.prepare(`
      SELECT s.*, d.name as doctor_name, d.specialty as doctor_specialization,
             u.name as created_by_name,
             av.voucher_number
      FROM doctor_commission_settlements s
      JOIN doctors d ON d.id = s.doctor_id AND d.tenant_id = s.tenant_id
      LEFT JOIN users u ON u.id = s.created_by
      LEFT JOIN accounting_vouchers av
        ON av.tenant_id = s.tenant_id
       AND av.source_type = 'doctor_commission_settlement'
       AND av.source_id = CAST(s.id AS TEXT)
       AND av.event_type = 'commission_settled'
      WHERE s.id = ? AND s.tenant_id = ?
    `).bind(id, tenantId).first();

    if (!settlement) {
      throw new HTTPException(404, { message: 'Settlement not found' });
    }

    const accruals = await db.$client.prepare(`
      SELECT a.*, p.name as patient_name, p.patient_code,
             lt.name as test_name
      FROM doctor_commission_accruals a
      LEFT JOIN patients p ON p.id = a.patient_id
      LEFT JOIN lab_tests lt ON lt.id = a.lab_test_id
      WHERE a.settlement_id = ? AND a.tenant_id = ?
    `).bind(id, tenantId).all();

    return c.json({
      settlement,
      accruals: accruals.results
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Fetch settlement detail error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch settlement details' });
  }
});

// GET /api/commissions — list commissions with filters
commissionRoutes.get('/', requireRole(...COMMISSION_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { status, person } = c.req.query();

  try {
    let query = `
      SELECT c.*, p.name as patient_name, p.patient_code
      FROM commissions c
      LEFT JOIN patients p ON c.patient_id = p.id
      WHERE c.tenant_id = ?`;
    const params: (string | number)[] = [tenantId!];

    if (status) { query += ' AND c.paid_status = ?'; params.push(status); }
    if (person) { query += ' AND c.marketing_person LIKE ?'; params.push(`%${person}%`); }

    query += ' ORDER BY c.created_at DESC';
    const commissions = await db.$client.prepare(query).bind(...params).all();
    return c.json({ commissions: commissions.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch commissions' });
  }
});

// GET /api/commissions/summary — totals for unpaid vs paid
commissionRoutes.get('/summary', requireRole(...COMMISSION_ADMIN_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);

  try {
    const summary = await db.$client.prepare(`
      SELECT paid_status,
             COUNT(*) as count,
             SUM(commission_amount) as total
      FROM commissions
      WHERE tenant_id = ?
      GROUP BY paid_status
    `).bind(tenantId).all();
    return c.json({ summary: summary.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch commission summary' });
  }
});

// POST /api/commissions — record new commission
commissionRoutes.post('/', requireRole(...COMMISSION_ADMIN_ROLES), zValidator('json', createCommissionSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');

  try {
    await assertAccountingPeriodOpen(c.env.DB, tenantId, getTodayGMT6(), 'Marketing commission creation');

    const result = await db.$client.prepare(`
      INSERT INTO commissions
        (marketing_person, mobile, patient_id, bill_id, commission_amount, paid_status, notes, tenant_id, created_by)
      VALUES (?, ?, ?, ?, ?, 'unpaid', ?, ?, ?)
    `).bind(
      data.marketingPerson,
      data.mobile ?? null,
      data.patientId ?? null,
      data.billId ?? null,
      data.commissionAmount,
      data.notes ?? null,
      tenantId,
      userId,
    ).run();

    const commissionId = Number(result.meta.last_row_id);
    await recordAndPostAccountingEvent(c.env.DB, {
      tenantId,
      sourceType: 'marketing_commission',
      sourceId: commissionId,
      eventType: ACCOUNTING_EVENT_TYPES.agentCommissionAccrued,
      eventDate: getTodayGMT6(),
      createdBy: userId,
      payload: {
        commissionId,
        marketingPerson: data.marketingPerson,
        patientId: data.patientId ?? null,
        billId: data.billId ?? null,
        amount: data.commissionAmount,
      },
    });

    await createAuditLog(
      c.env,
      tenantId,
      userId,
      'CREATE',
      'commissions',
      commissionId,
      null,
      { commissionId, marketingPerson: data.marketingPerson, commissionAmount: data.commissionAmount },
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent')
    );

    return c.json({ message: 'Commission recorded', id: commissionId }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to record commission' });
  }
});

// POST /api/commissions/:id/pay — mark commission as paid
commissionRoutes.post('/:id/pay', requireRole(...COMMISSION_ADMIN_ROLES), zValidator('json', markCommissionPaidSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');
  const data = c.req.valid('json');

  try {
    const existing = await db.$client.prepare(
      'SELECT id, paid_status, commission_amount FROM commissions WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<{ id: number; paid_status?: string | null; commission_amount?: number | null }>();
    if (!existing) throw new HTTPException(404, { message: 'Commission not found' });
    if (String(existing.paid_status || '').toLowerCase() === 'paid') {
      throw new HTTPException(409, { message: 'Commission is already paid' });
    }

    const paidDate = data.paidDate ?? getTodayGMT6();
    await assertAccountingPeriodOpen(c.env.DB, tenantId, paidDate, 'Marketing commission payment');

    const updateResult = await db.$client.prepare(
      `UPDATE commissions SET paid_status = 'paid', paid_date = ?, notes = COALESCE(?, notes)
       WHERE id = ? AND tenant_id = ? AND COALESCE(paid_status, 'unpaid') <> 'paid'`,
    ).bind(paidDate, data.notes ?? null, id, tenantId).run();
    if (Number(updateResult.meta.changes ?? 0) !== 1) {
      throw new HTTPException(409, { message: 'Commission is already paid' });
    }

    const paymentMode = data.paymentMode ?? 'cash';
    const postResult = await recordAndPostAccountingEvent(c.env.DB, {
      tenantId,
      sourceType: 'marketing_commission',
      sourceId: id,
      eventType: ACCOUNTING_EVENT_TYPES.agentCommissionSettled,
      eventDate: paidDate,
      createdBy: requireUserId(c),
      payload: {
        commissionId: Number(id),
        amount: Number(existing.commission_amount || 0),
        paymentMethod: paymentMode,
        referenceNo: data.referenceNo ?? null,
      },
    });

    await createAuditLog(
      c.env,
      tenantId,
      requireUserId(c),
      'PAYMENT',
      'commissions',
      Number(id),
      existing,
      { paidDate, paymentMode, referenceNo: data.referenceNo ?? null, voucherId: postResult.voucherId ?? null },
      c.req.header('CF-Connecting-IP'),
      c.req.header('User-Agent')
    );

    return c.json({ message: 'Commission marked as paid', paidDate, voucherId: postResult.voucherId ?? null });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update commission' });
  }
});

export default commissionRoutes;
