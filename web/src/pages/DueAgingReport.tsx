import { useState } from 'react';
import { Calendar, DollarSign, Clock, BarChart2, AlertTriangle, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6 } from '../lib/date-utils';

interface AgingBucket {
  label: string;
  amount: number;
  count: number;
}

interface AgingData {
  asOfDate: string;
  totalDue: number;
  buckets: AgingBucket[];
}

const BUCKET_COLORS: Record<string, string> = {
  '0-7 days': 'bg-emerald-500',
  '8-15 days': 'bg-amber-500',
  '16-30 days': 'bg-orange-500',
  '31-60 days': 'bg-red-500',
  '60+ days': 'bg-rose-600',
};

const BUCKET_ICONS: Record<string, string> = {
  '0-7 days': 'text-emerald-600 bg-emerald-50',
  '8-15 days': 'text-amber-600 bg-amber-50',
  '16-30 days': 'text-orange-600 bg-orange-50',
  '31-60 days': 'text-red-600 bg-red-50',
  '60+ days': 'text-rose-600 bg-rose-50',
};

function fmt(n: number) {
  return `\u09F3${n.toLocaleString('en-BD')}`;
}

export default function DueAgingReport({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['tenantBilling']);
  const [asOfDate, setAsOfDate] = useState(getTodayGMT6());

  const { data, isLoading } = useApiQuery<{ data: AgingData }>(
    queryKeys.dueAging.summary(asOfDate),
    `/api/due-aging?asOfDate=${asOfDate}`,
  );

  const aging = data?.data;
  const maxAmount = Math.max(...(aging?.buckets.map(b => b.amount) ?? [0]), 1);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6">
        {/* Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <Clock className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('dueAgingReport.title')}</h1>
              <p className="section-subtitle">{t('dueAgingReport.subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <input
              type="date"
              className="input w-40"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
            />
          </div>
        </div>

        {/* Total Due KPI */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <KPICard
            title={t('dueAgingReport.kpi.totalOutstanding')}
            value={isLoading ? '' : fmt(aging?.totalDue ?? 0)}
            icon={<DollarSign className="w-5 h-5" />}
            loading={isLoading}
          />
          <KPICard
            title={t('dueAgingReport.kpi.totalInvoices')}
            value={isLoading ? '' : String(aging?.buckets.reduce((sum, b) => sum + b.count, 0) ?? 0)}
            icon={<FileText className="w-5 h-5" />}
            loading={isLoading}
          />
        </div>

        {/* Bucket Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {isLoading ? (
            [...Array(5)].map((_, i) => (
              <div key={i} className="card p-5">
                <div className="skeleton h-4 w-20 rounded mb-3" />
                <div className="skeleton h-8 w-28 rounded" />
              </div>
            ))
          ) : aging?.buckets.map((bucket) => (
            <div key={bucket.label} className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${BUCKET_ICONS[bucket.label] ?? 'text-gray-600 bg-gray-50'}`}>
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <span className="text-sm font-medium text-[var(--color-text-secondary)]">{t(`dueAgingReport.bucket.${bucket.label}`, bucket.label)}</span>
              </div>
              <p className="text-2xl font-bold text-[var(--color-text-primary)] font-data">{fmt(bucket.amount)}</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">
                {t('dueAgingReport.invoiceCount', { count: bucket.count })}
              </p>
            </div>
          ))}
        </div>

        {/* Bar Chart */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="section-title flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-[var(--color-primary)]" />
              {t('dueAgingReport.distributionTitle')}
            </h2>
          </div>
          {isLoading ? (
            <div className="skeleton h-48 w-full rounded-lg" />
          ) : aging && aging.buckets.some(b => b.amount > 0) ? (
            <div className="space-y-4">
              {aging.buckets.map((bucket) => {
                const pct = maxAmount > 0 ? (bucket.amount / maxAmount) * 100 : 0;
                return (
                  <div key={bucket.label} className="space-y-1">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium text-[var(--color-text-primary)]">{t(`dueAgingReport.bucket.${bucket.label}`, bucket.label)}</span>
                      <span className="text-[var(--color-text-muted)] font-data">{fmt(bucket.amount)}</span>
                    </div>
                    <div className="h-6 bg-[var(--color-border)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${BUCKET_COLORS[bucket.label] ?? 'bg-gray-400'}`}
                        style={{ width: `${pct}%`, minWidth: bucket.amount > 0 ? 8 : 0 }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-[var(--color-text-muted)]">
                      <span>{t('dueAgingReport.invoiceCount', { count: bucket.count })}</span>
                      <span>{aging.totalDue > 0 ? ((bucket.amount / aging.totalDue) * 100).toFixed(1) : '0'}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<BarChart2 className="w-8 h-8 text-[var(--color-text-muted)]" />}
              title={t('dueAgingReport.empty.title')}
              description={t('dueAgingReport.empty.description')}
            />
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
