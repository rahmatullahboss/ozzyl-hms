import { useState, useEffect, useCallback } from 'react';
import { Plus, TrendingUp, TrendingDown, Activity, X } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface DashboardData {
  today: { income: number; expense: number; profit: number };
  mtd: { income: number; expense: number; profit: number };
  lastUpdated: string;
}

interface IncomeBreakdown  { source: string;   amount: number; percentage: string }
interface ExpenseBreakdown { category: string; amount: number; percentage: string }
interface Trend            { month: string; income: number; expense: number; profit: number }

const API_BASE = '/api/accounting';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

const SOURCE_DOT: Record<string, string> = {
  pharmacy: 'bg-blue-500', laboratory: 'bg-emerald-500',
  doctor_visit: 'bg-purple-500', admission: 'bg-amber-500',
  operation: 'bg-pink-500',
};
const CAT_DOT: Record<string, string> = {
  SALARY: 'bg-red-500', MEDICINE: 'bg-orange-500', RENT: 'bg-purple-500',
  ELECTRICITY: 'bg-amber-500', WATER: 'bg-blue-500',
};

export default function AccountingDashboard({ role = 'md' }: { role?: string }) {
  const { t } = useTranslation(['accounting', 'common']);
  const [data, setData]                     = useState<DashboardData | null>(null);
  const [incomeBreakdown, setIncome]        = useState<IncomeBreakdown[]>([]);
  const [expenseBreakdown, setExpense]      = useState<ExpenseBreakdown[]>([]);
  const [trends, setTrends]                 = useState<Trend[]>([]);
  const [loading, setLoading]               = useState(true);
  const [showIncomeModal, setShowIncome]    = useState(false);
  const [showExpenseModal, setShowExpense]  = useState(false);
  const [incomeForm, setIncomeForm]         = useState({ date: new Date().toISOString().split('T')[0], source: 'other', amount: '', description: '' });
  const [expenseForm, setExpenseForm]       = useState({ date: new Date().toISOString().split('T')[0], category: 'MISC', amount: '', description: '' });

  const sourceLabels: Record<string, string> = {
    pharmacy: t('sourcePharmacy'), laboratory: t('sourceLaboratory'),
    doctor_visit: t('sourceDoctorVisit'), admission: t('sourceAdmission'),
    operation: t('sourceOperation'), ambulance: t('sourceAmbulance'), other: t('sourceOther'),
  };
  const categoryLabels: Record<string, string> = {
    SALARY: t('catSalary'), MEDICINE: t('catMedicine'), RENT: t('catRent'),
    ELECTRICITY: t('catElectricity'), WATER: t('catWater'), COMMUNICATION: t('catCommunication'),
    MAINTENANCE: t('catMaintenance'), SUPPLIES: t('catSupplies'), MARKETING: t('catMarketing'),
    BANK: t('catBank'), MISC: t('catMisc'),
  };

  const fetchData = useCallback(async () => {
    try {
      const token = localStorage.getItem('hms_token');
      const headers = { Authorization: `Bearer ${token}` };
      const [s, i, e, tr] = await Promise.all([
        axios.get(`${API_BASE}/summary`, { headers }),
        axios.get(`${API_BASE}/income-breakdown`, { headers }),
        axios.get(`${API_BASE}/expense-breakdown`, { headers }),
        axios.get(`${API_BASE}/trends`, { headers }),
      ]);
      setData(s.data);
      setIncome(i.data.breakdown || []);
      setExpense(e.data.breakdown || []);
      setTrends(tr.data.trends || []);
    } catch {/* silent */} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); const id = setInterval(fetchData, 30000); return () => clearInterval(id); }, [fetchData]);

  const handleAddIncome = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('hms_token');
      await axios.post('/api/income', incomeForm, { headers: { Authorization: `Bearer ${token}` } });
      setShowIncome(false);
      setIncomeForm({ date: new Date().toISOString().split('T')[0], source: 'other', amount: '', description: '' });
      fetchData();
    } catch { /* silent */ }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('hms_token');
      await axios.post('/api/expenses', expenseForm, { headers: { Authorization: `Bearer ${token}` } });
      setShowExpense(false);
      setExpenseForm({ date: new Date().toISOString().split('T')[0], category: 'MISC', amount: '', description: '' });
      fetchData();
    } catch { /* silent */ }
  };

  const maxBar = trends.length > 0 ? Math.max(...trends.map(t => Math.max(t.income, t.expense))) : 1;

  if (loading) {
    return (
      <DashboardLayout role={role}>
        <div className="space-y-5 max-w-screen-2xl mx-auto">
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-28 rounded-xl" />)}
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('dashboardTitle')}</h1>
            <p className="section-subtitle mt-1">
              {t('lastUpdated')}: {data?.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'N/A'}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowIncome(true)} className="btn-secondary">
              <Plus className="w-4 h-4" /> {t('addIncome')}
            </button>
            <button onClick={() => setShowExpense(true)} className="btn-danger">
              <Plus className="w-4 h-4" /> {t('addExpense')}
            </button>
          </div>
        </div>

        {/* ── Today KPIs ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-5 border-l-4 border-l-emerald-500">
            <p className="text-xs text-[var(--color-text-muted)] font-medium uppercase tracking-wider mb-1">{t('todaysIncome')}</p>
            <p className="text-3xl font-bold text-emerald-600">{fmt(data?.today.income || 0)}</p>
          </div>
          <div className="card p-5 border-l-4 border-l-red-500">
            <p className="text-xs text-[var(--color-text-muted)] font-medium uppercase tracking-wider mb-1">{t('todaysExpense')}</p>
            <p className="text-3xl font-bold text-red-600">{fmt(data?.today.expense || 0)}</p>
          </div>
          <div className="card p-5 border-l-4 border-l-[var(--color-primary)]">
            <p className="text-xs text-[var(--color-text-muted)] font-medium uppercase tracking-wider mb-1">{t('todaysProfit')}</p>
            <p className={`text-3xl font-bold ${(data?.today.profit || 0) >= 0 ? 'text-[var(--color-primary)]' : 'text-red-600'}`}>
              {fmt(data?.today.profit || 0)}
            </p>
          </div>
        </div>

        {/* ── MTD KPIs ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: t('mtdIncome'),  value: data?.mtd.income  || 0, color: 'text-emerald-600' },
            { label: t('mtdExpense'), value: data?.mtd.expense || 0, color: 'text-red-600'     },
            { label: t('mtdProfit'),  value: data?.mtd.profit  || 0, color: (data?.mtd.profit || 0) >= 0 ? 'text-[var(--color-primary)]' : 'text-red-600' },
          ].map(k => (
            <div key={k.label} className="card p-5">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">{k.label}</p>
              <p className={`text-2xl font-bold ${k.color}`}>{fmt(k.value)}</p>
            </div>
          ))}
        </div>

        {/* ── Breakdowns ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Income by source */}
          <div className="card p-5">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              {t('incomeBySource')}
            </h3>
            {incomeBreakdown.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('noIncomeData')}</p>
            ) : (
              <div className="space-y-3">
                {incomeBreakdown.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${SOURCE_DOT[item.source] ?? 'bg-slate-400'}`} />
                      <span className="text-sm text-[var(--color-text-secondary)]">{sourceLabels[item.source] || item.source}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">{fmt(item.amount)}</span>
                      <span className="text-xs text-[var(--color-text-muted)] ml-2">({item.percentage}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Expense by category */}
          <div className="card p-5">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-red-500" />
              {t('expenseByCategory')}
            </h3>
            {expenseBreakdown.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('noExpenseData')}</p>
            ) : (
              <div className="space-y-3">
                {expenseBreakdown.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${CAT_DOT[item.category] ?? 'bg-slate-400'}`} />
                      <span className="text-sm text-[var(--color-text-secondary)]">{categoryLabels[item.category] || item.category}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-medium">{fmt(item.amount)}</span>
                      <span className="text-xs text-[var(--color-text-muted)] ml-2">({item.percentage}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Trend Chart ── */}
        <div className="card p-5">
          <h3 className="section-title mb-5 flex items-center gap-2">
            <Activity className="w-4 h-4 text-[var(--color-primary)]" />
            {t('profitTrend')}
          </h3>
          {trends.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-10">{t('noTrendData')}</p>
          ) : (
            <div className="flex items-end gap-3 h-48">
              {trends.map((tr, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex gap-0.5 h-40 items-end">
                    <div
                      className="flex-1 bg-emerald-500 rounded-t-sm transition-all duration-500"
                      style={{ height: `${Math.max(4, (tr.income / maxBar) * 100)}%` }}
                      title={`Income: ${fmt(tr.income)}`}
                    />
                    <div
                      className="flex-1 bg-red-400 rounded-t-sm transition-all duration-500"
                      style={{ height: `${Math.max(4, (tr.expense / maxBar) * 100)}%` }}
                      title={`Expense: ${fmt(tr.expense)}`}
                    />
                  </div>
                  <span className="text-[11px] text-[var(--color-text-muted)]">{tr.month}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 mt-3 justify-end text-xs text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block"/>{t('income')}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block"/>{t('expenses')}</span>
          </div>
        </div>

        {/* ── Add Income Modal ── */}
        {showIncomeModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('addIncome')}</h3>
                <button onClick={() => setShowIncome(false)} className="btn-ghost p-1.5" aria-label="Close modal"><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleAddIncome} className="p-5 space-y-4">
                <div><label className="label">{t('common:date')}</label><input type="date" required className="input" value={incomeForm.date} onChange={e => setIncomeForm({...incomeForm, date: e.target.value})} /></div>
                <div><label className="label">{t('source')}</label>
                  <select className="input" value={incomeForm.source} onChange={e => setIncomeForm({...incomeForm, source: e.target.value})}>
                    {Object.entries(sourceLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div><label className="label">{t('amountBDT')}</label><input type="number" required className="input" value={incomeForm.amount} onChange={e => setIncomeForm({...incomeForm, amount: e.target.value})} /></div>
                <div><label className="label">{t('description')}</label><input type="text" className="input" value={incomeForm.description} onChange={e => setIncomeForm({...incomeForm, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowIncome(false)} className="btn-secondary">{t('common:cancel')}</button>
                  <button type="submit" className="btn-primary">{t('addIncome')}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Add Expense Modal ── */}
        {showExpenseModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('addExpense')}</h3>
                <button onClick={() => setShowExpense(false)} className="btn-ghost p-1.5" aria-label="Close modal"><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleAddExpense} className="p-5 space-y-4">
                <div><label className="label">{t('common:date')}</label><input type="date" required className="input" value={expenseForm.date} onChange={e => setExpenseForm({...expenseForm, date: e.target.value})} /></div>
                <div><label className="label">{t('category')}</label>
                  <select className="input" value={expenseForm.category} onChange={e => setExpenseForm({...expenseForm, category: e.target.value})}>
                    {Object.entries(categoryLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div><label className="label">{t('amountBDT')}</label><input type="number" required className="input" value={expenseForm.amount} onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})} /></div>
                <div><label className="label">{t('description')}</label><input type="text" className="input" value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowExpense(false)} className="btn-secondary">{t('common:cancel')}</button>
                  <button type="submit" className="btn-danger">{t('addExpense')}</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
