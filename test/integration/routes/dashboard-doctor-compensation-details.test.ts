import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

describe('executive doctor compensation detail contract', () => {
  it('returns performer reserve ledger facts as a separate source and role', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (lower.includes('executive_doctor:summary')) {
          return {
            results: [{
              doctor_id: 7,
              doctor_name: 'Dr. Amina Rahman',
              visits: 2,
              referred_tests: 3,
              discounted_tests: 1,
              test_gross_amount: 1700,
              test_discount_amount: 100,
              performed_tests: 1,
              performer_reserve: 200,
              earned_commission: 300,
              doctor_waiver: 100,
              payable_commission: 200,
              paid_commission: 0,
              outstanding_commission: 200,
              total_rows: 1,
              overall_visits: 2,
              overall_referred_tests: 3,
              overall_discounted_tests: 1,
              overall_test_gross_amount: 1700,
              overall_test_discount_amount: 100,
              overall_performed_tests: 1,
              overall_performer_reserve: 200,
              overall_earned_commission: 300,
              overall_doctor_waiver: 100,
              overall_payable_commission: 200,
              overall_paid_commission: 0,
              overall_outstanding_commission: 200,
            }],
          };
        }
        if (!lower.includes('executive_doctor:details:commissions')) return null;

        expect(lower).toContain('union all');
        expect(lower).toContain('diagnostic_performer_reserves');
        expect(lower).toContain('-r.id as id');
        expect(lower).toContain("'performer_reserve' as source_type");
        expect(lower).toContain("'performer' as incentive_type");
        expect(lower).toContain('lab_test_catalog');
        expect(lower).toContain('detail_name');
        expect(lower).toContain('commission_rule_version_snapshot');
        expect(lower).toContain('doctor_commission_adjustments');
        expect(lower).toContain('commission_reason_code');
        expect(lower).toContain("not in ('cancelled', 'reversed')");
        expect(params).toEqual([
          'tenant-1', '2026-07-10', '2026-07-10',
          'tenant-1', '2026-07-10', '2026-07-10',
          7, 25, 0,
        ]);

        return {
          results: [{
            id: -17,
            occurred_at: '2026-07-10 11:00:00',
            source_type: 'performer_reserve',
            incentive_type: 'performer',
            doctor_name: 'Dr. Amina Rahman',
            detail_name: 'S. Creatinine',
            reference_no: 'INV-17',
            bill_id: 17,
            commission_rule_id: 77,
            commission_rule_version: null,
            adjustment_amount: 0,
            reason_code: 'rule_matched',
            reason_label: 'Rule matched',
            gross_amount: 700,
            discount_amount: 100,
            net_billed_amount: 600,
            performer_reserve_amount: 200,
            commission_base_amount: 600,
            rate_label: 'Flat ৳200',
            earned_amount: 200,
            waiver_amount: 0,
            payable_amount: 200,
            paid_amount: 0,
            outstanding_amount: 200,
            settlement_no: null,
            waiver_reason: null,
            amount: 200,
            status: 'reserved',
            total_rows: 1,
          }],
        };
      },
    });

    const response = await app.request(
      '/dashboard/doctor-performance/details?doctorId=7&tab=commissions&date=2026-07-10&pageSize=25',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      doctorId: number | null;
      tab: string;
      queryContract: Record<string, unknown>;
      summary: Record<string, unknown>;
      rows: Array<Record<string, unknown>>;
      totalRows: number;
      reconciliation: Record<string, {
        status: string;
        summaryTotal: number;
        detailTotal: number | null;
        detailRowCount: number;
      }>;
    };

    expect(body).toMatchObject({
      doctorId: 7,
      tab: 'commissions',
      totalRows: 1,
      queryContract: {
        contractVersion: 'doctor-compensation-v1',
        dataSource: 'legacy',
        moneyUnit: 'major',
        currencyCode: 'BDT',
        dateBasis: 'tenant-business-date-asia-dhaka',
        cutoverPolicy: 'explicit-provider-switch',
      },
      summary: {
        visits: 2,
        referredTests: 3,
        discountedTests: 1,
        testGrossAmount: 1700,
        testDiscountAmount: 100,
        performedTests: 1,
        performerReserveAmount: 200,
        earnedCommission: 300,
        doctorWaiver: 100,
        payableCommission: 200,
        paidCommission: 0,
        outstandingCommission: 200,
      },
    });
    expect(body.reconciliation).toMatchObject({
      payableCommission: { status: 'reconciled', summaryTotal: 200, detailTotal: 200, detailRowCount: 1 },
      paidCommission: { status: 'reconciled', summaryTotal: 0, detailTotal: 0, detailRowCount: 1 },
      outstandingCommission: { status: 'reconciled', summaryTotal: 200, detailTotal: 200, detailRowCount: 1 },
    });
    expect(body.rows).toEqual([{
      id: -17,
      occurredAt: '2026-07-10 11:00:00',
      sourceType: 'performer_reserve',
      incentiveType: 'performer',
      doctorName: 'Dr. Amina Rahman',
      detailName: 'S. Creatinine',
      referenceNo: 'INV-17',
      billId: 17,
      commissionRuleId: 77,
      commissionRuleVersion: null,
      adjustmentAmount: 0,
      reasonCode: 'rule_matched',
      reasonLabel: 'Rule matched',
      grossAmount: 700,
      discountAmount: 100,
      netBilledAmount: 600,
      performerReserveAmount: 200,
      commissionBaseAmount: 600,
      rateLabel: 'Flat ৳200',
      earnedAmount: 200,
      waiverAmount: 0,
      payableAmount: 200,
      paidAmount: 0,
      outstandingAmount: 200,
      settlementNo: null,
      waiverReason: null,
      amount: 200,
      status: 'reserved',
    }]);
    expect(mockDB.queries.filter((query) => query.sql.includes('executive_doctor:details:commissions'))).toHaveLength(1);
  });
});
