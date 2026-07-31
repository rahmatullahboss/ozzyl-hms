import { describe, it, expect } from 'vitest';
import { enforcePrescriptionDrugSafety } from '../src/lib/prescription-safety';
import { createMockDB } from './integration/helpers/mock-db';

function wrapDB(mockDB: ReturnType<typeof createMockDB>) {
  return { $client: mockDB.db } as any;
}

describe('enforcePrescriptionDrugSafety', () => {
  it('returns without error for empty items array', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, []),
    ).resolves.toBeUndefined();
  });

  it('returns without error when all items have empty medicine_name', async () => {
    const mockDB = createMockDB({ universalFallback: true });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, [
        { medicine_name: '' },
        { medicine_name: null },
        { medicine_name: '   ' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('blocks when drug conflicts with severe allergy', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from patient_allergies')) {
          return {
            results: [
              {
                allergen: 'Penicillin',
                severity: 'severe',
              },
            ],
          };
        }
        return null;
      },
      universalFallback: true,
    });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, [
        { medicine_name: 'Amoxicillin 500mg' },
      ]),
    ).rejects.toThrow('Prescription blocked');
  });

  it('allows safe prescription when no conflicts', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from patient_allergies')) {
          return { results: [] };
        }
        if (lower.includes('from patient_active_medications')) {
          return { results: [] };
        }
        if (lower.includes('from drug_interaction_pairs')) {
          return { results: [] };
        }
        if (lower.includes('from formulary_items')) {
          return { results: [] };
        }
        return null;
      },
    });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, [
        { medicine_name: 'Paracetamol 500mg' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('blocks when drug interaction detected', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from patient_active_medications') && lower.includes("status = 'active'")) {
          return {
            results: [
              {
                medication_name: 'Warfarin',
                generic_name: 'warfarin',
                status: 'active',
              },
            ],
          };
        }

        if (lower.includes('from patient_active_medications') && lower.includes("'discontinued'")) {
          return { results: [] };
        }

        if (lower.includes('from patient_allergies')) {
          return { results: [] };
        }

        if (lower.includes('from drug_interaction_pairs')) {
          return {
            results: [
              {
                drug_a_name: 'Aspirin',
                drug_b_name: 'Warfarin',
                severity: 'major',
                description: 'Increased risk of bleeding when combined.',
                recommendation: 'Monitor INR closely.',
              },
            ],
          };
        }

        if (lower.includes('from formulary_items')) {
          return { results: [] };
        }

        return null;
      },
    });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, [
        { medicine_name: 'Aspirin 100mg' },
      ]),
    ).rejects.toThrow('Prescription blocked');
  });

  it('allows when no blocking findings', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from patient_active_medications') && lower.includes("status = 'active'")) {
          return {
            results: [
              {
                medication_name: 'Metformin',
                generic_name: 'metformin',
                status: 'active',
              },
            ],
          };
        }

        if (lower.includes('from patient_active_medications') && lower.includes("'discontinued'")) {
          return { results: [] };
        }

        if (lower.includes('from patient_allergies')) {
          return { results: [] };
        }

        if (lower.includes('from drug_interaction_pairs')) {
          return {
            results: [
              {
                drug_a_name: 'Paracetamol',
                drug_b_name: 'Metformin',
                severity: 'minor',
                description: 'Minor interaction noted.',
                recommendation: 'No action needed.',
              },
            ],
          };
        }

        if (lower.includes('from formulary_items')) {
          return { results: [] };
        }

        return null;
      },
    });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, [
        { medicine_name: 'Paracetamol 500mg' },
      ]),
    ).resolves.toBeUndefined();
  });

  it('allows a blocking finding when a matching safety override was recorded', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from patient_active_medications') && lower.includes("status = 'active'")) {
          return { results: [{ medication_name: 'Warfarin', generic_name: 'warfarin', status: 'active' }] };
        }
        if (lower.includes('from patient_active_medications') && lower.includes("'discontinued'")) {
          return { results: [] };
        }
        if (lower.includes('from patient_allergies')) {
          return { results: [] };
        }
        if (lower.includes('from drug_interaction_pairs')) {
          return {
            results: [{
              drug_a_name: 'Aspirin',
              drug_b_name: 'Warfarin',
              severity: 'major',
              description: 'Increased bleeding risk.',
              recommendation: 'Avoid combination.',
            }],
          };
        }
        if (lower.includes('from formulary_items')) {
          return { results: [] };
        }
        if (lower.includes('from prescription_safety_checks')) {
          return {
            first: {
              id: 77,
              medication_name: 'Aspirin 100mg',
              warnings_json: JSON.stringify({ medications: [{ medication_name: 'Aspirin 100mg' }] }),
              override_reason: 'Benefit outweighs risk; INR monitoring planned',
            },
          };
        }

        return null;
      },
    });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, [
        { medicine_name: 'Aspirin 100mg' },
      ], {
        safetyCheckId: 77,
        safetyOverrideReason: 'Benefit outweighs risk; INR monitoring planned',
      }),
    ).resolves.toBeUndefined();
  });

  it('still blocks when the recorded override does not match the current medicines', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from patient_active_medications') && lower.includes("status = 'active'")) {
          return { results: [{ medication_name: 'Warfarin', generic_name: 'warfarin', status: 'active' }] };
        }
        if (lower.includes('from patient_active_medications') && lower.includes("'discontinued'")) {
          return { results: [] };
        }
        if (lower.includes('from patient_allergies')) {
          return { results: [] };
        }
        if (lower.includes('from drug_interaction_pairs')) {
          return {
            results: [{
              drug_a_name: 'Aspirin',
              drug_b_name: 'Warfarin',
              severity: 'major',
              description: 'Increased bleeding risk.',
              recommendation: 'Avoid combination.',
            }],
          };
        }
        if (lower.includes('from formulary_items')) {
          return { results: [] };
        }
        if (lower.includes('from prescription_safety_checks')) {
          return {
            first: {
              id: 77,
              medication_name: 'Ibuprofen 400mg',
              warnings_json: JSON.stringify({ medications: [{ medication_name: 'Ibuprofen 400mg' }] }),
              override_reason: 'Benefit outweighs risk; monitoring planned',
            },
          };
        }

        return null;
      },
    });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, [
        { medicine_name: 'Aspirin 100mg' },
      ], {
        safetyCheckId: 77,
        safetyOverrideReason: 'Benefit outweighs risk; monitoring planned',
      }),
    ).rejects.toThrow('Prescription blocked');
  });

  it('blocks when parsed dose and frequency exceed the configured max daily dose', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from patients')) {
          return { first: { age: 35, gender: 'Male', date_of_birth: null } };
        }
        if (lower.includes('from patient_problems')) {
          return { results: [] };
        }
        if (lower.includes('from patient_active_medications')) {
          return { results: [] };
        }
        if (lower.includes('from patient_allergies')) {
          return { results: [] };
        }
        if (lower.includes('from drug_interaction_pairs')) {
          return { results: [] };
        }
        if (lower.includes('from formulary_items')) {
          return {
            results: [{ name: 'Paracetamol', generic_name: 'Paracetamol', max_daily_dose_mg: 3000 }],
          };
        }

        return null;
      },
    });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, [
        { medicine_name: 'Paracetamol', dosage: '1000mg', frequency: '2+2+2' },
      ]),
    ).rejects.toThrow('Prescription blocked');
  });

  it('blocks drug-condition contraindications using patient problem context', async () => {
    const mockDB = createMockDB({
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();

        if (lower.includes('from patients')) {
          return { first: { age: 62, gender: 'Female', date_of_birth: null } };
        }
        if (lower.includes('from patient_problems')) {
          return { results: [{ problem_name: 'Chronic Kidney Disease', status: 'active' }] };
        }
        if (lower.includes('from patient_active_medications')) {
          return { results: [] };
        }
        if (lower.includes('from patient_allergies')) {
          return { results: [] };
        }
        if (lower.includes('from drug_interaction_pairs')) {
          return { results: [] };
        }
        if (lower.includes('from formulary_items')) {
          return { results: [] };
        }

        return null;
      },
    });
    const db = wrapDB(mockDB);

    await expect(
      enforcePrescriptionDrugSafety(db, 'tenant-1', 1, [
        { medicine_name: 'Metformin', dosage: '500mg', frequency: 'BD' },
      ]),
    ).rejects.toThrow('Prescription blocked');
  });

});
