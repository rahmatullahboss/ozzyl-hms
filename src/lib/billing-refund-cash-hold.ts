import type { D1PreparedStatement } from '@cloudflare/workers-types';
import { calculateBillingCounterSessionCashSummary } from './billing-counter-session';
import { shadowCreateCashLedgerEntry } from './cash-ledger-writer';

export type RefundCashHold = {
  id: number;
  approvalRequestId: number;
  billId: number;
  patientId: number;
  amount: number;
  paymentMethod: 'cash';
  employeeId: number;
  counterId: number;
  counterSessionId: number;
  status: 'held' | 'consumed' | 'released' | 'disputed' | 'settled';
  creditNoteId: number | null;
  idempotencyKey: string;
  heldAt: string | null;
  consumedAt: string | null;
  releasedAt: string | null;
  custodyUserId: number | null;
  releaseStatus: 'not_applicable' | 'pending' | 'credited';
  releaseCounterSessionId: number | null;
  releaseCashMovementId: number | null;
  releaseCreditedAt: string | null;
};

type RefundCashHoldRow = {
  id: number;
  approval_request_id: number;
  bill_id: number;
  patient_id: number;
  amount: number;
  payment_method: string;
  employee_id: number;
  counter_id: number;
  counter_session_id: number;
  status: string;
  credit_note_id: number | null;
  idempotency_key: string;
  held_at: string | null;
  consumed_at: string | null;
  released_at: string | null;
  custody_user_id?: number | null;
  release_status?: string | null;
  release_counter_session_id?: number | null;
  release_cash_movement_id?: number | null;
  release_credited_at?: string | null;
};

function mapHold(row: RefundCashHoldRow): RefundCashHold {
  return {
    id: Number(row.id),
    approvalRequestId: Number(row.approval_request_id),
    billId: Number(row.bill_id),
    patientId: Number(row.patient_id),
    amount: Number(row.amount),
    paymentMethod: 'cash',
    employeeId: Number(row.employee_id),
    counterId: Number(row.counter_id),
    counterSessionId: Number(row.counter_session_id),
    status: row.status as RefundCashHold['status'],
    creditNoteId: row.credit_note_id == null ? null : Number(row.credit_note_id),
    idempotencyKey: String(row.idempotency_key),
    heldAt: row.held_at ?? null,
    consumedAt: row.consumed_at ?? null,
    releasedAt: row.released_at ?? null,
    custodyUserId: row.custody_user_id == null ? null : Number(row.custody_user_id),
    releaseStatus: (row.release_status ?? 'not_applicable') as RefundCashHold['releaseStatus'],
    releaseCounterSessionId: row.release_counter_session_id == null ? null : Number(row.release_counter_session_id),
    releaseCashMovementId: row.release_cash_movement_id == null ? null : Number(row.release_cash_movement_id),
    releaseCreditedAt: row.release_credited_at ?? null,
  };
}

export async function getActiveRefundHoldTotal(
  db: D1Database,
  tenantId: string,
  counterSessionId: number,
): Promise<number> {
  const row = await db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS amount
    FROM billing_refund_cash_holds
    WHERE tenant_id = ?
      AND counter_session_id = ?
      AND status = 'held'
  `).bind(tenantId, counterSessionId).first<{ amount?: number | null }>();
  return Number(row?.amount ?? 0);
}

export async function getCounterAvailableCash(
  db: D1Database,
  tenantId: string,
  counterSessionId: number,
): Promise<{ expectedCash: number; heldRefundCash: number; availableCash: number }> {
  const summary = await calculateBillingCounterSessionCashSummary(db, tenantId, counterSessionId);
  return {
    expectedCash: summary.expectedCash,
    heldRefundCash: summary.heldRefundCash,
    availableCash: summary.availableCash,
  };
}

export async function loadRefundCashHold(
  db: D1Database,
  tenantId: string,
  approvalRequestId: number,
): Promise<RefundCashHold | null> {
  const row = await db.prepare(`
    SELECT *
    FROM billing_refund_cash_holds
    WHERE tenant_id = ?
      AND approval_request_id = ?
    LIMIT 1
  `).bind(tenantId, approvalRequestId).first<RefundCashHoldRow>();
  return row ? mapHold(row) : null;
}

export async function loadHeldRefundCashHold(
  db: D1Database,
  tenantId: string,
  approvalRequestId: number,
): Promise<RefundCashHold | null> {
  const hold = await loadRefundCashHold(db, tenantId, approvalRequestId);
  return hold?.status === 'held' ? hold : null;
}

export async function loadHeldRefundCashHoldsForSession(
  db: D1Database,
  tenantId: string,
  counterSessionId: number,
): Promise<RefundCashHold[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM billing_refund_cash_holds
    WHERE tenant_id = ?
      AND counter_session_id = ?
      AND status = 'held'
    ORDER BY id ASC
  `).bind(tenantId, counterSessionId).all<RefundCashHoldRow>();
  return (results ?? []).map(mapHold);
}

