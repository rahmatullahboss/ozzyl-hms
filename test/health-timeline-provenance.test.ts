import { describe, expect, test } from 'vitest';
import { createMockDB } from './integration/helpers/mock-db';
import { buildAggregatedHealthRecord } from '../src/lib/health-timeline';

describe('aggregated health timeline provenance', () => {
  test('adds provenance badges to timeline events built from reviewed clinical data', async () => {
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const normalized = sql.toLowerCase();

        if (normalized.includes('from patient_health_links')) {
          return {
            results: [{
              tenant_id: 10,
              patient_id: 50,
              hospital_name: 'Tenant Hospital',
              linked_at: '2026-04-01T10:00:00Z',
              uhid: 'OZ-000050',
            }],
            success: true,
            meta: {},
          };
        }

        if (normalized.includes('from health_record_consents')) {
          return {
            results: [{
              granting_tenant_id: 10,
              granted_to_tenant_id: 99,
              consent_type: 'view_full',
              clinical_areas: null,
            }],
            success: true,
            meta: {},
          };
        }

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

        if (normalized.includes('from clinicaldiagnosis')) {
          return {
            results: [{
              icd10_code: 'I10',
              icd11_code: 'BA00',
              icd11_title: 'Essential hypertension',
              description: 'Essential hypertension',
              diagnosis_type: 'final',
              review_status: 'verified',
              review_notes: 'Confirmed during rounds',
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
              taken_by: 12,
              created_at: '2026-04-05T10:00:00Z',
            }],
            success: true,
            meta: {},
          };
        }

        if (
          normalized.includes('from patient_allergies') ||
          normalized.includes('from patient_active_medications') ||
          normalized.includes('from cln_problemlist') ||
          normalized.includes('from patient_vaccinations') ||
          normalized.includes('from lab_order_items') ||
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

    const record = await buildAggregatedHealthRecord(mockDB.db, '1234567890', 99, 7, 'doctor');

    const diagnosis = record.timeline.find((item) => item.type === 'diagnosis');
    expect(diagnosis?.details).toMatchObject({
      provenance: {
        source: 'hospital',
        review_status: 'verified',
        badge: 'Doctor Verified',
      },
    });

    const vitals = record.timeline.find((item) => item.type === 'vitals');
    expect(vitals?.details).toMatchObject({
      provenance: {
        source: 'hospital',
        review_status: 'verified',
        badge: 'Doctor Verified',
      },
    });
  });
});
