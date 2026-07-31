import { useState } from 'react';
import { Calendar, UserX, BarChart2, Clock, TrendingUp } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { useTranslation } from 'react-i18next';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { getTodayGMT6, formatToTodayGMT6 } from '../lib/date-utils';

const TODAY = getTodayGMT6();
const MONTH_AGO = formatToTodayGMT6(new Date(Date.now() - 30 * 86400000));
const TABS = [
  { key: 'noshow',      labelKey: 'tabNoShowRate',    icon: UserX     },
  { key: 'utilization', labelKey: 'tabSlotUtilization', icon: BarChart2 },
  { key: 'peak',        labelKey: 'tabPeakHours',     icon: Clock     },
  { key: 'volume',      labelKey: 'tabDailyVolume',   icon: TrendingUp},
];

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(5)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function DateRangeBar({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  const { t } = useTranslation(['reports', 'common']);
  return (
    <div className="card p-3 flex gap-3 flex-wrap items-center">
      <span className="text-sm font-medium text-[var(--color-text-secondary)]">{t('dateRange')}:</span>
      <input className="input w-36" type="date" value={start} onChange={e => onStart(e.target.value)} />
      <span className="text-sm text-[var(--color-text-muted)]">{t('to')}</span>
      <input className="input w-36" type="date" value={end} onChange={e => onEnd(e.target.value)} />
    </div>
  );
}

function NoShowTab() {
  const { t } = useTranslation(['reports', 'common']);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);

  const { data: d, isLoading: loading } = useApiQuery<{ totalAppointments?: number; noShows?: number; attended?: number; cancelled?: number; noShowRate?: number; data?: any[] }>(
    queryKeys.reports.appointmentNoShow({ startDate: start, endDate: end }),
    `/api/reports/appointment/no-show-rate?startDate=${start}&endDate=${end}`
  );
  const summary = {
    totalAppointments: d?.totalAppointments ?? 0,
    noShows: d?.noShows ?? 0,
    attended: d?.attended ?? 0,
    cancelled: d?.cancelled ?? 0,
    noShowRate: d?.noShowRate ?? 0,
  };
  const data = d?.data ?? [];
  const totalAppts = summary.totalAppointments || data.reduce((s: number, r: any) => s + (r.total_appointments ?? 0), 0);
  const noShows    = summary.noShows || data.reduce((s: number, r: any) => s + (r.no_show_count ?? 0), 0);
  const noShowPct = summary.noShowRate || (totalAppts ? Math.round(noShows / totalAppts * 100) : 0);
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title={t('totalAppointments')} value={totalAppts}          loading={loading} icon={<Calendar className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title={t('noShows')}           value={noShows}             loading={loading} icon={<UserX className="w-5 h-5" />}    iconBg="bg-red-50 text-red-600"   index={1} />
        <KPICard title={t('noShowRate')}        value={`${noShowPct}%`}     loading={loading} icon={<BarChart2 className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={2} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('doctor')}</th><th>{t('total')}</th><th>{t('noShows')}</th><th>{t('noShowRate')}</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<UserX className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noData')} description={t('empty.noAppointmentData')} /></td></tr>
            : data.map((r: any, i: number) => {
              const rate = r.total_appointments ? Math.round((r.no_show_count ?? 0) / r.total_appointments * 100) : 0;
              return <tr key={i}><td className="font-medium">{r.doctor_name ?? '—'}</td><td className="font-data text-center">{r.total_appointments}</td><td className="font-data text-center text-red-600">{r.no_show_count ?? 0}</td><td><div className="flex items-center gap-2"><div className="flex-1 bg-[var(--color-border-light)] rounded-full h-1.5"><div className="bg-red-500 h-1.5 rounded-full" style={{ width: `${rate}%` }} /></div><span className="font-data text-sm w-10">{rate}%</span></div></td></tr>;
            })}
        </tbody>
      </table></div></div>
    </div>
  );
}

function UtilizationTab() {
  const { t } = useTranslation(['reports', 'common']);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);

  const { data: d, isLoading: loading } = useApiQuery<{ data?: any[]; doctors?: any[] }>(
    queryKeys.reports.appointmentUtilization({ startDate: start, endDate: end }),
    `/api/reports/appointment/slot-utilization?startDate=${start}&endDate=${end}`
  );
  const data = d?.data ?? d?.doctors?.map((row: any) => ({
    doctor_id: row.doctorId,
    doctor_name: row.doctorName,
    total_slots: row.totalAppointments ?? 0,
    booked_slots: row.completed ?? 0,
  })) ?? [];
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('doctor')}</th><th>{t('totalSlots')}</th><th>{t('booked')}</th><th>{t('utilization')}</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<BarChart2 className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noUtilizationData')} description={t('empty.noSchedulingData')} /></td></tr>
            : data.map((r: any, i: number) => {
              const pct = r.total_slots ? Math.round((r.booked_slots ?? 0) / r.total_slots * 100) : 0;
              return <tr key={i}><td className="font-medium">{r.doctor_name ?? `Doctor #${r.doctor_id}`}</td><td className="font-data text-center">{r.total_slots}</td><td className="font-data text-center">{r.booked_slots ?? 0}</td><td><div className="flex items-center gap-2"><div className="flex-1 bg-[var(--color-border-light)] rounded-full h-1.5"><div className="bg-[var(--color-primary)] h-1.5 rounded-full" style={{ width: `${pct}%` }} /></div><span className="font-data text-sm w-10">{pct}%</span></div></td></tr>;
            })}
        </tbody>
      </table></div></div>
    </div>
  );
}