export async function loadRefundReserveReleaseCreditsForSession(
  db: D1Database,
  tenantId: string,
  counterSessionId: number,
): Promise<RefundCashHold[]> {
  const { results } = await db.prepare(`
    SELECT *
    FROM billing_refund_cash_holds
    WHERE tenant_id = ?
      AND release_counter_session_id = ?
      AND status = 'released'
      AND release_status = 'credited'
    ORDER BY id ASC
  `).bind(tenantId, counterSessionId).all<RefundCashHoldRow>();
  return (results ?? []).map(mapHold);
}

export async function loadRefundCashHoldByIdempotencyKey(
  db: D1Database,
  tenantId: string,
  idempotencyKey: string,
): Promise<RefundCashHold | null> {
  const row = await db.prepare(`
    SELECT *
    FROM billing_refund_cash_holds
    WHERE tenant_id = ? AND idempotency_key = ?
    LIMIT 1
  `).bind(tenantId, idempotencyKey).first<RefundCashHoldRow>();
  return row ? mapHold(row) : null;
}

export function prepareCreateRefundHold(
  db: D1Database,
  input: {
    tenantId: string;
    approvalRequestIdLookupSql: string;
    approvalLookupBindings: unknown[];
    billId: number;
    patientId: number;
    amount: number;
    employeeId: number;
    counterId: number;
    counterSessionId: number;
    idempotencyKey: string;
  },
): D1PreparedStatement {
  return db.prepare(`
    INSERT INTO billing_refund_cash_holds (
      tenant_id, approval_request_id, bill_id, patient_id, amount,
      payment_method, employee_id, counter_id, counter_session_id,
      status, idempotency_key
    ) VALUES (
      ?,
      (${input.approvalRequestIdLookupSql}),
      ?,
      ?,
      CASE
        WHEN ? > 0
         AND EXISTS (
           SELECT 1
           FROM billing_counter_sessions session
           WHERE session.tenant_id = ?
             AND session.id = ?
             AND session.employee_id = ?
             AND session.counter_id = ?
             AND session.status = 'active'
             AND ? <= (
               COALESCE(session.opening_cash, 0)
               + COALESCE((
                 SELECT SUM(CASE
                   WHEN tx.payment_method = 'cash'
                    AND tx.transaction_type IN ('CashSales', 'CollectionFromReceivable', 'CashDiscountReceived')
                   THEN tx.amount
                   WHEN tx.payment_method = 'cash'
                    AND tx.transaction_type IN ('SalesReturn', 'ReturnDeposit', 'CashDiscountGiven')
                   THEN -tx.amount
                   ELSE 0
                 END)
                 FROM emp_cash_transactions tx
                 WHERE tx.tenant_id = session.tenant_id
                   AND tx.counter_session_id = session.id
               ), 0)
               + COALESCE((
                 SELECT SUM(CASE
                   WHEN movement.movement_type = 'cash_in' THEN movement.amount
                   WHEN movement.movement_type IN ('cash_out', 'cash_drop') THEN -movement.amount
                   ELSE 0
                 END)
                 FROM cash_drawer_movements movement
                 WHERE movement.tenant_id = session.tenant_id
                   AND movement.counter_session_id = session.id
               ), 0)
               - COALESCE((
                 SELECT SUM(existing.amount)
                 FROM billing_refund_cash_holds existing
                 WHERE existing.tenant_id = session.tenant_id
                   AND existing.counter_session_id = session.id
                   AND existing.status = 'held'
               ), 0)
             )
         )
        THEN ?
        ELSE 0
      END,
      'cash',
      ?,
      ?,
      ?,
      'held',
      ?
    )
  `).bind(
    input.tenantId,
    ...input.approvalLookupBindings,
    input.billId,
    input.patientId,
    input.amount,
    input.tenantId,
    input.counterSessionId,
    input.employeeId,
    input.counterId,
    input.amount,
    input.amount,
    input.employeeId,
    input.counterId,
    input.counterSessionId,
    input.idempotencyKey,
  ) as unknown as D1PreparedStatement;
}

