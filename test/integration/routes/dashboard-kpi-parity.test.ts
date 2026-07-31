import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type SummaryMetric = {
  metric: string;
  title: string;
  total: number;
  valueType: 'money' | 'count';
};

type Breakdown = {
  metric: string;
  title: string;
  total: number;
  valueType: 'money' | 'count';
  period: { startDate: string; endDate: string };
  totalRows: number;
  rows: unknown[];
};

const periodQuery = 'preset=custom&startDate=2026-07-01&endDate=2026-07-10';

describe('executive KPI summary/drilldown parity contract', () => {
  it('keeps every server-whitelisted card total and value type equal to its drilldown', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-parity',
      queryOverride: (sql) => sql.toLowerCase().includes('limit ? offset ?') ? { results: [] } : null,
    });

    const summaryResponse = await app.request(`/dashboard/kpi-summary?${periodQuery}`);
    expect(summaryResponse.status).toBe(200);
    const summary = await summaryResponse.json() as {
      period: { startDate: string; endDate: string };
      metrics: SummaryMetric[];
    };

    expect(summary.period).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-10' });
    expect(summary.metrics.length).toBeGreaterThanOrEqual(40);
    expect(new Set(summary.metrics.map((item) => item.metric)).size).toBe(summary.metrics.length);

    for (const card of summary.metrics) {
      const response = await app.request(`/dashboard/kpi-breakdown?metric=${encodeURIComponent(card.metric)}&${periodQuery}&page=1&pageSize=2`);
      expect(response.status, `${card.metric} drilldown status`).toBe(200);
      const drilldown = await response.json() as Breakdown;

      expect(drilldown.metric).toBe(card.metric);
      expect(drilldown.valueType, `${card.metric} value type`).toBe(card.valueType);
      expect(drilldown.total, `${card.metric} card/drilldown total`).toBe(card.total);
      expect(drilldown.period).toMatchObject({ startDate: '2026-07-01', endDate: '2026-07-10' });
      expect(Number.isFinite(drilldown.total)).toBe(true);
      expect(drilldown.totalRows, `${card.metric} totalRows`).toBeGreaterThanOrEqual(drilldown.rows.length);
    }
  });

  it('keeps every service collection card equal to its non-zero dedicated drilldown', async () => {
    const cases = [
      { metric: 'opd_income', source: 'OPD', amount: 500, kind: 'allocation' },
      { metric: 'lab_income', source: 'CBC', amount: 600, kind: 'lab' },
      { metric: 'ipd_collection', source: 'Admission/IPD collection', amount: 700, kind: 'ipd' },
      { metric: 'ot_income', source: 'OT', amount: 200, kind: 'allocation' },
      { metric: 'pharmacy_income', source: 'Pharmacy', amount: 100, kind: 'allocation' },
      { metric: 'radiology_income', source: 'Radiology', amount: 75, kind: 'allocation' },
      { metric: 'deposit_collection', source: 'Cash', amount: 300, kind: 'deposit' },
      { metric: 'uncategorized_income', source: 'Uncategorized', amount: 25, kind: 'allocation' },
    ] as const;

    for (const item of cases) {
      const { app } = createTestApp({
        route: dashboardRoutes,
        routePath: '/dashboard',
        role: 'hospital_admin',
        tenantId: `tenant-${item.metric}`,
        queryOverride: (sql) => {
          const lower = sql.toLowerCase();
          if (item.kind === 'allocation') {
            if (lower.includes('from payment_allocations') && lower.includes('group by source_label')) {
              return { results: [{ source_label: item.source, amount: item.amount, row_count: 1 }] };
            }
            if (lower.includes('from payment_allocations pa') && lower.includes('order by pa.occurred_at desc')) {
              return { results: [{
                id: `${item.metric}-1`, occurred_at: '2026-07-10 10:00:00', source_type: 'payment', source_label: item.source,
                reference_no: `R-${item.metric}`, amount: item.amount, status: 'posted', payment_method: 'cash', bill_id: 100,
                invoice_no: `INV-${item.metric}`, patient_name: 'Service Patient', patient_code: 'P-100', service_names: `${item.source} service`,
                item_count: 1, gross_amount: item.amount, discount_amount: 0, net_amount: item.amount, paid_amount: item.amount, due_amount: 0,
              }] };
            }
          }
          if (item.kind === 'lab') {
            if (lower.includes("where source_label = 'lab'") && lower.includes('group by service_name')) {
              return { results: [{ source_label: item.source, amount: item.amount, row_count: 1 }] };
            }
            if (lower.includes("where pa.source_label = 'lab'") && lower.includes('order by pa.occurred_at desc')) {
              return { results: [{
                id: 'lab-1', occurred_at: '2026-07-10 10:00:00', source_type: 'payment', source_label: item.source,
                reference_no: 'R-LAB', amount: item.amount, status: 'posted', payment_method: 'cash', bill_id: 101,
                invoice_no: 'INV-LAB', patient_name: 'Service Patient', patient_code: 'P-101', service_names: 'CBC', item_count: 1,
                gross_amount: item.amount, discount_amount: 0, net_amount: item.amount, paid_amount: item.amount, due_amount: 0,
              }] };
            }
          }
          if (item.kind === 'ipd') {
            if (lower.includes('join payments p') && lower.includes('b.admission_id is not null') && lower.includes('count(*)') && !lower.includes('order by')) {
              return { results: [{ total: item.amount, row_count: 1 }] };
            }
            if (lower.includes('join payments p') && lower.includes('b.admission_id is not null') && lower.includes('order by')) {
              return { results: [{
                id: 'ipd-1', occurred_at: '2026-07-10 10:00:00', source_type: 'ipd_collection', source_label: item.source,
                reference_no: 'R-IPD', amount: item.amount, status: 'paid', payment_method: 'cash', bill_id: 102,
                invoice_no: 'INV-IPD', patient_name: 'Service Patient', patient_code: 'P-102', service_names: 'Cabin', item_count: 1,
                gross_amount: item.amount, discount_amount: 0, net_amount: item.amount, paid_amount: item.amount, due_amount: 0,
              }] };
            }
          }
          if (item.kind === 'deposit') {
            if (lower.includes('from billing_deposits d') && lower.includes("= 'deposit'") && lower.includes('group by source_label')) {
              return { results: [{ source_label: item.source, amount: item.amount, row_count: 1 }] };
            }
            if (lower.includes('from billing_deposits d') && lower.includes("= 'deposit'") && lower.includes('order by occurred_at desc')) {
              return { results: [{
                id: 'deposit-1', occurred_at: '2026-07-10 10:00:00', source_type: 'deposit_collection', source_label: item.source,
                reference_no: 'DEP-1', amount: item.amount, status: 'posted', bill_id: null, invoice_no: null,
                patient_name: 'Deposit Patient', patient_code: 'P-DEP', payment_method: 'cash', service_names: 'Patient deposit / advance receipt', item_count: 1,
              }] };
            }
          }
          return null;
        },
      });

      const summaryResponse = await app.request(`/dashboard/kpi-summary?metrics=${item.metric}&${periodQuery}`);
      expect(summaryResponse.status, `${item.metric} summary status`).toBe(200);
      const summary = await summaryResponse.json() as { metrics: SummaryMetric[] };
      const card = summary.metrics[0];
      expect(card).toMatchObject({ metric: item.metric, total: item.amount, valueType: 'money' });

      const response = await app.request(`/dashboard/kpi-breakdown?metric=${item.metric}&${periodQuery}`);
      expect(response.status, `${item.metric} drilldown status`).toBe(200);
      const drilldown = await response.json() as Breakdown;
      expect(drilldown.total, `${item.metric} non-zero parity`).toBe(card.total);
      expect(drilldown.totalRows).toBe(1);
      expect(drilldown.rows).toHaveLength(1);
    }
  });

  it('keeps split commission cards equal to doctor-wise drilldowns with invoice context', async () => {
    const commissionTotals = {
      visit_commission: 100,
      test_commission: 250,
      other_doctor_commission: 325,
      total_commission: 675,
    } as const;
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-commission',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_commission:totals')) {
          return { results: [
            { source_type: 'consultation_fee', amount: 100, row_count: 1 },
            { source_type: 'lab_test', amount: 200, row_count: 1 },
            { source_type: 'referral', amount: 50, row_count: 1 },
            { source_type: 'procedure', amount: 300, row_count: 1 },
            { source_type: 'ipd_round', amount: 25, row_count: 1 },
          ] };
        }
        const metric = (Object.keys(commissionTotals) as Array<keyof typeof commissionTotals>)
          .find((key) => lower.includes(`executive_commission:${key}:`));
        if (!metric) return null;
        if (lower.includes(':sources')) {
          return { results: [{ source_label: 'Dr A', amount: commissionTotals[metric], row_count: 1 }] };
        }
        if (lower.includes(':details')) {
          return { results: [{
            id: `commission-${metric}`, occurred_at: '2026-07-10 09:00:00', source_type: 'commission', source_label: 'Dr A',
            reference_no: `INV-${metric}`, amount: commissionTotals[metric], status: 'accrued', bill_id: 501,
            invoice_no: `INV-${metric}`, patient_name: 'Commission Patient', patient_code: 'P-501', service_names: metric,
            item_count: 1, gross_amount: 1000, discount_amount: 0, net_amount: 1000, paid_amount: 900, due_amount: 100,
          }] };
        }
        return null;
      },
    });

    const metrics = Object.keys(commissionTotals) as Array<keyof typeof commissionTotals>;
    const summaryResponse = await app.request(`/dashboard/kpi-summary?metrics=${metrics.join(',')}&${periodQuery}`);
    expect(summaryResponse.status).toBe(200);
    const summary = await summaryResponse.json() as { metrics: SummaryMetric[] };

    for (const metric of metrics) {
      const card = summary.metrics.find((item) => item.metric === metric);
      expect(card).toMatchObject({ metric, total: commissionTotals[metric], valueType: 'money' });

      const response = await app.request(`/dashboard/kpi-breakdown?metric=${metric}&${periodQuery}`);
      expect(response.status).toBe(200);
      const drilldown = await response.json() as Breakdown & { rows: Array<Record<string, unknown>> };
      expect(drilldown.total).toBe(card?.total);
      expect(drilldown.totalRows).toBe(1);
      expect(drilldown.rows[0]).toMatchObject({
        billId: 501,
        invoiceNo: `INV-${metric}`,
        patientName: 'Commission Patient',
        patientCode: 'P-501',
        grossAmount: 1000,
        paidAmount: 900,
        dueAmount: 100,
      });
    }
  });
});
