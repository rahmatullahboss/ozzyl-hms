import { useState, useEffect } from 'react';
import {
  BookOpen, Plus, X, Search, Trash2, Calendar, ArrowRightLeft
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import KPICard from '../../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

/* ─── Types ─── */
interface JournalEntry {
  id: number;
  entry_date: string;
  reference?: string;
  description?: string;
  debit_account_id: number;
  credit_account_id: number;
  amount: number;
  debit_code?: string;
  debit_name?: string;
  credit_code?: string;
  credit_name?: string;
  created_by_name?: string;
}

interface Account {
  id: number;
  code: string;
  name: string;
  type: string;
  is_active: boolean;
}

interface JournalResponse {
  journalEntries: JournalEntry[];
}

interface AccountsResponse {
  accounts: Account[];
}

export default function JournalEntries({ role = 'hospital_admin' }: { role?: string }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ entryDate: new Date().toISOString().split('T')[0], reference: '', description: '', debitAccountId: '', creditAccountId: '', amount: '' });
  const { t } = useTranslation(['tenantBilling']);
  const queryClient = useQueryClient();

  // ESC-to-close modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCreate(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const dateFilters = { startDate, endDate };

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  };

  const { data: journalData, isLoading: loading } = useApiQuery<JournalResponse>(
    queryKeys.accounting.journals(dateFilters),
    `/api/journal${buildQueryString()}`,
  );

  const entries = journalData?.journalEntries ?? [];

  const { data: accountsData } = useApiQuery<AccountsResponse>(
    queryKeys.accounting.accounts(),
    '/api/accounts',
  );

  const accounts = (accountsData?.accounts ?? []).filter((a: Account) => a.is_active);

  const totalDebit = entries.reduce((s, e) => s + e.amount, 0);
  const totalCredit = totalDebit; // double-entry: always balanced

  const createMutation = useApiMutation<unknown, {
    entry_date: string;
    reference?: string;
    description?: string;
    debit_account_id: number;
    credit_account_id: number;
    amount: number;
  }>(
    'post',
    '/api/journal',
    {
      onSuccess: () => {
        toast.success(t('journalEntries.created'));
        setShowCreate(false);
        setForm({ entryDate: new Date().toISOString().split('T')[0], reference: '', description: '', debitAccountId: '', creditAccountId: '', amount: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
      onError: (err) => {
        toast.error(err.message ?? t('journalEntries.failedCreate'));
      },
    },
  );

  const deleteMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/journal/${id}`,
    {
      onSuccess: () => {
        toast.success(t('journalEntries.deleted'));
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
      onError: (err) => {
        toast.error(err.message ?? t('journalEntries.failedDelete'));
      },
    },
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.debitAccountId === form.creditAccountId) return toast.error(t('journalEntries.differentAccounts'));
    createMutation.mutate({
      entry_date: form.entryDate,
      reference: form.reference || undefined,
      description: form.description || undefined,
      debit_account_id: parseInt(form.debitAccountId),
      credit_account_id: parseInt(form.creditAccountId),
      amount: parseInt(form.amount),
    });
  };

  const handleDelete = (id: number) => {
    if (!confirm(t('journalEntries.confirmDelete'))) return;
    deleteMutation.mutate(id);
  };

  const saving = createMutation.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('journalEntries.title')}</h1>
            <p className="section-subtitle mt-1">{t('journalEntries.subtitle')}</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('journalEntries.newEntry')}</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('journalEntries.totalEntries')} value={entries.length} loading={loading} icon={<BookOpen className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('journalEntries.totalDebit')} value={`৳${totalDebit.toLocaleString()}`} loading={loading} icon={<ArrowRightLeft className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title={t('journalEntries.totalCredit')} value={`৳${totalCredit.toLocaleString()}`} loading={loading} icon={<ArrowRightLeft className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="date" className="input w-36 text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} placeholder={t('journalEntries.fromDate')} />
            <span className="text-[var(--color-text-muted)]">{t('journalEntries.toDate')}</span>
            <input type="date" className="input w-36 text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} placeholder={t('journalEntries.toDate')} />
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t('journalEntries.date')}</th><th>{t('journalEntries.ref')}</th><th>{t('journalEntries.description')}</th><th>{t('journalEntries.debitAccount')}</th><th>{t('journalEntries.creditAccount')}</th><th className="text-right">{t('journalEntries.amount')}</th><th>{t('journalEntries.by')}</th><th>{t('journalEntries.actions')}</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(4)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : entries.length === 0 ? (
                  <tr><td colSpan={8} className="py-16 text-center text-[var(--color-text-muted)]"><BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />{t('journalEntries.noEntries')}</td></tr>
                ) : (
                  entries.map(entry => (
                    <tr key={entry.id}>
                      <td className="font-data">{entry.entry_date}</td>
                      <td className="font-data text-[var(--color-text-muted)]">{entry.reference || '—'}</td>
                      <td>{entry.description || '—'}</td>
                      <td className="text-sm"><span className="font-data text-red-500">{entry.debit_code}</span> {entry.debit_name}</td>
                      <td className="text-sm"><span className="font-data text-emerald-500">{entry.credit_code}</span> {entry.credit_name}</td>
                      <td className="text-right font-data font-medium">৳{entry.amount.toLocaleString()}</td>
                      <td className="text-[var(--color-text-muted)] text-sm">{entry.created_by_name || '—'}</td>
                      <td><button onClick={() => handleDelete(entry.id)} className="btn-ghost p-1.5 text-red-500" title={t('journalEntries.delete')} aria-label={t('journalEntries.deleteAria')}><Trash2 className="w-4 h-4" /></button></td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('journalEntries.newEntryTitle')}</h3>
                <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5" aria-label={t('journalEntries.closeAria')}><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('journalEntries.date')} *</label><input className="input" type="date" required value={form.entryDate} onChange={e => setForm({ ...form, entryDate: e.target.value })} /></div>
                  <div><label className="label">{t('journalEntries.ref')}</label><input className="input" placeholder={t('journalEntries.refPlaceholder')} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></div>
                </div>
                <div><label className="label">{t('journalEntries.description')}</label><input className="input" placeholder={t('journalEntries.descriptionPlaceholder')} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('journalEntries.debit')} *</label>
                    <select className="input" required value={form.debitAccountId} onChange={e => setForm({ ...form, debitAccountId: e.target.value })}>
                      <option value="">{t('journalEntries.selectAccount')}</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('journalEntries.credit')} *</label>
                    <select className="input" required value={form.creditAccountId} onChange={e => setForm({ ...form, creditAccountId: e.target.value })}>
                      <option value="">{t('journalEntries.selectAccount')}</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                </div>
                <div><label className="label">{t('journalEntries.amount')} *</label><input className="input" type="number" required min="1" placeholder="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('journalEntries.cancel')}</button>
                  <button type="submit" disabled={saving} className="btn-primary">{saving ? t('journalEntries.creating') : t('journalEntries.createEntry')}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
