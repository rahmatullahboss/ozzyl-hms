import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import {
  FileText, ChevronRight, Plus, X, Printer, Download,
  CheckCircle, Clock, AlertTriangle, Receipt
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import DischargeClearancePanel from '../components/DischargeClearancePanel';
import { useTranslation } from 'react-i18next';
import { useApiQuery, useApiMutation, useQueryClient } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { printDischargeSummary } from '../lib/print/dischargeSummaryTemplate';

// --- Types -------------------------------------------------------------------

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
  template_id?: number;
  id?: number;
  admission_diagnosis?: string;
  final_diagnosis?: string;
  provisional_diagnosis?: string;
  treatment_summary?: string;
  procedures_performed?: string[];
  medicines_on_discharge?: Medicine[];
  follow_up_date?: string;
  follow_up_instructions?: string;
  doctor_notes?: string;
  chief_complaint?: string;
  presenting_illness?: string;
  hospital_course?: string;
  clinical_findings?: string;
  past_history?: string;
  pending_reports?: string;
  operative_procedure?: string;
  operative_findings?: string;
  histology_report?: string;
  special_notes?: string;
  allergies?: string;
  activities?: string;
  diet?: string;
  rest_days?: number;
  lab_results?: string;
  imaging_results?: string;
  lab_tests?: string[];
  imaging_items?: string[];
  discharge_condition?: string;
  discharge_type?: string;
  status: 'draft' | 'final';
}

interface DischargeResponse {
  admission: Admission;
  summary?: Summary;
  consultants?: Array<Record<string, unknown>>;
}

interface BillingSummary {
  provisional_total: number;
  bed_total: number;
  grand_total: number;
  deposit_balance: number;
  net_payable: number;
}

interface BillingResponse {
  summary: BillingSummary;
}

interface DischargeCondition { id: number; name: string; }
interface DischargeTemplate { id: number; name: string; department?: string; fields?: Record<string, unknown>; }

// --- Helpers -----------------------------------------------------------------

