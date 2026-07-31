import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { formatDisplayDate } from '../../lib/date-utils';

interface Income {
  id: number;
  date: string;
  source: string;
  amount: number;
  description: string;
  bill_id: number | null;
}

interface IncomeResponse {
  income: Income[];
}

type LocaleText = { en: string; bn: string };

const SOURCE_LABELS: Record<string, LocaleText> = {
  pharmacy: { en: 'Pharmacy', bn: 'ফার্মেসি' },
  laboratory: { en: 'Laboratory', bn: 'ল্যাবরেটরি' },
  doctor_visit: { en: 'Doctor Visit', bn: 'ডাক্তার ভিজিট' },
  admission: { en: 'Admission', bn: 'ভর্তি' },
  operation: { en: 'Operation', bn: 'অপারেশন' },
  ambulance: { en: 'Ambulance', bn: 'অ্যাম্বুলেন্স' },
  other: { en: 'Other', bn: 'অন্যান্য' },
};

const UI_TEXT: Record<string, LocaleText> = {
  'accounting.incomeList.title': { en: 'Income Management', bn: 'আয় ব্যবস্থাপনা' },
  'accounting.incomeList.addIncome': { en: 'Add Income', bn: 'আয় যোগ করুন' },
  'accounting.incomeList.allSources': { en: 'All Sources', bn: 'সব উৎস' },
  'accounting.incomeList.filter': { en: 'Filter', bn: 'ফিল্টার' },
  'accounting.incomeList.date': { en: 'Date', bn: 'তারিখ' },
  'accounting.incomeList.source': { en: 'Source', bn: 'উৎস' },
  'accounting.incomeList.amount': { en: 'Amount', bn: 'পরিমাণ' },
  'accounting.incomeList.description': { en: 'Description', bn: 'বিবরণ' },
  'accounting.incomeList.actions': { en: 'Actions', bn: 'কার্যক্রম' },
  'accounting.incomeList.noRecords': { en: 'No income records found', bn: 'কোনো আয়ের রেকর্ড পাওয়া যায়নি' },
  'accounting.incomeList.auto': { en: 'Auto', bn: 'স্বয়ংক্রিয়' },
  'accounting.incomeList.edit': { en: 'Edit', bn: 'সম্পাদনা' },
  'accounting.incomeList.delete': { en: 'Delete', bn: 'মুছে ফেলুন' },
  'accounting.incomeList.total': { en: 'Total', bn: 'মোট' },
  'accounting.incomeList.editIncome': { en: 'Edit Income', bn: 'আয় সম্পাদনা করুন' },
  'accounting.incomeList.closeAria': { en: 'Close modal', bn: 'মডাল বন্ধ করুন' },
  'accounting.incomeList.amountBdt': { en: 'Amount (BDT)', bn: 'পরিমাণ (বিডিটি)' },
  'accounting.incomeList.cancel': { en: 'Cancel', bn: 'বাতিল' },
  'accounting.incomeList.save': { en: 'Save', bn: 'সংরক্ষণ' },
  'accounting.incomeList.confirmDelete': { en: 'Delete this income record?', bn: 'এই আয়ের রেকর্ড মুছে ফেলবেন?' },
};

const SOURCE_BADGE: Record<string, string> = {
  pharmacy: 'badge-info', laboratory: 'badge-success', doctor_visit: 'badge-primary',
  admission: 'badge-warning', operation: 'badge-danger',
};

const fmt = (n: number) =>
  new Intl.NumberFormat('en-BD', { style: 'currency', currency: 'BDT', minimumFractionDigits: 0 }).format(n);

