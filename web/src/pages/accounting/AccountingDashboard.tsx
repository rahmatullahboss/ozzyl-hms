import { useState } from 'react';
import { Plus, TrendingUp, TrendingDown, Activity, X, Wallet, HandCoins, ReceiptText, BadgeDollarSign, AlertCircle } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface DashboardData {
  today: { income: number; expense: number; profit: number };
  mtd: { income: number; expense: number; profit: number };
  operations?: {
    todayCollection: number;
    pendingHandoverAmount: number;
    pendingHandoverCount: number;
    patientDue: number;
    patientAdvance: number;
    todayRefunds: number;
    todayDiscounts: number;
    doctorPayable: number;
    supplierPayable: number;
    pendingPostingEvents: number;
  };
  lastUpdated: string;
}

interface IncomeBreakdown  { source: string;   amount: number; percentage: string }
interface ExpenseBreakdown { category: string; amount: number; percentage: string }
interface Trend            { month: string; income: number; expense: number; profit: number }

interface IncomeBreakdownResponse  { breakdown: IncomeBreakdown[] }
interface ExpenseBreakdownResponse { breakdown: ExpenseBreakdown[] }
interface TrendsResponse           { trends: Trend[] }

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
  const { t } = useTranslation(['tenantDashboard']);
  const queryClient = useQueryClient();

  const [showIncomeModal, setShowIncome]    = useState(false);
  const [showExpenseModal, setShowExpense]  = useState(false);
  const [incomeForm, setIncomeForm]         = useState({ date: new Date().toISOString().split('T')[0], source: 'other', amount: '', description: '' });
  const [expenseForm, setExpenseForm]       = useState({ date: new Date().toISOString().split('T')[0], category: 'MISC', amount: '', description: '' });

  /* ── Queries ─────────────────────────────────────────────── */

  const { data, isLoading: loadingSummary } = useApiQuery<DashboardData>(
    [...queryKeys.accounting.dashboard(), 'summary'],
    `${API_BASE}/summary`,
    { refetchInterval: 30_000 },
  );

  const { data: incomeRes, isLoading: loadingIncome } = useApiQuery<IncomeBreakdownResponse>(
    [...queryKeys.accounting.dashboard(), 'income-breakdown'],
    `${API_BASE}/income-breakdown`,
    { refetchInterval: 30_000 },
  );

  const { data: expenseRes, isLoading: loadingExpense } = useApiQuery<ExpenseBreakdownResponse>(
    [...queryKeys.accounting.dashboard(), 'expense-breakdown'],
    `${API_BASE}/expense-breakdown`,
    { refetchInterval: 30_000 },
  );

  const { data: trendsRes, isLoading: loadingTrends } = useApiQuery<TrendsResponse>(
    [...queryKeys.accounting.dashboard(), 'trends'],
    `${API_BASE}/trends`,
    { refetchInterval: 30_000 },
  );

  const incomeBreakdown  = incomeRes?.breakdown  || [];
  const expenseBreakdown = expenseRes?.breakdown || [];
  const trends           = trendsRes?.trends     || [];

  const loading = loadingSummary || loadingIncome || loadingExpense || loadingTrends;

  /* ── Mutations ───────────────────────────────────────────── */

  const addIncomeMutation = useApiMutation<unknown, typeof incomeForm>(
    'post',
    '/api/income',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
        setShowIncome(false);
        setIncomeForm({ date: new Date().toISOString().split('T')[0], source: 'other', amount: '', description: '' });
      },
    },
  );

  const addExpenseMutation = useApiMutation<unknown, typeof expenseForm>(
    'post',
    '/api/expenses',
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
        setShowExpense(false);
        setExpenseForm({ date: new Date().toISOString().split('T')[0], category: 'MISC', amount: '', description: '' });
      },
    },
  );

  /* ── Handlers ────────────────────────────────────────────── */

  const handleAddIncome = (e: React.FormEvent) => {
    e.preventDefault();
    addIncomeMutation.mutate(incomeForm);
  };

  const handleAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    addExpenseMutation.mutate(expenseForm);
  };

  /* ── Labels ──────────────────────────────────────────────── */

  const sourceLabels: Record<string, string> = {
    pharmacy: t('accounting.sourcePharmacy'), laboratory: t('accounting.sourceLaboratory'),
    doctor_visit: t('accounting.sourceDoctorVisit'), admission: t('accounting.sourceAdmission'),
    operation: t('accounting.sourceOperation'), ambulance: t('accounting.sourceAmbulance'), other: t('accounting.sourceOther'),
  };
  const categoryLabels: Record<string, string> = {
    SALARY: t('accounting.catSalary'), MEDICINE: t('accounting.catMedicine'), RENT: t('accounting.catRent'),
    ELECTRICITY: t('accounting.catElectricity'), WATER: t('accounting.catWater'), COMMUNICATION: t('accounting.catCommunication'),
    MAINTENANCE: t('accounting.catMaintenance'), SUPPLIES: t('accounting.catSupplies'), MARKETING: t('accounting.catMarketing'),
    BANK: t('accounting.catBank'), MISC: t('accounting.catMisc'),
  };

  const maxBar = trends.length > 0 ? Math.max(...trends.map(t => Math.max(t.income, t.expense))) : 1;
  const operations = data?.operations ?? {
    todayCollection: 0,
    pendingHandoverAmount: 0,
    pendingHandoverCount: 0,
    patientDue: 0,
    patientAdvance: 0,
    todayRefunds: 0,
    todayDiscounts: 0,
    doctorPayable: 0,
    supplierPayable: 0,
    pendingPostingEvents: 0,
  };
  const operationalCards = [
    { label: t('accounting.todayCollection'), value: fmt(operations.todayCollection), icon: <Wallet className="w-4 h-4" />, tone: 'text-emerald-600', sub: t('accounting.cashBankMobile') },
    { label: t('accounting.pendingHandovers'), value: fmt(operations.pendingHandoverAmount), icon: <HandCoins className="w-4 h-4" />, tone: 'text-amber-600', sub: `${operations.pendingHandoverCount} ${t('accounting.pending')}` },
    { label: t('accounting.patientDue'), value: fmt(operations.patientDue), icon: <ReceiptText className="w-4 h-4" />, tone: 'text-red-600', sub: t('accounting.receivable') },
    { label: t('accounting.patientAdvance'), value: fmt(operations.patientAdvance), icon: <Wallet className="w-4 h-4" />, tone: 'text-blue-600', sub: t('accounting.advanceLiability') },
    { label: t('accounting.todayRefunds'), value: fmt(operations.todayRefunds), icon: <TrendingDown className="w-4 h-4" />, tone: 'text-red-600', sub: t('accounting.approvedRefunds') },
    { label: t('accounting.todayDiscounts'), value: fmt(operations.todayDiscounts), icon: <BadgeDollarSign className="w-4 h-4" />, tone: 'text-purple-600', sub: t('accounting.approvedDiscounts') },
    { label: t('accounting.doctorPayable'), value: fmt(operations.doctorPayable), icon: <HandCoins className="w-4 h-4" />, tone: 'text-indigo-600', sub: t('accounting.doctorLedger') },
    { label: t('accounting.supplierPayable'), value: fmt(operations.supplierPayable), icon: <ReceiptText className="w-4 h-4" />, tone: 'text-slate-700', sub: t('accounting.supplierLedger') },
    { label: t('accounting.pendingPostingEvents'), value: String(operations.pendingPostingEvents), icon: <AlertCircle className="w-4 h-4" />, tone: operations.pendingPostingEvents > 0 ? 'text-amber-600' : 'text-emerald-600', sub: t('accounting.postingQueue') },
  ];

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
            <h1 className="page-title">{t('accounting.dashboardTitle')}</h1>
            <p className="section-subtitle mt-1">
              {t('accounting.lastUpdated')}: {data?.lastUpdated ? new Date(data.lastUpdated).toLocaleString() : 'N/A'}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowIncome(true)} className="btn-secondary">
              <Plus className="w-4 h-4" /> {t('accounting.addIncome')}
            </button>
            <button onClick={() => setShowExpense(true)} className="btn-danger">
              <Plus className="w-4 h-4" /> {t('accounting.addExpense')}
            </button>
          </div>
        </div>

        {/* ── Today KPIs ── */}
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          {t('accounting.accrualRevenueExplanation')}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="card p-5 border-l-4 border-l-emerald-500">
            <p className="text-xs text-[var(--color-text-muted)] font-medium uppercase tracking-wider mb-1">{t('accounting.todaysAccrualRevenue')}</p>
            <p className="text-3xl font-bold text-emerald-600">{fmt(data?.today.income || 0)}</p>
          </div>
          <div className="card p-5 border-l-4 border-l-red-500">
            <p className="text-xs text-[var(--color-text-muted)] font-medium uppercase tracking-wider mb-1">{t('accounting.todaysPostedExpense')}</p>
            <p className="text-3xl font-bold text-red-600">{fmt(data?.today.expense || 0)}</p>
          </div>
          <div className="card p-5 border-l-4 border-l-[var(--color-primary)]">
            <p className="text-xs text-[var(--color-text-muted)] font-medium uppercase tracking-wider mb-1">{t('accounting.todaysAccrualProfit')}</p>
            <p className={`text-3xl font-bold ${(data?.today.profit || 0) >= 0 ? 'text-[var(--color-primary)]' : 'text-red-600'}`}>
              {fmt(data?.today.profit || 0)}
            </p>
          </div>
        </div>

        {/* ── MTD KPIs ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { label: t('accounting.mtdAccrualRevenue'), value: data?.mtd.income  || 0, color: 'text-emerald-600' },
            { label: t('accounting.mtdPostedExpense'), value: data?.mtd.expense || 0, color: 'text-red-600'     },
            { label: t('accounting.mtdAccrualProfit'), value: data?.mtd.profit  || 0, color: (data?.mtd.profit || 0) >= 0 ? 'text-[var(--color-primary)]' : 'text-red-600' },
          ].map(k => (
            <div key={k.label} className="card p-5">
              <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">{k.label}</p>
              <p className={`text-2xl font-bold ${k.color}`}>{fmt(k.value)}</p>
            </div>
          ))}
        </div>

        {/* ── Operational finance snapshot ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {operationalCards.map(card => (
            <div key={card.label} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-[var(--color-text-muted)] uppercase tracking-wider mb-1">{card.label}</p>
                  <p className={`text-xl font-bold ${card.tone}`}>{card.value}</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">{card.sub}</p>
                </div>
                <div className={`p-2 rounded-lg bg-[var(--color-border-light)] ${card.tone}`}>{card.icon}</div>
              </div>
            </div>
          ))}
        </div>

        {/* ── Breakdowns ── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {/* Income by source */}
          <div className="card p-5">
            <h3 className="section-title mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              {t('accounting.incomeBySource')}
            </h3>
            {incomeBreakdown.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('accounting.noIncomeData')}</p>
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
              {t('accounting.expenseByCategory')}
            </h3>
            {expenseBreakdown.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)] text-center py-6">{t('accounting.noExpenseData')}</p>
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
            {t('accounting.profitTrend')}
          </h3>
          {trends.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)] text-center py-10">{t('accounting.noTrendData')}</p>
          ) : (
            <div className="flex items-end gap-3 h-48">
              {trends.map((tr, idx) => (
                <div key={idx} className="flex-1 flex flex-col items-center gap-1">
                  <div className="w-full flex gap-0.5 h-40 items-end">
                    <div
                      className="flex-1 bg-emerald-500 rounded-t-sm transition-all duration-500"
                      style={{ height: `${Math.max(4, (tr.income / maxBar) * 100)}%` }}
                      title={`${t('accounting.income')}: ${fmt(tr.income)}`}
                    />
                    <div
                      className="flex-1 bg-red-400 rounded-t-sm transition-all duration-500"
                      style={{ height: `${Math.max(4, (tr.expense / maxBar) * 100)}%` }}
                      title={`${t('accounting.expenses')}: ${fmt(tr.expense)}`}
                    />
                  </div>
                  <span className="text-[11px] text-[var(--color-text-muted)]">{tr.month}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-4 mt-3 justify-end text-xs text-[var(--color-text-muted)]">
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block"/>{t('accounting.income')}</span>
            <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block"/>{t('accounting.expenses')}</span>
          </div>
        </div>

        {/* ── Add Income Modal ── */}
        {showIncomeModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('accounting.addIncome')}</h3>
                <button onClick={() => setShowIncome(false)} className="btn-ghost p-1.5" aria-label={t('accounting.closeAria')}><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleAddIncome} className="p-5 space-y-4">
                <div><label className="label">{t('accounting.date')}</label><input type="date" required className="input" value={incomeForm.date} onChange={e => setIncomeForm({...incomeForm, date: e.target.value})} /></div>
                <div><label className="label">{t('accounting.source')}</label>
                  <select className="input" value={incomeForm.source} onChange={e => setIncomeForm({...incomeForm, source: e.target.value})}>
                    {Object.entries(sourceLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div><label className="label">{t('accounting.amountBDT')}</label><input type="number" required className="input" value={incomeForm.amount} onChange={e => setIncomeForm({...incomeForm, amount: e.target.value})} /></div>
                <div><label className="label">{t('accounting.description')}</label><input type="text" className="input" value={incomeForm.description} onChange={e => setIncomeForm({...incomeForm, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowIncome(false)} className="btn-secondary">{t('accounting.cancel')}</button>
                  <button type="submit" className="btn-primary" disabled={addIncomeMutation.isPending}>{t('accounting.addIncome')}</button>
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
                <h3 className="font-semibold">{t('accounting.addExpense')}</h3>
                <button onClick={() => setShowExpense(false)} className="btn-ghost p-1.5" aria-label={t('accounting.closeAria')}><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleAddExpense} className="p-5 space-y-4">
                <div><label className="label">{t('accounting.date')}</label><input type="date" required className="input" value={expenseForm.date} onChange={e => setExpenseForm({...expenseForm, date: e.target.value})} /></div>
                <div><label className="label">{t('accounting.category')}</label>
                  <select className="input" value={expenseForm.category} onChange={e => setExpenseForm({...expenseForm, category: e.target.value})}>
                    {Object.entries(categoryLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div><label className="label">{t('accounting.amountBDT')}</label><input type="number" required className="input" value={expenseForm.amount} onChange={e => setExpenseForm({...expenseForm, amount: e.target.value})} /></div>
                <div><label className="label">{t('accounting.description')}</label><input type="text" className="input" value={expenseForm.description} onChange={e => setExpenseForm({...expenseForm, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowExpense(false)} className="btn-secondary">{t('accounting.cancel')}</button>
                  <button type="submit" className="btn-danger" disabled={addExpenseMutation.isPending}>{t('accounting.addExpense')}</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
