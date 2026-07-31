import { useState, useEffect, useCallback } from 'react';
import { Calendar, UserX, BarChart2, Clock, TrendingUp } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import EmptyState from '../components/dashboard/EmptyState';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

const TODAY = new Date().toISOString().split('T')[0];
const MONTH_AGO = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
const TABS = [
  { key: 'noshow',      label: 'No-Show Rate',        icon: UserX     },
  { key: 'utilization', label: 'Slot Utilization',     icon: BarChart2 },
  { key: 'peak',        label: 'Peak Hours',           icon: Clock     },
  { key: 'volume',      label: 'Daily Volume',         icon: TrendingUp},
];

function SkeletonRows({ cols }: { cols: number }) {
  return <>{[...Array(5)].map((_, i) => <tr key={i}>{[...Array(cols)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)}</>;
}

function DateRangeBar({ start, end, onStart, onEnd }: { start: string; end: string; onStart: (v: string) => void; onEnd: (v: string) => void }) {
  return (
    <div className="card p-3 flex gap-3 flex-wrap items-center">
      <span className="text-sm font-medium text-[var(--color-text-secondary)]">Date Range:</span>
      <input className="input w-36" type="date" value={start} onChange={e => onStart(e.target.value)} />
      <span className="text-sm text-[var(--color-text-muted)]">to</span>
      <input className="input w-36" type="date" value={end} onChange={e => onEnd(e.target.value)} />
    </div>
  );
}

function NoShowTab() {
  const [data, setData] = useState<any[]>([]);
  const [summary, setSummary] = useState({ totalAppointments: 0, noShows: 0, attended: 0, cancelled: 0, noShowRate: 0 });
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await axios.get('/api/reports/appointment/no-show-rate', { params: { startDate: start, endDate: end }, headers: authHeader() });
      setSummary({
        totalAppointments: d.totalAppointments ?? 0,
        noShows: d.noShows ?? 0,
        attended: d.attended ?? 0,
        cancelled: d.cancelled ?? 0,
        noShowRate: d.noShowRate ?? 0,
      });
      setData(d.data ?? []);
    }
    catch { setData([]); setSummary({ totalAppointments: 0, noShows: 0, attended: 0, cancelled: 0, noShowRate: 0 }); }
    finally { setLoading(false); }
  }, [start, end]);
  useEffect(() => { loadData(); }, [loadData]);
  const totalAppts = summary.totalAppointments || data.reduce((s, r) => s + (r.total_appointments ?? 0), 0);
  const noShows    = summary.noShows || data.reduce((s, r) => s + (r.no_show_count ?? 0), 0);
  const noShowPct = summary.noShowRate || (totalAppts ? Math.round(noShows / totalAppts * 100) : 0);
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title="Total Appointments" value={totalAppts}          loading={loading} icon={<Calendar className="w-5 h-5" />} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title="No-Shows"           value={noShows}             loading={loading} icon={<UserX className="w-5 h-5" />}    iconBg="bg-red-50 text-red-600"   index={1} />
        <KPICard title="No-Show Rate"       value={`${noShowPct}%`}     loading={loading} icon={<BarChart2 className="w-5 h-5" />} iconBg="bg-amber-50 text-amber-600" index={2} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Doctor</th><th>Total</th><th>No-Shows</th><th>No-Show Rate</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<UserX className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No data" description="No appointment data for this period." /></td></tr>
            : data.map((r, i) => {
              const rate = r.total_appointments ? Math.round((r.no_show_count ?? 0) / r.total_appointments * 100) : 0;
              return <tr key={i}><td className="font-medium">{r.doctor_name ?? '—'}</td><td className="font-data text-center">{r.total_appointments}</td><td className="font-data text-center text-red-600">{r.no_show_count ?? 0}</td><td><div className="flex items-center gap-2"><div className="flex-1 bg-[var(--color-border-light)] rounded-full h-1.5"><div className="bg-red-500 h-1.5 rounded-full" style={{ width: `${rate}%` }} /></div><span className="font-data text-sm w-10">{rate}%</span></div></td></tr>;
            })}
        </tbody>
      </table></div></div>
    </div>
  );
}

function UtilizationTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await axios.get('/api/reports/appointment/slot-utilization', { params: { startDate: start, endDate: end }, headers: authHeader() });
      setData(d.data ?? d.doctors?.map((row: any) => ({
        doctor_id: row.doctorId,
        doctor_name: row.doctorName,
        total_slots: row.totalAppointments ?? 0,
        booked_slots: row.completed ?? 0,
      })) ?? []);
    }
    catch { setData([]); } finally { setLoading(false); }
  }, [start, end]);
  useEffect(() => { loadData(); }, [loadData]);
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Doctor</th><th>Total Slots</th><th>Booked</th><th>Utilization</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<BarChart2 className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No utilization data" description="No scheduling data for this period." /></td></tr>
            : data.map((r, i) => {
              const pct = r.total_slots ? Math.round((r.booked_slots ?? 0) / r.total_slots * 100) : 0;
              return <tr key={i}><td className="font-medium">{r.doctor_name ?? `Doctor #${r.doctor_id}`}</td><td className="font-data text-center">{r.total_slots}</td><td className="font-data text-center">{r.booked_slots ?? 0}</td><td><div className="flex items-center gap-2"><div className="flex-1 bg-[var(--color-border-light)] rounded-full h-1.5"><div className="bg-[var(--color-primary)] h-1.5 rounded-full" style={{ width: `${pct}%` }} /></div><span className="font-data text-sm w-10">{pct}%</span></div></td></tr>;
            })}
        </tbody>
      </table></div></div>
    </div>
  );
}

function PeakHoursTab() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState(MONTH_AGO);
  const [end, setEnd] = useState(TODAY);
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await axios.get('/api/reports/appointment/peak-hours', { params: { startDate: start, endDate: end }, headers: authHeader() });
      setData(d.data ?? d.slots?.map((row: any) => ({
        hour_of_day: Number.parseInt(String(row.timeSlot).slice(0, 2), 10),
        appointment_count: row.count ?? 0,
      })) ?? []);
    }
    catch { setData([]); } finally { setLoading(false); }
  }, [start, end]);
  useEffect(() => { loadData(); }, [loadData]);
  const maxCount = Math.max(...data.map(r => r.appointment_count ?? 0), 1);
  return (
    <div className="space-y-4">
      <DateRangeBar start={start} end={end} onStart={setStart} onEnd={setEnd} />
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Hour</th><th>Appointments</th><th>Volume</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={3} />
            : data.length === 0 ? <tr><td colSpan={3}><EmptyState icon={<Clock className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No peak hour data" description="No appointment data for this period." /></td></tr>
            : data.map((r, i) => {
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
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState('30');
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: d } = await axios.get('/api/reports/appointment/daily-volume', { params: { days }, headers: authHeader() });
      setData(d.data ?? d.daily ?? []);
    }
    catch { setData([]); } finally { setLoading(false); }
  }, [days]);
  useEffect(() => { loadData(); }, [loadData]);
  const totalAppts = data.reduce((s, r) => s + (r.appointment_count ?? 0), 0);
  const avgPerDay = data.length ? Math.round(totalAppts / data.length) : 0;
  return (
    <div className="space-y-4">
      <div className="card p-3 flex gap-3 items-center">
        <span className="text-sm font-medium text-[var(--color-text-secondary)]">Last</span>
        <select className="input w-24" value={days} onChange={e => setDays(e.target.value)}><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option><option value="60">60 days</option><option value="90">90 days</option></select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <KPICard title="Total Appointments" value={totalAppts}   loading={loading} icon={<Calendar className="w-5 h-5" />}   iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
        <KPICard title="Daily Average"       value={avgPerDay}   loading={loading} icon={<TrendingUp className="w-5 h-5" />} iconBg="bg-violet-50 text-violet-600" index={1} />
      </div>
      <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base">
        <thead><tr><th>Date</th><th>Appointments</th><th>Completed</th><th>Cancelled</th></tr></thead>
        <tbody>
          {loading ? <SkeletonRows cols={4} />
            : data.length === 0 ? <tr><td colSpan={4}><EmptyState icon={<TrendingUp className="w-8 h-8 text-[var(--color-text-muted)]" />} title="No volume data" description="No appointment data for the selected period." /></td></tr>
            : data.map((r, i) => <tr key={i}><td className="font-data">{r.appointment_date}</td><td className="font-data font-semibold text-center">{r.appointment_count}</td><td className="font-data text-center text-emerald-600">{r.completed_count ?? 0}</td><td className="font-data text-center text-red-500">{r.cancelled_count ?? 0}</td></tr>)}
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
            <div><h1 className="page-title">Appointment Reports</h1><p className="section-subtitle">No-show rates, slot utilization, peak hours, and daily volume</p></div>
          </div>
        </div>
        <div className="card p-1.5 flex gap-1 flex-wrap">
          {TABS.map(tab => { const Icon = tab.icon; return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-[var(--color-primary)] text-white shadow-sm' : 'hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
            ><Icon className="w-4 h-4" />{tab.label}</button>
          ); })}
        </div>
        <TabComponent />
      </div>
    </DashboardLayout>
  );
}
