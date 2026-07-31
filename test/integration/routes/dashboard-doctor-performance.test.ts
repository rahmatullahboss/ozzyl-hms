import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type DoctorPerformanceResponse = {
  period: { startDate: string; endDate: string; label: string; preset?: string };
  queryContract: {
    contractVersion: string;
    dataSource: string;
    moneyUnit: string;
    currencyCode: string;
    dateBasis: string;
    cutoverPolicy: string;
  };
  totals: {
    visits: number;
    visitCollection: number;
    visitCommission: number;
    tests: number;
    referredTests: number;
    discountedTests: number;
    testGrossAmount: number;
    testDiscountAmount: number;
    testCollection: number;
    referrerCommission: number;
    performerReserveCount: number;
    performedTests: number;
    performerReserve: number;
    testCommission: number;
    otherCommission: number;
    earnedCommission: number;
    doctorWaiver: number;
    payableCommission: number;
    paidCommission: number;
    outstandingCommission: number;
    totalCommission: number;
  };
  rows: Array<{
    doctorId: number | null;
    doctorName: string;
    visits: number;
    visitCollection: number;
    visitCommission: number;
    tests: number;
    referredTests: number;
    discountedTests: number;
    testGrossAmount: number;
    testDiscountAmount: number;
    testCollection: number;
    referrerCommission: number;
    performerReserveCount: number;
    performedTests: number;
    performerReserve: number;
    testCommission: number;
    otherCommission: number;
    earnedCommission: number;
    doctorWaiver: number;
    payableCommission: number;
    paidCommission: number;
    outstandingCommission: number;
    totalCommission: number;
    lastActivityAt: string | null;
    lastActivityType: string | null;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
  reconciliation: Record<string, {
    status: string;
    summaryTotal: number;
    detailTotal: number | null;
    detailRowCount: number;
  }>;
};

describe('executive doctor performance analytics', () => {
  it('returns doctor-wise visits, tests, collections, and disjoint commission totals', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_doctor:last_activity')) {
          expect(lower).toContain('row_number() over');
          expect(params).toEqual([
            'tenant-1', '2026-07-01', '2026-07-31',
            'tenant-1', '2026-07-01', '2026-07-31',
            'tenant-1', '2026-07-01', '2026-07-31',
            'tenant-1', '2026-07-01', '2026-07-31',
          ]);
          return {
            results: [{
              doctor_id: 11,
              last_activity_at: '2026-07-30 14:00:00',
              last_activity_type: 'commission_accrued',
            }],
          };
        }
        if (lower.includes('executive_doctor:summary')) {
          expect(lower).toContain('visit_facts as');
          expect(lower).toContain('test_facts as');
          expect(lower).toContain('commission_facts as');
          expect(lower).toContain('performer_reserve_facts as');
          expect(lower).toContain('referrer_commission_facts as');
          expect(lower).toContain('diagnostic_performer_reserves');
          expect(lower).toContain('payment_allocations as');
          expect(lower).toContain('dca.doctor_waiver_amount');
          expect(lower).toContain('round(sum(reserved_amount), 2) as performer_reserve');
          expect(lower).toContain('round(sum(payable_commission), 2) as payable_commission');
          expect(lower).toContain('nullif(v.doctor_id');
          expect(lower).toContain('coalesce(b.status');
          expect(lower).toContain("not in ('cancelled', 'refunded', 'draft')");
          expect(lower).toContain("coalesce(commission_bill.status, 'open') = 'paid'");
          expect(lower).toContain('order by payable_commission desc');
          expect(params.at(-2)).toBe(25);
          expect(params.at(-1)).toBe(25);
          return {
            results: [
              {
                doctor_id: 11,
                doctor_name: 'Dr A',
                visits: 2,
                visit_collection: 700,
                visit_commission: 100,
                tests: 1,
                referred_tests: 1,
                discounted_tests: 1,
                test_gross_amount: 500,
                test_discount_amount: 100,
                test_collection: 200,
                referrer_commission: 30,
                performer_reserve_count: 1,
                performed_tests: 1,
                performer_reserve: 20,
                test_commission: 50,
                other_commission: 10,
                earned_commission: 180,
                doctor_waiver: 20,
                payable_commission: 160,
                paid_commission: 60,
                outstanding_commission: 100,
                total_commission: 160,
                total_rows: 2,
                overall_visits: 3,
                overall_visit_collection: 1000,
                overall_visit_commission: 130,
                overall_tests: 1,
                overall_referred_tests: 1,
                overall_discounted_tests: 1,
                overall_test_gross_amount: 500,
                overall_test_discount_amount: 100,
                overall_test_collection: 200,
                overall_referrer_commission: 30,
                overall_performer_reserve_count: 1,
                overall_performed_tests: 1,
                overall_performer_reserve: 20,
                overall_test_commission: 50,
                overall_other_commission: 10,
                overall_earned_commission: 210,
                overall_doctor_waiver: 20,
                overall_payable_commission: 190,
                overall_paid_commission: 60,
                overall_outstanding_commission: 130,
                overall_total_commission: 190,
              },
            ],
          };
        }
        return null;
      },
    });

    const response = await app.request(
      '/dashboard/doctor-performance?preset=custom&startDate=2026-07-01&endDate=2026-07-31&search=Dr&sortBy=totalCommission&sortDirection=desc&page=2&pageSize=25',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as DoctorPerformanceResponse;
    expect(body.period).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      label: '2026-07-01 → 2026-07-31',
    });
    expect(body.queryContract).toEqual({
      contractVersion: 'doctor-compensation-v1',
      dataSource: 'legacy',
      moneyUnit: 'major',
      currencyCode: 'BDT',
      dateBasis: 'tenant-business-date-asia-dhaka',
      cutoverPolicy: 'explicit-provider-switch',
    });
    expect(body.rows).toEqual([
      {
        doctorId: 11,
        doctorName: 'Dr A',
        visits: 2,
        visitCollection: 700,
        visitCommission: 100,
        tests: 1,
        referredTests: 1,
        discountedTests: 1,
        testGrossAmount: 500,
        testDiscountAmount: 100,
        testCollection: 200,
        referrerCommission: 30,
        performerReserveCount: 1,
        performedTests: 1,
        performerReserve: 20,
        testCommission: 50,
        otherCommission: 10,
        earnedCommission: 180,
        doctorWaiver: 20,
        payableCommission: 160,
        paidCommission: 60,
        outstandingCommission: 100,
        totalCommission: 160,
        lastActivityAt: '2026-07-30 14:00:00',
        lastActivityType: 'commission_accrued',
      },
    ]);
    expect(body.totals).toEqual({
      visits: 3,
      visitCollection: 1000,
      visitCommission: 130,
      tests: 1,
      referredTests: 1,
      discountedTests: 1,
      testGrossAmount: 500,
      testDiscountAmount: 100,
      testCollection: 200,
      referrerCommission: 30,
      performerReserveCount: 1,
      performedTests: 1,
      performerReserve: 20,
      testCommission: 50,
      otherCommission: 10,
      earnedCommission: 210,
      doctorWaiver: 20,
      payableCommission: 190,
      paidCommission: 60,
      outstandingCommission: 130,
      totalCommission: 190,
    });
    expect(body).toMatchObject({ page: 2, pageSize: 25, totalRows: 2, hasNextPage: false });
    expect(body.reconciliation).toMatchObject({
      visitCollection: { status: 'reconciled', summaryTotal: 1000, detailTotal: 1000, detailRowCount: 3 },
      testCollection: { status: 'reconciled', summaryTotal: 200, detailTotal: 200, detailRowCount: 1 },
      payableCommission: { status: 'reconciled', summaryTotal: 190, detailTotal: 190, detailRowCount: 2 },
      paidCommission: { status: 'reconciled', summaryTotal: 60, detailTotal: 60, detailRowCount: 2 },
    });
    expect(mockDB.queries.filter((query) => query.sql.includes('executive_doctor:summary'))).toHaveLength(1);
    expect(mockDB.queries.filter((query) => query.sql.includes('executive_doctor:last_activity'))).toHaveLength(1);
    expect(JSON.stringify(mockDB.queries)).not.toContain('canonical_reporting_v1');
  });

  it('trims and caps search, and rejects unsafe sort or unsupported page sizes before SQL', async () => {
    const seenParams: unknown[][] = [];
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        if (sql.includes('executive_doctor:summary')) {
          seenParams.push(params);
          return { results: [] };
        }
        return null;
      },
    });

    const longSearch = `  ${'A'.repeat(100)}  `;
    const valid = await app.request(`/dashboard/doctor-performance?search=${longSearch}&pageSize=50`);
    expect(valid.status).toBe(200);
    expect(seenParams.flat().some((value) => typeof value === 'string' && value.length === 82 && value.startsWith('%') && value.endsWith('%'))).toBe(true);

    const badSort = await app.request('/dashboard/doctor-performance?sortBy=doctor_sql');
    expect(badSort.status).toBe(400);

    const badPageSize = await app.request('/dashboard/doctor-performance?pageSize=75');
    expect(badPageSize.status).toBe(400);

    expect(mockDB.queries.filter((query) => query.sql.includes('executive_doctor:summary'))).toHaveLength(1);
  });

  it('returns visit details using invoice lines plus the legacy doctor_visit_bill fallback', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'director',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_doctor:details:visits')) {
          expect(lower).toContain('union all');
          expect(lower).toContain('doctor_visit_bill');
          expect(lower).toContain('not exists');
          expect(lower).toContain('payment_allocations');
          expect(params).toEqual([
            'tenant-1', '2026-07-10', '2026-07-10',
            'tenant-1', 'tenant-1', 'tenant-1', 'tenant-1',
            '2026-07-10', '2026-07-10', 11, 25, 0,
          ]);
          return {
            results: [{
              id: 'visit-line-1',
              occurred_at: '2026-07-10 10:00:00',
              patient_name: 'Patient A',
              invoice_no: 'INV-1',
              service_name: 'Consultation',
              billed_amount: 500,
              collected_amount: 250,
              due_amount: 250,
              status: 'partial',
              total_rows: 1,
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/doctor-performance/details?doctorId=11&tab=visits&date=2026-07-10&pageSize=25');
    expect(response.status).toBe(200);
    const body = await response.json() as { doctorId: number | null; tab: string; rows: Array<Record<string, unknown>>; totalRows: number };
    expect(body).toMatchObject({ doctorId: 11, tab: 'visits', totalRows: 1 });
    expect(body.rows[0]).toMatchObject({
      patientName: 'Patient A',
      invoiceNo: 'INV-1',
      billedAmount: 500,
      collectedAmount: 250,
      dueAmount: 250,
    });
  });

  it('attributes test business to the referring doctor while exposing the ordering doctor separately', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_doctor:details:tests')) {
          expect(lower).toContain('lo.ordered_by');
          expect(lower).toContain('lo.ordering_clinician_doctor_id');
          expect(lower).toContain('ou.id = lo.ordered_by');
          expect(lower).not.toContain('od.user_id = lo.ordered_by');
          expect(lower).toContain("lower(trim(coalesce(ii.item_category, ''))) = 'test'");
          expect(lower).toContain('loi.id = ii.reference_id');
          expect(params).toEqual([
            'tenant-1', '2026-07-10', '2026-07-10',
            'tenant-1', 'tenant-1', 'tenant-1',
            'tenant-1', '2026-07-10', '2026-07-10',
            'tenant-1', '2026-07-10', '2026-07-10',
            11, 25, 0,
          ]);
          return {
            results: [{
              id: 501,
              occurred_at: '2026-07-10 11:00:00',
              test_name: 'CBC',
              patient_name: 'Patient A',
              referring_doctor_name: 'Dr A',
              ordering_doctor_name: 'Dr B',
              ordering_clinician_id: 22,
              ordering_clinician_name: 'Dr B',
              entered_by_user_id: 77,
              entered_by_name: 'Reception User',
              performing_doctor_id: 33,
              performing_doctor_name: 'Dr Performer',
              invoice_no: 'INV-2',
              accession_no: 'ACC-1',
              status: 'verified',
              billed_amount: 500,
              collected_amount: 200,
              due_amount: 300,
              test_commission: 50,
              total_rows: 1,
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/doctor-performance/details?doctorId=11&tab=tests&date=2026-07-10&pageSize=25');
    expect(response.status).toBe(200);
    const body = await response.json() as { rows: Array<Record<string, unknown>> };
    expect(body.rows[0]).toMatchObject({
      testName: 'CBC',
      referringDoctorName: 'Dr A',
      orderingDoctorName: 'Dr B',
      orderingClinicianId: 22,
      orderingClinicianName: 'Dr B',
      enteredByUserId: 77,
      enteredByName: 'Reception User',
      performingDoctorId: 33,
      performingDoctorName: 'Dr Performer',
      collectedAmount: 200,
      testCommission: 50,
    });
  });

  it('keeps unassigned doctors as null and never coerces them to doctor ID zero', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        if (sql.includes('executive_doctor:details:commissions')) {
          expect(sql.toLowerCase()).toContain('resolved_doctor_id is null');
          expect(sql.toLowerCase()).toContain("'performer_reserve' as source_type");
          expect(params).toEqual([
            'tenant-1', '2026-07-10', '2026-07-10',
            'tenant-1', '2026-07-10', '2026-07-10',
            25, 0,
          ]);
          return {
            results: [{
              id: 91,
              occurred_at: '2026-07-10',
              source_type: 'referral',
              doctor_name: 'Unassigned Doctor',
              reference_no: 'ACCRUAL-91',
              amount: 25,
              status: 'accrued',
              total_rows: 1,
            }],
          };
        }
        return null;
      },
    });

    const response = await app.request('/dashboard/doctor-performance/details?doctorId=unassigned&tab=commissions&date=2026-07-10&pageSize=25');
    expect(response.status).toBe(200);
    const body = await response.json() as { doctorId: number | null; rows: Array<Record<string, unknown>> };
    expect(body.doctorId).toBeNull();
    expect(body.rows[0]).toMatchObject({ sourceType: 'referral', amount: 25 });
    expect(mockDB.queries.some((query) => query.sql.toLowerCase().includes('dca.doctor_id = 0'))).toBe(false);
  });
});