export function prepareConsumeRefundHold(
  db: D1Database,
  input: { tenantId: string; holdId: number; reviewerId: number; creditNoteId: number },
): D1PreparedStatement {
  return db.prepare(`
    UPDATE billing_refund_cash_holds
    SET status = 'consumed',
        credit_note_id = ?,
        consumed_at = datetime('now', '+6 hours'),
        resolved_by = ?,
        resolution_reason = 'Refund approved',
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ? AND id = ? AND status = 'held'
  `).bind(input.creditNoteId, input.reviewerId, input.tenantId, input.holdId) as unknown as D1PreparedStatement;
}

export type RefundReserveReleaseDestination = {
  counterSessionId: number;
  counterId: number;
  custodyUserId: number;
};

export type ExecutedRefundCashReturnInput = {
  tenantId: string;
  holdId: number;
  approvalRequestId: number;
  amount: number;
  reviewerId: number;
  destination: {
    counterSessionId: number;
    counterId: number;
    employeeId: number;
  };
  idempotencyKey: string;
  reason: string;
};

export function prepareCreditReturnedExecutedRefundCash(
  db: D1Database,
  input: ExecutedRefundCashReturnInput,
): D1PreparedStatement {
  return db.prepare(`
    INSERT OR IGNORE INTO cash_drawer_movements (
      tenant_id, counter_session_id, counter_id, employee_id,
      movement_type, amount, payment_method, description,
      reference_type, reference_id, created_by, created_at
    )
    SELECT ?, ?, ?, ?, 'cash_in', ?, 'cash', ?,
           'executed_refund_cash_return', ?, ?, datetime('now', '+6 hours')
    WHERE EXISTS (
      SELECT 1
      FROM billing_refund_cash_holds hold
      JOIN approval_requests approval
        ON approval.tenant_id = hold.tenant_id
       AND approval.id = hold.approval_request_id
      JOIN billing_counter_sessions session
        ON session.tenant_id = hold.tenant_id
       AND session.id = ?
       AND session.counter_id = ?
       AND session.employee_id = ?
       AND session.status = 'active'
       AND COALESCE(session.variance_approval_status, '') <> 'pending'
      WHERE hold.tenant_id = ?
        AND hold.id = ?
        AND hold.approval_request_id = ?
        AND hold.status = 'consumed'
        AND ABS(hold.amount - ?) < 0.001
        AND approval.status = 'rejected'
        AND approval.reviewed_by = ?
        AND approval.execution_status = 'succeeded'
    )
  `).bind(
    input.tenantId,
    input.destination.counterSessionId,
    input.destination.counterId,
    input.destination.employeeId,
    input.amount,
    `Returned cash for rejected refund #${input.approvalRequestId} (${input.idempotencyKey})`,
    input.holdId,
    input.reviewerId,
    input.destination.counterSessionId,
    input.destination.counterId,
    input.destination.employeeId,
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    input.amount,
    input.reviewerId,
  ) as unknown as D1PreparedStatement;
}

