import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Download, Printer, TestTube2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import DashboardLayout from '../components/DashboardLayout';
import ConsultationInvoiceBody from '../components/invoice/ConsultationInvoiceBody';
import DiagnosticInvoiceBody from '../components/invoice/DiagnosticInvoiceBody';
import DischargeInvoiceBody from '../components/invoice/DischargeInvoiceBody';
import InvoiceBrandHeader from '../components/invoice/InvoiceBrandHeader';
import InvoiceFooter from '../components/invoice/InvoiceFooter';
import InvoiceTotalsPayment from '../components/invoice/InvoiceTotalsPayment';
import type {
  InvoiceAdmissionInfo,
  InvoiceAppointmentInfo,
  InvoiceHospitalInfo,
  InvoicePatientInfo,
  InvoicePrintItem,
} from '../components/invoice/types';
import { useApiQuery } from '../hooks/useApiQuery';
import { getBillDepositAdjustedAmount, getBillOutstandingAmount, getBillSettledAmount } from '../lib/billAmounts';
import { filterLabTestInvoiceItems, getInvoiceBannerLabel, getInvoiceLayout } from '../lib/print/invoiceCategory';
import { formatInvoiceReferrer } from '../lib/print/invoiceReferrer';
import { buildInvoicePaymentLedger, formatInvoiceLedgerDateTime } from '../lib/print/paymentLedger';
import {
  getInvoicePaperConfig,
  parseInvoicePaperSize,
  type InvoicePaperSize,
} from '../lib/print/invoicePaper';
import { queryKeys } from '../lib/queryKeys';
import { getReceptionLabTestBillPrintPath } from '../lib/receptionBilling';
import { getInvoiceItemDisplayAmount, getInvoiceItemNetAmount, getInvoiceItemOriginalAmount, getInvoiceItemRefundLabel } from '../lib/print/invoiceRefund';

interface BillDetail {
  id: number;
  invoice_no: string;
  invoice_code?: string | null;
  patient_name: string;
  patient_code: string;
  mobile: string;
  address: string;
  age?: string | null;
  gender?: string | null;
  subtotal: number;
  discount: number;
  discount_reason?: string | null;
  discount_by_name?: string | null;
  approved_by_name?: string | null;
  tax_total?: number | null;
  total_amount: number;
  paid_amount: number;
  cash_paid_amount?: number | null;
  deposit_adjusted?: number | null;
  settled_amount?: number | null;
  due?: number;
  outstanding?: number;
  status: string;
  created_at: string;
  created_by: string;
}

interface Payment {
  id: number;
  amount: number;
  type: string;
  receipt_no: string;
  payment_method: string | null;
  received_by_name: string | null;
  date?: string | null;
  created_at: string;
}

interface DepositAdjustment {
  id: number;
  deposit_receipt_no?: string | null;
  amount: number;
  payment_method?: string | null;
  created_at: string;
}

interface DepositAllocation {
  id: string;
  amount: number;
  deposit_receipt_no?: string | null;
  payment_method?: string | null;
  deposited_at?: string | null;
  adjustment_receipt_no?: string | null;
  adjusted_at?: string | null;
}

interface ReferredBy {
  type: string;
  name?: string | null;
  hospitalId: number | null;
  hospitalName: string | null;
  doctorId: number | null;
  doctorName: string | null;
}

interface ReagentInventoryAlert {
  id: number;
  lab_order_item_id?: number | null;
  lab_test_id?: number | null;
  severity?: 'warning' | 'error' | string | null;
  reason?: string | null;
  message: string;
  status?: string | null;
  item_description?: string | null;
  created_at?: string | null;
}

