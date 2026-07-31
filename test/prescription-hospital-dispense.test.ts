import { describe, expect, it } from 'vitest';
import prescriptionFulfilmentRoutes from '../src/routes/tenant/prescriptionFulfilment';
import { createIdempotencyRequestHash } from '../src/lib/request-idempotency';
import { createMockDB } from './integration/helpers/mock-db';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

const validRequest = {
  idempotencyKey: 'dispense-rx-1-attempt-001',
  paymentMethod: 'cash',
  items: [{
    prescriptionItemId: 11,
    medicineId: 501,
    quantity: 2,
  }],
};

type DispenseFixture = {
  prescriptionStatus?: string;
  mappedMedicineId?: number;
  prescribedQuantity?: number;
  alreadyDispensed?: number;
  stockQuantity?: number;
  replay?: { requestHash: string; status?: string };
  prescriptionItems?: Record<string, unknown>[];
  stockBatches?: Record<string, unknown>[];
};

function makeDispenseDB(fixture: DispenseFixture = {}) {
  const {
    prescriptionStatus = 'final',
    mappedMedicineId = 501,
    prescribedQuantity = 5,
    alreadyDispensed = 0,
    stockQuantity = 10,
    replay,
    prescriptionItems,
    stockBatches,
  } = fixture;

  return createMockDB({
    queryOverride(sql) {
      const lower = sql.toLowerCase();

      if (lower.includes('from medication_orders') && lower.includes('idempotency_key')) {
        if (!replay) return { first: null, results: [] };
        return {
          first: {
            id: 'order-existing',
            status: replay.status ?? 'fulfilled',
            sale_id: 73,
            request_hash: replay.requestHash,
          },
        };
      }

      if (lower.includes('from prescriptions') && lower.includes('status')) {
        return {
          first: { id: 1, patient_id: 88, status: prescriptionStatus },
        };
      }

      if (lower.includes('from prescription_items') && lower.includes('join medicines')) {
        return {
          results: prescriptionItems ?? [{
            prescription_item_id: 11,
            medicine_name: 'Paracetamol 500mg',
            dosage: '500 mg',
            frequency: '1+0+1',
            duration: '5 days',
            quantity: prescribedQuantity,
            dispensed_qty: alreadyDispensed,
            medicine_id: mappedMedicineId,
            selected_name: 'Paracetamol 500mg',
            selected_generic_name: 'Paracetamol',
            selected_company: 'Test Pharma',
            selected_unit: 'tablet',
            selected_unit_price: 500,
          }],
        };
      }

      if (lower.includes('from medicine_stock_batches')) {
        return {
          results: stockBatches ?? [{
            id: 91,
            medicine_id: 501,
            quantity_available: stockQuantity,
            purchase_price: 300,
            sale_price: 500,
          }],
        };
      }

      if (lower.includes('select id, status, sale_id') && lower.includes('from medication_orders')) {
        return {
          first: { id: 'order-new', status: 'partially_fulfilled', sale_id: 74 },
        };
      }

      return null;
    },
  });
}

function makeApp(fixture: DispenseFixture = {}, role = 'pharmacist') {
  const mockDB = makeDispenseDB(fixture);
  const { app } = createTestApp({
    route: prescriptionFulfilmentRoutes,
    routePath: '/prescriptions',
    role,
    tenantId: 'tenant-1',
    userId: 7,
    mockDB,
  });
  return { app, mockDB };
}

