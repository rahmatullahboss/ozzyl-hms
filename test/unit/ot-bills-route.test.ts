import { describe, expect, it } from 'vitest';
import otRoutes from '../../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from '../integration/helpers/test-app';

const BILL: Record<string, unknown> = {
  id: 1, tenant_id: 1, booking_id: 50, patient_id: 100, visit_id: 200,
  admission_id: null, gross_amount: 15000, discount_amount: 1000,
  net_amount: 14000, status: 'draft', posted_to_ipd_bill_id: null,
  posted_by: null, posted_at: null, locked_by: null, locked_at: null,
  unlock_reason: null, review_notes: null, created_by: 1,
  created_at: '2026-06-05 10:00:00', updated_at: null,
};

const BILL_ITEMS: Record<string, unknown>[] = [
  { id: 1, tenant_id: 1, ot_bill_id: 1, charge_head: 'ot_room',
    item_id: null, inventory_consumption_id: null,
    description: 'OT Room 1 — 2 hours', quantity: 2, unit_price: 2000,
    total: 4000, doctor_id: null, is_commissionable: 0, is_billable: 1,
    created_by: 1, created_at: '2026-06-05 10:00:00' },
  { id: 2, tenant_id: 1, ot_bill_id: 1, charge_head: 'surgery',
    item_id: null, inventory_consumption_id: null,
    description: 'Appendectomy', quantity: 1, unit_price: 8000,
    total: 8000, doctor_id: 1, is_commissionable: 1, is_billable: 1,
    created_by: 1, created_at: '2026-06-05 10:00:00' },
];

