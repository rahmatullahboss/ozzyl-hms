import { useState, useEffect, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, Printer, Download, Share2, FileText } from 'lucide-react';
import axios from 'axios';
import DashboardLayout from '../components/DashboardLayout';
import { useTranslation } from 'react-i18next';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RxItem {
  id: number;
  medicine_name: string;
  dose?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
}

interface Prescription {
  id: number;
  rx_no: string;
  created_at: string;
  chief_complaint?: string;
  diagnosis?: string;
  examination_notes?: string;
  bp?: string;
  temperature?: string;
  weight?: string;
  spo2?: string;
  advice?: string;
  follow_up_date?: string;
  suggested_tests?: string;
  patient_name: string;
  patient_code: string;
  date_of_birth?: string;
  gender?: string;
  address?: string;
  doctor_name: string;
  specialty?: string;
  bmdc_reg_no?: string;
  qualifications?: string;
  visiting_hours?: string;
  hospital_name?: string;
  items: RxItem[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('hms_token')}` };
}

function calcAge(dob?: string): string {
  if (!dob) return '—';
  const diff = Date.now() - new Date(dob).getTime();
  const y = Math.floor(diff / (365.25 * 86400000));
  return `${y}Y`;
}

function fmtDate(d?: string): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// ─── Demo data ────────────────────────────────────────────────────────────────

const DEMO: Prescription = {
  id: 1, rx_no: 'RX-00023',
  created_at: new Date().toISOString(),
  chief_complaint: 'Fever, body ache, cough for 3 days',
  diagnosis: 'Upper Respiratory Tract Infection (URTI)',
  bp: '125/82', temperature: '99.1', weight: '68', spo2: '97',
  advice: 'Take plenty of warm fluids. Rest. Avoid cold food.',
  follow_up_date: new Date(Date.now() + 5 * 86400000).toISOString().split('T')[0],
  suggested_tests: 'CBC, CRP, Chest X-Ray',
  patient_name: 'Mohammad Karim', patient_code: 'P-00001',
  date_of_birth: '1990-01-01', gender: 'Male', address: 'Mirpur, Dhaka',
  doctor_name: 'Dr. Aminur Rahman', specialty: 'Internal Medicine',
  bmdc_reg_no: 'A-12345', qualifications: 'MBBS, FCPS (Medicine)',
  visiting_hours: 'Sat–Thu | 9am–1pm',
  hospital_name: 'City General Hospital',
  items: [
    { id: 1, medicine_name: 'Tab. Azithromycin 500mg', dose: '1 tab', frequency: 'Once daily', duration: '3 days' },
    { id: 2, medicine_name: 'Tab. Paracetamol 500mg', dose: '1–2 tabs', frequency: 'SOS', duration: '—' },
    { id: 3, medicine_name: 'Syr. Benadryl', dose: '2 tsp', frequency: 'TDS', duration: '5 days' },
  ],
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function PrescriptionPrint({ role = 'hospital_admin' }: { role?: string }) {
  const { t } = useTranslation(['patients', 'common']);

  const { slug = '', prescriptionId = '' } = useParams<{ slug: string; prescriptionId: string }>();
  const basePath = `/h/${slug}`;

  const [rx, setRx] = useState<Prescription>(DEMO);
  const [loading, setLoading] = useState(true);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [rxRes, settingsRes] = await Promise.all([
        axios.get(`/api/prescriptions/${prescriptionId}/print`, { headers: authHeaders() }).catch(() => null),
        axios.get('/api/settings', { headers: authHeaders() }).catch(() => null),
      ]);
      if (rxRes?.data?.prescription) setRx(rxRes.data.prescription);
      if (settingsRes?.data?.settings?.hospital_logo_url) {
        setLogoUrl(settingsRes.data.settings.hospital_logo_url);
      }
    } catch {
      setRx(DEMO); // fallback to demo
    } finally {
      setLoading(false);
    }
  }, [prescriptionId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handlePrint = () => window.print();

  return (
    <DashboardLayout role={role}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .rx-paper { box-shadow: none !important; margin: 0 !important; }
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
              <Link to={`${basePath}/dashboard`} className="hover:underline">Dashboard</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/prescriptions`} className="hover:underline">Prescriptions</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="font-medium text-[var(--color-text)]">Print — {rx.rx_no}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="btn btn-primary text-sm flex items-center gap-2">
                <Printer className="w-4 h-4" /> Print
              </button>
              <button className="btn btn-outline text-sm flex items-center gap-2">
                <Download className="w-4 h-4" /> Download PDF
              </button>
              <button className="btn btn-outline text-sm flex items-center gap-2">
                <Share2 className="w-4 h-4" /> Share
              </button>
            </div>
          </div>

          {/* A4 Paper */}
          <div className="rx-paper bg-white mx-auto rounded-2xl shadow-xl p-10 max-w-2xl"
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
                {rx.hospital_name ?? 'City General Hospital'}
              </h1>
              <p className="text-xs text-gray-500">Dhaka, Bangladesh · +880 1700-000000</p>
            </div>
            <div className="border-b-2 mb-4" style={{ borderColor: '#088eaf' }} />

            {/* Doctor info left / Patient info right */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="font-bold text-lg">{rx.doctor_name}</p>
                {rx.qualifications && <p className="text-xs text-gray-600">{rx.qualifications}</p>}
                {rx.specialty && <p className="text-xs text-gray-600">Specialist: {rx.specialty}</p>}
                {rx.bmdc_reg_no && <p className="text-xs font-medium" style={{ color: '#088eaf' }}>BMDC Reg. No: {rx.bmdc_reg_no}</p>}
                {rx.visiting_hours && <p className="text-xs text-gray-500">Visiting: {rx.visiting_hours}</p>}
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-sm">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="text-gray-500">Rx No</span>
                  <span className="font-semibold">{rx.rx_no}</span>
                  <span className="text-gray-500">Date</span>
                  <span>{fmtDate(rx.created_at)}</span>
                  <span className="text-gray-500">Patient</span>
                  <span className="font-semibold">{rx.patient_name}</span>
                  <span className="text-gray-500">Age/Sex</span>
                  <span>{calcAge(rx.date_of_birth)} / {rx.gender ?? '—'}</span>
                  {rx.address && <>
                    <span className="text-gray-500">Address</span>
                    <span>{rx.address}</span>
                  </>}
                </div>
              </div>
            </div>

            {/* Vitals */}
            {(rx.bp || rx.temperature || rx.weight || rx.spo2) && (
              <div className="text-xs bg-blue-50 rounded-lg px-3 py-2 mb-4 text-gray-700 flex flex-wrap gap-4">
                {rx.bp && <span><strong>BP:</strong> {rx.bp} mmHg</span>}
                {rx.temperature && <span><strong>Temp:</strong> {rx.temperature}°F</span>}
                {rx.weight && <span><strong>Weight:</strong> {rx.weight} kg</span>}
                {rx.spo2 && <span><strong>SpO₂:</strong> {rx.spo2}%</span>}
              </div>
            )}

            {/* CC + Diagnosis */}
            {(rx.chief_complaint || rx.diagnosis) && (
              <div className="mb-4 text-sm space-y-1">
                {rx.chief_complaint && <p><strong>CC:</strong> {rx.chief_complaint}</p>}
                {rx.diagnosis && <p><strong>Dx:</strong> {rx.diagnosis}</p>}
              </div>
            )}

            {/* Rx Symbol + Medicines */}
            <div className="mb-4">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-5xl font-serif font-bold" style={{ color: '#088eaf', lineHeight: 1 }}>℞</span>
                <span className="text-sm text-gray-500">{t('prescription', { defaultValue: 'Prescription' })}</span>
              </div>
              {rx.items.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs text-gray-500">
                      <th className="text-left py-1 pr-3 w-5">#</th>
                      <th className="text-left py-1 pr-3">Medicine</th>
                      <th className="text-left py-1 pr-3">Dose</th>
                      <th className="text-left py-1 pr-3">Frequency</th>
                      <th className="text-left py-1">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rx.items.map((item, i) => (
                      <tr key={item.id} className="border-b border-gray-100">
                        <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                        <td className="py-2 pr-3 font-medium">{item.medicine_name}</td>
                        <td className="py-2 pr-3 text-gray-700">{item.dose ?? '—'}</td>
                        <td className="py-2 pr-3 text-gray-700">{item.frequency ?? '—'}</td>
                        <td className="py-2 text-gray-700">{item.duration ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-400 italic">No medicines prescribed</p>
              )}
            </div>

            {/* Advice */}
            {rx.advice && (
              <div className="mb-4 text-sm">
                <strong>Advice:</strong> {rx.advice}
              </div>
            )}

            {/* Suggested Tests */}
            {rx.suggested_tests && (
              <div className="mb-4 text-sm">
                <strong>Investigation:</strong> {rx.suggested_tests}
              </div>
            )}

            {/* Follow-up */}
            {rx.follow_up_date && (
              <div className="mb-6 text-sm">
                <strong>Follow-up after:</strong>{' '}
                {new Date(rx.follow_up_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-gray-200 pt-4 flex justify-between items-end">
              <div>
                <span className="text-xs text-gray-400">_________________________</span>
                <p className="text-xs mt-1 font-medium">{rx.doctor_name}</p>
                {rx.bmdc_reg_no && <p className="text-xs text-gray-500">BMDC: {rx.bmdc_reg_no}</p>}
              </div>
              <p className="text-xs text-gray-400">Valid for 3 months</p>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
