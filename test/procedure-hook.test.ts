import { describe, expect, it, vi } from 'vitest';
import {
  buildOtConsumptionTriggerInput,
  buildProcedureConsumptionTriggerInput,
  shouldTriggerOtConsumptionOnStatus,
  triggerOtCompletionConsumption,
  triggerProcedureResultConsumption,
} from '../src/lib/inventory-consumption-clinical-hook';

describe('OT and procedure consumption hooks', () => {
  it('only triggers OT consumption when booking moves into completed once', () => {
    expect(shouldTriggerOtConsumptionOnStatus('in_progress', 'completed')).toBe(true);
    expect(shouldTriggerOtConsumptionOnStatus('completed', 'completed')).toBe(false);
    expect(shouldTriggerOtConsumptionOnStatus('scheduled', 'cancelled')).toBe(false);
  });

  it('builds OT completion trigger payloads', () => {
    expect(buildOtConsumptionTriggerInput({ tenantId: 't1', userId: 11, booking: { id: 80, patient_id: 5, visit_id: 6 }, remarks: 'Case closed' })).toEqual({ tenantId: 't1', userId: 11, triggerType: 'ot_procedure', triggerId: 80, patientId: 5, visitId: 6, otCaseId: 80, department: 'OT', remarks: 'Case closed' });
  });

  it('builds procedure result trigger payloads', () => {
    expect(buildProcedureConsumptionTriggerInput({ tenantId: 't1', userId: 12, order: { ProcedureOrderId: 30, PatientId: 5, EncounterId: 6 }, result: { ProcedureCode: 'DRESSING_SMALL', ProcedureName: 'Dressing Small' } })).toEqual({ tenantId: 't1', userId: 12, triggerType: 'procedure', triggerId: 30, triggerCode: 'DRESSING_SMALL', patientId: 5, visitId: 6, procedureId: 30, department: 'Procedure', remarks: 'Procedure completed: Dressing Small' });
  });

  it('delegates OT and procedure completion to the rule-driven trigger service', async () => {
    const db: any = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({ results: [] }), run: async () => ({ success: true, meta: { changes: 1 } }) }) }) };
    const trigger = vi.fn(async () => ({ summary: { matchedRules: 1, created: 1, existing: 0 }, events: [] }));
    await triggerOtCompletionConsumption(db, { tenantId: 't1', userId: 11, booking: { id: 80, patient_id: 5, visit_id: 6 }, remarks: 'done', triggerConsumption: trigger });
    await triggerProcedureResultConsumption(db, { tenantId: 't1', userId: 12, order: { ProcedureOrderId: 30, PatientId: 5, EncounterId: 6 }, result: { ProcedureCode: 'DRESSING_SMALL', ProcedureName: 'Dressing Small' }, triggerConsumption: trigger });
    expect(trigger).toHaveBeenCalledTimes(2);
    expect(trigger.mock.calls[0][1]).toMatchObject({ triggerType: 'ot_procedure', otCaseId: 80 });
    expect(trigger.mock.calls[1][1]).toMatchObject({ triggerType: 'procedure', procedureId: 30, triggerCode: 'DRESSING_SMALL' });
  });
});
