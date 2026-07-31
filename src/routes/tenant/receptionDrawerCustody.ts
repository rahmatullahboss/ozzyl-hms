import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import { createAuditLog } from '../../lib/accounting-helpers';
import { assertAccountingPeriodOpen } from '../../lib/accounting-hardening';
import { calculateBillingCounterSessionCashSummary, getBillingWorkstationId, loadActiveBillingCounterSession } from '../../lib/billing-counter-session';
import { getTodayGMT6 } from '../../lib/date-utils';
import { ACCOUNTING_EVENT_TYPES, recordAndPostAccountingEvent } from '../../lib/accounting-posting';
import {
  completeMutationIdempotencyKey,
  createIdempotencyRequestHash,
  markMutationIdempotencyKeyFailed,
  readMutationIdempotencyReplay,
  reserveMutationIdempotencyKey,
} from '../../lib/request-idempotency';
import { shadowCreateCashLedgerEntry } from '../../lib/cash-ledger-writer';

const routes = new Hono<{ Bindings: Env; Variables: Variables }>();
const CREATE_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;
const RECEIVE_ROLES = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'] as const;
const ADMIN_CUSTODY_ROLES = ['hospital_admin', 'md', 'director', 'accountant'] as const;
const COUNTER_CUSTODY_ROLES = ['reception', 'receptionist'] as const;
const ADMIN_CUSTODY_ROLE_SET = new Set<string>(ADMIN_CUSTODY_ROLES);
const COUNTER_CUSTODY_ROLE_SET = new Set<string>(COUNTER_CUSTODY_ROLES);
const MUTATION_TYPE = 'reception_drawer_custody_transfer';

const destinationTypeSchema = z.enum(['admin_custody', 'counter_session']).default('admin_custody');
const transferTypeSchema = z.enum(['admin_pickup', 'finance_custody', 'md_director_handover', 'inter_counter', 'emergency', 'other']).default('admin_pickup');

