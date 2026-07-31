import { Hono, type Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import { HTTPException } from "hono/http-exception";
import { updateLabItemResultSchema, updateSampleStatusSchema, cancelLabItemSchema, rejectSampleSchema, recollectSampleSchema, verifyLabItemSchema } from "../../schemas/lab";
import type { Env, Variables } from "../../types";
import { requireTenantId, requireUserId } from "../../lib/context-helpers";
import { requireRole } from "../../middleware/rbac";
import { getDb } from "../../db";
import { createAuditLog } from "../../lib/accounting-helpers";
import { assertAccountingPeriodOpen } from "../../lib/accounting-hardening";
import {
  ACCOUNTING_EVENT_TYPES,
  postPendingAccountingEvents,
  recordAccountingPostingEvent,
} from "../../lib/accounting-posting";
import { getTodayGMT6 } from "../../lib/date-utils";
import {
  getDiagnosticBillingClearance,
  getDiagnosticBillingColumns,
  getDiagnosticBillingJoin,
} from "../../lib/diagnostic-billing";
import { determineAbnormalFlag as determineAbnormalFromRange, calculateDelta } from "../../lib/lab-formula-evaluator";
import { consumeMappedLabConsumables } from "../../lib/lab-consumables";
import { getLabInventoryPolicy, shouldBlockLabInventoryException, shouldConsumeLabReagentsForEvent } from "../../lib/lab-inventory-policy";
import { cancelLabOrderItem } from "../../lib/lab-cancellation";
import { accrueLabVerificationCommissions } from "../../lib/lab-finance";
import { recordLabWorkflowEvent } from "../../lib/lab-workflow";
import { validateLabResult } from "./labValidation";

interface LabOrderItemVerificationRow {
  patient_id: number;
  visit_id: number | null;
  bill_id: number | null;
  lab_order_id: number;
  lab_test_id: number;
  category: string | null;
  line_total: number | null;
  status?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  normal_range?: string | null;
  critical_low?: number | null;
  critical_high?: number | null;
  [key: string]: unknown;
}

function queueLabAccountingPosting(c: Context<{ Bindings: Env; Variables: Variables }>, tenantId: string): void {
  const posting = postPendingAccountingEvents(c.env.DB, tenantId, 20).catch((error) => {
    console.error("Failed to post lab billing accounting events:", error);
  });
  try {
    c.executionCtx.waitUntil(posting);
  } catch {
    void posting;
  }
}

function assertDiagnosticBillCleared(row: Record<string, unknown>, workflow: string): void {
  const clearance = getDiagnosticBillingClearance(row);
  if (!clearance.cleared) {
    throw new HTTPException(409, {
      message: `Diagnostic bill payment required before ${workflow}. Bill #${clearance.billId ?? "unknown"} is ${clearance.paymentStatus}; outstanding ${clearance.outstanding}.`,
    });
  }
}

function detectAbnormalFlag(
  numericValue: number | undefined,
  normalRange: string | null | undefined,
  criticalLow?: number | null,
  criticalHigh?: number | null,
): "normal" | "high" | "low" | "critical" | "pending" {
  if (numericValue === undefined || numericValue === null || !normalRange) {
    return "pending";
  }

  const rangeStr = normalRange.includes("|")
    ? normalRange.split("|")[0].replace(/^[MF]:/, "")
    : normalRange;

  const match = rangeStr.match(/^([\d.]+)-([\d.]+)$/);
  if (!match) return "pending";

  const low = parseFloat(match[1]);
  const high = parseFloat(match[2]);

  if (Number.isNaN(low) || Number.isNaN(high)) return "pending";

  const cLow = criticalLow != null && !Number.isNaN(criticalLow) ? criticalLow : low - (high - low);
  const cHigh = criticalHigh != null && !Number.isNaN(criticalHigh) ? criticalHigh : high + (high - low);

  if (numericValue < cLow || numericValue > cHigh) return "critical";
  if (numericValue < low) return "low";
  if (numericValue > high) return "high";
  return "normal";
}

async function getStructuredReferenceRange(
  db: ReturnType<typeof getDb>,
  tenantId: number | string,
  testId: number,
  componentId: number | null | undefined,
  patientGender: string,
  patientAgeMonths: number,
): Promise<{ range_low: number | null; range_high: number | null; critical_low: number | null; critical_high: number | null } | null> {
  const genderFilter = patientGender.toLowerCase().startsWith("m") ? "male" : "female";

  const row = await db.$client.prepare(`
    SELECT range_low, range_high, critical_low, critical_high
    FROM lab_reference_ranges
    WHERE tenant_id = ? AND lab_test_id = ? AND is_active = 1
      AND (component_id = ? OR (component_id IS NULL AND ? IS NULL))
      AND (gender = ? OR gender = 'both')
      AND age_min_months <= ?
      AND (age_max_months IS NULL OR age_max_months >= ?)
    ORDER BY
      CASE WHEN gender = ? THEN 0 ELSE 1 END,
      age_max_months ASC NULLS LAST
    LIMIT 1
  `).bind(tenantId, testId, componentId ?? null, componentId ?? null, genderFilter, patientAgeMonths, patientAgeMonths, genderFilter).first<{
    range_low: number | null;
    range_high: number | null;
    critical_low: number | null;
    critical_high: number | null;
  }>();

  return row ?? null;
}

async function getPreviousResult(
  db: ReturnType<typeof getDb>,
  tenantId: number,
  patientId: number,
  testId: number,
  componentId: number | null | undefined,
): Promise<{ result_numeric: number | null; result_value: string | null } | null> {
  const query = `
    SELECT lr.result_numeric, lr.result_value
    FROM lab_results lr
    JOIN lab_reports lrp ON lr.lab_report_id = lrp.id
    JOIN lab_orders lo ON lrp.lab_order_id = lo.id
    WHERE lo.patient_id = ? AND lr.lab_test_id = ? AND lo.tenant_id = ?
      ${componentId ? "AND lr.component_id = ?" : "AND lr.component_id IS NULL"}
      AND lr.result_numeric IS NOT NULL
      AND COALESCE(lr.result_status, '') <> 'retracted'
    ORDER BY lr.created_at DESC
    LIMIT 1
  `;

  const params: (number | string)[] = [patientId, testId, tenantId];
  if (componentId) params.push(componentId);

  return db.$client.prepare(query).bind(...params).first<{ result_numeric: number | null; result_value: string | null }>();
}

const labResultRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

labResultRoutes.put('/items/:itemId/result', zValidator('json', updateLabItemResultSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const itemId = c.req.param('itemId');
  const data = c.req.valid('json');

  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, lo.patient_id, ${getDiagnosticBillingColumns('lo')},
              p.gender, p.date_of_birth, ltc.normal_range, ltc.critical_low, ltc.critical_high
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       JOIN patients p ON lo.patient_id = p.id
       LEFT JOIN lab_test_catalog ltc ON loi.lab_test_id = ltc.id AND ltc.tenant_id = lo.tenant_id
       WHERE loi.id = ? AND lo.tenant_id = ?`,
    ).bind(itemId, tenantId).first<LabOrderItemVerificationRow>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'entering lab results');

    // Validate item status allows result entry
    const itemStatusAtEntry = String((item as { status?: string }).status ?? 'pending');
    const allowedForResult = ['collected', 'received', 'processing'];
    if (!allowedForResult.includes(itemStatusAtEntry)) {
      throw new HTTPException(400, {
        message: `Cannot enter results for item in '${itemStatusAtEntry}' status. Item must be in: ${allowedForResult.join(', ')}`,
      });
    }

    // Parse numeric value from result string
    const numericValue = parseFloat(data.result);
    const resultNumeric = isNaN(numericValue) ? null : numericValue;

    // Calculate patient age in months
    const dob = item.date_of_birth as string | null;
    const ageMonths = dob
      ? Math.floor((Date.now() - new Date(dob).getTime()) / (1000 * 60 * 60 * 24 * 30.44))
      : 0;

    // Try structured reference range first
    let abnormalFlag: string;
    if (resultNumeric !== null && item.gender) {
      const structuredRange = await getStructuredReferenceRange(
        db, Number(tenantId), item.lab_test_id as number, data.component_id ?? null,
        item.gender as string, ageMonths
      );
      if (structuredRange && structuredRange.range_low !== null && structuredRange.range_high !== null) {
        abnormalFlag = determineAbnormalFromRange(
          resultNumeric, structuredRange.range_low, structuredRange.range_high,
          structuredRange.critical_low, structuredRange.critical_high
        );
      } else {
        abnormalFlag = detectAbnormalFlag(
          resultNumeric ?? undefined,
          item.normal_range as string | null,
          item.critical_low as number | null,
          item.critical_high as number | null,
        );
      }
    } else {
      abnormalFlag = detectAbnormalFlag(
        resultNumeric ?? undefined,
        item.normal_range as string | null,
        item.critical_low as number | null,
        item.critical_high as number | null,
      );
    }

    // Delta check
    let previousValue: string | null = null;
    let deltaFlag: string | null = null;
    if (resultNumeric !== null) {
      const prev = await getPreviousResult(db, Number(tenantId), item.patient_id as number, item.lab_test_id as number, data.component_id ?? null);
      if (prev && prev.result_numeric !== null && prev.result_numeric !== undefined) {
        previousValue = prev.result_value;
        deltaFlag = calculateDelta(resultNumeric, prev.result_numeric);
      } else {
        deltaFlag = 'new';
      }
    }

    // Run custom validation rules
    const validation = await validateLabResult(
      db, Number(tenantId),
      item.lab_test_id as number,
      data.component_id ?? null,
      data.result,
      resultNumeric,
      (item.patient_id as number) ?? null
    );
    if (validation.blocking.length > 0) {
      throw new HTTPException(400, { message: `Validation failed: ${validation.blocking.join('; ')}` });
    }

    const currentStatus = itemStatusAtEntry;
    const labInventoryPolicy = await getLabInventoryPolicy(c.env.DB, tenantId);
    const consumeReagentsOnResult = await shouldConsumeLabReagentsForEvent(c.env.DB, tenantId, 'result');
    if (consumeReagentsOnResult && !['completed', 'verified'].includes(currentStatus)) {
      try {
        await consumeMappedLabConsumables(c.env.DB, {
          tenantId,
          userId: requireUserId(c),
          labOrderItemId: Number(itemId),
          labOrderId: item.lab_order_id as number,
          labTestId: item.lab_test_id as number,
          requireMapping: labInventoryPolicy.require_test_mapping_for_completion,
        });
      } catch (error) {
        if (shouldBlockLabInventoryException(labInventoryPolicy, 'result')) throw error;
      }
    }

    await db.$client.prepare(
      `UPDATE lab_order_items SET result = ?, result_numeric = ?, abnormal_flag = ?, status = 'completed', completed_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`,
    ).bind(data.result, resultNumeric, abnormalFlag, itemId, tenantId).run();

    // Also insert/update lab_results record for delta tracking
    let report = await db.$client.prepare(
      'SELECT id FROM lab_reports WHERE lab_order_id = ? AND tenant_id = ?'
    ).bind(item.lab_order_id, tenantId).first<{ id: number }>();
    if (!report) {
      const reportResult = await db.$client.prepare(
        `INSERT INTO lab_reports (lab_order_id, reported_by, review_status, tenant_id, created_at)
         VALUES (?, ?, 'pending', ?, datetime('now', '+6 hours'))`
      ).bind(item.lab_order_id, requireUserId(c), tenantId).run();
      report = { id: reportResult.meta.last_row_id as number };
    }

    await db.$client.prepare(
      `INSERT INTO lab_results (lab_report_id, lab_test_id, component_id, result_value, result_numeric, abnormal_flag, previous_value, delta_flag, result_status, tenant_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'final', ?, datetime('now', '+6 hours'))`
    ).bind(report.id, item.lab_test_id, data.component_id ?? null, data.result, resultNumeric, abnormalFlag, previousValue, deltaFlag, tenantId).run();

    // Auto-update parent lab_orders status when all items are completed/verified
    const orderId = item.lab_order_id as number;
    const counts = await db.$client.prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN status = 'completed' OR status = 'verified' THEN 1 ELSE 0 END) as done
       FROM lab_order_items WHERE lab_order_id = ?`
    ).bind(orderId).first<{ total: number; done: number }>();
    if (counts && counts.total === counts.done) {
      await db.$client.prepare(
        `UPDATE lab_orders SET status = 'completed' WHERE id = ? AND tenant_id = ?`
      ).bind(orderId, tenantId).run();
    }

    const entryUserId = requireUserId(c);
    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId: entryUserId,
      actorRole: c.get('role') ?? null,
      eventType: 'result_entered',
      eventStage: 'result_entry',
      labOrderId: Number(item.lab_order_id ?? 0) || null,
      labOrderItemId: Number(itemId),
      patientId: Number(item.patient_id ?? 0) || null,
      fromStatus: currentStatus,
      toStatus: 'completed',
      notes: null,
      metadata: { abnormal_flag: abnormalFlag, delta_flag: deltaFlag },
    });

    void createAuditLog(c.env, tenantId!, entryUserId, 'RESULT', 'lab_order_items', Number(itemId), null, { result: data.result, abnormal_flag: abnormalFlag, delta_flag: deltaFlag });

    return c.json({ message: 'Result entered', abnormal_flag: abnormalFlag, delta_flag: deltaFlag });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update result' });
  }
});

