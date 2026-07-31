import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { HTTPException } from 'hono/http-exception';
import type { Env } from '../types';
import { assertAccountingPeriodOpen } from './accounting-hardening';
import { getTodayGMT6 } from './date-utils';
import { getNextSequence } from './sequence';
import { assertStrictFinancialBoundaryDisabledOrSupported } from './canonical/strict-financial-boundaries';
import { executeStrictFinancialMutation } from './canonical/strict-financial-mutation';
import { resolveLivePaymentReversalProjection } from './canonical/live-payment-reversal-projection';
import { reversePayment } from './canonical/commands/reverse-payment';

export type PaymentVoidBillStatus = 'paid' | 'partially_paid' | 'open';

export type PaymentVoidExecutionContext = {
  tenantId: string;
  paymentId: number;
  billId: number;
  patientId: number | null;
  originalReceiptNo: string | null;
  reversalReceiptNo: string;
  originalAmount: number;
  paymentMethod: string;
  originalReceivedBy: number;
  counterId: number | null;
  counterSessionId: number | null;
  newPaid: number;
  due: number;
  status: PaymentVoidBillStatus;
  reversedAtUtc: string;
  businessDate: string;
};

export type PaymentVoidExecutionInput = {
  tenantId: string;
  paymentId: number;
  actorUserId: number;
  reason: string;
  cashOnly?: boolean;
  additionalAuthoritativeStatements?: (
    context: PaymentVoidExecutionContext,
  ) => readonly D1PreparedStatement[];
};

export type PaymentVoidExecutionResult = PaymentVoidExecutionContext & {
  executionMode: 'legacy' | 'shadow' | 'strict';
  authoritativeResults?: unknown[];
};

