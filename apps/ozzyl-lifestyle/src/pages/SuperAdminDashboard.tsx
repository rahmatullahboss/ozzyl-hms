import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import {
  Building2, Users, UserPlus, TrendingUp,
  Clock, RefreshCw, ChevronRight, Inbox,
  Activity, ShieldCheck,
} from 'lucide-react';
import KPICard from '../components/dashboard/KPICard';
import adminApi from '../lib/adminApi';
import { useTranslation } from 'react-i18next';

interface PlatformStats {
  hospitals: { total: number; active: number; inactive: number; suspended: number };
  users: number;
  patients: number;
  revenue: { totalBilled: number; totalPaid: number };
  recentHospitals: Array<{
    id: number; name: string; subdomain: string; plan: string; status: string; created_at: string;
  }>;
  pendingOnboarding: number;
}

export default function SuperAdminDashboard() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { t } = useTranslation(['super-admin', 'common']);

  useEffect(() => { fetchStats(); }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/stats');
      setStats(data);
    } catch {
      // Don't silently swallow errors with fake data
      setStats(null);
    } finally {
      setLoading(false);
    }
  };

  const kpiCards = [
    {
      title: t('totalHospitals'),
      value: stats?.hospitals.total ?? 0,
      icon: <Building2 className="w-5 h-5" />,
      iconBg: 'bg-indigo-50 text-indigo-600',
      trend: { value: stats?.hospitals.active ?? 0, isPositive: true, label: t('active') },
    },
    {
      title: t('totalUsers'),
      value: stats?.users ?? 0,
      icon: <Users className="w-5 h-5" />,
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: t('totalPatients'),
      value: (stats?.patients ?? 0).toLocaleString(),
      icon: <Activity className="w-5 h-5" />,
      iconBg: 'bg-emerald-50 text-emerald-600',
    },
    {
      title: t('platformRevenue'),
      value: `৳${((stats?.revenue.totalPaid ?? 0) / 1000).toFixed(0)}k`,
      icon: <TrendingUp className="w-5 h-5" />,
      iconBg: 'bg-amber-50 text-amber-600',
    },
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* ── Header ── */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ShieldCheck className="w-6 h-6 text-[var(--color-primary)]" />
              <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">{t('dashboardTitle')}</h1>
            </div>
            <p className="text-sm text-[var(--color-text-muted)] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              {new Date().toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          <button onClick={fetchStats} className="btn-ghost" title={t('refresh', { ns: 'common' })}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {kpiCards.map((card) => (
            <KPICard key={card.title} loading={loading} {...card} />
          ))}
        </div>

        {/* ── Quick Actions + Pending Alert ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">

          {/* Pending Onboarding Alert */}
          {(stats?.pendingOnboarding ?? 0) > 0 && (
            <div
              className="card p-5 border-l-4 border-amber-400 cursor-pointer hover:shadow-lg transition-shadow lg:col-span-1"
              onClick={() => navigate('/super-admin/onboarding')}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center">
                  <Inbox className="w-5 h-5 text-amber-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium text-[var(--color-text-secondary)]">{t('pendingApplications')}</p>
                  <p className="text-2xl font-bold text-amber-600">{stats?.pendingOnboarding}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-[var(--color-text-muted)]" />
              </div>
            </div>
          )}

          {/* Quick Actions */}
          <div className={`card p-5 ${(stats?.pendingOnboarding ?? 0) > 0 ? 'lg:col-span-2' : 'lg:col-span-3'}`}>
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-4">{t('quickActions')}</h3>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => navigate('/super-admin/hospitals')} className="btn-primary">
                <Building2 className="w-4 h-4" /> {t('viewHospitals')}
              </button>
              <button onClick={() => navigate('/super-admin/onboarding')} className="btn-secondary">
                <Inbox className="w-4 h-4" /> {t('onboardingQueue')}
              </button>
              <button onClick={() => navigate('/super-admin/hospitals?action=create')} className="btn-secondary">
                <UserPlus className="w-4 h-4" /> {t('addHospital')}
              </button>
            </div>
          </div>
        </div>

        {/* ── Hospital Breakdown + Recent ── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

          {/* Hospital Status Breakdown */}
          <div className="card p-6 lg:col-span-2">
            <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide mb-5">{t('hospitalStatus')}</h3>
            <div className="space-y-4">
              {[
                { label: t('activeStatus'), count: stats?.hospitals.active ?? 0, color: 'bg-emerald-500', bg: 'bg-emerald-50' },
                { label: t('inactiveStatus'), count: stats?.hospitals.inactive ?? 0, color: 'bg-slate-400', bg: 'bg-slate-50' },
                { label: t('suspendedStatus'), count: stats?.hospitals.suspended ?? 0, color: 'bg-red-500', bg: 'bg-red-50' },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${s.color}`} />
                  <span className="flex-1 text-sm text-[var(--color-text-primary)]">{s.label}</span>
                  <span className={`text-sm font-semibold px-2.5 py-0.5 rounded-full ${s.bg}`}>{s.count}</span>
                </div>
              ))}
              <div className="pt-3 border-t border-[var(--color-border)]">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--color-text-primary)]">{t('revenueCollection')}</span>
                  <span className="text-sm font-semibold text-emerald-600">
                    {stats ? `${Math.round((stats.revenue.totalPaid / Math.max(stats.revenue.totalBilled, 1)) * 100)}%` : '—'}
                  </span>
                </div>
                <div className="mt-2 w-full bg-[var(--color-bg-secondary)] rounded-full h-2">
                  <div
                    className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                    style={{ width: stats ? `${Math.round((stats.revenue.totalPaid / Math.max(stats.revenue.totalBilled, 1)) * 100)}%` : '0%' }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Recent Hospitals */}
          <div className="card overflow-hidden lg:col-span-3">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">{t('recentlyRegistered')}</h3>
              <button
                onClick={() => navigate('/super-admin/hospitals')}
                className="text-sm text-[var(--color-primary)] hover:underline font-medium"
              >
                {t('viewAll')} →
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('hospital')}</th>
                    <th>{t('slug')}</th>
                    <th>{t('plan')}</th>
                    <th>{t('status')}</th>
                    <th>{t('date')}</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    [...Array(3)].map((_, i) => (
                      <tr key={i}>
                        {[...Array(5)].map((_, j) => (
                          <td key={j}><div className="skeleton h-4 w-full" /></td>
                        ))}
                      </tr>
                    ))
                  ) : (stats?.recentHospitals ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-[var(--color-text-muted)]">
                        {t('noHospitals')}
                      </td>
                    </tr>
                  ) : (
                    (stats?.recentHospitals ?? []).map((h) => (
                      <tr key={h.id} className="cursor-pointer" onClick={() => navigate(`/super-admin/hospitals/${h.id}`)}>
                        <td className="font-medium">{h.name}</td>
                        <td className="font-data text-sm text-[var(--color-text-secondary)]">{h.subdomain}</td>
                        <td>
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                            h.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                            h.plan === 'professional' ? 'bg-blue-100 text-blue-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {h.plan}
                          </span>
                        </td>
                        <td>
                          <span className={`inline-flex items-center gap-1 text-xs font-medium ${
                            h.status === 'active' ? 'text-emerald-600' : 'text-slate-400'
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${
                              h.status === 'active' ? 'bg-emerald-500' : 'bg-slate-400'
                            }`} />
                            {h.status}
                          </span>
                        </td>
                        <td className="text-sm text-[var(--color-text-muted)]">
                          {new Date(h.created_at).toLocaleDateString('en-GB')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
  );
}
