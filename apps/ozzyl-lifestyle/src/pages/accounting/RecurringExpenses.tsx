import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

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
  const [expenses, setExpenses] = useState<RecurringExpense[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showModal, setModal]   = useState(false);
  const [formData, setFormData] = useState({
    category_id: '', amount: '', description: '', frequency: 'monthly',
    next_run_date: new Date().toISOString().split('T')[0], end_date: '',
  });
  const { t } = useTranslation(['accounting', 'common']);

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const res = await axios.get('/api/recurring', { headers: { Authorization: `Bearer ${token}` } });
      setExpenses(res.data.recurringExpenses || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchExpenses(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('hms_token');
    try {
      await axios.post('/api/recurring', formData, { headers: { Authorization: `Bearer ${token}` } });
      setModal(false);
      setFormData({ category_id: '', amount: '', description: '', frequency: 'monthly', next_run_date: new Date().toISOString().split('T')[0], end_date: '' });
      fetchExpenses();
    } catch { /* silent */ }
  };

  const handleToggle = async (id: number, is_active: number) => {
    const token = localStorage.getItem('hms_token');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      if (is_active === 1) await axios.delete(`/api/recurring/${id}`, { headers });
      else await axios.put(`/api/recurring/${id}`, { is_active: 1 }, { headers });
      fetchExpenses();
    } catch { /* silent */ }
  };

  const handleRun = async (id: number) => {
    const token = localStorage.getItem('hms_token');
    try {
      await axios.post(`/api/recurring/${id}/run`, {}, { headers: { Authorization: `Bearer ${token}` } });
      fetchExpenses();
    } catch { /* silent */ }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <h1 className="page-title">Recurring Expenses</h1>
          <button onClick={() => setModal(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Recurring
          </button>
        </div>

        {/* ── Table ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Category</th><th>Amount</th><th>Frequency</th><th>Next Run</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => <tr key={i}>{[...Array(6)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : expenses.length === 0 ? (
                  <tr><td colSpan={6} className="py-14 text-center text-[var(--color-text-muted)]">No recurring expenses</td></tr>
                ) : (
                  expenses.map(expense => (
                    <tr key={expense.id}>
                      <td className="font-medium">{CAT_LABELS[expense.category_code] || expense.category_name}</td>
                      <td className="font-data text-red-600">{fmt(expense.amount)}</td>
                      <td><span className={`badge ${FREQ_BADGE[expense.frequency]}`}>{expense.frequency}</span></td>
                      <td className="font-data text-sm">{new Date(expense.next_run_date).toLocaleDateString('en-GB')}</td>
                      <td>
                        <button
                          onClick={() => handleToggle(expense.id, expense.is_active)}
                          className={`badge cursor-pointer ${expense.is_active ? 'badge-success' : 'badge-secondary'}`}
                        >
                          {expense.is_active ? 'Active' : 'Inactive'}
                        </button>
                      </td>
                      <td>
                        <button onClick={() => handleRun(expense.id)} className="btn-ghost p-1.5 text-xs text-[var(--color-primary)]">Run Now</button>
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
                <h3 className="font-semibold">Add Recurring Expense</h3>
                <button onClick={() => setModal(false)} className="btn-ghost p-1.5" aria-label="Close modal"><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label">{t('accounting.category')}</label>
                  <select required className="input" value={formData.category_id} onChange={e => setFormData({...formData, category_id: e.target.value})}>
                    <option value="">Select Category</option>
                    <option value="1">Staff Salary</option>
                    <option value="2">Medicine Purchase</option>
                    <option value="3">Rent</option>
                    <option value="4">Electricity</option>
                    <option value="5">Water Supply</option>
                    <option value="6">Internet &amp; Phone</option>
                    <option value="10">Miscellaneous</option>
                  </select>
                </div>
                <div><label className="label">{t('accounting.amountBdt')}</label><input type="number" required className="input" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} /></div>
                <div><label className="label">{t('accounting.frequency')}</label>
                  <select className="input" value={formData.frequency} onChange={e => setFormData({...formData, frequency: e.target.value})}>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                  </select>
                </div>
                <div><label className="label">{t('accounting.startDate')}</label><input type="date" required className="input" value={formData.next_run_date} onChange={e => setFormData({...formData, next_run_date: e.target.value})} /></div>
                <div><label className="label">{t('accounting.endDateOptional')}</label><input type="date" className="input" value={formData.end_date} onChange={e => setFormData({...formData, end_date: e.target.value})} /></div>
                <div><label className="label">{t('accounting.description')}</label><input type="text" className="input" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setModal(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" className="btn-primary">Save</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
