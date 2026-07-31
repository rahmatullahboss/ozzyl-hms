import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import {
  FileText, ChevronRight, Plus, X, Printer, Download,
  CheckCircle, Clock, AlertTriangle
} from 'lucide-react';
import axios from 'axios';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Admission {
  id: number;
  admission_no: string;
  patient_name: string;
  patient_code: string;
  admission_date: string;
  discharge_date?: string;
  ward_name?: string;
  bed_number?: string;
  doctor_name?: string;
  admission_type: string;
  provisional_diagnosis?: string;
  status: string;
}

interface Medicine { name: string; dose?: string; frequency?: string; duration?: string; }

interface Summary {
  id?: number;
  admission_diagnosis?: string;
  final_diagnosis?: string;
  treatment_summary?: string;
  procedures_performed?: string[];
  medicines_on_discharge?: Medicine[];
  follow_up_date?: string;
  follow_up_instructions?: string;
  doctor_notes?: string;
  status: 'draft' | 'final';
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

function fmt(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysBetween(a: string, b?: string) {
  const end = b ? new Date(b) : new Date();
  const diff = end.getTime() - new Date(a).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function DischargeSummary({
 role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['ipd', 'common']);

  const { slug = '', admissionId = '' } = useParams<{ slug: string; admissionId: string }>();
  const basePath = `/h/${slug}`;

  const [admission, setAdmission] = useState<Admission | null>(null);
  const [summary, setSummary] = useState<Summary>({
    status: 'draft',
    procedures_performed: [],
    medicines_on_discharge: [],
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newProcedure, setNewProcedure] = useState('');
  const [newMed, setNewMed] = useState<Medicine>({ name: '', dose: '', frequency: '', duration: '' });
  const [showMedModal, setShowMedModal] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`/api/discharge/${admissionId}`, { headers: authHeaders() });
      setAdmission(res.data.admission);
      if (res.data.summary) {
        setSummary({
          ...res.data.summary,
          procedures_performed: res.data.summary.procedures_performed ?? [],
          medicines_on_discharge: res.data.summary.medicines_on_discharge ?? [],
        });
      }
    } catch {
      // Demo fallback
      setAdmission({
        id: 1, admission_no: 'ADM-00001', patient_name: 'Mohammad Karim',
        patient_code: 'P-00001', admission_date: new Date(Date.now() - 7 * 86400000).toISOString(),
        discharge_date: new Date().toISOString(), ward_name: 'Ward A', bed_number: 'A-1',
        doctor_name: 'Dr. Rahman', admission_type: 'emergency',
        provisional_diagnosis: 'Acute appendicitis', status: 'discharged',
      });
    } finally {
      setLoading(false);
    }
  }, [admissionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleSave = async (finalise = false) => {
    setSaving(true);
    try {
      await axios.put(`/api/discharge/${admissionId}`, {
        ...summary,
        status: finalise ? 'final' : 'draft',
      }, { headers: authHeaders() });
      toast.success(finalise ? t('ipd.dischargeSummaryFinalised') : t('ipd.draftSaved'));
      if (finalise) setSummary(s => ({ ...s, status: 'final' }));
    } catch {
      toast.error(t('ipd.failed_to_save_summary'));
    } finally {
      setSaving(false);
    }
  };

  const addProcedure = () => {
    if (!newProcedure.trim()) return;
    setSummary(s => ({ ...s, procedures_performed: [...(s.procedures_performed ?? []), newProcedure.trim()] }));
    setNewProcedure('');
  };

  const removeProcedure = (i: number) => {
    setSummary(s => ({ ...s, procedures_performed: (s.procedures_performed ?? []).filter((_, idx) => idx !== i) }));
  };

  const addMedicine = () => {
    if (!newMed.name.trim()) { toast.error(t('ipd.medicine_name_required')); return; }
    setSummary(s => ({ ...s, medicines_on_discharge: [...(s.medicines_on_discharge ?? []), { ...newMed }] }));
    setNewMed({ name: '', dose: '', frequency: '', duration: '' });
    setShowMedModal(false);
  };

  const removeMedicine = (i: number) => {
    setSummary(s => ({ ...s, medicines_on_discharge: (s.medicines_on_discharge ?? []).filter((_, idx) => idx !== i) }));
  };

  const handlePrint = () => window.print();

  if (loading) {
    return (
      <DashboardLayout role={role}>
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton h-40 rounded-xl" />)}
        </div>
      </DashboardLayout>
    );
  }

  const isFinal = summary.status === 'final';
  const stayDays = admission ? daysBetween(admission.admission_date, admission.discharge_date) : 0;

  return (
    <DashboardLayout role={role}>
      {/* Print styles */}
      <style>{`
        @media print {
          header, nav, aside, .no-print { display: none !important; }
          .print-area { box-shadow: none !important; }
        }
      `}</style>

      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 no-print">
          <div>
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1 mb-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/admissions`} className="hover:underline">Admissions</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="text-[var(--color-text)] font-medium">{t('dischargeSummary', { defaultValue: 'Discharge Summary' })}</span>
            </div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-[var(--color-text)]">Discharge Summary</h1>
              {admission && (
                <span className="text-sm bg-[var(--color-bg)] border border-[var(--color-border)] rounded-full px-3 py-0.5 text-[var(--color-text-muted)]">
                  {admission.patient_name} · {admission.admission_no}
                </span>
              )}
              <span className={`text-xs font-medium rounded-full px-2 py-0.5 flex items-center gap-1 ${
                isFinal ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {isFinal ? <CheckCircle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                {isFinal ? 'Finalised' : 'Draft'}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
              <Printer className="w-4 h-4" /> Print
            </button>
            <button className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> Download PDF
            </button>
          </div>
        </div>

        {/* Main: 60/40 layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 print-area">

          {/* ── Left column (60%) ── */}
          <div className="lg:col-span-3 space-y-4">

            {/* Admission Info */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
                <FileText className="w-4 h-4 text-[var(--color-primary)]" /> Patient & Admission Info
              </h2>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                {[
                  ['Patient Name', admission?.patient_name],
                  ['MRN / Code', admission?.patient_code],
                  ['Admission Date', fmt(admission?.admission_date)],
                  ['Discharge Date', fmt(admission?.discharge_date)],
                  ['Ward / Bed', admission?.ward_name && admission?.bed_number ? `${admission.ward_name} — ${admission.bed_number}` : '—'],
                  ['Duration', `${stayDays} day${stayDays !== 1 ? 's' : ''}`],
                  ['Attending Doctor', admission?.doctor_name || '—'],
                  ['Admission Type', admission?.admission_type || '—'],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-[var(--color-text-muted)]">{label}</p>
                    <p className="font-medium text-[var(--color-text)] capitalize">{value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Diagnosis */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Diagnosis</h2>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Admission Diagnosis</label>
                <textarea value={summary.admission_diagnosis ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, admission_diagnosis: e.target.value }))}
                  rows={2} placeholder={t("ipd.provisional_diagnosis_at_time_of_admission")}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Final Diagnosis</label>
                <textarea value={summary.final_diagnosis ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, final_diagnosis: e.target.value }))}
                  rows={2} placeholder={t("ipd.final_confirmed_diagnosis_at_discharge")}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
            </div>

            {/* Treatment Summary */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Treatment Summary</h2>
              <textarea value={summary.treatment_summary ?? ''} readOnly={isFinal}
                onChange={e => setSummary(s => ({ ...s, treatment_summary: e.target.value }))}
                rows={5} placeholder={t("ipd.describe_the_course_of_treatment_surgeries_and_interventions")}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
            </div>

            {/* Procedures */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Procedures Performed</h2>
              <div className="space-y-2 mb-3">
                {(summary.procedures_performed ?? []).length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">No procedures added</p>
                ) : (
                  (summary.procedures_performed ?? []).map((p, i) => (
                    <div key={i} className="flex items-center gap-2 bg-[var(--color-bg)] rounded-lg px-3 py-2 text-sm">
                      <span className="flex-1">{p}</span>
                      {!isFinal && (
                        <button onClick={() => removeProcedure(i)} className="text-red-400 hover:text-red-600">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
              {!isFinal && (
                <div className="flex gap-2">
                  <input type="text" value={newProcedure}
                    onChange={e => setNewProcedure(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addProcedure()}
                    placeholder={t("ipd.eg_laparoscopic_appendectomy")}
                    className="flex-1 px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                  <button onClick={addProcedure} className="btn-secondary px-3">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Right column (40%) ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Medicines on Discharge */}
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-[var(--color-text)]">Medicines on Discharge</h2>
                {!isFinal && (
                  <button onClick={() => setShowMedModal(true)} className="text-xs text-[var(--color-primary)] hover:underline flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                )}
              </div>
              {(summary.medicines_on_discharge ?? []).length === 0 ? (
                <p className="text-sm text-[var(--color-text-muted)]">No medicines added</p>
              ) : (
                <div className="space-y-2">
                  {(summary.medicines_on_discharge ?? []).map((m, i) => (
                    <div key={i} className="bg-[var(--color-bg)] rounded-lg px-3 py-2 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{m.name}</span>
                        {!isFinal && (
                          <button onClick={() => removeMedicine(i)} className="text-red-400 hover:text-red-600">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      {(m.dose || m.frequency || m.duration) && (
                        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                          {[m.dose, m.frequency, m.duration].filter(Boolean).join(' · ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Follow-up */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Follow-up Instructions</h2>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Follow-up Date</label>
                <input type="date" value={summary.follow_up_date ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, follow_up_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
              <textarea value={summary.follow_up_instructions ?? ''} readOnly={isFinal}
                onChange={e => setSummary(s => ({ ...s, follow_up_instructions: e.target.value }))}
                rows={3} placeholder={t("ipd.postdischarge_care_instructions_wound_care_activity_restrict")}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
            </div>

            {/* Doctor Notes */}
            <div className="card p-5">
              <h2 className="text-sm font-semibold text-[var(--color-text)] mb-3">Doctor's Notes</h2>
              <textarea value={summary.doctor_notes ?? ''} readOnly={isFinal}
                onChange={e => setSummary(s => ({ ...s, doctor_notes: e.target.value }))}
                rows={3} placeholder={t("ipd.optional_final_clinical_observations")}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
            </div>

            {/* Save buttons */}
            {!isFinal && (
              <div className="space-y-2 no-print">
                <button onClick={() => handleSave(false)} disabled={saving}
                  className="btn-secondary w-full">
                  {saving ? 'Saving...' : '💾 Save Draft'}
                </button>
                <button onClick={() => handleSave(true)} disabled={saving}
                  className="btn-primary w-full">
                  {saving ? 'Finalising...' : '✅ Finalise & Lock Summary'}
                </button>
              </div>
            )}
            {isFinal && (
              <div className="card p-4 bg-emerald-50 border border-emerald-200 text-center no-print">
                <CheckCircle className="w-6 h-6 text-emerald-600 mx-auto mb-1" />
                <p className="text-sm font-semibold text-emerald-800">Summary Finalised</p>
                <p className="text-xs text-emerald-600 mt-1">This record is locked</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Add Medicine Modal ── */}
      {showMedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setShowMedModal(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-bold">Add Medicine on Discharge</h2>
              <button onClick={() => setShowMedModal(false)} className="p-1 hover:bg-gray-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              {(['name', 'dose', 'frequency', 'duration'] as const).map(field => (
                <div key={field}>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block capitalize">
                    {field}{field === 'name' ? ' *' : ''}
                  </label>
                  <input type="text" value={newMed[field] ?? ''}
                    onChange={e => setNewMed(m => ({ ...m, [field]: e.target.value }))}
                    placeholder={field === 'name' ? 'e.g. Amoxicillin 500mg' : field === 'dose' ? '1 tab' : field === 'frequency' ? 'TDS' : '7 days'}
                    className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setShowMedModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={addMedicine} className="btn-primary">Add Medicine</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Alert if not yet discharged ── */}
      {admission && admission.status === 'admitted' && (
        <div className="fixed bottom-4 right-4 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center gap-2 shadow-lg text-sm no-print">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-amber-800">Patient is still admitted — discharge first before finalising summary</span>
        </div>
      )}
    </DashboardLayout>
  );
}
