import { useState, useEffect } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Printer, Download, FileText, Smartphone, Mail, ArrowUp, ArrowDown, Minus, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { calculateAgePartsFromDateOfBirth, formatAgeFromDateOfBirth } from '../lib/age';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestResult {
  test_name: string;
  result: string;
  previous_result?: string;
  unit: string;
  reference_range: string;
  reference_range_female?: string;
  reference_range_child?: string;
  flag: 'normal' | 'high' | 'low' | 'critical_high' | 'critical_low';
  section: string;
}

interface LabReport {
  id: number;
  lab_no: string;
  created_at: string;
  sample_collected_at?: string;
  sample_type: string;
  patient_name: string;
  patient_code: string;
  date_of_birth?: string;
  gender?: string;
  doctor_name?: string;
  department?: string;
  comments?: string;
  verified_by?: string;
  hospital_name?: string;
  report_status?: string | null;
  retracted_at?: string | null;
  retraction_reason?: string | null;
  report_version?: number | null;
  supersedes_report_id?: number | null;
  results: TestResult[];
}

interface LabReportResponse {
  report: LabReport;
}

interface SettingsResponse {
  settings?: { hospital_logo_url?: string };
}

function fmtDate(d?: string, locale: string = 'en-GB'): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateTime(d?: string, locale: string = 'en-GB'): string {
  if (!d) return '—';
  return new Date(d).toLocaleString(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function calcAge(dob?: string, locale: string = 'en-GB'): string {
  return formatAgeFromDateOfBirth(dob, locale);
}

function calcDelta(current?: string, previous?: string): 'up' | 'down' | 'same' | null {
  if (!current || !previous) return null;
  const c = parseFloat(current.replace(/,/g, ''));
  const p = parseFloat(previous.replace(/,/g, ''));
  if (Number.isNaN(c) || Number.isNaN(p)) return null;
  if (c > p) return 'up';
  if (c < p) return 'down';
  return 'same';
}

function getReferenceRange(tr: TestResult, gender?: string, age?: number): string {
  // Child reference range (under 18)
  if (age !== undefined && age < 18 && tr.reference_range_child) {
    return tr.reference_range_child;
  }
  // Female reference range
  if (gender?.toLowerCase() === 'female' && tr.reference_range_female) {
    return tr.reference_range_female;
  }
  return tr.reference_range;
}

export function isWithdrawnLabReport(report: {
  report_status?: unknown;
  retracted_at?: unknown;
} | null | undefined): boolean {
  return String(report?.report_status ?? '').trim().toLowerCase() === 'retracted'
    || report?.retracted_at != null;
}

export function canNotifyLabReport(report: {
  report_status?: unknown;
  retracted_at?: unknown;
} | null | undefined): boolean {
  return !isWithdrawnLabReport(report);
}

// ─── Demo data ───────────────────────────────────────────────────────────────

const DEMO: LabReport = {
  id: 1, lab_no: 'LAB-00045',
  created_at: new Date().toISOString(),
  sample_collected_at: new Date(Date.now() - 3600000).toISOString(),
  sample_type: 'Blood (Venipuncture)',
  patient_name: 'Mohammad Karim', patient_code: 'P-00001',
  date_of_birth: '1990-01-01', gender: 'Male',
  doctor_name: 'Dr. Aminur Rahman', department: 'Internal Medicine',
  comments: 'Elevated WBC and CRP suggest active infection. Mildly elevated fasting blood sugar — recommend HbA1c. Follow-up in one week.',
  verified_by: 'Dr. Shahana Akhter (Pathologist)',
  hospital_name: 'City General Hospital',
  results: [
    { section: 'HEMATOLOGY', test_name: 'Hemoglobin', result: '11.2', previous_result: '13.5', unit: 'g/dL', reference_range: '12.0 – 16.0', reference_range_female: '11.5 – 15.5', reference_range_child: '11.0 – 14.0', flag: 'low' },
    { section: 'HEMATOLOGY', test_name: 'WBC Count', result: '12,500', previous_result: '8,200', unit: '/cmm', reference_range: '4,000 – 11,000', flag: 'high' },
    { section: 'HEMATOLOGY', test_name: 'RBC Count', result: '4.5', previous_result: '4.6', unit: 'million/cmm', reference_range: '4.0 – 5.5', flag: 'normal' },
    { section: 'HEMATOLOGY', test_name: 'Platelet Count', result: '245,000', previous_result: '220,000', unit: '/cmm', reference_range: '150,000 – 400,000', flag: 'normal' },
    { section: 'HEMATOLOGY', test_name: 'ESR', result: '35', previous_result: '18', unit: 'mm/hr', reference_range: '0 – 20', flag: 'high' },
    { section: 'BIOCHEMISTRY', test_name: 'Blood Sugar (Fasting)', result: '105', previous_result: '95', unit: 'mg/dL', reference_range: '70 – 100', flag: 'high' },
    { section: 'BIOCHEMISTRY', test_name: 'Creatinine', result: '1.0', previous_result: '0.9', unit: 'mg/dL', reference_range: '0.7 – 1.3', flag: 'normal' },
    { section: 'BIOCHEMISTRY', test_name: 'CRP (C-Reactive Protein)', result: '24', previous_result: '5', unit: 'mg/L', reference_range: '0 – 5', flag: 'high' },
  ],
};

const FLAG_STYLE: Record<string, string> = {
  normal: 'text-emerald-600',
  high: 'text-amber-600 font-semibold',
  low: 'text-blue-600 font-semibold',
  critical_high: 'text-red-600 font-bold',
  critical_low: 'text-red-600 font-bold',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function LabReportPrint({
  role = 'hospital_admin' }: { role?: string }) {
  const { t, i18n } = useTranslation(['laboratory', 'common']);
  const currentLocale = i18n.language === 'bn' ? 'bn-BD' : 'en-GB';

  const { slug = '', labId = '' } = useParams<{ slug: string; labId: string }>();
  const basePath = `/h/${slug}`;

  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const { data: labData, isLoading: labLoading } = useApiQuery<LabReportResponse>(
    queryKeys.labReport.detail(labId),
    `/api/lab/orders/${labId}/report`,
    { enabled: !!labId },
  );

  const { data: settingsData } = useApiQuery<SettingsResponse>(
    queryKeys.settings.all,
    '/api/settings',
  );

  useEffect(() => {
    if (settingsData?.settings?.hospital_logo_url) {
      setLogoUrl(settingsData.settings.hospital_logo_url);
    }
  }, [settingsData]);

  const report = labData?.report;
  const loading = labLoading;
  const withdrawn = isWithdrawnLabReport(report);

  const handlePrint = () => window.print();

  const handleSendSms = () => {
    if (withdrawn) {
      toast.error('Withdrawn reports cannot be sent to patients');
      return;
    }
    toast.success(t('smsSent', { defaultValue: 'SMS sent to patient' }));
  };

  const handleEmailPatient = () => {
    if (withdrawn) {
      toast.error('Withdrawn reports cannot be sent to patients');
      return;
    }
    toast.success(t('emailSent', { defaultValue: 'Email sent to patient' }));
  };

  const FLAG_LABEL: Record<string, string> = {
    normal: t('labReport.normal', { defaultValue: 'Normal' }),
    high: t('labReport.high', { defaultValue: 'High' }),
    low: t('labReport.low', { defaultValue: 'Low' }),
    critical_high: t('labReport.criticalHigh', { defaultValue: 'Critical High' }),
    critical_low: t('labReport.criticalLow', { defaultValue: 'Critical Low' }),
  };

  const ageParts = calculateAgePartsFromDateOfBirth(report?.date_of_birth);
  const age = ageParts?.years;

  // Group results by section
  const sections = report?.results.reduce((acc, r) => {
    if (!acc[r.section]) acc[r.section] = [];
    acc[r.section].push(r);
    return acc;
  }, {} as Record<string, TestResult[]>) ?? {};

  return (
    <DashboardLayout role={role}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .lab-paper { box-shadow: none !important; margin: 0 !important; }
          body { background: white !important; }
        }
      `}</style>

      {loading ? (
        <div className="animate-pulse h-96 bg-gray-100 rounded-xl" />
      ) : !report ? (
        <div className="text-center py-20">
          <p className="text-[var(--color-text-muted)]">{t('labReport.notFound', { defaultValue: 'Report not found' })}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('common:dashboard', { defaultValue: 'Dashboard' })}</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/tests`} className="hover:underline">{t('laboratoryTitle', { defaultValue: 'Laboratory' })}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="font-medium text-[var(--color-text)]">{t('labReport.title')} — {report.lab_no}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleSendSms}
                disabled={withdrawn}
                className="btn btn-secondary text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={withdrawn ? 'Withdrawn reports cannot be sent to patients' : undefined}
              >
                <Smartphone className="w-4 h-4" /> {t('sendSms', { defaultValue: 'Send SMS' })}
              </button>
              <button
                onClick={handleEmailPatient}
                disabled={withdrawn}
                className="btn btn-secondary text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title={withdrawn ? 'Withdrawn reports cannot be sent to patients' : undefined}
              >
                <Mail className="w-4 h-4" /> {t('emailToPatient', { defaultValue: 'Email to Patient' })}
              </button>
              <button onClick={handlePrint} className="btn btn-primary text-sm flex items-center gap-2">
                <Printer className="w-4 h-4" /> {t('common:print', { defaultValue: 'Print' })}
              </button>
              <button className="btn btn-outline text-sm flex items-center gap-2">
                <Download className="w-4 h-4" /> {t('common:downloadPdf', { defaultValue: 'Download PDF' })}
              </button>
            </div>
          </div>

          {/* A4 Paper */}
          <div className="lab-paper bg-white mx-auto rounded-2xl shadow-xl p-10 max-w-2xl"
               style={{ fontFamily: 'Inter, sans-serif', color: '#1a1a1a' }}>

            {withdrawn && (
              <div className="mb-5 border-4 border-red-700 bg-red-50 p-4 text-center text-red-900">
                <div className="flex items-center justify-center gap-2 text-lg font-black tracking-wide">
                  <AlertTriangle className="w-6 h-6" />
                  WITHDRAWN — DO NOT USE FOR CLINICAL DECISIONS
                </div>
                <p className="mt-2 text-sm font-semibold">
                  This historical report was formally withdrawn and must not guide treatment, diagnosis, or patient communication.
                </p>
                {report.retraction_reason && <p className="mt-1 text-xs">Reason: {report.retraction_reason}</p>}
                <p className="mt-1 text-xs">
                  Withdrawn {fmtDateTime(report.retracted_at ?? undefined, currentLocale)}
                  {report.report_version ? ` · report version ${report.report_version}` : ''}
                </p>
              </div>
            )}

            {/* Hospital Header */}
            <div className="text-center mb-4">
              <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-2 overflow-hidden"
                   style={{ background: logoUrl ? 'transparent' : '#088eaf' }}>
                {logoUrl ? (
                  <img src={logoUrl} alt="Hospital Logo" className="w-full h-full object-contain" />
                ) : (
                  <FileText className="w-7 h-7 text-white" />
                )}
              </div>
              <h1 className="text-xl font-bold" style={{ color: '#088eaf' }}>
                {report.hospital_name ?? 'City General Hospital'}
              </h1>
              <p className="text-xs text-gray-500">{t('common:labTagline', { defaultValue: 'Clinical Laboratory · ISO 15189 Accredited' })}</p>
              <p className="text-xs text-gray-500">{t('common:hospitalAddress', { defaultValue: 'Dhaka, Bangladesh' })} · {t('common:hospitalPhone', { defaultValue: '+880 1700-000000' })}</p>
            </div>
            <div className="border-b-2 mb-4" style={{ borderColor: '#088eaf' }} />

            {/* Report Info + Patient Info */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-xs space-y-1">
                <div className="flex gap-2"><span className="text-gray-500">{t('labReport.labOrderNo', { defaultValue: 'Lab Report No' })}:</span><span className="font-semibold">{report.lab_no}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">{t('labReport.reportedOn')}:</span><span>{fmtDate(report.created_at, currentLocale)}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">{t('labReport.registeredOn')}:</span><span>{fmtDateTime(report.sample_collected_at, currentLocale)}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">{t('labReport.specimen')}:</span><span>{report.sample_type}</span></div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                <div className="flex gap-2"><span className="text-gray-500">{t('labReport.patientInfo')}:</span><span className="font-semibold">{report.patient_name}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">MRN:</span><span>{report.patient_code}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">{t('labReport.age')} / {t('labReport.gender')}:</span><span>{calcAge(report.date_of_birth, currentLocale)} / {report.gender ?? '—'}</span></div>
                {report.doctor_name && <div className="flex gap-2"><span className="text-gray-500">{t('labReport.referredBy')}:</span><span>{report.doctor_name}</span></div>}
                {report.department && <div className="flex gap-2"><span className="text-gray-500">Dept:</span><span>{report.department}</span></div>}
              </div>
            </div>

            {/* Test Results by Section */}
            {Object.entries(sections).map(([section, tests]) => (
              <div key={section} className="mb-4">
                <div className="text-xs font-bold uppercase px-3 py-1.5 rounded-t-lg" style={{ background: '#088eaf15', color: '#088eaf' }}>
                  {t(`section_${section.toLowerCase()}`, { defaultValue: section })}
                </div>
                <table className="w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs text-gray-500 bg-gray-50">
                      <th className="text-left py-1.5 px-3">{t('labReport.testParameter')}</th>
                      <th className="text-center py-1.5 px-2">{t('labReport.result')}</th>
                      <th className="text-center py-1.5 px-2">{t('labReport.delta')}</th>
                      <th className="text-center py-1.5 px-2">{t('labReport.unit')}</th>
                      <th className="text-center py-1.5 px-2">{t('labReport.referenceRange')}</th>
                      <th className="text-center py-1.5 px-2">{t('labReport.flag')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tests.map((tr, i) => {
                      const delta = calcDelta(tr.result, tr.previous_result);
                      const range = getReferenceRange(tr, report.gender, age);
                      return (
                        <tr key={i} className="border-b border-gray-100">
                          <td className="py-2 px-3 font-medium">{tr.test_name}</td>
                          <td className={`py-2 px-2 text-center ${FLAG_STYLE[tr.flag]}`}>{tr.result}</td>
                          <td className="py-2 px-2 text-center">
                            {delta === 'up' && <span className="inline-flex items-center text-red-500 text-xs"><ArrowUp className="w-3 h-3" /></span>}
                            {delta === 'down' && <span className="inline-flex items-center text-blue-500 text-xs"><ArrowDown className="w-3 h-3" /></span>}
                            {delta === 'same' && <span className="inline-flex items-center text-emerald-500 text-xs"><Minus className="w-3 h-3" /></span>}
                            {!delta && <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="py-2 px-2 text-center text-gray-500 text-xs">{tr.unit}</td>
                          <td className="py-2 px-2 text-center text-gray-500 text-xs">{range}</td>
                          <td className={`py-2 px-2 text-center text-xs ${FLAG_STYLE[tr.flag]}`}>{FLAG_LABEL[tr.flag]}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}

            {/* Comments */}
            {report.comments && (
              <div className="mb-4 p-3 bg-amber-50 rounded-lg text-sm border border-amber-100">
                <strong>{t('labReport.comment')}:</strong> {report.comments}
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-gray-200 pt-4 flex justify-between items-end">
              <div>
                <span className="text-xs text-gray-400">_________________________</span>
                {report.verified_by && <p className="text-xs mt-1 font-medium">{t('labReport.validatedBy')}: {report.verified_by}</p>}
              </div>
              <p className="text-xs text-gray-400">{t('common:printedOn', { defaultValue: 'Printed on' })}: {fmtDate(new Date().toISOString(), currentLocale)}</p>
            </div>
            <p className="text-[10px] text-gray-400 mt-4 text-center italic">
              {t('labReport.note')}
            </p>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
