import { CheckCircle2, Clock3, Edit3, HeartPulse, Loader2, Pill, Save, X } from 'lucide-react';
import type { TFunction } from 'i18next';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

export interface PatientWellnessHubState {
  medicationReminders: string[];
  dailyRoutines: string[];
  suggestedMedicationReminders: string[];
  suggestedDailyRoutines: string[];
  completedItems: string[];
  trackerDate: string;
  updatedAt: string | null;
}

export interface PatientWellnessHubDraft {
  medicationText: string;
  routineText: string;
}

interface Props {
  t: TFunction<'patients'>;
  loading: boolean;
  saving: boolean;
  syncingChecklist: boolean;
  editing: boolean;
  hub: PatientWellnessHubState | null;
  draft: PatientWellnessHubDraft;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onDraftChange: (next: PatientWellnessHubDraft) => void;
  onSave: () => void;
  onToggleItem: (item: string) => void;
  onUseSuggested: () => void;
}

function formatDate(value: string | null | undefined) {
  const formatted = formatPatientDateMonthYear(value, '');
  return formatted || null;
}

export default function PatientWellnessTrackerCard({
  t,
  loading,
  saving,
  syncingChecklist,
  editing,
  hub,
  draft,
  onStartEdit,
  onCancelEdit,
  onDraftChange,
  onSave,
  onToggleItem,
  onUseSuggested,
}: Props) {
  const medicationItems = hub?.medicationReminders ?? [];
  const routineItems = hub?.dailyRoutines ?? [];
  const combinedItems = [...medicationItems, ...routineItems];
  const suggestedMedicationItems = hub?.suggestedMedicationReminders ?? [];
  const suggestedRoutineItems = hub?.suggestedDailyRoutines ?? [];
  const hasSuggestions = suggestedMedicationItems.length > 0 || suggestedRoutineItems.length > 0;
  const isTrackerEmpty = combinedItems.length === 0;
  const completedCount = (hub?.completedItems ?? []).length;
  const completionPercent = combinedItems.length > 0
    ? Math.round((completedCount / combinedItems.length) * 100)
    : 0;

  return (
    <section>
      <div className="rounded-3xl border border-slate-100 bg-white p-8 shadow-[0_12px_40px_rgba(0,96,103,0.06)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-700">{t('patientDashboard.wellnessTracker.eyebrow')}</p>
            <h3 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900">{t('patientDashboard.wellnessTracker.title')}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">{t('patientDashboard.wellnessTracker.description')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-right">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-cyan-700">{t('patientDashboard.wellnessTracker.todayScore')}</p>
              <p className="mt-1 text-2xl font-black text-cyan-900">{completionPercent}%</p>
            </div>
            {!editing ? (
              <div className="flex flex-wrap gap-2">
                {hasSuggestions && isTrackerEmpty && (
                  <button
                    type="button"
                    onClick={onUseSuggested}
                    className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-cyan-700"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {t('patientDashboard.wellnessTracker.useAiButton')}
                  </button>
                )}
                <button
                  type="button"
                  onClick={onStartEdit}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50"
                >
                  <Edit3 className="h-4 w-4" />
                  {t('patientDashboard.wellnessTracker.editButton')}
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-slate-800 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  {t('patientDashboard.wellnessTracker.saveButton')}
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-all hover:bg-slate-50"
                >
                  <X className="h-4 w-4" />
                  {t('patientDashboard.wellnessTracker.cancelButton')}
                </button>
              </div>
            )}
          </div>
        </div>

        {editing ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-[1.75rem] border border-cyan-100 bg-cyan-50/70 p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Pill className="h-4 w-4 text-cyan-700" />
                {t('patientDashboard.wellnessTracker.medicineTitle')}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{t('patientDashboard.wellnessTracker.medicineHelp')}</p>
              <textarea
                value={draft.medicationText}
                onChange={(event) => onDraftChange({ ...draft, medicationText: event.target.value })}
                rows={5}
                className="mt-4 w-full rounded-2xl border border-cyan-100 bg-white px-4 py-3 text-sm text-slate-700 outline-none ring-0 placeholder:text-slate-400"
                placeholder={t('patientDashboard.wellnessTracker.medicinePlaceholder')}
              />
            </div>
            <div className="rounded-[1.75rem] border border-emerald-100 bg-emerald-50/70 p-5">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <HeartPulse className="h-4 w-4 text-emerald-700" />
                {t('patientDashboard.wellnessTracker.routineTitle')}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{t('patientDashboard.wellnessTracker.routineHelp')}</p>
              <textarea
                value={draft.routineText}
                onChange={(event) => onDraftChange({ ...draft, routineText: event.target.value })}
                rows={5}
                className="mt-4 w-full rounded-2xl border border-emerald-100 bg-white px-4 py-3 text-sm text-slate-700 outline-none ring-0 placeholder:text-slate-400"
                placeholder={t('patientDashboard.wellnessTracker.routinePlaceholder')}
              />
            </div>
          </div>
        ) : loading ? (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-cyan-600" />
            {t('patientDashboard.wellnessTracker.loading')}
          </div>
        ) : (
          <>
            {hasSuggestions && isTrackerEmpty && (
              <div className="mt-6 rounded-[1.75rem] border border-cyan-100 bg-cyan-50/70 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-700">{t('patientDashboard.wellnessTracker.suggestedTitle')}</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{t('patientDashboard.wellnessTracker.suggestedDescription')}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {[...suggestedMedicationItems, ...suggestedRoutineItems].slice(0, 5).map((item) => (
                    <span key={item} className="rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-cyan-700 shadow-sm">
                      {item}
                    </span>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={onUseSuggested}
                  className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white transition-all hover:bg-cyan-700"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {t('patientDashboard.wellnessTracker.useAiButton')}
                </button>
              </div>
            )}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-[1.75rem] border border-cyan-100 bg-cyan-50/70 p-5">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Pill className="h-4 w-4 text-cyan-700" />
                  {t('patientDashboard.wellnessTracker.medicineTitle')}
                </div>
                <div className="mt-4 space-y-2">
                  {medicationItems.length > 0 ? medicationItems.map((item) => {
                    const checked = hub?.completedItems.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => onToggleItem(item)}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-all ${
                          checked ? 'border-emerald-200 bg-white text-slate-500' : 'border-white bg-white/90 text-slate-800'
                        }`}
                      >
                        <CheckCircle2 className={`h-4 w-4 ${checked ? 'text-emerald-600' : 'text-slate-300'}`} />
                        <span className={checked ? 'line-through' : ''}>{item}</span>
                      </button>
                    );
                  }) : (
                    <p className="rounded-2xl bg-white/85 px-4 py-4 text-sm text-slate-500">{t('patientDashboard.wellnessTracker.medicineEmpty')}</p>
                  )}
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-emerald-100 bg-emerald-50/70 p-5">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Clock3 className="h-4 w-4 text-emerald-700" />
                  {t('patientDashboard.wellnessTracker.routineTitle')}
                </div>
                <div className="mt-4 space-y-2">
                  {routineItems.length > 0 ? routineItems.map((item) => {
                    const checked = hub?.completedItems.includes(item);
                    return (
                      <button
                        key={item}
                        type="button"
                        onClick={() => onToggleItem(item)}
                        className={`flex w-full items-center gap-3 rounded-2xl border px-4 py-3 text-left text-sm transition-all ${
                          checked ? 'border-emerald-200 bg-white text-slate-500' : 'border-white bg-white/90 text-slate-800'
                        }`}
                      >
                        <CheckCircle2 className={`h-4 w-4 ${checked ? 'text-emerald-600' : 'text-slate-300'}`} />
                        <span className={checked ? 'line-through' : ''}>{item}</span>
                      </button>
                    );
                  }) : (
                    <p className="rounded-2xl bg-white/85 px-4 py-4 text-sm text-slate-500">{t('patientDashboard.wellnessTracker.routineEmpty')}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-4 py-4">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{t('patientDashboard.wellnessTracker.todayTracker')}</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {t('patientDashboard.wellnessTracker.progressText', { done: completedCount, total: combinedItems.length })}
                </p>
              </div>
              <div className="text-right text-xs text-slate-500">
                <p>{syncingChecklist ? t('patientDashboard.wellnessTracker.syncing') : t('patientDashboard.wellnessTracker.tapToMark')}</p>
                {hub?.updatedAt && <p className="mt-1">{t('patientDashboard.wellnessTracker.updatedAt', { date: formatDate(hub.updatedAt) })}</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
