import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requireTenantId } from '../../lib/context-helpers';
import { requireRole } from '../../middleware/rbac';
import { ReceivableAuthorityConfigurationError } from '../../services/actionCenter/collections/authority';
import { listCollectionCases } from '../../services/actionCenter/collections/query';
import { listTasks, loadLegacyTaskSummary } from '../../services/actionCenter/tasks/query';
import legacyAdminRoutes from './index';

const ADMIN_ROLES = [
  'super_admin',
  'hospital_admin',
  'md',
  'director',
  'manager',
  'accountant',
  'auditor',
] as const;

const adminRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

adminRoutes.get('/tasks', requireRole(...ADMIN_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  const nowUtc = new Date().toISOString();
  try {
    const [result, summary] = await Promise.all([
      listTasks({
        db: c.env.DB,
        tenantId,
        userId: Number(c.get('userId')),
        query: {
          view: 'all',
          page: 1,
          limit: 100,
        },
        nowUtc,
      }),
      loadLegacyTaskSummary({
        db: c.env.DB,
        tenantId,
        nowUtc,
      }),
    ]);

    const tasks = result.items
      .filter((task) => task.status !== 'cancelled')
      .map((task) => ({
        id: String(task.id),
        title: task.title,
        assignee: task.assignedToName ?? 'Unassigned',
        priority: task.priority,
        dueDate: task.dueAtUtc ?? task.createdAtUtc,
        status: task.isOverdue
          ? 'overdue'
          : task.status === 'open'
            ? 'pending'
            : task.status,
        module: task.sourceType,
        createdAt: task.createdAtUtc,
      }));

    return c.json({ tasks, summary });
  } catch (error) {
    console.error('Persistent task compatibility error:', error);
    return c.json({ error: 'Failed to load tasks' }, 500);
  }
});

adminRoutes.get('/due-receivables', requireRole(...ADMIN_ROLES), async (c) => {
  const tenantId = requireTenantId(c);
  try {
    const result = await listCollectionCases({
      db: c.env.DB,
      tenantId,
      query: {
        status: 'active',
        sort: 'exposure',
        page: 1,
        limit: 100,
      },
    });
    const receivables = result.data.map((row) => ({
      id: row.sourceKey,
      sourceKey: row.sourceKey,
      source: row.source,
      type: 'patient',
      invoice: row.invoiceNumber,
      party: row.patientName,
      patientName: row.patientName,
      contact: row.patientMobile,
      total: row.totalMinor / 100,
      paid: row.paidMinor / 100,
      due: row.dueMinor / 100,
      currencyCode: row.currencyCode,
      daysOutstanding: row.daysOutstanding,
      status: row.daysOutstanding > 60
        ? 'overdue'
        : row.daysOutstanding > 30
          ? 'aging'
          : 'open',
    }));
    const summary = result.summary;

    return c.json({
      receivables,
      summary: {
        totalDue: summary.totalDueMinor === null ? null : summary.totalDueMinor / 100,
        totalInvoices: summary.totalInvoices,
        current: summary.currentMinor === null ? null : summary.currentMinor / 100,
        days30: summary.days30Minor === null ? null : summary.days30Minor / 100,
        days60: summary.days60Minor === null ? null : summary.days60Minor / 100,
        days90Plus: summary.days90PlusMinor === null ? null : summary.days90PlusMinor / 100,
        currencyCode: summary.currencyCode,
        aging: summary.agingCounts,
        amountsByCurrency: summary.amountsByCurrency,
        authorityMode: summary.authorityMode,
        shadowMismatchCount: summary.shadowMismatchCount,
      },
    });
  } catch (error) {
    if (error instanceof ReceivableAuthorityConfigurationError) {
      return c.json({
        error: error.message,
        code: 'RECEIVABLE_AUTHORITY_UNAVAILABLE',
        requestedMode: error.requestedMode,
        missingRequirements: error.missingRequirements,
      }, 503);
    }

    console.error('Due receivables compatibility error:', error);
    return c.json({ error: 'Failed to load due receivables' }, 500);
  }
});

adminRoutes.route('/', legacyAdminRoutes);

export default adminRoutes;
