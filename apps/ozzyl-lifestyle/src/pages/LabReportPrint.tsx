import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Printer, Download, FileText } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestResult {
  test_name: string;
  result: string;
  unit: string;
  reference_range: string;
  flag: 'normal' | 'high' | 'low';
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
  results: TestResult[];
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

function fmtDate(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDateTime(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function calcAge(dob?: string): string {
  if (!dob) return '—';
  const y = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000));
  return `${y}Y`;
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
    { section: 'HEMATOLOGY', test_name: 'Hemoglobin', result: '11.2', unit: 'g/dL', reference_range: '12.0 – 16.0', flag: 'low' },
    { section: 'HEMATOLOGY', test_name: 'WBC Count', result: '12,500', unit: '/cmm', reference_range: '4,000 – 11,000', flag: 'high' },
    { section: 'HEMATOLOGY', test_name: 'RBC Count', result: '4.5', unit: 'million/cmm', reference_range: '4.0 – 5.5', flag: 'normal' },
    { section: 'HEMATOLOGY', test_name: 'Platelet Count', result: '245,000', unit: '/cmm', reference_range: '150,000 – 400,000', flag: 'normal' },
    { section: 'HEMATOLOGY', test_name: 'ESR', result: '35', unit: 'mm/hr', reference_range: '0 – 20', flag: 'high' },
    { section: 'BIOCHEMISTRY', test_name: 'Blood Sugar (Fasting)', result: '105', unit: 'mg/dL', reference_range: '70 – 100', flag: 'high' },
    { section: 'BIOCHEMISTRY', test_name: 'Creatinine', result: '1.0', unit: 'mg/dL', reference_range: '0.7 – 1.3', flag: 'normal' },
    { section: 'BIOCHEMISTRY', test_name: 'CRP (C-Reactive Protein)', result: '24', unit: 'mg/L', reference_range: '0 – 5', flag: 'high' },
  ],
};

