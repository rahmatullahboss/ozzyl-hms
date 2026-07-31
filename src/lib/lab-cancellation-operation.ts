import { HTTPException } from 'hono/http-exception';

export type LabCancellationOperationStatus = 'processing' | 'core_completed' | 'completed' | 'failed';

export type LabCancellationOperationRow = {
  id: number;
  tenant_id: string;
  lab_order_item_id: number;
  request_hash: string;
  status: LabCancellationOperationStatus;
  skip_invoice_update: number;
  bill_id: number | null;
  lab_order_id: number;
  cancelled_amount: number;
  reason: string;
  notes: string | null;
  last_error: string | null;
};

export type LabCancellationResult = {
  itemId: number;
  billId: number | null;
  labOrderId: number;
  cancelledAmount: number;
  newBillTotal: number | null;
  orderStatus: string;
  operationDate: string;
  replayed?: boolean;
};

export async function findLabCancellationOperation(
  db: D1Database,
  input: { tenantId: string; itemId: number },
): Promise<LabCancellationOperationRow | null> {
  return db.prepare(`
    SELECT id, tenant_id, lab_order_item_id, request_hash, status,
           skip_invoice_update, bill_id, lab_order_id, cancelled_amount,
           reason, notes, last_error
    FROM lab_cancellation_operations
    WHERE tenant_id = ? AND lab_order_item_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.itemId).first<LabCancellationOperationRow>();
}

export async function reserveLabCancellationOperation(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string;
    itemId: number;
    requestHash: string;
    skipInvoiceUpdate: boolean;
    billId: number | null;
    labOrderId: number;
    cancelledAmount: number;
    reason: string;
    notes?: string | null;
  },
): Promise<LabCancellationOperationRow> {
  await db.prepare(`
    INSERT OR IGNORE INTO lab_cancellation_operations
      (tenant_id, lab_order_item_id, request_hash, status, skip_invoice_update,
       bill_id, lab_order_id, cancelled_amount, reason, notes, created_by,
       created_at, updated_at)
    VALUES (?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `).bind(
    input.tenantId,
    input.itemId,
    input.requestHash,
    input.skipInvoiceUpdate ? 1 : 0,
    input.billId,
    input.labOrderId,
    input.cancelledAmount,
    input.reason,
    input.notes ?? null,
    input.userId,
  ).run();

  const operation = await db.prepare(`
    SELECT id, tenant_id, lab_order_item_id, request_hash, status,
           skip_invoice_update, bill_id, lab_order_id, cancelled_amount,
           reason, notes, last_error
    FROM lab_cancellation_operations
    WHERE tenant_id = ? AND lab_order_item_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.itemId).first<LabCancellationOperationRow>();

  if (!operation) throw new Error('Lab cancellation operation could not be reserved');
  if (operation.request_hash !== input.requestHash) {
    throw new HTTPException(409, {
      message: 'This lab item cancellation was already started with different details.',
    });
  }
  return operation;
}

function billRecalculationStatement(
  db: D1Database,
  input: { tenantId: string; billId: number },
): D1PreparedStatement {
  return db.prepare(`
    UPDATE bills
    SET total = (
          SELECT COALESCE(SUM(ii.line_total), 0)
          FROM invoice_items ii
          WHERE ii.bill_id = bills.id
            AND ii.tenant_id = bills.tenant_id
            AND COALESCE(ii.status, 'active') = 'active'
        ),
        due = MAX(0, (
          SELECT COALESCE(SUM(ii.line_total), 0)
          FROM invoice_items ii
          WHERE ii.bill_id = bills.id
            AND ii.tenant_id = bills.tenant_id
            AND COALESCE(ii.status, 'active') = 'active'
        ) - paid),
        status = CASE
          WHEN (
            SELECT COALESCE(SUM(ii.line_total), 0)
            FROM invoice_items ii
            WHERE ii.bill_id = bills.id
              AND ii.tenant_id = bills.tenant_id
              AND COALESCE(ii.status, 'active') = 'active'
          ) <= 0 THEN 'cancelled'
          WHEN paid >= (
            SELECT COALESCE(SUM(ii.line_total), 0)
            FROM invoice_items ii
            WHERE ii.bill_id = bills.id
              AND ii.tenant_id = bills.tenant_id
              AND COALESCE(ii.status, 'active') = 'active'
          ) THEN 'paid'
          WHEN paid > 0 THEN 'partially_paid'
          ELSE 'open'
        END,
        updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).bind(input.billId, input.tenantId);
}

export async function commitLabCancellationCore(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string;
    itemId: number;
    labOrderId: number;
    invoiceItemIds: number[];
    billIds: number[];
    skipInvoiceUpdate: boolean;
    reason: string;
    notes?: string | null;
  },
): Promise<void> {
  const statements: D1PreparedStatement[] = [];

  if (!input.skipInvoiceUpdate) {
    for (const invoiceItemId of input.invoiceItemIds) {
      statements.push(db.prepare(`
        UPDATE invoice_items
        SET status = 'cancelled',
            cancelled_by = ?,
            cancelled_at = datetime('now'),
            cancel_reason = ?
        WHERE id = ? AND tenant_id = ?
          AND COALESCE(status, 'active') != 'cancelled'
      `).bind(input.userId, input.reason, invoiceItemId, input.tenantId));
    }
    for (const billId of [...new Set(input.billIds)]) {
      statements.push(billRecalculationStatement(db, { tenantId: input.tenantId, billId }));
    }
  }

  const note = input.notes ? `${input.reason}: ${input.notes}` : input.reason;
  statements.push(db.prepare(`
    UPDATE lab_order_items
    SET status = 'cancelled',
        notes = COALESCE(?, notes),
        updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).bind(note, input.itemId, input.tenantId));

  statements.push(db.prepare(`
    UPDATE visit_services
    SET status = 'cancelled',
        updated_at = datetime('now')
    WHERE tenant_id = ?
      AND reference_type = 'lab_order_item'
      AND reference_id = ?
      AND status IN ('pending', 'billed')
  `).bind(input.tenantId, input.itemId));

  statements.push(db.prepare(`
    UPDATE doctor_commission_accruals
    SET status = 'cancelled',
        notes = COALESCE(?, notes),
        updated_at = datetime('now')
    WHERE tenant_id = ?
      AND lab_order_item_id = ?
      AND status IN ('accrued', 'pending')
  `).bind(`Cancelled with lab item: ${input.reason}`, input.tenantId, input.itemId));

  statements.push(db.prepare(`
    UPDATE lab_orders
    SET status = CASE
          WHEN NOT EXISTS (
            SELECT 1 FROM lab_order_items loi
            WHERE loi.lab_order_id = lab_orders.id
              AND loi.tenant_id = lab_orders.tenant_id
              AND COALESCE(loi.status, 'pending') != 'cancelled'
          ) THEN 'cancelled'
          WHEN NOT EXISTS (
            SELECT 1 FROM lab_order_items loi
            WHERE loi.lab_order_id = lab_orders.id
              AND loi.tenant_id = lab_orders.tenant_id
              AND COALESCE(loi.status, 'pending') != 'cancelled'
              AND loi.status NOT IN ('completed', 'verified')
          ) THEN 'completed'
          ELSE 'pending'
        END,
        updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ?
  `).bind(input.labOrderId, input.tenantId));

  statements.push(db.prepare(`
    UPDATE lab_cancellation_operations
    SET status = 'core_completed',
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND lab_order_item_id = ?
      AND status IN ('processing', 'failed', 'core_completed')
  `).bind(input.tenantId, input.itemId));

  await db.batch(statements);
}

