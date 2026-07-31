import { useState } from 'react';
import {
  BarChart3, FileText, Pill, Activity, ClipboardList, Stethoscope,
  Package, RefreshCw, Calendar, AlertTriangle, Users,
} from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6 } from '../lib/date-utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface DailySummary {
  vitals_count: number;
  medications_given: number;
  medications_missed: number;
  notes_count: number;
  orders_acknowledged: number;
  services_added: number;
}

interface MissedDose {
  id: number;
  patient_name: string;
  medicine: string;
  reason: string | null;
  time: string;
}

interface NurseWorkload {
  nurse_id: number;
  nurse_name: string;
  tasks_assigned: number;
  tasks_completed: number;
  patients_assigned: number;
}

// ─── Tabs ───────────────────────────────────────────────────────────────────

type TabKey = 'daily' | 'missed-doses' | 'workload';

const TABS: { key: TabKey; labelKey: string; icon: React.ReactNode }[] = [
  { key: 'daily', labelKey: 'reports.daily', icon: <BarChart3 className="w-4 h-4" /> },
  { key: 'missed-doses', labelKey: 'reports.missedDoses', icon: <AlertTriangle className="w-4 h-4" /> },
  { key: 'workload', labelKey: 'reports.workload', icon: <Users className="w-4 h-4" /> },
];

// ─── Component ──────────────────────────────────────────────────────────────

