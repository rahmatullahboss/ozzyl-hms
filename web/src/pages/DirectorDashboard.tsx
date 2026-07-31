import { useState, useEffect, useMemo } from 'react';
import { Plus, X, Users, PieChart, TrendingUp, DollarSign, ClipboardList, FileText, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import ExecutiveControlKpis from '../components/dashboard/ExecutiveControlKpis';
import ExecutiveDuePanel from '../components/dashboard/ExecutiveDuePanel';
import IPDBillingOverview from '../components/dashboard/IPDBillingOverview';
import type { DashboardPeriod } from '../components/dashboard/dashboardPeriod';
import ExecutiveDashboardRangeFilter, { resolveExecutiveDashboardFilters } from '../components/dashboard/ExecutiveDashboardRangeFilter';
import PendingRequestsSection from '../components/dashboard/PendingRequestsSection';
import { executiveAnalyticsQuery } from '../hooks/useExecutiveDashboardAnalytics';
import type { ExecutiveDashboardFilters } from '../types/executiveDashboard';

interface Shareholder {
  id: number; name: string; phone: string;
  share_count: number; type: 'profit' | 'owner'; investment: number;
}

interface ShareholdersResponse {
  shareholders: Shareholder[];
}

interface ProfitCalculation {
  month: string;
  financials: {
    totalIncome: number;
    totalExpenses: number;
    netProfit: number;
    retainedAmount: number;
    retainedPct: number;
    distributable: number;
  };
  profitPct: number;
  breakdown: Array<{
    id: number;
    name: string;
    type: string;
    shareCount: number;
    grossDividend: number;
    taxDeducted: number;
    netPayable: number;
  }>;
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

const currentMonth = new Date().toISOString().slice(0, 7);

export default function DirectorDashboard({ role = 'director' }: { role?: string }) {
  const { t } = useTranslation(['director', 'common']);
  const { user } = useAuth();
  const { slug } = useParams<{ slug: string }>();
  const queryClient = useQueryClient();
  const base = `/h/${slug ?? ''}`;
  const [filters, setFilters] = useState<ExecutiveDashboardFilters>(() => resolveExecutiveDashboardFilters('today'));
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date>(() => new Date());
  const period = useMemo<DashboardPeriod>(() => ({
    startDate: filters.startDate,
    endDate: filters.endDate,
    label: filters.startDate === filters.endDate ? filters.endDate : `${filters.startDate} – ${filters.endDate}`,
  }), [filters.endDate, filters.startDate]);
  const pendingRequestWindow = { from: filters.startDate, to: filters.endDate };
  const dashboardQuery = `?${executiveAnalyticsQuery(filters)}`;
  const pdfCenterPath = `${base}/director/reports/pdf?from=${filters.startDate}&to=${filters.endDate}`;
  const dailyClosingPackPath = `${base}/director/reports/pdf?pack=daily-closing&from=${filters.startDate}&to=${filters.endDate}&autoprint=1`;
  const userPermissions = user?.permissions ?? [];
  const canWorkAsReception = userPermissions.includes('*')
    || userPermissions.includes('billing.counter.shift.auto_open')
    || userPermissions.includes('billing.counter.activate')
    || userPermissions.includes('billing.counter.handover.receive');

  const [showAddShareholder,  setShowAdd]           = useState(false);
  const [newShareholder,      setNew]               = useState({
    name: '', address: '', phone: '', shareCount: 0, type: 'profit' as 'profit' | 'owner', investment: 0,
  });

  // ── Queries ──────────────────────────────────────────────────────────────
  const {
    data: shareholdersData,
    isLoading: shareholdersLoading,
  } = useApiQuery<ShareholdersResponse>(
    queryKeys.shareholders.list(),
    '/api/shareholders',
  );

  const {
    data: profitCalc,
    isLoading: calcLoading,
  } = useApiQuery<ProfitCalculation>(
    queryKeys.shareholders.calculate(currentMonth),
    `/api/shareholders/calculate?month=${currentMonth}`,
  );

  const loading = shareholdersLoading || calcLoading;
  const shareholders = shareholdersData?.shareholders ?? [];

  // ── Mutations ────────────────────────────────────────────────────────────
  const addShareholderMutation = useApiMutation<unknown, typeof newShareholder>(
    'post',
    '/api/shareholders',
    {
      onSuccess: () => {
        toast.success(t('director.shareholder_added'));
        setShowAdd(false);
        setNew({ name: '', address: '', phone: '', shareCount: 0, type: 'profit', investment: 0 });
        queryClient.invalidateQueries({ queryKey: queryKeys.shareholders.all });
      },
      onError: (error: Error) => {
        toast.error(error.message || 'Failed to add shareholder');
      },
    },
  );

  const distributeMutation = useApiMutation<unknown, { month: string; items: Array<{ shareholderId: number; grossDividend: number; taxDeducted: number; netPayable: number }> }>(
    'post',
    '/api/shareholders/distribute',
    {
      onSuccess: () => {
        toast.success(t('director.profit_distribution_approved'));
        queryClient.invalidateQueries({ queryKey: queryKeys.shareholders.all });
      },
      onError: () => {
        toast.error(t('director.failed_to_approve'));
      },
    },
  );

  // ESC to close modal
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowAdd(false); setNew({ name: '', address: '', phone: '', shareCount: 0, type: 'profit', investment: 0 }); } };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const handleAddShareholder = () => {
    addShareholderMutation.mutate(newShareholder);
  };

  const handleApproveProfit = () => {
    if (!profitCalc) return;
    const items = profitCalc.breakdown.map((item) => ({
      shareholderId: item.id,
      grossDividend: item.grossDividend,
      taxDeducted: item.taxDeducted,
      netPayable: item.netPayable,
    }));
    distributeMutation.mutate({ month: profitCalc.month, items });
  };

  const refreshExecutiveDashboard = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.shareholders.all }),
      queryClient.invalidateQueries({ queryKey: ['director', 'executive-control'] }),
      queryClient.invalidateQueries({ queryKey: ['director', 'executive-kpis'] }),
      queryClient.invalidateQueries({ queryKey: ['director', 'executive-analytics'] }),
      queryClient.invalidateQueries({ queryKey: ['director', 'ipd-billing-overview'] }),
      queryClient.invalidateQueries({ queryKey: queryKeys.actionCenter.collections.all }),
    ]);
    setLastRefreshedAt(new Date());
  };

  const profitPartners = useMemo(() => shareholders.filter(s => s.type === 'profit'), [shareholders]);
  const ownerPartners  = useMemo(() => shareholders.filter(s => s.type === 'owner'), [shareholders]);
  const totalShares    = useMemo(() => shareholders.reduce((sum, s) => sum + s.share_count, 0), [shareholders]);
  const totalInvest    = useMemo(() => shareholders.reduce((sum, s) => sum + s.investment, 0), [shareholders]);
  const averageProfitPartnerPayout = profitCalc && profitPartners.length > 0
    ? Math.round(
        profitCalc.breakdown
          .filter((item) => item.type === 'profit')
          .reduce((sum, item) => sum + item.netPayable, 0) / profitPartners.length,
      )
    : 0;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <h1 className="page-title">{t('directorDashboard', { defaultValue: 'Administration Dashboard' })}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={pdfCenterPath} className="btn-secondary text-xs">
              <FileText className="w-4 h-4" aria-hidden="true" />
              PDF Center
            </Link>
            <Link to={dailyClosingPackPath} className="btn-secondary text-xs">
              <Printer className="w-4 h-4" aria-hidden="true" />
              Daily Pack
            </Link>
            {canWorkAsReception ? (
              <Link
                to={`${base}/reception/dashboard`}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-2 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-bg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
              >
                <ClipboardList className="h-4 w-4" />
                <span className="hidden sm:inline">{t('workAsReception', { defaultValue: 'Work as Reception' })}</span>
              </Link>
            ) : null}
            <button onClick={() => setShowAdd(true)} className="btn-primary">
              <Plus className="w-4 h-4" />
              <span className="hidden sm:inline">{t('addShareholder', { defaultValue: 'Add Shareholder' })}</span>
            </button>
          </div>
        </div>

        <ExecutiveDashboardRangeFilter
          filters={filters}
          onChange={setFilters}
          onRefresh={() => { void refreshExecutiveDashboard(); }}
          refreshing={loading}
          lastRefreshedAt={lastRefreshedAt}
        />

        <ExecutiveControlKpis
          queryKeyScope="director"
          querySuffix={dashboardQuery}
          filters={filters}
          snapshotDate={filters.endDate}
          title="Administration cash-control KPIs"
          subtitle="Admin dashboard cash KPIs with the same drilldown, transaction details, and cash source breakdown. Accounting KPIs stay below this top control section."
          handoverPath={`${base}/director/handover?status=pending&mode=management`}
        />

        <ExecutiveDuePanel
          role="director"
          basePath={base}
          queryKeyScope="director"
        />

        <IPDBillingOverview period={period} queryKeyScope="director" />
        <PendingRequestsSection role="director" window={pendingRequestWindow} />

        {/* ── Shareholder KPIs ── */}
        <div className="card p-4 sm:p-5" data-testid="director-shareholder-accounting-kpis">
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Ownership & accounting</p>
            <h2 className="section-title mt-1">Shareholder and profit KPIs</h2>
            <p className="section-subtitle mt-1">Administration-specific accounting/profit KPIs are kept below the operational cash-control KPIs.</p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('totalShares',     { defaultValue: 'Total Shares' })}     value={totalShares}           loading={loading} icon={<PieChart className="w-5 h-5" />}   iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('profitPartners',  { defaultValue: 'Profit Partners' })}  value={profitPartners.length} loading={loading} icon={<TrendingUp className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={1} />
          <KPICard title={t('ownerPartners',   { defaultValue: 'Owner Partners' })}   value={ownerPartners.length}  loading={loading} icon={<Users className="w-5 h-5" />}      iconBg="bg-blue-50 text-blue-600"      index={2} />
          <KPICard title={t('totalInvestment', { defaultValue: 'Total Investment' })} value={fmt(totalInvest)}      loading={loading} icon={<DollarSign className="w-5 h-5" />}  iconBg="bg-amber-50 text-amber-600"    index={3} />
          </div>
        </div>

        {/* ── Monthly Profit Distribution ── */}
        {profitCalc && (
          <div className="card p-5">
            <h3 className="section-title mb-4">{t('monthlyProfitDistribution')} — {profitCalc.month}</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
              {[
                { label: t('totalIncome'),   value: fmt(profitCalc.financials.totalIncome ?? 0),   color: 'text-emerald-600' },
                { label: t('totalExpenses'), value: fmt(profitCalc.financials.totalExpenses ?? 0), color: 'text-red-600' },
                { label: t('netProfit'),     value: fmt(profitCalc.financials.netProfit ?? 0),     color: 'text-[var(--color-primary)]' },
                { label: `${t('distributable')} (${profitCalc.profitPct}%)`, value: fmt(profitCalc.financials.distributable ?? 0), color: 'text-emerald-600' },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <p className="text-xs text-[var(--color-text-muted)] mb-1">{label}</p>
                  <p className={`text-xl font-bold ${color}`}>{value}</p>
                </div>
              ))}
            </div>
            <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl p-4 flex flex-wrap justify-between items-center gap-4">
              <div>
                <p className="text-xs text-[var(--color-text-muted)]">{t('eachProfitPartnerReceives')}</p>
                <p className="text-2xl font-bold text-emerald-600">{fmt(averageProfitPartnerPayout)}</p>
              </div>
              <button onClick={handleApproveProfit} className="btn-primary">
                {t('approveAndDistribute')}
              </button>
            </div>
          </div>
        )}

        {/* ── Shareholders Table ── */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--color-border)]">
            <h3 className="section-title">{t('shareholders', { defaultValue: 'Shareholders' })}</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>{t('name', { ns: 'common' })}</th><th>{t('phone')}</th><th>{t('type')}</th><th>{t('shares')}</th><th>{t('investment')}</th></tr></thead>
              <tbody>
                {loading ? (
                  [...Array(4)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 rounded" /></td>)}</tr>)
                ) : shareholders.length === 0 ? (
                  <tr><td colSpan={5} className="py-14 text-center text-[var(--color-text-muted)]">{t('noShareholders', { defaultValue: 'No shareholders found' })}</td></tr>
                ) : (
                  shareholders.map(sh => (
                    <tr key={sh.id}>
                      <td className="font-medium">{sh.name}</td>
                      <td className="font-data text-sm">{sh.phone}</td>
                      <td><span className={`badge ${sh.type === 'profit' ? 'badge-success' : 'badge-info'}`}>{sh.type}</span></td>
                      <td className="font-data">{sh.share_count}</td>
                      <td className="font-data">{fmt(sh.investment ?? 0)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Add Shareholder Modal ── */}
        {showAddShareholder && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('addNewShareholder', { defaultValue: 'Add New Shareholder' })}</h3>
                <button onClick={() => setShowAdd(false)} className="btn-ghost p-1.5"><X className="w-5 h-5"/></button>
              </div>
              <div className="p-5 space-y-4">
                <div><label className="label">{t('name', { ns: 'common' })}</label><input type="text" className="input" value={newShareholder.name} onChange={e => setNew({...newShareholder, name: e.target.value})} /></div>
                <div><label className="label">{t('address')}</label><input type="text" className="input" value={newShareholder.address} onChange={e => setNew({...newShareholder, address: e.target.value})} /></div>
                <div><label className="label">{t('phone')}</label><input type="text" className="input" value={newShareholder.phone} onChange={e => setNew({...newShareholder, phone: e.target.value})} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('shareCount')}</label><input type="number" className="input" value={newShareholder.shareCount} onChange={e => setNew({...newShareholder, shareCount: Number(e.target.value)})} /></div>
                  <div><label className="label">{t('investment')}</label><input type="number" className="input" value={newShareholder.investment} onChange={e => setNew({...newShareholder, investment: Number(e.target.value)})} /></div>
                </div>
                <div><label className="label">{t('type')}</label>
                  <select className="input" value={newShareholder.type} onChange={e => setNew({...newShareholder, type: e.target.value as 'profit' | 'owner'})}>
                    <option value="profit">{t('profitPartner')}</option>
                    <option value="owner">{t('ownerPartner')}</option>
                  </select>
                </div>
                <div className="flex gap-3 pt-2">
                  <button onClick={handleAddShareholder} className="btn-primary flex-1">{t('addShareholder', { defaultValue: 'Add Shareholder' })}</button>
                  <button onClick={() => setShowAdd(false)} className="btn-secondary">{t('cancel')}</button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
