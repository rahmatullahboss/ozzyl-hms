import { describe, it, expect } from 'vitest';
import { evaluateMedicationSafety, normalizeMedicationName, type PatientContext } from '../src/lib/drug-safety';

// ═══════════════════════════════════════════════════════════════════════════════
// Drug-Condition Contraindication Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Drug-Condition Contraindications', () => {
  const baseInput = {
    activeMedications: [],
    allergies: [],
    interactionPairs: [],
    formularyByDrug: {},
  };

  it('should flag NSAID in heart failure patient', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Ibuprofen 400mg', generic_name: 'ibuprofen' }],
      patientContext: { diagnoses: ['Heart Failure', 'Hypertension'] },
    });

    expect(result.safe).toBe(false);
    const finding = result.findings.find(f => f.type === 'drug_condition');
    expect(finding).toBeDefined();
    expect(finding!.title).toContain('NSAID in Heart Failure');
    expect(finding!.blocking).toBe(true);
  });

  it('should flag ACE inhibitor in pregnancy', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Enalapril 5mg', generic_name: 'enalapril' }],
      patientContext: { is_pregnant: true },
    });

    expect(result.has_contraindicated).toBe(true);
    const finding = result.findings.find(f => f.title.includes('ACE Inhibitor in Pregnancy'));
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('contraindicated');
  });

  it('should flag ARB in pregnancy', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Losartan 50mg', generic_name: 'losartan' }],
      patientContext: { is_pregnant: true },
    });

    expect(result.has_contraindicated).toBe(true);
  });

  it('should flag statin in pregnancy', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Atorvastatin 20mg', generic_name: 'atorvastatin' }],
      patientContext: { is_pregnant: true },
    });

    const finding = result.findings.find(f => f.title.includes('Statin in Pregnancy'));
    expect(finding).toBeDefined();
  });

  it('should flag metformin in severe renal impairment', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Metformin 500mg', generic_name: 'metformin' }],
      patientContext: { diagnoses: ['CKD Stage 5', 'Diabetes'] },
    });

    const finding = result.findings.find(f => f.title.includes('Metformin'));
    expect(finding).toBeDefined();
  });

  it('should flag beta-blocker in asthma', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Propranolol 40mg', generic_name: 'propranolol' }],
      patientContext: { diagnoses: ['Bronchial Asthma'] },
    });

    const finding = result.findings.find(f => f.title.includes('Beta-Blocker in Asthma'));
    expect(finding).toBeDefined();
    expect(finding!.blocking).toBe(true);
  });

  it('should flag NSAID with peptic ulcer history', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Diclofenac 50mg', generic_name: 'diclofenac' }],
      patientContext: { diagnoses: ['Peptic Ulcer'] },
    });

    const finding = result.findings.find(f => f.title.includes('Peptic Ulcer'));
    expect(finding).toBeDefined();
  });

  it('should NOT flag when no matching condition', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Ibuprofen 400mg', generic_name: 'ibuprofen' }],
      patientContext: { diagnoses: ['Diabetes'] },
    });

    const conditionFindings = result.findings.filter(f => f.type === 'drug_condition');
    expect(conditionFindings).toHaveLength(0);
  });

  it('should NOT flag when no patient context', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Ibuprofen', generic_name: 'ibuprofen' }],
    });

    expect(result.findings.filter(f => f.type === 'drug_condition')).toHaveLength(0);
  });

  it('should match ICD codes in diagnoses', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Enalapril', generic_name: 'enalapril' }],
      patientContext: { diagnoses: ['Z33 — Pregnant state'] },
    });

    const finding = result.findings.find(f => f.title.includes('ACE Inhibitor'));
    expect(finding).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Patient-Adjusted Dosing Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Patient-Adjusted Dosing', () => {
  const baseInput = {
    activeMedications: [],
    allergies: [],
    interactionPairs: [],
    formularyByDrug: {},
  };

  it('should flag renal dose adjustment for low eGFR', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Gabapentin 300mg', generic_name: 'gabapentin', dose_mg: 300, frequency_per_day: 3 }],
      patientContext: { egfr: 25 },
    });

    const finding = result.findings.find(f => f.type === 'dose_adjustment' && f.title.includes('Renal'));
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
    expect(finding!.blocking).toBe(true);
  });

  it('should flag moderate renal adjustment for eGFR 30-60', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Metformin 500mg', generic_name: 'metformin', dose_mg: 500, frequency_per_day: 2 }],
      patientContext: { egfr: 45 },
    });

    const finding = result.findings.find(f => f.type === 'dose_adjustment' && f.title.includes('Renal'));
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('warning');
  });

  it('should NOT flag renal adjustment for normal eGFR', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Metformin', generic_name: 'metformin', dose_mg: 500, frequency_per_day: 2 }],
      patientContext: { egfr: 90 },
    });

    expect(result.findings.filter(f => f.type === 'dose_adjustment')).toHaveLength(0);
  });

  it('should flag hepatic dose adjustment for Child-Pugh C', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Paracetamol 1000mg', generic_name: 'paracetamol', dose_mg: 1000, frequency_per_day: 4 }],
      patientContext: { child_pugh_score: 'C' },
    });

    const finding = result.findings.find(f => f.type === 'dose_adjustment' && f.title.includes('Hepatic'));
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('critical');
  });

  it('should NOT flag hepatic for Child-Pugh A', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Paracetamol', generic_name: 'paracetamol', dose_mg: 500, frequency_per_day: 3 }],
      patientContext: { child_pugh_score: 'A' },
    });

    expect(result.findings.filter(f => f.title.includes('Hepatic'))).toHaveLength(0);
  });

  it('should flag Beers criteria drugs in elderly', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Diazepam 5mg', generic_name: 'diazepam' }],
      patientContext: { age_years: 72 },
    });

    const finding = result.findings.find(f => f.title.includes('Beers Criteria'));
    expect(finding).toBeDefined();
    expect(finding!.description).toContain('72 years');
  });

  it('should NOT flag Beers for young patient', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Diazepam', generic_name: 'diazepam' }],
      patientContext: { age_years: 30 },
    });

    expect(result.findings.filter(f => f.title.includes('Beers'))).toHaveLength(0);
  });

  it('should flag excessive pediatric dose', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Amoxicillin', generic_name: 'amoxicillin', dose_mg: 500, frequency_per_day: 4 }],
      patientContext: { age_years: 5, weight_kg: 15 },
    });

    const finding = result.findings.find(f => f.type === 'dose_adjustment' && f.title.includes('Pediatric'));
    expect(finding).toBeDefined();
    expect(finding!.blocking).toBe(true);
  });

  it('should combine drug-condition + dose adjustment for same drug', () => {
    const result = evaluateMedicationSafety({
      ...baseInput,
      newItems: [{ medication_name: 'Metformin 500mg', generic_name: 'metformin', dose_mg: 500, frequency_per_day: 2 }],
      patientContext: {
        egfr: 25,
        diagnoses: ['CKD Stage 5'],
      },
    });

    const conditionFinding = result.findings.find(f => f.type === 'drug_condition');
    const doseFinding = result.findings.find(f => f.type === 'dose_adjustment');
    expect(conditionFinding).toBeDefined();
    expect(doseFinding).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Existing CDS Still Works (Regression Tests)
// ═══════════════════════════════════════════════════════════════════════════════

describe('Existing CDS — Regression', () => {
  it('should still detect drug-drug interactions', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Fluoxetine 20mg', generic_name: 'fluoxetine' }],
      activeMedications: [{ medication_name: 'Tramadol 50mg', generic_name: 'tramadol', status: 'active' }],
      allergies: [],
      interactionPairs: [{ drug_a_name: 'fluoxetine', drug_b_name: 'tramadol', severity: 'major', description: 'Serotonin syndrome risk' }],
      formularyByDrug: {},
    });

    expect(result.has_blocking).toBe(true);
    expect(result.findings[0].type).toBe('drug_interaction');
  });

  it('should still detect allergy contraindications with cross-reactivity', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Amoxicillin 500mg', generic_name: 'amoxicillin' }],
      activeMedications: [],
      allergies: [{ allergen: 'Penicillin', severity: 'severe' }],
      interactionPairs: [],
      formularyByDrug: {},
    });

    expect(result.has_contraindicated).toBe(true);
    const finding = result.findings.find(f => f.type === 'allergy_contraindication');
    expect(finding).toBeDefined();
  });

  it('should still detect duplicate therapy', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Omeprazole 20mg', generic_name: 'omeprazole' }],
      activeMedications: [{ medication_name: 'Omeprazole 40mg', generic_name: 'omeprazole', status: 'active' }],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: {},
    });

    const finding = result.findings.find(f => f.type === 'duplicate_therapy');
    expect(finding).toBeDefined();
  });

  it('should still detect max dose exceeded', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Paracetamol', generic_name: 'paracetamol', dose_mg: 1000, frequency_per_day: 6 }],
      activeMedications: [],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: { paracetamol: { name: 'Paracetamol', generic_name: 'paracetamol', max_daily_dose_mg: 4000 } },
    });

    const finding = result.findings.find(f => f.type === 'max_dose');
    expect(finding).toBeDefined();
    expect(finding!.description).toContain('6000mg/day');
  });

  it('should still detect washout interaction', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Sertraline', generic_name: 'sertraline' }],
      activeMedications: [],
      recentlyStoppedMedications: [{ medication_name: 'Phenelzine', generic_name: 'phenelzine', status: 'discontinued', stop_date: threeDaysAgo }],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: {},
    });

    const finding = result.findings.find(f => f.type === 'washout_interaction');
    expect(finding).toBeDefined();
    expect(finding!.severity).toBe('contraindicated');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Edge Cases
