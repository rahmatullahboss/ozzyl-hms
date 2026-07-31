import { HTTPException } from 'hono/http-exception';
import { reverseMappedLabConsumablesForOrderItem } from './lab-consumables';
import { createIdempotencyRequestHash } from './request-idempotency';
import {
  commitLabCancellationCore,
  findLabCancellationOperation,
  loadLabCancellationResult,
  markLabCancellationCompleted,
  recordLabCancellationFailure,
  reserveLabCancellationOperation,
  type LabCancellationOperationRow,
} from './lab-cancellation-operation';

interface LabOrderItemRow {
  id: number;
  status: string | null;
  lab_order_id: number;
  lab_test_id: number;
  line_total: number | null;
  bill_id: number | null;
  tenant_id: string | number;
}

interface LinkedInvoiceItemRow {
  id: number;
  bill_id: number;
  line_total: number | null;
  bill_paid: number | null;
  bill_status: string | null;
}

export interface CancelLabOrderItemInput {
  tenantId: string | number;
  userId: string | number;
  itemId: number;
  reason: string;
  notes?: string | null;
  skipInvoiceUpdate?: boolean;
}

export interface CancelLabOrderItemResult {
  itemId: number;
  billId: number | null;
  labOrderId: number;
  cancelledAmount: number;
  newBillTotal: number | null;
  orderStatus: string;
  operationDate: string;
  replayed?: boolean;
}

function isNotFound(error: unknown): boolean {
  return error instanceof HTTPException && error.status === 404;
}

async function findLabOrderItem(
  db: D1Database,
  tenantId: string,
  itemId: number,
): Promise<LabOrderItemRow | null> {
  return db.prepare(`
    SELECT
      loi.id,
      loi.status,
      loi.lab_order_id,
      loi.lab_test_id,
      loi.line_total,
      lo.bill_id,
      lo.tenant_id
    FROM lab_order_items loi
    JOIN lab_orders lo ON lo.id = loi.lab_order_id AND lo.tenant_id = loi.tenant_id
    WHERE loi.id = ? AND lo.tenant_id = ?
  `).bind(itemId, tenantId).first<LabOrderItemRow>();
}

async function getLinkedInvoiceItems(
  db: D1Database,
  tenantId: string,
  itemId: number,
): Promise<LinkedInvoiceItemRow[]> {
  const { results } = await db.prepare(`
    SELECT
      ii.id,
      ii.bill_id,
      ii.line_total,
      b.paid AS bill_paid,
      b.status AS bill_status
    FROM invoice_items ii
    JOIN bills b ON b.id = ii.bill_id AND b.tenant_id = ii.tenant_id
    WHERE ii.tenant_id = ?
      AND ii.item_category = 'test'
      AND ii.reference_id = ?
      AND COALESCE(ii.status, 'active') != 'cancelled'
  `).bind(tenantId, itemId).all<LinkedInvoiceItemRow>();

  return results ?? [];
}

async function assertBillHasNoPayment(
  db: D1Database,
  tenantId: string,
  billId: number | null,
): Promise<void> {
  if (!billId) return;

  const bill = await db.prepare(
    'SELECT id, paid, status FROM bills WHERE id = ? AND tenant_id = ?',
  ).bind(billId, tenantId).first<{ id: number; paid: number | null; status: string | null }>();

  if (Number(bill?.paid ?? 0) > 0 || bill?.status === 'paid' || bill?.status === 'partially_paid') {
    throw new HTTPException(409, {
      message: 'Cannot cancel lab item after payment. Use credit note instead.',
    });
  }
}

function assertInvoiceItemsUnpaid(invoiceItems: LinkedInvoiceItemRow[]): void {
  for (const invoiceItem of invoiceItems) {
    if (
      Number(invoiceItem.bill_paid ?? 0) > 0
      || invoiceItem.bill_status === 'paid'
      || invoiceItem.bill_status === 'partially_paid'
    ) {
      throw new HTTPException(409, {
        message: 'Cannot cancel lab item after payment. Use credit note instead.',
      });
    }
  }
}

async function buildCancellationRequestHash(
  tenantId: string,
  input: CancelLabOrderItemInput,
): Promise<string> {
  return createIdempotencyRequestHash({
    tenantId,
    body: {
      itemId: input.itemId,
      reason: input.reason.trim(),
      notes: input.notes?.trim() || null,
      skipInvoiceUpdate: Boolean(input.skipInvoiceUpdate),
    },
  });
}

function assertOperationHash(operation: LabCancellationOperationRow, requestHash: string): void {
  if (operation.request_hash !== requestHash) {
    throw new HTTPException(409, {
      message: 'This lab item cancellation was already started with different details.',
    });
  }
}