const createSchema = z.object({
  amount: z.number().positive(),
  receiverId: z.number().int().positive(),
  destinationType: destinationTypeSchema.optional(),
  destinationCounterSessionId: z.number().int().positive().optional(),
  transferType: transferTypeSchema.optional(),
  note: z.string().trim().min(3).max(500).optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
const receiveSchema = z.object({ receivedAmount: z.number().positive(), note: z.string().trim().max(500).optional() });
const n = (value: unknown) => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
};
const serial = (sessionId: number, key?: string) => `CCT-${sessionId}-${(key || `${Date.now()}`).slice(0, 48)}`;

routes.get('/recipients', requireRole(...CREATE_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const { results } = await c.env.DB.prepare(`
    SELECT id, name, email, role
    FROM users
    WHERE tenant_id = ?
      AND id <> ?
      AND role IN ('hospital_admin','md','director','accountant')
      AND COALESCE(is_active, 1) = 1
    ORDER BY
      CASE role WHEN 'md' THEN 1 WHEN 'director' THEN 2 WHEN 'hospital_admin' THEN 3 WHEN 'accountant' THEN 4 ELSE 9 END,
      name ASC
  `).bind(tenantId, userId).all();
  return c.json({ recipients: results ?? [] });
});

routes.get('/pending', requireRole(...CREATE_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const role = c.get('role') ?? '';
  const params: Array<string | number> = [tenantId];
  let scope = '';
  if (!['hospital_admin', 'md', 'director'].includes(role)) {
    scope = 'AND (t.transfer_by = ? OR t.transfer_to = ?)';
    params.push(userId, userId);
  }
  const { results } = await c.env.DB.prepare(`
    SELECT t.*, u1.name AS transfer_by_name, u2.name AS transfer_to_name, bc.counter_name, bc.counter_code
    FROM billing_counter_cash_transfers t
    LEFT JOIN users u1 ON u1.id = t.transfer_by AND u1.tenant_id = t.tenant_id
    LEFT JOIN users u2 ON u2.id = t.transfer_to AND u2.tenant_id = t.tenant_id
    LEFT JOIN billing_counters bc ON bc.id = t.counter_id AND bc.tenant_id = t.tenant_id
    WHERE t.tenant_id = ? AND t.status IN ('pending','partial','disputed') ${scope}
    ORDER BY t.created_at DESC
    LIMIT 100
  `).bind(...params).all();
  return c.json({ transfers: results ?? [] });
});

routes.get('/transfers', requireRole(...CREATE_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const role = c.get('role') ?? '';
  const canMonitorAll = ['hospital_admin', 'md', 'director', 'accountant'].includes(role);
  const allowedStatuses = new Set(['pending', 'received', 'partial', 'disputed', 'cancelled']);
  const params: Array<string | number> = [tenantId];
  const filters = ['t.tenant_id = ?'];
  const status = c.req.query('status')?.trim();
  const from = c.req.query('from') || c.req.query('dateFrom');
  const to = c.req.query('to') || c.req.query('dateTo');
  const senderId = Number(c.req.query('senderId') ?? 0);
  const receiverId = Number(c.req.query('receiverId') ?? 0);
  const counterSessionId = Number(c.req.query('counterSessionId') ?? 0);
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 200) || 200, 1), 500);

  if (status && status !== 'all') {
    if (!allowedStatuses.has(status)) throw new HTTPException(400, { message: 'Invalid transfer status' });
    filters.push('t.status = ?');
    params.push(status);
  }
  if (from) {
    filters.push('t.created_at >= ?');
    params.push(from);
  }
  if (to) {
    filters.push('t.created_at <= ?');
    params.push(`${to} 23:59:59`);
  }
  if (canMonitorAll) {
    if (Number.isInteger(senderId) && senderId > 0) {
      filters.push('t.transfer_by = ?');
      params.push(senderId);
    }
    if (Number.isInteger(receiverId) && receiverId > 0) {
      filters.push('t.transfer_to = ?');
      params.push(receiverId);
    }
    if (Number.isInteger(counterSessionId) && counterSessionId > 0) {
      filters.push('t.counter_session_id = ?');
      params.push(counterSessionId);
    }
  } else {
    filters.push('(t.transfer_by = ? OR t.transfer_to = ?)');
    params.push(userId, userId);
  }

  const { results } = await c.env.DB.prepare(`
    SELECT
      t.id,
      t.transfer_no,
      t.counter_session_id,
      t.counter_id,
      t.transfer_by,
      t.transfer_to,
      t.amount,
      t.received_amount,
      t.due_amount,
      t.status,
      t.destination_type,
      t.destination_counter_id,
      t.destination_counter_session_id,
      t.custody_label,
      t.note,
      t.receiver_note,
      t.accounting_voucher_id,
      t.created_at,
      t.received_at,
      u1.name AS transfer_by_name,
      u2.name AS transfer_to_name,
      bc.counter_name,
      bc.counter_code,
      dbc.counter_name AS destination_counter_name,
      dbc.counter_code AS destination_counter_code
    FROM billing_counter_cash_transfers t
    LEFT JOIN users u1 ON u1.id = t.transfer_by AND u1.tenant_id = t.tenant_id
    LEFT JOIN users u2 ON u2.id = t.transfer_to AND u2.tenant_id = t.tenant_id
    LEFT JOIN billing_counters bc ON bc.id = t.counter_id AND bc.tenant_id = t.tenant_id
    LEFT JOIN billing_counters dbc ON dbc.id = t.destination_counter_id AND dbc.tenant_id = t.tenant_id
    WHERE ${filters.join(' AND ')}
    ORDER BY datetime(t.created_at) DESC, t.id DESC
    LIMIT ?
  `).bind(...params, limit).all();

  return c.json({ transfers: results ?? [] });
});

