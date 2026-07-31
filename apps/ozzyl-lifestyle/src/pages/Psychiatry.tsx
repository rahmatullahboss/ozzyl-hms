import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, Plus, X, AlertTriangle, User } from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';

function authHeaders() {
  const { t } = useTranslation('clinical');
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

interface PatientResult {
  id: number;
  name: string;
  patient_code: string;
}

interface MentalStatusExam {
  MseId: number;
  PatientId: number;
  ExamDate: string;
  Appearance?: string;
  Behavior?: string;
  Mood?: string;
  Affect?: string;
  ThoughtProcess?: string;
  Alertness?: string;
  Insight?: string;
  Judgment?: string;
  SuicidalIdeation?: boolean;
  HomicidalIdeation?: boolean;
  Delusions?: boolean;
  Hallucinations?: boolean;
  SuicideRisk?: string;
  ViolenceRisk?: string;
  ClinicalNotes?: string;
}

const EMPTY_FORM = {
  Appearance: '',
  Behavior: '',
  Mood: '',
  Affect: '',
  ThoughtProcess: '',
  Alertness: 'alert',
  Insight: 'good',
  Judgment: 'good',
  SuicidalIdeation: false,
  HomicidalIdeation: false,
  Delusions: false,
  Hallucinations: false,
  SuicideRisk: 'low',
  ViolenceRisk: 'low',
  ClinicalNotes: '',
};

const RISK_BADGE: Record<string, string> = {
  low:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  moderate: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  high:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  imminent: 'bg-red-700 text-white',
};

function RiskBadge({ level }: { level?: string }) {
  if (!level) return <span className="text-[var(--color-text-muted)]">—</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${RISK_BADGE[level] ?? RISK_BADGE.high}`}>
      {level}
    </span>
  );
}

export default function Psychiatry({ role }: { role?: string }) {
  const [search, setSearch] = useState('');
  const [patients, setPatients] = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  const [mseList, setMseList] = useState<MentalStatusExam[]>([]);
  const [loadingMse, setLoadingMse] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  /* Escape key closes modal */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowModal(false); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  /* Debounced patient search */
  const searchPatients = useCallback(async () => {
    if (search.length < 2) { setPatients([]); return; }
    try {
      const res = await axios.get(`/api/patients?search=${encodeURIComponent(search)}&limit=10`, {
        headers: authHeaders(),
      });
      setPatients(res.data?.patients ?? res.data?.Results ?? []);
    } catch { /* silent */ }
  }, [search]);

  useEffect(() => {
    const t = setTimeout(searchPatients, 300);
    return () => clearTimeout(t);
  }, [searchPatients]);

  const loadMseList = async (patientId: number) => {
    setLoadingMse(true);
    try {
      const res = await axios.get(`/api/psychiatry/mse/${patientId}`, { headers: authHeaders() });
      setMseList(res.data?.Results ?? res.data?.data ?? res.data ?? []);
    } catch {
      toast.error(t('clinical.failed_to_load_mental_status_exams'));
      setMseList([]);
    } finally {
      setLoadingMse(false);
    }
  };

  const handleSelectPatient = (p: PatientResult) => {
    setSelectedPatient(p);
    setPatients([]);
    setSearch('');
    loadMseList(p.id);
  };

  const handleSaveMse = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPatient) return;
    setSaving(true);
    try {
      await axios.post('/api/psychiatry/mse', {
        PatientId: selectedPatient.id,
        Appearance:        form.Appearance || undefined,
        Behavior:          form.Behavior || undefined,
        Mood:              form.Mood || undefined,
        Affect:            form.Affect || undefined,
        ThoughtProcess:    form.ThoughtProcess || undefined,
        Alertness:         form.Alertness,
        Insight:           form.Insight,
        Judgment:          form.Judgment,
        SuicidalIdeation:  form.SuicidalIdeation,
        HomicidalIdeation: form.HomicidalIdeation,
        Delusions:         form.Delusions,
        Hallucinations:    form.Hallucinations,
        SuicideRisk:       form.SuicideRisk,
        ViolenceRisk:      form.ViolenceRisk,
        ClinicalNotes:     form.ClinicalNotes || undefined,
      }, { headers: authHeaders() });
      toast.success(t('clinical.mental_status_exam_saved'));
      setShowModal(false);
      setForm({ ...EMPTY_FORM });
      loadMseList(selectedPatient.id);
    } catch (err) {
      toast.error(axios.isAxiosError(err) ? err.response?.data?.message ?? 'Failed to save' : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const setField = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <DashboardLayout role={role ?? 'hospital_admin'}>
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">

        {/* Page header */}
        <div className="page-header">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="page-title">Psychiatry</h1>
              <p className="text-sm text-[var(--color-text-muted)]">Mental Status Examinations</p>
            </div>
          </div>
          {selectedPatient && (
            <button onClick={() => setShowModal(true)} className="btn btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              New MSE
            </button>
          )}
        </div>

        {/* Patient search */}
        <div className="card p-4 relative">
          <label className="label">{t('common.patient')}</label>
          <div className="relative">
            <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              placeholder={t("common.search_by_name_or_code")}
              value={selectedPatient ? `${selectedPatient.name} (${selectedPatient.patient_code})` : search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedPatient(null);
                setMseList([]);
              }}
              className="input w-full pl-9"
            />
          </div>
          {patients.length > 0 && (
            <div className="absolute z-10 left-4 right-4 top-full bg-[var(--color-card)] border border-[var(--color-border)] rounded-lg shadow-lg mt-1 max-h-52 overflow-y-auto">
              {patients.map((p) => (
                <button
                  key={p.id}
                  onClick={() => handleSelectPatient(p)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-[var(--color-bg-secondary)] transition-colors"
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="text-[var(--color-text-muted)] ml-2">{p.patient_code}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* MSE list */}
        {selectedPatient && (
          <div className="card overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
              <h3 className="section-title">
                MSE History — {selectedPatient.name}
              </h3>
              {!loadingMse && mseList.length > 0 && (
                <span className="text-xs text-[var(--color-text-muted)]">{mseList.length} record{mseList.length !== 1 ? 's' : ''}</span>
              )}
            </div>

            {loadingMse ? (
              <div className="p-8 text-center text-sm text-[var(--color-text-muted)]">Loading…</div>
            ) : mseList.length === 0 ? (
              <div className="p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)]">
                <Brain className="w-10 h-10 mb-3 opacity-30" />
                <p className="text-sm font-medium">No Mental Status Exams recorded</p>
                <button onClick={() => setShowModal(true)} className="btn btn-primary mt-4 flex items-center gap-2 text-sm">
                  <Plus className="w-4 h-4" /> New MSE
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table-base w-full text-sm">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Mood</th>
                      <th>Affect</th>
                      <th>Suicide Risk</th>
                      <th>Violence Risk</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mseList.map((mse) => (
                      <tr key={mse.MseId}>
                        <td className="font-data whitespace-nowrap">{String(mse.ExamDate).slice(0, 10)}</td>
                        <td>{mse.Mood ?? '—'}</td>
                        <td>{mse.Affect ?? '—'}</td>
                        <td><RiskBadge level={mse.SuicideRisk} /></td>
                        <td><RiskBadge level={mse.ViolenceRisk} /></td>
                        <td className="max-w-xs">
                          {mse.ClinicalNotes
                            ? <span className="text-[var(--color-text-muted)] line-clamp-2">{mse.ClinicalNotes.slice(0, 120)}{mse.ClinicalNotes.length > 120 ? '…' : ''}</span>
                            : <span className="text-[var(--color-text-muted)]">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Placeholder when no patient selected */}
        {!selectedPatient && (
          <div className="card p-12 flex flex-col items-center justify-center text-[var(--color-text-muted)] min-h-64">
            <Brain className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-base font-medium text-[var(--color-text)]">No patient selected</p>
            <p className="text-sm mt-1">Search and select a patient to view or record Mental Status Exams.</p>
          </div>
        )}
      </div>

      {/* New MSE Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-[var(--color-card)] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">

            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] sticky top-0 bg-[var(--color-card)] z-10">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-violet-500" />
                <h3 className="font-semibold text-[var(--color-text)]">New Mental Status Exam</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="btn btn-secondary p-1.5 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMse} className="px-6 py-5 space-y-5">

              {/* Appearance & Behavior */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('common.appearance')}</label>
                  <input
                    className="input w-full"
                    placeholder={t("common.eg_wellgroomed_disheveled")}
                    value={form.Appearance}
                    onChange={(e) => setField('Appearance', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">{t('common.behavior')}</label>
                  <input
                    className="input w-full"
                    placeholder={t("common.eg_cooperative_agitated")}
                    value={form.Behavior}
                    onChange={(e) => setField('Behavior', e.target.value)}
                  />
                </div>
              </div>

              {/* Mood & Affect */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('common.mood')}</label>
                  <input
                    className="input w-full"
                    placeholder={t("common.eg_depressed_anxious_euthymic")}
                    value={form.Mood}
                    onChange={(e) => setField('Mood', e.target.value)}
                  />
                </div>
                <div>
                  <label className="label">{t('common.affect')}</label>
                  <input
                    className="input w-full"
                    placeholder={t("common.eg_flat_labile_congruent")}
                    value={form.Affect}
                    onChange={(e) => setField('Affect', e.target.value)}
                  />
                </div>
              </div>

              {/* Thought Process */}
              <div>
                <label className="label">{t('common.thought_process')}</label>
                <input
                  className="input w-full"
                  placeholder={t("common.eg_linear_tangential_circumstantial")}
                  value={form.ThoughtProcess}
                  onChange={(e) => setField('ThoughtProcess', e.target.value)}
                />
              </div>

              {/* Selects row 1 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="label">{t('common.alertness')}</label>
                  <select className="input w-full" value={form.Alertness} onChange={(e) => setField('Alertness', e.target.value)}>
                    <option value="alert">Alert</option>
                    <option value="drowsy">Drowsy</option>
                    <option value="stuporous">Stuporous</option>
                    <option value="comatose">Comatose</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('common.insight')}</label>
                  <select className="input w-full" value={form.Insight} onChange={(e) => setField('Insight', e.target.value)}>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('common.judgment')}</label>
                  <select className="input w-full" value={form.Judgment} onChange={(e) => setField('Judgment', e.target.value)}>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                    <option value="absent">Absent</option>
                  </select>
                </div>
              </div>

              {/* Checkboxes */}
              <div>
                <p className="label mb-2">Symptoms Present</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {(
                    [
                      { key: 'SuicidalIdeation',  label: 'Suicidal Ideation' },
                      { key: 'HomicidalIdeation', label: 'Homicidal Ideation' },
                      { key: 'Delusions',         label: 'Delusions' },
                      { key: 'Hallucinations',    label: 'Hallucinations' },
                    ] as const
                  ).map(({ key, label }) => (
                    <label
                      key={key}
                      className={`flex items-center gap-2 cursor-pointer rounded-lg border px-3 py-2.5 text-sm transition-colors select-none ${
                        form[key]
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:border-[var(--color-primary)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="accent-violet-600 w-4 h-4"
                        checked={form[key]}
                        onChange={(e) => setField(key, e.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Risk selects */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="label">{t('common.suicide_risk')}</label>
                  <select
                    className="input w-full"
                    value={form.SuicideRisk}
                    onChange={(e) => setField('SuicideRisk', e.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="moderate">Moderate</option>
                    <option value="high">High</option>
                    <option value="imminent">Imminent</option>
                  </select>
                </div>
                <div>
                  <label className="label">{t('common.violence_risk')}</label>
                  <select
                    className="input w-full"
                    value={form.ViolenceRisk}
                    onChange={(e) => setField('ViolenceRisk', e.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="moderate">Moderate</option>
                    <option value="high">High</option>
                    <option value="imminent">Imminent</option>
                  </select>
                </div>
              </div>

              {/* Risk preview badges */}
              {(form.SuicideRisk !== 'low' || form.ViolenceRisk !== 'low') && (
                <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-bg-secondary)] border border-[var(--color-border)]">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <span className="text-[var(--color-text-muted)]">Risk flags:</span>
                    <RiskBadge level={form.SuicideRisk} />
                    <span className="text-[var(--color-text-muted)]">suicide</span>
                    <span className="text-[var(--color-text-muted)]">·</span>
                    <RiskBadge level={form.ViolenceRisk} />
                    <span className="text-[var(--color-text-muted)]">violence</span>
                  </div>
                </div>
              )}

              {/* Clinical Notes */}
              <div>
                <label className="label">{t('common.clinical_notes')}</label>
                <textarea
                  className="input w-full resize-none"
                  rows={4}
                  placeholder={t("common.clinical_observations_treatment_plan_followup_notes")}
                  value={form.ClinicalNotes}
                  onChange={(e) => setField('ClinicalNotes', e.target.value)}
                />
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary flex items-center gap-2"
                >
                  {saving ? 'Saving…' : (<><Plus className="w-4 h-4" /> Save MSE</>)}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
