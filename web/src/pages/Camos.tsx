import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Brain, Search, ChevronRight, User, ClipboardList, History,
  Plus, RefreshCw, AlertCircle, CheckCircle2, Activity,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { api } from '../lib/apiClient';
import { queryKeys } from '../lib/queryKeys';
import { formatDisplayDate } from '../lib/date-utils';

// ─── Types ─────────────────────────────────────────────────────────────────

interface Patient {
  id: number;
  patient_name: string;
  patient_code: string;
  mobile?: string;
}

interface CamosCategory {
  CategoryId: number;
  CategoryName: string;
  Type: string;
  Icon?: string;
  Color?: string;
}

interface CamosSubcategory {
  SubcategoryId: number;
  SubcategoryName: string;
  CategoryId: number;
}

type ItemType = 'text' | 'number' | 'select' | 'checkbox' | 'textarea' | 'date';

interface CamosItem {
  ItemId: number;
  ItemName: string;
  ItemCode: string;
  ItemType: ItemType;
  ScoreWeight: number;
  Options?: string[]; // for select type
}

interface AssessmentResponse {
  ItemId: number;
  ResponseValue: string;
  ScoreValue: number;
}

interface PastAssessment {
  AssessmentId: number;
  AssessmentDate: string;
  AssessmentTitle: string;
  TotalScore: number;
  ScorePercentage: number;
  RiskLevel: 'low' | 'moderate' | 'high';
  ClinicalNotes?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

const RISK_BADGE: Record<string, { label: string; cls: string }> = {
  low:      { label: 'Low Risk',      cls: 'bg-green-100  text-green-700  dark:bg-green-500/15  dark:text-green-400'  },
  moderate: { label: 'Moderate Risk', cls: 'bg-amber-100  text-amber-700  dark:bg-amber-500/15  dark:text-amber-400'  },
  high:     { label: 'High Risk',     cls: 'bg-red-100    text-red-700    dark:bg-red-500/15    dark:text-red-400'    },
};

const scoreToRisk = (pct: number): 'low' | 'moderate' | 'high' => {
  if (pct < 33)  return 'low';
  if (pct <= 66) return 'moderate';
  return 'high';
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function Camos({ role }: { role?: string }) {
  const { t } = useTranslation(['camos', 'common']);
  const queryClient = useQueryClient();

  // ── Patient search ──────────────────────────────────────────────────────
  const [patientQuery, setPatientQuery]       = useState('');
  const [patients, setPatients]               = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Category browser ────────────────────────────────────────────────────
  const [selectedCat, setSelectedCat]         = useState<CamosCategory | null>(null);
  const [selectedSub, setSelectedSub]         = useState<CamosSubcategory | null>(null);

  // ── Assessment form ─────────────────────────────────────────────────────
  const [assessmentTitle, setAssessmentTitle] = useState('');
  const [responses, setResponses]             = useState<Record<number, string>>({});
  const [clinicalNotes, setClinicalNotes]     = useState('');

  // ── Right panel tab ─────────────────────────────────────────────────────
  const [rightTab, setRightTab] = useState<'form' | 'history'>('form');

  // ── Patient search (debounced) ──────────────────────────────────────────
  useEffect(() => {
    if (patientQuery.length < 2) { setPatients([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.get<{ patients: Patient[] }>(`/api/patients?search=${encodeURIComponent(patientQuery)}&limit=10`)
        .then(r => setPatients(r.patients ?? []))
        .catch(() => setPatients([]));
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [patientQuery]);

  // ── Load categories on mount ────────────────────────────────────────────
  const { data: catData, isLoading: catLoading } = useApiQuery<CamosCategory[] | { Results: CamosCategory[] }>(
    queryKeys.camos.categories(),
    '/api/camos/categories',
  );
  const categories = Array.isArray(catData) ? catData : (catData as { Results?: CamosCategory[] })?.Results ?? [];

  // ── Load subcategories when category selected ───────────────────────────
  const { data: subData } = useApiQuery<CamosSubcategory[] | { Results: CamosSubcategory[] }>(
    queryKeys.camos.subcategories(selectedCat?.CategoryId ?? 0),
    `/api/camos/subcategories?categoryId=${selectedCat?.CategoryId}`,
    { enabled: !!selectedCat },
  );
  const subcategories = Array.isArray(subData) ? subData : (subData as { Results?: CamosSubcategory[] })?.Results ?? [];

  // ── Load items when subcategory selected ───────────────────────────────
  const { data: itemsData, isLoading: itemsLoading } = useApiQuery<CamosItem[] | { Results: CamosItem[] }>(
    queryKeys.camos.items(selectedSub?.SubcategoryId ?? 0),
    `/api/camos/items?subcategoryId=${selectedSub?.SubcategoryId}`,
    { enabled: !!selectedSub },
  );
  const items: CamosItem[] = Array.isArray(itemsData) ? itemsData : (itemsData as { Results?: CamosItem[] })?.Results ?? [];

  // ── Load past assessments when patient selected ─────────────────────────
  const { data: histData, isLoading: histLoading } = useApiQuery<PastAssessment[] | { Results: PastAssessment[] }>(
    queryKeys.camos.assessments(selectedPatient?.id ?? 0),
    `/api/camos/assessments?patientId=${selectedPatient?.id}`,
    { enabled: !!selectedPatient },
  );
  const pastAssessments: PastAssessment[] = Array.isArray(histData) ? histData : (histData as { Results?: PastAssessment[] })?.Results ?? [];

  // ── Submit assessment mutation ──────────────────────────────────────────
  const submitMutation = useApiMutation<unknown, Record<string, unknown>>(
    'post',
    '/api/camos/assessments',
    {
      onSuccess: () => {
        toast.success(t('toast.assessmentSaved', { ns: 'camos', defaultValue: 'Assessment saved' }));
        setResponses({});
        setAssessmentTitle('');
        setClinicalNotes('');
        setRightTab('history');
        if (selectedPatient) {
          queryClient.invalidateQueries({ queryKey: queryKeys.camos.assessments(selectedPatient.id) });
        }
      },
      onError: () => {
        toast.error(t('toast.saveAssessmentFailed', { ns: 'camos', defaultValue: 'Failed to save assessment' }));
      },
    },
  );

  // ── Score calculations ──────────────────────────────────────────────────
  const maxPossibleScore = items.reduce((s, it) => s + it.ScoreWeight, 0);

  const totalScore = items.reduce((sum, item) => {
    const val = responses[item.ItemId];
    if (!val) return sum;
    if (item.ItemType === 'checkbox') return val === 'true' ? sum + item.ScoreWeight : sum;
    if (item.ItemType === 'number') {
      // score = min(numericValue, ScoreWeight) for bounded scoring
      const n = parseFloat(val);
      return isNaN(n) ? sum : sum + Math.min(n, item.ScoreWeight);
    }
    return val ? sum + item.ScoreWeight : sum;
  }, 0);

  const scorePercentage = maxPossibleScore > 0
    ? Math.round((totalScore / maxPossibleScore) * 100)
    : 0;

  const riskLevel = scoreToRisk(scorePercentage);

  // ── Response change ─────────────────────────────────────────────────────
  const handleResponse = (itemId: number, value: string) => {
    setResponses(prev => ({ ...prev, [itemId]: value }));
  };

  // ── Submit assessment ───────────────────────────────────────────────────
  const handleSubmit = () => {
    if (!selectedPatient) { toast.error(t('toast.selectPatient', { ns: 'camos', defaultValue: 'Select a patient first' })); return; }
    if (!assessmentTitle) { toast.error(t('toast.assessmentTitleRequired', { ns: 'camos', defaultValue: 'Assessment title is required' })); return; }
    if (items.length === 0) { toast.error(t('toast.selectSubcategory', { ns: 'camos', defaultValue: 'Select a subcategory to load assessment items' })); return; }

    const builtResponses: AssessmentResponse[] = items
      .filter(it => responses[it.ItemId] !== undefined && responses[it.ItemId] !== '')
      .map(it => {
        const val = responses[it.ItemId];
        let score = 0;
        if (it.ItemType === 'checkbox') score = val === 'true' ? it.ScoreWeight : 0;
        else if (it.ItemType === 'number') {
          const n = parseFloat(val);
          score = isNaN(n) ? 0 : Math.min(n, it.ScoreWeight);
        } else if (val) {
          score = it.ScoreWeight;
        }
        return { ItemId: it.ItemId, ResponseValue: val, ScoreValue: score };
      });

    submitMutation.mutate({
      PatientId:       selectedPatient.id,
      AssessmentTitle: assessmentTitle,
      Responses:       builtResponses,
      TotalScore:      totalScore,
      ScorePercentage: scorePercentage,
      RiskLevel:       riskLevel,
      ClinicalNotes:   clinicalNotes,
    });
  };

  // ── Render item field by type ───────────────────────────────────────────
  const renderItemField = (item: CamosItem) => {
    const val = responses[item.ItemId] ?? '';
    const base = 'input w-full';

    switch (item.ItemType) {
      case 'textarea':
        return (
          <textarea
            value={val}
            onChange={e => handleResponse(item.ItemId, e.target.value)}
            rows={2}
            placeholder={item.ItemName}
            className={`${base} resize-none`}
          />
        );
      case 'checkbox':
        return (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={val === 'true'}
              onChange={e => handleResponse(item.ItemId, e.target.checked ? 'true' : 'false')}
              className="w-4 h-4 rounded accent-[var(--color-primary)]"
            />
            <span className="text-sm text-[var(--color-text)]">{item.ItemName}</span>
          </label>
        );
      case 'number':
        return (
          <input
            type="number"
            value={val}
            onChange={e => handleResponse(item.ItemId, e.target.value)}
            placeholder={t("common.0")}
            className={base}
          />
        );
      case 'date':
        return (
          <input
            type="date"
            value={val}
            onChange={e => handleResponse(item.ItemId, e.target.value)}
            className={base}
          />
        );
      case 'select':
        return (
          <select
            value={val}
            onChange={e => handleResponse(item.ItemId, e.target.value)}
            className={base}
          >
            <option value="">— Select —</option>
            {(item.Options ?? []).map(opt => (
              <option key={opt} value={opt}>{opt}</option>
            ))}
          </select>
        );
      default: // text
        return (
          <input
            type="text"
            value={val}
            onChange={e => handleResponse(item.ItemId, e.target.value)}
            placeholder={item.ItemName}
            className={base}
          />
        );
    }
  };

  // ── Risk progress bar color ─────────────────────────────────────────────
  const progressColor =
    riskLevel === 'low'      ? 'bg-green-500' :
    riskLevel === 'moderate' ? 'bg-amber-500' :
    'bg-red-500';

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <DashboardLayout role={role ?? 'staff'}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* Page Header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">CAMOS</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Clinical Assessment Management Operating System</p>
            </div>
          </div>
        </div>

        {/* Two-column layout */}
        <div className="flex gap-5 items-start">

          {/* ── Left Panel: Category Browser (1/3) ─────────────────────── */}
          <div className="w-1/3 shrink-0 space-y-3">

            {/* Categories */}
            <div className="card overflow-hidden">
              <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-[var(--color-text-muted)]" />
                <h2 className="section-title">{t('categories', { ns: 'camos', defaultValue: 'Categories' })}</h2>
              </div>
              {catLoading ? (
                <div className="flex items-center justify-center py-10 text-[var(--color-text-muted)]">
                  <RefreshCw className="w-4 h-4 animate-spin mr-2" /> {t('common.loading', { defaultValue: 'Loading...' })}
                </div>
              ) : categories.length === 0 ? (
                <p className="px-4 py-8 text-sm text-center text-[var(--color-text-muted)]">{t('noCategories', { ns: 'camos', defaultValue: 'No categories found' })}</p>
              ) : (
                <ul className="divide-y divide-[var(--color-border)]">
                  {categories.map(cat => (
                    <li key={cat.CategoryId}>
                      <button
                        onClick={() => {
                          setSelectedCat(selectedCat?.CategoryId === cat.CategoryId ? null : cat);
                          setSelectedSub(null);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${
                          selectedCat?.CategoryId === cat.CategoryId
                            ? 'bg-violet-50 dark:bg-violet-500/10 text-violet-700 dark:text-violet-400'
                            : 'hover:bg-[var(--color-bg-secondary)] text-[var(--color-text)]'
                        }`}
                      >
                        {cat.Icon ? (
                          <span className="text-base w-5 text-center">{cat.Icon}</span>
                        ) : (
                          <div
                            className="w-5 h-5 rounded-md shrink-0"
                            style={{ background: cat.Color ?? 'var(--color-primary)' }}
                          />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{cat.CategoryName}</p>
                          {cat.Type && (
                            <p className="text-xs text-[var(--color-text-muted)] truncate">{cat.Type}</p>
                          )}
                        </div>
                        <ChevronRight className={`w-4 h-4 shrink-0 transition-transform ${selectedCat?.CategoryId === cat.CategoryId ? 'rotate-90' : ''}`} />
                      </button>

                      {/* Subcategories inline */}
                      {selectedCat?.CategoryId === cat.CategoryId && subcategories.length > 0 && (
                        <ul className="bg-[var(--color-bg-secondary)] border-t border-[var(--color-border)]">
                          {subcategories.map(sub => (
                            <li key={sub.SubcategoryId}>
                              <button
                                onClick={() => setSelectedSub(selectedSub?.SubcategoryId === sub.SubcategoryId ? null : sub)}
                                className={`w-full text-left px-6 py-2.5 text-sm flex items-center gap-2 transition-colors ${
                                  selectedSub?.SubcategoryId === sub.SubcategoryId
                                    ? 'text-violet-700 dark:text-violet-400 font-medium'
                                    : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                                }`}
                              >
                                <ChevronRight className="w-3 h-3 shrink-0" />
                                {sub.SubcategoryName}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Items loaded from subcategory */}
            {selectedSub && (
              <div className="card overflow-hidden">
                <div className="px-4 py-3 border-b border-[var(--color-border)]">
                  <p className="label">{selectedSub.SubcategoryName} — Items</p>
                </div>
                {itemsLoading ? (
                  <div className="flex items-center justify-center py-8 text-[var(--color-text-muted)]">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> {t('common.loading', { defaultValue: 'Loading...' })}
                  </div>
                ) : items.length === 0 ? (
                  <p className="px-4 py-6 text-sm text-center text-[var(--color-text-muted)]">{t('noItemsInSubcategory', { ns: 'camos', defaultValue: 'No items in this subcategory' })}</p>
                ) : (
                  <ul className="divide-y divide-[var(--color-border)] text-sm">
                    {items.map(it => (
                      <li key={it.ItemId} className="px-4 py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[var(--color-text)] truncate">{it.ItemName}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{it.ItemCode} · {it.ItemType}</p>
                        </div>
                        <span className="shrink-0 text-xs font-mono bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 rounded">
                          x{it.ScoreWeight}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* ── Right Panel: Assessment Form + History (2/3) ────────────── */}
          <div className="flex-1 min-w-0 space-y-4">

            {/* Patient Search */}
            <div className="card p-4">
              <p className="label mb-2">Patient</p>
              {selectedPatient ? (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-violet-400 to-indigo-500 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[var(--color-text)]">{selectedPatient.patient_name}</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {selectedPatient.patient_code}
                      {selectedPatient.mobile ? ` · ${selectedPatient.mobile}` : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => { setSelectedPatient(null); setPatientQuery(''); }}
                    className="btn-ghost text-xs"
                  >
                    {t('common.change', { defaultValue: 'Change' })}
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                  <input
                    value={patientQuery}
                    onChange={e => setPatientQuery(e.target.value)}
                    placeholder={t('searchPatient', { ns: 'camos', defaultValue: 'Search patient by name or code...' })}
                    className="input pl-9 w-full max-w-sm"
                  />
                  {patients.length > 0 && (
                    <div className="absolute z-20 left-0 top-full mt-1 w-full max-w-sm card py-1 shadow-xl border border-[var(--color-border)]">
                      {patients.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setSelectedPatient(p); setPatients([]); setPatientQuery(''); }}
                          className="w-full text-left px-4 py-2.5 hover:bg-[var(--color-bg-secondary)] transition-colors"
                        >
                          <p className="font-medium text-sm text-[var(--color-text)]">{p.patient_name}</p>
                          <p className="text-xs text-[var(--color-text-muted)]">{p.patient_code}{p.mobile ? ` · ${p.mobile}` : ''}</p>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Tabs */}
            <div className="flex gap-1 p-1 rounded-xl bg-[var(--color-bg-secondary)] border border-[var(--color-border)] w-fit">
              {([
                { key: 'form',    label: t('newAssessment', { ns: 'camos', defaultValue: 'New Assessment' }), icon: <Plus className="w-3.5 h-3.5" /> },
                { key: 'history', label: t('pastAssessments', { ns: 'camos', defaultValue: 'Past Assessments' }), icon: <History className="w-3.5 h-3.5" /> },
              ] as const).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setRightTab(tab.key)}
                  className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    rightTab === tab.key
                      ? 'bg-[var(--color-card)] text-[var(--color-text)] shadow-sm'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ── Tab: New Assessment Form ────────────────────────────── */}
            {rightTab === 'form' && (
              <div className="card p-5 space-y-5">

                {/* Assessment Title */}
                <div>
                  <label className="label">{t('assessmentTitle', { ns: 'camos', defaultValue: 'Assessment Title' })}</label>
                  <input
                    value={assessmentTitle}
                    onChange={e => setAssessmentTitle(e.target.value)}
                    placeholder={t('assessmentTitlePlaceholder', { ns: 'camos', defaultValue: 'e.g. PHQ-9 Depression Screening' })}
                    className="input w-full"
                  />
                </div>

                {/* Score meter (visible once items loaded) */}
                {items.length > 0 && (
                  <div className="p-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-[var(--color-text-muted)]" />
                        <span className="text-sm font-medium text-[var(--color-text)]">{t('liveScore', { ns: 'camos', defaultValue: 'Live Score' })}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-[var(--color-text)]">
                          {totalScore} / {maxPossibleScore}
                          <span className="text-[var(--color-text-muted)] font-normal ml-1">({scorePercentage}%)</span>
                        </span>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${RISK_BADGE[riskLevel].cls}`}>
                          {RISK_BADGE[riskLevel].label}
                        </span>
                      </div>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--color-border)] overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${progressColor}`}
                        style={{ width: `${scorePercentage}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Dynamic item fields */}
                {items.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-[var(--color-text-muted)] gap-2 rounded-xl border border-dashed border-[var(--color-border)]">
                    <ClipboardList className="w-7 h-7 opacity-30" />
                    <p className="text-sm">{t('selectSubcategoryHint', { ns: 'camos', defaultValue: 'Select a subcategory from the left panel to load assessment items' })}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="label">{selectedSub?.SubcategoryName ?? 'Assessment Items'}</p>
                    <div className="space-y-2">
                      {items.map(item => (
                        <div
                          key={item.ItemId}
                          className="flex items-start gap-4 p-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-secondary)]"
                        >
                          <div className="flex-1 min-w-0">
                            {item.ItemType !== 'checkbox' && (
                              <label className="text-sm font-medium text-[var(--color-text)] block mb-1">
                                {item.ItemName}
                                <span className="ml-1.5 text-xs font-mono text-[var(--color-text-muted)]">
                                  [{item.ItemCode}]
                                </span>
                              </label>
                            )}
                            {renderItemField(item)}
                          </div>
                          <span className="shrink-0 mt-1 text-xs font-mono bg-violet-100 dark:bg-violet-500/15 text-violet-700 dark:text-violet-400 px-1.5 py-0.5 rounded">
                            x{item.ScoreWeight}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Clinical Notes */}
                <div>
                  <label className="label">{t('clinicalNotes', { ns: 'camos', defaultValue: 'Clinical Notes' })}</label>
                  <textarea
                    value={clinicalNotes}
                    onChange={e => setClinicalNotes(e.target.value)}
                    rows={3}
                    placeholder={t('clinicalNotesPlaceholder', { ns: 'camos', defaultValue: 'Optional clinical observations, recommendations...' })}
                    className="input w-full resize-none"
                  />
                </div>

                {/* Submit */}
                <div className="flex justify-end">
                  <button
                    onClick={handleSubmit}
                    disabled={submitMutation.isPending || !selectedPatient || !assessmentTitle}
                    className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {submitMutation.isPending ? t('common.saving', { defaultValue: 'Saving...' }) : t('submitAssessment', { ns: 'camos', defaultValue: 'Submit Assessment' })}
                  </button>
                </div>
              </div>
            )}

            {/* ── Tab: Past Assessments ───────────────────────────────── */}
            {rightTab === 'history' && (
              <div className="card overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
                  <div className="flex items-center gap-2">
                    <History className="w-4 h-4 text-[var(--color-text-muted)]" />
                    <h2 className="section-title">{t('assessmentHistory', { ns: 'camos', defaultValue: 'Assessment History' })}</h2>
                  </div>
                  {selectedPatient && (
                    <button
                      onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.camos.assessments(selectedPatient.id) })}
                      className="btn-ghost p-2"
                      title="Refresh"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {!selectedPatient ? (
                  <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)] gap-2">
                    <User className="w-7 h-7 opacity-30" />
                    <p className="text-sm">{t('selectPatientHistory', { ns: 'camos', defaultValue: 'Select a patient to view their assessment history' })}</p>
                  </div>
                ) : histLoading ? (
                  <div className="flex items-center justify-center py-16 text-[var(--color-text-muted)]">
                    <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading...
                  </div>
                ) : pastAssessments.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 text-[var(--color-text-muted)] gap-2">
                    <AlertCircle className="w-7 h-7 opacity-30" />
                    <p className="text-sm">{t('noPastAssessments', { ns: 'camos', defaultValue: 'No past assessments for this patient' })}</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="table-base w-full text-sm">
                      <thead>
                        <tr>
                          <th className="text-left px-4 py-3">Date</th>
                          <th className="text-left px-4 py-3">Title</th>
                          <th className="text-right px-4 py-3">Score</th>
                          <th className="text-right px-4 py-3">Percentage</th>
                          <th className="text-center px-4 py-3">Risk</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pastAssessments.map(a => {
                          const risk = RISK_BADGE[a.RiskLevel] ?? RISK_BADGE.low;
                          return (
                            <tr key={a.AssessmentId} className="hover:bg-[var(--color-bg-secondary)] transition-colors">
                              <td className="px-4 py-3 text-[var(--color-text-muted)] whitespace-nowrap">
                                {formatDisplayDate(a.AssessmentDate)}
                              </td>
                              <td className="px-4 py-3 text-[var(--color-text)] font-medium">
                                {a.AssessmentTitle}
                              </td>
                              <td className="px-4 py-3 text-right font-mono font-semibold text-[var(--color-text)]">
                                {a.TotalScore}
                              </td>
                              <td className="px-4 py-3 text-right text-[var(--color-text-muted)]">
                                {a.ScorePercentage}%
                              </td>
                              <td className="px-4 py-3 text-center">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${risk.cls}`}>
                                  {risk.label}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
