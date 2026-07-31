import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  Users, FlaskConical, Receipt, UserCog,
  TrendingUp, Activity, Clock, AlertCircle,
  Plus, RefreshCw,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Cell,
} from 'recharts';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import SafeChartFrame from '../components/dashboard/SafeChartFrame';
import { useTranslation } from 'react-i18next';
import axios from 'axios';

interface DashboardStats {
  totalPatients:  number;
  todayPatients:  number;
  pendingTests:   number;
  completedTests: number;
  pendingBills:   number;
  totalRevenue:   number;
  staffCount:     number;
  lowStockItems:  number;
}

interface RecentPatient {
  id:         number;
  name:       string;
  mobile:     string;
  created_at: string;
}

interface RevenueData {
  day:     string;
  revenue: number;
}


export default function HospitalAdminDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const [stats,          setStats]          = useState<DashboardStats | null>(null);
  const [recentPatients, setRecentPatients] = useState<RecentPatient[]>([]);
  const [revenueData,    setRevenueData]    = useState<RevenueData[]>([]);
  const [loading,        setLoading]        = useState(true);
  const navigate = useNavigate();
  const { slug } = useParams<{ slug: string }>();
  const base = `/h/${slug}`;
  const { t } = useTranslation(['dashboard', 'patients', 'common']);

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/dashboard/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setStats(data.stats);
      setRecentPatients(data.recentPatients ?? []);
      setRevenueData(data.revenueData ?? []);
    } catch {
      // Fallback mock data for development
      setStats({
        totalPatients: 1456, todayPatients: 47, pendingTests: 8,
        completedTests: 45, pendingBills: 12, totalRevenue: 245000,
        staffCount: 24, lowStockItems: 3,
      });
      setRevenueData([
        { day: 'Mon', revenue: 35000 }, { day: 'Tue', revenue: 52000 },
        { day: 'Wed', revenue: 41000 }, { day: 'Thu', revenue: 68000 },
        { day: 'Fri', revenue: 75000 }, { day: 'Sat', revenue: 58000 },
        { day: 'Sun', revenue: 28000 },
      ]);
      setRecentPatients([
        { id: 1, name: 'Mohammad Karim',  mobile: '01711-234567', created_at: new Date().toISOString() },
        { id: 2, name: 'Fatema Begum',    mobile: '01812-345678', created_at: new Date().toISOString() },
        { id: 3, name: 'Rahim Uddin',     mobile: '01911-456789', created_at: new Date().toISOString() },
        { id: 4, name: 'Nasrin Akter',    mobile: '01611-567890', created_at: new Date().toISOString() },
        { id: 5, name: 'Kabir Hossain',   mobile: '01511-678901', created_at: new Date().toISOString() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const kpiCards = [
    {
      title: t('totalPatients'),
      value: stats?.totalPatients.toLocaleString() ?? 0,
      icon:  <Users className="w-5 h-5" />,
      iconBg:'bg-blue-50 text-blue-600',
      trend: { value: 12, isPositive: true, label: t('vsLastMonth', { defaultValue: 'vs last month' }) },
    },
    {
      title: t('todayAppointments', { defaultValue: "Today's Patients" }),
      value: stats?.todayPatients ?? 0,
      icon:  <Activity className="w-5 h-5" />,
      iconBg:'bg-[var(--color-primary-light)] text-[var(--color-primary)]',
    },
    {
      title: t('revenue'),
      value: `৳${(stats?.totalRevenue ?? 0).toLocaleString()}`,
      icon:  <TrendingUp className="w-5 h-5" />,
      iconBg:'bg-emerald-50 text-emerald-600',
      trend: { value: 8, isPositive: true, label: t('vsLastMonth', { defaultValue: 'vs last month' }) },
    },
    {
      title: t('pendingBills'),
      value: stats?.pendingBills ?? 0,
      icon:  <Receipt className="w-5 h-5" />,
      iconBg:'bg-amber-50 text-amber-600',
      trend: { value: 3, isPositive: false },
    },
    {
      title: t('labPending'),
      value: stats?.pendingTests ?? 0,
      icon:  <FlaskConical className="w-5 h-5" />,
      iconBg:'bg-purple-50 text-purple-600',
    },
    {
      title: t('pharmacySales', { defaultValue: 'Completed Tests' }),
      value: stats?.completedTests ?? 0,
      icon:  <FlaskConical className="w-5 h-5" />,
      iconBg:'bg-emerald-50 text-emerald-600',
    },
    {
      title: t('activeDoctors', { defaultValue: 'Staff Count' }),
      value: stats?.staffCount ?? 0,
      icon:  <UserCog className="w-5 h-5" />,
      iconBg:'bg-slate-100 text-slate-600',
    },
    {
      title: t('lowStock', { defaultValue: 'Low Stock Items' }),
      value: stats?.lowStockItems ?? 0,
      icon:  <AlertCircle className="w-5 h-5" />,
      iconBg:'bg-red-50 text-red-500',
      trend: stats?.lowStockItems ? { value: stats.lowStockItems, isPositive: false } : undefined,
    },
  ];

  const quickActions = [
    { label: t('newPatient', { ns: 'patients', defaultValue: 'New Patient' }), icon: <Plus className="w-4 h-4" />,       path: `${base}/patients/new`, color: 'btn-primary' },
    { label: t('labTests', { defaultValue: 'Lab Tests' }),                     icon: <FlaskConical className="w-4 h-4"/>, path: `${base}/tests`,        color: 'btn-secondary' },
    { label: t('newBill', { ns: 'billing', defaultValue: 'New Bill' }),        icon: <Receipt className="w-4 h-4" />,     path: `${base}/billing`,      color: 'btn-secondary' },
    { label: t('staff', { ns: 'staff', defaultValue: 'Add Staff' }),           icon: <UserCog className="w-4 h-4" />,     path: `${base}/staff`,        color: 'btn-secondary' },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-6 max-w-screen-2xl mx-auto">

        {/* ── Page header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <p className="section-subtitle flex items-center gap-1.5 mt-1">
              <Clock className="w-3.5 h-3.5" />
              {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={fetchData} className="btn-ghost" title="Refresh">
              <RefreshCw className="w-4 h-4" />
            </button>
            <button onClick={() => navigate(`${base}/patients/new`)} className="btn-primary">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('newPatient', { ns: 'patients', defaultValue: 'New Patient' })}</span>
            </button>
          </div>
        </div>

        {/* ── KPI Cards — Row 1 (4 key metrics) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.slice(0, 4).map((card, i) => (
            <KPICard key={card.title} loading={loading} index={i} {...card} />
          ))}
        </div>

        {/* ── KPI Cards — Row 2 (secondary metrics) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {kpiCards.slice(4).map((card, i) => (
            <KPICard key={card.title} loading={loading} index={i + 4} {...card} />
          ))}
        </div>

        {/* ── Quick Actions ── */}
        <div className="card p-5">
          <h3 className="section-title mb-4">{t('quickActions', { defaultValue: 'Quick Actions' })}</h3>
          <div className="flex flex-wrap gap-3">
            {quickActions.map((action) => (
              <button
                key={action.label}
                onClick={() => navigate(action.path)}
                className={`${action.color} transition-transform hover:-translate-y-0.5 active:translate-y-0`}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Charts ── */}
        <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">

          {/* Revenue trend — wider */}
          <div className="card p-4 sm:p-6 xl:col-span-3">
            <div className="flex items-center justify-between mb-4 sm:mb-5">
              <h3 className="section-title">{t('revenue')}</h3>
              <span className="section-subtitle">{t('last7days', { defaultValue: 'Last 7 days' })}</span>
            </div>
            <SafeChartFrame className="h-40 sm:h-56">
              <ResponsiveContainer width="100%" height="100%" minHeight={0} minWidth={0}>
                <LineChart data={revenueData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="day" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false}
                    tickFormatter={(v) => `৳${v / 1000}k`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: '10px', fontSize: '13px' }}
                    formatter={(v) => [`৳${Number(v).toLocaleString()}`, 'Revenue']}
                  />
                  <Line type="monotone" dataKey="revenue" stroke="var(--color-primary)" strokeWidth={2.5}
                    dot={{ fill: 'var(--color-primary)', r: 3 }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </SafeChartFrame>
          </div>

          {/* Lab Tests — narrower */}
          <div className="card p-4 sm:p-6 xl:col-span-2">
            <div className="flex items-center justify-between mb-4 sm:mb-5">
              <h3 className="section-title">{t('labTests', { defaultValue: 'Lab Tests' })}</h3>
              <span className="section-subtitle">{t('thisWeek', { defaultValue: 'This week' })}</span>
            </div>
            <SafeChartFrame className="h-40 sm:h-56">
              <ResponsiveContainer width="100%" height="100%" minHeight={0} minWidth={0}>
                <BarChart
                  data={[
                    { name: 'Pending',   value: stats?.pendingTests   ?? 0 },
                    { name: 'Completed', value: stats?.completedTests ?? 0 },
                  ]}
                  margin={{ top: 4, right: 4, bottom: 0, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="name" stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--color-text-muted)" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: 'var(--color-bg-card)', border: '1px solid var(--color-border)', borderRadius: '10px', fontSize: '13px' }}
                  />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                    <Cell fill="#d97706" />
                    <Cell fill="#059669" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </SafeChartFrame>
          </div>
        </div>

        {/* ── Recent Patients ── */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-4 sm:px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="section-title">{t('recentActivity')}</h3>
            <button onClick={() => navigate(`${base}/patients`)} className="text-sm text-[var(--color-primary)] hover:underline font-medium">
              {t('view', { ns: 'common' })} →
            </button>
          </div>

          {/* Mobile card list — visible on small screens only */}
          <div className="sm:hidden divide-y divide-[var(--color-border)]">
            {loading
              ? [...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3 p-4">
                    <div className="skeleton w-10 h-10 rounded-full shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="skeleton h-4 w-32" />
                      <div className="skeleton h-3 w-24" />
                    </div>
                  </div>
                ))
              : recentPatients.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 p-4 cursor-pointer hover:bg-[var(--color-border-light)] transition-colors"
                    onClick={() => navigate(`${base}/patients/${p.id}`)}
                  >
                    <div className="mobile-card-avatar bg-[var(--color-primary-light)] text-[var(--color-primary-dark)]">
                      {p.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{p.name}</p>
                      <p className="text-xs text-[var(--color-text-muted)] font-data">
                        #{p.id} · {new Date(p.created_at).toLocaleDateString('en-GB')}
                      </p>
                    </div>
                    <span className="text-[var(--color-primary)] text-xs font-medium shrink-0">
                      {t('view', { ns: 'common' })} →
                    </span>
                  </div>
                ))
            }
          </div>

          {/* Desktop table — hidden on small screens */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('patientId', { ns: 'patients', defaultValue: 'Patient ID' })}</th>
                  <th>{t('name', { ns: 'common' })}</th>
                  <th>{t('phone', { ns: 'common' })}</th>
                  <th>{t('date', { ns: 'common' })}</th>
                  <th>{t('actions', { ns: 'common' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(5)].map((_, j) => (
                        <td key={j}><div className="skeleton h-4 w-full" /></td>
                      ))}
                    </tr>
                  ))
                ) : recentPatients.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-[var(--color-text-muted)]">
                      {t('noPatients', { ns: 'patients', defaultValue: 'No patients found' })}
                    </td>
                  </tr>
                ) : (
                  recentPatients.map((p) => (
                    <tr key={p.id} onClick={() => navigate(`${base}/patients/${p.id}`)}>
                      <td className="font-data text-sm">#{p.id}</td>
                      <td className="font-medium">{p.name}</td>
                      <td className="font-data text-sm text-[var(--color-text-secondary)]">{p.mobile}</td>
                      <td className="text-[var(--color-text-muted)] text-sm">
                        {new Date(p.created_at).toLocaleDateString('en-GB')}
                      </td>
                      <td>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`${base}/patients/${p.id}`); }}
                          className="text-[var(--color-primary)] text-sm font-medium hover:underline"
                        >
                          {t('view', { ns: 'common' })}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </DashboardLayout>
  );
}
