import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type {
  CollectionListResponse,
  CollectionQueueItem,
  CollectionStatus,
  CollectionSummary,
} from '../action-center/collectionTypes';
import { useApiQuery } from '../../hooks/useApiQuery';
import { formatDisplayDate, formatDisplayDateTime } from '../../lib/date-utils';
import { queryKeys } from '../../lib/queryKeys';

const PAGE_SIZE = 8;

export interface ExecutiveDuePanelProps {
  role: 'hospital_admin' | 'md' | 'director';
  basePath: string;
  queryKeyScope: 'admin' | 'md' | 'director';
}

function localeFor(language: string): string {
  return language.startsWith('bn') ? 'bn-BD' : 'en-BD';
}

function formatMinor(
  amountMinor: number | null | undefined,
  currencyCode: string | null | undefined,
  language: string,
): string {
  if (amountMinor === null || amountMinor === undefined || !currencyCode) return '—';
  return new Intl.NumberFormat(localeFor(language), {
    style: 'currency',
    currency: currencyCode,
    currencyDisplay: 'code',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function humanize(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function statusTone(status: CollectionStatus): string {
  if (status === 'promised') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (status === 'disputed') return 'bg-red-50 text-red-700 ring-red-200';
  if (status === 'escalated' || status === 'write_off_requested') return 'bg-violet-50 text-violet-700 ring-violet-200';
  if (status === 'contacted') return 'bg-cyan-50 text-cyan-700 ring-cyan-200';
  if (status === 'contact_due') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (status === 'closed') return 'bg-slate-100 text-slate-700 ring-slate-200';
  return 'bg-blue-50 text-blue-700 ring-blue-200';
}

function authorityTone(mode: CollectionSummary['authorityMode']): string {
  if (mode === 'canonical') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (mode === 'shadow') return 'bg-violet-50 text-violet-700 ring-violet-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function followupText(item: CollectionQueueItem): string {
  if (item.promiseDate) return `Promise: ${formatDisplayDate(item.promiseDate)}`;
  if (item.nextFollowupAtUtc) return `Follow-up: ${formatDisplayDateTime(item.nextFollowupAtUtc)}`;
  return '—';
}

function SummaryMetric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <article className="rounded-xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 font-data text-lg font-bold text-[var(--color-text-primary)]">{value}</p>
      {hint ? <p className="mt-1 text-xs text-[var(--color-text-muted)]">{hint}</p> : null}
    </article>
  );
}

function ExecutiveDueSummary({ summary, language }: { summary: CollectionSummary; language: string }) {
  const mixedCurrencies = summary.currencyCode === null && summary.amountsByCurrency.length > 0;
  const totalValue = mixedCurrencies
    ? 'Multiple currencies'
    : formatMinor(summary.totalDueMinor, summary.currencyCode, language);
  const metrics = [
    { label: 'Total outstanding', value: totalValue, hint: `${summary.totalInvoices} open invoices` },
    {
      label: '0–7 days',
      value: formatMinor(summary.currentMinor, summary.currencyCode, language),
      hint: `${summary.agingCounts['0-7']} invoices`,
    },
    {
      label: '8–30 days',
      value: formatMinor(summary.days30Minor, summary.currencyCode, language),
      hint: `${summary.agingCounts['8-30']} invoices`,
    },
    {
      label: '31–60 days',
      value: formatMinor(summary.days60Minor, summary.currencyCode, language),
      hint: `${summary.agingCounts['31-60']} invoices`,
    },
    {
      label: '60+ days',
      value: formatMinor(summary.days90PlusMinor, summary.currencyCode, language),
      hint: `${summary.agingCounts['60+']} invoices`,
    },
    { label: 'Follow-up due', value: String(summary.followupDue), hint: 'Cases needing action' },
    {
      label: 'Promised',
      value: formatMinor(summary.promisedAmountMinor, summary.currencyCode, language),
      hint: 'Expected from payment promises',
    },
    {
      label: 'Disputed',
      value: formatMinor(summary.disputedAmountMinor, summary.currencyCode, language),
      hint: 'Amount under review',
    },
  ];

  return (
    <div role="region" aria-label="Outstanding due summary" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        {metrics.map((metric) => <SummaryMetric key={metric.label} {...metric} />)}
      </div>

      {mixedCurrencies ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">Amounts are shown separately by currency.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.amountsByCurrency.map((amount) => (
              <span
                key={amount.currencyCode}
                className="rounded-full bg-white px-3 py-1 font-data font-semibold ring-1 ring-amber-200"
              >
                {formatMinor(amount.totalDueMinor, amount.currencyCode, language)} · {amount.totalInvoices} invoices
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DueRow({ item, basePath, language }: { item: CollectionQueueItem; basePath: string; language: string }) {
  const detailHref = `${basePath}/action/collections?status=active&sort=exposure&search=${encodeURIComponent(item.invoiceNumber)}`;

  return (
    <tr className="border-t border-[var(--color-border-light)] hover:bg-[var(--color-bg-subtle)]">
      <td className="px-3 py-3">
        <p className="font-semibold text-[var(--color-text-primary)]">{item.patientName}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{item.patientMobile ?? 'No contact number'}</p>
      </td>
      <td className="px-3 py-3 text-sm">
        <p className="font-semibold text-[var(--color-text-primary)]">{item.invoiceNumber}</p>
        <p className="text-xs text-[var(--color-text-muted)]">Issued {formatDisplayDate(item.issuedAtUtc)}</p>
      </td>
      <td className="px-3 py-3 text-right font-data text-sm font-semibold text-red-700">
        {formatMinor(item.dueMinor, item.currencyCode, language)}
      </td>
      <td className="px-3 py-3 text-center text-sm text-[var(--color-text-secondary)]">
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
          {item.daysOutstanding}d
        </span>
      </td>
      <td className="px-3 py-3">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusTone(item.collectionStatus)}`}>
          {humanize(item.collectionStatus)}
        </span>
      </td>
      <td className="px-3 py-3 text-sm text-[var(--color-text-muted)]">{followupText(item)}</td>
      <td className="px-3 py-3 text-right">
        <Link
          to={detailHref}
          aria-label={`Open ${item.invoiceNumber}`}
          className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--color-border-light)] px-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          Review
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </td>
    </tr>
  );
}

export default function ExecutiveDuePanel({ role, basePath, queryKeyScope }: ExecutiveDuePanelProps) {
  const { i18n } = useTranslation('adminReceivables');
  const [page, setPage] = useState(1);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => new Date());
  const filters = useMemo(() => ({
    status: 'active',
    sort: 'exposure',
    page,
    limit: PAGE_SIZE,
    scope: queryKeyScope,
  }), [page, queryKeyScope]);
  const apiPath = `/api/action-center/collections?status=active&sort=exposure&page=${page}&limit=${PAGE_SIZE}`;
  const listQuery = useApiQuery<CollectionListResponse>(
    queryKeys.actionCenter.collections.list(filters),
    apiPath,
    {
      placeholderData: (previous) => previous,
      staleTime: 15_000,
    },
  );

  const data = listQuery.data?.data;
  const items = data?.items ?? [];
  const pagination = data?.pagination ?? { page, limit: PAGE_SIZE, total: 0, totalPages: 0 };
  const errorStatus = Number((listQuery.error as { status?: number } | null)?.status ?? 0);
  const viewAllHref = `${basePath}/action/collections?status=active&sort=exposure`;

  const refresh = async () => {
    await listQuery.refetch();
    setLastRefreshedAt(new Date());
  };

  if (listQuery.isError) {
    return (
      <section
        role="alert"
        data-dashboard-role={role}
        className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-950"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              {errorStatus === 503 ? 'Receivable authority is unavailable' : 'Unable to load outstanding dues'}
            </h2>
            <p className="mt-1 text-sm">
              {errorStatus === 503
                ? 'The configured receivable authority cannot provide a safe live balance. No fallback total was shown.'
                : 'The due panel could not be loaded. No zero balance has been assumed.'}
            </p>
          </div>
          <button
            type="button"
            aria-label="Retry due panel"
            onClick={() => { void refresh(); }}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-red-300 bg-white px-4 text-sm font-semibold hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-labelledby={`${queryKeyScope}-executive-due-title`}
      data-dashboard-role={role}
      className="card overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border-light)] p-4 sm:p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`${queryKeyScope}-executive-due-title`} className="section-title">
              Outstanding Dues &amp; Collection Control
            </h2>
            <span className="inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              Live outstanding dues
            </span>
            {data?.summary ? (
              <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${authorityTone(data.summary.authorityMode)}`}>
                {humanize(data.summary.authorityMode)} authority
              </span>
            ) : null}
          </div>
          <p className="section-subtitle mt-1">
            Current open patient receivables. Summary totals cover the full result set, not only the visible page.
          </p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            Last refreshed {formatDisplayDateTime(lastRefreshedAt)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { void refresh(); }}
            disabled={listQuery.isFetching}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-light)] px-3 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${listQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            Refresh
          </button>
          <Link
            to={viewAllHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            View all dues
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="space-y-4 p-4 sm:p-5">
        {listQuery.isLoading && !data ? (
          <div className="space-y-3" aria-busy="true" aria-label="Loading outstanding dues">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
              {Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton h-24 rounded-xl" />)}
            </div>
            <div className="skeleton h-64 rounded-xl" />
          </div>
        ) : data?.summary ? (
          <>
            <ExecutiveDueSummary summary={data.summary} language={i18n.language} />

            {data.summary.shadowMismatchCount > 0 ? (
              <div role="status" className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
                <strong>{data.summary.shadowMismatchCount} receivable shadow mismatches</strong> require reconciliation review. The served balance still follows the active authority.
              </div>
            ) : null}

            {items.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--color-border)] p-10 text-center text-sm text-[var(--color-text-muted)]">
                No active outstanding dues.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border-light)]">
                <table className="min-w-full" aria-label="Outstanding due preview">
                  <thead className="bg-[var(--color-bg-subtle)]">
                    <tr className="text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                      <th className="px-3 py-3">Patient</th>
                      <th className="px-3 py-3">Invoice</th>
                      <th className="px-3 py-3 text-right">Due</th>
                      <th className="px-3 py-3 text-center">Age</th>
                      <th className="px-3 py-3">Collection status</th>
                      <th className="px-3 py-3">Promise / follow-up</th>
                      <th className="px-3 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <DueRow key={item.sourceKey} item={item} basePath={basePath} language={i18n.language} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-[var(--color-text-muted)]">
                Showing page {pagination.page} of {Math.max(pagination.totalPages, 1)} · {pagination.total} active invoices
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Previous due page"
                  disabled={page <= 1 || listQuery.isFetching}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--color-border-light)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  aria-label="Next due page"
                  disabled={page >= pagination.totalPages || listQuery.isFetching}
                  onClick={() => setPage((current) => current + 1)}
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-[var(--color-border-light)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
