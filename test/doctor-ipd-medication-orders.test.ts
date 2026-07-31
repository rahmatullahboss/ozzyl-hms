import { describe, expect, it, vi } from 'vitest';
import { medicationOrderRoutes } from '../src/routes/tenant/nursing/medication-orders';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const validOrder = {
  patient_id: 10,
  visit_id: 20,
  formulary_item_id: 30,
  medication_name: 'Ceftriaxone',
  generic_name: 'Ceftriaxone',
  strength: '1 g',
  dosage_form: 'Injection',
  dose: '1 g',
  route: 'IV',
  frequency: 'BD',
  duration: '5 days',
  instructions: 'Administer slowly',
  priority: 'routine' as const,
  start_datetime: '2026-07-11T08:00:00.000Z',
  idempotency_key: 'doctor-order:test-001',
};

function createOrderApp(options: {
  visit?: Record<string, unknown> | null;
  formulary?: Record<string, unknown> | null;
  existingOrder?: Record<string, unknown> | null;
  createdOrder?: Record<string, unknown> | null;
  batchError?: Error;
} = {}) {
  let orderLookupCount = 0;
  const mockDB = createMockDB({
    universalFallback: false,
    batchError: options.batchError,
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from visits v') && lower.includes('from admissions') === false) {
        const visit = options.visit === undefined
          ? { id: 20, patient_id: 10, admission_id: 300 }
          : options.visit;
        return { first: visit, results: visit ? [visit] : [] };
      }
      if (lower.includes('from formulary_items')) {
        const formulary = options.formulary === undefined
          ? { id: 30, name: 'Ceftriaxone', generic_name: 'Ceftriaxone', strength: '1 g', dosage_form: 'Injection' }
          : options.formulary;
        return { first: formulary, results: formulary ? [formulary] : [] };
      }
      if (lower.includes('from cln_medication_orders') && lower.includes('idempotency_key = ?')) {
        orderLookupCount += 1;
        const row = orderLookupCount === 1
          ? (options.existingOrder ?? null)
          : (options.createdOrder ?? {
              id: 501,
              patient_id: 10,
              visit_id: 20,
              formulary_item_id: 30,
              medication_name: 'Ceftriaxone',
              generic_name: 'Ceftriaxone',
              strength: '1 g',
              dosage_form: 'Injection',
              dose: '1 g',
              route: 'IV',
              frequency: 'BD',
              duration: '5 days',
              instructions: 'Administer slowly',
              priority: 'routine',
              start_datetime: '2026-07-11T08:00:00.000Z',
              end_datetime: null,
              status: 'active',
              idempotency_key: 'doctor-order:test-001',
            });
        return { first: row, results: row ? [row] : [] };
      }
      return null;
    },
  });

  const { app } = createTestApp({
    route: medicationOrderRoutes,
    routePath: '/medication-orders',
    role: 'doctor',
    userId: 42,
    tenantId: 'tenant-1',
    mockDB,
  });
  return { app, mockDB };
}

function createExistingOrderApp(status: 'active' | 'on_hold' | 'completed' | 'discontinued' | 'cancelled' = 'active') {
  const orderRow = {
    id: 501,
    tenant_id: 'tenant-1',
    patient_id: 10,
    visit_id: 20,
    medication_name: 'Ceftriaxone',
    dose: '1 g',
    route: 'IV',
    frequency: 'BD',
    priority: 'routine',
    status,
    is_active: 1,
  };
  const mockDB = createMockDB({
    tables: {
      cln_medication_orders: [orderRow],
    },
    queryOverride(sql) {
      const lower = sql.toLowerCase();
      if (lower.includes('from "cln_medication_orders"')) {
        return { results: [orderRow] };
      }
      return null;
    },
  });
  const { app } = createTestApp({
    route: medicationOrderRoutes,
    routePath: '/medication-orders',
    role: 'doctor',
    userId: 42,
    tenantId: 'tenant-1',
    mockDB,
  });
  return { app, mockDB };
}

