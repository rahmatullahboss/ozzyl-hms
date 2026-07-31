import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { requirePermission, requireRole } from '../../middleware/rbac';
import { requireTenantId } from '../../lib/context-helpers';
import { getFullTimestampGMT6, getTodayGMT6 } from '../../lib/date-utils';
import { logServerError } from '../../lib/server-error-logging';
import {
  loadApprovalOperationalSummary,
  type ApprovalOperationalSummary,
} from '../../services/actionCenter/approvalSummary';
import { ReceivableAuthorityConfigurationError } from '../../services/actionCenter/collections/authority';
import { listCollectionCases } from '../../services/actionCenter/collections/query';
import type {
  CollectionCurrencySummary,
  ReceivableAuthorityMode,
} from '../../services/actionCenter/collections/types';
import { loadTaskOperationalSummary } from '../../services/actionCenter/tasks/query';
import actionCenterExceptionRoutes from './actionCenterExceptions';
import actionCenterCollectionRoutes from './actionCenterCollections';
import actionCenterTaskRoutes from './actionCenterTasks';

const actionCenterRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

const ACTION_CENTER_READ_ROLES = [
  'hospital_admin',
  'md',
  'director',
  'manager',
  'accountant',
] as const;

const TASK_TEAM_ROLES = new Set<string>([
  'hospital_admin',
  'md',
  'director',
  'manager',
]);

export interface ActionCenterSummary {
  approvals: ApprovalOperationalSummary;
  exceptions: {
    open: number;
    critical: number;
    slaBreached: number;
    byRule: Record<string, number>;
  };
  collections: {
    open: number;
    followupDue: number;
    exposure: number | null;
    exposureMinor: number | null;
    currencyCode: string | null;
    amountsByCurrency: CollectionCurrencySummary[];
    authorityMode: ReceivableAuthorityMode;
    shadowMismatchCount: number;
  };
  tasks: {
    open: number;
    overdue: number;
    assignedToMe: number;
  };
  resolvedToday: number;
  nextBestAction: {
    workstream: 'approvals' | 'exceptions' | 'collections' | 'tasks';
    href: string;
    label: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
  } | null;
  capabilities: {
    persistentExceptions: boolean;
    persistentCollections: boolean;
    persistentTasks: boolean;
  };
}

interface ExceptionAggregateRow {
  open_count?: number | string | null;
  critical_count?: number | string | null;
  sla_breached?: number | string | null;
  resolved_today?: number | string | null;
}

interface ExceptionRuleCountRow {
  rule_key: string;
  total?: number | string | null;
}

