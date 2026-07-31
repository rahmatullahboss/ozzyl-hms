import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  TrendingUp, TrendingDown, DollarSign, Calendar,
  Download, RefreshCw, Receipt, Wallet, CreditCard,
  Search, Printer, FileText,
} from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import KPICard from '../components/dashboard/KPICard';
import { useTranslation } from 'react-i18next';
import { useApiMutation, useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { getTodayGMT6 } from '../lib/date-utils';
import ReceptionTopBar from '../components/reception/ReceptionTopBar';

interface CollectionSummary {
  total_cash_sales: number;
  total_sales_return: number;
  total_deposit_deduct: number;
  total_deposit_return: number;
  total_collection_from_receivable: number;
  total_cash_discount_given: number;
  net_collection: number;
}

interface FinanceSummary {
  total_received: number;
  cash_received: number;
  current_collection: number;
  due_collection: number;
  total_returns: number;
  total_discounts: number;
  net_collection: number;
}

interface ServiceSummary {
  total_patients_seen: number;
  doctor_visit_count: number;
  doctor_visit_amount: number;
  test_count: number;
  test_amount: number;
}

interface ReportDeliverySummary {
  total_orders: number;
  ready_orders: number;
  pending_orders: number;
  total_tests: number;
  ready_tests: number;
  delivered_tests: number;
}

interface DoctorSummary {
  doctor_id: number;
  doctor_name: string;
  patient_count: number;
  doctor_visit_count: number;
  doctor_visit_amount: number;
  test_count: number;
  test_order_count: number;
  test_collection_amount: number;
  test_commission_amount: number;
  test_commission_percent?: number | null;
  commission_amount: number;
}

interface DoctorTestInvoiceRow {
  doctor_id: number;
  doctor_name: string;
  bill_id: number;
  invoice_no: string | null;
  invoice_date: string | null;
  patient_name: string | null;
  patient_code: string | null;
  patient_mobile: string | null;
  reference_name: string | null;
  test_names: string | null;
  test_count: number;
  gross_amount: number;
  discount_amount: number;
  test_collection_amount: number;
  paid_amount: number;
  due_amount: number;
  test_commission_amount: number;
  test_commission_percent?: number | null;
}

interface PaymentMethodRow {
  payment_method: string;
  transaction_count: number;
  gross_amount?: number;
  net_amount?: number;
  total_amount: number;
}

interface CollectionDetail {
  id: number;
  transaction_type: string;
  amount: number;
  payment_method: string | null;
  invoice_no?: string | null;
  description: string | null;
  created_at: string;
}

interface PaidExpenseDetail {
  id: string;
  date?: string | null;
  category: string;
  details: string;
  amount: number;
  payment_method: string;
  status: string;
  transaction_type?: string;
}

interface ReportDeliveryQueueRow {
  lab_order_id: number;
  order_no: string | null;
  order_status: string | null;
  bill_id: number | null;
  patient_name: string | null;
  patient_code: string | null;
  patient_mobile: string | null;
  doctor_id: number | null;
  doctor_name: string | null;
  invoice_no: string | null;
  due_amount: number;
  item_count: number;
  ready_count: number;
  delivered_count: number;
  can_print: boolean;
}

interface DailyCollectionResponse {
  date: string;
  summary: CollectionSummary;
  finance_summary: FinanceSummary;
  service_summary: ServiceSummary;
  report_delivery_summary: ReportDeliverySummary;
  report_delivery_queue: ReportDeliveryQueueRow[];
  doctor_summaries: DoctorSummary[];
  doctor_test_invoices?: DoctorTestInvoiceRow[];
  by_payment_method: PaymentMethodRow[];
  expense_details?: PaidExpenseDetail[];
  details: CollectionDetail[];
}

interface BillRow {
  id: number;
  invoice_no: string;
  patient_name?: string;
  total_amount: number;
  paid?: number;
  paid_amount?: number;
  outstanding?: number;
  discount: number;
  status: string;
  created_at: string;
}

interface BillsResponse {
  bills: BillRow[];
  total: number;
}

interface ReportDeliveryLookup {
  invoice: { id: number; invoiceNo: string; status?: string; totalAmount: number; paidAmount: number; dueAmount: number };
  patient: { id: number; name: string; patientCode?: string | null; mobile?: string | null };
  reports: Array<{ id: number; lab_order_id?: number; test_name?: string; status?: string; order_no?: string }>;
  orders: Array<{ labOrderId: number; orderNo?: string; status?: string; itemCount: number; readyCount: number; deliveredCount: number; canPrint: boolean }>;
  canPrint: boolean;
  needsPayment: boolean;
  allReady: boolean;
}

export interface ShiftHandoverReport {
  session: {
    sessionId: number;
    status: string;
    counterId: number;
    counterName: string;
    counterCode?: string | null;
    cashierId: number;
    cashierName: string;
    openedAt?: string | null;
    closedAt?: string | null;
    openingCash: number;
  };
  activity: {
    serialCreated: number;
    doctorSeen: number;
    serialCancelled: number;
    serialWaiting: number;
    invoiceCount: number;
    patientsSeen: number;
    doctorVisits: number;
    testOrders: number;
    testItems: number;
  };
  finance: {
    totalReceived: number;
    cashReceived: number;
    dueCollection: number;
    doctorVisitCollection: number;
    testCollection: number;
    refund: number;
    discount: number;
    doctorPayout: number;
    pettyExpense: number;
    transferOut: number;
    bankDeposit: number;
    acceptedTransferIn: number;
    totalDue: number;
    expectedCash: number;
    countedCash: number;
    variance: number;
  };
  paymentMethods: Array<{ paymentMethod: string; transactionCount: number; totalAmount: number }>;
  settlement?: {
    paymentMethods: Array<{ paymentMethod: string; transactionCount: number; systemAmount: number; declaredAmount: number | null; difference: number | null }>;
    nonCashRemarks?: string | null;
  };
  handover?: {
    handoverToName?: string | null;
    handoverAmount: number;
    handoverDue: number;
    status?: string | null;
    remarks?: string | null;
  };
  denominations?: Array<{ note: number; count: number; total: number }>;
  expenses: Array<{ id: number; category: string; amount: number; description?: string | null; status?: string | null }>;
  transfers: Array<{ id: number; transferNo?: unknown; amount: number; status?: unknown; receiverName?: unknown }>;
  exceptions?: {
    cancelledBills?: Array<{ id: number; invoiceNo?: string | null; patientName?: string | null; total: number; reason?: unknown; cancelledAt?: unknown; cancelledByName?: unknown }>;
    refundedBills?: Array<{ id: number; creditNoteNo?: string | null; invoiceNo?: string | null; patientName?: string | null; refundAmount: number; reason?: unknown; createdAt?: unknown; createdByName?: unknown }>;
    discountedBills?: Array<{ id: number; invoiceNo?: string | null; patientName?: string | null; total: number; discount: number; discountPercent?: number; reason?: unknown; referredBy?: unknown; approvedByName?: unknown }>;
    dueBills?: Array<{ id: number; invoiceNo?: string | null; patientName?: string | null; total: number; paid: number; due: number; status?: unknown }>;
    editedBills?: Array<{ id: number; billId: number; invoiceNo?: string | null; versionNumber: number; total: number; discount: number; reason?: unknown; editedByName?: unknown; createdAt?: unknown }>;
    approvalRequests?: Array<{ id: number; type: string; entityId: number; entityNo?: unknown; status: string; requestedByName?: unknown; reviewedByName?: unknown; reviewNotes?: unknown; createdAt?: unknown }>;
    manualMovements?: Array<{ id: number; movementType: string; amount: number; referenceType?: unknown; description?: unknown; createdByName?: unknown; createdAt?: unknown }>;
  };
  audit: { reportNo: string; generatedAt: string; generatedBy: number; scope: string };
}

interface ShiftHandoverResponse {
  report: ShiftHandoverReport;
  reports?: ShiftHandoverReport[];
  snapshot?: {
    id: number;
    reportNo: string;
    status: string;
    hash: string;
    finalizedAt?: string | null;
    acceptedBy?: number | null;
    acceptedAt?: string | null;
  };
}

interface ShiftHandoverHistoryItem {
  id: number;
  sessionId: number;
  reportNo: string;
  status: string;
  cashierName: string;
  counterName: string;
  openedAt?: string | null;
  closedAt?: string | null;
  finalizedAt?: string | null;
  acceptedAt?: string | null;
  acceptedByName?: string | null;
  expectedCash: number;
  countedCash: number;
  variance: number;
  totalReceived: number;
}

interface ShiftHandoverHistoryResponse {
  reports: ShiftHandoverHistoryItem[];
}

function fmtMoney(amt: number): string {
  const numeric = Number(amt ?? 0);
  const safeAmount = Number.isFinite(numeric) ? numeric : 0;
  const hasFraction = Math.abs(safeAmount - Math.round(safeAmount)) > 0.000001;
  return `৳${safeAmount.toLocaleString('en-US', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  })}`;
}

function fmtCount(value: number): string {
  return Math.round(Number(value ?? 0)).toLocaleString();
}

function fmtPercent(value?: number | null): string {
  if (value == null) return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '—';
  return `${numeric.toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

function getCommissionPercent(
  _commissionAmount?: number | null,
  _collectionAmount?: number | null,
  explicitPercent?: number | null,
): number | null {
  if (explicitPercent == null) return null;
  const explicit = Number(explicitPercent);
  return Number.isFinite(explicit) && explicit >= 0 ? explicit : null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openPrintWindow(title: string, body: string): void {
  const printWindow = window.open('about:blank', '_blank');
  if (!printWindow) {
    toast.error('Popup blocked. Allow popups to print the report.');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #0f172a; }
      h1, h2, h3 { margin: 0 0 10px; }
      .muted { color: #475569; }
      .meta { display: flex; gap: 24px; flex-wrap: wrap; margin: 14px 0 24px; }
      .card-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 20px; }
      .card { border: 1px solid #cbd5e1; border-radius: 12px; padding: 12px; background: #f8fafc; }
      .label { font-size: 12px; color: #475569; margin-bottom: 6px; }
      .value { font-size: 22px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin-top: 14px; }
      th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; font-size: 13px; vertical-align: top; }
      th { background: #e2e8f0; }
      .right { text-align: right; }
      .print-btn { margin-bottom: 16px; padding: 10px 14px; border: none; background: #0f766e; color: white; border-radius: 10px; cursor: pointer; }
      @media print {
        .print-btn { display: none; }
        body { margin: 10mm; }
      }
    </style>
  </head>
  <body onload="window.focus(); window.print();">
    <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
    ${body}
  </body>
</html>`);
  printWindow.document.close();
}

