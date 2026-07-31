import { Hono } from 'hono';
import { requireTenantId } from '../../lib/context-helpers';
import { getDb } from '../../db';
import type { Env, Variables } from '../../types';
import { getTodayGMT6 } from '../../lib/date-utils';
import { requirePermission, requireRole } from '../../middleware/rbac';

const managerDashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
const MANAGER_DASHBOARD_ROLES = ['hospital_admin', 'md', 'director', 'manager'] as const;

function validDate(value: string | undefined): boolean {
  return !value || /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function localReportDate(expression: string): string {
  const valueExpr = expression.includes(',') ? `COALESCE(${expression})` : expression;
  return `CASE
    WHEN ${valueExpr} IS NULL THEN NULL
    WHEN ${valueExpr} LIKE '%Z' OR ${valueExpr} LIKE '%+00:00' OR ${valueExpr} LIKE '%-00:00'
      THEN date(${valueExpr}, '+6 hours')
    ELSE date(${valueExpr})
  END`;
}

function count(row: unknown, key = 'count'): number {
  if (!row || typeof row !== 'object') return 0;
  return Number((row as Record<string, unknown>)[key] ?? 0);
}

managerDashboardRoutes.get('/dashboard-summary', requireRole(...MANAGER_DASHBOARD_ROLES), requirePermission('manager.dashboard.read'), async (c) => {
  const tenantId = requireTenantId(c);
  const db = getDb(c.env.DB);
  const dateParam = c.req.query('date');
  if (!validDate(dateParam)) return c.json({ error: 'date must be YYYY-MM-DD' }, 400);
  const date = dateParam || getTodayGMT6();

  try {
    const [patientsToday, appointmentsToday, activeCounters, pendingHandovers, labOrdersToday, pendingLabOrders, readyReports, delayedReports, invoicesToday, dueInvoices, pendingPayments, admissionsToday, occupiedBeds, availableBeds] = await db.$client.batch([
      db.$client.prepare(`SELECT COUNT(*) AS count FROM patients WHERE tenant_id = ? AND ${localReportDate('created_at')} = date(?)`).bind(tenantId, date),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM appointments WHERE tenant_id = ? AND date(appt_date) = date(?)`).bind(tenantId, date),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM billing_counter_sessions WHERE tenant_id = ? AND status = 'active'`).bind(tenantId),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM billing_counter_sessions WHERE tenant_id = ? AND status IN ('pending_handover', 'closed_pending_handover')`).bind(tenantId),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM lab_orders WHERE tenant_id = ? AND ${localReportDate('order_date, created_at')} = date(?)`).bind(tenantId, date),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM lab_order_items WHERE tenant_id = ? AND COALESCE(status, 'pending') IN ('pending', 'collected', 'received', 'processing')`).bind(tenantId),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM lab_order_items WHERE tenant_id = ? AND COALESCE(status, '') IN ('completed', 'verified', 'reported', 'ready')`).bind(tenantId),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM lab_order_items WHERE tenant_id = ? AND COALESCE(status, 'pending') IN ('pending', 'collected', 'received', 'processing') AND datetime(COALESCE(created_at, 'now'), '+24 hours') < datetime('now', '+6 hours')`).bind(tenantId),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM bills WHERE tenant_id = ? AND ${localReportDate('created_at')} = date(?)`).bind(tenantId, date),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM bills WHERE tenant_id = ? AND COALESCE(due, 0) > 0 AND COALESCE(status, 'open') NOT IN ('cancelled', 'refunded', 'draft')`).bind(tenantId),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM bills WHERE tenant_id = ? AND COALESCE(status, 'open') IN ('pending', 'open', 'unpaid')`).bind(tenantId),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM admissions WHERE tenant_id = ? AND ${localReportDate('admission_date, created_at')} = date(?)`).bind(tenantId, date),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM beds WHERE tenant_id = ? AND status IN ('occupied', 'maintenance')`).bind(tenantId),
      db.$client.prepare(`SELECT COUNT(*) AS count FROM beds WHERE tenant_id = ? AND status IN ('available', 'vacant')`).bind(tenantId),
    ]);

    const delayed = count(delayedReports.results?.[0]);
    const pendingHandoversCount = count(pendingHandovers.results?.[0]);
    const alerts = [
      ...(delayed > 0 ? [{ id: 'lab-delays', severity: 'warning' as const, title: 'Lab report delay', description: `${delayed} lab items are delayed`, targetPath: '/lab/dashboard' }] : []),
      ...(pendingHandoversCount > 0 ? [{ id: 'pending-handovers', severity: 'warning' as const, title: 'Pending cash handover', description: `${pendingHandoversCount} counter handovers need follow-up`, targetPath: '/reception/cash-operations' }] : []),
    ];

    return c.json({
      data: {
        date,
        reception: {
          patientsToday: count(patientsToday.results?.[0]),
          appointmentsToday: count(appointmentsToday.results?.[0]),
          waitingQueue: 0,
          activeCounters: count(activeCounters.results?.[0]),
          pendingHandovers: pendingHandoversCount,
        },
        lab: {
          ordersToday: count(labOrdersToday.results?.[0]),
          pendingOrders: count(pendingLabOrders.results?.[0]),
          readyReports: count(readyReports.results?.[0]),
          delayedReports: delayed,
        },
        billing: {
          invoicesToday: count(invoicesToday.results?.[0]),
          dueInvoices: count(dueInvoices.results?.[0]),
          pendingPayments: count(pendingPayments.results?.[0]),
          cashMismatchAlerts: 0,
        },
        ipd: {
          admissionsToday: count(admissionsToday.results?.[0]),
          dischargesPending: 0,
          occupiedBeds: count(occupiedBeds.results?.[0]),
          availableBeds: count(availableBeds.results?.[0]),
        },
        alerts,
      },
    });
  } catch (error) {
    console.error('Manager dashboard summary error:', error);
    return c.json({ error: 'Failed to fetch manager dashboard summary' }, 500);
  }
});

export default managerDashboardRoutes;
