import { useState, useEffect } from 'react';
import { Plus, X, Users, PieChart, TrendingUp, DollarSign } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { authHeader } from '../utils/auth';
import { useTranslation } from 'react-i18next';

interface Shareholder {
  id: number; name: string; phone: string;
  share_count: number; type: 'profit' | 'owner'; investment: number;
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

export default function DirectorDashboard({ role = 'director' }: { role?: string }) {
  const { t } = useTranslation(['director', 'common']);
  const [shareholders,        setShareholders]      = useState<Shareholder[]>([]);
  const [profitCalc,          setProfitCalc]        = useState<ProfitCalculation | null>(null);
  const [loading,             setLoading]           = useState(true);
  const [showAddShareholder,  setShowAdd]           = useState(false);
  const [newShareholder,      setNew]               = useState({
    name: '', address: '', phone: '', shareCount: 0, type: 'profit' as 'profit' | 'owner', investment: 0,
  });

  useEffect(() => { fetchData(); }, []);

  // ESC to close modal
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowAdd(false); setNew({ name: '', address: '', phone: '', shareCount: 0, type: 'profit', investment: 0 }); } };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, []);

  const fetchData = async () => {
    try {
      const headers = authHeader();
      const [shRes, calcRes] = await Promise.all([
        axios.get('/api/shareholders', { headers }),
        axios.get('/api/shareholders/calculate', {
          headers,
          params: { month: new Date().toISOString().slice(0, 7) },
        }),
      ]);
      setShareholders(shRes.data.shareholders || []);
      setProfitCalc(calcRes.data);
    } catch { toast.error(t('director.failed_to_fetch_data')); }
    finally { setLoading(false); }
  };

  const handleAddShareholder = async () => {
    try {
      await axios.post('/api/shareholders', newShareholder, { headers: authHeader() });
      toast.success(t('director.shareholder_added'));
      setShowAdd(false);
      setNew({ name: '', address: '', phone: '', shareCount: 0, type: 'profit', investment: 0 });
      fetchData();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || 'Failed to add shareholder');
    }
  };

  const handleApproveProfit = async () => {
    if (!profitCalc) return;
    try {
      const items = profitCalc.breakdown.map((item) => ({
        shareholderId: item.id,
        grossDividend: item.grossDividend,
        taxDeducted: item.taxDeducted,
        netPayable: item.netPayable,
      }));
      await axios.post('/api/shareholders/distribute', {
        month: profitCalc.month,
        items,
      }, { headers: authHeader() });
      toast.success(t('director.profit_distribution_approved'));
      fetchData();
    } catch { toast.error(t('director.failed_to_approve')); }
  };

  const profitPartners = shareholders.filter(s => s.type === 'profit');
  const ownerPartners  = shareholders.filter(s => s.type === 'owner');
  const totalShares    = shareholders.reduce((sum, s) => sum + s.share_count, 0);
  const totalInvest    = shareholders.reduce((sum, s) => sum + s.investment, 0);
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
          <button onClick={() => setShowAdd(true)} className="btn-primary">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('addShareholder', { defaultValue: 'Add Shareholder' })}</span>
          </button>
        </div>

        {/* ── Shareholder KPIs ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('totalShares',     { defaultValue: 'Total Shares' })}     value={totalShares}           loading={loading} icon={<PieChart className="w-5 h-5" />}   iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" index={0} />
          <KPICard title={t('profitPartners',  { defaultValue: 'Profit Partners' })}  value={profitPartners.length} loading={loading} icon={<TrendingUp className="w-5 h-5" />} iconBg="bg-emerald-50 text-emerald-600" index={1} />
          <KPICard title={t('ownerPartners',   { defaultValue: 'Owner Partners' })}   value={ownerPartners.length}  loading={loading} icon={<Users className="w-5 h-5" />}      iconBg="bg-blue-50 text-blue-600"      index={2} />
          <KPICard title={t('totalInvestment', { defaultValue: 'Total Investment' })} value={fmt(totalInvest)}      loading={loading} icon={<DollarSign className="w-5 h-5" />}  iconBg="bg-amber-50 text-amber-600"    index={3} />
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
