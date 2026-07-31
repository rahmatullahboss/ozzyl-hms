import { useState } from 'react';
import { TrendingUp, Calculator, DollarSign, History } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import KPICard from '../../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';

interface CalcResult {
  month: string; totalIncome: number; totalExpense: number; totalProfit: number;
  profitPercentage: number; distributableProfit: number; calculatedAt: string;
}
interface Distribution {
  id: number; month: string; total_profit: number; distributable_profit: number;
  profit_percentage: number; approved_by_name?: string; approved_at: string;
}

export default function ProfitLoss({ role = 'hospital_admin' }: { role?: string }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [calc, setCalc] = useState<CalcResult | null>(null);
  const [history, setHistory] = useState<Distribution[]>([]);
  const [loading, setLoading] = useState(false);
  const [distributing, setDistributing] = useState(false);
  const [tab, setTab] = useState<'calculate' | 'history'>('calculate');
  const { t } = useTranslation(['accounting', 'common']);

  const calculate = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/profit/calculate', { params: { month }, headers: { Authorization: `Bearer ${token}` } });
      setCalc(data);
    } catch { toast.error(t('accounting.calculationFailed')); } finally { setLoading(false); }
  };

  const distribute = async () => {
    setDistributing(true);
    try {
      const token = localStorage.getItem('hms_token');
      await axios.post('/api/profit/distribute', { month }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('accounting.profitDistributed')); setCalc(null); fetchHistory();
    } catch (err) { toast.error(axios.isAxiosError(err) ? err.response?.data?.error ?? t('common.failed') : t('common.failed')); } finally { setDistributing(false); }
  };

  const fetchHistory = async () => {
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/profit/history', { headers: { Authorization: `Bearer ${token}` } });
      setHistory(data.distributions ?? []);
    } catch { setHistory([]); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div><h1 className="page-title">Profit & Loss</h1><p className="section-subtitle mt-1">Calculate monthly P&L and distribute profits</p></div></div>

        <div className="flex border-b border-[var(--color-border)]">
          {([['calculate', 'Calculate P&L'], ['history', 'Distribution History']] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); if (key === 'history') fetchHistory(); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)]'}`}>{label}</button>
          ))}
        </div>

        {tab === 'calculate' && (
          <div className="card p-6 space-y-5">
            <div className="flex items-end gap-4">
              <div><label className="label">{t('accounting.month')}</label><input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} /></div>
              <button onClick={calculate} disabled={loading} className="btn-primary"><Calculator className="w-4 h-4" /> {loading ? 'Calculating…' : 'Calculate'}</button>
            </div>

            {calc && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KPICard title="Total Income" value={`৳${calc.totalIncome.toLocaleString()}`} loading={false} icon={<TrendingUp className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
                  <KPICard title="Total Expenses" value={`৳${calc.totalExpense.toLocaleString()}`} loading={false} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-red-50 text-red-600" />
                  <KPICard title="Net Profit" value={`৳${calc.totalProfit.toLocaleString()}`} loading={false} icon={<TrendingUp className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
                  <KPICard title={`Distributable (${calc.profitPercentage}%)`} value={`৳${calc.distributableProfit.toLocaleString()}`} loading={false} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
                </div>

                <div className="bg-[var(--color-surface)] p-4 rounded-lg">
                  <div className="flex justify-between items-center text-sm">
                    <div>
                      <p className="text-[var(--color-text-muted)]">Profit margin</p>
                      <p className="font-data font-semibold text-lg">{calc.totalIncome > 0 ? ((calc.totalProfit / calc.totalIncome) * 100).toFixed(1) : '0'}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[var(--color-text-muted)]">Month</p>
                      <p className="font-medium">{calc.month}</p>
                    </div>
                  </div>
                  <div className="mt-3 w-full bg-[var(--color-border)] rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all" style={{ width: `${Math.min((calc.totalProfit / (calc.totalIncome || 1)) * 100, 100)}%` }} />
                  </div>
                </div>

                {calc.distributableProfit > 0 && (
                  <button onClick={distribute} disabled={distributing} className="btn-primary w-full">
                    {distributing ? 'Distributing…' : `Approve & Distribute ৳${calc.distributableProfit.toLocaleString()}`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>Month</th><th>Total Profit</th><th>Distributable</th><th>%</th><th>Approved By</th><th>Date</th></tr></thead><tbody>
            {history.length === 0 ? <tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]"><History className="w-10 h-10 mx-auto mb-2 opacity-30" />No distributions yet</td></tr>
            : history.map(d => (
                <tr key={d.id}>
                  <td className="font-medium">{d.month}</td>
                  <td className="font-data">৳{d.total_profit.toLocaleString()}</td>
                  <td className="font-data text-emerald-600">৳{d.distributable_profit.toLocaleString()}</td>
                  <td className="font-data">{d.profit_percentage}%</td>
                  <td>{d.approved_by_name || '—'}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{new Date(d.approved_at).toLocaleDateString()}</td>
                </tr>
              ))}
          </tbody></table></div></div>
        )}
      </div>
    </DashboardLayout>
  );
}
