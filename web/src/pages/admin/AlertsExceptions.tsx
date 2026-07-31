import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useParams, useSearchParams } from 'react-router';
import DashboardLayout from '../../components/DashboardLayout';
import ActionCenterShell from '../../components/action-center/ActionCenterShell';
import ExceptionDetailDrawer from '../../components/action-center/ExceptionDetailDrawer';
import type {
  ExceptionCase,
  ExceptionListResponse,
  ExceptionSeverity,
  ExceptionStatus,
} from '../../components/action-center/exceptionTypes';
import { useApiQuery } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';
import { queryKeys } from '../../lib/queryKeys';
import { formatDateTime } from '../../lib/format';

const STATUS_VALUES = ['active', 'open', 'acknowledged', 'in_progress', 'snoozed', 'resolved', 'dismissed', 'all'] as const;
const SEVERITY_VALUES = ['critical', 'warning', 'info'] as const;
const RULE_VALUES = [
  'cash.stale_handover',
  'billing.high_discount',
  'billing.missing_discount_reference',
  'billing.same_day_cancellation',
  'inventory.low_stock',
] as const;

function validStatus(value: string | null): (typeof STATUS_VALUES)[number] {
  return STATUS_VALUES.includes(value as (typeof STATUS_VALUES)[number])
    ? value as (typeof STATUS_VALUES)[number]
    : 'open';
}

function validSeverity(value: string | null): ExceptionSeverity | '' {
  return SEVERITY_VALUES.includes(value as ExceptionSeverity) ? value as ExceptionSeverity : '';
}

function positiveInteger(value: string | null, fallback: number): number {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function severityTone(severity: ExceptionSeverity): string {
  if (severity === 'critical') return 'bg-red-50 text-red-700 ring-red-200';
  if (severity === 'info') return 'bg-blue-50 text-blue-700 ring-blue-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function statusTone(status: ExceptionStatus): string {
  if (status === 'resolved') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'dismissed') return 'bg-slate-100 text-slate-700 ring-slate-200';
  if (status === 'in_progress') return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (status === 'acknowledged') return 'bg-cyan-50 text-cyan-700 ring-cyan-200';
  if (status === 'snoozed') return 'bg-violet-50 text-violet-700 ring-violet-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function tenantSourceUrl(slug: string, href: string | null): string | null {
  if (!href || !href.startsWith('/')) return null;
  return `/h/${slug}${href}`;
}

function compactNumber(value: unknown): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString() : '0';
}

