import { useEffect, useState } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type {
  ExecutiveDashboardFilters,
  PatientAgeAggregateDetailRow,
  PatientAgeBucket,
  PatientAgeDetailResponse,
  PatientAgeDetailSort,
  PatientAgeDetailView,
  PatientAgePatientDetailRow,
} from '../../types/executiveDashboard';
import {
  DASHBOARD_DETAIL_OVERLAY_CLASS,
  DashboardDialogPortal,
  useDashboardDialogLayer,
} from './DashboardDialogLayer';

interface Props {
  ageBucket: PatientAgeBucket | null;
  filters: ExecutiveDashboardFilters;
  canViewPatients: boolean;
  onClose: () => void;
}

const BUCKET_LABELS: Record<PatientAgeBucket, string> = {
  '0_5': '0–5 years',
  '6_17': '6–17 years',
  '18_30': '18–30 years',
  '31_45': '31–45 years',
  '46_60': '46–60 years',
  '61_plus': '61+ years',
  unknown: 'Unknown age',
};

const TABS: Array<{ value: PatientAgeDetailView; label: string }> = [
  { value: 'services', label: 'Services' },
  { value: 'doctors', label: 'Doctors' },
  { value: 'departments', label: 'Departments' },
  { value: 'patients', label: 'Patients' },
];

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'BDT',
  currencyDisplay: 'code',
  maximumFractionDigits: 2,
});

function errorStatus(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
}

function isPatientRow(row: PatientAgeAggregateDetailRow | PatientAgePatientDetailRow): row is PatientAgePatientDetailRow {
  return 'patientId' in row;
}

function defaultSort(view: PatientAgeDetailView): PatientAgeDetailSort {
  if (view === 'services') return 'services';
  if (view === 'patients') return 'name';
  return 'visits';
}

