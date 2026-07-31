import { useState, useEffect } from 'react';
import { Plus, X } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Expense {
  id: number;
  date: string;
  category: string;
  amount: number;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  created_by: number | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  created_at: string | null;
  approved_at: string | null;
}

const CAT_LABELS: Record<string, string> = {
  SALARY: 'Staff Salary', MEDICINE: 'Medicine Purchase', RENT: 'Rent',
  ELECTRICITY: 'Electricity', WATER: 'Water Supply', COMMUNICATION: 'Internet & Phone',
  MAINTENANCE: 'Maintenance', SUPPLIES: 'Medical Supplies', MARKETING: 'Marketing',
  BANK: 'Bank Charges', MISC: 'Miscellaneous',
};

const CAT_PILL: Record<string, { short: string; cls: string }> = {
  SALARY:         { short: 'Salary',     cls: 'bg-blue-100 text-blue-700' },
  MEDICINE:       { short: 'Medicine',   cls: 'bg-teal-100 text-teal-700' },
  RENT:           { short: 'Rent',       cls: 'bg-amber-100 text-amber-700' },
  ELECTRICITY:    { short: 'Electric',   cls: 'bg-yellow-100 text-yellow-700' },
  WATER:          { short: 'Water',      cls: 'bg-sky-100 text-sky-700' },
  COMMUNICATION:  { short: 'Telecom',    cls: 'bg-indigo-100 text-indigo-700' },
  MAINTENANCE:    { short: 'Maint.',     cls: 'bg-orange-100 text-orange-700' },
  MARKETING:      { short: 'Marketing',  cls: 'bg-pink-100 text-pink-700' },
  SUPPLIES:       { short: 'Supplies',   cls: 'bg-emerald-100 text-emerald-700' },
  BANK:           { short: 'Bank',       cls: 'bg-slate-200 text-slate-700' },
};
const CAT_PILL_DEFAULT = { short: 'Misc', cls: 'bg-purple-100 text-purple-700' };

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const diffMs = Date.now() - d.getTime();
  const m = Math.floor(diffMs / 60_000);
  if (m < 1)   return 'just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 7)   return `${days}d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