interface BillResponse {
  bill: BillDetail;
  items: InvoicePrintItem[];
  payments: Payment[];
  deposit_adjustments?: DepositAdjustment[];
  deposit_allocations?: DepositAllocation[];
  reagent_inventory_alerts?: ReagentInventoryAlert[];
  visitSerial: number | null;
  referredBy: ReferredBy;
  appointment?: InvoiceAppointmentInfo | null;
  admission?: InvoiceAdmissionInfo | null;
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

function formatDate(date: string, locale = 'en-GB') {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00` : date;
  return new Date(normalized).toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatDateTime(date: string, locale = 'en-GB') {
  const parsed = new Date(date);
  const datePart = parsed.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
  const timePart = parsed.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

function formatAppointmentTime(time: string | null | undefined, locale: string) {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return time;
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

function money(amount: number | null | undefined, locale = 'en-BD') {
  return `৳${Number(amount ?? 0).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function getHospitalName() {
  try {
    const tenant = JSON.parse(localStorage.getItem('tenant') ?? '{}');
    return tenant?.name ?? 'Hospital Management System';
  } catch {
    return 'Hospital Management System';
  }
}

function getPrintStyles(pageRule: string, margin: string) {
  return `
    :root {
      --invoice-navy: #10234a;
      --invoice-teal: #078d87;
      --invoice-teal-dark: #08736f;
      --invoice-teal-soft: #e9f7f6;
      --invoice-line: #cbd9df;
      --invoice-muted: #64748b;
    }

    .invoice-sheet {
      display: flex; flex-direction: column;
      box-sizing: border-box;
      color: var(--invoice-navy);
      font-family: Inter, "Noto Sans Bengali", Arial, sans-serif;
      background: white;
    }
    .invoice-paper-a5 { min-height: 210mm; }
    .invoice-paper-a4 { min-height: 297mm; }
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
      display: inline-block; margin-top: 9px; padding: 6px 18px; border-radius: 999px;
      background: linear-gradient(90deg, var(--invoice-teal), #0aa49c); color: white;
      font-size: 12px; line-height: 1; font-weight: 800; letter-spacing: .03em;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .invoice-header-meta { display: grid; gap: 4px; margin-top: 8px; text-align: left; }
    .invoice-header-meta > div { display: grid; grid-template-columns: 14px 84px 1fr; align-items: center; gap: 6px; font-size: 10px; }
    .invoice-header-meta svg { width: 13px; height: 13px; color: var(--invoice-teal); }
    .invoice-header-meta span { color: var(--invoice-muted); }
    .invoice-header-meta strong { color: var(--invoice-navy); font-weight: 700; }
    .invoice-type-ribbon {
      padding: 7px 28px; background: linear-gradient(90deg, #edfafa, #fff);
      color: var(--invoice-teal-dark); font-size: 11px; font-weight: 800;
      text-align: center; text-transform: uppercase; letter-spacing: .14em;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .invoice-body { padding: 18px 28px 0; }
    .consultation-summary {
      display: grid; grid-template-columns: 1fr 1.18fr; gap: 0;
      margin-bottom: 18px; border-bottom: 1px solid var(--invoice-line);
    }
    .invoice-summary-column { position: relative; min-width: 0; padding: 4px 22px 18px 4px; }
    .invoice-summary-column + .invoice-summary-column { padding-left: 26px; border-left: 1px solid var(--invoice-line); }
    .invoice-section-title { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--invoice-teal-dark); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .03em; }
    .invoice-section-title svg { width: 20px; height: 20px; padding: 4px; border-radius: 50%; background: var(--invoice-teal-soft); }
    .invoice-summary-column h3 { margin: 0 0 10px 30px; font-size: 14px; }
    .invoice-summary-column p { display: flex; align-items: flex-start; gap: 9px; margin: 6px 0; color: #334155; font-size: 10px; line-height: 1.45; }
    .invoice-summary-column p svg { width: 13px; height: 13px; flex: none; color: var(--invoice-teal-dark); }
    .invoice-detail-row { display: grid; grid-template-columns: 43% 57%; gap: 8px; margin: 5px 0; font-size: 10px; line-height: 1.35; }
    .invoice-detail-row span { color: var(--invoice-muted); }
    .invoice-detail-row strong { color: var(--invoice-navy); font-weight: 700; }
    .invoice-token-row { align-items: center; margin-top: 8px; }
    .invoice-token-row strong {
      width: fit-content; min-width: 38px; padding: 4px 13px; border: 1px solid var(--invoice-teal);
      border-radius: 999px; background: var(--invoice-teal-soft); color: var(--invoice-teal-dark);
      font-size: 15px; line-height: 1; text-align: center;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .invoice-summary-watermark { display: none; }
    .diagnostic-meta {
      display: grid; gap: 0; margin-bottom: 12px; border-bottom: 1px solid var(--invoice-line);
    }
    .diagnostic-meta-count-3 { grid-template-columns: minmax(0, 1.65fr) minmax(0, 0.9fr) minmax(0, 1.6fr); }
    .diagnostic-meta-count-4 { grid-template-columns: minmax(0, 1.65fr) minmax(0, 0.92fr) minmax(0, 0.96fr) minmax(0, 1.47fr); }
    .diagnostic-meta-count-5 { grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 2fr) minmax(0, 1fr); }
    .diagnostic-meta > div {
      display: grid; grid-template-columns: 27px 1fr; grid-template-rows: auto auto;
      column-gap: 7px; padding: 3px 12px 8px; border-right: 1px solid var(--invoice-line);
      min-width: 0;
    }
    .diagnostic-meta > div:last-child { border-right: 0; }
    .diagnostic-meta svg { grid-row: 1 / 3; width: 20px; height: 20px; color: var(--invoice-teal-dark); }
    .diagnostic-meta span { color: var(--invoice-muted); font-size: 9px; line-height: 1.15; }
    .diagnostic-meta strong { overflow-wrap: break-word; word-break: normal; font-size: 11px; line-height: 1.18; }
    .diagnostic-patient-value { display: flex; flex-direction: column; gap: 2px; }
    .diagnostic-patient-value > span { color: var(--invoice-navy); font-size: 14px; font-weight: 800; line-height: 1.12; }
    .diagnostic-patient-value small { color: var(--invoice-muted); font-size: 12px; font-weight: 800; line-height: 1.12; }
    .diagnostic-meta > div:nth-child(1) strong,
    .diagnostic-meta > div:nth-child(3) strong { font-size: 13px; line-height: 1.15; }
    .discharge-body { padding-top: 14px; }
    .discharge-meta {
      display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0;
      margin-bottom: 12px; border: 1px solid var(--invoice-line); border-radius: 9px; overflow: hidden;
    }
    .discharge-info-tile {
      display: grid; grid-template-columns: 24px minmax(0, 1fr); grid-template-rows: auto auto;
      gap: 2px 8px; min-height: 55px; padding: 9px 10px;
      border-right: 1px solid var(--invoice-line); border-bottom: 1px solid var(--invoice-line);
    }
    .discharge-info-tile:nth-child(4n) { border-right: 0; }
    .discharge-info-tile:nth-last-child(-n+4) { border-bottom: 0; }
    .discharge-info-tile svg { grid-row: 1 / 3; width: 18px; height: 18px; color: var(--invoice-teal-dark); }
    .discharge-info-tile span { color: var(--invoice-muted); font-size: 8px; line-height: 1.1; text-transform: uppercase; letter-spacing: .04em; }
    .discharge-info-tile strong { overflow-wrap: anywhere; color: var(--invoice-navy); font-size: 10px; line-height: 1.18; }
    .discharge-note {
      display: flex; align-items: center; gap: 9px; width: 52%; min-height: 44px; margin-top: 12px;
      padding: 10px 12px; border: 1px solid var(--invoice-line); border-radius: 8px; color: #475569; font-size: 10px;
    }
    .discharge-note svg { width: 22px; height: 22px; color: var(--invoice-teal-dark); flex: none; }
    .invoice-items-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 11px; }
    .invoice-items-table thead { display: table-header-group; }
    .invoice-items-table th {
      padding: 9px 10px; border: 0; background: linear-gradient(90deg, var(--invoice-teal), #099b94);
      color: white; font-size: 10px; text-align: left; text-transform: uppercase; letter-spacing: .03em;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .invoice-items-table th:first-child { border-radius: 7px 0 0 0; text-align: center; }
    .invoice-items-table th:last-child { border-radius: 0 7px 0 0; text-align: right; }
    .invoice-items-table td { padding: 9px 10px; border: 0; border-bottom: 1px solid #dbe4e8; color: #263755; vertical-align: top; }
    .invoice-items-table td:first-child { text-align: center; color: var(--invoice-muted); }
    .invoice-items-table td:last-child { text-align: right; font-variant-numeric: tabular-nums; }
    .invoice-items-table small { display: block; margin-top: 3px; color: var(--invoice-muted); font-size: 9px; font-weight: 400; }
    .invoice-item-refunded { background: #fff8eb; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .invoice-item-description-refunded { text-decoration: line-through; text-decoration-thickness: 1px; color: #64748b; }
    .invoice-refund-label { width: fit-content; padding: 2px 6px; border-radius: 999px; background: #fef3c7; color: #92400e !important; font-weight: 800 !important; text-decoration: none !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .invoice-original-amount { margin: 0 0 2px auto !important; color: #94a3b8 !important; text-decoration: line-through; }
    .invoice-col-serial { width: 44px; }
    .invoice-col-qty { width: 62px; text-align: center !important; }
    .invoice-col-category { width: 92px; }
    .invoice-col-amount { width: 118px; text-align: right !important; }
    .invoice-totals { width: 52%; margin: 0 0 8px auto; border: 1px solid var(--invoice-line); border-radius: 0 0 7px 7px; overflow: hidden; }
    .invoice-totals > div { display: flex; justify-content: space-between; gap: 20px; padding: 5px 12px; font-size: 9px; }
    .invoice-totals span { color: #475569; }
    .invoice-totals strong { font-variant-numeric: tabular-nums; }
    .invoice-totals .invoice-subtotal-row { font-weight: 800; }
    .invoice-totals .invoice-subrow { padding-top: 5px; padding-bottom: 5px; background: #f8fafc; font-size: 10px; font-weight: 800; }
    .invoice-totals .invoice-grand-total {
      padding-top: 8px; padding-bottom: 8px; background: var(--invoice-teal-soft);
      color: var(--invoice-teal-dark); font-size: 11px; font-weight: 900;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .invoice-totals .invoice-grand-total span { color: inherit; }
    .invoice-totals .invoice-due-total { color: #b42318; font-weight: 800; }
    .invoice-totals .invoice-due-total span { color: inherit; }
    .invoice-financials { padding: 8px 28px 0; }
    .lab-test-only-summary {
      margin: auto 28px 12px; padding: 12px 14px; border: 1px solid var(--invoice-teal);
      border-radius: 8px; background: var(--invoice-teal-soft); color: var(--invoice-navy);
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .lab-test-only-summary > div { display: flex; justify-content: space-between; gap: 16px; font-size: 11px; font-weight: 800; }
    .lab-test-only-summary p { margin: 6px 0 0; color: #475569; font-size: 9px; line-height: 1.35; }
    .invoice-payment-compact {
      display: flex; align-items: center; gap: 18px; min-height: 48px; padding: 10px 14px;
      border: 1px solid var(--invoice-teal); border-radius: 7px; background: var(--invoice-teal-soft);
      font-size: 10px; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .invoice-payment-compact > div { display: flex; align-items: center; gap: 8px; min-width: 0; }
    .invoice-payment-compact span { color: var(--invoice-muted); }
    .invoice-payment-compact strong { color: var(--invoice-navy); font-variant-numeric: tabular-nums; }
    .invoice-payment-compact-status { color: var(--invoice-teal-dark); }
    .invoice-payment-compact-status svg { width: 22px; height: 22px; flex: none; }
    .invoice-payment-compact-status strong { color: inherit; font-size: 15px; line-height: 1; }
    .invoice-payment-compact.is-partial { border-color: #d97706; background: #fff8eb; }
    .invoice-payment-compact.is-partial .invoice-payment-compact-status { color: #b45309; }
    .invoice-payment-compact.is-due { border-color: #dc2626; background: #fff1f1; }
    .invoice-payment-compact.is-due .invoice-payment-compact-status,
    .invoice-payment-compact-due strong { color: #b42318; }
    .invoice-payment-ledger {
      display: grid !important; width: 100%; gap: 7px; align-items: stretch !important;
    }
    .invoice-payment-ledger-header {
      display: flex !important; align-items: center; justify-content: space-between; gap: 10px;
      padding-bottom: 6px; border-bottom: 1px solid var(--invoice-line);
    }
    .invoice-payment-ledger-header > div { display: flex; align-items: center; gap: 7px; }
    .invoice-payment-ledger-header svg { width: 18px; height: 18px; color: var(--invoice-teal-dark); }
    .invoice-payment-ledger-header strong { color: var(--invoice-teal-dark); font-size: 11px; }
    .invoice-payment-ledger-status {
      flex: none; border: 1px solid currentColor; border-radius: 999px; padding: 2px 7px;
      color: var(--invoice-teal-dark) !important; font-size: 8px; font-weight: 900; letter-spacing: .04em;
    }
    .invoice-payment-compact.is-partial .invoice-payment-ledger-status { color: #b45309 !important; }
    .invoice-payment-compact.is-due .invoice-payment-ledger-status { color: #b42318 !important; }
    .invoice-payment-ledger-list { display: grid !important; gap: 4px; width: 100%; }
    .invoice-payment-ledger-row {
      display: grid !important; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 10px;
      padding: 4px 0; border-bottom: 1px dashed #cbd9df;
    }
    .invoice-payment-ledger-description { display: grid !important; gap: 2px; min-width: 0; }
    .invoice-payment-ledger-description > strong { font-size: 9px; }
    .invoice-payment-ledger-description > span { overflow-wrap: anywhere; font-size: 7.5px; line-height: 1.25; }
    .invoice-payment-ledger-amount { white-space: nowrap; font-size: 9px; }
    .invoice-large-identifier { margin-left: auto; color: var(--invoice-teal-dark); }
    .invoice-large-identifier [data-testid="invoice-serial-large"] { margin: 0; font-size: 10px; letter-spacing: .03em; white-space: nowrap; }
    .invoice-footer { margin-top: auto; padding: 11px 28px 14px; border-top: 1px solid var(--invoice-line); }
    .invoice-footer-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .invoice-footer-grid.invoice-footer-pair { grid-template-columns: minmax(0, auto) minmax(0, auto); justify-content: space-between; }
    .invoice-footer-pair > div:last-child { justify-self: end; }
    .invoice-footer-grid > div { display: grid; grid-template-columns: 20px 1fr; grid-template-rows: auto auto; column-gap: 7px; min-width: 0; }
    .invoice-footer-grid svg { grid-row: 1 / 3; width: 17px; height: 17px; color: var(--invoice-teal-dark); }
    .invoice-footer-grid span { color: var(--invoice-teal-dark); font-size: 8px; font-weight: 800; text-transform: uppercase; }
    .invoice-footer-grid strong { overflow-wrap: anywhere; color: #334155; font-size: 9.5px; line-height: 1.3; }
    .invoice-footer-message { margin: 13px -28px -1px; padding: 9px 28px; background: var(--invoice-teal); color: white; text-align: center; font-size: 11px; font-weight: 700; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .invoice-thank-you {
      display: flex; flex-direction: column; align-items: center; gap: 2px;
      margin: 11px -28px -14px; padding: 8px 28px;
      background: linear-gradient(90deg, var(--invoice-teal-dark), #0aa49c); color: white;
      text-align: center; -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .invoice-thank-you strong { font-size: 11px; line-height: 1.25; }
    .invoice-thank-you span { font-size: 8px; line-height: 1.2; opacity: .92; }
    .invoice-generic-meta { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 14px; font-size: 10px; }
    .invoice-generic-meta strong { display: block; font-size: 12px; }
    .invoice-generic-referral { margin-top: 4px; color: var(--invoice-muted); }

    .invoice-layout-consultation .invoice-header-meta > div { font-size: 11px; }
    .invoice-layout-consultation .invoice-header-meta strong { font-size: 11px; }
    .invoice-layout-consultation .invoice-section-title { font-size: 12px; }
    .invoice-layout-consultation .invoice-summary-column h3 { font-size: 15px; }
    .invoice-layout-consultation .invoice-summary-column p { font-size: 11px; }
    .invoice-layout-consultation .invoice-summary-column p svg { width: 15px; height: 15px; }
    .invoice-layout-consultation .invoice-detail-row { font-size: 11px; }
    .invoice-layout-consultation .invoice-totals > div { font-size: 10px; }
    .invoice-layout-consultation .invoice-totals .invoice-grand-total { font-size: 13px; }
    .invoice-layout-consultation .invoice-payment-compact { font-size: 10px; }
    .invoice-layout-consultation .invoice-payment-compact-status strong { font-size: 16px; }
    .invoice-layout-consultation .invoice-large-identifier [data-testid="invoice-serial-large"] { font-size: 11px; }

    .invoice-layout-diagnostic .invoice-body { padding-top: 10px; }
    .invoice-layout-diagnostic .invoice-financials {
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 52%);
      grid-template-areas: "payment totals";
      align-items: end; gap: 16px; margin-top: auto; padding-top: 12px;
    }
    .invoice-layout-diagnostic .invoice-payment-compact { grid-area: payment; justify-self: start; min-height: 0; max-width: 100%; flex-wrap: wrap; }
    .invoice-layout-diagnostic .invoice-totals { grid-area: totals; width: 100%; margin: 0; }
    .invoice-layout-diagnostic .invoice-large-identifier { display: none; }
    .invoice-layout-diagnostic .invoice-footer { margin-top: 0; }
    .invoice-layout-discharge .invoice-financials {
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(250px, 52%);
      grid-template-areas: "payment totals";
      align-items: end; gap: 18px; margin-top: auto; padding-top: 12px;
    }
    .invoice-layout-discharge .invoice-payment-compact { grid-area: payment; justify-self: stretch; min-height: 72px; }
    .invoice-layout-discharge .invoice-payment-compact-status strong { font-size: 20px; }
    .invoice-layout-discharge .invoice-payment-compact-status svg { width: 28px; height: 28px; }
    .invoice-layout-discharge .invoice-totals { grid-area: totals; width: 100%; margin: 0; border-radius: 7px; }
    .invoice-layout-discharge .invoice-large-identifier { display: none; }
    .invoice-layout-discharge .invoice-footer { margin-top: 0; }

    .invoice-layout-discharge.invoice-paper-a5 .invoice-brand-header { padding: 10px 20px 8px; gap: 12px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-brand-logo { width: 42px; height: 42px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-brand-identity { gap: 10px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-brand-identity h1 { font-size: 13px; line-height: 1.05; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-title { font-size: 16px; letter-spacing: .035em; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-number-pill { margin-top: 5px; padding: 4px 14px; font-size: 10px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-header-meta { gap: 2px; margin-top: 5px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-header-meta > div { grid-template-columns: 12px 70px 1fr; gap: 5px; font-size: 8px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-header-meta svg { width: 11px; height: 11px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-type-ribbon { padding: 5px 20px; font-size: 9px; letter-spacing: .12em; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-body { padding: 10px 20px 0; }
    .invoice-layout-discharge.invoice-paper-a5 .discharge-body { padding-top: 9px; }
    .invoice-layout-discharge.invoice-paper-a5 .discharge-meta { margin-bottom: 8px; border-radius: 7px; }
    .invoice-layout-discharge.invoice-paper-a5 .discharge-info-tile {
      grid-template-columns: 18px minmax(0, 1fr); gap: 1px 6px; min-height: 42px; padding: 6px 7px;
    }
    .invoice-layout-discharge.invoice-paper-a5 .discharge-info-tile svg { width: 14px; height: 14px; }
    .invoice-layout-discharge.invoice-paper-a5 .discharge-info-tile span { font-size: 6.8px; letter-spacing: .03em; }
    .invoice-layout-discharge.invoice-paper-a5 .discharge-info-tile strong { font-size: 8.4px; line-height: 1.1; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-items-table { font-size: 9.5px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-items-table th { padding: 5px 7px; font-size: 8px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-items-table td { padding: 5px 7px; line-height: 1.2; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-items-table small { margin-top: 1px; font-size: 7.5px; line-height: 1.15; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-col-serial { width: 32px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-col-qty { width: 42px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-col-amount { width: 82px; }
    .invoice-layout-discharge.invoice-paper-a5 .discharge-note {
      gap: 7px; width: 50%; min-height: 32px; margin-top: 8px; padding: 6px 8px; border-radius: 6px; font-size: 8.5px; line-height: 1.28;
    }
    .invoice-layout-discharge.invoice-paper-a5 .discharge-note svg { width: 16px; height: 16px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-financials {
      grid-template-columns: minmax(0, 1fr) minmax(210px, 50%); gap: 10px; margin-top: auto; padding: 7px 20px 0;
    }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-compact { min-height: 46px; padding: 7px 10px; gap: 10px; font-size: 8.5px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-compact-status strong { font-size: 15px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-compact-status svg { width: 20px; height: 20px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger { gap: 4px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-header { padding-bottom: 4px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-header svg { width: 14px; height: 14px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-header strong { font-size: 9px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-row { gap: 6px; padding: 2px 0; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-description > strong,
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-amount { font-size: 7.5px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-payment-ledger-description > span { font-size: 6.5px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-totals > div { padding: 3px 9px; font-size: 8px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-totals .invoice-subrow { padding-top: 3px; padding-bottom: 3px; font-size: 8.5px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-totals .invoice-grand-total { padding-top: 5px; padding-bottom: 5px; font-size: 9.5px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-footer { padding: 6px 20px 8px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-footer-grid { gap: 7px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-footer-grid > div { grid-template-columns: 14px 1fr; column-gap: 5px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-footer-grid svg { width: 13px; height: 13px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-footer-grid strong { font-size: 8px; line-height: 1.18; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-thank-you { margin: 6px -20px -8px; padding: 5px 20px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-thank-you strong { font-size: 9.5px; }
    .invoice-layout-discharge.invoice-paper-a5 .invoice-thank-you span { font-size: 7px; }
    .invoice-layout-generic + .invoice-financials {
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 52%);
      grid-template-areas: "payment totals";
      align-items: end; gap: 16px; margin-top: auto; padding-top: 12px;
    }
    .invoice-layout-generic + .invoice-financials .invoice-payment-compact { grid-area: payment; justify-self: start; min-height: 0; max-width: 100%; flex-wrap: wrap; }
    .invoice-layout-generic + .invoice-financials .invoice-totals { grid-area: totals; width: 100%; margin: 0; }
    .invoice-layout-generic + .invoice-financials .invoice-large-identifier { display: none; }
    .invoice-layout-generic .invoice-footer { margin-top: 0; }

    .invoice-paper-a4 .invoice-brand-header { padding: 24px 40px 18px; }
    .invoice-paper-a4 .invoice-brand-logo { width: 68px; height: 68px; }
    .invoice-paper-a4 .invoice-brand-identity h1 { font-size: 22px; }
    .invoice-paper-a4 .invoice-title { font-size: 24px; }
    .invoice-paper-a4 .invoice-body, .invoice-paper-a4 .invoice-financials { padding-left: 40px; padding-right: 40px; }
    .invoice-paper-a4 .invoice-footer { padding-left: 40px; padding-right: 40px; }

    @page { size: ${pageRule}; margin: ${margin}; }
    @media print {
      aside, header:not(.invoice-brand-header), nav, .no-print { display: none !important; }
      html, body, .invoice-sheet {
        background: white !important;
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
      main { margin: 0 !important; padding: 0 !important; width: 100% !important; max-width: 100% !important; overflow: visible !important; }
      .flex.h-screen { display: block !important; overflow: visible !important; }
      .invoice-print-shell {
        width: 100% !important; max-width: none !important;
        margin: 0 !important; padding: 0 !important;
      }
      .invoice-print-shell > .invoice-sheet { margin-top: 0 !important; }
      .invoice-brand-header { display: flex !important; }
      .invoice-sheet {
        width: 100% !important; max-width: none !important;
        min-height: 0; height: auto !important; overflow: visible !important;
        margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important;
      }
      .invoice-paper-a5 { min-height: 210mm !important; }
      .invoice-layout-discharge.invoice-paper-a5 .invoice-footer {
        margin-top: 0 !important;
        break-inside: auto !important;
        page-break-inside: auto !important;
      }
      .invoice-paper-a4 { min-height: 297mm !important; }
      thead { display: table-header-group; }
      tr, .invoice-keep-together { break-inside: avoid; page-break-inside: avoid; }
      .invoice-items-table { break-inside: auto; }
      .invoice-financials { break-inside: auto !important; page-break-inside: auto !important; }
      .invoice-layout-diagnostic .invoice-financials { break-inside: avoid !important; page-break-inside: avoid !important; }
      .invoice-payment-compact { break-inside: avoid; page-break-inside: avoid; }
      .invoice-payment-compact.has-ledger { break-inside: auto; page-break-inside: auto; }
      .invoice-payment-ledger-row { break-inside: avoid; page-break-inside: avoid; }
      .invoice-brand-header, .invoice-type-ribbon, .invoice-items-table th,
      .invoice-grand-total, .invoice-payment-compact, .invoice-footer-message {
        -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important;
      }
    }

    @media screen and (max-width: 720px) {
      .invoice-brand-header { padding: 18px; gap: 12px; }
      .invoice-brand-logo { width: 48px; height: 48px; }
      .invoice-brand-identity h1 { font-size: 15px; }
      .invoice-title { font-size: 18px; }
      .invoice-header-meta { display: none; }
      .consultation-summary { grid-template-columns: 1fr; }
      .invoice-summary-column + .invoice-summary-column { padding-left: 4px; border-left: 0; border-top: 1px solid var(--invoice-line); padding-top: 16px; }
      .diagnostic-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .discharge-meta { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .discharge-info-tile:nth-child(4n) { border-right: 1px solid var(--invoice-line); }
      .discharge-info-tile:nth-child(2n) { border-right: 0; }
      .discharge-note { width: 100%; }
      .invoice-layout-diagnostic .invoice-financials,
      .invoice-layout-discharge .invoice-financials,
      .invoice-layout-generic + .invoice-financials { grid-template-columns: 1fr; grid-template-areas: "totals" "payment"; }
      .invoice-footer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .invoice-totals { width: 100%; }
      .invoice-payment-compact { flex-wrap: wrap; gap: 8px 14px; }
      .invoice-large-identifier { margin-left: 0; }
    }
  `;
}

export default function BillPrint({
  role = 'hospital_admin',
  scope = 'full',
}: {
  role?: string;
  scope?: 'full' | 'lab';
}) {
  const isLabTestOnly = scope === 'lab';
  const { t, i18n } = useTranslation(['billing', 'common']);
  const [printLang, setPrintLang] = useState<'en' | 'bn'>(() => {
    const saved = localStorage.getItem('billPrintLang');
    if (saved === 'bn' || saved === 'en') return saved;
    return i18n.language === 'bn' ? 'bn' : 'en';
  });
  const [paperSize, setPaperSize] = useState<InvoicePaperSize>(() =>
    parseInvoicePaperSize(localStorage.getItem('billPrintPaperSize')),
  );
  const currentLocale = printLang === 'bn' ? 'bn-BD' : 'en-GB';
  const l = (english: string, bengali: string) => printLang === 'bn' ? bengali : english;
  const pt = (key: string, opts?: Record<string, unknown>) =>
    t(key, { ...opts, lng: printLang === 'bn' ? 'bn' : 'en' });

  const { slug = '', billId = '' } = useParams<{ slug: string; billId: string }>();
  const navigate = useNavigate();
  const basePath = `/h/${slug}`;
  const billingPath = role === 'hospital_admin'
    ? `${basePath}/billing`
    : `${basePath}/reception/billing`;
  const fullInvoicePrintPath = role === 'hospital_admin'
    ? `${basePath}/billing/${billId}/print`
    : `${basePath}/reception/billing/${billId}/print`;
  const labTestPrintPath = role === 'hospital_admin'
    ? `${basePath}/billing/${billId}/lab-print`
    : getReceptionLabTestBillPrintPath(basePath, billId);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const invoiceRef = useRef<HTMLElement>(null);

  const { data: billData, isLoading } = useApiQuery<BillResponse>(
    queryKeys.billPrint.detail(billId),
    `/api/billing/${billId}`,
    { enabled: Boolean(billId) },
  );
  const { data: settingsData } = useApiQuery<SettingsResponse>(
    queryKeys.settings.all,
    '/api/settings',
  );

  useEffect(() => {
    setLogoUrl(settingsData?.settings?.hospital_logo_url ?? null);
  }, [settingsData]);

  const bill = billData?.bill ?? null;
  const allItems = billData?.items ?? [];
  const items = isLabTestOnly ? filterLabTestInvoiceItems(allItems) : allItems;
  const labTestItems = filterLabTestInvoiceItems(allItems);
  const payments = billData?.payments ?? [];
  const depositAdjustments = billData?.deposit_adjustments ?? [];
  const depositAllocations = billData?.deposit_allocations ?? [];
  const reagentInventoryAlerts = billData?.reagent_inventory_alerts ?? [];
  const visitSerial = billData?.visitSerial ?? null;
  const referredBy = billData?.referredBy ?? null;
  const appointment = billData?.appointment ?? null;
  const admission = billData?.admission ?? null;
  const paperConfig = getInvoicePaperConfig(paperSize);

  if (isLoading) {
    return (
      <DashboardLayout role={role}>
        <div className="mx-auto max-w-[210mm] space-y-4">
          <div className="skeleton h-8 w-48 rounded-lg" />
          <div className="skeleton h-80 w-full rounded-xl" />
        </div>
      </DashboardLayout>
    );
  }

  if (!bill) {
    return (
      <DashboardLayout role={role}>
        <div className="card mx-auto max-w-md p-12 text-center">
          <p className="text-[var(--color-text-muted)]">
            {t('billNotFound', { ns: 'billing', defaultValue: 'Bill not found.' })}
          </p>
          <button onClick={() => navigate(-1)} className="btn-primary mt-4">
            {t('common:back', { defaultValue: 'Go Back' })}
          </button>
        </div>
      </DashboardLayout>
    );
  }

  if (isLabTestOnly && items.length === 0) {
    return (
      <DashboardLayout role={role}>
        <div className="card mx-auto max-w-md p-12 text-center">
          <TestTube2 className="mx-auto h-10 w-10 text-[var(--color-text-muted)]" />
          <h1 className="mt-4 text-lg font-bold text-[var(--color-text)]">
            {l('No lab/test items found', 'কোনো ল্যাব/টেস্ট আইটেম পাওয়া যায়নি')}
          </h1>
          <p className="mt-2 text-sm text-[var(--color-text-muted)]">
            {l('This invoice does not contain a laboratory, pathology, or test charge.', 'এই ইনভয়েসে ল্যাবরেটরি, প্যাথলজি বা টেস্ট চার্জ নেই।')}
          </p>
          <Link to={fullInvoicePrintPath} className="btn-primary mt-4">
            {l('Open Full Invoice', 'সম্পূর্ণ ইনভয়েস খুলুন')}
          </Link>
        </div>
      </DashboardLayout>
    );
  }

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
    logoUrl,
  };
  const patient: InvoicePatientInfo = {
    name: bill.patient_name,
    code: bill.patient_code,
    mobile: bill.mobile,
    address: bill.address,
    age: bill.age,
    gender: bill.gender,
  };
  const fetchedDepositAdjusted = depositAdjustments.reduce(
    (sum, entry) => sum + Number(entry.amount ?? 0),
    0,
  );
  const depositAdjusted = Math.max(getBillDepositAdjustedAmount(bill), fetchedDepositAdjusted);
  const billForAmounts = { ...bill, deposit_adjusted: depositAdjusted };
  const settledAmount = getBillSettledAmount(billForAmounts);
  const outstanding = getBillOutstandingAmount(billForAmounts);
  const itemSubtotal = items.reduce((sum, item) => sum + getInvoiceItemNetAmount(item), 0);
  const computedSubtotal = isLabTestOnly
    ? itemSubtotal
    : Number(bill.subtotal ?? 0) || itemSubtotal;
  const primaryPayment = payments[0];
  const paymentMethodLabel = primaryPayment?.payment_method
    ? t(`payMethod_${primaryPayment.payment_method}`, {
        defaultValue: primaryPayment.payment_method,
        lng: printLang,
      })
    : null;
  const referredByLabel = formatInvoiceReferrer(referredBy, {
    self: l('Self', 'নিজে'),
    doctor: l('Doctor', 'ডাক্তার'),
    hospital: l('Hospital', 'হাসপাতাল'),
    other: l('Other', 'অন্যান্য'),
  });
  const displayAppointment = appointment
    ? {
        ...appointment,
        time: formatAppointmentTime(appointment.time, currentLocale),
      }
    : null;
  const isDischargeBill = Boolean(admission?.discharge_date || admission?.status === 'discharged');
  const invoiceLayout = isLabTestOnly
    ? 'diagnostic'
    : isDischargeBill
      ? 'discharge'
      : getInvoiceLayout(items);
  const isFullySettled = outstanding <= 0
    && (bill.status === 'paid' || settledAmount >= Number(bill.total_amount ?? 0));
  const dischargePaymentLedger = invoiceLayout === 'discharge'
    ? buildInvoicePaymentLedger({
        payments,
        depositAllocations,
        isFullySettled,
      })
    : undefined;
  const localizedDischargePaymentLedger = dischargePaymentLedger?.map((entry) => ({
    ...entry,
    paymentMethod: entry.paymentMethod
      ? t(`payMethod_${entry.paymentMethod}`, {
          defaultValue: entry.paymentMethod,
          lng: printLang,
        })
      : null,
  }));
  const largeSerialLabel = bill?.invoice_no;
  const invoiceBannerLabel = isLabTestOnly
    ? l('LABORATORY TEST COPY', 'ল্যাবরেটরি টেস্ট কপি')
    : isDischargeBill
      ? l('DISCHARGE + INVOICE', 'ছাড়পত্র + ইনভয়েস')
      : getInvoiceBannerLabel(items, printLang);
  const formatMoney = (amount: number) => money(amount, currentLocale);
  const formatLocalizedDate = (date: string) => formatDate(date, currentLocale);
  const formatLocalizedDateTime = (date: string) => formatDateTime(date, currentLocale);
  const formatLocalizedLedgerDateTime = (date: string) => formatInvoiceLedgerDateTime(date, currentLocale);
  const printInvoice = () => {
    const invoice = invoiceRef.current;
    if (!invoice) return;

    const printFrame = document.createElement('iframe');
    printFrame.setAttribute('title', 'Invoice print frame');
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

    const cleanup = () => {
      setTimeout(() => printFrame.remove(), 500);
    };
    const styles = getPrintStyles(paperConfig.pageRule, paperConfig.margin);
    printDocument.open();
    printDocument.write(`<!doctype html>
      <html lang="${printLang}">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>${bill.invoice_no}</title>
          <style>
            * { box-sizing: border-box; }
            html, body { margin: 0; padding: 0; background: white; }
            body { color: #10234a; font-family: Inter, "Noto Sans Bengali", Arial, sans-serif; }
            main { width: 100%; margin: 0; padding: 0; overflow: visible; }
            ${styles}
          </style>
        </head>
        <body>
          <main>${invoice.outerHTML}</main>
        </body>
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

  const renderGenericInvoiceTable = (): ReactNode => (
    <div className="invoice-body invoice-layout-generic">
      <div className="invoice-generic-meta">
        <div>
          <span>{l('Bill To', 'বিল প্রাপক')}</span>
          <strong>{bill.patient_name}</strong>
          <small>{[bill.patient_code, bill.mobile].filter(Boolean).join(' · ')}</small>
          {referredBy && referredBy.type !== 'self' && (
            <p className="invoice-generic-referral" data-testid="referred-by">
              {l('Referred by', 'রেফার করেছেন')}: {' '}
              {referredBy.type === 'hospital' && referredBy.hospitalName && (
                <span>{referredBy.hospitalName}</span>
              )}
              {referredBy.type === 'doctor' && referredBy.doctorName && (
                <span>Dr. {referredBy.doctorName}</span>
              )}
            </p>
          )}
        </div>
        <div>
          <span>{l('Date', 'তারিখ')}</span>
          <strong>{formatLocalizedDateTime(bill.created_at)}</strong>
        </div>
      </div>
      <table className="invoice-items-table">
        <thead>
          <tr>
            <th className="invoice-col-serial">SL.</th>
            <th>{l('Description', 'বিবরণ')}</th>
            <th className="invoice-col-qty">{l('Qty', 'পরিমাণ')}</th>
            <th className="invoice-col-amount">{l('Amount', 'মূল্য')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const originalAmount = getInvoiceItemOriginalAmount(item);
            const netAmount = getInvoiceItemDisplayAmount(item);
            const refundLabel = getInvoiceItemRefundLabel(item, {
              requested: l('Refund requested', 'রিফান্ড অনুরোধ করা হয়েছে'),
              pendingApproval: l('Refunded — approval pending', 'রিফান্ড হয়েছে — অনুমোদন অপেক্ষমাণ'),
              refunded: l('Refunded', 'রিফান্ড হয়েছে'),
            });
            return (
              <tr key={item.id} className={refundLabel ? 'invoice-item-refunded' : undefined}>
                <td>{index + 1}</td>
                <td>
                  <strong className={refundLabel ? 'invoice-item-description-refunded' : undefined}>{item.description || item.item_category}</strong>
                  {refundLabel ? <small className="invoice-refund-label">{refundLabel}</small> : null}
                </td>
                <td>{item.quantity}</td>
                <td>
                  {netAmount < originalAmount ? <small className="invoice-original-amount">{formatMoney(originalAmount)}</small> : null}
                  <strong>{formatMoney(netAmount)}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <DashboardLayout role={role}>
      <style>{getPrintStyles(paperConfig.pageRule, paperConfig.margin)}</style>

      <div className="invoice-print-shell mx-auto space-y-4" style={{ maxWidth: paperConfig.previewWidth }}>
        <div className="no-print rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to={billingPath}
                className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-slate-200 bg-white text-[var(--color-text-muted)] shadow-sm transition hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] dark:border-slate-700 dark:bg-slate-800"
                title={t('allBills')}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">{t('allBills')}</span>
              </Link>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--color-text-muted)]">
                  {l('Print preview', 'প্রিন্ট প্রিভিউ')}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
                  <span className="truncate">{bill.invoice_no}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {invoiceBannerLabel}
                  </span>
                  <span className="text-xs font-medium text-[var(--color-text-muted)]">
                    {formatLocalizedDateTime(bill.created_at)}
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
                    localStorage.setItem('billPrintPaperSize', value);
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
                    localStorage.setItem('billPrintLang', value);
                  }}
                >
                  <option value="en">English</option>
                  <option value="bn">বাংলা</option>
                </select>
              </label>
              {isLabTestOnly ? (
                <Link to={fullInvoicePrintPath} className="btn-secondary h-10 justify-center px-4">
                  {l('Full Invoice', 'সম্পূর্ণ ইনভয়েস')}
                </Link>
              ) : labTestItems.length > 0 ? (
                <Link to={labTestPrintPath} className="btn-secondary h-10 justify-center px-4">
                  <TestTube2 className="h-4 w-4" /> {l('Lab/Test Only', 'শুধু ল্যাব/টেস্ট')}
                </Link>
              ) : null}
              <button onClick={printInvoice} className="btn-primary h-10 justify-center px-4 shadow-sm">
                <Printer className="h-4 w-4" /> {t('common:print', { defaultValue: 'Print Invoice' })}
              </button>
              <button
                onClick={printInvoice}
                className="btn-secondary h-10 justify-center px-4"
                title={l("Use the browser's Save as PDF option", 'ব্রাউজারের Save as PDF অপশন ব্যবহার করুন')}
              >
                <Download className="h-4 w-4" /> {t('common:downloadPdf', { defaultValue: 'Save as PDF' })}
              </button>
            </div>
          </div>
          <p className="mt-2 text-xs text-[var(--color-text-muted)]">
            {l('Use Print for paper copy. Use Save as PDF from the browser print dialog for digital copy.', 'কাগজে প্রিন্টের জন্য Print ব্যবহার করুন। ডিজিটাল কপির জন্য ব্রাউজারের print dialog থেকে Save as PDF ব্যবহার করুন।')}
          </p>
        </div>

        {reagentInventoryAlerts.length > 0 && (
          <div data-testid="reagent-inventory-alerts" className="no-print rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <div className="font-semibold">Internal lab inventory alert</div>
            <ul className="mt-1 list-disc pl-5 space-y-1">
              {reagentInventoryAlerts.map((alert) => (
                <li key={alert.id}>
                  <span className="font-medium">{alert.item_description ?? 'Lab item'}</span>: {alert.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        <article
          ref={invoiceRef}
          className={`invoice-sheet invoice-paper-${paperSize} invoice-layout-${invoiceLayout} overflow-hidden rounded-xl border border-slate-200 shadow-lg`}
        >
          <InvoiceBrandHeader
            hospital={hospital}
            invoiceNo={bill.invoice_no}
            issueDate={formatLocalizedDateTime(bill.created_at)}
            appointmentNumber={invoiceLayout === 'consultation' ? appointment?.number : null}
            labels={{
              invoice: isLabTestOnly
                ? l('LAB / TEST COPY', 'ল্যাব / টেস্ট কপি')
                : isDischargeBill
                  ? l('DISCHARGE BILL', 'ছাড়পত্র বিল')
                  : l('INVOICE', 'ইনভয়েস'),
              issueDate: l('Issue Date', 'ইস্যুর তারিখ'),
              appointmentId: l('Appointment ID', 'অ্যাপয়েন্টমেন্ট আইডি'),
            }}
          />

          <div className="invoice-type-ribbon">{invoiceBannerLabel}</div>

          {invoiceLayout === 'consultation' && (
            <ConsultationInvoiceBody
              patient={patient}
              appointment={displayAppointment}
              visitSerial={visitSerial}
              items={items}
              money={formatMoney}
              formatDate={formatLocalizedDate}
              labels={{
                billTo: l('Bill To', 'বিল প্রাপক'),
                appointmentDetails: l('Appointment Details', 'অ্যাপয়েন্টমেন্টের তথ্য'),
                followUp: l('Follow-up', 'ফলো-আপ'),
                patientId: l('Patient ID', 'রোগীর আইডি'),
                ageGender: l('Age / Gender', 'বয়স / লিঙ্গ'),
                doctor: l('Doctor', 'ডাক্তার'),
                specialty: l('Specialty', 'বিশেষত্ব'),
                department: l('Department', 'বিভাগ'),
                appointmentDate: l('Appointment Date', 'অ্যাপয়েন্টমেন্টের তারিখ'),
                appointmentTime: l('Appointment Time', 'অ্যাপয়েন্টমেন্টের সময়'),
                token: l('Serial No.', 'সিরিয়াল নং'),
                description: l('Description', 'বিবরণ'),
                quantity: l('Qty', 'পরিমাণ'),
                amount: l('Amount (BDT)', 'মূল্য'),
                refundRequested: l('Refund requested', 'রিফান্ড অনুরোধ করা হয়েছে'),
                refundedPendingApproval: l('Refunded — approval pending', 'রিফান্ড হয়েছে — অনুমোদন অপেক্ষমাণ'),
                refunded: l('Refunded', 'রিফান্ড হয়েছে'),
              }}
            />
          )}

          {invoiceLayout === 'diagnostic' && (
            <DiagnosticInvoiceBody
              patient={patient}
              referredBy={referredByLabel}
              items={items}
              money={formatMoney}
              labels={{
                patient: l('Patient', 'রোগী'),
                patientId: l('Patient ID', 'রোগীর আইডি'),
                ageGender: l('Age / Gender', 'বয়স / লিঙ্গ'),
                referredBy: l('Referred By', 'রেফার করেছেন'),
                self: l('Self', 'নিজে'),
                testName: l('Test Name', 'টেস্টের নাম'),
                category: l('Category', 'ক্যাটাগরি'),
                amount: l('Amount (BDT)', 'মূল্য'),
                refundRequested: l('Refund requested', 'রিফান্ড অনুরোধ করা হয়েছে'),
                refundedPendingApproval: l('Refunded — approval pending', 'রিফান্ড হয়েছে — অনুমোদন অপেক্ষমাণ'),
                refunded: l('Refunded', 'রিফান্ড হয়েছে'),
              }}
            />
          )}

          {invoiceLayout === 'discharge' && (
            <DischargeInvoiceBody
              patient={patient}
              admission={admission}
              items={items}
              money={formatMoney}
              formatDateTime={formatLocalizedDateTime}
              labels={{
                patientName: l('Patient Name', 'রোগীর নাম'),
                patientId: l('Patient ID', 'রোগীর আইডি'),
                phone: l('Phone', 'ফোন'),
                ageGender: l('Age / Gender', 'বয়স / লিঙ্গ'),
                wardCabin: l('Ward / Cabin', 'ওয়ার্ড / কেবিন'),
                bedNo: l('Bed No', 'বেড নং'),
                consultant: l('Consultant', 'কনসালট্যান্ট'),
                diagnosis: l('Diagnosis', 'রোগ নির্ণয়'),
                admissionDate: l('Admission Date', 'ভর্তির তারিখ'),
                dischargeDate: l('Discharge Date', 'ছাড়পত্রের তারিখ'),
                stayDuration: l('Stay Duration', 'থাকার সময়কাল'),
                description: l('Description', 'বিবরণ'),
                quantity: l('Qty', 'পরিমাণ'),
                rate: l('Rate', 'রেট'),
                amount: l('Amount', 'মূল্য'),
                days: l('Days', 'দিন'),
                note: l('Patient discharged in stable condition. Please follow prescribed medication and review schedule.', 'রোগী স্থিতিশীল অবস্থায় ছাড়পত্র পেয়েছেন। প্রেসক্রাইব করা ওষুধ ও রিভিউ সময়সূচি অনুসরণ করুন।'),
                refundRequested: l('Refund requested', 'রিফান্ড অনুরোধ করা হয়েছে'),
                refundedPendingApproval: l('Refunded — approval pending', 'রিফান্ড হয়েছে — অনুমোদন অপেক্ষমাণ'),
                refunded: l('Refunded', 'রিফান্ড হয়েছে'),
              }}
            />
          )}

          {invoiceLayout === 'generic' && renderGenericInvoiceTable()}

          {isLabTestOnly ? (
            <div className="lab-test-only-summary" data-testid="lab-test-only-summary">
              <div>
                <span>{l('Lab/Test Subtotal', 'ল্যাব/টেস্ট মোট')}</span>
                <strong>{formatMoney(computedSubtotal)}</strong>
              </div>
              <p>
                {l(
                  `Payment status remains governed by the full invoice ${bill.invoice_no}. This service copy does not allocate full-invoice discounts, deposits, payments, or due amounts to individual test lines.`,
                  `পেমেন্ট স্ট্যাটাস সম্পূর্ণ ইনভয়েস ${bill.invoice_no} অনুযায়ী পরিচালিত হবে। এই সার্ভিস কপিতে সম্পূর্ণ ইনভয়েসের ডিসকাউন্ট, ডিপোজিট, পেমেন্ট বা বকেয়া আলাদা টেস্ট লাইনে ভাগ করা হয়নি।`,
                )}
              </p>
            </div>
          ) : (
            <InvoiceTotalsPayment
              identifier={(
                <p className="font-mono font-bold" data-testid="invoice-serial-large">
                  {largeSerialLabel}
                </p>
              )}
              subtotal={computedSubtotal}
              discount={Number(bill.discount ?? 0)}
              discountReason={bill.discount_reason}
              discountByName={bill.discount_by_name}
              approvedByName={bill.approved_by_name}
              tax={Number(bill.tax_total ?? 0)}
              total={Number(bill.total_amount ?? 0)}
              paid={settledAmount}
              depositAdjusted={depositAdjusted}
              outstanding={outstanding}
              status={bill.status}
              money={formatMoney}
              paymentMethodLabel={paymentMethodLabel}
              paymentLedger={localizedDischargePaymentLedger}
              formatLedgerDateTime={formatLocalizedLedgerDateTime}
              labels={{
                paymentMethod: l('Payment Method', 'পেমেন্ট পদ্ধতি'),
                subtotal: pt('subtotal', { defaultValue: 'Subtotal' }),
                discount: pt('discount', { defaultValue: 'Discount' }),
                discountReason: l('Reason', 'কারণ'),
                discountReference: l('Reference', 'রেফারেন্স'),
                approvedBy: l('Approved By', 'অনুমোদন করেছেন'),
                tax: pt('tax', { defaultValue: 'Tax' }),
                totalAmount: l('Total Amount', 'মোট পরিমাণ'),
                paid: pt('paid', { defaultValue: 'Paid' }),
                depositAdjusted: l('Deposit Adjusted', 'ডিপোজিট সমন্বয়'),
                due: pt('due', { defaultValue: 'Due' }),
                paidStatus: l('PAID', 'পরিশোধিত'),
                partialStatus: l('PARTIAL', 'আংশিক'),
                unpaidStatus: l('UNPAID', 'অপরিশোধিত'),
                unpaidAmount: l('Unpaid', 'বাকি'),
                paymentHistory: l('Payment Ledger', 'পেমেন্ট লেজার'),
                paymentReceived: l('Payment Received', 'পেমেন্ট জমা'),
                dischargeSettlement: l('Final Payment', 'চূড়ান্ত পেমেন্ট'),
                ledgerDepositAdjusted: l('Deposit Received', 'ডিপোজিট জমা'),
                receipt: l('Receipt', 'রসিদ'),
              }}
            />
          )}

          <InvoiceFooter
            hospital={hospital}
            labels={{
              hotline: l('Hotline', 'হটলাইন'),
              address: l('Address', 'ঠিকানা'),
              website: l('Website', 'ওয়েবসাইট'),
              email: l('Email', 'ইমেইল'),
              registration: l('Registration', 'রেজিস্ট্রেশন'),
              binTin: l('BIN / TIN', 'বিন / টিন'),
              thankYou: l('Thank you for choosing', 'আমাদের সেবা বেছে নেওয়ার জন্য ধন্যবাদ'),
            }}
          />
        </article>
      </div>
    </DashboardLayout>
  );
}
