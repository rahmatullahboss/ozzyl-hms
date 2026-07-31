import { Link, useParams } from 'react-router';
import { Brain, ChevronRight, Printer, ShieldAlert, Stethoscope, Users, Heart, AlertTriangle, History, Activity } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { formatAgeFromDateOfBirth } from '../lib/age';

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

function fmtDate(value?: string | null, locale: string = 'en-GB') {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(value?: string | null, locale: string = 'en-GB') {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(locale, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function patientAge(patient?: Patient | null, locale: string = 'en-GB'): string {
  if (!patient) return '—';
  const age = formatAgeFromDateOfBirth(patient.date_of_birth, locale);
  if (age !== '—') return age;
  if (patient.age !== undefined && patient.age !== null) return locale === 'bn-BD' || locale === 'bn' ? `${patient.age} বছর` : `${patient.age}Y`;
  return '—';
}

export default function PatientChartPrint({ role = 'hospital_admin' }: { role?: string }) {
  const { t, i18n } = useTranslation(['clinical', 'sidebar', 'status', 'general']);
  const currentLocale = i18n.language === 'bn' ? 'bn-BD' : 'en-GB';
  const { slug = '', id = '' } = useParams<{ slug: string; id: string }>();

  const { data, isLoading: loading } = useApiQuery<ChartResponse>(
    queryKeys.patientChart.detail(id, true),
    `/api/patients/${id}/chart?includeAiSummary=1`,
    { enabled: !!id },
  );

  const { data: settingsData } = useApiQuery<{ settings?: { hospital_logo_url?: string } }>(
    ['settings'],
    '/api/settings',
  );
  const logoUrl = settingsData?.settings?.hospital_logo_url ?? null;

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
              <Link to={`/h/${slug}/dashboard`} className="hover:underline">{t('sidebar:dashboard')}</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`/h/${slug}/patients/${id}/chart`} className="hover:underline">{t('chart.doctorWorkspace')}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="font-medium text-[var(--color-text)]">{t('chart.printSummary')}</span>
            </div>
            <button onClick={() => window.print()} className="btn btn-primary text-sm flex items-center gap-2">
              <Printer className="w-4 h-4" />
              {t('chart.printButton')}
            </button>
          </div>

          <div className="chart-paper bg-white mx-auto rounded-2xl shadow-xl p-8 max-w-5xl text-slate-900 border border-slate-100">
            <div className="flex items-start justify-between gap-6 border-b pb-5 border-slate-200">
              <div className="flex items-start gap-4">
                {logoUrl && (
                  <img src={logoUrl} alt="Hospital Logo" className="w-14 h-14 object-contain rounded-lg shrink-0" />
                )}
                <div>
                  <p className="text-xs uppercase tracking-[0.28em] text-slate-500 font-bold">{t('chart.medicalProfile')}</p>
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
              </div>
              <div className="text-sm min-w-[220px] space-y-1">
                <p><span className="text-slate-500">{t('chart.age')}:</span> <span className="font-medium">{patientAge(patient, currentLocale)}</span></p>
                <p><span className="text-slate-500">{t('chart.gender')}:</span> <span className="font-medium capitalize">{patient.gender || '—'}</span></p>
                <p><span className="text-slate-500">{t('chart.mobile')}:</span> <span className="font-medium">{patient.mobile || '—'}</span></p>
                <p><span className="text-slate-500">{t('chart.primaryDoctor')}:</span> <span className="font-medium">{snapshot.primaryDoctor?.name || '—'}</span></p>
                <p><span className="text-slate-500">{t('chart.printed')}:</span> <span className="font-medium">{fmtDateTime(new Date().toISOString(), currentLocale)}</span></p>
              </div>
            </div>

            {aiSummary?.summary && (
              <section className="mt-6 rounded-2xl bg-slate-50 border border-slate-200 p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Brain className="w-4 h-4 text-[var(--color-primary)]" />
                  <h2 className="text-sm font-semibold">{t('chart.aiBrief')}</h2>
                </div>
                {aiSummary.summary.oneLiner && <p className="text-sm font-medium text-slate-800">{aiSummary.summary.oneLiner}</p>}
                <div className="grid md:grid-cols-2 gap-4 mt-4 text-sm">
                  {[
                    { label: t('chart.activeIssues'), items: aiSummary.summary.activeIssues },
                    { label: t('chart.familyHistory'), items: aiSummary.summary.familyHistory },
                    { label: t('chart.patientContext'), items: aiSummary.summary.patientContext },
                    { label: t('chart.recentChanges'), items: aiSummary.summary.recentChanges },
                    { label: t('chart.medicationFocus'), items: aiSummary.summary.medicationFocus },
                    { label: t('chart.abnormalFindings'), items: aiSummary.summary.abnormalFindings },
                    { label: t('chart.followUpRisks'), items: aiSummary.summary.followUpRisks },
                    { label: t('chart.cautions'), items: aiSummary.summary.cautions },
                    { label: t('chart.provenanceFlags'), items: aiSummary.summary.provenanceFlags },
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
                  <p className="text-xs text-slate-500 mt-4">
                    {aiSummary.status === 'fallback' ? t('chart.deterministicSummary', { defaultValue: 'Historical data summary' }) : t('chart.generated', { defaultValue: 'Generated' })} {fmtDateTime(aiSummary.generatedAt, currentLocale)}. {t('chart.verifyRecords', { defaultValue: 'Please verify with full medical records.' })}
                  </p>
                )}
              </section>
            )}

            <div className="grid lg:grid-cols-2 gap-6 mt-6">
              <section className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <AlertBadge />
                    {t('chart.activeProblems')}
                  </h2>
                  <div className="space-y-2">
                    {snapshot.activeProblems.length === 0 ? (
                      <p className="text-sm text-slate-500">{t('chart.noActiveProblems')}</p>
                    ) : snapshot.activeProblems.slice(0, 6).map((problem) => (
                      <div key={String(problem.id ?? problem.description)} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-medium">{problem.description || t('general:problem', { defaultValue: 'Problem' })}</p>
                        <p className="text-xs text-slate-500">
                          {[problem.severity, problem.status, fmtDate(problem.updated_at, currentLocale)].filter((value) => value && value !== '—').join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <ShieldAlert className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('chart.allergyHistory')}
                  </h2>
                  <div className="space-y-2">
                    {snapshot.allergies.length === 0 ? (
                      <p className="text-sm text-slate-500">{t('chart.noAllergies')}</p>
                    ) : snapshot.allergies.slice(0, 6).map((item) => (
                      <div key={String(item.id ?? item.allergen)} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-medium">{item.allergen || t('general:allergy', { defaultValue: 'Allergy' })}</p>
                        <p className="text-xs text-slate-500">
                          {[item.reaction, item.severity, item.verified_at ? t('status:verified', { defaultValue: 'verified' }) : t('status:notVerified', { defaultValue: 'not verified' })].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-2">
                    <Stethoscope className="w-4 h-4 text-[var(--color-primary)]" />
                    {t('chart.followUpAlerts')}
                  </h2>
                  <div className="space-y-2">
                    {reminders.length === 0 ? (
                      <p className="text-sm text-slate-500">{t('chart.noReminders')}</p>
                    ) : reminders.slice(0, 8).map((item, idx) => (
                      <div key={`reminder-${idx}`} className="rounded-xl border border-slate-200 p-3">
                        <p className="font-medium">{String(item.label ?? item.title ?? t('general:clinicalReminder', { defaultValue: 'Clinical reminder' }))}</p>
                        <p className="text-xs text-slate-500">{String(item.recommendation ?? item.severity ?? item.code ?? '') || t('general:reviewInWorkspace', { defaultValue: 'Review in workspace' })}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div>
                  <h2 className="text-sm font-semibold mb-2">{t('chart.currentMedications')}</h2>
                  <div className="space-y-2">
                    {snapshot.currentMedications.length === 0 ? (
                      <p className="text-sm text-slate-500">{t('chart.noMedications')}</p>
                    ) : snapshot.currentMedications.slice(0, 8).map((med) => (
                      <div key={String(med.id ?? med.medication_name)} className="rounded-xl border border-slate-200 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium">{med.medication_name || t('general:medication', { defaultValue: 'Medication' })}</p>
                          {med.provenance?.badge_text && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge(med.provenance.category)}`}>
                              {med.provenance.badge_text}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {[med.dosage, med.frequency, med.end_date ? `${t('general:until', { defaultValue: 'until' })} ${fmtDate(med.end_date, currentLocale)}` : null].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold mb-2">{t('chart.recentAbnormalLabs')}</h2>
                  <div className="space-y-2">
                    {recentLabs.length === 0 ? (
                      <p className="text-sm text-slate-500">{t('chart.noAbnormalLabs')}</p>
                    ) : recentLabs.slice(0, 6).map((item, idx) => (
                      <div key={`lab-${idx}`} className="rounded-xl border border-red-100 bg-red-50/50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="font-medium">{String(item.test_name ?? t('general:labResult', { defaultValue: 'Lab result' }))}</p>
                          {(item as BasicItem).provenance?.badge_text && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${provenanceCategoryBadge((item as BasicItem).provenance?.category)}`}>
                              {(item as BasicItem).provenance?.badge_text}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500">
                          {[String(item.result ?? item.result_numeric ?? ''), item.unit ? String(item.unit) : '', item.normal_range ? `${t('general:ref', { defaultValue: 'ref' })} ${String(item.normal_range)}` : ''].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h2 className="text-sm font-semibold mb-2">{t('chart.recentTimeline')}</h2>
                  <div className="space-y-2">
                    {data.timeline.length === 0 ? (
                      <p className="text-sm text-slate-500">{t('chart.noTimeline')}</p>
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
                          {[item.doctor_name, item.status, fmtDateTime(item.date, currentLocale)].filter(Boolean).join(' · ')}
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
