import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Brain, ChevronRight, Printer, ShieldAlert, Stethoscope } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import { authHeader } from '../utils/auth';

interface Patient {
  id: number;
  patient_code: string;
  name: string;
  age?: number;
  gender?: string;
  blood_group?: string;
  mobile?: string;
  date_of_birth?: string;
}

interface BasicItem {
  id?: number | string;
  description?: string;
  severity?: string;
  status?: string;
  allergen?: string;
  reaction?: string;
  verified_at?: string;
  medication_name?: string;
  dosage?: string;
  frequency?: string;
  end_date?: string;
  updated_at?: string;
  provenance?: {
    category: string;
    badge_text: string;
    review_status: string;
  };
}

interface TimelineItem {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  doctor_name?: string;
  status?: string;
  date: string;
  provenance?: {
    category: string;
    badge_text: string;
    review_status: string;
  };
}

interface ChartResponse {
  patient: Patient;
  snapshot: {
    allergies: BasicItem[];
    activeProblems: BasicItem[];
    currentMedications: BasicItem[];
    riskFlags: Array<{ type: string; label: string; severity?: string }>;
    primaryDoctor?: { name: string } | null;
  };
  timeline: TimelineItem[];
  recentLabs: {
    abnormal: Array<Record<string, unknown>>;
  };
  dischargeSummaries?: Array<Record<string, unknown>>;
  documents?: Array<Record<string, unknown>>;
  referrals?: Array<Record<string, unknown>>;
  radiologyReports?: Array<Record<string, unknown>>;
  tasks: {
    chronicCareReminders?: Array<Record<string, unknown>>;
    vitalAlerts?: Array<Record<string, unknown>>;
  };
  familyRiskSummary?: {
    status: string;
    headline: string;
    summary: string;
    insights: Array<{ label: string; severity: string }>;
  };
  aiSummary: {
    status: 'ready' | 'fallback' | 'not_requested' | 'unavailable';
    generatedAt: string | null;
    summary: null | {
      oneLiner?: string;
      activeIssues?: Array<{ text: string; priority?: string; provenance?: string }>;
      familyHistory?: Array<{ text: string; priority?: string; provenance?: string }>;
      patientContext?: Array<{ text: string; priority?: string; provenance?: string }>;
      recentChanges?: Array<{ text: string; priority?: string; provenance?: string }>;
      medicationFocus?: Array<{ text: string; priority?: string; provenance?: string }>;
      abnormalFindings?: Array<{ text: string; priority?: string; provenance?: string }>;
      followUpRisks?: Array<{ text: string; priority?: string; provenance?: string }>;
      cautions?: Array<{ text: string; priority?: string; provenance?: string }>;
      provenanceFlags?: Array<{ text: string; priority?: string; provenance?: string }>;
    };
  };
}

function provenanceBadge(provenance?: string) {
  switch (provenance) {
    case 'patient_reported':
      return 'bg-amber-50 text-amber-700 border border-amber-200';
    case 'clinician_verified':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    case 'mixed':
      return 'bg-violet-50 text-violet-700 border border-violet-200';
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200';
  }
}

function provenanceCategoryBadge(category?: string) {
  switch (category) {
    case 'patient_reported':
      return 'bg-amber-50 text-amber-700 border border-amber-200';
    case 'clinician_verified':
      return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
    case 'imported_record':
      return 'bg-sky-50 text-sky-700 border border-sky-200';
    case 'family_history':
      return 'bg-rose-50 text-rose-700 border border-rose-200';
    case 'system_derived':
      return 'bg-indigo-50 text-indigo-700 border border-indigo-200';
    case 'mixed':
      return 'bg-violet-50 text-violet-700 border border-violet-200';
    default:
      return 'bg-slate-100 text-slate-700 border border-slate-200';
  }
}

