import { useState, useEffect } from 'react';
import {
  Pill, Search, Plus, AlertTriangle, Shield, ShieldAlert, ShieldCheck,
  Activity, BookOpen, X, ChevronDown, ChevronUp, FileText, Stethoscope,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { api } from '../lib/apiClient';
import type { ApiClientError } from '../lib/apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormularyItem {
  id: number;
  name: string;
  generic_name: string;
  category_name?: string;
  strength?: string;
  dosage_form?: string;
  route?: string;
  manufacturer?: string;
  max_daily_dose_mg?: number;
  is_antibiotic: number;
  is_controlled: number;
  unit_price: number;
  created_at: string;
}

interface DrugInteraction {
  id: number;
  drug_a_name: string;
  drug_b_name: string;
  severity: 'minor' | 'moderate' | 'major' | 'contraindicated';
  description: string;
  recommendation?: string;
}

interface SafetyWarning {
  type: string;
  severity: 'info' | 'warning' | 'critical' | 'contraindicated';
  title: string;
  description: string;
  recommendation?: string;
}

interface SafetyCheckResult {
  safe: boolean;
  warning_count: number;
  has_critical: boolean;
  has_contraindicated: boolean;
  warnings: SafetyWarning[];
  safety_check_id: number;
}

interface Stats {
  formulary_items: number;
  interaction_pairs: number;
  total_safety_checks: number;
  checks_with_warnings: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const severityColor: Record<string, string> = {
  minor: 'bg-blue-100 text-blue-700 border-blue-200',
  moderate: 'bg-amber-100 text-amber-700 border-amber-200',
  major: 'bg-orange-100 text-orange-800 border-orange-200',
  contraindicated: 'bg-red-100 text-red-800 border-red-200',
  info: 'bg-blue-50 text-blue-600 border-blue-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  critical: 'bg-red-50 text-red-700 border-red-200',
};

const severityIcon: Record<string, typeof Shield> = {
  minor: ShieldCheck,
  moderate: Shield,
  major: ShieldAlert,
  contraindicated: AlertTriangle,
};

function SeverityBadge({ severity }: { severity: string }) {
  const IconComp = severityIcon[severity] || Shield;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${severityColor[severity] || 'bg-gray-100 text-gray-600'}`}>
      <IconComp className="w-3 h-3" />
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

type TabKey = 'safety' | 'formulary' | 'interactions';

/** Build a query-string from an object, omitting undefined/empty values. */
function buildQS(params: Record<string, string | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function EPrescribingDashboard({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation('eprescribing');
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('safety');

  // ── Safety Checker state
  const [patientId, setPatientId] = useState('');
  const [medName, setMedName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [safetyResult, setSafetyResult] = useState<SafetyCheckResult | null>(null);

  // ── Formulary state
  const [formularySearch, setFormularySearch] = useState('');
  const [debouncedFormularySearch, setDebouncedFormularySearch] = useState('');
  const [showFormularyModal, setShowFormularyModal] = useState(false);
  const [formularyForm, setFormularyForm] = useState({ name: '', generic_name: '', strength: '', dosage_form: '', route: '', manufacturer: '', max_daily_dose_mg: '', unit_price: '' });

  // ── Interactions state
  const [interactionSearch, setInteractionSearch] = useState('');
  const [interactionFilter, setInteractionFilter] = useState<string>('all');
  const [showInteractionModal, setShowInteractionModal] = useState(false);
  const [interactionForm, setInteractionForm] = useState({ drug_a_name: '', drug_b_name: '', severity: 'moderate' as string, description: '', recommendation: '' });
  const [expandedWarning, setExpandedWarning] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // ── Debounce formulary search (400ms)
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedFormularySearch(formularySearch), 400);
    return () => clearTimeout(timer);
  }, [formularySearch]);

  // ── Queries ───────────────────────────────────────────────────────────────

  const statsQuery = useApiQuery<Stats>(
    queryKeys.ePrescribing.stats(),
    '/api/e-prescribing/stats',
  );

  const stats = statsQuery.data ?? { formulary_items: 0, interaction_pairs: 0, total_safety_checks: 0, checks_with_warnings: 0 };

  const formularyQuery = useApiQuery<{ formulary: FormularyItem[] }>(
    queryKeys.ePrescribing.formulary({ search: debouncedFormularySearch }),
    `/api/e-prescribing/formulary${buildQS({ search: debouncedFormularySearch || undefined })}`,
    { enabled: activeTab === 'formulary' },
  );

  const formulary = formularyQuery.data?.formulary ?? [];
  const formularyLoading = formularyQuery.isLoading && formularyQuery.fetchStatus !== 'idle';

  const interactionsQuery = useApiQuery<{ interactions: DrugInteraction[] }>(
    queryKeys.ePrescribing.interactions({ search: interactionSearch, severity: interactionFilter }),
    `/api/e-prescribing/interactions${buildQS({
      search: interactionSearch || undefined,
      severity: interactionFilter !== 'all' ? interactionFilter : undefined,
    })}`,
    { enabled: activeTab === 'interactions' },
  );

  const interactions = interactionsQuery.data?.interactions ?? [];
  const interactionsLoading = interactionsQuery.isLoading && interactionsQuery.fetchStatus !== 'idle';

  // ── Invalidation helper
  const invalidateAll = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.ePrescribing.all });

  // ── Mutations ─────────────────────────────────────────────────────────────

  const safetyCheckMutation = useApiMutation<SafetyCheckResult, {
    patient_id: number;
    medication_name: string;
    generic_name?: string;
  }>('post', '/api/e-prescribing/check-safety', {
    onSuccess: (data) => {
      setSafetyResult(data);
      queryClient.invalidateQueries({ queryKey: queryKeys.ePrescribing.stats() });
      if (data.safe) toast.success(t('toast.success.noSafetyConcerns', { defaultValue: 'No safety concerns found' }));
      else toast(t('toast.warning.safetyWarnings', { defaultValue: 'Safety warnings detected — please review' }), { icon: '🔍' });
    },
    onError: (err) => {
      const msg = (err as ApiClientError).message || t('toast.error.safetyCheckFailed', { defaultValue: 'Safety check failed' });
      toast.error(msg);
    },
  });

  const addFormularyMutation = useApiMutation<unknown, {
    name: string;
    generic_name: string;
    strength?: string;
    dosage_form?: string;
    route?: string;
    manufacturer?: string;
    max_daily_dose_mg?: number;
    unit_price: number;
  }>('post', '/api/e-prescribing/formulary', {
    onSuccess: () => {
      toast.success(t('toast.success.drugAdded', { defaultValue: 'Drug added to formulary' }));
      setShowFormularyModal(false);
      setFormularyForm({ name: '', generic_name: '', strength: '', dosage_form: '', route: '', manufacturer: '', max_daily_dose_mg: '', unit_price: '' });
      invalidateAll();
    },
    onError: (err) => {
      const msg = (err as ApiClientError).message || t('toast.error.addDrugFailed', { defaultValue: 'Failed to add drug' });
      toast.error(msg);
    },
  });

  const addInteractionMutation = useApiMutation<unknown, {
    drug_a_name: string;
    drug_b_name: string;
    severity: string;
    description: string;
    recommendation: string;
  }>('post', '/api/e-prescribing/interactions', {
    onSuccess: () => {
      toast.success(t('toast.success.interactionAdded', { defaultValue: 'Interaction pair added' }));
      setShowInteractionModal(false);
      setInteractionForm({ drug_a_name: '', drug_b_name: '', severity: 'moderate', description: '', recommendation: '' });
      invalidateAll();
    },
    onError: (err) => {
      const msg = (err as ApiClientError).message || t('toast.error.addInteractionFailed', { defaultValue: 'Failed to add interaction' });
      toast.error(msg);
    },
  });

  const deleteInteractionMutation = useApiMutation<unknown, { id: number }>(
    'delete',
    (vars) => `/api/e-prescribing/interactions/${vars.id}`,
    {
      onSuccess: () => {
        toast.success(t('toast.success.interactionRemoved', { defaultValue: 'Interaction removed' }));
        setConfirmDeleteId(null);
        invalidateAll();
      },
      onError: () => {
        toast.error(t('toast.error.removeFailed', { defaultValue: 'Failed to remove' }));
      },
    },
  );

  // ── Form handlers ─────────────────────────────────────────────────────────

  const runSafetyCheck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!patientId || !medName) return toast.error(t('toast.error.safetyCheckRequired', { defaultValue: 'Patient ID and medication name required' }));
    setSafetyResult(null);
    safetyCheckMutation.mutate({
      patient_id: parseInt(patientId),
      medication_name: medName,
      generic_name: genericName || undefined,
    });
  };

  const submitFormulary = (e: React.FormEvent) => {
    e.preventDefault();
    addFormularyMutation.mutate({
      name: formularyForm.name,
      generic_name: formularyForm.generic_name,
      strength: formularyForm.strength || undefined,
      dosage_form: formularyForm.dosage_form || undefined,
      route: formularyForm.route || undefined,
      manufacturer: formularyForm.manufacturer || undefined,
      max_daily_dose_mg: formularyForm.max_daily_dose_mg ? parseFloat(formularyForm.max_daily_dose_mg) : undefined,
      unit_price: formularyForm.unit_price ? parseFloat(formularyForm.unit_price) : 0,
    });
  };

  const submitInteraction = (e: React.FormEvent) => {
    e.preventDefault();
    addInteractionMutation.mutate(interactionForm);
  };

  const deleteInteraction = (id: number) => {
    deleteInteractionMutation.mutate({ id });
  };

  // ── Derived state
  const checking = safetyCheckMutation.isPending;

  const tabs: { key: TabKey; label: string; icon: typeof Pill }[] = [
    { key: 'safety', label: t('tabs.safetyChecker', { defaultValue: 'Safety Checker' }), icon: ShieldCheck },
    { key: 'formulary', label: t('tabs.drugCatalog', { defaultValue: 'Drug Catalog' }), icon: BookOpen },
    { key: 'interactions', label: t('tabs.interactions', { defaultValue: 'Interactions' }), icon: Activity },
  ];

  return (
    <DashboardLayout role={role}>
      <div className="space-y-5 max-w-screen-2xl mx-auto">

        {/* ── Header ── */}
        <div className="page-header">
          <div>
            <h1 className="page-title">{t('title', { defaultValue: 'E-Prescribing' })}</h1>
            <p className="section-subtitle mt-1">{t('subtitle', { defaultValue: 'Drug safety checking, formulary & interaction management' })}</p>
          </div>
        </div>

        {/* ── KPI Cards ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KPICard title={t('kpi.drugCatalog', { defaultValue: 'Drug Catalog' })} value={stats.formulary_items} loading={statsQuery.isLoading} icon={<BookOpen className="w-5 h-5"/>} iconBg="bg-[var(--color-primary-light)] text-[var(--color-primary)]" />
          <KPICard title={t('kpi.interactionPairs', { defaultValue: 'Interaction Pairs' })} value={stats.interaction_pairs} loading={statsQuery.isLoading} icon={<Activity className="w-5 h-5"/>} iconBg="bg-amber-50 text-amber-600" />
          <KPICard title={t('kpi.safetyChecksRun', { defaultValue: 'Safety Checks Run' })} value={stats.total_safety_checks} loading={statsQuery.isLoading} icon={<ShieldCheck className="w-5 h-5"/>} iconBg="bg-emerald-50 text-emerald-600" />
          <KPICard title={t('kpi.warningsDetected', { defaultValue: 'Warnings Detected' })} value={stats.checks_with_warnings} loading={statsQuery.isLoading} icon={<AlertTriangle className="w-5 h-5"/>} iconBg="bg-red-50 text-red-600" />
        </div>

        {/* ── Tab Navigation ── */}
        <div className="flex gap-1 p-1 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeTab === tab.key
                    ? 'bg-[var(--color-primary)] text-white shadow-sm'
                    : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-border-light)]'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* SAFETY CHECKER TAB                                                */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'safety' && (
          <div className="space-y-4">
            <div className="card p-6">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Stethoscope className="w-5 h-5 text-[var(--color-primary)]" />
                {t('safety.title', { defaultValue: 'Prescription Safety Check' })}
              </h2>
              <p className="text-sm text-[var(--color-text-muted)] mb-4">
                {t('safety.description', { defaultValue: 'Enter a patient ID and medication to check for drug-drug interactions, allergy contraindications, duplicate therapy, and max dose violations.' })}
              </p>
              <form onSubmit={runSafetyCheck} className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="label">{t('safety.patientIdLabel', { defaultValue: 'Patient ID *' })}</label>
                  <input className="input" type="number" required value={patientId} onChange={e => setPatientId(e.target.value)} placeholder={t('safety.patientIdPlaceholder', { defaultValue: 'e.g. 1' })} />
                </div>
                <div>
                  <label className="label">{t('safety.medicationNameLabel', { defaultValue: 'Medication Name *' })}</label>
                  <input className="input" required value={medName} onChange={e => setMedName(e.target.value)} placeholder={t('safety.medicationNamePlaceholder', { defaultValue: 'e.g. Ibuprofen' })} />
                </div>
                <div>
                  <label className="label">{t('safety.genericNameLabel', { defaultValue: 'Generic Name (optional)' })}</label>
                  <input className="input" value={genericName} onChange={e => setGenericName(e.target.value)} placeholder={t('safety.genericNamePlaceholder', { defaultValue: 'e.g. ibuprofen' })} />
                </div>
                <div className="flex items-end">
                  <button type="submit" disabled={checking} className="btn-primary w-full">
                    {checking ? t('safety.checking', { defaultValue: 'Checking…' }) : t('safety.runCheckBtn', { defaultValue: '🔍 Run Safety Check' })}
                  </button>
                </div>
              </form>
            </div>

            {/* ── Safety Result ── */}
            {safetyResult && (
              <div className={`card border-2 ${safetyResult.safe ? 'border-emerald-300 bg-emerald-50' : safetyResult.has_contraindicated ? 'border-red-400 bg-red-50' : 'border-amber-300 bg-amber-50'}`}>
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    {safetyResult.safe ? (
                      <ShieldCheck className="w-8 h-8 text-emerald-600" />
                    ) : safetyResult.has_contraindicated ? (
                      <AlertTriangle className="w-8 h-8 text-red-600" />
                    ) : (
                      <ShieldAlert className="w-8 h-8 text-amber-600" />
                    )}
                    <div>
                      <h3 className="text-lg font-bold">
                        {safetyResult.safe ? t('safety.noConcerns', { defaultValue: '✅ No Safety Concerns' }) : safetyResult.has_contraindicated ? t('safety.contraindicated', { defaultValue: '🚫 CONTRAINDICATED' }) : `⚠️ ${safetyResult.warning_count} ${safetyResult.warning_count > 1 ? t('safety.warningsFound', { defaultValue: 'Warnings Found' }) : t('safety.warningFound', { defaultValue: 'Warning Found' })}`}
                      </h3>
                      <p className="text-sm text-[var(--color-text-muted)]">
                        Safety Check ID: #{safetyResult.safety_check_id}
                      </p>
                    </div>
                  </div>

                  {safetyResult.warnings.length > 0 && (
                    <div className="space-y-3">
                      {safetyResult.warnings.map((w, idx) => (
                        <div key={idx} className={`rounded-xl border p-4 ${severityColor[w.severity] || 'bg-gray-50 border-gray-200'}`}>
                          <div
                            className="flex items-start justify-between cursor-pointer"
                            onClick={() => setExpandedWarning(expandedWarning === idx ? null : idx)}
                          >
                            <div className="flex items-start gap-3">
                              <SeverityBadge severity={w.severity} />
                              <div>
                                <p className="font-semibold text-sm">{w.title}</p>
                                <p className="text-xs text-[var(--color-text-muted)] mt-0.5 capitalize">{w.type.replace(/_/g, ' ')}</p>
                              </div>
                            </div>
                            {expandedWarning === idx ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                          {expandedWarning === idx && (
                            <div className="mt-3 pl-8 space-y-2 text-sm">
                              <p>{w.description}</p>
                              {w.recommendation && (
                                <p className="font-medium">{'💡'} {t('safety.recommendation', { defaultValue: 'Recommendation' })}: {w.recommendation}</p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* FORMULARY TAB                                                     */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'formulary' && (
          <div className="space-y-4">
            <div className="card p-4 flex flex-wrap gap-3 items-center justify-between">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  placeholder={t('formulary.searchPlaceholder', { defaultValue: 'Search drug name, generic or manufacturer…' })}
                  value={formularySearch}
                  onChange={e => setFormularySearch(e.target.value)}
                  className="input pl-9"
                />
              </div>
              <button onClick={() => setShowFormularyModal(true)} className="btn-primary">
                <Plus className="w-4 h-4" /> {t('formulary.addDrug', { defaultValue: 'Add Drug' })}
              </button>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Drug Name</th>
                      <th>Generic Name</th>
                      <th>Category</th>
                      <th>Strength</th>
                      <th>Form</th>
                      <th>Max Dose</th>
                      <th>Price</th>
                      <th>Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {formularyLoading ? (
                      [...Array(5)].map((_, i) => <tr key={i}>{[...Array(9)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    ) : formulary.length === 0 ? (
                      <tr><td colSpan={9} className="py-16 text-center text-[var(--color-text-muted)]">{t('formulary.noDrugs', { defaultValue: 'No drugs in formulary yet. Add one to get started.' })}</td></tr>
                    ) : (
                      formulary.map((item, idx) => (
                        <tr key={item.id}>
                          <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                          <td className="font-medium">{item.name}</td>
                          <td className="text-[var(--color-text-secondary)]">{item.generic_name}</td>
                          <td><span className="badge badge-info">{item.category_name || '—'}</span></td>
                          <td>{item.strength || '—'}</td>
                          <td>{item.dosage_form || '—'}</td>
                          <td className="font-data">{item.max_daily_dose_mg ? `${item.max_daily_dose_mg}mg` : '—'}</td>
                          <td className="font-data">{'৳'}{item.unit_price?.toFixed(2) || '0.00'}</td>
                          <td>
                            <div className="flex gap-1">
                              {item.is_antibiotic ? <span className="badge badge-warning text-xs">{t('formulary.antibiotic', { defaultValue: 'Antibiotic' })}</span> : null}
                              {item.is_controlled ? <span className="badge badge-danger text-xs">{t('formulary.controlled', { defaultValue: 'Controlled' })}</span> : null}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* INTERACTIONS TAB                                                  */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === 'interactions' && (
          <div className="space-y-4">
            <div className="card p-4 flex flex-wrap gap-3 items-center justify-between">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                <input
                  type="text"
                  placeholder={t('interactions.searchPlaceholder', { defaultValue: 'Search drug names or descriptions…' })}
                  value={interactionSearch}
                  onChange={e => setInteractionSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && interactionsQuery.refetch()}
                  className="input pl-9"
                />
              </div>
              <div className="flex border border-[var(--color-border)] rounded-lg overflow-hidden text-sm">
                {['all', 'minor', 'moderate', 'major', 'contraindicated'].map(f => (
                  <button
                    key={f}
                    onClick={() => { setInteractionFilter(f); }}
                    className={`px-3 py-2 font-medium transition-colors ${interactionFilter === f ? 'bg-[var(--color-primary)] text-white' : 'bg-[var(--color-surface)] hover:bg-[var(--color-border-light)] text-[var(--color-text-secondary)]'}`}
                  >
                    {f === 'all' ? t('interactions.severity.all', { defaultValue: 'All' }) : t(`interactions.severity.${f}`, { defaultValue: f.charAt(0).toUpperCase() + f.slice(1) })}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowInteractionModal(true)} className="btn-primary">
                <Plus className="w-4 h-4" /> {t('interactions.addPair', { defaultValue: 'Add Pair' })}
              </button>
            </div>

            <div className="card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Drug A</th>
                      <th>Drug B</th>
                      <th>Severity</th>
                      <th>Description</th>
                      <th>Recommendation</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interactionsLoading ? (
                      [...Array(5)].map((_, i) => <tr key={i}>{[...Array(7)].map((_, j) => <td key={j}><div className="skeleton h-4 w-full rounded" /></td>)}</tr>)
                    ) : interactions.length === 0 ? (
                      <tr><td colSpan={7} className="py-16 text-center text-[var(--color-text-muted)]">{t('interactions.noPairs', { defaultValue: 'No interaction pairs found.' })}</td></tr>
                    ) : (
                      interactions.map((pair, idx) => (
                        <tr key={pair.id}>
                          <td className="text-[var(--color-text-muted)]">{idx + 1}</td>
                          <td className="font-medium capitalize">{pair.drug_a_name}</td>
                          <td className="font-medium capitalize">{pair.drug_b_name}</td>
                          <td><SeverityBadge severity={pair.severity} /></td>
                          <td className="text-sm max-w-xs truncate" title={pair.description}>{pair.description}</td>
                          <td className="text-sm max-w-xs truncate" title={pair.recommendation}>{pair.recommendation || '—'}</td>
                          <td>
                            {confirmDeleteId === pair.id ? (
                              <div className="flex items-center gap-1">
                                <button onClick={() => deleteInteraction(pair.id)} className="btn-ghost p-1 text-xs text-red-600 font-semibold">{t('actions.yes', { defaultValue: 'Yes' })}</button>
                                <button onClick={() => setConfirmDeleteId(null)} className="btn-ghost p-1 text-xs text-[var(--color-text-muted)]">{t('actions.no', { defaultValue: 'No' })}</button>
                              </div>
                            ) : (
                              <button onClick={() => setConfirmDeleteId(pair.id)} className="btn-ghost p-1.5 text-red-500 hover:text-red-700" title="Remove">
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* MODALS                                                            */}
        {/* ═══════════════════════════════════════════════════════════════════ */}

        {/* ── Add Formulary Drug Modal ── */}
        {showFormularyModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold flex items-center gap-2"><Pill className="w-5 h-5" /> {t('formularyModal.title', { defaultValue: 'Add Drug to Formulary' })}</h3>
                <button onClick={() => setShowFormularyModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={submitFormulary} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('formularyModal.drugNameLabel', { defaultValue: 'Drug Name *' })}</label>
                    <input className="input" required value={formularyForm.name} onChange={e => setFormularyForm({...formularyForm, name: e.target.value})} placeholder={t('formularyModal.drugNamePlaceholder', { defaultValue: 'e.g. Napa Extra' })} />
                  </div>
                  <div>
                    <label className="label">{t('formularyModal.genericNameLabel', { defaultValue: 'Generic Name *' })}</label>
                    <input className="input" required value={formularyForm.generic_name} onChange={e => setFormularyForm({...formularyForm, generic_name: e.target.value})} placeholder={t('formularyModal.genericNamePlaceholder', { defaultValue: 'e.g. Paracetamol' })} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="label">{t('formularyModal.strengthLabel', { defaultValue: 'Strength' })}</label>
                    <input className="input" value={formularyForm.strength} onChange={e => setFormularyForm({...formularyForm, strength: e.target.value})} placeholder={t('formularyModal.strengthPlaceholder', { defaultValue: '500mg' })} />
                  </div>
                  <div>
                    <label className="label">{t('formularyModal.dosageFormLabel', { defaultValue: 'Dosage Form' })}</label>
                    <select className="input" value={formularyForm.dosage_form} onChange={e => setFormularyForm({...formularyForm, dosage_form: e.target.value})}>
                      <option value="">{t('formularyModal.selectPlaceholder', { defaultValue: 'Select…' })}</option>
                      <option>{t('formularyModal.forms.tablet', { defaultValue: 'Tablet' })}</option><option>{t('formularyModal.forms.capsule', { defaultValue: 'Capsule' })}</option><option>{t('formularyModal.forms.syrup', { defaultValue: 'Syrup' })}</option>
                      <option>{t('formularyModal.forms.suspension', { defaultValue: 'Suspension' })}</option><option>{t('formularyModal.forms.injection', { defaultValue: 'Injection' })}</option><option>{t('formularyModal.forms.ointment', { defaultValue: 'Ointment' })}</option>
                      <option>{t('formularyModal.forms.cream', { defaultValue: 'Cream' })}</option><option>{t('formularyModal.forms.drops', { defaultValue: 'Drops' })}</option><option>{t('formularyModal.forms.inhaler', { defaultValue: 'Inhaler' })}</option><option>{t('formularyModal.forms.other', { defaultValue: 'Other' })}</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">{t('formularyModal.routeLabel', { defaultValue: 'Route' })}</label>
                    <select className="input" value={formularyForm.route} onChange={e => setFormularyForm({...formularyForm, route: e.target.value})}>
                      <option value="">{t('formularyModal.selectPlaceholder', { defaultValue: 'Select…' })}</option>
                      <option>{t('formularyModal.routes.oral', { defaultValue: 'Oral' })}</option><option>IV</option><option>IM</option><option>SC</option>
                      <option>{t('formularyModal.routes.topical', { defaultValue: 'Topical' })}</option><option>{t('formularyModal.routes.inhalation', { defaultValue: 'Inhalation' })}</option><option>{t('formularyModal.routes.ophthalmic', { defaultValue: 'Ophthalmic' })}</option><option>{t('formularyModal.routes.other', { defaultValue: 'Other' })}</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="label">{t('formularyModal.manufacturerLabel', { defaultValue: 'Manufacturer' })}</label>
                    <input className="input" value={formularyForm.manufacturer} onChange={e => setFormularyForm({...formularyForm, manufacturer: e.target.value})} placeholder={t('formularyModal.manufacturerPlaceholder', { defaultValue: 'Square Pharma' })} />
                  </div>
                  <div>
                    <label className="label">{t('formularyModal.maxDailyDoseLabel', { defaultValue: 'Max Daily Dose (mg)' })}</label>
                    <input className="input" type="number" min="0" value={formularyForm.max_daily_dose_mg} onChange={e => setFormularyForm({...formularyForm, max_daily_dose_mg: e.target.value})} placeholder={t('formularyModal.maxDailyDosePlaceholder', { defaultValue: '4000' })} />
                  </div>
                  <div>
                    <label className="label">{t('formularyModal.unitPriceLabel', { defaultValue: 'Unit Price (৳)' })}</label>
                    <input className="input" type="number" min="0" step="0.01" value={formularyForm.unit_price} onChange={e => setFormularyForm({...formularyForm, unit_price: e.target.value})} placeholder={t('formularyModal.unitPricePlaceholder', { defaultValue: '5.00' })} />
                  </div>
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowFormularyModal(false)} className="btn-secondary">{t('actions.cancel', { defaultValue: 'Cancel' })}</button>
                  <button type="submit" className="btn-primary">{t('formularyModal.addBtn', { defaultValue: 'Add to Formulary' })}</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Add Interaction Pair Modal ── */}
        {showInteractionModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-modal w-full max-w-lg">
              <div className="flex items-center justify-between p-5 border-b border-[var(--color-border)]">
                <h3 className="font-semibold flex items-center gap-2"><Activity className="w-5 h-5" /> {t('interactionModal.title', { defaultValue: 'Add Drug Interaction Pair' })}</h3>
                <button onClick={() => setShowInteractionModal(false)} className="btn-ghost p-1.5"><X className="w-5 h-5" /></button>
              </div>
              <form onSubmit={submitInteraction} className="p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="label">{t('interactionModal.drugALabel', { defaultValue: 'Drug A (Generic) *' })}</label>
                    <input className="input" required value={interactionForm.drug_a_name} onChange={e => setInteractionForm({...interactionForm, drug_a_name: e.target.value})} placeholder={t('interactionModal.drugAPlaceholder', { defaultValue: 'e.g. warfarin' })} />
                  </div>
                  <div>
                    <label className="label">{t('interactionModal.drugBLabel', { defaultValue: 'Drug B (Generic) *' })}</label>
                    <input className="input" required value={interactionForm.drug_b_name} onChange={e => setInteractionForm({...interactionForm, drug_b_name: e.target.value})} placeholder={t('interactionModal.drugBPlaceholder', { defaultValue: 'e.g. ibuprofen' })} />
                  </div>
                </div>
                <div>
                  <label className="label">{t('interactionModal.severityLabel', { defaultValue: 'Severity *' })}</label>
                  <select className="input" value={interactionForm.severity} onChange={e => setInteractionForm({...interactionForm, severity: e.target.value})}>
                    <option value="minor">{t('interactionModal.severityOptions.minor', { defaultValue: 'Minor' })}</option>
                    <option value="moderate">{t('interactionModal.severityOptions.moderate', { defaultValue: 'Moderate' })}</option>
                    <option value="major">{t('interactionModal.severityOptions.major', { defaultValue: 'Major' })}</option>
                    <option value="contraindicated">{t('interactionModal.severityOptions.contraindicated', { defaultValue: 'Contraindicated' })}</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('interactionModal.descriptionLabel', { defaultValue: 'Description *' })}</label>
                  <textarea className="input min-h-[80px]" required value={interactionForm.description} onChange={e => setInteractionForm({...interactionForm, description: e.target.value})} placeholder={t('interactionModal.descriptionPlaceholder', { defaultValue: 'Clinical description of the interaction…' })} />
                </div>
                <div>
                  <label className="label">{t('interactionModal.recommendationLabel', { defaultValue: 'Recommendation' })}</label>
                  <textarea className="input min-h-[60px]" value={interactionForm.recommendation} onChange={e => setInteractionForm({...interactionForm, recommendation: e.target.value})} placeholder={t('interactionModal.recommendationPlaceholder', { defaultValue: 'What should the prescriber do?' })} />
                </div>
                <div className="flex justify-end gap-3 pt-2">
                  <button type="button" onClick={() => setShowInteractionModal(false)} className="btn-secondary">{t('actions.cancel', { defaultValue: 'Cancel' })}</button>
                  <button type="submit" className="btn-primary">{t('interactionModal.addBtn', { defaultValue: 'Add Interaction' })}</button>
                </div>
              </form>
            </div>
          </div>
        )}

      </div>
    </DashboardLayout>
  );
}
