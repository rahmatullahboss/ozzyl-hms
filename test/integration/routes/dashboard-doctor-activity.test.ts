import { describe, expect, it } from 'vitest';
import dashboardRoutes from '../../../src/routes/tenant/dashboard';
import { createTestApp } from '../helpers/test-app';

type DoctorActivityResponse = {
  period: { startDate: string; endDate: string; label: string };
  doctorId: number;
  rows: Array<{
    eventId: string;
    eventType: string;
    occurredAt: string;
    sourceType: string;
    sourceId: string;
    billId: number | null;
    invoiceNo: string | null;
    patientId: number | null;
    patientName: string | null;
    patientIdentityRedacted: boolean;
    title: string;
    amount: number;
    status: string | null;
    reasonCode: string | null;
  }>;
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
};

function activityResult() {
  return {
    results: [
      {
        event_id: 'commission:91',
        event_type: 'commission_accrued',
        occurred_at: '2026-07-30 14:00:00',
        source_type: 'doctor_commission_accrual',
        source_id: '91',
        doctor_id: 17,
        bill_id: 701,
        invoice_no: 'INV-701',
        patient_id: 41,
        patient_name: 'Patient One',
        title: 'CBC commission',
        amount: 125,
        status: 'accrued',
        reason_code: 'rule_matched',
        total_rows: 3,
      },
      {
        event_id: 'visit:701',
        event_type: 'visit',
        occurred_at: '2026-07-29 09:00:00',
        source_type: 'bill',
        source_id: '701',
        doctor_id: 17,
        bill_id: 701,
        invoice_no: 'INV-701',
        patient_id: 41,
        patient_name: 'Patient One',
        title: 'Doctor visit',
        amount: 500,
        status: 'paid',
        reason_code: null,
        total_rows: 3,
      },
      {
        event_id: 'settlement:11',
        event_type: 'commission_settled',
        occurred_at: '2026-07-28 16:30:00',
        source_type: 'doctor_commission_settlement',
        source_id: '11',
        doctor_id: 17,
        bill_id: null,
        invoice_no: null,
        patient_id: null,
        patient_name: null,
        title: 'Commission settlement SET-11',
        amount: 75,
        status: 'paid',
        reason_code: null,
        total_rows: 3,
      },
    ],
  };
}

describe('executive doctor activity timeline', () => {
  it('returns stable, deduplicated events in descending occurrence order with invoice references', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'hospital_admin',
      tenantId: 'tenant-1',
      permissions: ['patients:read'],
      queryOverride: (sql, params) => {
        const lower = sql.toLowerCase();
        if (!lower.includes('executive_doctor:activity')) return null;

        expect(lower).toContain('union all');
        expect(lower).toContain('row_number() over');
        expect(lower).toContain('partition by event_id');
        expect(lower).toContain('count(*) over');
        expect(lower).toContain('doctor_commission_settlements');
        expect(lower).toContain('accounting_posting_events');
        expect(params).toEqual(['tenant-1', '2026-07-01', '2026-07-31', 17, 50, 0]);
        return activityResult();
      },
    });

    const response = await app.request(
      '/dashboard/doctor-performance/activity?doctorId=17&preset=custom&startDate=2026-07-01&endDate=2026-07-31&page=1&pageSize=50',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as DoctorActivityResponse;
    expect(body.period).toMatchObject({
      startDate: '2026-07-01',
      endDate: '2026-07-31',
      label: '2026-07-01 → 2026-07-31',
    });
    expect(body).toMatchObject({
      doctorId: 17,
      page: 1,
      pageSize: 50,
      totalRows: 3,
      hasNextPage: false,
    });
    expect(body.rows.map((row) => row.eventId)).toEqual([
      'commission:91',
      'visit:701',
      'settlement:11',
    ]);
    expect(body.rows[0]).toMatchObject({
      billId: 701,
      invoiceNo: 'INV-701',
      patientId: 41,
      patientName: 'Patient One',
      patientIdentityRedacted: false,
      reasonCode: 'rule_matched',
    });
    expect(body.rows[2]).toMatchObject({
      patientId: null,
      patientName: null,
      patientIdentityRedacted: false,
    });
    expect(mockDB.queries.filter((query) => query.sql.includes('executive_doctor:activity'))).toHaveLength(1);
  });

  it('redacts patient identity server-side without dropping identity-free events', async () => {
    const { app } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'director',
      tenantId: 'tenant-1',
      queryOverride: (sql) => sql.includes('executive_doctor:activity') ? activityResult() : null,
    });

    const response = await app.request(
      '/dashboard/doctor-performance/activity?doctorId=17&date=2026-07-30&pageSize=50',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as DoctorActivityResponse;
    expect(body.rows).toHaveLength(3);
    expect(body.rows[0]).toMatchObject({
      patientId: null,
      patientName: null,
      patientIdentityRedacted: true,
    });
    expect(body.rows[2]).toMatchObject({
      eventId: 'settlement:11',
      patientId: null,
      patientName: null,
      patientIdentityRedacted: false,
    });
  });

  it('rejects invalid doctor, period, and pagination before executing activity SQL', async () => {
    const { app, mockDB } = createTestApp({
      route: dashboardRoutes,
      routePath: '/dashboard',
      role: 'md',
      tenantId: 'tenant-1',
    });

    expect((await app.request('/dashboard/doctor-performance/activity?doctorId=0')).status).toBe(400);
    expect((await app.request(
      '/dashboard/doctor-performance/activity?doctorId=17&preset=custom&startDate=2026-07-31&endDate=2026-07-01',
    )).status).toBe(400);
    expect((await app.request('/dashboard/doctor-performance/activity?doctorId=17&pageSize=75')).status).toBe(400);
    expect(mockDB.queries.some((query) => query.sql.includes('executive_doctor:activity'))).toBe(false);
  });
});