export default function NurseReportsPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['nursing', 'common']);
  const [activeTab, setActiveTab] = useState<TabKey>('daily');
  const [date, setDate] = useState(getTodayGMT6());
  const [fromDate, setFromDate] = useState(getTodayGMT6());
  const [toDate, setToDate] = useState(getTodayGMT6());

  // ── Queries ──

  const dailyQuery = useApiQuery<{ Results: DailySummary }>(
    queryKeys.nursing.nursingReports({ date }),
    `/api/nursing/reports/daily?date=${date}`,
    { enabled: activeTab === 'daily' },
  );
  const daily = dailyQuery.data?.Results;

  const missedDosesQuery = useApiQuery<{ Results: MissedDose[] }>(
    queryKeys.nursing.nursingReports({ from: fromDate, to: toDate }),
    `/api/nursing/reports/missed-doses?from=${fromDate}&to=${toDate}`,
    { enabled: activeTab === 'missed-doses' },
  );
  const missedDoses = missedDosesQuery.data?.Results ?? [];

  const workloadQuery = useApiQuery<{ Results: NurseWorkload[] }>(
    queryKeys.nursing.nursingReports({ date }),
    `/api/nursing/reports/workload?date=${date}`,
    { enabled: activeTab === 'workload' },
  );
  const workload = workloadQuery.data?.Results ?? [];

  const loading = dailyQuery.isLoading || missedDosesQuery.isLoading || workloadQuery.isLoading;

  // ── KPIs ──

  const dailyKpis = daily ? [
    { title: t('reports.vitalsRecorded'), value: daily.vitals_count, icon: <Activity className="w-5 h-5" />, iconBg: 'bg-blue-50 text-blue-600' },
    { title: t('reports.medicationsGiven'), value: daily.medications_given, icon: <Pill className="w-5 h-5" />, iconBg: 'bg-emerald-50 text-emerald-600' },
    { title: t('reports.medicationsMissed'), value: daily.medications_missed, icon: <AlertTriangle className="w-5 h-5" />, iconBg: 'bg-red-50 text-red-600' },
    { title: t('reports.notesAdded'), value: daily.notes_count, icon: <FileText className="w-5 h-5" />, iconBg: 'bg-purple-50 text-purple-600' },
    { title: t('reports.ordersCompleted'), value: daily.orders_acknowledged, icon: <ClipboardList className="w-5 h-5" />, iconBg: 'bg-amber-50 text-amber-600' },
    { title: t('reports.servicesAdded'), value: daily.services_added, icon: <Package className="w-5 h-5" />, iconBg: 'bg-cyan-50 text-cyan-600' },
  ] : [];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">{t('reports.title')}</h1>
              <p className="section-subtitle">{t('reports.daily')} &bull; {t('reports.missedDoses')} &bull; {t('reports.workload')}</p>
            </div>
          </div>
        </div>

        {/* ── Tab Bar ── */}
        <div className="card p-1.5 overflow-x-auto">
          <div className="flex gap-1 min-w-max">
            {TABS.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'
                }`}
              >
                {tab.icon} {t(tab.labelKey)}
              </button>
            ))}
          </div>
        </div>

        {/* ── Date Filters ── */}
        {activeTab === 'daily' || activeTab === 'workload' ? (
          <div className="card p-3 flex flex-wrap items-center gap-3">
            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('common:date', { defaultValue: 'Date' })}:</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="input max-w-40"
            />
          </div>
        ) : (
          <div className="card p-3 flex flex-wrap items-center gap-3">
            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('common:from', { defaultValue: 'From' })}:</label>
            <input
              type="date"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
              className="input max-w-40"
            />
            <label className="text-sm font-medium text-[var(--color-text-secondary)]">{t('common:to', { defaultValue: 'To' })}:</label>
            <input
              type="date"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
              className="input max-w-40"
            />
          </div>
        )}

        {/* ── Daily Summary Tab ── */}
        {activeTab === 'daily' && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
              {dailyKpis.map((k, i) => (
                <KPICard key={k.title} title={k.title} value={k.value} icon={k.icon} iconBg={k.iconBg} loading={loading} index={i} />
              ))}
            </div>
            {!loading && !daily && (
              <EmptyState
                icon={<BarChart3 className="w-8 h-8 text-[var(--color-text-muted)]" />}
                title={t('reports.noData')}
                description={t('reports.noData')}
              />
            )}
          </>
        )}

        {/* ── Missed Doses Tab ── */}
        {activeTab === 'missed-doses' && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('reports.missedDoses')}</h2>
              <span className="text-xs text-[var(--color-text-muted)]">
                {missedDoses.length} {t('reports.missedDoses').toLowerCase()}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('patient')}</th>
                    <th>{t('reports.medicine')}</th>
                    <th>{t('reports.reason')}</th>
                    <th>{t('common:date', { defaultValue: 'Time' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        {[...Array(5)].map((_, j) => (
                          <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                        ))}
                      </tr>
                    ))
                  ) : missedDoses.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState
                          icon={<Pill className="w-8 h-8 text-[var(--color-text-muted)]" />}
                          title={t('reports.noData')}
                          description={t('reports.noData')}
                        />
                      </td>
                    </tr>
                  ) : (
                    missedDoses.map((dose, idx) => (
                      <tr key={dose.id}>
                        <td className="font-data text-sm text-[var(--color-text-muted)]">{idx + 1}</td>
                        <td className="font-medium">{dose.patient_name}</td>
                        <td className="text-sm">{dose.medicine}</td>
                        <td className="text-sm text-[var(--color-text-secondary)]">{dose.reason || '—'}</td>
                        <td className="font-data text-xs text-[var(--color-text-muted)]">
                          {dose.time ? new Date(dose.time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Workload Tab ── */}
        {activeTab === 'workload' && (
          <div className="card overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">{t('reports.workload')}</h2>
              <span className="text-xs text-[var(--color-text-muted)]">
                {workload.length} {t('reports.nurseName').toLowerCase()}(s)
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{t('reports.nurseName')}</th>
                    <th>{t('reports.tasksAssigned')}</th>
                    <th>{t('reports.tasksCompleted')}</th>
                    <th>{t('reports.patientsAssigned')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(5)].map((_, i) => (
                      <tr key={i}>
                        {[...Array(5)].map((_, j) => (
                          <td key={j}><div className="skeleton h-4 w-full rounded" /></td>
                        ))}
                      </tr>
                    ))
                  ) : workload.length === 0 ? (
                    <tr>
                      <td colSpan={5}>
                        <EmptyState
                          icon={<Users className="w-8 h-8 text-[var(--color-text-muted)]" />}
                          title={t('reports.noData')}
                          description={t('reports.noData')}
                        />
                      </td>
                    </tr>
                  ) : (
                    workload.map((nurse, idx) => (
                      <tr key={nurse.nurse_id}>
                        <td className="font-data text-sm text-[var(--color-text-muted)]">{idx + 1}</td>
                        <td className="font-medium">{nurse.nurse_name}</td>
                        <td className="font-data text-sm">{nurse.tasks_assigned}</td>
                        <td className="font-data text-sm">{nurse.tasks_completed}</td>
                        <td className="font-data text-sm">{nurse.patients_assigned}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
