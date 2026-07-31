import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, CheckCircle2, HeartPulse, Loader2, Pill, Plus, ShieldCheck, ShieldAlert, UserRound, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { formatPatientDateMonthYear } from '../../lib/patientPortalUx';

interface ReportedData {
  id: number;
  category: 'allergy' | 'chronic_condition' | 'current_health_issue' | 'current_medication';
  name: string;
  severity: string | null;
  clinical_status: string;
  verification_status: string;
  start_date: string | null;
  notes: string | null;
  created_at: string;
}

type ReportedDataCategory = ReportedData['category'];
type ReportedFormCategory = ReportedDataCategory | 'adverse_reaction' | 'lifestyle_log' | 'vitals';

const DEFAULT_FORM_STATE = {
  category: 'allergy' as ReportedFormCategory,
  name: '',
  severity: 'mild',
  clinical_status: 'active',
  start_date: '',
  notes: '',
  reaction: '',
  outcome_status: '',
  sleep_hours: '',
  exercise_minutes: '',
  mood: '',
  energy_level: '',
  symptoms: '',
  diet_notes: '',
  logged_on: new Date().toISOString().split('T')[0],
  systolic: '',
  diastolic: '',
  heart_rate: '',
  blood_sugar: '',
  blood_sugar_context: '',
};

