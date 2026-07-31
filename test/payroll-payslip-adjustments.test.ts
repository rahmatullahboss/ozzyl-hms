import { describe, it, expect, beforeEach } from 'vitest';
import payrollRoute from '../src/routes/tenant/hr/payroll';
import { createTestApp } from './integration/helpers/test-app';
import { createMockDB } from './integration/helpers/mock-db';
import type { TestApp } from './integration/helpers/test-app';

interface SeedArgs {
  net: number;
  totalEarning?: number;
  runStatus?: 'draft' | 'locked' | 'approved';
  tenantIdOverride?: string;
  /** Tenant to use for the seed rows. Defaults to tenantIdOverride (or 'tenant-1'). */
  seedTenantId?: string;
}

function seedFixture(args: SeedArgs) {
  const tenantId = args.tenantIdOverride ?? 'tenant-1';
  const seedTenant = args.seedTenantId ?? tenantId;
  const runId = 100;
  const payslipId = 200;
  const staffId = 300;
  const userId = 1;

  const { db, queries } = createMockDB({
    tables: {
      hr_payroll_runs: [{
        id: runId, tenant_id: seedTenant, run_month: '2026-06',
        status: args.runStatus ?? 'draft',
        total_employees: 1, total_gross: args.net, total_deductions: 0, total_net: args.net,
        created_by: userId, created_at: '2026-06-01 00:00:00',
      }],
      hr_payslips: [{
        id: payslipId, tenant_id: seedTenant, payroll_run_id: runId, staff_id: staffId, month: '2026-06',
        total_earning: args.totalEarning ?? args.net, total_deduction: 0, net_pay: args.net,
        payment_method: null, payment_reference: null, status: 'pending',
        breakdown_json: null, attendance_summary_json: null, created_at: '2026-06-01 00:00:00',
      }],
    },
  });

  const { app, mockDB } = createTestApp({
    route: payrollRoute,
    routePath: '/hr/payroll',
    role: 'hospital_admin',
    tenantId,
    userId,
    mockDB: { db, queries, reset: () => queries.length = 0 } as any,
  });

  return { app: app as unknown as TestApp['app'], mockDB, tenantId, runId, payslipId, staffId, userId };
}

function makePatchRequest(app: TestApp['app'], payslipId: number, body: object) {
  return app.request(`/hr/payroll/payslips/${payslipId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/hr/payroll/payslips/:id', () => {
  let ctx: ReturnType<typeof seedFixture>;

  beforeEach(() => { ctx = seedFixture({ net: 30000, totalEarning: 40000 }); });

  it('updates net pay and writes an audit row in draft', async () => {
    const res = await makePatchRequest(ctx.app, ctx.payslipId, { netPay: 32500, reason: 'manual correction' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ oldNet: 30000, newNet: 32500 });
    // Verify the audit row was inserted (look for the INSERT INTO hr_payslip_adjustments query)
    const auditInsert = ctx.mockDB.queries.find((q) =>
      /INSERT\s+INTO\s+hr_payslip_adjustments/i.test(q.sql)
    );
    expect(auditInsert).toBeDefined();
    expect(auditInsert?.params).toContain('manual correction');
    expect(auditInsert?.params).toContain(ctx.userId);
    // Verify the UPDATE on hr_payslips happened
    const payslipUpdate = ctx.mockDB.queries.find((q) =>
      /UPDATE\s+hr_payslips/i.test(q.sql)
    );
    expect(payslipUpdate).toBeDefined();
  });

  it('rejects when run is locked', async () => {
    const c2 = seedFixture({ net: 30000, totalEarning: 40000, runStatus: 'locked' });
    const res = await makePatchRequest(c2.app, c2.payslipId, { netPay: 32500, reason: 'manual correction' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/locked/i);
  });

  it('rejects when run is approved', async () => {
    const c2 = seedFixture({ net: 30000, totalEarning: 40000, runStatus: 'approved' });
    const res = await makePatchRequest(c2.app, c2.payslipId, { netPay: 32500, reason: 'manual correction' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/approved/i);
  });

  it('returns 404 for payslip from another tenant', async () => {
    // Seed belongs to the original tenant; the test app queries from a different tenant.
    const c2 = seedFixture({ net: 30000, totalEarning: 40000, tenantIdOverride: 'tenant-other', seedTenantId: 'tenant-1' });
    const res = await makePatchRequest(c2.app, c2.payslipId, { netPay: 32500, reason: 'manual correction' });
    expect(res.status).toBe(404);
  });

  it('validates reason length and non-negative net (Zod 400)', async () => {
    const res = await makePatchRequest(ctx.app, ctx.payslipId, { netPay: -1, reason: 'x' });
    expect(res.status).toBe(400);
  });
});
