import { describe, it, expect } from 'vitest';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import { medicationOrderRoutes } from '../src/routes/tenant/nursing/medication-orders';
import { ioChartsRoutes } from '../src/routes/tenant/nursing/io-charts';
import { woundCareRoutes } from '../src/routes/tenant/nursing/wound-care';
import { ivDrugRoutes } from '../src/routes/tenant/nursing/iv-drugs';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupMedicationOrders(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: medicationOrderRoutes,
    routePath: '/medication-orders',
    role: 'doctor',
    mockDB,
  });
  return { app, mockDB };
}

function setupIOCharts(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: ioChartsRoutes,
    routePath: '/io',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

function setupWoundCare(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: woundCareRoutes,
    routePath: '/wound-care',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

function setupIVDrugs(tables: Record<string, Record<string, unknown>[]> = {}) {
  const mockDB = createMockDB({ universalFallback: true, tables });
  const { app } = createTestApp({
    route: ivDrugRoutes,
    routePath: '/iv-drugs',
    role: 'nurse',
    mockDB,
  });
  return { app, mockDB };
}

// ─── Medication Orders ───────────────────────────────────────────────────────

describe('Nursing – Medication Orders', () => {

  it('GET / returns list with pagination', async () => {
    const { app } = setupMedicationOrders({
      cln_medication_orders: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, medication_name: 'Paracetamol', is_active: 1 },
        { id: 2, tenant_id: 'tenant-1', patient_id: 10, medication_name: 'Amoxicillin', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/medication-orders?patient_id=10&page=1&limit=20');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[]; pagination: { page: number; limit: number; total: number } };
    expect(body.Results).toBeDefined();
    expect(Array.isArray(body.Results)).toBe(true);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(20);
  });

  it('GET /:id returns single order', async () => {
    const { app } = setupMedicationOrders({
      cln_medication_orders: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, medication_name: 'Paracetamol', is_active: 1 },
      ],
      nur_medication_admin: [],
    });

    const res = await jsonRequest(app, '/medication-orders/1');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: Record<string, unknown> };
    expect(body.Results).toBeDefined();
    expect(body.Results.id).toBe(1);
  });

  it('POST / creates order', async () => {
    let lookupCount = 0;
    let generatedKey = '';
    const mockDB = createMockDB({
      queryOverride(sql, params) {
        const lower = sql.toLowerCase();
        if (lower.includes('from visits v')) {
          return { first: { id: 5, patient_id: 10, admission_id: 7 } };
        }
        if (lower.includes('from cln_medication_orders') && lower.includes('idempotency_key = ?')) {
          lookupCount += 1;
          generatedKey = String(params[1] ?? generatedKey);
          if (lookupCount === 1) return { first: null };
          return {
            first: {
              id: 1001,
              patient_id: 10,
              visit_id: 5,
              formulary_item_id: null,
              medication_name: 'Paracetamol',
              generic_name: null,
              strength: null,
              dosage_form: null,
              dose: '500mg',
              route: 'Oral',
              frequency: 'TDS',
              duration: null,
              instructions: null,
              priority: 'routine',
              start_datetime: '2026-07-11T08:00:00.000Z',
              end_datetime: null,
              status: 'active',
              idempotency_key: generatedKey,
            },
          };
        }
        return null;
      },
    });
    const { app } = createTestApp({
      route: medicationOrderRoutes,
      routePath: '/medication-orders',
      role: 'doctor',
      mockDB,
    });

    const startDatetime = '2026-07-11T08:00:00.000Z';
    const res = await jsonRequest(app, '/medication-orders', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 5,
        medication_name: 'Paracetamol',
        dose: '500mg',
        route: 'Oral',
        frequency: 'TDS',
        priority: 'routine',
        start_datetime: startDatetime,
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBe(1001);
  });

});

// ─── IO Charts ───────────────────────────────────────────────────────────────

describe('Nursing – IO Charts', () => {

  it('GET /balance/:patientId returns intake/output/balance', async () => {
    const { app } = setupIOCharts({
      nur_intake_output: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, intake_amount: 500, output_amount: 300, is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/io/balance/10');
    expect(res.status).toBe(200);

    const body = await res.json() as { total_intake: number; total_output: number; balance: number; period: string };
    expect(body.total_intake).toBeDefined();
    expect(body.total_output).toBeDefined();
    expect(body.balance).toBeDefined();
    expect(body.period).toBeDefined();
  });

  it('GET / returns list', async () => {
    const { app } = setupIOCharts({
      nur_intake_output: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, intake_type: 'oral', intake_amount: 200, is_active: 1 },
        { id: 2, tenant_id: 'tenant-1', patient_id: 10, output_type: 'urine', output_amount: 150, is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/io?patient_id=10');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[]; pagination: { page: number; limit: number; total: number } };
    expect(body.Results).toBeDefined();
    expect(Array.isArray(body.Results)).toBe(true);
    expect(body.pagination).toBeDefined();
  });

  it('POST / creates record', async () => {
    const { app } = setupIOCharts();

    const res = await jsonRequest(app, '/io', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 5,
        intake_type: 'oral',
        intake_amount: 250,
        intake_unit: 'ml',
        output_type: 'urine',
        output_amount: 200,
        output_unit: 'ml',
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

});

// ─── Wound Care ──────────────────────────────────────────────────────────────

describe('Nursing – Wound Care', () => {

  it('GET / returns list', async () => {
    const { app } = setupWoundCare({
      nur_wound_care: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, wound_site: 'left leg', is_active: 1 },
        { id: 2, tenant_id: 'tenant-1', patient_id: 10, wound_site: 'right arm', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/wound-care?patient_id=10');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[]; pagination: { page: number; limit: number; total: number } };
    expect(body.Results).toBeDefined();
    expect(Array.isArray(body.Results)).toBe(true);
    expect(body.pagination).toBeDefined();
  });

  it('POST / creates wound care record', async () => {
    const { app } = setupWoundCare();

    const res = await jsonRequest(app, '/wound-care', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 5,
        wound_site: 'left leg',
        wound_type: 'surgical',
        size: '3cm',
        depth: 'partial',
        description: 'Post-operative wound',
        treatment: 'Clean and dress',
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  it('PUT /:id updates record', async () => {
    const { app } = setupWoundCare({
      nur_wound_care: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, wound_site: 'left leg', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/wound-care/1', {
      method: 'PUT',
      body: {
        wound_site: 'left leg updated',
        treatment: 'New dressing applied',
      },
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: boolean };
    expect(body.Results).toBe(true);
  });

  it('DELETE /:id soft deletes', async () => {
    const { app } = setupWoundCare({
      nur_wound_care: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, wound_site: 'left leg', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/wound-care/1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: boolean };
    expect(body.Results).toBe(true);
  });

});

// ─── IV Drugs ────────────────────────────────────────────────────────────────

describe('Nursing – IV Drugs', () => {

  it('GET / returns list', async () => {
    const { app } = setupIVDrugs({
      nur_iv_drugs: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, drug_name: 'Ceftriaxone', is_active: 1 },
        { id: 2, tenant_id: 'tenant-1', patient_id: 10, drug_name: 'Metronidazole', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/iv-drugs?patient_id=10');
    expect(res.status).toBe(200);

    const body = await res.json() as { Results: unknown[]; pagination: { page: number; limit: number; total: number } };
    expect(body.Results).toBeDefined();
    expect(Array.isArray(body.Results)).toBe(true);
    expect(body.pagination).toBeDefined();
  });

  it('POST / creates record', async () => {
    const { app } = setupIVDrugs();

    const res = await jsonRequest(app, '/iv-drugs', {
      method: 'POST',
      body: {
        patient_id: 10,
        visit_id: 5,
        drug_name: 'Ceftriaxone',
        dosing: '1g BD',
        rate: '100ml/hr',
        status: 'running',
      },
    });

    expect(res.status).toBe(201);

    const body = await res.json() as { Results: { id: number } };
    expect(body.Results.id).toBeDefined();
  });

  it('DELETE /:id soft deletes', async () => {
    const { app } = setupIVDrugs({
      nur_iv_drugs: [
        { id: 1, tenant_id: 'tenant-1', patient_id: 10, drug_name: 'Ceftriaxone', is_active: 1 },
      ],
    });

    const res = await jsonRequest(app, '/iv-drugs/1', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);

    const body = await res.json() as { Results: boolean };
    expect(body.Results).toBe(true);
  });

});
