import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import { createExpectedConsumptionEvent, confirmConsumptionEvent, getConsumptionEventDetail, listConsumptionEvents, reviewConsumptionVariance } from "../../../lib/inventory-consumption-events";
import { postConsumptionEvent } from "../../../lib/inventory-consumption-posting";
import { recordInventoryIssue } from "./issues";

type Variables = { tenantId?: string; userId?: string; role?: string };

const consumptionEvents = new Hono<{ Bindings: Env; Variables: Variables }>();

function tenantId(c: any): string {
  const value = c.get("tenantId");
  if (!value) throw new Error("tenantId is required");
  return String(value);
}

function userId(c: any): number {
  const numeric = Number(c.get("userId"));
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error("userId is required");
  return numeric;
}

const eventItemSchema = z.object({
  ruleItemId: z.number().int().positive().nullable().optional(),
  itemId: z.number().int().positive(),
  stockId: z.number().int().positive().nullable().optional(),
  batchNo: z.string().max(120).nullable().optional(),
  expectedQuantity: z.number().positive(),
  actualQuantity: z.number().min(0).nullable().optional(),
  unit: z.string().max(50).nullable().optional(),
  chargeable: z.boolean().optional(),
  chargeAmount: z.number().min(0).optional(),
  requiresScan: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  highValueFlag: z.boolean().optional(),
  remarks: z.string().max(500).nullable().optional(),
});

const createEventSchema = z.object({
  eventNo: z.string().max(80).nullable().optional(),
  ruleId: z.number().int().positive().nullable().optional(),
  triggerType: z.enum(["billing_item", "lab_test", "ot_procedure", "procedure", "nursing_task", "emergency_service", "pharmacy_sale", "package", "manual_reference"]),
  triggerId: z.number().int().positive().nullable().optional(),
  triggerCode: z.string().max(120).nullable().optional(),
  patientId: z.number().int().positive().nullable().optional(),
  visitId: z.number().int().positive().nullable().optional(),
  admissionId: z.number().int().positive().nullable().optional(),
  billId: z.number().int().positive().nullable().optional(),
  invoiceItemId: z.number().int().positive().nullable().optional(),
  labOrderId: z.number().int().positive().nullable().optional(),
  labOrderItemId: z.number().int().positive().nullable().optional(),
  otCaseId: z.number().int().positive().nullable().optional(),
  procedureId: z.number().int().positive().nullable().optional(),
  department: z.string().max(120).nullable().optional(),
  storeId: z.number().int().positive().nullable().optional(),
  deductionMode: z.enum(["auto", "suggest_confirm", "scan_required", "approval_required", "manual_only"]),
  remarks: z.string().max(1000).nullable().optional(),
  items: z.array(eventItemSchema).min(1),
});

const confirmItemSchema = z.object({
  eventItemId: z.number().int().positive(),
  expectedQuantity: z.number().min(0),
  actualQuantity: z.number().min(0),
  toleranceQty: z.number().min(0).optional(),
  tolerancePercent: z.number().min(0).optional(),
  varianceReason: z.string().max(500).nullable().optional(),
});

const confirmSchema = z.object({
  items: z.array(confirmItemSchema).min(1),
});

const varianceReviewSchema = z.object({
  note: z.string().max(1000).nullable().optional(),
});

const listEventQuerySchema = z.object({
  status: z.enum(["expected", "pending_confirmation", "confirmed", "posted", "reversed", "cancelled", "blocked_missing_rule", "blocked_stock_shortage", "blocked_scan_required", "blocked_approval_required", "variance_review"]).optional(),
  department: z.string().optional(),
  triggerType: z.enum(["billing_item", "lab_test", "ot_procedure", "procedure", "nursing_task", "emergency_service", "pharmacy_sale", "package", "manual_reference"]).optional(),
  patientId: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

consumptionEvents.get("/", zValidator("query", listEventQuerySchema), async (c) => {
  const rows = await listConsumptionEvents(c.env.DB, tenantId(c), c.req.valid("query"));
  return c.json({ data: rows });
});

consumptionEvents.get("/:id", async (c) => {
  const eventId = Number(c.req.param("id"));
  const detail = await getConsumptionEventDetail(c.env.DB, tenantId(c), eventId);
  return c.json({ data: detail });
});

consumptionEvents.post("/", zValidator("json", createEventSchema), async (c) => {
  const result = await createExpectedConsumptionEvent(c.env.DB, {
    tenantId: tenantId(c),
    userId: userId(c),
    ...c.req.valid("json"),
  });
  return c.json({ data: result }, result.created ? 201 : 200);
});

consumptionEvents.post("/:id/confirm", zValidator("json", confirmSchema), async (c) => {
  const eventId = Number(c.req.param("id"));
  const result = await confirmConsumptionEvent(c.env.DB, {
    tenantId: tenantId(c),
    eventId,
    userId: userId(c),
    items: c.req.valid("json").items,
  });
  return c.json({ data: result });
});

consumptionEvents.post("/:id/review-variance", zValidator("json", varianceReviewSchema), async (c) => {
  const eventId = Number(c.req.param("id"));
  const result = await reviewConsumptionVariance(c.env.DB, {
    tenantId: tenantId(c),
    eventId,
    reviewedBy: userId(c),
    note: c.req.valid("json").note ?? null,
  });
  return c.json({ data: result });
});

consumptionEvents.post("/:id/post", async (c) => {
  const eventId = Number(c.req.param("id"));
  const result = await postConsumptionEvent(c.env.DB, {
    tenantId: tenantId(c),
    eventId,
    userId: userId(c),
    postIssue: async (payload) => {
      const response = await recordInventoryIssue(
        c,
        payload,
        `consumption-event:${tenantId(c)}:${eventId}`,
      );
      return response.json();
    },
  });
  return c.json({ data: result }, result.posted ? 201 : 200);
});

export default consumptionEvents;