export function prepareSettleExecutedRefundHold(
  db: D1Database,
  input: ExecutedRefundCashReturnInput,
): D1PreparedStatement {
  return db.prepare(`
    UPDATE billing_refund_cash_holds
    SET status = 'settled',
        release_status = 'credited',
        release_counter_session_id = ?,
        release_cash_movement_id = (
          SELECT movement.id
          FROM cash_drawer_movements movement
          WHERE movement.tenant_id = billing_refund_cash_holds.tenant_id
            AND movement.reference_type = 'executed_refund_cash_return'
            AND movement.reference_id = billing_refund_cash_holds.id
            AND movement.movement_type = 'cash_in'
            AND movement.counter_session_id = ?
            AND movement.counter_id = ?
            AND movement.employee_id = ?
          LIMIT 1
        ),
        release_credited_at = datetime('now', '+6 hours'),
        resolved_by = ?,
        resolution_reason = ?,
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND id = ?
      AND approval_request_id = ?
      AND status = 'consumed'
      AND ABS(amount - ?) < 0.001
      AND EXISTS (
        SELECT 1
        FROM approval_requests approval
        WHERE approval.tenant_id = billing_refund_cash_holds.tenant_id
          AND approval.id = billing_refund_cash_holds.approval_request_id
          AND approval.status = 'rejected'
          AND approval.reviewed_by = ?
          AND approval.execution_status = 'succeeded'
      )
      AND EXISTS (
        SELECT 1
        FROM cash_drawer_movements movement
        WHERE movement.tenant_id = billing_refund_cash_holds.tenant_id
          AND movement.reference_type = 'executed_refund_cash_return'
          AND movement.reference_id = billing_refund_cash_holds.id
          AND movement.movement_type = 'cash_in'
          AND movement.counter_session_id = ?
          AND movement.counter_id = ?
          AND movement.employee_id = ?
          AND ABS(movement.amount - billing_refund_cash_holds.amount) < 0.001
      )
  `).bind(
    input.destination.counterSessionId,
    input.destination.counterSessionId,
    input.destination.counterId,
    input.destination.employeeId,
    input.reviewerId,
    input.reason,
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    input.amount,
    input.reviewerId,
    input.destination.counterSessionId,
    input.destination.counterId,
    input.destination.employeeId,
  ) as unknown as D1PreparedStatement;
}

export function prepareCreditRefundReserveRelease(
  db: D1Database,
  input: {
    tenantId: string;
    holdId: number;
    approvalRequestId: number;
    amount: number;
    reviewerId: number;
    destination: RefundReserveReleaseDestination;
  },
): D1PreparedStatement {
  return db.prepare(`
    INSERT OR IGNORE INTO cash_drawer_movements (
      tenant_id, counter_session_id, counter_id, employee_id,
      movement_type, amount, payment_method, description,
      reference_type, reference_id, created_by
    )
    SELECT ?, ?, ?, ?, 'cash_in', ?, 'cash', ?, 'refund_reserve_release', ?, ?
    WHERE EXISTS (
      SELECT 1
      FROM billing_refund_cash_holds hold
      JOIN approval_requests approval
        ON approval.id = hold.approval_request_id
       AND approval.tenant_id = hold.tenant_id
      JOIN billing_counter_sessions session
        ON session.id = ?
       AND session.tenant_id = hold.tenant_id
       AND session.counter_id = ?
       AND session.employee_id = ?
       AND session.status = 'active'
       AND COALESCE(session.variance_approval_status, '') <> 'pending'
      WHERE hold.tenant_id = ?
        AND hold.id = ?
        AND hold.approval_request_id = ?
        AND hold.status = 'held'
        AND hold.custody_user_id = ?
        AND approval.status = 'rejected'
        AND approval.reviewed_by = ?
        AND COALESCE(approval.execution_status, 'not_required') NOT IN ('processing', 'succeeded')
    )
  `).bind(
    input.tenantId,
    input.destination.counterSessionId,
    input.destination.counterId,
    input.destination.custodyUserId,
    input.amount,
    `Released refund reserve #${input.holdId}`,
    input.holdId,
    input.reviewerId,
    input.destination.counterSessionId,
    input.destination.counterId,
    input.destination.custodyUserId,
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    input.destination.custodyUserId,
    input.reviewerId,
  ) as unknown as D1PreparedStatement;
}

