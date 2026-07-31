import { useState, useEffect, useCallback } from 'react';
import {
  BookOpen, Plus, X, Search, Trash2, Calendar, ArrowRightLeft
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import KPICard from '../../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';

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

const DEMO_ENTRIES: JournalEntry[] = [
  { id: 1, entry_date: '2026-03-13', reference: 'JV-001', description: 'Medicine purchase from supplier', debit_account_id: 5, credit_account_id: 1, amount: 25000, debit_name: 'Medicine Inventory', debit_code: '1300', credit_name: 'Cash', credit_code: '1100', created_by_name: 'Admin' },
  { id: 2, entry_date: '2026-03-12', reference: 'JV-002', description: 'Equipment depreciation', debit_account_id: 8, credit_account_id: 10, amount: 5000, debit_name: 'Depreciation Expense', debit_code: '6100', credit_name: 'Accumulated Depreciation', credit_code: '1520', created_by_name: 'Admin' },
  { id: 3, entry_date: '2026-03-11', reference: 'JV-003', description: 'Salary advance to staff', debit_account_id: 6, credit_account_id: 1, amount: 15000, debit_name: 'Staff Advances', debit_code: '1400', credit_name: 'Cash', credit_code: '1100', created_by_name: 'Admin' },
];

export default function JournalEntries({ role = 'hospital_admin' }: { role?: string }) {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ entryDate: new Date().toISOString().split('T')[0], reference: '', description: '', debitAccountId: '', creditAccountId: '', amount: '' });
  const { t } = useTranslation(['accounting', 'common']);

  // ESC-to-close modal
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowCreate(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const params: Record<string, string> = {};
      if (startDate) params.startDate = startDate;
      if (endDate) params.endDate = endDate;
      const { data } = await axios.get('/api/journal', { params, headers: { Authorization: `Bearer ${token}` } });
      setEntries(data.journalEntries ?? []);
    } catch {
      setEntries(DEMO_ENTRIES);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const fetchAccounts = useCallback(async () => {
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/accounts', { headers: { Authorization: `Bearer ${token}` } });
      setAccounts((data.accounts ?? []).filter((a: Account) => a.is_active));
    } catch {
      setAccounts([
        { id: 1, code: '1100', name: 'Cash', type: 'asset', is_active: true },
        { id: 5, code: '1300', name: 'Medicine Inventory', type: 'asset', is_active: true },
        { id: 8, code: '6100', name: 'Depreciation Expense', type: 'expense', is_active: true },
        { id: 10, code: '1520', name: 'Accumulated Depreciation', type: 'contra_asset', is_active: true },
      ]);
    }
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);
  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const totalDebit = entries.reduce((s, e) => s + e.amount, 0);
  const totalCredit = totalDebit; // double-entry: always balanced

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.debitAccountId === form.creditAccountId) return toast.error(t('journal.differentAccounts', { defaultValue: 'Debit & credit accounts must be different' }));
    setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      await axios.post('/api/journal', {
        entry_date: form.entryDate,
        reference: form.reference || undefined,
        description: form.description || undefined,
        debit_account_id: parseInt(form.debitAccountId),
        credit_account_id: parseInt(form.creditAccountId),
        amount: parseInt(form.amount),
      }, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('journal.created', { defaultValue: 'Journal entry created' }));
      setShowCreate(false);
      setForm({ entryDate: new Date().toISOString().split('T')[0], reference: '', description: '', debitAccountId: '', creditAccountId: '', amount: '' });
      fetchEntries();
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : t('journal.failedCreate', { defaultValue: 'Failed to create' });
      toast.error(msg ?? t('journal.failed', { defaultValue: 'Failed to create' }));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm(t('journal.confirmDelete', { defaultValue: 'Delete this journal entry?' }))) return;
    try {
      const token = localStorage.getItem('hms_token');
      await axios.delete(`/api/journal/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('journal.deleted', { defaultValue: 'Entry deleted' }));
      fetchEntries();
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.error : t('journal.failedDelete', { defaultValue: 'Failed to delete' });
      toast.error(msg ?? t('journal.failedDelete', { defaultValue: 'Failed to delete' }));
    }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('journal.title', { defaultValue: 'Journal Entries' })}</h1>
            <p className="section-subtitle mt-1">{t('journal.subtitle', { defaultValue: 'Double-entry accounting journal' })}</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary"><Plus className="w-4 h-4" /> {t('journal.newEntry', { defaultValue: 'New Entry' })}</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title={t('journal.totalEntries', { defaultValue: 'Total Entries' })} value={entries.length} loading={loading} icon={<BookOpen className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('journal.totalDebit', { defaultValue: 'Total Debit' })} value={`৳${totalDebit.toLocaleString()}`} loading={loading} icon={<ArrowRightLeft className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
          <KPICard title={t('journal.totalCredit', { defaultValue: 'Total Credit' })} value={`৳${totalCredit.toLocaleString()}`} loading={loading} icon={<ArrowRightLeft className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
        </div>

        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="date" className="input w-36 text-sm" value={startDate} onChange={e => setStartDate(e.target.value)} placeholder={t('journal.fromDate', { defaultValue: 'From' })} />
            <span className="text-[var(--color-text-muted)]">{t('journal.toDate', { defaultValue: 'to' })}</span>
            <input type="date" className="input w-36 text-sm" value={endDate} onChange={e => setEndDate(e.target.value)} placeholder={t('journal.toDate', { defaultValue: 'To' })} />
          </div>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr><th>{t('journal.date', { defaultValue: 'Date' })}</th><th>{t('journal.ref', { defaultValue: 'Ref' })}</th><th>{t('journal.description', { defaultValue: 'Description' })}</th><th>{t('journal.debitAccount', { defaultValue: 'Debit Account' })}</th><th>{t('journal.creditAccount', { defaultValue: 'Credit Account' })}</th><th className="text-right">{t('journal.amount', { defaultValue: 'Amount (৳)' })}</th><th>{t('journal.by', { defaultValue: 'By' })}</th><th>{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(4)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : entries.length === 0 ? (
                  <tr><td colSpan={8} className="py-16 text-center text-[var(--color-text-muted)]"><BookOpen className="w-10 h-10 mx-auto mb-2 opacity-30" />{t('journal.noEntries', { defaultValue: 'No journal entries found' })}</td></tr>
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
                      <td><button onClick={() => handleDelete(entry.id)} className="btn-ghost p-1.5 text-red-500" title="Delete" aria-label="Delete entry"><Trash2 className="w-4 h-4" /></button></td>
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
                <h3 className="font-semibold">{t('journal.newEntryTitle', { defaultValue: 'New Journal Entry' })}</h3>
                <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5" aria-label="Close modal"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('journal.date', { defaultValue: 'Date' })} *</label><input className="input" type="date" required value={form.entryDate} onChange={e => setForm({ ...form, entryDate: e.target.value })} /></div>
                  <div><label className="label">{t('journal.ref', { defaultValue: 'Reference' })}</label><input className="input" placeholder={t('journal.refPlaceholder', { defaultValue: 'JV-004' })} value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} /></div>
                </div>
                <div><label className="label">{t('journal.description', { defaultValue: 'Description' })}</label><input className="input" placeholder={t('journal.descriptionPlaceholder', { defaultValue: 'Transaction description' })} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('journal.debit', { defaultValue: 'Debit (Dr)' })} *</label>
                    <select className="input" required value={form.debitAccountId} onChange={e => setForm({ ...form, debitAccountId: e.target.value })}>
                      <option value="">{t('journal.selectAccount', { defaultValue: 'Select account' })}</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('journal.credit', { defaultValue: 'Credit (Cr)' })} *</label>
                    <select className="input" required value={form.creditAccountId} onChange={e => setForm({ ...form, creditAccountId: e.target.value })}>
                      <option value="">{t('journal.selectAccount', { defaultValue: 'Select account' })}</option>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
                    </select>
                  </div>
                </div>
                <div><label className="label">{t('journal.amount', { defaultValue: 'Amount (৳)' })} *</label><input className="input" type="number" required min="1" placeholder="0" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
                  <button type="submit" disabled={saving} className="btn-primary">{saving ? t('journal.creating', { defaultValue: 'Creating…' }) : t('journal.createEntry', { defaultValue: 'Create Entry' })}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
