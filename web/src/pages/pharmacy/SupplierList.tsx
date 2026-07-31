import { useState } from 'react';
import { Plus, Pencil, X, Phone, Mail, MapPin } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { ApiClientError } from '../../lib/apiClient';

interface Supplier {
  id: number; name: string; contact_no?: string; address?: string;
  city?: string; email?: string; pan_no?: string; credit_period?: number;
  notes?: string; is_active: number;
}

const EMPTY = {
  name: '', contactNo: '', address: '', city: '',
  email: '', panNo: '', creditPeriod: '0', notes: '',
};

export default function SupplierList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  // ── Query ────────────────────────────────────────────────────────────
  const { data, isLoading: loading } = useApiQuery<{ suppliers: Supplier[] }>(
    queryKeys.pharmacy.suppliers(),
    '/api/pharmacy/pharmacy-suppliers',
  );
  const suppliers = data?.suppliers ?? [];

  // ── Mutations ────────────────────────────────────────────────────────
  const createMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/pharmacy/pharmacy-suppliers',
    {
      onSuccess: () => {
        toast.success(t('supplierCreated', { defaultValue: 'Supplier created' }));
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.all });
      },
      onError: (err) => {
        const msg = err instanceof ApiClientError ? err.message : 'Failed to save supplier';
        toast.error(msg || t('supplier.failedSave', { defaultValue: 'Failed to save supplier' }));
      },
    },
  );

  const updateMutation = useApiMutation<unknown, { id: number; payload: Record<string, unknown> }>(
    'put',
    (vars) => `/api/pharmacy/pharmacy-suppliers/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('supplierUpdated', { defaultValue: 'Supplier updated' }));
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.all });
      },
      onError: (err) => {
        const msg = err instanceof ApiClientError ? err.message : 'Failed to save supplier';
        toast.error(msg || t('supplier.failedSave', { defaultValue: 'Failed to save supplier' }));
      },
    },
  );

  const toggleMutation = useApiMutation<unknown, Supplier>(
    'put',
    (s) => `/api/pharmacy/pharmacy-suppliers/${s.id}/${s.is_active ? 'deactivate' : 'activate'}`,
    {
      onSuccess: (_data, s) => {
        const action = s.is_active ? 'deactivate' : 'activate';
        toast.success(t('supplier.statusUpdated', { defaultValue: `Supplier ${action}d` }));
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.all });
      },
      onError: () => { toast.error(t('supplier.failedStatus', { defaultValue: 'Failed to update status' })); },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name,
      contactNo: form.contactNo || undefined,
      address: form.address || undefined,
      city: form.city || undefined,
      email: form.email || undefined,
      panNo: form.panNo || undefined,
      creditPeriod: parseInt(form.creditPeriod) || 0,
      notes: form.notes || undefined,
    };
    if (editing) {
      updateMutation.mutate({ id: editing.id, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const openEdit = (s: Supplier) => {
    setEditing(s);
    setForm({
      name: s.name,
      contactNo: s.contact_no ?? '',
      address: s.address ?? '',
      city: s.city ?? '',
      email: s.email ?? '',
      panNo: s.pan_no ?? '',
      creditPeriod: String(s.credit_period ?? 0),
      notes: s.notes ?? '',
    });
    setShowModal(true);
  };

  const handleToggle = (s: Supplier) => toggleMutation.mutate(s);

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('suppliers', { defaultValue: 'Pharmacy Suppliers' })}</h1>
            <p className="section-subtitle mt-1">{t('suppliersSubtitle', { defaultValue: 'Manage medicine suppliers and vendors' })}</p>
          </div>
          <button onClick={() => { setEditing(null); setForm({...EMPTY}); setShowModal(true); }} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('addSupplier', { defaultValue: 'Add Supplier' })}
          </button>
        </div>

        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('name', { defaultValue: 'Name' })}</th>
                  <th>{t('contact', { defaultValue: 'Contact' })}</th>
                  <th>{t('city', { defaultValue: 'City' })}</th>
                  <th>{t('email', { defaultValue: 'Email' })}</th>
                  <th>{t('creditDays', { defaultValue: 'Credit (days)' })}</th>
                  <th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th>
                  <th className="text-right">{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  [...Array(4)].map((_, i) => (
                    <tr key={i}>
                      {[...Array(8)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}
                    </tr>
                  ))
                ) : suppliers.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-16 text-center text-[var(--color-text-muted)]">
                      {t('noSuppliers', { defaultValue: 'No suppliers yet. Click "Add Supplier" to create one.' })}
                    </td>
                  </tr>
                ) : (
                  suppliers.map((s, idx) => (
                    <tr key={s.id}>
                      <td className="text-[var(--color-text-muted)] text-sm">{idx + 1}</td>
                      <td className="font-medium">{s.name}</td>
                      <td>
                        {s.contact_no ? (
                          <a href={`tel:${s.contact_no}`} className="flex items-center gap-1 text-[var(--color-primary)] hover:underline">
                            <Phone className="w-3 h-3" />{s.contact_no}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="text-[var(--color-text-secondary)]">{s.city || '—'}</td>
                      <td>
                        {s.email ? (
                          <a href={`mailto:${s.email}`} className="flex items-center gap-1 text-[var(--color-primary)] hover:underline">
                            <Mail className="w-3 h-3" />{s.email}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="font-data text-center">{s.credit_period ?? 0}</td>
                      <td>
                        <span className={`badge ${s.is_active ? 'badge-success' : 'badge-secondary'}`}>
                          {s.is_active ? t('active', { ns: 'common' }) : t('inactive', { ns: 'common' })}
                        </span>
                      </td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <button onClick={() => openEdit(s)} className="btn-ghost p-1.5" title={t('edit', { ns: 'common' })}>
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleToggle(s)} className="btn-ghost p-1.5 text-xs">
                            {s.is_active ? t('deactivate') : t('activate')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Add / Edit Supplier Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{editing ? t('editSupplier') : t('addSupplier')}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div>
                  <label className="label">{t('supplierName')} *</label>
                  <input className="input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder={t('supplier.namePlaceholder')} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('contactNo')}</label>
                    <input className="input" value={form.contactNo} onChange={e => setForm({...form, contactNo: e.target.value})} placeholder={t('supplier.contactPlaceholder')} />
                  </div>
                  <div>
                    <label className="label">{t('email')}</label>
                    <input className="input" type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} placeholder={t('supplier.emailPlaceholder')} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('address')}</label><input className="input" value={form.address} onChange={e => setForm({...form, address: e.target.value})} /></div>
                  <div><label className="label">{t('city')}</label><input className="input" value={form.city} onChange={e => setForm({...form, city: e.target.value})} placeholder={t('supplier.cityPlaceholder')} /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className="label">{t('panNo')}</label><input className="input" value={form.panNo} onChange={e => setForm({...form, panNo: e.target.value})} /></div>
                  <div><label className="label">{t('creditPeriod')}</label><input className="input" type="number" min="0" value={form.creditPeriod} onChange={e => setForm({...form, creditPeriod: e.target.value})} /></div>
                </div>
                <div><label className="label">{t('notes')}</label><textarea className="input" rows={2} value={form.notes} onChange={e => setForm({...form, notes: e.target.value})} /></div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('cancel', { ns: 'common' })}</button>
                  <button type="submit" disabled={saving} className="btn-primary">{saving ? '...' : (editing ? t('update', { ns: 'common' }) : t('save', { ns: 'common' }))}</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

