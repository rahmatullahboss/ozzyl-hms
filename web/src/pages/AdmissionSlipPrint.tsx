import { useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import InvoiceBrandHeader from '../components/invoice/InvoiceBrandHeader';
import InvoiceFooter from '../components/invoice/InvoiceFooter';
import type { InvoiceHospitalInfo } from '../components/invoice/types';
import { useApiQuery } from '../hooks/useApiQuery';
import {
  getInvoicePaperConfig,
  parseInvoicePaperSize,
  type InvoicePaperSize,
} from '../lib/print/invoicePaper';
import { queryKeys } from '../lib/queryKeys';

interface AdmissionSlipRecord {
  id: number;
  admission_no: string;
  admission_date: string;
  admission_type?: string | null;
  admit_source?: string | null;
  referral_doctor?: string | null;
  admission_reason?: string | null;
  is_emergency?: number | boolean | null;
  provisional_diagnosis?: string | null;
  department?: string | null;
  patient_name: string;
  patient_code?: string | null;
  gender?: string | null;
  mobile?: string | null;
  date_of_birth?: string | null;
  blood_group?: string | null;
  address?: string | null;
  ward_name?: string | null;
  bed_number?: string | null;
  bed_type?: string | null;
  doctor_name?: string | null;
  doctor_specialization?: string | null;
  care_of_name?: string | null;
  care_of_phone?: string | null;
  care_of_relation?: string | null;
  created_by_name?: string | null;
}

interface AdmissionSlipResponse {
  slip: AdmissionSlipRecord;
}

interface SettingsResponse {
  settings?: {
    hospital_logo_url?: string;
    hospital_name?: string;
  };
  hospital_info?: {
    name?: string;
    tagline?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    registration_number?: string;
    bin_tin?: string;
    footer_text?: string;
  };
}

function getHospitalName(): string {
  try {
    const tenant = JSON.parse(localStorage.getItem('tenant') ?? '{}');
    return tenant?.name ?? 'Hospital Management System';
  } catch {
    return 'Hospital Management System';
  }
}

function formatDateTime(date: string, locale: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date || '—';
  return `${parsed.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}, ${parsed.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })}`;
}

function formatDate(date: string | null | undefined, locale: string): string {
  if (!date) return '—';
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00` : date;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function calculateAge(dateOfBirth?: string | null): string | null {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let years = today.getFullYear() - birth.getFullYear();
  const monthDifference = today.getMonth() - birth.getMonth();
  if (monthDifference < 0 || (monthDifference === 0 && today.getDate() < birth.getDate())) years -= 1;
  return years >= 0 ? `${years}` : null;
}

function displayValue(value: unknown): ReactNode {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function getAdmissionSlipStyles(pageRule: string, margin: string): string {
  return `
    :root {
      --invoice-navy: #10234a;
      --invoice-teal: #078d87;
      --invoice-teal-dark: #08736f;
      --invoice-teal-soft: #e9f7f6;
      --invoice-line: #cbd9df;
      --invoice-muted: #64748b;
    }
    * { box-sizing: border-box; }
    .admission-slip-sheet {
      display: flex;
      min-height: 210mm;
      flex-direction: column;
      overflow: hidden;
      color: var(--invoice-navy);
      background: white;
      font-family: Inter, "Noto Sans Bengali", Arial, sans-serif;
    }
    .invoice-paper-a4 { min-height: 297mm; }
    .invoice-paper-a5 { min-height: 210mm; }
    .invoice-brand-header {
      display: flex;
      justify-content: space-between;
      gap: 18px;
      padding: 16px 28px 13px;
      border-bottom: 2px solid var(--invoice-teal);
    }
    .invoice-brand-identity { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .invoice-brand-logo { width: 54px; height: 54px; object-fit: contain; flex: none; }
    .invoice-brand-identity h1 { margin: 0; font-size: 15px; line-height: 1.08; font-weight: 800; color: var(--invoice-navy); }
    .invoice-brand-tagline { margin: 5px 0 0; color: var(--invoice-teal-dark); font-size: 10px; font-weight: 600; }
    .invoice-brand-contact { margin: 4px 0 0; color: var(--invoice-muted); font-size: 10px; }
    .invoice-identity { text-align: right; flex: none; }
    .invoice-title { margin: 0; font-size: 18px; letter-spacing: .04em; line-height: 1; font-weight: 900; color: var(--invoice-navy); }
    .invoice-number-pill {
      display: inline-block;
      margin-top: 9px;
      padding: 6px 18px;
      border-radius: 999px;
      background: linear-gradient(90deg, var(--invoice-teal), #0aa49c);
      color: white;
      font-size: 12px;
      line-height: 1;
      font-weight: 800;
      letter-spacing: .03em;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .invoice-header-meta { display: grid; gap: 4px; margin-top: 8px; text-align: left; }
    .invoice-header-meta > div { display: grid; grid-template-columns: 14px 84px 1fr; align-items: center; gap: 6px; font-size: 10px; }
    .invoice-header-meta svg { width: 13px; height: 13px; color: var(--invoice-teal); }
    .invoice-header-meta span { color: var(--invoice-muted); }
    .invoice-header-meta strong { color: var(--invoice-navy); font-weight: 700; }
    .invoice-type-ribbon {
      padding: 7px 28px;
      background: linear-gradient(90deg, #edfafa, #fff);
      color: var(--invoice-teal-dark);
      font-size: 11px;
      font-weight: 800;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: .14em;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .admission-slip-body { flex: 1; padding: 18px 28px 14px; }
    .admission-highlight {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) repeat(3, minmax(0, 1fr));
      margin-bottom: 14px;
      border: 1px solid var(--invoice-line);
      border-radius: 10px;
      overflow: hidden;
    }
    .admission-highlight > div { padding: 10px 12px; border-right: 1px solid var(--invoice-line); }
    .admission-highlight > div:last-child { border-right: 0; }
    .admission-highlight span, .admission-detail span { display: block; color: var(--invoice-muted); font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .admission-highlight strong { display: block; margin-top: 4px; color: var(--invoice-navy); font-size: 11px; line-height: 1.3; }
    .admission-section { margin-top: 15px; break-inside: avoid; }
    .admission-section:first-of-type { margin-top: 0; }
    .admission-section-title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 0 9px;
      color: var(--invoice-teal-dark);
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .admission-section-title::before { content: ''; width: 4px; height: 17px; border-radius: 99px; background: var(--invoice-teal); }
    .admission-details-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      border-top: 1px solid var(--invoice-line);
      border-left: 1px solid var(--invoice-line);
    }
    .admission-detail {
      min-height: 45px;
      padding: 8px 10px;
      border-right: 1px solid var(--invoice-line);
      border-bottom: 1px solid var(--invoice-line);
    }
    .admission-detail strong { display: block; margin-top: 4px; color: var(--invoice-navy); font-size: 10.5px; line-height: 1.35; overflow-wrap: anywhere; }
    .admission-detail-wide { grid-column: 1 / -1; }
    .admission-emergency { color: #b91c1c !important; }
    .admission-signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: 24px; margin-top: 38px; padding: 0 8px; break-inside: avoid; }
    .admission-signature { padding-top: 6px; border-top: 1px solid #64748b; text-align: center; color: #475569; font-size: 9px; }
    .invoice-footer { margin-top: auto; padding: 12px 28px 14px; border-top: 1px solid var(--invoice-line); break-inside: avoid; }
    .invoice-footer-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .invoice-footer-grid > div { display: grid; grid-template-columns: 18px 1fr; grid-template-rows: auto auto; column-gap: 6px; min-width: 0; }
    .invoice-footer-grid svg { grid-row: 1 / 3; width: 14px; height: 14px; margin-top: 2px; color: var(--invoice-teal-dark); }
    .invoice-footer-grid span { color: var(--invoice-muted); font-size: 8px; text-transform: uppercase; }
    .invoice-footer-grid strong { color: var(--invoice-navy); font-size: 9px; overflow-wrap: anywhere; }
    .invoice-footer-message { margin: 8px 0 0; color: var(--invoice-muted); font-size: 9px; text-align: center; }
    .invoice-thank-you { display: flex; justify-content: center; gap: 7px; margin-top: 10px; color: var(--invoice-teal-dark); font-size: 9px; }
    .invoice-thank-you span { color: var(--invoice-muted); }

    /* A5 keeps the full admission record readable while remaining a single page. */
    .invoice-paper-a5 { width: 148mm; min-height: 210mm; }
    .invoice-paper-a5 .invoice-brand-header { gap: 11px; padding: 10px 18px 8px; }
    .invoice-paper-a5 .invoice-brand-identity { gap: 9px; }
    .invoice-paper-a5 .invoice-brand-logo { width: 46px; height: 46px; }
    .invoice-paper-a5 .invoice-brand-identity h1 { font-size: 14px; line-height: 1.06; }
    .invoice-paper-a5 .invoice-brand-tagline { margin-top: 3px; font-size: 9px; }
    .invoice-paper-a5 .invoice-brand-contact { margin-top: 2px; font-size: 8.5px; line-height: 1.18; }
    .invoice-paper-a5 .invoice-title { font-size: 16px; }
    .invoice-paper-a5 .invoice-number-pill { margin-top: 5px; padding: 4px 12px; font-size: 10.5px; }
    .invoice-paper-a5 .invoice-header-meta { gap: 2px; margin-top: 5px; }
    .invoice-paper-a5 .invoice-header-meta > div { grid-template-columns: 11px 72px 1fr; gap: 4px; font-size: 9px; }
    .invoice-paper-a5 .invoice-header-meta svg { width: 10px; height: 10px; }
    .invoice-paper-a5 .invoice-type-ribbon { padding: 4px 18px; font-size: 10px; letter-spacing: .1em; }
    .invoice-paper-a5 .admission-slip-body { display: flex; flex: 1; flex-direction: column; padding: 10px 18px 8px; }
    .invoice-paper-a5 .admission-highlight { margin-bottom: 8px; border-radius: 7px; }
    .invoice-paper-a5 .admission-highlight > div { padding: 6px 8px; }
    .invoice-paper-a5 .admission-highlight span,
    .invoice-paper-a5 .admission-detail span { font-size: 9px; letter-spacing: .025em; }
    .invoice-paper-a5 .admission-highlight strong { margin-top: 2px; font-size: 10.5px; line-height: 1.2; }
    .invoice-paper-a5 .admission-section { margin-top: 9px; }
    .invoice-paper-a5 .admission-section-title { gap: 5px; margin-bottom: 5px; font-size: 10px; }
    .invoice-paper-a5 .admission-section-title::before { width: 3px; height: 14px; }
    .invoice-paper-a5 .admission-details-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .invoice-paper-a5 .admission-detail { min-height: 0; padding: 5px 7px; }
    .invoice-paper-a5 .admission-detail strong { margin-top: 3px; font-size: 10.5px; line-height: 1.22; }
    .invoice-paper-a5 .admission-signatures { gap: 16px; margin-top: auto; padding: 18px 4px 0; }
    .invoice-paper-a5 .admission-signature { padding-top: 4px; font-size: 9px; }
    .invoice-paper-a5 .invoice-footer { padding: 8px 18px 9px; }
    .invoice-paper-a5 .invoice-footer-grid { gap: 5px 7px; }
    .invoice-paper-a5 .invoice-footer-grid > div { grid-template-columns: 13px 1fr; column-gap: 4px; }
    .invoice-paper-a5 .invoice-footer-grid svg { width: 10px; height: 10px; margin-top: 0; }
    .invoice-paper-a5 .invoice-footer-grid span { font-size: 8px; }
    .invoice-paper-a5 .invoice-footer-grid strong { font-size: 9px; line-height: 1.18; }
    .invoice-paper-a5 .invoice-footer-message { margin-top: 5px; font-size: 8.5px; }
    .invoice-paper-a5 .invoice-thank-you { gap: 5px; margin-top: 6px; font-size: 9px; }

    @page { size: ${pageRule}; margin: ${margin}; }
    @media print {
      html, body { margin: 0 !important; padding: 0 !important; background: white !important; }
      .no-print { display: none !important; }
      .admission-slip-sheet { width: 100%; min-height: auto; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
      .admission-slip-sheet.invoice-paper-a5 {
        width: 148mm !important;
        height: 210mm !important;
        min-height: 210mm !important;
        overflow: visible !important;
        break-after: avoid-page;
      }
    }
    @media screen and (max-width: 720px) {
      .invoice-brand-header { padding: 16px 18px 12px; gap: 10px; }
      .invoice-brand-logo { width: 46px; height: 46px; }
      .invoice-header-meta { display: none; }
      .admission-slip-body { padding: 15px 18px 12px; }
      .admission-highlight { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .admission-highlight > div:nth-child(2) { border-right: 0; }
      .admission-highlight > div:nth-child(-n+2) { border-bottom: 1px solid var(--invoice-line); }
      .admission-details-grid { grid-template-columns: 1fr; }
      .admission-detail-wide { grid-column: auto; }
      .admission-signatures { grid-template-columns: 1fr; gap: 30px; }
      .invoice-footer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  `;
}

function Detail({ label, value, wide = false, emergency = false }: {
  label: string;
  value: ReactNode;
  wide?: boolean;
  emergency?: boolean;
}) {
  return (
    <div className={`admission-detail${wide ? ' admission-detail-wide' : ''}`}>
      <span>{label}</span>
      <strong className={emergency ? 'admission-emergency' : undefined}>{value}</strong>
    </div>
  );
}

export default function AdmissionSlipPrint({ role = 'hospital_admin' }: { role?: string }) {
  const { t, i18n } = useTranslation(['ipd', 'common']);
  const { slug = '', admissionId = '' } = useParams<{ slug: string; admissionId: string }>();
  const navigate = useNavigate();
  const slipRef = useRef<HTMLElement>(null);
  const [printLang, setPrintLang] = useState<'en' | 'bn'>(() => {
    const saved = localStorage.getItem('admissionSlipLang');
    if (saved === 'en' || saved === 'bn') return saved;
    return i18n.language === 'bn' ? 'bn' : 'en';
  });
  const [paperSize, setPaperSize] = useState<InvoicePaperSize>(() =>
    parseInvoicePaperSize(localStorage.getItem('admissionSlipPaperSize')),
  );

  const { data: slipData, isLoading, error } = useApiQuery<AdmissionSlipResponse>(
    [...queryKeys.admissions.all, 'slip-print', admissionId],
    `/api/admissions/${admissionId}/slip`,
    { enabled: Boolean(admissionId) },
  );
  const { data: settingsData } = useApiQuery<SettingsResponse>(
    queryKeys.settings.all,
    '/api/settings',
  );

  const currentLocale = printLang === 'bn' ? 'bn-BD' : 'en-GB';
  const l = (english: string, bengali: string) => printLang === 'bn' ? bengali : english;
  const paperConfig = getInvoicePaperConfig(paperSize);
  const listPath = role === 'reception' || role === 'receptionist'
    ? `/h/${slug}/reception/admissions`
    : `/h/${slug}/admissions`;
  const slip = slipData?.slip ?? null;
  const hospital: InvoiceHospitalInfo = {
    name: settingsData?.hospital_info?.name
      || settingsData?.settings?.hospital_name
      || getHospitalName(),
    tagline: settingsData?.hospital_info?.tagline ?? '',
    address: settingsData?.hospital_info?.address ?? '',
    phone: settingsData?.hospital_info?.phone ?? '',
    email: settingsData?.hospital_info?.email ?? '',
    website: settingsData?.hospital_info?.website ?? '',
    registrationNumber: settingsData?.hospital_info?.registration_number ?? '',
    binTin: settingsData?.hospital_info?.bin_tin ?? '',
    footerText: settingsData?.hospital_info?.footer_text ?? '',
    logoUrl: settingsData?.settings?.hospital_logo_url ?? null,
  };

  const printSlip = () => {
    const slipElement = slipRef.current;
    if (!slipElement) return;

    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('title', 'Admission slip print frame');
    printFrame.setAttribute('aria-hidden', 'true');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    printFrame.style.opacity = '0';
    printFrame.style.pointerEvents = 'none';
    document.body.appendChild(printFrame);

    const printWindow = printFrame.contentWindow;
    const printDocument = printFrame.contentDocument ?? printWindow?.document;
    if (!printWindow || !printDocument) {
      printFrame.remove();
      window.print();
      return;
    }

    const cleanup = () => setTimeout(() => printFrame.remove(), 500);
    const styles = getAdmissionSlipStyles(paperConfig.pageRule, paperConfig.margin);
    printDocument.open();
    printDocument.write(`<!doctype html>
      <html lang="${printLang}">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${slip?.admission_no ?? 'Admission Slip'}</title>
          <style>
            html, body { margin: 0; padding: 0; background: white; }
            ${styles}
          </style>
        </head>
        <body>${slipElement.outerHTML}</body>
      </html>`);
    printDocument.close();

    const startPrint = () => {
      const images = Array.from(printDocument.images);
      Promise.all(images.map((image) => image.decode?.().catch(() => undefined)))
        .finally(() => {
          printWindow.focus();
          printWindow.addEventListener('afterprint', cleanup, { once: true });
          printWindow.print();
          setTimeout(cleanup, 10_000);
        });
    };

    if (printDocument.readyState === 'complete') startPrint();
    else printWindow.addEventListener('load', startPrint, { once: true });
  };

  if (isLoading) {
    return (
      <DashboardLayout role={role}>
        <div className="mx-auto max-w-[210mm] space-y-4">
          <div className="skeleton h-16 w-full rounded-xl" />
          <div className="skeleton h-96 w-full rounded-xl" />
        </div>
      </DashboardLayout>
    );
  }

  if (!slip || error) {
    return (
      <DashboardLayout role={role}>
        <div className="card mx-auto max-w-md p-10 text-center">
          <h1 className="text-lg font-bold text-[var(--color-text)]">
            {l('Admission slip unavailable', 'ভর্তি স্লিপ পাওয়া যায়নি')}
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {error?.message ?? l('The admission record could not be loaded.', 'ভর্তির তথ্য লোড করা যায়নি।')}
          </p>
          <button type="button" onClick={() => navigate(listPath)} className="btn-primary mt-5">
            <ArrowLeft className="h-4 w-4" /> {t('common:back', { defaultValue: l('Go Back', 'ফিরে যান') })}
          </button>
        </div>
      </DashboardLayout>
    );
  }

  const age = calculateAge(slip.date_of_birth);
  const emergency = Boolean(slip.is_emergency);
  const source = slip.admit_source?.replace(/_/g, ' ');
  const doctor = [slip.doctor_name, slip.doctor_specialization].filter(Boolean).join(' — ');
  const bed = [slip.bed_number, slip.bed_type ? `(${slip.bed_type})` : null].filter(Boolean).join(' ');

  return (
    <DashboardLayout role={role}>
      <style>{getAdmissionSlipStyles(paperConfig.pageRule, paperConfig.margin)}</style>
      <div className="mx-auto space-y-4" style={{ maxWidth: paperConfig.previewWidth }}>
        <div className="no-print rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(listPath)}
                className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-slate-200 bg-white text-[var(--color-text-muted)] shadow-sm transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] dark:border-slate-700 dark:bg-slate-800"
                title={l('Back to admissions', 'ভর্তি তালিকায় ফিরুন')}
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                  {l('Print preview', 'প্রিন্ট প্রিভিউ')}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <span>{slip.admission_no}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {l('Admission Slip', 'ভর্তি স্লিপ')}
                  </span>
                  <span className="text-xs font-medium text-[var(--color-text-muted)]">
                    {formatDateTime(slip.admission_date, currentLocale)}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:justify-end">
              <label className="flex min-w-[110px] flex-col gap-1 text-xs font-semibold text-[var(--color-text-muted)]">
                {l('Paper', 'কাগজ')}
                <select
                  aria-label={l('Paper size', 'কাগজের সাইজ')}
                  className="input h-10 px-3 py-2 text-sm font-semibold text-[var(--color-text)]"
                  value={paperSize}
                  onChange={(event) => {
                    const value = parseInvoicePaperSize(event.target.value);
                    setPaperSize(value);
                    localStorage.setItem('admissionSlipPaperSize', value);
                  }}
                >
                  <option value="a5">A5</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label className="flex min-w-[130px] flex-col gap-1 text-xs font-semibold text-[var(--color-text-muted)]">
                {l('Language', 'ভাষা')}
                <select
                  aria-label={l('Print language', 'প্রিন্টের ভাষা')}
                  className="input h-10 px-3 py-2 text-sm font-semibold text-[var(--color-text)]"
                  value={printLang}
                  onChange={(event) => {
                    const value = event.target.value as 'en' | 'bn';
                    setPrintLang(value);
                    localStorage.setItem('admissionSlipLang', value);
                  }}
                >
                  <option value="en">English</option>
                  <option value="bn">বাংলা</option>
                </select>
              </label>
              <button type="button" onClick={printSlip} className="btn-primary h-10 justify-center px-4 shadow-sm">
                <Printer className="h-4 w-4" /> {l('Print Admission Slip', 'ভর্তি স্লিপ প্রিন্ট')}
              </button>
              <button
                type="button"
                onClick={printSlip}
                className="btn-secondary h-10 justify-center px-4"
                title={l("Use the browser's Save as PDF option", 'ব্রাউজারের Save as PDF অপশন ব্যবহার করুন')}
              >
                <Download className="h-4 w-4" /> {l('Save as PDF', 'PDF সেভ করুন')}
              </button>
            </div>
          </div>
        </div>

        <article
          ref={slipRef}
          className={`admission-slip-sheet invoice-paper-${paperSize} rounded-xl border border-slate-200 shadow-lg`}
        >
          <InvoiceBrandHeader
            hospital={hospital}
            invoiceNo={slip.admission_no}
            issueDate={formatDateTime(slip.admission_date, currentLocale)}
            labels={{
              invoice: l('ADMISSION SLIP', 'ভর্তি স্লিপ'),
              issueDate: l('Admission Date', 'ভর্তির তারিখ'),
              appointmentId: l('Admission ID', 'ভর্তি আইডি'),
            }}
          />
          <div className="invoice-type-ribbon">{l('Inpatient Admission', 'ইনডোর রোগী ভর্তি')}</div>

          <div className="admission-slip-body">
            <div className="admission-highlight">
              <div><span>{l('Patient', 'রোগী')}</span><strong>{slip.patient_name}</strong></div>
              <div><span>{l('Patient ID', 'রোগীর আইডি')}</span><strong>{displayValue(slip.patient_code)}</strong></div>
              <div><span>{l('Ward / Cabin', 'ওয়ার্ড / কেবিন')}</span><strong>{displayValue(slip.ward_name)}</strong></div>
              <div><span>{l('Bed No.', 'বেড নং')}</span><strong>{displayValue(bed)}</strong></div>
            </div>

            <section className="admission-section">
              <h2 className="admission-section-title">{l('Patient Information', 'রোগীর তথ্য')}</h2>
              <div className="admission-details-grid">
                <Detail label={l('Mobile', 'মোবাইল')} value={displayValue(slip.mobile)} />
                <Detail label={l('Gender', 'লিঙ্গ')} value={displayValue(slip.gender)} />
                <Detail label={l('Age', 'বয়স')} value={age ? `${age} ${l('years', 'বছর')}` : '—'} />
                <Detail label={l('Date of Birth', 'জন্মতারিখ')} value={formatDate(slip.date_of_birth, currentLocale)} />
                <Detail label={l('Blood Group', 'রক্তের গ্রুপ')} value={displayValue(slip.blood_group)} />
                <Detail label={l('Address', 'ঠিকানা')} value={displayValue(slip.address)} wide />
              </div>
            </section>

            <section className="admission-section">
              <h2 className="admission-section-title">{l('Admission Details', 'ভর্তির তথ্য')}</h2>
              <div className="admission-details-grid">
                <Detail label={l('Admission Date & Time', 'ভর্তির তারিখ ও সময়')} value={formatDateTime(slip.admission_date, currentLocale)} />
                <Detail label={l('Admission Type', 'ভর্তির ধরন')} value={displayValue(slip.admission_type)} />
                <Detail label={l('Admit Source', 'ভর্তির উৎস')} value={displayValue(source)} />
                <Detail label={l('Emergency', 'জরুরি')} value={emergency ? l('Yes', 'হ্যাঁ') : l('No', 'না')} emergency={emergency} />
                <Detail label={l('Department', 'বিভাগ')} value={displayValue(slip.department)} />
                <Detail label={l('Ward / Cabin', 'ওয়ার্ড / কেবিন')} value={displayValue(slip.ward_name)} />
                <Detail label={l('Bed', 'বেড')} value={displayValue(bed)} />
                <Detail label={l('Attending Doctor', 'দায়িত্বপ্রাপ্ত ডাক্তার')} value={displayValue(doctor)} />
                <Detail label={l('Referral Doctor', 'রেফারেল ডাক্তার')} value={displayValue(slip.referral_doctor)} />
                <Detail label={l('Admission Reason', 'ভর্তির কারণ')} value={displayValue(slip.admission_reason)} wide />
                <Detail label={l('Provisional Diagnosis', 'প্রাথমিক রোগ নির্ণয়')} value={displayValue(slip.provisional_diagnosis)} wide />
              </div>
            </section>

            {(slip.care_of_name || slip.care_of_phone || slip.care_of_relation) && (
              <section className="admission-section">
                <h2 className="admission-section-title">{l('Guardian / Care-of Person', 'অভিভাবক / দায়িত্বপ্রাপ্ত ব্যক্তি')}</h2>
                <div className="admission-details-grid">
                  <Detail label={l('Name', 'নাম')} value={displayValue(slip.care_of_name)} />
                  <Detail label={l('Relation', 'সম্পর্ক')} value={displayValue(slip.care_of_relation)} />
                  <Detail label={l('Phone', 'ফোন')} value={displayValue(slip.care_of_phone)} />
                </div>
              </section>
            )}

            <div className="admission-signatures">
              <div className="admission-signature">{l('Patient / Guardian Signature', 'রোগী / অভিভাবকের স্বাক্ষর')}</div>
              <div className="admission-signature">
                {slip.created_by_name
                  ? `${slip.created_by_name} · ${l('Admitting Officer', 'ভর্তি গ্রহণকারী')}`
                  : l('Admitting Officer', 'ভর্তি গ্রহণকারী')}
              </div>
              <div className="admission-signature">{l('Authorized Signature', 'অনুমোদিত স্বাক্ষর')}</div>
            </div>
          </div>

          <InvoiceFooter
            hospital={hospital}
            labels={{
              hotline: l('Hotline', 'হটলাইন'),
              address: l('Address', 'ঠিকানা'),
              website: l('Website', 'ওয়েবসাইট'),
              email: l('Email', 'ইমেইল'),
              registration: l('Registration', 'রেজিস্ট্রেশন'),
              binTin: l('BIN / TIN', 'বিন / টিন'),
              thankYou: l('Thank you for choosing', 'আমাদের সেবা বেছে নেওয়ার জন্য ধন্যবাদ'),
            }}
          />
        </article>
      </div>
    </DashboardLayout>
  );
}