describe('hospital prescription fulfilment', () => {
  it('requires the counter payment method instead of silently assuming cash', async () => {
    const { app } = makeApp();
    const { paymentMethod: _paymentMethod, ...withoutPaymentMethod } = validRequest;

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: withoutPaymentMethod,
    });

    expect(res.status).toBe(400);
  });

  it('rejects a client-supplied sale price so pricing remains server controlled', async () => {
    const { app } = makeApp();

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: {
        ...validRequest,
        items: [{ ...validRequest.items[0], unitPrice: 1 }],
      },
    });

    expect(res.status).toBe(400);
  });

  it('rejects doctors from dispensing medicine stock', async () => {
    const { app, mockDB } = makeApp({}, 'doctor');

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: validRequest,
    });

    expect(res.status).toBe(403);
    expect(mockDB.queries).toHaveLength(0);
  });

  it('rejects a non-final prescription before creating a fulfilment order', async () => {
    const { app, mockDB } = makeApp({ prescriptionStatus: 'draft' });

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: validRequest,
    });

    expect(res.status).toBe(409);
    expect(mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n'))
      .not.toContain('insert into medication_orders');
  });

  it('rejects selection of a medicine not mapped by the prescription item', async () => {
    const { app } = makeApp({ mappedMedicineId: 900 });

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: validRequest,
    });

    expect(res.status).toBe(409);
  });

  it('only dispenses a mapped hospital medicine while it remains active in the catalog', async () => {
    const { app, mockDB } = makeApp();

    await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: validRequest,
    });

    const itemSelection = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('from prescription_items') &&
      query.sql.toLowerCase().includes('join medicines'));
    expect(itemSelection?.sql.toLowerCase()).toContain('m.is_active = 1');
  });

  it('reads the mapped hospital medicine sale price from medicines.unit_price', async () => {
    const { app, mockDB } = makeApp();

    await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: validRequest,
    });

    const itemSelection = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('from prescription_items') &&
      query.sql.toLowerCase().includes('join medicines'));
    expect(itemSelection?.sql.toLowerCase()).toContain('m.unit_price as selected_unit_price');
    expect(itemSelection?.sql.toLowerCase()).not.toContain('m.price as selected_unit_price');
  });

  it('rejects quantities exceeding prescribed remaining quantity', async () => {
    const { app } = makeApp({ prescribedQuantity: 2, alreadyDispensed: 1 });

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: validRequest,
    });

    expect(res.status).toBe(409);
  });

  it('rejects dispensing when non-expired stock is insufficient', async () => {
    const { app } = makeApp({ stockQuantity: 1 });

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: validRequest,
    });

    expect(res.status).toBe(409);
  });

  it('depletes FEFO batches across separate prescription lines for the same medicine', async () => {
    const { app, mockDB } = makeApp({
      prescriptionItems: [
        {
          prescription_item_id: 11,
          medicine_name: 'Paracetamol morning',
          quantity: 2,
          dispensed_qty: 0,
          medicine_id: 501,
          selected_name: 'Paracetamol 500mg',
          selected_unit_price: 500,
        },
        {
          prescription_item_id: 12,
          medicine_name: 'Paracetamol evening',
          quantity: 2,
          dispensed_qty: 0,
          medicine_id: 501,
          selected_name: 'Paracetamol 500mg',
          selected_unit_price: 500,
        },
      ],
      stockBatches: [
        { id: 91, medicine_id: 501, quantity_available: 3, purchase_price: 300, sale_price: 500 },
        { id: 92, medicine_id: 501, quantity_available: 2, purchase_price: 300, sale_price: 500 },
      ],
    });

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: {
        ...validRequest,
        items: [
          { prescriptionItemId: 11, medicineId: 501, quantity: 2 },
          { prescriptionItemId: 12, medicineId: 501, quantity: 2 },
        ],
      },
    });

    expect(res.status).toBe(201);
    const batchUpdates = mockDB.queries
      .filter((query) => query.sql.toLowerCase().includes('update medicine_stock_batches'));
    const deductedByBatch = batchUpdates.reduce((deductions, query) => {
      const batchId = Number(query.params[1]);
      deductions.set(batchId, (deductions.get(batchId) ?? 0) + Number(query.params[0]));
      return deductions;
    }, new Map<number, number>());
    expect(deductedByBatch.get(91)).toBe(3);
    expect(deductedByBatch.get(92)).toBe(1);
  });

  it('commits hospital dispensing through order records without changing clinical prescription status', async () => {
    const { app, mockDB } = makeApp();

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: validRequest,
    });

    expect(res.status).toBe(201);
    const recordedSql = mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n');
    expect(recordedSql).toContain('insert into medication_orders');
    expect(recordedSql).toContain('insert into medication_order_items');
    expect(recordedSql).toContain('insert into pharmacy_sales');
    expect(recordedSql).toContain('insert or ignore into accounting_posting_events');
    expect(recordedSql).not.toContain('update prescriptions set status');
    expect(recordedSql).not.toContain("'prescriptions'");
    expect(recordedSql).toContain("'pharmacy_sales'");
    const saleInsert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into pharmacy_sales'));
    expect(saleInsert?.params).toContain(1000);
    expect(saleInsert?.params).toContain('cash');
  });

  it('records the selected non-cash counter payment method', async () => {
    const { app, mockDB } = makeApp();

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: { ...validRequest, paymentMethod: 'bkash' },
    });

    expect(res.status).toBe(201);
    const saleInsert = mockDB.queries.find((query) => query.sql.toLowerCase().includes('insert into pharmacy_sales'));
    expect(saleInsert?.params).toContain('bkash');
  });

  it('returns the completed order for a replayed idempotency key without new writes', async () => {
    const requestHash = await createIdempotencyRequestHash({
      prescriptionId: 1,
      paymentMethod: validRequest.paymentMethod,
      items: validRequest.items,
    });
    const { app, mockDB } = makeApp({ replay: { requestHash } });

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: validRequest,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: 'order-existing', idempotent: true });
    expect(mockDB.queries.map((query) => query.sql.toLowerCase()).join('\n'))
      .not.toContain('insert into medication_orders');
  });

  it('does not replay a dispense idempotency key with a different payment method', async () => {
    const requestHash = await createIdempotencyRequestHash({
      prescriptionId: 1,
      paymentMethod: validRequest.paymentMethod,
      items: validRequest.items,
    });
    const { app } = makeApp({ replay: { requestHash } });

    const res = await jsonRequest(app, '/prescriptions/1/hospital-dispense', {
      method: 'POST',
      body: { ...validRequest, paymentMethod: 'card' },
    });

    expect(res.status).toBe(409);
  });
});