/**
 * POST /api/lab/orders/:id/print
 * Increments the print count for a specific lab order and updates the last printed timestamp.
 *
 * @param {string} id - The ID of the lab order.
 * @returns {Object} JSON response indicating success.
 * @throws {HTTPException} 500 if the print count update fails.
 *
 * @example
 * // POST /api/lab/orders/456/print
 */
labResultRoutes.post('/orders/:id/print', async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const id = c.req.param('id');

  try {
    await db.$client.prepare(
      `UPDATE lab_orders SET print_count = print_count + 1, last_printed_at = datetime('now', '+6 hours')
       WHERE id = ? AND tenant_id = ?`,
    ).bind(id, tenantId).run();
    return c.json({ message: 'Print count updated' });
  } catch {
    throw new HTTPException(500, { message: 'Failed to update print count' });
  }
});

// ─── PATCH /api/lab/items/:itemId/sample-status ──────────────────────────────

labResultRoutes.patch('/items/:itemId/sample-status', zValidator('json', updateSampleStatusSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const role = c.get('role');
  const itemId = c.req.param('itemId');
  const data = c.req.valid('json');

  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, ${getDiagnosticBillingColumns('lo')}
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       WHERE loi.id = ? AND lo.tenant_id = ?`
    ).bind(itemId, tenantId).first<{ status: string }>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'updating sample status');

    // Enforce valid state transitions (forward-only workflow)
    const validTransitions: Record<string, string[]> = {
      pending: ['collected', 'rejected'],
      collected: ['received', 'rejected'],
      received: ['processing', 'rejected'],
      processing: ['completed', 'rejected'],
      completed: ['verified'],
      verified: [],
      rejected: [],
    };
    const currentStatus = (item.status as string) || 'pending';
    const allowed = validTransitions[currentStatus] || [];
    if (!allowed.includes(data.status)) {
      throw new HTTPException(400, {
        message: `Invalid transition: ${currentStatus} → ${data.status}. Allowed: ${allowed.join(', ') || 'none'}`,
      });
    }

    await db.$client.prepare(
      `UPDATE lab_order_items SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`
    ).bind(data.status, data.notes ?? null, itemId, tenantId).run();

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: role ?? null,
      eventType: 'sample_status_updated',
      eventStage: 'legacy_status_update',
      labOrderId: Number((item as { lab_order_id?: number }).lab_order_id ?? 0) || null,
      labOrderItemId: Number(itemId),
      patientId: Number((item as { patient_id?: number }).patient_id ?? 0) || null,
      fromStatus: currentStatus,
      toStatus: data.status,
      notes: data.notes ?? null,
    });
    void createAuditLog(c.env, tenantId, userId, 'UPDATE_STATUS', 'lab_order_items', Number(itemId), item, {
      status: data.status,
      notes: data.notes ?? null,
    });
    return c.json({ message: `Sample status updated to ${data.status}` });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to update sample status' });
  }
});

// ─── PATCH /api/lab/items/:itemId/cancel ─────────────────────────────────────

labResultRoutes.patch('/items/:itemId/cancel', zValidator('json', cancelLabItemSchema), async (c) => {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const itemId = Number(c.req.param('itemId'));
  const data = c.req.valid('json');
  const today = getTodayGMT6();

  if (!Number.isFinite(itemId) || itemId <= 0) {
    throw new HTTPException(400, { message: 'Invalid lab item ID' });
  }

  try {
    await assertAccountingPeriodOpen(c.env.DB, tenantId, today, 'Lab item cancellation');
    const result = await cancelLabOrderItem(c.env.DB, {
      tenantId,
      userId,
      itemId,
      reason: data.reason,
      notes: data.notes ?? null,
    });

    if (result.billId && result.cancelledAmount > 0) {
      await recordAccountingPostingEvent(c.env.DB, {
        tenantId,
        sourceType: 'billing_item_cancellation',
        sourceId: `${result.billId}:lab-item:${result.itemId}`,
        eventType: ACCOUNTING_EVENT_TYPES.billCancelled,
        eventDate: today,
        createdBy: userId,
        payload: {
          billId: result.billId,
          itemIds: [result.itemId],
          labOrderId: result.labOrderId,
          total: result.cancelledAmount,
          discount: 0,
          testBill: result.cancelledAmount,
          doctorVisitBill: 0,
          admissionBill: 0,
          operationBill: 0,
          medicineBill: 0,
          reason: data.reason,
        },
      });
      queueLabAccountingPosting(c, tenantId);
    }

    void createAuditLog(c.env, tenantId, userId, 'CANCEL', 'lab_order_items', result.itemId, null, {
      billId: result.billId,
      labOrderId: result.labOrderId,
      cancelledAmount: result.cancelledAmount,
      reason: data.reason,
    });

    return c.json({
      message: 'Lab item cancelled',
      itemId: result.itemId,
      labOrderId: result.labOrderId,
      billId: result.billId,
      cancelledAmount: result.cancelledAmount,
      newBillTotal: result.newBillTotal,
      orderStatus: result.orderStatus,
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to cancel lab item' });
  }
});

// ─── PATCH /api/lab/items/:itemId/reject ─────────────────────────────────────

labResultRoutes.patch('/items/:itemId/reject', zValidator('json', rejectSampleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const itemId = c.req.param('itemId');
  const data = c.req.valid('json');

  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, ${getDiagnosticBillingColumns('lo')}
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       WHERE loi.id = ? AND lo.tenant_id = ?`
    ).bind(itemId, tenantId).first<{ status: string }>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'rejecting a sample');

    const currentStatus = (item.status as string) || 'pending';
    const allowed = ['pending', 'collected', 'received', 'processing'];
    if (!allowed.includes(currentStatus)) {
      throw new HTTPException(400, {
        message: `Cannot reject sample in status '${currentStatus}'. Only samples in ${allowed.join(', ')} can be rejected.`,
      });
    }

    await db.$client.prepare(
      `UPDATE lab_order_items
       SET status = 'rejected',
           rejection_reason_id = ?,
           rejected_by = ?,
           rejected_at = datetime('now', '+6 hours'),
           rejection_notes = COALESCE(?, rejection_notes),
           updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`
    ).bind(data.rejection_reason_id, userId, data.notes ?? null, itemId, tenantId).run();

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: c.get('role') ?? null,
      eventType: 'sample_rejected',
      eventStage: 'rejection',
      labOrderId: Number((item as { lab_order_id?: number }).lab_order_id ?? 0) || null,
      labOrderItemId: Number(itemId),
      patientId: Number((item as { patient_id?: number }).patient_id ?? 0) || null,
      fromStatus: currentStatus,
      toStatus: 'rejected',
      notes: data.notes ?? null,
      metadata: { rejection_reason_id: data.rejection_reason_id },
    });
    void createAuditLog(c.env, tenantId, userId, 'REJECT', 'lab_order_items', Number(itemId), item, {
      status: 'rejected',
      rejection_reason_id: data.rejection_reason_id,
      notes: data.notes ?? null,
    });

    return c.json({ message: 'Sample rejected' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to reject sample' });
  }
});

