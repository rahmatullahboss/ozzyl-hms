import { useState } from 'react';
import {
  Plus, X, Pencil, Trash2, Loader2, Pill
} from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import { api } from '../../lib/apiClient';

interface DosageTemplate {
  id: number;
  generic_id: number | null;
  generic_name: string | null;
  dosage_label: string;
  frequency: string;
  route: string;
  duration_days: number | null;
  notes: string | null;
  is_active: number;
}

type FormState = {
  generic_id: string; dosage_label: string; frequency: string;
  route: string; duration_days: string; notes: string;
};

interface DosagePayload {
  dosage_label: string;
  frequency: string;
  route: string;
  generic_id?: number;
  duration_days?: number;
  notes?: string;
}

const EMPTY: FormState = {
  generic_id: '', dosage_label: '', frequency: '', route: 'Oral', duration_days: '', notes: ''
};

const ROUTES = ['Oral', 'IV', 'IM', 'SC', 'Topical', 'Intranasal', 'Sublingual', 'Rectal', 'Ophthalmic', 'Otic'];
const COMMON_FREQUENCIES = [
  'Once Daily (OD)', 'Twice Daily (BD)', 'Thrice Daily (TDS)', 'Four Times Daily (QDS)',
  'Every 6 Hours (Q6H)', 'Every 8 Hours (Q8H)', 'Every 12 Hours (Q12H)',
  'Once Daily at Night (HS)', 'Once Weekly', 'As Needed (SOS / PRN)',
];
const COMMON_LABELS = [
  '1-0-0', '0-1-0', '0-0-1',
  '1-0-1', '1-1-0', '0-1-1',
  '1-1-1', '½-0-½', '1-1-1-1',
];

