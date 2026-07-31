import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { getNextSequence } from '../../lib/sequence';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import {
  CanonicalStrictFinancialError,
  resolveStrictFinancialPolicy,
} from '../../lib/canonical/strict-financial-policy';
import { isFinancialBatchAssertionError } from '../../lib/canonical/financial-batch-assertion';
import { CanonicalIdempotencyConflictError } from '../../lib/canonical/idempotency';
import { createDeterministicSourceId } from '../../lib/canonical/source-mapping';
import { toMinorUnits } from '../../lib/canonical/money';
import {
  finalizeSettlement,
  type SettlementTenderType,
} from '../../lib/canonical/commands/finalize-settlement';
import { cancelSettlement } from '../../lib/canonical/commands/cancel-settlement';
import {
  executeSettlementOriginalLegacy,
  prepareSettlementShadowCanonicalContext,
  prepareSettlementStrictContext,
  prepareSettlementStrictStatements,
  SettlementFinalizationError,
  type SettlementContext,
  type SettlementPreparationInput,
  type SettlementStrictContext,
} from '../../lib/canonical/settlement-finalization';
import {
  executeSettlementCancellationOriginalLegacy,
  prepareSettlementCancellationStrictContext,
  prepareSettlementCancellationStrictStatements,
  SettlementCancellationError,
  type SettlementCancellationInput,
  type SettlementCancellationStrictContext,
} from '../../lib/canonical/settlement-cancellation';
import { getDb } from '../../db';
import { isRoleAllowed } from '../../lib/authz';
import { requireRole } from '../../middleware/rbac';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import { getTodayGMT6 } from '../../lib/date-utils';
import { postPendingAccountingEvents } from '../../lib/accounting-posting';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyReplay,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';
import { assertDiscountReferralNameForHighDiscount } from '../../lib/discount-policy';
import { discountAllocationTypeForReason, normalizeDiscountReason } from '../../lib/discount_allocation';
import { shadowCreateCashLedgerEntry } from '../../lib/cash-ledger-writer';



function isCashPaymentMode(value: unknown): boolean {
  const normalized = String(value ?? 'cash').trim().toLowerCase();
  return normalized === '' || normalized === 'cash' || normalized === 'cash payment';
}

async function shadowWriteSettlementCollection(params: {
  db: D1Database;
  tenantId: string;
  settlementId: number;
  receiptNo: string;
  patientId: number;
  amount: number;
  paymentMode?: string | null;
  userId: string | number;
  counterSessionId: number;
  counterId: number;
  billIds: number[];
}) {
  if (!isCashPaymentMode(params.paymentMode)) return;
  await shadowCreateCashLedgerEntry(params.db, {
    tenantId: params.tenantId,
    sourceType: 'settlement',
    sourceId: params.settlementId,
    sourceNo: params.receiptNo,
    eventType: 'RECEIVABLE_COLLECTION_RECEIVED',
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
    referenceType: 'settlement',
    referenceId: params.settlementId,
    note: `Settlement collection ${params.receiptNo}`,
    metadata: {
      receiptNo: params.receiptNo,
      patientId: params.patientId,
      billIds: params.billIds,
      shadowSource: 'billing_settlements',
    },
    idempotencyKey: `cash-ledger:settlement:${params.settlementId}:collection`,
    createdBy: Number(params.userId),
    occurredAt: new Date().toISOString(),
  });
}

const settlements = new Hono<{ Bindings: Env; Variables: Variables }>();
const SETTLEMENT_READ_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;
const SETTLEMENT_WRITE_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception'] as const;
const SETTLEMENT_DISCOUNT_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post settlement accounting events:', error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

class SettlementIdempotencyReplaySignal extends Error {
  constructor(readonly responseBody: Record<string, unknown>) {
    super('Settlement idempotency replay');
    this.name = 'SettlementIdempotencyReplaySignal';
  }
}