export default function PatientAgeDetailDrawer({ ageBucket, filters, canViewPatients, onClose }: Props) {
  const { dialogRef, initialFocusRef } = useDashboardDialogLayer({ open: Boolean(ageBucket), onClose });
  const [view, setView] = useState<PatientAgeDetailView>('services');
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<PatientAgeDetailSort>('services');
  const [patientAccessDenied, setPatientAccessDenied] = useState(false);
  const pageSize = 25;

  useEffect(() => {
    setView('services');
    setPage(1);
    setSortBy('services');
    setPatientAccessDenied(false);
  }, [ageBucket]);

  const params = new URLSearchParams();
  params.set('ageBucket', ageBucket ?? 'unknown');
  params.set('view', view);
  params.set('preset', filters.preset);
  params.set('startDate', filters.startDate);
  params.set('endDate', filters.endDate);
  params.set('page', String(page));
  params.set('pageSize', String(pageSize));
  params.set('sortBy', sortBy);
  params.set('sortDirection', sortBy === 'name' ? 'asc' : 'desc');
  const detailQuery = params.toString();
  const patientQueryAllowed = view !== 'patients' || (canViewPatients && !patientAccessDenied);
  const query = useApiQuery<PatientAgeDetailResponse>(
    queryKeys.admin.patientAgeDetails(detailQuery),
    `/api/dashboard/patient-age-analytics/details?${detailQuery}`,
    { enabled: Boolean(ageBucket) && patientQueryAllowed, placeholderData: undefined },
  );

  useEffect(() => {
    if (view === 'patients' && query.isError && errorStatus(query.error) === 403) {
      setPatientAccessDenied(true);
    }
  }, [query.error, query.isError, view]);

  if (!ageBucket) return null;

  const bucketLabel = BUCKET_LABELS[ageBucket];
  const patientTabDisabled = !canViewPatients || patientAccessDenied;
  const selectView = (nextView: PatientAgeDetailView) => {
    if (nextView === 'patients' && patientTabDisabled) return;
    setView(nextView);
    setPage(1);
    setSortBy(defaultSort(nextView));
  };

  let content;
  if (view === 'patients' && patientAccessDenied) {
    content = (
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
        Patient identity access is not available. Aggregate services, doctors, and departments remain available.
      </div>
    );
  } else if (query.isLoading) {
    content = (
      <div aria-label="Loading patient age details" className="space-y-3">
        {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-32 rounded-2xl" />)}
      </div>
    );
  } else if (query.isError) {
    content = (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
        <p className="font-semibold">Unable to load patient age details.</p>
        <button
          type="button"
          onClick={() => { void query.refetch(); }}
          className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-current px-3 py-2 font-semibold"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  } else if (!query.data || query.data.rows.length === 0) {
    content = (
      <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
        No matching {view} were found for this age group and period.
      </div>
    );
  } else {
    content = (
      <div className="space-y-3">
        {query.data.rows.map((row) => isPatientRow(row) ? (
          <article key={`patient-${row.patientId}`} data-testid="patient-age-detail-card" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold text-[var(--color-text-primary)]">{row.patientName || `Patient ${row.patientId}`}</h4>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{row.patientCode || 'No patient code'}</p>
              </div>
              <span className="rounded-full bg-[var(--color-bg-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">
                {row.latestServiceAt}
              </span>
            </div>
            <p className="mt-3 text-sm text-[var(--color-text-secondary)]">
              Age at latest matching service: {row.ageAtService ?? 'Unknown'}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
              <span><span className="text-[var(--color-text-muted)]">Visits </span><strong>{numberFormatter.format(row.visits)}</strong></span>
              <span><span className="text-[var(--color-text-muted)]">Admissions </span><strong>{numberFormatter.format(row.admissions)}</strong></span>
              <span><span className="text-[var(--color-text-muted)]">Services </span><strong>{numberFormatter.format(row.services)}</strong></span>
              <span className="sm:col-span-2"><span className="text-[var(--color-text-muted)]">Collection </span><strong>{moneyFormatter.format(row.collection)}</strong></span>
            </div>
          </article>
        ) : (
          <article key={`${view}-${String(row.id)}-${row.name}`} data-testid="patient-age-detail-card" className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="font-semibold text-[var(--color-text-primary)]">{row.name}</h4>
                <p className="mt-1 text-sm text-[var(--color-text-muted)]">{row.category || 'Uncategorized'}</p>
              </div>
              <span className="rounded-full bg-[var(--color-bg-subtle)] px-2.5 py-1 font-data text-sm font-bold text-[var(--color-primary)]">
                {numberFormatter.format(row.uniquePatients)} patients
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <span><strong>{numberFormatter.format(row.visits)}</strong> visits</span>
              <span><strong>{numberFormatter.format(row.services)}</strong> services</span>
              <span><strong>{numberFormatter.format(row.quantity ?? row.services)}</strong> quantity</span>
              <span><strong>{moneyFormatter.format(row.collection)}</strong> collection</span>
            </div>
          </article>
        ))}
      </div>
    );
  }

  return (
    <DashboardDialogPortal>
      <div className={`fixed inset-0 ${DASHBOARD_DETAIL_OVERLAY_CLASS} flex justify-end bg-black/50 backdrop-blur-sm sm:p-4`}>
        <section
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-label={`${bucketLabel} patient age details`}
          className="flex min-h-dvh w-full max-w-none flex-col overflow-hidden bg-[var(--color-bg)] shadow-2xl sm:my-auto sm:h-[min(92vh,900px)] sm:min-h-0 sm:max-w-5xl sm:rounded-2xl"
        >
        <header className="border-b border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Age at service</p>
              <h3 className="mt-1 text-xl font-semibold text-[var(--color-text-primary)]">{bucketLabel}</h3>
              <p className="mt-1 text-sm text-[var(--color-text-muted)]">{filters.startDate} – {filters.endDate} · Asia/Dhaka service date</p>
            </div>
            <button
              ref={initialFocusRef}
              type="button"
              aria-label="Close patient age details"
              onClick={onClose}
              className="btn-ghost min-h-11 min-w-11 shrink-0 p-2"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>

          <div role="tablist" aria-label="Patient age detail views" className="mt-4 flex gap-2 overflow-x-auto pb-1">
            {TABS.map((tab) => {
              const disabled = tab.value === 'patients' && patientTabDisabled;
              return (
                <button
                  key={tab.value}
                  type="button"
                  role="tab"
                  aria-selected={view === tab.value}
                  aria-controls="patient-age-detail-panel"
                  disabled={disabled}
                  onClick={() => selectView(tab.value)}
                  className="min-h-11 shrink-0 cursor-pointer rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-semibold aria-selected:border-[var(--color-primary)] aria-selected:bg-[var(--color-primary)] aria-selected:text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg-card)] px-4 py-3 sm:px-5">
            <div>
              <label htmlFor="patient-age-detail-sort" className="block text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Sort</label>
              <select
                id="patient-age-detail-sort"
                aria-label="Sort patient age details"
                value={sortBy}
                onChange={(event) => { setSortBy(event.target.value as PatientAgeDetailSort); setPage(1); }}
                className="mt-1 min-h-11 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 text-sm"
              >
                <option value="name">Name</option>
                <option value="uniquePatients">Unique patients</option>
                <option value="visits">Visits</option>
                <option value="services">Services</option>
                <option value="collection">Collection</option>
              </select>
            </div>
            {query.data ? (
              <div className="text-right text-sm text-[var(--color-text-muted)]">
                <p>{numberFormatter.format(query.data.totalRows)} grouped rows</p>
                <p>{numberFormatter.format(query.data.totals.uniquePatients)} unique patients · {moneyFormatter.format(query.data.totals.collection)}</p>
              </div>
            ) : null}
          </div>

          <div id="patient-age-detail-panel" role="tabpanel" tabIndex={0} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
            {content}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-[var(--color-border)] bg-[var(--color-bg-card)] p-4">
            <button
              type="button"
              aria-label="Previous page"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="btn-secondary min-h-11 gap-2 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Previous
            </button>
            <span className="font-data text-sm text-[var(--color-text-muted)]">Page {page}</span>
            <button
              type="button"
              aria-label="Next page"
              disabled={!query.data?.hasNextPage}
              onClick={() => setPage((current) => current + 1)}
              className="btn-secondary min-h-11 gap-2 disabled:opacity-50"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </footer>
        </div>
        </section>
      </div>
    </DashboardDialogPortal>
  );
}
