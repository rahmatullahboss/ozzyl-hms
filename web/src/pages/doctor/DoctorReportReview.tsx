import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck, FileText, FlaskConical, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { getTodayGMT6 } from '../../lib/date-utils';

interface ReportShowMedicine {
  medicine_name?: string;
  name?: string;
  dosage?: string;
  frequency?: string;
}

interface ReportShowTest {
  test_name?: string;
  name?: string;
  result?: string | number | null;
  result_value?: string | number | null;
  unit?: string | null;
  status?: string;
}

interface ReportShowPatient {
  appointment_id: number;
  patient_name: string;
  patient_code?: string;
  validity_badge?: string;
  last_prescription?: {
    diagnosis?: string | null;
    items?: ReportShowMedicine[];
  } | null;
  ordered_tests?: ReportShowTest[];
  completed_reports?: ReportShowTest[];
}

interface ReportShowResponse {
  patients?: ReportShowPatient[];
}

function validityLabel(t: (k: string, opts?: any) => string, value?: string): string {
  const labels: Record<string, string> = {
    valid_report_show: t('doctorReportReview.validity.validReportShow', { defaultValue: 'Valid Report Show' }),
    report_show_expired: t('doctorReportReview.validity.reportShowExpired', { defaultValue: 'Report Show Expired' }),
    valid_follow_up: t('doctorReportReview.validity.validFollowUp', { defaultValue: 'Valid Follow-up' }),
    follow_up_expired: t('doctorReportReview.validity.followUpExpired', { defaultValue: 'Follow-up Expired' }),
    payment_pending: t('doctorReportReview.validity.paymentPending', { defaultValue: 'Payment Pending' }),
  };
  return labels[value ?? ''] ?? t('doctorReportReview.validity.fallback', { defaultValue: 'Report Show' });
}

function testLabel(test: ReportShowTest, fallback: string): string {
  const name = test.test_name ?? test.name ?? fallback;
  const value = test.result_value ?? test.result;
  return value === null || value === undefined ? name : `${name}: ${value}${test.unit ? ` ${test.unit}` : ''}`;
}

export default function DoctorReportReview() {
  const { t } = useTranslation(['tenantClinical']);
  const [date, setDate] = useState(getTodayGMT6());
  const [notes, setNotes] = useState<Record<number, string>>({});
  const queryClient = useQueryClient();
  const queryKey = ['doctor', 'report-show', date] as const;
  const { data, isLoading } = useApiQuery<ReportShowResponse>(
    queryKey,
    `/api/doctors/dashboard/report-show-patients?date=${date}`,
  );
  const review = useApiMutation<unknown, { appointmentId: number; notes: string }>(
    'post',
    (values) => `/api/doctors/dashboard/report-show/${values.appointmentId}/review`,
    {
      onSuccess: () => {
        toast.success(t('doctorReportReview.toast.saved'));
        queryClient.invalidateQueries({ queryKey });
      },
      onError: () => toast.error(t('doctorReportReview.toast.saveFailed')),
    },
  );

  return (
    <DashboardLayout role="doctor">
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="page-title flex items-center gap-2">
              <ClipboardCheck className="w-6 h-6 text-[var(--color-primary)]" />
              {t('doctorReportReview.title')}
            </h1>
            <p className="section-subtitle mt-1">{t('doctorReportReview.subtitle')}</p>
          </div>
          <input className="input text-sm" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </div>

        {isLoading ? (
          <div className="card p-10 flex justify-center text-[var(--color-text-muted)]">
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> {t('doctorReportReview.loading')}
          </div>
        ) : (data?.patients ?? []).length === 0 ? (
          <div className="card p-10 text-center text-[var(--color-text-muted)]">{t('doctorReportReview.emptyState')}</div>
        ) : (
          <div className="space-y-4">
            {(data?.patients ?? []).map((patient) => (
              <article key={patient.appointment_id} className="card p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-[var(--color-text)]">{patient.patient_name}</h2>
                    <p className="text-xs text-[var(--color-text-muted)]">{patient.patient_code ?? ''}</p>
                  </div>
                  <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    {validityLabel(t, patient.validity_badge)}
                  </span>
                </div>

                <div className="grid gap-3 lg:grid-cols-3">
                  <section className="rounded-lg bg-[var(--color-surface)] p-3">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                      <FileText className="w-3.5 h-3.5" /> {t('doctorReportReview.lastPrescription')}
                    </h3>
                    <p className="text-xs mb-2">{patient.last_prescription?.diagnosis ?? t('doctorReportReview.noDiagnosis')}</p>
                    {(patient.last_prescription?.items ?? []).map((medicine, index) => (
                      <p key={index} className="text-xs text-[var(--color-text-muted)]">
                        {medicine.medicine_name ?? medicine.name ?? t('doctorReportReview.medicine')} {medicine.dosage ?? ''} {medicine.frequency ?? ''}
                      </p>
                    ))}
                  </section>
                  <section className="rounded-lg bg-[var(--color-surface)] p-3">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                      <FlaskConical className="w-3.5 h-3.5 text-emerald-600" /> {t('doctorReportReview.completedReports')}
                    </h3>
                    {(patient.completed_reports ?? []).length === 0
                      ? <p className="text-xs text-[var(--color-text-muted)]">{t('doctorReportReview.noCompletedReport')}</p>
                      : (patient.completed_reports ?? []).map((test, index) => <p key={index} className="text-xs">{testLabel(test, t('doctorReportReview.testFallback'))}</p>)}
                  </section>
                  <section className="rounded-lg bg-[var(--color-surface)] p-3">
                    <h3 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                      <FlaskConical className="w-3.5 h-3.5 text-amber-600" /> {t('doctorReportReview.pendingTests')}
                    </h3>
                    {(patient.ordered_tests ?? []).filter((test) => test.status !== 'completed').length === 0
                      ? <p className="text-xs text-[var(--color-text-muted)]">{t('doctorReportReview.noPendingTest')}</p>
                      : (patient.ordered_tests ?? []).filter((test) => test.status !== 'completed').map((test, index) => <p key={index} className="text-xs">{testLabel(test, t('doctorReportReview.testFallback'))}</p>)}
                  </section>
                </div>

                <div className="flex flex-col sm:flex-row gap-2 items-end">
                  <label className="flex-1 text-xs font-medium text-[var(--color-text-muted)]">
                    {t('doctorReportReview.reviewNoteFor', { name: patient.patient_name, defaultValue: `Review note for ${patient.patient_name}` })}
                    <textarea
                      aria-label={t('doctorReportReview.reviewNoteFor', { name: patient.patient_name, defaultValue: `Review note for ${patient.patient_name}` })}
                      className="input mt-1 min-h-[56px] w-full text-sm"
                      value={notes[patient.appointment_id] ?? ''}
                      onChange={(event) => setNotes((current) => ({ ...current, [patient.appointment_id]: event.target.value }))}
                      placeholder={t('doctorReportReview.reviewNotePlaceholder', { defaultValue: 'Clinical review note (optional)' })}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-primary text-sm"
                    disabled={review.isPending}
                    onClick={() => review.mutate({ appointmentId: patient.appointment_id, notes: notes[patient.appointment_id] ?? '' })}
                  >
                    {t('doctorReportReview.markReviewed', { defaultValue: 'Mark Reviewed' })}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
