import { useState, useMemo } from 'react';
import { Pill, Search, Plus, AlertTriangle, Pencil, X, PackageOpen } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';

interface Medicine {
  id: number;
  name: string;
  company: string;
  unit_price: number;
  quantity: number;
  created_at: string;
  updated_at: string;
}

interface MedicinesResponse {
  medicines: Medicine[];
}

const LOW_STOCK = 20;
const CRITICAL  = 5;

function stockStatus(qty: number, t: any): { label: string; badge: string } {
  if (qty <= CRITICAL)  return { label: t('critical'), badge: 'badge-danger' };
  if (qty <= LOW_STOCK) return { label: t('low'),      badge: 'badge-warning' };
  return                       { label: t('stockStatus_ok'), badge: 'badge-success' };
}

function StockBar({ qty, max = 200 }: { qty: number; max?: number }) {
  const pct   = Math.min(100, Math.round((qty / max) * 100));
  const color  = qty <= CRITICAL ? '#dc2626' : qty <= LOW_STOCK ? '#d97706' : '#059669';
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-[var(--color-border)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="font-data text-xs w-10 text-right">{qty}</span>
    </div>
  );
}

export default function PharmacyDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const [search,     setSearch]     = useState('');
  const [stockFilter,setStockFilter]= useState<'all' | 'low' | 'critical'>('all');
  const [showModal,  setShowModal]  = useState(false);
  const [editing,    setEditing]    = useState<Medicine | null>(null);
  const [form,       setForm]       = useState({ name: '', company: '', unitPrice: '', quantity: '' });
  const { t } = useTranslation(['pharmacy', 'common']);
  const queryClient = useQueryClient();

  const filters = useMemo(() => (search ? { search } : {}), [search]);

  const { data, isLoading: loading } = useApiQuery<MedicinesResponse>(
    queryKeys.pharmacy.medicines(filters),
    `/api/pharmacy/medicines${search ? `?search=${encodeURIComponent(search)}` : ''}`,
  );

  const medicines = data?.medicines ?? [];

  const saveMutation = useApiMutation<unknown, { id?: number; name: string; company: string; unitPrice: number; quantity: number }>(
    'post',
    (vars) => vars.id ? `/api/pharmacy/medicines/${vars.id}` : '/api/pharmacy/medicines',
    {
      onSuccess: (_data, vars) => {
        toast.success(vars.id ? t('medicine_updated') : t('medicine_added'));
        closeModal();
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.all });
      },
      onError: (_err, vars) => {
        toast.error(vars.id ? t('medicine_updated') : t('medicine_added'));
        closeModal();
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.all });
      },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      id: editing?.id,
      name:      form.name,
      company:   form.company,
      unitPrice: parseFloat(form.unitPrice) || 0,
      quantity:  parseInt(form.quantity)    || 0,
    };

    if (editing) {
      // Use PUT for edits
      saveMutation.mutate(payload);
    } else {
      saveMutation.mutate(payload);
    }
  };

  const openEdit = (med: Medicine) => {
    setEditing(med);
    setForm({ name: med.name, company: med.company || '', unitPrice: med.unit_price.toString(), quantity: med.quantity.toString() });
    setShowModal(true);
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', company: '', unitPrice: '', quantity: '' });
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditing(null); };

  const lowStockItems  = medicines.filter(m => m.quantity <= LOW_STOCK);
  const criticalItems  = medicines.filter(m => m.quantity <= CRITICAL);
  const totalValue     = medicines.reduce((s, m) => s + m.unit_price * m.quantity, 0);
  const totalUnits     = medicines.reduce((s, m) => s + m.quantity, 0);

  const displayed = medicines.filter(m => {
    const matchSearch = !search || m.name.toLowerCase().includes(search.toLowerCase()) || m.company?.toLowerCase().includes(search.toLowerCase());
    const matchFilter = stockFilter === 'all' || (stockFilter === 'critical' ? m.quantity <= CRITICAL : m.quantity <= LOW_STOCK);
    return matchSearch && matchFilter;
  });

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title')}</h1>
            <p className="section-subtitle mt-1">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-sm">{t('dispenseMedicine')}</button>
            <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4"/> {t('addMedicine')}</button>
          </div>
        </div>

        {/* ── Alert banner ── */}
        {criticalItems.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span className="text-sm font-medium">
              ⚠ {t(criticalItems.length === 1 ? 'criticallyLowStock' : 'criticallyLowStock_plural', { count: criticalItems.length })} —{' '}
              <button onClick={() => setStockFilter('critical')} className="underline font-semibold">{t('viewDetails')}</button>
            </span>
          </div>
        )}

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('medicines')}          value={medicines.length}                          loading={loading} icon={<Pill className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('totalStockValue')} value={`৳${totalValue.toLocaleString()}`} loading={loading} icon={<PackageOpen className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title={t('lowStock')}            value={lowStockItems.length}                      loading={loading} icon={<AlertTriangle className="w-5 h-5"/>} iconBg="bg-amber-50 text-amber-600" />
          <KPICard title={t('totalUnits')} value={totalUnits.toLocaleString()} loading={loading} icon={<Pill className="w-5 h-5"/>} iconBg="bg-blue-50 text-blue-600" />
        </div>

        {/* ── Search & Filter ── */}
        <div className="card p-4 flex flex-wrap gap-3 items-center">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
            <input type="text" placeholder={t('searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" />
          </div>
          <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
            {(['all', 'low', 'critical'] as const).map(f => (
              <button key={f} onClick={() => setStockFilter(f)}
                className={`px-3 py-2 font-medium transition-colors ${stockFilter === f ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}>
                {f === 'all' ? t('all') : f === 'low' ? t('lowStock') : t('critical')}
              </button>
            ))}
          </div>
        </div>

        {/* ── Table ── */}
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('medicineName')}</th>
                  <th>{t('company')}</th>
                  <th>{t('stockLevel')}</th>
                  <th>{t('unitPrice')}</th>
                  <th>{t('totalValue')}</th>
                  <th>{t('status', { ns: 'common' })}</th>
                  <th>{t('actions', { ns: 'common' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(6)].map((_, i) => <tr key={i}>{[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                ) : displayed.length === 0 ? (
                  <tr><td colSpan={8} className="py-16 text-center text-[var(--color-text-muted)]">{t('noMedicines')}</td></tr>
                ) : (
                  displayed.map((med, idx) => {
                    const st = stockStatus(med.quantity, t);
                    return (
                      <tr key={med.id}>
                        <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                        <td className="font-medium">{med.name}</td>
                        <td className="text-[var(--color-text-secondary)]">{med.company || '—'}</td>
                        <td className="min-w-[140px]"><StockBar qty={med.quantity} /></td>
                        <td className="font-data">৳{med.unit_price.toFixed(2)}</td>
                        <td className="font-data">৳{(med.unit_price * med.quantity).toLocaleString()}</td>
                        <td><span className={`badge ${st.badge}`}>{st.label}</span></td>
                        <td>
                          <div className="flex gap-1.5">
                            <button onClick={() => openEdit(med)} className="btn-ghost p-1.5" title="Edit"><Pencil className="w-4 h-4"/></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Add/Edit Modal ── */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{editing ? t('editMedicine') : t('addMedicine')}</h3>
                <button onClick={closeModal} className="btn-ghost p-1.5"><X className="w-5 h-5"/></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                  <label className="label">{t('medicineName')} *</label>
                  <input className="input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder={t("medicineNameExample")} />
                </div>
                <div>
                  <label className="label">{t('company')}</label>
                  <input className="input" value={form.company} onChange={e => setForm({...form, company: e.target.value})} placeholder={t("companyExample")} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('unitPrice')}</label>
                    <input className="input" type="number" required min="0" step="0.01" value={form.unitPrice} onChange={e => setForm({...form, unitPrice: e.target.value})} />
                  </div>
                  <div>
                    <label className="label">{t('quantity')}</label>
                    <input className="input" type="number" min="0" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={closeModal} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                  <button type="submit" disabled={saveMutation.isPending} className="btn-primary">{saveMutation.isPending ? t('loading', { ns: 'common' }) : editing ? t('save', { ns: 'common' }) : t('addMedicine')}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