function PeakHoursTab() {
  const { t } = useTranslation(['reports', 'common']);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);

  const { data: d, isLoading: loading } = useApiQuery<{ data?: any[]; slots?: any[] }>(
    queryKeys.reports.appointmentPeakHours({ startDate: start, endDate: end }),
    `/api/reports/appointment/peak-hours?startDate=${start}&endDate=${end}`
  );
  const data = d?.data ?? d?.slots?.map((row: any) => ({
    hour_of_day: Number.parseInt(String(row.timeSlot).slice(0, 2), 10),
    appointment_count: row.count ?? 0,
  })) ?? [];
  const maxCount = Math.max(...data.map((r: any) => r.appointment_count ?? 0), 1);
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('hour')}</th><th>{t('appointments')}</th><th>{t('volume')}</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={3} />
            : data.length === 0 ? <tr><td colSpan={3}><EmptyState icon={<Clock className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noPeakData')} description={t('empty.noAppointmentData')} /></td></tr>
            : data.map((r: any, i: number) => {
              const pct = Math.round((r.appointment_count ?? 0) / maxCount * 100);
              const h = r.hour_of_day ?? i;
              const label = `${String(h).padStart(2, '0')}:00 – ${String(h + 1).padStart(2, '0')}:00`;
              return <tr key={i}><td className="font-data">{label}</td><td className="font-data font-semibold text-center">{r.appointment_count}</td><td><div className="flex items-center gap-2"><div className="flex-1 bg-[var(--color-border-light)] rounded-full h-2"><div className="bg-violet-500 h-2 rounded-full" style={{ width: `${pct}%` }} /></div></div></td></tr>;
            })}
        </tbody>
      </table></div></div>
    </div>
  );
}

function DailyVolumeTab() {
  const { t } = useTranslation(['reports', 'common']);
  const [days, setDays] = useState('30');

  const { data: d, isLoading: loading } = useApiQuery<{ data?: any[]; daily?: any[] }>(
    queryKeys.reports.appointmentDailyVolume(days),
    `/api/reports/appointment/daily-volume?days=${days}`
  );
  const data = d?.data ?? d?.daily ?? [];
  const totalAppts = data.reduce((s: number, r: any) => s + (r.appointment_count ?? 0), 0);
  const avgPerDay = data.length ? Math.round(totalAppts / data.length) : 0;
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-3 items-center">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">{t('lastDays')}</span>
        <select className="input w-24" value={days} onChange={e => setDays(e.target.value)}>
          <option value="7">{t('days7')}</option>
          <option value="14">{t('days14')}</option>
          <option value="30">{t('days30')}</option>
          <option value="60">{t('days60')}</option>
          <option value="90">{t('days90')}</option>
        </select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KPICard title={t('totalAppointments')} value={totalAppts}   loading={loading} icon={<Calendar className="w-5 h-5" />}   iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title={t('dailyAverage')}       value={avgPerDay}   loading={loading} icon={<TrendingUp className="w-5 h-5" />} iconBg="bg-violet-50 text-violet-600" index={1} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>{t('date')}</th><th>{t('appointments')}</th><th>{t('completed')}</th><th>{t('cancelled')}</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<TrendingUp className="w-8 h-8 text-[var(--color-text-muted)]" />} title={t('noVolumeData')} description={t('empty.noAppointmentPeriodData')} /></td></tr>
            : data.map((r: any, i: number) => <tr key={i}><td className="font-data">{r.appointment_date}</td><td className="font-data font-semibold text-center">{r.appointment_count}</td><td className="font-data text-center text-emerald-600">{r.completed_count ?? 0}</td><td className="font-data text-center text-red-500">{r.cancelled_count ?? 0}</td></tr>)}
        </tbody>
      </table></div></div>
    </div>
  );
}

const TAB_MAP: Record<string, React.ComponentType> = {
  noshow: NoShowTab, utilization: UtilizationTab, peak: PeakHoursTab, volume: DailyVolumeTab,
};

export default function ReportAppointmentPage({ role = 'hospital_admin' }: { role?: string }) {
  const [activeTab, setActiveTab] = useState('noshow');
  const TabComponent = TAB_MAP[activeTab];
  const { t } = useTranslation(['reports', 'common']);
  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Calendar className="w-5 h-5 text-white" />
            </div>
            <div><h1 className="page-title">{t('appointmentReports')}</h1><p className="section-subtitle">{t('appointmentReportsDesc')}</p></div>
          </div>
        </div>
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => { const Icon = tab.icon; return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            ><Icon className="w-4 h-4" />{t(tab.labelKey)}</button>
          ); })}
        </div>
        <TabComponent />
      </div>
    </DashboardLayout>
  );
}