export function prepareReleaseRefundHold(
  db: D1Database,
  input: {
    tenantId: string;
    holdId: number;
    approvalRequestId: number;
    reviewerId: number;
    reason: string;
    destination?: RefundReserveReleaseDestination | null;
  },
): D1PreparedStatement {
  return db.prepare(`
    UPDATE billing_refund_cash_holds
    SET status = 'released',
        released_at = datetime('now', '+6 hours'),
        release_status = CASE
          WHEN EXISTS (
            SELECT 1
            FROM cash_drawer_movements movement
            WHERE movement.tenant_id = billing_refund_cash_holds.tenant_id
              AND movement.reference_type = 'refund_reserve_release'
              AND movement.reference_id = billing_refund_cash_holds.id
              AND movement.movement_type = 'cash_in'
          ) THEN 'credited'
          WHEN custody_user_id IS NOT NULL THEN 'pending'
          ELSE 'not_applicable'
        END,
        release_counter_session_id = (
          SELECT movement.counter_session_id
          FROM cash_drawer_movements movement
          WHERE movement.tenant_id = billing_refund_cash_holds.tenant_id
            AND movement.reference_type = 'refund_reserve_release'
            AND movement.reference_id = billing_refund_cash_holds.id
            AND movement.movement_type = 'cash_in'
          LIMIT 1
        ),
        release_cash_movement_id = (
          SELECT movement.id
          FROM cash_drawer_movements movement
          WHERE movement.tenant_id = billing_refund_cash_holds.tenant_id
            AND movement.reference_type = 'refund_reserve_release'
            AND movement.reference_id = billing_refund_cash_holds.id
            AND movement.movement_type = 'cash_in'
          LIMIT 1
        ),
        release_credited_at = CASE
          WHEN EXISTS (
            SELECT 1
            FROM cash_drawer_movements movement
            WHERE movement.tenant_id = billing_refund_cash_holds.tenant_id
              AND movement.reference_type = 'refund_reserve_release'
              AND movement.reference_id = billing_refund_cash_holds.id
              AND movement.movement_type = 'cash_in'
          ) THEN datetime('now', '+6 hours')
          ELSE NULL
        END,
        resolved_by = ?,
        resolution_reason = ?,
        updated_at = datetime('now', '+6 hours')
    WHERE tenant_id = ?
      AND id = ?
      AND approval_request_id = ?
      AND status = 'held'
      AND EXISTS (
        SELECT 1
        FROM approval_requests ar
        WHERE ar.id = ?
          AND ar.tenant_id = ?
          AND ar.status = 'rejected'
          AND ar.reviewed_by = ?
          AND COALESCE(ar.execution_status, 'not_required') NOT IN ('processing', 'succeeded')
      )
  `).bind(
    input.reviewerId,
    input.reason,
    input.tenantId,
    input.holdId,
    input.approvalRequestId,
    input.approvalRequestId,
    input.tenantId,
    input.reviewerId,
  ) as unknown as D1PreparedStatement;
}