function finiteNumber(...values: unknown[]): number {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

async function loadExceptionAggregate(
  db: Env['DB'],
  tenantId: string,
  now: string,
  today: string,
) {
  const [row, ruleResult] = await Promise.all([
    db.prepare(`
      WITH scoped AS (
        SELECT
          c.*,
          ? AS now_value,
          ? AS today_value
        FROM admin_exception_cases c
        WHERE c.tenant_id = ?
      ), active AS (
        SELECT *
        FROM scoped
        WHERE status IN ('open', 'acknowledged', 'in_progress', 'snoozed')
          AND (
            status <> 'snoozed'
            OR snoozed_until IS NULL
            OR datetime(snoozed_until) <= datetime(now_value)
          )
      )
      SELECT
        (SELECT COUNT(*) FROM active) AS open_count,
        (SELECT COUNT(*) FROM active WHERE severity = 'critical') AS critical_count,
        (
          SELECT COUNT(*)
          FROM active
          WHERE datetime(first_detected_at) <= datetime(now_value, '-24 hours')
        ) AS sla_breached,
        (
          SELECT COUNT(*)
          FROM scoped
          WHERE status = 'resolved'
            AND date(resolved_at) = date(today_value)
        ) AS resolved_today
    `).bind(now, today, tenantId).first<ExceptionAggregateRow>(),
    db.prepare(`
      SELECT c.rule_key, COUNT(*) AS total
      FROM admin_exception_cases c
      WHERE c.tenant_id = ?
        AND c.status IN ('open', 'acknowledged', 'in_progress', 'snoozed')
        AND (
          c.status <> 'snoozed'
          OR c.snoozed_until IS NULL
          OR datetime(c.snoozed_until) <= datetime(?)
        )
      GROUP BY c.rule_key
      ORDER BY c.rule_key
    `).bind(tenantId, now).all<ExceptionRuleCountRow>(),
  ]);

  const byRule = Object.fromEntries((ruleResult.results ?? []).map((item) => [
    item.rule_key,
    Math.max(0, Math.trunc(finiteNumber(item.total))),
  ]));

  return {
    open: Math.max(0, Math.trunc(finiteNumber(row?.open_count))),
    critical: Math.max(0, Math.trunc(finiteNumber(row?.critical_count))),
    slaBreached: Math.max(0, Math.trunc(finiteNumber(row?.sla_breached))),
    resolvedToday: Math.max(0, Math.trunc(finiteNumber(row?.resolved_today))),
    byRule,
  };
}

actionCenterRoutes.route('/exceptions', actionCenterExceptionRoutes);
actionCenterRoutes.route('/collections', actionCenterCollectionRoutes);
actionCenterRoutes.route('/tasks', actionCenterTaskRoutes);

actionCenterRoutes.get('/summary', requireRole(...ACTION_CENTER_READ_ROLES), requirePermission('receivables.view'), async (c) => {
  const tenantId = requireTenantId(c);

  try {
    const now = getFullTimestampGMT6();
    const today = getTodayGMT6();
    const taskNowUtc = new Date().toISOString();
    const currentUserId = Number(c.get('userId'));
    const canViewTeamTasks = TASK_TEAM_ROLES.has(String(c.get('role') ?? ''));
    const [approvals, exceptions, receivables, tasks] = await Promise.all([
      loadApprovalOperationalSummary(c.env.DB, tenantId),
      loadExceptionAggregate(c.env.DB, tenantId, now, today),
      listCollectionCases({
        db: c.env.DB,
        tenantId,
        query: {
          status: 'active',
          sort: 'exposure',
          page: 1,
          limit: 1,
        },
      }),
      loadTaskOperationalSummary({
        db: c.env.DB,
        tenantId,
        userId: currentUserId,
        nowUtc: taskNowUtc,
      }),
    ]);
    const collectionSummary = receivables.summary;

    const data: ActionCenterSummary = {
      approvals,
      exceptions: {
        open: exceptions.open,
        critical: exceptions.critical,
        slaBreached: exceptions.slaBreached,
        byRule: exceptions.byRule,
      },
      collections: {
        open: collectionSummary.totalInvoices,
        followupDue: collectionSummary.followupDue,
        exposure: collectionSummary.totalDueMinor === null
          ? null
          : collectionSummary.totalDueMinor / 100,
        exposureMinor: collectionSummary.totalDueMinor,
        currencyCode: collectionSummary.currencyCode,
        amountsByCurrency: collectionSummary.amountsByCurrency,
        authorityMode: collectionSummary.authorityMode,
        shadowMismatchCount: collectionSummary.shadowMismatchCount,
      },
      tasks: {
        open: tasks.open,
        overdue: tasks.overdue,
        assignedToMe: tasks.assignedToMe,
      },
      resolvedToday: approvals.todayApproved + approvals.rejectedToday + exceptions.resolvedToday,
      nextBestAction: exceptions.critical > 0
        ? {
            workstream: 'exceptions',
            href: '/action/exceptions?status=active&severity=critical',
            label: 'Review critical exception',
            priority: 'critical',
          }
        : !canViewTeamTasks && tasks.assignedOverdue > 0
          ? {
              workstream: 'tasks',
              href: '/action/tasks?view=mine',
              label: 'Review my overdue tasks',
              priority: 'high',
            }
          : canViewTeamTasks && tasks.overdue > 0
            ? {
                workstream: 'tasks',
                href: '/action/tasks?view=overdue',
                label: 'Review overdue tasks',
                priority: 'high',
              }
            : approvals.totalPending > 0
            ? {
              workstream: 'approvals',
              href: '/action/approvals?status=pending',
              label: 'Review oldest pending approval',
              priority: approvals.highPriority > 0 ? 'high' : 'medium',
            }
          : exceptions.open > 0
            ? {
                workstream: 'exceptions',
                href: '/action/exceptions?status=active',
                label: 'Review oldest open exception',
                priority: exceptions.slaBreached > 0 ? 'high' : 'medium',
              }
            : collectionSummary.followupDue > 0
              ? {
                  workstream: 'collections',
                  href: '/action/collections?followup=due&status=active',
                  label: 'Review due collection follow-ups',
                  priority: 'high',
                }
              : collectionSummary.totalInvoices > 0
                ? {
                    workstream: 'collections',
                    href: '/action/collections?status=active&sort=exposure',
                    label: 'Review open receivables',
                    priority: 'medium',
                  }
                : null,
      capabilities: {
        persistentExceptions: true,
        persistentCollections: true,
        persistentTasks: true,
      },
    };

    return c.json({ data });
  } catch (error) {
    if (error instanceof ReceivableAuthorityConfigurationError) {
      return c.json({
        error: error.message,
        code: 'RECEIVABLE_AUTHORITY_UNAVAILABLE',
        requestedMode: error.requestedMode,
        missingRequirements: error.missingRequirements,
      }, 503);
    }

    logServerError({
      request: c.req.raw,
      status: 500,
      environment: c.env.ENVIRONMENT,
      source: 'onError',
      error,
      message: 'action center summary failed',
      tenantId,
      userId: c.get('userId'),
      requestId: c.req.header('x-request-id')
        ?? c.req.header('x-correlation-id')
        ?? c.req.header('cf-ray')
        ?? undefined,
      tags: ['action_center_summary_failed', 'd1_query_failed'],
    });
    return c.json({
      error: 'Failed to load Action Center summary',
      detail: error instanceof Error ? error.message : String(error),
    }, 500);
  }
});

export default actionCenterRoutes;
