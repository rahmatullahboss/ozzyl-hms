import { z } from 'zod';

const labTestCategorySchema = z.string().trim().min(1).max(100).optional();
const activeStatusSchema = z.union([
  z.boolean(),
  z.number().int().min(0).max(1),
]);

export const createLabTestSchema = z.object({
  code: z.string().trim().min(1, 'Test code required'),
  name: z.string().trim().min(1, 'Test name required'),
  category: labTestCategorySchema,
  price: z.number().int().nonnegative('Price required'),
  unit: z.string().optional(),
  normal_range: z.string().optional(), // e.g. "70-100" or "M:4.5-5.5|F:4.0-5.0"
  method: z.string().optional(),
  critical_low: z.number().optional(),
  critical_high: z.number().optional(),
  is_commissionable: activeStatusSchema.optional(),
});

export const updateLabTestSchema = createLabTestSchema.partial().extend({
  is_active: activeStatusSchema.optional(),
});

const labOrderItemSchema = z.object({
  labTestId: z.number().int().positive('Lab test ID required'),
  discount: z.number().int().nonnegative().default(0),
});

export const createLabOrderSchema = z.object({
  patientId: z.number().int().positive('Patient ID required'),
  visitId: z.number().int().positive().optional(),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  // P0-13: idempotency key — optional in the body, generated server-side when absent.
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  items: z.array(labOrderItemSchema).min(1, 'At least one test required'),
});

export const updateLabItemResultSchema = z.object({
  result: z.string().min(1, 'Result required'),
  component_id: z.number().int().positive().optional(),
  is_draft: z.boolean().optional(),
});

export const updateSampleStatusSchema = z.object({
  status: z.enum(['collected', 'received', 'processing', 'completed', 'verified', 'rejected']),
  notes: z.string().optional(),
});

export const rejectSampleSchema = z.object({
  rejection_reason_id: z.number().int().positive('Rejection reason ID required'),
  notes: z.string().optional(),
});

export const recollectSampleSchema = z.object({
  notes: z.string().optional(),
});

export const cancelLabItemSchema = z.object({
  reason: z.string().min(1, 'Cancel reason required'),
  notes: z.string().optional(),
});

export const verifyLabItemSchema = z.object({
  notes: z.string().optional(),
});

export const barcodeScanSchema = z.object({
  barcode: z.string().min(1, 'Barcode required'),
  action: z.enum(['collect', 'process', 'complete']),
});

export const collectLabSpecimenSchema = z.object({
  labOrderItemIds: z.array(z.number().int().positive()).optional(),
  specimen_barcode: z.string().trim().min(1).max(120).optional(),
  specimen_type: z.string().trim().max(120).optional(),
  container_type: z.string().trim().max(120).optional(),
  collection_site: z.string().trim().max(120).optional(),
  fasting_status: z.string().trim().max(80).optional(),
  collection_priority: z.enum(['routine', 'urgent', 'stat', 'asap']).default('routine'),
  notes: z.string().trim().max(500).optional(),
});

export const receiveLabSpecimenSchema = z.object({
  location: z.string().trim().max(120).optional(),
  transport_condition: z.string().trim().max(120).optional(),
  storage_location: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(500).optional(),
});

export const receiveMachineResultSchema = z.object({
  deviceId: z.string().min(1, 'Device ID required'),
  barcode: z.string().optional(),
  orderNo: z.string().optional(),
  patientId: z.number().optional(), // HL7 PID
  testCodes: z.array(z.object({
    code: z.string(),
    result: z.string(),
    abnormalFlag: z.string().optional(),
    unit: z.string().optional(),
  })).min(1, 'At least one test result required'),
}).refine(data => data.barcode || data.orderNo, {
  message: "Either barcode or orderNo must be provided",
});

export type CreateLabTestInput        = z.infer<typeof createLabTestSchema>;
export type CreateLabOrderInput       = z.infer<typeof createLabOrderSchema>;
export type UpdateLabItemResultInput  = z.infer<typeof updateLabItemResultSchema>;
export type UpdateSampleStatusInput   = z.infer<typeof updateSampleStatusSchema>;
export type VerifyLabItemInput        = z.infer<typeof verifyLabItemSchema>;
export type BarcodeScanInput          = z.infer<typeof barcodeScanSchema>;
export type CollectLabSpecimenInput   = z.infer<typeof collectLabSpecimenSchema>;
export type ReceiveLabSpecimenInput   = z.infer<typeof receiveLabSpecimenSchema>;
export type ReceiveMachineResultInput = z.infer<typeof receiveMachineResultSchema>;

// ─── Panel / Hierarchical Test ──────────────────────────────────────────────

export const createPanelSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.string().optional(),
  price: z.number().int().nonnegative(),
  department: z.string().optional(),
  specimen_type: z.string().optional(),
  specimen_volume: z.string().optional(),
  specimen_container: z.string().optional(),
  tat_minutes: z.number().int().positive().optional(),
  childTestIds: z.array(z.number().int().positive()).min(1, 'Panel must have at least one child test'),
});

export const updatePanelSchema = createPanelSchema.partial();

// ─── Lab Report ─────────────────────────────────────────────────────────────

export const createLabReportSchema = z.object({
  lab_order_id: z.number().int().positive(),
  lab_order_item_id: z.number().int().positive().optional(),
  specimen_num: z.string().optional(),
  report_notes: z.string().optional(),
  pathologist_notes: z.string().optional(),
});

