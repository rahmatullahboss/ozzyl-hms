/*
 * Phase 7 (fix/pharmacy-inventory) — Canonical pharmacy stock/invoice service.
 *
 * This module is the SINGLE POINT OF TRUTH for pharmacy stock deductions,
 * GRN-driven stock increments, and invoice finalization. It is invoked by:
 *   • The canonical write endpoints (POST /pharmacy/invoices, /pharmacy/goods-receipts)
 *   • The legacy /pharmacy/sales and /pharmacy/billing endpoints (P0-22 redirect)
 *   • The repair endpoint /pharmacy/invoices/:id/repair (P0-23)
 *
 * The legacy model (medicines / medicine_stock_batches / pharmacy_sales) is
 * FROZEN: it is still readable for backward compatibility, but all new
 * write traffic must go through the canonical service below.
 */
import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { HTTPException } from 'hono/http-exception';

import { recordAccountingPostingEvent } from './accounting-posting';
import { ACCOUNTING_EVENT_TYPES } from './accounting-posting';
import { getDb } from '../db';
import { selectFefoStockAllocations } from './inventory-core';

/* ─── Errors ─────────────────────────────────────────────────────────── */

export class CanonicalRefusalError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 422) {
    super(message);
    this.statusCode = statusCode;
  }
}

/* ─── Helpers ────────────────────────────────────────────────────────── */

function getRowsWritten(result: { meta?: { rows_written?: number; changes?: number } }): number {
  return Number(result.meta?.rows_written ?? result.meta?.changes ?? 0);
}

