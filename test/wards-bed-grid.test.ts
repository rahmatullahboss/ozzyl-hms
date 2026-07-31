import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import wardsRoutes from '../src/routes/tenant/nursing/wards';

function setupBedGrid(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: false, tables });
  const { app } = createTestApp({
    route: wardsRoutes,
    routePath: '/wards',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

describe('Wards – Bed Grid', () => {

  it('GET /bed-grid returns beds array with statusColor for empty bed', async () => {
    // Mock returns raw table rows (no SQL aliases), so we use 'id' not 'bed_id'
    const { app } = setupBedGrid({
      beds: [
        { id: 1, tenant_id: 'tenant-1', ward_name: 'General', bed_number: 'B1', bed_type: 'standard', status: 'available', floor: 1, rate_per_day: 500 },
      ],
    });

    const res = await jsonRequest(app, '/wards/bed-grid');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown>[] };
    expect(body.Results).toBeDefined();
    expect(Array.isArray(body.Results)).toBe(true);
    expect(body.Results.length).toBe(1);
    // Mock returns raw table columns — id maps to bed_id via SQL alias in production
    expect(body.Results[0].id).toBe(1);
    expect(body.Results[0].statusColor).toBe('empty');
    expect(body.Results[0].latestVitals).toBeNull();
    expect(body.Results[0].activeAlerts).toBe(0);
    expect(body.Results[0].medDueCount).toBe(0);
  });

  it('GET /bed-grid returns enriched data for occupied bed', async () => {
    // The mock can't execute JOINs, so we include joined columns directly in the beds row
    // to simulate what the SQL JOIN would produce
    const { app } = setupBedGrid({
      beds: [
        {
          id: 1, tenant_id: 'tenant-1', ward_name: 'General', bed_number: 'B1',
          bed_type: 'standard', status: 'occupied', floor: 1, rate_per_day: 500,
          admission_id: 10, admission_status: 'admitted', provisional_diagnosis: 'Fever',
          patient_id: 100, patient_name: 'John Doe', patient_code: 'P001', blood_group: 'A+',
          doctor_name: 'Dr Smith',
        },
      ],
      patient_vitals: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 100, systolic: 120, diastolic: 80, temperature: 98.6, heart_rate: 72, spo2: 99, respiratory_rate: 16, recorded_at: '2025-01-01 10:00:00' },
      ],
      vital_alerts: [],
      mar_schedules: [],
    });

    const res = await jsonRequest(app, '/wards/bed-grid');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown>[] };
    expect(body.Results.length).toBe(1);

    const bed = body.Results[0];
    expect(bed.patient_id).toBe(100);
    expect(bed.patient_name).toBe('John Doe');
    expect(bed.doctor_name).toBe('Dr Smith');
    expect(bed.latestVitals).toBeDefined();
    expect((bed.latestVitals as Record<string, unknown>).systolic).toBe(120);
    expect(bed.statusColor).toBe('stable');
    expect(bed.activeAlerts).toBe(0);
    expect(bed.medDueCount).toBe(0);
  });

  it('GET /bed-grid marks bed as critical when alerts exist', async () => {
    const { app } = setupBedGrid({
      beds: [
        {
          id: 1, tenant_id: 'tenant-1', ward_name: 'ICU', bed_number: 'ICU-1',
          bed_type: 'icu', status: 'occupied', floor: 2, rate_per_day: 2000,
          admission_id: 10, admission_status: 'critical', provisional_diagnosis: 'Sepsis',
          patient_id: 100, patient_name: 'Jane Doe', patient_code: 'P002', blood_group: 'B+',
          doctor_name: 'Dr Khan',
        },
      ],
      patient_vitals: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 100, systolic: 90, diastolic: 60, temperature: 102, heart_rate: 110, spo2: 92, respiratory_rate: 24, recorded_at: '2025-01-01 10:00:00' },
      ],
      vital_alerts: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 100, status: 'active', severity: 'critical' },
      ],
      mar_schedules: [],
    });

    const res = await jsonRequest(app, '/wards/bed-grid');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown>[] };
    const bed = body.Results[0];
    expect(bed.statusColor).toBe('critical');
    expect(bed.activeAlerts).toBe(1);
  });

  it('GET /bed-grid marks bed as medication-due when pending meds exist', async () => {
    const { app } = setupBedGrid({
      beds: [
        {
          id: 1, tenant_id: 'tenant-1', ward_name: 'General', bed_number: 'B1',
          bed_type: 'standard', status: 'occupied', floor: 1, rate_per_day: 500,
          admission_id: 10, admission_status: 'admitted', provisional_diagnosis: 'Post-op',
          patient_id: 100, patient_name: 'Ali', patient_code: 'P003', blood_group: 'O+',
          doctor_name: 'Dr Ahmed',
        },
      ],
      patient_vitals: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 100, systolic: 120, diastolic: 80, temperature: 98.6, heart_rate: 72, spo2: 99, respiratory_rate: 16, recorded_at: '2025-01-01 10:00:00' },
      ],
      vital_alerts: [],
      nur_medication_admin: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 100, status: 'pending', scheduled_time: '2025-01-01 14:00:00' },
      ],
    });

    const res = await jsonRequest(app, '/wards/bed-grid');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown>[] };
    const bed = body.Results[0];
    expect(bed.statusColor).toBe('medication-due');
    expect(bed.medDueCount).toBe(1);
  });

  it('GET /bed-grid handles empty beds table', async () => {
    const { app } = setupBedGrid({ beds: [] });

    const res = await jsonRequest(app, '/wards/bed-grid');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[] };
    expect(body.Results).toEqual([]);
  });

  it('GET /bed-grid returns multiple beds', async () => {
    const { app } = setupBedGrid({
      beds: [
        { id: 1, tenant_id: 'tenant-1', ward_name: 'General', bed_number: 'B1', bed_type: 'standard', status: 'available', floor: 1, rate_per_day: 500 },
        { id: 2, tenant_id: 'tenant-1', ward_name: 'ICU', bed_number: 'ICU-1', bed_type: 'icu', status: 'available', floor: 2, rate_per_day: 2000 },
      ],
    });

    const res = await jsonRequest(app, '/wards/bed-grid');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown>[] };
    expect(body.Results.length).toBe(2);
    expect(body.Results[0].statusColor).toBe('empty');
    expect(body.Results[1].statusColor).toBe('empty');
  });

});
