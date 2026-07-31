import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Building2, Users, BedDouble, DollarSign, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Branch {
  id: number;
  name: string;
  location: string;
  status: 'active' | 'inactive';
  stats: { patients: number; revenue: number; beds_total: number; beds_occupied: number; staff: number; occupancy_pct: number };
  trend: number; // revenue change %
}


function fmtTaka(n: number): string {
  if (n >= 1000000) return `৳${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `৳${(n / 1000).toFixed(0)}K`;
  return `৳${n}`;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MultiBranchDashboard({
 role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('dashboard');

  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = `/h/${slug}`;
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchBranches = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/branches/analytics', {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-Subdomain': slug,
        },
      });
      setBranches(data.branches ?? []);
    } catch {
      // API unavailable — show empty
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => { fetchBranches(); }, [fetchBranches]);

  const totalRevenue = branches.reduce((s, b) => s + b.stats.revenue, 0);
  const totalPatients = branches.reduce((s, b) => s + b.stats.patients, 0);
  const totalBeds = branches.reduce((s, b) => s + b.stats.beds_total, 0);
  const totalOccupied = branches.reduce((s, b) => s + b.stats.beds_occupied, 0);
  const avgOccupancy = totalBeds > 0 ? Math.round((totalOccupied / totalBeds) * 100) : 0;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('dashboard', { defaultValue: 'Dashboard' })}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('multiBranch', { defaultValue: 'Multi-Branch' })}</span>
            </div>
            <h1 className="text-2xl font-bold text-[var(--color-text)]">{t('multiBranchOverview', { defaultValue: 'Multi-Branch Overview' })}</h1>
            <p className="text-sm text-[var(--color-text-muted)]">{t('performanceAcross', { defaultValue: 'Performance across all branches' })}</p>
          </div>
        </div>

        {/* Aggregate Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: t('totalRevenue', { defaultValue: 'Total Revenue' }), value: fmtTaka(totalRevenue), icon: <DollarSign className="w-5 h-5" />, color: '#088eaf' },
            { label: t('totalPatients', { defaultValue: 'Total Patients' }), value: totalPatients.toLocaleString(), icon: <Users className="w-5 h-5" />, color: '#6366f1' },
            { label: t('activeBranches', { defaultValue: 'Active Branches' }), value: branches.filter(b => b.status === 'active').length, icon: <Building2 className="w-5 h-5" />, color: '#10b981' },
            { label: t('avgOccupancy', { defaultValue: 'Avg Occupancy' }), value: `${avgOccupancy}%`, icon: <BedDouble className="w-5 h-5" />, color: '#f59e0b' },
          ].map(({ label, value, icon, color }) => (
            <div key={label} className="card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white flex-shrink-0"
                   style={{ background: color }}>
                {icon}
              </div>
              <div>
                <p className="text-xl font-bold text-[var(--color-text)]">{loading ? '—' : value}</p>
                <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Branch Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {loading ? (
            [...Array(4)].map((_, i) => (
              <div key={i} className="card p-5">
                <div className="skeleton h-6 w-48 rounded mb-4" />
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[...Array(3)].map((_, j) => <div key={j} className="skeleton h-12 rounded-lg" />)}
                </div>
                <div className="skeleton h-2 w-full rounded-full" />
              </div>
            ))
          ) : branches.length === 0 ? (
            <div className="col-span-2 card p-10 text-center">
              <Building2 className="w-10 h-10 mx-auto mb-3 text-[var(--color-text-muted)] opacity-40" />
              <p className="text-sm text-[var(--color-text-muted)]">{t('noBranches', { defaultValue: 'No branches configured yet' })}</p>
            </div>
          ) : branches.map(branch => (
            <div key={branch.id} className="card p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white"
                       style={{ background: 'var(--color-primary)' }}>
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-[var(--color-text)]">{branch.name}</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">{branch.location}</p>
                  </div>
                </div>
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                  branch.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {branch.status}
                </span>
              </div>

              {/* Branch metrics */}
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="text-center p-2 bg-[var(--color-bg)] rounded-lg">
                  <p className="text-lg font-bold text-[var(--color-text)]">{branch.stats.patients}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{t('patients', { defaultValue: 'Patients' })}</p>
                </div>
                <div className="text-center p-2 bg-[var(--color-bg)] rounded-lg">
                  <p className="text-lg font-bold text-[var(--color-text)]">{fmtTaka(branch.stats.revenue)}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{t('revenue', { defaultValue: 'Revenue' })}</p>
                </div>
                <div className="text-center p-2 bg-[var(--color-bg)] rounded-lg">
                  <p className="text-lg font-bold text-[var(--color-text)]">{branch.stats.staff}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{t('staff', { defaultValue: 'Staff' })}</p>
                </div>
              </div>

              {/* Bed occupancy bar */}
              {branch.stats.beds_total > 0 && (
                <div className="mb-3">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-[var(--color-text-muted)]">{t('bedOccupancy', { defaultValue: 'Bed Occupancy' })}</span>
                    <span className="font-medium">{branch.stats.beds_occupied}/{branch.stats.beds_total} ({branch.stats.occupancy_pct}%)</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{
                      width: `${branch.stats.occupancy_pct}%`,
                      background: branch.stats.occupancy_pct > 85 ? '#ef4444' : branch.stats.occupancy_pct > 60 ? '#f59e0b' : '#10b981',
                    }} />
                  </div>
                </div>
              )}

              {/* Revenue trend */}
              <div className="flex items-center gap-1 text-xs">
                {branch.trend >= 0 ? (
                  <><ArrowUpRight className="w-3.5 h-3.5 text-emerald-600" /><span className="text-emerald-600 font-medium">+{branch.trend}%</span></>
                ) : (
                  <><ArrowDownRight className="w-3.5 h-3.5 text-red-600" /><span className="text-red-600 font-medium">{branch.trend}%</span></>
                )}
                <span className="text-[var(--color-text-muted)]">{t('vsLastMonth', { defaultValue: 'vs last month' })}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DashboardLayout>
  );
}
