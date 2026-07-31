import { describe, expect, it } from 'vitest';
import ipBillingRoutes from '../../../src/routes/tenant/ipBilling';
import { createTestApp } from '../helpers/test-app';

const requestPath = '/ip-billing/stats?from=2026-07-01&to=2026-07-17&page=2&pageSize=2';

describe('IP billing period-aware statistics', () => {
  it('returns the resolved inclusive period and stable pagination metadata', async () => {
    const { app } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        if (normalized.includes('ipd_activity_count')) return { results: [{ count: 5 }] };
        if (normalized.includes('ipd_activity_details')) {
          return { results: [
            { bill_id: 12, invoice_no: 'IPD-12', admission_id: 102, admission_no: 'ADM-102', patient_name: 'Patient 2', patient_code: 'P-2', gross_amount: 800, discount_amount: 0, net_amount: 800, payment_amount: 500, cash_amount: 500, non_cash_amount: 0, deposit_received_today: 0, total_received_today: 500, deposit_applied: 0, due_amount: 300, status: 'partial', payment_method: 'cash', service_names: 'Cabin', item_count: 1, occurred_at: '2026-07-16 12:00:00' },
            { bill_id: 11, invoice_no: 'IPD-11', admission_id: 101, admission_no: 'ADM-101', patient_name: 'Patient 1', patient_code: 'P-1', gross_amount: 600, discount_amount: 100, net_amount: 500, payment_amount: 500, cash_amount: 0, non_cash_amount: 500, deposit_received_today: 0, total_received_today: 500, deposit_applied: 0, due_amount: 0, status: 'paid', payment_method: 'bKash', service_names: 'Admission Fee', item_count: 1, occurred_at: '2026-07-15 12:00:00' },
          ] };
        }
        return null;
      },
    });

    const response = await app.request(requestPath);
    expect(response.status).toBe(200);
    const body = await response.json() as Record<string, any>;

    expect(body.period).toEqual({ startDate: '2026-07-01', endDate: '2026-07-17', label: '2026-07-01 → 2026-07-17', preset: 'custom' });
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.totalActivityRows).toBe(5);
    expect(body.hasNextPage).toBe(true);
    expect(body.activity).toHaveLength(2);
    expect(body.today_activity).toEqual(body.activity);
  });

  it.each([
    '/ip-billing/stats?from=17-07-2026&to=2026-07-17',
    '/ip-billing/stats?from=2026-07-18&to=2026-07-17',
    '/ip-billing/stats?from=2026-07-01&to=2026-07-17&page=0',
    '/ip-billing/stats?from=2026-07-01&to=2026-07-17&pageSize=0',
  ])('rejects invalid period or pagination before querying: %s', async (path) => {
    const { app, mockDB } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const response = await app.request(path);
    expect(response.status).toBe(400);
    expect(mockDB.queries).toHaveLength(0);
    expect(mockDB.batchCalls).toHaveLength(0);
  });

  it('uses selected end date for as-of admission snapshots and selected range for events', async () => {
    const { app, mockDB } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const response = await app.request('/ip-billing/stats?from=2026-07-10&to=2026-07-12');
    expect(response.status).toBe(200);

    const sql = mockDB.batchCalls.flat().join('\n');
    expect(sql).toContain('ipd_as_of_inpatients');
    expect(sql).toContain('ipd_as_of_pending_billing');
    expect(sql).toContain('ipd_as_of_provisional_due');
    expect(sql).toContain('finalized.cancelled_at');
    expect(sql).toContain("finalized.status <> 'cancelled'");
    expect(sql).toContain('ipd_period_charges');
    expect(sql).toContain('ipd_period_payments');
    expect(sql).toContain('d.admission_id');
    expect(sql).not.toContain("d.remarks LIKE 'Admission deposit for %'");
    expect(sql).toContain("'+6 hours'");

    const allParams = mockDB.queries.flatMap((query) => query.params);
    expect(allParams).toContain('2026-07-10');
    expect(allParams).toContain('2026-07-12');
  });

  it('uses LIMIT/OFFSET only for activity details while global activity count stays separate', async () => {
    const { app, mockDB } = createTestApp({
      route: ipBillingRoutes,
      routePath: '/ip-billing',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const response = await app.request(requestPath);
    expect(response.status).toBe(200);

    const countQuery = mockDB.queries.find((query) => query.sql.includes('ipd_activity_count'));
    const detailQuery = mockDB.queries.find((query) => query.sql.includes('ipd_activity_details'));
    expect(countQuery?.sql.toLowerCase()).not.toContain('limit ?');
    expect(detailQuery?.sql.toLowerCase()).toContain('limit ? offset ?');
    expect(detailQuery?.params.slice(-2)).toEqual([2, 2]);
  });
});
