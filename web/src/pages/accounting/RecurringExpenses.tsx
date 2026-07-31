import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDisplayDate } from '../../lib/date-utils';

interface RecurringExpense {
  id: number;
  category_name: string;
  category_code: string;
  amount: number;
  description: string | null;
  frequency: 'daily' | 'weekly' | 'monthly';
  next_run_date: string;
  end_date: string | null;
  is_active: number;
}

interface RecurringResponse {
  recurringExpenses: RecurringExpense[];
}

const FREQ_BADGE: Record<string, string> = { daily: 'badge-warning', weekly: 'badge-info', monthly: 'badge-primary' };

const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

const CAT_LABELS: Record<string, string> = {
  SALARY: 'Staff Salary', MEDICINE: 'Medicine Purchase', RENT: 'Rent',
  ELECTRICITY: 'Electricity', WATER: 'Water Supply', COMMUNICATION: 'Internet & Phone',
  MAINTENANCE: 'Maintenance', SUPPLIES: 'Medical Supplies', MARKETING: 'Marketing',
  BANK: 'Bank Charges', MISC: 'Miscellaneous',
};

export default function RecurringExpenses({ role = 'md' }: { role?: string }) {
  const [showModal, setModal]   = useState(false);
  const [formData, setFormData] = useState({
    category_id: '', amount: '', description: '', frequency: 'monthly',
    next_run_date: new Date().toISOString().split('T')[0], end_date: '',
  });
  const { t } = useTranslation(['tenantBilling']);
  const queryClient = useQueryClient();

  const { data, isLoading: loading } = useApiQuery<RecurringResponse>(
    queryKeys.accounting.recurring(),
    '/api/recurring',
  );

  const expenses = data?.recurringExpenses ?? [];

  const createMutation = useApiMutation<unknown, typeof formData>(
    'post',
    '/api/recurring',
    {
      onSuccess: () => {
        setModal(false);
        setFormData({ category_id: '', amount: '', description: '', frequency: 'monthly', next_run_date: new Date().toISOString().split('T')[0], end_date: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
    },
  );

  const deactivateMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/recurring/${id}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
    },
  );

  const reactivateMutation = useApiMutation<unknown, { id: number; is_active: number }>(
    'put',
    (vars) => `/api/recurring/${vars.id}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
    },
  );

  const runNowMutation = useApiMutation<unknown, { id: number }>(
    'post',
    (vars) => `/api/recurring/${vars.id}/run`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const handleToggle = (id: number, is_active: number) => {
    if (is_active === 1) {
      deactivateMutation.mutate(id);
    } else {
      reactivateMutation.mutate({ id, is_active: 1 });
    }
  };

  const handleRun = (id: number) => {
    runNowMutation.mutate({ id });
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <h1 className="page-title">{t('recurringExpenses.title')}</h1>
          <button onClick={() => setModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('recurringExpenses.addRecurring')}
          </button>
        </div>

        {/* ── Table ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('recurringExpenses.category')}</th><th>{t('recurringExpenses.amount')}</th><th>{t('recurringExpenses.frequency')}</th><th>{t('recurringExpenses.nextRun')}</th><th>{t('recurringExpenses.status')}</th><th>{t('recurringExpenses.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : expenses.length === 0 ? (
                  <tr><td colSpan={6} className="py-14 text-center text-[var(--color-text-muted)]">{t('recurringExpenses.noRecurring')}</td></tr>
                ) : (
                  expenses.map(expense => (
                    <tr key={expense.id}>
                      <td className="font-medium">{CAT_LABELS[expense.category_code] || expense.category_name}</td>
                      <td className="font-data text-red-600">{fmt(expense.amount)}</td>
                      <td><span className={`badge ${FREQ_BADGE[expense.frequency]}`}>{expense.frequency}</span></td>
                      <td className="font-data text-sm">{formatDisplayDate(expense.next_run_date)}</td>
                      <td>
                        <button
                          onClick={() => handleToggle(expense.id, expense.is_active)}
                          className={`badge cursor-pointer ${expense.is_active ? 'badge-success' : 'badge-secondary'}`}
                        >
                          {expense.is_active ? t('recurringExpenses.active') : t('recurringExpenses.inactive')}
                        </button>
                      </td>
                      <td>
                        <button onClick={() => handleRun(expense.id)} className="btn-ghost p-1.5 text-xs text-[var(--color-primary)]">{t('recurringExpenses.runNow')}</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Modal ── */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('recurringExpenses.addRecurringTitle')}</h3>
                <button onClick={() => setModal(false)} className="btn-ghost p-1.5" aria-label={t('recurringExpenses.closeAria')}><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label">{t('recurringExpenses.category')}</label>
                  <select required className="input" value={formData.category_id} onChange={e => setFormData({...formData, category_id: e.target.value})}>
                    <option value="">{t('recurringExpenses.selectCategory')}</option>
                    <option value="1">{t('recurringExpenses.staffSalary')}</option>
                    <option value="2">{t('recurringExpenses.medicinePurchase')}</option>
                    <option value="3">{t('recurringExpenses.rent')}</option>
                    <option value="4">{t('recurringExpenses.electricity')}</option>
                    <option value="5">{t('recurringExpenses.water')}</option>
                    <option value="6">{t('recurringExpenses.internet')}</option>
                    <option value="10">{t('recurringExpenses.misc')}</option>
                  </select>
                </div>
                <div><label className="label">{t('recurringExpenses.amountBdt')}</label><input type="number" required className="input" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} /></div>
                <div><label className="label">{t('recurringExpenses.frequency')}</label>
                  <select className="input" value={formData.frequency} onChange={e => setFormData({...formData, frequency: e.target.value})}>
                    <option value="daily">{t('recurringExpenses.daily')}</option>
                    <option value="weekly">{t('recurringExpenses.weekly')}</option>
                    <option value="monthly">{t('recurringExpenses.monthly')}</option>
                  </select>
                </div>
                <div><label className="label">{t('recurringExpenses.startDate')}</label><input type="date" required className="input" value={formData.next_run_date} onChange={e => setFormData({...formData, next_run_date: e.target.value})} /></div>
                <div><label className="label">{t('recurringExpenses.endDateOptional')}</label><input type="date" className="input" value={formData.end_date} onChange={e => setFormData({...formData, end_date: e.target.value})} /></div>
                <div><label className="label">{t('recurringExpenses.description')}</label><input type="text" className="input" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setModal(false)} className="btn-secondary">{t('recurringExpenses.cancel')}</button>
                  <button type="submit" className="btn-primary">{t('recurringExpenses.save')}</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
