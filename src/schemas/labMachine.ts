import { z } from 'zod';
import {
  LAB_MACHINE_CONNECTION_TYPES,
  LAB_MACHINE_PROTOCOLS,
  LAB_MACHINE_TYPES,
} from '../lib/lab-machine-capabilities';

// ─── Lab Machine CRUD ───────────────────────────────────────────────────────

export const createLabMachineSchema = z.object({
  machine_name: z.string().min(1).max(200),
  machine_code: z.string().min(1).max(50),
  machine_type: z.enum(LAB_MACHINE_TYPES).optional(),
  manufacturer: z.string().max(100).optional(),
  model_number: z.string().max(100).optional(),
  serial_number: z.string().max(100).optional(),
  protocol: z.enum(LAB_MACHINE_PROTOCOLS).default('astm'),
  connection_type: z.enum(LAB_MACHINE_CONNECTION_TYPES).default('tcp'),
  host_address: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  baud_rate: z.number().int().optional(),
  is_bidirectional: z.boolean().default(false),
});

export const updateLabMachineSchema = createLabMachineSchema.partial();

// ─── Machine Test Mapping ───────────────────────────────────────────────────

export const qualitativeMapSchema = z.record(z.string().min(1), z.string().min(1).max(200)).optional();

export const createMachineTestMapSchema = z.object({
  lab_test_id: z.number().int().positive(),
  component_id: z.number().int().positive().optional(),
  machine_test_code: z.string().min(1).max(100),
  machine_test_name: z.string().max(200).optional(),
  machine_unit: z.string().max(50).optional(),
  conversion_factor: z.number().positive().default(1.0),
  qualitative_map: qualitativeMapSchema,
});

export const updateMachineTestMapSchema = createMachineTestMapSchema.partial();

export const bulkMachineTestMapSchema = z.object({
  mappings: z.array(createMachineTestMapSchema).min(1),
});

// ─── Machine Result Receive (enhanced from middleware) ──────────────────────

export const machineResultSchema = z.object({
  deviceId: z.string().optional(),       // machine_code
  machineId: z.number().int().optional(), // direct machine ID
  barcode: z.string().optional(),
  specimenId: z.string().optional(),
  orderNo: z.string().optional(),
  controlId: z.string().optional(),
  patientId: z.string().optional(),
  results: z.array(z.object({
    testCode: z.string().min(1),
    testName: z.string().optional(),
    value: z.string().min(1),
    units: z.string().optional(),
    referenceRange: z.string().optional(),
    abnormalFlag: z.string().optional(),
    resultStatus: z.string().optional(),   // F=final, P=preliminary, C=corrected
    comments: z.string().optional(),
    completedAt: z.string().optional(),
  })).min(1),
}).refine(data => data.barcode || data.orderNo || data.controlId || data.specimenId, {
  message: 'At least one identifier (barcode, orderNo, controlId, or specimenId) required',
});

// ─── Raw HL7 Message Receive ────────────────────────────────────────────────

export const hl7MessageReceiveSchema = z.object({
  machineId: z.number().int().optional(),
  machineCode: z.string().optional(),
  message: z.string().min(10, 'HL7 message too short'),
});

// ─── Raw ASTM Message Receive ───────────────────────────────────────────────

export const astmMessageReceiveSchema = z.object({
  machineId: z.number().int().optional(),
  machineCode: z.string().optional(),
  message: z.string().min(5, 'ASTM message too short'),
});

// ─── Bidirectional Order Sending ────────────────────────────────────────────

export const sendOrdersSchema = z.object({
  orderItemIds: z.array(z.number().int().positive()).optional(),
  protocol: z.enum(['hl7', 'astm']).optional(),
});

export const acknowledgeOrderSchema = z.object({
  machineOrderId: z.number().int().positive(),
});

// ─── Machine Downtime ───────────────────────────────────────────────────────

export const createDowntimeSchema = z.object({
  reason: z.string().min(1).max(200),
  description: z.string().max(500).optional(),
});

export const resolveDowntimeSchema = z.object({
  resolutionNotes: z.string().max(500).optional(),
});

// ─── Local LIS Bridge Agent Monitoring ──────────────────────────────────────

export const bridgeAgentHeartbeatSchema = z.object({
  agentCode: z.string().trim().min(1).max(80),
  agentName: z.string().trim().min(1).max(160).optional(),
  siteName: z.string().trim().max(160).optional(),
  hostFingerprint: z.string().trim().max(200).optional(),
  version: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'degraded', 'inactive']).default('active'),
  lastError: z.string().trim().max(1000).optional(),
  capabilities: z.record(z.unknown()).optional(),
});

export const resolveUnmatchedResultSchema = z.object({
  labOrderItemId: z.number().int().positive().optional(),
  notes: z.string().trim().max(1000).optional(),
  status: z.enum(['resolved', 'ignored']).default('resolved'),
});

// ─── Types ──────────────────────────────────────────────────────────────────

export type CreateLabMachineInput = z.infer<typeof createLabMachineSchema>;
export type MachineResultInput = z.infer<typeof machineResultSchema>;
export type HL7MessageReceiveInput = z.infer<typeof hl7MessageReceiveSchema>;
export type ASTMMessageReceiveInput = z.infer<typeof astmMessageReceiveSchema>;
export type SendOrdersInput = z.infer<typeof sendOrdersSchema>;
export type AcknowledgeOrderInput = z.infer<typeof acknowledgeOrderSchema>;
export type CreateDowntimeInput = z.infer<typeof createDowntimeSchema>;
export type ResolveDowntimeInput = z.infer<typeof resolveDowntimeSchema>;
export type BridgeAgentHeartbeatInput = z.infer<typeof bridgeAgentHeartbeatSchema>;
export type ResolveUnmatchedResultInput = z.infer<typeof resolveUnmatchedResultSchema>;