function fmt(d?: string) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function daysBetween(a: string, b?: string) {
  const end = b ? new Date(b) : new Date();
  const diff = end.getTime() - new Date(a).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

const DEFAULT_SUMMARY: Summary = {
  status: 'draft',
  procedures_performed: [],
  medicines_on_discharge: [],
};

// --- Component ---------------------------------------------------------------

export default function DischargeSummary({
 role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['ipd', 'common']);

  const { slug = '', admissionId = '' } = useParams<{ slug: string; admissionId: string }>();
  const basePath = `/h/${slug}`;

  const queryClient = useQueryClient();

  // --- Server data -----------------------------------------------------------

  const {
    data: dischargeData,
    isLoading: loading,
    isError,
  } = useApiQuery<DischargeResponse>(
    queryKeys.discharge.detail(admissionId),
    `/api/discharge/${admissionId}`,
    { enabled: !!admissionId },
  );

  const conditionsQuery = useApiQuery<{ conditions: DischargeCondition[] }>(
    [...queryKeys.admissions.all, 'discharge-conditions'],
    '/api/admissions/discharge-conditions',
  );
  const templatesQuery = useApiQuery<{ templates: DischargeTemplate[] }>(
    [...queryKeys.discharge.all, 'templates'],
    '/api/discharge/templates/list',
  );

  // Billing status — fetched once the admission ID is known
  const billingQuery = useApiQuery<BillingResponse>(
    queryKeys.billing.pending(admissionId),
    `/api/ip-billing/pending/${admissionId}`,
    { enabled: !!admissionId },
  );

  const dischargeConditions = conditionsQuery.data?.conditions ?? [];
  const templates = templatesQuery.data?.templates ?? [];

  // Derive admission from query data
  const admission: Admission | null = dischargeData?.admission ?? null;

  // --- Local form state (seeded from server) ---------------------------------

  const [summary, setSummary] = useState<Summary>(DEFAULT_SUMMARY);
  const [formSeeded, setFormSeeded] = useState(false);
  const [newProcedure, setNewProcedure] = useState('');
  const [newMed, setNewMed] = useState<Medicine>({ name: '', dose: '', frequency: '', duration: '' });
  const [newConsultant, setNewConsultant] = useState({ consultant_id: '', role: 'consultant' });
  const [showMedModal, setShowMedModal] = useState(false);

  // Seed local summary state when server data arrives
  useEffect(() => {
    if (!dischargeData || !admissionId) return;
    setFormSeeded(false);
    if (dischargeData.summary) {
      setSummary({
        ...dischargeData.summary,
        procedures_performed: dischargeData.summary.procedures_performed ?? [],
        medicines_on_discharge: dischargeData.summary.medicines_on_discharge ?? [],
      });
    } else {
      setSummary({ ...DEFAULT_SUMMARY });
    }
    setFormSeeded(true);
  }, [dischargeData, admissionId]);

  // --- Save mutation ---------------------------------------------------------

  const saveMutation = useApiMutation<DischargeResponse, Summary>(
    'put',
    `/api/discharge/${admissionId}`,
    {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.discharge.detail(admissionId) });
      },
      onError: () => {
        toast.error(t('ipd.failed_to_save_summary'));
      },
    },
  );

  const saving = saveMutation.isPending;

  const addConsultantMutation = useApiMutation<unknown, { consultant_id: number; role: string }>(
    'post',
    `/api/discharge/${admissionId}/consultants`,
    {
      onSuccess: () => {
        toast.success('Consultant added');
        setNewConsultant({ consultant_id: '', role: 'consultant' });
        queryClient.invalidateQueries({ queryKey: queryKeys.discharge.detail(admissionId) });
      },
      onError: (err) => toast.error(err.message || 'Failed to add consultant'),
    },
  );

  const removeConsultantMutation = useApiMutation<unknown, { consultant_id: number }>(
    'delete',
    (vars) => `/api/discharge/${admissionId}/consultants/${vars.consultant_id}`,
    {
      onSuccess: () => {
        toast.success('Consultant removed');
        queryClient.invalidateQueries({ queryKey: queryKeys.discharge.detail(admissionId) });
      },
      onError: (err) => toast.error(err.message || 'Failed to remove consultant'),
    },
  );

  // --- Error state (after hooks to keep hook order stable) ---------------------
  if (isError) {
    return (
      <DashboardLayout role={role}>
        <div className="flex flex-col items-center justify-center py-16">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
          <h3 className="text-lg font-semibold">{t('failedToLoadDischargeSummary', { defaultValue: 'Failed to load discharge summary' })}</h3>
          <p className="text-sm text-[var(--color-text-muted)] mt-2">{t('pleaseTryAgain', { defaultValue: 'Please try again or contact support' })}</p>
          <button onClick={() => window.location.reload()} className="mt-4 btn btn-primary">
            {t('retry', { defaultValue: 'Retry' })}
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const handleSave = (finalise = false) => {
    // Validate required diagnosis fields before save
    const hasRequiredDiagnosis =
      summary.admission_diagnosis?.trim() ||
      summary.provisional_diagnosis?.trim() ||
      summary.final_diagnosis?.trim();
    if (!hasRequiredDiagnosis) {
      toast.error(t('diagnosisRequired', { defaultValue: 'At least one diagnosis field is required' }));
      return;
    }

    if (finalise) {
      if (!admission || admission.status !== 'discharged') {
        toast.error(t('patientStillAdmitted', { defaultValue: 'Patient is still admitted — complete discharge settlement first.' }));
        return;
      }
    }

    const payload: Summary = { ...summary, status: finalise ? 'final' : 'draft' };
    saveMutation.mutate(payload, {
      onSuccess: () => {
        toast.success(finalise ? t('ipd.dischargeSummaryFinalised') : t('ipd.draftSaved'));
        if (finalise) {
          setSummary(s => ({ ...s, status: 'final' }));
        }
      },
    });
  };

  // --- Local list helpers (no network) ---------------------------------------

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

  if (isError) {
    return (
      <DashboardLayout role={role}>
        <div className="flex flex-col items-center justify-center py-16">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-4" />
          <h3 className="text-lg font-semibold">{t('failedToLoadDischargeSummary', { defaultValue: 'Failed to load discharge summary' })}</h3>
          <p className="text-sm text-[var(--color-text-muted)] mt-2">{t('pleaseTryAgain', { defaultValue: 'Please try again or contact support' })}</p>
          <button onClick={() => window.location.reload()} className="mt-4 btn btn-primary">
            {t('retry', { defaultValue: 'Retry' })}
          </button>
        </div>
      </DashboardLayout>
    );
  }

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
            <button onClick={() => {
              if (!admission) return;
              const s = summary;
              printDischargeSummary({
                admissionNo: admission.admission_no,
                admissionDate: admission.admission_date,
                dischargeDate: admission.discharge_date,
                durationDays: stayDays,
                patient: {
                  name: admission.patient_name,
                  patientCode: admission.patient_code,
                  ward: admission.ward_name,
                  bed: admission.bed_number,
                  doctor: admission.doctor_name,
                },
                diagnosis: {
                  provisional: s.provisional_diagnosis,
                  admission: s.admission_diagnosis,
                  final: s.final_diagnosis,
                },
                treatmentSummary: s.treatment_summary,
                investigationSummary: [s.lab_results, s.imaging_results].filter(Boolean).join('\n\n') || undefined,
                medicines: s.medicines_on_discharge,
                followUp: {
                  date: s.follow_up_date,
                  instructions: s.follow_up_instructions,
                },
                consultants: (dischargeData?.consultants ?? []).map((c: Record<string, unknown>) => ({
                  name: String(c.consultant_name ?? c.consultant_id ?? ''),
                  role: String(c.role ?? 'consultant'),
                })),
              });
            }} className="btn-secondary flex items-center gap-2">
              <Download className="w-4 h-4" /> Download PDF
            </button>
          </div>
        </div>

        {/* Main: 60/40 layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 print-area">

          {/* -- Left column (60%) -- */}
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

            {/* History & Presentation */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">History & Presentation</h2>
              {([
                ['chief_complaint', 'Chief Complaint', 2],
                ['presenting_illness', 'Presenting Illness / HPI', 3],
                ['past_history', 'Past Medical History', 2],
                ['clinical_findings', 'Clinical Findings on Admission', 3],
                ['allergies', 'Known Allergies', 1],
              ] as const).map(([key, label, rows]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">{label}</label>
                  <textarea value={(summary[key] as string) ?? ''} readOnly={isFinal}
                    onChange={e => setSummary(s => ({ ...s, [key]: e.target.value }))}
                    rows={rows} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
              ))}
            </div>

            {/* Diagnosis */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Diagnosis</h2>
              {([
                ['provisional_diagnosis', 'Provisional Diagnosis', 2],
                ['admission_diagnosis', 'Admission Diagnosis', 2],
                ['final_diagnosis', 'Final Diagnosis', 2],
              ] as const).map(([key, label, rows]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">{label}</label>
                  <textarea value={(summary[key] as string) ?? ''} readOnly={isFinal}
                    onChange={e => setSummary(s => ({ ...s, [key]: e.target.value }))}
                    rows={rows} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
              ))}
            </div>

            {/* Hospital Course & Treatment */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Hospital Course & Treatment</h2>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Hospital Course</label>
                <textarea value={summary.hospital_course ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, hospital_course: e.target.value }))}
                  rows={4} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Treatment Summary</label>
                <textarea value={summary.treatment_summary ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, treatment_summary: e.target.value }))}
                  rows={4} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
            </div>

            {/* Procedures & Operative */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Procedures & Operative Details</h2>
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
                    placeholder="e.g. Laparoscopic appendectomy"
                    className="flex-1 px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                  <button onClick={addProcedure} className="btn-secondary px-3">
                    <Plus className="w-4 h-4" />
                  </button>
                </div>
              )}
              {([
                ['operative_procedure', 'Operative Procedure Details', 3],
                ['operative_findings', 'Operative Findings', 2],
                ['histology_report', 'Histology / Pathology Report', 2],
              ] as const).map(([key, label, rows]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">{label}</label>
                  <textarea value={(summary[key] as string) ?? ''} readOnly={isFinal}
                    onChange={e => setSummary(s => ({ ...s, [key]: e.target.value }))}
                    rows={rows} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
              ))}
            </div>

            {/* Investigation Results */}
            <div className="card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Investigation Results</h2>
              {([
                ['lab_results', 'Lab Results Summary', 3],
                ['imaging_results', 'Imaging Results Summary', 3],
                ['pending_reports', 'Pending Reports / Investigations', 2],
              ] as const).map(([key, label, rows]) => (
                <div key={key}>
                  <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">{label}</label>
                  <textarea value={(summary[key] as string) ?? ''} readOnly={isFinal}
                    onChange={e => setSummary(s => ({ ...s, [key]: e.target.value }))}
                    rows={rows} className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
                </div>
              ))}
            </div>
          </div>

          {/* -- Right column (40%) -- */}
          <div className="lg:col-span-2 space-y-4">

            {/* Billing Status */}
            {admission && (
              <div className={`card p-5 space-y-3 ${billingQuery.isLoading ? 'opacity-60' : ''}`}>
                <h2 className="text-sm font-semibold text-[var(--color-text)] flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-[var(--color-primary)]" /> Billing Status
                </h2>
                {billingQuery.isLoading ? (
                  <p className="text-xs text-[var(--color-text-muted)]">Loading billing info...</p>
                ) : billingQuery.isError ? (
                  <div className="space-y-1">
                    <p className="text-xs text-red-500">Could not load billing info</p>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      Please check the connection or try again later.
                    </p>
                  </div>
                ) : (
                  (() => {
                    const bs = billingQuery.data?.summary;
                    if (!bs) return null;
                    const balance = Math.max(0, bs.net_payable ?? 0);
                    const isSettled = balance <= 0;
                    return (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[var(--color-text-muted)]">Total Charges</span>
                          <span className="font-medium text-[var(--color-text)]">BDT {Number(bs.grand_total ?? 0).toLocaleString()}</span>
                        </div>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-[var(--color-text-muted)]">Deposit Used</span>
                          <span className="font-medium text-[var(--color-text)]">BDT {Number(bs.deposit_balance ?? 0).toLocaleString()}</span>
                        </div>
                        <div className="border-t border-[var(--color-border)] pt-2 flex items-center justify-between">
                          <span className="text-[var(--color-text-muted)]">Balance</span>
                          <span className={`font-bold text-sm ${isSettled ? 'text-emerald-600' : 'text-red-600'}`}>
                            {isSettled ? (
                              <span className="flex items-center gap-1"><CheckCircle className="w-3.5 h-3.5" /> Settled</span>
                            ) : (
                              <>BDT {balance.toLocaleString()} Pending</>
                            )}
                          </span>
                        </div>
                        {!isSettled && (
                          <div className="rounded-lg bg-red-50 border border-red-200 p-2 text-xs text-red-700">
                            Settlement required before final discharge
                          </div>
                        )}
                      </div>
                    );
                  })()
                )}
              </div>
            )}

            {/* Discharge Clearance Checklist */}
            {admission && (
              <DischargeClearancePanel admissionId={admission.id} />
            )}

            {/* Template */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Summary Template</h2>
              <select
                value={summary.template_id ?? ''}
                disabled={isFinal}
                onChange={e => setSummary(s => ({ ...s, template_id: e.target.value ? parseInt(e.target.value) : undefined }))}
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30"
              >
                <option value="">Default template</option>
                {templates.map(template => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            </div>

            {/* Discharge Condition */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Discharge Details</h2>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Discharge Condition</label>
                <select value={summary.discharge_condition ?? ''} disabled={isFinal}
                  onChange={e => setSummary(s => ({ ...s, discharge_condition: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
                  <option value="">Select condition</option>
                  {dischargeConditions.map(c => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Discharge Type</label>
                <select value={summary.discharge_type ?? ''} disabled={isFinal}
                  onChange={e => setSummary(s => ({ ...s, discharge_type: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30">
                  <option value="">Select type</option>
                  {['Normal', 'Emergency', 'Transfer', 'Referral', 'LAMA', 'DAMA', 'Death'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Consultants */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Consultants</h2>
              <div className="space-y-2">
                {(dischargeData?.consultants ?? []).length === 0 ? (
                  <p className="text-sm text-[var(--color-text-muted)]">No consultants added</p>
                ) : (dischargeData?.consultants ?? []).map((consultant, idx) => (
                  <div key={String(consultant.consultant_id ?? idx)} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--color-bg)] px-3 py-2 text-sm">
                    <span>{String(consultant.consultant_name ?? consultant.consultant_id)} · {String(consultant.role ?? 'consultant')}</span>
                    {!isFinal && (
                      <button onClick={() => {
                        const consultantId = Number(consultant.consultant_id);
                        if (!consultantId || isNaN(consultantId)) {
                          toast.error('Invalid consultant');
                          return;
                        }
                        removeConsultantMutation.mutate({ consultant_id: consultantId });
                      }}
                        className="text-red-500 hover:text-red-700">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {!isFinal && (
                <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                  <input className="input text-xs" placeholder="Consultant ID" value={newConsultant.consultant_id}
                    onChange={e => setNewConsultant(v => ({ ...v, consultant_id: e.target.value }))} />
                  <input className="input text-xs" placeholder="Role" value={newConsultant.role}
                    onChange={e => setNewConsultant(v => ({ ...v, role: e.target.value }))} />
                  <button className="btn-secondary text-xs" onClick={() => addConsultantMutation.mutate({ consultant_id: Number(newConsultant.consultant_id), role: newConsultant.role || 'consultant' })}
                    disabled={!newConsultant.consultant_id}>
                    Add
                  </button>
                </div>
              )}
            </div>

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

            {/* Post-Discharge Instructions */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Post-Discharge Instructions</h2>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Activities / Restrictions</label>
                <textarea value={summary.activities ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, activities: e.target.value }))}
                  rows={2} placeholder="e.g. Avoid heavy lifting for 6 weeks"
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Diet Instructions</label>
                <textarea value={summary.diet ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, diet: e.target.value }))}
                  rows={2} placeholder="e.g. Soft diet for 3 days, then normal"
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Rest Days</label>
                <input type="number" min={0} value={summary.rest_days ?? ''} readOnly={isFinal}
                  onChange={e => {
                    const val = e.target.value;
                    if (val === '' || /^\d+$/.test(val)) {
                      setSummary(s => ({ ...s, rest_days: val ? parseInt(val) : undefined }));
                    }
                  }}
                  placeholder="0"
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
            </div>

            {/* Follow-up */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Follow-up</h2>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Follow-up Date</label>
                <input type="date" value={summary.follow_up_date ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, follow_up_date: e.target.value }))}
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
              <textarea value={summary.follow_up_instructions ?? ''} readOnly={isFinal}
                onChange={e => setSummary(s => ({ ...s, follow_up_instructions: e.target.value }))}
                rows={3} placeholder="Post-discharge care instructions, wound care, etc."
                className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
            </div>

            {/* Doctor Notes & Special Notes */}
            <div className="card p-5 space-y-3">
              <h2 className="text-sm font-semibold text-[var(--color-text)]">Notes</h2>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Doctor's Notes</label>
                <textarea value={summary.doctor_notes ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, doctor_notes: e.target.value }))}
                  rows={3} placeholder="Final clinical observations"
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--color-text-muted)] mb-1 block">Special Notes</label>
                <textarea value={summary.special_notes ?? ''} readOnly={isFinal}
                  onChange={e => setSummary(s => ({ ...s, special_notes: e.target.value }))}
                  rows={2} placeholder="Any special instructions or warnings"
                  className="w-full px-3 py-2 border border-[var(--color-border)] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]/30" />
              </div>
            </div>

            {/* Save buttons */}
            {!isFinal && (
              <div className="space-y-2 no-print">
                {(() => {
                  const bs = billingQuery.data?.summary;
                  const balance = Math.max(0, bs?.net_payable ?? 0);
                  const billingUnsettled = bs != null && balance > 0;
                  const admissionNotDischarged = admission?.status !== 'discharged';
                  const finaliseBlocked = admissionNotDischarged;
                  const finaliseTitle = admissionNotDischarged ? 'Complete discharge action before finalising' : undefined;
                  return (
                    <>
                      {admissionNotDischarged && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-xs text-amber-700 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold">Patient still admitted</p>
                            <p className="mt-0.5">Complete final settlement from the discharge modal before locking the clinical summary.</p>
                          </div>
                        </div>
                      )}
                      {billingUnsettled && (
                        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                          <div>
                            <p className="font-semibold">Billing due remains</p>
                            <p className="mt-0.5">BDT {balance.toLocaleString()} is pending. If discharge was approved on due, the clinical summary can still be locked.</p>
                          </div>
                        </div>
                      )}
                      <button onClick={() => handleSave(false)} disabled={saving}
                        className="btn-secondary w-full">
                        {saving ? 'Saving...' : '💾 Save Draft'}
                      </button>
                      <button
                        onClick={() => handleSave(true)}
                        disabled={saving || finaliseBlocked}
                        title={finaliseTitle}
                        className={`btn-primary w-full ${finaliseBlocked ? 'opacity-60 cursor-not-allowed' : ''}`}>
                        {saving ? 'Finalising...' : '✅ Finalise & Lock Summary'}
                      </button>
                    </>
                  );
                })()}
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

      {/* -- Add Medicine Modal -- */}
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

      {/* -- Alert if not yet discharged -- */}
      {admission && admission.status === 'admitted' && (
        <div className="fixed bottom-4 right-4 bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 flex items-center gap-2 shadow-lg text-sm no-print">
          <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
          <span className="text-amber-800">Patient is still admitted — discharge first before finalising summary</span>
        </div>
      )}
    </DashboardLayout>
  );
}
