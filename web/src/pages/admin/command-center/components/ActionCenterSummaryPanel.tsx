import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { useApiQuery } from '../../../../hooks/useApiQuery';
import { queryKeys } from '../../../../lib/queryKeys';

interface ActionCenterSummaryResponse {
  data?: {
    approvals?: { totalPending?: number };
    exceptions?: { open?: number; critical?: number; slaBreached?: number };
    collections?: {
      open?: number;
      exposureMinor?: number | null;
      currencyCode?: string | null;
    };
    tasks?: { open?: number; overdue?: number; assignedToMe?: number };
    nextBestAction?: {
      workstream: 'approvals' | 'exceptions' | 'collections' | 'tasks';
      href: string;
      label: string;
      priority: 'critical' | 'high' | 'medium' | 'low';
    } | null;
  };
}

function positiveCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

function tenantHref(slug: string, href: string): string {
  if (href.startsWith(`/h/${slug}/`)) return href;
  if (href.startsWith('/h/')) return href;
  if (href.startsWith('/')) return `/h/${slug}${href}`;
  return `/h/${slug}/${href}`;
}

function formatExposure(amountMinor: unknown, currencyCode: unknown): string {
  const amount = Number(amountMinor);
  const currency = String(currencyCode ?? '').trim().toUpperCase();
  if (!Number.isFinite(amount) || !currency) return '—';
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return '—';
  }
}

interface SummaryMetricProps {
  testId: string;
  label: string;
  value: string | number;
  detail?: string;
  actionLabel: string;
  onOpen: () => void;
  icon: React.ReactNode;
}

function SummaryMetric({ testId, label, value, detail, actionLabel, onOpen, icon }: SummaryMetricProps) {
  return (
    <button
      type="button"
      aria-label={actionLabel}
      onClick={onOpen}
      className="group min-h-28 cursor-pointer rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 text-left transition-colors hover:border-[var(--color-primary)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</span>
        <span className="text-[var(--color-primary)]">{icon}</span>
      </div>
      <p data-testid={testId} className="mt-2 font-data text-2xl font-bold tabular-nums text-[var(--color-text-primary)]">{value}</p>
      {detail ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{detail}</p> : null}
    </button>
  );
}

export default function ActionCenterSummaryPanel() {
  const navigate = useNavigate();
  const { slug = '' } = useParams<{ slug: string }>();
  const query = useApiQuery<ActionCenterSummaryResponse>(
    queryKeys.actionCenter.summary(),
    '/api/action-center/summary',
    { staleTime: 30_000 },
  );
  const summary = query.data?.data;
  const pendingApprovals = positiveCount(summary?.approvals?.totalPending);
  const criticalExceptions = positiveCount(summary?.exceptions?.critical);
  const openReceivables = positiveCount(summary?.collections?.open);
  const overdueTasks = positiveCount(summary?.tasks?.overdue);
  const exposure = formatExposure(summary?.collections?.exposureMinor, summary?.collections?.currencyCode);
  const totalPending = pendingApprovals + criticalExceptions + openReceivables + overdueTasks;
  const nextAction = summary?.nextBestAction ?? null;

  if (query.isLoading && !query.data) {
    return (
      <section className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm" aria-label="Loading Action Center summary">
        <div className="skeleton h-5 w-48 rounded" />
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-28 rounded-xl" />)}
        </div>
      </section>
    );
  }

  if (query.isError && !query.data) {
    return (
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-700 shadow-sm dark:border-red-900 dark:bg-red-950/30 dark:text-red-200" role="alert">
        <p className="flex items-center gap-2 text-sm font-semibold">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          Unable to load Action Center summary.
        </p>
        <button
          type="button"
          onClick={() => { void query.refetch(); }}
          className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-current px-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      </section>
    );
  }

  return (
    <section data-testid="action-center-summary-panel" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Action Center</p>
          <h3 className="mt-1 text-lg font-semibold text-[var(--color-text-primary)]">Management action summary</h3>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">
            One authoritative queue for approvals, exceptions, collections, and tasks.
          </p>
        </div>
        <button
          type="button"
          onClick={() => navigate(`/h/${slug}/action`)}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-[var(--color-border)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-secondary)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          Open Action Center
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {query.isError ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900" role="status">
          Showing the last available Action Center summary.
        </p>
      ) : null}

      {totalPending === 0 && !nextAction ? (
        <div className="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>No management action is currently pending.</p>
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryMetric
              testId="action-summary-approvals"
              label="Pending approvals"
              value={pendingApprovals}
              actionLabel="Open pending approvals"
              onOpen={() => navigate(`/h/${slug}/action/approvals?status=pending`)}
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            />
            <SummaryMetric
              testId="action-summary-critical"
              label="Critical exceptions"
              value={criticalExceptions}
              actionLabel="Open critical exceptions"
              onOpen={() => navigate(`/h/${slug}/action/exceptions?status=active&priority=critical`)}
              icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            />
            <SummaryMetric
              testId="action-summary-receivables"
              label="Open receivables"
              value={openReceivables}
              detail={`Exposure ${exposure}`}
              actionLabel="Open receivable exposure"
              onOpen={() => navigate(`/h/${slug}/action/collections?status=active&sort=exposure`)}
              icon={<WalletCards className="h-4 w-4" aria-hidden="true" />}
            />
            <SummaryMetric
              testId="action-summary-overdue"
              label="Overdue tasks"
              value={overdueTasks}
              actionLabel="Open overdue tasks"
              onOpen={() => navigate(`/h/${slug}/action/tasks?status=overdue`)}
              icon={<Clock3 className="h-4 w-4" aria-hidden="true" />}
            />
          </div>

          {nextAction ? (
            <button
              type="button"
              aria-label={nextAction.label}
              onClick={() => navigate(tenantHref(slug, nextAction.href))}
              className="mt-4 flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 transition-colors hover:bg-amber-100 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            >
              <span>
                <span className="block text-xs font-semibold uppercase tracking-wide">Next best action · {nextAction.priority}</span>
                <span className="mt-1 block font-semibold">{nextAction.label}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
            </button>
          ) : null}
        </>
      )}
    </section>
  );
}
