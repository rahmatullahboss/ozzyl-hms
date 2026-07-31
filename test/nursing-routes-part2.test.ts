import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest, type TestApp } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import { aiHandoverRoutes } from '../src/routes/tenant/nursing/ai-handover';
import { clinicalSummaryRoutes } from '../src/routes/tenant/nursing/clinical-summary';
import { medicationDueRoutes } from '../src/routes/tenant/nursing/medication-due';
import { nursingReportsRoutes } from '../src/routes/tenant/nursing/reports';
import { nursingOrderRoutes } from '../src/routes/tenant/nursing/nursing-orders';
import { consultationRequestRoutes } from '../src/routes/tenant/nursing/consultation-requests';
import { monitoringRoutes } from '../src/routes/tenant/nursing/monitoring';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupAIHandover(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: aiHandoverRoutes,
    routePath: '/ai-handover',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

function setupClinicalSummary(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: clinicalSummaryRoutes,
    routePath: '/clinical-summary',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

function setupMedicationDue(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: medicationDueRoutes,
    routePath: '/medication-due',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

function setupReports(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: nursingReportsRoutes,
    routePath: '/reports',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

function setupNursingOrders(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: nursingOrderRoutes,
    routePath: '/orders',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

function setupConsultationRequests(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: consultationRequestRoutes,
    routePath: '/consultation-requests',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

function setupMonitoring(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: monitoringRoutes,
    routePath: '/monitoring',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

// ─── AI Handover ─────────────────────────────────────────────────────────────

describe('Nursing – AI Handover', () => {

  it('POST /generate returns handover data with correct table names', async () => {
    const { app } = setupAIHandover({
      patient_vitals: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, systolic: 190, diastolic: 80, heart_rate: 70, spo2: 98, temperature: 98.6, recorded_at: new Date().toISOString() },
      ],
      nur_medication_admin: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, medication_name: 'Paracetamol', scheduled_time: new Date().toISOString(), status: 'pending' },
      ],
      nur_orders: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, order_description: 'Blood test', status: 'pending' },
      ],
      admissions: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, status: 'admitted', admission_date: new Date().toISOString().split('T')[0] },
      ],
      patients: [
        { id: 10, tenant_id: 'tenant-1', name: 'John Doe' },
      ],
      beds: [
        { id: 1, bed_number: 'B1' },
      ],
      care_plans: [],
    });

    const res = await jsonRequest(app, '/ai-handover/generate', {
      method: 'POST',
      body: { ward: 'General', shift: 'morning' },
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { summary: string };
    expect(body.summary).toBeDefined();
    expect(typeof body.summary).toBe('string');
    expect(body.summary).toContain('SHIFT HANDOVER SUMMARY');
    expect(body.summary).toContain('General');
  });

  it('POST /generate validates request body', async () => {
    const { app } = setupAIHandover();

    const res = await jsonRequest(app, '/ai-handover/generate', {
      method: 'POST',
      body: { ward: '' },
    });

    expect(res.status).toBe(400);
  });

});

// ─── Clinical Summary ────────────────────────────────────────────────────────

describe('Nursing – Clinical Summary', () => {

  it('GET /:patientId returns summary with correct table references', async () => {
    const { app } = setupClinicalSummary({
      patient_vitals: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, systolic: 120, diastolic: 80, temperature: 98.6, heart_rate: 72, spo2: 98, respiratory_rate: 16, weight: 70, recorded_at: new Date().toISOString() },
      ],
      nur_medication_admin: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, medication_name: 'Paracetamol', status: 'given', is_active: 1 },
      ],
      cln_medication_orders: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, medication_name: 'Amoxicillin', status: 'active' },
      ],
      nursing_final_diagnoses: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, final_diagnosis: 'Hypertension', icd10_code: 'I10' },
      ],
      patient_allergies: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, allergen: 'Penicillin', severity: 'severe', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/clinical-summary/10');

    expect(res.status).toBe(200);

    const body = await res.json() as {
      Results: {
        patient_id: number;
        vitals: unknown[];
        recent_medications: unknown[];
        active_orders: unknown[];
        diagnoses: unknown[];
        allergies: unknown[];
      };
    };
    expect(body.Results.patient_id).toBe(10);
    expect(body.Results.vitals).toBeDefined();
    expect(body.Results.recent_medications).toBeDefined();
    expect(body.Results.active_orders).toBeDefined();
    expect(body.Results.diagnoses).toBeDefined();
    expect(body.Results.allergies).toBeDefined();
  });

  it('GET /:patientId returns 400 for invalid ID', async () => {
    const { app } = setupClinicalSummary();

    const res = await jsonRequest(app, '/clinical-summary/abc');

    expect(res.status).toBe(400);
  });

});