export async function markLabCancellationCompleted(
  db: D1Database,
  input: { tenantId: string; itemId: number },
): Promise<void> {
  await db.prepare(`
    UPDATE lab_cancellation_operations
    SET status = 'completed',
        last_error = NULL,
        completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND lab_order_item_id = ?
  `).bind(input.tenantId, input.itemId).run();
}

export async function recordLabCancellationFailure(
  db: D1Database,
  input: {
    tenantId: string;
    itemId: number;
    error: unknown;
    preserveCoreCompleted?: boolean;
  },
): Promise<void> {
  const message = input.error instanceof Error ? input.error.message : String(input.error);
  await db.prepare(`
    UPDATE lab_cancellation_operations
    SET status = CASE
          WHEN ? = 1 AND status = 'core_completed' THEN 'core_completed'
          ELSE 'failed'
        END,
        last_error = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE tenant_id = ? AND lab_order_item_id = ?
  `).bind(input.preserveCoreCompleted ? 1 : 0, message.slice(0, 2000), input.tenantId, input.itemId).run();
}

export async function loadLabCancellationResult(
  db: D1Database,
  input: { tenantId: string; itemId: number; replayed?: boolean },
): Promise<LabCancellationResult> {
  const row = await db.prepare(`
    SELECT
      op.lab_order_item_id AS item_id,
      op.bill_id,
      op.lab_order_id,
      op.cancelled_amount,
      lo.status AS order_status,
      b.total AS new_bill_total,
      date(op.created_at, '+6 hours') AS operation_date
    FROM lab_cancellation_operations op
    JOIN lab_orders lo ON lo.id = op.lab_order_id AND lo.tenant_id = op.tenant_id
    LEFT JOIN bills b ON b.id = op.bill_id AND b.tenant_id = op.tenant_id
    WHERE op.tenant_id = ? AND op.lab_order_item_id = ?
    LIMIT 1
  `).bind(input.tenantId, input.itemId).first<{
    item_id: number;
    bill_id: number | null;
    lab_order_id: number;
    cancelled_amount: number;
    order_status: string | null;
    new_bill_total: number | null;
    operation_date: string | null;
  }>();

  if (!row) throw new Error('Lab cancellation result could not be reconstructed');
  return {
    itemId: Number(row.item_id),
    billId: row.bill_id == null ? null : Number(row.bill_id),
    labOrderId: Number(row.lab_order_id),
    cancelledAmount: Number(row.cancelled_amount ?? 0),
    newBillTotal: row.new_bill_total == null ? null : Number(row.new_bill_total),
    orderStatus: row.order_status ?? 'pending',
    operationDate: row.operation_date ?? new Date().toISOString().slice(0, 10),
    replayed: input.replayed ?? false,
  };
}
