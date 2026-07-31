import React, { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import toast from 'react-hot-toast';
import {
  useWellnessHub,
  useUpdateWellnessPreferences,
  useUpdateWellnessChecklist,
} from '../../hooks/usePatientWellness';
import PatientWellnessTrackerCard, {
  type PatientWellnessHubState,
  type PatientWellnessHubDraft,
} from './PatientWellnessTrackerCard';

export function WellnessHubSection() {
  const { t } = useTranslation('patients');
  const { data, isLoading } = useWellnessHub();
  const { mutate: updatePreferences, isPending: isUpdatingPrefs } = useUpdateWellnessPreferences();
  const { mutate: updateChecklist, isPending: isUpdatingChecklist } = useUpdateWellnessChecklist();

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PatientWellnessHubDraft>({ medicationText: '', routineText: '' });

  // Sync draft text when data lands (only if not actively editing)
  useEffect(() => {
    if (data && !editing) {
      setDraft({
        medicationText: (data.medication_reminders || []).join('\n'),
        routineText: (data.daily_routines || []).join('\n'),
      });
    }
  }, [data, editing]);

  const hubState: PatientWellnessHubState | null = data
    ? {
        medicationReminders: data.medication_reminders || [],
        dailyRoutines: data.daily_routines || [],
        suggestedMedicationReminders: data.suggested_medication_reminders || [],
        suggestedDailyRoutines: data.suggested_daily_routines || [],
        completedItems: data.completed_items || [],
        trackerDate: data.tracker_date,
        updatedAt: data.updated_at,
      }
    : null;

  const handleStartEdit = () => {
    setEditing(true);
  };

  const handleCancelEdit = () => {
    setDraft({
      medicationText: (data?.medication_reminders || []).join('\n'),
      routineText: (data?.daily_routines || []).join('\n'),
    });
    setEditing(false);
  };

  const handleSave = () => {
    const nextMeds = draft.medicationText
      .split('\n')
      .map((i) => i.trim())
      .filter(Boolean);
    const nextRoutines = draft.routineText
      .split('\n')
      .map((i) => i.trim())
      .filter(Boolean);

    updatePreferences(
      {
        medication_reminders: nextMeds,
        daily_routines: nextRoutines,
      },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success(t('patientDashboard.wellnessTracker.saveSuccess', 'Preferences updated successfully'));
        },
        onError: () => {
          toast.error(t('patientDashboard.wellnessTracker.saveFailed', 'Failed to save preferences'));
        },
      }
    );
  };

  const handleToggleItem = (item: string) => {
    if (!data) return;
    const completedItems = new Set(data.completed_items || []);
    if (completedItems.has(item)) {
      completedItems.delete(item);
    } else {
      completedItems.add(item);
    }

    updateChecklist(Array.from(completedItems), {
      onError: () => {
        toast.error(t('patientDashboard.wellnessTracker.checklistFailed', 'Failed to update tracker'));
      },
    });
  };

  const handleUseSuggested = () => {
    if (!data) return;
    const nextMeds = Array.from(
      new Set([...(data.medication_reminders || []), ...(data.suggested_medication_reminders || [])])
    );
    const nextRoutines = Array.from(
      new Set([...(data.daily_routines || []), ...(data.suggested_daily_routines || [])])
    );

    updatePreferences(
      {
        medication_reminders: nextMeds,
        daily_routines: nextRoutines,
      },
      {
        onSuccess: () => {
          toast.success(t('patientDashboard.wellnessTracker.aiAppliedSuccess', 'AI Plan applied to your daily tracker'));
        },
        onError: () => {
          toast.error(t('patientDashboard.wellnessTracker.aiAppliedFailed', 'Failed to apply AI Plan'));
        },
      }
    );
  };

  return (
    <PatientWellnessTrackerCard
      t={t}
      loading={isLoading}
      saving={isUpdatingPrefs}
      syncingChecklist={isUpdatingChecklist}
      editing={editing}
      hub={hubState}
      draft={draft}
      onStartEdit={handleStartEdit}
      onCancelEdit={handleCancelEdit}
      onDraftChange={setDraft}
      onSave={handleSave}
      onToggleItem={handleToggleItem}
      onUseSuggested={handleUseSuggested}
    />
  );
}