export const reviewLabReportSchema = z.object({
  notes: z.string().optional(),
});

// ─── Lab Results (individual result entry) ──────────────────────────────────

export const createLabResultSchema = z.object({
  lab_report_id: z.number().int().positive(),
  lab_test_id: z.number().int().positive(),
  result_code: z.string().optional(),
  result_value: z.string().min(1),
  units: z.string().optional(),
  normal_range: z.string().optional(),
  value_type: z.enum(['numeric', 'string', 'memo', 'coded', 'ratio']).default('numeric'),
  comments: z.string().optional(),
  result_status: z.enum(['preliminary', 'final', 'corrected', 'cancelled']).default('preliminary'),
});

// ─── Bulk Result Entry ──────────────────────────────────────────────────────

export const bulkResultEntrySchema = z.object({
  results: z.array(z.object({
    lab_test_id: z.number().int().positive(),
    component_id: z.number().int().positive().optional(),
    result_value: z.string().min(1),
    units: z.string().optional(),
    comments: z.string().optional(),
    result_status: z.enum(['preliminary', 'final', 'corrected']).default('final'),
  })).min(1),
  specimen_num: z.string().optional(),
  report_notes: z.string().optional(),
});

// ─── Enhanced Create Lab Test (with hierarchical fields) ────────────────────

export const createLabTestExtendedSchema = createLabTestSchema.extend({
  parent_id: z.number().int().positive().optional(),
  test_type: z.enum(['group', 'panel', 'single', 'component']).default('single'),
  specimen_type: z.string().optional(),
  specimen_volume: z.string().optional(),
  specimen_container: z.string().optional(),
  department: z.string().optional(),
  tat_minutes: z.number().int().positive().optional(),
  display_sequence: z.number().int().nonnegative().default(0),
  value_type: z.enum(['numeric', 'string', 'memo', 'coded', 'ratio']).default('numeric'),
  interpretation_template: z.string().optional(),
  is_outsourced: z.boolean().default(false),
  outsource_vendor_id: z.number().int().positive().optional(),
  loinc_code: z.string().optional(),
});

// ─── Enhanced Create Order (with priority, specimen, clinical info) ─────────

export const createLabOrderExtendedSchema = createLabOrderSchema.extend({
  priority: z.enum(['routine', 'urgent', 'stat', 'asap']).default('routine'),
  specimen_type: z.string().optional(),
  specimen_fasting: z.string().optional(),
  clinical_history: z.string().optional(),
  vendor_id: z.number().int().positive().optional(),
  notes: z.string().optional(),
});

export type CreatePanelInput = z.infer<typeof createPanelSchema>;
export type CreateLabReportInput = z.infer<typeof createLabReportSchema>;
export type CreateLabResultInput = z.infer<typeof createLabResultSchema>;
export type BulkResultEntryInput = z.infer<typeof bulkResultEntrySchema>;
export type CreateLabTestExtendedInput = z.infer<typeof createLabTestExtendedSchema>;
export type CreateLabOrderExtendedInput = z.infer<typeof createLabOrderExtendedSchema>;

// ─── Lab Notifications ──────────────────────────────────────────────────────

export const sendLabSmsSchema = z.object({
  message: z.string().min(1).optional(),
  templateId: z.number().int().positive().optional(),
});

export const sendLabEmailSchema = z.object({
  to: z.string().email().optional(),
  subject: z.string().optional(),
  includePdf: z.boolean().default(false),
});

export const labNotificationTemplateSchema = z.object({
  type: z.enum(['sms', 'email']),
  name: z.string().min(1),
  template: z.string().min(1),
  isActive: z.boolean().default(true),
});

// ─── Lab Barcode ────────────────────────────────────────────────────────────

export const generateBarcodeSchema = z.object({
  orderId: z.number().int().positive(),
  itemIds: z.array(z.number().int().positive()).optional(),
});

export type SendLabSmsInput = z.infer<typeof sendLabSmsSchema>;
export type SendLabEmailInput = z.infer<typeof sendLabEmailSchema>;
export type LabNotificationTemplateInput = z.infer<typeof labNotificationTemplateSchema>;
export type GenerateBarcodeInput = z.infer<typeof generateBarcodeSchema>;

// ─── Lab Validation Rules ───────────────────────────────────────────────────

export const createValidationRuleSchema = z.object({
  lab_test_id: z.number().int().positive().optional(),
  component_id: z.number().int().positive().optional(),
  rule_type: z.enum(['range', 'mandatory', 'dependency', 'delta']),
  rule_config: z.record(z.unknown()),
  error_message: z.string().min(1),
  is_blocking: z.boolean().default(true),
});

export const updateValidationRuleSchema = createValidationRuleSchema.partial();

export const validateResultSchema = z.object({
  lab_test_id: z.number().int().positive(),
  component_id: z.number().int().positive().optional(),
  result_value: z.string(),
  result_numeric: z.number().optional(),
  patient_id: z.number().int().positive().optional(),
});

export type RejectSampleInput = z.infer<typeof rejectSampleSchema>;
export type RecollectSampleInput = z.infer<typeof recollectSampleSchema>;
export type CancelLabItemInput = z.infer<typeof cancelLabItemSchema>;
export type CreateValidationRuleInput = z.infer<typeof createValidationRuleSchema>;
export type UpdateValidationRuleInput = z.infer<typeof updateValidationRuleSchema>;
export type ValidateResultInput = z.infer<typeof validateResultSchema>;