const FLAG_STYLE: Record<string, string> = {
  normal: 'text-emerald-600',
  high: 'text-red-600 font-semibold',
  low: 'text-blue-600 font-semibold',
};
const FLAG_LABEL: Record<string, string> = {
  normal: '✓ Normal',
  high: '⬆ High',
  low: '⬇ Low',
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function LabReportPrint({
 role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['laboratory', 'common']);

  const { slug = '', labId = '' } = useParams<{ slug: string; labId: string }>();
  const basePath = `/h/${slug}`;

  const [report, setReport] = useState<LabReport>(DEMO);
  const [loading, setLoading] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [labRes, settingsRes] = await Promise.all([
        axios.get(`/api/lab-orders/${labId}/report`, { headers: authHeaders() }).catch(() => null),
        axios.get('/api/settings', { headers: authHeaders() }).catch(() => null),
      ]);
      if (labRes?.data?.report) setReport(labRes.data.report);
      if (settingsRes?.data?.settings?.hospital_logo_url) {
        setLogoUrl(settingsRes.data.settings.hospital_logo_url);
      }
    } catch {
      setReport(DEMO);
    } finally {
      setLoading(false);
    }
  }, [labId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePrint = () => window.print();

  // Group results by section
  const sections = report.results.reduce((acc, r) => {
    if (!acc[r.section]) acc[r.section] = [];
    acc[r.section].push(r);
    return acc;
  }, {} as Record<string, TestResult[]>);

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
      ) : (
        <div className="space-y-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3 no-print">
            <div className="text-xs text-[var(--color-text-muted)] flex items-center gap-1">
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('dashboard', { defaultValue: 'Dashboard' })}</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/tests`} className="hover:underline">Laboratory</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="font-medium text-[var(--color-text)]">Report — {report.lab_no}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="btn btn-primary text-sm flex items-center gap-2">
                <Printer className="w-4 h-4" /> Print
              </button>
              <button className="btn btn-outline text-sm flex items-center gap-2">
                <Download className="w-4 h-4" /> Download PDF
              </button>
            </div>
          </div>

          {/* A4 Paper */}
          <div className="lab-paper bg-white mx-auto rounded-2xl shadow-xl p-10 max-w-2xl"
               style={{ fontFamily: 'Inter, sans-serif', color: '#1a1a1a' }}>

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
              <p className="text-xs text-gray-500">Clinical Laboratory · ISO 15189 Accredited</p>
              <p className="text-xs text-gray-500">Dhaka, Bangladesh · +880 1700-000000</p>
            </div>
            <div className="border-b-2 mb-4" style={{ borderColor: '#088eaf' }} />

            {/* Report Info + Patient Info */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div className="text-xs space-y-1">
                <div className="flex gap-2"><span className="text-gray-500">Lab Report No:</span><span className="font-semibold">{report.lab_no}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">Date:</span><span>{fmtDate(report.created_at)}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">Sample Collected:</span><span>{fmtDateTime(report.sample_collected_at)}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">Sample Type:</span><span>{report.sample_type}</span></div>
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-xs space-y-1">
                <div className="flex gap-2"><span className="text-gray-500">Patient:</span><span className="font-semibold">{report.patient_name}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">MRN:</span><span>{report.patient_code}</span></div>
                <div className="flex gap-2"><span className="text-gray-500">Age/Sex:</span><span>{calcAge(report.date_of_birth)} / {report.gender ?? '—'}</span></div>
                {report.doctor_name && <div className="flex gap-2"><span className="text-gray-500">Referred By:</span><span>{report.doctor_name}</span></div>}
                {report.department && <div className="flex gap-2"><span className="text-gray-500">Dept:</span><span>{report.department}</span></div>}
              </div>
            </div>

            {/* Test Results by Section */}
            {Object.entries(sections).map(([section, tests]) => (
              <div key={section} className="mb-4">
                <div className="text-xs font-bold uppercase px-3 py-1.5 rounded-t-lg" style={{ background: '#088eaf15', color: '#088eaf' }}>
                  {section}
                </div>
                <table className="w-full text-sm border border-gray-200">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs text-gray-500 bg-gray-50">
                      <th className="text-left py-1.5 px-3">Test Name</th>
                      <th className="text-center py-1.5 px-2">Result</th>
                      <th className="text-center py-1.5 px-2">Unit</th>
                      <th className="text-center py-1.5 px-2">Reference Range</th>
                      <th className="text-center py-1.5 px-2">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tests.map((t, i) => (
                      <tr key={i} className="border-b border-gray-100">
                        <td className="py-2 px-3 font-medium">{t.test_name}</td>
                        <td className={`py-2 px-2 text-center ${FLAG_STYLE[t.flag]}`}>{t.result}</td>
                        <td className="py-2 px-2 text-center text-gray-500 text-xs">{t.unit}</td>
                        <td className="py-2 px-2 text-center text-gray-500 text-xs">{t.reference_range}</td>
                        <td className={`py-2 px-2 text-center text-xs ${FLAG_STYLE[t.flag]}`}>{FLAG_LABEL[t.flag]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}

            {/* Comments */}
            {report.comments && (
              <div className="mb-4 p-3 bg-amber-50 rounded-lg text-sm border border-amber-100">
                <strong>Clinical Comments:</strong> {report.comments}
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-gray-200 pt-4 flex justify-between items-end">
              <div>
                <span className="text-xs text-gray-400">_________________________</span>
                {report.verified_by && <p className="text-xs mt-1 font-medium">Verified By: {report.verified_by}</p>}
              </div>
              <p className="text-xs text-gray-400">Printed on: {fmtDate(new Date().toISOString())}</p>
            </div>
            <p className="text-[10px] text-gray-400 mt-4 text-center italic">
              This report is confidential and intended only for the referring physician and patient.
            </p>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
