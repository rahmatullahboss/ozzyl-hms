import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { getTodayGMT6 } from '../../lib/date-utils';
import type { DashboardRange, ExecutiveDashboardFilters } from '../../types/executiveDashboard';

const PRESETS: Array<{ key: Exclude<DashboardRange, 'custom'>; label: string }> = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: '7d', label: 'Last 7 Days' },
  { key: '30d', label: 'Last 30 Days' },
];

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function resolveExecutiveDashboardFilters(
  preset: DashboardRange,
  today = getTodayGMT6(),
): ExecutiveDashboardFilters {
  if (!isIsoDate(today)) {
    throw new Error('A valid Bangladesh date is required');
  }
  if (preset === 'today' || preset === 'custom') {
    return { preset, startDate: today, endDate: today };
  }
  if (preset === 'yesterday') {
    const yesterday = addDays(today, -1);
    return { preset, startDate: yesterday, endDate: yesterday };
  }
  if (preset === '7d') return { preset, startDate: addDays(today, -6), endDate: today };
  if (preset === '30d') return { preset, startDate: addDays(today, -29), endDate: today };

  const [year, month] = today.split('-').map(Number);
  if (preset === 'this_week') {
    const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay();
    const mondayOffset = (dayOfWeek + 6) % 7;
    return { preset, startDate: addDays(today, -mondayOffset), endDate: today };
  }
  if (preset === 'this_month') {
    return {
      preset,
      startDate: `${year}-${String(month).padStart(2, '0')}-01`,
      endDate: today,
    };
  }

  const previousMonthLastDay = new Date(Date.UTC(year, month - 1, 0));
  const previousYear = previousMonthLastDay.getUTCFullYear();
  const previousMonth = previousMonthLastDay.getUTCMonth() + 1;
  return {
    preset: 'last_month',
    startDate: `${previousYear}-${String(previousMonth).padStart(2, '0')}-01`,
    endDate: previousMonthLastDay.toISOString().slice(0, 10),
  };
}

interface Props {
  filters: ExecutiveDashboardFilters;
  onChange: (filters: ExecutiveDashboardFilters) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  lastRefreshedAt?: Date | string | null;
  today?: string;
  className?: string;
}

export default function ExecutiveDashboardRangeFilter({
  filters,
  onChange,
  onRefresh,
  refreshing = false,
  lastRefreshedAt,
  today = getTodayGMT6(),
  className = '',
}: Props) {
  const [customOpen, setCustomOpen] = useState(filters.preset === 'custom');
  const [customStart, setCustomStart] = useState(filters.startDate);
  const [customEnd, setCustomEnd] = useState(filters.endDate);

  useEffect(() => {
    setCustomStart(filters.startDate);
    setCustomEnd(filters.endDate);
    setCustomOpen(filters.preset === 'custom');
  }, [filters.endDate, filters.preset, filters.startDate]);

  const customValid = isIsoDate(customStart)
    && isIsoDate(customEnd)
    && customStart <= customEnd;
  const refreshedDate = lastRefreshedAt ? new Date(lastRefreshedAt) : null;
  const refreshedLabel = refreshedDate && !Number.isNaN(refreshedDate.getTime())
    ? new Intl.DateTimeFormat('en-BD', {
      timeZone: 'Asia/Dhaka',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(refreshedDate)
    : 'Not refreshed yet';

  return (
    <section className={`rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 ${className}`.trim()} aria-label="Executive dashboard range">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Date range">
          {PRESETS.map((preset) => (
            <button
              key={preset.key}
              type="button"
              role="tab"
              aria-selected={filters.preset === preset.key && !customOpen}
              onClick={() => {
                setCustomOpen(false);
                onChange(resolveExecutiveDashboardFilters(preset.key, today));
              }}
              className={`rounded-lg px-3 py-2 text-xs font-semibold transition motion-reduce:transition-none ${filters.preset === preset.key && !customOpen
                ? 'bg-[var(--color-primary)] text-white'
                : 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]'}`}
            >
              {preset.label}
            </button>
          ))}
          <button
            type="button"
            role="tab"
            aria-selected={customOpen}
            onClick={() => setCustomOpen(true)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition motion-reduce:transition-none ${customOpen
              ? 'bg-[var(--color-primary)] text-white'
              : 'border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-muted)]'}`}
          >
            Custom
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--color-text-muted)]">Last refreshed: {refreshedLabel}</span>
          <button
            type="button"
            aria-label="Refresh"
            onClick={onRefresh}
            className="btn-secondary text-xs"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {customOpen ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--color-border)] pt-3">
          <label className="text-xs font-medium text-[var(--color-text-muted)]">
            Start date
            <input
              type="date"
              className="input mt-1"
              aria-label="Custom start date"
              value={customStart}
              onChange={(event) => setCustomStart(event.target.value)}
            />
          </label>
          <label className="text-xs font-medium text-[var(--color-text-muted)]">
            End date
            <input
              type="date"
              className="input mt-1"
              aria-label="Custom end date"
              value={customEnd}
              onChange={(event) => setCustomEnd(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            aria-label="Apply custom range"
            disabled={!customValid}
            onClick={() => {
              if (!customValid) return;
              onChange({ preset: 'custom', startDate: customStart, endDate: customEnd });
            }}
          >
            Apply
          </button>
        </div>
      ) : null}
    </section>
  );
}
