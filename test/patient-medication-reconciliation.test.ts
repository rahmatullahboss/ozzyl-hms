import { describe, expect, it } from 'vitest';

import {
  buildReportedMedicationName,
  extractMedicationCandidatesFromPrescriptionText,
} from '../src/lib/patient-medication-reconciliation';

describe('patient medication reconciliation helpers', () => {
  it('builds a diary-friendly current medication name from reminder fields', () => {
    expect(buildReportedMedicationName('Napa', '500 mg')).toBe('Napa 500 mg');
    expect(buildReportedMedicationName('Seclo 20mg', '20 mg')).toBe('Seclo 20mg');
    expect(buildReportedMedicationName('Napa', '')).toBe('Napa');
  });

  it('extracts likely medicines from OCR text in a prescription document', () => {
    const rawText = `
      Rx
      1. Tab Napa 500 mg
      1+0+1 x 5 days

      2. Cap Seclo 20mg
      Before breakfast

      Advice:
      Drink more water
    `;

    expect(extractMedicationCandidatesFromPrescriptionText(rawText)).toEqual([
      'Napa 500 mg',
      'Seclo 20 mg',
    ]);
  });

  it('deduplicates repeated medicines and ignores non-medicine lines', () => {
    const rawText = `
      Tablet Napa 500mg
      Tablet Napa 500 mg
      BP: 120/80
      Follow up after 7 days
      Syrup Ace 5 ml
    `;

    expect(extractMedicationCandidatesFromPrescriptionText(rawText)).toEqual([
      'Napa 500 mg',
      'Ace 5 ml',
    ]);
  });
});