export function buildDoctorPerformanceCsv(doctors: DoctorSummary[]): string {
  return [
    ['Doctor', 'Patients Seen', 'Doctor Visits', 'Doctor Visit Amount', 'Tests Given', 'Test Orders', 'Test Collection', 'Test Commission', 'Test Commission %', 'Commission'],
    ...doctors.map((doctor) => [
      doctor.doctor_name,
      String(doctor.patient_count),
      String(doctor.doctor_visit_count),
      String(doctor.doctor_visit_amount),
      String(doctor.test_count),
      String(doctor.test_order_count),
      String(doctor.test_collection_amount),
      String(doctor.test_commission_amount ?? 0),
      fmtPercent(getCommissionPercent(doctor.test_commission_amount ?? 0, doctor.test_collection_amount, doctor.test_commission_percent)),
      String(doctor.commission_amount),
    ]),
  ].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function buildLabReportPrintUrl(basePath: string, labOrderId: number): string {
  return `${basePath}/api/lab/orders/${labOrderId}/report/print?autoprint=1`;
}

export function buildDoctorReportHtml(
  date: string,
  doctors: DoctorSummary[],
  _financeSummary: FinanceSummary,
  serviceSummary: ServiceSummary,
  targetDoctor?: DoctorSummary,
  doctorTestInvoices: DoctorTestInvoiceRow[] = [],
): string {
  const rowsForReport = targetDoctor ? [targetDoctor] : doctors;
  const reportTotals = rowsForReport.reduce((totals, doctor) => ({
    patient_count: totals.patient_count + Number(doctor.patient_count ?? 0),
    doctor_visit_count: totals.doctor_visit_count + Number(doctor.doctor_visit_count ?? 0),
    doctor_visit_amount: totals.doctor_visit_amount + Number(doctor.doctor_visit_amount ?? 0),
    test_count: totals.test_count + Number(doctor.test_count ?? 0),
    test_collection_amount: totals.test_collection_amount + Number(doctor.test_collection_amount ?? 0),
    test_commission_amount: totals.test_commission_amount + Number(doctor.test_commission_amount ?? 0),
    commission_amount: totals.commission_amount + Number(doctor.commission_amount ?? 0),
  }), {
    patient_count: 0,
    doctor_visit_count: 0,
    doctor_visit_amount: 0,
    test_count: 0,
    test_collection_amount: 0,
    test_commission_amount: 0,
    commission_amount: 0,
  });
  const hasDoctorRows = rowsForReport.length > 0;
  const displayPatients = hasDoctorRows ? reportTotals.patient_count : serviceSummary.total_patients_seen;
  const displayVisits = hasDoctorRows ? reportTotals.doctor_visit_count : serviceSummary.doctor_visit_count;
  const displayVisitCollection = hasDoctorRows ? reportTotals.doctor_visit_amount : serviceSummary.doctor_visit_amount;
  const displayTests = hasDoctorRows ? reportTotals.test_count : serviceSummary.test_count;
  const displayTestCollection = hasDoctorRows ? reportTotals.test_collection_amount : serviceSummary.test_amount;
  const displayCommission = hasDoctorRows ? reportTotals.commission_amount : 0;
  const displayTotalCollection = displayVisitCollection + displayTestCollection;
  const displayNetCollection = displayTotalCollection - displayCommission;
  const selectedDoctorIds = new Set(rowsForReport.map((doctor) => Number(doctor.doctor_id)));
  const invoiceRowsForReport = doctorTestInvoices.filter((invoice) => selectedDoctorIds.has(Number(invoice.doctor_id)));
  const invoiceTotals = invoiceRowsForReport.reduce((totals, invoice) => ({
    test_count: totals.test_count + Number(invoice.test_count ?? 0),
    gross_amount: totals.gross_amount + Number(invoice.gross_amount ?? 0),
    discount_amount: totals.discount_amount + Number(invoice.discount_amount ?? 0),
    test_collection_amount: totals.test_collection_amount + Number(invoice.test_collection_amount ?? 0),
    paid_amount: totals.paid_amount + Number(invoice.paid_amount ?? 0),
    due_amount: totals.due_amount + Number(invoice.due_amount ?? 0),
    test_commission_amount: totals.test_commission_amount + Number(invoice.test_commission_amount ?? 0),
  }), {
    test_count: 0,
    gross_amount: 0,
    discount_amount: 0,
    test_collection_amount: 0,
    paid_amount: 0,
    due_amount: 0,
    test_commission_amount: 0,
  });

  const rows = rowsForReport.map((doctor, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(doctor.doctor_name)}</td>
      <td class="right">${fmtCount(doctor.patient_count)}</td>
      <td class="right">${fmtCount(doctor.doctor_visit_count)}</td>
      <td class="right">${escapeHtml(fmtMoney(doctor.doctor_visit_amount))}</td>
      <td class="right">${fmtCount(doctor.test_count)}</td>
      <td class="right">${fmtCount(doctor.test_order_count)}</td>
      <td class="right">${escapeHtml(fmtMoney(doctor.test_collection_amount))}</td>
      <td class="right">${escapeHtml(fmtMoney(doctor.test_commission_amount ?? 0))}</td>
      <td class="right">${escapeHtml(fmtPercent(getCommissionPercent(doctor.test_commission_amount ?? 0, doctor.test_collection_amount, doctor.test_commission_percent)))}</td>
      <td class="right">${escapeHtml(fmtMoney(doctor.commission_amount))}</td>
    </tr>
  `).join('');

  const invoiceRows = invoiceRowsForReport.map((invoice, index) => {
    const commissionPercent = getCommissionPercent(
      invoice.test_commission_amount,
      invoice.test_collection_amount,
      invoice.test_commission_percent,
    );

    return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(invoice.invoice_no || 'Bill #' + invoice.bill_id)}</td>
      <td>${escapeHtml(invoice.invoice_date || '—')}</td>
      <td>${escapeHtml(invoice.patient_name || '—')}</td>
      <td>${escapeHtml(invoice.patient_mobile || invoice.patient_code || '—')}</td>
      <td>${escapeHtml(invoice.reference_name || invoice.doctor_name || '—')}</td>
      <td>${escapeHtml(invoice.test_names || '—')}</td>
      <td class="right">${fmtCount(invoice.test_count)}</td>
      <td class="right">${escapeHtml(fmtMoney(invoice.gross_amount))}</td>
      <td class="right">${escapeHtml(fmtMoney(invoice.discount_amount))}</td>
      <td class="right">${escapeHtml(fmtMoney(invoice.test_collection_amount))}</td>
      <td class="right">${escapeHtml(fmtMoney(invoice.paid_amount))}</td>
      <td class="right">${escapeHtml(fmtMoney(invoice.due_amount))}</td>
      <td class="right">${escapeHtml(fmtMoney(invoice.test_commission_amount))}</td>
      <td class="right">${escapeHtml(fmtPercent(commissionPercent))}</td>
    </tr>
  `;
  }).join('');

  const invoiceCommissionRates = Array.from(new Set(
    invoiceRowsForReport
      .map((invoice) => invoice.test_commission_percent)
      .filter((value): value is number => value != null && Number.isFinite(Number(value)))
      .map((value) => Number(value)),
  ));
  const invoiceTotalCommissionPercent = invoiceCommissionRates.length === 1
    ? invoiceCommissionRates[0]
    : null;

  const invoiceDetailsTable = invoiceRowsForReport.length > 0 ? `
    <h2>Test Invoice Details</h2>
    <table>
      <thead>
        <tr>
          <th>#</th><th>Invoice No</th><th>Date/Time</th><th>Patient</th><th>Phone / ID</th><th>Reference Name</th><th>Tests</th>
          <th class="right">Test Count</th><th class="right">Gross</th><th class="right">Discount</th>
          <th class="right">Test Collection</th><th class="right">Paid</th><th class="right">Due</th><th class="right">Test Commission</th><th class="right">Commission %</th>
        </tr>
      </thead>
      <tbody>${invoiceRows}</tbody>
      <tfoot>
        <tr>
          <th colspan="7" class="right">Totals</th>
          <th class="right">${fmtCount(invoiceTotals.test_count)}</th>
          <th class="right">${escapeHtml(fmtMoney(invoiceTotals.gross_amount))}</th>
          <th class="right">${escapeHtml(fmtMoney(invoiceTotals.discount_amount))}</th>
          <th class="right">${escapeHtml(fmtMoney(invoiceTotals.test_collection_amount))}</th>
          <th class="right">${escapeHtml(fmtMoney(invoiceTotals.paid_amount))}</th>
          <th class="right">${escapeHtml(fmtMoney(invoiceTotals.due_amount))}</th>
          <th class="right">${escapeHtml(fmtMoney(invoiceTotals.test_commission_amount))}</th>
          <th class="right">${escapeHtml(fmtPercent(invoiceTotalCommissionPercent))}</th>
        </tr>
      </tfoot>
    </table>
  ` : '<h2>Test Invoice Details</h2><p class="muted">No test invoices found for this doctor/date.</p>';

  return `
    <h1>${escapeHtml(targetDoctor ? `${targetDoctor.doctor_name} Daily Performance` : 'All Doctors Daily Performance Report')}</h1>
    <div class="muted">Date: ${escapeHtml(date)}</div>
    <div class="meta">
      <div><strong>Total Doctor Collection:</strong> ${escapeHtml(fmtMoney(displayTotalCollection))}</div>
      <div><strong>Doctor Visit Collection:</strong> ${escapeHtml(fmtMoney(displayVisitCollection))}</div>
      <div><strong>Test Collection:</strong> ${escapeHtml(fmtMoney(displayTestCollection))}</div>
      <div><strong>Commission:</strong> ${escapeHtml(fmtMoney(displayCommission))}</div>
    </div>
    <div class="card-grid">
      <div class="card"><div class="label">Patients Seen</div><div class="value">${escapeHtml(fmtCount(displayPatients))}</div></div>
      <div class="card"><div class="label">Doctor Visits</div><div class="value">${escapeHtml(fmtCount(displayVisits))}</div></div>
      <div class="card"><div class="label">Tests Given</div><div class="value">${escapeHtml(fmtCount(displayTests))}</div></div>
      <div class="card"><div class="label">Net After Commission</div><div class="value">${escapeHtml(fmtMoney(displayNetCollection))}</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Doctor</th>
          <th class="right">Patients</th>
          <th class="right">Visits</th>
          <th class="right">Visit Collection</th>
          <th class="right">Tests</th>
          <th class="right">Test Orders</th>
          <th class="right">Test Collection</th>
          <th class="right">Test Commission</th>
          <th class="right">Test Commission %</th>
          <th class="right">Commission</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    ${invoiceDetailsTable}
  `;
}

