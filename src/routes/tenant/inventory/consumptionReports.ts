import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import {
  buildConsumptionReconciliationSummary,
  buildConsumptionRuleCoverageSummary,
  listConsumptionReconciliationRows,
  listConsumptionRuleCoverageRows,
} from "../../../lib/inventory-consumption-reports";

type Variables = { tenantId?: string; userId?: string; role?: string };

const consumptionReports = new Hono<{ Bindings: Env; Variables: Variables }>();

function tenantId(c: any): string {
  const value = c.get("tenantId");
  if (!value) throw new Error("tenantId is required");
  return String(value);
}

const reportQuerySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  department: z.string().optional(),
  triggerType: z.string().optional(),
});

consumptionReports.get("/reconciliation", zValidator("query", reportQuerySchema), async (c) => {
  const filters = c.req.valid("query");
  const rows = await listConsumptionReconciliationRows(c.env.DB, tenantId(c), filters);
  return c.json({ data: { rows, summary: buildConsumptionReconciliationSummary(rows) } });
});

consumptionReports.get("/rule-coverage", zValidator("query", reportQuerySchema), async (c) => {
  const filters = c.req.valid("query");
  const rows = await listConsumptionRuleCoverageRows(c.env.DB, tenantId(c), filters);
  return c.json({ data: { rows, summary: buildConsumptionRuleCoverageSummary(rows) } });
});

export default consumptionReports;
