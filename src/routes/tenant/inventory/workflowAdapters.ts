import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "../../../types";
import { recordInventoryIssue } from './issues';
import { INVENTORY_ISSUE_MAX_INPUT_ITEMS } from '../../../lib/inventory-issue-service';
import { triggerInventoryConsumptionFromWorkflow } from '../../../lib/inventory-consumption-triggering';

type Variables = { tenantId?: string; userId?: string; role?: string };

const adapters = new Hono<{ Bindings: Env; Variables: Variables }>();

const adapterItemSchema = z.object({
  ItemId: z.number().int().positive(),
  StockId: z.number().int().positive().optional(),
  BatchNo: z.string().max(120).optional(),
  Quantity: z.number().int().positive(),
  Chargeable: z.boolean().optional(),
  ChargeAmount: z.number().min(0).optional(),
  Remarks: z.string().max(500).optional(),
});

const labReagentConsumptionSchema = z.object({
  FromStoreId: z.number().int().positive(),
  LabOrderId: z.number().int().positive().optional(),
  DepartmentId: z.number().int().positive().optional(),
  MachineId: z.number().int().positive().optional(),
  TestId: z.number().int().positive().optional(),
  Remarks: z.string().max(1000).optional(),
  IdempotencyKey: z.string().trim().min(8).max(128).optional(),
  Items: z.array(adapterItemSchema).min(1).max(INVENTORY_ISSUE_MAX_INPUT_ITEMS),
});

const triggerConsumptionSchema = z.object({
  triggerType: z.enum(["billing_item", "lab_test", "ot_procedure", "procedure", "nursing_task", "emergency_service", "pharmacy_sale", "package", "manual_reference"]),
  triggerId: z.number().int().positive().optional(),
  triggerCode: z.string().max(120).optional(),
  patientId: z.number().int().positive().optional(),
  visitId: z.number().int().positive().optional(),
  admissionId: z.number().int().positive().optional(),
  billId: z.number().int().positive().optional(),
  invoiceItemId: z.number().int().positive().optional(),
  labOrderId: z.number().int().positive().optional(),
  labOrderItemId: z.number().int().positive().optional(),
  otCaseId: z.number().int().positive().optional(),
  procedureId: z.number().int().positive().optional(),
  department: z.string().max(120).optional(),
  storeId: z.number().int().positive().optional(),
  remarks: z.string().max(1000).optional(),
});

const otConsumptionSchema = z.object({
  FromStoreId: z.number().int().positive(),
  PatientId: z.number().int().positive(),
  AdmissionId: z.number().int().positive().optional(),
  VisitId: z.number().int().positive().optional(),
  SurgeryId: z.number().int().positive().optional(),
  OTRoom: z.string().max(120).optional(),
  Surgeon: z.string().max(120).optional(),
  Chargeable: z.boolean().default(false),
  Remarks: z.string().max(1000).optional(),
  IdempotencyKey: z.string().trim().min(8).max(128).optional(),
  Items: z.array(adapterItemSchema).min(1).max(INVENTORY_ISSUE_MAX_INPUT_ITEMS),
});

adapters.post("/trigger-consumption", zValidator("json", triggerConsumptionSchema), async (c) => {
  const tenantId = c.get("tenantId");
  const userId = Number(c.get("userId"));
  const result = await triggerInventoryConsumptionFromWorkflow(c.env.DB, {
    tenantId: String(tenantId),
    userId: Number.isFinite(userId) && userId > 0 ? userId : null,
    ...c.req.valid("json"),
  });
  return c.json({ message: "Consumption trigger processed", ...result });
});

adapters.post('/lab/reagent-consumption', zValidator('json', labReagentConsumptionSchema), async (c) => {
  const body = c.req.valid('json');
  const idempotencyKey = c.req.header('Idempotency-Key') ?? body.IdempotencyKey;
  return recordInventoryIssue(c, {
    IssueType: "lab_consumption",
    FromStoreId: body.FromStoreId,
    DepartmentId: body.DepartmentId,
    ToDepartment: "Lab",
    LabOrderId: body.LabOrderId,
    Chargeable: false,
    Remarks: body.Remarks || [
      body.TestId ? `Test ${body.TestId}` : null,
      body.MachineId ? `Machine ${body.MachineId}` : null,
    ].filter(Boolean).join(' | ') || undefined,
    Items: body.Items,
  }, idempotencyKey);
});

adapters.post('/ot/consumption', zValidator('json', otConsumptionSchema), async (c) => {
  const body = c.req.valid('json');
  const idempotencyKey = c.req.header('Idempotency-Key') ?? body.IdempotencyKey;
  return recordInventoryIssue(c, {
    IssueType: "ot_consumption",
    FromStoreId: body.FromStoreId,
    ToDepartment: body.OTRoom ? `OT - ${body.OTRoom}` : "OT",
    PatientId: body.PatientId,
    AdmissionId: body.AdmissionId,
    VisitId: body.VisitId,
    SurgeryId: body.SurgeryId,
    Chargeable: body.Chargeable,
    Remarks: body.Remarks || (body.Surgeon ? `Surgeon: ${body.Surgeon}` : undefined),
    Items: body.Items.map((item) => ({
      ...item,
      Chargeable: item.Chargeable ?? body.Chargeable,
    })),
  }, idempotencyKey);
});

export default adapters;
