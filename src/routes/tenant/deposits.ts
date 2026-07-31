import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { getNextSequence } from '../../lib/sequence';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { requireRole } from '../../middleware/rbac';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getTodayGMT6 } from '../../lib/date-utils';
import {
  ACCOUNTING_EVENT_TYPES,
  createPostingEventKey,
  postPendingAccountingEvents,
} from '../../lib/accounting-posting';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyReplay,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';
import { shadowCreateCashLedgerEntry } from '../../lib/cash-ledger-writer';
import { assertStrictFinancialBoundaryDisabledOrSupported } from '../../lib/canonical/strict-financial-boundaries';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { buildLiveDepositProjection } from '../../lib/canonical/live-financial-projection';
import { recordDeposit, type AdjustmentTenderType } from '../../lib/canonical/commands/apply-deposit';
import {
  applyAvailableDeposits,
  refundAvailableDeposits,
} from '../../lib/canonical/commands/allocate-deposit-balance';
import { createDeterministicSourceId, createSourceEvidenceSha256 } from '../../lib/canonical/source-mapping';
import { toMinorUnits } from '../../lib/canonical/money';

const deposits = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

const DEPOSIT_COLLECTION_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function canonicalDepositTenderType(paymentMethod: string | null | undefined): AdjustmentTenderType {
  const normalized = String(paymentMethod ?? 'cash').trim().toLowerCase();
  if (normalized === 'cash') return 'cash';
  if (normalized === 'card') return 'card';
  if (['mobile_wallet', 'mobile banking', 'mobile_banking', 'bkash', 'nagad', 'rocket'].includes(normalized)) {
    return 'mobile_wallet';
  }
  if (['bank', 'bank_transfer', 'bank transfer', 'cheque', 'check'].includes(normalized)) return 'bank_transfer';
  if (['gateway', 'online'].includes(normalized)) return 'gateway';
  return 'other';
}

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string, message: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error(message, error);
  });
  try {
    c.executionCtx.waitUntil(posting);
    return;
  } catch {
    void posting;
  }
}

async function shadowWriteDepositCollection(params: {
  db: D1Database;
  tenantId: string;
  depositId: number;
  receiptNo: string;
  patientId: number;
  amount: number;
  paymentMethod: string;
  userId: string | number;
  counterSessionId: number;
  counterId: number;
  remarks?: string | null;
}) {
  await shadowCreateCashLedgerEntry(params.db, {
    tenantId: params.tenantId,
    sourceType: 'patient_deposit',
    sourceId: params.depositId,
    sourceNo: params.receiptNo,
    eventType: 'PATIENT_DEPOSIT_RECEIVED',
    movementDirection: 'in',
    cashStatus: 'IN_DRAWER',
    status: 'posted',
    amount: params.amount,
    expectedAmount: params.amount,
    receivedAmount: params.amount,
    dueAmount: 0,
    paymentMethod: params.paymentMethod || 'cash',
    fromUserId: params.patientId,
    toUserId: Number(params.userId),
    counterSessionId: params.counterSessionId,
    counterId: params.counterId,
    currentLocationType: 'drawer',
    currentLocationLabel: `Counter session #${params.counterSessionId}`,
    referenceType: 'deposit',
    referenceId: params.depositId,
    note: params.remarks || `Deposit ${params.receiptNo}`,
    metadata: {
      receiptNo: params.receiptNo,
      patientId: params.patientId,
      shadowSource: 'billing_deposits',
    },
    idempotencyKey: `cash-ledger:deposit:${params.depositId}:received`,
    createdBy: Number(params.userId),
    occurredAt: new Date().toISOString(),
  });
}