async function finishCancellationReversal(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string;
    itemId: number;
    reason: string;
    replayed: boolean;
  },
): Promise<CancelLabOrderItemResult> {
  try {
    await reverseMappedLabConsumablesForOrderItem(db, {
      tenantId: input.tenantId,
      userId: input.userId,
      labOrderItemId: input.itemId,
      reason: input.reason,
    });
    await markLabCancellationCompleted(db, {
      tenantId: input.tenantId,
      itemId: input.itemId,
    });
  } catch (error) {
    await recordLabCancellationFailure(db, {
      tenantId: input.tenantId,
      itemId: input.itemId,
      error,
      preserveCoreCompleted: true,
    }).catch(() => undefined);
    throw error;
  }

  return loadLabCancellationResult(db, {
    tenantId: input.tenantId,
    itemId: input.itemId,
    replayed: input.replayed,
  });
}

async function resumeExistingCancellation(
  db: D1Database,
  input: {
    tenantId: string;
    userId: string;
    itemId: number;
    requestHash: string;
    operation: LabCancellationOperationRow;
  },
): Promise<CancelLabOrderItemResult | null> {
  assertOperationHash(input.operation, input.requestHash);

  if (input.operation.status === 'completed') {
    return loadLabCancellationResult(db, {
      tenantId: input.tenantId,
      itemId: input.itemId,
      replayed: true,
    });
  }

  if (input.operation.status === 'core_completed') {
    return finishCancellationReversal(db, {
      tenantId: input.tenantId,
      userId: input.userId,
      itemId: input.itemId,
      reason: input.operation.reason,
      replayed: true,
    });
  }

  return null;
}

export async function cancelLabOrderItem(
  db: D1Database,
  input: CancelLabOrderItemInput,
): Promise<CancelLabOrderItemResult> {
  const tenantId = String(input.tenantId);
  const userId = String(input.userId);
  const requestHash = await buildCancellationRequestHash(tenantId, input);

  const existingOperation = await findLabCancellationOperation(db, {
    tenantId,
    itemId: input.itemId,
  });
  if (existingOperation) {
    const resumed = await resumeExistingCancellation(db, {
      tenantId,
      userId,
      itemId: input.itemId,
      requestHash,
      operation: existingOperation,
    });
    if (resumed) return resumed;
  }

  const item = await findLabOrderItem(db, tenantId, input.itemId);
  if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });

  const currentStatus = item.status ?? 'pending';
  if (currentStatus === 'cancelled' && !existingOperation) {
    throw new HTTPException(400, { message: 'Lab order item already cancelled' });
  }
  if (['completed', 'verified'].includes(currentStatus)) {
    throw new HTTPException(409, {
      message: `Cannot cancel lab item in status '${currentStatus}'. Use correction/refund workflow instead.`,
    });
  }

  const skipInvoiceUpdate = Boolean(input.skipInvoiceUpdate);
  const invoiceItems = skipInvoiceUpdate
    ? []
    : await getLinkedInvoiceItems(db, tenantId, input.itemId);

  if (!skipInvoiceUpdate) {
    if (invoiceItems.length === 0) {
      await assertBillHasNoPayment(db, tenantId, item.bill_id);
    }
    assertInvoiceItemsUnpaid(invoiceItems);
  }

  const cancelledAmount = invoiceItems.reduce(
    (sum, invoiceItem) => sum + (Number(invoiceItem.line_total ?? 0) || 0),
    0,
  );
  const billIds = invoiceItems.map((invoiceItem) => Number(invoiceItem.bill_id)).filter(Boolean);
  const billId = item.bill_id ?? billIds[0] ?? null;

  const operation = await reserveLabCancellationOperation(db, {
    tenantId,
    userId,
    itemId: input.itemId,
    requestHash,
    skipInvoiceUpdate,
    billId,
    labOrderId: item.lab_order_id,
    cancelledAmount,
    reason: input.reason.trim(),
    notes: input.notes?.trim() || null,
  });

  const resumedAfterReserve = await resumeExistingCancellation(db, {
    tenantId,
    userId,
    itemId: input.itemId,
    requestHash,
    operation,
  });
  if (resumedAfterReserve) return resumedAfterReserve;

  try {
    await commitLabCancellationCore(db, {
      tenantId,
      userId,
      itemId: input.itemId,
      labOrderId: item.lab_order_id,
      invoiceItemIds: invoiceItems.map((invoiceItem) => Number(invoiceItem.id)),
      billIds,
      skipInvoiceUpdate,
      reason: input.reason.trim(),
      notes: input.notes?.trim() || null,
    });
  } catch (error) {
    await recordLabCancellationFailure(db, {
      tenantId,
      itemId: input.itemId,
      error,
      preserveCoreCompleted: false,
    }).catch(() => undefined);
    throw error;
  }

  return finishCancellationReversal(db, {
    tenantId,
    userId,
    itemId: input.itemId,
    reason: input.reason.trim(),
    replayed: Boolean(existingOperation),
  });
}

