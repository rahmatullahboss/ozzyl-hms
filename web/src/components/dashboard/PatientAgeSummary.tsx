import { AlertCircle, RefreshCw, UsersRound } from 'lucide-react';
import type {
  PatientAgeAnalyticsResponse,
  PatientAgeBucket,
} from '../../types/executiveDashboard';

interface Props {
  data?: PatientAgeAnalyticsResponse;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onBucketSelect: (bucket: PatientAgeBucket) => void;
}

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
const moneyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'BDT',
  currencyDisplay: 'code',
  maximumFractionDigits: 2,
});

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-subtle)] p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{label}</p>
      <p className="mt-1 font-data text-lg font-bold text-[var(--color-text-primary)]">{value}</p>
    </div>
  );
}

export default function PatientAgeSummary({ data, loading, error, onRetry, onBucketSelect }: Props) {
  if (loading) {
    return (
      <div aria-label="Loading patient age analytics" className="space-y-3">
        <div className="skeleton h-24 rounded-2xl" />
        {Array.from({ length: 7 }, (_, index) => <div key={index} className="skeleton h-28 rounded-2xl" />)}
      </div>
    );
  }

  if (error) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
        <span className="flex items-center gap-2 font-medium">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          Unable to load patient age analytics.
        </span>
        <button
          type="button"
          aria-label="Retry patient age analytics"
          onClick={onRetry}
          className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-current px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
        Patient age analytics is unavailable.
      </div>
    );
  }

  const unknownWarning = data.warnings.find((warning) => warning.toLowerCase().includes('unknown age'));
  const empty = data.totals.uniquePatients === 0;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--color-bg-subtle)] text-[var(--color-primary)]">
            <UsersRound className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">Patient demand by age at service</h3>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Completed age is calculated on each visit, admission, or invoice service date in Asia/Dhaka.
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Stat label="Unique patients" value={numberFormatter.format(data.totals.uniquePatients)} />
          <Stat label="Visits" value={numberFormatter.format(data.totals.visits)} />
          <Stat label="Services" value={numberFormatter.format(data.totals.services)} />
          <Stat label="Collection" value={moneyFormatter.format(data.totals.collection)} />
          <Stat label="Average bill" value={moneyFormatter.format(data.totals.averageBill)} />
        </div>
      </div>

      {unknownWarning ? (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          <span className="font-semibold">Unknown age:</span> {unknownWarning}
        </div>
      ) : null}

      {empty ? (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          No patient activity was found for this period.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {data.rows.map((row) => (
            <button
              key={row.bucket}
              type="button"
              aria-label={`Open ${row.label} age details`}
              onClick={() => onBucketSelect(row.bucket)}
              className="min-h-11 cursor-pointer rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 text-left shadow-sm transition-colors hover:bg-[var(--color-bg-subtle)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[var(--color-text-primary)]">{row.label}</p>
                  <p className="mt-1 text-sm text-[var(--color-text-muted)]">
                    {numberFormatter.format(row.uniquePatients)} patients · {numberFormatter.format(row.patientShare)}%
                  </p>
                </div>
                <span className="rounded-full bg-[var(--color-bg-subtle)] px-2.5 py-1 font-data text-sm font-bold text-[var(--color-primary)]">
                  {numberFormatter.format(row.uniquePatients)}
                </span>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--color-bg-subtle)]" aria-hidden="true">
                <div
                  data-testid={`patient-age-share-${row.bucket}`}
                  className="h-full rounded-full bg-[var(--color-primary)]"
                  style={{ width: `${Math.max(0, Math.min(100, row.patientShare))}%` }}
                />
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm sm:grid-cols-4">
                <span><span className="text-[var(--color-text-muted)]">Visits </span><strong className="font-data">{numberFormatter.format(row.visits)}</strong></span>
                <span><span className="text-[var(--color-text-muted)]">Services </span><strong className="font-data">{numberFormatter.format(row.services)}</strong></span>
                <span><span className="text-[var(--color-text-muted)]">Collection </span><strong className="font-data">{moneyFormatter.format(row.collection)}</strong></span>
                <span><span className="text-[var(--color-text-muted)]">Avg bill </span><strong className="font-data">{moneyFormatter.format(row.averageBill)}</strong></span>
              </div>
            </button>
          ))}
        </div>
      )}

      {data.warnings.filter((warning) => warning !== unknownWarning).map((warning) => (
        <p key={warning} className="text-xs text-[var(--color-text-muted)]">{warning}</p>
      ))}
    </div>
  );
}