export default function DosageTemplatesPage({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['pharmacy', 'common']);
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);

  const { data, isLoading: loading } = useApiQuery<{ data: DosageTemplate[] }>(
    queryKeys.pharmacy.dosageTemplates(),
    '/api/pharmacy/dosage-templates',
  );
  const templates = data?.data ?? [];

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.pharmacy.dosageTemplates() });

  const createMutation = useApiMutation<unknown, DosagePayload>(
    'post', '/api/pharmacy/dosage-templates',
    {
      onSuccess: () => { toast.success(t('dosage.created', { defaultValue: 'Template created' })); invalidate(); setShowModal(false); },
      onError: () => { toast.error(t('dosage.failedSave', { defaultValue: 'Failed to save template' })); },
    },
  );

  const updateMutation = useMutation<unknown, Error, { id: number; payload: DosagePayload }>({
    mutationFn: ({ id, payload }) => api.put(`/api/pharmacy/dosage-templates/${id}`, payload),
    onSuccess: () => { toast.success(t('dosage.updated', { defaultValue: 'Template updated' })); invalidate(); setShowModal(false); },
    onError: () => { toast.error(t('dosage.failedSave', { defaultValue: 'Failed to save template' })); },
  });

  const deleteMutation = useApiMutation<unknown, number>(
    'delete',
    (id) => `/api/pharmacy/dosage-templates/${id}`,
    {
      onSuccess: () => { toast.success(t('dosage.deactivated', { defaultValue: 'Template deactivated' })); invalidate(); },
      onError: () => { toast.error(t('dosage.failedDelete', { defaultValue: 'Failed to delete template' })); },
    },
  );

  const saving = createMutation.isPending || updateMutation.isPending;

  const openCreate = () => { setForm(EMPTY); setEditId(null); setShowModal(true); };
  const openEdit = (tpl: DosageTemplate) => {
    setForm({
      generic_id: tpl.generic_id?.toString() ?? '',
      dosage_label: tpl.dosage_label,
      frequency: tpl.frequency,
      route: tpl.route,
      duration_days: tpl.duration_days?.toString() ?? '',
      notes: tpl.notes ?? '',
    });
    setEditId(tpl.id);
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.dosage_label || !form.frequency) {
      toast.error(t('dosage.labelFrequencyRequired', { defaultValue: 'Dosage label and frequency are required' }));
      return;
    }
    const payload: DosagePayload = {
      dosage_label: form.dosage_label,
      frequency: form.frequency,
      route: form.route,
      generic_id: form.generic_id ? parseInt(form.generic_id) : undefined,
      duration_days: form.duration_days ? parseInt(form.duration_days) : undefined,
      notes: form.notes || undefined,
    };
    if (editId) {
      updateMutation.mutate({ id: editId, payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const handleDelete = (id: number) => {
    if (!window.confirm(t('confirmDelete'))) return;
    deleteMutation.mutate(id);
  };

  // Group by generic
  const grouped = templates.reduce<Record<string, DosageTemplate[]>>((acc, tpl) => {
    const key = tpl.generic_name ?? 'General (All Generics)';
    if (!acc[key]) acc[key] = [];
    acc[key].push(tpl);
    return acc;
  }, {});

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-lg mx-auto">
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('dosage.title', { defaultValue: 'Dosage Templates' })}</h1>
            <p className="page-subtitle">{t('dosage.subtitle', { defaultValue: 'Predefined dosage labels, frequencies, and routes for dispensing' })}</p>
          </div>
          <button className="btn btn-primary btn-sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> {t('dosage.addTemplate', { defaultValue: 'Add Template' })}
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
        ) : templates.length === 0 ? (
          <div className="card p-12 text-center text-gray-400">
            <Pill className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p>{t('dosage.noTemplates', { defaultValue: 'No dosage templates yet. Create one to speed up dispensing.' })}</p>
          </div>
        ) : (
          Object.entries(grouped).map(([group, items]) => (
            <div key={group} className="card">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-700">{group}</p>
              </div>
              <div className="table-responsive">
                <table className="table">
                  <thead>
                    <tr>
                      <th>{t('dosage.label')}</th>
                      <th>{t('dosage.frequency')}</th>
                      <th>{t('dosage.route')}</th>
                      <th>{t('dosage.duration')}</th>
                      <th>{t('dosage.notes')}</th>
                      <th className="text-right">{t('actions', { ns: 'common' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(tpl => (
                      <tr key={tpl.id}>
                        <td>
                          <span className="font-mono bg-gray-100 text-gray-800 px-2 py-0.5 rounded text-sm">{tpl.dosage_label}</span>
                        </td>
                        <td className="text-sm">{tpl.frequency}</td>
                        <td>
                          <span className="badge badge-secondary text-xs">{tpl.route}</span>
                        </td>
                        <td className="text-sm text-gray-500">{tpl.duration_days ? `${tpl.duration_days} ${t('dosage.days', { defaultValue: 'days' })}` : '—'}</td>
                        <td className="text-sm text-gray-500 max-w-xs truncate">{tpl.notes || '—'}</td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <button className="btn btn-ghost btn-xs" onClick={() => openEdit(tpl)}>
                              <Pencil className="h-3 w-3" />
                            </button>
                            <button className="btn btn-ghost btn-xs text-red-500" onClick={() => handleDelete(tpl.id)}>
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}

        {/* Modal */}
        {showModal && (
          <div className="modal-overlay">
            <div className="modal max-w-lg">
              <div className="modal-header">
                <h2 className="modal-title">{editId ? t('dosage.editTemplate') : t('dosage.newTemplate')}</h2>
                <button className="btn btn-ghost btn-xs" onClick={() => setShowModal(false)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="modal-body space-y-4">

                <div>
                  <label className="form-label">{t('dosage.genericId', { defaultValue: 'Generic ID' })} <span className="text-gray-400 text-xs">({t('dosage.genericIdHint', { defaultValue: 'optional — leave blank for all generics' })})</span></label>
                  <input type="number" className="form-control" placeholder={t('dosage.genericIdPlaceholder', { defaultValue: 'e.g. 42' })}
                    value={form.generic_id} onChange={e => setForm(f => ({ ...f, generic_id: e.target.value }))} />
                </div>

                <div>
                  <label className="form-label">{t('dosage.label', { defaultValue: 'Dosage Label' })} <span className="text-red-500">*</span></label>
                  <div className="flex gap-2">
                    <input className="form-control flex-1" placeholder={t('dosage.labelPlaceholder', { defaultValue: 'e.g. 1-0-1 or "After meals"' })}
                      value={form.dosage_label} onChange={e => setForm(f => ({ ...f, dosage_label: e.target.value }))} />
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {COMMON_LABELS.map(l => (
                      <button key={l} type="button"
                        className="text-xs px-2 py-0.5 rounded bg-gray-100 hover:bg-primary hover:text-white transition-colors"
                        onClick={() => setForm(f => ({ ...f, dosage_label: l }))}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="form-label">{t('dosage.frequency', { defaultValue: 'Frequency' })} <span className="text-red-500">*</span></label>
                  <input list="freq-suggestions" className="form-control"
                    placeholder={t('dosage.frequencyPlaceholder', { defaultValue: 'e.g. Twice Daily (BD)' })} value={form.frequency}
                    onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))} />
                  <datalist id="freq-suggestions">
                    {COMMON_FREQUENCIES.map(f => <option key={f} value={f} />)}
                  </datalist>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label">{t('dosage.route', { defaultValue: 'Route' })}</label>
                    <select className="form-control" value={form.route}
                      onChange={e => setForm(f => ({ ...f, route: e.target.value }))}>
                      {ROUTES.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="form-label">{t('dosage.durationDays', { defaultValue: 'Duration (days)' })}</label>
                    <input type="number" min="1" className="form-control"
                      placeholder={t('dosage.durationPlaceholder', { defaultValue: 'Leave blank for open' })} value={form.duration_days}
                      onChange={e => setForm(f => ({ ...f, duration_days: e.target.value }))} />
                  </div>
                </div>

                <div>
                  <label className="form-label">{t('dosage.notes', { defaultValue: 'Notes' })}</label>
                  <textarea className="form-control" rows={2} placeholder={t('dosage.notesPlaceholder', { defaultValue: 'e.g. Take with food' })}
                    value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>{t('cancel', { ns: 'common', defaultValue: 'Cancel' })}</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                    {editId ? t('dosage.update', { defaultValue: 'Update' }) : t('dosage.create', { defaultValue: 'Create' })}
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
