import { useState } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface Generic { id: number; name: string; description?: string; is_active: number; }

export default function GenericList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Generic | null>(null);
  const [form, setForm] = useState({ name: '', description: '' });

  // ── Query ────────────────────────────────────────────────────────────
  const { data, isLoading: loading } = useApiQuery<{ generics: Generic[] }>(
    queryKeys.pharmacy.generics(),
    '/api/pharmacy/generics',
  );
  const generics = data?.generics ?? [];

  // ── Mutations ────────────────────────────────────────────────────────
  const createMutation = useApiMutation<unknown, { name: string; description: string }>(
    'post',
    '/api/pharmacy/generics',
    {
      onSuccess: () => {
        toast.success(t('pharmacy.generic_created'));
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.all });
      },
      onError: () => { toast.error(t('pharmacy.failed_to_save')); },
    },
  );

  const updateMutation = useApiMutation<unknown, { id: number; name: string; description: string }>(
    'put',
    (vars) => `/api/pharmacy/generics/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('pharmacy.generic_updated'));
        setShowModal(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.all });
      },
      onError: () => { toast.error(t('pharmacy.failed_to_save')); },
    },
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({ id: editing.id, name: form.name, description: form.description });
    } else {
      createMutation.mutate({ name: form.name, description: form.description });
    }
  };

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">{t('generics', { defaultValue: 'Generic Names' })}</h1></div>
          <button onClick={() => { setEditing(null); setForm({ name: '', description: '' }); setShowModal(true); }} className="btn-primary"><Plus className="w-4 h-4" /> {t('addGeneric', { defaultValue: 'Add Generic' })}</button>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>#</th><th>{t('name', { defaultValue: 'Name' })}</th><th>{t('description', { defaultValue: 'Description' })}</th><th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th><th>{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th></tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : generics.length === 0 ? (<tr><td colSpan={5} className="py-16 text-center text-[var(--color-text-muted)]">{t('noGenerics', { defaultValue: 'No generics yet' })}</td></tr>)
                : generics.map((g, idx) => (
                  <tr key={g.id}>
                    <td className="text-[var(--color-text-muted)] text-sm">{idx + 1}</td>
                    <td className="font-medium">{g.name}</td>
                    <td className="text-[var(--color-text-secondary)]">{g.description || '—'}</td>
                    <td><span className={`badge ${g.is_active ? 'badge-success' : 'badge-secondary'}`}>{g.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td><button onClick={() => { setEditing(g); setForm({ name: g.name, description: g.description ?? '' }); setShowModal(true); }} className="btn-ghost p-1.5"><Pencil className="w-4 h-4" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-sm">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{editing ? t('editGeneric', { defaultValue: 'Edit Generic' }) : t('addGeneric', { defaultValue: 'Add Generic' })}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label">{t('name', { defaultValue: 'Name' })} *</label><input className="input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
                <div><label className="label">{t('description', { defaultValue: 'Description' })}</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button><button type="submit" disabled={saving} className="btn-primary">{saving ? '...' : t('save', { ns: 'common', defaultValue: 'Save' })}</button></div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