function makeApp(opts: {
  bill?: Record<string, unknown> | null;
  items?: Record<string, unknown>[];
  booking?: Record<string, unknown> | null;
  insertedBillId?: number;
  insertedItemId?: number;
  updatedId?: number | null;
} = {}) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const bill = opts.bill === undefined ? BILL : opts.bill;
  const items = opts.items ?? BILL_ITEMS;
  const booking = opts.booking === undefined
    ? { id: 50, tenant_id: 1, patient_id: 100, visit_id: 200, admission_id: 5, is_active: 1 }
    : opts.booking;
  return {
    calls,
    ...createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'hospital_admin',
      tenantId: '1',
      userId: 1,
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        calls.push({ sql, params: params as unknown[] });
        if (s.includes('insert into ot_bills')) {
          return { first: { id: opts.insertedBillId ?? 42 }, results: [{ id: opts.insertedBillId ?? 42 }], success: true, meta: {} };
        }
        if (s.includes('insert into ot_bill_items')) {
          return { first: { id: opts.insertedItemId ?? 77 }, results: [{ id: opts.insertedItemId ?? 77 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_bills')) {
          if (opts.updatedId === null) return { first: null, results: [], success: true, meta: {} };
          return { first: { id: opts.updatedId ?? 1 }, results: [{ id: opts.updatedId ?? 1 }], success: true, meta: {} };
        }
        if (s.startsWith('update ot_bill_items')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.startsWith('delete from ot_bill_items')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bookings') && !s.includes('bill')) {
          return { first: booking, results: booking ? [booking] : [], success: true, meta: {} };
        }
        if (s.includes('from ot_bills') && s.includes('and id = ?')) {
          return { first: bill, results: bill ? [bill] : [], success: true, meta: {} };
        }
        if (s.includes('from ot_bills')) {
          return { first: bill, results: bill ? [bill] : [], success: true, meta: {} };
        }
        if (s.includes('from ot_bill_items')) {
          return { first: items[0] ?? null, results: items, success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    }),
  };
}

describe('GET /api/ot/bookings/:booking_id/bill', () => {
  it('returns 200 with the bill and its items', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/bill');
    expect(res.status).toBe(200);
    const body = await res.json() as { bill: { id: number; status: string; net_amount: number }; items: Array<{ charge_head: string }> };
    expect(body.bill.id).toBe(1);
    expect(body.bill.status).toBe('draft');
    expect(body.bill.net_amount).toBe(14000);
    expect(body.items.length).toBe(2);
    expect(body.items[0].charge_head).toBe('ot_room');
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/bill');
    expect(res.status).toBe(404);
  });

  it('returns 404 when no bill exists for the booking', async () => {
    const { app } = makeApp({ bill: null });
    const res = await jsonRequest(app, '/ot/bookings/50/bill');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/ot/bookings/:booking_id/bill', () => {
  it('creates a bill and returns 201', async () => {
    const { app, calls } = makeApp({ insertedBillId: 55 });
    const res = await jsonRequest(app, '/ot/bookings/50/bill', { method: 'POST' });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(55);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_bills'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(100); // patient_id from booking
  });

  it('returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/bill', { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/ot/bills/:id', () => {
  it('posts the bill and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/bills/1', {
      method: 'PUT',
      body: { status: 'posted', review_notes: 'Reviewed by accounts' },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_bills'));
    expect(upd).toBeDefined();
    expect(upd!.params).toContain('posted');
  });

  it('locks the bill and returns 200', async () => {
    const { app, calls } = makeApp();
    const res = await jsonRequest(app, '/ot/bills/1', {
      method: 'PUT',
      body: { status: 'locked' },
    });
    expect(res.status).toBe(200);
    const upd = calls.find(c => c.sql.toLowerCase().startsWith('update ot_bills'));
    expect(upd!.params).toContain('locked');
  });

  it('rejects invalid status with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bills/1', {
      method: 'PUT',
      body: { status: 'approved' },
    });
    expect(res.status).toBe(400);
  });

  it('auto-calculates commissions when bill is posted', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const commissionBillItems = [
      { id: 2, charge_head: 'surgeon_fee', doctor_id: 1, total: 20000, is_commissionable: 1 },
      { id: 3, charge_head: 'anesthesia', doctor_id: 3, total: 7000, is_commissionable: 1 },
    ];
    const commissionRules = [
      { id: 1, role: 'chief_surgeon', rule_type: 'percentage_of_surgery',
        amount: 0, percent: 15, procedure_id: null, department_id: null,
        doctor_id: null, include_emergency_surcharge: 0, priority: 10 },
      { id: 3, role: 'anesthetist', rule_type: 'fixed_amount',
        amount: 3000, percent: 0, procedure_id: null, department_id: null,
        doctor_id: null, include_emergency_surcharge: 0, priority: 10 },
    ];
    const { app } = createTestApp({
      route: otRoutes,
      routePath: '/ot',
      role: 'hospital_admin',
      tenantId: '1',
      userId: 1,
      queryOverride(sql, params) {
        const s = sql.toLowerCase();
        calls.push({ sql, params: params as unknown[] });
        if (s.startsWith('update ot_bills')) {
          return { first: { id: 1 }, results: [{ id: 1 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bills') && s.includes('where id = ?')) {
          return { first: { id: 1, booking_id: 50 }, results: [{ id: 1, booking_id: 50 }], success: true, meta: {} };
        }
        if (s.includes('from ot_bill_items')) {
          return { first: null, results: commissionBillItems, success: true, meta: {} };
        }
        if (s.includes('from ot_commission_rules')) {
          return { first: null, results: commissionRules, success: true, meta: {} };
        }
        if (s.includes('insert into ot_commissions')) {
          return { first: { id: 99 }, results: [{ id: 99 }], success: true, meta: {} };
        }
        return { first: null, results: [], success: true, meta: {} };
      },
    });
    const res = await jsonRequest(app, '/ot/bills/1', {
      method: 'PUT',
      body: { status: 'posted' },
    });
    expect(res.status).toBe(200);
    // Should have inserted 2 commission entries (surgeon 15% = 3000, anesthetist fixed 3000)
    const inserts = calls.filter(c => c.sql.toLowerCase().includes('insert into ot_commissions'));
    expect(inserts.length).toBe(2);
    expect(inserts[0].params).toContain(3000); // surgeon commission
    expect(inserts[1].params).toContain(3000); // anesthetist commission
  });
});

describe('POST /api/ot/bills/:id/items', () => {
  it('adds a line item and returns 201', async () => {
    const { app, calls } = makeApp({ insertedItemId: 88 });
    const res = await jsonRequest(app, '/ot/bills/1/items', {
      method: 'POST',
      body: {
        charge_head: 'anesthesia',
        description: 'General anesthesia — 3 hours',
        quantity: 3,
        unit_price: 1500,
        doctor_id: 2,
        is_commissionable: 1,
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: number; success: boolean };
    expect(body.id).toBe(88);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_bill_items'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain('anesthesia');
  });

  it('rejects missing charge_head with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bills/1/items', {
      method: 'POST',
      body: { description: 'Missing head' },
    });
    expect(res.status).toBe(400);
  });

  it('rejects unknown charge_head with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bills/1/items', {
      method: 'POST',
      body: { charge_head: 'parking_fee', description: 'Invalid' },
    });
    expect(res.status).toBe(400);
  });
});

// ─── Edge Cases ──────────────────────────────────────────────────────────────

describe('Bills edge cases', () => {
  it('GET /bookings/:id/bill returns 404 when no bill exists', async () => {
    const { app } = makeApp({ bill: null });
    const res = await jsonRequest(app, '/ot/bookings/50/bill');
    expect(res.status).toBe(404);
  });

  it('GET /bookings/:id/bill returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/bill');
    expect(res.status).toBe(404);
  });

  it('POST /bookings/:id/bill returns 404 when booking does not exist', async () => {
    const { app } = makeApp({ booking: null });
    const res = await jsonRequest(app, '/ot/bookings/9999/bill', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('PUT /bills/:id rejects invalid status with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bills/1', {
      method: 'PUT',
      body: { status: 'approved' },
    });
    expect(res.status).toBe(400);
  });

  it('PUT /bills/:id rejects empty body with 400', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bills/1', {
      method: 'PUT',
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it('PUT /bills/:id returns 404 when bill not found', async () => {
    const { app } = makeApp({ updatedId: null });
    const res = await jsonRequest(app, '/ot/bills/999', {
      method: 'PUT',
      body: { status: 'posted' },
    });
    expect(res.status).toBe(404);
  });

  it('POST /bills/:id/items calculates total from quantity * unit_price', async () => {
    const { app, calls } = makeApp({ insertedItemId: 88 });
    const res = await jsonRequest(app, '/ot/bills/1/items', {
      method: 'POST',
      body: {
        charge_head: 'surgery',
        description: 'Appendectomy',
        quantity: 2,
        unit_price: 5000,
      },
    });
    expect(res.status).toBe(201);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_bill_items'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(2); // quantity
    expect(insert!.params).toContain(5000); // unit_price
    expect(insert!.params).toContain(10000); // total = 2 * 5000
  });

  it('POST /bills/:id/items uses default quantity=1 when not provided', async () => {
    const { app, calls } = makeApp({ insertedItemId: 89 });
    const res = await jsonRequest(app, '/ot/bills/1/items', {
      method: 'POST',
      body: {
        charge_head: 'ot_room',
        description: 'OT Room 1',
        unit_price: 2000,
      },
    });
    expect(res.status).toBe(201);
    const insert = calls.find(c => c.sql.toLowerCase().includes('insert into ot_bill_items'));
    expect(insert).toBeDefined();
    expect(insert!.params).toContain(1); // default quantity
  });

  it('GET /bookings/:id/bill returns bill with items array', async () => {
    const { app } = makeApp();
    const res = await jsonRequest(app, '/ot/bookings/50/bill');
    expect(res.status).toBe(200);
    const body = await res.json() as { bill: { id: number }; items: Array<{ charge_head: string }> };
    expect(body.bill.id).toBe(1);
    expect(body.items.length).toBe(2);
  });
});
