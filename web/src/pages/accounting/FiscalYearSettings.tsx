import { useState, useEffect } from 'react';
import {
  Calendar, Plus, X, Edit2, Power, PowerOff, RotateCcw,
  ChevronRight, AlertTriangle, Check
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';

interface FiscalYear {
  id: number;
  fiscal_year_name: string;
  start_date: string;
  end_date: string;
  prefix?: string;
  is_active: number;
  is_closed: number;
  created_at: string;
}

interface FiscalYearResponse {
  fiscalYears: FiscalYear[];
}

interface SingleFiscalYearResponse {
  fiscalYear: FiscalYear;
}

export default function FiscalYearSettings({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['accounting', 'common']);
  const queryClient = useQueryClient();

  const [showCreate, setShowCreate] = useState(false);
  const [editingFY, setEditingFY] = useState<FiscalYear | null>(null);
  const [showReopenModal, setShowReopenModal] = useState(false);
  const [reopenFY, setReopenFY] = useState<FiscalYear | null>(null);
  const [reopenRemark, setReopenRemark] = useState('');
  const [form, setForm] = useState({
    fiscalYearName: '',
    startDate: '',
    endDate: '',
    prefix: '',
  });

  const { data, isLoading, error } = useApiQuery<FiscalYearResponse>(
    queryKeys.accounting.fiscalYears(),
    '/api/fiscal-years',
  );

  const fiscalYears = data?.fiscalYears ?? [];
  const activeFY = fiscalYears.find(f => f.is_active);
  const closedFYs = fiscalYears.filter(f => f.is_closed);

  const createMutation = useApiMutation<unknown, {
    fiscalYearName: string;
    startDate: string;
    endDate: string;
    prefix?: string;
  }>(
    'post',
    '/api/fiscal-years',
    {
      onSuccess: () => {
        toast.success(t('fiscalYear.created', { defaultValue: 'Fiscal year created' }));
        setShowCreate(false);
        setForm({ fiscalYearName: '', startDate: '', endDate: '', prefix: '' });
        queryClient.invalidateQueries({ queryKey: ['fiscalYears'] });
      },
      onError: (err) => {
        toast.error(err.message ?? t('fiscalYear.failedCreate', { defaultValue: 'Failed to create fiscal year' }));
      },
    },
  );

  const updateMutation = useApiMutation<unknown, {
    id: number;
    fiscalYearName?: string;
    startDate?: string;
    endDate?: string;
  }>(
    'put',
    (v) => `/api/fiscal-years/${v.id}`,
    {
      onSuccess: () => {
        toast.success(t('fiscalYear.updated', { defaultValue: 'Fiscal year updated' }));
        setEditingFY(null);
        queryClient.invalidateQueries({ queryKey: ['fiscalYears'] });
      },
      onError: (err) => {
        toast.error(err.message ?? t('fiscalYear.failedUpdate', { defaultValue: 'Failed to update fiscal year' }));
      },
    },
  );

  const activateMutation = useApiMutation<unknown, number>(
    'put',
    (id) => `/api/fiscal-years/${id}/activate`,
    {
      onSuccess: () => {
        toast.success(t('fiscalYear.activated', { defaultValue: 'Fiscal year activated' }));
        queryClient.invalidateQueries({ queryKey: ['fiscalYears'] });
      },
      onError: (err) => {
        toast.error(err.message ?? t('fiscalYear.activateFailed', { defaultValue: 'Failed to activate' }));
      },
    },
  );

  const closeMutation = useApiMutation<unknown, number>(
    'put',
    (id) => `/api/fiscal-years/${id}/close`,
    {
      onSuccess: () => {
        toast.success(t('fiscalYear.closed', { defaultValue: 'Fiscal year closed' }));
        queryClient.invalidateQueries({ queryKey: ['fiscalYears'] });
      },
      onError: (err) => {
        toast.error(err.message ?? t('fiscalYear.closeFailed', { defaultValue: 'Failed to close' }));
      },
    },
  );

  const reopenMutation = useApiMutation<unknown, { id: number; remark: string }>(
    'put',
    (v) => `/api/fiscal-years/${v.id}/reopen`,
    {
      onSuccess: () => {
        toast.success(t('fiscalYear.reopened', { defaultValue: 'Fiscal year reopened' }));
        setShowReopenModal(false);
        setReopenFY(null);
        setReopenRemark('');
        queryClient.invalidateQueries({ queryKey: ['fiscalYears'] });
      },
      onError: (err) => {
        toast.error(err.message ?? t('fiscalYear.reopenFailed', { defaultValue: 'Failed to reopen' }));
      },
    },
  );

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      fiscalYearName: form.fiscalYearName,
      startDate: form.startDate,
      endDate: form.endDate,
      prefix: form.prefix || undefined,
    });
  };

  const handleUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingFY) return;
    updateMutation.mutate({
      id: editingFY.id,
      fiscalYearName: editingFY.fiscal_year_name,
      startDate: editingFY.start_date,
      endDate: editingFY.end_date,
    });
  };

  const handleActivate = (fy: FiscalYear) => {
    if (!confirm(t('fiscalYear.confirmActivate', { name: fy.fiscal_year_name, defaultValue: `Activate ${fy.fiscal_year_name}? This will deactivate all other fiscal years.` }))) return;
    activateMutation.mutate(fy.id);
  };

  const handleClose = (fy: FiscalYear) => {
    if (!confirm(t('fiscalYear.confirmClose', { name: fy.fiscal_year_name, defaultValue: `Close fiscal year ${fy.fiscal_year_name}? This action cannot be undone.` }))) return;
    closeMutation.mutate(fy.id);
  };

  const handleReopen = (fy: FiscalYear) => {
    setReopenFY(fy);
    setShowReopenModal(true);
  };

  const submitReopen = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reopenFY || !reopenRemark.trim()) return;
    reopenMutation.mutate({ id: reopenFY.id, remark: reopenRemark });
  };

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-xl mx-auto">
        {/* Header */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('fiscalYear.title', { defaultValue: 'Fiscal Year Management' })}</h1>
            <p className="section-subtitle mt-1">{t('fiscalYear.subtitle', { defaultValue: 'Manage accounting fiscal years, activation, and closure' })}</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary">
            <Plus className="w-4 h-4" /> {t('fiscalYear.addNew', { defaultValue: 'Add Fiscal Year' })}
          </button>
        </div>

        {/* Active FY Banner */}
        {activeFY && (
          <div className="card p-4 flex items-center justify-between bg-emerald-50 border-emerald-200">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500 flex items-center justify-center text-white">
                <Check className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm font-medium text-emerald-700">{t('fiscalYear.activeFY', { defaultValue: 'Active Fiscal Year' })}</p>
                <p className="text-lg font-semibold text-emerald-800">{activeFY.fiscal_year_name}</p>
                <p className="text-sm text-emerald-600">{formatDate(activeFY.start_date)} — {formatDate(activeFY.end_date)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditingFY(activeFY)}
                className="btn-secondary text-sm flex items-center gap-1.5"
              >
                <Edit2 className="w-3.5 h-3.5" /> {t('edit', { ns: 'common' })}
              </button>
              <button
                onClick={() => handleClose(activeFY)}
                className="btn-secondary text-sm flex items-center gap-1.5 text-amber-600 hover:text-amber-700"
              >
                <PowerOff className="w-3.5 h-3.5" /> {t('fiscalYear.close', { defaultValue: 'Close FY' })}
              </button>
            </div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="card p-4 border-red-200 bg-red-50 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <span className="text-red-700">{t('fiscalYear.loadFailed', { defaultValue: 'Failed to load fiscal years' })}</span>
          </div>
        )}

        {/* Fiscal Year List */}
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)]">
            <h2 className="font-semibold">{t('fiscalYear.allFY', { defaultValue: 'All Fiscal Years' })} ({fiscalYears.length})</h2>
          </div>
          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-8 text-center text-[var(--color-text-muted)]">
                {t('loading', { ns: 'common', defaultValue: 'Loading...' })}
              </div>
            ) : fiscalYears.length === 0 ? (
              <div className="p-12 text-center text-[var(--color-text-muted)]">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>{t('fiscalYear.noData', { defaultValue: 'No fiscal years found. Create one to get started.' })}</p>
              </div>
            ) : (
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('fiscalYear.name', { defaultValue: 'Name' })}</th>
                    <th>{t('fiscalYear.startDate', { defaultValue: 'Start Date' })}</th>
                    <th>{t('fiscalYear.endDate', { defaultValue: 'End Date' })}</th>
                    <th>{t('fiscalYear.prefix', { defaultValue: 'Prefix' })}</th>
                    <th>{t('fiscalYear.status', { defaultValue: 'Status' })}</th>
                    <th>{t('actions', { ns: 'common', defaultValue: 'Actions' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {fiscalYears.map(fy => (
                    <tr key={fy.id} className={fy.is_active ? 'bg-emerald-50/30' : ''}>
                      <td className="font-medium">
                        {fy.fiscal_year_name}
                        {fy.is_active && (
                          <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-emerald-100 text-emerald-700 font-medium">
                            {t('fiscalYear.active', { defaultValue: 'Active' })}
                          </span>
                        )}
                        {fy.is_closed && (
                          <span className="ml-2 px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 font-medium">
                            {t('fiscalYear.closed', { defaultValue: 'Closed' })}
                          </span>
                        )}
                      </td>
                      <td className="font-data text-sm">{fy.start_date}</td>
                      <td className="font-data text-sm">{fy.end_date}</td>
                      <td className="font-data text-sm text-[var(--color-text-muted)]">{fy.prefix || '—'}</td>
                      <td>
                        {fy.is_closed
                          ? <span className="text-gray-500 text-sm">{t('fiscalYear.statusClosed', { defaultValue: 'Closed' })}</span>
                          : fy.is_active
                          ? <span className="text-emerald-600 text-sm font-medium">{t('fiscalYear.statusActive', { defaultValue: 'Active' })}</span>
                          : <span className="text-gray-400 text-sm">{t('fiscalYear.statusInactive', { defaultValue: 'Inactive' })}</span>
                        }
                      </td>
                      <td>
                        <div className="flex items-center gap-1">
                          {!fy.is_closed && !fy.is_active && (
                            <button
                              onClick={() => handleActivate(fy)}
                              className="btn-ghost p-1.5 text-emerald-600"
                              title={t('fiscalYear.activate', { defaultValue: 'Activate' })}
                            >
                              <Power className="w-4 h-4" />
                            </button>
                          )}
                          {fy.is_closed && (
                            <button
                              onClick={() => handleReopen(fy)}
                              className="btn-ghost p-1.5 text-blue-600"
                              title={t('fiscalYear.reopen', { defaultValue: 'Reopen' })}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          )}
                          {!fy.is_closed && (
                            <button
                              onClick={() => setEditingFY(fy)}
                              className="btn-ghost p-1.5"
                              title={t('edit', { ns: 'common' })}
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Create Modal */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('fiscalYear.addNewTitle', { defaultValue: 'New Fiscal Year' })}</h3>
                <button onClick={() => setShowCreate(false)} className="btn-ghost p-1.5">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleCreate} className="p-5 space-y-4">
                <div>
                  <label className="label">{t('fiscalYear.name', { defaultValue: 'Fiscal Year Name' })} *</label>
                  <input
                    className="input"
                    required
                    placeholder={t('fiscalYear.namePlaceholder', { defaultValue: 'e.g. FY 2025-26' })}
                    value={form.fiscalYearName}
                    onChange={e => setForm({ ...form, fiscalYearName: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('fiscalYear.startDate', { defaultValue: 'Start Date' })} *</label>
                    <input
                      className="input"
                      type="date"
                      required
                      value={form.startDate}
                      onChange={e => setForm({ ...form, startDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">{t('fiscalYear.endDate', { defaultValue: 'End Date' })} *</label>
                    <input
                      className="input"
                      type="date"
                      required
                      value={form.endDate}
                      onChange={e => setForm({ ...form, endDate: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="label">{t('fiscalYear.prefix', { defaultValue: 'Prefix (Optional)' })}</label>
                  <input
                    className="input"
                    placeholder={t('fiscalYear.prefixPlaceholder', { defaultValue: 'e.g. FY25' })}
                    value={form.prefix}
                    onChange={e => setForm({ ...form, prefix: e.target.value })}
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowCreate(false)} className="btn-secondary">
                    {t('cancel', { ns: 'common' })}
                  </button>
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? t('fiscalYear.creating', { defaultValue: 'Creating...' }) : t('fiscalYear.create', { defaultValue: 'Create' })}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Edit Modal */}
        {editingFY && !showReopenModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('fiscalYear.editTitle', { defaultValue: 'Edit Fiscal Year' })}</h3>
                <button onClick={() => setEditingFY(null)} className="btn-ghost p-1.5">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={handleUpdate} className="p-5 space-y-4">
                <div>
                  <label className="label">{t('fiscalYear.name', { defaultValue: 'Name' })} *</label>
                  <input
                    className="input"
                    required
                    value={editingFY.fiscal_year_name}
                    onChange={e => setEditingFY({ ...editingFY, fiscal_year_name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('fiscalYear.startDate', { defaultValue: 'Start Date' })}</label>
                    <input
                      className="input"
                      type="date"
                      value={editingFY.start_date}
                      onChange={e => setEditingFY({ ...editingFY, start_date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">{t('fiscalYear.endDate', { defaultValue: 'End Date' })}</label>
                    <input
                      className="input"
                      type="date"
                      value={editingFY.end_date}
                      onChange={e => setEditingFY({ ...editingFY, end_date: e.target.value })}
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setEditingFY(null)} className="btn-secondary">
                    {t('cancel', { ns: 'common' })}
                  </button>
                  <button type="submit" disabled={saving} className="btn-primary">
                    {saving ? t('fiscalYear.saving', { defaultValue: 'Saving...' }) : t('update', { ns: 'common' })}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Reopen Modal */}
        {showReopenModal && reopenFY && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-md">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold">{t('fiscalYear.reopenTitle', { defaultValue: 'Reopen Fiscal Year' })}</h3>
                <button onClick={() => { setShowReopenModal(false); setReopenFY(null); setReopenRemark(''); }} className="btn-ghost p-1.5">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <form onSubmit={submitReopen} className="p-5 space-y-4">
                <div className="p-3 bg-blue-50 rounded-lg text-sm text-blue-700">
                  <p><strong>{reopenFY.fiscal_year_name}</strong></p>
                  <p>{formatDate(reopenFY.start_date)} — {formatDate(reopenFY.end_date)}</p>
                </div>
                <div>
                  <label className="label">{t('fiscalYear.remark', { defaultValue: 'Reason for Reopening' })} *</label>
                  <textarea
                    className="input min-h-[80px]"
                    required
                    placeholder={t('fiscalYear.remarkPlaceholder', { defaultValue: 'Enter reason for reopening...' })}
                    value={reopenRemark}
                    onChange={e => setReopenRemark(e.target.value)}
                  />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => { setShowReopenModal(false); setReopenFY(null); setReopenRemark(''); }} className="btn-secondary">
                    {t('cancel', { ns: 'common' })}
                  </button>
                  <button type="submit" disabled={reopenMutation.isPending || !reopenRemark.trim()} className="btn-primary">
                    {reopenMutation.isPending ? t('fiscalYear.reopening', { defaultValue: 'Reopening...' }) : t('fiscalYear.reopen', { defaultValue: 'Reopen FY' })}
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