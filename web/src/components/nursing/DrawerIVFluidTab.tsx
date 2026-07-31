import { useState } from 'react';
import { Droplets, Plus, RefreshCw, Play, CheckCircle, XCircle, Clock, Activity } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { BedGridItem } from './WardBedGrid';

interface IVFluid {
  id: number;
  patient_id: number;
  admission_id: number;
  fluid_name: string;
  volume_ml: number;
  drop_rate?: string;
  start_time: string;
  expected_end_time?: string;
  status: 'running' | 'completed' | 'stopped';
  remarks?: string;
}

interface DrawerIVFluidTabProps {
  bed: BedGridItem;
}

export default function DrawerIVFluidTab({ bed }: DrawerIVFluidTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    fluid_name: '',
    volume_ml: '',
    drop_rate: '',
    remarks: '',
  });

  const fluidsQuery = useApiQuery<{ Results?: IVFluid[] }>(
    queryKeys.nursing.ivDrugs(bed.patient_id!),
    `/api/nursing/iv-drugs?patient_id=${bed.patient_id}&admission_id=${bed.admission_id ?? ''}`,
    { enabled: !!bed.patient_id },
  );
  const fluids = fluidsQuery.data?.Results ?? [];

  const activeFluids = fluids.filter(f => f.status === 'running');
  const totalVolume = activeFluids.reduce((sum, f) => sum + f.volume_ml, 0);

  const createMutation = useApiMutation('post', '/api/nursing/iv-drugs', {
    onSuccess: () => {
      toast.success(t('ivFluid.started', { defaultValue: 'IV fluid started' }));
      setForm({ fluid_name: '', volume_ml: '', drop_rate: '', remarks: '' });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.ivDrugs(bed.patient_id!) });
    },
    onError: (err) => toast.error(err.message || t('ivFluid.failed', { defaultValue: 'Failed to start IV fluid' })),
  });

  const statusMutation = useApiMutation('patch', (vars: { id: number; status: string }) => `/api/nursing/iv-drugs/${vars.id}/status`, {
    onSuccess: () => {
      toast.success(t('ivFluid.statusUpdated', { defaultValue: 'Status updated' }));
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.ivDrugs(bed.patient_id!) });
    },
    onError: (err) => toast.error(err.message || t('ivFluid.statusFailed', { defaultValue: 'Failed to update status' })),
  });

  const handleStart = () => {
    if (!form.fluid_name.trim() || !form.volume_ml) {
      toast.error(t('ivFluid.fieldsRequired', { defaultValue: 'Fluid name and volume required' }));
      return;
    }
    createMutation.mutate({
      patient_id: bed.patient_id,
      admission_id: bed.admission_id ?? undefined,
      fluid_name: form.fluid_name.trim(),
      volume_ml: parseFloat(form.volume_ml),
      drop_rate: form.drop_rate || undefined,
      remarks: form.remarks || undefined,
    });
  };

  const handleStatusChange = (id: number, status: 'completed' | 'stopped') => {
    statusMutation.mutate({ id, status });
  };

  const statusBadge = (status: IVFluid['status']) => {
    const styles = {
      running: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      completed: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
      stopped: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    };
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${styles[status]}`}>
        {status === 'running' && <Play className="w-2.5 h-2.5" />}
        {status === 'completed' && <CheckCircle className="w-2.5 h-2.5" />}
        {status === 'stopped' && <XCircle className="w-2.5 h-2.5" />}
        {t(`ivFluid.status.${status}`, { defaultValue: status.charAt(0).toUpperCase() + status.slice(1) })}
      </span>
    );
  };

  return (
    <div className="space-y-4" data-testid="iv-fluid-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t('drawer.ivFluid.title', { defaultValue: 'IV Fluids' })}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => fluidsQuery.refetch()} className="btn-ghost p-1.5" aria-label="Refresh" data-testid="iv-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-ghost p-1.5 text-[var(--color-primary)]"
            aria-label="Start IV fluid"
            data-testid="add-iv-btn"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* IV Fluid Balance Summary */}
      {activeFluids.length > 0 && (
        <div className="grid grid-cols-2 gap-2" data-testid="iv-summary">
          <div className="bg-blue-50 dark:bg-blue-900/30 rounded-lg p-2 text-center">
            <Droplets className="w-4 h-4 text-blue-600 mx-auto mb-1" />
            <p className="text-sm font-bold text-blue-600">{activeFluids.length}</p>
            <p className="text-[10px] text-blue-500">{t('ivFluid.active', { defaultValue: 'Active' })}</p>
          </div>
          <div className="bg-cyan-50 dark:bg-cyan-900/30 rounded-lg p-2 text-center">
            <Activity className="w-4 h-4 text-cyan-600 mx-auto mb-1" />
            <p className="text-sm font-bold text-cyan-600">{totalVolume}<span className="text-[10px] font-normal ml-0.5">ml</span></p>
            <p className="text-[10px] text-cyan-500">{t('ivFluid.totalVolume', { defaultValue: 'Total Volume' })}</p>
          </div>
        </div>
      )}

      {/* Quick Add Form */}
      {showForm && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30 space-y-3" data-testid="iv-form">
          <div className="grid grid-cols-3 gap-2">
            <div className="col-span-2">
              <label className="label text-xs">{t('ivFluid.fluidName', { defaultValue: 'Fluid Name' })} *</label>
              <input
                type="text"
                value={form.fluid_name}
                onChange={e => setForm(f => ({ ...f, fluid_name: e.target.value }))}
                placeholder={t('ivFluid.fluidPlaceholder', { defaultValue: 'e.g., NS, DNS, RL' })}
                className="input text-sm"
                data-testid="iv-fluid-input"
              />
            </div>
            <div>
              <label className="label text-xs">{t('ivFluid.volume', { defaultValue: 'Volume (ml)' })} *</label>
              <input
                type="number"
                value={form.volume_ml}
                onChange={e => setForm(f => ({ ...f, volume_ml: e.target.value }))}
                className="input text-sm"
                data-testid="iv-volume-input"
              />
            </div>
          </div>

          <div>
            <label className="label text-xs">{t('ivFluid.dropRate', { defaultValue: 'Drop Rate' })}</label>
            <input
              type="text"
              value={form.drop_rate}
              onChange={e => setForm(f => ({ ...f, drop_rate: e.target.value }))}
              placeholder={t('ivFluid.dropRatePlaceholder', { defaultValue: 'e.g., 20 drops/min' })}
              className="input text-sm"
              data-testid="iv-drop-rate-input"
            />
          </div>

          <div>
            <label className="label text-xs">{t('ivFluid.remarks', { defaultValue: 'Remarks' })}</label>
            <input
              type="text"
              value={form.remarks}
              onChange={e => setForm(f => ({ ...f, remarks: e.target.value }))}
              className="input text-sm"
              data-testid="iv-remarks-input"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setForm({ fluid_name: '', volume_ml: '', drop_rate: '', remarks: '' }); }} className="btn-secondary text-xs">
              {t('common:cancel')}
            </button>
            <button
              onClick={handleStart}
              disabled={createMutation.isPending || !form.fluid_name.trim() || !form.volume_ml}
              className="btn-primary text-xs"
              data-testid="save-iv-btn"
            >
              {createMutation.isPending ? t('common:saving') : t('ivFluid.startBtn', { defaultValue: 'Start IV' })}
            </button>
          </div>
        </div>
      )}

      {/* IV Fluids List */}
      <div className="space-y-1.5" data-testid="iv-list">
        {fluidsQuery.isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-lg" />
          ))
        ) : fluids.length === 0 ? (
          <div className="text-center py-6 text-[var(--color-text-muted)]" data-testid="iv-empty">
            <Droplets className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('drawer.ivFluid.noRecords', { defaultValue: 'No IV fluids recorded' })}</p>
          </div>
        ) : (
          fluids.map(f => (
            <div
              key={f.id}
              className="p-3 rounded-lg border border-[var(--color-border)] hover:bg-[var(--color-border-light)]/20 transition-colors"
              data-testid="iv-item"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-[var(--color-text)]">{f.fluid_name}</p>
                    {statusBadge(f.status)}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {f.volume_ml} ml
                    </p>
                    {f.drop_rate && (
                      <p className="text-[10px] text-[var(--color-text-muted)]">
                        <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                        {f.drop_rate}
                      </p>
                    )}
                    <p className="text-[10px] text-[var(--color-text-muted)]">
                      {new Date(f.start_time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {f.expected_end_time && (
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      {t('ivFluid.expectedEnd', { defaultValue: 'Expected end' })}: {new Date(f.expected_end_time).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                  {f.remarks && (
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{f.remarks}</p>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              {f.status === 'running' && (
                <div className="flex gap-2 mt-2 pt-2 border-t border-[var(--color-border)]">
                  <button
                    onClick={() => handleStatusChange(f.id, 'completed')}
                    className="btn-ghost text-xs text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 flex items-center gap-1"
                    data-testid={`complete-iv-${f.id}`}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    {t('ivFluid.markCompleted', { defaultValue: 'Mark Completed' })}
                  </button>
                  <button
                    onClick={() => handleStatusChange(f.id, 'stopped')}
                    className="btn-ghost text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 flex items-center gap-1"
                    data-testid={`stop-iv-${f.id}`}
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    {t('ivFluid.stop', { defaultValue: 'Stop IV' })}
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
