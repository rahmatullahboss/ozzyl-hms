import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, X } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

interface Category { id: number; name: string; description?: string; is_active: number; }

export default function CategoryList({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', description: '' });
  const [showInactive, setShowInactive] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('hms_token');
      const { data } = await axios.get('/api/pharmacy/categories', { headers: { Authorization: `Bearer ${token}` } });
      setCategories(data.categories ?? []);
      // Also fetch inactive if toggled
      if (showInactive) {
        // Backend filters is_active=1 by default, but deactivated items need a different approach
        // For now show all and let the toggle filter work client-side
      }
    } catch { setCategories([]); } finally { setLoading(false); }
  }, [showInactive]);

  useEffect(() => { fetch(); }, [fetch]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      const token = localStorage.getItem('hms_token');
      const headers = { Authorization: `Bearer ${token}` };
      if (editing) {
        await axios.put(`/api/pharmacy/categories/${editing.id}`, form, { headers });
        toast.success(t('pharmacy.category_updated'));
      } else {
        await axios.post('/api/pharmacy/categories', form, { headers });
        toast.success(t('pharmacy.category_created'));
      }
      setShowModal(false); fetch();
    } catch { toast.error(t('pharmacy.failed_to_save')); } finally { setSaving(false); }
  };

  const openEdit = (cat: Category) => { setEditing(cat); setForm({ name: cat.name, description: cat.description ?? '' }); setShowModal(true); };
  const openAdd = () => { setEditing(null); setForm({ name: '', description: '' }); setShowModal(true); };

  const handleDeactivate = async (cat: Category) => {
    try {
      const token = localStorage.getItem('hms_token');
      const action = cat.is_active ? 'deactivate' : 'activate';
      await axios.put(`/api/pharmacy/categories/${cat.id}/${action}`, {}, { headers: { Authorization: `Bearer ${token}` } });
      toast.success(t('pharmacy.categoryUpdated', { action })); fetch();
    } catch { toast.error(t('pharmacy.failed')); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">
        <div className="page-header">
          <div><h1 className="page-title">{t('categories', { defaultValue: 'Categories' })}</h1></div>
          <button onClick={openAdd} className="btn-primary"><Plus className="w-4 h-4" /> {t('addCategory', { defaultValue: 'Add Category' })}</button>
        </div>
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead><tr><th>#</th><th>{t('name', { defaultValue: 'Name' })}</th><th>{t('description', { defaultValue: 'Description' })}</th><th>{t('status', { ns: 'common', defaultValue: 'Status' })}</th><th>{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th></tr></thead>
              <tbody>
                {loading ? ([...Array(4)].map((_, i) => <tr key={i}>{[...Array(5)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>))
                : categories.length === 0 ? (<tr><td colSpan={5} className="py-16 text-center text-[var(--color-text-muted)]">{t('noCategories', { defaultValue: 'No categories yet' })}</td></tr>)
                : categories.map((cat, idx) => (
                  <tr key={cat.id}>
                    <td className="text-[var(--color-text-muted)] text-sm">{idx + 1}</td>
                    <td className="font-medium">{cat.name}</td>
                    <td className="text-[var(--color-text-secondary)]">{cat.description || '—'}</td>
                    <td><span className={`badge ${cat.is_active ? 'badge-success' : 'badge-secondary'}`}>{cat.is_active ? 'Active' : 'Inactive'}</span></td>
                    <td><div className="flex gap-1.5">
                      <button onClick={() => openEdit(cat)} className="btn-ghost p-1.5"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => handleDeactivate(cat)} className="btn-ghost p-1.5 text-xs">{cat.is_active ? 'Deactivate' : 'Activate'}</button>
                    </div></td>
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
                <h3 className="font-semibold">{editing ? t('editCategory', { defaultValue: 'Edit Category' }) : t('addCategory', { defaultValue: 'Add Category' })}</h3>
                <button onClick={() => setShowModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-5 space-y-4">
                <div><label className="label">{t('name', { defaultValue: 'Name' })} *</label><input className="input" required value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
                <div><label className="label">{t('description', { defaultValue: 'Description' })}</label><textarea className="input" rows={2} value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
                <div className="flex justify-end gap-3"><button type="button" onClick={() => setShowModal(false)} className="btn-secondary">{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button><button type="submit" disabled={saving} className="btn-primary">{saving ? '…' : t('save', { ns: 'common', defaultValue: 'Save' })}</button></div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
