import { describe, expect, it } from 'vitest';
import type { QueueItem } from './types';
import { buildMedicationSafetyPayload, buildPatientSafetyContext, parseDoseMg, parseFrequencyPerDay } from './doctorPrescriptionSafety';

describe('doctorPrescriptionSafety helpers', () => {
  it('parses common dose units into milligrams', () => {
    expect(parseDoseMg('500mg')).toBe(500);
    expect(parseDoseMg('0.5 g')).toBe(500);
    expect(parseDoseMg('250 mcg')).toBe(0.25);
    expect(parseDoseMg('5 ml')).toBeUndefined();
  });

  it('parses common doctor frequency shortcuts', () => {
    expect(parseFrequencyPerDay('1+1+1')).toBe(3);
    expect(parseFrequencyPerDay('BD')).toBe(2);
    expect(parseFrequencyPerDay('TDS')).toBe(3);
    expect(parseFrequencyPerDay('SOS')).toBeUndefined();
  });

  it('builds medication and patient context payloads for safety checks', () => {
    const medications = buildMedicationSafetyPayload([
      { medicine_name: ' Metformin ', dosage: '500mg', frequency: 'BD' },
      { medicine_name: '', dosage: '10mg', frequency: 'OD' },
    ]);

    expect(medications).toEqual([
      { medication_name: 'Metformin', dose_mg: 500, frequency_per_day: 2 },
    ]);

    const context = buildPatientSafetyContext({
      patient_age: '62 years',
      gender: 'Female',
      last_diagnosis: 'Type 2 Diabetes Mellitus',
      medical_snapshot: {
        age: null,
        chronicConditions: ['Chronic Kidney Disease'],
        bloodGroup: null,
        allergies: [],
        lastVisitDate: null,
        lastDiagnosis: null,
        lastHbA1c: null,
        currentVitals: null,
      },
    } as QueueItem);

    expect(context).toMatchObject({
      age_years: 62,
      sex: 'F',
      diagnoses: ['Chronic Kidney Disease', 'Type 2 Diabetes Mellitus'],
    });
  });
});