type PaymentAuthorityRow = {
  id: number;
  bill_id: number;
  patient_id: number | null;
  amount: number;
  payment_type: string | null;
  receipt_no: string | null;
  payment_method: string | null;
  received_by: number | null;
  counter_id: number | null;
  counter_session_id: number | null;
  paid: number;
  total: number;
  status: string | null;
};

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizePaymentMethod(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

async function assertNoPaidDoctorCompensation(
  db: D1Database,
  tenantId: string,
  billId: number,
): Promise<void> {
  const [paidReserve, paidCommission] = await Promise.all([
    db.prepare(`
      SELECT id
      FROM diagnostic_performer_reserves
      WHERE tenant_id = ? AND bill_id = ? AND status = 'paid'
      LIMIT 1
    `).bind(tenantId, billId).first<{ id: number }>(),
    db.prepare(`
      SELECT id
      FROM doctor_commission_accruals
      WHERE tenant_id = ? AND bill_id = ? AND status = 'paid'
      LIMIT 1
    `).bind(tenantId, billId).first<{ id: number }>(),
  ]);

  if (paidReserve || paidCommission) {
    throw new HTTPException(409, {
      message: 'This payment is linked to a paid doctor payout. Reverse the doctor payout before voiding the patient payment.',
    });
  }
}

export async function executePaymentVoidReversal(
  env: Env,
  input: PaymentVoidExecutionInput,
): Promise<PaymentVoidExecutionResult> {
  const reason = input.reason.trim();
  if (!reason) throw new HTTPException(400, { message: 'Payment void reason is required' });
  if (!Number.isSafeInteger(input.paymentId) || input.paymentId <= 0) {
    throw new HTTPException(400, { message: 'Invalid payment ID' });
  }
  if (!Number.isSafeInteger(input.actorUserId) || input.actorUserId <= 0) {
    throw new HTTPException(401, { message: 'Invalid payment void actor' });
  }

  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(env.DB, input.tenantId, today, 'Payment void reversal');
  await assertStrictFinancialBoundaryDisabledOrSupported(env.DB, input.tenantId, 'payment.reverse');

  const payment = await env.DB.prepare(`
    SELECT p.id, p.bill_id, p.amount, p.payment_type, p.receipt_no,
           p.payment_method, p.received_by, p.counter_id, p.counter_session_id,
           b.patient_id, b.paid, b.total, b.status
    FROM payments p
    JOIN bills b ON b.id = p.bill_id AND b.tenant_id = p.tenant_id
    WHERE p.id = ? AND p.tenant_id = ?
    LIMIT 1
  `).bind(input.paymentId, input.tenantId).first<PaymentAuthorityRow>();
  if (!payment) throw new HTTPException(404, { message: 'Payment not found' });

  const originalAmount = roundMoney(Number(payment.amount ?? 0));
  if (originalAmount <= 0 || String(payment.payment_type ?? '').toLowerCase() === 'reversal') {
    throw new HTTPException(409, { message: 'Only positive payment receipts can be reversed' });
  }

  const paymentMethod = normalizePaymentMethod(payment.payment_method);
  if (input.cashOnly && paymentMethod !== 'cash') {
    throw new HTTPException(409, {
      message: 'Immediate payment void currently supports cash receipts only. Use the provider refund workflow for non-cash payments.',
    });
  }
  if (paymentMethod === 'cash' && (!payment.counter_id || !payment.counter_session_id)) {
    throw new HTTPException(409, { message: 'Cash payment is missing its originating counter custody.' });
  }

  const existingReversal = await env.DB.prepare(`
    SELECT id
    FROM payments
    WHERE tenant_id = ?
      AND external_transaction_id = ?
    LIMIT 1
  `).bind(input.tenantId, `reverse-payment-${input.paymentId}`).first<{ id: number }>();
  if (existingReversal) {
    throw new HTTPException(409, { message: 'This payment already has a reversal entry' });
  }

  await assertNoPaidDoctorCompensation(env.DB, input.tenantId, Number(payment.bill_id));

  const depositAdjusted = await env.DB.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS deposit_adjusted
    FROM billing_deposits
    WHERE tenant_id = ?
      AND reference_bill_id = ?
      AND transaction_type = 'adjustment'
      AND is_active = 1
  `).bind(input.tenantId, payment.bill_id).first<{ deposit_adjusted?: number | null }>();

  const newPaid = roundMoney(Math.max(0, Number(payment.paid ?? 0) - originalAmount));
  const billTotal = roundMoney(Number(payment.total ?? 0));
  const due = roundMoney(Math.max(0, billTotal - newPaid - Number(depositAdjusted?.deposit_adjusted ?? 0)));
  const status: PaymentVoidBillStatus = due <= 0 ? 'paid' : newPaid > 0 ? 'partially_paid' : 'open';
  const reversalReceiptNo = await getNextSequence(env.DB, input.tenantId, 'payment_reversal', 'RVR');
  const reversedAtUtc = new Date().toISOString();
  const originalReceivedBy = Number(payment.received_by ?? input.actorUserId);
  const legacyReversalPaymentType = String(payment.payment_type ?? '').toLowerCase() === 'due'
    ? 'due'
    : 'current';

  const context: PaymentVoidExecutionContext = {
    tenantId: input.tenantId,
    paymentId: input.paymentId,
    billId: Number(payment.bill_id),
    patientId: payment.patient_id == null ? null : Number(payment.patient_id),
    originalReceiptNo: payment.receipt_no ?? null,
    reversalReceiptNo,
    originalAmount,
    paymentMethod,
    originalReceivedBy,
    counterId: payment.counter_id == null ? null : Number(payment.counter_id),
    counterSessionId: payment.counter_session_id == null ? null : Number(payment.counter_session_id),
    newPaid,
    due,
    status,
    reversedAtUtc,
    businessDate: today,
  };

  const additionalStatements = input.additionalAuthoritativeStatements?.(context) ?? [];
  const reversalExternalId = `reverse-payment-${input.paymentId}`;
  const legacyStatements: D1PreparedStatement[] = [
    ...additionalStatements,
    env.DB.prepare(`
      INSERT INTO payments (
        bill_id, amount, payment_type, receipt_no, received_by, payment_method,
        external_transaction_id, tenant_id, counter_id, counter_session_id, date
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+6 hours'))
    `).bind(
      payment.bill_id,
      -originalAmount,
      legacyReversalPaymentType,
      reversalReceiptNo,
      input.actorUserId,
      payment.payment_method ?? null,
      reversalExternalId,
      input.tenantId,
      payment.counter_id ?? null,
      payment.counter_session_id ?? null,
    ),
    env.DB.prepare(`UPDATE bills SET paid = ?, due = ?, status = ?, updated_at = datetime('now', '+6 hours') WHERE id = ? AND tenant_id = ?`).bind(
      newPaid,
      due,
      status,
      payment.bill_id,
      input.tenantId,
    ),
    env.DB.prepare(`
      INSERT INTO income (date, source, amount, description, bill_id, tenant_id, created_by)
      VALUES (?, 'other', ?, ?, ?, ?, ?)
    `).bind(
      today,
      -originalAmount,
      `Payment reversal ${reversalReceiptNo}: ${reason}`,
      payment.bill_id,
      input.tenantId,
      input.actorUserId,
    ),
    env.DB.prepare(`
      INSERT INTO emp_cash_transactions (
        tenant_id, employee_id, counter_id, counter_session_id,
        transaction_type, amount, reference_id, reference_type,
        payment_method, description
      ) VALUES (?, ?, ?, ?, 'SalesReturn', ?, ?, 'payment', ?, ?)
    `).bind(
      input.tenantId,
      originalReceivedBy,
      payment.counter_id ?? null,
      payment.counter_session_id ?? null,
      originalAmount,
      input.paymentId,
      payment.payment_method ?? null,
      `Reverse ${payment.receipt_no ?? input.paymentId}: ${reason}`,
    ),
  ];

  const mutation = await executeStrictFinancialMutation({
    db: env.DB,
    tenantId: input.tenantId,
    boundary: 'payment.reverse',
    legacyStatements,
    canonical: async (options) => {
      const canonicalInput = await resolveLivePaymentReversalProjection(env.DB, {
        tenantId: input.tenantId,
        paymentId: input.paymentId,
        billId: Number(payment.bill_id),
        paymentReceiptNo: String(payment.receipt_no ?? input.paymentId),
        reversalReceiptNo,
        amount: originalAmount,
        paymentMethod: payment.payment_method ?? null,
        reason,
        reversedAtUtc,
      });
      return reversePayment(env.DB, canonicalInput, options);
    },
  });

  return {
    ...context,
    executionMode: mutation.mode,
    authoritativeResults: mutation.mode === 'strict' ? undefined : mutation.result,
  };
}
