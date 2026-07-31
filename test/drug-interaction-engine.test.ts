import { describe, expect, it } from 'vitest';
import {
  buildInteractionPairKey,
  evaluateMedicationSafety,
  normalizeMedicationName,
} from '../src/lib/drug-safety';

describe('drug interaction engine', () => {
  it('matches interaction pairs bidirectionally and blocks major findings', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Aspirin', generic_name: 'aspirin' }],
      activeMedications: [{ medication_name: 'Warfarin', generic_name: 'warfarin', status: 'active' }],
      allergies: [],
      interactionPairs: [{
        drug_a_name: 'warfarin',
        drug_b_name: 'aspirin',
        severity: 'major',
        description: 'Bleeding risk',
        recommendation: 'Avoid combination',
      }],
      formularyByDrug: {},
    });

    expect(result.has_blocking).toBe(true);
    expect(result.findings[0]).toMatchObject({
      type: 'drug_interaction',
      blocking: true,
      severity: 'critical',
      related_medication: 'Warfarin',
    });
  });

  it('checks same-order items and duplicate therapy', () => {
    const result = evaluateMedicationSafety({
      newItems: [
        { medication_name: 'Ibuprofen', generic_name: 'ibuprofen' },
        { medication_name: 'Warfarin', generic_name: 'warfarin' },
        { medication_name: 'Metformin XR', generic_name: 'metformin' },
      ],
      activeMedications: [{ medication_name: 'Metformin', generic_name: 'metformin', status: 'active' }],
      allergies: [],
      interactionPairs: [{
        drug_a_name: 'warfarin',
        drug_b_name: 'ibuprofen',
        severity: 'moderate',
        description: 'Bleeding risk',
        recommendation: 'Monitor',
      }],
      formularyByDrug: {},
    });

    expect(result.findings.some((item) => item.type === 'drug_interaction')).toBe(true);
    expect(result.findings.some((item) => item.type === 'duplicate_therapy')).toBe(true);
  });

  it('maps allergy and max-dose findings into blocking and warning buckets', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Amoxicillin', generic_name: 'amoxicillin', dose_mg: 2000, frequency_per_day: 3 }],
      activeMedications: [],
      allergies: [{ allergen: 'Penicillin', severity: 'severe' }],
      interactionPairs: [],
      formularyByDrug: {
        amoxicillin: { name: 'Amoxicillin', generic_name: 'Amoxicillin', max_daily_dose_mg: 4000 },
      },
    });

    expect(result.findings.some((item) => item.type === 'allergy_contraindication' && item.blocking)).toBe(true);
    expect(result.findings.some((item) => item.type === 'max_dose')).toBe(true);
  });

  it('normalizes medication names consistently', () => {
    expect(normalizeMedicationName('Metformin 500mg Tablet')).toBe('metformin tablet');
    expect(buildInteractionPairKey('Warfarin', ' aspirin ')).toBe('aspirin::warfarin');
  });

  it('blocks when a MAOI-family medication was recently stopped within the washout window', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Sertraline', generic_name: 'sertraline' }],
      activeMedications: [],
      recentlyStoppedMedications: [{
        medication_name: 'Phenelzine',
        generic_name: 'phenelzine',
        status: 'discontinued',
        stop_date: new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString(),
      }],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: {},
    });

    expect(result.has_blocking).toBe(true);
    expect(result.findings.some((item) => item.type === 'washout_interaction' && item.blocking)).toBe(true);
  });

  it('does not alert when the washout window has elapsed', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Sertraline', generic_name: 'sertraline' }],
      activeMedications: [],
      recentlyStoppedMedications: [{
        medication_name: 'Phenelzine',
        generic_name: 'phenelzine',
        status: 'discontinued',
        stop_date: new Date(Date.now() - (20 * 24 * 60 * 60 * 1000)).toISOString(),
      }],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: {},
    });

    expect(result.findings.some((item) => item.type === 'washout_interaction')).toBe(false);
  });

  it('blocks MAOI-family prescribing shortly after fluoxetine discontinuation', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Linezolid', generic_name: 'linezolid' }],
      activeMedications: [],
      recentlyStoppedMedications: [{
        medication_name: 'Fluoxetine',
        generic_name: 'fluoxetine',
        status: 'completed',
        stop_date: new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString(),
      }],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: {},
    });

    expect(result.has_blocking).toBe(true);
    expect(result.findings.some((item) => item.type === 'washout_interaction' && item.related_medication === 'Fluoxetine')).toBe(true);
  });
});
