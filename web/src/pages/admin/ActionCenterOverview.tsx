import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import ActionCenterShell from '../../components/action-center/ActionCenterShell';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface ActionCenterSummaryResponse {
  data?: {
    approvals?: {
      totalPending?: number;
      highPriority?: number;
      olderThan24h?: number;
      todayApproved?: number;
      rejectedToday?: number;
      totalPendingAmount?: number;
    };
    exceptions?: { open?: number; critical?: number; slaBreached?: number };
    collections?: {
      open?: number;
      followupDue?: number;
      exposure?: number | null;
      exposureMinor?: number | null;
      currencyCode?: string | null;
      amountsByCurrency?: Array<{
        currencyCode: string;
        totalDueMinor: number;
        totalInvoices: number;
      }>;
      authorityMode?: 'legacy' | 'shadow' | 'canonical';
      shadowMismatchCount?: number;
    };
    tasks?: { open?: number; overdue?: number; assignedToMe?: number };
    resolvedToday?: number;
    nextBestAction?: {
      workstream: 'approvals' | 'exceptions' | 'collections' | 'tasks';
      href: string;
      label: string;
      priority: 'critical' | 'high' | 'medium' | 'low';
    } | null;
    capabilities?: {
      persistentExceptions?: boolean;
      persistentCollections?: boolean;
      persistentTasks?: boolean;
    };
  };
}

interface MetricCardProps {
  id: string;
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
}

function MetricCard({ id, label, value, detail, icon }: MetricCardProps) {
  return (
    <article
      data-testid="action-center-metric"
      className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-4 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
          <p
            data-testid={id}
            className="mt-2 font-data text-2xl font-bold tabular-nums text-[var(--color-text-primary)]"
          >
            {value}
          </p>
        </div>
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--color-bg-subtle)] text-[var(--color-primary)]">
          {icon}
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">{detail}</p>
    </article>
  );
}

interface WorkstreamCardProps {
  title: string;
  description: string;
  status: string;
  icon: ReactNode;
  href?: string;
  actionLabel?: string;
}

function WorkstreamCard({ title, description, status, icon, href, actionLabel }: WorkstreamCardProps) {
  return (
    <article className="flex min-h-52 flex-col rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--color-bg-subtle)] text-[var(--color-primary)]">
          {icon}
        </span>
        <span className="rounded-full border border-[var(--color-border-light)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-muted)]">
          {status}
        </span>
      </div>
      <h2 className="mt-4 text-base font-semibold text-[var(--color-text-primary)]">{title}</h2>
      <p className="mt-2 flex-1 text-sm leading-6 text-[var(--color-text-muted)]">{description}</p>
      {href && actionLabel ? (
        <Link
          to={href}
          className="mt-4 inline-flex min-h-11 items-center justify-between gap-2 rounded-xl border border-[var(--color-border-light)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition-colors duration-200 hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
        >
          {actionLabel}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      ) : null}
    </article>
  );
}

function tenantHref(slug: string, href: string): string {
  if (href.startsWith(`/h/${slug}/`)) return href;
  if (href.startsWith('/')) return `/h/${slug}${href}`;
  return `/h/${slug}/${href}`;
}

