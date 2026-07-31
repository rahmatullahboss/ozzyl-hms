import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { eq, and, desc } from 'drizzle-orm';
import { getNextSequence } from '../../lib/sequence';
import type { Env, Variables } from '../../types';
import { requireTenantId, requireUserId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import { pharmacyReturns, pharmacyReturnItems } from '../../db/schema';
import { requireRole } from '../../middleware/rbac';

const PHARM_READ  = ['hospital_admin', 'pharmacist', 'doctor', 'md', 'nurse'] as const;
const PHARM_WRITE = ['hospital_admin', 'pharmacist'] as const;

const createReturnSchema = z.object({
  saleInvoiceId: z.number().int().positive(),
  patientId: z.number().int().positive().optional(),
  items: z.array(z.object({
    saleItemId: z.number().int().positive(),
    medicineId: z.number().int().positive(),
    stockId: z.number().int().positive(),
    returnedQty: z.number().int().positive(),
    unitPrice: z.number().positive(),
    batchNo: z.string().optional(),
    expiryDate: z.string().optional(),
    reason: z.string().optional(),
  })).min(1),
  paymentMethod: z.string().optional(),
  remarks: z.string().optional(),
});

const returnRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─── POST /api/pharmacy/returns ───────────────────────────────────────────────
returnRoutes.post('/', requireRole(...PHARM_WRITE), zValidator('json', createReturnSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const userId = String(requireUserId(c));
  const data = c.req.valid('json');

  try {
    // 1. Validate the sale invoice exists
    const sale = await db.$client.prepare(
      'SELECT id, patient_id FROM pharmacy_sales WHERE id = ? AND tenant_id = ?'
    ).bind(data.saleInvoiceId, tenantId).first<{ id: number; patient_id: number | null }>();

    if (!sale) {
      throw new HTTPException(404, { message: 'Sale invoice not found' });
    }

    // 2. Validate each item's returnedQty doesn't exceed original qty minus previous returns
    for (const item of data.items) {
      const saleItem = await db.$client.prepare(
        'SELECT quantity FROM pharmacy_sale_items WHERE id = ? AND sale_id = ? AND tenant_id = ?'
      ).bind(item.saleItemId, data.saleInvoiceId, tenantId).first<{ quantity: number }>();

      if (!saleItem) {
        throw new HTTPException(404, { message: `Sale item ${item.saleItemId} not found` });
      }

      const previousReturns = await db.$client.prepare(`
        SELECT COALESCE(SUM(pri.returned_qty), 0) as total_returned
        FROM pharmacy_return_items pri
        JOIN pharmacy_returns pr ON pri.return_id = pr.id
        WHERE pr.sale_invoice_id = ? AND pri.sale_item_id = ? AND pr.tenant_id = ?
      `).bind(data.saleInvoiceId, item.saleItemId, tenantId).first<{ total_returned: number }>();

      const alreadyReturned = previousReturns?.total_returned ?? 0;
      const maxReturnable = saleItem.quantity - alreadyReturned;

      if (item.returnedQty > maxReturnable) {
        throw new HTTPException(400, {
          message: `Returned qty (${item.returnedQty}) exceeds max returnable (${maxReturnable}) for item ${item.saleItemId}`,
        });
      }
    }

    // 3. Calculate totalReturnAmount
    const totalReturnAmount = data.items.reduce((sum, item) => sum + item.returnedQty * item.unitPrice, 0);

    // 4. Generate return number
    const returnNo = await getNextSequence(c.env.DB, tenantId, 'pharmacy_return', 'RET');

    // 5. Insert into pharmacy_returns and pharmacy_return_items
    const [returnRecord] = await db.insert(pharmacyReturns)
      .values({
        tenantId,
        returnNo,
        saleInvoiceId: data.saleInvoiceId,
        patientId: data.patientId ?? sale.patient_id ?? null,
        totalReturnAmount,
        paymentMethod: data.paymentMethod ?? 'cash',
        remarks: data.remarks ?? null,
        createdBy: Number(userId),
      })
      .returning({ id: pharmacyReturns.id });

    const returnId = returnRecord.id;

    const batchStmts: D1PreparedStatement[] = [];

    for (const item of data.items) {
      const lineTotal = item.returnedQty * item.unitPrice;

      batchStmts.push(
        db.$client.prepare(`
          INSERT INTO pharmacy_return_items
            (return_id, sale_item_id, medicine_id, returned_qty, unit_price, line_total, batch_no, expiry_date, reason)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          returnId,
          item.saleItemId,
          item.medicineId,
          item.returnedQty,
          item.unitPrice,
          lineTotal,
          item.batchNo ?? null,
          item.expiryDate ?? null,
          item.reason ?? null,
        ),
      );

      // 6. Update pharmacy_stock to add back the returned quantity using stock_id
      const stockUpdate = await db.$client.prepare(`
        UPDATE pharmacy_stock
        SET available_qty = available_qty + ?,
            updated_at = datetime('now', '+6 hours')
        WHERE id = ? AND tenant_id = ?
      `).bind(
        item.returnedQty,
        item.stockId,
        tenantId,
      ).run();

      // Record stock transaction audit trail
      batchStmts.push(
        db.$client.prepare(`
          INSERT INTO pharmacy_stock_transactions
            (item_id, stock_id, transaction_type, reference_type, reference_id, batch_no, in_qty, price, remarks, tenant_id, created_by)
          VALUES (?, ?, 'return_in', 'pharmacy_return', ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          item.medicineId,
          item.stockId,
          returnId,
          item.batchNo ?? null,
          item.returnedQty,
          item.unitPrice,
          `Pharmacy return ${returnNo}`,
          tenantId,
          Number(userId),
        ),
      );

      if (stockUpdate.meta.changes === 0) {
        // Fallback: legacy medicine_stock_batches
        batchStmts.push(
          db.$client.prepare(`
            UPDATE medicine_stock_batches
            SET quantity_available = quantity_available + ?
            WHERE medicine_id = ? AND tenant_id = ?
              AND (? IS NULL OR batch_no = ?)
          `).bind(
            item.returnedQty,
            item.medicineId,
            tenantId,
            item.batchNo ?? null,
            item.batchNo ?? null,
          ),
        );

        // Also restore medicines.quantity
        batchStmts.push(
          db.$client.prepare(
            'UPDATE medicines SET quantity = quantity + ? WHERE id = ? AND tenant_id = ?'
          ).bind(item.returnedQty, item.medicineId, tenantId),
        );
      }
    }

    if (batchStmts.length > 0) {
      await db.$client.batch(batchStmts);
    }

    // 7. Record SalesReturn in emp_cash_transactions if cash refund
    if ((data.paymentMethod ?? 'cash') === 'cash') {
      await db.$client.prepare(`
        INSERT INTO emp_cash_transactions
          (tenant_id, employee_id, transaction_type, amount, reference_id, reference_type, payment_method, description, transaction_date)
        VALUES (?, ?, 'SalesReturn', ?, ?, 'pharmacy_return', 'cash', ?, datetime('now', '+6 hours'))
      `).bind(
        tenantId,
        Number(userId),
        totalReturnAmount,
        returnId,
        `Pharmacy return ${returnNo}`,
      ).run();
    }

    return c.json({ message: 'Return recorded', returnId, returnNo }, 201);
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('pharmacy return error:', error);
    throw new HTTPException(500, { message: 'Failed to record return' });
  }
});

// ─── GET /api/pharmacy/returns ────────────────────────────────────────────────
returnRoutes.get('/', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const { saleInvoiceId, page = '1', limit = '50' } = c.req.query();
  const offset = (Math.max(1, Number(page)) - 1) * Math.max(1, Number(limit));

  try {
    let where = 'WHERE pr.tenant_id = ?';
    const params: (string | number)[] = [tenantId];

    if (saleInvoiceId) {
      where += ' AND pr.sale_invoice_id = ?';
      params.push(Number(saleInvoiceId));
    }

    const { results } = await db.$client.prepare(`
      SELECT pr.*, ps.invoice_no as sale_invoice_no, p.name as patient_name
      FROM pharmacy_returns pr
      LEFT JOIN pharmacy_sales ps ON pr.sale_invoice_id = ps.id
      LEFT JOIN patients p ON pr.patient_id = p.id
      ${where}
      ORDER BY pr.created_at DESC
      LIMIT ? OFFSET ?
    `).bind(...params, Number(limit), offset).all();

    return c.json({ returns: results ?? [] });
  } catch {
    throw new HTTPException(500, { message: 'Failed to fetch returns' });
  }
});

// ─── GET /api/pharmacy/returns/:id ────────────────────────────────────────────
returnRoutes.get('/:id', requireRole(...PHARM_READ), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = String(requireTenantId(c));
  const id = c.req.param('id');

  try {
    const returnRecord = await db.$client.prepare(`
      SELECT pr.*, ps.invoice_no as sale_invoice_no, p.name as patient_name
      FROM pharmacy_returns pr
      LEFT JOIN pharmacy_sales ps ON pr.sale_invoice_id = ps.id
      LEFT JOIN patients p ON pr.patient_id = p.id
      WHERE pr.id = ? AND pr.tenant_id = ?
    `).bind(id, tenantId).first();

    if (!returnRecord) {
      throw new HTTPException(404, { message: 'Return not found' });
    }

    const { results: items } = await db.$client.prepare(`
      SELECT pri.*, psi.medicine_name as original_medicine_name
      FROM pharmacy_return_items pri
      LEFT JOIN pharmacy_sale_items psi ON pri.sale_item_id = psi.id
      WHERE pri.return_id = ?
    `).bind(id).all();

    return c.json({ return: returnRecord, items: items ?? [] });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to fetch return' });
  }
});

export default returnRoutes;
