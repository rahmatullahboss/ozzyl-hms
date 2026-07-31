import { useState, useEffect, useCallback } from 'react';
import {
  Users, Plus, X, Search, DollarSign, TrendingUp,
  PiggyBank, Calculator, Check, ChevronRight, Upload
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import KPICard from '../../components/dashboard/KPICard';
import PdfImportModal from '../../components/shareholders/PdfImportModal';
import { useTranslation } from 'react-i18next';

/* ─── Types ─── */
interface Shareholder {
  id: number;
  name: string;
  address?: string;
  phone?: string;
  share_count: number;
  type: string;
  investment: number;
  start_date?: string;
}

interface Distribution {
  id: number;
  month: string;
  total_profit: number;
  distributable_profit: number;
  profit_percentage: number;
  approved_at: string;
}

interface CalculationResult {
  month: string;
  financials: {
    totalIncome: number;
    totalExpenses: number;
    netProfit: number;
    retainedAmount: number;
    retainedPct: number;
    distributable: number;
  };
  taxConfig: {
    tdsApplicable: boolean;
    taxRate: number;
    tdsRate: number;
  };
  metrics: {
    totalShares: number;
    globalShareValue: number;
    grossPerShare: number;
  };
  profitPct: number;
  breakdown: {
    id: number;
    name: string;
    type: string;
    shareCount: number;
    shareValueBdt: number;
    shareValueTotal: number;
    grossDividend: number;
    taxDeducted: number;
    netPayable: number;
  }[];
}

const TYPE_BADGE: Record<string, { label: string; badge: string }> = {
  owner:        { label: 'Owner',        badge: 'badge-primary' },
  profit:       { label: 'Profit',       badge: 'badge-success' },
  investor:     { label: 'Investor',     badge: 'badge-warning' },
  doctor:       { label: 'Doctor',       badge: 'badge-info' },
  shareholder:  { label: 'Shareholder',  badge: 'badge-secondary' },
};

export default function ShareholderManagement({ role = 'hospital_admin' }: { role?: string }) {
  const [shareholders, setShareholders] = useState<Shareholder[]>([]);
  const [distributions, setDistributions] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Shareholder | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', address: '', phone: '', shareCount: '', type: 'investor', investment: '', startDate: '', email: '', nid: '', bankName: '', bankAccountNo: '', bankBranch: '', routingNo: '', nomineeName: '', nomineeContact: '' });
  const [activeTab, setActiveTab] = useState<'shareholders' | 'distributions' | 'calculate'>('shareholders');
  const [calcMonth, setCalcMonth] = useState(new Date().toISOString().slice(0, 7));
  const [calcResult, setCalcResult] = useState<CalculationResult | null>(null);
  const [distributing, setDistributing] = useState(false);
  const [showPdfImport, setShowPdfImport] = useState(false);
  const { t } = useTranslation(['accounting', 'common']);

  // ESC-to-close modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setShowModal(false); setEditing(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fetchShareholders = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const params: Record<string, string> = {};
      if (typeFilter) params.type = typeFilter;
      const { data } = await axios.get('/api/shareholders', { params, headers: { Authorization: `Bearer ${token}` } });
      setShareholders(data.shareholders ?? []);
    } catch {
      setShareholders([]);
      toast.error(t('shareholders.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  const fetchDistributions = useCallback(async () => {
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/shareholders/distributions', { headers: { Authorization: `Bearer ${token}` } });
      setDistributions(data.distributions ?? []);
    } catch {
      setDistributions([]);
    }
  }, []);

  useEffect(() => { fetchShareholders(); }, [fetchShareholders]);
  useEffect(() => { fetchDistributions(); }, [fetchDistributions]);

  const totalShares = shareholders.reduce((s, sh) => s + sh.share_count, 0);
  const totalInvestment = shareholders.reduce((s, sh) => s + sh.investment, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const payload = {
      name: form.name,
      address: form.address || undefined,
      phone: form.phone || undefined,
      shareCount: parseInt(form.shareCount) || 0,
      type: form.type,
      investment: parseInt(form.investment) || 0,
      startDate: form.startDate || undefined,
    };
    try {
      const token = localStorage.getItem('hms_token');
      if (editing) {
        await axios.put(`/api/shareholders/${editing.id}`, payload, { headers: { Authorization: `Bearer ${token}` } });
        toast.success(t('shareholders.updated'));
      } else {
        await axios.post('/api/shareholders', payload, { headers: { Authorization: `Bearer ${token}` } });
        toast.success(t('shareholders.added'));
      }
      setShowModal(false);
      setEditing(null);
      fetchShareholders();
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : 'Operation failed';
      toast.error(msg ?? t('shareholders.operationFailed'));
    } finally {
      setSaving(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', address: '', phone: '', shareCount: '', type: 'investor', investment: '', startDate: '', email: '', nid: '', bankName: '', bankAccountNo: '', bankBranch: '', routingNo: '', nomineeName: '', nomineeContact: '' });
    setShowModal(true);
  };

  const openEdit = (sh: Shareholder) => {
    setEditing(sh);
    setForm({ name: sh.name, address: sh.address || '', phone: sh.phone || '', shareCount: sh.share_count.toString(), type: sh.type, investment: sh.investment.toString(), startDate: sh.start_date || '', email: '', nid: '', bankName: '', bankAccountNo: '', bankBranch: '', routingNo: '', nomineeName: '', nomineeContact: '' });
    setShowModal(true);
  };

  const calculateProfit = async () => {
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/shareholders/calculate', { params: { month: calcMonth }, headers: { Authorization: `Bearer ${token}` } });
      setCalcResult(data);
    } catch {
      toast.error(t('shareholders.calculationFailed'));
    }
  };

  const distributeProfit = async () => {
    if (!calcResult) return;
    setDistributing(true);
    try {
      const token = localStorage.getItem('hms_token');
      const items = calcResult.breakdown.map(b => ({
        shareholderId: b.id,
        grossDividend: b.grossDividend,
        taxDeducted: b.taxDeducted,
        netPayable: b.netPayable,
      }));
      await axios.post('/api/shareholders/distribute', {
        month: calcMonth,
        items,
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('shareholders.profitDistributed'));
      setCalcResult(null);
      fetchDistributions();
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : 'Distribution failed';
      toast.error(msg ?? t('shareholders.distributionFailed'));
    } finally {
      setDistributing(false);
    }
  };

  const displayed = shareholders.filter(sh =>
    (!search || sh.name.toLowerCase().includes(search.toLowerCase())) &&
    (!typeFilter || sh.type === typeFilter)
  );

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">Shareholder Management</h1>
            <p className="section-subtitle mt-1">Manage shareholders, shares, and profit distribution</p>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowPdfImport(true)} className="btn-secondary">
              <Upload className="w-4 h-4" /> PDF Import
            </button>
            <button onClick={openAdd} className="btn-primary">
              <Plus className="w-4 h-4" /> Add Shareholder
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title="Total Shareholders" value={shareholders.length} loading={loading} icon={<Users className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title="Total Shares" value={totalShares} loading={loading} icon={<PiggyBank className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title="Total Investment" value={`৳${totalInvestment.toLocaleString()}`} loading={loading} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title="Distributions" value={distributions.length} loading={loading} icon={<TrendingUp className="w-5 h-5"/>} iconBg="bg-amber-50 text-amber-600" />
        </div>

        <div className="flex border-b border-[var(--color-border)]">
          {([['shareholders', 'Shareholders'], ['distributions', 'Distribution History'], ['calculate', 'Calculate Profit']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeTab === key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}>
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'shareholders' && (
          <>
            <div className="card p-4 flex flex-wrap gap-3 items-center">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input type="text" placeholder={t("shareholders.searchPlaceholder")} value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" />
              </div>
              <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
                {[['', 'All'], ['owner', 'Owner'], ['profit', 'Profit'], ['investor', 'Investor'], ['doctor', 'Doctor'], ['shareholder', 'Shareholder']].map(([val, label]) => (
                  <button key={val} onClick={() => setTypeFilter(val)}
                    className={`px-3 py-2 font-medium transition-colors ${typeFilter === val ? 'bg-[var(--color-primary)] text-white' : 'bg-white hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead><tr><th>#</th><th>Name</th><th>Type</th><th>Shares</th><th>Investment</th><th>Phone</th><th>Actions</th></tr></thead>
                  <tbody>
                    {loading ? (
                      [...Array(4)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    ) : displayed.length === 0 ? (
                      <tr><td colSpan={7} className="py-16 text-center text-[var(--color-text-muted)]">No shareholders found</td></tr>
                    ) : (
                      displayed.map((sh, idx) => {
                        const tb = TYPE_BADGE[sh.type] ?? { label: sh.type, badge: 'badge-secondary' };
                        return (
                          <tr key={sh.id}>
                            <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                            <td className="font-medium">{sh.name}</td>
                            <td><span className={`badge ${tb.badge}`}>{tb.label}</span></td>
                            <td className="font-data">{sh.share_count}</td>
                            <td className="font-data">৳{sh.investment.toLocaleString()}</td>
                            <td className="text-[var(--color-text-secondary)]">{sh.phone || '—'}</td>
                            <td><button onClick={() => openEdit(sh)} className="btn-ghost text-sm"><ChevronRight className="w-4 h-4" /></button></td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {activeTab === 'distributions' && (
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead><tr><th>Month</th><th>Total Profit</th><th>Distributable</th><th>Profit %</th><th>Approved</th></tr></thead>
                <tbody>
                  {distributions.length === 0 ? (
                    <tr><td colSpan={5} className="py-16 text-center text-[var(--color-text-muted)]">No distributions yet</td></tr>
                  ) : (
                    distributions.map(d => (
                      <tr key={d.id}>
                        <td className="font-medium">{d.month}</td>
                        <td className="font-data">৳{d.total_profit.toLocaleString()}</td>
                        <td className="font-data text-emerald-600">৳{d.distributable_profit.toLocaleString()}</td>
                        <td className="font-data">{d.profit_percentage}%</td>
                        <td className="text-sm text-[var(--color-text-muted)]">{new Date(d.approved_at).toLocaleDateString()}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'calculate' && (
          <div className="card p-6 space-y-5">
            <div className="flex items-end gap-4">
              <div>
                <label className="label">{t('accounting.month')}</label>
                <input type="month" className="input" value={calcMonth} onChange={e => setCalcMonth(e.target.value)} />
              </div>
              <button onClick={calculateProfit} className="btn-primary"><Calculator className="w-4 h-4" /> Calculate</button>
            </div>

            {calcResult && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-3 bg-[var(--color-surface)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)]">Income</p>
                    <p className="font-data font-medium text-emerald-600">৳{calcResult.financials.totalIncome.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-[var(--color-surface)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)]">Expenses</p>
                    <p className="font-data font-medium text-red-600">৳{calcResult.financials.totalExpenses.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-[var(--color-surface)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)]">Net Profit</p>
                    <p className="font-data font-semibold">৳{calcResult.financials.netProfit.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-[var(--color-surface)] rounded-lg">
                    <p className="text-xs text-[var(--color-text-muted)]">Distributable ({calcResult.profitPct}%)</p>
                    <p className="font-data font-semibold text-[var(--color-primary)]">৳{calcResult.financials.distributable.toLocaleString()}</p>
                  </div>
                </div>

                {calcResult.financials.retainedAmount > 0 && (
                  <p className="text-sm text-amber-600">Retained Earnings: ৳{calcResult.financials.retainedAmount.toLocaleString()} ({calcResult.financials.retainedPct}%)</p>
                )}
                {calcResult.taxConfig.tdsApplicable && (
                  <p className="text-sm text-red-500">TDS @{calcResult.taxConfig.taxRate}% applicable</p>
                )}
                <p className="text-sm text-[var(--color-text-muted)]">Per Share: ৳{calcResult.metrics.grossPerShare.toLocaleString()} × {calcResult.metrics.totalShares} shares</p>

                <table className="table-base text-sm">
                  <thead><tr><th>Shareholder</th><th>Type</th><th>Shares</th><th className="text-right">Gross</th><th className="text-right">Tax</th><th className="text-right">Net Payable</th></tr></thead>
                  <tbody>
                    {calcResult.breakdown.map(b => (
                      <tr key={b.id}>
                        <td className="font-medium">{b.name}</td>
                        <td><span className={`badge ${TYPE_BADGE[b.type]?.badge ?? 'badge-secondary'}`}>{TYPE_BADGE[b.type]?.label ?? b.type}</span></td>
                        <td className="font-data">{b.shareCount}</td>
                        <td className="text-right font-data">৳{b.grossDividend.toLocaleString()}</td>
                        <td className="text-right font-data text-red-500">{b.taxDeducted > 0 ? `৳${b.taxDeducted.toLocaleString()}` : '—'}</td>
                        <td className="text-right font-data font-medium">৳{b.netPayable.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <button onClick={distributeProfit} disabled={distributing} className="btn-primary w-full">
                  <Check className="w-4 h-4" /> {distributing ? 'Distributing…' : `Approve & Distribute ৳${calcResult.financials.distributable.toLocaleString()}`}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Add/Edit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{editing ? 'Edit Shareholder' : 'Add Shareholder'}</h3>
                <button onClick={() => { setShowModal(false); setEditing(null); }} className="btn-ghost p-1.5" aria-label="Close modal"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label">{t('accounting.name_')}</label><input className="input" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('accounting.type_')}</label>
                    <select className="input" value={form.type} onChange={e => setForm({ ...form, type: e.target.value })}>
                      <option value="owner">Owner</option><option value="profit">Profit Holder</option><option value="investor">Investor</option><option value="doctor">Doctor</option><option value="shareholder">Shareholder</option>
                    </select>
                  </div>
                  <div><label className="label">{t('accounting.shares_')}</label><input className="input" type="number" min="1" required value={form.shareCount} onChange={e => setForm({ ...form, shareCount: e.target.value })} /></div>
                </div>
                <div><label className="label">{t('accounting.investment_')}</label><input className="input" type="number" min="0" value={form.investment} onChange={e => setForm({ ...form, investment: e.target.value })} /></div>
                <div><label className="label">{t('accounting.phone')}</label><input className="input" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                <div><label className="label">{t('accounting.address')}</label><input className="input" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => { setShowModal(false); setEditing(null); }} className="btn-secondary">Cancel</button>
                  <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : editing ? 'Update' : 'Add Shareholder'}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* PDF Import Modal */}
        <PdfImportModal
          isOpen={showPdfImport}
          onClose={() => setShowPdfImport(false)}
          onImportComplete={() => {
            setShowPdfImport(false);
            fetchShareholders();
          }}
        />
      </div>
    </DashboardLayout>
  );
}
