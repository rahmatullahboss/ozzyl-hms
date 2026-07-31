import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import DashboardLayout from '../../components/DashboardLayout';
import ActionCenterShell from '../../components/action-center/ActionCenterShell';
import CollectionDetailDrawer from '../../components/action-center/CollectionDetailDrawer';
import type {
  CollectionListResponse,
  CollectionQueueItem,
  CollectionStatus,
  CollectionSummary,
  ReceivableAuthorityMode,
} from '../../components/action-center/collectionTypes';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

const STATUS_VALUES = [
  'active',
  'new',
  'contact_due',
  'contacted',
  'promised',
  'disputed',
  'escalated',
  'write_off_requested',
  'closed',
  'all',
] as const;
const FOLLOWUP_VALUES = ['', 'due', 'upcoming', 'none'] as const;
const AGE_BUCKET_VALUES = ['', '0-7', '8-30', '31-60', '60+'] as const;
const SORT_VALUES = ['exposure', 'oldest', 'followup'] as const;
const PAGE_LIMIT = 50;

type StatusFilter = (typeof STATUS_VALUES)[number];
type FollowupFilter = (typeof FOLLOWUP_VALUES)[number];
type AgeBucketFilter = (typeof AGE_BUCKET_VALUES)[number];
type SortFilter = (typeof SORT_VALUES)[number];

