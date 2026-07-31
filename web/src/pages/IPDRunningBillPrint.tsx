import { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { Link, useParams, useNavigate } from 'react-router';
import { AlertTriangle, Loader2, ArrowLeft, Download, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import { apiFetch } from '../lib/apiClient';
import { buildRunningBillHtml, getRunningBillPreviewWidth } from '../lib/print';
import type { RunningBillData, RunningBillPaperSize } from '../lib/print';

interface AdmissionDetail {
  id: number;
  admission_no: string;
  patient_id: number;
  patient_name: string;
  patient_code?: string | null;
  mobile?: string | null;
  patient_mobile?: string | null;
  address?: string | null;
  patient_address?: string | null;
  age?: string | null;
  gender?: string | null;
  ward_name?: string | null;
  bed_number?: string | null;
  bed_type?: string | null;
  doctor_name?: string | null;
  admission_date: string;
  admission_type?: string | null;
  status?: string | null;
  provisional_diagnosis?: string | null;
}

interface PendingItem {
  item_name: string;
  item_category?: string | null;
  department?: string | null;
  unit_price: number;
  quantity: number;
  discount_percent?: number | null;
  total_amount: number;
  created_at?: string | null;
}

interface BedChargeSegment {
  ward_name?: string | null;
  bed_number?: string | null;
  bed_type?: string | null;
  rate_per_day: number;
  started_on?: string | null;
  ended_on?: string | null;
  days: number;
  charge_amount: number;
}

interface PendingResponse {
  items?: PendingItem[];
  bed_charges?: { segments?: BedChargeSegment[]; bed_total?: number };
  summary?: {
    provisional_total?: number;
    package_total?: number;
    bed_total?: number;
    grand_total?: number;
    deposit_balance?: number;
    deposit_total?: number;
    deposit_used?: number;
    net_payable?: number;
  };
  deposit_history?: TimelineEntry[];
}

interface TimelineEntry {
  type?: string | null;
  description?: string | null;
  amount?: number | null;
  payment_method?: string | null;
  receipt_no?: string | null;
  received_by_name?: string | null;
  created_by?: string | number | null;
  created_at?: string | null;
}

interface SettingsResponse {
  settings?: { hospital_logo_url?: string };
  hospital_info?: {
    name?: string;
    tagline?: string;
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
    footer_text?: string;
  };
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sanitizeRunningBillPreviewHtml(html: string): string {
  return DOMPurify.sanitize(html, { ADD_TAGS: ['style'], FORCE_BODY: true });
}

export function buildPrintData(
  admission: AdmissionDetail,
  pending: PendingResponse,
  settings: SettingsResponse | null,
): RunningBillData {
  const items = pending.items ?? [];
  const bedCharges = pending.bed_charges?.segments ?? [];
  const provisionalTotal = asNumber(pending.summary?.provisional_total ?? items.reduce((sum, item) => sum + asNumber(item.total_amount), 0));
  const bedTotal = asNumber(pending.summary?.bed_total ?? pending.bed_charges?.bed_total ?? bedCharges.reduce((sum, bed) => sum + asNumber(bed.charge_amount), 0));
  const grandTotal = asNumber(pending.summary?.grand_total ?? provisionalTotal + bedTotal + asNumber(pending.summary?.package_total));
  const depositBalance = asNumber(pending.summary?.deposit_balance);
  const netPayable = asNumber(pending.summary?.net_payable ?? Math.max(0, grandTotal - depositBalance));

  return {
    admission: {
      id: admission.id,
      admission_no: admission.admission_no,
      admission_date: admission.admission_date,
      admission_type: admission.admission_type ?? '',
      status: admission.status ?? '',
      provisional_diagnosis: admission.provisional_diagnosis ?? '',
    },
    patient: {
      id: admission.patient_id,
      name: admission.patient_name,
      patient_code: admission.patient_code ?? '',
      mobile: admission.mobile ?? admission.patient_mobile ?? '',
      address: admission.address ?? admission.patient_address ?? '',
      age: admission.age ?? '',
      gender: admission.gender ?? '',
    },
    doctor: { name: admission.doctor_name ?? '' },
    bed: {
      ward_name: admission.ward_name ?? '',
      bed_number: admission.bed_number ?? '',
      bed_type: admission.bed_type ?? '',
    },
    items: items.map((item) => ({
      item_category: item.item_category ?? 'service',
      item_name: item.item_name,
      department: item.department ?? '',
      quantity: asNumber(item.quantity),
      unit_price: asNumber(item.unit_price),
      discount_percent: asNumber(item.discount_percent),
      total_amount: asNumber(item.total_amount),
      created_at: item.created_at ?? '',
    })),
    bed_charges: bedCharges.map((bed) => ({
      ward_name: bed.ward_name ?? admission.ward_name ?? '',
      bed_number: bed.bed_number ?? admission.bed_number ?? '',
      bed_type: bed.bed_type ?? admission.bed_type ?? '',
      rate_per_day: asNumber(bed.rate_per_day),
      days: asNumber(bed.days),
      charge_amount: asNumber(bed.charge_amount),
      started_on: bed.started_on ?? '',
      ended_on: bed.ended_on ?? '',
    })),
    payments: (pending.deposit_history ?? [])
      .map((entry) => ({
        type: entry.type ?? '',
        description: entry.description ?? '',
        amount: entry.type === 'refund' || entry.type === 'adjustment'
          ? -Math.abs(asNumber(entry.amount))
          : asNumber(entry.amount),
        payment_method: entry.payment_method ?? '',
        receipt_no: entry.receipt_no ?? '',
        received_by_name: entry.received_by_name ?? (entry.created_by != null ? String(entry.created_by) : ''),
        created_at: entry.created_at ?? '',
      })),
    summary: {
      provisional_total: provisionalTotal,
      package_total: asNumber(pending.summary?.package_total),
      bed_total: bedTotal,
      grand_total: grandTotal,
      deposit_balance: depositBalance,
      deposit_total: asNumber(pending.summary?.deposit_total),
      deposit_used: asNumber(pending.summary?.deposit_used),
      net_payable: netPayable,
      current_balance: depositBalance - grandTotal,
    },
    hospital: {
      name: settings?.hospital_info?.name ?? 'Hospital Management System',
      tagline: settings?.hospital_info?.tagline ?? '',
      address: settings?.hospital_info?.address ?? '',
      phone: settings?.hospital_info?.phone ?? '',
      email: settings?.hospital_info?.email ?? '',
      website: settings?.hospital_info?.website ?? '',
      logo_url: settings?.settings?.hospital_logo_url ?? '',
      footer_text: settings?.hospital_info?.footer_text ?? '',
    },
    generated_at: new Date().toISOString(),
  };
}

export default function IPDRunningBillPrint(props: { role?: string }) {
  const layoutRole = props.role ?? 'reception';
  const { t } = useTranslation(['tenantBilling', 'common']);
  const { admissionId, slug = '' } = useParams<{ admissionId: string; slug: string }>();
  const navigate = useNavigate();
  const basePath = slug ? `/h/${slug}` : '';
  const [data, setData] = useState<RunningBillData | null>(null);
  const [paperSize, setPaperSize] = useState<RunningBillPaperSize>(() => (localStorage.getItem('runningBillPaperSize') === 'a4' ? 'a4' : 'a5'));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      if (!admissionId) {
        setError(t('ipdRunningBillPrint.error.missingAdmissionId'));
        setLoading(false);
        return;
      }

      setError('');
      setData(null);
      setLoading(true);

      try {
        const [admissionRes, pendingRes, settingsRes] = await Promise.all([
          apiFetch<{ admission: AdmissionDetail }>(`/api/admissions/${admissionId}/detail`),
          apiFetch<PendingResponse>(`/api/ip-billing/pending/${admissionId}`),
          apiFetch<SettingsResponse>('/api/settings').catch(() => null),
        ]);

        if (!cancelled) {
          setData(buildPrintData(admissionRes.admission, pendingRes, settingsRes));
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t('ipdRunningBillPrint.error.loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => { cancelled = true; };
  }, [admissionId, t]);

  const previewHtml = useMemo(
    () => (data ? buildRunningBillHtml(data, { paperSize, includeScreenActions: false }) : ''),
    [data, paperSize],
  );
  const previewWidth = getRunningBillPreviewWidth(paperSize);
  const billingPath = `${basePath}/reception/ip-billing`;

  if (loading) {
    return (
      <DashboardLayout role={layoutRole}>
        <div className="flex min-h-[60vh] items-center justify-center text-slate-600">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {t('ipdRunningBillPrint.loading')}
        </div>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout role={layoutRole}>
        <div className="card mx-auto max-w-xl p-6 text-red-700">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" />
            {t('ipdRunningBillPrint.errorTitle')}
          </div>
          <p className="text-sm">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-4 w-4" /> {t('ipdRunningBillPrint.goBack')}
          </button>
        </div>
      </DashboardLayout>
    );
  }

  if (!data) return null;

  return (
    <DashboardLayout role={layoutRole}>
      <div className="mx-auto space-y-4" style={{ maxWidth: previewWidth }}>
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <Link
            to={billingPath}
            className="flex items-center gap-1 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-primary)]"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> All IP Bills
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Paper size"
              className="input px-2 py-1 text-sm"
              value={paperSize}
              onChange={(event) => {
                const value = event.target.value === 'a4' ? 'a4' : 'a5';
                setPaperSize(value);
                localStorage.setItem('runningBillPaperSize', value);
              }}
            >
              <option value="a5">A5</option>
              <option value="a4">A4</option>
            </select>
            <button type="button" onClick={() => window.print()} className="btn-primary">
              <Printer className="h-4 w-4" /> {t('common:print', { defaultValue: 'Print' })}
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="btn-secondary"
              title="Use the browser's Save as PDF option"
            >
              <Download className="h-4 w-4" /> {t('common:downloadPdf', { defaultValue: 'Save as PDF' })}
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg" dangerouslySetInnerHTML={{ __html: sanitizeRunningBillPreviewHtml(previewHtml) }} />
      </div>
    </DashboardLayout>
  );
}
