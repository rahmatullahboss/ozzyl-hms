import { describe, expect, it } from 'vitest';
import dashboardRoutes, { getAccountingIncomeSourceSql } from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type Breakdown = {
  metric: string;
  title: string;
  total: number;
  valueType: 'money' | 'count';
  totalRows: number;
  sources: Array<{ label: string; amount: number; count: number; key?: string; doctorId?: number }>;
  rows: Array<Record<string, unknown>>;
};

describe('admin dashboard management KPI drilldowns', () => {
  it('returns lab income grouped test-wise with invoice details', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes("where source_label = 'lab'") && lower.includes('group by service_name')) {
          return { results: [{ source_label: 'CBC', amount: 600, row_count: 2 }] };
        }
        if (lower.includes("where pa.source_label = 'lab'") && lower.includes('order by pa.occurred_at desc')) {
          return { results: [{
            id: 'lab-1', occurred_at: '2026-07-10', source_type: 'payment', source_label: 'CBC', reference_no: 'R-1', amount: 600, status: 'posted', payment_method: 'cash',
            bill_id: 101, invoice_no: 'INV-1', patient_name: 'Patient A', patient_code: 'P-101', service_names: 'CBC', item_count: 2,
            gross_amount: 700, discount_amount: 100, net_amount: 600, paid_amount: 600, due_amount: 0,
          }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=lab_income&date=2026-07-10');
    expect(res.status).toBe(200);
    const body = await res.json() as Breakdown;
    expect(body).toMatchObject({ metric: 'lab_income', title: 'Diagnostic / Laboratory Collection', total: 600, valueType: 'money', totalRows: 2 });
    expect(body.sources).toEqual([{ label: 'CBC', amount: 600, count: 2 }]);
    expect(body.rows[0]).toMatchObject({
      billId: 101,
      invoiceNo: 'INV-1',
      patientName: 'Patient A',
      patientCode: 'P-101',
      serviceNames: 'CBC',
      paymentMethod: 'cash',
      grossAmount: 700,
      discountAmount: 100,
      netAmount: 600,
      paidAmount: 600,
      dueAmount: 0,
    });
  });

  it.each([
    ['opd_income', 'OPD / Doctor Visit Collection', 'OPD', 500],
    ['ot_income', 'OT / Procedure Collection', 'OT', 200],
    ['pharmacy_income', 'Pharmacy / Medicine Collection', 'Pharmacy', 100],
    ['radiology_income', 'Radiology / Imaging Collection', 'Radiology', 75],
    ['uncategorized_income', 'Uncategorized Services', 'Uncategorized', 25],
  ])('returns %s as a dedicated collection KPI instead of one catch-all Other Income card', async (metric, title, sourceLabel, amount) => {
    const sourceSql = getAccountingIncomeSourceSql([sourceLabel]);
    expect(sourceSql).toContain("IN ('radiology', 'imaging') THEN 'Radiology'");
    expect(sourceSql).toContain("WHEN pb.admission_id IS NOT NULL THEN 'IPD'");
    expect(sourceSql).not.toContain("'diagnostic', 'radiology', 'imaging') THEN 'Lab'");

    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from payment_allocations') && lower.includes('where source_label in (?)')) {
          return { results: [{ source_label: sourceLabel, amount, row_count: 1 }] };
        }
        if (lower.includes('from payment_allocations pa') && lower.includes('where pa.source_label in (?)')) {
          return { results: [{
            id: `${sourceLabel.toLowerCase()}-1`, occurred_at: '2026-07-10 10:00:00', source_type: 'payment', source_label: sourceLabel,
            reference_no: `R-${sourceLabel}`, amount, status: 'posted', payment_method: 'cash', bill_id: 200,
            invoice_no: `INV-${sourceLabel}`, patient_name: 'Category Patient', patient_code: 'P-200',
            service_names: `${sourceLabel} service`, item_count: 1, gross_amount: amount + 50, discount_amount: 50,
            net_amount: amount, paid_amount: amount, due_amount: 0,
          }] };
        }
        return null;
      },
    });

    const res = await app.request(`/dashboard/kpi-breakdown?metric=${metric}&date=2026-07-10`);
    expect(res.status).toBe(200);
    const body = await res.json() as Breakdown;
    expect(body).toMatchObject({ metric, title, total: amount, valueType: 'money', totalRows: 1 });
    expect(body.sources).toEqual([{ label: sourceLabel, amount, count: 1 }]);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      billId: 200,
      invoiceNo: `INV-${sourceLabel}`,
      patientName: 'Category Patient',
      patientCode: 'P-200',
      serviceNames: `${sourceLabel} service`,
      paymentMethod: 'cash',
      grossAmount: amount + 50,
      discountAmount: 50,
      netAmount: amount,
      paidAmount: amount,
      dueAmount: 0,
    });
  });

  it('returns deposits from the patient advance ledger across payment methods', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from billing_deposits d') && lower.includes("= 'deposit'") && lower.includes('group by source_label')) {
          return {
            results: [
              { source_label: 'Cash', amount: 700, row_count: 2 },
              { source_label: 'bKash', amount: 300, row_count: 1 },
            ],
          };
        }
        if (lower.includes('from billing_deposits d') && lower.includes("= 'deposit'") && lower.includes('order by occurred_at desc')) {
          return { results: [{
            id: 'deposit-10', occurred_at: '2026-07-10 11:00:00', source_type: 'deposit_collection', source_label: 'bKash',
            reference_no: 'DEP-10', counter_name: 'Reception', user_name: 'Cashier A', amount: 300, status: 'posted',
            bill_id: null, invoice_no: null, patient_name: 'Deposit Patient', patient_code: 'P-DEP', payment_method: 'bkash',
            service_names: 'Patient deposit / advance receipt', item_count: 1,
          }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=deposit_collection&date=2026-07-10');
    expect(res.status).toBe(200);
    const body = await res.json() as Breakdown;
    expect(body).toMatchObject({ metric: 'deposit_collection', title: 'Deposits / Advances', total: 1000, valueType: 'money', totalRows: 3 });
    expect(body.sources.map((source) => source.label)).toEqual(['Cash', 'bKash']);
    expect(body.rows[0]).toMatchObject({
      billId: null,
      invoiceNo: 'DEP-10',
      patientName: 'Deposit Patient',
      patientCode: 'P-DEP',
      paymentMethod: 'bkash',
      referenceNo: 'DEP-10',
      sourceLabel: 'bKash',
      serviceNames: 'Patient deposit / advance receipt',
      amount: 300,
    });
  });

  it('returns doctor-wise commission accruals without treating them as paid expenses', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from doctor_commission_accruals dca') && lower.includes('group by dca.doctor_id')) {
          return { results: [{ source_label: 'Dr A', amount: 400, row_count: 3 }] };
        }
        if (lower.includes('from doctor_commission_accruals dca') && lower.includes('order by occurred_at desc')) {
          return { results: [{ id: 'commission-1', occurred_at: '2026-07-10', source_type: 'commission', source_label: 'Dr A', reference_no: 'INV-1', amount: 400, status: 'approved', invoice_no: 'INV-1', patient_name: 'Patient A', service_names: 'consultation_fee' }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=total_commission&date=2026-07-10');
    expect(res.status).toBe(200);
    const body = await res.json() as Breakdown;
    expect(body).toMatchObject({ metric: 'total_commission', title: 'Total Doctor Commission', total: 400, valueType: 'money', totalRows: 3 });
    expect(body.sources[0]).toMatchObject({ label: 'Dr A', amount: 400, count: 3 });
  });

  it('filters test commission by doctor and returns one grouped row per invoice', async () => {
    let sawDoctorBoundSourceQuery = false;
    let sawDoctorBoundGroupedDetailQuery = false;

    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_commission:test_commission:sources')) {
          sawDoctorBoundSourceQuery = params.includes(17);
          expect(lower).toContain('count(distinct');
          expect(lower).toContain('dca.doctor_id = ?');
          return {
            results: [{ source_label: 'Dr A', source_key: 17, doctor_id: 17, amount: 300, row_count: 1 }],
          };
        }
        if (lower.includes('executive_commission:test_commission:details')) {
          sawDoctorBoundGroupedDetailQuery = params.includes(17);
          expect(lower).toContain('group_concat');
          expect(lower).toContain('group by dca.doctor_id');
          return {
            results: [{
              id: 'commission-invoice-17-bill-91',
              occurred_at: '2026-07-23 12:00:00',
              source_type: 'commission',
              source_label: 'Dr A',
              reference_no: 'INV-91',
              amount: 300,
              status: 'approved',
              bill_id: 91,
              invoice_no: 'INV-91',
              patient_name: 'Patient A',
              patient_code: 'P-1',
              service_names: 'CBC, Lipid Profile',
              item_count: 2,
              gross_amount: 1200,
              discount_amount: 0,
              net_amount: 1200,
              paid_amount: 1200,
              due_amount: 0,
            }],
          };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=test_commission&date=2026-07-23&doctorId=17');
    expect(res.status).toBe(200);
    const body = await res.json() as Breakdown;
    expect(sawDoctorBoundSourceQuery).toBe(true);
    expect(sawDoctorBoundGroupedDetailQuery).toBe(true);
    expect(body).toMatchObject({ metric: 'test_commission', total: 300, valueType: 'money', totalRows: 1 });
    expect(body.sources[0]).toMatchObject({ label: 'Dr A', amount: 300, count: 1, key: '17', doctorId: 17 });
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      billId: 91,
      invoiceNo: 'INV-91',
      patientName: 'Patient A',
      serviceNames: 'CBC, Lipid Profile',
      itemCount: 2,
      amount: 300,
    });
  });

  it.each(['abc', '0', '-2', '1.5'])('rejects invalid commission doctorId %s', async (doctorId) => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request(`/dashboard/kpi-breakdown?metric=test_commission&date=2026-07-23&doctorId=${doctorId}`);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'doctorId must be a positive integer' });
  });

  it('rejects doctorId on a non-commission KPI', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=lab_income&date=2026-07-23&doctorId=17');
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'doctorId is only supported for commission metrics' });
  });

  it('returns total visits as a count while retaining doctor-wise billed amounts', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('group by resolved_doctor_id')) {
          expect(lower).toContain('union all');
          expect(lower).toContain('coalesce(b.doctor_visit_bill, 0) > 0');
          expect(lower).toContain('not exists');
          return { results: [{ source_label: 'Dr A', amount: 900, row_count: 4 }] };
        }
        if (lower.includes('from invoice_items ii') && lower.includes('order by occurred_at desc')) {
          return { results: [{ id: 'visit-1', occurred_at: '2026-07-10', source_type: 'visit', source_label: 'Dr A', reference_no: 'INV-1', amount: 300, status: 'posted', invoice_no: 'INV-1', patient_name: 'Patient A', service_names: 'Consultation', item_count: 1 }] };
        }
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=total_visits&date=2026-07-10');
    expect(res.status).toBe(200);
    const body = await res.json() as Breakdown;
    expect(body).toMatchObject({ metric: 'total_visits', title: 'Total Visits', total: 4, valueType: 'count', totalRows: 4 });
    expect(body.sources[0]).toMatchObject({ label: 'Dr A', amount: 900, count: 4 });
  });

  it('combines canonical, expense, and final handover approvals', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql) => {
        const lower = sql.toLowerCase();
        if (lower.includes('from approval_requests') && lower.includes('group by source_label')) return { results: [{ source_label: 'bill_cancel', amount: 0, row_count: 2 }] };
        if (lower.includes('from expenses') && lower.includes('group by source_label')) return { results: [{ source_label: 'expense', amount: 3000, row_count: 1 }] };
        if (lower.includes('from billing_handovers') && lower.includes('group by source_label')) return { results: [{ source_label: 'cash_handover', amount: 5000, row_count: 1 }] };
        if (lower.includes('union all') && lower.includes('approval_requests') && lower.includes('billing_handovers')) return { results: [] };
        return null;
      },
    });

    const res = await app.request('/dashboard/kpi-breakdown?metric=pending_approvals&date=2026-07-10');
    expect(res.status).toBe(200);
    const body = await res.json() as Breakdown;
    expect(body).toMatchObject({ metric: 'pending_approvals', title: 'Pending Approvals', total: 4, valueType: 'count', totalRows: 4 });
    expect(body.sources.map((source) => source.label)).toEqual(['bill_cancel', 'expense', 'cash_handover']);
  });
});
