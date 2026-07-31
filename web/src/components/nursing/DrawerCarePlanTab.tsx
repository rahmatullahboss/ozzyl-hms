import { useState } from 'react';
import { ClipboardList, Plus, X, RefreshCw, CheckCircle, Circle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { BedGridItem } from './WardBedGrid';

interface CarePlanItem {
  id: number;
  patient_id: number;
  problem: string;
  goal?: string;
  intervention?: string;
  evaluation?: string;
  status?: string;
  created_at: string;
}

interface DrawerCarePlanTabProps {
  bed: BedGridItem;
}

export default function DrawerCarePlanTab({ bed }: DrawerCarePlanTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ problem: '', goal: '', intervention: '' });

  const carePlanQuery = useApiQuery<{ Results?: CarePlanItem[] }>(
    queryKeys.nursing.carePlan(bed.patient_id!),
    `/api/nursing/care-plan?patient_id=${bed.patient_id}&limit=20`,
    { enabled: !!bed.patient_id },
  );
  const items = carePlanQuery.data?.Results ?? [];

  const createMutation = useApiMutation('post', '/api/nursing/care-plan', {
    onSuccess: () => {
      toast.success(t('drawer.carePlan.saved', { defaultValue: 'Care plan added' }));
      setForm({ problem: '', goal: '', intervention: '' });
      setShowForm(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.carePlan(bed.patient_id!) });
    },
    onError: (err) => toast.error(err.message || t('drawer.carePlan.failed', { defaultValue: 'Failed to save' })),
  });

  const updateMutation = useApiMutation('put', (vars: { id: number; status: string }) => `/api/nursing/care-plan/${vars.id}`, {
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.carePlan(bed.patient_id!) });
    },
    onError: () => toast.error(t('drawer.carePlan.updateFailed', { defaultValue: 'Failed to update status' })),
  });

  const deleteMutation = useApiMutation('delete', (id: number) => `/api/nursing/care-plan/${id}`, {
    onSuccess: () => {
      toast.success(t('common:deleted', { defaultValue: 'Deleted' }));
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.carePlan(bed.patient_id!) });
    },
    onError: () => toast.error(t('common:deleteFailed', { defaultValue: 'Delete failed' })),
  });

  const handleSave = () => {
    if (!form.problem.trim()) {
      toast.error(t('drawer.carePlan.problemRequired', { defaultValue: 'Problem is required' }));
      return;
    }
    createMutation.mutate({
      patient_id: bed.patient_id,
      problem: form.problem.trim(),
      goal: form.goal.trim() || undefined,
      intervention: form.intervention.trim() || undefined,
    });
  };

  const handleToggleStatus = (item: CarePlanItem) => {
    const newStatus = item.status === 'completed' ? 'active' : 'completed';
    updateMutation.mutate({ id: item.id, status: newStatus });
  };

  const handleDelete = (id: number) => {
    if (!confirm(t('common:confirmDelete', { defaultValue: 'Delete this record?' }))) return;
    deleteMutation.mutate(id);
  };

  return (
    <div className="space-y-4" data-testid="care-plan-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t('drawer.carePlan.title', { defaultValue: 'Care Plan' })}
        </h3>
        <div className="flex items-center gap-1">
          <button onClick={() => carePlanQuery.refetch()} className="btn-ghost p-1.5" aria-label="Refresh" data-testid="care-plan-refresh">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setShowForm(!showForm)}
            className="btn-ghost p-1.5 text-[var(--color-primary)]"
            aria-label="Add care plan"
            data-testid="add-care-plan-btn"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Quick Add Form */}
      {showForm && (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30 space-y-3" data-testid="care-plan-form">
          <div>
            <label className="label text-xs">{t('problem', { defaultValue: 'Problem' })} *</label>
            <textarea
              value={form.problem}
              onChange={e => setForm(f => ({ ...f, problem: e.target.value }))}
              rows={2}
              className="input resize-none text-sm"
              placeholder={t('placeholders.problem', { defaultValue: 'Patient problem or nursing diagnosis' })}
              data-testid="care-plan-problem-input"
            />
          </div>
          <div>
            <label className="label text-xs">{t('goal', { defaultValue: 'Goal' })}</label>
            <input
              type="text"
              value={form.goal}
              onChange={e => setForm(f => ({ ...f, goal: e.target.value }))}
              className="input text-sm"
              placeholder={t('placeholders.goal', { defaultValue: 'Expected outcome' })}
              data-testid="care-plan-goal-input"
            />
          </div>
          <div>
            <label className="label text-xs">{t('intervention', { defaultValue: 'Intervention' })}</label>
            <input
              type="text"
              value={form.intervention}
              onChange={e => setForm(f => ({ ...f, intervention: e.target.value }))}
              className="input text-sm"
              placeholder={t('placeholders.intervention', { defaultValue: 'Nursing intervention' })}
              data-testid="care-plan-intervention-input"
            />
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={() => { setShowForm(false); setForm({ problem: '', goal: '', intervention: '' }); }} className="btn-secondary text-xs">
              {t('common:cancel')}
            </button>
            <button
              onClick={handleSave}
              disabled={createMutation.isPending || !form.problem.trim()}
              className="btn-primary text-xs"
              data-testid="save-care-plan-btn"
            >
              {createMutation.isPending ? t('common:saving') : t('common:save')}
            </button>
          </div>
        </div>
      )}

      {/* Care Plan Items */}
      <div className="space-y-2" data-testid="care-plan-list">
        {carePlanQuery.isLoading ? (
          [...Array(3)].map((_, i) => (
            <div key={i} className="skeleton h-16 w-full rounded-lg" />
          ))
        ) : items.length === 0 ? (
          <div className="text-center py-6 text-[var(--color-text-muted)]" data-testid="care-plan-empty">
            <ClipboardList className="w-8 h-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">{t('drawer.carePlan.noItems', { defaultValue: 'No care plan items yet' })}</p>
          </div>
        ) : (
          items.map(item => {
            const isCompleted = item.status === 'completed';
            return (
              <div
                key={item.id}
                className={`p-3 rounded-lg border transition-colors group ${
                  isCompleted
                    ? 'border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/20'
                    : 'border-[var(--color-border)] hover:bg-[var(--color-border-light)]/20'
                }`}
                data-testid="care-plan-item"
              >
                <div className="flex items-start gap-2.5">
                  <button
                    onClick={() => handleToggleStatus(item)}
                    className="mt-0.5 flex-shrink-0"
                    data-testid="toggle-care-plan-status"
                  >
                    {isCompleted ? (
                      <CheckCircle className="w-5 h-5 text-emerald-500" />
                    ) : (
                      <Circle className="w-5 h-5 text-[var(--color-text-muted)] hover:text-[var(--color-primary)]" />
                    )}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium ${isCompleted ? 'line-through text-[var(--color-text-muted)]' : 'text-[var(--color-text)]'}`}>
                      {item.problem}
                    </p>
                    {item.goal && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        <span className="font-medium">{t('goal', { defaultValue: 'Goal' })}:</span> {item.goal}
                      </p>
                    )}
                    {item.intervention && (
                      <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                        <span className="font-medium">{t('intervention', { defaultValue: 'Intervention' })}:</span> {item.intervention}
                      </p>
                    )}
                    <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                      {item.created_at ? new Date(item.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="btn-ghost p-1 text-red-500 opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                    title={t('common:delete')}
                    data-testid="delete-care-plan-btn"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
