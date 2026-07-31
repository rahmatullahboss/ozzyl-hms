import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import {
  createConsumptionRule,
  listConsumptionRules,
  findConsumptionRulesForTrigger,
} from "../../../lib/inventory-consumption-rules";
import { seedInventoryConsumptionDefaults } from "../../../lib/inventory-consumption-defaults";

type Variables = { tenantId?: string; userId?: string; role?: string };

const consumptionRules = new Hono<{ Bindings: Env; Variables: Variables }>();

function tenantId(c: any): string {
  const value = c.get("tenantId");
  if (!value) throw new Error("tenantId is required");
  return String(value);
}

function userId(c: any): number | null {
  const value = c.get("userId");
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

const ruleItemSchema = z.object({
  itemId: z.number().int().positive(),
  defaultStockId: z.number().int().positive().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().max(50).nullable().optional(),
  isMandatory: z.boolean().optional(),
  requiresScan: z.boolean().optional(),
  requiresApproval: z.boolean().optional(),
  highValueFlag: z.boolean().optional(),
  allowSubstitution: z.boolean().optional(),
  varianceToleranceQty: z.number().min(0).optional(),
  varianceTolerancePercent: z.number().min(0).optional(),
  sortOrder: z.number().int().optional(),
  notes: z.string().max(500).nullable().optional(),
});

const createRuleSchema = z.object({
  ruleName: z.string().min(1).max(160),
  ruleCode: z.string().max(80).nullable().optional(),
  triggerType: z.enum(["billing_item", "lab_test", "ot_procedure", "procedure", "nursing_task", "emergency_service", "pharmacy_sale", "package", "manual_reference"]),
  triggerId: z.number().int().positive().nullable().optional(),
  triggerCode: z.string().max(120).nullable().optional(),
  department: z.string().max(120).nullable().optional(),
  defaultStoreId: z.number().int().positive().nullable().optional(),
  deductionMode: z.enum(["auto", "suggest_confirm", "scan_required", "approval_required", "manual_only"]).optional(),
  chargePolicy: z.enum(["none", "patient", "department", "included_in_package"]).optional(),
  isActive: z.boolean().optional(),
  effectiveFrom: z.string().nullable().optional(),
  effectiveTo: z.string().nullable().optional(),
  items: z.array(ruleItemSchema).min(1),
});

const listQuerySchema = z.object({
  triggerType: z.enum(["billing_item", "lab_test", "ot_procedure", "procedure", "nursing_task", "emergency_service", "pharmacy_sale", "package", "manual_reference"]).optional(),
  isActive: z.coerce.boolean().optional(),
  department: z.string().optional(),
});

const findQuerySchema = z.object({
  triggerType: z.enum(["billing_item", "lab_test", "ot_procedure", "procedure", "nursing_task", "emergency_service", "pharmacy_sale", "package", "manual_reference"]),
  triggerId: z.coerce.number().int().positive().optional(),
  triggerCode: z.string().optional(),
});

consumptionRules.get("/", zValidator("query", listQuerySchema), async (c) => {
  const rows = await listConsumptionRules(c.env.DB, tenantId(c), c.req.valid("query"));
  return c.json({ data: rows });
});

consumptionRules.get("/match", zValidator("query", findQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const rows = await findConsumptionRulesForTrigger(c.env.DB, { tenantId: tenantId(c), ...query });
  return c.json({ data: rows });
});

consumptionRules.post("/defaults/seed", async (c) => {
  const summary = await seedInventoryConsumptionDefaults(c.env.DB, tenantId(c), userId(c));
  return c.json({ message: "Starter consumption rules checked", summary });
});

consumptionRules.post("/", zValidator("json", createRuleSchema), async (c) => {
  const body = c.req.valid("json");
  const result = await createConsumptionRule(c.env.DB, {
    tenantId: tenantId(c),
    userId: userId(c),
    rule: { tenantId: tenantId(c), ...body },
  });
  return c.json({ data: result }, 201);
});

export default consumptionRules;