interface AdverseReaction {
  id: number;
  medication_name: string;
  generic_name: string | null;
  reaction: string;
  severity: string | null;
  onset_date: string | null;
  outcome_status: string | null;
  notes: string | null;
  source: string;
  review_status: string;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

interface LifestyleLog {
  id: number;
  logged_on: string;
  sleep_hours: number | null;
  exercise_minutes: number | null;
  mood: string | null;
  energy_level: string | null;
  symptom_score: number | null;
  symptoms: string | null;
  diet_notes: string | null;
  notes: string | null;
  source: string;
  review_status: string;
  reviewed_at: string | null;
  review_notes: string | null;
  created_at: string;
}

function renderStatusBadge(status: string, t: (key: string) => string) {
  if (status === 'confirmed' || status === 'verified') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
        <ShieldCheck className="h-3.5 w-3.5" />
        {t('status.doctorVerified')}
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
        <ShieldAlert className="h-3.5 w-3.5" />
        {t('status.needsCorrection')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
      <UserRound className="h-3.5 w-3.5" />
      {t('status.patientEntered')}
    </span>
  );
}

const ACTIVE_CARD_SCROLL_MARGIN_CLASS = 'scroll-mt-28 sm:scroll-mt-24';

export default function PatientReportedDataTab() {
  const { t } = useTranslation('patients');
  const [dataList, setDataList] = useState<ReportedData[]>([]);
  const [adverseReactions, setAdverseReactions] = useState<AdverseReaction[]>([]);
  const [lifestyleLogs, setLifestyleLogs] = useState<LifestyleLog[]>([]);
  const [vitalsLogs, setVitalsLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [inlineCategory, setInlineCategory] = useState<ReportedFormCategory | null>(null);
  const cardRefs = useRef(new Map<ReportedFormCategory, HTMLDivElement>());

  const [form, setForm] = useState(DEFAULT_FORM_STATE);

  async function fetchReportedData() {
    setLoading(true);
    try {
      const [reportedResponse, adverseResponse, lifestyleResponse, vitalsResponse] = await Promise.all([
        fetch('/api/patient-phr/reported-data', { credentials: 'include' }),
        fetch('/api/patient-phr/adverse-reactions', { credentials: 'include' }),
        fetch('/api/patient-phr/lifestyle-logs', { credentials: 'include' }),
        fetch('/api/patient-phr/vitals', { credentials: 'include' }),
      ]);
      if (!reportedResponse.ok || !adverseResponse.ok || !lifestyleResponse.ok || !vitalsResponse.ok) {
        throw new Error(t('reportedData.errors.fetchFailed'));
      }
      const reportedJson = await reportedResponse.json() as { reported_data: ReportedData[] };
      const adverseJson = await adverseResponse.json() as { adverse_reactions: AdverseReaction[] };
      const lifestyleJson = await lifestyleResponse.json() as { lifestyle_logs: LifestyleLog[] };
      const vitalsJson = await vitalsResponse.json() as { vitals: any[] };
      setDataList(reportedJson.reported_data ?? []);
      setAdverseReactions(adverseJson.adverse_reactions ?? []);
      setLifestyleLogs(lifestyleJson.lifestyle_logs ?? []);
      setVitalsLogs(vitalsJson.vitals ?? []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.error.system'));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void fetchReportedData();
  }, []);

  useEffect(() => {
    if (!inlineCategory) return;
    const activeCard = cardRefs.current.get(inlineCategory);
    if (!activeCard) return;

    window.requestAnimationFrame(() => {
      activeCard.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, [inlineCategory]);

  useEffect(() => {
    if (!showAddModal) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [showAddModal]);

  function resetForm(nextCategory: ReportedFormCategory = 'allergy') {
    setForm({
      ...DEFAULT_FORM_STATE,
      category: nextCategory,
      logged_on: new Date().toISOString().split('T')[0],
    });
  }

  function openInlineForm(category: ReportedFormCategory) {
    setInlineCategory((current) => {
      if (current === category) {
        resetForm('allergy');
        return null;
      }
      resetForm(category);
      return category;
    });
    setShowAddModal(false);
  }

  function openModalForCategory(category: ReportedFormCategory = 'allergy') {
    resetForm(category);
    setInlineCategory(null);
    setShowAddModal(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (['allergy', 'chronic_condition', 'current_health_issue', 'current_medication'].includes(form.category)) {
      if (!form.name.trim()) { toast.error(t('reportedData.errors.nameRequired')); return; }
    } else if (form.category === 'lifestyle_log') {
      if (!form.sleep_hours && !form.exercise_minutes && !form.symptoms.trim() && !form.notes.trim()) {
        toast.error(t('reportedData.errors.lifestyleRequired'));
        return;
      }
    } else if (form.category === 'vitals') {
      if (!form.systolic && !form.blood_sugar && !form.heart_rate) { toast.error(t('reportedData.errors.checkVitals')); return; }
    } else if (form.category === 'adverse_reaction') {
      if (!form.name.trim() || !form.reaction.trim()) { toast.error(t('reportedData.errors.medicineAndReactionRequired')); return; }
    }

    setIsSubmitting(true);
    try {
      let url = '/api/patient-phr/reported-data';
      let payload: any = {};

      if (['allergy', 'chronic_condition', 'current_health_issue', 'current_medication'].includes(form.category)) {
        payload = {
          category: form.category,
          name: form.name.trim(),
          severity: form.category === 'allergy' || form.category === 'current_health_issue' ? form.severity : null,
          clinical_status: form.clinical_status,
          start_date: form.start_date || null,
          notes: form.notes || null,
        };
      } else if (form.category === 'adverse_reaction') {
        url = '/api/patient-phr/adverse-reactions';
        payload = {
          medication_name: form.name.trim(),
          reaction: form.reaction.trim(),
          severity: form.severity,
          outcome_status: form.outcome_status || null,
          notes: form.notes || null,
        };
      } else if (form.category === 'lifestyle_log') {
        url = '/api/patient-phr/lifestyle-logs';
        payload = {
          logged_on: form.logged_on,
          sleep_hours: form.sleep_hours ? parseFloat(form.sleep_hours) : null,
          exercise_minutes: form.exercise_minutes ? parseInt(form.exercise_minutes) : null,
          mood: form.mood || null,
          energy_level: form.energy_level || null,
          symptoms: form.symptoms || null,
          diet_notes: form.diet_notes || null,
          notes: form.notes || null,
        };
      } else if (form.category === 'vitals') {
        url = '/api/patient-phr/vitals';
        payload = {
          logged_on: form.logged_on,
          systolic: form.systolic ? parseInt(form.systolic) : null,
          diastolic: form.diastolic ? parseInt(form.diastolic) : null,
          heart_rate: form.heart_rate ? parseInt(form.heart_rate) : null,
          blood_sugar: form.blood_sugar ? parseFloat(form.blood_sugar) : null,
          blood_sugar_context: form.blood_sugar_context || null,
          notes: form.notes || null,
        };
      }

      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) throw new Error(t('reportedData.errors.addFailed'));
      toast.success(t('toast.success.dataAdded'));
      setShowAddModal(false);
      setInlineCategory(null);
      resetForm();
      void fetchReportedData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('toast.error.submit'));
    } finally {
      setIsSubmitting(false);
    }
  }

  const getCategoryIcon = (cat: string) => {
    switch (cat) {
      case 'allergy': return <AlertTriangle className="w-5 h-5 text-rose-500" />;
      case 'current_medication': return <Pill className="w-5 h-5 text-cyan-500" />;
      case 'current_health_issue': return <AlertCircle className="w-5 h-5 text-amber-500" />;
      default: return <HeartPulse className="w-5 h-5 text-violet-500" />;
    }
  };

  const categories = [
    {
      id: 'chronic_condition',
      label: t('reportedData.categories.chronicConditions'),
      description: t('reportedData.categoryDescriptions.chronicConditions'),
      color: 'violet',
    },
    {
      id: 'current_health_issue',
      label: t('reportedData.categories.currentHealthIssues'),
      description: t('reportedData.categoryDescriptions.currentHealthIssues'),
      color: 'amber',
    },
    {
      id: 'allergy',
      label: t('reportedData.categories.allergies'),
      description: t('reportedData.categoryDescriptions.allergies'),
      color: 'rose',
    },
    {
      id: 'current_medication',
      label: t('reportedData.categories.medications'),
      description: t('reportedData.categoryDescriptions.medications'),
      color: 'cyan',
    },
  ] as const;

  function getNamePlaceholder(category: ReportedDataCategory) {
    switch (category) {
      case 'allergy':
        return t('placeholders.allergyExample');
      case 'current_medication':
        return t('placeholders.medicationExample');
      case 'current_health_issue':
        return t('placeholders.currentIssueExample');
      default:
        return t('placeholders.diseaseExample');
    }
  }

  function getInlineCardTitle(category: ReportedFormCategory) {
    switch (category) {
      case 'adverse_reaction':
        return t('reportedData.adverseReactions.title');
      case 'lifestyle_log':
        return t('reportedData.lifestyleLogs.title');
      case 'vitals':
        return t('reportedData.vitals.title');
      default:
        return t('reportedData.modal.title');
    }
  }

  function renderInlineForm(category: ReportedFormCategory) {
    if (inlineCategory !== category) return null;

    return (
      <form onSubmit={handleSubmit} className="mb-4 rounded-2xl border border-cyan-100 bg-white/90 p-4 shadow-sm dark:border-cyan-900/60 dark:bg-slate-950/80">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{getInlineCardTitle(category)}</p>
            <button
              type="button"
              onClick={() => {
                setInlineCategory(null);
                resetForm();
              }}
              className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              aria-label={t('common.cancel')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {['allergy', 'chronic_condition', 'current_health_issue', 'current_medication'].includes(category) && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.nameTitle')}</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={getNamePlaceholder(category as ReportedDataCategory)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>

              {(category === 'allergy' || category === 'current_health_issue') && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.severity')}</label>
                  <select
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="mild">{t('severity.mild')}</option>
                    <option value="moderate">{t('severity.moderate')}</option>
                    <option value="severe">{t('severity.severe')}</option>
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.currentStatus')}</label>
                  <select
                    value={form.clinical_status}
                    onChange={(e) => setForm({ ...form, clinical_status: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="active">{t('statusOptions.active')}</option>
                    <option value="inactive">{t('statusOptions.inactive')}</option>
                    <option value="resolved">{t('statusOptions.resolved')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.startDate')}</label>
                  <input
                    type="date"
                    value={form.start_date}
                    onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
            </>
          )}

          {category === 'adverse_reaction' && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.medicineName')}</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t('placeholders.medicationExample')}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.reaction')}</label>
                <input
                  required
                  value={form.reaction}
                  onChange={(e) => setForm({ ...form, reaction: e.target.value })}
                  placeholder={t('placeholders.reactionExample')}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.severity')}</label>
                  <select
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="mild">{t('severity.mild')}</option>
                    <option value="moderate">{t('severity.moderate')}</option>
                    <option value="severe">{t('severity.severe')}</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.currentStatus')}</label>
                  <select
                    value={form.outcome_status}
                    onChange={(e) => setForm({ ...form, outcome_status: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                  >
                    <option value="">{t('placeholders.select')}</option>
                    <option value="ongoing">{t('outcomeStatus.ongoing')}</option>
                    <option value="resolved">{t('outcomeStatus.resolved')}</option>
                    <option value="required_treatment">{t('outcomeStatus.requiredTreatment')}</option>
                    <option value="hospitalized">{t('outcomeStatus.hospitalized')}</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {category === 'lifestyle_log' && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.date')}</label>
                <input
                  type="date"
                  required
                  value={form.logged_on}
                  onChange={(e) => setForm({ ...form, logged_on: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.lifestyle.sleep')}</label>
                  <input
                    type="number"
                    step="0.5"
                    value={form.sleep_hours}
                    onChange={(e) => setForm({ ...form, sleep_hours: e.target.value })}
                    placeholder={t('reportedData.placeholders.sleepHours')}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.lifestyle.exercise')}</label>
                  <input
                    type="number"
                    value={form.exercise_minutes}
                    onChange={(e) => setForm({ ...form, exercise_minutes: e.target.value })}
                    placeholder={t('reportedData.placeholders.exerciseMinutes')}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.lifestyle.mood')}</label>
                  <input
                    value={form.mood}
                    onChange={(e) => setForm({ ...form, mood: e.target.value })}
                    placeholder={t('reportedData.placeholders.mood')}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.lifestyle.energy')}</label>
                  <input
                    value={form.energy_level}
                    onChange={(e) => setForm({ ...form, energy_level: e.target.value })}
                    placeholder={t('reportedData.placeholders.energy')}
                    className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.symptoms')}</label>
                <textarea
                  rows={2}
                  value={form.symptoms}
                  onChange={(e) => setForm({ ...form, symptoms: e.target.value })}
                  placeholder={t('reportedData.placeholders.symptoms')}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
            </>
          )}

          {category === 'vitals' && (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.date')}</label>
                <input
                  type="date"
                  required
                  value={form.logged_on}
                  onChange={(e) => setForm({ ...form, logged_on: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <input
                  type="number"
                  placeholder={t('reportedData.vitals.systolic')}
                  value={form.systolic}
                  onChange={(e) => setForm({ ...form, systolic: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  type="number"
                  placeholder={t('reportedData.vitals.diastolic')}
                  value={form.diastolic}
                  onChange={(e) => setForm({ ...form, diastolic: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  type="number"
                  placeholder={t('reportedData.vitals.heartRate')}
                  value={form.heart_rate}
                  onChange={(e) => setForm({ ...form, heart_rate: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
                <input
                  type="number"
                  step="0.1"
                  placeholder={t('reportedData.vitals.bloodSugar')}
                  value={form.blood_sugar}
                  onChange={(e) => setForm({ ...form, blood_sugar: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                />
                <select
                  value={form.blood_sugar_context}
                  onChange={(e) => setForm({ ...form, blood_sugar_context: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="">{t('reportedData.vitals.sugarContext')}</option>
                  <option value="fasting">{t('sugarContext.fasting')}</option>
                  <option value="post_prandial">{t('sugarContext.postPrandial')}</option>
                  <option value="random">{t('sugarContext.random')}</option>
                </select>
              </div>
            </>
          )}

          {category !== 'vitals' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{t('reportedData.modal.notesOptional')}</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder={t('placeholders.notesDetailed')}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20 dark:border-slate-700 dark:bg-slate-950"
              />
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <button
              type="button"
              onClick={() => {
                setInlineCategory(null);
                resetForm();
              }}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:opacity-95 disabled:opacity-70 dark:bg-white dark:text-slate-900"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {isSubmitting ? t('reportedData.modal.saving') : t('reportedData.quickAdd.saveFromCard')}
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <div className="bg-white rounded-[2rem] p-6 sm:p-8 shadow-[0_12px_40px_rgba(8,145,178,0.06)] border border-slate-100 space-y-8 animate-fade-in-up animate-in fade-in duration-500">
      {/* Header Area */}
      <div className="rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 sm:p-8 shadow-sm backdrop-blur-md relative overflow-hidden flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div className="absolute -right-12 -top-12 w-48 h-48 bg-cyan-700/10 rounded-full blur-2xl"></div>
        <div className="absolute -left-12 -bottom-12 w-48 h-48 bg-violet-700/10 rounded-full blur-2xl"></div>
        <div className="relative z-10">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-600 dark:text-cyan-400">{t('reportedData.header.phrLabel')}</p>
          <h2 className="mt-2 text-2xl sm:text-3xl font-bold font-manrope text-slate-900 dark:text-white">{t('reportedData.header.title')}</h2>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 max-w-lg">
            {t('reportedData.header.description')}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {renderStatusBadge('pending_review', t)}
            {renderStatusBadge('verified', t)}
            {renderStatusBadge('rejected', t)}
          </div>
        </div>
        <button
          onClick={() => openModalForCategory('allergy')}
          className="relative z-10 shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-cyan-600 text-white font-bold hover:bg-cyan-700 transition shadow-lg shadow-cyan-500/20"
        >
          <Plus className="w-5 h-5" strokeWidth={3} />
          {t('reportedData.addHealthLog')}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-cyan-600" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
          {categories.map(cat => {
            const items = dataList.filter(d => d.category === cat.id);
            const isInlineOpen = inlineCategory === cat.id;
            return (
              <div
                key={cat.id}
                ref={(node) => {
                  if (node) {
                    cardRefs.current.set(cat.id, node);
                    return;
                  }
                  cardRefs.current.delete(cat.id);
                }}
                className={`${ACTIVE_CARD_SCROLL_MARGIN_CLASS} rounded-[1.5rem] border p-6 shadow-sm backdrop-blur-md transition ${isInlineOpen ? 'border-cyan-300 bg-cyan-50/60 dark:border-cyan-700 dark:bg-cyan-950/10 shadow-lg shadow-cyan-500/10' : 'border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 hover:shadow-md'}`}
              >
                <div className="flex items-start gap-3 mb-4">
                  <div className={`p-2.5 rounded-xl bg-${cat.color}-50 dark:bg-${cat.color}-950/30`}>
                    {getCategoryIcon(cat.id)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold font-manrope text-slate-900 dark:text-white">{cat.label}</h3>
                      <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                        {items.length}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{cat.description}</p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => openInlineForm(cat.id)}
                  className={`mb-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${isInlineOpen ? 'border-cyan-600 bg-cyan-600 text-white hover:bg-cyan-700' : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-700 dark:hover:text-cyan-300'}`}
                >
                  <Plus className="h-4 w-4" />
                  {isInlineOpen ? t('reportedData.quickAdd.closeInline') : t('reportedData.quickAdd.addHere')}
                </button>

                {renderInlineForm(cat.id)}

                <div className="space-y-3">
                  {items.length === 0 ? (
                    <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">{t('reportedData.quickAdd.emptyForCategory')}</p>
                  ) : items.map(item => (
                    <div key={item.id} className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 relative overflow-hidden group">
                      <div className="mb-2">{renderStatusBadge(item.verification_status === 'confirmed' ? 'verified' : item.verification_status, t)}</div>
                      <p className="font-semibold text-slate-900 dark:text-white">{item.name}</p>

                      <div className="flex flex-wrap gap-2 mt-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium uppercase ${item.clinical_status === 'active' ? 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300' : 'bg-slate-200 text-slate-600'}`}>
                          {item.clinical_status}
                        </span>
                        {item.severity && (
                          <span className="text-[10px] px-2 py-0.5 rounded-md font-medium uppercase bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400">
                            {item.severity}
                          </span>
                        )}
                        {item.start_date && (
                          <span className="text-xs text-slate-500 py-0.5 border-l border-slate-300 dark:border-slate-700 pl-2">
                            {t('reportedData.since')}: {formatPatientDateMonthYear(item.start_date)}
                          </span>
                        )}
                      </div>
                      {item.notes && (
                        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-900 p-2 rounded-lg italic">
                          "{item.notes}"
                        </p>
                      )}
                      {item.verification_status === 'confirmed' && (
                        <p className="mt-2 text-[11px] text-emerald-700 dark:text-emerald-300">
                          {t('reportedData.doctorReviewedNote')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div
            ref={(node) => {
              if (node) {
                cardRefs.current.set('adverse_reaction', node);
                return;
              }
              cardRefs.current.delete('adverse_reaction');
            }}
            className={`${ACTIVE_CARD_SCROLL_MARGIN_CLASS} rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md hover:shadow-md transition`}
          >
            <div className="mb-6 flex items-start gap-3">
              <div className="rounded-xl bg-rose-50 dark:bg-rose-950/30 p-2.5">
                <AlertTriangle className="h-5 w-5 text-rose-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold font-manrope text-slate-900 dark:text-white">{t('reportedData.adverseReactions.title')}</h3>
                  <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {adverseReactions.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('reportedData.adverseReactions.description')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openInlineForm('adverse_reaction')}
              className={`mb-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${inlineCategory === 'adverse_reaction' ? 'border-cyan-600 bg-cyan-600 text-white hover:bg-cyan-700' : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-700 dark:hover:text-cyan-300'}`}
            >
              <Plus className="h-4 w-4" />
              {inlineCategory === 'adverse_reaction' ? t('reportedData.quickAdd.closeInline') : t('reportedData.quickAdd.addHere')}
            </button>
            {renderInlineForm('adverse_reaction')}
            <div className="space-y-3">
              {adverseReactions.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">{t('reportedData.adverseReactions.empty')}</p>
              ) : adverseReactions.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 p-4">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="font-semibold text-slate-900 dark:text-white">{item.medication_name}</div>
                    {renderStatusBadge(item.review_status, t)}
                  </div>
                  <div className="mt-2 text-sm text-slate-700 dark:text-slate-300">{item.reaction}</div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-500">
                    {item.severity && <span className="rounded-md bg-rose-100 px-2 py-0.5 font-medium text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">{item.severity}</span>}
                    {item.onset_date && <span>{t('reportedData.since')} {formatPatientDateMonthYear(item.onset_date)}</span>}
                    {item.outcome_status && <span>{t('reportedData.outcome')}: {item.outcome_status}</span>}
                  </div>
                  {item.review_notes && (
                    <div className="mt-3 rounded-xl bg-white dark:bg-slate-900 p-3 text-xs text-slate-600 dark:text-slate-300">
                      {t('reportedData.doctorNote')}: {item.review_notes}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div
            ref={(node) => {
              if (node) {
                cardRefs.current.set('lifestyle_log', node);
                return;
              }
              cardRefs.current.delete('lifestyle_log');
            }}
            className={`${ACTIVE_CARD_SCROLL_MARGIN_CLASS} rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md hover:shadow-md transition`}
          >
            <div className="mb-6 flex items-start gap-3">
              <div className="rounded-xl bg-cyan-50 dark:bg-cyan-950/30 p-2.5">
                <HeartPulse className="h-5 w-5 text-cyan-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold font-manrope text-slate-900 dark:text-white">{t('reportedData.lifestyleLogs.title')}</h3>
                  <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {lifestyleLogs.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('reportedData.lifestyleLogs.description')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openInlineForm('lifestyle_log')}
              className={`mb-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${inlineCategory === 'lifestyle_log' ? 'border-cyan-600 bg-cyan-600 text-white hover:bg-cyan-700' : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-700 dark:hover:text-cyan-300'}`}
            >
              <Plus className="h-4 w-4" />
              {inlineCategory === 'lifestyle_log' ? t('reportedData.quickAdd.closeInline') : t('reportedData.quickAdd.addHere')}
            </button>
            {renderInlineForm('lifestyle_log')}
            <div className="space-y-3">
              {lifestyleLogs.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">{t('reportedData.lifestyleLogs.empty')}</p>
              ) : lifestyleLogs.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 p-4">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {formatPatientDateMonthYear(item.logged_on)}
                    </div>
                    {renderStatusBadge(item.review_status, t)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    {item.sleep_hours != null && <span className="rounded-md bg-indigo-100 px-2 py-0.5 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">{t('reportedData.lifestyle.sleep')} {item.sleep_hours}h</span>}
                    {item.exercise_minutes != null && <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">{t('reportedData.lifestyle.exercise')} {item.exercise_minutes} min</span>}
                    {item.mood && <span>{t('reportedData.lifestyle.mood')}: {item.mood}</span>}
                    {item.energy_level && <span>{t('reportedData.lifestyle.energy')}: {item.energy_level}</span>}
                  </div>
                  {(item.symptoms || item.notes || item.review_notes) && (
                    <div className="mt-3 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                      {item.symptoms && <div className="rounded-xl bg-white dark:bg-slate-900 p-3">{t('reportedData.symptoms')}: {item.symptoms}</div>}
                      {item.notes && <div className="rounded-xl bg-white dark:bg-slate-900 p-3">{t('reportedData.yourNote')}: {item.notes}</div>}
                      {item.review_notes && <div className="rounded-xl bg-white dark:bg-slate-900 p-3">{t('reportedData.doctorNote')}: {item.review_notes}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Vitals Logs Panel */}
          <div
            ref={(node) => {
              if (node) {
                cardRefs.current.set('vitals', node);
                return;
              }
              cardRefs.current.delete('vitals');
            }}
            className={`${ACTIVE_CARD_SCROLL_MARGIN_CLASS} rounded-[1.5rem] border border-white/40 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 p-6 shadow-sm backdrop-blur-md hover:shadow-md transition`}
          >
            <div className="mb-6 flex items-start gap-3">
              <div className="rounded-xl bg-purple-50 dark:bg-purple-950/30 p-2.5">
                <HeartPulse className="h-5 w-5 text-purple-500" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-bold font-manrope text-slate-900 dark:text-white">{t('reportedData.vitals.title')}</h3>
                  <span className="ml-auto text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    {vitalsLogs.length}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">{t('reportedData.vitals.description')}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => openInlineForm('vitals')}
              className={`mb-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-semibold transition ${inlineCategory === 'vitals' ? 'border-cyan-600 bg-cyan-600 text-white hover:bg-cyan-700' : 'border-slate-200 bg-white text-slate-700 hover:border-cyan-300 hover:text-cyan-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-cyan-700 dark:hover:text-cyan-300'}`}
            >
              <Plus className="h-4 w-4" />
              {inlineCategory === 'vitals' ? t('reportedData.quickAdd.closeInline') : t('reportedData.quickAdd.addHere')}
            </button>
            {renderInlineForm('vitals')}
            <div className="space-y-3">
              {vitalsLogs.length === 0 ? (
                <p className="text-sm text-slate-400 dark:text-slate-500 py-4 text-center">{t('reportedData.vitals.empty')}</p>
              ) : vitalsLogs.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-950/50 p-4">
                  <div className="flex flex-wrap items-center gap-2 justify-between">
                    <div className="font-semibold text-slate-900 dark:text-white">
                      {formatPatientDateMonthYear(item.logged_on)}
                    </div>
                    {renderStatusBadge(item.review_status, t)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                    {(item.systolic || item.diastolic) && (
                      <span className="rounded-md bg-rose-100 px-2 py-0.5 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
                        {t('reportedData.vitals.bp')}: {item.systolic || '-'}/{item.diastolic || '-'}
                      </span>
                    )}
                    {item.heart_rate && (
                      <span className="rounded-md bg-purple-100 px-2 py-0.5 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                        {t('reportedData.vitals.hr')}: {item.heart_rate} bpm
                      </span>
                    )}
                    {item.blood_sugar && (
                      <span className="rounded-md bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        {t('reportedData.vitals.sugar')}: {item.blood_sugar} ({item.blood_sugar_context})
                      </span>
                    )}
                  </div>
                  {(item.notes || item.review_notes) && (
                    <div className="mt-3 space-y-2 text-xs text-slate-600 dark:text-slate-300">
                      {item.notes && <div className="rounded-xl bg-white dark:bg-slate-900 p-3">{t('reportedData.yourNote')}: {item.notes}</div>}
                      {item.review_notes && <div className="rounded-xl bg-white dark:bg-slate-900 p-3">{t('reportedData.doctorNote')}: {item.review_notes}</div>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto p-3 pt-16 sm:items-center sm:p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
          <div className="relative my-auto w-full max-w-lg overflow-hidden rounded-[2rem] border border-slate-200 bg-white shadow-2xl animate-in fade-in zoom-in-95 duration-200 max-h-[88vh] sm:max-h-[85vh] dark:border-slate-800 dark:bg-slate-900">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-xl font-bold font-headline text-slate-900">{t('reportedData.modal.title')}</h3>
              <button onClick={() => setShowAddModal(false)} className="text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-2 transition">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 pt-4 pb-2">
              <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl flex gap-3 text-sm text-amber-800 dark:text-amber-200 border border-amber-100 dark:border-amber-900/50">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p>{t('reportedData.modal.warning')}</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 overflow-y-auto p-6 pt-2">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.category')}</label>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {[
                    { val: 'chronic_condition', lbl: t('reportedData.modal.categories.disease') },
                    { val: 'current_health_issue', lbl: t('reportedData.modal.categories.currentIssue') },
                    { val: 'allergy', lbl: t('reportedData.modal.categories.allergy') },
                    { val: 'current_medication', lbl: t('reportedData.modal.categories.medicine') },
                    { val: 'adverse_reaction', lbl: t('reportedData.modal.categories.sideEffect') },
                    { val: 'lifestyle_log', lbl: t('reportedData.modal.categories.lifestyle') },
                    { val: 'vitals', lbl: t('reportedData.modal.categories.dailyVitals') }
                  ].map(c => (
                    <button
                      type="button"
                      key={c.val}
                      onClick={() => setForm({ ...form, category: c.val as any })}
                      className={`py-2 px-2 text-xs text-center rounded-xl font-medium transition ${form.category === c.val ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'}`}
                    >
                      {c.lbl}
                    </button>
                  ))}
                </div>
              </div>

              {['allergy', 'chronic_condition', 'current_health_issue', 'current_medication'].includes(form.category) && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.nameTitle')} <span className="text-rose-500">*</span></label>
                    <input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder={form.category === 'allergy' ? t('placeholders.allergyExample') : form.category === 'current_medication' ? t('placeholders.medicationExample') : form.category === 'current_health_issue' ? t('placeholders.currentIssueExample') : t('placeholders.diseaseExample')}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {(form.category === 'allergy' || form.category === 'current_health_issue') && (
                      <div>
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.severity')}</label>
                        <select
                          value={form.severity}
                          onChange={(e) => setForm({ ...form, severity: e.target.value })}
                          className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                        >
                          <option value="mild">{t('severity.mild')}</option>
                          <option value="moderate">{t('severity.moderate')}</option>
                          <option value="severe">{t('severity.severe')}</option>
                        </select>
                      </div>
                    )}
                    <div className={form.category !== 'allergy' ? 'col-span-2 sm:col-span-1' : ''}>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.currentStatus')}</label>
                      <select
                        value={form.clinical_status}
                        onChange={(e) => setForm({ ...form, clinical_status: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      >
                        <option value="active">{t('statusOptions.active')}</option>
                        <option value="inactive">{t('statusOptions.inactive')}</option>
                        <option value="resolved">{t('statusOptions.resolved')}</option>
                      </select>
                    </div>
                    <div className={form.category !== 'allergy' ? 'col-span-2 sm:col-span-1' : ''}>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.startDate')}</label>
                      <input
                        type="date"
                        value={form.start_date}
                        onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      />
                    </div>
                  </div>
                </>
              )}

              {form.category === 'adverse_reaction' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.medicineName')} <span className="text-rose-500">*</span></label>
                    <input
                      required
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      placeholder={t('placeholders.medicationExample')}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.reaction')} <span className="text-rose-500">*</span></label>
                    <input
                      required
                      value={form.reaction}
                      onChange={(e) => setForm({ ...form, reaction: e.target.value })}
                      placeholder={t('placeholders.reactionExample')}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.severity')}</label>
                      <select
                        value={form.severity}
                        onChange={(e) => setForm({ ...form, severity: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      >
                        <option value="mild">{t('severity.mild')}</option>
                        <option value="moderate">{t('severity.moderate')}</option>
                        <option value="severe">{t('severity.severe')}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.currentStatus')}</label>
                      <select
                        value={form.outcome_status}
                        onChange={(e) => setForm({ ...form, outcome_status: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      >
                        <option value="">{t('placeholders.select')}</option>
                        <option value="ongoing">{t('outcomeStatus.ongoing')}</option>
                        <option value="resolved">{t('outcomeStatus.resolved')}</option>
                        <option value="required_treatment">{t('outcomeStatus.requiredTreatment')}</option>
                        <option value="hospitalized">{t('outcomeStatus.hospitalized')}</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              {form.category === 'lifestyle_log' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.date')}</label>
                    <input
                      type="date"
                      required
                      value={form.logged_on}
                      onChange={(e) => setForm({ ...form, logged_on: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.lifestyle.sleep')}</label>
                      <input
                        type="number"
                        step="0.5"
                        value={form.sleep_hours}
                        onChange={(e) => setForm({ ...form, sleep_hours: e.target.value })}
                        placeholder={t('reportedData.placeholders.sleepHours')}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.lifestyle.exercise')}</label>
                      <input
                        type="number"
                        value={form.exercise_minutes}
                        onChange={(e) => setForm({ ...form, exercise_minutes: e.target.value })}
                        placeholder={t('reportedData.placeholders.exerciseMinutes')}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.lifestyle.mood')}</label>
                      <input
                        value={form.mood}
                        onChange={(e) => setForm({ ...form, mood: e.target.value })}
                        placeholder={t('reportedData.placeholders.mood')}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.lifestyle.energy')}</label>
                      <input
                        value={form.energy_level}
                        onChange={(e) => setForm({ ...form, energy_level: e.target.value })}
                        placeholder={t('reportedData.placeholders.energy')}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.symptoms')}</label>
                    <textarea
                      rows={2}
                      value={form.symptoms}
                      onChange={(e) => setForm({ ...form, symptoms: e.target.value })}
                      placeholder={t('reportedData.placeholders.symptoms')}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.placeholders.dietNotesLabel')}</label>
                    <textarea
                      rows={2}
                      value={form.diet_notes}
                      onChange={(e) => setForm({ ...form, diet_notes: e.target.value })}
                      placeholder={t('reportedData.placeholders.dietNotes')}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                    />
                  </div>
                </>
              )}

              {form.category === 'vitals' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.date')}</label>
                    <input
                      type="date"
                      required
                      value={form.logged_on}
                      onChange={(e) => setForm({ ...form, logged_on: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                    />
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.vitals.systolic')}</label>
                      <input
                        type="number"
                        placeholder={t("patients.reportedData.systolic")}
                        value={form.systolic}
                        onChange={(e) => setForm({ ...form, systolic: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.vitals.diastolic')}</label>
                      <input
                        type="number"
                        placeholder={t("patients.reportedData.diastolic")}
                        value={form.diastolic}
                        onChange={(e) => setForm({ ...form, diastolic: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.vitals.heartRate')}</label>
                      <input
                        type="number"
                        placeholder={t("patients.reportedData.heartRate")}
                        value={form.heart_rate}
                        onChange={(e) => setForm({ ...form, heart_rate: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.vitals.bloodSugar')}</label>
                      <input
                        type="number"
                        step="0.1"
                        placeholder={t("patients.reportedData.bloodSugar")}
                        value={form.blood_sugar}
                        onChange={(e) => setForm({ ...form, blood_sugar: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.vitals.sugarContext')}</label>
                      <select
                        value={form.blood_sugar_context}
                        onChange={(e) => setForm({ ...form, blood_sugar_context: e.target.value })}
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                      >
                        <option value="">{t('placeholders.select')}</option>
                        <option value="fasting">{t('sugarContext.fasting')}</option>
                        <option value="post_prandial">{t('sugarContext.postPrandial')}</option>
                        <option value="random">{t('sugarContext.random')}</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">{t('reportedData.modal.notesOptional')}</label>
                <textarea
                  rows={2}
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder={t('placeholders.notesDetailed')}
                  className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-4 py-2.5 text-sm outline-none focus:border-cyan-500 focus:ring-4 focus:ring-cyan-500/20"
                />
              </div>

              <div className="pt-4 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-900 border border-slate-900 text-white dark:bg-white dark:border-white dark:text-slate-900 font-semibold text-sm shadow-lg hover:opacity-95 transition disabled:opacity-70"
                >
                  {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isSubmitting ? t('reportedData.modal.saving') : t('reportedData.modal.save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
