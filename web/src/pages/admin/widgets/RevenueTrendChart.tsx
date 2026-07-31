import { useMemo, useState } from 'react';
import { AlertCircle, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../../hooks/useApiQuery';
import { formatCurrency } from '../../../lib/format';
import { queryKeys } from '../../../lib/queryKeys';
import type { ExecutiveDashboardFilters } from '../../../types/executiveDashboard';

interface LegacyRevenuePoint {
  day: string;
  revenue: number;
}

interface LegacyRevenueTrendData {
  revenueData: LegacyRevenuePoint[];
}

interface FinancialTrendPoint {
  bucket: string;
  label: string;
  collection: number;
  expense: number;
  result: number;
}

interface FinancialTrendData {
  points: FinancialTrendPoint[];
  totals: {
    collection: number;
    expense: number;
    result: number;
  };
  granularity: 'daily' | 'monthly';
  reconciliation?: Record<string, { status?: 'reconciled' | 'warning' | 'unavailable' }>;
}

type RevenueTrendData = LegacyRevenueTrendData | FinancialTrendData;

const PERIODS = [
  { key: 'periodToday', value: 'Today' },
  { key: 'period7d', value: '7D' },
] as const;
type PeriodValue = (typeof PERIODS)[number]['value'];

type ChartPoint = {
  label: string;
  value: number;
  x: number;
  y: number;
};

const VIEWBOX_WIDTH = 640;
const VIEWBOX_HEIGHT = 176;
const CHART_TOP = 22;
const CHART_BOTTOM = 132;
const LABEL_Y = 164;

function clampNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isFinancialTrendData(data: RevenueTrendData | null | undefined): data is FinancialTrendData {
  return Boolean(data && 'points' in data && 'totals' in data);
}

function buildSmoothPath(points: ChartPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x - 72} ${point.y} C ${point.x - 36} ${point.y - 22}, ${point.x + 36} ${point.y + 22}, ${point.x + 72} ${point.y}`;
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] ?? current;
    const afterNext = points[index + 2] ?? next;
    const cp1x = current.x + (next.x - previous.x) / 6;
    const cp1y = current.y + (next.y - previous.y) / 6;
    const cp2x = next.x - (afterNext.x - current.x) / 6;
    const cp2y = next.y - (afterNext.y - current.y) / 6;
    commands.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`);
  }
  return commands.join(' ');
}