function formatMinorCurrency(amountMinor: number, currencyCode: string, language: string): string {
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: currencyCode,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function formatCollectionExposure(
  collections: NonNullable<NonNullable<ActionCenterSummaryResponse['data']>['collections']> | undefined,
  language: string,
): string {
  if (
    collections?.exposureMinor !== null
    && collections?.exposureMinor !== undefined
    && collections.currencyCode
  ) {
    return formatMinorCurrency(collections.exposureMinor, collections.currencyCode, language);
  }

  const amounts = collections?.amountsByCurrency ?? [];
  if (amounts.length > 0) {
    return amounts
      .map((amount) => formatMinorCurrency(amount.totalDueMinor, amount.currencyCode, language))
      .join(' + ');
  }

  return '—';
}

export default function ActionCenterOverview() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { t, i18n } = useTranslation('adminPages');
  const { data, isLoading, isError } = useApiQuery<ActionCenterSummaryResponse>(
    queryKeys.actionCenter.summary(),
    '/api/action-center/summary',
    { staleTime: 30_000 },
  );
  const summary = data?.data;
  const approvals = summary?.approvals;
  const collections = summary?.collections;
  const capabilities = summary?.capabilities;
  const base = `/h/${slug}/action`;
  const collectionExposure = formatCollectionExposure(collections, i18n.language);

  const metrics: MetricCardProps[] = [
    {
      id: 'metric-pending',
      label: t('actionCenter.overview.metrics.pending', { defaultValue: 'Pending approvals' }),
      value: Number(approvals?.totalPending ?? 0).toLocaleString(),
      detail: t('actionCenter.overview.metrics.pendingDetail', { defaultValue: 'Decisions currently waiting for review' }),
      icon: <ShieldCheck className="h-5 w-5" aria-hidden="true" />,
    },
    {
      id: 'metric-high-priority',
      label: t('actionCenter.overview.metrics.highPriority', { defaultValue: 'High priority' }),
      value: Number(approvals?.highPriority ?? 0).toLocaleString(),
      detail: t('actionCenter.overview.metrics.highPriorityDetail', { defaultValue: 'Financial or operational risk requiring attention' }),
      icon: <AlertTriangle className="h-5 w-5" aria-hidden="true" />,
    },
    {
      id: 'metric-sla-breached',
      label: t('actionCenter.overview.metrics.slaBreached', { defaultValue: 'SLA breached' }),
      value: Number(approvals?.olderThan24h ?? 0).toLocaleString(),
      detail: t('actionCenter.overview.metrics.slaBreachedDetail', { defaultValue: 'Approval items beyond their expected review window' }),
      icon: <Clock3 className="h-5 w-5" aria-hidden="true" />,
    },
    {
      id: 'metric-receivables',
      label: t('actionCenter.overview.metrics.receivables', { defaultValue: 'Open receivables' }),
      value: Number(collections?.open ?? 0).toLocaleString(),
      detail: t('actionCenter.overview.metrics.receivablesDetail', { defaultValue: 'Invoices with a positive outstanding balance' }),
      icon: <WalletCards className="h-5 w-5" aria-hidden="true" />,
    },
    {
      id: 'metric-exposure',
      label: t('actionCenter.overview.metrics.exposure', { defaultValue: 'Receivable exposure' }),
      value: collectionExposure,
      detail: t('actionCenter.overview.metrics.exposureDetail', { defaultValue: 'Live outstanding amount across eligible bills' }),
      icon: <WalletCards className="h-5 w-5" aria-hidden="true" />,
    },
    {
      id: 'metric-resolved',
      label: t('actionCenter.overview.metrics.resolvedToday', { defaultValue: 'Resolved today' }),
      value: Number(summary?.resolvedToday ?? 0).toLocaleString(),
      detail: t('actionCenter.overview.metrics.resolvedTodayDetail', { defaultValue: 'Approval decisions completed today' }),
      icon: <CheckCircle2 className="h-5 w-5" aria-hidden="true" />,
    },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <ActionCenterShell
        activeSection="overview"
        title={t('actionCenter.overview.title', { defaultValue: 'Action Center' })}
        description={t('actionCenter.overview.subtitle', {
          defaultValue: 'Prioritize approvals, risks, receivables, and follow-ups from one operational workspace.',
        })}
      >
        {isError ? (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert">
            {t('actionCenter.overview.loadError', { defaultValue: 'The overview could not be refreshed. Queue navigation remains available.' })}
          </div>
        ) : null}

        <section aria-label={t('actionCenter.overview.metricsLabel', { defaultValue: 'Operational metrics' })}>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
            {isLoading
              ? Array.from({ length: 6 }, (_, index) => <div key={index} className="skeleton h-36 rounded-2xl" />)
              : metrics.map((metric) => <MetricCard key={metric.id} {...metric} />)}
          </div>
        </section>

        <section className="mt-5" aria-labelledby="action-center-workstreams">
          <div className="mb-3">
            <h2 id="action-center-workstreams" className="text-lg font-semibold text-[var(--color-text-primary)]">
              {t('actionCenter.overview.workstreamsTitle', { defaultValue: 'Operational workstreams' })}
            </h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {t('actionCenter.overview.workstreamsSubtitle', { defaultValue: 'Open the right workspace without duplicating decision queues.' })}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <WorkstreamCard
              title={t('actionCenter.overview.workstreams.approvals.title', { defaultValue: 'Approvals' })}
              description={t('actionCenter.overview.workstreams.approvals.description', { defaultValue: 'Review evidence, request information, approve, or reject auditable decisions.' })}
              status={`${Number(approvals?.totalPending ?? 0).toLocaleString()} ${t('actionCenter.overview.open', { defaultValue: 'open' })}`}
              icon={<ShieldCheck className="h-5 w-5" aria-hidden="true" />}
              href={`${base}/approvals?status=pending`}
              actionLabel={t('actionCenter.overview.workstreams.approvals.action', { defaultValue: 'Review approvals' })}
            />
            <WorkstreamCard
              title={t('actionCenter.overview.workstreams.exceptions.title', { defaultValue: 'Exceptions' })}
              description={capabilities?.persistentExceptions
                ? t('actionCenter.overview.workstreams.exceptions.activeDescription', { defaultValue: 'Acknowledge, assign, and resolve persistent operational exceptions.' })
                : t('actionCenter.overview.workstreams.exceptions.previewDescription', { defaultValue: 'Alerts are available for review; acknowledgement workflow is not active yet.' })}
              status={capabilities?.persistentExceptions
                ? `${Number(summary?.exceptions?.open ?? 0).toLocaleString()} ${t('actionCenter.overview.open', { defaultValue: 'open' })}`
                : t('actionCenter.overview.reviewOnly', { defaultValue: 'Review only' })}
              icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
              href={`${base}/exceptions`}
              actionLabel={t('actionCenter.overview.workstreams.exceptions.action', { defaultValue: 'Review alerts' })}
            />
            <WorkstreamCard
              title={t('actionCenter.overview.workstreams.collections.title', { defaultValue: 'Collections' })}
              description={capabilities?.persistentCollections
                ? t('actionCenter.overview.workstreams.collections.activeDescription', { defaultValue: 'Manage contact, promises, disputes, escalation, and payment follow-up.' })
                : t('actionCenter.overview.workstreams.collections.previewDescription', { defaultValue: 'Review live receivables now; collection case actions are not active yet.' })}
              status={collectionExposure}
              icon={<WalletCards className="h-5 w-5" aria-hidden="true" />}
              href={`${base}/collections?status=active&sort=exposure`}
              actionLabel={t('actionCenter.overview.workstreams.collections.action', { defaultValue: 'Review receivables' })}
            />
            <WorkstreamCard
              title={t('actionCenter.overview.workstreams.tasks.title', { defaultValue: 'Tasks' })}
              description={capabilities?.persistentTasks
                ? t('actionCenter.overview.workstreams.tasks.activeDescription', { defaultValue: 'Manage assigned operational tasks and due dates.' })
                : t('actionCenter.overview.workstreams.tasks.previewDescription', { defaultValue: 'Task assignment workflow is not active yet.' })}
              status={capabilities?.persistentTasks
                ? `${Number(summary?.tasks?.open ?? 0).toLocaleString()} ${t('actionCenter.overview.open', { defaultValue: 'open' })}`
                : t('actionCenter.overview.notActive', { defaultValue: 'Not active' })}
              icon={<ClipboardCheck className="h-5 w-5" aria-hidden="true" />}
              href={capabilities?.persistentTasks ? `${base}/tasks` : undefined}
              actionLabel={capabilities?.persistentTasks
                ? t('actionCenter.overview.workstreams.tasks.action', { defaultValue: 'Open tasks' })
                : undefined}
            />
          </div>
        </section>

        <section className="mt-5 rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-5 shadow-sm" aria-labelledby="next-best-action">
          <h2 id="next-best-action" className="text-lg font-semibold text-[var(--color-text-primary)]">
            {t('actionCenter.overview.nextBestAction.title', { defaultValue: 'Next best action' })}
          </h2>
          {summary?.nextBestAction ? (
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-[var(--color-text-primary)]">
                  {t('actionCenter.overview.nextBestAction.reviewPending', { defaultValue: 'Review oldest pending approval' })}
                </p>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                  {t('actionCenter.overview.nextBestAction.description', { defaultValue: 'Start with the oldest decision or a high-priority item.' })}
                </p>
              </div>
              <Link
                to={tenantHref(slug, summary.nextBestAction.href)}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white transition-opacity duration-200 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
              >
                {t('actionCenter.overview.nextBestAction.action', { defaultValue: 'Review oldest pending approval' })}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-3 rounded-xl bg-emerald-50 p-4 text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  {t('actionCenter.overview.nextBestAction.clearTitle', { defaultValue: 'No approval decision is waiting right now.' })}
                </p>
                <p className="mt-1 text-sm">
                  {t('actionCenter.overview.nextBestAction.clearDescription', { defaultValue: 'Use the workstream cards to review receivables or operational reports.' })}
                </p>
              </div>
            </div>
          )}
        </section>
      </ActionCenterShell>
    </DashboardLayout>
  );
}
