import { describe, expect, test } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import { buildPortableHealthSummary } from '../src/lib/health-summary';

describe('portable health summary provenance', () => {
  test('exposes normalized provenance for allergies, medications, diagnoses, vitals, and labs', async () => {
    const mockDB = createMockDB({
      queryOverride(sql) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from patients where id = ? and tenant_id = ?')) {
          return {
            first: {
              name: 'Patient One',
              age: 34,
              gender: 'female',
              blood_group: 'B+',
              date_of_birth: '1992-01-01',
            },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('select name from tenants where id = ?')) {
          return {
            first: { name: 'Tenant Hospital' },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('select uhid from patients where id = ? and tenant_id = ?')) {
          return {
            first: { uhid: 'OZ-000050' },
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from patient_allergies')) {
          return {
            results: [{
              allergen: 'Penicillin',
              allergy_type: 'drug',
              severity: 'severe',
              reaction: 'Rash',
              source: 'patient_reported',
              review_status: 'verified',
              review_notes: 'Confirmed by clinician',
              created_at: '2026-04-01T10:00:00Z',
              created_by: 5,
              verified_by: 8,
              verified_at: '2026-04-02T10:00:00Z',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from patient_active_medications')) {
          return {
            results: [{
              medication_name: 'Metformin',
              generic_name: 'Metformin',
              dosage: '500 mg',
              frequency: '1+0+1',
              duration: '30 days',
              instructions: 'After food',
              status: 'active',
              source: 'patient_reported',
              review_status: 'rejected',
              review_notes: 'Dose not confirmed',
              reviewed_by: 15,
              reviewed_at: '2026-04-04T10:00:00Z',
              created_by: 9,
              created_at: '2026-04-03T10:00:00Z',
              prescribed_by: null,
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from clinicaldiagnosis')) {
          return {
            results: [{
              icd10_code: 'A01',
              icd11_code: '1A00',
              icd11_title: 'Cholera due to Vibrio cholerae 01, biovar cholerae',
              source: 'imported',
              diagnosis_type: 'final',
              review_status: 'verified',
              review_notes: 'Reviewed in ward round',
              reviewed_by: 18,
              reviewed_at: '2026-04-04T12:00:00Z',
              created_at: '2026-04-04T10:00:00Z',
              created_by: 11,
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from clinical_vitals')) {
          return {
            results: [{
              recorded_at: '2026-04-05T10:00:00Z',
              temperature: 98.6,
              pulse: 72,
              systolic: 120,
              diastolic: 80,
              respiratory_rate: 16,
              spo2: 98,
              weight: 70,
              height: 170,
              bmi: 24.2,
              blood_sugar: 100,
              source: 'device',
              taken_by: 12,
              created_at: '2026-04-05T10:00:00Z',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from lab_order_items')) {
          return {
            results: [{
              test_name: 'CBC',
              result: '5.4',
              abnormal_flag: 'normal',
              unit: 'x10^9/L',
              normal_range: '4-11',
              completed_at: '2026-04-06T10:00:00Z',
              source: 'lab',
              ordered_by: 22,
              verified_by: 31,
              verified_at: '2026-04-06T12:00:00Z',
              notes: 'Analyzer confirmed',
            }],
            success: true,
            meta: {},
          };
        }

        if (
          normalized.includes('from cln_problemlist') ||
          normalized.includes('from patient_vaccinations') ||
          normalized.includes('from discharge_summaries')
        ) {
          return {
            results: [],
            success: true,
            meta: {},
          };
        }

        return null;
      },
    });

    const summary = await buildPortableHealthSummary(mockDB.db, 'tenant-1', 50);

    expect(summary?.allergies[0]).toMatchObject({
      allergen: 'Penicillin',
      provenance: {
        source: 'patient_reported',
        verified: true,
        review_status: 'verified',
        recorded_by_user_id: 5,
        verified_by_user_id: 8,
      },
    });

    expect(summary?.current_medications[0]).toMatchObject({
      medication_name: 'Metformin',
      provenance: {
        source: 'patient_reported',
        verified: false,
        review_status: 'rejected',
        recorded_by_user_id: 9,
        reviewed_by_user_id: 15,
      },
    });

    expect(summary?.recent_diagnoses[0]).toMatchObject({
      icd11_code: '1A00',
      provenance: {
        source: 'imported',
        verified: true,
        review_status: 'verified',
        recorded_by_user_id: 11,
        reviewed_by_user_id: 18,
      },
    });

    expect(summary?.last_vitals).toMatchObject({
      pulse: 72,
      provenance: {
        source: 'device',
        verified: true,
        recorded_by_user_id: 12,
      },
    });

    expect(summary?.recent_lab_results[0]).toMatchObject({
      test_name: 'CBC',
      provenance: {
        source: 'lab',
        verified: true,
        review_status: 'verified',
        recorded_by_user_id: 22,
        reviewed_by_user_id: 31,
      },
    });
  });
});
