import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { createPaymentGateway, type GatewayName } from '../../lib/payment-gateway';
import { initiatePaymentSchema } from '../../schemas/payment';
import { verifyPaymentSchema } from '../../schemas/accounting';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { getDiagnosticBillPaidUpdateSql } from '../../lib/diagnostic-billing';
import { getTodayGMT6 } from '../../lib/date-utils';
import { postPendingAccountingEvents } from '../../lib/accounting-posting';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { requireRole } from '../../middleware/rbac';
import { executeStrictFinancialMutation } from '../../lib/canonical/strict-financial-mutation';
import { prepareGatewayPaymentLegacyStatements } from '../../lib/canonical/gateway-payment-verification';
import { buildLiveDepositProjection, buildLivePaymentProjection } from '../../lib/canonical/live-financial-projection';
import { settleGatewayPayment } from '../../lib/canonical/commands/settle-gateway-payment';
import { createDeterministicSourceId } from '../../lib/canonical/source-mapping';


const paymentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

function queueAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string, message: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error(message, error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

// ─── GET / — list all payments (with filters) ─────────────────────────────────
paymentRoutes.get('/', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const { search, status, payment_method, date_from, date_to } = c.req.query();

  let sql = `
    SELECT p.id, p.receipt_no as payment_ref, pt.name as patient_name, pt.patient_code,
      p.amount, COALESCE(p.payment_method, 'cash') as payment_method,
      COALESCE(p.payment_type, 'received') as payment_type,
      'completed' as status,
      p.date as paid_at, p.date as created_at
    FROM payments p
    LEFT JOIN bills b ON p.bill_id = b.id
    LEFT JOIN patients pt ON b.patient_id = pt.id AND pt.tenant_id = p.tenant_id
    WHERE p.tenant_id = ?
  `;
  const params: (string | number)[] = [tenantId];

  if (search) {
    sql += ' AND (pt.name LIKE ? OR pt.patient_code LIKE ? OR p.receipt_no LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (payment_method && payment_method !== 'all') {
    sql += ' AND p.payment_method = ?';
    params.push(payment_method);
  }
  if (date_from) { sql += ' AND date(p.date) >= ?'; params.push(date_from); }
  if (date_to)   { sql += ' AND date(p.date) <= ?'; params.push(date_to); }

  sql += ' ORDER BY p.date DESC LIMIT 200';

  try {
    const { results } = await db.$client.prepare(sql).bind(...params).all();
    return c.json({ data: results });
  } catch {
    return c.json({ data: [] });
  }
});