// ═══════════════════════════════════════════════════════════════════════════════

describe('CDS Edge Cases', () => {
  it('should handle empty patient context gracefully', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Paracetamol', generic_name: 'paracetamol' }],
      activeMedications: [],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: {},
      patientContext: {},
    });

    expect(result.safe).toBe(true);
  });

  it('should handle undefined patientContext', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Ibuprofen', generic_name: 'ibuprofen' }],
      activeMedications: [],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: {},
    });

    expect(result.safe).toBe(true);
  });

  it('should handle multiple findings for same drug', () => {
    const result = evaluateMedicationSafety({
      newItems: [{ medication_name: 'Ibuprofen', generic_name: 'ibuprofen', dose_mg: 400, frequency_per_day: 3 }],
      activeMedications: [],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: {},
      patientContext: {
        diagnoses: ['Heart Failure', 'Peptic Ulcer', 'Chronic Kidney Disease'],
        egfr: 40,
        age_years: 70,
      },
    });

    // Should have multiple drug-condition findings (HF + PU + CKD)
    const conditionFindings = result.findings.filter(f => f.type === 'drug_condition');
    expect(conditionFindings.length).toBeGreaterThanOrEqual(3);
  });

  it('should sort findings by severity (contraindicated first)', () => {
    const result = evaluateMedicationSafety({
      newItems: [
        { medication_name: 'Enalapril', generic_name: 'enalapril' },
        { medication_name: 'Ibuprofen', generic_name: 'ibuprofen' },
      ],
      activeMedications: [],
      allergies: [],
      interactionPairs: [],
      formularyByDrug: {},
      patientContext: {
        is_pregnant: true,
        diagnoses: ['Heart Failure'],
      },
    });

    if (result.findings.length >= 2) {
      const severityOrder = ['contraindicated', 'critical', 'warning', 'info'];
      const idx0 = severityOrder.indexOf(result.findings[0].severity);
      const idx1 = severityOrder.indexOf(result.findings[1].severity);
      expect(idx0).toBeLessThanOrEqual(idx1);
    }
  });
});
