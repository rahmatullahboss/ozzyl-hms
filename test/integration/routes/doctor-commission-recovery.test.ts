import { describe, expect, it } from 'vitest';
import commissionRoutes from '../../../src/routes/tenant/commissions';
import { createMockDB } from '../helpers/mock-db';
import { createTestApp } from '../helpers/test-app';

function createRecoveryApp() {
  const mockDB = createMockDB({
    queryOverride(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.includes('from doctor_commission_adjustments adjustment')) {
        return { results: [{ adjustment_id: 901, outstanding_amount: 100 }] };
      }
      if (normalized.includes('from doctor_commission_accruals a') && normalized.includes('where a.id = ?')) {
        const row = {
          id: 3,
          doctor_id: 7,
          doctor_name: 'Dr Rahman',
          doctor_specialization: 'Medicine',
          doctor_department: 'OPD',
          doctor_registration_number: 'BMDC-7',
          doctor_user_id: null,
          doctor_is_active: 1,
          commission_amount: 500,
          payable_amount: 500,
          canonical_source_key: null,
          status: 'approved',
          bill_is_paid: 1,
        };
        return { first: row, results: [row] };
      }
      if (normalized.includes('from doctor_commission_accruals a') && normalized.includes('where a.id in')) {
        return {
          results: [
            {
              id: 3,
              doctor_id: 7,
              doctor_name: 'Dr Rahman',
              doctor_specialization: 'Medicine',
              doctor_department: 'OPD',
              doctor_registration_number: 'BMDC-7',
              doctor_user_id: null,
              doctor_is_active: 1,
              commission_amount: 250,
              payable_amount: 250,
              canonical_source_key: null,
              status: 'approved',
              bill_is_paid: 1,
            },
            {
              id: 4,
              doctor_id: 7,
              doctor_name: 'Dr Rahman',
              doctor_specialization: 'Medicine',
              doctor_department: 'OPD',
              doctor_registration_number: 'BMDC-7',
              doctor_user_id: null,
              doctor_is_active: 1,
              commission_amount: 250,
              payable_amount: 250,
              canonical_source_key: null,
              status: 'approved',
              bill_is_paid: 1,
            },
          ],
        };
      }
      if (normalized.startsWith('update doctor_commission_accruals')) {
        return { success: true, meta: { changes: normalized.includes(' in (') ? 2 : 1, last_row_id: 0 } };
      }
      if (normalized.includes('select id')
        && normalized.includes('from doctor_commission_settlements')
        && normalized.includes('idempotency_key')) {
        return { first: { id: 501 } };
      }
      return null;
    },
    tables: {
      accounting_period_closes: [],
      accounting_fiscal_years: [],
      canonical_feature_flags: [],
      doctor_commission_settlements: [],
      doctor_commission_adjustments: [],
      doctor_commission_adjustment_applications: [],
      doctor_commission_accruals: [],
      bills: [],
      doctors: [],
    },
  });

  const { app } = createTestApp({
    route: commissionRoutes,
    routePath: '/commissions',
    role: 'accountant',
    tenantId: '1',
    userId: 9,
    mockDB,
  });

  return { app, mockDB };
}

function accountingPayload(mockDB: ReturnType<typeof createMockDB>) {
  const accountingEvent = mockDB.queries.find((query) =>
    /INSERT OR IGNORE INTO accounting_posting_events/i.test(query.sql));
  const raw = accountingEvent?.params.find((value) => typeof value === 'string' && value.startsWith('{'));
  return raw ? JSON.parse(String(raw)) as Record<string, unknown> : null;
}

describe('doctor commission management recovery compatibility', () => {
  it('deducts existing recovery from a single approved accrual payment', async () => {
    const { app, mockDB } = createRecoveryApp();

    const response = await app.request('/commissions/doctor-accruals/3/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paidDate: '2026-07-25', paymentMode: 'cash' }),
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(await response.json()).toMatchObject({
      grossCommissionAmount: 500,
      clawbackDeduction: 100,
      netPaidAmount: 400,
      clawbackApplications: [{ adjustmentId: 901, amount: 100 }],
    });

    expect(mockDB.queries.some((query) =>
      /INSERT OR IGNORE INTO doctor_commission_adjustment_applications/i.test(query.sql)
      && query.params.includes(100)
    )).toBe(true);
    expect(accountingPayload(mockDB)).toMatchObject({
      grossCommissionAmount: 500,
      clawbackDeduction: 100,
      netPaidAmount: 400,
    });
    expect(mockDB.batchCalls.some((batch) =>
      batch.some((sql) => /INSERT INTO doctor_commission_settlements/i.test(sql))
      && batch.some((sql) => /UPDATE doctor_commission_accruals/i.test(sql))
      && batch.some((sql) => /doctor_commission_adjustment_applications/i.test(sql))
    )).toBe(true);
  });

  it('deducts existing recovery from a bulk doctor settlement', async () => {
    const { app, mockDB } = createRecoveryApp();

    const response = await app.request('/commissions/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        doctorId: 7,
        accrualIds: [3, 4],
        paymentMode: 'cash',
        settlementDate: '2026-07-25',
      }),
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    expect(await response.json()).toMatchObject({
      grossCommissionAmount: 500,
      clawbackDeduction: 100,
      netPaidAmount: 400,
      clawbackApplications: [{ adjustmentId: 901, amount: 100 }],
      count: 2,
    });
    expect(accountingPayload(mockDB)).toMatchObject({
      grossCommissionAmount: 500,
      clawbackDeduction: 100,
      netPaidAmount: 400,
    });
  });

  it('preserves cheque mode while storing a schema-compatible settlement method', async () => {
    const { app, mockDB } = createRecoveryApp();

    const response = await app.request('/commissions/doctor-accruals/3/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paidDate: '2026-07-25', paymentMode: 'cheque' }),
    });

    const responseBody = await response.clone().json();
    expect(response.status, JSON.stringify(responseBody)).toBe(200);
    const settlementInsert = mockDB.queries.find((query) =>
      /INSERT INTO doctor_commission_settlements/i.test(query.sql));
    expect(settlementInsert?.params[4]).toBe('cheque');
    expect(settlementInsert?.params[5]).toBe('bank');
    expect(accountingPayload(mockDB)).toMatchObject({ paymentMethod: 'cheque' });
  });
});