function settlementTenderType(paymentMode: string): SettlementTenderType {
  const normalized = paymentMode.trim().toLowerCase();
  if (normalized === '' || normalized === 'cash' || normalized === 'cash payment') return 'cash';
  if (normalized.includes('card')) return 'card';
  if (normalized.includes('bkash') || normalized.includes('nagad') || normalized.includes('wallet')) {
    return 'mobile_wallet';
  }
  if (normalized.includes('bank')) return 'bank_transfer';
  if (normalized.includes('gateway') || normalized.includes('online')) return 'gateway';
  return 'other';
}

// ─── GET / — list settlements ────────────────────────────────────────────────

settlements.get('/', requireRole(...SETTLEMENT_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');
  const startDate = c.req.query('start_date');
  const endDate = c.req.query('end_date');
  const page = Math.max(1, parseInt(c.req.query('page') || '1'));
  const perPage = Math.min(200, Math.max(1, parseInt(c.req.query('per_page') || '50')));
  const offset = (page - 1) * perPage;

  let whereSql = 's.tenant_id = ? AND s.is_active = 1';
  const params: (string | number)[] = [tenantId];
  if (patientId) { whereSql += ' AND s.patient_id = ?'; params.push(patientId); }
  if (startDate) { whereSql += ' AND date(s.created_at) >= date(?)'; params.push(startDate); }
  if (endDate) { whereSql += ' AND date(s.created_at) <= date(?)'; params.push(endDate); }

  const sql = `
    SELECT s.*, p.name as patient_name, p.patient_code
    FROM billing_settlements s
    JOIN patients p ON s.patient_id = p.id AND p.tenant_id = s.tenant_id
    WHERE ${whereSql}
    ORDER BY s.created_at DESC LIMIT ${perPage} OFFSET ${offset}
  `;
  const summarySql = `
    SELECT
      COUNT(*) AS total_settlements,
      COALESCE(SUM(s.payable_amount), 0) AS total_payable_amount,
      COALESCE(SUM(s.paid_amount), 0) AS total_paid_amount,
      COALESCE(SUM(s.deposit_deducted), 0) AS total_deposit_deducted,
      COALESCE(SUM(s.discount_amount), 0) AS total_discount_amount,
      COALESCE(SUM(s.returned_amount), 0) AS total_returned_amount
    FROM billing_settlements s
    WHERE ${whereSql}
  `;

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  const summaryRow = await db.$client.prepare(summarySql).bind(...params).first<{
    total_settlements?: number | null;
    total_payable_amount?: number | null;
    total_paid_amount?: number | null;
    total_deposit_deducted?: number | null;
    total_discount_amount?: number | null;
    total_returned_amount?: number | null;
    cnt?: number | null;
    count?: number | null;
  }>();

  return c.json({
    settlements: results,
    page,
    per_page: perPage,
    summary: {
      totalSettlements: Number(summaryRow?.total_settlements ?? summaryRow?.cnt ?? summaryRow?.count ?? 0),
      totalPayableAmount: roundMoney(Number(summaryRow?.total_payable_amount ?? 0)),
      totalPaidAmount: roundMoney(Number(summaryRow?.total_paid_amount ?? 0)),
      totalDepositDeducted: roundMoney(Number(summaryRow?.total_deposit_deducted ?? 0)),
      totalDiscountAmount: roundMoney(Number(summaryRow?.total_discount_amount ?? 0)),
      totalReturnedAmount: roundMoney(Number(summaryRow?.total_returned_amount ?? 0)),
    },
  });
});

// ─── GET /pending — credit bills awaiting payment ────────────────────────────

settlements.get('/pending', requireRole(...SETTLEMENT_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = c.req.query('patient_id');

  let sql = `
    SELECT b.*, p.name as patient_name, p.patient_code,
      (b.total - b.paid) as due_amount
    FROM bills b
    JOIN patients p ON b.patient_id = p.id AND p.tenant_id = b.tenant_id
    WHERE b.tenant_id = ? AND b.status IN ('open', 'partially_paid')
      AND b.total > b.paid
  `;
  const params: (string | number)[] = [tenantId];
  if (patientId) { sql += ' AND b.patient_id = ?'; params.push(patientId); }
  sql += ' ORDER BY b.created_at ASC';

  const { results } = await db.$client.prepare(sql).bind(...params).all();
  return c.json({ pending_bills: results });
});