// ─── GET /stats — payment KPI stats ────────────────────────────────────────────
paymentRoutes.get('/stats', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const today = getTodayGMT6();

  try {
    const batchResults = await db.$client.batch([
      db.$client.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE tenant_id = ? AND date(date) = ?"
      ).bind(tenantId, today),
      db.$client.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE tenant_id = ? AND date(date) = ? AND payment_type IN ('received', 'current')"
      ).bind(tenantId, today),
      db.$client.prepare(
        "SELECT COUNT(*) as count FROM payment_gateway_logs WHERE tenant_id = ? AND status = 'pending'"
      ).bind(tenantId),
      db.$client.prepare(
        "SELECT COUNT(*) as count FROM payment_gateway_logs WHERE tenant_id = ? AND status = 'failed'"
      ).bind(tenantId),
      db.$client.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE tenant_id = ? AND date(date) = ? AND payment_method = 'cash'"
      ).bind(tenantId, today),
      db.$client.prepare(
        "SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE tenant_id = ? AND date(date) = ? AND payment_method = 'card'"
      ).bind(tenantId, today),
      db.$client.prepare(`
        SELECT
          COALESCE(payment_method, 'unknown') as payment_method,
          COALESCE(SUM(amount), 0) as total,
          COUNT(*) as transaction_count
        FROM payments
        WHERE tenant_id = ? AND date(date) = ?
        GROUP BY COALESCE(payment_method, 'unknown')
        ORDER BY total DESC
      `).bind(tenantId, today),
    ]);

    const methodTotals = (batchResults[6]?.results ?? []) as Array<{
      payment_method: string;
      total: number;
      transaction_count: number;
    }>;
    const totalFor = (method: string) =>
      Number(methodTotals.find((row) => row.payment_method === method)?.total ?? 0);

    return c.json({
      total_today:     (batchResults[0]?.results?.[0] as any)?.total ?? 0,
      completed_today: (batchResults[1]?.results?.[0] as any)?.total ?? 0,
      pending_count:   (batchResults[2]?.results?.[0] as any)?.count ?? 0,
      failed_count:    (batchResults[3]?.results?.[0] as any)?.count ?? 0,
      cash_total:      (batchResults[4]?.results?.[0] as any)?.total ?? 0,
      card_total:      (batchResults[5]?.results?.[0] as any)?.total ?? 0,
      bkash_total: totalFor('bkash'),
      nagad_total: totalFor('nagad'),
      rocket_total: totalFor('rocket'),
      bank_total: totalFor('bank'),
      bank_transfer_total: totalFor('bank_transfer'),
      cheque_total: totalFor('cheque'),
      other_total: totalFor('other'),
      method_totals: methodTotals,
    });
  } catch {
    return c.json({
      total_today: 0,
      completed_today: 0,
      pending_count: 0,
      failed_count: 0,
      cash_total: 0,
      card_total: 0,
      bkash_total: 0,
      nagad_total: 0,
      rocket_total: 0,
      bank_total: 0,
      bank_transfer_total: 0,
      cheque_total: 0,
      other_total: 0,
      method_totals: [],
    });
  }
});

// ─── GET /:id — single payment detail ──────────────────────────────────────────
paymentRoutes.get('/:id', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = parseInt(c.req.param('id'));
  if (isNaN(id)) return c.json({ error: 'Invalid payment ID' }, 400);

  try {
    const result = await db.$client.prepare(`
      SELECT p.id, p.receipt_no as payment_ref, pt.name as patient_name, pt.patient_code,
        p.amount, COALESCE(p.payment_method, 'cash') as payment_method,
        COALESCE(p.payment_type, 'received') as payment_type,
        'completed' as status,
        p.date as paid_at, p.date as created_at,
        p.bill_id, s.name as collected_by
      FROM payments p
      LEFT JOIN bills b ON p.bill_id = b.id
      LEFT JOIN patients pt ON b.patient_id = pt.id AND pt.tenant_id = p.tenant_id
      LEFT JOIN staff s ON p.received_by = s.id
      WHERE p.id = ? AND p.tenant_id = ?
    `).bind(id, tenantId).first();

    if (!result) return c.json({ error: 'Payment not found' }, 404);
    return c.json({ data: result });
  } catch {
    return c.json({ error: 'Failed to fetch payment' }, 500);
  }
});

// Staff roles allowed to initiate payments
const PAYMENT_STAFF_ROLES = ['hospital_admin', 'reception', 'accountant'];

