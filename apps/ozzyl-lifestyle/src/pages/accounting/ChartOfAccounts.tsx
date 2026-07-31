import { useState, useEffect } from 'react';
import { Plus, Pencil, Trash2, X, Search } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Account {
  id: number; code: string; name: string;
  type: string; parent_id: number | null;
  is_active: number; created_at: string;
}

const TYPE_LABEL: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity',
  income: 'Income', expense: 'Expense',
};

const TYPE_BADGE: Record<string, string> = {
  asset:     'badge badge-info',
  liability: 'badge badge-warning',
  equity:    'badge badge-primary',
  income:    'badge badge-success',
  expense:   'badge badge-danger',
};

export default function ChartOfAccounts({ role = 'md' }: { role?: string }) {
  const [accounts,       setAccounts]      = useState<Account[]>([]);
  const [loading,        setLoading]       = useState(true);
  const [filter,         setFilter]        = useState('');
  const [typeFilter,     setTypeFilter]    = useState('');
  const [showModal,      setShowModal]     = useState(false);
  const [editingAccount, setEditing]       = useState<Account | null>(null);
  const [formData,       setFormData]      = useState({ code: '', name: '', type: 'expense', parent_id: '' });
  const { t } = useTranslation(['accounting', 'common']);

  const fetchAccounts = async () => {
    try {
      const token = localStorage.getItem('hms_token');
      const params = new URLSearchParams();
      if (typeFilter) params.append('type', typeFilter);
      const res = await axios.get(`/api/accounts?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAccounts(res.data.accounts || []);
    } catch { console.error('Error fetching accounts'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAccounts(); }, [typeFilter]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const token = localStorage.getItem('hms_token');
      const headers = { Authorization: `Bearer ${token}` };
      const payload = { ...formData, parent_id: formData.parent_id ? parseInt(formData.parent_id) : null };
      if (editingAccount) {
        await axios.put(`/api/accounts/${editingAccount.id}`, payload, { headers });
        toast.success(t('chart.updated', { defaultValue: 'Account updated' }));
      } else {
        await axios.post('/api/accounts', payload, { headers });
        toast.success(t('chart.created', { defaultValue: 'Account created' }));
      }
      setShowModal(false); setEditing(null);
      setFormData({ code: '', name: '', type: 'expense', parent_id: '' });
      fetchAccounts();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { error?: string } } };
      toast.error(err.response?.data?.error || t('chart.failedSave', { defaultValue: 'Error saving account' }));
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('chart.confirmDelete', { defaultValue: 'Delete this account?' }))) return;
    try {
      const token = localStorage.getItem('hms_token');
      await axios.delete(`/api/accounts/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('chart.deleted', { defaultValue: 'Account deleted' }));
      fetchAccounts();
    } catch { toast.error(t('chart.failedDelete', { defaultValue: 'Error deleting account' })); }
  };

  const openEdit = (account: Account) => {
    setEditing(account);
    setFormData({ code: account.code, name: account.name, type: account.type, parent_id: account.parent_id?.toString() || '' });
    setShowModal(true);
  };

  const filtered = accounts.filter(a =>
    a.name.toLowerCase().includes(filter.toLowerCase()) ||
    a.code.toLowerCase().includes(filter.toLowerCase())
  );

  const grouped = filtered.reduce((acc, a) => {
    if (!acc[a.type]) acc[a.type] = [];
    acc[a.type].push(a);
    return acc;
  }, {} as Record<string, Account[]>);

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <h1 className="page-title">{t('chart.title', { defaultValue: 'Chart of Accounts' })}</h1>
          <button onClick={() => { setEditing(null); setFormData({ code: '', name: '', type: 'expense', parent_id: '' }); setShowModal(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('chart.addAccount', { defaultValue: 'Add Account' })}
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" placeholder={t('chart.searchPlaceholder', { defaultValue: 'Search accounts…' })} value={filter} onChange={e => setFilter(e.target.value)} className="input pl-9" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input w-48">
            <option value="">{t('chart.allTypes', { defaultValue: 'All Types' })}</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{t(`chart.types.${v}`, { defaultValue: l })}</option>)}
          </select>
        </div>

        {/* ── Grouped Tables ── */}
        {loading ? (
          <div className="card p-10 text-center">
            <div className="w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[var(--color-text-muted)]">{t('loading', { ns: 'common', defaultValue: 'Loading accounts…' })}</p>
          </div>
        ) : Object.entries(grouped).length === 0 ? (
          <div className="card p-14 text-center text-[var(--color-text-muted)]">{t('chart.noAccounts', { defaultValue: 'No accounts found' })}</div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([type, typeAccounts]) => (
              <div key={type} className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                  <span className={TYPE_BADGE[type] ?? 'badge badge-secondary'}>{TYPE_LABEL[type] || type}</span>
                  <span className="text-xs text-[var(--color-text-muted)] ml-2">{typeAccounts.length} {t('chart.accounts', { defaultValue: 'accounts' })}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead><tr><th className="w-24">{t('chart.code', { defaultValue: 'Code' })}</th><th>{t('chart.name', { defaultValue: 'Name' })}</th><th className="w-24">{t('status', { ns: 'common', defaultValue: 'Status' })}</th><th className="w-28 text-right">{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th></tr></thead>
                    <tbody>
                      {typeAccounts.map(a => (
                        <tr key={a.id}>
                          <td className="font-data font-medium text-[var(--color-primary)]">{a.code}</td>
                          <td>{a.name}</td>
                          <td><span className={`badge ${a.is_active ? 'badge-success' : 'badge-danger'}`}>{a.is_active ? t('active', { ns: 'common', defaultValue: 'Active' }) : t('inactive', { ns: 'common', defaultValue: 'Inactive' })}</span></td>
                          <td className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => openEdit(a)} className="btn-ghost p-1.5 text-[var(--color-primary)]" aria-label="Edit account"><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handleDelete(a.id)} className="btn-ghost p-1.5 text-red-500" aria-label="Delete account"><Trash2 className="w-4 h-4" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Add / Edit Modal ── */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
                <h3 className="font-semibold text-[var(--color-text)]">{editingAccount ? t('chart.editAccount', { defaultValue: 'Edit Account' }) : t('chart.addAccount', { defaultValue: 'Add Account' })}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label="Close modal"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                  <label className="label">{t('chart.accountCode', { defaultValue: 'Account Code' })}</label>
                  <input type="text" className="input" value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})}
                    required disabled={!!editingAccount} placeholder={t('chart.codePlaceholder', { defaultValue: 'e.g. 5001' })} />
                </div>
                <div>
                  <label className="label">{t('chart.accountName', { defaultValue: 'Account Name' })}</label>
                  <input type="text" className="input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                    required placeholder={t('chart.namePlaceholder', { defaultValue: 'e.g. Medicine Purchase' })} />
                </div>
                <div>
                  <label className="label">{t('chart.type', { defaultValue: 'Type' })}</label>
                  <select className="input" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                    {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{t(`chart.types.${v}`, { defaultValue: l })}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="submit" className="btn-primary flex-1">{editingAccount ? t('chart.update', { defaultValue: 'Update' }) : t('chart.create', { defaultValue: 'Create' })}</button>
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
