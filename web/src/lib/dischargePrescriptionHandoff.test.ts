import { describe, expect, it } from 'vitest';
import { buildDischargePrescriptionHandoff } from './dischargePrescriptionHandoff';

describe('buildDischargePrescriptionHandoff', () => {
  it('uses modified dose, frequency and route when creating prescription items', () => {
    const handoff = buildDischargePrescriptionHandoff({
      id: 71,
      patient_id: 10,
      reconciliation_type: 'discharge',
      status: 'completed',
      items: [{
        id: 1,
        medication_name: 'Amlodipine',
        dose: '5 mg',
        frequency: 'once daily',
        route: 'oral',
        action: 'modify',
        action_reason: 'Blood pressure remains elevated',
        new_dose: '10 mg',
        new_frequency: 'once daily',
        new_route: 'oral',
      }],
    }, 10);

    expect(handoff.items).toEqual([{
      medicine_name: 'Amlodipine',
      dosage: '10 mg',
      frequency: 'once daily',
      duration: '',
      instructions: 'Route: oral · Reconciliation: Blood pressure remains elevated',
    }]);
  });

  it('excludes discontinued medicines and lists them in discharge advice', () => {
    const handoff = buildDischargePrescriptionHandoff({
      id: 71,
      patientId: 10,
      reconciliationType: 'discharge',
      status: 'completed',
      items: [
        { medicationName: 'Ceftriaxone', action: 'discontinue', actionReason: 'Course completed' },
        { medicationName: 'Paracetamol', dose: '500 mg', frequency: 'SOS', action: 'continue' },
      ],
    }, 10);

    expect(handoff.items.map((item) => item.medicine_name)).toEqual(['Paracetamol']);
    expect(handoff.stoppedMedications).toEqual([{ name: 'Ceftriaxone', reason: 'Course completed' }]);
    expect(handoff.advice).toContain('Ceftriaxone — Course completed');
  });

  it('rejects a reconciliation for another patient', () => {
    expect(() => buildDischargePrescriptionHandoff({
      id: 71,
      patient_id: 99,
      reconciliation_type: 'discharge',
      status: 'completed',
      items: [],
    }, 10)).toThrow(/does not belong/i);
  });

  it('rejects an incomplete or non-discharge reconciliation', () => {
    expect(() => buildDischargePrescriptionHandoff({
      id: 71,
      patient_id: 10,
      reconciliation_type: 'admission',
      status: 'in_progress',
      items: [],
    }, 10)).toThrow(/completed discharge/i);
  });
});