export default function AlertsExceptions() {
  const { t } = useTranslation('adminPages');
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedCaseId, setSelectedCaseId] = useState<number | null>(null);

  const status = validStatus(searchParams.get('status'));
  const severity = validSeverity(searchParams.get('severity'));
  const type = String(searchParams.get('type') ?? '').trim();
  const assignee = String(searchParams.get('assignee') ?? '').trim();
  const search = String(searchParams.get('search') ?? '').trim();
  const page = positiveInteger(searchParams.get('page'), 1);
  const limit = 50;

  const filters = useMemo(() => ({ status, severity, type, assignee, search, page, limit }), [status, severity, type, assignee, search, page]);
  const apiParams = new URLSearchParams();
  apiParams.set('status', status);
  if (severity) apiParams.set('severity', severity);
  if (type) apiParams.set('type', type);
  if (assignee) apiParams.set('assignee', assignee);
  if (search) apiParams.set('search', search);
  apiParams.set('page', String(page));
  apiParams.set('limit', String(limit));

  const listQuery = useApiQuery<ExceptionListResponse>(
    queryKeys.actionCenter.exceptions.list(filters),
    `/api/action-center/exceptions?${apiParams.toString()}`,
    {
      placeholderData: (previous) => previous,
      staleTime: 15_000,
    },
  );

  const data = listQuery.data?.data;
  const items = data?.items ?? [];
  const summary = data?.summary ?? {};
  const pagination = data?.pagination ?? { page, limit, total: 0, totalPages: 0 };

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  const currentUserId = Number(user?.userId ?? 0);
  const cards = [
    { label: t('alerts.summary.total'), value: summary.total ?? 0, tone: 'text-[var(--color-primary)]' },
    { label: t('alerts.status.open'), value: summary.open ?? 0, tone: 'text-amber-700' },
    { label: t('alerts.severity.critical'), value: summary.critical ?? 0, tone: 'text-red-700' },
    { label: t('alerts.status.snoozed'), value: summary.snoozed ?? 0, tone: 'text-violet-700' },
  ];

  return (
    <DashboardLayout role="hospital_admin">
      <ActionCenterShell
        activeSection="exceptions"
        title={t('alerts.title')}
        description={t('alerts.subtitle')}
        primaryAction={(
          <button
            type="button"
            onClick={() => listQuery.refetch()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('alerts.refresh')}
          </button>
        )}
      >
        <div className="space-y-4">
          <section aria-label={t('alerts.summary.label')} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {cards.map((card) => (
              <article key={card.label} className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{card.label}</p>
                <p className={`mt-2 font-data text-2xl font-bold ${card.tone}`}>{compactNumber(card.value)}</p>
              </article>
            ))}
          </section>

          <section aria-label={t('alerts.filters.label')} className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-3 shadow-sm sm:p-4">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                <span className="mb-1 block">{t('alerts.filters.status')}</span>
                <select value={status} onChange={(event) => setFilter('status', event.target.value)} className="input min-h-11 w-full">
                  {STATUS_VALUES.map((value) => <option key={value} value={value}>{t(`alerts.status.${value}`)}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                <span className="mb-1 block">{t('alerts.filters.severity')}</span>
                <select value={severity} onChange={(event) => setFilter('severity', event.target.value)} className="input min-h-11 w-full">
                  <option value="">{t('alerts.filters.allSeverities')}</option>
                  {SEVERITY_VALUES.map((value) => <option key={value} value={value}>{t(`alerts.severity.${value}`)}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                <span className="mb-1 block">{t('alerts.filters.type')}</span>
                <select value={type} onChange={(event) => setFilter('type', event.target.value)} className="input min-h-11 w-full">
                  <option value="">{t('alerts.filters.allTypes')}</option>
                  {RULE_VALUES.map((value) => <option key={value} value={value}>{t(`alerts.rules.${value}`)}</option>)}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                <span className="mb-1 block">{t('alerts.filters.assignee')}</span>
                <select value={assignee} onChange={(event) => setFilter('assignee', event.target.value)} className="input min-h-11 w-full">
                  <option value="">{t('alerts.filters.allAssignees')}</option>
                  {currentUserId > 0 ? <option value={String(currentUserId)}>{t('alerts.filters.assignedToMe')}</option> : null}
                </select>
              </label>
              <label className="text-sm font-medium text-[var(--color-text-primary)]">
                <span className="mb-1 block">{t('alerts.filters.search')}</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden="true" />
                  <input value={search} onChange={(event) => setFilter('search', event.target.value)} placeholder={t('alerts.filters.searchPlaceholder')} className="input min-h-11 w-full pl-9" />
                </span>
              </label>
            </div>
          </section>

          {listQuery.isLoading && !data ? (
            <div role="status" className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-8 text-center text-sm text-[var(--color-text-muted)]">
              {t('alerts.loading')}
            </div>
          ) : listQuery.isError && !data ? (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
              <p>{t('alerts.error')}</p>
              <button type="button" onClick={() => listQuery.refetch()} className="mt-3 min-h-11 rounded-xl px-3 font-semibold hover:bg-red-100">
                {t('alerts.retry')}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-10 text-center">
              <AlertTriangle className="mx-auto h-8 w-8 text-emerald-600" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-semibold text-[var(--color-text-primary)]">{t('alerts.emptyTitle')}</h2>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{t('alerts.empty')}</p>
            </div>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] shadow-sm">
              {listQuery.isError ? (
                <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{t('alerts.stale')}</div>
              ) : null}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[940px] border-collapse text-left text-sm">
                  <thead className="bg-[var(--color-bg-subtle)] text-xs uppercase tracking-wide text-[var(--color-text-muted)]">
                    <tr>
                      <th className="px-4 py-3">{t('alerts.table.exception')}</th>
                      <th className="px-4 py-3">{t('alerts.table.severity')}</th>
                      <th className="px-4 py-3">{t('alerts.table.status')}</th>
                      <th className="px-4 py-3">{t('alerts.table.assignee')}</th>
                      <th className="px-4 py-3">{t('alerts.table.age')}</th>
                      <th className="px-4 py-3">{t('alerts.table.updated')}</th>
                      <th className="px-4 py-3 text-right">{t('alerts.table.source')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--color-border-light)]">
                    {items.map((item) => (
                      <ExceptionRow key={item.id} item={item} slug={slug} onOpen={() => setSelectedCaseId(item.id)} t={t} />
                    ))}
                  </tbody>
                </table>
              </div>
              <footer className="flex flex-col gap-3 border-t border-[var(--color-border-light)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-[var(--color-text-muted)]">
                  {t('alerts.pagination.summary', { page: pagination.page, totalPages: pagination.totalPages, total: pagination.total })}
                </p>
                <div className="flex gap-2">
                  <button type="button" aria-label={t('alerts.pagination.previous')} disabled={pagination.page <= 1} onClick={() => setFilter('page', String(pagination.page - 1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--color-border-light)] disabled:opacity-40">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button type="button" aria-label={t('alerts.pagination.next')} disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages} onClick={() => setFilter('page', String(pagination.page + 1))} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--color-border-light)] disabled:opacity-40">
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </footer>
            </section>
          )}
        </div>
      </ActionCenterShell>

      <ExceptionDetailDrawer
        open={selectedCaseId !== null}
        caseId={selectedCaseId}
        onClose={() => setSelectedCaseId(null)}
        onChanged={() => listQuery.refetch()}
      />
    </DashboardLayout>
  );
}

function ExceptionRow({
  item,
  slug,
  onOpen,
  t,
}: {
  item: ExceptionCase;
  slug: string;
  onOpen: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const source = tenantSourceUrl(slug, item.sourceHref);
  return (
    <tr className="hover:bg-[var(--color-bg-subtle)]">
      <td className="px-4 py-3 align-top">
        <button type="button" onClick={onOpen} className="min-h-11 max-w-md rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          <span className="block font-semibold text-[var(--color-text-primary)]">{item.title}</span>
          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-[var(--color-text-muted)]">{item.description}</span>
          <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{item.ruleKey}</span>
        </button>
      </td>
      <td className="px-4 py-3 align-top"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${severityTone(item.severity)}`}>{t(`alerts.severity.${item.severity}`)}</span></td>
      <td className="px-4 py-3 align-top"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusTone(item.status)}`}>{t(`alerts.status.${item.status}`)}</span></td>
      <td className="px-4 py-3 align-top text-[var(--color-text-muted)]">{item.assignedToName ?? t('alerts.unassigned')}</td>
      <td className="px-4 py-3 align-top font-data text-[var(--color-text-primary)]">{item.slaAgeHours}h</td>
      <td className="px-4 py-3 align-top text-[var(--color-text-muted)]">{formatDateTime(item.updatedAt)}</td>
      <td className="px-4 py-3 text-right align-top">
        {source ? (
          <a href={source} className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            {t('alerts.openSource')}
          </a>
        ) : <span className="text-[var(--color-text-muted)]">—</span>}
      </td>
    </tr>
  );
}