const STATUS_BADGE: Record<string, string> = {
  pending:  'badge-warning',
  approved: 'badge-success',
  rejected: 'badge-danger',
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

export default function ExpenseList({ role = 'md' }: { role?: string }) {
  const [expenses, setExpenses]         = useState<Expense[]>([]);
  const [loading, setLoading]           = useState(true);
  const [filters, setFilters]           = useState({ startDate: '', endDate: '', category: '', status: '' });
  const [showModal, setShowModal]       = useState(false);
  const [editingExpense, setEditing]    = useState<Expense | null>(null);
  const [formData, setFormData]         = useState({ date: new Date().toISOString().split('T')[0], category: 'MISC', amount: '', description: '' });
  const isDirector = role === 'director';
  const isAdmin       = role === 'hospital_admin';
  const isMd          = role === 'md';
  const isAccountant  = role === 'accountant';
  const showCreatedBy  = isAdmin || isMd || isDirector || isAccountant;
  const showApprovedBy = isAdmin || isMd || isDirector;
  const auditColSpan   = (showCreatedBy ? 1 : 0) + (showApprovedBy ? 1 : 0);
  const { t } = useTranslation(['accounting', 'common']);

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const params = new URLSearchParams();
      if (filters.startDate) params.append('startDate', filters.startDate);
      if (filters.endDate)   params.append('endDate',   filters.endDate);
      if (filters.category)  params.append('category',  filters.category);
      if (filters.status)    params.append('status',    filters.status);
      const res = await axios.get(`/api/expenses?${params}`, { headers: { Authorization: `Bearer ${token}` } });
      setExpenses(res.data.expenses || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchExpenses(); }, [filters]); // eslint-disable-line

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('hms_token');
    const headers = { Authorization: `Bearer ${token}` };
    try {
      if (editingExpense) {
        await axios.put(`/api/expenses/${editingExpense.id}`, formData, { headers });
      } else {
        await axios.post('/api/expenses', formData, { headers });
      }
      setShowModal(false); setEditing(null);
      setFormData({ date: new Date().toISOString().split('T')[0], category: 'MISC', amount: '', description: '' });
      fetchExpenses();
    } catch { /* silent */ }
  };

  const handleApprove = async (id: number) => {
    const token = localStorage.getItem('hms_token');
    try { await axios.post(`/api/expenses/${id}/approve`, {}, { headers: { Authorization: `Bearer ${token}` } }); fetchExpenses(); }
    catch { /* silent */ }
  };

  const handleReject = async (id: number) => {
    const token = localStorage.getItem('hms_token');
    try { await axios.post(`/api/expenses/${id}/reject`, {}, { headers: { Authorization: `Bearer ${token}` } }); fetchExpenses(); }
    catch { /* silent */ }
  };

  const openEdit = (expense: Expense) => {
    setEditing(expense);
    setFormData({ date: expense.date, category: expense.category, amount: expense.amount.toString(), description: expense.description || '' });
    setShowModal(true);
  };

  const totalApproved = expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <h1 className="page-title">Expense Management</h1>
          <button onClick={() => setShowModal(true)} className="btn-danger">
            <Plus className="w-4 h-4" /> Add Expense
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="card p-4 flex flex-wrap gap-3">
          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} className="input w-40 text-sm" />
          <input type="date" value={filters.endDate}   onChange={e => setFilters({...filters, endDate:   e.target.value})} className="input w-40 text-sm" />
          <select value={filters.category} onChange={e => setFilters({...filters, category: e.target.value})} className="input w-44 text-sm">
            <option value="">All Categories</option>
            {Object.entries(CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} className="input w-36 text-sm">
            <option value="">All Status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <button onClick={fetchExpenses} className="btn-secondary text-sm">Filter</button>
        </div>

        {/* ── Table ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>Date</th><th>Category</th><th>Amount</th><th>Status</th>
                  {showCreatedBy  && <th>Created By</th>}
                  {showApprovedBy && <th>Approved By</th>}
                  <th>Description</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => <tr key={i}>{[...Array(6 + auditColSpan)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : expenses.length === 0 ? (
                  <tr><td colSpan={6 + auditColSpan} className="py-14 text-center text-[var(--color-text-muted)]">No expense records found</td></tr>
                ) : (
                  expenses.map(expense => (
                    <tr key={expense.id}>
                      <td className="font-data text-sm">{new Date(expense.date).toLocaleDateString('en-GB')}</td>
                      <td>
                        {(() => {
                          const pill = CAT_PILL[expense.category] ?? CAT_PILL_DEFAULT;
                          return (
                            <span
                              title={CAT_LABELS[expense.category] || expense.category}
                              className={`inline-block max-w-[6.5rem] truncate rounded-full px-2 py-0.5 text-xs font-medium ${pill.cls}`}
                            >
                              {pill.short}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="font-data font-medium text-red-600">{fmt(expense.amount)}</td>
                      <td><span className={`badge ${STATUS_BADGE[expense.status] ?? 'badge-secondary'}`}>{expense.status.charAt(0).toUpperCase() + expense.status.slice(1)}</span></td>
                      {showCreatedBy && (
                        <td className="text-sm">
                          {expense.created_by_name ? (
                            <>
                              <div className="font-medium">{expense.created_by_name}</div>
                              <div className="text-xs text-[var(--color-text-muted)]" title={expense.created_at ?? ''}>{relativeTime(expense.created_at)}</div>
                            </>
                          ) : (
                            <span className="text-[var(--color-text-muted)]" title={expense.created_by ? `User #${expense.created_by}` : ''}>Unknown</span>
                          )}
                        </td>
                      )}
                      {showApprovedBy && (
                        <td className="text-sm">
                          {expense.approved_by_name ? (
                            <span className={expense.status === 'rejected' ? 'text-red-600' : ''}>
                              <span className="font-medium block">{expense.approved_by_name}</span>
                              <span className="block text-xs">{relativeTime(expense.approved_at)}</span>
                            </span>
                          ) : (
                            <span className="text-[var(--color-text-muted)]">—</span>
                          )}
                        </td>
                      )}
                      <td className="text-sm text-[var(--color-text-secondary)]">{expense.description || '—'}</td>
                      <td>
                        <div className="flex gap-1.5">
                          {expense.status !== 'pending' && (
                            <button onClick={() => openEdit(expense)} className="btn-ghost p-1.5 text-xs">Edit</button>
                          )}
                          {expense.status === 'pending' && isDirector && (
                            <>
                              <button onClick={() => handleApprove(expense.id)} className="btn-ghost p-1.5 text-xs text-emerald-600">Approve</button>
                              <button onClick={() => handleReject(expense.id)} className="btn-ghost p-1.5 text-xs text-red-500">Reject</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {!loading && expenses.length > 0 && (
                <tfoot className="bg-[var(--color-surface)] border-t border-[var(--color-border)]">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-medium text-sm">Total Approved</td>
                    <td className="px-4 py-3 font-bold text-red-600">{fmt(totalApproved)}</td>
                    <td colSpan={3 + auditColSpan} />
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
                <h3 className="font-semibold">{editingExpense ? 'Edit Expense' : 'Add Expense'}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label="Close modal"><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label">{t('accounting.date')}</label><input type="date" required className="input" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} /></div>
                <div><label className="label">{t('accounting.category')}</label>
                  <select className="input" value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                    {Object.entries(CAT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div><label className="label">{t('accounting.amountBdt')}</label><input type="number" required className="input" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} /></div>
                <div><label className="label">{t('accounting.description')}</label><input type="text" className="input" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                  <button type="submit" className="btn-danger">Save</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
