import { Activity, CalendarRange } from 'lucide-react';
import ExecutiveDashboardRangeFilter from '../../../components/dashboard/ExecutiveDashboardRangeFilter';
import type { ExecutiveDashboardFilters } from '../../../types/executiveDashboard';

interface Props {
  filters: ExecutiveDashboardFilters;
  generatedAt: string;
  onFiltersChange: (filters: ExecutiveDashboardFilters) => void;
  onRefresh: () => void;
  refreshing?: boolean;
}

export default function CommandCenterHeader({
  filters,
  generatedAt,
  onFiltersChange,
  onRefresh,
  refreshing = false,
}: Props) {
  const periodLabel = filters.startDate === filters.endDate
    ? filters.endDate
    : `${filters.startDate} – ${filters.endDate}`;

  return (
    <header className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Hospital administration</p>
          <h1 className="mt-1 text-2xl font-bold text-[var(--color-text-primary)]">Admin Command Center</h1>
          <p className="mt-1 text-sm text-[var(--color-text-muted)]">Decision-grade reporting with explicit period and live-state context.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 font-medium text-[var(--color-text-secondary)]">
            <CalendarRange className="h-4 w-4" aria-hidden="true" />
            <span>{periodLabel}</span>
          </span>
          <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[var(--color-border)] px-3 py-2 font-medium text-[var(--color-text-secondary)]">
            <Activity className="h-4 w-4" aria-hidden="true" />
            <span>Live/current state widgets are labeled separately</span>
          </span>
        </div>
      </div>
      <ExecutiveDashboardRangeFilter
        filters={filters}
        onChange={onFiltersChange}
        onRefresh={onRefresh}
        refreshing={refreshing}
        lastRefreshedAt={generatedAt}
        className="mt-4 shadow-none"
      />
    </header>
  );
}