function enumValue<T extends readonly string[]>(
  values: T,
  value: string | null,
  fallback: T[number],
): T[number] {
  return values.includes(value as T[number]) ? value as T[number] : fallback;
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function formatMinor(
  amountMinor: number | null | undefined,
  currencyCode: string | null | undefined,
  language: string,
): string {
  if (amountMinor === null || amountMinor === undefined || !currencyCode) return '—';
  return new Intl.NumberFormat(language, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
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

function authorityTone(mode: ReceivableAuthorityMode): string {
  if (mode === 'canonical') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (mode === 'shadow') return 'bg-violet-50 text-violet-700 ring-violet-200';
  return 'bg-amber-50 text-amber-700 ring-amber-200';
}

function openLabel(invoiceNumber: string): string {
  return `Open ${invoiceNumber}`;
}

function SummaryCards({
  summary,
  language,
  t,
}: {
  summary: CollectionSummary;
  language: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const cards = [
    { label: t('dueReceivables.summary.totalDue'), amount: summary.totalDueMinor },
    { label: t('dueReceivables.summary.current'), amount: summary.currentMinor },
    { label: t('dueReceivables.summary.days30'), amount: summary.days30Minor },
    { label: t('dueReceivables.summary.days60'), amount: summary.days60Minor },
    { label: t('dueReceivables.summary.days90Plus'), amount: summary.days90PlusMinor },
  ];

  return (
    <section aria-label={t('dueReceivables.summary.label')} className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {cards.map((card) => (
          <article key={card.label} className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{card.label}</p>
            <p className="mt-2 font-data text-xl font-bold text-[var(--color-text-primary)]">
              {formatMinor(card.amount, summary.currencyCode, language)}
            </p>
          </article>
        ))}
        <article className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            {t('dueReceivables.summary.followupDue')}
          </p>
          <p className="mt-2 font-data text-xl font-bold text-amber-700">{summary.followupDue}</p>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            {t('dueReceivables.summary.invoices', { count: summary.totalInvoices })}: {summary.totalInvoices}
          </p>
        </article>
      </div>

      {summary.currencyCode === null && summary.amountsByCurrency.length > 0 ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">{t('dueReceivables.summary.mixedCurrency')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {summary.amountsByCurrency.map((amount) => (
              <span key={amount.currencyCode} className="rounded-full bg-white px-3 py-1 font-data font-semibold ring-1 ring-amber-200">
                {formatMinor(amount.totalDueMinor, amount.currencyCode, language)} · {amount.totalInvoices}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function CollectionRow({
  item,
  language,
  t,
  onOpen,
}: {
  item: CollectionQueueItem;
  language: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  onOpen: () => void;
}) {
  return (
    <tr className="border-t border-[var(--color-border-light)] hover:bg-[var(--color-bg-subtle)]">
      <td className="px-4 py-3">
        <p className="font-semibold text-[var(--color-text-primary)]">{item.patientName}</p>
        <p className="text-xs text-[var(--color-text-muted)]">{item.patientMobile ?? '—'}</p>
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-text-primary)]">{item.invoiceNumber}</td>
      <td className="px-4 py-3 text-right font-data text-sm font-semibold text-red-700">
        {formatMinor(item.dueMinor, item.currencyCode, language)}
      </td>
      <td className="px-4 py-3 text-center font-data text-sm">{item.daysOutstanding}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusTone(item.collectionStatus)}`}>
          {t(`dueReceivables.status.${item.collectionStatus}`)}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-[var(--color-text-muted)]">
        {item.nextFollowupAtUtc ?? '—'}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          type="button"
          onClick={onOpen}
          aria-label={t('dueReceivables.actions.openCase', {
            defaultValue: 'Open {{invoice}}',
            invoice: item.invoiceNumber,
          }) || openLabel(item.invoiceNumber)}
          className="min-h-11 rounded-xl border border-[var(--color-border-light)] px-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
        >
          {t('dueReceivables.actions.open')}
        </button>
      </td>
    </tr>
  );
}

export default function DueReceivables() {
  const { t, i18n } = useTranslation('adminReceivables');
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedSourceKey, setSelectedSourceKey] = useState<string | null>(null);

  const status = enumValue(STATUS_VALUES, searchParams.get('status'), 'active') as StatusFilter;
  const followup = enumValue(FOLLOWUP_VALUES, searchParams.get('followup'), '') as FollowupFilter;
  const ageBucket = enumValue(AGE_BUCKET_VALUES, searchParams.get('ageBucket'), '') as AgeBucketFilter;
  const sort = enumValue(SORT_VALUES, searchParams.get('sort'), 'exposure') as SortFilter;
  const search = String(searchParams.get('search') ?? '').slice(0, 120);
  const page = positiveInteger(searchParams.get('page'), 1);

  const filters = useMemo(() => ({
    status,
    followup,
    ageBucket,
    sort,
    search,
    page,
    limit: PAGE_LIMIT,
  }), [status, followup, ageBucket, sort, search, page]);

  const apiParams = new URLSearchParams({
    status,
    sort,
    page: String(page),
    limit: String(PAGE_LIMIT),
  });
  if (followup) apiParams.set('followup', followup);
  if (ageBucket) apiParams.set('ageBucket', ageBucket);
  if (search) apiParams.set('search', search);

  const listQuery = useApiQuery<CollectionListResponse>(
    queryKeys.actionCenter.collections.list(filters),
    `/api/action-center/collections?${apiParams.toString()}`,
    {
      placeholderData: (previous) => previous,
      staleTime: 15_000,
    },
  );

  const data = listQuery.data?.data;
  const items = data?.items ?? [];
  const pagination = data?.pagination ?? { page, limit: PAGE_LIMIT, total: 0, totalPages: 0 };
  const errorStatus = Number((listQuery.error as { status?: number } | null)?.status ?? 0);

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setSearchParams(next);
  };

  return (
    <DashboardLayout role="hospital_admin">
      <ActionCenterShell
        activeSection="collections"
        title={t('dueReceivables.title')}
        description={t('dueReceivables.subtitle')}
        primaryAction={(
          <button
            type="button"
            onClick={() => listQuery.refetch()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] px-4 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t('dueReceivables.actions.refresh')}
          </button>
        )}
      >
        <div className="space-y-4">
          {errorStatus === 503 ? (
            <section role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
              <h2 className="font-semibold">{t('dueReceivables.authority.unavailable')}</h2>
              <p className="mt-1 text-sm">{t('dueReceivables.authority.unavailableDescription')}</p>
            </section>
          ) : null}

          {errorStatus !== 503 && data?.summary ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${authorityTone(data.summary.authorityMode)}`}>
                  {t(`dueReceivables.authority.${data.summary.authorityMode}`)}
                </span>
                {data.summary.authorityMode === 'shadow' ? (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {t('dueReceivables.authority.shadowMismatches', { count: data.summary.shadowMismatchCount })}: {data.summary.shadowMismatchCount}
                  </span>
                ) : null}
              </div>
              <SummaryCards summary={data.summary} language={i18n.language} t={t} />
            </>
          ) : null}

          {errorStatus !== 503 ? (
            <section aria-label={t('dueReceivables.filters.label')} className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-4 shadow-sm">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  <span className="mb-1 block">{t('dueReceivables.filters.status')}</span>
                  <select
                    aria-label={t('dueReceivables.filters.status')}
                    value={status}
                    onChange={(event) => setFilter('status', event.target.value)}
                    className="input min-h-11 w-full"
                  >
                    {STATUS_VALUES.map((value) => (
                      <option key={value} value={value}>{t(`dueReceivables.status.${value}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  <span className="mb-1 block">{t('dueReceivables.filters.followup')}</span>
                  <select
                    aria-label={t('dueReceivables.filters.followup')}
                    value={followup}
                    onChange={(event) => setFilter('followup', event.target.value)}
                    className="input min-h-11 w-full"
                  >
                    {FOLLOWUP_VALUES.map((value) => (
                      <option key={value || 'all'} value={value}>{t(`dueReceivables.followupFilter.${value || 'all'}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  <span className="mb-1 block">{t('dueReceivables.filters.ageBucket')}</span>
                  <select
                    aria-label={t('dueReceivables.filters.ageBucket')}
                    value={ageBucket}
                    onChange={(event) => setFilter('ageBucket', event.target.value)}
                    className="input min-h-11 w-full"
                  >
                    {AGE_BUCKET_VALUES.map((value) => (
                      <option key={value || 'all'} value={value}>{t(`dueReceivables.ageBucket.${value || 'all'}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  <span className="mb-1 block">{t('dueReceivables.filters.sort')}</span>
                  <select
                    aria-label={t('dueReceivables.filters.sort')}
                    value={sort}
                    onChange={(event) => setFilter('sort', event.target.value)}
                    className="input min-h-11 w-full"
                  >
                    {SORT_VALUES.map((value) => (
                      <option key={value} value={value}>{t(`dueReceivables.sort.${value}`)}</option>
                    ))}
                  </select>
                </label>
                <label className="text-sm font-medium text-[var(--color-text-primary)]">
                  <span className="mb-1 block">{t('dueReceivables.filters.search')}</span>
                  <span className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
                    <input
                      aria-label={t('dueReceivables.filters.search')}
                      value={search}
                      onChange={(event) => setFilter('search', event.target.value.slice(0, 120))}
                      className="input min-h-11 w-full pl-9"
                      maxLength={120}
                    />
                  </span>
                </label>
              </div>
            </section>
          ) : null}

          {errorStatus !== 503 && listQuery.isLoading && !data ? (
            <div className="space-y-3" aria-label={t('dueReceivables.loading')}>
              {[1, 2, 3].map((item) => <div key={item} className="skeleton h-20 rounded-2xl" />)}
            </div>
          ) : null}

          {errorStatus !== 503 && listQuery.isError && errorStatus !== 503 && !data ? (
            <section role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900">
              <p className="font-semibold">{t('dueReceivables.error')}</p>
              <button type="button" onClick={() => listQuery.refetch()} className="mt-3 min-h-11 rounded-xl px-4 font-semibold ring-1 ring-red-300">
                {t('dueReceivables.actions.retry')}
              </button>
            </section>
          ) : null}

          {errorStatus !== 503 && !listQuery.isLoading && items.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--color-border-light)] bg-[var(--color-bg-card)] py-14 text-center text-sm text-[var(--color-text-muted)]">
              {t('dueReceivables.empty')}
            </div>
          ) : null}

          {errorStatus !== 503 && items.length > 0 ? (
            <>
              <div className="hidden overflow-hidden rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] shadow-sm md:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[980px]" aria-label={t('dueReceivables.table.label')}>
                    <thead className="bg-[var(--color-bg-subtle)]">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('dueReceivables.table.patient')}</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('dueReceivables.table.invoice')}</th>
                        <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('dueReceivables.table.due')}</th>
                        <th scope="col" className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('dueReceivables.table.age')}</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('dueReceivables.table.status')}</th>
                        <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('dueReceivables.table.followup')}</th>
                        <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{t('dueReceivables.table.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <CollectionRow
                          key={item.sourceKey}
                          item={item}
                          language={i18n.language}
                          t={t}
                          onOpen={() => setSelectedSourceKey(item.sourceKey)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-3 md:hidden" data-testid="collection-mobile-list">
                {items.map((item) => (
                  <article key={item.sourceKey} className="rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[var(--color-text-primary)]">{item.patientName}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{item.invoiceNumber}</p>
                      </div>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusTone(item.collectionStatus)}`}>
                        {t(`dueReceivables.status.${item.collectionStatus}`)}
                      </span>
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <dt className="text-xs text-[var(--color-text-muted)]">{t('dueReceivables.table.due')}</dt>
                        <dd className="font-data font-bold text-red-700">{formatMinor(item.dueMinor, item.currencyCode, i18n.language)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-[var(--color-text-muted)]">{t('dueReceivables.table.age')}</dt>
                        <dd className="font-data font-semibold">{item.daysOutstanding}</dd>
                      </div>
                    </dl>
                    <button
                      type="button"
                      onClick={() => setSelectedSourceKey(item.sourceKey)}
                      aria-label={t('dueReceivables.actions.openCase', {
                        defaultValue: 'Open {{invoice}}',
                        invoice: item.invoiceNumber,
                      }) || openLabel(item.invoiceNumber)}
                      className="mt-4 min-h-11 w-full rounded-xl bg-[var(--color-primary)] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
                    >
                      {t('dueReceivables.actions.open')}
                    </button>
                  </article>
                ))}
              </div>

              <nav aria-label={t('dueReceivables.pagination.label')} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--color-border-light)] bg-[var(--color-bg-card)] p-3">
                <p className="text-sm text-[var(--color-text-muted)]">
                  {pagination.total} · {pagination.page}/{Math.max(1, pagination.totalPages)}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pagination.page <= 1}
                    onClick={() => setFilter('page', String(pagination.page - 1))}
                    className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-[var(--color-border-light)] px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                    {t('dueReceivables.actions.previous')}
                  </button>
                  <button
                    type="button"
                    disabled={pagination.totalPages === 0 || pagination.page >= pagination.totalPages}
                    onClick={() => setFilter('page', String(pagination.page + 1))}
                    className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-[var(--color-border-light)] px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t('dueReceivables.actions.next')}
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </nav>
            </>
          ) : null}
        </div>
      </ActionCenterShell>

      <CollectionDetailDrawer
        open={Boolean(selectedSourceKey)}
        sourceKey={selectedSourceKey}
        onClose={() => setSelectedSourceKey(null)}
        onChanged={() => listQuery.refetch()}
      />
    </DashboardLayout>
  );
}