export async function loadLabOrderItemIdsForInvoiceItems(
  db: D1Database,
  input: {
    tenantId: string | number;
    invoiceItemIds: number[];
  },
): Promise<number[]> {
  const invoiceItemIds = Array.from(new Set(
    input.invoiceItemIds.filter((id) => Number.isInteger(id) && id > 0),
  ));
  if (invoiceItemIds.length === 0) return [];

  const placeholders = invoiceItemIds.map(() => '?').join(',');
  const { results } = await db.prepare(`
    SELECT ii.id AS invoice_item_id, loi.id AS lab_order_item_id
    FROM invoice_items ii
    JOIN lab_order_items loi
      ON loi.id = ii.reference_id
     AND loi.tenant_id = ii.tenant_id
    JOIN lab_orders lo
      ON lo.id = loi.lab_order_id
     AND lo.tenant_id = loi.tenant_id
     AND lo.bill_id = ii.bill_id
    WHERE ii.id IN (${placeholders})
      AND ii.tenant_id = ?
      AND ii.item_category = 'test'
      AND ii.reference_id IS NOT NULL

    UNION ALL

    SELECT ii.id AS invoice_item_id, loi.id AS lab_order_item_id
    FROM invoice_items ii
    JOIN lab_test_catalog ltc
      ON ltc.tenant_id = ii.tenant_id
     AND ltc.billing_service_item_id = ii.reference_id
    JOIN lab_order_items loi
      ON loi.tenant_id = ii.tenant_id
     AND loi.lab_test_id = ltc.id
    JOIN lab_orders lo
      ON lo.id = loi.lab_order_id
     AND lo.tenant_id = loi.tenant_id
     AND lo.bill_id = ii.bill_id
    WHERE ii.id IN (${placeholders})
      AND ii.tenant_id = ?
      AND ii.item_category = 'test'
      AND ii.reference_id IS NOT NULL
  `).bind(
    ...invoiceItemIds,
    String(input.tenantId),
    ...invoiceItemIds,
    String(input.tenantId),
  ).all<{ invoice_item_id: number; lab_order_item_id: number }>();

  const candidatesByInvoiceItem = new Map<number, Set<number>>();
  for (const row of results ?? []) {
    const invoiceItemId = Number(row.invoice_item_id);
    const labOrderItemId = Number(row.lab_order_item_id);
    if (!Number.isInteger(invoiceItemId) || invoiceItemId <= 0
      || !Number.isInteger(labOrderItemId) || labOrderItemId <= 0) continue;
    const candidates = candidatesByInvoiceItem.get(invoiceItemId) ?? new Set<number>();
    candidates.add(labOrderItemId);
    candidatesByInvoiceItem.set(invoiceItemId, candidates);
  }

  const resolved: number[] = [];
  for (const invoiceItemId of invoiceItemIds) {
    const candidates = candidatesByInvoiceItem.get(invoiceItemId);
    if (!candidates || candidates.size === 0) continue;
    if (candidates.size > 1) {
      throw new HTTPException(409, {
        message: `Invoice item ${invoiceItemId} resolves to multiple lab order items; manual review is required.`,
      });
    }
    resolved.push(Array.from(candidates)[0]);
  }
  return Array.from(new Set(resolved));
}

export async function cancelLabOrderItemsForInvoiceItems(
  db: D1Database,
  input: {
    tenantId: string | number;
    userId: string | number;
    invoiceItemIds: number[];
    reason: string;
  },
): Promise<number> {
  const itemIds = await loadLabOrderItemIdsForInvoiceItems(db, {
    tenantId: input.tenantId,
    invoiceItemIds: input.invoiceItemIds,
  });

  let cancelled = 0;
  for (const itemId of itemIds) {
    try {
      await cancelLabOrderItem(db, {
        tenantId: input.tenantId,
        userId: input.userId,
        itemId,
        reason: input.reason,
        skipInvoiceUpdate: true,
      });
      cancelled += 1;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  return cancelled;
}

export async function cancelLabOrderItemsForBill(
  db: D1Database,
  input: {
    tenantId: string | number;
    userId: string | number;
    billId: number;
    reason: string;
  },
): Promise<number> {
  const { results } = await db.prepare(`
    SELECT DISTINCT ii.reference_id
    FROM invoice_items ii
    JOIN lab_order_items loi
      ON loi.id = ii.reference_id
     AND loi.tenant_id = ii.tenant_id
    JOIN lab_orders lo
      ON lo.id = loi.lab_order_id
     AND lo.tenant_id = loi.tenant_id
     AND lo.bill_id = ii.bill_id
    WHERE ii.bill_id = ?
      AND ii.tenant_id = ?
      AND ii.item_category = 'test'
      AND ii.reference_id IS NOT NULL
      AND COALESCE(ii.status, 'active') != 'cancelled'
  `).bind(input.billId, String(input.tenantId)).all<{ reference_id: number | null }>();

  let cancelled = 0;
  for (const row of results ?? []) {
    const itemId = Number(row.reference_id);
    if (!itemId) continue;
    try {
      await cancelLabOrderItem(db, {
        tenantId: input.tenantId,
        userId: input.userId,
        itemId,
        reason: input.reason,
        skipInvoiceUpdate: true,
      });
      cancelled += 1;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
  return cancelled;
}
