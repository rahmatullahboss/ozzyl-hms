import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, FileBadge, Printer } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import { useApiMutation, useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { getTodayGMT6 } from '../../lib/date-utils';

interface CertificateRecord {
  id: number;
  certificate_no: string;
  certificate_type: string;
  patient_name?: string;
  patient_code?: string;
  doctor_name?: string;
  bmdc_reg_no?: string | null;
  issue_date: string;
  recommendation: string;
  rest_days?: number | null;
  status: 'final' | 'cancelled';
}

interface PatientOption {
  id: number;
  name: string;
  patient_code?: string;
  mobile?: string;
}

interface CreateCertificate {
  patientId: number;
  certificateType: 'medical' | 'fitness' | 'sick_leave' | 'work_rest';
  issueDate: string;
  recommendation: string;
  restDays?: number;
  purpose?: string;
}

function certificateTypeLabel(t: (k: string, opts?: any) => string, value: string): string {
  const labels: Record<string, string> = {
    medical: t('doctorCertificates.typeOption.medical', { defaultValue: 'Medical certificate' }),
    fitness: t('doctorCertificates.typeOption.fitness', { defaultValue: 'Fitness certificate' }),
    sick_leave: t('doctorCertificates.typeOption.sick_leave', { defaultValue: 'Sick leave certificate' }),
    work_rest: t('doctorCertificates.typeOption.work_rest', { defaultValue: 'Work rest advice' }),
  };
  return labels[value] ?? value;
}

export default function DoctorCertificates() {
  const { t } = useTranslation(['tenantClinical']);
  const queryClient = useQueryClient();
  const [patientSearch, setPatientSearch] = useState('');
  const [selectedPatient, setSelectedPatient] = useState<PatientOption | null>(null);
  const [certificateType, setCertificateType] = useState<CreateCertificate['certificateType']>('medical');
  const [issueDate, setIssueDate] = useState(getTodayGMT6());
  const [recommendation, setRecommendation] = useState('');
  const [restDays, setRestDays] = useState('');
  const [purpose, setPurpose] = useState('');
  const [preview, setPreview] = useState<CertificateRecord | null>(null);
  const queryKey = ['doctor-certificates'] as const;

  const { data, isLoading } = useApiQuery<{ certificates?: CertificateRecord[] }>(
    queryKey,
    '/api/doctor-certificates',
  );
  const { data: patientResults } = useApiQuery<{ patients?: PatientOption[] }>(
    ['doctor-certificates', 'patient-search', patientSearch],
    `/api/patients?search=${encodeURIComponent(patientSearch)}&limit=10`,
    { enabled: patientSearch.trim().length >= 2 },
  );
  const issueCertificate = useApiMutation<unknown, CreateCertificate>('post', '/api/doctor-certificates', {
    onSuccess: () => {
      toast.success(t('doctorCertificates.toast.issued'));
      setRecommendation('');
      setRestDays('');
      setPurpose('');
      setPatientSearch('');
      setSelectedPatient(null);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: () => toast.error(t('doctorCertificates.toast.issueFailed')),
  });
  const cancelCertificate = useApiMutation<unknown, { id: number; reason: string }>(
    'post',
    (values) => `/api/doctor-certificates/${values.id}/cancel`,
    {
      onSuccess: () => {
        toast.success(t('doctorCertificates.toast.cancelled'));
        queryClient.invalidateQueries({ queryKey });
      },
      onError: () => toast.error(t('doctorCertificates.toast.cancelFailed')),
    },
  );

  const submit = () => {
    if (!selectedPatient || !recommendation.trim()) {
      toast.error(t('doctorCertificates.validationError'));
      return;
    }
    issueCertificate.mutate({
      patientId: selectedPatient.id,
      certificateType,
      issueDate,
      recommendation: recommendation.trim(),
      ...(restDays ? { restDays: Number(restDays) } : {}),
      ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
    });
  };

  return (
    <DashboardLayout role="doctor">
      <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-5">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <FileBadge className="w-6 h-6 text-[var(--color-primary)]" />
            {t('doctorCertificates.title', { defaultValue: 'Medical Certificates' })}
          </h1>
          <p className="section-subtitle mt-1">{t('doctorCertificates.subtitle', { defaultValue: 'Issued certificates are final records. Cancel with a reason and issue a new record for corrections.' })}</p>
        </div>

        <section className="card p-4 sm:p-5 space-y-4">
          <h2 className="font-semibold">{t('doctorCertificates.issueSection')}</h2>
          <div>
            <label className="text-sm block">
              {t('doctorCertificates.searchPatient')}
              <input
                aria-label={t('doctorCertificates.searchPatient', { defaultValue: 'Search patient' })}
                className="input mt-1 w-full"
                value={patientSearch}
                onChange={(event) => {
                  setPatientSearch(event.target.value);
                  setSelectedPatient(null);
                }}
                placeholder={t('doctorCertificates.searchPlaceholder')}
              />
            </label>
            {selectedPatient ? (
              <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm font-medium text-emerald-800">
                {t('doctorCertificates.selected')}: {selectedPatient.name} {selectedPatient.patient_code ? `(${selectedPatient.patient_code})` : ''}
              </p>
            ) : patientSearch.trim().length >= 2 && (
              <div className="mt-2 flex flex-col gap-1">
                {(patientResults?.patients ?? []).slice(0, 5).map((patient) => (
                  <button
                    key={patient.id}
                    type="button"
                    className="rounded-lg border border-[var(--color-border)] p-2 text-left text-sm hover:border-[var(--color-primary)]"
                    onClick={() => setSelectedPatient(patient)}
                  >
                    {patient.name} {patient.patient_code ? `- ${patient.patient_code}` : ''} {patient.mobile ? `- ${patient.mobile}` : ''}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="text-sm">
              {t('doctorCertificates.type')}
              <select
                aria-label={t('doctorCertificates.type', { defaultValue: 'Certificate Type' })}
                className="input mt-1 w-full"
                value={certificateType}
                onChange={(event) => setCertificateType(event.target.value as CreateCertificate['certificateType'])}
              >
                <option value="medical">{t('doctorCertificates.typeOption.medical')}</option>
                <option value="fitness">{t('doctorCertificates.typeOption.fitness')}</option>
                <option value="sick_leave">{t('doctorCertificates.typeOption.sick_leave')}</option>
                <option value="work_rest">{t('doctorCertificates.typeOption.work_rest')}</option>
              </select>
            </label>
            <label className="text-sm">
              {t('doctorCertificates.issueDate')}
              <input
                aria-label={t('doctorCertificates.issueDate', { defaultValue: 'Issue date' })}
                className="input mt-1 w-full"
                value={issueDate}
                onChange={(event) => setIssueDate(event.target.value)}
                type="date"
              />
            </label>
            <label className="text-sm">
              {t('doctorCertificates.restDays')}
              <input
                aria-label={t('doctorCertificates.restDays', { defaultValue: 'Rest days' })}
                className="input mt-1 w-full"
                value={restDays}
                onChange={(event) => setRestDays(event.target.value)}
                type="number"
                min="0"
                max="365"
              />
            </label>
          </div>
          <label className="text-sm block">
            {t('doctorCertificates.purpose')}
            <input
              aria-label={t('doctorCertificates.purpose', { defaultValue: 'Purpose' })}
              className="input mt-1 w-full"
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
              maxLength={300}
            />
          </label>
          <label className="text-sm block">
            {t('doctorCertificates.recommendation')}
            <textarea
              aria-label={t('doctorCertificates.recommendation', { defaultValue: 'Recommendation' })}
              className="input mt-1 w-full min-h-[80px]"
              value={recommendation}
              onChange={(event) => setRecommendation(event.target.value)}
              maxLength={2000}
            />
          </label>
          <button type="button" className="btn-primary" onClick={submit} disabled={issueCertificate.isPending}>
            {t('doctorCertificates.issue', { defaultValue: 'Issue Certificate' })}
          </button>
        </section>

        <section className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--color-border)] font-semibold">{t('doctorCertificates.issuedList')}</div>
          {isLoading ? (
            <p className="p-5 text-sm text-[var(--color-text-muted)]">{t('doctorCertificates.loading')}</p>
          ) : (data?.certificates ?? []).length === 0 ? (
            <p className="p-5 text-sm text-[var(--color-text-muted)]">{t('doctorCertificates.noCertificate')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base text-sm">
                <thead>
                  <tr>
                    <th>{t('doctorCertificates.table.certificateNo')}</th>
                    <th>{t('doctorCertificates.table.patient')}</th>
                    <th>{t('doctorCertificates.table.type')}</th>
                    <th>{t('doctorCertificates.table.date')}</th>
                    <th>{t('doctorCertificates.table.status')}</th>
                    <th>{t('doctorCertificates.actions', { ns: 'common', defaultValue: 'Actions' })}</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.certificates ?? []).map((certificate) => (
                    <tr key={certificate.id}>
                      <td className="font-mono text-xs">{certificate.certificate_no}</td>
                      <td>{certificate.patient_name ?? certificate.patient_code ?? '-'}</td>
                      <td>{certificateTypeLabel(t, certificate.certificate_type)}</td>
                      <td>{certificate.issue_date}</td>
                      <td>{t(`doctorCertificates.status.${certificate.status}`)}</td>
                      <td>
                        <div className="flex gap-2">
                          <button type="button" className="btn-ghost text-xs" onClick={() => setPreview(certificate)}>
                            <Printer className="w-3.5 h-3.5" /> {t('doctorCertificates.preview', { defaultValue: 'Preview & Print' })}
                          </button>
                          {certificate.status === 'final' && (
                            <button
                              type="button"
                              className="btn-ghost text-xs text-red-700"
                              onClick={() => {
                                const reason = window.prompt(t('doctorCertificates.cancellationPrompt'));
                                if (reason?.trim()) cancelCertificate.mutate({ id: certificate.id, reason: reason.trim() });
                              }}
                            >
                              <Ban className="w-3.5 h-3.5" /> {t('doctorCertificates.cancel')}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {preview && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <section className="w-full max-w-2xl rounded-xl bg-white p-6 shadow-xl print:shadow-none" aria-label={t('doctorCertificates.previewAria', { defaultValue: 'Certificate print preview' })}>
              <div className="flex justify-between border-b pb-3">
                <div>
                  <h2 className="text-xl font-bold">{certificateTypeLabel(t, preview.certificate_type)}</h2>
                  <p className="text-sm font-mono">{preview.certificate_no}</p>
                </div>
                <p className="text-sm">{preview.issue_date}</p>
              </div>
              <div className="mt-5 space-y-3 text-sm">
                <p><span className="font-semibold">{t('doctorCertificates.previewPatient')}</span> {preview.patient_name ?? '-'} {preview.patient_code ? `(${preview.patient_code})` : ''}</p>
                <p className="min-h-[70px] whitespace-pre-wrap">{preview.recommendation}</p>
                {preview.rest_days !== null && preview.rest_days !== undefined && <p>{t('doctorCertificates.restAdvised', { count: preview.rest_days, defaultValue: `Rest advised: ${preview.rest_days} day(s)` })}</p>}
                <div className="pt-8 text-right">
                  <p className="font-semibold">{preview.doctor_name ?? t('doctorCertificates.issuingDoctor')}</p>
                  {preview.bmdc_reg_no && <p>{preview.bmdc_reg_no}</p>}
                  <p className="text-xs text-[var(--color-text-muted)]">{t('doctorCertificates.digitalFinal')}</p>
                </div>
              </div>
              <div className="mt-6 flex justify-end gap-2 print:hidden">
                <button type="button" className="btn-ghost" onClick={() => setPreview(null)}>{t('doctorCertificates.close')}</button>
                <button type="button" className="btn-primary" onClick={() => window.print()}>
                  <Printer className="w-4 h-4" /> {t('doctorCertificates.print')}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