function buildAreaPath(points: ChartPoint[]): string {
  const linePath = buildSmoothPath(points);
  if (!linePath || points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  const leftX = points.length === 1 ? first.x - 72 : first.x;
  const rightX = points.length === 1 ? last.x + 72 : last.x;
  return `${linePath} L ${rightX} ${CHART_BOTTOM + 10} L ${leftX} ${CHART_BOTTOM + 10} Z`;
}

function getChartPoints(points: Array<{ label: string; value: number }>): ChartPoint[] {
  if (points.length === 0) return [];
  const maxValue = Math.max(...points.map((point) => point.value), 1);
  const horizontalPadding = points.length === 1 ? VIEWBOX_WIDTH / 2 : 44;
  const usableWidth = points.length === 1 ? 0 : VIEWBOX_WIDTH - horizontalPadding * 2;
  const usableHeight = CHART_BOTTOM - CHART_TOP;

  return points.map((point, index) => {
    const x = points.length === 1
      ? VIEWBOX_WIDTH / 2
      : horizontalPadding + (usableWidth / Math.max(points.length - 1, 1)) * index;
    const normalized = point.value <= 0 ? 0 : point.value / maxValue;
    const y = CHART_BOTTOM - normalized * usableHeight;
    return {
      ...point,
      x,
      y: Math.max(CHART_TOP, Math.min(CHART_BOTTOM, y)),
    };
  });
}

export interface RevenueTrendChartProps {
  filters?: ExecutiveDashboardFilters;
}

export default function RevenueTrendChart({ filters }: RevenueTrendChartProps = {}) {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<PeriodValue>('7D');
  const queryKey = filters
    ? [...queryKeys.admin.revenueTrend(), filters.startDate, filters.endDate]
    : queryKeys.admin.revenueTrend();
  const queryPath = filters
    ? `/api/dashboard/financial-trend?startDate=${encodeURIComponent(filters.startDate)}&endDate=${encodeURIComponent(filters.endDate)}&series=${encodeURIComponent('collection,expense,result')}`
    : '/api/dashboard/stats';

  const { data, isLoading, isError, refetch } = useApiQuery<RevenueTrendData>(
    queryKey,
    queryPath,
    undefined,
  );

  const financialData = filters && isFinancialTrendData(data) ? data : null;
  const legacyPoints = !filters && data && 'revenueData' in data
    ? data.revenueData.map((point) => ({ label: point.day, value: clampNumber(point.revenue) }))
    : [];
  const visibleLegacyPoints = period === 'Today' ? legacyPoints.slice(-1) : legacyPoints;
  const points = financialData
    ? financialData.points.map((point) => ({ label: point.label, value: clampNumber(point.collection) }))
    : visibleLegacyPoints;
  const total = financialData
    ? clampNumber(financialData.totals.collection)
    : points.reduce((sum, point) => sum + point.value, 0);
  const chartPoints = useMemo(() => getChartPoints(points), [points]);
  const linePath = useMemo(() => buildSmoothPath(chartPoints), [chartPoints]);
  const areaPath = useMemo(() => buildAreaPath(chartPoints), [chartPoints]);

  if (isError) {
    return (
      <div className="card p-5" role="alert" aria-live="assertive">
        <div className="mb-3 flex items-center gap-2 text-red-700 dark:text-red-300">
          <AlertCircle className="h-4 w-4" aria-hidden="true" />
          <p className="text-sm font-medium">{t('adminDashboard.errors.loadFailed')}</p>
        </div>
        <button
          type="button"
          onClick={() => { void refetch(); }}
          className="cursor-pointer rounded text-xs text-red-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 dark:text-red-300"
        >
          {t('adminDashboard.errors.retry')}
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="card p-5">
        <div className="skeleton mb-4 h-4 w-32" />
        <div className="skeleton h-40 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="card overflow-hidden p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300">
            <TrendingUp className="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 className="text-lg font-semibold text-[var(--color-text-primary)]">{t('adminDashboard.revenueTrend.title')}</h3>
        </div>
        {filters ? (
          <span className="rounded-xl border border-[var(--color-border)] px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]">
            {filters.startDate} – {filters.endDate} · {financialData?.granularity ?? 'daily'}
          </span>
        ) : (
          <div className="flex gap-1 rounded-2xl bg-[var(--color-bg-secondary)] p-1">
            {PERIODS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setPeriod(item.value)}
                className={`cursor-pointer rounded-xl px-4 py-2 text-sm font-semibold transition-all motion-reduce:transition-none ${
                  period === item.value
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]'
                }`}
              >
                {t(`adminDashboard.revenueTrend.${item.key}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      {financialData ? (
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl bg-[var(--color-bg-secondary)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Collection</p>
            <p className="mt-1 font-data text-lg font-bold text-[var(--color-text-primary)]">{formatCurrency(financialData.totals.collection)}</p>
          </div>
          <div className="rounded-xl bg-[var(--color-bg-secondary)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Paid expense</p>
            <p className="mt-1 font-data text-lg font-bold text-[var(--color-text-primary)]">{formatCurrency(financialData.totals.expense)}</p>
          </div>
          <div className="rounded-xl bg-[var(--color-bg-secondary)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Result</p>
            <p className="mt-1 font-data text-lg font-bold text-[var(--color-text-primary)]">{formatCurrency(financialData.totals.result)}</p>
          </div>
        </div>
      ) : (
        <div className="mt-7 font-data text-4xl font-bold tracking-tight text-[var(--color-text-primary)]">
          {formatCurrency(total)}
        </div>
      )}

      {points.length === 0 ? (
        <div className="py-14 text-center text-sm text-[var(--color-text-muted)]">{t('adminDashboard.revenueTrend.noData')}</div>
      ) : (
        <div className="mt-8 rounded-3xl bg-gradient-to-b from-emerald-50/60 to-transparent px-2 pt-2 dark:from-emerald-500/5">
          <svg
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
            className="h-44 w-full overflow-visible"
            role="img"
            aria-label={t('adminDashboard.revenueTrend.title')}
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="revenueTrendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(16 185 129)" stopOpacity="0.26" />
                <stop offset="60%" stopColor="rgb(16 185 129)" stopOpacity="0.08" />
                <stop offset="100%" stopColor="rgb(16 185 129)" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="revenueTrendStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="rgb(52 211 153)" />
                <stop offset="50%" stopColor="rgb(20 184 166)" />
                <stop offset="100%" stopColor="rgb(6 148 162)" />
              </linearGradient>
            </defs>
            <path d={`M 32 ${CHART_BOTTOM} H ${VIEWBOX_WIDTH - 32}`} stroke="currentColor" strokeOpacity="0.08" strokeWidth="1" />
            <path d={areaPath} fill="url(#revenueTrendFill)" />
            <path d={linePath} fill="none" stroke="url(#revenueTrendStroke)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
            <path d={linePath} fill="none" stroke="white" strokeOpacity="0.50" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            {chartPoints.map((point) => (
              <g key={`${point.label}-${point.x}`}>
                <circle cx={point.x} cy={point.y} r="7" fill="white" opacity="0.92" />
                <circle cx={point.x} cy={point.y} r="4" fill="rgb(16 185 129)" />
                <text x={point.x} y={LABEL_Y} textAnchor="middle" className="fill-slate-400 text-[12px] font-medium">
                  {point.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      )}

      {financialData && financialData.points.length > 0 ? (
        <table className="sr-only" aria-label="Financial trend data">
          <thead>
            <tr><th>Period</th><th>Collection</th><th>Paid expense</th><th>Result</th></tr>
          </thead>
          <tbody>
            {financialData.points.map((point) => (
              <tr key={point.bucket}>
                <td>{point.label}</td>
                <td>{formatCurrency(point.collection)}</td>
                <td>{formatCurrency(point.expense)}</td>
                <td>{formatCurrency(point.result)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