// ─── Medication Due ──────────────────────────────────────────────────────────

describe('Nursing – Medication Due', () => {

  it('GET / returns medications due with correct table names', async () => {
    const { app } = setupMedicationDue({
      nur_medication_admin: [
        { id: 1, tenant_id: 'tenant-1', order_id: 1, scheduled_time: new Date().toISOString(), status: 'pending', patient_id: 10 },
      ],
      cln_medication_orders: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, medication_name: 'Paracetamol', generic_name: 'Acetaminophen', dose: '500mg', route: 'oral', frequency: 'TID', priority: 'routine', status: 'active' },
      ],
      patients: [
        { id: 10, tenant_id: 'tenant-1', name: 'John Doe', patient_code: 'P001' },
      ],
      admissions: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, status: 'admitted', admission_no: 'ADM001' },
      ],
    });

    const res = await jsonRequest(app, '/medication-due');

    expect(res.status).toBe(200);

    const body = await res.json() as {
      Results: unknown[];
      summary: { overdue: number; upcoming: number; total: number };
    };
    expect(body.Results).toBeDefined();
    expect(body.summary).toBeDefined();
    expect(body.summary.total).toBeDefined();
  });

  it('GET / filters by ward_id', async () => {
    const { app } = setupMedicationDue();

    const res = await jsonRequest(app, '/medication-due?ward_id=1');

    expect(res.status).toBe(200);
  });

});

// ─── Nursing Reports ─────────────────────────────────────────────────────────

describe('Nursing – Reports', () => {

  it('GET /daily returns daily report with correct table names', async () => {
    const { app } = setupReports({
      patient_vitals: [],
      nur_medication_admin: [],
      nur_notes: [],
      nur_orders: [],
      nur_ward_billing_requests: [],
    });

    const res = await jsonRequest(app, '/reports/daily?date=2026-05-30');

    expect(res.status).toBe(200);

    const body = await res.json() as {
      Results: {
        vitals_count: number;
        medications_given: number;
        medications_missed: number;
        notes_count: number;
        orders_acknowledged: number;
        services_added: number;
      };
    };
    expect(body.Results.vitals_count).toBeDefined();
    expect(body.Results.medications_given).toBeDefined();
    expect(body.Results.medications_missed).toBeDefined();
    expect(body.Results.notes_count).toBeDefined();
    expect(body.Results.orders_acknowledged).toBeDefined();
    expect(body.Results.services_added).toBeDefined();
  });

  it('GET /daily validates date format', async () => {
    const { app } = setupReports();

    const res = await jsonRequest(app, '/reports/daily?date=invalid');

    expect(res.status).toBe(400);
  });

  it('GET /missed-doses returns missed dose report', async () => {
    const { app } = setupReports({
      nur_medication_admin: [],
      patients: [],
    });

    const res = await jsonRequest(app, '/reports/missed-doses?from=2026-05-01&to=2026-05-30');

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[] };
    expect(body.Results).toBeDefined();
  });

});

// ─── Nursing Orders ──────────────────────────────────────────────────────────