describe('doctor IPD medication orders', () => {
  it('creates the medication order and initial MAR row in one atomic batch', async () => {
    const { app, mockDB } = createOrderApp();

    const res = await jsonRequest(app, '/medication-orders', {
      method: 'POST',
      body: validOrder,
    });

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      Results: { id: 501, status: 'active', replayed: false },
    });
    expect(mockDB.batchCalls).toHaveLength(1);
    expect(mockDB.batchCalls[0]).toHaveLength(2);
    expect(mockDB.batchCalls[0][0].toLowerCase()).toContain('insert or ignore into cln_medication_orders');
    expect(mockDB.batchCalls[0][0].toLowerCase()).toContain('idempotency_key');
    expect(mockDB.batchCalls[0][1].toLowerCase()).toContain('insert into nur_medication_admin');
    expect(mockDB.batchCalls[0][1].toLowerCase()).toContain('select o.tenant_id');
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
  });

  it('rejects a visit that is not an active IPD visit for the patient', async () => {
    const { app, mockDB } = createOrderApp({ visit: null });

    const res = await jsonRequest(app, '/medication-orders', {
      method: 'POST',
      body: validOrder,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/active ipd visit/i) });
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('rejects a formulary item from another tenant or inactive catalog', async () => {
    const { app, mockDB } = createOrderApp({ formulary: null });

    const res = await jsonRequest(app, '/medication-orders', {
      method: 'POST',
      body: validOrder,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/formulary/i) });
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('returns the existing order for an exact idempotent replay without creating another MAR row', async () => {
    const existing = {
      id: 501,
      patient_id: 10,
      visit_id: 20,
      formulary_item_id: 30,
      medication_name: 'Ceftriaxone',
      generic_name: 'Ceftriaxone',
      strength: '1 g',
      dosage_form: 'Injection',
      dose: '1 g',
      route: 'IV',
      frequency: 'BD',
      duration: '5 days',
      instructions: 'Administer slowly',
      priority: 'routine',
      start_datetime: '2026-07-11T08:00:00.000Z',
      end_datetime: null,
      status: 'active',
      idempotency_key: 'doctor-order:test-001',
    };
    const { app, mockDB } = createOrderApp({ existingOrder: existing });

    const res = await jsonRequest(app, '/medication-orders', {
      method: 'POST',
      body: validOrder,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      Results: { id: 501, replayed: true },
    });
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('treats an omitted start datetime as an exact replay using the stored order timestamp', async () => {
    const existing = {
      id: 501,
      patient_id: 10,
      visit_id: 20,
      formulary_item_id: 30,
      medication_name: 'Ceftriaxone',
      generic_name: 'Ceftriaxone',
      strength: '1 g',
      dosage_form: 'Injection',
      dose: '1 g',
      route: 'IV',
      frequency: 'BD',
      duration: '5 days',
      instructions: 'Administer slowly',
      priority: 'routine',
      start_datetime: '2026-07-11T09:15:00.000Z',
      end_datetime: null,
      status: 'active',
      idempotency_key: 'doctor-order:test-001',
    };
    const { app, mockDB } = createOrderApp({ existingOrder: existing });
    const { start_datetime: _omitted, ...withoutStart } = validOrder;

    const res = await jsonRequest(app, '/medication-orders', {
      method: 'POST',
      body: withoutStart,
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ Results: { id: 501, replayed: true } });
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('rejects reuse of an idempotency key with a different clinical order', async () => {
    const { app, mockDB } = createOrderApp({
      existingOrder: {
        id: 501,
        patient_id: 10,
        visit_id: 20,
        formulary_item_id: 30,
        medication_name: 'Ceftriaxone',
        generic_name: 'Ceftriaxone',
        strength: '1 g',
        dosage_form: 'Injection',
        dose: '2 g',
        route: 'IV',
        frequency: 'OD',
        duration: '5 days',
        instructions: 'Different order',
        priority: 'urgent',
        start_datetime: '2026-07-11T08:00:00.000Z',
        end_datetime: null,
        status: 'active',
        idempotency_key: 'doctor-order:test-001',
      },
    });

    const res = await jsonRequest(app, '/medication-orders', {
      method: 'POST',
      body: validOrder,
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/idempotency key/i) });
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('does not leave an active order behind when the atomic batch fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { app, mockDB } = createOrderApp({ batchError: new Error('MAR insert failed') });

    try {
      const res = await jsonRequest(app, '/medication-orders', {
        method: 'POST',
        body: validOrder,
      });

      expect(res.status).toBe(500);
      expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(false);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('holds an active order with a reason and audit trail', async () => {
    const { app, mockDB } = createExistingOrderApp('active');

    const res = await jsonRequest(app, '/medication-orders/501/hold', {
      method: 'PUT',
      body: { status_reason: 'Patient is NPO' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ Results: { id: 501, status: 'on_hold' } });
    const update = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('update "cln_medication_orders"')
      || query.sql.toLowerCase().includes('update cln_medication_orders')
    );
    expect(update?.params).toContain('on_hold');
    expect(update?.params).toContain('Patient is NPO');
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
  });

  it('resumes an on-hold order with a documented reason', async () => {
    const { app } = createExistingOrderApp('on_hold');

    const res = await jsonRequest(app, '/medication-orders/501/hold', {
      method: 'PUT',
      body: { status_reason: 'Patient can take oral medicines again' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ Results: { id: 501, status: 'active' } });
  });

  it('discontinues an active order with a reason and audit trail', async () => {
    const { app, mockDB } = createExistingOrderApp('active');

    const res = await jsonRequest(app, '/medication-orders/501/discontinue', {
      method: 'PUT',
      body: { status_reason: 'Antibiotic course completed' },
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ Results: { id: 501, status: 'discontinued' } });
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
  });

  it('rejects reopening a terminal completed order', async () => {
    const { app } = createExistingOrderApp('completed');

    const res = await jsonRequest(app, '/medication-orders/501/status', {
      method: 'PUT',
      body: { status: 'active' },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/cannot transition/i) });
  });

  it('blocks deletion of a MAR-linked clinical medication order', async () => {
    const { app, mockDB } = createExistingOrderApp('active');

    const res = await jsonRequest(app, '/medication-orders/501', {
      method: 'DELETE',
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: expect.stringMatching(/immutable clinical records/i) });
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('insert into audit_logs'))).toBe(true);
    expect(mockDB.queries.some((query) => query.method === 'run' && query.sql.toLowerCase().includes('update cln_medication_orders'))).toBe(false);
  });

  it('requires a reason before discontinuing an active order', async () => {
    const { app } = createOrderApp();

    const res = await jsonRequest(app, '/medication-orders/501/discontinue', {
      method: 'PUT',
      body: {},
    });

    expect(res.status).toBe(400);
  });

  it('requires a reason for hold and resume decisions', async () => {
    const { app } = createOrderApp();

    const res = await jsonRequest(app, '/medication-orders/501/hold', {
      method: 'PUT',
      body: {},
    });

    expect(res.status).toBe(400);
  });
});
