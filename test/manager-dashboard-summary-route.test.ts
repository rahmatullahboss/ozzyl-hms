import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const routeSource = () => readFileSync('src/routes/tenant/managerDashboard.ts', 'utf8');
const indexSource = () => readFileSync('src/index.ts', 'utf8');

describe('manager dashboard summary route contract', () => {
  it('mounts the manager dashboard API under /api/manager', () => {
    expect(indexSource()).toContain("import managerDashboardRoutes from './routes/tenant/managerDashboard'");
    expect(indexSource()).toContain("app.route('/api/manager', managerDashboardRoutes)");
  });

  it('guards dashboard-summary to safe manager and owner roles', () => {
    const source = routeSource();
    expect(source).toContain("managerDashboardRoutes.get('/dashboard-summary', requireRole(...MANAGER_DASHBOARD_ROLES)");
    expect(source).toContain("'manager'");
    expect(source).toContain("'hospital_admin'");
    expect(source).toContain("'md'");
    expect(source).toContain("'director'");
    expect(source).not.toContain("'accountant'");
  });

  it('validates date input and scopes all summary queries by tenant', () => {
    const source = routeSource();
    expect(source).toContain("date must be YYYY-MM-DD");
    expect(source).toContain('const tenantId = requireTenantId(c)');
    expect(source).toContain('patients WHERE tenant_id = ?');
    expect(source).toContain('appointments WHERE tenant_id = ?');
    expect(source).toContain('date(appt_date)');
    expect(source).not.toContain('appointment_date');
    expect(source).toContain('billing_counter_sessions WHERE tenant_id = ?');
    expect(source).toContain('lab_orders WHERE tenant_id = ?');
    expect(source).toContain('lab_order_items WHERE tenant_id = ?');
    expect(source).toContain('bills WHERE tenant_id = ?');
  });

  it('returns the manager dashboard summary shape from the spec', () => {
    const source = routeSource();
    for (const key of [
      'patientsToday',
      'appointmentsToday',
      'waitingQueue',
      'activeCounters',
      'pendingHandovers',
      'ordersToday',
      'pendingOrders',
      'readyReports',
      'delayedReports',
      'invoicesToday',
      'dueInvoices',
      'pendingPayments',
      'cashMismatchAlerts',
      'admissionsToday',
      'occupiedBeds',
      'availableBeds',
      'alerts',
    ]) {
      expect(source).toContain(key);
    }
  });
});
