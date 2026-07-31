import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X, Pencil, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';

interface TaxConfig {
  id: number;
  tax_name: string;
  tax_rate: number;
  tax_type: string;
  is_active: number;
}

type FormState = Omit<TaxConfig, 'id' | 'is_active'> & { is_active: boolean };

const EMPTY: FormState = { tax_name: '', tax_rate: 0, tax_type: 'percentage', is_active: true };

export default function TaxConfigPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('pharmacy');
  const [configs, setConfigs] = useState<TaxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const token = () => localStorage.getItem('hms_token');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/api/pharmacy/tax-config', { headers: { Authorization: `Bearer ${token()}` } });
      setConfigs(data.data ?? []);
    } catch { toast.error(t('pharmacy.failed_to_load_tax_configs')); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(EMPTY); setEditId(null); setShowModal(true); };
  const openEdit = (c: TaxConfig) => {
    setForm({ tax_name: c.tax_name, tax_rate: c.tax_rate, tax_type: c.tax_type, is_active: c.is_active === 1 });
    setEditId(c.id);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.tax_name) { toast.error(t('pharmacy.tax_name_is_required')); return; }
    setSaving(true);
    try {
      const payload = { ...form, is_active: form.is_active ? 1 : 0 };
      if (editId) {
        await axios.put(`/api/pharmacy/tax-config/${editId}`, payload, { headers: { Authorization: `Bearer ${token()}` } });
        toast.success(t('pharmacy.tax_config_updated'));
      } else {
        await axios.post('/api/pharmacy/tax-config', payload, { headers: { Authorization: `Bearer ${token()}` } });
        toast.success(t('pharmacy.tax_config_created'));
      }
      setShowModal(false);
      load();
    } catch { toast.error(t('pharmacy.failed_to_save_tax_config')); }
    finally { setSaving(false); }
  };

  const handleDeactivate = async (id: number) => {
    try {
      await axios.delete(`/api/pharmacy/tax-config/${id}`, { headers: { Authorization: `Bearer ${token()}` } });
      toast.success(t('pharmacy.tax_config_deactivated'));
      load();
    } catch { toast.error(t('pharmacy.failed_to_deactivate')); }
  };

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-3xl mx-auto">

        <div className="page-header">
          <div>
            <h1 className="page-title">Tax Configuration</h1>
            <p className="page-subtitle">Manage VAT, GST, and other tax rates for pharmacy billing</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> Add Tax
          </button>
        </div>

        <div className="card">
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
          ) : (
            <div className="table-responsive">
              <table className="table">
                <thead>
                  <tr>
                    <th>Tax Name</th>
                    <th className="text-right">Rate</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {configs.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-8 text-gray-400">
                      No tax configs yet. Click <strong>Add Tax</strong> to create one.
                    </td></tr>
                  )}
                  {configs.map(c => (
                    <tr key={c.id}>
                      <td className="font-medium">{c.tax_name}</td>
                      <td className="text-right">
                        {c.tax_type === 'percentage' ? `${c.tax_rate}%` : `৳${c.tax_rate}`}
                      </td>
                      <td className="capitalize text-sm text-gray-500">{c.tax_type}</td>
                      <td>
                        {c.is_active
                          ? <span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle className="h-4 w-4" /> Active</span>
                          : <span className="flex items-center gap-1 text-gray-400 text-sm"><XCircle className="h-4 w-4" /> Inactive</span>
                        }
                      </td>
                      <td>
                        <div className="flex justify-end gap-2">
                          <button className="btn btn-ghost btn-xs" onClick={() => openEdit(c)}>
                            <Pencil className="h-3 w-3" />
                          </button>
                          {c.is_active === 1 && (
                            <button className="btn btn-ghost btn-xs text-red-500" onClick={() => handleDeactivate(c.id)}>
                              <XCircle className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Info box */}
        <div className="card p-4 bg-blue-50 border border-blue-200">
          <p className="text-sm text-blue-700">
            <strong>How it works:</strong> Tax rates configured here are applied automatically when creating
            pharmacy invoices. Set VAT to <code className="bg-blue-100 px-1 rounded">0%</code> if your hospital is tax-exempt.
            Multiple tax configs can be active simultaneously (e.g., VAT + Surcharge).
          </p>
        </div>

        {/* Modal */}
        {showModal && (
          <div className="modal-overlay">
            <div className="modal max-w-md">
              <div className="modal-header">
                <h2 className="modal-title">{editId ? 'Edit Tax Config' : 'Add Tax Config'}</h2>
                <button className="btn btn-ghost btn-xs" onClick={() => setShowModal(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="modal-body space-y-4">
                <div>
                  <label className="form-label">{t("pharmacy.taxNameRequired")} <span className="text-red-500">*</span></label>
                  <input className="form-control" placeholder={t("pharmacy.taxNameExample")}
                    value={form.tax_name}
                    onChange={e => setForm(f => ({ ...f, tax_name: e.target.value }))}
                    required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">{t("pharmacy.rate")}</label>
                    <input type="number" step="0.01" min="0" className="form-control"
                      value={form.tax_rate}
                      onChange={e => setForm(f => ({ ...f, tax_rate: parseFloat(e.target.value) || 0 }))} />
                  </div>
                  <div>
                    <label className="form-label">{t("pharmacy.type")}</label>
                    <select className="form-control" value={form.tax_type}
                      onChange={e => setForm(f => ({ ...f, tax_type: e.target.value }))}>
                      <option value="percentage">Percentage (%)</option>
                      <option value="flat">Flat Amount (৳)</option>
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="checkbox"
                    checked={form.is_active}
                    onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} />
                  <span className="text-sm">Active</span>
                </label>
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    {editId ? 'Update' : 'Create'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
