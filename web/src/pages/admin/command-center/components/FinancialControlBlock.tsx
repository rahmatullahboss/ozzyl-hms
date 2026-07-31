import { ArrowRight } from 'lucide-react';
import { formatCurrency } from '../../../../lib/format';
import type { FinancialReconciliationEnvelope } from '../../../../types/executiveDashboard';
import ReconciliationStrip from './ReconciliationStrip';

export interface FinancialControlMetric {
  label: string;
  value: number;
  badge?: string;
  emphasis?: boolean;
}

interface Props {
  testId: string;
  title: string;
  description: string;
  formula: string;
  metrics: FinancialControlMetric[];
  secondaryMetrics?: FinancialControlMetric[];
  reconciliation: FinancialReconciliationEnvelope;
  detailsLabel: string;
  onOpenDetails: () => void;
}

function MetricRow({ metric }: { metric: FinancialControlMetric }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-2">
      <div className="min-w-0">
        <p className={`text-sm ${metric.emphasis ? 'font-semibold text-[var(--color-text-primary)]' : 'text-[var(--color-text-secondary)]'}`}>
          {metric.label}
        </p>
        {metric.badge ? (
          <span className="mt-1 inline-flex rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--color-text-muted)]">
            {metric.badge}
          </span>
        ) : null}
      </div>
      <p className={`shrink-0 font-data tabular-nums text-[var(--color-text-primary)] ${metric.emphasis ? 'text-lg font-bold' : 'font-semibold'}`}>
        {formatCurrency(metric.value)}
      </p>
    </div>
  );
}

export default function FinancialControlBlock({
  testId,
  title,
  description,
  formula,
  metrics,
  secondaryMetrics = [],
  reconciliation,
  detailsLabel,
  onOpenDetails,
}: Props) {
  return (
    <article data-testid={testId} className="flex min-w-0 flex-col rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
      <div>
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{title}</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">{description}</p>
        <p className="mt-3 rounded-xl border border-dashed border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]">
          {formula}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {metrics.map((metric) => <MetricRow key={metric.label} metric={metric} />)}
      </div>

      {secondaryMetrics.length > 0 ? (
        <div className="mt-4 border-t border-[var(--color-border)] pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Separate context</p>
          <div className="space-y-2">
            {secondaryMetrics.map((metric) => <MetricRow key={metric.label} metric={metric} />)}
          </div>
        </div>
      ) : null}

      <div className="mt-4">
        <ReconciliationStrip reconciliation={reconciliation} />
      </div>

      <button
        type="button"
        aria-label={detailsLabel}
        onClick={onOpenDetails}
        className="mt-4 inline-flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2 text-sm font-semibold text-[var(--color-text-primary)] transition-colors hover:bg-[var(--color-bg-secondary)] motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
      >
        Review details
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </article>
  );
}
