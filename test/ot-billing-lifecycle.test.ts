import { describe, expect, it } from 'vitest';
import otRoutes from '../src/routes/tenant/ot';
import { createTestApp, jsonRequest } from './integration/helpers/test-app';

function makeOtApp(options: {
  booking?: Record<string, unknown>;
  existingSummary?: Record<string, unknown> | null;
  linkedServices?: Record<string, unknown>[];
} = {}) {
  const booking = options.booking ?? {
    id: 77,
    tenant_id: 'tenant-1',
    patient_id: 44,
    visit_id: 33,
    is_active: 1,
    operation_status: 'scheduled',
  };
  const existingSummary = options.existingSummary ?? null;
  const linkedServices = options.linkedServices ?? [];

  return createTestApp({
    route: otRoutes,
    routePath: '/ot',
    role: 'hospital_admin',
    tenantId: 'tenant-1',
    userId: 9,
    queryOverride(sql, params) {
      const s = sql.toLowerCase();
      if (s.includes('from ot_bookings') && s.includes('where id = ?')) {
        return {
          first: booking,
          results: [booking],
          success: true,
          meta: {},
        };
      }
      if (s.includes('from ot_summaries') && s.includes('where booking_id = ?')) {
        return {
          first: existingSummary,
          results: existingSummary ? [existingSummary] : [],
          success: true,
          meta: {},
        };
      }
      if (s.includes('from ot_summaries') && s.includes('where s.id = ?')) {
        return {
          first: existingSummary,
          results: existingSummary ? [existingSummary] : [],
          success: true,
          meta: {},
        };
      }
      if (s.includes('from ot_summaries') && s.includes('where id = ?')) {
        return {
          first: existingSummary,
          results: existingSummary ? [existingSummary] : [],
          success: true,
          meta: {},
        };
      }
      if (s.includes('from visit_services') && s.includes("reference_type = 'ot_summary'")) {
        return {
          first: linkedServices[0] ?? null,
          results: linkedServices,
          success: true,
          meta: {},
        };
      }
      if (s.includes('insert into ot_summaries')) {
        return { success: true, meta: { last_row_id: 88, changes: 1 } };
      }
      if (s.includes('update visit_services')) {
        return { success: true, meta: { changes: 1 } };
      }
      if (s.includes('update ot_bookings')) {
        return { success: true, meta: { changes: 1 } };
      }
      return null;
    },
  });
}

describe('OT billing lifecycle', () => {
  it('creates a pending visit service for OT summary charges instead of bypassing central billing', async () => {
    const { app, mockDB } = makeOtApp();

    const res = await jsonRequest(app, '/ot/summary', {
      method: 'POST',
      body: {
        booking_id: 77,
        post_op_diagnosis: 'Appendicitis',
        ot_charge: 12500,
        ot_description: 'Emergency appendectomy OT charge',
        category: 'surgery',
      },
    });

    expect(res.status).toBe(201);
    const visitServiceInsert = mockDB.queries.find((query) =>
      query.sql.toLowerCase().includes('insert into visit_services')
    );
    expect(visitServiceInsert?.params).toEqual(expect.arrayContaining([
      'tenant-1',
      33,
      44,
      'procedure',
      'Emergency appendectomy OT charge',
      12500,
      'ot_summary',
      88,
      'pending',
      '9',
    ]));
  });

  it('blocks OT charge changes after the linked service has already been billed', async () => {
    const { app, mockDB } = makeOtApp({
      existingSummary: {
        id: 88,
        booking_id: 77,
        patient_id: 44,
        visit_id: 33,
        ot_charge: 12500,
      },
      linkedServices: [{ id: 501, status: 'billed', bill_id: 900, total_amount: 12500 }],
    });

    const res = await jsonRequest(app, '/ot/summary/88', {
      method: 'PUT',
      body: { ot_charge: 13000 },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('credit note'),
    });
    expect(mockDB.queries.some((query) =>
      query.sql.toLowerCase().includes('update ot_summaries')
    )).toBe(false);
  });

  it('blocks cancelling an OT booking when the linked OT service is already billed', async () => {
    const { app, mockDB } = makeOtApp({
      existingSummary: { id: 88, booking_id: 77, patient_id: 44, visit_id: 33, ot_charge: 12500 },
      linkedServices: [{ id: 501, status: 'billed', bill_id: 900, total_amount: 12500 }],
    });

    const res = await jsonRequest(app, '/ot/bookings/77/cancel', {
      method: 'PUT',
      body: { cancellation_remarks: 'Patient cancelled after payment' },
    });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: expect.stringContaining('credit note'),
    });
    expect(mockDB.queries.some((query) =>
      query.sql.toLowerCase().includes('update ot_bookings')
    )).toBe(false);
  });

  it('cancels pending OT visit services when an unpaid booking is cancelled', async () => {
    const { app, mockDB } = makeOtApp({
      existingSummary: { id: 88, booking_id: 77, patient_id: 44, visit_id: 33, ot_charge: 12500 },
      linkedServices: [{ id: 501, status: 'pending', bill_id: null, total_amount: 12500 }],
    });

    const res = await jsonRequest(app, '/ot/bookings/77/cancel', {
      method: 'PUT',
      body: { cancellation_remarks: 'Patient declined surgery' },
    });

    expect(res.status).toBe(200);
    expect(mockDB.queries.some((query) =>
      query.sql.toLowerCase().includes('update visit_services')
      && query.sql.toLowerCase().includes("status = 'cancelled'")
      && query.params.includes(501)
    )).toBe(true);
  });
});