// ─── GET /patient/:patientId/info — settlement summary for a patient ─────────

settlements.get('/patient/:patientId/info', requireRole(...SETTLEMENT_READ_ROLES), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const patientId = parseInt(c.req.param('patientId'));

  const patient = await db.$client.prepare(
    'SELECT id, name, patient_code, mobile FROM patients WHERE id = ? AND tenant_id = ?'
  ).bind(patientId, tenantId).first();
  if (!patient) throw new HTTPException(404, { message: 'Patient not found' });

  const { results: pendingBills } = await db.$client.prepare(`
    SELECT id, invoice_no, total, paid,
      (total - paid) as due_amount, created_at, status
    FROM bills WHERE patient_id = ? AND tenant_id = ? AND status IN ('open', 'partially_paid')
    ORDER BY created_at ASC
  `).bind(patientId, tenantId).all();

  const deposit = await db.$client.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type = 'deposit' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN transaction_type IN ('refund', 'adjustment') THEN amount ELSE 0 END), 0) as balance
    FROM billing_deposits WHERE tenant_id = ? AND patient_id = ? AND is_active = 1
  `).bind(tenantId, patientId).first<{ balance: number }>();

  const totalDue = (pendingBills as any[]).reduce((sum, b: any) => sum + (b.due_amount || 0), 0);

  return c.json({
    patient,
    pending_bills: pendingBills,
    deposit_balance: deposit?.balance || 0,
    total_due: totalDue,
    net_payable: Math.max(0, totalDue - (deposit?.balance || 0)),
  });
});

// ─── POST / — create settlement ─────────────────────────────────────────────

settlements.post('/', requireRole(...SETTLEMENT_WRITE_ROLES), zValidator('json', z.object({
  patient_id: z.number().int().positive(),
  bill_ids: z.array(z.number().int().positive()).min(1),
  paid_amount: z.number().min(0).default(0),
  deposit_deducted: z.number().min(0).default(0),
  discount_amount: z.number().min(0).default(0),
  discount_by_name: z.string().trim().max(200).optional(),
  reason_code: z.string().trim().optional(),
  payment_mode: z.string().default('cash'),
  remarks: z.string().optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
})), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const numericUserId = Number(userId);
  const data = c.req.valid('json');
  if (data.discount_amount > 0 && !isRoleAllowed(c.get('role'), SETTLEMENT_DISCOUNT_ROLES)) {
    throw new HTTPException(403, { message: 'Settlement discount requires finance approval.' });
  }
  const mutationType = 'settlement';
  const requestHash = data.idempotencyKey
    ? await createIdempotencyRequestHash({ ...data, idempotencyKey: undefined })
    : null;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different settlement request',
      conflictMessage: 'Settlement request is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);
  }

  const placeholders = data.bill_ids.map(() => '?').join(',');
  const { results: selectedBillRows } = await db.$client.prepare(`
    SELECT id,invoice_no,total,paid,due,status,settlement_id,patient_id
    FROM bills
    WHERE id IN (${placeholders}) AND tenant_id=?
  `).bind(...data.bill_ids, tenantId).all<Record<string, unknown>>();
  if (selectedBillRows.length !== data.bill_ids.length) {
    throw new HTTPException(400, { message: 'Some bills not found' });
  }

  const bills = selectedBillRows.map((bill) => {
    const id = Number(bill.id);
    const total = roundMoney(Number(bill.total ?? 0));
    const paid = roundMoney(Number(bill.paid ?? 0));
    const due = roundMoney(Number(bill.due ?? total - paid));
    return {
      id,
      invoiceNo: String(bill.invoice_no ?? `BILL-${id}`),
      patientId: Number(bill.patient_id),
      total,
      paid,
      due,
      status: String(bill.status ?? (paid >= total ? 'paid' : paid > 0 ? 'partially_paid' : 'open')),
      settlementId: bill.settlement_id == null ? null : Number(bill.settlement_id),
    };
  });
  if (bills.some((bill) => bill.patientId !== data.patient_id)) {
    throw new HTTPException(400, { message: 'Bill does not belong to patient' });
  }

  const totalDue = roundMoney(bills.reduce((sum, bill) => sum + bill.due, 0));
  assertDiscountReferralNameForHighDiscount(totalDue, data.discount_amount, data.discount_by_name);
  const roundedPayment = roundMoney(data.paid_amount + data.deposit_deducted + data.discount_amount);
  if (roundedPayment <= 0) {
    throw new HTTPException(400, {
      message: 'Settlement requires a payment, deposit adjustment, or approved discount.',
    });
  }
  if (roundedPayment > totalDue) {
    throw new HTTPException(400, { message: `Overpayment: due ${totalDue}, paying ${roundedPayment}` });
  }

  if (data.deposit_deducted > 0) {
    const deposit = await db.$client.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN transaction_type='deposit' THEN amount ELSE 0 END),0)
        - COALESCE(SUM(CASE WHEN transaction_type IN ('refund','adjustment') THEN amount ELSE 0 END),0)
        AS balance
      FROM billing_deposits
      WHERE tenant_id=? AND patient_id=? AND is_active=1
    `).bind(tenantId, data.patient_id).first<{ balance: number }>();
    if (data.deposit_deducted > Number(deposit?.balance ?? 0)) {
      throw new HTTPException(400, {
        message: `Insufficient deposit: available ${deposit?.balance || 0}`,
      });
    }
  }

  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Settlement creation');
  const activeCounterSession = await loadActiveBillingCounterSession(c.env.DB, tenantId, String(userId), {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeCounterSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before creating settlements.' });
  }

  const normalizedDiscountReason = normalizeDiscountReason(data.reason_code);
  let idempotencyReserved = false;
  const preparationInput: SettlementPreparationInput = {
    tenantId,
    userId: numericUserId,
    patientId: data.patient_id,
    requestedBillIds: [...data.bill_ids],
    bills,
    paidAmount: roundMoney(data.paid_amount),
    depositDeducted: roundMoney(data.deposit_deducted),
    discountAmount: roundMoney(data.discount_amount),
    discountByName: data.discount_by_name?.trim() || null,
    discountReasonCode: normalizedDiscountReason,
    discountAllocationType: discountAllocationTypeForReason(normalizedDiscountReason),
    paymentMode: data.payment_mode,
    remarks: data.remarks?.trim() || null,
    businessDate: today,
    occurredAtUtc: new Date().toISOString(),
    counterId: Number(activeCounterSession.counter_id),
    counterSessionId: Number(activeCounterSession.id),
    dependencies: {
      async nextReceiptNo() {
        const receiptNo = await getNextSequence(c.env.DB, String(tenantId), 'settlement', 'STL');
        if (data.idempotencyKey && requestHash) {
          const replay = await reserveMutationIdempotencyKey(c.env.DB, {
            tenantId,
            mutationType,
            idempotencyKey: data.idempotencyKey,
            requestHash,
            createdBy: userId,
            mismatchMessage: 'Idempotency key was already used for a different settlement request',
            conflictMessage: 'Settlement request is already being processed. Please retry shortly.',
          });
          if (replay) throw new SettlementIdempotencyReplaySignal(replay.responseBody);
          idempotencyReserved = true;
        }
        return receiptNo;
      },
    },
  };
  const contextRef: { current: SettlementContext | SettlementStrictContext | null } = { current: null };
  const legacySettlementIdRef: { current: number | null } = { current: null };
  const runCommittedSettlementPostCommit = async (
    context: SettlementContext,
    settlementId: number,
  ): Promise<void> => {
    if (context.paidAmount > 0 || context.depositDeducted > 0 || context.discountAmount > 0) {
      queueAccountingPosting(c, tenantId);
    }
    if (context.paidAmount > 0) {
      await shadowWriteSettlementCollection({
        db: c.env.DB,
        tenantId,
        settlementId,
        receiptNo: context.receiptNo,
        patientId: context.patientId,
        amount: context.paidAmount,
        paymentMode: context.paymentMode,
        userId,
        counterSessionId: context.counterSessionId,
        counterId: context.counterId,
        billIds: [...context.requestedBillIds],
      });
    }
  };

  try {
    const financialExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId,
      boundary: 'settlement.finalize',
      legacyExecutor: async () => {
        const legacy = await executeSettlementOriginalLegacy(c.env.DB, preparationInput);
        contextRef.current = legacy.context;
        legacySettlementIdRef.current = legacy.settlementId;
        return [...legacy.results];
      },
      legacyPostCommit: async () => {
        const context = contextRef.current;
        const settlementId = legacySettlementIdRef.current;
        if (!context || !(settlementId && settlementId > 0)) {
          throw new Error('Committed legacy settlement context is unavailable');
        }
        await runCommittedSettlementPostCommit(context, settlementId);
      },
      strictAuthoritativeStatements: async () => {
        const strictContext = await prepareSettlementStrictContext(c.env.DB, preparationInput);
        contextRef.current = strictContext;
        return prepareSettlementStrictStatements(c.env.DB, strictContext);
      },
      canonical: async (execution) => {
        const preparedContext = contextRef.current;
        if (!preparedContext) throw new Error('Settlement context is unavailable');
        const canonicalContext = 'canonicalInvoices' in preparedContext
          ? preparedContext
          : await prepareSettlementShadowCanonicalContext(c.env.DB, preparationInput, preparedContext);
        const settlementPublicId = await createDeterministicSourceId(
          'stl',
          tenantId,
          'legacy_settlement',
          canonicalContext.receiptNo,
        );
        return finalizeSettlement(c.env.DB, {
          tenantId,
          commandIdempotencyKey: `settlement:${canonicalContext.receiptNo}`,
          settlementPublicId,
          settlementReceiptNumber: canonicalContext.receiptNo,
          legacyPatientId: canonicalContext.patientId,
          currencyCode: 'BDT',
          occurredAtUtc: canonicalContext.occurredAtUtc,
          businessDate: canonicalContext.businessDate,
          legacyCollectorId: canonicalContext.userId,
          legacyCounterId: canonicalContext.counterId,
          legacyCounterSessionId: canonicalContext.counterSessionId,
          paymentMethod: canonicalContext.paymentMode,
          tenderType: settlementTenderType(canonicalContext.paymentMode),
          bills: canonicalContext.billPlans.map((bill) => {
            const invoice = canonicalContext.canonicalInvoices.get(bill.id);
            if (!invoice) throw new Error(`Canonical invoice context is unavailable for bill #${bill.id}`);
            return {
              billId: bill.id,
              invoicePublicId: invoice.invoicePublicId,
              invoiceNumber: bill.invoiceNo,
              legacyTotalMinor: Number(toMinorUnits(bill.total)),
              legacyPaidBeforeMinor: Number(toMinorUnits(bill.paid)),
              legacyDueBeforeMinor: Number(toMinorUnits(bill.due)),
              canonicalPaidBeforeMinor: invoice.paidMinor,
              canonicalDueBeforeMinor: invoice.dueMinor,
              canonicalCreditedBeforeMinor: invoice.creditedMinor,
              canonicalNetDueBeforeMinor: invoice.netDueMinor,
              cashMinor: Number(toMinorUnits(bill.cashApplied)),
              depositMinor: Number(toMinorUnits(bill.depositApplied)),
              discountMinor: Number(toMinorUnits(bill.discountApplied)),
              paymentReceiptNumber: bill.paymentReceiptNo,
              depositAdjustmentReceiptNumber: bill.depositReceiptNo,
              discountNumber: bill.discountReceiptNo,
              discountReasonCode: bill.discountApplied > 0
                ? canonicalContext.discountReasonCode
                : null,
              discountAllocationType: bill.discountApplied > 0
                ? canonicalContext.discountAllocationType
                : null,
              discountReferenceName: bill.discountApplied > 0
                ? canonicalContext.discountByName
                : null,
              discountNote: bill.discountApplied > 0
                ? canonicalContext.remarks
                : null,
            };
          }),
        }, {
          authoritativeStatements: execution.authoritativeStatements,
        });
      },
    });

    const context = contextRef.current;
    if (!context) throw new Error('Committed settlement context is unavailable');
    const committed = await c.env.DB.prepare(`
      SELECT id
      FROM billing_settlements
      WHERE tenant_id=? AND settlement_receipt_no=?
      LIMIT 1
    `).bind(tenantId, context.receiptNo).first<{ id: number }>();
    const settlementId = Number(committed?.id ?? legacySettlementIdRef.current ?? 0);
    if (!(settlementId > 0)) {
      throw new HTTPException(409, {
        message: 'Settlement changed concurrently. Please refresh and try again.',
      });
    }

    if (financialExecution.mode === 'strict') {
      await runCommittedSettlementPostCommit(context, settlementId);
    }

    const responseBody = {
      id: settlementId,
      receipt_no: context.receiptNo,
      message: 'Settlement created',
    };
    if (data.idempotencyKey && requestHash && idempotencyReserved) {
      await completeMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
        sourceId: settlementId,
        responseBody,
      });
    }
    return c.json(responseBody, 201);
  } catch (error) {
    const replaySignal = error instanceof SettlementIdempotencyReplaySignal
      ? error
      : error instanceof CanonicalStrictFinancialError
        && error.cause instanceof SettlementIdempotencyReplaySignal
        ? error.cause
        : null;
    if (replaySignal) return c.json({ ...replaySignal.responseBody, idempotent: true }, 201);

    if (idempotencyReserved && data.idempotencyKey) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('Failed to mark settlement idempotency key failed:', markError);
      });
    }
    if (error instanceof HTTPException) throw error;
    if (error instanceof SettlementFinalizationError) {
      throw new HTTPException(error.status as 400 | 409, { message: error.message });
    }
    if (
      error instanceof CanonicalStrictFinancialError
      || error instanceof CanonicalIdempotencyConflictError
      || isFinancialBatchAssertionError(error)
    ) {
      throw new HTTPException(409, {
        message: 'Settlement authority changed concurrently or canonical authority is unavailable. Refresh and try again.',
      });
    }
    throw error;
  }
});