routes.post('/sessions/:id/transfers', requireRole(...CREATE_ROLES), zValidator('json', createSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const sessionId = Number(c.req.param('id'));
  const data = c.req.valid('json');
  if (!Number.isInteger(sessionId) || sessionId <= 0) throw new HTTPException(400, { message: 'Invalid counter session' });
  if (Number(data.receiverId) === Number(userId)) throw new HTTPException(400, { message: 'Receiver cannot be the same cashier' });

  const destinationType = data.destinationType ?? 'admin_custody';
  const transferType = data.transferType ?? (destinationType === 'counter_session' ? 'inter_counter' : 'admin_pickup');

  const normalizedPayload = {
    sessionId,
    receiverId: data.receiverId,
    amount: n(data.amount),
    destinationType,
    destinationCounterSessionId: data.destinationCounterSessionId ?? null,
    transferType,
    note: data.note?.trim() || null,
  };
  const requestHash = data.idempotencyKey ? await createIdempotencyRequestHash(normalizedPayload) : null;
  let idempotencyReserved = false;

  if (data.idempotencyKey && requestHash) {
    const replay = await readMutationIdempotencyReplay(c.env.DB, {
      tenantId,
      mutationType: MUTATION_TYPE,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      mismatchMessage: 'Idempotency key was already used for a different cash transfer request',
      conflictMessage: 'Cash transfer is already being processed. Please retry shortly.',
    });
    if (replay) return c.json({ ...replay.responseBody, idempotent: true }, 201);

    const reserved = await reserveMutationIdempotencyKey(c.env.DB, {
      tenantId,
      mutationType: MUTATION_TYPE,
      idempotencyKey: data.idempotencyKey,
      requestHash,
      createdBy: userId,
      mismatchMessage: 'Idempotency key was already used for a different cash transfer request',
      conflictMessage: 'Cash transfer is already being processed. Please retry shortly.',
    });
    if (reserved) return c.json({ ...reserved.responseBody, idempotent: true }, 201);
    idempotencyReserved = true;
  }

  try {
    const session = await loadActiveBillingCounterSession(c.env.DB, tenantId, userId, {
      workstationId: getBillingWorkstationId(c),
      requireCurrentWorkstation: true,
    });
    if (!session || Number(session.id) !== sessionId) throw new HTTPException(404, { message: 'Active counter session not found for this workstation' });

    const receiver = await c.env.DB.prepare(`
      SELECT id, name, role FROM users
      WHERE tenant_id = ?
        AND id = ?
        AND role IN ('hospital_admin','md','director','accountant','reception','receptionist')
        AND COALESCE(is_active, 1) = 1
      LIMIT 1
    `).bind(tenantId, data.receiverId).first<{ id: number; name: string; role: string }>();
    if (!receiver) throw new HTTPException(400, { message: 'Receiver must be an active counter cashier, MD, director, accountant, or hospital admin' });

    const receiverRole = String(receiver.role ?? '');
    let destinationCounter: { id: number; counter_id: number; counter_name?: string | null; counter_code?: string | null } | null = null;
    if (destinationType === 'admin_custody') {
      if (!ADMIN_CUSTODY_ROLE_SET.has(receiverRole)) throw new HTTPException(400, { message: 'Admin custody transfers can only be sent to MD, director, accountant, or hospital admin' });
    } else {
      if (!COUNTER_CUSTODY_ROLE_SET.has(receiverRole)) throw new HTTPException(400, { message: 'Counter transfer receiver must be an active receptionist/cashier' });
      if (!data.destinationCounterSessionId) throw new HTTPException(400, { message: 'Destination counter session is required for counter-to-counter transfer' });
      destinationCounter = await c.env.DB.prepare(`
        SELECT s.id, s.counter_id, bc.counter_name, bc.counter_code
        FROM billing_counter_sessions s
        LEFT JOIN billing_counters bc ON bc.id = s.counter_id AND bc.tenant_id = s.tenant_id
        WHERE s.tenant_id = ?
          AND s.id = ?
          AND s.employee_id = ?
          AND s.status = 'active'
          AND s.id <> ?
        LIMIT 1
      `).bind(tenantId, data.destinationCounterSessionId, data.receiverId, sessionId).first<{ id: number; counter_id: number; counter_name?: string | null; counter_code?: string | null }>();
      if (!destinationCounter) throw new HTTPException(400, { message: 'Destination counter session must be active and owned by the receiver' });
    }

    const transferAmount = n(data.amount);
    const summary = await calculateBillingCounterSessionCashSummary(c.env.DB, tenantId, sessionId);
    if (transferAmount > n(summary.expectedCash)) throw new HTTPException(400, { message: `Available drawer cash is ${n(summary.expectedCash).toFixed(2)}` });
    await assertAccountingPeriodOpen(c.env.DB, tenantId, getTodayGMT6(), 'Reception drawer custody transfer');

    const destinationLabel = destinationCounter
      ? `${destinationCounter.counter_name ?? `Counter #${destinationCounter.counter_id}`} - ${receiver.name}`
      : `${receiver.name} (${receiver.role})`;
    const transferNo = serial(sessionId, data.idempotencyKey);
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO billing_counter_cash_transfers
          (tenant_id, counter_session_id, counter_id, transfer_no, transfer_by, transfer_to, amount, due_amount, status, destination_type, destination_counter_id, destination_counter_session_id, custody_label, note, idempotency_key, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)
      `).bind(tenantId, sessionId, session.counter_id, transferNo, Number(userId), data.receiverId, transferAmount, transferAmount, destinationType, destinationCounter?.counter_id ?? null, destinationCounter?.id ?? null, destinationLabel, data.note?.trim() || null, data.idempotencyKey ?? null, Number(userId)),
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
        SELECT tenant_id, counter_session_id, counter_id, transfer_by, 'cash_drop', amount, 'cash', 'cash_custody_transfer', CAST(id AS TEXT), ?, created_by
        FROM billing_counter_cash_transfers
        WHERE tenant_id = ? AND transfer_no = ?
      `).bind(destinationType === 'counter_session' ? `Inter-counter cash transfer to ${destinationLabel}` : `Drawer custody to ${destinationLabel}`, tenantId, transferNo),
    ]);

    const created = await c.env.DB.prepare(`
      SELECT id, transfer_no, amount, status
      FROM billing_counter_cash_transfers
      WHERE tenant_id = ? AND transfer_no = ?
      LIMIT 1
    `).bind(tenantId, transferNo).first<{ id: number; transfer_no: string; amount: number; status: string }>();
    if (!created) throw new HTTPException(500, { message: 'Cash transfer was not created' });

    await shadowCreateCashLedgerEntry(c.env.DB, {
      tenantId,
      sourceType: 'cash_custody_transfer',
      sourceId: Number(created.id),
      sourceNo: created.transfer_no,
      eventType: 'CASH_CUSTODY_TRANSFER_REQUESTED',
      movementDirection: 'transfer',
      cashStatus: 'PENDING_RECEIVE',
      status: created.status,
      amount: transferAmount,
      expectedAmount: transferAmount,
      receivedAmount: 0,
      dueAmount: transferAmount,
      paymentMethod: 'cash',
      fromUserId: Number(userId),
      toUserId: data.receiverId,
      counterSessionId: sessionId,
      counterId: Number(session.counter_id),
      currentLocationType: 'in_transit',
      currentLocationLabel: destinationLabel,
      referenceType: 'cash_custody_transfer',
      referenceId: Number(created.id),
      note: data.note?.trim() || null,
      metadata: {
        transferNo,
        destinationType,
        transferType,
        destinationCounterSessionId: destinationCounter?.id ?? null,
      },
      idempotencyKey: `cash-ledger:cash-custody-transfer:${created.id}:requested`,
      createdBy: Number(userId),
      occurredAt: new Date().toISOString(),
    });

    const responseBody = { success: true, transferId: Number(created.id), transferNo: created.transfer_no, amount: n(created.amount), transferTo: data.receiverId, transferToName: receiver.name, destinationType, destinationLabel, status: created.status };
    if (data.idempotencyKey) {
      await completeMutationIdempotencyKey(c.env.DB, {
        tenantId,
        mutationType: MUTATION_TYPE,
        idempotencyKey: data.idempotencyKey,
        sourceId: Number(created.id),
        responseBody,
      });
    }

    await createAuditLog(c.env, tenantId, userId, 'CREATE', 'billing_counter_cash_transfers', Number(created.id), null, { transferNo, amount: transferAmount, receiverId: data.receiverId, destinationType, destinationCounterSessionId: destinationCounter?.id ?? null, counterSessionId: sessionId });
    return c.json(responseBody, 201);
  } catch (error) {
    if (idempotencyReserved && data.idempotencyKey) {
      await markMutationIdempotencyKeyFailed(c.env.DB, {
        tenantId,
        mutationType: MUTATION_TYPE,
        idempotencyKey: data.idempotencyKey,
      }).catch((markError) => {
        console.error('Failed to mark cash transfer idempotency failed:', markError);
      });
    }
    throw error;
  }
});

