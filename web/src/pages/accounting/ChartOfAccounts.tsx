import { useState } from 'react';
import { Plus, Pencil, Trash2, X, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Account {
  id: number; code: string; name: string;
  type: string; parent_id: number | null;
  is_active: number; created_at: string;
}

interface AccountsResponse {
  accounts: Account[];
}

const TYPE_LABEL: Record<string, string> = {
  asset: 'Asset', liability: 'Liability', equity: 'Equity',
  revenue: 'Revenue', expense: 'Expense',
};

const TYPE_BADGE: Record<string, string> = {
  asset:     'badge badge-info',
  liability: 'badge badge-warning',
  equity:    'badge badge-primary',
  revenue:   'badge badge-success',
  expense:   'badge badge-danger',
};

export default function ChartOfAccounts({ role = 'md' }: { role?: string }) {
  const [filter,         setFilter]        = useState('');
  const [typeFilter,     setTypeFilter]    = useState('');
  const [showModal,      setShowModal]     = useState(false);
  const [editingAccount, setEditing]       = useState<Account | null>(null);
  const [formData,       setFormData]      = useState({ code: '', name: '', type: 'expense', parent_id: '' });
  const { t } = useTranslation(['tenantAdmin']);
  const queryClient = useQueryClient();

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (typeFilter) params.append('type', typeFilter);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  };

  const { data, isLoading: loading } = useApiQuery<AccountsResponse>(
    queryKeys.accounting.chartOfAccounts({ type: typeFilter }),
    `/api/accounts${buildQueryString()}`,
  );

  const accounts = data?.accounts ?? [];

  const saveMutation = useApiMutation<unknown, { code: string; name: string; type: string; parent_id: number | null }>(
    editingAccount ? 'put' : 'post',
    editingAccount ? `/api/accounts/${editingAccount.id}` : '/api/accounts',
    {
      onSuccess: () => {
        toast.success(editingAccount
          ? t('chartOfAccounts.updated')
          : t('chartOfAccounts.created'));
        setShowModal(false);
        setEditing(null);
        setFormData({ code: '', name: '', type: 'expense', parent_id: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
      onError: (err) => {
        toast.error(err.message || t('chartOfAccounts.failedSave'));
      },
    },
  );

  const deleteMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/accounts/${id}`,
    {
      onSuccess: () => {
        toast.success(t('chartOfAccounts.deleted'));
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
      onError: () => {
        toast.error(t('chartOfAccounts.failedDelete'));
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = { ...formData, parent_id: formData.parent_id ? parseInt(formData.parent_id) : null };
    saveMutation.mutate(payload);
  };

  const handleDelete = (id: number) => {
    if (!confirm(t('chartOfAccounts.confirmDelete'))) return;
    deleteMutation.mutate(id);
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
          <h1 className="page-title">{t('chartOfAccounts.title')}</h1>
          <button onClick={() => { setEditing(null); setFormData({ code: '', name: '', type: 'expense', parent_id: '' }); setShowModal(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('chartOfAccounts.addAccount')}
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" placeholder={t('chartOfAccounts.searchPlaceholder')} value={filter} onChange={e => setFilter(e.target.value)} className="input pl-9" />
          </div>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className="input w-48">
            <option value="">{t('chartOfAccounts.allTypes')}</option>
            {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{t(`chartOfAccounts.types.${v}`, { defaultValue: l })}</option>)}
          </select>
        </div>

        {/* ── Grouped Tables ── */}
        {loading ? (
          <div className="card p-10 text-center">
            <div className="w-8 h-8 border-4 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[var(--color-text-muted)]">{t('chartOfAccounts.loading')}</p>
          </div>
        ) : Object.entries(grouped).length === 0 ? (
          <div className="card p-14 text-center text-[var(--color-text-muted)]">{t('chartOfAccounts.noAccounts')}</div>
        ) : (
          <div className="space-y-5">
            {Object.entries(grouped).map(([type, typeAccounts]) => (
              <div key={type} className="card overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
                  <span className={TYPE_BADGE[type] ?? 'badge badge-secondary'}>{TYPE_LABEL[type] || type}</span>
                  <span className="text-xs text-[var(--color-text-muted)] ml-2">{typeAccounts.length} {t('chartOfAccounts.accounts')}</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="table-base">
                    <thead><tr><th className="w-24">{t('chartOfAccounts.code')}</th><th>{t('chartOfAccounts.name')}</th><th className="w-24">{t('chartOfAccounts.status')}</th><th className="w-28 text-right">{t('chartOfAccounts.actions')}</th></tr></thead>
                    <tbody>
                      {typeAccounts.map(a => (
                        <tr key={a.id}>
                          <td className="font-data font-medium text-[var(--color-primary)]">{a.code}</td>
                          <td>{a.name}</td>
                          <td><span className={`badge ${a.is_active ? 'badge-success' : 'badge-danger'}`}>{a.is_active ? t('chartOfAccounts.active') : t('chartOfAccounts.inactive')}</span></td>
                          <td className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => openEdit(a)} className="btn-ghost p-1.5 text-[var(--color-primary)]" aria-label={t('chartOfAccounts.editAria')}><Pencil className="w-4 h-4" /></button>
                              <button onClick={() => handleDelete(a.id)} className="btn-ghost p-1.5 text-red-500" aria-label={t('chartOfAccounts.deleteAria')}><Trash2 className="w-4 h-4" /></button>
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
                <h3 className="font-semibold text-[var(--color-text)]">{editingAccount ? t('chartOfAccounts.editAccount') : t('chartOfAccounts.addAccount')}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label={t('chartOfAccounts.closeAria')}><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                  <label className="label">{t('chartOfAccounts.accountCode')}</label>
                  <input type="text" className="input" value={formData.code} onChange={e => setFormData({...formData, code: e.target.value})}
                    required disabled={!!editingAccount} placeholder={t('chartOfAccounts.codePlaceholder')} />
                </div>
                <div>
                  <label className="label">{t('chartOfAccounts.accountName')}</label>
                  <input type="text" className="input" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                    required placeholder={t('chartOfAccounts.namePlaceholder')} />
                </div>
                <div>
                  <label className="label">{t('chartOfAccounts.type')}</label>
                  <select className="input" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})}>
                    {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{t(`chartOfAccounts.types.${v}`, { defaultValue: l })}</option>)}
                  </select>
                </div>
                <div className="flex gap-3 pt-1">
                  <button type="submit" className="btn-primary flex-1">{editingAccount ? t('chartOfAccounts.update') : t('chartOfAccounts.create')}</button>
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('chartOfAccounts.cancel')}</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
