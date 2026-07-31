import { AlertTriangle, ArrowRight, CheckCircle2, Info } from 'lucide-react';
import type { DashboardMetricResult } from '../../../../../../packages/shared/src/dashboard';
import { formatCurrency } from '../../../../lib/format';

interface Props {
  metrics: DashboardMetricResult[];
  onOpenMetric: (metric: DashboardMetricResult) => void;
}

function formatMetricValue(metric: DashboardMetricResult): string {
  if (metric.value === null || metric.sourceStatus.state === 'unavailable' || metric.sourceStatus.state === 'partial') {
    return 'Unavailable';
  }
  if (metric.valueType === 'money') return formatCurrency(metric.value);
  if (metric.valueType === 'percentage') return `${metric.value.toLocaleString('en-US')}%`;
  return metric.value.toLocaleString('en-US');
}

function statusContent(metric: DashboardMetricResult) {
  if (metric.sourceStatus.state === 'unavailable' || metric.sourceStatus.state === 'partial') {
    return { icon: AlertTriangle, label: metric.sourceStatus.state === 'partial' ? 'Partial source data' : 'Source unavailable' };
  }
  if (metric.sourceStatus.state === 'stale') return { icon: Info, label: 'Stale source data' };
  if (metric.reconciliation?.isBalanced === false) return { icon: AlertTriangle, label: 'Unreconciled' };
  if (metric.reconciliation?.isBalanced === true) return { icon: CheckCircle2, label: 'Reconciled' };
  return { icon: Info, label: metric.temporalMode === 'live' ? 'Live/current state' : metric.period.label };
}

export default function OverviewKpiGrid({ metrics, onOpenMetric }: Props) {
  const visibleMetrics = metrics.slice(0, 10);

  if (visibleMetrics.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
        No primary metrics are available for this role and period.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
      {visibleMetrics.map((metric) => {
        const status = statusContent(metric);
        const StatusIcon = status.icon;
        return (
          <button
            key={metric.key}
            type="button"
            data-testid="command-center-kpi"
            aria-label={`Open ${metric.label} details`}
            onClick={() => onOpenMetric(metric)}
            className="group min-h-36 cursor-pointer rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 text-left shadow-sm transition-colors duration-200 hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="line-clamp-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{metric.label}</p>
              <ArrowRight className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden="true" />
            </div>
            <p className="mt-3 font-data text-xl font-bold tabular-nums text-[var(--color-text-primary)]">
              {formatMetricValue(metric)}
            </p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
              <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>{status.label}</span>
            </p>
          </button>
        );
      })}
    </div>
  );
}
