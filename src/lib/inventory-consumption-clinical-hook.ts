import type { ConsumptionRuleDb } from './inventory-consumption-rules';
import { triggerInventoryConsumptionFromWorkflow, type ConsumptionTriggerInput } from './inventory-consumption-triggering';

export type OtCompletionBooking = {
  id: number;
  patient_id: number;
  visit_id?: number | null;
};

export type ProcedureCompletionOrder = {
  ProcedureOrderId: number;
  PatientId: number;
  EncounterId?: number | null;
};

export type ProcedureCompletionResult = {
  ProcedureCode: string;
  ProcedureName?: string | null;
};

function normalizeUserId(value: number | string | null | undefined): number | null {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function shouldTriggerOtConsumptionOnStatus(fromStatus?: string | null, toStatus?: string | null): boolean {
  return String(toStatus || '').toLowerCase() === 'completed' && String(fromStatus || '').toLowerCase() !== 'completed';
}

export function buildOtConsumptionTriggerInput(input: {
  tenantId: string;
  userId?: number | string | null;
  booking: OtCompletionBooking;
  remarks?: string | null;
}): ConsumptionTriggerInput {
  return {
    tenantId: input.tenantId,
    userId: normalizeUserId(input.userId),
    triggerType: 'ot_procedure',
    triggerId: Number(input.booking.id),
    patientId: Number(input.booking.patient_id),
    visitId: input.booking.visit_id ?? null,
    otCaseId: Number(input.booking.id),
    department: 'OT',
    remarks: input.remarks || `OT completed: ${input.booking.id}`,
  };
}

export function buildProcedureConsumptionTriggerInput(input: {
  tenantId: string;
  userId?: number | string | null;
  order: ProcedureCompletionOrder;
  result: ProcedureCompletionResult;
}): ConsumptionTriggerInput {
  const procedureName = input.result.ProcedureName || input.result.ProcedureCode;
  return {
    tenantId: input.tenantId,
    userId: normalizeUserId(input.userId),
    triggerType: 'procedure',
    triggerId: Number(input.order.ProcedureOrderId),
    triggerCode: input.result.ProcedureCode,
    patientId: Number(input.order.PatientId),
    visitId: input.order.EncounterId ?? null,
    procedureId: Number(input.order.ProcedureOrderId),
    department: 'Procedure',
    remarks: `Procedure completed: ${procedureName}`,
  };
}

export async function triggerOtCompletionConsumption(db: ConsumptionRuleDb, input: {
  tenantId: string;
  userId?: number | string | null;
  booking: OtCompletionBooking;
  remarks?: string | null;
  triggerConsumption?: (db: ConsumptionRuleDb, trigger: ConsumptionTriggerInput) => Promise<unknown>;
}): Promise<unknown> {
  const trigger = input.triggerConsumption ?? triggerInventoryConsumptionFromWorkflow;
  return trigger(db, buildOtConsumptionTriggerInput(input));
}

export async function triggerProcedureResultConsumption(db: ConsumptionRuleDb, input: {
  tenantId: string;
  userId?: number | string | null;
  order: ProcedureCompletionOrder;
  result: ProcedureCompletionResult;
  triggerConsumption?: (db: ConsumptionRuleDb, trigger: ConsumptionTriggerInput) => Promise<unknown>;
}): Promise<unknown> {
  const trigger = input.triggerConsumption ?? triggerInventoryConsumptionFromWorkflow;
  return trigger(db, buildProcedureConsumptionTriggerInput(input));
}