function logDeprecation(
  env: { DB: D1Database },
  ctx: { tenantId: string; userId: string; route: string; mutationType: string; payload?: unknown },
): void {
  try {
    const envAny = env as unknown as { PHARMACY_DEPRECATION_LOG?: { put: (k: string, v: string) => Promise<unknown> } };
    const kv = envAny.PHARMACY_DEPRECATION_LOG;
    if (kv) {
      void kv.put(
        `deprecation:${ctx.tenantId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        JSON.stringify(ctx),
      );
    }
  } catch {
    /* swallow — logging must never break business logic */
  }
  console.warn(
    `[pharmacy:DEPRECATED] route=${ctx.route} tenant=${ctx.tenantId} user=${ctx.userId} mutation=${ctx.mutationType}`,
  );
}

function legacyLineTotal(items: Array<{ quantity: number; unitPrice: number }>, discount = 0): number {
  return Math.max(0, items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) - discount);
}

/* ─── Public API ─────────────────────────────────────────────────────── */

export type CanonicalInvoiceLineInput = {
  itemId: number;
  stockId?: number | null;
  batchNo?: string | null;
  expiryDate?: string | null;
  quantity: number;
  price: number; // paisa
  mrp?: number;  // paisa
  discountPct?: number;
  vatPct?: number;
  remarks?: string | null;
};

export type CanonicalInvoiceInput = {
  tenantId: string;
  userId: string;
  patientId?: number | null;
  patientVisitId?: number | null;
  counterId?: number | null;
  counterSessionId?: number | null;
  prescriberId?: number | null;
  isOutdoorPatient?: boolean;
  visitType?: 'opd' | 'ipd' | 'emergency' | null;
  discountAmount?: number;
  discountPct?: number;
  vatAmount?: number;
  paidAmount?: number;
  creditAmount?: number;
  tender?: number;
  paymentMode?: 'cash' | 'card' | 'credit' | 'mobile' | 'deposit';
  depositDeductAmount?: number;
  remarks?: string | null;
  idempotencyKey?: string;
  items: CanonicalInvoiceLineInput[];
  allowFefoAutopick?: boolean;
};

export type CanonicalInvoiceResult = {
  invoiceId: number;
  invoiceNo: string;
  totalAmount: number;
  status: 'paid' | 'credit' | 'pending_repair';
  pendingRepairReason?: string;
  replayed?: boolean;
};

async function withInvoiceIdempotency<T extends CanonicalInvoiceResult>(
  env: { DB: D1Database },
  input: { tenantId: string; userId: string; idempotencyKey?: string },
  work: () => Promise<T>,
): Promise<T> {
  if (!input.idempotencyKey) return work();

  const { reserveMutationIdempotencyKey, completeMutationIdempotencyKey, markMutationIdempotencyKeyFailed, createIdempotencyRequestHash } = await import('./request-idempotency');
  const requestHash = await createIdempotencyRequestHash({
    tenantId: input.tenantId,
    userId: input.userId,
    idempotencyKey: input.idempotencyKey,
  });

  const replay = await reserveMutationIdempotencyKey(env.DB, {
    tenantId: input.tenantId,
    mutationType: 'pharmacy_invoice',
    idempotencyKey: input.idempotencyKey,
    requestHash,
    createdBy: input.userId,
    mismatchMessage: 'Idempotency key reuse with different payload for pharmacy invoice',
    conflictMessage: 'Pharmacy invoice with this idempotency key is already being processed',
  });

  if (replay) {
    return { ...(replay.responseBody as unknown as T), replayed: true };
  }

  try {
    const result = await work();
    await completeMutationIdempotencyKey(env.DB, {
      tenantId: input.tenantId,
      mutationType: 'pharmacy_invoice',
      idempotencyKey: input.idempotencyKey,
      sourceId: String(result.invoiceId),
      responseBody: { ...result, replayed: false },
    });
    return result;
  } catch (err) {
    await markMutationIdempotencyKeyFailed(env.DB, {
      tenantId: input.tenantId,
      mutationType: 'pharmacy_invoice',
      idempotencyKey: input.idempotencyKey,
    }).catch(() => undefined);
    throw err;
  }
}

export async function createCanonicalPharmacyInvoice(
  env: { DB: D1Database },
  input: CanonicalInvoiceInput,
): Promise<CanonicalInvoiceResult> {
  return withInvoiceIdempotency(env, input, async () => {
    const db = getDb(env.DB);
    const tenantId = input.tenantId;
    const userId = input.userId;
    if (!input.items || input.items.length === 0) {
      throw new CanonicalRefusalError('Invoice must contain at least one item');
    }
    if (input.paymentMode === 'cash' && (input.paidAmount ?? 0) > 0 && (input.tender ?? 0) < (input.paidAmount ?? 0)) {
      throw new CanonicalRefusalError('Cash tender cannot be less than paid cash amount');
    }

    const resolved: Array<{
      itemId: number; stockId: number; batchNo: string; expiryDate: string | null;
      quantity: number; price: number; mrp: number; discountPct: number; vatPct: number; costPrice: number;
      lineSubtotal: number; discountAmt: number; vatAmt: number; total: number;
    }> = [];
    let totalCogs = 0;
    for (const line of input.items) {
      let stockRow: { id: number; available_qty: number; cost_price: number | null; mrp: number; sale_price: number | null; batch_no: string; expiry_date: string | null; status?: string | null; is_active?: number | boolean | null } | null = null;
      if (line.stockId) {
        stockRow = await db.$client.prepare(
          `SELECT id, available_qty, cost_price, mrp, sale_price, batch_no, expiry_date, status, is_active
           FROM pharmacy_stock WHERE id = ? AND tenant_id = ? AND is_active = 1`
        ).bind(line.stockId, tenantId).first<typeof stockRow>();
        if (!stockRow) throw new CanonicalRefusalError(`Stock record ${line.stockId} not found`);
      } else if (input.allowFefoAutopick) {
        const allResult: { id: number; available_qty: number; cost_price: number | null; mrp: number; sale_price: number | null; batch_no: string; expiry_date: string | null; status?: string | null; is_active?: number | boolean | null }[] =
          ((await db.$client.prepare(
            `SELECT id, available_qty, cost_price, mrp, sale_price, batch_no, expiry_date, status, is_active
             FROM pharmacy_stock
             WHERE item_id = ? AND tenant_id = ? AND is_active = 1
               AND (expiry_date IS NULL OR expiry_date > date('now', '+6 hours'))
             ORDER BY expiry_date ASC, id ASC`
          ).bind(line.itemId, tenantId).all()) as any).results;
        const results = allResult;
        if (!results.length) {
          throw new CanonicalRefusalError(`No active stock available for item ${line.itemId}`);
        }
        try {
          const allocations = selectFefoStockAllocations(
            results.map((r) => ({
              stockId: r.id, availableQuantity: r.available_qty, expiryDate: r.expiry_date,
              status: r.status ?? null, isActive: r.is_active ?? null,
            })),
            line.quantity,
          );
          if (allocations.length > 1) {
            throw new CanonicalRefusalError(
              `Item ${line.itemId} requires splitting across ${allocations.length} batches; pass stockId explicitly`,
            );
          }
          stockRow = results.find((r) => r.id === allocations[0]!.stockId) ?? null;
        } catch (err) {
          if (err instanceof CanonicalRefusalError) throw err;
          if (err instanceof Error && err.message.startsWith('Insufficient')) {
            throw new CanonicalRefusalError(err.message, 409);
          }
          throw err;
        }
      } else {
        throw new CanonicalRefusalError(`stockId is required for item ${line.itemId}`);
      }
      if (!stockRow) throw new CanonicalRefusalError(`No stock resolved for item ${line.itemId}`);
      if ((stockRow.available_qty ?? 0) < line.quantity) {
        throw new CanonicalRefusalError(
          `Insufficient stock for stock ${stockRow.id}. Available: ${stockRow.available_qty}, Requested: ${line.quantity}`,
          409,
        );
      }
      const lineSubtotal = line.quantity * line.price;
      const discountAmt = Math.round(lineSubtotal * ((line.discountPct ?? 0) / 100));
      const vatAmt = Math.round((lineSubtotal - discountAmt) * ((line.vatPct ?? 0) / 100));
      const total = lineSubtotal - discountAmt + vatAmt;
      totalCogs += line.quantity * Number(stockRow.cost_price ?? 0);
      resolved.push({
        itemId: line.itemId,
        stockId: stockRow.id,
        batchNo: line.batchNo ?? stockRow.batch_no,
        expiryDate: line.expiryDate ?? stockRow.expiry_date ?? null,
        quantity: line.quantity,
        price: line.price,
        mrp: line.mrp ?? stockRow.mrp,
        discountPct: line.discountPct ?? 0,
        vatPct: line.vatPct ?? 0,
        costPrice: Number(stockRow.cost_price ?? 0),
        lineSubtotal, discountAmt, vatAmt, total,
      });
    }

    const subtotal = resolved.reduce((s, r) => s + r.total, 0);
    const totalAmount = subtotal - (input.discountAmount ?? 0) + (input.vatAmount ?? 0);
    const paid = input.paidAmount ?? 0;
    const credit = input.creditAmount ?? 0;
    const deposit = input.depositDeductAmount ?? 0;
    if (paid + credit + deposit !== totalAmount) {
      throw new CanonicalRefusalError('Payment split (paid + credit + deposit) must equal total amount');
    }
    const invoiceStatus: 'paid' | 'credit' = credit > 0 ? 'credit' : 'paid';
    const invoiceDate = new Date().toISOString().slice(0, 10);

    const { getNextInvoiceNumber } = await import('./invoice-sequence');
    const invoiceNo = await getNextInvoiceNumber(env.DB, tenantId, 'pharmacy');
    const deducted: Array<{ stockId: number; quantity: number }> = [];
    try {
      for (const r of resolved) {
        const stockResult = await db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty - ?, updated_at = datetime('now', '+6 hours')
           WHERE id = ? AND tenant_id = ? AND available_qty >= ?`
        ).bind(r.quantity, r.stockId, tenantId, r.quantity).run();
        if (getRowsWritten(stockResult) === 0) {
          throw new HTTPException(409, { message: `Stock depleted for item ${r.itemId} (concurrent sale)` });
        }
        deducted.push({ stockId: r.stockId, quantity: r.quantity });
      }
    } catch (err) {
      for (const s of deducted) {
        await db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at = datetime('now', '+6 hours')
           WHERE id = ? AND tenant_id = ?`
        ).bind(s.quantity, s.stockId, tenantId).run().catch((rollbackErr) => {
          console.error('[pharmacy] Rollback stock failed:', rollbackErr);
        });
      }
      throw err;
    }

    let invoiceId: number | null = null;
    let pendingRepairReason: string | undefined;
    try {
      const invResult = await db.$client.prepare(`
        INSERT INTO pharmacy_invoices
          (invoice_no, patient_id, patient_visit_id, counter_id, counter_session_id,
           is_outdoor_patient, visit_type, prescriber_id, subtotal, discount_amount,
           discount_pct, vat_amount, total_amount, paid_amount, credit_amount, tender,
           change_amount, payment_mode, deposit_deduct_amount, status, paid_date,
           remarks, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        invoiceNo, input.patientId ?? null, input.patientVisitId ?? null,
        input.counterId ?? null, input.counterSessionId ?? null,
        input.isOutdoorPatient ? 1 : 0, input.visitType ?? null, input.prescriberId ?? null,
        subtotal, input.discountAmount ?? 0, input.discountPct ?? 0, input.vatAmount ?? 0,
        totalAmount, paid, credit, input.tender ?? 0,
        Math.max(0, (input.tender ?? 0) - paid), input.paymentMode ?? 'cash',
        deposit, invoiceStatus, paid > 0 || deposit > 0 ? invoiceDate : null,
        input.remarks ?? null, tenantId, userId,
      ).run();
      invoiceId = Number(invResult.meta.last_row_id);

      const batchStmts: D1PreparedStatement[] = resolved.map((r) => db.$client.prepare(`
        INSERT INTO pharmacy_invoice_items
          (invoice_id, item_id, stock_id, batch_no, expiry_date, quantity, mrp, price,
           subtotal, discount_pct, discount_amount, vat_pct, vat_amount, total_amount, tenant_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        invoiceId, r.itemId, r.stockId, r.batchNo, r.expiryDate, r.quantity, r.mrp, r.price,
        r.lineSubtotal, r.discountPct, r.discountAmt, r.vatPct, r.vatAmt, r.total, tenantId, userId,
      ));

      for (const r of resolved) {
        batchStmts.push(db.$client.prepare(`
          INSERT INTO pharmacy_stock_transactions
            (item_id, stock_id, transaction_type, reference_type, reference_id, batch_no, out_qty, price, tenant_id, created_by)
          VALUES (?, ?, 'sale_out', 'invoice', ?, ?, ?, ?, ?, ?)
        `).bind(r.itemId, r.stockId, invoiceId, r.batchNo, r.quantity, r.price, tenantId, userId));
      }

      await db.$client.batch(batchStmts);
    } catch (err) {
      pendingRepairReason = err instanceof Error ? err.message : 'invoice commit failed';
      console.error('[pharmacy] Invoice commit failed mid-flight, marking pending_repair:', pendingRepairReason);
      for (const s of deducted) {
        await db.$client.prepare(
          `UPDATE pharmacy_stock SET available_qty = available_qty + ?, updated_at = datetime('now', '+6 hours')
           WHERE id = ? AND tenant_id = ?`
        ).bind(s.quantity, s.stockId, tenantId).run().catch((rollbackErr) => {
          console.error('[pharmacy] pending_repair rollback stock failed:', rollbackErr);
        });
      }
      try {
        await db.$client.prepare(`
          INSERT INTO pharmacy_invoice_repair_queue
            (tenant_id, invoice_no, payload_json, reason, created_by)
          VALUES (?, ?, ?, ?, ?)
        `).bind(tenantId, invoiceNo, JSON.stringify({ ...input, idempotencyKey: undefined }), pendingRepairReason, userId).run();
      } catch (queueErr) {
        console.error('[pharmacy] CRITICAL: failed to enqueue pending_repair row', queueErr);
      }
      return {
        invoiceId: 0,
        invoiceNo,
        totalAmount,
        status: 'pending_repair',
        pendingRepairReason,
      };
    }

    try {
      await recordAccountingPostingEvent(env.DB, {
        tenantId,
        sourceType: 'pharmacy_invoice',
        sourceId: String(invoiceId),
        eventType: ACCOUNTING_EVENT_TYPES.billCreated,
        eventDate: invoiceDate,
        payload: {
          billId: invoiceId,
          invoiceNo,
          patientId: input.patientId ?? null,
          visitId: input.patientVisitId ?? null,
          total: totalAmount,
          discount: input.discountAmount ?? 0,
          medicineBill: totalAmount + (input.discountAmount ?? 0),
          testBill: 0,
          doctorVisitBill: 0,
          admissionBill: 0,
          operationBill: 0,
        },
        createdBy: userId,
      });
      if (totalCogs > 0) {
        await recordAccountingPostingEvent(env.DB, {
          tenantId,
          sourceType: 'pharmacy_invoice_cogs',
          sourceId: String(invoiceId),
          eventType: ACCOUNTING_EVENT_TYPES.pharmacySaleCogs,
          eventDate: invoiceDate,
          payload: { cogsAmount: totalCogs, invoiceNo, patientId: input.patientId ?? null },
          createdBy: userId,
        });
      }
    } catch (err) {
      console.error('[pharmacy] Non-fatal: accounting event enqueue failed', err);
    }

    return {
      invoiceId: invoiceId!,
      invoiceNo,
      totalAmount,
      status: invoiceStatus,
    };
  });
}

/* ─── Public: deprecation warning ─────────────────────────────────────── */

export function emitDeprecationWarning(
  env: { DB: D1Database },
  ctx: { tenantId: string; userId: string; route: string; mutationType: string; payload?: unknown },
): void {
  logDeprecation(env, ctx);
}

/* ─── Public: legacy → canonical mapping ──────────────────────────────── */

export type LegacySaleLineInput = {
  medicineId: number;
  quantity: number;
  unitPrice: number;
};

export type LegacySaleInput = {
  tenantId: string;
  userId: string;
  patientId?: number | null;
  discount?: number;
  paymentMode?: 'cash' | 'card' | 'credit' | 'mobile' | 'deposit';
  paidAmount?: number;
  creditAmount?: number;
  items: LegacySaleLineInput[];
  remarks?: string | null;
};

export type LegacyBillInput = {
  tenantId: string;
  userId: string;
  patientId?: number | null;
  discount?: number;
  paymentMethod?: 'cash' | 'bkash' | 'bank' | 'other';
  items: Array<{ medicineId: number; name?: string; quantity: number; unitPrice: number }>;
};

export async function forwardLegacySaleToCanonical(
  env: { DB: D1Database },
  input: LegacySaleInput,
): Promise<CanonicalInvoiceResult> {
  const db = getDb(env.DB);
  const lines: CanonicalInvoiceLineInput[] = [];
  for (const it of input.items) {
    const { results } = await db.$client.prepare(
      `SELECT id FROM pharmacy_items WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`
    ).bind(it.medicineId, input.tenantId).all<{ id: number }>();
    if (!results.length) {
      throw new CanonicalRefusalError(
        `Legacy /sales payload references medicine ${it.medicineId} which is not in the canonical pharmacy_items catalog`,
      );
    }
    lines.push({
      itemId: it.medicineId,
      quantity: it.quantity,
      price: it.unitPrice,
    });
  }

  const total = legacyLineTotal(input.items, input.discount ?? 0);
  const isCredit = input.paymentMode === 'credit';
  const paidAmount = input.paidAmount ?? (isCredit ? 0 : total);
  const creditAmount = input.creditAmount ?? (isCredit ? total : 0);
  const tender = input.paymentMode === 'cash' || !input.paymentMode ? paidAmount : 0;

  return createCanonicalPharmacyInvoice(env, {
    tenantId: input.tenantId,
    userId: input.userId,
    patientId: input.patientId ?? null,
    discountAmount: input.discount ?? 0,
    paidAmount,
    creditAmount,
    tender,
    paymentMode: input.paymentMode ?? 'cash',
    remarks: input.remarks ?? 'Forwarded from legacy /pharmacy/sales',
    allowFefoAutopick: true,
    items: lines,
  });
}

export async function forwardLegacyBillToCanonical(
  env: { DB: D1Database },
  input: LegacyBillInput,
): Promise<CanonicalInvoiceResult> {
  const db = getDb(env.DB);
  const lines: CanonicalInvoiceLineInput[] = [];
  for (const it of input.items) {
    const { results } = await db.$client.prepare(
      `SELECT id FROM pharmacy_items WHERE id = ? AND tenant_id = ? AND is_active = 1 LIMIT 1`
    ).bind(it.medicineId, input.tenantId).all<{ id: number }>();
    if (!results.length) {
      throw new CanonicalRefusalError(
        `Legacy /billing payload references medicine ${it.medicineId} which is not in the canonical pharmacy_items catalog`,
      );
    }
    lines.push({
      itemId: it.medicineId,
      quantity: it.quantity,
      price: it.unitPrice,
    });
  }

  const total = legacyLineTotal(input.items, input.discount ?? 0);
  const paymentMode = input.paymentMethod === 'bkash' ? 'mobile' : 'cash';

  return createCanonicalPharmacyInvoice(env, {
    tenantId: input.tenantId,
    userId: input.userId,
    patientId: input.patientId ?? null,
    discountAmount: input.discount ?? 0,
    paymentMode,
    paidAmount: total,
    creditAmount: 0,
    tender: paymentMode === 'cash' ? total : 0,
    remarks: 'Forwarded from legacy /pharmacy/billing',
    allowFefoAutopick: true,
    items: lines,
  });
}
