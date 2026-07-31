import { HTTPException } from 'hono/http-exception';

const NON_CANCELLABLE_RADIOLOGY_STATUSES = new Set([
  'scanned',
  'reported',
  'completed',
  'verified',
]);

type LinkedRadiologyRequisition = {
  id: number;
  order_status: string | null;
  bill_id: number | null;
};

function normalizeStatus(value: unknown): string {
  return String(value ?? 'pending').trim().toLowerCase() || 'pending';
}

export async function cancelRadiologyRequisitionsForInvoiceItems(
  db: D1Database,
  input: {
    tenantId: string | number;
    userId: string | number;
    billId: number;
    invoiceItemIds: number[];
    reason: string;
  },
): Promise<number> {
  const invoiceItemIds = Array.from(new Set(input.invoiceItemIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (invoiceItemIds.length === 0) return 0;

  const placeholders = invoiceItemIds.map(() => '?').join(',');
  const { results } = await db.prepare(`
    SELECT DISTINCT rr.id, rr.order_status, rr.bill_id
    FROM invoice_items ii
    JOIN radiology_requisitions rr
      ON rr.id = ii.reference_id
     AND rr.tenant_id = ii.tenant_id
     AND rr.bill_id = ii.bill_id
    WHERE ii.tenant_id = ?
      AND ii.bill_id = ?
      AND ii.id IN (${placeholders})
      AND ii.item_category = 'test'
  `).bind(String(input.tenantId), input.billId, ...invoiceItemIds).all<LinkedRadiologyRequisition>();

  let cancelled = 0;
  for (const requisition of results ?? []) {
    const status = normalizeStatus(requisition.order_status);
    if (status === 'cancelled') continue;
    if (NON_CANCELLABLE_RADIOLOGY_STATUSES.has(status)) {
      throw new HTTPException(409, {
        message: `Radiology requisition #${requisition.id} is already ${status} and cannot be cancelled through the refund workflow.`,
      });
    }

    const update = await db.prepare(`
      UPDATE radiology_requisitions
      SET order_status = 'cancelled',
          billing_status = 'cancelled',
          cancel_remarks = ?,
          is_active = 0,
          updated_at = datetime('now', '+6 hours')
      WHERE tenant_id = ?
        AND id = ?
        AND bill_id = ?
        AND COALESCE(order_status, 'pending') NOT IN ('scanned', 'reported', 'completed', 'verified', 'cancelled')
    `).bind(input.reason, String(input.tenantId), requisition.id, input.billId).run();

    if (Number(update.meta?.changes ?? 0) !== 1) {
      const current = await db.prepare(`
        SELECT order_status
        FROM radiology_requisitions
        WHERE tenant_id = ? AND id = ? AND bill_id = ?
      `).bind(String(input.tenantId), requisition.id, input.billId).first<{ order_status: string | null }>();
      if (normalizeStatus(current?.order_status) === 'cancelled') continue;
      throw new HTTPException(409, {
        message: `Radiology requisition #${requisition.id} changed status before cancellation; review it manually.`,
      });
    }

    await db.prepare(`
      INSERT INTO audit_logs (
        tenant_id, user_id, action, table_name, record_id,
        old_value, new_value, ip_address, user_agent, created_at
      ) VALUES (?, ?, 'CANCEL', 'radiology_requisitions', ?, ?, ?, NULL, NULL, datetime('now', '+6 hours'))
    `).bind(
      String(input.tenantId),
      String(input.userId),
      requisition.id,
      JSON.stringify({ orderStatus: status, billId: input.billId }),
      JSON.stringify({ orderStatus: 'cancelled', billId: input.billId, reason: input.reason }),
    ).run();
    cancelled += 1;
  }

  return cancelled;
}
