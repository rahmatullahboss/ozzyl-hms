import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import { createIdempotencyRequestHash } from '../../lib/request-idempotency';
import { ACCOUNTING_EVENT_TYPES, postPendingAccountingEvents } from '../../lib/accounting-posting';
import { getTodayGMT6 } from '../../lib/date-utils';

const prescriptionFulfilmentRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const DISPENSE_ROLES = ['hospital_admin', 'pharmacist'] as const;
const COUNTER_PAYMENT_METHODS = ['cash', 'card', 'bkash', 'nagad', 'rocket', 'bank', 'bank_transfer', 'cheque', 'other'] as const;

const hospitalDispenseSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(128),
  paymentMethod: z.enum(COUNTER_PAYMENT_METHODS),
  items: z.array(z.object({
    prescriptionItemId: z.number().int().positive(),
    medicineId: z.number().int().positive(),
    quantity: z.number().int().positive(),
  }).strict()).min(1),
}).strict().superRefine((data, ctx) => {
  const itemIds = data.items.map((item) => item.prescriptionItemId);
  if (new Set(itemIds).size !== itemIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'A prescription item may only be dispensed once in an order',
      path: ['items'],
    });
  }
});

type DispenseItemRow = {
  prescription_item_id: number;
  medicine_name: string;
  dosage: string | null;
  frequency: string | null;
  duration: string | null;
  quantity: number;
  dispensed_qty: number;
  medicine_id: number | null;
  selected_name: string | null;
  selected_generic_name: string | null;
  selected_company: string | null;
  selected_unit: string | null;
  selected_unit_price: number | null;
};

type StockBatchRow = {
  id: number;
  medicine_id: number;
  quantity_available: number;
  purchase_price: number | null;
  sale_price: number | null;
};

function queuePharmacyPosting(env: Env, executionCtx: ExecutionContext, tenantId: string): void {
  const posting = postPendingAccountingEvents(env.DB, tenantId, 20).catch((error) => {
    console.error('Failed to post medication fulfilment accounting event:', error);
  });
  executionCtx.waitUntil(posting);
}

function isDispenseConstraintFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /medication_fulfilment_stock_negative|medication_fulfilment_overdispense/i.test(message);
}