// ─── PATCH /api/lab/items/:itemId/recollect ──────────────────────────────────

labResultRoutes.patch('/items/:itemId/recollect', zValidator('json', recollectSampleSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const itemId = c.req.param('itemId');
  const data = c.req.valid('json');

  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, ${getDiagnosticBillingColumns('lo')}
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       WHERE loi.id = ? AND lo.tenant_id = ?`
    ).bind(itemId, tenantId).first<{ status: string }>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'marking a sample for recollection');

    if ((item.status as string) !== 'rejected') {
      throw new HTTPException(400, {
        message: `Only rejected samples can be marked for recollection. Current status: ${item.status}`,
      });
    }

    await db.$client.prepare(
      `UPDATE lab_order_items
       SET status = 'pending',
           notes = COALESCE(?, notes),
           updated_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`
    ).bind(data.notes ?? null, itemId, tenantId).run();

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: c.get('role') ?? null,
      eventType: 'sample_recollection_requested',
      eventStage: 'recollection',
      labOrderId: Number((item as { lab_order_id?: number }).lab_order_id ?? 0) || null,
      labOrderItemId: Number(itemId),
      patientId: Number((item as { patient_id?: number }).patient_id ?? 0) || null,
      fromStatus: 'rejected',
      toStatus: 'pending',
      notes: data.notes ?? null,
    });
    void createAuditLog(c.env, tenantId, userId, 'RECOLLECT', 'lab_order_items', Number(itemId), item, {
      status: 'pending',
      notes: data.notes ?? null,
    });

    return c.json({ message: 'Sample marked for recollection' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to mark sample for recollection' });
  }
});

// ─── LIS Enterprise Endpoints ────────────────────────────────────────────────

/**
 * PATCH /api/lab/items/:itemId/verify
 * Restricted to doctors/pathologists. Marks an item as verified.
 */
labResultRoutes.patch('/items/:itemId/verify', requireRole('laboratory', 'doctor', 'md', 'hospital_admin'), zValidator('json', verifyLabItemSchema), async (c) => {
  const db = getDb(c.env.DB);
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  const itemId = c.req.param('itemId');
  
  try {
    const item = await db.$client.prepare(
      `SELECT loi.*, lo.tenant_id, ${getDiagnosticBillingColumns('lo')}
       FROM lab_order_items loi
       JOIN lab_orders lo ON loi.lab_order_id = lo.id
       ${getDiagnosticBillingJoin('lo')}
       WHERE loi.id = ? AND lo.tenant_id = ?`
    ).bind(itemId, tenantId).first<LabOrderItemVerificationRow>();
    if (!item) throw new HTTPException(404, { message: 'Lab order item not found' });
    assertDiagnosticBillCleared(item as Record<string, unknown>, 'verifying lab results');

    await db.$client.prepare(
      `UPDATE lab_order_items SET status = 'verified', verified_by = ?, verified_at = datetime('now', '+6 hours')
       WHERE id = ? AND lab_order_id IN (SELECT id FROM lab_orders WHERE tenant_id = ?)`
    ).bind(userId, itemId, tenantId).run();

    // Accrue commission for the PERFORMER (verifying doctor)
    c.executionCtx.waitUntil(
      accrueLabVerificationCommissions(c.env.DB, {
        tenantId,
        userId,
        patientId: item.patient_id,
        visitId: item.visit_id,
        billId: item.bill_id,
        labOrderId: item.lab_order_id,
        labOrderItemId: Number(itemId),
        labTestId: item.lab_test_id,
        category: item.category,
        lineTotal: item.line_total ?? 0,
        verificationDate: getTodayGMT6(),
      }).catch(err => console.error('Failed to accrue performer commission:', err))
    );

    await recordLabWorkflowEvent(c.env.DB, {
      tenantId,
      userId,
      actorRole: c.get('role') ?? null,
      eventType: 'result_verified_legacy',
      eventStage: 'legacy_verification',
      labOrderId: item.lab_order_id,
      labOrderItemId: Number(itemId),
      patientId: item.patient_id,
      fromStatus: String(item.status ?? 'completed'),
      toStatus: 'verified',
      notes: c.req.valid('json').notes ?? null,
    });
    void createAuditLog(c.env, tenantId, userId, 'VERIFY', 'lab_order_items', Number(itemId), item, {
      status: 'verified',
      notes: c.req.valid('json').notes ?? null,
    });
    
    return c.json({ message: 'Lab result verified successfully' });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(500, { message: 'Failed to verify result' });
  }
});

/**
 * POST /api/lab/barcode/scan
 * Used by physical barcode scanners to quickly update a sample status.
 */

export default labResultRoutes;
