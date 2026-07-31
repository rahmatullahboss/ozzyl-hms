import { describe, expect, it } from 'vitest';
import { filterSummaryByClinicalAreas } from '../src/lib/consent-helpers';
import type { PortableHealthSummary } from '../src/lib/health-summary';

const provenance = {
  source: 'clinician',
  verified: true,
  review_status: 'verified' as const,
  recorded_at: null,
  recorded_by_user_id: null,
  reviewed_at: null,
  reviewed_by_user_id: null,
  review_notes: null,
  verified_at: null,
  verified_by_user_id: null,
};

const baseSummary: PortableHealthSummary = {
  provenance: { generated_at: '2026-04-10T00:00:00Z', model: 'normalized' },
  uhid: 'OZ-000050',
  patient: { name: 'Patient One', age: 34, gender: 'female', blood_group: 'B+', date_of_birth: '1992-01-01' },
  hospital: { name: 'Tenant Hospital', generated_at: '2026-04-10T00:00:00Z', consent_mode: 'view_full' },
  allergies: [{ allergen: 'Penicillin', allergy_type: 'drug', severity: 'moderate', reaction: 'Rash', provenance }],
  active_problems: [{ description: 'Asthma', icd10_code: 'J45', severity: 'moderate', status: 'active', onset_date: null }],
  current_medications: [{ medication_name: 'Napa', generic_name: 'Paracetamol', dosage: '500mg', frequency: 'TDS', duration: '5 days', instructions: null, status: 'active', provenance }],
  recent_diagnoses: [{ icd10_code: 'I10', icd11_code: null, description: 'Hypertension', diagnosis_type: 'final', created_at: '2026-04-09T10:00:00Z', provenance }],
  last_vitals: { recorded_at: '2026-04-09T09:00:00Z', temperature: 98.6, pulse: 72, systolic: 120, diastolic: 80, respiratory_rate: 16, spo2: 99, weight: 70, height: 170, bmi: 24.2, blood_sugar: 100, provenance: { ...provenance, source: 'recorded' } },
  vaccinations: [{ vaccine_name: 'Td', vaccine_code: null, dose_number: 1, total_doses: null, administered_date: '2024-01-01', status: 'completed', next_dose_date: null }],
  recent_lab_results: [{ test_name: 'CBC', result: 'Normal', abnormal_flag: null, unit: null, normal_range: null, completed_at: '2026-04-08T12:00:00Z' }],
  last_discharge: null,
};

describe('filterSummaryByClinicalAreas', () => {
  it('returns the full summary when consent areas are null', () => {
    expect(filterSummaryByClinicalAreas(baseSummary, null).recent_lab_results).toHaveLength(1);
    expect(filterSummaryByClinicalAreas(baseSummary, null).allergies).toHaveLength(1);
  });

  it('keeps only consented sections', () => {
    const filtered = filterSummaryByClinicalAreas(baseSummary, ['labs', 'vitals']);
    expect(filtered.recent_lab_results).toHaveLength(1);
    expect(filtered.last_vitals).not.toBeNull();
    expect(filtered.current_medications).toHaveLength(0);
    expect(filtered.recent_diagnoses).toHaveLength(0);
    expect(filtered.vaccinations).toHaveLength(0);
  });

  it('always preserves life-threatening allergies', () => {
    const filtered = filterSummaryByClinicalAreas({
      ...baseSummary,
      allergies: [{ ...baseSummary.allergies[0], severity: 'life_threatening' }],
    }, ['labs']);

    expect(filtered.allergies).toHaveLength(1);
    expect(filtered.allergies[0].severity).toBe('life_threatening');
  });
});