export default function IncomeList({ role = 'md' }: { role?: string }) {
  const [filters, setFilters]           = useState({ startDate: '', endDate: '', source: '' });
  const [showModal, setShowModal]       = useState(false);
  const [editingIncome, setEditing]     = useState<Income | null>(null);
  const [formData, setFormData]         = useState({ date: '', source: 'other', amount: '', description: '' });
  const { t, i18n } = useTranslation(['tenantBilling']);
  const queryClient = useQueryClient();
  const isBn = i18n.language?.toLowerCase().startsWith('bn');
  const tt = (key: keyof typeof UI_TEXT) => t(key, { defaultValue: UI_TEXT[key][isBn ? 'bn' : 'en'] });
  const sourceLabel = (source: string) => SOURCE_LABELS[source]?.[isBn ? 'bn' : 'en'] ?? source;

  const buildQueryString = () => {
    const params = new URLSearchParams();
    if (filters.startDate) params.append('startDate', filters.startDate);
    if (filters.endDate)   params.append('endDate',   filters.endDate);
    if (filters.source)    params.append('source',    filters.source);
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  };

  const { data, isLoading: loading } = useApiQuery<IncomeResponse>(
    queryKeys.accounting.income(filters),
    `/api/income${buildQueryString()}`,
  );

  const incomes = data?.income ?? [];

  const saveMutation = useApiMutation<unknown, typeof formData>(
    editingIncome ? 'put' : 'post',
    editingIncome ? `/api/income/${editingIncome.id}` : '/api/income',
    {
      onSuccess: () => {
        setShowModal(false);
        setEditing(null);
        setFormData({ date: new Date().toISOString().split('T')[0], source: 'other', amount: '', description: '' });
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
    },
  );

  const deleteMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/income/${id}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.accounting.all });
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    saveMutation.mutate(formData);
  };

  const handleDelete = (id: number) => {
    if (!confirm(tt('accounting.incomeList.confirmDelete'))) return;
    deleteMutation.mutate(id);
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
          <h1 className="page-title">{tt('accounting.incomeList.title')}</h1>
          <button onClick={() => { setEditing(null); setFormData({ date: new Date().toISOString().split('T')[0], source: 'other', amount: '', description: '' }); setShowModal(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> {tt('accounting.incomeList.addIncome')}
          </button>
        </div>

        {/* ── Filters ── */}
        <div className="card p-4 flex flex-wrap gap-3">
          <input type="date" value={filters.startDate} onChange={e => setFilters({...filters, startDate: e.target.value})} className="input w-40 text-sm" />
          <input type="date" value={filters.endDate}   onChange={e => setFilters({...filters, endDate:   e.target.value})} className="input w-40 text-sm" />
          <select value={filters.source} onChange={e => setFilters({...filters, source: e.target.value})} className="input w-44 text-sm">
            <option value="">{tt('accounting.incomeList.allSources')}</option>
            {Object.entries(SOURCE_LABELS).map(([v]) => <option key={v} value={v}>{sourceLabel(v)}</option>)}
          </select>
          <button onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.accounting.income(filters) })} className="btn-secondary text-sm">{tt('accounting.incomeList.filter')}</button>
        </div>

        {/* ── Table ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{tt('accounting.incomeList.date')}</th><th>{tt('accounting.incomeList.source')}</th><th>{tt('accounting.incomeList.amount')}</th><th>{tt('accounting.incomeList.description')}</th><th>{tt('accounting.incomeList.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(5)].map((_, i) => (
                    <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>
                  ))
                ) : incomes.length === 0 ? (
                  <tr><td colSpan={5} className="py-14 text-center text-[var(--color-text-muted)]">{tt('accounting.incomeList.noRecords')}</td></tr>
                ) : (
                  incomes.map(income => (
                    <tr key={income.id}>
                      <td className="font-data text-sm">{formatDisplayDate(income.date)}</td>
                      <td>
                        <span className={`badge ${SOURCE_BADGE[income.source] ?? 'badge-secondary'}`}>
                          {sourceLabel(income.source)}
                        </span>
                        {income.bill_id && <span className="ml-2 text-xs text-[var(--color-text-muted)]">{tt('accounting.incomeList.auto')}</span>}
                      </td>
                      <td className="font-data font-medium text-emerald-600">{fmt(income.amount)}</td>
                      <td className="text-[var(--color-text-secondary)] text-sm">{income.description || '—'}</td>
                      <td>
                        <div className="flex gap-1.5">
                          <button onClick={() => openEdit(income)} className="btn-ghost p-1.5 text-xs">{tt('accounting.incomeList.edit')}</button>
                          <button onClick={() => handleDelete(income.id)} className="btn-ghost p-1.5 text-xs text-red-500">{tt('accounting.incomeList.delete')}</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
              {!loading && incomes.length > 0 && (
                <tfoot className="bg-[var(--color-surface)] border-t border-[var(--color-border)]">
                  <tr>
                    <td colSpan={2} className="px-4 py-3 font-medium text-sm">{tt('accounting.incomeList.total')}</td>
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
                <h3 className="font-semibold">{editingIncome ? tt('accounting.incomeList.editIncome') : tt('accounting.incomeList.addIncome')}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5" aria-label={tt('accounting.incomeList.closeAria')}><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label">{tt('accounting.incomeList.date')}</label><input type="date" required className="input" value={formData.date} onChange={e => setFormData({...formData, date: e.target.value})} /></div>
                <div><label className="label">{tt('accounting.incomeList.source')}</label>
                  <select className="input" value={formData.source} onChange={e => setFormData({...formData, source: e.target.value})}>
                    {Object.entries(SOURCE_LABELS).map(([v]) => <option key={v} value={v}>{sourceLabel(v)}</option>)}
                  </select>
                </div>
                <div><label className="label">{tt('accounting.incomeList.amountBdt')}</label><input type="number" required className="input" value={formData.amount} onChange={e => setFormData({...formData, amount: e.target.value})} /></div>
                <div><label className="label">{tt('accounting.incomeList.description')}</label><input type="text" className="input" value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{tt('accounting.incomeList.cancel')}</button>
                  <button type="submit" className="btn-primary">{tt('accounting.incomeList.save')}</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
