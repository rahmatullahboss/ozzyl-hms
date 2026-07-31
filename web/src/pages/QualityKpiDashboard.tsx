import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BarChart3, TrendingUp, TrendingDown, Bed, Activity, Users, DollarSign,
  FlaskConical, AlertTriangle, Siren, UserCheck, Calendar, RefreshCw, AlertCircle,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { formatDisplayDate } from '../lib/date-utils';

/* ── Types ── */
interface KpiData {
  alos: { value: number; trend: number };
  bed_occupancy: { value: number; trend: number };
  readmission_rate: { value: number; trend: number };
  opd_volume: { value: number; trend: number };
  ipd_volume: { value: number; trend: number };
  revenue_billed: number;
  revenue_collected: number;
  revenue_outstanding: number;
  lab_tat: { value: number; trend: number };
  low_stock_alerts: number;
  emergency_volume: { value: number; trend: number };
  staff_on_duty: number;
}

interface TrendPoint {
  date: string;
  alos?: number;
  bed_occupancy?: number;
  readmission_rate?: number;
  opd_volume?: number;
  ipd_volume?: number;
}

/* ── Helpers ── */
function formatCurrency(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toFixed(0);
}

function KpiCard({
  title, value, unit, trend, icon, iconBg, alert, loading, index = 0,
}: {
  title: string; value: string | number; unit?: string; trend?: number;
  icon: React.ReactNode; iconBg: string; alert?: boolean; loading?: boolean; index?: number;
}) {
  if (loading) {
    return (
      <div className="card p-5">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <div className="skeleton h-3.5 w-28 rounded" />
            <div className="skeleton h-8 w-20 rounded mt-3" />
            <div className="skeleton h-3 w-16 rounded" />
          </div>
          <div className="skeleton w-11 h-11 rounded-xl ml-4" />
        </div>
      </div>
    );
  }

  const isPositive = trend !== undefined && trend >= 0;
  const delay = `${index * 60}ms`;

  return (
    <div
      className={`card p-5 cursor-default group animate-fade-in-up ${alert ? 'ring-2 ring-red-400/50' : ''}`}
      style={{ animationDelay: delay }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[var(--color-text-muted)] truncate">{title}</p>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="font-data text-3xl font-bold text-[var(--color-text-primary)] leading-none tracking-tight">
              {value}
            </span>
            {unit && <span className="text-sm text-[var(--color-text-muted)]">{unit}</span>}
          </div>
          {trend !== undefined && (
            <span className={`mt-2 inline-flex items-center gap-1 text-xs font-medium ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>
              {isPositive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {Math.abs(trend).toFixed(1)}%
              <span className="text-[var(--color-text-muted)] font-normal ml-0.5">{t('cards.vsLastPeriod')}</span>
            </span>
          )}
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${iconBg} transition-all duration-200 group-hover:shadow-[0_0_0_4px_rgba(8,145,178,0.12)] group-hover:scale-105`}>
          {icon}
        </div>
      </div>
      <div className="mt-3 h-0.5 rounded-full bg-gradient-to-r from-[var(--color-primary)] to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}

/* ── Revenue Card ── */
function RevenueCard({ billed, collected, outstanding, loading }: { billed: number; collected: number; outstanding: number; loading: boolean }) {
  if (loading) {
    return (
      <div className="card p-5 col-span-full sm:col-span-2">
        <div className="space-y-3">
          <div className="skeleton h-4 w-32 rounded" />
          <div className="skeleton h-8 w-40 rounded" />
          <div className="skeleton h-4 w-full rounded" />
          <div className="skeleton h-3 w-48 rounded" />
        </div>
      </div>
    );
  }

  const collectedPct = billed > 0 ? (collected / billed) * 100 : 0;

  return (
    <div className="card p-5 col-span-full sm:col-span-2 group animate-fade-in-up" style={{ animationDelay: '480ms' }}>
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-sm font-medium text-[var(--color-text-muted)]">{t('revenue.title')}</p>
          <p className="mt-1 font-data text-3xl font-bold text-[var(--color-text-primary)] leading-none tracking-tight">
            ${formatCurrency(collected)}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-1">
            {t('revenue.collectedOfBilled', { collected: formatCurrency(collected), billed: formatCurrency(billed) })}
          </p>
        </div>
        <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 bg-emerald-50 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400">
          <DollarSign className="w-5 h-5" />
        </div>
      </div>

      {/* Progress bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs">
          <span className="text-[var(--color-text-muted)]">{t('revenue.collectionRate')}</span>
          <span className={`font-semibold ${collectedPct >= 80 ? 'text-emerald-600' : collectedPct >= 60 ? 'text-amber-600' : 'text-red-500'}`}>
            {collectedPct.toFixed(1)}%
          </span>
        </div>
        <div className="h-2.5 bg-[var(--color-border-light)] rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-700 ${collectedPct >= 80 ? 'bg-emerald-500' : collectedPct >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
            style={{ width: `${Math.min(collectedPct, 100)}%` }}
          />
        </div>
        <div className="grid grid-cols-3 gap-3 mt-3">
          <div className="text-center p-2 rounded-lg bg-[var(--color-border-light)]">
            <p className="text-xs text-[var(--color-text-muted)]">{t('revenue.billed')}</p>
            <p className="font-data text-sm font-semibold">${formatCurrency(billed)}</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-[var(--color-border-light)]">
            <p className="text-xs text-[var(--color-text-muted)]">{t('revenue.collected')}</p>
            <p className="font-data text-sm font-semibold text-emerald-600">${formatCurrency(collected)}</p>
          </div>
          <div className="text-center p-2 rounded-lg bg-[var(--color-border-light)]">
            <p className="text-xs text-[var(--color-text-muted)]">{t('revenue.outstanding')}</p>
            <p className="font-data text-sm font-semibold text-red-500">${formatCurrency(outstanding)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Trend Chart Placeholder ── */
function TrendSection({ trends, loading }: { trends: TrendPoint[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="card p-5">
        <div className="skeleton h-4 w-32 rounded mb-4" />
        <div className="skeleton h-48 w-full rounded" />
      </div>
    );
  }

  return (
    <div className="card p-5">
      <h3 className="font-semibold text-sm mb-4">{t('trends.title')}</h3>
      {trends.length === 0 ? (
        <div className="flex items-center justify-center h-48 text-[var(--color-text-muted)]">
          <p className="text-sm">{t('trends.noData')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table-base">
            <thead>
              <tr>
                <th>{t('trends.table.date')}</th>
                <th>{t('trends.table.alos')}</th>
                <th>{t('trends.table.bedOcc')}</th>
                <th className="hidden sm:table-cell">{t('trends.table.readmit')}</th>
                <th className="hidden md:table-cell">{t('trends.table.opd')}</th>
                <th className="hidden md:table-cell">{t('trends.table.ipd')}</th>
              </tr>
            </thead>
            <tbody>
              {trends.map(tp => (
                <tr key={tp.date}>
                  <td className="font-data text-sm whitespace-nowrap">{formatDisplayDate(tp.date)}</td>
                  <td className="font-data text-sm">{tp.alos?.toFixed(1) ?? '—'}</td>
                  <td>
                    <span className={`font-data text-sm ${(tp.bed_occupancy ?? 0) > 90 ? 'text-red-500 font-semibold' : ''}`}>
                      {tp.bed_occupancy?.toFixed(1) ?? '—'}%
                    </span>
                  </td>
                  <td className="hidden sm:table-cell">
                    <span className={`font-data text-sm ${(tp.readmission_rate ?? 0) > 5 ? 'text-red-500 font-semibold' : ''}`}>
                      {tp.readmission_rate?.toFixed(1) ?? '—'}%
                    </span>
                  </td>
                  <td className="hidden md:table-cell font-data text-sm">{tp.opd_volume ?? '—'}</td>
                  <td className="hidden md:table-cell font-data text-sm">{tp.ipd_volume ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Main Page ── */
export default function QualityKpiDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['quality_kpi', 'common']);
  const queryClient = useQueryClient();

  // Default: last 30 days
  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const [dateFrom, setDateFrom] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(today.toISOString().split('T')[0]);

  const { data: kpiRaw, isLoading: loading, isError, error } = useApiQuery<{ data?: KpiData } & KpiData>(
    queryKeys.qualityKpi.dashboard(dateFrom, dateTo),
    `/api/quality-kpi/dashboard?date_from=${dateFrom}&date_to=${dateTo}`,
  );

  const { data: trendsRaw, isLoading: trendLoading } = useApiQuery<{ data?: TrendPoint[] } & TrendPoint[]>(
    queryKeys.qualityKpi.trends(dateFrom, dateTo),
    `/api/quality-kpi/trends?date_from=${dateFrom}&date_to=${dateTo}`,
  );

  const kpi: KpiData | null = kpiRaw?.data ?? (kpiRaw as KpiData | undefined) ?? null;
  const trends: TrendPoint[] = trendsRaw?.data ?? (Array.isArray(trendsRaw) ? trendsRaw : []);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.qualityKpi.all });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('title')}</h1>
              <p className="section-subtitle">{t('subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Date Range Picker */}
        <div className="flex flex-wrap items-center gap-3">
          <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
          <input type="date" className="input w-auto" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className="text-sm text-[var(--color-text-muted)]">{t('filters.to')}</span>
          <input type="date" className="input w-auto" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          <button onClick={handleRefresh} className="btn-ghost p-2"><RefreshCw className="w-4 h-4" /></button>
        </div>

        {/* Error state */}
        {isError ? (
          <div className="card p-8 text-center">
            <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-[var(--color-text-secondary)] mb-3">{t('errors.loadFailed')}</p>
            <button onClick={handleRefresh} className="btn-primary"><RefreshCw className="w-4 h-4" />{t('common:retry')}</button>
          </div>
        ) : (
          <>
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard
                title={t('cards.alos.title')}
                value={kpi?.alos.value.toFixed(1) ?? '—'}
                unit={t('cards.alos.unit')}
                trend={kpi?.alos.trend}
                icon={<Bed className="w-5 h-5" />}
                iconBg="bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400"
                loading={loading}
                index={0}
              />
              <KpiCard
                title={t('cards.bedOccupancy.title')}
                value={kpi?.bed_occupancy.value.toFixed(1) ?? '—'}
                unit={t('cards.bedOccupancy.unit')}
                trend={kpi?.bed_occupancy.trend}
                icon={<Bed className="w-5 h-5" />}
                iconBg="bg-teal-50 text-teal-600 dark:bg-teal-900/30 dark:text-teal-400"
                alert={kpi ? kpi.bed_occupancy.value > 90 : false}
                loading={loading}
                index={1}
              />
              <KpiCard
                title={t('cards.readmissionRate.title')}
                value={kpi?.readmission_rate.value.toFixed(1) ?? '—'}
                unit={t('cards.readmissionRate.unit')}
                trend={kpi?.readmission_rate.trend}
                icon={<Activity className="w-5 h-5" />}
                iconBg="bg-rose-50 text-rose-600 dark:bg-rose-900/30 dark:text-rose-400"
                alert={kpi ? kpi.readmission_rate.value > 5 : false}
                loading={loading}
                index={2}
              />
              <KpiCard
                title={t('cards.opdVolume.title')}
                value={kpi?.opd_volume.value ?? '—'}
                trend={kpi?.opd_volume.trend}
                icon={<Users className="w-5 h-5" />}
                iconBg="bg-violet-50 text-violet-600 dark:bg-violet-900/30 dark:text-violet-400"
                loading={loading}
                index={3}
              />
              <KpiCard
                title={t('cards.ipdVolume.title')}
                value={kpi?.ipd_volume.value ?? '—'}
                trend={kpi?.ipd_volume.trend}
                icon={<Users className="w-5 h-5" />}
                iconBg="bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400"
                loading={loading}
                index={4}
              />
              <KpiCard
                title={t('cards.labTat.title')}
                value={kpi?.lab_tat.value ?? '—'}
                unit={t('cards.labTat.unit')}
                trend={kpi?.lab_tat.trend}
                icon={<FlaskConical className="w-5 h-5" />}
                iconBg="bg-purple-50 text-purple-600 dark:bg-purple-900/30 dark:text-purple-400"
                loading={loading}
                index={5}
              />
              <KpiCard
                title={t('cards.lowStock.title')}
                value={kpi?.low_stock_alerts ?? '—'}
                icon={<AlertTriangle className="w-5 h-5" />}
                iconBg="bg-amber-50 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                alert={kpi ? kpi.low_stock_alerts > 10 : false}
                loading={loading}
                index={6}
              />
              <KpiCard
                title={t('cards.emergencyVolume.title')}
                value={kpi?.emergency_volume.value ?? '—'}
                trend={kpi?.emergency_volume.trend}
                icon={<Siren className="w-5 h-5" />}
                iconBg="bg-red-50 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                loading={loading}
                index={7}
              />
              <KpiCard
                title={t('cards.staffOnDuty.title')}
                value={kpi?.staff_on_duty ?? '—'}
                icon={<UserCheck className="w-5 h-5" />}
                iconBg="bg-cyan-50 text-cyan-600 dark:bg-cyan-900/30 dark:text-cyan-400"
                loading={loading}
                index={8}
              />

              {/* Revenue Card spans 2 cols */}
              <RevenueCard
                billed={kpi?.revenue_billed ?? 0}
                collected={kpi?.revenue_collected ?? 0}
                outstanding={kpi?.revenue_outstanding ?? 0}
                loading={loading}
              />
            </div>

            {/* Trends */}
            <TrendSection trends={trends} loading={trendLoading} />
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
