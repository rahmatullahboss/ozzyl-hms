import { useState } from 'react';
import { UtensilsCrossed, CheckCircle, XCircle, AlertTriangle, Ban, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../../hooks/useApiQuery';
import { queryKeys } from '../../lib/queryKeys';
import type { BedGridItem } from './WardBedGrid';

interface DietType {
  id: number;
  diet_code: string;
  diet_name: string;
  display_order: number;
}

interface PatientDiet {
  id: number;
  patient_id: number;
  visit_id: number;
  diet_type_id: number;
  extra_diet: string | null;
  ward_id: number | null;
  remarks: string | null;
  recorded_on: string;
  diet_code: string;
  diet_name: string;
  patient_name: string;
  patient_code: string;
}

interface DrawerDietTabProps {
  bed: BedGridItem;
}

const QUICK_ACTIONS = [
  { key: 'given', label: 'Diet Given', icon: CheckCircle, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300' },
  { key: 'refused', label: 'Patient Refused', icon: XCircle, color: 'text-red-600 bg-red-50 dark:bg-red-900/30 dark:text-red-300' },
  { key: 'vomiting', label: 'Vomiting', icon: AlertTriangle, color: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30 dark:text-orange-300' },
  { key: 'npo', label: 'NPO Maintained', icon: Ban, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/30 dark:text-yellow-300' },
];

export default function DrawerDietTab({ bed }: DrawerDietTabProps) {
  const { t } = useTranslation(['nursing', 'common']);
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState('');

  const dietQuery = useApiQuery<{ Results: PatientDiet[] }>(
    queryKeys.nursing.diet(bed.patient_id!),
    `/api/nursing/diet-sheet?patient_id=${bed.patient_id}`,
    { enabled: !!bed.patient_id },
  );

  const dietTypesQuery = useApiQuery<{ Results: DietType[] }>(
    queryKeys.nursing.dietTypes(),
    '/api/nursing/diet-sheet/types',
  );

  const currentDiet = dietQuery.data?.Results?.[0];
  const dietTypes = dietTypesQuery.data?.Results ?? [];

  const createMutation = useApiMutation('post', '/api/nursing/diet-sheet', {
    onSuccess: () => {
      toast.success(t('drawer.diet.updated', { defaultValue: 'Diet status updated' }));
      setNotes('');
      queryClient.invalidateQueries({ queryKey: queryKeys.nursing.diet(bed.patient_id!) });
    },
    onError: (err) => toast.error(err.message || t('drawer.diet.failed', { defaultValue: 'Failed to update diet' })),
  });

  const handleQuickAction = (actionKey: string) => {
    if (!currentDiet) {
      toast.error(t('drawer.diet.noDietAssigned', { defaultValue: 'No diet assigned to patient' }));
      return;
    }
    const remarks = `[${actionKey.toUpperCase()}]${notes ? ` ${notes}` : ''}`;
    createMutation.mutate({
      patient_id: bed.patient_id,
      visit_id: bed.admission_id,
      diet_type_id: currentDiet.diet_type_id,
      remarks,
    });
  };

  const handleAssignDiet = (dietTypeId: number) => {
    createMutation.mutate({
      patient_id: bed.patient_id,
      visit_id: bed.admission_id,
      diet_type_id: dietTypeId,
      remarks: notes || undefined,
    });
  };

  return (
    <div className="space-y-4" data-testid="diet-tab">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {t('drawer.diet.title', { defaultValue: 'Diet & Nutrition' })}
        </h3>
        <button onClick={() => dietQuery.refetch()} className="btn-ghost p-1.5" aria-label="Refresh" data-testid="diet-refresh">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Current Diet */}
      {currentDiet ? (
        <div className="p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-border-light)]/30" data-testid="current-diet">
          <div className="flex items-center gap-2 mb-2">
            <UtensilsCrossed className="w-4 h-4 text-[var(--color-primary)]" />
            <span className="text-xs text-[var(--color-text-muted)] uppercase tracking-wide">{t('drawer.diet.currentDiet', { defaultValue: 'Current Diet' })}</span>
          </div>
          <p className="text-lg font-bold text-[var(--color-text)]">{currentDiet.diet_name}</p>
          {currentDiet.extra_diet && (
            <p className="text-sm text-[var(--color-text-secondary)] mt-1">{t('drawer.diet.extra', { defaultValue: 'Extra' })}: {currentDiet.extra_diet}</p>
          )}
          {currentDiet.remarks && (
            <p className="text-xs text-[var(--color-text-muted)] mt-1">{currentDiet.remarks}</p>
          )}
          <p className="text-[10px] text-[var(--color-text-muted)] mt-2">
            {currentDiet.recorded_on ? new Date(currentDiet.recorded_on).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
          </p>
        </div>
      ) : (
        <div className="text-center py-4 text-[var(--color-text-muted)]" data-testid="diet-empty">
          <UtensilsCrossed className="w-6 h-6 mx-auto mb-1.5 opacity-50" />
          <p className="text-sm">{t('drawer.diet.noDiet', { defaultValue: 'No diet assigned' })}</p>
        </div>
      )}

      {/* Quick Actions */}
      <div>
        <label className="label text-xs">{t('drawer.diet.quickActions', { defaultValue: 'Quick Actions' })}</label>
        <div className="grid grid-cols-2 gap-2">
          {QUICK_ACTIONS.map(action => {
            const Icon = action.icon;
            return (
              <button
                key={action.key}
                onClick={() => handleQuickAction(action.key)}
                disabled={createMutation.isPending || !currentDiet}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${action.color}`}
                data-testid={`diet-action-${action.key}`}
              >
                <Icon className="w-3.5 h-3.5" />
                {action.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Notes Input */}
      <div>
        <label className="label text-xs">{t('drawer.diet.notes', { defaultValue: 'Notes' })}</label>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder={t('drawer.diet.notesPlaceholder', { defaultValue: 'Optional notes...' })}
          className="input text-sm"
          data-testid="diet-notes"
        />
      </div>

      {/* Assign Diet Type */}
      {dietTypes.length > 0 && (
        <div>
          <label className="label text-xs">{t('drawer.diet.changeDiet', { defaultValue: 'Change Diet Type' })}</label>
          <div className="flex flex-wrap gap-1.5" data-testid="diet-types">
            {dietTypes.map(dt => (
              <button
                key={dt.id}
                onClick={() => handleAssignDiet(dt.id)}
                disabled={createMutation.isPending}
                className={`px-2 py-1 text-xs rounded-md border transition-colors disabled:opacity-50 ${
                  currentDiet?.diet_type_id === dt.id
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] font-medium'
                    : 'border-[var(--color-border)] hover:bg-[var(--color-border-light)]'
                }`}
                data-testid={`diet-type-${dt.diet_code}`}
              >
                {dt.diet_name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