describe('Nursing – Nursing Orders', () => {

  it('GET / returns orders with pagination', async () => {
    const { app } = setupNursingOrders({
      nur_orders: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, order_type: 'lab', item_name: 'CBC', status: 'pending', is_active: 1 },
        { id: 2, tenant_id: 'tenant-1', patient_id: 10, order_type: 'radiology', item_name: 'X-Ray', status: 'pending', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/orders?patient_id=10&page=1&limit=20');

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[]; pagination: { page: number; limit: number; total: number } };
    expect(body.Results).toBeDefined();
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
  });

  it('GET /:id returns single order', async () => {
    const { app } = setupNursingOrders({
      nur_orders: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, order_type: 'lab', item_name: 'CBC', status: 'pending', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/orders/1');

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown> };
    expect(body.Results).toBeDefined();
    expect(body.Results.id).toBe(1);
  });

  it('POST / creates order', async () => {
    const { app } = setupNursingOrders();

    const res = await jsonRequest(app, '/orders', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 5,
        order_type: 'lab',
        item_name: 'CBC',
        quantity: 1,
        priority: 'routine',
        ordered_by: 1,
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  it('PUT /:id/status updates order status without updated_by column error', async () => {
    const mockDB = createMockDB({
      tables: {
        nur_orders: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, order_type: 'lab', item_name: 'CBC', status: 'pending', is_active: 1 },
        ],
      },
      queryOverride: (sql) => {
        if (sql.includes('SELECT 1 FROM nur_orders')) {
          return { first: { id: 1, status: 'pending' } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: nursingOrderRoutes,
      routePath: '/orders',
      role: 'nurse',
      mockDB,
    });

    const res = await jsonRequest(app, '/orders/1/status', {
      method: 'PUT',
      body: { status: 'accepted' },
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { id: number; status: string } };
    expect(body.Results.status).toBe('accepted');
  });

  it('DELETE /:id soft deletes without updated_by column error', async () => {
    const mockDB = createMockDB({
      tables: {
        nur_orders: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, order_type: 'lab', item_name: 'CBC', status: 'pending', is_active: 1 },
        ],
      },
      queryOverride: (sql) => {
        if (sql.includes('SELECT 1 FROM nur_orders')) {
          return { first: { id: 1 } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: nursingOrderRoutes,
      routePath: '/orders',
      role: 'nurse',
      mockDB,
    });

    const res = await jsonRequest(app, '/orders/1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: boolean };
    expect(body.Results).toBe(true);
  });

  it('PUT /:id/status returns 404 for non-existent order', async () => {
    const mockDB = createMockDB({
      queryOverride: () => ({ first: null }),
    });
    const { app } = createTestApp({
      route: nursingOrderRoutes,
      routePath: '/orders',
      role: 'nurse',
      mockDB,
    });

    const res = await jsonRequest(app, '/orders/999/status', {
      method: 'PUT',
      body: { status: 'accepted' },
    });

    expect(res.status).toBe(404);
  });

});

// ─── Consultation Requests ───────────────────────────────────────────────────

describe('Nursing – Consultation Requests', () => {

  it('GET / returns consultation requests', async () => {
    const { app } = setupConsultationRequests({
      nur_consultation_requests: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, purpose: 'Cardiology consult', status: 'pending', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/consultation-requests?patient_id=10&page=1&limit=20');

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[]; pagination: { page: number; limit: number; total: number } };
    expect(body.Results).toBeDefined();
    expect(body.pagination).toBeDefined();
  });

  it('GET /:id returns single consultation request', async () => {
    const { app } = setupConsultationRequests({
      nur_consultation_requests: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, purpose: 'Cardiology consult', status: 'pending', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/consultation-requests/1');

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown> };
    expect(body.Results).toBeDefined();
    expect(body.Results.id).toBe(1);
  });

  it('POST / creates consultation request', async () => {
    const { app } = setupConsultationRequests();

    const res = await jsonRequest(app, '/consultation-requests', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 5,
        requesting_doctor_id: 1,
        purpose: 'Cardiology consult',
        consulting_doctor_id: 2,
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  it('PUT /:id/respond updates consultation without updated_by column error', async () => {
    const mockDB = createMockDB({
      tables: {
        nur_consultation_requests: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, purpose: 'Cardiology consult', status: 'pending', is_active: 1 },
        ],
      },
      queryOverride: (sql) => {
        if (sql.includes('SELECT id, status FROM nur_consultation_requests')) {
          return { first: { id: 1, status: 'pending' } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: consultationRequestRoutes,
      routePath: '/consultation-requests',
      role: 'nurse',
      mockDB,
    });

    const res = await jsonRequest(app, '/consultation-requests/1/respond', {
      method: 'PUT',
      body: {
        consultant_response: 'Patient needs echocardiogram',
        status: 'responded',
      },
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { id: number; status: string } };
    expect(body.Results.status).toBe('responded');
  });

  it('PUT /:id/cancel cancels consultation without updated_by column error', async () => {
    const mockDB = createMockDB({
      tables: {
        nur_consultation_requests: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, purpose: 'Cardiology consult', status: 'pending', is_active: 1 },
        ],
      },
      queryOverride: (sql) => {
        if (sql.includes('SELECT id, status FROM nur_consultation_requests')) {
          return { first: { id: 1, status: 'pending' } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: consultationRequestRoutes,
      routePath: '/consultation-requests',
      role: 'nurse',
      mockDB,
    });

    const res = await jsonRequest(app, '/consultation-requests/1/cancel', {
      method: 'PUT',
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: { id: number; status: string } };
    expect(body.Results.status).toBe('cancelled');
  });

  it('PUT /:id/respond returns 400 for already responded request', async () => {
    const mockDB = createMockDB({
      tables: {
        nur_consultation_requests: [
          { id: 1, tenant_id: 'tenant-1', patient_id: 10, purpose: 'Cardiology consult', status: 'responded', is_active: 1 },
        ],
      },
      queryOverride: (sql) => {
        if (sql.includes('SELECT id, status FROM nur_consultation_requests')) {
          return { first: { id: 1, status: 'responded' } };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: consultationRequestRoutes,
      routePath: '/consultation-requests',
      role: 'nurse',
      mockDB,
    });

    const res = await jsonRequest(app, '/consultation-requests/1/respond', {
      method: 'PUT',
      body: {
        consultant_response: 'Updated response',
        status: 'responded',
      },
    });

    expect(res.status).toBe(400);
  });

});

// ─── Monitoring ──────────────────────────────────────────────────────────────

describe('Nursing – Monitoring', () => {

  it('GET / returns vitals with pagination', async () => {
    const { app } = setupMonitoring({
      patient_vitals: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, systolic: 120, diastolic: 80, temperature: 98.6, heart_rate: 72, respiratory_rate: 16, spo2: 98, recorded_at: new Date().toISOString() },
      ],
    });

    const res = await jsonRequest(app, '/monitoring?patient_id=10&page=1&limit=20');

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[]; pagination: { page: number; limit: number; total: number } };
    expect(body.Results).toBeDefined();
    expect(body.pagination).toBeDefined();
  });

  it('GET /:id returns single vital', async () => {
    const { app } = setupMonitoring({
      patient_vitals: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, systolic: 120, diastolic: 80, temperature: 98.6, heart_rate: 72, respiratory_rate: 16, spo2: 98, recorded_at: new Date().toISOString() },
      ],
    });

    const res = await jsonRequest(app, '/monitoring/1');

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown> };
    expect(body.Results).toBeDefined();
    expect(body.Results.id).toBe(1);
  });

  it('POST / creates vital record', async () => {
    const { app } = setupMonitoring();

    const res = await jsonRequest(app, '/monitoring', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 5,
        temperature: 98.6,
        pulse: 72,
        bp_systolic: 120,
        bp_diastolic: 80,
        spo2: 98,
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  it('PUT /:id updates vital with updated_at timestamp', async () => {
    const { app } = setupMonitoring({
      patient_vitals: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, systolic: 120, diastolic: 80, temperature: 98.6, heart_rate: 72, respiratory_rate: 16, spo2: 98, recorded_at: new Date().toISOString() },
      ],
    });

    const res = await jsonRequest(app, '/monitoring/1', {
      method: 'PUT',
      body: {
        temperature: 99.2,
        remarks: 'Slight fever',
      },
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: boolean };
    expect(body.Results).toBe(true);
  });

  it('DELETE /:id hard deletes vital', async () => {
    const { app } = setupMonitoring({
      patient_vitals: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, systolic: 120, diastolic: 80, recorded_at: new Date().toISOString() },
      ],
    });

    const res = await jsonRequest(app, '/monitoring/1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: boolean };
    expect(body.Results).toBe(true);
  });

  it('PUT /:id returns 404 for non-existent vital', async () => {
    const mockDB = createMockDB({
      queryOverride: () => ({ first: null }),
    });
    const { app } = createTestApp({
      route: monitoringRoutes,
      routePath: '/monitoring',
      role: 'nurse',
      mockDB,
    });

    const res = await jsonRequest(app, '/monitoring/999', {
      method: 'PUT',
      body: { temperature: 98.6 },
    });

    expect(res.status).toBe(404);
  });

});