routes.post('/transfers/:id/receive', requireRole(...RECEIVE_ROLES), zValidator('json', receiveSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = Number(requireUserId(c));
  const transferId = Number(c.req.param('id'));
  const data = c.req.valid('json');
  if (!Number.isInteger(transferId) || transferId <= 0) throw new HTTPException(400, { message: 'Invalid transfer id' });

  const transfer = await c.env.DB.prepare('SELECT * FROM billing_counter_cash_transfers WHERE tenant_id = ? AND id = ? LIMIT 1').bind(tenantId, transferId).first<any>();
  if (!transfer) throw new HTTPException(404, { message: 'Transfer not found' });
  if (!['pending', 'partial', 'disputed'].includes(String(transfer.status))) throw new HTTPException(409, { message: 'Transfer is already closed' });
  if (Number(transfer.transfer_to) !== userId && !['hospital_admin', 'md', 'director'].includes(c.get('role') ?? '')) throw new HTTPException(403, { message: 'Only receiver or supervisor can receive this transfer' });

  const receivedAmount = n(data.receivedAmount);
  const transferAmount = n(transfer.amount);
  const previousReceivedAmount = n(transfer.received_amount);
  const rawDueAmount = n(transfer.due_amount);
  const currentDueAmount = rawDueAmount > 0 ? rawDueAmount : n(transferAmount - previousReceivedAmount);
  if (receivedAmount > currentDueAmount) throw new HTTPException(400, { message: 'Received amount cannot exceed pending transfer amount' });
  const totalReceivedAmount = n(previousReceivedAmount + receivedAmount);
  const dueAmount = n(transferAmount - totalReceivedAmount);
  const status = dueAmount === 0 ? 'received' : 'partial';
  const date = getTodayGMT6();
  await assertAccountingPeriodOpen(c.env.DB, tenantId, date, 'Receive reception drawer custody transfer');

  const receiverSession = await c.env.DB.prepare(`
    SELECT id, counter_id
    FROM billing_counter_sessions
    WHERE tenant_id = ?
      AND employee_id = ?
      AND status = 'active'
    ORDER BY opened_at DESC, id DESC
    LIMIT 1
  `).bind(tenantId, userId).first<{ id: number; counter_id: number }>();
  const statements = [
    c.env.DB.prepare(`
      UPDATE billing_counter_cash_transfers
      SET received_amount = ?, due_amount = ?, status = ?, receiver_note = ?, received_by = ?, received_at = datetime('now', '+6 hours'), updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id = ?
        AND status IN ('pending', 'partial', 'disputed')
        AND accepted_cash_movement_id IS NULL
    `).bind(totalReceivedAmount, dueAmount, status, data.note?.trim() || null, userId, tenantId, transferId),
  ];

  const rawDestinationType = transfer.destination_type == null ? '' : String(transfer.destination_type);
  const isCounterDestination = rawDestinationType === 'counter_session';
  const isLegacyCashierDestination = !rawDestinationType && !transfer.destination_counter_session_id && Boolean(receiverSession);
  const shouldPostReceiverCashIn = isCounterDestination || isLegacyCashierDestination;

  if (shouldPostReceiverCashIn && !receiverSession) {
    throw new HTTPException(400, { message: 'Counter cashier receiver must have an active counter session before receiving transfer cash' });
  }
  if (isCounterDestination && Number(transfer.destination_counter_session_id) !== Number(receiverSession?.id)) {
    throw new HTTPException(400, { message: 'Receiver must accept this transfer from the selected destination counter session' });
  }

  if (shouldPostReceiverCashIn && receiverSession) {
    statements.push(
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
        SELECT ?, ?, ?, ?, 'cash_in', ?, 'cash', 'accepted_cash_transfer', CAST(t.id AS TEXT), ?, ?
        FROM billing_counter_cash_transfers t
        WHERE t.tenant_id = ?
          AND t.id = ?
          AND t.received_by = ?
          AND t.status = ?
          AND t.accepted_cash_movement_id IS NULL
      `).bind(
        tenantId,
        receiverSession.id,
        receiverSession.counter_id,
        userId,
        receivedAmount,
        `Accepted cash transfer ${transfer.transfer_no ?? transferId}`,
        userId,
        tenantId,
        transferId,
        userId,
        status,
      ),
      c.env.DB.prepare(`
        UPDATE billing_counter_cash_transfers
        SET accepted_cash_movement_id = (
          SELECT m.id
          FROM cash_drawer_movements m
          WHERE m.tenant_id = billing_counter_cash_transfers.tenant_id
            AND m.reference_type = 'accepted_cash_transfer'
            AND m.reference_id = CAST(billing_counter_cash_transfers.id AS TEXT)
            AND m.movement_type = 'cash_in'
          ORDER BY m.id DESC
          LIMIT 1
        )
        WHERE tenant_id = ?
          AND id = ?
          AND received_by = ?
          AND status = ?
          AND accepted_cash_movement_id IS NULL
      `).bind(tenantId, transferId, userId, status),
      c.env.DB.prepare(`
        INSERT INTO cash_drawer_movements
          (tenant_id, counter_session_id, counter_id, employee_id, movement_type, amount, payment_method, reference_type, reference_id, description, created_by)
        SELECT NULL, ?, ?, ?, 'cash_in', 0, 'cash', 'accepted_transfer_guard', ?, 'accepted transfer guard', ?
        FROM billing_counter_cash_transfers t
        WHERE t.tenant_id = ?
          AND t.id = ?
          AND t.received_by = ?
          AND t.status = ?
          AND t.accepted_cash_movement_id IS NULL
      `).bind(receiverSession.id, receiverSession.counter_id, userId, String(transferId), userId, tenantId, transferId, userId, status),
    );
  }

  await c.env.DB.batch(statements);

  const postResult = await recordAndPostAccountingEvent(c.env.DB, {
    tenantId,
    sourceType: 'cash_custody_transfer',
    sourceId: transferId,
    eventType: ACCOUNTING_EVENT_TYPES.cashHandover,
    eventDate: date,
    createdBy: userId,
    payload: { transferId, transferNo: transfer.transfer_no, counterSessionId: transfer.counter_session_id, amount: receivedAmount, dueAmount, source: 'cash_custody_transfer' },
  });
  if (postResult.voucherId) {
    await c.env.DB.prepare('UPDATE billing_counter_cash_transfers SET accounting_voucher_id = ? WHERE tenant_id = ? AND id = ?').bind(postResult.voucherId, tenantId, transferId).run();
  }

  const receivedCashStatus = status === 'received'
    ? shouldPostReceiverCashIn ? 'COUNTER_CUSTODY' : 'ADMIN_CUSTODY'
    : 'PENDING_RECEIVE';
  const receivedLocationType = status === 'received'
    ? shouldPostReceiverCashIn ? 'counter_custody' : 'admin_custody'
    : 'in_transit';
  const receivedLocationLabel = status === 'received'
    ? shouldPostReceiverCashIn
      ? `Counter session #${receiverSession?.id ?? transfer.destination_counter_session_id ?? 'unknown'}`
      : String(transfer.custody_label ?? `User #${transfer.transfer_to}`)
    : `Partial cash transfer ${transfer.transfer_no ?? transferId}`;

  await shadowCreateCashLedgerEntry(c.env.DB, {
    tenantId,
    sourceType: 'cash_custody_transfer',
    sourceId: transferId,
    sourceNo: transfer.transfer_no ?? null,
    eventType: status === 'received' ? 'CASH_CUSTODY_TRANSFER_RECEIVED' : 'CASH_CUSTODY_TRANSFER_PARTIAL_RECEIVED',
    movementDirection: 'transfer',
    cashStatus: receivedCashStatus,
    status,
    amount: receivedAmount,
    expectedAmount: transferAmount,
    receivedAmount,
    dueAmount,
    varianceAmount: dueAmount > 0 ? dueAmount : null,
    paymentMethod: 'cash',
    fromUserId: Number(transfer.transfer_by),
    toUserId: Number(transfer.transfer_to),
    counterSessionId: Number(transfer.counter_session_id),
    counterId: Number(transfer.counter_id),
    currentLocationType: receivedLocationType,
    currentLocationLabel: receivedLocationLabel,
    accountingVoucherId: postResult.voucherId ?? null,
    accountingPostingStatus: postResult.voucherId ? 'posted' : 'not_posted',
    referenceType: 'cash_custody_transfer',
    referenceId: transferId,
    note: data.note?.trim() || null,
    metadata: {
      transferNo: transfer.transfer_no ?? null,
      receiverSessionId: receiverSession?.id ?? null,
      receiverCounterId: receiverSession?.counter_id ?? null,
      destinationType: transfer.destination_type ?? null,
      acceptedCashMovementExpected: shouldPostReceiverCashIn,
    },
    idempotencyKey: `cash-ledger:cash-custody-transfer:${transferId}:receive:${status}:${receivedAmount}:${dueAmount}`,
    createdBy: userId,
    occurredAt: new Date().toISOString(),
    postedAt: postResult.voucherId ? new Date().toISOString() : null,
  });

  await createAuditLog(c.env, tenantId, String(userId), status === 'received' ? 'APPROVE' : 'UPDATE', 'billing_counter_cash_transfers', transferId, { status: transfer.status }, { status, receivedAmount, dueAmount });
  return c.json({ success: true, transferId, status, receivedAmount, dueAmount, voucherId: postResult.voucherId ?? null });
});

export default routes;
