import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import { requireTenantId, requireUserId } from "../../../lib/context-helpers";
import {
  createInventoryIssue,
  INVENTORY_ISSUE_MAX_INPUT_ITEMS,
  type CreateInventoryIssuePayload,
} from '../../../lib/inventory-issue-service';

type Variables = { tenantId?: string; userId?: string; role?: string };

const issues = new Hono<{ Bindings: Env; Variables: Variables }>();

const issueItemSchema = z.object({
  ItemId: z.number().int().positive(),
  StockId: z.number().int().positive().optional(),
  BatchNo: z.string().max(120).optional(),
  Quantity: z.number().positive(),
  Chargeable: z.boolean().optional(),
  ChargeAmount: z.number().min(0).optional(),
  Remarks: z.string().max(500).optional(),
});

const createIssueSchema = z.object({
  IssueType: z.enum([
    "department_issue",
    "patient_issue",
    "ot_consumption",
    "emergency_issue",
    "lab_consumption",
    "pharmacy_sale",
    "asset_issue",
  ]).default("department_issue"),
  FromStoreId: z.number().int().positive(),
  ToDepartment: z.string().max(120).optional(),
  DepartmentId: z.number().int().positive().optional(),
  PatientId: z.number().int().positive().optional(),
  AdmissionId: z.number().int().positive().optional(),
  VisitId: z.number().int().positive().optional(),
  SurgeryId: z.number().int().positive().optional(),
  LabOrderId: z.number().int().positive().optional(),
  BillingReferenceId: z.number().int().positive().optional(),
  RequestedBy: z.string().max(120).optional(),
  ApprovedBy: z.string().max(120).optional(),
  Chargeable: z.boolean().default(false),
  Remarks: z.string().max(1000).optional(),
  IdempotencyKey: z.string().trim().min(8).max(128).optional(),
  Items: z.array(issueItemSchema).min(1).max(INVENTORY_ISSUE_MAX_INPUT_ITEMS),
});

export type { CreateInventoryIssuePayload };

export async function recordInventoryIssue(
  c: any,
  body: CreateInventoryIssuePayload,
  idempotencyKey?: string,
) {
  const tenantId = requireTenantId(c);
  const userId = requireUserId(c);
  let waitUntil: ((promise: Promise<unknown>) => void) | undefined;
  try {
    waitUntil = c.executionCtx?.waitUntil?.bind(c.executionCtx);
  } catch {
    waitUntil = undefined;
  }

  const result = await createInventoryIssue({
    db: c.env.DB,
    tenantId,
    userId,
    idempotencyKey,
    waitUntil,
  }, body);

  return c.json(result, result.replayed ? 200 : 201);
}

issues.post('/', zValidator('json', createIssueSchema), async (c) => {
  const body = c.req.valid('json');
  const idempotencyKey = c.req.header('Idempotency-Key') ?? body.IdempotencyKey;
  return recordInventoryIssue(c, body, idempotencyKey);
});

export default issues;
