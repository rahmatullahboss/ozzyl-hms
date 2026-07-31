import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Income {
  id: number;
  date: string;
  source: string;
  amount: number;
  description: string;
  bill_id: number | null;
}

const SOURCE_LABELS: Record<string, string> = {
  pharmacy: 'Pharmacy', laboratory: 'Laboratory', doctor_visit: 'Doctor Visit',
  admission: 'Admission', operation: 'Operation', ambulance: 'Ambulance', other: 'Other',
};

const SOURCE_BADGE: Record<string, string> = {
  pharmacy: 'badge-info', laboratory: 'badge-success', doctor_visit: 'badge-primary',
  admission: 'badge-warning', operation: 'badge-danger',
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

export default function IncomeList({ role = 'md' }: { role?: string }) {
  const [incomes, setIncomes]           = useState<Income[]>([]);
  const [loading, setLoading]           = useState(true);
  const [filters, setFilters]           = useState({ startDate: '', endDate: '', source: '' });
  const [showModal, setShowModal]       = useState(false);
  const [editingIncome, setEditing]     = useState<Income | null>(null);
  const [formData, setFormData]         = useState({ date: '', source: 'other', amount: '', description: '' });
  const { t } = useTranslation(['accounting', 'common']);

  const fetchIncomes = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate)   params.append('endDate',   filters.endDate);
      if (filters.source)    params.append('source',    filters.source);
      const res = await axios.get(`/api/income?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      setIncomes(res.data.income || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchIncomes(); }, [filters]); // eslint-disable-line

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('hms_token');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      if (editingIncome) {
        await axios.put(`/api/income/${editingIncome.id}`, formData, { headers });
      } else {
        await axios.post('/api/income', formData, { headers });
      }
      setShowModal(false); setEditing(null);
      setFormData({ date: new Date().toISOString().split('T')[0], source: 'other', amount: '', description: '' });
      fetchIncomes();
    } catch { /* silent */ }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Delete this income record?')) return;
    const token = localStorage.getItem('hms_token');
    try { await axios.delete(`/api/income/${id}`, { headers: { Authorization: `Bearer ${token}` } }); fetchIncomes(); }
    catch { /* silent */ }
  };

  const openEdit = (income: Income) => {
    setEditing(income);
    setFormData({ date: income.date, source: income.source, amount: income.amount.toString(), description: income.description || '' });
    setShowModal(true);
  };

  const totalAmount = incomes.reduce((s, i) => s + i.amount, 0);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <h1 className="page-title">Income Management</h1>
          <button onClick={() => { setEditing(null); setFormData({ date: new Date().toISOString().split('T')[0], source: 'other', amount: '', description: '' }); setShowModal(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> Add Income
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="card p-4 flex flex-wrap gap-3">
          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} className="input w-40 text-sm" />
          <input type="date" value={filters.endDate}   onChange={e => setFilters({...filters, endDate:   e.target.value})} className="input w-40 text-sm" />
          <select value={filters.source} onChange={e => setFilters({...filters, source: e.target.value})} className="input w-44 text-sm">
            <option value="">All Sources</option>
            {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button onClick={fetchIncomes} className="btn-secondary text-sm">Filter</button>
        </div>

        {/* ── Table ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Date</th><th>Source</th><th>Amount</th><th>Description</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                  ))
                ) : incomes.length === 0 ? (
                  <tr><td colSpan={5} className="py-14 text-center text-[var(--color-text-muted)]">No income records found</td></tr>
                ) : (
                  incomes.map(income => (
                    <tr key={income.id}>
                      <td className="font-data text-sm">{new Date(income.date).toLocaleDateString('en-GB')}</td>
                      <td>
                        <span className={`badge ${SOURCE_BADGE[income.source] ?? 'badge-secondary'}`}>
                          {SOURCE_LABELS[income.source] || income.source}
                        </span>
                        {income.bill_id && <span className="ml-2 text-xs text-[var(--color-text-muted)]">Auto</span>}
                      </td>
                      <td className="font-data font-medium text-emerald-600">{fmt(income.amount)}</td>
                      <td className="text-[var(--color-text-secondary)] text-sm">{income.description || '—'}</td>
                      <td>
                        <div className="flex gap-1.5">
                          <button onClick={() => openEdit(income)} className="btn-ghost p-1.5 text-xs">Edit</button>
                          <button onClick={() => handleDelete(income.id)} className="btn-ghost p-1.5 text-xs text-red-500">Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {!loading && incomes.length > 0 && (
                <tfoot className="bg-[var(--color-surface)] border-t border-[var(--color-border)]">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-medium text-sm">Total</td>
                    <td className="px-4 py-3 font-bold text-emerald-600">{fmt(totalAmount)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* ── Modal ── */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{editingIncome ? 'Edit Income' : 'Add Income'}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label="Close modal"><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label">{t('accounting.date')}</label><input type="date" required className="input" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} /></div>
                <div><label className="label">{t('accounting.source')}</label>
                  <select className="input" value={formData.source} onChange={e => setFormData({...formData, source: e.target.value})}>
                    {Object.entries(SOURCE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div><label className="label">{t('accounting.amountBdt')}</label><input type="number" required className="input" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} /></div>
                <div><label className="label">{t('accounting.description')}</label><input type="text" className="input" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
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