export function buildShiftHandoverReportHtml(report: ShiftHandoverReport): string {
  const metaRows = [
    ['Report No', report.audit.reportNo],
    ['Cashier', report.session.cashierName],
    ['Counter', `${report.session.counterName}${report.session.counterCode ? ` (${report.session.counterCode})` : ''}`],
    ['Opened At', report.session.openedAt ?? '—'],
    ['Closed At', report.session.closedAt ?? 'Active shift'],
    ['Status', report.session.status],
  ];
  const activityRows = [
    ['OPD Serial Created', report.activity.serialCreated],
    ['Doctor Seen', report.activity.doctorSeen],
    ['Patients Seen', report.activity.patientsSeen],
    ['Doctor Visits', report.activity.doctorVisits],
    ['Invoices', report.activity.invoiceCount],
    ['Test Orders', report.activity.testOrders],
    ['Test Items', report.activity.testItems],
    ['Waiting / Pending Serial', report.activity.serialWaiting],
    ['Cancelled Serial', report.activity.serialCancelled],
  ];
  const financeRows = [
    ['Opening Cash', report.session.openingCash],
    ['Total Received', report.finance.totalReceived],
    ['Cash Received', report.finance.cashReceived],
    ['Due Collection', report.finance.dueCollection],
    ['Doctor Visit Collection', report.finance.doctorVisitCollection],
    ['Test Collection', report.finance.testCollection],
    ['Refund / Return', report.finance.refund],
    ['Discount Given', report.finance.discount],
    ['Doctor Payout', report.finance.doctorPayout],
    ['Petty Cash Expense', report.finance.pettyExpense],
    ['Cash Transfer Out', report.finance.transferOut],
    ['Bank Deposit', report.finance.bankDeposit],
    ['Accepted Transfer In', report.finance.acceptedTransferIn],
    ['Expected Drawer Cash', report.finance.expectedCash],
    ['Counted Cash', report.finance.countedCash],
    ['Variance', report.finance.variance],
  ];
  const paymentRows = report.paymentMethods.map((row) => `
    <tr><td>${escapeHtml(row.paymentMethod)}</td><td class="right">${fmtCount(row.transactionCount)}</td><td class="right">${escapeHtml(fmtMoney(row.totalAmount))}</td></tr>
  `).join('') || '<tr><td colspan="3">No payment method rows</td></tr>';
  const settlementRows = (report.settlement?.paymentMethods ?? []).map((row) => `
    <tr><td>${escapeHtml(row.paymentMethod)}</td><td class="right">${fmtCount(row.transactionCount)}</td><td class="right">${escapeHtml(fmtMoney(row.systemAmount))}</td><td class="right">${row.declaredAmount == null ? '—' : escapeHtml(fmtMoney(row.declaredAmount))}</td><td class="right">${row.difference == null ? '—' : escapeHtml(fmtMoney(row.difference))}</td></tr>
  `).join('') || '<tr><td colspan="5">No settlement declaration recorded</td></tr>';
  const handover = report.handover;
  const handoverRows = handover ? [
    ['Handover To', handover.handoverToName ?? '—'],
    ['Handover Amount', fmtMoney(handover.handoverAmount)],
    ['Handover Due', fmtMoney(handover.handoverDue)],
    ['Status', handover.status ?? '—'],
    ['Remarks', handover.remarks ?? '—'],
  ].map(([label, value]) => `<tr><th>${escapeHtml(String(label))}</th><td>${escapeHtml(String(value))}</td></tr>`).join('') : '<tr><td colspan="2">No handover row recorded</td></tr>';
  const expenseRows = report.expenses.map((row) => `
    <tr><td>${escapeHtml(row.category)}</td><td>${escapeHtml(String(row.description ?? '—'))}</td><td>${escapeHtml(String(row.status ?? '—'))}</td><td class="right">${escapeHtml(fmtMoney(row.amount))}</td></tr>
  `).join('') || '<tr><td colspan="4">No expenses recorded</td></tr>';
  const transferRows = report.transfers.map((row) => `
    <tr><td>${escapeHtml(String(row.transferNo ?? row.id))}</td><td>${escapeHtml(String(row.receiverName ?? '—'))}</td><td>${escapeHtml(String(row.status ?? '—'))}</td><td class="right">${escapeHtml(fmtMoney(row.amount))}</td></tr>
  `).join('') || '<tr><td colspan="4">No cash transfers recorded</td></tr>';
  const exceptions = report.exceptions ?? {};
  const exceptionSummaryRows = [
    ['Cancelled Bills', exceptions.cancelledBills?.length ?? 0],
    ['Refunded Bills', exceptions.refundedBills?.length ?? 0],
    ['Discounted Bills', exceptions.discountedBills?.length ?? 0],
    ['Due Bills', exceptions.dueBills?.length ?? 0],
    ['Edited Bills', exceptions.editedBills?.length ?? 0],
    ['Approval Requests', exceptions.approvalRequests?.length ?? 0],
    ['Manual Cash Movements', exceptions.manualMovements?.length ?? 0],
  ];
  const cancelledRows = (exceptions.cancelledBills ?? []).map((row) => `
    <tr><td>${escapeHtml(String(row.invoiceNo ?? row.id))}</td><td>${escapeHtml(String(row.patientName ?? '—'))}</td><td>${escapeHtml(String(row.reason ?? '—'))}</td><td>${escapeHtml(String(row.cancelledByName ?? '—'))}</td><td class="right">${escapeHtml(fmtMoney(row.total))}</td></tr>
  `).join('') || '<tr><td colspan="5">No cancelled bills</td></tr>';
  const refundRows = (exceptions.refundedBills ?? []).map((row) => `
    <tr><td>${escapeHtml(String(row.creditNoteNo ?? row.id))}</td><td>${escapeHtml(String(row.invoiceNo ?? '—'))}</td><td>${escapeHtml(String(row.patientName ?? '—'))}</td><td>${escapeHtml(String(row.reason ?? '—'))}</td><td class="right">${escapeHtml(fmtMoney(row.refundAmount))}</td></tr>
  `).join('') || '<tr><td colspan="5">No refunds</td></tr>';
  const discountRows = (exceptions.discountedBills ?? []).map((row) => `
    <tr><td>${escapeHtml(String(row.invoiceNo ?? row.id))}</td><td>${escapeHtml(String(row.patientName ?? '—'))}</td><td>${escapeHtml(String(row.reason ?? '—'))}</td><td>${escapeHtml(String(row.approvedByName ?? row.referredBy ?? '—'))}</td><td class="right">${escapeHtml(fmtMoney(row.discount))}</td></tr>
  `).join('') || '<tr><td colspan="5">No discounts</td></tr>';
  const dueRows = (exceptions.dueBills ?? []).map((row) => `
    <tr><td>${escapeHtml(String(row.invoiceNo ?? row.id))}</td><td>${escapeHtml(String(row.patientName ?? '—'))}</td><td>${escapeHtml(String(row.status ?? '—'))}</td><td class="right">${escapeHtml(fmtMoney(row.paid))}</td><td class="right">${escapeHtml(fmtMoney(row.due))}</td></tr>
  `).join('') || '<tr><td colspan="5">No due bills</td></tr>';
  const auditRows = [
    ...(exceptions.editedBills ?? []).map((row) => ['Bill Edit', row.invoiceNo ?? row.billId, row.reason ?? '—', row.editedByName ?? '—', row.createdAt ?? '—']),
    ...(exceptions.approvalRequests ?? []).map((row) => [`Approval ${row.type}`, row.entityNo ?? row.entityId, row.status, row.reviewedByName ?? row.requestedByName ?? '—', row.createdAt ?? '—']),
    ...(exceptions.manualMovements ?? []).map((row) => ['Manual Cash', row.referenceType ?? row.movementType, `${fmtMoney(row.amount)} · ${String(row.description ?? '—')}`, row.createdByName ?? '—', row.createdAt ?? '—']),
  ].map((row) => `
    <tr><td>${escapeHtml(String(row[0]))}</td><td>${escapeHtml(String(row[1]))}</td><td>${escapeHtml(String(row[2]))}</td><td>${escapeHtml(String(row[3]))}</td><td>${escapeHtml(String(row[4]))}</td></tr>
  `).join('') || '<tr><td colspan="5">No edit/approval/manual movement exceptions</td></tr>';

  return `
    <h1>Shift Handover Report</h1>
    <div class="muted">Generated: ${escapeHtml(report.audit.generatedAt)}</div>
    <div class="meta">
      ${metaRows.map(([label, value]) => `<div><strong>${escapeHtml(String(label))}:</strong> ${escapeHtml(String(value))}</div>`).join('')}
    </div>
    <div class="card-grid">
      <div class="card"><div class="label">Total Received</div><div class="value">${escapeHtml(fmtMoney(report.finance.totalReceived))}</div></div>
      <div class="card"><div class="label">Expected Drawer Cash</div><div class="value">${escapeHtml(fmtMoney(report.finance.expectedCash))}</div></div>
      <div class="card"><div class="label">Counted Cash</div><div class="value">${escapeHtml(fmtMoney(report.finance.countedCash))}</div></div>
      <div class="card"><div class="label">Variance</div><div class="value">${escapeHtml(fmtMoney(report.finance.variance))}</div></div>
    </div>
    <h2>Operational Activity</h2>
    <table><tbody>${activityRows.map(([label, value]) => `<tr><th>${escapeHtml(String(label))}</th><td class="right">${escapeHtml(fmtCount(Number(value)))}</td></tr>`).join('')}</tbody></table>
    <h2>Cash Reconciliation</h2>
    <table><tbody>${financeRows.map(([label, value]) => `<tr><th>${escapeHtml(String(label))}</th><td class="right">${escapeHtml(fmtMoney(Number(value)))}</td></tr>`).join('')}</tbody></table>
    <h2>Payment Methods</h2>
    <table><thead><tr><th>Payment Method</th><th class="right">Transactions</th><th class="right">Amount</th></tr></thead><tbody>${paymentRows}</tbody></table>
    <h2>Payment Settlement Reconciliation</h2>
    <table><thead><tr><th>Method</th><th class="right">Transactions</th><th class="right">System</th><th class="right">Declared</th><th class="right">Difference</th></tr></thead><tbody>${settlementRows}</tbody></table>
    <div class="muted"><strong>Settlement remarks:</strong> ${escapeHtml(report.settlement?.nonCashRemarks ?? '—')}</div>
    <h2>Cash Handover Summary</h2>
    <table><tbody>${handoverRows}</tbody></table>
    <h2>Expenses / Cash Out</h2>
    <table><thead><tr><th>Category</th><th>Purpose</th><th>Status</th><th class="right">Amount</th></tr></thead><tbody>${expenseRows}</tbody></table>
    <h2>Cash Transfers</h2>
    <table><thead><tr><th>Transfer No</th><th>Receiver</th><th>Status</th><th class="right">Amount</th></tr></thead><tbody>${transferRows}</tbody></table>
    <h2>Exception / Audit Review</h2>
    <table><tbody>${exceptionSummaryRows.map(([label, value]) => `<tr><th>${escapeHtml(String(label))}</th><td class="right">${escapeHtml(fmtCount(Number(value)))}</td></tr>`).join('')}</tbody></table>
    <h3>Cancelled Bills</h3>
    <table><thead><tr><th>Invoice</th><th>Patient</th><th>Reason</th><th>Cancelled By</th><th class="right">Amount</th></tr></thead><tbody>${cancelledRows}</tbody></table>
    <h3>Refunds / Credit Notes</h3>
    <table><thead><tr><th>Credit Note</th><th>Invoice</th><th>Patient</th><th>Reason</th><th class="right">Amount</th></tr></thead><tbody>${refundRows}</tbody></table>
    <h3>Discounted Bills</h3>
    <table><thead><tr><th>Invoice</th><th>Patient</th><th>Reason</th><th>Approved / Referred By</th><th class="right">Discount</th></tr></thead><tbody>${discountRows}</tbody></table>
    <h3>Due Bills</h3>
    <table><thead><tr><th>Invoice</th><th>Patient</th><th>Status</th><th class="right">Paid</th><th class="right">Due</th></tr></thead><tbody>${dueRows}</tbody></table>
    <h3>Edits, Approvals & Manual Cash Movements</h3>
    <table><thead><tr><th>Type</th><th>Reference</th><th>Reason / Status</th><th>User</th><th>Time</th></tr></thead><tbody>${auditRows}</tbody></table>
    <div class="meta" style="margin-top:40px">
      <div style="min-width:220px;border-top:1px solid #334155;padding-top:8px">Cashier Signature</div>
      <div style="min-width:220px;border-top:1px solid #334155;padding-top:8px">Receiver Signature</div>
      <div style="min-width:220px;border-top:1px solid #334155;padding-top:8px">Admin / Accountant</div>
    </div>
  `;
}