function fmtDate(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function patientAge(patient?: Patient | null): string {
  if (!patient) return '—';
  if (patient.age) return `${patient.age}y`;
  if (!patient.date_of_birth) return '—';
  const dob = new Date(patient.date_of_birth);
  if (Number.isNaN(dob.getTime())) return '—';
  return `${Math.max(0, Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000)))}y`;
}

export default function PatientChartPrint({ role = 'hospital_admin' }: { role?: string }) {
  const { slug = '', id = '' } = useParams<{ slug: string; id: string }>();
  const [data, setData] = useState<ChartResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    setLoading(true);
    void axios.get<ChartResponse>(`/api/patients/${id}/chart?includeAiSummary=1`, {
      headers: authHeader(),
    }).then(({ data: res }) => {
      if (!cancelled) setData(res);
    }).catch(() => {
      if (!cancelled) setData(null);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  const patient = data?.patient;
  const snapshot = data?.snapshot;
  const aiSummary = data?.aiSummary;
  const recentLabs = data?.recentLabs.abnormal ?? [];
  const reminders = [
    ...(data?.tasks.vitalAlerts ?? []),
    ...(data?.tasks.chronicCareReminders ?? []),
  ];

  return (
    <DashboardLayout role={role}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .chart-paper { box-shadow: none !important; margin: 0 !important; max-width: none !important; }
          body { background: white !important; }
        }
      `}</style>

      {loading ? (
        <div className="animate-pulse h-96 bg-gray-100 rounded-xl" />
      ) : !data || !patient || !snapshot ? (
        <div className="card p-6 text-sm text-[var(--color-text-muted)]">Failed to load printable chart summary.</div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
              <Link to={`/h/${slug}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`/h/${slug}/patients/${id}/chart`} className="hover:underline">Doctor Workspace</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="font-medium text-[var(--color-text)]">Print Summary</span>
            </div>
            <button onClick={() => window.print()} className="btn btn-primary text-sm flex items-center gap-2">
              <Printer className="w-4 h-4" />
              Print Summary
            </button>
          </div>

          <div className="chart-paper bg-white mx-auto rounded-2xl shadow-xl p-8 max-w-5xl text-slate-900">
            <div className="flex items-start justify-between gap-6 border-b pb-5 border-slate-200">
              <div>
                <p className="text-xs uppercase tracking-[0.28em] text-slate-500">Doctor Chart Summary</p>
                <h1 className="text-3xl font-bold mt-2">{patient.name}</h1>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-sky-50 text-sky-700 px-2.5 py-1 font-medium">{patient.patient_code}</span>
                  {patient.blood_group && <span className="rounded-full bg-red-50 text-red-700 px-2.5 py-1 font-medium">{patient.blood_group}</span>}
                  {snapshot.riskFlags.map((flag, idx) => (
                    <span key={`${flag.type}-${idx}`} className="rounded-full bg-amber-50 text-amber-700 px-2.5 py-1 font-medium">{flag.label}</span>
                  ))}
                  {data.familyRiskSummary?.insights.slice(0, 2).map((item) => (
                    <span key={item.label} className="rounded-full bg-rose-50 text-rose-700 px-2.5 py-1 font-medium">{item.label}</span>
                  ))}
                </div>
              </div>
              <div className="text-sm min-w-[220px] space-y-1">
                <p><span className="text-slate-500">Age:</span> <span className="font-medium">{patientAge(patient)}</span></p>
                <p><span className="text-slate-500">Gender:</span> <span className="font-medium capitalize">{patient.gender || '—'}</span></p>
                <p><span className="text-slate-500">Mobile:</span> <span className="font-medium">{patient.mobile || '—'}</span></p>
                <p><span className="text-slate-500">Primary Doctor:</span> <span className="font-medium">{snapshot.primaryDoctor?.name || '—'}</span></p>
                <p><span className="text-slate-500">Printed:</span> <span className="font-medium">{fmtDateTime(new Date().toISOString())}</span></p>
              </div>
            </div>

            {aiSummary?.summary && (
              <section className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-4 h-4 text-[var(--color-primary)]" />
                  <h2 className="text-sm font-semibold">AI Brief</h2>
                </div>
                {aiSummary.summary.oneLiner && <p className="text-sm font-medium text-slate-800">{aiSummary.summary.oneLiner}</p>}
                <div className="grid md:grid-cols-2 gap-4 mt-4 text-sm">
                  {[
                    { label: 'Active issues', items: aiSummary.summary.activeIssues },
                    { label: 'Family history', items: aiSummary.summary.familyHistory },
                    { label: 'Patient context', items: aiSummary.summary.patientContext },
                    { label: 'Recent changes', items: aiSummary.summary.recentChanges },
                    { label: 'Medication focus', items: aiSummary.summary.medicationFocus },
                    { label: 'Abnormal findings', items: aiSummary.summary.abnormalFindings },
                    { label: 'Follow-up risks', items: aiSummary.summary.followUpRisks },
                    { label: 'Cautions', items: aiSummary.summary.cautions },
                    { label: 'Provenance flags', items: aiSummary.summary.provenanceFlags },
                  ].map(({ label, items }) => (
                    Array.isArray(items) && items.length > 0 ? (
                      <div key={label}>
                        <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1.5">{label}</h3>
                        <ul className="space-y-1">
                          {items.slice(0, 4).map((item, index) => (
                            <li key={`${label}-${index}`} className="flex gap-2">
                              <span className="mt-1 h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] shrink-0" />
                              <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span>{item.text}</span>
                                  {item.priority && <span className="rounded-full bg-slate-100 text-slate-700 px-2 py-0.5 text-[10px] font-medium">{item.priority}</span>}
                                  {item.provenance && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceBadge(item.provenance)}`}>{item.provenance.replace(/_/g, ' ')}</span>}
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null
                  ))}
                </div>
                {aiSummary.generatedAt && (
                  <p className="text-xs text-slate-500 mt-4">{aiSummary.status === 'fallback' ? 'Deterministic summary generated' : 'Generated'} {fmtDateTime(aiSummary.generatedAt)}. Verify against source records.</p>
                )}
              </section>
            )}

            <div className="grid lg:grid-cols-2 gap-6 mt-6">
              <section className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <AlertBadge />
                    Active Problems
                  </h2>
                  <div className="space-y-2">
                    {snapshot.activeProblems.length === 0 ? (
                      <p className="text-sm text-slate-500">No active problems recorded.</p>
                    ) : snapshot.activeProblems.slice(0, 6).map((problem) => (
                      <div key={String(problem.id ?? problem.description)} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-medium">{problem.description || 'Problem'}</p>
                        <p className="text-xs text-slate-500">
                          {[problem.severity, problem.status, fmtDate(problem.updated_at)].filter((value) => value && value !== '—').join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <ShieldAlert className="w-4 h-4 text-[var(--color-primary)]" />
                    Allergies
                  </h2>
                  <div className="space-y-2">
                    {snapshot.allergies.length === 0 ? (
                      <p className="text-sm text-slate-500">No allergies recorded.</p>
                    ) : snapshot.allergies.slice(0, 6).map((item) => (
                      <div key={String(item.id ?? item.allergen)} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-medium">{item.allergen || 'Allergy'}</p>
                        <p className="text-xs text-slate-500">
                          {[item.reaction, item.severity, item.verified_at ? 'verified' : 'not verified'].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                    Follow-up And Alerts
                  </h2>
                  <div className="space-y-2">
                    {reminders.length === 0 ? (
                      <p className="text-sm text-slate-500">No active reminders.</p>
                    ) : reminders.slice(0, 8).map((item, idx) => (
                      <div key={`reminder-${idx}`} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-medium">{String(item.label ?? item.title ?? 'Clinical reminder')}</p>
                        <p className="text-xs text-slate-500">{String(item.recommendation ?? item.severity ?? item.code ?? '') || 'Review in workspace'}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold mb-2">Current Medications</h2>
                  <div className="space-y-2">
                    {snapshot.currentMedications.length === 0 ? (
                      <p className="text-sm text-slate-500">No active medication list recorded.</p>
                    ) : snapshot.currentMedications.slice(0, 8).map((med) => (
                      <div key={String(med.id ?? med.medication_name)} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium">{med.medication_name || 'Medication'}</p>
                          {med.provenance?.badge_text && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge(med.provenance.category)}`}>
                              {med.provenance.badge_text}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {[med.dosage, med.frequency, med.end_date ? `until ${fmtDate(med.end_date)}` : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold mb-2">Recent Abnormal Labs</h2>
                  <div className="space-y-2">
                    {recentLabs.length === 0 ? (
                      <p className="text-sm text-slate-500">No abnormal lab result captured.</p>
                    ) : recentLabs.slice(0, 6).map((item, idx) => (
                      <div key={`lab-${idx}`} className="rounded-xl border border-red-100 bg-red-50/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium">{String(item.test_name ?? 'Lab result')}</p>
                          {(item as BasicItem).provenance?.badge_text && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge((item as BasicItem).provenance?.category)}`}>
                              {(item as BasicItem).provenance?.badge_text}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {[String(item.result ?? item.result_numeric ?? ''), item.unit ? String(item.unit) : '', item.normal_range ? `ref ${String(item.normal_range)}` : ''].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold mb-2">Recent Timeline</h2>
                  <div className="space-y-2">
                    {data.timeline.length === 0 ? (
                      <p className="text-sm text-slate-500">No timeline events found.</p>
                    ) : data.timeline.slice(0, 8).map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium">{item.title}</p>
                          {item.provenance?.badge_text && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge(item.provenance.category)}`}>
                              {item.provenance.badge_text}
                            </span>
                          )}
                        </div>
                        {item.subtitle && <p className="text-sm text-slate-600 mt-1">{item.subtitle}</p>}
                        <p className="text-xs text-slate-500 mt-1">
                          {[item.doctor_name, item.status, fmtDateTime(item.date)].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}

function AlertBadge() {
  return <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-[10px] font-bold">!</span>;
}