prescriptionFulfilmentRoutes.post(
  '/:id/hospital-dispense',
  requireRole(...DISPENSE_ROLES),
  zValidator('json', hospitalDispenseSchema),
  async (c) => {
    const tenantId = requireTenantId(c);
    if (!tenantId) throw new HTTPException(401, { message: 'Tenant required' });

    const prescriptionId = Number(c.req.param('id'));
    if (!Number.isInteger(prescriptionId) || prescriptionId <= 0) {
      throw new HTTPException(400, { message: 'Invalid prescription id' });
    }

    const userId = requireUserId(c);
    const body = c.req.valid('json');
    const requestHash = await createIdempotencyRequestHash({
      prescriptionId,
      paymentMethod: body.paymentMethod,
      items: body.items,
    });

    const replayOrder = await c.env.DB.prepare(`
      SELECT id, status, sale_id, request_hash
      FROM medication_orders
      WHERE tenant_id = ? AND idempotency_key = ?
      LIMIT 1
    `).bind(tenantId, body.idempotencyKey).first<{
      id: string;
      status: string;
      sale_id: number | null;
      request_hash: string;
    }>();

    if (replayOrder) {
      if (replayOrder.request_hash !== requestHash) {
        throw new HTTPException(409, { message: 'Idempotency key was already used for a different dispensing request' });
      }
      return c.json({
        id: replayOrder.id,
        saleId: replayOrder.sale_id,
        status: replayOrder.status,
        idempotent: true,
      });
    }

    const prescription = await c.env.DB.prepare(`
      SELECT id, patient_id, status
      FROM prescriptions
      WHERE id = ? AND tenant_id = ?
      LIMIT 1
    `).bind(prescriptionId, tenantId).first<{ id: number; patient_id: number; status: string }>();
    if (!prescription) throw new HTTPException(404, { message: 'Prescription not found' });
    if (prescription.status !== 'final') {
      throw new HTTPException(409, { message: 'Only final prescriptions can be dispensed' });
    }

    const itemIds = body.items.map((item) => item.prescriptionItemId);
    const itemPlaceholders = itemIds.map(() => '?').join(', ');
    const { results: prescriptionItems } = await c.env.DB.prepare(`
      SELECT pi.id AS prescription_item_id, pi.medicine_name, pi.dosage, pi.frequency, pi.duration,
             pi.quantity, pi.dispensed_qty, pi.medicine_id,
             m.name AS selected_name, m.generic_name AS selected_generic_name,
             m.company AS selected_company, m.unit AS selected_unit,
             m.unit_price AS selected_unit_price
      FROM prescription_items pi
      LEFT JOIN medicines m ON m.id = pi.medicine_id AND m.tenant_id = ? AND m.is_active = 1
      WHERE pi.prescription_id = ? AND pi.id IN (${itemPlaceholders})
    `).bind(tenantId, prescriptionId, ...itemIds).all<DispenseItemRow>();

    if ((prescriptionItems ?? []).length !== body.items.length) {
      throw new HTTPException(409, { message: 'One or more medicine items are not part of this prescription' });
    }

    const itemRows = new Map((prescriptionItems ?? []).map((item) => [Number(item.prescription_item_id), item]));
    const serverUnitPriceByItem = new Map<number, number>();
    for (const requestedItem of body.items) {
      const prescribedItem = itemRows.get(requestedItem.prescriptionItemId);
      if (!prescribedItem || Number(prescribedItem.medicine_id) !== requestedItem.medicineId) {
        throw new HTTPException(409, { message: 'Dispensing requires the medicine mapped on the prescription item' });
      }
      const remaining = Number(prescribedItem.quantity) - Number(prescribedItem.dispensed_qty ?? 0);
      if (remaining <= 0 || requestedItem.quantity > remaining) {
        throw new HTTPException(409, { message: 'Dispensed quantity exceeds the prescribed remaining quantity' });
      }
      const serverUnitPrice = Number(prescribedItem.selected_unit_price);
      if (!Number.isFinite(serverUnitPrice) || serverUnitPrice < 0) {
        throw new HTTPException(409, { message: 'Mapped medicine has no valid hospital sale price' });
      }
      serverUnitPriceByItem.set(requestedItem.prescriptionItemId, serverUnitPrice);
    }

    const medicineIds = [...new Set(body.items.map((item) => item.medicineId))];
    const medicinePlaceholders = medicineIds.map(() => '?').join(', ');
    const { results: batches } = await c.env.DB.prepare(`
      SELECT id, medicine_id, quantity_available, purchase_price, sale_price
      FROM medicine_stock_batches
      WHERE tenant_id = ? AND medicine_id IN (${medicinePlaceholders})
        AND quantity_available > 0
        AND (expiry_date IS NULL OR expiry_date > date('now', '+6 hours'))
      ORDER BY medicine_id, expiry_date ASC, id ASC
    `).bind(tenantId, ...medicineIds).all<StockBatchRow>();

    const batchesByMedicine = new Map<number, StockBatchRow[]>();
    const remainingQuantityByBatch = new Map<number, number>();
    for (const batch of batches ?? []) {
      const medicineId = Number(batch.medicine_id);
      const medicineBatches = batchesByMedicine.get(medicineId) ?? [];
      medicineBatches.push(batch);
      batchesByMedicine.set(medicineId, medicineBatches);
      remainingQuantityByBatch.set(Number(batch.id), Number(batch.quantity_available));
    }

    const allocations: Array<{
      medicineId: number;
      batchId: number;
      quantity: number;
      purchasePrice: number;
      unitPrice: number;
    }> = [];
    let totalAmount = 0;
    let totalCogs = 0;
    for (const requestedItem of body.items) {
      let remaining = requestedItem.quantity;
      const unitPrice = serverUnitPriceByItem.get(requestedItem.prescriptionItemId)!;
      totalAmount += requestedItem.quantity * unitPrice;
      for (const batch of batchesByMedicine.get(requestedItem.medicineId) ?? []) {
        if (remaining <= 0) break;
        const batchId = Number(batch.id);
        const availableQuantity = remainingQuantityByBatch.get(batchId) ?? 0;
        if (availableQuantity <= 0) continue;
        const deduction = Math.min(remaining, availableQuantity);
        remaining -= deduction;
        remainingQuantityByBatch.set(batchId, availableQuantity - deduction);
        const purchasePrice = Number(batch.purchase_price ?? 0);
        allocations.push({
          medicineId: requestedItem.medicineId,
          batchId,
          quantity: deduction,
          purchasePrice,
          unitPrice,
        });
        totalCogs += deduction * purchasePrice;
      }
      if (remaining > 0) {
        throw new HTTPException(409, { message: `Insufficient available stock for medicine ${requestedItem.medicineId}` });
      }
    }

    const orderId = crypto.randomUUID();
    const saleDate = getTodayGMT6();
    const auditSummary = JSON.stringify({
      operation: 'hospital_dispense',
      orderId,
      itemCount: body.items.length,
      status: 'fulfilled',
      paymentMethod: body.paymentMethod,
    });
    const postingKey = `medication_order:${orderId}:${ACCOUNTING_EVENT_TYPES.pharmacySaleCogs}`;
    const statements: D1PreparedStatement[] = [
      c.env.DB.prepare(`
        INSERT INTO medication_orders (
          id, tenant_id, prescription_id, patient_id, channel, provider_type,
          provider_tenant_id, status, payment_status, delivery_status,
          idempotency_key, request_hash, created_by
        ) VALUES (?, ?, ?, ?, 'hospital_counter', 'hospital_pharmacy', ?, 'fulfilled', 'paid', 'not_applicable', ?, ?, ?)
      `).bind(orderId, tenantId, prescriptionId, prescription.patient_id, tenantId, body.idempotencyKey, requestHash, userId),
      c.env.DB.prepare(`
        INSERT INTO pharmacy_sales (
          tenant_id, patient_id, total_amount, discount, net_amount,
          payment_method, status, sold_by, remarks, medication_order_id
        ) VALUES (?, ?, ?, 0, ?, ?, 'completed', ?, 'Hospital prescription fulfilment', ?)
      `).bind(tenantId, prescription.patient_id, totalAmount, totalAmount, body.paymentMethod, userId, orderId),
      c.env.DB.prepare(`
        UPDATE medication_orders
        SET sale_id = (SELECT id FROM pharmacy_sales WHERE tenant_id = ? AND medication_order_id = ?),
            updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ?
      `).bind(tenantId, orderId, orderId, tenantId),
    ];

    for (const requestedItem of body.items) {
      const prescribedItem = itemRows.get(requestedItem.prescriptionItemId)!;
      const unitPrice = serverUnitPriceByItem.get(requestedItem.prescriptionItemId)!;
      statements.push(
        c.env.DB.prepare(`
          INSERT INTO medication_order_items (
            order_id, prescription_item_id, prescribed_name, prescribed_dosage,
            prescribed_frequency, prescribed_duration, selected_medicine_id,
            selected_name, selected_generic_name, selected_company, selected_unit,
            requested_quantity, fulfilled_quantity, unit_price, line_total,
            is_alternative, patient_confirmed_alternative
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
        `).bind(
          orderId,
          requestedItem.prescriptionItemId,
          prescribedItem.medicine_name,
          prescribedItem.dosage ?? null,
          prescribedItem.frequency ?? null,
          prescribedItem.duration ?? null,
          requestedItem.medicineId,
          prescribedItem.selected_name ?? prescribedItem.medicine_name,
          prescribedItem.selected_generic_name ?? null,
          prescribedItem.selected_company ?? null,
          prescribedItem.selected_unit ?? null,
          requestedItem.quantity,
          requestedItem.quantity,
          unitPrice,
          requestedItem.quantity * unitPrice,
        ),
        c.env.DB.prepare(`
          UPDATE prescription_items
          SET dispensed_qty = dispensed_qty + ?
          WHERE id = ? AND prescription_id = ?
        `).bind(requestedItem.quantity, requestedItem.prescriptionItemId, prescriptionId),
        c.env.DB.prepare(`
          INSERT INTO pharmacy_sale_items (
            sale_id, medicine_id, medicine_name, quantity, unit_price, line_total, tenant_id
          ) VALUES (
            (SELECT id FROM pharmacy_sales WHERE tenant_id = ? AND medication_order_id = ?),
            ?, ?, ?, ?, ?, ?
          )
        `).bind(
          tenantId,
          orderId,
          requestedItem.medicineId,
          prescribedItem.selected_name ?? prescribedItem.medicine_name,
          requestedItem.quantity,
          unitPrice,
          requestedItem.quantity * unitPrice,
          tenantId,
        ),
        c.env.DB.prepare(`
          UPDATE medicines
          SET quantity = quantity - ?
          WHERE id = ? AND tenant_id = ?
        `).bind(requestedItem.quantity, requestedItem.medicineId, tenantId),
      );
    }

    for (const allocation of allocations) {
      statements.push(
        c.env.DB.prepare(`
          UPDATE medicine_stock_batches
          SET quantity_available = quantity_available - ?
          WHERE id = ? AND tenant_id = ?
        `).bind(allocation.quantity, allocation.batchId, tenantId),
        c.env.DB.prepare(`
          INSERT INTO medicine_stock_movements (
            medicine_id, batch_id, movement_type, quantity, unit_cost, unit_price,
            reference_type, reference_id, movement_date, tenant_id, created_by
          ) VALUES (
            ?, ?, 'sale_out', ?, ?, ?, 'sale',
            (SELECT id FROM pharmacy_sales WHERE tenant_id = ? AND medication_order_id = ?),
            ?, ?, ?
          )
        `).bind(
          allocation.medicineId,
          allocation.batchId,
          allocation.quantity,
          allocation.purchasePrice,
          allocation.unitPrice,
          tenantId,
          orderId,
          saleDate,
          tenantId,
          userId,
        ),
      );
    }

    statements.push(
      c.env.DB.prepare(`
        INSERT OR IGNORE INTO accounting_posting_events (
          tenant_id, source_event_key, source_type, source_id, event_type,
          event_date, payload_json, created_by
        ) VALUES (?, ?, 'medication_order', ?, ?, ?, ?, ?)
      `).bind(
        tenantId,
        postingKey,
        orderId,
        ACCOUNTING_EVENT_TYPES.pharmacySaleCogs,
        saleDate,
        JSON.stringify({ cogsAmount: totalCogs }),
        userId,
      ),
      c.env.DB.prepare(`
        INSERT INTO audit_logs (
          tenant_id, user_id, action, table_name, record_id,
          old_value, new_value, created_at
        ) VALUES (
          ?, ?, 'CREATE', 'pharmacy_sales',
          (SELECT id FROM pharmacy_sales WHERE tenant_id = ? AND medication_order_id = ?),
          NULL, ?, datetime('now', '+6 hours')
        )
      `).bind(tenantId, userId, tenantId, orderId, auditSummary),
    );

    try {
      await c.env.DB.batch(statements);
    } catch (error) {
      const concurrentlyCompleted = await c.env.DB.prepare(`
        SELECT id, status, sale_id, request_hash
        FROM medication_orders
        WHERE tenant_id = ? AND idempotency_key = ?
        LIMIT 1
      `).bind(tenantId, body.idempotencyKey).first<{
        id: string;
        status: string;
        sale_id: number | null;
        request_hash: string;
      }>();
      if (concurrentlyCompleted && concurrentlyCompleted.request_hash === requestHash) {
        return c.json({
          id: concurrentlyCompleted.id,
          saleId: concurrentlyCompleted.sale_id,
          status: concurrentlyCompleted.status,
          idempotent: true,
        });
      }
      if (isDispenseConstraintFailure(error)) {
        throw new HTTPException(409, { message: 'Stock or prescribed remaining quantity changed; refresh and retry' });
      }
      throw error;
    }

    if (c.env.ENVIRONMENT !== 'test') {
      queuePharmacyPosting(c.env, c.executionCtx, tenantId);
    }

    const committed = await c.env.DB.prepare(`
      SELECT id, status, sale_id
      FROM medication_orders
      WHERE id = ? AND tenant_id = ?
    `).bind(orderId, tenantId).first<{ id: string; status: string; sale_id: number | null }>();

    return c.json({
      id: committed?.id ?? orderId,
      saleId: committed?.sale_id ?? null,
      status: committed?.status ?? 'fulfilled',
      idempotent: false,
    }, 201);
  },
);

export default prescriptionFulfilmentRoutes;