export function buildShiftHandoverReportCsv(report: ShiftHandoverReport): string {
  const rows: string[][] = [
    ['Report No', report.audit.reportNo],
    ['Cashier', report.session.cashierName],
    ['Counter', report.session.counterName],
    ['Opened At', report.session.openedAt ?? ''],
    ['Closed At', report.session.closedAt ?? 'Active shift'],
    [],
    ['Metric', 'Value'],
    ['OPD Serial Created', String(report.activity.serialCreated)],
    ['Doctor Seen', String(report.activity.doctorSeen)],
    ['Patients Seen', String(report.activity.patientsSeen)],
    ['Doctor Visits', String(report.activity.doctorVisits)],
    ['Test Orders', String(report.activity.testOrders)],
    ['Test Items', String(report.activity.testItems)],
    ['Total Received', String(report.finance.totalReceived)],
    ['Cash Received', String(report.finance.cashReceived)],
    ['Doctor Visit Collection', String(report.finance.doctorVisitCollection)],
    ['Test Collection', String(report.finance.testCollection)],
    ['Petty Cash Expense', String(report.finance.pettyExpense)],
    ['Doctor Payout', String(report.finance.doctorPayout)],
    ['Cash Transfer Out', String(report.finance.transferOut)],
    ['Bank Deposit', String(report.finance.bankDeposit)],
    ['Expected Drawer Cash', String(report.finance.expectedCash)],
    ['Counted Cash', String(report.finance.countedCash)],
    ['Variance', String(report.finance.variance)],
    [],
    ['Payment Method', 'Transactions', 'Amount'],
    ...report.paymentMethods.map((row) => [row.paymentMethod, String(row.transactionCount), String(row.totalAmount)]),
    [],
    ['Exception Type', 'Reference', 'Patient/User', 'Reason/Status', 'Amount'],
    ...(report.exceptions?.cancelledBills ?? []).map((row) => ['Cancelled Bill', String(row.invoiceNo ?? row.id), String(row.patientName ?? ''), String(row.reason ?? ''), String(row.total)]),
    ...(report.exceptions?.refundedBills ?? []).map((row) => ['Refund', String(row.creditNoteNo ?? row.id), String(row.patientName ?? ''), String(row.reason ?? ''), String(row.refundAmount)]),
    ...(report.exceptions?.discountedBills ?? []).map((row) => ['Discount', String(row.invoiceNo ?? row.id), String(row.patientName ?? ''), String(row.reason ?? ''), String(row.discount)]),
    ...(report.exceptions?.dueBills ?? []).map((row) => ['Due Bill', String(row.invoiceNo ?? row.id), String(row.patientName ?? ''), String(row.status ?? ''), String(row.due)]),
    ...(report.exceptions?.editedBills ?? []).map((row) => ['Bill Edit', String(row.invoiceNo ?? row.billId), String(row.editedByName ?? ''), String(row.reason ?? ''), String(row.total)]),
    ...(report.exceptions?.approvalRequests ?? []).map((row) => ['Approval', String(row.entityNo ?? row.entityId), String(row.requestedByName ?? ''), `${row.type} ${row.status}`, '']),
    ...(report.exceptions?.manualMovements ?? []).map((row) => ['Manual Cash', String(row.referenceType ?? row.movementType), String(row.createdByName ?? ''), String(row.description ?? ''), String(row.amount)]),
  ];
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export function buildShiftHandoverReportUrl(date: string, sessionId?: number | null): string {
  const params = new URLSearchParams();
  params.set('from', date);
  params.set('to', date);
  params.set('limit', '100');
  if (sessionId) params.set('sessionId', String(sessionId));
  return `/api/reports/shift-handover?${params.toString()}`;
}

export function buildShiftHandoverFinalizeUrl(sessionId: number): string {
  return `/api/reports/shift-handover/sessions/${sessionId}/finalize`;
}

export function buildShiftHandoverHistoryUrl(limit = 12): string {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  return `/api/reports/shift-handover/history?${params.toString()}`;
}

export function buildReceptionDueBillsUrl(date: string): string {
  const params = new URLSearchParams();
  params.set('from', date);
  params.set('to', date);
  return `/api/billing/due?${params.toString()}`;
}

export function getReceptionBillOutstanding(bill: Pick<BillRow, 'total_amount' | 'paid' | 'paid_amount' | 'outstanding'>): number {
  const serverOutstanding = Number(bill.outstanding);
  if (Number.isFinite(serverOutstanding)) return Math.max(0, serverOutstanding);

  const total = Number(bill.total_amount ?? 0);
  const paid = Number(bill.paid_amount ?? bill.paid ?? 0);
  return Math.max(0, total - paid);
}

type ReceptionReportShortcut = {
  key: string;
  title: string;
  description: string;
  href: string;
  badge: string;
};

function isSupervisorReportRole(role: string): boolean {
  return ['hospital_admin', 'admin', 'md', 'director', 'accountant'].includes(role);
}

export function buildReceptionReportsPdfCenterPath(basePath: string, role: string): string {
  return isSupervisorReportRole(role) ? `${basePath}/reports/pdf` : `${basePath}/reception/reports/pdf`;
}

export function buildReceptionReportActions(basePath: string, role: string): ReceptionReportShortcut[] {
  const isSupervisor = isSupervisorReportRole(role);
  const actions: ReceptionReportShortcut[] = [
    ...(isSupervisor ? [{
      key: 'shift-handover',
      title: 'All Shift Handovers',
      description: 'Review cashier-wise expected cash, counted cash, variance and acceptance status.',
      href: '#shift-handover-report',
      badge: 'Admin audit',
    }] : [{
      key: 'shift-report-print',
      title: 'Shift Report Print',
      description: 'Print your shift handover report: Opening cash, Collections, Expense / doctor payout, ending cash and Handover receiver.',
      href: `${basePath}/reception/reports/pdf?report=shiftHandover`,
      badge: 'Print/PDF',
    }]),
    {
      key: 'report-delivery',
      title: 'Report Delivery Desk',
      description: 'Search invoices, collect due before delivery, and print ready lab reports.',
      href: '#report-delivery',
      badge: 'Front desk',
    },
    {
      key: 'daily-collection',
      title: isSupervisor ? 'Staff Collection Snapshot' : "Today's Collection Snapshot",
      description: isSupervisor
        ? 'Check date-wise collection, payment methods, dues, discounts and doctor activity.'
        : 'Check your daily reception collection, payment methods, dues and doctor activity.',
      href: '#daily-collection-snapshot',
      badge: isSupervisor ? 'Staff/date' : 'Today',
    },
    {
      key: 'pdf-center',
      title: 'PDF Center',
      description: isSupervisor
        ? 'Generate full admin PDFs with collection, doctor, cash and handover reports.'
        : 'Generate scoped reception PDFs for collection, delivery and shift handover work.',
      href: buildReceptionReportsPdfCenterPath(basePath, role),
      badge: 'Print/PDF',
    },
    {
      key: 'cash-operations',
      title: 'Cash Operations',
      description: 'Record expenses, doctor payout, cash transfer, bank deposit and shift close from the dedicated cash workspace.',
      href: `${basePath}/reception/cash-operations`,
      badge: 'Cash work',
    },
  ];

  return actions;
}

export function getCollectionDetailReference(detail: Pick<CollectionDetail, 'invoice_no' | 'description' | 'id'>): string {
  const invoiceNo = String(detail.invoice_no ?? '').trim();
  if (invoiceNo) return invoiceNo;
  const description = String(detail.description ?? '').trim();
  return description || `Txn #${detail.id}`;
}

const PM_COLOR: Record<string, string> = {
  cash: 'bg-emerald-500',
  bkash: 'bg-pink-500',
  nagad: 'bg-orange-500',
  rocket: 'bg-purple-500',
  card: 'bg-blue-500',
  bank: 'bg-indigo-500',
  bank_transfer: 'bg-sky-500',
  cheque: 'bg-amber-500',
  other: 'bg-slate-500',
  unknown: 'bg-gray-400',
};

export default function ReceptionReportsPage({ role = 'reception' }: { role?: string }) {
  const { t } = useTranslation(['reports', 'common']);
  const { slug = '' } = useParams<{ slug: string }>();
  const basePath = slug ? `/h/${slug}` : '';
  const queryClient = useQueryClient();
  const [date, setDate] = useState(getTodayGMT6());
  const [invoiceInput, setInvoiceInput] = useState('');
  const [invoiceLookup, setInvoiceLookup] = useState('');
  const [selectedShiftSessionId, setSelectedShiftSessionId] = useState('');
  const normalizedRole = role === 'receptionist' ? 'receptionist' : role;
  const canViewFinanceReports = ['hospital_admin', 'md', 'director', 'accountant', 'reception', 'receptionist'].includes(normalizedRole);
  const pdfCenterPath = buildReceptionReportsPdfCenterPath(basePath, normalizedRole);
  const reportActions = canViewFinanceReports
    ? buildReceptionReportActions(basePath, normalizedRole)
    : buildReceptionReportActions(basePath, normalizedRole).filter((action) => ['report-delivery', 'pdf-center'].includes(action.key));

  const { data: collectionData, isLoading: loadingCollection } = useApiQuery<DailyCollectionResponse>(
    ['reports', 'daily-collection', date],
    `/api/reports/daily-collection?date=${date}`,
  );

  const { data: billsData, isLoading: loadingBills } = useApiQuery<BillsResponse>(
    ['bills', 'due', date],
    buildReceptionDueBillsUrl(date),
    { enabled: canViewFinanceReports },
  );

  const reportLookupQuery = useApiQuery<ReportDeliveryLookup>(
    ['reception', 'report-delivery', invoiceLookup],
    `/api/reception/report-delivery/lookup?invoice=${encodeURIComponent(invoiceLookup)}`,
    { enabled: invoiceLookup.trim().length > 0, retry: false },
  );

  const { data: shiftReportData, isLoading: loadingShiftReport } = useApiQuery<ShiftHandoverResponse>(
    ['reports', 'shift-handover', date],
    buildShiftHandoverReportUrl(date),
    { enabled: canViewFinanceReports, staleTime: 10 * 60_000, retry: false },
  );

  const { data: shiftReportHistoryData, isLoading: loadingShiftReportHistory } = useApiQuery<ShiftHandoverHistoryResponse>(
    ['reports', 'shift-handover', 'history'],
    buildShiftHandoverHistoryUrl(12),
    { enabled: canViewFinanceReports, staleTime: 60_000, retry: false },
  );

  const collectDue = useApiMutation<
    { receiptNo?: string },
    { billId: number; amount: number; type: 'due'; paymentMethod: string; idempotencyKey: string }
  >(
    'post',
    '/api/billing/pay',
    {
      onSuccess: (response) => {
        toast.success(response.receiptNo ? `Due collected: ${response.receiptNo}` : 'Due collected');
        queryClient.invalidateQueries({ queryKey: ['reception', 'report-delivery'] });
        queryClient.invalidateQueries({ queryKey: ['bills', 'due'] });
        queryClient.invalidateQueries({ queryKey: ['reports', 'daily-collection'] });
      },
      onError: (error) => toast.error(error.message),
    },
  );

  const finalizeShiftReport = useApiMutation<ShiftHandoverResponse, { sessionId: number }>(
    'post',
    (payload) => buildShiftHandoverFinalizeUrl(payload.sessionId),
    {
      onSuccess: async (response) => {
        toast.success(response.snapshot?.status === 'accepted' ? 'Final handover report loaded' : 'Shift handover report finalized');
        openPrintWindow(`Shift handover ${response.report.audit.reportNo}`, buildShiftHandoverReportHtml(response.report));
        await queryClient.invalidateQueries({ queryKey: ['reports', 'shift-handover'] });
        await queryClient.invalidateQueries({ queryKey: ['reports', 'shift-handover', 'history'] });
      },
      onError: (error) => toast.error(error.message || 'Failed to finalize shift report'),
    },
  );

  const summary = collectionData?.summary;
  const financeSummary = collectionData?.finance_summary;
  const serviceSummary = collectionData?.service_summary;
  const reportDeliverySummary = collectionData?.report_delivery_summary;
  const reportQueue = collectionData?.report_delivery_queue ?? [];
  const shiftReports = shiftReportData?.reports ?? (shiftReportData?.report ? [shiftReportData.report] : []);
  const selectedShiftReport = selectedShiftSessionId
    ? shiftReports.find((report) => String(report.session.sessionId) === selectedShiftSessionId) ?? shiftReports[0]
    : shiftReports[0];
  const shiftReport = selectedShiftReport;
  const shiftReportHistory = shiftReportHistoryData?.reports ?? [];
  const doctorSummaries = collectionData?.doctor_summaries ?? [];
  const doctorTestInvoices = collectionData?.doctor_test_invoices ?? [];
  const paymentMethods = collectionData?.by_payment_method ?? [];
  const paymentMethodTotal = paymentMethods.reduce((sum, method) => (
    sum + Math.max(0, Number(method.total_amount ?? method.net_amount ?? method.gross_amount ?? 0))
  ), 0);
  const details = collectionData?.details ?? [];
  const paidExpenseDetails = collectionData?.expense_details;
  const dailyExpenses: PaidExpenseDetail[] = paidExpenseDetails !== undefined
    ? paidExpenseDetails
    : (shiftReport?.expenses ?? []).map((expense) => ({
        id: `shift-expense-${expense.id}`,
        date,
        category: expense.category,
        details: expense.description ?? expense.category,
        amount: Number(expense.amount ?? 0),
        payment_method: 'cash',
        status: expense.status ?? 'paid',
        transaction_type: 'expense',
      }));
  const approvedExpenseTotal = dailyExpenses.reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0);
  const dueBills = (billsData?.bills ?? []).filter((bill) => bill.status !== 'paid' && bill.status !== 'cancelled');
  const totalDue = dueBills.reduce((sum, bill) => sum + getReceptionBillOutstanding(bill), 0);
  const loading = loadingCollection || (canViewFinanceReports && loadingBills);

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['reports', 'daily-collection'] });
    queryClient.invalidateQueries({ queryKey: ['reports', 'shift-handover'] });
    queryClient.invalidateQueries({ queryKey: ['bills', 'due'] });
  };

  const handlePrintDoctorReport = (doctor?: DoctorSummary) => {
    if (!financeSummary || !serviceSummary) {
      toast.error('Daily report is still loading');
      return;
    }
    openPrintWindow(
      doctor ? `${doctor.doctor_name} report` : `All doctors report ${date}`,
      buildDoctorReportHtml(date, doctorSummaries, financeSummary, serviceSummary, doctor, doctorTestInvoices),
    );
  };

  const handlePrintShiftReport = () => {
    if (!shiftReport) {
      toast.error('Shift report is still loading or no active shift was found');
      return;
    }
    finalizeShiftReport.mutate({ sessionId: shiftReport.session.sessionId });
  };

  const exportShiftReportCsv = () => {
    if (!shiftReport) {
      toast.error('Shift report is still loading or no active shift was found');
      return;
    }
    downloadCsv(buildShiftHandoverReportCsv(shiftReport), `shift-handover-${shiftReport.audit.reportNo}.csv`);
  };

  const exportDoctorCsv = () => {
    downloadCsv(buildDoctorPerformanceCsv(doctorSummaries), `doctor-performance-${date}.csv`);
  };

  const exportTransactions = () => {
    const csv = [
      ['#', 'Type', 'Amount', 'Method', 'Reference', 'Time'],
      ...details.map((detail, index) => [
        String(index + 1),
        t(`reports:txnTypes.${detail.transaction_type}`, { defaultValue: detail.transaction_type }),
        String(detail.amount),
        detail.payment_method ?? '',
        getCollectionDetailReference(detail),
        detail.created_at ? new Date(detail.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '',
      ]),
    ].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
    downloadCsv(csv, `collection-${date}.csv`);
  };

  return (
    <DashboardLayout role={role}>
      <div className="mx-auto max-w-screen-2xl space-y-5">
        <ReceptionTopBar role={role} />

        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-xl font-bold text-[var(--color-text-primary)]">
              {t('receptionReports', { defaultValue: 'Reception Reports & Delivery' })}
            </h1>
            <p className="text-sm text-[var(--color-text-muted)]">
              {new Date(date).toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to={pdfCenterPath} className="btn-primary text-sm">
              <FileText className="h-4 w-4" /> PDF Center
            </Link>
            <input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSelectedShiftSessionId(''); }} className="input" />
            <button onClick={() => { setDate(getTodayGMT6()); setSelectedShiftSessionId(''); }} className="btn-secondary text-sm">
              {t('common:today', { defaultValue: 'Today' })}
            </button>
            <button onClick={handleRefresh} className="btn-ghost" title="Refresh report">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>

        <section className="card border border-cyan-100 bg-gradient-to-br from-cyan-50 to-white p-5 dark:border-cyan-900/40 dark:from-slate-900 dark:to-slate-900">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-cyan-700">Reception Report Workspace</p>
              <h2 className="mt-1 text-lg font-bold text-[var(--color-text-primary)]">Shift, delivery and collection reports in one clear flow</h2>
              <p className="mt-2 max-w-3xl text-sm text-[var(--color-text-muted)]">
                Receptionists should mainly use own shift handover, report delivery and daily collection snapshots. Admin, MD and accounts users can use the same page for staff/date-wise review and full PDF audit.
              </p>
            </div>
            <Link to={pdfCenterPath} className="btn-secondary text-sm">
              <FileText className="h-4 w-4" /> Open PDF Center
            </Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {reportActions.map((action) => {
              const card = (
                <div className="h-full rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md dark:bg-slate-950">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{action.title}</h3>
                    <span className="badge badge-info whitespace-nowrap">{action.badge}</span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-[var(--color-text-muted)]">{action.description}</p>
                </div>
              );
              return action.href.startsWith('#') ? (
                <a key={action.key} href={action.href} className="block focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2">{card}</a>
              ) : (
                <Link key={action.key} to={action.href} className="block focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2">{card}</Link>
              );
            })}
          </div>
        </section>

        <section id="report-delivery" className="card scroll-mt-24 p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-3">
                <h2 className="text-base font-semibold text-[var(--color-text)]">{t('reports:reportDelivery.title')}</h2>
                <p className="text-sm text-[var(--color-text-muted)]">{t('reports:reportDelivery.description')}</p>
              </div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
                <div className="min-w-0 flex-1">
                  <label className="label">{t('reports:reportDelivery.invoiceNumber')}</label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    <input
                      className="input pl-9 text-base"
                      value={invoiceInput}
                      onChange={(event) => setInvoiceInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') setInvoiceLookup(invoiceInput.trim());
                      }}
                      placeholder={t('reports:reportDelivery.scanOrEnterInvoice')}
                    />
                  </div>
                </div>
                <button type="button" className="btn-primary" onClick={() => setInvoiceLookup(invoiceInput.trim())}>
                  {t('reports:reportDelivery.lookup')}
                </button>
              </div>
              {reportLookupQuery.error ? <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{reportLookupQuery.error.message}</div> : null}
            </div>

            <div className="grid w-full gap-3 sm:grid-cols-3 xl:w-[420px]">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                <div className="text-xs text-[var(--color-text-muted)]">{t('reports:reportDelivery.ordersReady')}</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-600">{fmtCount(reportDeliverySummary?.ready_orders ?? 0)}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{t('reports:reportDelivery.outOf')} {fmtCount(reportDeliverySummary?.total_orders ?? 0)}</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                <div className="text-xs text-[var(--color-text-muted)]">{t('reports:reportDelivery.readyTests')}</div>
                <div className="mt-1 text-2xl font-semibold text-blue-600">{fmtCount(reportDeliverySummary?.ready_tests ?? 0)}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{t('reports:reportDelivery.delivered')} {fmtCount(reportDeliverySummary?.delivered_tests ?? 0)}</div>
              </div>
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                <div className="text-xs text-[var(--color-text-muted)]">{t('reports:reportDelivery.pendingOrders')}</div>
                <div className="mt-1 text-2xl font-semibold text-amber-600">{fmtCount(reportDeliverySummary?.pending_orders ?? 0)}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{t('reports:reportDelivery.tests')} {fmtCount(reportDeliverySummary?.total_tests ?? 0)}</div>
              </div>
            </div>
          </div>

          {reportLookupQuery.data ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-lg border border-[var(--color-border)] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{reportLookupQuery.data.patient.name}</h3>
                    <p className="text-sm text-[var(--color-text-muted)]">
                      {reportLookupQuery.data.invoice.invoiceNo} • {reportLookupQuery.data.patient.mobile ?? reportLookupQuery.data.patient.patientCode ?? ''}
                    </p>
                  </div>
                  <span className={`badge ${reportLookupQuery.data.allReady ? 'badge-success' : 'badge-warning'}`}>
                    {reportLookupQuery.data.allReady ? 'Ready for delivery' : 'Report still processing'}
                  </span>
                </div>

                <div className="mt-4 space-y-3">
                  {reportLookupQuery.data.orders.length === 0 ? (
                    <div className="rounded-lg bg-[var(--color-bg-elevated)] p-3 text-sm text-[var(--color-text-muted)]">
                      No linked lab order found for this invoice.
                    </div>
                  ) : reportLookupQuery.data.orders.map((order) => (
                    <div key={order.labOrderId} className="rounded-xl border border-[var(--color-border)] p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="font-medium">{order.orderNo ?? `Lab order #${order.labOrderId}`}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">
                            Ready {fmtCount(order.readyCount)}/{fmtCount(order.itemCount)} • Delivered {fmtCount(order.deliveredCount)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`badge ${order.canPrint ? 'badge-success' : 'badge-warning'}`}>
                            {order.canPrint ? 'Printable' : 'Hold'}
                          </span>
                          <button
                            type="button"
                            className="btn-secondary text-sm"
                            disabled={!order.canPrint}
                            onClick={() => window.open(buildLabReportPrintUrl(basePath, order.labOrderId), '_blank')}
                          >
                            <Printer className="h-4 w-4" /> {t('reports:reportDelivery.printReport')}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-[var(--color-border)] p-4">
                <div className="text-sm text-[var(--color-text-muted)]">{t('reports:reportDelivery.dueAmount')}</div>
                <div className="font-data text-2xl font-semibold">{fmtMoney(reportLookupQuery.data.invoice.dueAmount)}</div>
                <div className="mt-2 text-sm text-[var(--color-text-muted)]">
                  {t('reports:reportDelivery.paid')} {fmtMoney(reportLookupQuery.data.invoice.paidAmount)} / {t('reports:reportDelivery.total')} {fmtMoney(reportLookupQuery.data.invoice.totalAmount)}
                </div>
                {reportLookupQuery.data.needsPayment ? (
                  <button
                    type="button"
                    className="btn-primary mt-4 w-full"
                    disabled={collectDue.isPending}
                    onClick={() => collectDue.mutate({
                      billId: reportLookupQuery.data!.invoice.id,
                      amount: reportLookupQuery.data!.invoice.dueAmount,
                      type: 'due',
                      paymentMethod: 'cash',
                      idempotencyKey: `report-due-${reportLookupQuery.data!.invoice.id}-${Date.now()}`,
                    })}
                  >
                    {t('reports:reportDelivery.collectDue')}
                  </button>
                ) : (
                  <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700">
                    {t('reports:reportDelivery.paymentCleared')}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('reports:reportDelivery.table.order')}</th>
                  <th>{t('reports:reportDelivery.table.patient')}</th>
                  <th>{t('reports:reportDelivery.table.doctor')}</th>
                  <th>{t('reports:reportDelivery.table.invoice')}</th>
                  <th>{t('reports:reportDelivery.table.ready')}</th>
                  <th>{t('reports:reportDelivery.table.due')}</th>
                  <th>{t('reports:reportDelivery.table.action')}</th>
                </tr>
              </thead>
              <tbody>
                {reportQueue.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-[var(--color-text-muted)]">
                      {t('reports:reportDelivery.noLabOrders')}
                    </td>
                  </tr>
                ) : reportQueue.slice(0, 20).map((row) => (
                  <tr key={row.lab_order_id}>
                    <td>
                      <div className="font-medium">{row.order_no ?? `Lab order #${row.lab_order_id}`}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{row.order_status ?? 'pending'}</div>
                    </td>
                    <td>
                      <div className="font-medium">{row.patient_name ?? 'Unknown patient'}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{row.patient_mobile ?? row.patient_code ?? '—'}</div>
                    </td>
                    <td>{row.doctor_name ?? '—'}</td>
                    <td>{row.invoice_no ?? '—'}</td>
                    <td>
                      <span className={`badge ${row.can_print ? 'badge-success' : 'badge-warning'}`}>
                        {fmtCount(row.ready_count)}/{fmtCount(row.item_count)}
                      </span>
                    </td>
                    <td>{fmtMoney(row.due_amount)}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-ghost text-sm"
                        disabled={!row.can_print}
                        onClick={() => window.open(buildLabReportPrintUrl(basePath, row.lab_order_id), '_blank')}
                      >
                        <Printer className="h-4 w-4" /> {t('reports:reportDelivery.table.print')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {canViewFinanceReports ? (
          <section id="shift-handover-report" className="card scroll-mt-24 p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-[var(--color-text)]">{isSupervisorReportRole(normalizedRole) ? 'Shift Handover Reports' : 'My Shift Handover Report'}</h2>
                <p className="text-sm text-[var(--color-text-muted)]">Select a report date and shift session, then generate the PDF any time — active or already closed.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  className="input min-w-[260px] text-sm"
                  value={selectedShiftSessionId || (shiftReport ? String(shiftReport.session.sessionId) : '')}
                  onChange={(event) => setSelectedShiftSessionId(event.target.value)}
                  disabled={loadingShiftReport || shiftReports.length === 0}
                  aria-label="Select shift session"
                >
                  {shiftReports.length === 0 ? <option value="">No shift found for selected date</option> : null}
                  {shiftReports.map((report) => (
                    <option key={report.session.sessionId} value={report.session.sessionId}>
                      {report.session.cashierName} • {report.session.counterName} • {report.session.openedAt ?? 'Unknown open'} {report.session.closedAt ? `→ ${report.session.closedAt}` : '→ Active'}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn-ghost text-sm" disabled={!shiftReport || loadingShiftReport} onClick={exportShiftReportCsv}>
                  <Download className="h-3.5 w-3.5" /> Export CSV
                </button>
                <button type="button" className="btn-secondary text-sm" disabled={!shiftReport || loadingShiftReport || finalizeShiftReport.isPending} onClick={handlePrintShiftReport}>
                  <Printer className="h-3.5 w-3.5" /> {finalizeShiftReport.isPending ? 'Finalizing...' : 'Generate PDF'}
                </button>
              </div>
            </div>
            {loadingShiftReport ? (
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[1, 2, 3, 4].map((item) => <div key={item} className="skeleton h-24 rounded-xl" />)}
              </div>
            ) : shiftReport ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
                  {[
                    { label: 'OPD serials', value: fmtCount(shiftReport.activity.serialCreated) },
                    { label: 'Doctor seen', value: fmtCount(shiftReport.activity.doctorSeen) },
                    { label: 'Patients', value: fmtCount(shiftReport.activity.patientsSeen) },
                    { label: 'Tests', value: fmtCount(shiftReport.activity.testItems) },
                    { label: 'Total received', value: fmtMoney(shiftReport.finance.totalReceived) },
                    { label: 'Expense', value: fmtMoney(shiftReport.finance.pettyExpense) },
                    { label: 'Transfer out', value: fmtMoney(shiftReport.finance.transferOut) },
                    { label: 'Expected cash', value: fmtMoney(shiftReport.finance.expectedCash) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                      <div className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{item.label}</div>
                      <div className="font-data mt-2 text-xl font-bold text-[var(--color-text-primary)]">{item.value}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-[var(--color-border)] p-4">
                    <h3 className="text-sm font-semibold">Cash reconciliation</h3>
                    <div className="mt-3 space-y-2 text-sm">
                      {[
                        ['Opening Cash', shiftReport.session.openingCash],
                        ['Cash Received', shiftReport.finance.cashReceived],
                        ['Accepted Transfer In', shiftReport.finance.acceptedTransferIn],
                        ['Doctor Payout', -shiftReport.finance.doctorPayout],
                        ['Petty Expense', -shiftReport.finance.pettyExpense],
                        ['Cash Transfer Out', -shiftReport.finance.transferOut],
                        ['Bank Deposit', -shiftReport.finance.bankDeposit],
                        ['Expected Drawer Cash', shiftReport.finance.expectedCash],
                        ['Counted Cash', shiftReport.finance.countedCash],
                        ['Variance', shiftReport.finance.variance],
                      ].map(([label, value]) => (
                        <div key={String(label)} className="flex justify-between border-b border-[var(--color-border)] py-1.5 last:border-0">
                          <span className="text-[var(--color-text-secondary)]">{label}</span>
                          <span className="font-semibold">{fmtMoney(Number(value))}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] p-4">
                    <h3 className="text-sm font-semibold">Report metadata</h3>
                    <div className="mt-3 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Report No</span><span className="font-medium">{shiftReport.audit.reportNo}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Cashier</span><span className="font-medium">{shiftReport.session.cashierName}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Counter</span><span className="font-medium">{shiftReport.session.counterName}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Opened</span><span className="font-medium">{shiftReport.session.openedAt ?? '—'}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Closed</span><span className="font-medium">{shiftReport.session.closedAt ?? 'Active shift'}</span></div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="mt-4 rounded-xl bg-[var(--color-bg-secondary)] p-4 text-sm text-[var(--color-text-muted)]">No active counter shift found for this user. Open a billing counter first, or ask admin to generate a closed-session report.</div>
            )}

            <div className="mt-5 rounded-xl border border-[var(--color-border)] p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Finalized handover history</h3>
                  <p className="text-xs text-[var(--color-text-muted)]">Saved immutable handover reports with acceptance status and variance.</p>
                </div>
                <button
                  type="button"
                  className="btn-ghost text-sm"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ['reports', 'shift-handover', 'history'] })}
                >
                  <RefreshCw className="h-3.5 w-3.5" /> Refresh history
                </button>
              </div>
              <div className="mt-3 overflow-x-auto">
                <table className="table-base">
                  <thead>
                    <tr>
                      <th>Report No</th>
                      <th>Cashier</th>
                      <th>Counter</th>
                      <th>Status</th>
                      <th className="text-right">Expected</th>
                      <th className="text-right">Counted</th>
                      <th className="text-right">Variance</th>
                      <th>Finalized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loadingShiftReportHistory ? (
                      <tr><td colSpan={8} className="py-6 text-center text-[var(--color-text-muted)]">Loading handover history...</td></tr>
                    ) : shiftReportHistory.length === 0 ? (
                      <tr><td colSpan={8} className="py-6 text-center text-[var(--color-text-muted)]">No finalized handover reports yet.</td></tr>
                    ) : shiftReportHistory.map((report) => (
                      <tr key={report.id}>
                        <td>
                          <div className="font-medium">{report.reportNo}</div>
                          <div className="text-xs text-[var(--color-text-muted)]">Session #{report.sessionId}</div>
                        </td>
                        <td>{report.cashierName || '—'}</td>
                        <td>{report.counterName || '—'}</td>
                        <td>
                          <span className={`badge ${report.status === 'accepted' ? 'badge-success' : 'badge-warning'}`}>
                            {report.status}
                          </span>
                          {report.acceptedByName ? <div className="text-xs text-[var(--color-text-muted)]">by {report.acceptedByName}</div> : null}
                        </td>
                        <td className="text-right font-medium">{fmtMoney(report.expectedCash)}</td>
                        <td className="text-right font-medium">{fmtMoney(report.countedCash)}</td>
                        <td className={`text-right font-semibold ${Math.abs(Number(report.variance ?? 0)) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{fmtMoney(report.variance)}</td>
                        <td>{report.finalizedAt ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        ) : null}

        {canViewFinanceReports ? (
          <>
        <div id="daily-collection-snapshot" className="scroll-mt-24">
        {loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[1, 2, 3, 4, 5, 6].map((item) => <div key={item} className="skeleton h-24 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <KPICard
              title={t('reports:finance.totalReceived')}
              value={fmtMoney(financeSummary?.total_received ?? 0)}
              icon={<DollarSign className="h-5 w-5" />}
              iconBg="bg-blue-50 text-blue-600"
            />
            <KPICard
              title={t('reports:finance.cashReceived')}
              value={fmtMoney(financeSummary?.cash_received ?? 0)}
              icon={<Wallet className="h-5 w-5" />}
              iconBg="bg-emerald-50 text-emerald-600"
            />
            <KPICard
              title={t('reports:finance.testCollection')}
              value={fmtMoney(serviceSummary?.test_amount ?? 0)}
              icon={<FileText className="h-5 w-5" />}
              iconBg="bg-cyan-50 text-cyan-600"
            />
            <KPICard
              title={t('reports:finance.doctorVisitCollection')}
              value={fmtMoney(serviceSummary?.doctor_visit_amount ?? 0)}
              icon={<TrendingUp className="h-5 w-5" />}
              iconBg="bg-violet-50 text-violet-600"
            />
            <KPICard
              title={t('reports:finance.testsToday')}
              value={fmtCount(serviceSummary?.test_count ?? 0)}
              icon={<Receipt className="h-5 w-5" />}
              iconBg="bg-amber-50 text-amber-600"
            />
            <KPICard
              title={t('reports:finance.patientsSeen')}
              value={fmtCount(serviceSummary?.total_patients_seen ?? 0)}
              icon={<Calendar className="h-5 w-5" />}
              iconBg="bg-rose-50 text-rose-600"
            />
          </div>
        )}
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
              <CreditCard className="h-4 w-4 text-[var(--color-primary)]" />
              {t('reports:paymentMethods.byPaymentMethod')}
            </h3>
            {paymentMethods.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">{t('reports:paymentMethods.noPaymentsFound')}</p>
            ) : (
              <div className="space-y-3">
                {paymentMethods.map((method) => {
                  const total = Number(method.total_amount ?? method.net_amount ?? method.gross_amount ?? 0);
                  const denominator = paymentMethodTotal || Number(financeSummary?.total_received ?? 0);
                  const pct = denominator > 0 ? Math.min(100, Math.round((Math.max(0, total) / denominator) * 100)) : 0;
                  return (
                    <div key={method.payment_method}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="font-medium">{t(`reports:paymentMethods.${method.payment_method}`, { defaultValue: method.payment_method })}</span>
                        <span className="text-[var(--color-text-muted)]">{fmtMoney(total)} ({pct}%)</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--color-bg)]">
                        <div className={`h-full rounded-full ${PM_COLOR[method.payment_method] ?? PM_COLOR.unknown}`} style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
              <Wallet className="h-4 w-4 text-[var(--color-primary)]" />
              {t('reports:dailySnapshot.title')}
            </h3>
            <div className="space-y-2">
              {[
                { label: t('reports:finance.currentCollection'), value: financeSummary?.current_collection ?? summary?.total_cash_sales ?? 0, positive: true },
                { label: t('reports:finance.dueCollection'), value: financeSummary?.due_collection ?? summary?.total_collection_from_receivable ?? 0, positive: true },
                { label: t('reports:finance.cashReceived'), value: financeSummary?.cash_received ?? 0, positive: true },
                { label: t('reports:finance.returnsRefunds'), value: financeSummary?.total_returns ?? 0, positive: false },
                { label: t('reports:finance.discountGiven'), value: financeSummary?.total_discounts ?? summary?.total_cash_discount_given ?? 0, positive: false },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between border-b border-[var(--color-border)] py-1.5 last:border-0">
                  <span className="text-sm text-[var(--color-text-secondary)]">{row.label}</span>
                  <span className={`text-sm font-medium ${row.positive ? 'text-emerald-600' : 'text-red-500'}`}>
                    {row.positive ? '+' : '-'}{fmtMoney(row.value)}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between border-t-2 border-[var(--color-border)] pt-2">
                <span className="text-sm font-bold">{t('reports:finance.netCollection')}</span>
                <span className="text-lg font-bold text-[var(--color-primary)]">{fmtMoney(financeSummary?.net_collection ?? summary?.net_collection ?? 0)}</span>
              </div>
            </div>
          </div>

          <div className="card p-5">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-[var(--color-text)]">
              <Receipt className="h-4 w-4 text-amber-500" />
              {t('reports:pendingDueBills')} ({dueBills.length})
            </h3>
            {dueBills.length === 0 ? (
              <p className="py-6 text-center text-sm text-[var(--color-text-muted)]">{t('reports:noPendingDues')}</p>
            ) : (
              <div className="space-y-2">
                <div className="rounded-lg bg-amber-50 p-3 text-sm font-medium text-amber-700">
                  {t('reports:totalDue')} {fmtMoney(totalDue)}
                </div>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                  {dueBills.slice(0, 20).map((bill) => (
                    <div key={bill.id} className="flex items-center justify-between border-b border-[var(--color-border)] py-1.5 last:border-0">
                      <div>
                        <p className="text-sm font-medium">{bill.invoice_no}</p>
                        <p className="text-xs text-[var(--color-text-muted)]">{bill.patient_name ?? `Bill #${bill.id}`}</p>
                      </div>
                      <span className="text-sm font-medium text-amber-600">{fmtMoney(getReceptionBillOutstanding(bill))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <section className="card p-5">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold">{t('reports:expense.title')}</h3>
              <p className="text-sm text-[var(--color-text-muted)]">Paid operating expenses and executed doctor payouts for the selected date. Approved-but-unpaid and rejected expenses are excluded.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold text-red-600">Paid total {fmtMoney(approvedExpenseTotal)}</div>
              <Link to={`${basePath}/reception/cash-operations`} className="btn-secondary text-sm">Open Cash Operations</Link>
            </div>
          </div>
          {dailyExpenses.length > 0 ? (
            <div className="mt-4 overflow-x-auto">
              <table className="table-base min-w-[960px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>{t('reports:expense.table.category')}</th>
                    <th>Details</th>
                    <th>Payment Method</th>
                    <th>Status</th>
                    <th className="text-right">Paid Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyExpenses.map((expense) => (
                    <tr key={expense.id}>
                      <td className="whitespace-nowrap text-sm text-[var(--color-text-muted)]">{expense.date ? String(expense.date).slice(0, 10) : date}</td>
                      <td>{t(`reports:expenseCategories.${expense.category}`, { defaultValue: expense.category })}</td>
                      <td className="max-w-[420px] text-sm text-[var(--color-text-muted)]">{expense.details || '—'}</td>
                      <td className="text-sm capitalize">{String(expense.payment_method || 'cash').replace(/_/g, ' ')}</td>
                      <td>
                        <span className={`badge ${expense.status === 'paid' || expense.status === 'approved' ? 'badge-success' : expense.status === 'pending' || expense.status === 'unpaid' ? 'badge-warning' : 'badge-danger'}`}>
                          {expense.status}
                        </span>
                      </td>
                      <td className="text-right font-medium text-red-600">{fmtMoney(expense.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg bg-[var(--color-bg-secondary)] px-4 py-8 text-center text-sm text-[var(--color-text-muted)]">No paid operating expenses or doctor payouts found for this date.</div>
          )}
        </section>

        <section id="doctor-performance-report" className="card scroll-mt-24 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-sm font-semibold">{t('reports:doctorReport.title')}</h3>
              <p className="text-sm text-[var(--color-text-muted)]">{t('reports:doctorReport.description')}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={exportDoctorCsv} className="btn-ghost text-sm">
                <Download className="h-3.5 w-3.5" /> {t('reports:doctorReport.exportCsv')}
              </button>
              <button onClick={() => handlePrintDoctorReport()} className="btn-secondary text-sm">
                <Printer className="h-3.5 w-3.5" /> {t('reports:doctorReport.printAllDoctors')}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="table-base">
              <thead>
                <tr>
                  <th>{t('reports:doctorReport.table.doctor')}</th>
                  <th>{t('reports:doctorReport.table.patients')}</th>
                  <th>{t('reports:doctorReport.table.visits')}</th>
                  <th>{t('reports:doctorReport.table.visitCollection')}</th>
                  <th>{t('reports:doctorReport.table.testsGiven')}</th>
                  <th>{t('reports:doctorReport.table.testOrders')}</th>
                  <th>{t('reports:doctorReport.table.testCollection')}</th>
                  <th>{t('reports:doctorReport.table.testCommission')}</th>
                  <th>{t('reports:doctorReport.table.testCommissionPercent', { defaultValue: 'Test Commission %' })}</th>
                  <th>{t('reports:doctorReport.table.commission')}</th>
                  <th>{t('reports:doctorReport.table.pdf')}</th>
                </tr>
              </thead>
              <tbody>
                {doctorSummaries.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-10 text-center text-[var(--color-text-muted)]">
                      {t('reports:doctorReport.noDoctorActivity')}
                    </td>
                  </tr>
                ) : doctorSummaries.map((doctor) => (
                  <tr key={doctor.doctor_id}>
                    <td className="font-medium">{doctor.doctor_name}</td>
                    <td>{fmtCount(doctor.patient_count)}</td>
                    <td>{fmtCount(doctor.doctor_visit_count)}</td>
                    <td>{fmtMoney(doctor.doctor_visit_amount)}</td>
                    <td>{fmtCount(doctor.test_count)}</td>
                    <td>{fmtCount(doctor.test_order_count)}</td>
                    <td>{fmtMoney(doctor.test_collection_amount)}</td>
                    <td>{fmtMoney(doctor.test_commission_amount ?? 0)}</td>
                    <td>{fmtPercent(getCommissionPercent(doctor.test_commission_amount ?? 0, doctor.test_collection_amount, doctor.test_commission_percent))}</td>
                    <td>{fmtMoney(doctor.commission_amount)}</td>
                    <td>
                      <button onClick={() => handlePrintDoctorReport(doctor)} className="btn-ghost text-sm">
                        <Printer className="h-4 w-4" /> {t('reports:reportDelivery.table.print')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Calendar className="h-4 w-4 text-[var(--color-primary)]" />
              {t('reports:transactions.title')} ({details.length})
            </h3>
            <button onClick={exportTransactions} className="btn-ghost text-sm">
              <Download className="h-3.5 w-3.5" /> {t('common:export', { defaultValue: 'Export' })}
            </button>
          </div>
          {details.length === 0 ? (
            <div className="py-12 text-center text-[var(--color-text-muted)]">
              <DollarSign className="mx-auto mb-2 h-8 w-8 opacity-30" />
              <p className="text-sm">{t('reports:transactions.noTransactions')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table-base">
                <thead>
                  <tr>
                    <th>{t('reports:transactions.table.number')}</th>
                    <th>{t('reports:transactions.table.type')}</th>
                    <th>{t('reports:transactions.table.amount')}</th>
                    <th>{t('reports:transactions.table.method')}</th>
                    <th>{t('reports:transactions.table.reference')}</th>
                    <th>{t('reports:transactions.table.time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {details.map((detail, index) => (
                    <tr key={detail.id}>
                      <td className="text-[var(--color-text-muted)]">{index + 1}</td>
                      <td>
                        <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-xs font-medium">
                          {t(`reports:txnTypes.${detail.transaction_type}`, { defaultValue: detail.transaction_type })}
                        </span>
                      </td>
                      <td className={`font-medium ${detail.transaction_type === 'SalesReturn' || detail.transaction_type === 'ReturnDeposit' || detail.transaction_type === 'CashDiscountGiven' ? 'text-red-500' : 'text-emerald-600'}`}>
                        {fmtMoney(detail.amount)}
                      </td>
                      <td className="capitalize text-sm">{detail.payment_method ?? '—'}</td>
                      <td className="max-w-[240px] truncate text-sm text-[var(--color-text-muted)]">{getCollectionDetailReference(detail)}</td>
                      <td className="text-sm text-[var(--color-text-muted)]">
                        {detail.created_at ? new Date(detail.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
          </>
        ) : (
          <section className="card border border-blue-100 bg-blue-50 p-5 text-sm text-blue-800">
            Financial collection, doctor-wise earning, due, and transaction reports are hidden for this role. Use the Test Report Delivery section above for report handover work.
          </section>
        )}
      </div>
    </DashboardLayout>
  );
}
