import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Brain, CheckCircle2, Dumbbell, Flame, Loader2, Salad, Sparkles, Star, Stethoscope, Sunrise, Target } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatPatientDateMonthYear, normalizePatientAiPlannerPayload, type PatientAiSavedPlan } from '../../lib/patientPortalUx';

function formatDate(value: string | null | undefined, _lang: string) {
  return formatPatientDateMonthYear(value, 'N/A');
}

function SectionCard({
  title,
  items,
  tone,
  icon,
}: {
  title: string;
  items: string[];
  tone: string;
  icon: ReactNode;
}) {
  if (!items.length) return null;
  return (
    <div className={`rounded-[1.5rem] border p-5 shadow-sm ${tone}`}>
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-2xl bg-white/80 p-2.5 shadow-sm">{icon}</div>
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
      </div>
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={`${title}-${index}`} className="rounded-2xl bg-white/80 px-4 py-3 text-sm text-slate-700">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function getMomentumLabel(percent: number, t: (key: string) => string) {
  if (percent >= 100) return t('aiPlanner.momentum.complete');
  if (percent >= 75) return t('aiPlanner.momentum.strong');
  if (percent >= 40) return t('aiPlanner.momentum.rhythm');
  if (percent > 0) return t('aiPlanner.momentum.start');
  return t('aiPlanner.momentum.ready');
}

function getMomentumTone(percent: number) {
  if (percent >= 75) return 'from-emerald-500 via-teal-500 to-cyan-500';
  if (percent >= 40) return 'from-cyan-500 via-sky-500 to-indigo-500';
  if (percent > 0) return 'from-amber-400 via-orange-400 to-rose-400';
  return 'from-slate-500 via-slate-400 to-slate-300';
}

function getCompletionMeta(plan: PatientAiSavedPlan | null) {
  const total = plan?.plan.action_checklist.length ?? 0;
  const completed = plan?.completed_items.length ?? 0;
  const percent = plan?.completion_percent ?? 0;
  const remaining = Math.max(0, total - completed);
  return { total, completed, percent, remaining };
}

function buildSmartFoodCards(plan: PatientAiSavedPlan | null) {
  if (!plan) return [];
  return [
    {
      title: 'eatMore',
      items: (plan.plan.eat_more ?? []).slice(0, 3),
      tone: 'border-emerald-100 bg-emerald-50/80',
    },
    {
      title: 'reduce',
      items: (plan.plan.avoid_or_reduce ?? []).slice(0, 3),
      tone: 'border-rose-100 bg-rose-50/80',
    },
  ].filter((card) => card.items.length > 0);
}

function buildRoutineMoments(plan: PatientAiSavedPlan | null, t: (key: string, options?: any) => string) {
  if (!plan) return [];
  const allItems = [...(plan.plan.daily_routine ?? []), ...(plan.plan.exercise_plan ?? [])].slice(0, 6);
  return allItems.map((item, index) => ({
    label: index === 0 ? t('aiPlanner.routine.start') : index === allItems.length - 1 ? t('aiPlanner.routine.finish') : t('aiPlanner.routine.step', { num: index + 1 }),
    item,
  }));
}

function buildDataInsightCards(plan: PatientAiSavedPlan | null, t: (key: string, options?: any) => string) {
  if (!plan?.source_snapshot) return [];

  const latestDoc = plan.source_snapshot.vault_documents?.[0];
  const latestVital = plan.source_snapshot.vitals?.[0];
  const latestLifestyle = plan.source_snapshot.lifestyle_logs?.[0];
  const insights: Array<{ title: string; value: string; note: string }> = [];

  if (latestDoc?.title) {
    insights.push({
      title: t('aiPlanner.insights.latestReport'),
      value: latestDoc.title,
      note: latestDoc.document_date || latestDoc.entered_at || t('aiPlanner.insights.recentlyAdded'),
    });
  }

  if (typeof latestVital?.blood_sugar === 'number' || (typeof latestVital?.systolic === 'number' && typeof latestVital?.diastolic === 'number')) {
    const value = typeof latestVital?.blood_sugar === 'number'
      ? t('aiPlanner.insights.sugarValue', { value: latestVital.blood_sugar })
      : t('aiPlanner.insights.bpValue', { sys: latestVital?.systolic, dia: latestVital?.diastolic });
    insights.push({
      title: t('aiPlanner.insights.recentVital'),
      value,
      note: latestVital?.logged_on || t('aiPlanner.insights.recentReading'),
    });
  }

  if (typeof latestLifestyle?.sleep_hours === 'number' || typeof latestLifestyle?.exercise_minutes === 'number') {
    const value = [
      typeof latestLifestyle?.sleep_hours === 'number' ? t('aiPlanner.insights.sleepValue', { count: latestLifestyle.sleep_hours }) : null,
      typeof latestLifestyle?.exercise_minutes === 'number' ? t('aiPlanner.insights.exerciseValue', { count: latestLifestyle.exercise_minutes }) : null,
    ].filter(Boolean).join(' • ');
    insights.push({
      title: t('aiPlanner.insights.lifestyleSignal'),
      value,
      note: latestLifestyle?.diet_notes || latestLifestyle?.logged_on || t('aiPlanner.insights.fromRecentLog'),
    });
  }

  return insights.slice(0, 3);
}

function buildConditionPlaybooks(plan: PatientAiSavedPlan | null, t: (key: string) => string) {
  if (!plan) return [];

  const focusText = [
    ...(plan.plan.focus_areas ?? []),
    ...(plan.plan.follow_up_actions ?? []),
    ...(plan.plan.warning_signs ?? []),
  ].join(' ').toLowerCase();
  const latestVital = plan.source_snapshot?.vitals?.[0];
  const latestLifestyle = plan.source_snapshot?.lifestyle_logs?.[0];
  const cards: Array<{ key: string; title: string; items: string[]; tone: string }> = [];

  const hasBloodSugarSignal =
    focusText.includes('sugar') ||
    focusText.includes('diabetes') ||
    typeof latestVital?.blood_sugar === 'number';
  if (hasBloodSugarSignal) {
    cards.push({
      key: 'sugar',
      title: t('aiPlanner.conditionCards.sugarTitle'),
      items: [
        t('aiPlanner.conditionCards.sugar1'),
        t('aiPlanner.conditionCards.sugar2'),
        t('aiPlanner.conditionCards.sugar3'),
      ],
      tone: 'border-emerald-100 bg-emerald-50/80',
    });
  }

  const hasBPSignal =
    focusText.includes('bp') ||
    focusText.includes('pressure') ||
    (typeof latestVital?.systolic === 'number' && typeof latestVital?.diastolic === 'number');
  if (hasBPSignal) {
    cards.push({
      key: 'bp',
      title: t('aiPlanner.conditionCards.bpTitle'),
      items: [
        t('aiPlanner.conditionCards.bp1'),
        t('aiPlanner.conditionCards.bp2'),
        t('aiPlanner.conditionCards.bp3'),
      ],
      tone: 'border-sky-100 bg-sky-50/80',
    });
  }

  const hasSleepSignal =
    focusText.includes('sleep') ||
    (typeof latestLifestyle?.sleep_hours === 'number' && latestLifestyle.sleep_hours < 7);
  if (hasSleepSignal) {
    cards.push({
      key: 'sleep',
      title: t('aiPlanner.conditionCards.sleepTitle'),
      items: [
        t('aiPlanner.conditionCards.sleep1'),
        t('aiPlanner.conditionCards.sleep2'),
        t('aiPlanner.conditionCards.sleep3'),
      ],
      tone: 'border-violet-100 bg-violet-50/80',
    });
  }

  const hasMovementSignal =
    focusText.includes('weight') ||
    focusText.includes('exercise') ||
    (typeof latestLifestyle?.exercise_minutes === 'number' && latestLifestyle.exercise_minutes < 20);
  if (hasMovementSignal) {
    cards.push({
      key: 'movement',
      title: t('aiPlanner.conditionCards.movementTitle'),
      items: [
        t('aiPlanner.conditionCards.movement1'),
        t('aiPlanner.conditionCards.movement2'),
        t('aiPlanner.conditionCards.movement3'),
      ],
      tone: 'border-amber-100 bg-amber-50/80',
    });
  }

  return cards.slice(0, 3);
}

function buildAdherenceCard(plan: PatientAiSavedPlan | null, t: (key: string, options?: any) => string) {
  const tracker = plan?.source_snapshot?.wellness_tracker;
  if (!tracker) return null;

  const adherence = Math.max(0, Math.min(100, Number(tracker.adherence_percent_today ?? 0)));
  const medsCount = tracker.medication_reminders?.length ?? 0;
  const routineCount = tracker.daily_routines?.length ?? 0;
  const completedCount = tracker.completed_items_today?.length ?? 0;

  const value = adherence > 0
    ? t('aiPlanner.adherence.followedToday', { percent: adherence })
    : t('aiPlanner.adherence.notStarted');

  const noteParts: string[] = [];
  if (medsCount > 0) noteParts.push(t('aiPlanner.adherence.medReminders', { count: medsCount }));
  if (routineCount > 0) noteParts.push(t('aiPlanner.adherence.routineSteps', { count: routineCount }));
  if (completedCount > 0) noteParts.push(t('aiPlanner.adherence.done', { count: completedCount }));

  return {
    title: t('aiPlanner.smartCards.adherenceTitle'),
    value,
    note: noteParts.join(' • ') || t('aiPlanner.smartCards.adherenceFallback'),
  };
}

export default function PatientAIPlannerTab() {
  const { t, i18n } = useTranslation('patients');
  const isBangla = i18n.language?.startsWith('bn');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [refining, setRefining] = useState(false);
  const [savingChecklist, setSavingChecklist] = useState(false);
  const [payload, setPayload] = useState(() => normalizePatientAiPlannerPayload(null));

  async function loadPlans() {
    setLoading(true);
    try {
      const response = await fetch('/api/global-portal/ai-plans', { credentials: 'include' });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((json as { error?: string; message?: string }).error || (json as { message?: string }).message || t('aiPlanner.loadFailed'));
      }
      setPayload(normalizePatientAiPlannerPayload(json as any));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('aiPlanner.loadFailed'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPlans();
  }, []);

  async function handleGenerate() {
    setGenerating(true);
    try {
      const response = await fetch('/api/global-portal/ai-plans/generate', {
        method: 'POST',
        credentials: 'include',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((json as { error?: string; message?: string }).error || (json as { message?: string }).message || t('aiPlanner.generateFailed'));
      }

      toast.success(t('aiPlanner.generateSuccess'));
      await loadPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('aiPlanner.generateFailed'));
    } finally {
      setGenerating(false);
    }
  }

  async function handleChecklistToggle(plan: PatientAiSavedPlan, item: string) {
    const completedItems = new Set(plan.completed_items ?? []);
    if (completedItems.has(item)) completedItems.delete(item);
    else completedItems.add(item);

    setSavingChecklist(true);
    try {
      const response = await fetch(`/api/global-portal/ai-plans/${plan.id}/checklist`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          completed_items: Array.from(completedItems),
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((json as { error?: string; message?: string }).error || (json as { message?: string }).message || t('aiPlanner.checklistSaveFailed'));
      }

      const updatedPlan = (json as { plan?: PatientAiSavedPlan }).plan;
      if (updatedPlan) {
        setPayload((current) => {
          const nextPlans = current.plans.map((existing) => existing.id === updatedPlan.id ? updatedPlan : existing);
          return {
            ...current,
            latestPlan: current.latestPlan?.id === updatedPlan.id ? updatedPlan : current.latestPlan,
            plans: nextPlans,
          };
        });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('aiPlanner.checklistSaveFailed'));
    } finally {
      setSavingChecklist(false);
    }
  }

  async function handleRefine(plan: PatientAiSavedPlan) {
    setRefining(true);
    try {
      const response = await fetch(`/api/global-portal/ai-plans/${plan.id}/refine`, {
        method: 'POST',
        credentials: 'include',
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((json as { error?: string; message?: string }).error || (json as { message?: string }).message || t('aiPlanner.refineFailed'));
      }

      toast.success(t('aiPlanner.refineSuccess'));
      await loadPlans();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('aiPlanner.refineFailed'));
    } finally {
      setRefining(false);
    }
  }

  const latestPlan = payload.latestPlan;
  const history = payload.plans;
  const completion = getCompletionMeta(latestPlan);
  const momentumLabel = getMomentumLabel(completion.percent, t);
  const momentumTone = getMomentumTone(completion.percent);
  const focusPreview = (latestPlan?.plan.focus_areas ?? []).slice(0, 3);
  const smartFoodCards = buildSmartFoodCards(latestPlan);
  const routineMoments = buildRoutineMoments(latestPlan, t);
  const adherenceCard = buildAdherenceCard(latestPlan, t);
  const dataInsights = [
    ...(adherenceCard ? [adherenceCard] : []),
    ...buildDataInsightCards(latestPlan, t),
  ].slice(0, 3);
  const conditionPlaybooks = buildConditionPlaybooks(latestPlan, (key) => t(key));

  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200/80 bg-white p-12 text-center">
        <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-[2rem] border border-cyan-100 bg-[radial-gradient(circle_at_top_left,_rgba(34,211,238,0.22),_transparent_28%),linear-gradient(135deg,_#ecfeff_0%,_#ffffff_42%,_#f0fdf4_100%)] p-8 shadow-[0_12px_40px_rgba(8,145,178,0.08)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-cyan-700 shadow-sm">
              <Sparkles className="h-4 w-4" />
              {t('aiPlanner.badge')}
            </div>
            <h2 className="text-3xl font-black tracking-tight text-slate-900">{latestPlan?.headline || t('aiPlanner.emptyTitle')}</h2>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-600">
              {latestPlan?.summary || t('aiPlanner.emptyDescription')}
            </p>
            <div className="mt-5 flex flex-wrap gap-3 text-xs">
              <span className="rounded-full bg-white/90 px-3 py-1.5 font-semibold text-slate-700">
                {t('aiPlanner.remainingToday')}: {payload.remainingGenerationsToday}/{payload.dailyLimit}
              </span>
              {latestPlan && (
                  <span>
                    {t('aiPlanner.lastGenerated')}: {formatDate(latestPlan.created_at, i18n.language)}
                  </span>
              )}
              {latestPlan && (
                <span className="rounded-full bg-white/90 px-3 py-1.5 font-semibold text-slate-700">
                  {t('aiPlanner.confidence')}: {latestPlan.confidence}
                </span>
              )}
            </div>

            {latestPlan && (
              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div className="rounded-[1.5rem] border border-white/70 bg-white/80 p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    <Target className="h-4 w-4 text-cyan-600" />
                    {t('aiPlanner.gamification.planScore')}
                  </div>
                  <div className="mt-3 text-3xl font-black tracking-tight text-slate-900">{completion.percent}%</div>
                  <p className="mt-1 text-xs text-slate-500">{momentumLabel}</p>
                </div>
                <div className="rounded-[1.5rem] border border-white/70 bg-white/80 p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    {t('aiPlanner.gamification.completedToday')}
                  </div>
                  <div className="mt-3 text-3xl font-black tracking-tight text-slate-900">{completion.completed}/{completion.total}</div>
                  <p className="mt-1 text-xs text-slate-500">{t('aiPlanner.gamification.tasksDone')}</p>
                </div>
                <div className="rounded-[1.5rem] border border-white/70 bg-white/80 p-4 shadow-sm">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                    <Flame className="h-4 w-4 text-amber-500" />
                    {t('aiPlanner.gamification.nextMilestone')}
                  </div>
                  <div className="mt-3 text-lg font-black tracking-tight text-slate-900">
                    {completion.remaining > 0 ? `${completion.remaining} ${t('aiPlanner.gamification.tasksRemaining')}` : t('aiPlanner.gamification.allTasksDone')}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{t('aiPlanner.gamification.keepMomentum')}</p>
                </div>
              </div>
            )}
          </div>

          <div className="w-full max-w-sm rounded-[1.75rem] border border-white/70 bg-white/80 p-5 shadow-lg backdrop-blur-sm">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">{t('aiPlanner.generateBoxTitle')}</p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">{t('aiPlanner.generateBoxDescription')}</p>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || refining || payload.remainingGenerationsToday <= 0}
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
              {payload.remainingGenerationsToday > 0 ? t('aiPlanner.generateButton') : t('aiPlanner.limitReached')}
            </button>
            {latestPlan && (
              <button
                type="button"
                onClick={() => void handleRefine(latestPlan)}
                disabled={generating || refining || payload.remainingGenerationsToday <= 0}
                className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:border-cyan-200 hover:bg-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refining ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t('aiPlanner.refineButton')}
              </button>
            )}
            <p className="mt-3 text-xs leading-relaxed text-slate-500">{t('aiPlanner.disclaimerShort')}</p>
          </div>
        </div>

        {latestPlan && (
          <div className="mt-8 grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.7fr]">
            <div className={`rounded-[1.75rem] bg-gradient-to-r ${momentumTone} p-[1px] shadow-lg`}>
              <div className="rounded-[1.7rem] bg-slate-950/90 p-6 text-white">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-100/80">{t('aiPlanner.gamification.momentumTitle')}</p>
                    <h3 className="mt-3 text-2xl font-black tracking-tight">{momentumLabel}</h3>
                    <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-200">
                      {completion.remaining > 0
                        ? t('aiPlanner.gamification.momentumBody', { count: completion.remaining })
                        : t('aiPlanner.gamification.momentumBodyDone')}
                    </p>
                  </div>
                  <div className="rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-white/90">
                    {completion.percent}%
                  </div>
                </div>
                <div className="mt-5 h-3 overflow-hidden rounded-full bg-white/10">
                  <div className={`h-full rounded-full bg-gradient-to-r ${momentumTone} transition-all`} style={{ width: `${completion.percent}%` }} />
                </div>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/70 bg-white/85 p-6 shadow-sm backdrop-blur-sm">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                <Star className="h-4 w-4 text-amber-500" />
                {t('aiPlanner.gamification.focusAreas')}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {focusPreview.map((focus) => (
                  <span key={focus} className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white">
                    {focus}
                  </span>
                ))}
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">
                {t('aiPlanner.gamification.focusBody')}
              </p>
            </div>
          </div>
        )}
      </section>

      {latestPlan && (
        <>
          {(smartFoodCards.length > 0 || routineMoments.length > 0 || dataInsights.length > 0) && (
            <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-[1.75rem] border border-amber-100 bg-[linear-gradient(135deg,_rgba(255,251,235,0.95),_rgba(255,255,255,0.98))] p-6 shadow-sm">
                <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-amber-700">
                  <Salad className="h-4 w-4" />
                  {t('aiPlanner.smartCards.foodTitle')}
                </div>
                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
                  {smartFoodCards.map((card) => (
                    <div key={card.title} className={`rounded-[1.5rem] border p-4 ${card.tone}`}>
                      <p className="text-sm font-bold text-slate-900">
                        {card.title === 'eatMore' ? t('aiPlanner.smartCards.eatMoreTitle') : t('aiPlanner.smartCards.reduceTitle')}
                      </p>
                      <div className="mt-3 space-y-2">
                        {card.items.map((item) => (
                          <div key={`${card.title}-${item}`} className="rounded-xl bg-white/80 px-3 py-2 text-sm text-slate-700">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-[1.75rem] border border-cyan-100 bg-[linear-gradient(135deg,_rgba(236,254,255,0.95),_rgba(255,255,255,0.98))] p-6 shadow-sm">
                  <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-700">
                    <Sunrise className="h-4 w-4" />
                    {t('aiPlanner.smartCards.routineTitle')}
                  </div>
                  <div className="mt-5 space-y-3">
                    {routineMoments.map((moment) => (
                      <div key={`${moment.label}-${moment.item}`} className="flex gap-3 rounded-[1.25rem] bg-white/85 px-4 py-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-100 text-xs font-black text-cyan-700">
                          {moment.label}
                        </div>
                        <div className="flex-1 text-sm font-medium leading-relaxed text-slate-700">{moment.item}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {dataInsights.length > 0 && (
                  <div className="rounded-[1.75rem] border border-violet-100 bg-[linear-gradient(135deg,_rgba(245,243,255,0.95),_rgba(255,255,255,0.98))] p-6 shadow-sm">
                    <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-violet-700">
                      <Brain className="h-4 w-4" />
                      {t('aiPlanner.smartCards.insightTitle')}
                    </div>
                    <div className="mt-5 grid grid-cols-1 gap-3">
                      {dataInsights.map((insight) => (
                        <div key={`${insight.title}-${insight.value}`} className="rounded-[1.25rem] bg-white/85 px-4 py-4">
                          <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{insight.title}</p>
                          <p className="mt-2 text-base font-black tracking-tight text-slate-900">{insight.value}</p>
                          <p className="mt-1 text-xs leading-relaxed text-slate-500">{insight.note}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {conditionPlaybooks.length > 0 && (
            <section className="rounded-[1.75rem] border border-slate-100 bg-[linear-gradient(135deg,_rgba(255,255,255,0.98),_rgba(248,250,252,0.95))] p-6 shadow-sm">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                <Star className="h-4 w-4 text-amber-500" />
                {t('aiPlanner.conditionCards.sectionTitle')}
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-3">
                {conditionPlaybooks.map((card) => (
                  <div key={card.key} className={`rounded-[1.5rem] border p-5 shadow-sm ${card.tone}`}>
                    <h3 className="text-base font-black tracking-tight text-slate-900">{card.title}</h3>
                    <div className="mt-4 space-y-2">
                      {card.items.map((item) => (
                        <div key={`${card.key}-${item}`} className="rounded-xl bg-white/80 px-3 py-3 text-sm font-medium leading-relaxed text-slate-700">
                          {item}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,_rgba(248,250,252,0.9),_rgba(255,255,255,0.98))] p-5 shadow-sm xl:col-span-2">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <div className="mb-3 flex items-center gap-3">
                    <div className="rounded-2xl bg-emerald-50 p-2.5">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-slate-900">{t('aiPlanner.cards.checklist')}</h3>
                      <p className="text-sm text-slate-500">{t('aiPlanner.checklistDescription')}</p>
                    </div>
                  </div>
                  <div className="text-xs font-semibold text-slate-500">
                    {t('aiPlanner.progressLabel')}: {latestPlan.completion_percent ?? 0}%
                  </div>
                </div>
                <div className="min-w-[12rem]">
                  <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all"
                      style={{ width: `${latestPlan.completion_percent ?? 0}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-2">
                {(latestPlan.plan.action_checklist ?? []).map((item) => {
                  const completed = (latestPlan.completed_items ?? []).includes(item);
                  return (
                    <button
                      key={item}
                      type="button"
                      onClick={() => void handleChecklistToggle(latestPlan, item)}
                      disabled={savingChecklist}
                      className={`group flex items-start gap-3 rounded-[1.25rem] border px-4 py-3 text-left transition ${
                        completed
                          ? 'border-emerald-200 bg-[linear-gradient(135deg,_rgba(236,253,245,0.95),_rgba(240,253,250,0.95))] text-emerald-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-200 hover:bg-cyan-50/60'
                      } ${savingChecklist ? 'cursor-wait opacity-70' : ''}`}
                    >
                      <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full border ${completed ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 bg-white text-transparent'}`}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </span>
                      <div className="flex-1">
                        <span className="text-sm font-medium leading-relaxed">{item}</span>
                        <div className={`mt-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${completed ? 'text-emerald-700' : 'text-slate-400 group-hover:text-cyan-600'}`}>
                          {completed ? t('aiPlanner.gamification.completedBadge') : t('aiPlanner.gamification.tapToComplete')}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <SectionCard
              title={t('aiPlanner.cards.eatMore')}
              items={latestPlan.plan.eat_more ?? []}
              tone="border-emerald-100 bg-emerald-50/70"
              icon={<Salad className="h-5 w-5 text-emerald-600" />}
            />
            <SectionCard
              title={t('aiPlanner.cards.avoid')}
              items={latestPlan.plan.avoid_or_reduce ?? []}
              tone="border-rose-100 bg-rose-50/70"
              icon={<AlertTriangle className="h-5 w-5 text-rose-600" />}
            />
            <SectionCard
              title={t('aiPlanner.cards.routine')}
              items={latestPlan.plan.daily_routine ?? []}
              tone="border-cyan-100 bg-cyan-50/70"
              icon={<Sunrise className="h-5 w-5 text-cyan-600" />}
            />
            <SectionCard
              title={t('aiPlanner.cards.exercise')}
              items={latestPlan.plan.exercise_plan ?? []}
              tone="border-violet-100 bg-violet-50/70"
              icon={<Dumbbell className="h-5 w-5 text-violet-600" />}
            />
            <SectionCard
              title={t('aiPlanner.cards.followUp')}
              items={latestPlan.plan.follow_up_actions ?? []}
              tone="border-amber-100 bg-amber-50/70"
              icon={<Stethoscope className="h-5 w-5 text-amber-600" />}
            />
            <SectionCard
              title={t('aiPlanner.cards.warningSigns')}
              items={latestPlan.plan.warning_signs ?? []}
              tone="border-orange-100 bg-orange-50/70"
              icon={<AlertTriangle className="h-5 w-5 text-orange-600" />}
            />
          </section>

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <SectionCard
              title={t('aiPlanner.cards.doctorAdvice')}
              items={latestPlan.plan.doctor_consultation_advice ?? []}
              tone="border-blue-100 bg-blue-50/70"
              icon={<Stethoscope className="h-5 w-5 text-blue-600" />}
            />
            <SectionCard
              title={t('aiPlanner.cards.dataGaps')}
              items={latestPlan.plan.data_gaps ?? []}
              tone="border-slate-200 bg-slate-50/80"
              icon={<Brain className="h-5 w-5 text-slate-600" />}
            />
          </section>

          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
            <p className="font-semibold text-slate-900">{t('aiPlanner.disclaimerTitle')}</p>
            <p className="mt-2 leading-relaxed">
              {latestPlan.plan.disclaimer || t('aiPlanner.disclaimerShort')}
            </p>
          </div>
        </>
      )}

      <section className="rounded-[2rem] border border-slate-100 bg-white p-6 shadow-[0_12px_40px_rgba(15,23,42,0.04)]">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-black text-slate-900">{t('aiPlanner.historyTitle')}</h3>
            <p className="mt-1 text-sm text-slate-500">{t('aiPlanner.historyDescription')}</p>
          </div>
          <div className="rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600">
            {history.length} {t('aiPlanner.historyCount')}
          </div>
        </div>

        {history.length === 0 ? (
          <div className="rounded-[1.5rem] border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
            {t('aiPlanner.noHistory')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {history.map((plan: PatientAiSavedPlan) => (
              <div key={plan.id} className="rounded-[1.5rem] border border-slate-100 bg-[linear-gradient(180deg,_rgba(248,250,252,0.9),_rgba(255,255,255,0.98))] p-5 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-base font-bold text-slate-900">{plan.headline}</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-600">{plan.summary}</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    {plan.confidence}
                  </span>
                </div>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-white px-3 py-1.5 font-semibold text-slate-600">
                    {formatDate(plan.created_at, i18n.language)}
                  </span>
                  {(plan.plan.focus_areas ?? []).slice(0, 2).map((area) => (
                    <span key={`${plan.id}-${area}`} className="rounded-full bg-cyan-50 px-3 py-1.5 font-semibold text-cyan-700">
                      {area}
                    </span>
                  ))}
                  <span className="rounded-full bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-700">
                    {t('aiPlanner.progressLabel')}: {plan.completion_percent ?? 0}%
                  </span>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full bg-gradient-to-r ${getMomentumTone(plan.completion_percent ?? 0)}`}
                    style={{ width: `${plan.completion_percent ?? 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