async function shadowWriteDepositRefund(params: {
  db: D1Database;
  tenantId: string;
  refundId: number;
  receiptNo: string;
  patientId: number;
  amount: number;
  paymentMethod: string;
  userId: string | number;
  counterSessionId: number;
  counterId: number;
  remarks?: string | null;
}) {
  await shadowCreateCashLedgerEntry(params.db, {
    tenantId: params.tenantId,
    sourceType: 'patient_deposit_refund',
    sourceId: params.refundId,
    sourceNo: params.receiptNo,
    eventType: 'PATIENT_DEPOSIT_REFUNDED',
    movementDirection: 'out',
    cashStatus: 'REFUNDED',
    status: 'posted',
    amount: params.amount,
    expectedAmount: params.amount,
    receivedAmount: 0,
    dueAmount: 0,
    paymentMethod: params.paymentMethod || 'cash',
    fromUserId: Number(params.userId),
    toUserId: params.patientId,
    counterSessionId: params.counterSessionId,
    counterId: params.counterId,
    currentLocationType: 'refund',
    currentLocationLabel: `Patient deposit refund ${params.receiptNo}`,
    referenceType: 'deposit_refund',
    referenceId: params.refundId,
    note: params.remarks || `Refund ${params.receiptNo}`,
    metadata: {
      receiptNo: params.receiptNo,
      patientId: params.patientId,
      shadowSource: 'billing_deposits',
    },
    idempotencyKey: `cash-ledger:deposit-refund:${params.refundId}:paid`,
    createdBy: Number(params.userId),
    occurredAt: new Date().toISOString(),
  });
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const createDepositSchema = z.object({
  patient_id: z.number().int().positive(),
  admission_id: z.number().int().positive().optional(),
  amount: z.number().positive(),
  payment_method: z.string().optional(),
  remarks: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const refundDepositSchema = z.object({
  patient_id: z.number().int().positive(),
  amount: z.number().positive(),
  payment_method: z.string().optional(),
  remarks: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

const adjustDepositSchema = z.object({
  patient_id: z.number().int().positive(),
  amount: z.number().positive(),
  bill_id: z.number().int().positive(),
  remarks: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});

// ─── GET / — list deposits ───────────────────────────────────────────────────

deposits.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');
  const type = c.req.query('type');
  // P3#12: Pagination support
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = Math.min(200, Math.max(1, parseInt(c.req.query('per_page') || '50')));
  const offset = (page - 1) * perPage;

  let sql = `
    SELECT d.*, p.name as patient_name, p.patient_code
    FROM billing_deposits d
    LEFT JOIN patients p ON d.patient_id = p.id AND p.tenant_id = d.tenant_id
    WHERE d.tenant_id = ? AND d.is_active = 1
  `;
  const params: (string | number)[] = [tenantId];

  if (patientId) { sql += ' AND d.patient_id = ?'; params.push(patientId); }
  if (type) { sql += ' AND d.transaction_type = ?'; params.push(type); }

  const summarySql = `
    SELECT
      COALESCE(SUM(CASE WHEN d.transaction_type = 'deposit' THEN d.amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN d.transaction_type = 'refund' THEN d.amount ELSE 0 END), 0) AS total_refunds,
      COALESCE(SUM(CASE WHEN d.transaction_type = 'adjustment' THEN d.amount ELSE 0 END), 0) AS total_adjustments
    FROM billing_deposits d
    WHERE d.tenant_id = ? AND d.is_active = 1
      ${patientId ? 'AND d.patient_id = ?' : ''}
      ${type ? 'AND d.transaction_type = ?' : ''}
  `;

  const countSql = sql.replace(/SELECT d\.\*, p\.name as patient_name, p\.patient_code/, 'SELECT COUNT(*) as total');
  sql += ` ORDER BY d.created_at DESC LIMIT ${perPage} OFFSET ${offset}`;

  const [countResult, { results }, summary] = await Promise.all([
    db.$client.prepare(countSql).bind(...params).first<{ total: number }>(),
    db.$client.prepare(sql).bind(...params).all(),
    db.$client.prepare(summarySql).bind(...params).first<{
      total_deposits: number;
      total_refunds: number;
      total_adjustments: number;
    }>(),
  ]);
  const total = countResult?.total ?? 0;
  const totalDeposits = Number(summary?.total_deposits ?? 0);
  const totalRefunds = Number(summary?.total_refunds ?? 0);
  const totalAdjustments = Number(summary?.total_adjustments ?? 0);

  return c.json({
    deposits: results,
    total,
    page,
    per_page: perPage,
    summary: {
      total_deposits: roundMoney(totalDeposits),
      total_refunds: roundMoney(totalRefunds),
      total_adjustments: roundMoney(totalAdjustments),
      balance: roundMoney(totalDeposits - totalRefunds - totalAdjustments),
    },
  });
});

// ─── GET /advance-report — patient-wise advance liability report ────────────

deposits.get('/advance-report', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const includeZero = c.req.query('include_zero') === 'true';
  const startDate = c.req.query('startDate') || c.req.query('from') || c.req.query('date') || null;
  const endDate = c.req.query('endDate') || c.req.query('to') || c.req.query('date') || null;
  const patientFilter = c.req.query('patient_id') || c.req.query('patientId') || null;

  if (startDate && endDate && startDate > endDate) {
    throw new HTTPException(400, { message: 'startDate must be on or before endDate' });
  }

  let patientId: number | null = null;
  if (patientFilter) {
    const parsedPatientId = Number(patientFilter);
    if (!Number.isInteger(parsedPatientId) || parsedPatientId <= 0) {
      throw new HTTPException(400, { message: 'Invalid patient ID' });
    }
    patientId = parsedPatientId;
  }

  const whereParts = [
    'd.tenant_id = ?',
    'd.is_active = 1',
  ];
  const params: (string | number)[] = [tenantId];
  if (startDate) {
    whereParts.push('date(d.created_at) >= date(?)');
    params.push(startDate);
  }
  if (endDate) {
    whereParts.push('date(d.created_at) <= date(?)');
    params.push(endDate);
  }
  if (patientId) {
    whereParts.push('d.patient_id = ?');
    params.push(patientId);
  }

  const ledgerJoin = patientId
    ? 'JOIN accounting_posting_events ape ON ape.tenant_id = v.tenant_id AND ape.source_event_key = v.source_event_key'
    : '';
  const ledgerWhereParts = [
    'jl.tenant_id = ?',
    "v.status = 'verified'",
    "m.mapping_key = 'patient_deposit_liability'",
    'm.is_active = 1',
  ];
  const ledgerParams: (string | number)[] = [tenantId];
  if (startDate) {
    ledgerWhereParts.push('date(v.entry_date) >= date(?)');
    ledgerParams.push(startDate);
  }
  if (endDate) {
    ledgerWhereParts.push('date(v.entry_date) <= date(?)');
    ledgerParams.push(endDate);
  }
  if (patientId) {
    ledgerWhereParts.push("json_extract(ape.payload_json, '$.patientId') = ?");
    ledgerParams.push(patientId);
  }

  const [advanceResult, ledgerRow] = await Promise.all([
    db.$client.prepare(`
    SELECT
      d.patient_id,
      p.name AS patient_name,
      p.patient_code,
      COALESCE(SUM(CASE WHEN d.transaction_type = 'deposit' THEN d.amount ELSE 0 END), 0) AS total_deposits,
      COALESCE(SUM(CASE WHEN d.transaction_type = 'refund' THEN d.amount ELSE 0 END), 0) AS total_refunds,
      COALESCE(SUM(CASE WHEN d.transaction_type = 'adjustment' THEN d.amount ELSE 0 END), 0) AS total_adjustments,
      (
        COALESCE(SUM(CASE WHEN d.transaction_type = 'deposit' THEN d.amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN d.transaction_type = 'refund' THEN d.amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN d.transaction_type = 'adjustment' THEN d.amount ELSE 0 END), 0)
      ) AS balance
    FROM billing_deposits d
    LEFT JOIN patients p ON p.id = d.patient_id AND p.tenant_id = d.tenant_id
    WHERE ${whereParts.join(' AND ')}
    GROUP BY d.patient_id, p.name, p.patient_code
    HAVING ? = 1 OR ABS(balance) >= 0.01
    ORDER BY balance DESC, p.name ASC
  `).bind(...params, includeZero ? 1 : 0).all<{
    patient_id: number;
    patient_name: string | null;
    patient_code: string | null;
    total_deposits: number;
    total_refunds: number;
    total_adjustments: number;
    balance: number;
  }>(),
    db.$client.prepare(`
      SELECT COALESCE(SUM(jl.credit_amount - jl.debit_amount), 0) AS advance_liability_ledger_total
      FROM accounting_journal_lines jl
      JOIN accounting_vouchers v ON v.id = jl.voucher_id AND v.tenant_id = jl.tenant_id
      JOIN accounting_account_mappings m ON m.tenant_id = jl.tenant_id AND m.account_id = jl.account_id
      ${ledgerJoin}
      WHERE ${ledgerWhereParts.join(' AND ')}
    `).bind(...ledgerParams).first<{ advance_liability_ledger_total: number }>(),
  ]);

  const rows = (advanceResult.results ?? []).map((row) => ({
    patient_id: row.patient_id,
    patient_name: row.patient_name,
    patient_code: row.patient_code,
    total_deposits: roundMoney(Number(row.total_deposits ?? 0)),
    total_refunds: roundMoney(Number(row.total_refunds ?? 0)),
    total_adjustments: roundMoney(Number(row.total_adjustments ?? 0)),
    balance: roundMoney(Number(row.balance ?? 0)),
  }));
  const summary = rows.reduce((acc, row) => ({
    patient_count: acc.patient_count + 1,
    total_deposits: acc.total_deposits + row.total_deposits,
    total_refunds: acc.total_refunds + row.total_refunds,
    total_adjustments: acc.total_adjustments + row.total_adjustments,
    balance: acc.balance + row.balance,
  }), { patient_count: 0, total_deposits: 0, total_refunds: 0, total_adjustments: 0, balance: 0 });
  const advanceLiabilityLedgerTotal = roundMoney(Number(ledgerRow?.advance_liability_ledger_total ?? 0));
  const subledgerBalance = roundMoney(summary.balance);
  const ledgerDifference = roundMoney(subledgerBalance - advanceLiabilityLedgerTotal);
  const hasLedgerMismatch = Math.abs(ledgerDifference) >= 0.01;

  return c.json({
    rows,
    summary: {
      patient_count: summary.patient_count,
      total_deposits: roundMoney(summary.total_deposits),
      total_refunds: roundMoney(summary.total_refunds),
      total_adjustments: roundMoney(summary.total_adjustments),
      balance: subledgerBalance,
      advanceLiabilityLedgerTotal,
      ledgerDifference,
      hasLedgerMismatch,
      ledgerStatus: hasLedgerMismatch ? 'mismatch' : 'balanced',
    },
  });
});

// ─── GET /balance/:patientId — patient deposit balance ───────────────────────

deposits.get('/balance/:patientId', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));

  const result = await db.$client.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) as total_deposits,
      COALESCE(SUM(CASE WHEN transaction_type = 'refund' THEN amount ELSE 0 END), 0) as total_refunds,
      COALESCE(SUM(CASE WHEN transaction_type = 'adjustment' THEN amount ELSE 0 END), 0) as total_adjustments
    FROM billing_deposits
    WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
  `).bind(tenantId, patientId).first<{
    total_deposits: number; total_refunds: number; total_adjustments: number;
  }>();

  const totalDeposits = result?.total_deposits ?? 0;
  const totalRefunds = result?.total_refunds ?? 0;
  const totalAdjustments = result?.total_adjustments ?? 0;
  const balance = totalDeposits - totalRefunds - totalAdjustments;

  return c.json({
    patient_id: patientId,
    total_deposits: totalDeposits,
    total_refunds: totalRefunds,
    total_adjustments: totalAdjustments,
    balance,
  });
});

// ─── POST / — collect deposit ────────────────────────────────────────────────

deposits.post('/', requireRole(...DEPOSIT_COLLECTION_ROLES), zValidator('json', createDepositSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'deposit.collect');
  const mutationType = 'patient_deposit_collect';
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ ...data, idempotencyKey: undefined })
    : null;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different deposit request',
      conflictMessage: 'Deposit collection is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
  }

  const activeCounterSession = await loadActiveBillingCounterSession(c.env.DB, String(tenantId), String(userId), {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeCounterSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before collecting deposits.' });
  }
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Deposit collection');

  // P2#9: Validate patient belongs to tenant
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(data.patient_id, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  if (data.admission_id) {
    const admission = await db.$client.prepare(`
      SELECT id
      FROM admissions
      WHERE id = ? AND tenant_id = ? AND patient_id = ?
      LIMIT 1
    `).bind(data.admission_id, tenantId, data.patient_id).first();
    if (!admission) {
      throw new HTTPException(400, { message: 'Admission does not belong to this patient.' });
    }
  }

  const receiptNo = await getNextSequence(c.env.DB, String(tenantId), 'deposit', 'DEP');
  let idempotencyReserved = false;

  if (data.idempotencyKey && requestHash) {
    const replay = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: userId,
      mismatchMessage: 'Idempotency key was already used for a different deposit request',
      conflictMessage: 'Deposit collection is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  let coreCommitted = false;
  try {
    const paymentMethod = data.payment_method ?? 'cash';
    const sourceEventKey = createPostingEventKey('patient_deposit', receiptNo, ACCOUNTING_EVENT_TYPES.patientDepositReceived);
    const accountingPayload = {
      depositId: null,
      receiptNo,
      patientId: data.patient_id,
      admissionId: data.admission_id ?? null,
      amount: data.amount,
      paymentMethod,
      counterId: activeCounterSession.counter_id,
      counterSessionId: activeCounterSession.id,
    };
    const auditPayload = {
      action: 'deposit_collect',
      patient_id: data.patient_id,
      admission_id: data.admission_id ?? null,
      amount: data.amount,
      receiptNo,
      counterId: activeCounterSession.counter_id,
      counterSessionId: activeCounterSession.id,
    };
    const depositIdLookup = '(SELECT id FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ? LIMIT 1)';

    const legacyStatements = [
      db.$client.prepare(`
        INSERT INTO billing_deposits (tenant_id, patient_id, admission_id, deposit_receipt_no, amount, transaction_type, payment_method, remarks, created_by, counter_id, counter_session_id)
        VALUES (?, ?, ?, ?, ?, 'deposit', ?, ?, ?, ?, ?)
      `).bind(
        tenantId, data.patient_id, data.admission_id ?? null, receiptNo, data.amount, paymentMethod || null, data.remarks || null, userId,
        activeCounterSession.counter_id, activeCounterSession.id,
      ),
      db.$client.prepare(`
        INSERT INTO emp_cash_transactions (
          tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount,
          reference_id, reference_type, payment_method, description
        ) VALUES (?, ?, ?, ?, 'CashSales', ?, ${depositIdLookup}, 'deposit', ?, ?)
      `).bind(
        tenantId, Number(userId), activeCounterSession.counter_id, activeCounterSession.id, data.amount,
        tenantId, receiptNo, paymentMethod || null, `Deposit ${receiptNo}`,
      ),
      db.$client.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events
          (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        sourceEventKey,
        'patient_deposit',
        receiptNo,
        ACCOUNTING_EVENT_TYPES.patientDepositReceived,
        today,
        JSON.stringify(accountingPayload),
        String(userId),
      ),
      db.$client.prepare(`
        INSERT INTO audit_logs (
          tenant_id, user_id, action, table_name, record_id,
          old_value, new_value, ip_address, user_agent, created_at
        )
        VALUES (?, ?, 'PAYMENT', 'billing_deposits', ${depositIdLookup}, NULL, ?, NULL, NULL, datetime('now', '+6 hours'))
      `).bind(
        tenantId,
        userId,
        tenantId,
        receiptNo,
        JSON.stringify(auditPayload),
      ),
    ];

    const collectedAtUtc = new Date().toISOString();
    const depositExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'deposit.collect',
      legacyStatements,
      canonical: async (options) => {
        const tenderType = canonicalDepositTenderType(paymentMethod);
        const canonicalInput = await buildLiveDepositProjection({
          tenantId: String(tenantId),
          depositNo: receiptNo,
          patientId: data.patient_id,
          amount: data.amount,
          tenderType,
          methodCode: String(paymentMethod || tenderType),
          collectedAtUtc,
        });
        return recordDeposit(c.env.DB, canonicalInput, options);
      },
    });

    const legacyResults = depositExecution.mode === 'strict' ? null : depositExecution.result;
    let depositId = Number((legacyResults?.[0] as any)?.meta?.last_row_id ?? 0);
    if (!depositId) {
      const inserted = await c.env.DB.prepare(
        'SELECT id FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ? LIMIT 1',
      ).bind(tenantId, receiptNo).first<{ id: number }>();
      depositId = Number(inserted?.id ?? 0);
    }
    if (!depositId) {
      throw new HTTPException(500, { message: 'Deposit committed but its legacy receipt could not be reloaded' });
    }
    coreCommitted = true;
    const responseBody = { id: depositId, receipt_no: receiptNo, message: 'Deposit collected' };

    if (data.idempotencyKey && requestHash) {
      await completeMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
        sourceId: depositId,
        responseBody,
      }).catch((error) => console.error('Failed to complete deposit idempotency key:', error));
    }

    queueAccountingPosting(c, tenantId, 'Failed to post patient deposit accounting event:');

    await shadowWriteDepositCollection({
      db: c.env.DB,
      tenantId,
      depositId,
      receiptNo,
      patientId: data.patient_id,
      amount: data.amount,
      paymentMethod,
      userId,
      counterSessionId: activeCounterSession.id,
      counterId: activeCounterSession.counter_id,
      remarks: data.remarks || null,
    }).catch((error) => console.error('Failed to write deposit shadow cash ledger entry:', error));

    return c.json(responseBody, 201);
  } catch (error) {
    if (!coreCommitted && idempotencyReserved && data.idempotencyKey) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('Failed to mark deposit idempotency key failed:', markError);
      });
    }
    throw error;
  }
});

// ─── POST /refund — process refund ───────────────────────────────────────────

deposits.post('/refund', requireRole('hospital_admin', 'md', 'director', 'accountant'), zValidator('json', refundDepositSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'deposit.refund');
  const mutationType = 'patient_deposit_refund';
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ ...data, idempotencyKey: undefined })
    : null;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different deposit refund request',
      conflictMessage: 'Deposit refund is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
  }

  const activeCounterSession = await loadActiveBillingCounterSession(c.env.DB, String(tenantId), String(userId), {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeCounterSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before refunding deposits.' });
  }
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Deposit refund');

  // P2#9: Validate patient belongs to tenant
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(data.patient_id, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // P0#1: Check balance — we verify again after batch to prevent race conditions
  const balance = await db.$client.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0) as balance
    FROM billing_deposits WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
  `).bind(tenantId, data.patient_id).first<{ balance: number }>();

  if ((balance?.balance ?? 0) < data.amount) {
    throw new HTTPException(400, { message: `Insufficient deposit balance (available: ${balance?.balance ?? 0})` });
  }

  const receiptNo = await getNextSequence(c.env.DB, String(tenantId), 'deposit_refund', 'DRF');
  let idempotencyReserved = false;

  if (data.idempotencyKey && requestHash) {
    const replay = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: userId,
      mismatchMessage: 'Idempotency key was already used for a different deposit refund request',
      conflictMessage: 'Deposit refund is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  let coreCommitted = false;
  try {
    const paymentMethod = data.payment_method ?? 'cash';
    const refundIdLookup = '(SELECT id FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ? LIMIT 1)';
    const sourceEventKey = createPostingEventKey('patient_deposit_refund', receiptNo, ACCOUNTING_EVENT_TYPES.patientDepositRefunded);
    const accountingPayload = {
      depositId: null,
      receiptNo,
      patientId: data.patient_id,
      amount: data.amount,
      paymentMethod,
      counterId: activeCounterSession.counter_id,
      counterSessionId: activeCounterSession.id,
    };
    const auditPayload = {
      action: 'deposit_refund',
      patient_id: data.patient_id,
      amount: data.amount,
      receiptNo,
      counterId: activeCounterSession.counter_id,
      counterSessionId: activeCounterSession.id,
    };

    const legacyStatements = [
      db.$client.prepare(`
        INSERT INTO billing_deposits (
          tenant_id, patient_id, deposit_receipt_no, amount, transaction_type,
          payment_method, remarks, created_by, counter_id, counter_session_id
        )
        SELECT CASE WHEN (
          SELECT
            COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0)
          FROM billing_deposits
          WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
        ) >= ? THEN ? ELSE NULL END, ?, ?, ?, 'refund', ?, ?, ?, ?, ?
      `).bind(
        tenantId,
        data.patient_id,
        data.amount,
        tenantId,
        data.patient_id,
        receiptNo,
        data.amount,
        paymentMethod || null,
        data.remarks || null,
        userId,
        activeCounterSession.counter_id,
        activeCounterSession.id,
      ),
      db.$client.prepare(`
        INSERT INTO emp_cash_transactions (
          tenant_id, employee_id, counter_id, counter_session_id, transaction_type, amount,
          reference_id, reference_type, payment_method, description
        )
        SELECT ?, ?, ?, ?, 'ReturnDeposit', ?, ${refundIdLookup}, 'deposit_refund', ?, ?
        WHERE EXISTS (SELECT 1 FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ?)
      `).bind(
        tenantId,
        Number(userId),
        activeCounterSession.counter_id,
        activeCounterSession.id,
        data.amount,
        tenantId,
        receiptNo,
        paymentMethod || null,
        `Refund ${receiptNo}`,
        tenantId,
        receiptNo,
      ),
      db.$client.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events
          (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
        SELECT ?, ?, 'patient_deposit_refund', ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ?)
      `).bind(
        tenantId,
        sourceEventKey,
        receiptNo,
        ACCOUNTING_EVENT_TYPES.patientDepositRefunded,
        today,
        JSON.stringify(accountingPayload),
        String(userId),
        tenantId,
        receiptNo,
      ),
      db.$client.prepare(`
        INSERT INTO audit_logs (
          tenant_id, user_id, action, table_name, record_id,
          old_value, new_value, ip_address, user_agent, created_at
        )
        SELECT ?, ?, 'PAYMENT', 'billing_deposits', ${refundIdLookup}, NULL, ?, NULL, NULL, datetime('now', '+6 hours')
        WHERE EXISTS (SELECT 1 FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ?)
      `).bind(
        tenantId,
        userId,
        tenantId,
        receiptNo,
        JSON.stringify(auditPayload),
        tenantId,
        receiptNo,
      ),
    ];

    const refundedAtUtc = new Date().toISOString();
    const tenderType = canonicalDepositTenderType(paymentMethod);
    const operationPublicId = await createDeterministicSourceId(
      'depop',
      String(tenantId),
      'legacy_live_deposit_refund_operation',
      receiptNo,
    );
    const refundExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'deposit.refund',
      legacyStatements,
      canonical: async (options) => refundAvailableDeposits(c.env.DB, {
        tenantId: String(tenantId),
        legacyPatientId: data.patient_id,
        amountMinor: Number(toMinorUnits(data.amount)),
        occurredAtUtc: refundedAtUtc,
        businessDate: today,
        sourceType: 'legacy_live_deposit_refund_operation',
        sourcePublicId: receiptNo,
        sourceTable: 'billing_deposits',
        sourceEvidenceSha256: await createSourceEvidenceSha256({
          receiptNo,
          patientId: data.patient_id,
          amount: String(data.amount),
          paymentMethod,
          counterSessionId: activeCounterSession.id,
        }),
        idempotencyKey: `legacy_live_deposit_refund:${receiptNo}`,
        outboxEventPublicId: await createDeterministicSourceId(
          'outevt',
          String(tenantId),
          'legacy_live_deposit_refund_operation',
          receiptNo,
        ),
        operationPublicId,
        tenderType,
        methodCode: String(paymentMethod || tenderType),
      }, options),
    });

    const legacyResults = refundExecution.mode === 'strict' ? null : refundExecution.result;
    const insertChanges = Number((legacyResults?.[0] as any)?.meta?.changes ?? 1);
    if (insertChanges === 0) {
      throw new HTTPException(409, { message: 'Concurrent refund detected — insufficient balance. Please retry.' });
    }

    let refundId = Number((legacyResults?.[0] as any)?.meta?.last_row_id ?? 0);
    if (!refundId) {
      const inserted = await c.env.DB.prepare(
        'SELECT id FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ? LIMIT 1',
      ).bind(tenantId, receiptNo).first<{ id: number }>();
      refundId = Number(inserted?.id ?? 0);
    }
    if (!refundId) {
      throw new HTTPException(500, { message: 'Refund committed but its legacy receipt could not be reloaded' });
    }
    coreCommitted = true;
    const responseBody = { id: refundId, receipt_no: receiptNo, message: 'Refund processed' };

    if (data.idempotencyKey && requestHash) {
      await completeMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
        sourceId: refundId,
        responseBody,
      }).catch((error) => console.error('Failed to complete deposit refund idempotency key:', error));
    }

    queueAccountingPosting(c, tenantId, 'Failed to post patient deposit refund accounting event:');

    await shadowWriteDepositRefund({
      db: c.env.DB,
      tenantId,
      refundId,
      receiptNo,
      patientId: data.patient_id,
      amount: data.amount,
      paymentMethod,
      userId,
      counterSessionId: activeCounterSession.id,
      counterId: activeCounterSession.counter_id,
      remarks: data.remarks || null,
    }).catch((error) => console.error('Failed to write deposit refund shadow cash ledger entry:', error));

    return c.json(responseBody, 201);
  } catch (error) {
    if (!coreCommitted && idempotencyReserved && data.idempotencyKey) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('Failed to mark deposit refund idempotency key failed:', markError);
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/NOT NULL constraint failed:\s*billing_deposits\.tenant_id/i.test(message)) {
      throw new HTTPException(409, { message: 'Concurrent refund detected — insufficient balance. Please retry.' });
    }
    throw error;
  }
});

// ─── POST /adjust — adjust deposit against a bill ────────────────────────────

deposits.post('/adjust', requireRole(...DEPOSIT_COLLECTION_ROLES), zValidator('json', adjustDepositSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const data = c.req.valid('json');
  await assertStrictFinancialBoundaryDisabledOrSupported(c.env.DB, String(tenantId), 'deposit.apply');
  const idempotencyKey = data.idempotencyKey ?? null;

  const activeCounterSession = await loadActiveBillingCounterSession(c.env.DB, String(tenantId), String(userId), {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeCounterSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before adjusting deposits.' });
  }
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Deposit adjustment');

  // P2#9: Validate patient belongs to tenant
  const patient = await db.$client.prepare(
    'SELECT id FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(data.patient_id, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  // Verify bill exists, belongs to this patient, and still has enough due.
  const bill = await db.$client.prepare('SELECT id, invoice_no, patient_id, total, paid FROM bills WHERE id = ? AND tenant_id = ?')
    .bind(data.bill_id, tenantId).first<{ id: number; invoice_no: string | null; patient_id: number; total: number; paid: number }>();
  if (!bill) throw new HTTPException(404, { message: 'Bill not found' });
  if (bill.patient_id !== data.patient_id) {
    throw new HTTPException(400, { message: 'Deposit patient does not match the bill patient' });
  }

  const billDue = Math.max(0, (bill.total ?? 0) - (bill.paid ?? 0));
  if (data.amount > billDue) {
    throw new HTTPException(400, { message: `Amount ${data.amount} exceeds bill due ${billDue}` });
  }

  // Idempotency: if a key was supplied, look it up first. We DO NOT
  // perform any side effects until the conditional balance check
  // succeeds.
  if (idempotencyKey) {
    const existing = await c.env.DB.prepare(
      'SELECT response_json, status FROM bills_idempotency_keys WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1'
    ).bind(tenantId, idempotencyKey).first<{ response_json: string | null; status: string }>();
    if (existing?.status === 'completed' && existing.response_json) {
      return c.json({ ...JSON.parse(existing.response_json), idempotent: true }, 200);
    }
    if (existing?.status === 'pending') {
      throw new HTTPException(409, { message: 'A previous request with this Idempotency-Key is still being processed.' });
    }
  }

  // Check balance
  const balance = await db.$client.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0) as balance
    FROM billing_deposits WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
  `).bind(tenantId, data.patient_id).first<{ balance: number }>();

  if ((balance?.balance ?? 0) < data.amount) {
    throw new HTTPException(400, { message: `Insufficient deposit balance` });
  }

  const receiptNo = await getNextSequence(c.env.DB, String(tenantId), 'deposit_adj', 'DAD');

  // Reserve idempotency key outside the batch so retries that race the
  // same key can detect the in-flight request.
  if (idempotencyKey) {
    try {
      await c.env.DB.prepare(
        'INSERT INTO bills_idempotency_keys (tenant_id, idempotency_key, status, created_by) VALUES (?, ?, ?, ?)'
      ).bind(tenantId, idempotencyKey, 'pending', String(userId)).run();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE|PRIMARY KEY/i.test(msg)) {
        throw new HTTPException(409, { message: 'Idempotency-Key already in use' });
      }
      throw err;
    }
  }

  // Adjust the patient advance and the bill in one D1 transaction. Both
  // available advance and current bill due are re-checked inside the batch,
  // preventing two cashier requests from spending the same balance.
  const sourceEventKey = createPostingEventKey(
    'patient_deposit_adjustment',
    receiptNo,
    ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
  );
  const accountingPayload = {
    depositId: null,
    receiptNo,
    patientId: data.patient_id,
    billId: data.bill_id,
    amount: data.amount,
    counterId: activeCounterSession.counter_id,
    counterSessionId: activeCounterSession.id,
  };
  const adjustmentIdLookup = '(SELECT id FROM billing_deposits WHERE tenant_id = ? AND deposit_receipt_no = ? LIMIT 1)';
  const auditPayload = {
    action: 'deposit_adjust',
    patient_id: data.patient_id,
    amount: data.amount,
    bill_id: data.bill_id,
    receiptNo,
    counterId: activeCounterSession.counter_id,
    counterSessionId: activeCounterSession.id,
  };

  try {
    const legacyStatements = [
      db.$client.prepare(`
        INSERT INTO billing_deposits (
          tenant_id, patient_id, deposit_receipt_no, amount, transaction_type,
          reference_bill_id, remarks, created_by, counter_id, counter_session_id
        )
        SELECT CASE WHEN (
          (
            SELECT COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) -
                   COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0)
            FROM billing_deposits
            WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
          ) >= ?
          AND EXISTS (
            SELECT 1 FROM bills
            WHERE id = ? AND tenant_id = ? AND patient_id = ?
              AND MAX(0, COALESCE(total, 0) - COALESCE(paid, 0)) >= ?
          )
        ) THEN ? ELSE NULL END, ?, ?, ?, 'adjustment', ?, ?, ?, ?, ?
      `).bind(
        tenantId,
        data.patient_id,
        data.amount,
        data.bill_id,
        tenantId,
        data.patient_id,
        data.amount,
        tenantId,
        data.patient_id,
        receiptNo,
        data.amount,
        data.bill_id,
        data.remarks || 'Deposit adjustment',
        userId,
        activeCounterSession.counter_id,
        activeCounterSession.id,
      ),
      db.$client.prepare(`
        UPDATE bills
        SET paid = MIN(total, COALESCE(paid, 0) + ?),
            due = MAX(0, total - (COALESCE(paid, 0) + ?)),
            status = CASE
              WHEN COALESCE(paid, 0) + ? >= total THEN 'paid'
              WHEN COALESCE(paid, 0) + ? > 0 THEN 'partially_paid'
              ELSE 'open'
            END,
            updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ? AND patient_id = ?
          AND EXISTS (
            SELECT 1 FROM billing_deposits
            WHERE tenant_id = ? AND deposit_receipt_no = ? AND transaction_type = 'adjustment'
          )
      `).bind(
        data.amount,
        data.amount,
        data.amount,
        data.amount,
        data.bill_id,
        tenantId,
        data.patient_id,
        tenantId,
        receiptNo,
      ),
      db.$client.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events
          (tenant_id, source_event_key, source_type, source_id, event_type, event_date, payload_json, created_by)
        SELECT ?, ?, 'patient_deposit_adjustment', ?, ?, ?, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM billing_deposits
          WHERE tenant_id = ? AND deposit_receipt_no = ? AND transaction_type = 'adjustment'
        )
      `).bind(
        tenantId,
        sourceEventKey,
        receiptNo,
        ACCOUNTING_EVENT_TYPES.patientDepositAdjusted,
        today,
        JSON.stringify(accountingPayload),
        String(userId),
        tenantId,
        receiptNo,
      ),
      db.$client.prepare(`
        INSERT INTO audit_logs (
          tenant_id, user_id, action, table_name, record_id,
          old_value, new_value, ip_address, user_agent, created_at
        )
        SELECT ?, ?, 'PAYMENT', 'billing_deposits', ${adjustmentIdLookup}, NULL, ?, NULL, NULL, datetime('now', '+6 hours')
        WHERE EXISTS (
          SELECT 1 FROM billing_deposits
          WHERE tenant_id = ? AND deposit_receipt_no = ? AND transaction_type = 'adjustment'
        )
      `).bind(
        tenantId,
        userId,
        tenantId,
        receiptNo,
        JSON.stringify(auditPayload),
        tenantId,
        receiptNo,
      ),
      db.$client.prepare(`
        INSERT INTO emp_cash_transactions (
          tenant_id,employee_id,counter_id,counter_session_id,transaction_type,amount,
          reference_id,reference_type,payment_method,description
        )
        SELECT ?,?,?,?,'DepositDeduct',?,?,'bill',NULL,?
        WHERE EXISTS (
          SELECT 1 FROM billing_deposits
          WHERE tenant_id=? AND deposit_receipt_no=? AND transaction_type='adjustment'
        )
      `).bind(
        tenantId,
        Number(userId),
        activeCounterSession.counter_id,
        activeCounterSession.id,
        data.amount,
        data.bill_id,
        `Deposit adjustment ${receiptNo}`,
        tenantId,
        receiptNo,
      ),
    ];

    const appliedAtUtc = new Date().toISOString();
    const operationPublicId = await createDeterministicSourceId(
      'depop',
      String(tenantId),
      'legacy_live_deposit_application_operation',
      receiptNo,
    );
    const adjustmentExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(tenantId),
      boundary: 'deposit.apply',
      legacyStatements,
      canonical: async (options) => {
        const invoiceMapping = await c.env.DB.prepare(`
          SELECT canonical_public_id
          FROM canonical_source_mappings
          WHERE tenant_id=? AND entity_type='invoice' AND mapping_status='mapped'
            AND ((source_type='legacy_live_bill' AND source_public_id=?)
              OR (source_type='legacy_bill' AND source_public_id=?))
          ORDER BY CASE source_type WHEN 'legacy_live_bill' THEN 0 ELSE 1 END
          LIMIT 1
        `).bind(tenantId, String(bill.invoice_no ?? ''), String(bill.id)).first<{ canonical_public_id: string }>();
        if (!invoiceMapping?.canonical_public_id) throw new Error('Canonical invoice mapping not found');

        return applyAvailableDeposits(c.env.DB, {
          tenantId: String(tenantId),
          legacyPatientId: data.patient_id,
          amountMinor: Number(toMinorUnits(data.amount)),
          occurredAtUtc: appliedAtUtc,
          businessDate: today,
          sourceType: 'legacy_live_deposit_application_operation',
          sourcePublicId: receiptNo,
          sourceTable: 'billing_deposits',
          sourceEvidenceSha256: await createSourceEvidenceSha256({
            receiptNo,
            patientId: data.patient_id,
            billId: data.bill_id,
            invoicePublicId: invoiceMapping.canonical_public_id,
            amount: String(data.amount),
            counterSessionId: activeCounterSession.id,
          }),
          idempotencyKey: `legacy_live_deposit_application:${receiptNo}`,
          outboxEventPublicId: await createDeterministicSourceId(
            'outevt',
            String(tenantId),
            'legacy_live_deposit_application_operation',
            receiptNo,
          ),
          operationPublicId,
          invoicePublicId: invoiceMapping.canonical_public_id,
          invoiceLinePublicId: null,
        }, options);
      },
    });

    const legacyResults = adjustmentExecution.mode === 'strict' ? null : adjustmentExecution.result;
    const insertChanges = Number((legacyResults?.[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 1);
    if (insertChanges === 0) {
      throw new HTTPException(409, {
        message: 'Concurrent deposit adjustment detected — advance balance or bill due changed. Please retry.',
      });
    }

    const responseBody = { receipt_no: receiptNo, message: 'Deposit adjusted against bill' };
    if (idempotencyKey) {
      await c.env.DB.prepare(
        "UPDATE bills_idempotency_keys SET status = 'completed', response_json = ?, updated_at = datetime('now', '+6 hours') WHERE tenant_id = ? AND idempotency_key = ?"
      ).bind(JSON.stringify(responseBody), tenantId, idempotencyKey).run()
        .catch((error) => console.error('Failed to complete deposit adjustment idempotency key:', error));
    }

    queueAccountingPosting(c, tenantId, 'Failed to post patient deposit adjustment accounting event:');
    return c.json(responseBody, 201);
  } catch (error) {
    if (idempotencyKey) {
      await c.env.DB.prepare(
        "UPDATE bills_idempotency_keys SET status = 'failed', updated_at = datetime('now', '+6 hours') WHERE tenant_id = ? AND idempotency_key = ?"
      ).bind(tenantId, idempotencyKey).run().catch((markError) => {
        console.error('Failed to mark deposit adjustment idempotency key failed:', markError);
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (/NOT NULL constraint failed:\s*billing_deposits\.tenant_id/i.test(message)) {
      throw new HTTPException(409, {
        message: 'Concurrent deposit adjustment detected — advance balance or bill due changed. Please retry.',
      });
    }
    throw error;
  }
});

export default deposits;
