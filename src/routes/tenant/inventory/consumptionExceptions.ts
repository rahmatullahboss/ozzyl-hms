import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import { createConsumptionException, listConsumptionExceptions, reviewConsumptionException } from "../../../lib/inventory-consumption-exceptions";

type Variables = { tenantId?: string; userId?: string; role?: string };

const consumptionExceptions = new Hono<{ Bindings: Env; Variables: Variables }>();

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

const createExceptionSchema = z.object({
  eventId: z.number().int().positive(),
  eventItemId: z.number().int().positive().nullable().optional(),
  reason: z.enum(["missing_rule", "stock_shortage", "scan_missing", "approval_required", "variance_high", "duplicate_event", "reference_missing", "reversal_failed"]),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  message: z.string().min(1).max(1000),
});

const reviewExceptionSchema = z.object({
  status: z.enum(["open", "reviewed", "resolved", "ignored"]),
  resolutionNote: z.string().max(1000).nullable().optional(),
});

const listExceptionQuerySchema = z.object({
  status: z.enum(["open", "reviewed", "resolved", "ignored"]).optional(),
  severity: z.enum(["info", "warning", "critical"]).optional(),
  reason: z.enum(["missing_rule", "stock_shortage", "scan_missing", "approval_required", "variance_high", "duplicate_event", "reference_missing", "reversal_failed"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

consumptionExceptions.get("/", zValidator("query", listExceptionQuerySchema), async (c) => {
  const rows = await listConsumptionExceptions(c.env.DB, tenantId(c), c.req.valid("query"));
  return c.json({ data: rows });
});

consumptionExceptions.post("/", zValidator("json", createExceptionSchema), async (c) => {
  const result = await createConsumptionException(c.env.DB, {
    tenantId: tenantId(c),
    createdBy: userId(c),
    ...c.req.valid("json"),
  });
  return c.json({ data: result }, 201);
});

consumptionExceptions.post("/:id/review", zValidator("json", reviewExceptionSchema), async (c) => {
  const result = await reviewConsumptionException(c.env.DB, {
    tenantId: tenantId(c),
    exceptionId: Number(c.req.param("id")),
    reviewedBy: userId(c),
    ...c.req.valid("json"),
  });
  return c.json({ data: result });
});

export default consumptionExceptions;
