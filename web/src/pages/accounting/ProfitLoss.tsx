import { useState } from 'react';
import { TrendingUp, Calculator, DollarSign, History } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import KPICard from '../../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDisplayDate } from '../../lib/date-utils';

interface CalcResult {
  month: string; totalIncome: number; totalExpense: number; totalProfit: number;
  profitPercentage: number; distributableProfit: number; calculatedAt: string;
}
interface Distribution {
  id: number; month: string; total_profit: number; distributable_profit: number;
  profit_percentage: number; approved_by_name?: string; approved_at: string;
}

interface HistoryResponse {
  distributions: Distribution[];
}

export default function ProfitLoss({ role = 'hospital_admin' }: { role?: string }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [calcEnabled, setCalcEnabled] = useState(false);
  const [tab, setTab] = useState<'calculate' | 'history'>('calculate');
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const { t } = useTranslation(['tenantBilling']);
  const queryClient = useQueryClient();

  const { data: calc, isLoading: loading, isFetching } = useApiQuery<CalcResult>(
    queryKeys.accounting.profitLoss(month),
    `/api/profit/calculate?month=${month}`,
    {
      enabled: calcEnabled,
    },
  );

  const { data: historyData } = useApiQuery<HistoryResponse>(
    queryKeys.accounting.profitHistory(),
    '/api/profit/history',
    {
      enabled: historyEnabled,
    },
  );

  const history = historyData?.distributions ?? [];

  const distributeMutation = useApiMutation<unknown, { month: string }>(
    'post',
    '/api/profit/distribute',
    {
      onSuccess: () => {
        toast.success(t('profitLoss.distributed'));
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
        setCalcEnabled(false);
        setHistoryEnabled(true);
      },
      onError: (err) => {
        toast.error(err.message ?? t('profitLoss.failed'));
      },
    },
  );

  const distributing = distributeMutation.isPending;

  const calculate = () => {
    setCalcEnabled(true);
    // If already cached for this month, force a refetch
    queryClient.invalidateQueries({ queryKey: queryKeys.accounting.profitLoss(month) });
  };

  const distribute = () => {
    distributeMutation.mutate({ month });
  };

  const fetchHistory = () => {
    setHistoryEnabled(true);
    queryClient.invalidateQueries({ queryKey: queryKeys.accounting.profitHistory() });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header"><div><h1 className="page-title">{t('profitLoss.title')}</h1><p className="section-subtitle mt-1">{t('profitLoss.subtitle')}</p></div></div>

        <div className="flex border-b border-[var(--color-border)]">
          {([['calculate', t('profitLoss.tabCalculate')], ['history', t('profitLoss.tabHistory')]] as const).map(([key, label]) => (
            <button key={key} onClick={() => { setTab(key); if (key === 'history') fetchHistory(); }}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === key ? 'border-[var(--color-primary)] text-[var(--color-primary)]' : 'border-transparent text-[var(--color-text-muted)]'}`}>{label}</button>
          ))}
        </div>

        {tab === 'calculate' && (
          <div className="card p-6 space-y-5">
            <div className="flex items-end gap-4">
              <div><label className="label">{t('profitLoss.month')}</label><input type="month" className="input" value={month} onChange={e => setMonth(e.target.value)} /></div>
              <button onClick={calculate} disabled={loading || isFetching} className="btn-primary"><Calculator className="w-4 h-4" /> {(loading || isFetching) ? t('profitLoss.calculating') : t('profitLoss.calculate')}</button>
            </div>

            {calc && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <KPICard title={t('profitLoss.totalIncome')} value={`৳${calc.totalIncome.toLocaleString()}`} loading={false} icon={<TrendingUp className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
                  <KPICard title={t('profitLoss.totalExpenses')} value={`৳${calc.totalExpense.toLocaleString()}`} loading={false} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-red-50 text-red-600" />
                  <KPICard title={t('profitLoss.netProfit')} value={`৳${calc.totalProfit.toLocaleString()}`} loading={false} icon={<TrendingUp className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
                  <KPICard title={`${t('profitLoss.distributable')} (${calc.profitPercentage}%)`} value={`৳${calc.distributableProfit.toLocaleString()}`} loading={false} icon={<DollarSign className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
                </div>

                <div className="bg-[var(--color-surface)] p-4 rounded-lg">
                  <div className="flex justify-between items-center text-sm">
                    <div>
                      <p className="text-[var(--color-text-muted)]">{t('profitLoss.profitMargin')}</p>
                      <p className="font-data font-semibold text-lg">{calc.totalIncome > 0 ? ((calc.totalProfit / calc.totalIncome) * 100).toFixed(1) : '0'}%</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[var(--color-text-muted)]">{t('profitLoss.month')}</p>
                      <p className="font-medium">{calc.month}</p>
                    </div>
                  </div>
                  <div className="mt-3 w-full bg-[var(--color-border)] rounded-full h-3 overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all" style={{ width: `${Math.min((calc.totalProfit / (calc.totalIncome || 1)) * 100, 100)}%` }} />
                  </div>
                </div>

                {calc.distributableProfit > 0 && (
                  <button onClick={distribute} disabled={distributing} className="btn-primary w-full">
                    {distributing ? t('profitLoss.distributing') : `${t('profitLoss.approveAndDistribute')} ৳${calc.distributableProfit.toLocaleString()}`}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div className="card overflow-hidden"><div className="overflow-x-auto"><table className="table-base"><thead><tr><th>{t('profitLoss.month')}</th><th>{t('profitLoss.totalProfit')}</th><th>{t('profitLoss.distributable')}</th><th>%</th><th>{t('profitLoss.approvedBy')}</th><th>{t('profitLoss.date')}</th></tr></thead><tbody>
            {history.length === 0 ? <tr><td colSpan={6} className="py-16 text-center text-[var(--color-text-muted)]"><History className="w-10 h-10 mx-auto mb-2 opacity-30" />{t('profitLoss.noHistory')}</td></tr>
              : history.map(d => (
                <tr key={d.id}>
                  <td className="font-medium">{d.month}</td>
                  <td className="font-data">৳{d.total_profit.toLocaleString()}</td>
                  <td className="font-data text-emerald-600">৳{d.distributable_profit.toLocaleString()}</td>
                  <td className="font-data">{d.profit_percentage}%</td>
                  <td>{d.approved_by_name || '—'}</td>
                  <td className="text-sm text-[var(--color-text-muted)]">{formatDisplayDate(d.approved_at)}</td>
                </tr>
              ))}
          </tbody></table></div></div>
        )}
      </div>
    </DashboardLayout>
  );
}