export async function creditPendingRefundReserveReleasesForSession(
  db: D1Database,
  input: {
    tenantId: string;
    custodyUserId: number;
    counterSessionId: number;
    counterId: number;
    createdBy: number;
  },
): Promise<number> {
  const results = await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO cash_drawer_movements (
        tenant_id, counter_session_id, counter_id, employee_id,
        movement_type, amount, payment_method, description,
        reference_type, reference_id, created_by
      )
      SELECT h.tenant_id, ?, ?, ?, 'cash_in', h.amount, 'cash',
        'Released refund reserve #' || h.id,
        'refund_reserve_release', h.id, ?
      FROM billing_refund_cash_holds h
      WHERE h.tenant_id = ?
        AND h.custody_user_id = ?
        AND h.status = 'released'
        AND h.release_status = 'pending'
        AND EXISTS (
          SELECT 1
          FROM billing_counter_sessions session
          WHERE session.tenant_id = h.tenant_id
            AND session.id = ?
            AND session.counter_id = ?
            AND session.employee_id = ?
            AND session.status = 'active'
            AND COALESCE(session.variance_approval_status, '') <> 'pending'
        )
    `).bind(
      input.counterSessionId,
      input.counterId,
      input.custodyUserId,
      input.createdBy,
      input.tenantId,
      input.custodyUserId,
      input.counterSessionId,
      input.counterId,
      input.custodyUserId,
    ),
    db.prepare(`
      UPDATE billing_refund_cash_holds
      SET release_status = 'credited',
          release_counter_session_id = (
            SELECT movement.counter_session_id
            FROM cash_drawer_movements movement
            WHERE movement.tenant_id = billing_refund_cash_holds.tenant_id
              AND movement.reference_type = 'refund_reserve_release'
              AND movement.reference_id = billing_refund_cash_holds.id
              AND movement.movement_type = 'cash_in'
              AND movement.counter_session_id = ?
              AND movement.counter_id = ?
              AND movement.employee_id = ?
            LIMIT 1
          ),
          release_cash_movement_id = (
            SELECT movement.id
            FROM cash_drawer_movements movement
            WHERE movement.tenant_id = billing_refund_cash_holds.tenant_id
              AND movement.reference_type = 'refund_reserve_release'
              AND movement.reference_id = billing_refund_cash_holds.id
              AND movement.movement_type = 'cash_in'
              AND movement.counter_session_id = ?
              AND movement.counter_id = ?
              AND movement.employee_id = ?
            LIMIT 1
          ),
          release_credited_at = datetime('now', '+6 hours'),
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND custody_user_id = ?
        AND status = 'released'
        AND release_status = 'pending'
        AND EXISTS (
          SELECT 1
          FROM cash_drawer_movements movement
          WHERE movement.tenant_id = billing_refund_cash_holds.tenant_id
            AND movement.reference_type = 'refund_reserve_release'
            AND movement.reference_id = billing_refund_cash_holds.id
            AND movement.movement_type = 'cash_in'
            AND movement.counter_session_id = ?
            AND movement.counter_id = ?
            AND movement.employee_id = ?
        )
    `).bind(
      input.counterSessionId,
      input.counterId,
      input.custodyUserId,
      input.counterSessionId,
      input.counterId,
      input.custodyUserId,
      input.tenantId,
      input.custodyUserId,
      input.counterSessionId,
      input.counterId,
      input.custodyUserId,
    ),
  ]);
  return Number((results[1] as any)?.meta?.changes ?? 0);
}

export async function shadowRefundReserveHeld(
  db: D1Database,
  tenantId: string,
  hold: RefundCashHold,
  createdBy: number,
): Promise<void> {
  await shadowCreateCashLedgerEntry(db, {
    tenantId,
    sourceType: 'refund_reserve_hold',
    sourceId: hold.id,
    sourceNo: `RRH-${hold.id}`,
    eventType: 'REFUND_RESERVE_HELD',
    movementDirection: 'neutral',
    cashStatus: 'HELD_FOR_REFUND',
    status: hold.status,
    amount: hold.amount,
    expectedAmount: hold.amount,
    receivedAmount: hold.amount,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: hold.employeeId,
    toUserId: hold.employeeId,
    counterSessionId: hold.counterSessionId,
    counterId: hold.counterId,
    currentLocationType: 'drawer_reserve',
    currentLocationLabel: `Counter session #${hold.counterSessionId} refund reserve`,
    referenceType: 'refund_reserve_hold',
    referenceId: hold.id,
    metadata: {
      approvalRequestId: hold.approvalRequestId,
      billId: hold.billId,
      patientId: hold.patientId,
      originalCounterSessionId: hold.counterSessionId,
      shadowSource: 'billing_refund_cash_holds',
    },
    idempotencyKey: `cash-ledger:refund-reserve:${hold.id}:held`,
    createdBy,
    occurredAt: new Date().toISOString(),
  });
}

export async function shadowRefundReserveCustodyTransfer(
  db: D1Database,
  tenantId: string,
  hold: RefundCashHold,
  custodyUserId: number,
  createdBy: number,
): Promise<void> {
  await shadowCreateCashLedgerEntry(db, {
    tenantId,
    sourceType: 'refund_reserve_hold',
    sourceId: hold.id,
    sourceNo: `RRH-${hold.id}`,
    eventType: 'REFUND_RESERVE_CUSTODY_TRANSFERRED',
    movementDirection: 'transfer',
    cashStatus: 'HELD_FOR_REFUND',
    status: hold.status,
    amount: hold.amount,
    expectedAmount: hold.amount,
    receivedAmount: hold.amount,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: hold.employeeId,
    toUserId: custodyUserId,
    counterSessionId: hold.counterSessionId,
    counterId: hold.counterId,
    currentLocationType: 'custody',
    currentLocationLabel: `Refund reserve custody user #${custodyUserId}`,
    referenceType: 'refund_reserve_hold',
    referenceId: hold.id,
    metadata: {
      approvalRequestId: hold.approvalRequestId,
      billId: hold.billId,
      patientId: hold.patientId,
      originalCounterSessionId: hold.counterSessionId,
      custodyUserId,
      shadowSource: 'billing_refund_cash_holds',
    },
    idempotencyKey: `cash-ledger:refund-reserve:${hold.id}:custody:${custodyUserId}`,
    createdBy,
    occurredAt: new Date().toISOString(),
  });
}

