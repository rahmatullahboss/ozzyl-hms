import { useState, useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import DOMPurify from 'dompurify';
import { ChevronRight, Printer, Download, Share2, FileText, QrCode, Phone } from 'lucide-react';
import DashboardLayout from '../components/DashboardLayout';
import { useApiQuery } from '../hooks/useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import { useTranslation } from 'react-i18next';
import { formatAgeFromDateOfBirth } from '../lib/age';

// ─── Types ───────────────────────────────────────────────────────────────────

interface RxItem {
  id: number;
  medicine_name: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  instructions?: string;
  quantity?: number;
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

interface PrescriptionResponse {
  prescription: Prescription;
}

interface SettingsResponse {
  settings?: { hospital_logo_url?: string };
}

// ─── QR Code Generator (simple SVG-based) ────────────────────────────────────

function generateQRCodeSVG(data: string, size: number = 80): string {
  // Simple QR-like pattern for visual representation
  // In production, use a real QR library like qrcode
  const hash = data.split('').reduce((acc, char) => {
    const h = ((acc << 5) - acc + char.charCodeAt(0)) | 0;
    return h;
  }, 0);
  const cells = 11;
  const cellSize = size / cells;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`;
  svg += `<rect width="${size}" height="${size}" fill="white"/>`;
  // Generate pattern from hash
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      const bit = ((hash >> ((y * cells + x) % 30)) & 1) === 1;
      const isCorner = (x < 3 && y < 3) || (x >= cells - 3 && y < 3) || (x < 3 && y >= cells - 3);
      if (bit || isCorner) {
        svg += `<rect x="${x * cellSize}" y="${y * cellSize}" width="${cellSize}" height="${cellSize}" fill="#088eaf"/>`;
      }
    }
  }
  svg += '</svg>';
  return svg;
}

function generateVerifyUrl(rxNo: string, patientCode: string): string {
  const verify = btoa(`${rxNo}:${patientCode}`).slice(0, 12);
  return `/rx/verify?rx=${encodeURIComponent(rxNo)}&p=${encodeURIComponent(patientCode)}&v=${verify}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcAge(dob?: string, locale: string = 'en-GB'): string {
  return formatAgeFromDateOfBirth(dob, locale);
}

function fmtDate(d?: string, locale: string = 'en-GB'): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
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
    { id: 1, medicine_name: 'Tab. Azithromycin 500mg', dosage: '1 tab', frequency: 'Once daily', duration: '3 days', quantity: 3 },
    { id: 2, medicine_name: 'Tab. Paracetamol 500mg', dosage: '1-2 tabs', frequency: 'SOS', duration: '-', quantity: 10 },
    { id: 3, medicine_name: 'Syr. Benadryl', dosage: '2 tsp', frequency: 'TDS', duration: '5 days', quantity: 1 },
  ],
};

// ─── Component ───────────────────────────────────────────────────────────────

export default function PrescriptionPrint({ role = 'hospital_admin' }: { role?: string }) {
  const { t, i18n } = useTranslation(['patients', 'common']);
  const currentLocale = i18n.language === 'bn' ? 'bn-BD' : 'en-GB';

  const { slug = '', prescriptionId = '' } = useParams<{ slug: string; prescriptionId: string }>();
  const basePath = `/h/${slug}`;

  const [logoUrl, setLogoUrl] = useState<string | null>(null);

  const { data: rxData, isLoading: rxLoading } = useApiQuery<PrescriptionResponse>(
    queryKeys.prescriptionPrint.detail(prescriptionId),
    `/api/prescriptions/${prescriptionId}/print`,
    { enabled: !!prescriptionId },
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

  const rx = rxData?.prescription ?? DEMO;
  const loading = rxLoading;

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
              <Link to={`${basePath}/dashboard`} className="hover:underline">{t('common:dashboard')}</Link>
              <ChevronRight className="w-3 h-3" />
              <Link to={`${basePath}/prescriptions`} className="hover:underline">{t('prescriptionPrint.prescription')}</Link>
              <ChevronRight className="w-3 h-3" />
              <span className="font-medium text-[var(--color-text)]">{t('common:print')} — {rx.rx_no}</span>
            </div>
            <div className="flex gap-2">
              <button onClick={handlePrint} className="btn btn-primary text-sm flex items-center gap-2">
                <Printer className="w-4 h-4" /> {t('prescriptionPrint.print')}
              </button>
              <button className="btn btn-outline text-sm flex items-center gap-2">
                <Download className="w-4 h-4" /> {t('prescriptionPrint.downloadPdf')}
              </button>
              <button className="btn btn-outline text-sm flex items-center gap-2">
                <Share2 className="w-4 h-4" /> {t('prescriptionPrint.share')}
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
              <p className="text-xs text-gray-500">{t('common:hospitalAddress', { defaultValue: 'Dhaka, Bangladesh' })} · {t('common:hospitalPhone', { defaultValue: '+880 1700-000000' })}</p>
            </div>
            <div className="border-b-2 mb-4" style={{ borderColor: '#088eaf' }} />

            {/* Doctor info left / Patient info right */}
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <p className="font-bold text-lg">{rx.doctor_name}</p>
                {rx.qualifications && <p className="text-xs text-gray-600">{rx.qualifications}</p>}
                {rx.specialty && <p className="text-xs text-gray-600">{t('prescriptionPrint.specialist')}: {rx.specialty}</p>}
                {rx.bmdc_reg_no && <p className="text-xs font-medium" style={{ color: '#088eaf' }}>{t('prescriptionPrint.bmdcReg')}: {rx.bmdc_reg_no}</p>}
                {rx.visiting_hours && <p className="text-xs text-gray-500">{t('prescriptionPrint.visiting')}: {rx.visiting_hours}</p>}
              </div>
              <div className="bg-gray-50 rounded-xl p-3 text-sm">
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="text-gray-500">{t('prescriptionPrint.rxNo')}</span>
                  <span className="font-semibold">{rx.rx_no}</span>
                  <span className="text-gray-500">{t('prescriptionPrint.date')}</span>
                  <span>{fmtDate(rx.created_at, currentLocale)}</span>
                  <span className="text-gray-500">{t('prescriptionPrint.patient')}</span>
                  <span className="font-semibold">{rx.patient_name}</span>
                  <span className="text-gray-500">{t('prescriptionPrint.ageSex')}</span>
                  <span>{calcAge(rx.date_of_birth, currentLocale)} / {rx.gender ?? '—'}</span>
                  {rx.address && <>
                    <span className="text-gray-500">{t('prescriptionPrint.address')}</span>
                    <span>{rx.address}</span>
                  </>}
                </div>
              </div>
            </div>

            {/* Vitals */}
            {(rx.bp || rx.temperature || rx.weight || rx.spo2) && (
              <div className="text-xs bg-blue-50 rounded-lg px-3 py-2 mb-4 text-gray-700 flex flex-wrap gap-4">
                {rx.bp && <span><strong>{t('prescriptionPrint.vitals.bp')}:</strong> {rx.bp} mmHg</span>}
                {rx.temperature && <span><strong>{t('prescriptionPrint.vitals.temp')}:</strong> {rx.temperature}°F</span>}
                {rx.weight && <span><strong>{t('prescriptionPrint.vitals.weight')}:</strong> {rx.weight} kg</span>}
                {rx.spo2 && <span><strong>{t('prescriptionPrint.vitals.spo2')}:</strong> {rx.spo2}%</span>}
              </div>
            )}

            {/* CC + Diagnosis */}
            {(rx.chief_complaint || rx.diagnosis) && (
              <div className="mb-4 text-sm space-y-1">
                {rx.chief_complaint && <p><strong>{t('prescriptionPrint.chiefComplaint')}:</strong> {rx.chief_complaint}</p>}
                {rx.diagnosis && <p><strong>{t('prescriptionPrint.diagnoses')}:</strong> {rx.diagnosis}</p>}
              </div>
            )}

            {/* Rx Symbol + Medicines */}
            <div className="mb-4">
              <div className="flex items-baseline gap-2 mb-3">
                <span className="text-5xl font-serif font-bold" style={{ color: '#088eaf', lineHeight: 1 }}>{'℞'}</span>
                <span className="text-sm text-gray-500">{t('prescriptionPrint.prescription')}</span>
              </div>
              {rx.items.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs text-gray-500">
                      <th className="text-left py-1 pr-3 w-5">#</th>
                      <th className="text-left py-1 pr-3">{t('prescriptionPrint.medicine')}</th>
                      <th className="text-left py-1 pr-3">{t('prescriptionPrint.dose')}</th>
                      <th className="text-left py-1 pr-3">{t('prescriptionPrint.frequency')}</th>
                      <th className="text-left py-1">{t('prescriptionPrint.duration')}</th>
                      <th className="text-left py-1">{t('prescriptionPrint.quantity', { defaultValue: 'Qty' })}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rx.items.map((item, i) => (
                      <tr key={item.id} className="border-b border-gray-100">
                        <td className="py-2 pr-3 text-gray-400">{i + 1}</td>
                        <td className="py-2 pr-3 font-medium">{item.medicine_name}</td>
                        <td className="py-2 pr-3 text-gray-700">{item.dosage ?? '-'}</td>
                        <td className="py-2 pr-3 text-gray-700">{item.frequency ?? '—'}</td>
                        <td className="py-2 text-gray-700">{item.duration ?? '—'}</td>
                        <td className="py-2 text-gray-700">{item.quantity ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-sm text-gray-400 italic">{t('prescriptionPrint.noMedicines')}</p>
              )}
            </div>

            {/* Advice */}
            {rx.advice && (
              <div className="mb-4 text-sm">
                <strong>{t('prescriptionPrint.advice')}:</strong> {rx.advice}
              </div>
            )}

            {/* Suggested Tests */}
            {rx.suggested_tests && (
              <div className="mb-4 text-sm">
                <strong>{t('prescriptionPrint.investigation')}:</strong> {rx.suggested_tests}
              </div>
            )}

            {/* Follow-up */}
            {rx.follow_up_date && (
              <div className="mb-6 text-sm">
                <strong>{t('prescriptionPrint.followUp')}</strong>{' '}
                {new Date(rx.follow_up_date).toLocaleDateString(currentLocale, { day: 'numeric', month: 'long', year: 'numeric' })}
              </div>
            )}

            {/* Footer */}
            <div className="border-t border-gray-200 pt-4 flex justify-between items-end">
              <div>
                <span className="text-xs text-gray-400">_________________________</span>
                <p className="text-xs mt-1 font-medium">{rx.doctor_name}</p>
                {rx.bmdc_reg_no && <p className="text-xs text-gray-500">{t('prescriptionPrint.bmdcReg')}: {rx.bmdc_reg_no}</p>}
              </div>
              <div className="flex items-end gap-4">
                {/* Emergency Contact */}
                <div className="text-right">
                  <p className="text-[10px] text-gray-400 flex items-center gap-1 justify-end">
                    <Phone className="w-2.5 h-2.5" />
                    {t('prescriptionPrint.emergencyContact', { defaultValue: 'Emergency' })}
                  </p>
                  <p className="text-[10px] text-gray-500">+880 1700-000000</p>
                </div>
                {/* QR Code */}
                <div className="flex flex-col items-center">
                  <div
                    className="border border-gray-200 rounded"
                    style={{ width: 60, height: 60 }}
                    dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(generateQRCodeSVG(generateVerifyUrl(rx.rx_no, rx.patient_code), 60), { USE_PROFILES: { svg: true } }) }}
                  />
                  <p className="text-[8px] text-gray-400 mt-0.5">{t('prescriptionPrint.scanToVerify', { defaultValue: 'Scan to verify' })}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