// ─── POST /api/payments/initiate ─────────────────────────────────────────────
// Initiates bKash or Nagad payment, returns redirect URL for the patient.
paymentRoutes.post('/initiate', zValidator('json', initiatePaymentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = requireUserId(c);
  const role     = c.get('role');
  if (!role || !PAYMENT_STAFF_ROLES.includes(role)) {
    throw new HTTPException(403, { message: 'Only authorized staff can initiate payments' });
  }
  const data     = c.req.valid('json');

  // Verify bill belongs to this tenant and isn't already paid
  const bill = await db.$client.prepare(
    'SELECT id, total, paid, status FROM bills WHERE id = ? AND tenant_id = ?',
  ).bind(data.billId, tenantId).first<{ id: number; total: number; paid: number; status: string }>();
  if (!bill) throw new HTTPException(404, { message: 'Bill not found' });
  if (bill.status === 'paid') throw new HTTPException(400, { message: 'Bill is already fully paid' });

  const outstanding = bill.total - bill.paid;
  if (data.amount > outstanding + 0.01) {  // 0.01 tolerance for float rounding
    throw new HTTPException(400, { message: `Amount ৳${data.amount} exceeds outstanding ৳${outstanding.toFixed(2)}` });
  }

  const gateway = createPaymentGateway(data.gateway as GatewayName, c.env);

  try {
    const result = await gateway.initiate({
      billId: data.billId,
      amount: data.amount,
      callbackUrl: data.callbackUrl,
    });

    // Log the initiation in gateway_logs
    await db.$client.prepare(`
      INSERT INTO payment_gateway_logs
        (tenant_id, bill_id, gateway, payment_id, amount, status, initiated_by)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).bind(tenantId, data.billId, data.gateway, result.paymentId, data.amount, userId).run();

    return c.json({
      paymentId:   result.paymentId,
      redirectUrl: result.redirectUrl,
      gateway:     data.gateway,
      amount:      data.amount,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Gateway error';
    throw new HTTPException(502, { message: `Payment gateway error: ${msg}` });
  }
});

// ─── POST /api/payments/verify ────────────────────────────────────────────────
// Server-side verification endpoint. After gateway callback redirect,
// staff verifies the payment from dashboard (OR patient lands on a page that auto-calls this).
// This is a POST (not GET) to prevent accidental replays.
const VALID_GATEWAYS = ['bkash', 'nagad'];

paymentRoutes.post('/verify', requireRole('hospital_admin', 'reception', 'accountant'), zValidator('json', verifyPaymentSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId   = requireUserId(c);

  const { paymentId, gateway } = c.req.valid('json');

  // Find the log entry
  const log = await db.$client.prepare(
    'SELECT * FROM payment_gateway_logs WHERE gateway = ? AND payment_id = ? AND tenant_id = ?',
  ).bind(gateway, paymentId, tenantId).first<{
    id: number; bill_id: number; amount: number; status: string; tenant_id: string;
  }>();

  if (!log) throw new HTTPException(404, { message: 'Payment session not found' });
  if (log.status === 'success') {
    return c.json({ message: 'Already processed', paymentId });
  }

  const today = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Gateway payment verification');

  // Atomic idempotency: UPDATE ... WHERE status = 'pending' — only ONE request can flip it
  const lockResult = await db.$client.prepare(
    `UPDATE payment_gateway_logs SET status = 'verifying', updated_at = datetime('now', '+6 hours') WHERE id = ? AND status = 'pending'`,
  ).bind(log.id).run();
  if (!lockResult.meta.changes || lockResult.meta.changes === 0) {
    return c.json({ message: 'Payment already being processed or completed', paymentId });
  }

  // Verify with gateway
  const gw = createPaymentGateway(gateway as GatewayName, c.env);
  let verifyResult;
  try {
    verifyResult = await gw.verify(paymentId);
  } catch (error) {
    await db.$client.prepare(
      `UPDATE payment_gateway_logs SET status = 'failed', raw_response = ?, updated_at = datetime('now', '+6 hours') WHERE id = ?`,
    ).bind(JSON.stringify({ error: String(error) }), log.id).run();
    throw new HTTPException(502, { message: 'Payment verification failed' });
  }

  if (!verifyResult.success) {
    await db.$client.prepare(
      `UPDATE payment_gateway_logs SET status = 'failed', raw_response = ?, updated_at = datetime('now', '+6 hours') WHERE id = ?`,
    ).bind(JSON.stringify(verifyResult), log.id).run();
    return c.json({ success: false, message: verifyResult.message ?? 'Payment not completed' }, 200);
  }

  // Payment confirmed — record the payment without ever overpaying the bill.
  // If the bill was paid by another cashier while the gateway session was open,
  // keep the excess as a patient advance deposit so cash and bill ledgers stay reconcilable.
  const bill = await db.$client.prepare(
    'SELECT id, patient_id, invoice_no, total, paid, status FROM bills WHERE id = ? AND tenant_id = ?',
  ).bind(log.bill_id, log.tenant_id).first<{
    id: number; patient_id: number; invoice_no: string; total: number; paid: number; status: string;
  }>();

  if (!bill) {
    await db.$client.prepare(
      `UPDATE payment_gateway_logs SET status = 'failed', raw_response = ?, updated_at = datetime('now', '+6 hours') WHERE id = ?`,
    ).bind(JSON.stringify({ ...verifyResult, error: 'Bill not found during verification' }), log.id).run();
    throw new HTTPException(404, { message: 'Bill not found' });
  }

  const confirmedAmount = verifyResult.amount > 0 ? verifyResult.amount : log.amount;
  const currentPaid = Number(bill.paid || 0);
  const total = Number(bill.total || 0);
  const outstanding = Math.max(0, Math.round((total - currentPaid) * 100) / 100);
  const amountForBill = Math.min(confirmedAmount, outstanding);
  const depositAmount = Math.max(0, Math.round((confirmedAmount - amountForBill) * 100) / 100);
  const newPaid = Math.min(total, Math.round((currentPaid + amountForBill) * 100) / 100);
  const status = newPaid >= total ? 'paid' : (newPaid > 0 ? 'partially_paid' : bill.status);
  const receiptNo = `${gateway.toUpperCase()}-${verifyResult.transactionId ?? paymentId}`;
  const externalTransactionId = verifyResult.transactionId ?? paymentId;

  const advanceReceiptNo = `${receiptNo}-ADV`;
  const occurredAtUtc = new Date().toISOString();
  const rawResponseJson = JSON.stringify({ ...verifyResult, appliedToBill: amountForBill, depositAmount });
  const legacyStatements = prepareGatewayPaymentLegacyStatements(c.env.DB, {
    tenantId: String(log.tenant_id),
    userId: String(userId),
    gatewayLogId: Number(log.id),
    billId: Number(log.bill_id),
    patientId: Number(bill.patient_id),
    expectedBillTotal: total,
    expectedBillPaid: currentPaid,
    expectedBillStatus: String(bill.status),
    confirmedAmount,
    amountForBill,
    depositAmount,
    newPaid,
    newBillStatus: status,
    receiptNo,
    advanceReceiptNo,
    gateway,
    paymentId,
    externalTransactionId,
    businessDate: today,
    rawResponseJson,
  });

  try {
    await executeStrictFinancialMutation({
      db: c.env.DB,
      tenantId: String(log.tenant_id),
      boundary: 'payment-gateway.verify',
      legacyStatements,
      canonical: async (execution) => {
        let payment: Awaited<ReturnType<typeof buildLivePaymentProjection>> | null = null;
        if (amountForBill > 0) {
          const mapping = await c.env.DB.prepare(`
            SELECT canonical_public_id
            FROM canonical_source_mappings
            WHERE tenant_id = ? AND entity_type = 'invoice' AND mapping_status = 'mapped'
              AND ((source_type = 'legacy_live_bill' AND source_public_id = ?)
                OR (source_type = 'legacy_bill' AND source_public_id = ?))
            ORDER BY CASE source_type WHEN 'legacy_live_bill' THEN 0 ELSE 1 END
            LIMIT 1
          `).bind(
            String(log.tenant_id),
            String(bill.invoice_no),
            String(bill.id),
          ).first<{ canonical_public_id: string }>();
          if (!mapping?.canonical_public_id) {
            throw new Error('Canonical invoice mapping not found');
          }
          payment = await buildLivePaymentProjection({
            tenantId: String(log.tenant_id),
            patientId: Number(bill.patient_id),
            paymentNo: receiptNo,
            receiptNo,
            currencyCode: 'BDT',
            receivedAtUtc: occurredAtUtc,
            amount: amountForBill,
            tenderType: 'gateway',
            methodCode: gateway,
            status: 'captured',
            allocations: [{
              sourceAllocationId: `bill:${bill.id}`,
              invoicePublicId: mapping.canonical_public_id,
              amount: amountForBill,
            }],
            collectorId: Number(userId),
            externalTransactionId,
          });
        }
        const advanceDeposit = depositAmount > 0
          ? await buildLiveDepositProjection({
              tenantId: String(log.tenant_id),
              depositNo: advanceReceiptNo,
              patientId: Number(bill.patient_id),
              amount: depositAmount,
              tenderType: 'gateway',
              methodCode: gateway,
              collectedAtUtc: occurredAtUtc,
            })
          : null;
        return settleGatewayPayment(c.env.DB, {
          tenantId: String(log.tenant_id),
          commandIdempotencyKey: `gateway-payment:${gateway}:${paymentId}`,
          commandOutboxEventPublicId: await createDeterministicSourceId(
            'outevt',
            String(log.tenant_id),
            'payment_gateway_settlement',
            `${gateway}:${paymentId}`,
          ),
          occurredAtUtc,
          businessDate: today,
          payment,
          advanceDeposit,
        }, {
          authoritativeStatements: execution.authoritativeStatements,
        });
      },
    });
  } catch (error) {
    // D1 batch writes are transactional. If the financial batch fails, release
    // the transient claim so the same verified gateway payment can be retried.
    await db.$client.prepare(`
      UPDATE payment_gateway_logs
      SET status = 'pending',
          raw_response = ?,
          updated_at = datetime('now', '+6 hours')
      WHERE id = ? AND status = 'verifying'
    `).bind(JSON.stringify({ ...verifyResult, batchError: String(error) }), log.id).run()
      .catch((unlockError) => console.error('Failed to release gateway verification lock:', unlockError));
    throw new HTTPException(503, { message: 'Payment was verified but could not be posted. Please retry verification.' });
  }

  if (amountForBill > 0 || depositAmount > 0) {
    queueAccountingPosting(c, log.tenant_id, 'Failed to post gateway payment accounting events:');
  }

  if (amountForBill > 0 && status === 'paid') {
    await Promise.all([
      db.$client.prepare(getDiagnosticBillPaidUpdateSql('lab_orders')).bind(log.bill_id, log.tenant_id).run(),
      db.$client.prepare(getDiagnosticBillPaidUpdateSql('radiology_requisitions')).bind(log.bill_id, log.tenant_id).run(),
    ]);
  }

  return c.json({
    success: true,
    paymentId,
    transactionId: verifyResult.transactionId,
    appliedToBill: amountForBill,
    depositAmount,
    message: 'Payment completed successfully',
  });
});

// ─── GET /api/payments/logs — list gateway payment logs (admin only) ───────
paymentRoutes.get('/logs', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const role     = c.get('role');
  if (role !== 'hospital_admin') throw new HTTPException(403, { message: 'Admin only' });

  const { billId, gateway, status, from, to } = c.req.query();

  let query = `SELECT l.*, b.invoice_no, p.name as patient_name
    FROM payment_gateway_logs l
    JOIN bills b ON l.bill_id = b.id
    JOIN patients p ON b.patient_id = p.id
    WHERE l.tenant_id = ?`;
  const params: (string | number)[] = [tenantId!];

  if (billId)  { query += ' AND l.bill_id = ?';  params.push(billId); }
  if (gateway) { query += ' AND l.gateway = ?';  params.push(gateway); }
  if (status)  { query += ' AND l.status = ?';   params.push(status); }
  if (from)    { query += ' AND date(l.created_at) >= ?'; params.push(from); }
  if (to)      { query += ' AND date(l.created_at) <= ?'; params.push(to); }

  query += ' ORDER BY l.created_at DESC LIMIT 100';

  try {
    const logs = await db.$client.prepare(query).bind(...params).all();
    return c.json({ logs: logs.results });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch payment logs' });
  }
});

// ─── GET /api/payments/stub-callback — development-only test endpoint ─────
paymentRoutes.get('/stub-callback', async (c) => {
  if (c.env.ENVIRONMENT !== 'development') {
    return c.json({ error: 'Not available' }, 404);
  }
  const { paymentId } = c.req.query();
  return c.json({ message: 'Stub callback received', paymentId, status: 'success' });
});

export default paymentRoutes;