export async function shadowRefundReserveReleased(
  db: D1Database,
  tenantId: string,
  hold: RefundCashHold,
  createdBy: number,
): Promise<void> {
  if (hold.custodyUserId == null || hold.releaseCounterSessionId == null) return;
  const destination = await db.prepare(`
    SELECT counter_id
    FROM billing_counter_sessions
    WHERE tenant_id = ? AND id = ? AND employee_id = ?
    LIMIT 1
  `).bind(tenantId, hold.releaseCounterSessionId, hold.custodyUserId)
    .first<{ counter_id: number }>();
  if (!destination?.counter_id) return;

  await shadowCreateCashLedgerEntry(db, {
    tenantId,
    sourceType: 'refund_reserve_hold',
    sourceId: hold.id,
    sourceNo: `RRH-${hold.id}`,
    eventType: 'REFUND_RESERVE_RELEASED',
    movementDirection: 'transfer',
    cashStatus: 'IN_DRAWER',
    status: hold.status,
    amount: hold.amount,
    expectedAmount: hold.amount,
    receivedAmount: hold.amount,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: hold.custodyUserId,
    toUserId: hold.custodyUserId,
    counterSessionId: hold.releaseCounterSessionId,
    counterId: Number(destination.counter_id),
    currentLocationType: 'drawer',
    currentLocationLabel: `Counter session #${hold.releaseCounterSessionId}`,
    referenceType: 'refund_reserve_release',
    referenceId: hold.id,
    metadata: {
      approvalRequestId: hold.approvalRequestId,
      billId: hold.billId,
      patientId: hold.patientId,
      originalCounterSessionId: hold.counterSessionId,
      releaseCashMovementId: hold.releaseCashMovementId,
      shadowSource: 'billing_refund_cash_holds',
    },
    idempotencyKey: `cash-ledger:refund-reserve:${hold.id}:released`,
    createdBy,
    occurredAt: new Date().toISOString(),
  });
}

export async function shadowRefundReserveConsumed(
  db: D1Database,
  tenantId: string,
  hold: RefundCashHold,
  createdBy: number,
): Promise<void> {
  await shadowCreateCashLedgerEntry(db, {
    tenantId,
    sourceType: 'refund_reserve_hold',
    sourceId: hold.id,
    sourceNo: `RRH-${hold.id}`,
    eventType: 'REFUND_RESERVE_CONSUMED',
    movementDirection: 'out',
    cashStatus: 'REFUNDED',
    status: 'consumed',
    amount: hold.amount,
    expectedAmount: hold.amount,
    receivedAmount: 0,
    dueAmount: 0,
    paymentMethod: 'cash',
    fromUserId: hold.custodyUserId ?? hold.employeeId,
    toUserId: hold.patientId,
    counterSessionId: hold.counterSessionId,
    counterId: hold.counterId,
    currentLocationType: 'patient_refund',
    currentLocationLabel: `Patient #${hold.patientId}`,
    referenceType: 'refund_reserve_hold',
    referenceId: hold.id,
    metadata: {
      approvalRequestId: hold.approvalRequestId,
      billId: hold.billId,
      patientId: hold.patientId,
      originalCounterSessionId: hold.counterSessionId,
      custodyUserId: hold.custodyUserId,
      shadowSource: 'billing_refund_cash_holds',
    },
    idempotencyKey: `cash-ledger:refund-reserve:${hold.id}:consumed`,
    createdBy,
    occurredAt: new Date().toISOString(),
  });
}
