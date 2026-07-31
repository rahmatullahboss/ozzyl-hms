import { Users, FlaskConical, BedDouble, Pill, AlertCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../../../hooks/useApiQuery';
import { queryKeys } from '../../../lib/queryKeys';
import { formatCurrency } from '../../../lib/format';

interface TodaySummary {
  totalAppointments: number;
  completedConsultations: number;
  pendingTests: number;
  completedTests: number;
  pharmacySales: number;
}

interface BedSummary {
  total: number;
  available: number;
  occupied: number;
  occupancyPercentage: number;
}

interface PharmacySummary {
  todaySales: number;
  todaySalesCount: number;
  lowStockItems: number;
}

interface DashboardResponse {
  todaySummary: TodaySummary;
  bedSummary: BedSummary;
  pharmacySummary: PharmacySummary;
}

export default function OperationsSnapshot() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useApiQuery<DashboardResponse>(
    queryKeys.admin.dashboard(),
    '/api/dashboard/stats',
    { refetchInterval: 30000 },
  );

  const widgets = [
    {
      icon: <Users className="w-5 h-5 text-blue-500" />,
      titleKey: 'adminDashboard.operationsSnapshot.opdQueue',
      stats: [
        { labelKey: 'adminDashboard.operationsSnapshot.opdAppointments', value: data?.todaySummary?.totalAppointments ?? 0 },
        { labelKey: 'adminDashboard.operationsSnapshot.opdCompleted', value: data?.todaySummary?.completedConsultations ?? 0 },
      ],
    },
    {
      icon: <FlaskConical className="w-5 h-5 text-purple-500" />,
      titleKey: 'adminDashboard.operationsSnapshot.diagnostic',
      stats: [
        { labelKey: 'adminDashboard.operationsSnapshot.diagnosticPending', value: data?.todaySummary?.pendingTests ?? 0 },
        { labelKey: 'adminDashboard.operationsSnapshot.diagnosticCompleted', value: data?.todaySummary?.completedTests ?? 0 },
      ],
    },
    {
      icon: <BedDouble className="w-5 h-5 text-cyan-500" />,
      titleKey: 'adminDashboard.operationsSnapshot.ipd',
      stats: [
        { labelKey: 'adminDashboard.operationsSnapshot.ipdOccupied', value: data?.bedSummary?.occupied ?? 0 },
        { labelKey: 'adminDashboard.operationsSnapshot.ipdAvailable', value: data?.bedSummary?.available ?? 0 },
        { labelKey: 'adminDashboard.operationsSnapshot.ipdOccupancy', value: `${data?.bedSummary?.occupancyPercentage ?? 0}%` },
      ],
    },
    {
      icon: <Pill className="w-5 h-5 text-pink-500" />,
      titleKey: 'adminDashboard.operationsSnapshot.pharmacy',
      stats: [
        { labelKey: 'adminDashboard.operationsSnapshot.pharmacyTodaySales', value: formatCurrency(data?.pharmacySummary?.todaySales ?? 0, { fractionDigits: 0 }) },
      ],
    },
  ];

  return (
    <div className="card p-5">
      <h3 className="font-semibold text-[var(--color-text-primary)] mb-4">{t('adminDashboard.operationsSnapshot.title')}</h3>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-24 w-full rounded-lg" />)}
        </div>
      ) : isError ? (
        <div
          className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-900/20 p-4"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-center gap-2 text-red-700 dark:text-red-300">
            <AlertCircle className="w-4 h-4" />
            <p className="text-sm font-medium">{t('adminDashboard.errors.loadFailed')}</p>
          </div>
          <button
            onClick={() => refetch()}
            className="mt-2 text-xs text-red-700 dark:text-red-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 rounded"
          >
            {t('adminDashboard.errors.retry')}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {widgets.map((w, i) => (
            <div
              key={i}
              className="p-3 rounded-lg bg-[var(--color-bg-secondary)] hover:bg-[var(--color-border-light)] transition-colors"
            >
              <div className="flex items-center gap-2 mb-2">
                {w.icon}
                <span className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wide">
                  {t(w.titleKey)}
                </span>
              </div>
              <div className="space-y-1">
                {w.stats.map((s, j) => (
                  <div key={j} className="flex items-baseline justify-between">
                    <span className="text-xs text-[var(--color-text-muted)]">{t(s.labelKey)}</span>
                    <span className="text-sm font-bold font-data text-[var(--color-text-primary)]">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