// ─── PUT /:id/cancel — cancel a settlement ──────────────────────────────────

settlements.put('/:id/cancel', requireRole('hospital_admin', 'md', 'director'), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const numericUserId = Number(userId);
  const settlementId = c.req.param('id');
  const numericSettlementId = Number(settlementId);
  if (!Number.isSafeInteger(numericSettlementId) || numericSettlementId <= 0) {
    throw new HTTPException(404, { message: 'Settlement not found or already cancelled' });
  }

  const activeCounterSession = await loadActiveBillingCounterSession(c.env.DB, String(tenantId), String(userId), {
    workstationId: getBillingWorkstationId(c),
    requireCurrentWorkstation: true,
  });
  if (!activeCounterSession) {
    throw new HTTPException(409, { message: 'Activate a billing counter before cancelling settlements.' });
  }
  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Settlement cancellation');

  const settlement = await db.$client.prepare(
    'SELECT * FROM billing_settlements WHERE id = ? AND tenant_id = ? AND is_active = 1'
  ).bind(numericSettlementId, tenantId).first<Record<string, unknown>>();
  if (!settlement) throw new HTTPException(404, { message: 'Settlement not found or already cancelled' });

  const { results: settledBills } = await db.$client.prepare(`
    SELECT id, invoice_no, patient_id, total, paid, due, status, settlement_id
    FROM bills
    WHERE settlement_id = ? AND tenant_id = ?
    ORDER BY id
  `).bind(numericSettlementId, tenantId).all<Record<string, unknown>>();

  const cancellationInput: SettlementCancellationInput = {
    tenantId,
    userId: numericUserId,
    settlementId: numericSettlementId,
    businessDate: today,
    cancelledAtUtc: new Date().toISOString(),
    activeCounterId: Number(activeCounterSession.counter_id),
    activeCounterSessionId: Number(activeCounterSession.id),
    settlement: {
      id: numericSettlementId,
      patientId: Number(settlement.patient_id),
      receiptNo: String(settlement.settlement_receipt_no ?? ''),
      payableAmount: roundMoney(Number(settlement.payable_amount ?? 0)),
      paidAmount: roundMoney(Number(settlement.paid_amount ?? 0)),
      depositDeducted: roundMoney(Number(settlement.deposit_deducted ?? 0)),
      discountAmount: roundMoney(Number(settlement.discount_amount ?? 0)),
      discountByName: settlement.discount_by_name == null ? null : String(settlement.discount_by_name),
      paymentMode: String(settlement.payment_mode ?? 'cash'),
      remarks: settlement.remarks == null ? null : String(settlement.remarks),
      createdBy: Number(settlement.created_by),
      counterId: Number(settlement.counter_id),
      counterSessionId: Number(settlement.counter_session_id),
      isActive: Number(settlement.is_active),
    },
    bills: settledBills.map((bill) => ({
      id: Number(bill.id),
      invoiceNo: String(bill.invoice_no ?? ''),
      patientId: Number(bill.patient_id),
      total: roundMoney(Number(bill.total ?? 0)),
      paid: roundMoney(Number(bill.paid ?? 0)),
      due: roundMoney(Number(bill.due ?? 0)),
      status: String(bill.status ?? ''),
      settlementId: bill.settlement_id == null ? null : Number(bill.settlement_id),
    })),
  };

  const strictContextRef: { current: SettlementCancellationStrictContext | null } = { current: null };
  let shadowPreparationError: unknown = null;
  const policy = await resolveStrictFinancialPolicy(c.env.DB, tenantId);
  if (policy.enabled && policy.writePolicy === 'shadow') {
    try {
      strictContextRef.current = await prepareSettlementCancellationStrictContext(c.env.DB, cancellationInput);
    } catch (error) {
      shadowPreparationError = error;
    }
  }

  try {
    const financialExecution = await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId,
      boundary: 'settlement.cancel',
      legacyExecutor: async () => {
        const legacy = await executeSettlementCancellationOriginalLegacy(c.env.DB, cancellationInput);
        return [...legacy.results];
      },
      strictAuthoritativeStatements: async () => {
        const strictContext = await prepareSettlementCancellationStrictContext(c.env.DB, cancellationInput);
        strictContextRef.current = strictContext;
        return prepareSettlementCancellationStrictStatements(c.env.DB, strictContext);
      },
      canonical: async (execution) => {
        const strictContext = strictContextRef.current;
        if (!strictContext) {
          if (shadowPreparationError) throw shadowPreparationError;
          throw new Error('Settlement cancellation strict context is unavailable');
        }
        return cancelSettlement(c.env.DB, strictContext.commandInput, {
          authoritativeStatements: execution.authoritativeStatements,
        });
      },
    });

    if (financialExecution.mode === 'strict') queueAccountingPosting(c, tenantId);
    return c.json({ message: 'Settlement cancelled successfully', settlement_id: settlementId });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    if (error instanceof SettlementCancellationError) {
      throw new HTTPException(error.status as 404 | 409, { message: error.message });
    }
    if (
      error instanceof CanonicalStrictFinancialError
      || error instanceof CanonicalIdempotencyConflictError
      || isFinancialBatchAssertionError(error)
    ) {
      throw new HTTPException(409, {
        message: 'Settlement cancellation authority changed concurrently or canonical evidence is unavailable. Refresh and try again.',
      });
    }
    throw error;
  }
});

export default settlements;
