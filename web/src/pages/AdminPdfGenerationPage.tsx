import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Download, FileText, Printer, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../components/DashboardLayout';
import ReceptionTopBar from '../components/reception/ReceptionTopBar';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';
import { useAuth } from '../hooks/useAuth';
import { getTodayGMT6 } from '../lib/date-utils';
import { formatCurrency, formatDateTime } from '../lib/format';

export type ReportType =
  | 'dailyCollection'
  | 'paymentMethod'
  | 'userCollection'
  | 'dueBills'
  | 'invoiceSummary'
  | 'patientRegistration'
  | 'visitReport'
  | 'testReport'
  | 'reportDelivery'
  | 'doctorPerformance'
  | 'doctorPayout'
  | 'referralReport'
  | 'departmentIncome'
  | 'ipdAdmission'
  | 'serviceItemSales'
  | 'expenses'
  | 'cashActivity'
  | 'dailyDiscount'
  | 'refundReport'
  | 'shiftHandover'
  | 'auditLog';
type ReportCategory = 'Collection Reports' | 'Clinical / Patient Reports' | 'Doctor Reports' | 'Cash / Admin Reports';
type PageSize = 'a4' | 'a5';
type Orientation = 'portrait' | 'landscape';

type PdfPageProps = { role?: string };

export type ReportOption = {
  value: ReportType;
  title: string;
  description: string;
  category: ReportCategory;
};

export const reportCategories: ReportCategory[] = ['Collection Reports', 'Clinical / Patient Reports', 'Doctor Reports', 'Cash / Admin Reports'];

export const reportOptions: ReportOption[] = [
  { value: 'dailyCollection', title: 'Daily Collection Report', category: 'Collection Reports', description: 'Date-wise receipts, payment methods, billing reconciliation and transaction details. Discounts are shown as non-cash billing adjustments.' },
  { value: 'paymentMethod', title: 'Payment Method Report', category: 'Collection Reports', description: 'Cash, bKash, card, bank and other receipt method totals.' },
  { value: 'userCollection', title: 'User-wise Collection Report', category: 'Collection Reports', description: 'Cashier/reception user-wise receipts, due collection, non-cash invoice discounts, returns and net cash-in.' },
  { value: 'dueBills', title: 'Due Bills Report', category: 'Collection Reports', description: 'Outstanding bills and due collection follow-up.' },
  { value: 'invoiceSummary', title: 'Invoice Summary Report', category: 'Collection Reports', description: 'All available invoice rows with paid/due totals and bill status. ' },
  { value: 'patientRegistration', title: 'Patient Registration Report', category: 'Clinical / Patient Reports', description: 'New patient registrations with gender, location and contact summary.' },
  { value: 'visitReport', title: 'Visit Report', category: 'Clinical / Patient Reports', description: 'Doctor visit-only report with patients, visit count, billed amount and commission accrual.' },
  { value: 'testReport', title: 'Test Report', category: 'Clinical / Patient Reports', description: 'Diagnostic test-only report with invoices, net billed amount, allocated receipts, due and commission accrual.' },
  { value: 'reportDelivery', title: 'Report Delivery Queue', category: 'Clinical / Patient Reports', description: 'Ready/pending lab report delivery list.' },
  { value: 'departmentIncome', title: 'Department-wise Billing & Receipt Report', category: 'Clinical / Patient Reports', description: 'Service-category net billed amount and proportionally allocated receipts for OPD, diagnostic and other services.' },
  { value: 'ipdAdmission', title: 'IPD Admission Report', category: 'Clinical / Patient Reports', description: 'Admission, discharge and running admitted patient summary with ward/bed details.' },
  { value: 'serviceItemSales', title: 'Service Item Sales Report', category: 'Clinical / Patient Reports', description: 'Invoice item/service sales quantity, gross billed, discount and net billed amount.' },
  { value: 'doctorPerformance', title: 'Doctor Performance Report', category: 'Doctor Reports', description: 'Doctor-wise visits, tests, billed amounts and commission accruals.' },
  { value: 'doctorPayout', title: 'Doctor Payout Report', category: 'Doctor Reports', description: 'Doctor payable estimate from accrued visit, test and referral commissions.' },
  { value: 'referralReport', title: 'Referral Report', category: 'Doctor Reports', description: 'Doctor/referral-wise diagnostic orders, net billed amount and commission accrual.' },
  { value: 'expenses', title: 'Expense Report', category: 'Cash / Admin Reports', description: 'Approved, pending and rejected expense list with totals.' },
  { value: 'cashActivity', title: 'Cash Activity Report', category: 'Cash / Admin Reports', description: 'Cash in/out, bank deposit, transfers, patient payments and running balance.' },
  { value: 'dailyDiscount', title: 'Daily Discount Report', category: 'Cash / Admin Reports', description: 'Daily discount allocations grouped by invoice, including reason, approved by doctor, given by staff and discount percentages.' },
  { value: 'refundReport', title: 'Refund Report', category: 'Cash / Admin Reports', description: 'Sales return, deposit return and refund-style cash-out transactions.' },
  { value: 'shiftHandover', title: 'Shift Handover Report', category: 'Cash / Admin Reports', description: 'Cashier accountability, expected cash, counted cash and exceptions.' },
  { value: 'auditLog', title: 'Audit / Activity Log Report', category: 'Cash / Admin Reports', description: 'Cash activity and shift exception rows for admin review.' },
];


const SUPERVISOR_PDF_ROLES = ['hospital_admin', 'admin', 'md', 'director', 'accountant'];
const RECEPTION_PDF_REPORT_TYPES: ReportType[] = [
  'dailyCollection',
  'paymentMethod',
  'userCollection',
  'dueBills',
  'invoiceSummary',
  'patientRegistration',
  'visitReport',
  'testReport',
  'reportDelivery',
  'ipdAdmission',
  'serviceItemSales',
  'shiftHandover',
];

export const DAILY_CLOSING_PACK_REPORT_TYPES: ReportType[] = [
  'dailyCollection',
  'doctorPerformance',
  'paymentMethod',
  'userCollection',
  'dueBills',
  'cashActivity',
  'expenses',
  'shiftHandover',
];

function isSupervisorPdfRole(role: string): boolean {
  return SUPERVISOR_PDF_ROLES.includes(role);
}

export function getAvailablePdfReportOptions(role: string): ReportOption[] {
  if (isSupervisorPdfRole(role)) return reportOptions;
  return reportOptions.filter((option) => RECEPTION_PDF_REPORT_TYPES.includes(option.value));
}

export function getInitialPdfReportType(requestedReport: string | null | undefined, role: string): ReportType {
  const available = getAvailablePdfReportOptions(role);
  const match = available.find((option) => option.value === requestedReport);
  return match?.value ?? available[0]?.value ?? 'dailyCollection';
}

function money(value: unknown) {
  return formatCurrency(Number(value ?? 0), { fractionDigits: 2 });
}

function num(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizedStatus(value: unknown, fallback = 'unknown') {
  const status = String(value ?? '').trim().toLowerCase();
  return status || fallback;
}

function expenseApprovalStatus(row: any) {
  return normalizedStatus(row?.approval_status ?? row?.approvalStatus ?? row?.status);
}

function expensePaymentStatus(row: any) {
  return normalizedStatus(row?.payment_status ?? row?.paymentStatus, 'unpaid');
}

function transactionReference(row: any) {
  const invoiceNo = String(row?.invoice_no ?? row?.invoiceNo ?? '').trim();
  if (invoiceNo) return invoiceNo;
  return row?.description || row?.reference_id || row?.referenceId || '—';
}

function transactionTypeLabel(value: unknown) {
  const words = String(value ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '—';
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  const formatted = formatDateTime(value);
  return formatted === '—' ? String(value) : formatted;
}

function tableRows(rows: unknown[], columns: Array<{ label: string; render: (row: any, index: number) => unknown; align?: 'right' | 'center' }>) {
  if (!rows.length) return `<tr><td colspan="${columns.length}" class="empty">No data found for selected filters.</td></tr>`;
  return rows.map((row, index) => `
    <tr>${columns.map((column) => `<td class="${column.align ? column.align : ''}">${escapeHtml(column.render(row, index))}</td>`).join('')}</tr>
  `).join('');
}

type BuildReportBodyData = {
  collection?: any;
  expenses?: any;
  cashActivity?: any;
  shift?: any;
  dueBills?: any;
  discountReport?: any;
  includeSummary: boolean;
  includeDetails: boolean;
  pageSize: PageSize;
  orientation: Orientation;
};

export function buildReportBody(type: ReportType, data: BuildReportBodyData) {
  const collection = data.collection;
  const summary = collection?.summary ?? {};
  const finance = collection?.finance_summary ?? {};
  const billSummary = collection?.bill_summary ?? {};
  const services = collection?.service_summary ?? {};
  const serviceCollections = collection?.service_collection_summary ?? {};
  const paymentMethods = collection?.by_payment_method ?? [];
  const collectionSources = collection?.collection_sources ?? [];
  const normalizedPaymentMethods = collection?.payment_methods ?? [];
  const collectionExpenses = collection?.expenses ?? [];
  const cashClosing = collection?.cash_closing ?? {};
  const doctorRows = collection?.doctor_summaries ?? [];
  const transactions = collection?.details ?? [];
  const expenses = data.expenses?.expenses ?? [];
  const approvedExpenses = expenses.filter((row: any) => expenseApprovalStatus(row) === 'approved');
  const activity = data.cashActivity?.activity ?? [];
  const shift = data.shift?.report;
  const shiftReports = data.shift?.reports ?? (shift ? [shift] : []);
  const dueBills = (data.dueBills?.bills ?? []).filter((row: any) => row.status !== 'paid' && row.status !== 'cancelled');
  const reportQueue = collection?.report_delivery_queue ?? [];
  const testInvoiceRows = collection?.doctor_test_invoices ?? [];
  const invoiceSummaryRows = collection?.invoice_summary_rows ?? testInvoiceRows;
  const patientRows = collection?.patient_registration_rows ?? [];
  const patientSummary = collection?.patient_registration_summary ?? {};
  const ipdRows = collection?.ipd_admission_rows ?? [];
  const ipdSummary = collection?.ipd_admission_summary ?? {};
  const serviceItemRows = collection?.service_item_sales_rows ?? [];
  const employeeRows = collection?.by_employee ?? [];
  const discountRows = collection?.discount_rows ?? [];
  const isA5 = data.pageSize === 'a5';
  const useCompactWideColumns = isA5 || data.orientation === 'portrait';
  const detailLimit = isA5 ? (data.orientation === 'landscape' ? 35 : 24) : 500;
  const transactionHeaders = isA5
    ? '<th>#</th><th>Type</th><th>Reference</th><th class="right">Amount</th>'
    : '<th>#</th><th>Type</th><th>Payment Method</th><th>Invoice / Reference</th><th>Time</th><th class="right">Amount</th>';
  const transactionColumns = isA5 ? [
    { label: '#', render: (_r: any, i: number) => i + 1 },
    { label: 'Type', render: (r: any) => transactionTypeLabel(r.transaction_type) },
    { label: 'Reference', render: transactionReference },
    { label: 'Amount', align: 'right' as const, render: (r: any) => money(r.amount) },
  ] : [
    { label: '#', render: (_r: any, i: number) => i + 1 },
    { label: 'Type', render: (r: any) => transactionTypeLabel(r.transaction_type) },
    { label: 'Payment Method', render: (r: any) => r.payment_method ? transactionTypeLabel(r.payment_method) : '—' },
    { label: 'Invoice / Reference', render: transactionReference },
    { label: 'Time', render: (r: any) => fmtDateTime(r.created_at) },
    { label: 'Amount', align: 'right' as const, render: (r: any) => money(r.amount) },
  ];

  if (type === 'paymentMethod') {
    const total = paymentMethods.reduce((sum: number, row: any) => sum + num(row.total_amount ?? row.net_amount ?? row.gross_amount), 0);
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Methods</span><strong>${paymentMethods.length}</strong></div><div class="metric"><span>Total Received</span><strong>${money(total)}</strong></div></section>` : ''}
      <h3>Payment Method Summary</h3>
      <table><thead><tr><th>Method</th><th class="right">Transactions</th><th class="right">Amount</th><th class="right">Share</th></tr></thead><tbody>${tableRows(paymentMethods, [
        { label: 'Method', render: (r: any) => r.payment_method || '—' },
        { label: 'Transactions', align: 'right', render: (r: any) => num(r.transaction_count) },
        { label: 'Amount', align: 'right', render: (r: any) => money(r.total_amount ?? r.net_amount ?? r.gross_amount) },
        { label: 'Share', align: 'right', render: (r: any) => total > 0 ? `${Math.round((num(r.total_amount ?? r.net_amount ?? r.gross_amount) / total) * 100)}%` : '0%' },
      ])}</tbody></table>`;
  }

  if (type === 'userCollection') {
    const netTotal = employeeRows.reduce((sum: number, row: any) => sum + num(row.net), 0);
    const userHeaders = isA5
      ? '<th>User / Employee</th><th class="right">Receipts</th><th class="right">Discount</th><th class="right">Return</th><th class="right">Net Cash In</th>'
      : '<th>User / Employee</th><th class="right">Current Receipts</th><th class="right">Due Receipts</th><th class="right">Invoice Discount (Non-cash)</th><th class="right">Return</th><th class="right">Net Cash In</th>';
    const userColumns = isA5 ? [
      { label: 'User', render: (r: any) => r.employee_name || r.user_name || `Employee #${r.employee_id ?? '—'}` },
      { label: 'Receipts', align: 'right' as const, render: (r: any) => money(num(r.cash_sales) + num(r.collection_from_receivable)) },
      { label: 'Discount', align: 'right' as const, render: (r: any) => money(r.cash_discount_given) },
      { label: 'Return', align: 'right' as const, render: (r: any) => money(num(r.sales_return) + num(r.deposit_return)) },
      { label: 'Net Cash In', align: 'right' as const, render: (r: any) => money(r.net) },
    ] : [
      { label: 'User', render: (r: any) => r.employee_name || r.user_name || `Employee #${r.employee_id ?? '—'}` },
      { label: 'Current Receipts', align: 'right' as const, render: (r: any) => money(r.cash_sales) },
      { label: 'Due Receipts', align: 'right' as const, render: (r: any) => money(r.collection_from_receivable) },
      { label: 'Invoice Discount (Non-cash)', align: 'right' as const, render: (r: any) => money(r.cash_discount_given) },
      { label: 'Return', align: 'right' as const, render: (r: any) => money(num(r.sales_return) + num(r.deposit_return)) },
      { label: 'Net Cash In', align: 'right' as const, render: (r: any) => money(r.net) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Users</span><strong>${employeeRows.length}</strong></div><div class="metric"><span>Net Cash In</span><strong>${money(netTotal)}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>User-wise Collection${employeeRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><p class="muted">Invoice discounts are non-cash billing adjustments and are not deducted again from received money.</p><table><thead><tr>${userHeaders}</tr></thead><tbody>${tableRows(employeeRows.slice(0, detailLimit), userColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'invoiceSummary') {
    const invoiceRows = invoiceSummaryRows.map((row: any) => ({ source: row.source || row.bill_type || 'Invoice', invoice: row.invoice_no || row.invoiceNo || row.id || row.bill_id, patient: row.patient_name, doctor: row.doctor_name, status: row.status, total: row.total_amount ?? row.total ?? row.gross_amount, paid: row.paid_amount ?? row.paid, due: row.due_amount ?? row.outstanding ?? row.due }));
    const dueTotal = invoiceRows.reduce((sum: number, row: any) => sum + num(row.due), 0);
    const paidTotal = invoiceRows.reduce((sum: number, row: any) => sum + num(row.paid), 0);
    const invoiceHeaders = isA5
      ? '<th>Source</th><th>Invoice</th><th>Patient</th><th class="right">Paid</th><th class="right">Due</th>'
      : '<th>Source</th><th>Invoice</th><th>Patient</th><th>Doctor</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Due</th>';
    const invoiceColumns = isA5 ? [
      { label: 'Source', render: (r: any) => r.source },
      { label: 'Invoice', render: (r: any) => r.invoice || '—' },
      { label: 'Patient', render: (r: any) => r.patient || '—' },
      { label: 'Paid', align: 'right' as const, render: (r: any) => money(r.paid) },
      { label: 'Due', align: 'right' as const, render: (r: any) => money(r.due) },
    ] : [
      { label: 'Source', render: (r: any) => r.source },
      { label: 'Invoice', render: (r: any) => r.invoice || '—' },
      { label: 'Patient', render: (r: any) => r.patient || '—' },
      { label: 'Doctor', render: (r: any) => r.doctor || '—' },
      { label: 'Total', align: 'right' as const, render: (r: any) => money(r.total) },
      { label: 'Paid', align: 'right' as const, render: (r: any) => money(r.paid) },
      { label: 'Due', align: 'right' as const, render: (r: any) => money(r.due) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Invoices</span><strong>${invoiceRows.length}</strong></div><div class="metric"><span>Paid</span><strong>${money(paidTotal)}</strong></div><div class="metric"><span>Due</span><strong>${money(dueTotal)}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>Invoice Summary${invoiceRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${invoiceHeaders}</tr></thead><tbody>${tableRows(invoiceRows.slice(0, detailLimit), invoiceColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'departmentIncome') {
    const rows = [
      { department: 'OPD / Doctor Visit Bill', count: services.doctor_visit_count ?? billSummary.doctor_visit_count ?? 0, amount: billSummary.doctor_visit_bill_amount ?? services.doctor_visit_amount ?? 0 },
      { department: 'Lab / Diagnostic Test Bill', count: services.test_count ?? 0, amount: billSummary.test_bill_amount ?? services.test_amount ?? 0 },
      { department: 'Other Service Bill', count: '—', amount: billSummary.other_bill_amount ?? Math.max(0, num(billSummary.final_bill_amount) - num(billSummary.doctor_visit_bill_amount ?? services.doctor_visit_amount) - num(billSummary.test_bill_amount ?? services.test_amount)) },
    ];
    const collectionRows = [
      { department: 'OPD / Doctor Visit Allocated Receipts', count: '—', amount: serviceCollections.doctor_visit_collection ?? 0 },
      { department: 'Lab / Diagnostic Allocated Receipts', count: '—', amount: serviceCollections.test_collection ?? 0 },
      { department: 'Other Service Allocated Receipts', count: '—', amount: serviceCollections.other_collection ?? 0 },
    ];
    const total = rows.reduce((sum: number, row: any) => sum + num(row.amount), 0);
    const collectionTotal = collectionRows.reduce((sum: number, row: any) => sum + num(row.amount), 0);
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Bill Categories</span><strong>${rows.length}</strong></div><div class="metric"><span>Net Billed Amount</span><strong>${money(total)}</strong></div><div class="metric"><span>Allocated Receipts</span><strong>${money(collectionTotal)}</strong></div><div class="metric"><span>Due Receipts</span><strong>${money(finance.due_collection ?? summary.total_collection_from_receivable)}</strong></div></section>` : ''}
      <h3>Department / Service Billing &amp; Receipts</h3>
      <h4>Service-wise Net Billed Amount</h4>
      <table><thead><tr><th>Department / Service</th><th class="right">Count</th><th class="right">Bill Amount</th><th class="right">Share</th></tr></thead><tbody>${tableRows(rows, [
        { label: 'Department', render: (r: any) => r.department },
        { label: 'Count', align: 'right', render: (r: any) => r.count },
        { label: 'Amount', align: 'right', render: (r: any) => money(r.amount) },
        { label: 'Share', align: 'right', render: (r: any) => total > 0 ? `${Math.round((num(r.amount) / total) * 100)}%` : '0%' },
      ])}</tbody></table>
      <h3>Service-wise Receipt Allocation</h3>
      <p class="muted">Mixed-invoice receipts are allocated proportionally across service categories.</p>
      <table><thead><tr><th>Department / Service</th><th class="right">Count</th><th class="right">Allocated Receipt</th></tr></thead><tbody>${tableRows(collectionRows, [
        { label: 'Department', render: (r: any) => r.department },
        { label: 'Count', align: 'right', render: (r: any) => r.count },
        { label: 'Allocated Receipt', align: 'right', render: (r: any) => money(r.amount) },
      ])}</tbody></table>`;
  }

  if (type === 'ipdAdmission') {
    const ipdHeaders = isA5
      ? '<th>Admission</th><th>Patient</th><th>Ward / Bed</th><th>Status</th><th>Admitted</th>'
      : '<th>Admission No</th><th>Patient</th><th>Doctor</th><th>Ward / Bed</th><th>Status</th><th>Admitted</th><th>Discharged</th>';
    const ipdColumns = isA5 ? [
      { label: 'Admission', render: (r: any) => r.admission_no || r.id || '—' },
      { label: 'Patient', render: (r: any) => r.patient_name || '—' },
      { label: 'Ward', render: (r: any) => [r.ward_name, r.bed_number].filter(Boolean).join(' / ') || '—' },
      { label: 'Status', render: (r: any) => r.status || '—' },
      { label: 'Admitted', render: (r: any) => fmtDateTime(r.admission_date) },
    ] : [
      { label: 'Admission', render: (r: any) => r.admission_no || r.id || '—' },
      { label: 'Patient', render: (r: any) => r.patient_name || '—' },
      { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
      { label: 'Ward', render: (r: any) => [r.ward_name, r.bed_number].filter(Boolean).join(' / ') || '—' },
      { label: 'Status', render: (r: any) => r.status || '—' },
      { label: 'Admitted', render: (r: any) => fmtDateTime(r.admission_date) },
      { label: 'Discharged', render: (r: any) => r.discharge_date ? fmtDateTime(r.discharge_date) : '—' },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>New Admissions</span><strong>${num(ipdSummary.new_admissions)}</strong></div><div class="metric"><span>Discharges</span><strong>${num(ipdSummary.discharges)}</strong></div><div class="metric"><span>Running Admitted</span><strong>${num(ipdSummary.running_admitted)}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>IPD Admission Details${ipdRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${ipdHeaders}</tr></thead><tbody>${tableRows(ipdRows.slice(0, detailLimit), ipdColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'serviceItemSales') {
    const totalQty = serviceItemRows.reduce((sum: number, row: any) => sum + num(row.quantity), 0);
    const totalNet = serviceItemRows.reduce((sum: number, row: any) => sum + num(row.net_amount), 0);
    const serviceItemHeaders = isA5
      ? '<th>Category</th><th>Service / Item</th><th class="right">Qty</th><th class="right">Net</th>'
      : '<th>Category</th><th>Service / Item</th><th class="right">Qty</th><th class="right">Gross</th><th class="right">Discount</th><th class="right">Net</th>';
    const serviceItemColumns = isA5 ? [
      { label: 'Category', render: (r: any) => r.item_category || '—' },
      { label: 'Item', render: (r: any) => r.description || r.item_name || '—' },
      { label: 'Qty', align: 'right' as const, render: (r: any) => num(r.quantity) },
      { label: 'Net', align: 'right' as const, render: (r: any) => money(r.net_amount) },
    ] : [
      { label: 'Category', render: (r: any) => r.item_category || '—' },
      { label: 'Item', render: (r: any) => r.description || r.item_name || '—' },
      { label: 'Qty', align: 'right' as const, render: (r: any) => num(r.quantity) },
      { label: 'Gross', align: 'right' as const, render: (r: any) => money(r.gross_amount) },
      { label: 'Discount', align: 'right' as const, render: (r: any) => money(r.discount_amount) },
      { label: 'Net', align: 'right' as const, render: (r: any) => money(r.net_amount) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Items</span><strong>${serviceItemRows.length}</strong></div><div class="metric"><span>Total Qty</span><strong>${totalQty}</strong></div><div class="metric"><span>Net Billed Sales</span><strong>${money(totalNet)}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>Service Item Sales${serviceItemRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${serviceItemHeaders}</tr></thead><tbody>${tableRows(serviceItemRows.slice(0, detailLimit), serviceItemColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'patientRegistration') {
    const total = num(patientSummary.total_patients ?? patientRows.length);
    const withMobile = num(patientSummary.with_mobile);
    const withoutMobile = Math.max(0, total - withMobile);
    const patientHeaders = isA5
      ? '<th>Code</th><th>Name</th><th>Mobile</th><th>Area</th><th>Time</th>'
      : '<th>Code</th><th>Name</th><th>Mobile</th><th>Gender</th><th>Area</th><th>Time</th>';
    const patientColumns = isA5 ? [
      { label: 'Code', render: (r: any) => r.patient_code || r.uhid || r.id || '—' },
      { label: 'Name', render: (r: any) => r.name || '—' },
      { label: 'Mobile', render: (r: any) => r.mobile || r.guardian_mobile || '—' },
      { label: 'Area', render: (r: any) => [r.district, r.upazila].filter(Boolean).join(', ') || '—' },
      { label: 'Time', render: (r: any) => fmtDateTime(r.created_at) },
    ] : [
      { label: 'Code', render: (r: any) => r.patient_code || r.uhid || r.id || '—' },
      { label: 'Name', render: (r: any) => r.name || '—' },
      { label: 'Mobile', render: (r: any) => r.mobile || r.guardian_mobile || '—' },
      { label: 'Gender', render: (r: any) => r.gender || '—' },
      { label: 'Area', render: (r: any) => [r.district, r.upazila].filter(Boolean).join(', ') || '—' },
      { label: 'Time', render: (r: any) => fmtDateTime(r.created_at) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>New Patients</span><strong>${total}</strong></div><div class="metric"><span>With Mobile</span><strong>${withMobile}</strong></div><div class="metric"><span>Without Mobile</span><strong>${withoutMobile}</strong></div></section>` : ''}
      <h3>Patient Registration Summary</h3>
      <table><thead><tr><th>Gender</th><th class="right">Count</th></tr></thead><tbody>${tableRows(patientSummary.by_gender ?? [], [
        { label: 'Gender', render: (r: any) => r.gender || 'Unknown' },
        { label: 'Count', align: 'right', render: (r: any) => num(r.count) },
      ])}</tbody></table>
      ${data.includeDetails ? `<h3>Patient Registration Details${patientRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${patientHeaders}</tr></thead><tbody>${tableRows(patientRows.slice(0, detailLimit), patientColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'visitReport') {
    const totalPatients = doctorRows.reduce((sum: number, row: any) => sum + num(row.patient_count), 0);
    const totalVisits = doctorRows.reduce((sum: number, row: any) => sum + num(row.doctor_visit_count), 0);
    const totalBillAmount = doctorRows.reduce((sum: number, row: any) => sum + num(row.doctor_visit_amount), 0);
    const totalCommission = doctorRows.reduce((sum: number, row: any) => sum + num(row.consultation_commission_amount), 0);
    const visitRows = doctorRows.filter((row: any) => num(row.patient_count) > 0 || num(row.doctor_visit_count) > 0 || num(row.doctor_visit_amount) > 0);
    const visitHeaders = isA5
      ? '<th>Doctor</th><th class="right">Patients</th><th class="right">Visits</th><th class="right">Bill Amount</th>'
      : '<th>Doctor</th><th class="right">Patients</th><th class="right">Visits</th><th class="right">Visit Bill Amount</th><th class="right">Commission Accrued</th>';
    const visitColumns = isA5 ? [
      { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
      { label: 'Patients', align: 'right' as const, render: (r: any) => num(r.patient_count) },
      { label: 'Visits', align: 'right' as const, render: (r: any) => num(r.doctor_visit_count) },
      { label: 'Bill Amount', align: 'right' as const, render: (r: any) => money(r.doctor_visit_amount) },
    ] : [
      { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
      { label: 'Patients', align: 'right' as const, render: (r: any) => num(r.patient_count) },
      { label: 'Visits', align: 'right' as const, render: (r: any) => num(r.doctor_visit_count) },
      { label: 'Visit Bill Amount', align: 'right' as const, render: (r: any) => money(r.doctor_visit_amount) },
      { label: 'Commission Accrued', align: 'right' as const, render: (r: any) => money(r.consultation_commission_amount) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Patients</span><strong>${totalPatients}</strong></div><div class="metric"><span>Visits</span><strong>${totalVisits}</strong></div><div class="metric"><span>Visit Bill Amount</span><strong>${money(totalBillAmount)}</strong></div><div class="metric"><span>Commission Accrued</span><strong>${money(totalCommission)}</strong></div></section>` : ''}
      <h3>Visit Summary</h3>
      <p class="muted">Visit bill amount and commission accrual are shown separately; this report does not treat commission as a receipt or expense.</p>
      <table><thead><tr><th>Metric</th><th class="right">Value</th></tr></thead><tbody>
        <tr><td>Total Patients</td><td class="right">${totalPatients}</td></tr>
        <tr><td>Total Visits</td><td class="right">${totalVisits}</td></tr>
        <tr><td>Visit Bill Amount</td><td class="right">${money(totalBillAmount)}</td></tr>
        <tr><td>Commission Accrued</td><td class="right">${money(totalCommission)}</td></tr>
      </tbody></table>
      ${data.includeDetails ? `<h3>Doctor Wise Visits${visitRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${visitHeaders}</tr></thead><tbody>${tableRows(visitRows.slice(0, detailLimit), visitColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'testReport') {
    const totalTests = testInvoiceRows.reduce((sum: number, row: any) => sum + num(row.test_count), 0) || doctorRows.reduce((sum: number, row: any) => sum + num(row.test_count), 0) || num(services.test_count);
    const totalGross = testInvoiceRows.reduce((sum: number, row: any) => sum + num(row.gross_amount), 0);
    const totalDiscount = testInvoiceRows.reduce((sum: number, row: any) => sum + num(row.discount_amount), 0);
    const totalNetTestBill = testInvoiceRows.reduce((sum: number, row: any) => sum + num(row.test_collection_amount), 0) || doctorRows.reduce((sum: number, row: any) => sum + num(row.test_collection_amount), 0) || num(services.test_amount);
    const totalPaid = testInvoiceRows.reduce((sum: number, row: any) => sum + num(row.paid_amount), 0);
    const totalDue = testInvoiceRows.reduce((sum: number, row: any) => sum + num(row.due_amount), 0);
    const totalCashCollection = num(serviceCollections.test_collection);
    const totalCommission = testInvoiceRows.reduce((sum: number, row: any) => sum + num(row.test_commission_amount), 0) || doctorRows.reduce((sum: number, row: any) => sum + num(row.test_commission_amount), 0);
    const doctorTestRows = doctorRows.filter((row: any) => num(row.test_count) > 0 || num(row.test_collection_amount) > 0 || num(row.test_order_count) > 0);
    const invoiceDetailRows = testInvoiceRows.slice(0, detailLimit);
    const invoiceHeaders = useCompactWideColumns
      ? '<th>Invoice</th><th>Patient</th><th class="right">Count</th><th class="right">Net Test Bill</th><th class="right">Invoice Due</th>'
      : '<th>Invoice</th><th>Date</th><th>Patient</th><th>Doctor</th><th class="right">Count</th><th class="right">Gross</th><th class="right">Discount</th><th class="right">Net Test Bill</th><th class="right">Invoice Paid</th><th class="right">Invoice Due</th><th class="right">Commission</th>';
    const invoiceColumns = useCompactWideColumns ? [
      { label: 'Invoice', render: (r: any) => r.invoice_no || r.bill_id || '—' },
      { label: 'Patient', render: (r: any) => r.patient_name || '—' },
      { label: 'Count', align: 'right' as const, render: (r: any) => num(r.test_count) },
      { label: 'Net Test Bill', align: 'right' as const, render: (r: any) => money(r.test_collection_amount) },
      { label: 'Invoice Due', align: 'right' as const, render: (r: any) => money(r.due_amount) },
    ] : [
      { label: 'Invoice', render: (r: any) => r.invoice_no || r.bill_id || '—' },
      { label: 'Date', render: (r: any) => fmtDateTime(r.invoice_date) },
      { label: 'Patient', render: (r: any) => r.patient_name || '—' },
      { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
      { label: 'Count', align: 'right' as const, render: (r: any) => num(r.test_count) },
      { label: 'Gross', align: 'right' as const, render: (r: any) => money(r.gross_amount) },
      { label: 'Discount', align: 'right' as const, render: (r: any) => money(r.discount_amount) },
      { label: 'Net Test Bill', align: 'right' as const, render: (r: any) => money(r.test_collection_amount) },
      { label: 'Invoice Paid', align: 'right' as const, render: (r: any) => money(r.paid_amount) },
      { label: 'Invoice Due', align: 'right' as const, render: (r: any) => money(r.due_amount) },
      { label: 'Commission', align: 'right' as const, render: (r: any) => money(r.test_commission_amount) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Tests</span><strong>${totalTests}</strong></div><div class="metric"><span>Net Test Bill</span><strong>${money(totalNetTestBill)}</strong></div><div class="metric"><span>Allocated Test Receipts</span><strong>${money(totalCashCollection)}</strong></div><div class="metric"><span>Invoice Due</span><strong>${money(totalDue)}</strong></div><div class="metric"><span>Commission Accrued</span><strong>${money(totalCommission)}</strong></div></section>` : ''}
      <h3>Test Summary</h3>
      <table><thead><tr><th>Metric</th><th class="right">Value</th></tr></thead><tbody>
        <tr><td>Test Items</td><td class="right">${totalTests}</td></tr>
        <tr><td>Gross Test Bill</td><td class="right">${money(totalGross || totalNetTestBill + totalDiscount)}</td></tr>
        <tr><td>Invoice Discount</td><td class="right">${money(totalDiscount)}</td></tr>
        <tr><td>Net Test Bill</td><td class="right">${money(totalNetTestBill)}</td></tr>
        <tr><td>Allocated Test Receipts</td><td class="right">${money(totalCashCollection)}</td></tr>
        <tr><td>Invoice Paid (all services)</td><td class="right">${money(totalPaid)}</td></tr>
        <tr><td>Invoice Due (all services)</td><td class="right">${money(totalDue)}</td></tr>
        <tr><td>Commission Accrued</td><td class="right">${money(totalCommission)}</td></tr>
      </tbody></table>
      <h3>Doctor Wise Test Summary</h3>
      <table><thead><tr><th>Doctor</th><th class="right">Orders</th><th class="right">Tests</th><th class="right">Net Test Bill</th><th class="right">Commission Accrued</th></tr></thead><tbody>${tableRows(doctorTestRows, [
        { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
        { label: 'Orders', align: 'right', render: (r: any) => num(r.test_order_count) },
        { label: 'Tests', align: 'right', render: (r: any) => num(r.test_count) },
        { label: 'Net Test Bill', align: 'right', render: (r: any) => money(r.test_collection_amount) },
        { label: 'Commission Accrued', align: 'right', render: (r: any) => money(r.test_commission_amount) },
      ])}</tbody></table>
      ${data.includeDetails ? `<h3>Test Invoice Details${testInvoiceRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${invoiceHeaders}</tr></thead><tbody>${tableRows(invoiceDetailRows, invoiceColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'doctorPayout') {
    const payable = doctorRows.reduce((sum: number, row: any) => sum + num(row.commission_amount), 0);
    const payoutHeaders = isA5
      ? '<th>Doctor</th><th class="right">Visit Comm.</th><th class="right">Test Comm.</th><th class="right">Other</th><th class="right">Payable</th>'
      : '<th>Doctor</th><th class="right">Visit Commission Accrued</th><th class="right">Net Test Bill</th><th class="right">Test Commission Accrued</th><th class="right">Referral / Other Accrued</th><th class="right">Estimated Payable</th>';
    const payoutColumns = isA5 ? [
      { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
      { label: 'Visit Commission', align: 'right' as const, render: (r: any) => money(r.consultation_commission_amount) },
      { label: 'Test Commission', align: 'right' as const, render: (r: any) => money(r.test_commission_amount) },
      { label: 'Other', align: 'right' as const, render: (r: any) => money(r.referral_commission_amount) },
      { label: 'Payable', align: 'right' as const, render: (r: any) => money(r.commission_amount) },
    ] : [
      { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
      { label: 'Visit Commission Accrued', align: 'right' as const, render: (r: any) => money(r.consultation_commission_amount) },
      { label: 'Net Test Bill', align: 'right' as const, render: (r: any) => money(r.test_collection_amount ?? r.test_amount ?? r.test_bill_amount) },
      { label: 'Test Commission Accrued', align: 'right' as const, render: (r: any) => money(r.test_commission_amount) },
      { label: 'Referral / Other Accrued', align: 'right' as const, render: (r: any) => money(r.referral_commission_amount) },
      { label: 'Estimated Payable', align: 'right' as const, render: (r: any) => money(r.commission_amount) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Doctors</span><strong>${doctorRows.length}</strong></div><div class="metric"><span>Estimated Payable</span><strong>${money(payable)}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>Doctor Payout Estimate${doctorRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${payoutHeaders}</tr></thead><tbody>${tableRows(doctorRows.slice(0, detailLimit), payoutColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'referralReport') {
    const referralRows = doctorRows.filter((row: any) => num(row.test_order_count) > 0 || num(row.test_collection_amount) > 0 || num(row.referral_commission_amount) > 0);
    const totalTestBill = referralRows.reduce((sum: number, row: any) => sum + num(row.test_collection_amount), 0);
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Referrers</span><strong>${referralRows.length}</strong></div><div class="metric"><span>Net Test Bill</span><strong>${money(totalTestBill)}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>Referral / Doctor Test Business${referralRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr><th>Doctor / Referrer</th><th class="right">Orders</th><th class="right">Tests</th><th class="right">Net Test Bill</th><th class="right">Commission Accrued</th></tr></thead><tbody>${tableRows(referralRows.slice(0, detailLimit), [
        { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
        { label: 'Orders', align: 'right', render: (r: any) => num(r.test_order_count) },
        { label: 'Tests', align: 'right', render: (r: any) => num(r.test_count) },
        { label: 'Net Test Bill', align: 'right', render: (r: any) => money(r.test_collection_amount) },
        { label: 'Commission Accrued', align: 'right', render: (r: any) => money(num(r.test_commission_amount) + num(r.referral_commission_amount)) },
      ])}</tbody></table>` : ''}`;
  }

  if (type === 'doctorPerformance') {
    const totalPatients = doctorRows.reduce((sum: number, row: any) => sum + num(row.patient_count), 0);
    const totalVisits = doctorRows.reduce((sum: number, row: any) => sum + num(row.doctor_visit_count), 0);
    const visitBillAmount = doctorRows.reduce((sum: number, row: any) => sum + num(row.doctor_visit_amount), 0);
    const consultationCommission = doctorRows.reduce((sum: number, row: any) => sum + num(row.consultation_commission_amount), 0);
    const testOrders = doctorRows.reduce((sum: number, row: any) => sum + num(row.test_order_count), 0);
    const testItems = doctorRows.reduce((sum: number, row: any) => sum + num(row.test_count), 0);
    const testBillAmount = doctorRows.reduce((sum: number, row: any) => sum + num(row.test_collection_amount), 0);
    const testCommission = doctorRows.reduce((sum: number, row: any) => sum + num(row.test_commission_amount), 0);
    const referralCommission = doctorRows.reduce((sum: number, row: any) => sum + num(row.referral_commission_amount), 0);
    const totalCommission = doctorRows.reduce((sum: number, row: any) => sum + num(row.commission_amount), 0);
    const totalBilled = visitBillAmount + testBillAmount;
    const sectionRows = [
      { name: 'Consultation / Doctor Visit', count: `${totalVisits} visits · ${totalPatients} patients`, billed: visitBillAmount, commission: consultationCommission },
      { name: 'Diagnostic Tests / Investigation', count: `${testItems} tests · ${testOrders} orders`, billed: testBillAmount, commission: testCommission },
      { name: 'Referral / Other Commission', count: '—', billed: 0, commission: referralCommission },
    ];
    const doctorHeaders = useCompactWideColumns
      ? '<th>Doctor</th><th class="right">Visits</th><th class="right">Visit Bill</th><th class="right">Tests</th><th class="right">Commission</th>'
      : '<th>Doctor</th><th class="right">Patient</th><th class="right">Visit</th><th class="right">Visit Bill Amount</th><th class="right">Test Order</th><th class="right">Net Test Bill</th><th class="right">Test Commission Accrued</th><th class="right">Total Commission Accrued</th>';
    const doctorColumns = useCompactWideColumns ? [
      { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
      { label: 'Visits', align: 'right' as const, render: (r: any) => num(r.doctor_visit_count) },
      { label: 'Visit Bill', align: 'right' as const, render: (r: any) => money(r.doctor_visit_amount) },
      { label: 'Tests', align: 'right' as const, render: (r: any) => num(r.test_count) },
      { label: 'Commission', align: 'right' as const, render: (r: any) => money(r.commission_amount) },
    ] : [
      { label: 'Doctor', render: (r: any) => r.doctor_name || '—' },
      { label: 'Patient', align: 'right' as const, render: (r: any) => num(r.patient_count) },
      { label: 'Visit', align: 'right' as const, render: (r: any) => num(r.doctor_visit_count) },
      { label: 'Visit Bill Amount', align: 'right' as const, render: (r: any) => money(r.doctor_visit_amount) },
      { label: 'Test Order', align: 'right' as const, render: (r: any) => num(r.test_order_count) },
      { label: 'Net Test Bill', align: 'right' as const, render: (r: any) => money(r.test_collection_amount) },
      { label: 'Test Commission Accrued', align: 'right' as const, render: (r: any) => money(r.test_commission_amount) },
      { label: 'Total Commission Accrued', align: 'right' as const, render: (r: any) => money(r.commission_amount) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Doctors</span><strong>${doctorRows.length}</strong></div><div class="metric"><span>Visits</span><strong>${totalVisits}</strong></div><div class="metric"><span>Visit Bill Amount</span><strong>${money(visitBillAmount)}</strong></div><div class="metric"><span>Tests</span><strong>${testItems}</strong></div><div class="metric"><span>Net Test Bill</span><strong>${money(testBillAmount)}</strong></div><div class="metric"><span>Commission Accrued</span><strong>${money(totalCommission)}</strong></div></section>` : ''}
      <p class="muted">This report shows billed business and commission accruals. It does not imply that the bill was fully received or that commission was paid.</p>
      <h3>Category Summary</h3>
      <table><thead><tr><th>Category</th><th>Count</th><th class="right">Billed Amount</th><th class="right">Commission Accrued</th></tr></thead><tbody>
        ${tableRows(sectionRows, [
          { label: 'Category', render: (r) => r.name },
          { label: 'Count', render: (r) => r.count },
          { label: 'Billed Amount', align: 'right', render: (r) => money(r.billed) },
          { label: 'Commission Accrued', align: 'right', render: (r) => money(r.commission) },
        ])}
        <tr><td><strong>Total</strong></td><td><strong>${totalVisits + testItems}</strong></td><td class="right"><strong>${money(totalBilled)}</strong></td><td class="right"><strong>${money(totalCommission)}</strong></td></tr>
      </tbody></table>
      ${data.includeDetails ? `<h3>Doctor Wise Performance${doctorRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${doctorHeaders}</tr></thead><tbody>${tableRows(doctorRows.slice(0, detailLimit), doctorColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'expenses') {
    const submitted = expenses.reduce((sum: number, row: any) => sum + num(row.amount), 0);
    const approved = approvedExpenses.reduce((sum: number, row: any) => sum + num(row.amount), 0);
    const pending = expenses
      .filter((row: any) => expenseApprovalStatus(row) === 'pending')
      .reduce((sum: number, row: any) => sum + num(row.amount), 0);
    const byCategory = Object.values(approvedExpenses.reduce((acc: Record<string, any>, row: any) => {
      const key = row.category || 'Uncategorized';
      acc[key] = acc[key] || { category: key, count: 0, amount: 0 };
      acc[key].count += 1;
      acc[key].amount += num(row.amount);
      return acc;
    }, {}));
    const byStatus = Object.values(expenses.reduce((acc: Record<string, any>, row: any) => {
      const key = expenseApprovalStatus(row);
      acc[key] = acc[key] || { status: key, count: 0, amount: 0 };
      acc[key].count += 1;
      acc[key].amount += num(row.amount);
      return acc;
    }, {}));
    const expenseDetailRows = expenses.slice(0, detailLimit);
    const expenseHeaders = isA5
      ? '<th>Category</th><th>Purpose</th><th>Approval</th><th>Payment</th><th class="right">Amount</th>'
      : data.orientation === 'portrait'
        ? '<th>Date</th><th>Category</th><th>Purpose</th><th>Approval</th><th>Payment</th><th class="right">Amount</th>'
        : '<th>#</th><th>Date</th><th>Category</th><th>Purpose</th><th>Approval</th><th>Payment</th><th class="right">Amount</th>';
    const expenseColumns = isA5 ? [
      { label: 'Category', render: (r: any) => r.category || '—' },
      { label: 'Purpose', render: (r: any) => r.description || '—' },
      { label: 'Approval', render: expenseApprovalStatus },
      { label: 'Payment', render: expensePaymentStatus },
      { label: 'Amount', align: 'right' as const, render: (r: any) => money(r.amount) },
    ] : data.orientation === 'portrait' ? [
      { label: 'Date', render: (r: any) => r.date || r.created_at || '—' },
      { label: 'Category', render: (r: any) => r.category || '—' },
      { label: 'Purpose', render: (r: any) => r.description || '—' },
      { label: 'Approval', render: expenseApprovalStatus },
      { label: 'Payment', render: expensePaymentStatus },
      { label: 'Amount', align: 'right' as const, render: (r: any) => money(r.amount) },
    ] : [
      { label: '#', render: (_r: any, i: number) => i + 1 },
      { label: 'Date', render: (r: any) => r.date || r.created_at || '—' },
      { label: 'Category', render: (r: any) => r.category || '—' },
      { label: 'Purpose', render: (r: any) => r.description || '—' },
      { label: 'Approval', render: expenseApprovalStatus },
      { label: 'Payment', render: expensePaymentStatus },
      { label: 'Amount', align: 'right' as const, render: (r: any) => money(r.amount) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Submitted Amount</span><strong>${money(submitted)}</strong></div><div class="metric"><span>Approved Requests</span><strong>${money(approved)}</strong></div><div class="metric"><span>Pending Requests</span><strong>${money(pending)}</strong></div><div class="metric"><span>Requests</span><strong>${expenses.length}</strong></div></section>` : ''}
      <h3>Approved Expense Category Summary</h3>
      <table><thead><tr><th>Category</th><th class="right">Count</th><th class="right">Amount</th></tr></thead><tbody>${tableRows(byCategory, [{ label: 'Category', render: (r) => r.category }, { label: 'Count', align: 'right', render: (r) => r.count }, { label: 'Amount', align: 'right', render: (r) => money(r.amount) }])}</tbody></table>
      <h3>Approval Status Summary</h3>
      <table><thead><tr><th>Status</th><th class="right">Count</th><th class="right">Amount</th></tr></thead><tbody>${tableRows(byStatus, [{ label: 'Status', render: (r) => r.status }, { label: 'Count', align: 'right', render: (r) => r.count }, { label: 'Amount', align: 'right', render: (r) => money(r.amount) }])}</tbody></table>
      ${data.includeDetails ? `<h3>Expense Details${expenses.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${expenseHeaders}</tr></thead><tbody>${tableRows(expenseDetailRows, expenseColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'dailyDiscount') {
    const items = data.discountReport?.items || [];
    const summary = data.discountReport?.summary || { total_discount_given: 0, discounted_bills_count: 0, average_discount: 0 };
    const detailRows = items.slice(0, detailLimit);
    const detailHeaders = useCompactWideColumns
      ? '<th>Invoice</th><th>Patient</th><th>Service</th><th>User</th><th class="right">Discount</th>'
      : '<th>Invoice No</th><th>Patient Name</th><th>Date &amp; Time</th><th>Service / Type</th><th class="right">Gross Amount</th><th class="right">Discount Amount</th><th class="right">Discount %</th><th>Reason</th><th>Approved By</th><th>Given By</th><th>User</th><th>Counter</th>';
    const detailColumns = useCompactWideColumns ? [
      { label: 'Invoice', render: (r: any) => r.invoice_no || '—' },
      { label: 'Patient', render: (r: any) => r.patient_name || '—' },
      { label: 'Service', render: (r: any) => r.service || '—' },
      { label: 'User', render: (r: any) => r.given_by || r.user || '—' },
      { label: 'Discount', align: 'right' as const, render: (r: any) => `${money(r.discount_amount)} (${Number(r.discount_percent ?? 0).toFixed(1)}%)` },
    ] : [
      { label: 'Invoice No', render: (r: any) => r.invoice_no || '—' },
      { label: 'Patient Name', render: (r: any) => r.patient_name || '—' },
      { label: 'Date & Time', render: (r: any) => fmtDateTime(r.created_at) },
      { label: 'Service / Type', render: (r: any) => r.service || '—' },
      { label: 'Gross Amount', align: 'right' as const, render: (r: any) => money(r.gross_amount) },
      { label: 'Discount Amount', align: 'right' as const, render: (r: any) => money(r.discount_amount) },
      { label: 'Discount %', align: 'right' as const, render: (r: any) => `${Number(r.discount_percent ?? 0).toFixed(1)}%` },
      { label: 'Reason', render: (r: any) => r.reason || '—' },
      { label: 'Approved By', render: (r: any) => r.approved_by || '—' },
      { label: 'Given By', render: (r: any) => r.given_by || '—' },
      { label: 'User', render: (r: any) => r.user || '—' },
      { label: 'Counter', render: (r: any) => r.counter || '—' },
    ];
    return `
      ${data.includeSummary ? `
        <section class="summary-grid">
          <div class="metric"><span>Total Discount Given</span><strong>${money(summary.total_discount_given)}</strong></div>
          <div class="metric"><span>Discounted Bills Count</span><strong>${summary.discounted_bills_count}</strong></div>
          <div class="metric"><span>Average Discount</span><strong>${money(summary.average_discount)}</strong></div>
        </section>
      ` : ''}
      ${data.includeDetails ? `
        <h3>Discount Allocation Details${items.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3>
        <table><thead><tr>${detailHeaders}</tr></thead><tbody>${tableRows(detailRows, detailColumns)}</tbody></table>
      ` : ''}
    `;
  }

  if (type === 'refundReport') {
    const rows = transactions.filter((row: any) => {
      const txn = String(row.transaction_type ?? '').toLowerCase();
      return txn.includes('return') || txn.includes('refund');
    });
    const total = rows.reduce((sum: number, row: any) => sum + num(row.amount), 0) || num(finance.total_returns);
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Refund / Return Rows</span><strong>${rows.length}</strong></div><div class="metric"><span>Total Return</span><strong>${money(total)}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>Refund / Return Details${rows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr><th>Type</th><th>Reference</th><th>Method</th><th>Time</th><th class="right">Amount</th></tr></thead><tbody>${tableRows(rows.slice(0, detailLimit), [
        { label: 'Type', render: (r: any) => r.transaction_type || 'Return' },
        { label: 'Reference', render: (r: any) => r.description || r.reference_id || '—' },
        { label: 'Method', render: (r: any) => r.payment_method || '—' },
        { label: 'Time', render: (r: any) => fmtDateTime(r.created_at) },
        { label: 'Amount', align: 'right', render: (r: any) => money(r.amount) },
      ])}</tbody></table>` : ''}`;
  }

  if (type === 'cashActivity') {
    let running = 0;
    const rows = [...activity].reverse().map((row: any) => {
      const movement = String(row.movementType ?? '').toLowerCase();
      const amount = Number(row.amount ?? 0);
      const cashIn = movement === 'cash_in' || (movement !== 'cash_out' && amount >= 0) ? Math.abs(amount) : 0;
      const cashOut = movement === 'cash_out' || movement === 'cash_drop' || amount < 0 ? Math.abs(amount) : 0;
      running += cashIn - cashOut;
      return { ...row, cashIn, cashOut, running };
    });
    const totalIn = rows.reduce((sum, row) => sum + row.cashIn, 0);
    const totalOut = rows.reduce((sum, row) => sum + row.cashOut, 0);
    const byType = Object.values(rows.reduce((acc: Record<string, any>, row: any) => {
      const key = row.referenceType || row.movementType || row.source || 'cash_activity';
      acc[key] = acc[key] || { type: key, count: 0, cashIn: 0, cashOut: 0, net: 0 };
      acc[key].count += 1;
      acc[key].cashIn += num(row.cashIn);
      acc[key].cashOut += num(row.cashOut);
      acc[key].net += num(row.cashIn) - num(row.cashOut);
      return acc;
    }, {}));
    const activityDetailRows = rows.slice(0, detailLimit);
    const activityHeaders = useCompactWideColumns ? '<th>Time</th><th>Activity</th><th class="right">In</th><th class="right">Out</th><th class="right">Bal</th>' : '<th>Time</th><th>Type</th><th>Reference</th><th>Description</th><th class="right">Cash In</th><th class="right">Cash Out</th><th class="right">Balance</th><th>User</th>';
    const activityColumns = useCompactWideColumns ? [
      { label: 'Time', render: (r: any) => fmtDateTime(r.createdAt) },
      { label: 'Activity', render: (r: any) => r.description || r.referenceType || r.movementType || r.source || '—' },
      { label: 'In', align: 'right' as const, render: (r: any) => r.cashIn ? money(r.cashIn) : '—' },
      { label: 'Out', align: 'right' as const, render: (r: any) => r.cashOut ? money(r.cashOut) : '—' },
      { label: 'Bal', align: 'right' as const, render: (r: any) => money(r.running) },
    ] : [
      { label: 'Time', render: (r: any) => fmtDateTime(r.createdAt) },
      { label: 'Type', render: (r: any) => r.movementType || r.source || '—' },
      { label: 'Reference', render: (r: any) => r.referenceId ? `${r.referenceType || 'REF'}-${r.referenceId}` : r.referenceType || '—' },
      { label: 'Description', render: (r: any) => r.description || '—' },
      { label: 'Cash In', align: 'right' as const, render: (r: any) => r.cashIn ? money(r.cashIn) : '—' },
      { label: 'Cash Out', align: 'right' as const, render: (r: any) => r.cashOut ? money(r.cashOut) : '—' },
      { label: 'Balance', align: 'right' as const, render: (r: any) => money(r.running) },
      { label: 'User', render: (r: any) => r.actorName || '—' },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Cash In</span><strong>${money(totalIn)}</strong></div><div class="metric"><span>Cash Out</span><strong>${money(totalOut)}</strong></div><div class="metric"><span>Net</span><strong>${money(totalIn - totalOut)}</strong></div><div class="metric"><span>Rows</span><strong>${rows.length}</strong></div></section>` : ''}
      <h3>Cash Activity Category Summary</h3>
      <table><thead><tr><th>Type</th><th class="right">Count</th><th class="right">Cash In</th><th class="right">Cash Out</th><th class="right">Net</th></tr></thead><tbody>${tableRows(byType, [{ label: 'Type', render: (r) => r.type }, { label: 'Count', align: 'right', render: (r) => r.count }, { label: 'Cash In', align: 'right', render: (r) => money(r.cashIn) }, { label: 'Cash Out', align: 'right', render: (r) => money(r.cashOut) }, { label: 'Net', align: 'right', render: (r) => money(r.net) }])}</tbody></table>
      ${data.includeDetails ? `<h3>Cash Activity${rows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${activityHeaders}</tr></thead><tbody>${tableRows(activityDetailRows, activityColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'auditLog') {
    const rows = activity.slice(0, detailLimit).map((row: any) => ({ type: row.movementType || row.source || 'Cash Activity', reference: row.referenceId ? `${row.referenceType || 'REF'}-${row.referenceId}` : row.referenceType, user: row.actorName, detail: row.description, amount: row.amount, time: row.createdAt }));
    const auditHeaders = isA5
      ? '<th>Type</th><th>Reference</th><th>User</th><th>Time</th><th class="right">Amount</th>'
      : '<th>Type</th><th>Reference</th><th>User</th><th>Detail</th><th>Time</th><th class="right">Amount</th>';
    const auditColumns = isA5 ? [
      { label: 'Type', render: (r: any) => r.type || '—' },
      { label: 'Reference', render: (r: any) => r.reference || '—' },
      { label: 'User', render: (r: any) => r.user || '—' },
      { label: 'Time', render: (r: any) => fmtDateTime(r.time) },
      { label: 'Amount', align: 'right' as const, render: (r: any) => money(r.amount) },
    ] : [
      { label: 'Type', render: (r: any) => r.type || '—' },
      { label: 'Reference', render: (r: any) => r.reference || '—' },
      { label: 'User', render: (r: any) => r.user || '—' },
      { label: 'Detail', render: (r: any) => r.detail || '—' },
      { label: 'Time', render: (r: any) => fmtDateTime(r.time) },
      { label: 'Amount', align: 'right' as const, render: (r: any) => money(r.amount) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Activity Rows</span><strong>${activity.length}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>Audit / Activity Log${activity.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${auditHeaders}</tr></thead><tbody>${tableRows(rows, auditColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'shiftHandover') {
    const totalExpected = shiftReports.reduce((sum: number, row: any) => sum + num(row.finance?.expectedCash), 0);
    const totalCounted = shiftReports.reduce((sum: number, row: any) => sum + num(row.finance?.countedCash), 0);
    const totalVariance = shiftReports.reduce((sum: number, row: any) => sum + num(row.finance?.variance), 0);
    const sessionRows = shiftReports.map((row: any) => ({
      cashier: row.session?.cashierName || '—',
      counter: row.session?.counterName || row.session?.counterCode || '—',
      openedAt: row.session?.openedAt,
      closedAt: row.session?.closedAt,
      status: row.session?.status || '—',
      openingCash: row.session?.openingCash,
      expectedCash: row.finance?.expectedCash,
      countedCash: row.finance?.countedCash,
      variance: row.finance?.variance,
    }));
    const selectedShift = shiftReports[0] ?? shift;
    const financeRows = selectedShift ? Object.entries(selectedShift.finance ?? {}).map(([key, value]) => ({ key, value })) : [];
    const shiftExpenses = (selectedShift?.expenses ?? []).slice(0, detailLimit);
    const shiftSessionHeaders = useCompactWideColumns
      ? '<th>Cashier / Counter</th><th>Status</th><th class="right">Expected</th><th class="right">Counted</th><th class="right">Variance</th>'
      : '<th>Cashier</th><th>Counter</th><th>Opened</th><th>Closed</th><th>Status</th><th class="right">Opening</th><th class="right">Expected</th><th class="right">Counted</th><th class="right">Variance</th>';
    const shiftSessionColumns = useCompactWideColumns ? [
      { label: 'Cashier / Counter', render: (r: any) => `${r.cashier} / ${r.counter}` },
      { label: 'Status', render: (r: any) => r.status },
      { label: 'Expected', align: 'right' as const, render: (r: any) => money(r.expectedCash) },
      { label: 'Counted', align: 'right' as const, render: (r: any) => money(r.countedCash) },
      { label: 'Variance', align: 'right' as const, render: (r: any) => money(r.variance) },
    ] : [
      { label: 'Cashier', render: (r: any) => r.cashier },
      { label: 'Counter', render: (r: any) => r.counter },
      { label: 'Opened', render: (r: any) => fmtDateTime(r.openedAt) },
      { label: 'Closed', render: (r: any) => r.closedAt ? fmtDateTime(r.closedAt) : '—' },
      { label: 'Status', render: (r: any) => r.status },
      { label: 'Opening', align: 'right' as const, render: (r: any) => money(r.openingCash) },
      { label: 'Expected', align: 'right' as const, render: (r: any) => money(r.expectedCash) },
      { label: 'Counted', align: 'right' as const, render: (r: any) => money(r.countedCash) },
      { label: 'Variance', align: 'right' as const, render: (r: any) => money(r.variance) },
    ];
    const shiftExpenseHeaders = isA5 ? '<th>Category</th><th class="right">Amount</th>' : '<th>Category</th><th>Purpose</th><th>Status</th><th class="right">Amount</th>';
    const shiftExpenseColumns = isA5 ? [
      { label: 'Category', render: (r: any) => r.category || '—' },
      { label: 'Amount', align: 'right' as const, render: (r: any) => money(r.amount) },
    ] : [
      { label: 'Category', render: (r: any) => r.category || '—' },
      { label: 'Purpose', render: (r: any) => r.description || '—' },
      { label: 'Status', render: (r: any) => r.status || '—' },
      { label: 'Amount', align: 'right' as const, render: (r: any) => money(r.amount) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Shifts</span><strong>${shiftReports.length}</strong></div><div class="metric"><span>Expected Cash</span><strong>${money(totalExpected)}</strong></div><div class="metric"><span>Counted Cash</span><strong>${money(totalCounted)}</strong></div><div class="metric"><span>Variance</span><strong>${money(totalVariance)}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>Shift Sessions${sessionRows.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${shiftSessionHeaders}</tr></thead><tbody>${tableRows(sessionRows.slice(0, detailLimit), shiftSessionColumns)}</tbody></table>${selectedShift ? `<h3>Selected Shift Finance</h3><table><thead><tr><th>Metric</th><th class="right">Amount</th></tr></thead><tbody>${tableRows(financeRows, [{ label: 'Metric', render: (r) => String(r.key).replace(/([A-Z])/g, ' $1') }, { label: 'Amount', align: 'right', render: (r) => money(r.value) }])}</tbody></table><h3>Expenses${(selectedShift?.expenses ?? []).length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${shiftExpenseHeaders}</tr></thead><tbody>${tableRows(shiftExpenses, shiftExpenseColumns)}</tbody></table>` : ''}` : ''}`;
  }

  if (type === 'dueBills') {
    const dueTotal = dueBills.reduce((sum: number, row: any) => sum + Number(row.outstanding ?? row.due ?? Math.max(0, Number(row.total_amount ?? 0) - Number(row.paid ?? row.paid_amount ?? 0))), 0);
    const dueDetailRows = dueBills.slice(0, detailLimit);
    const dueHeaders = isA5 ? '<th>Invoice</th><th>Patient</th><th class="right">Due</th>' : '<th>Invoice</th><th>Patient</th><th>Status</th><th class="right">Total</th><th class="right">Paid</th><th class="right">Due</th>';
    const dueColumns = isA5 ? [
      { label: 'Invoice', render: (r: any) => r.invoice_no || r.invoiceNo || r.id },
      { label: 'Patient', render: (r: any) => r.patient_name || '—' },
      { label: 'Due', align: 'right' as const, render: (r: any) => money(r.outstanding ?? r.due ?? Math.max(0, num(r.total_amount) - num(r.paid ?? r.paid_amount))) },
    ] : [
      { label: 'Invoice', render: (r: any) => r.invoice_no || r.invoiceNo || r.id },
      { label: 'Patient', render: (r: any) => r.patient_name || '—' },
      { label: 'Status', render: (r: any) => r.status || '—' },
      { label: 'Total', align: 'right' as const, render: (r: any) => money(r.total_amount ?? r.total) },
      { label: 'Paid', align: 'right' as const, render: (r: any) => money(r.paid ?? r.paid_amount) },
      { label: 'Due', align: 'right' as const, render: (r: any) => money(r.outstanding ?? r.due ?? Math.max(0, num(r.total_amount) - num(r.paid ?? r.paid_amount))) },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Due Bills</span><strong>${dueBills.length}</strong></div><div class="metric"><span>Total Due</span><strong>${money(dueTotal)}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>Due Bills${dueBills.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${dueHeaders}</tr></thead><tbody>${tableRows(dueDetailRows, dueColumns)}</tbody></table>` : ''}`;
  }

  if (type === 'reportDelivery') {
    const queueRows = reportQueue.slice(0, detailLimit);
    const queueHeaders = isA5 ? '<th>Order</th><th>Patient</th><th class="right">Ready</th><th class="right">Due</th>' : '<th>Order</th><th>Patient</th><th>Invoice</th><th>Status</th><th class="right">Due</th><th class="right">Ready</th><th class="right">Delivered</th>';
    const queueColumns = isA5 ? [
      { label: 'Order', render: (r: any) => r.order_no || r.lab_order_id },
      { label: 'Patient', render: (r: any) => r.patient_name || '—' },
      { label: 'Ready', align: 'right' as const, render: (r: any) => `${r.ready_count ?? 0}/${r.item_count ?? 0}` },
      { label: 'Due', align: 'right' as const, render: (r: any) => money(r.due_amount) },
    ] : [
      { label: 'Order', render: (r: any) => r.order_no || r.lab_order_id },
      { label: 'Patient', render: (r: any) => r.patient_name || '—' },
      { label: 'Invoice', render: (r: any) => r.invoice_no || '—' },
      { label: 'Status', render: (r: any) => r.order_status || '—' },
      { label: 'Due', align: 'right' as const, render: (r: any) => money(r.due_amount) },
      { label: 'Ready', align: 'right' as const, render: (r: any) => `${r.ready_count ?? 0}/${r.item_count ?? 0}` },
      { label: 'Delivered', align: 'right' as const, render: (r: any) => `${r.delivered_count ?? 0}/${r.item_count ?? 0}` },
    ];
    return `
      ${data.includeSummary ? `<section class="summary-grid"><div class="metric"><span>Total Orders</span><strong>${collection?.report_delivery_summary?.total_orders ?? reportQueue.length}</strong></div><div class="metric"><span>Ready</span><strong>${collection?.report_delivery_summary?.ready_orders ?? 0}</strong></div><div class="metric"><span>Pending</span><strong>${collection?.report_delivery_summary?.pending_orders ?? 0}</strong></div></section>` : ''}
      ${data.includeDetails ? `<h3>Report Delivery Queue${reportQueue.length > detailLimit ? ` (first ${detailLimit})` : ''}</h3><table><thead><tr>${queueHeaders}</tr></thead><tbody>${tableRows(queueRows, queueColumns)}</tbody></table>` : ''}`;
  }

  const totalBilled = num(summary.total_bill ?? billSummary.final_bill_amount);
  const totalCollection = num(finance.total_received);
  const totalDeposit = num(finance.deposit_collection ?? summary.total_deposit);
  const totalExpense = num(summary.total_expense);
  const totalDue = num(summary.total_due ?? billSummary.due_remaining);
  const netCashToday = num(cashClosing.net_cash_movement ?? summary.net_cash);
  const sourceRows = collectionSources
    .map((row: any) => ({ label: row.department || row.source || row.category || 'Other', amount: num(row.amount) }))
    .filter((row: any) => row.amount !== 0);
  const paymentRows = (normalizedPaymentMethods.length > 0
    ? normalizedPaymentMethods.map((row: any) => ({
      label: row.method || 'Unknown',
      amount: num(row.amount),
      percentage: row.percentage == null ? null : num(row.percentage),
    }))
    : paymentMethods.map((row: any) => ({
      label: row.payment_method ? transactionTypeLabel(row.payment_method) : 'Unknown',
      amount: num(row.total_amount ?? row.net_amount ?? row.gross_amount),
      percentage: null,
    })))
    .filter((row: any) => row.amount !== 0)
    .map((row: any) => ({
      ...row,
      share: row.percentage == null
        ? (totalCollection > 0 ? (row.amount / totalCollection) * 100 : 0)
        : row.percentage,
    }));
  const expenseRows = collectionExpenses
    .map((row: any) => ({ label: row.expense_head || row.category || 'Uncategorized', amount: num(row.amount) }))
    .filter((row: any) => row.amount !== 0);
  const sourceTableBody = sourceRows.length > 0
    ? tableRows(sourceRows, [
      { label: 'Department / Collection Source', render: (r: any) => r.label },
      { label: 'Amount', align: 'right', render: (r: any) => money(r.amount) },
    ])
    : '<tr><td colspan="2" class="empty">No collection source data found.</td></tr>';
  const paymentTableBody = paymentRows.length > 0
    ? tableRows(paymentRows, [
      { label: 'Payment Method', render: (r: any) => r.label },
      { label: 'Amount', align: 'right', render: (r: any) => money(r.amount) },
      { label: 'Share', align: 'right', render: (r: any) => `${r.share.toFixed(1)}%` },
    ])
    : '<tr><td colspan="3" class="empty">No payment method data found.</td></tr>';
  const expenseTableBody = expenseRows.length > 0
    ? tableRows(expenseRows, [
      { label: 'Expense Head', render: (r: any) => r.label },
      { label: 'Amount', align: 'right', render: (r: any) => money(r.amount) },
    ])
    : '<tr><td colspan="2" class="empty">No expense data found.</td></tr>';
  const dailyCollectionTransactionRows = transactions.slice(0, detailLimit);
  const transactionDetailHeading = transactions.length > detailLimit
    ? `Transaction Details (first ${detailLimit})`
    : 'Transaction Details';

  return `
    ${data.includeSummary ? `<section class="summary-grid">
      <div class="metric"><span>Total Billed Today</span><strong>${money(totalBilled)}</strong></div>
      <div class="metric"><span>Total Collection Today</span><strong>${money(totalCollection)}</strong></div>
      <div class="metric"><span>Total Deposit Today</span><strong>${money(totalDeposit)}</strong></div>
      <div class="metric"><span>Total Expense</span><strong>${money(totalExpense)}</strong></div>
      <div class="metric"><span>Total Due Today</span><strong>${money(totalDue)}</strong></div>
      <div class="metric"><span>Net Cash Today</span><strong>${money(netCashToday)}</strong></div>
    </section>` : ''}
    <section class="report-grid">
      <div>
        <h3>Operational Collection Summary</h3>
        <table><tbody>
          <tr><td>Total Collection Today</td><td class="right">${money(totalCollection)}</td></tr>
          <tr><td>Deposits Included in Total</td><td class="right">${money(totalDeposit)}</td></tr>
          <tr><td>Total Expense</td><td class="right">${money(totalExpense)}</td></tr>
          <tr class="bold border-top"><td><strong>Net Cash Today</strong></td><td class="right"><strong>${money(netCashToday)}</strong></td></tr>
        </tbody></table>
      </div>
      <div>
        <h3>Department-wise Collection</h3>
        <table><thead><tr><th>Department / Collection Source</th><th class="right">Amount</th></tr></thead><tbody>
          ${sourceTableBody}
          <tr class="bold border-top"><td><strong>Total Collection</strong></td><td class="right"><strong>${money(totalCollection)}</strong></td></tr>
        </tbody></table>
      </div>
    </section>
    <section class="report-grid">
      <div>
        <h3>Payment Method Summary</h3>
        <table><thead><tr><th>Payment Method</th><th class="right">Amount</th><th class="right">Share</th></tr></thead><tbody>
          ${paymentTableBody}
          <tr class="bold border-top"><td><strong>Total Collection</strong></td><td class="right"><strong>${money(totalCollection)}</strong></td><td class="right"><strong>${totalCollection > 0 ? '100.0%' : '0.0%'}</strong></td></tr>
        </tbody></table>
      </div>
      <div>
        <h3>Expense</h3>
        <table><thead><tr><th>Expense Head</th><th class="right">Amount</th></tr></thead><tbody>
          ${expenseTableBody}
          <tr class="bold border-top"><td><strong>Total Expense</strong></td><td class="right"><strong>${money(totalExpense)}</strong></td></tr>
        </tbody></table>
      </div>
    </section>
    ${data.includeDetails ? `<h3>${transactionDetailHeading}</h3><table><thead><tr>${transactionHeaders}</tr></thead><tbody>${tableRows(dailyCollectionTransactionRows, transactionColumns)}</tbody></table>` : ''}`;
}

export function buildDailyClosingPackBody(data: BuildReportBodyData) {
  const summary = data.collection?.summary ?? {};
  const totalCollection = num(summary.total_collection);
  const totalExpense = num(summary.total_expense);
  const netIncome = num(summary.net_income ?? (totalCollection - totalExpense));
  const physicalNetCash = num(summary.net_cash);
  const receiptPosition = `<section class="report-pack-section"><h2>Management Closing Position</h2><p class="muted">Management collection and net income use the reconciled server totals. Physical drawer cash is shown separately and must be verified from Cash Activity and Shift Handover.</p><section class="summary-grid"><div class="metric"><span>Total Collection</span><strong>${money(totalCollection)}</strong></div><div class="metric"><span>Total Expense</span><strong>${money(totalExpense)}</strong></div><div class="metric"><span>Net Income</span><strong>${money(netIncome)}</strong></div><div class="metric"><span>Physical Net Cash</span><strong>${money(physicalNetCash)}</strong></div></section></section>`;
  const reportSections = DAILY_CLOSING_PACK_REPORT_TYPES.map((type) => {
    const option = reportOptions.find((report) => report.value === type);
    const openTag = '<section class="report-pack-section report-pack-section-break">';
    const closeTag = '</section>';
    return openTag + '<h2>' + escapeHtml(option?.title ?? type) + '</h2><p class="muted">' + escapeHtml(option?.description ?? '') + '</p>' + buildReportBody(type, data) + closeTag;
  }).join('');
  return receiptPosition + reportSections;
}

function buildFullHtml(args: {
  title: string;
  centerLabel: string;
  hospitalName: string;
  generatedBy: string;
  dateFrom: string;
  dateTo: string;
  pageSize: PageSize;
  orientation: Orientation;
  body: string;
  includeSignatures: boolean;
  compact?: boolean;
}) {
  const pageLabel = args.pageSize.toUpperCase();
  const isA5 = args.pageSize === 'a5';
  const isCompact = Boolean(args.compact && !isA5);
  const pageWidth = isA5 ? (args.orientation === 'landscape' ? '190mm' : '128mm') : (args.orientation === 'landscape' ? '277mm' : '190mm');
  const pageMinHeight = isA5 ? (args.orientation === 'landscape' ? '128mm' : '190mm') : (args.orientation === 'landscape' ? '190mm' : '277mm');
  const columns = isA5 ? (args.orientation === 'landscape' ? 3 : 2) : 6;
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${escapeHtml(args.title)}</title><style>
    @page { size: ${pageLabel} ${args.orientation}; margin: ${isA5 ? '6mm' : isCompact ? '9mm' : '12mm'}; }
    * { box-sizing: border-box; } body { margin: 0; background: #f8fafc; color: #153044; font-family: Arial, Helvetica, sans-serif; font-size: ${isA5 ? '8.2px' : isCompact ? '9.6px' : '11px'}; }
    .toolbar { display: flex; justify-content: center; gap: 10px; padding: 12px; background: #edf6f7; border-bottom: 1px solid #d7e7eb; }
    .toolbar button { border: 0; border-radius: 8px; padding: 9px 14px; background: #0891a6; color: white; font-weight: 700; cursor: pointer; }
    .page { width: ${pageWidth}; min-height: ${pageMinHeight}; margin: 18px auto; background: white; padding: ${isA5 ? '6.5mm' : isCompact ? '10mm' : '14mm'}; box-shadow: 0 8px 24px rgba(15,23,42,.16); }
    header { display: flex; justify-content: space-between; gap: ${isA5 ? '10px' : isCompact ? '14px' : '20px'}; border-bottom: ${isA5 ? '2px' : '3px'} solid #0891a6; padding-bottom: ${isA5 ? '7px' : isCompact ? '8px' : '12px'}; }
    h1 { margin: 0; color: #0f4055; font-size: ${isA5 ? '13px' : isCompact ? '17px' : '22px'}; } h2 { margin: 0; color: #0f4055; font-size: ${isA5 ? '12px' : isCompact ? '15px' : '19px'}; text-align: right; } h3 { margin: ${isA5 ? '10px' : isCompact ? '9px' : '18px'} 0 ${isA5 ? '5px' : isCompact ? '4px' : '8px'}; color: #0f4055; }
    .muted { color: #64748b; line-height: ${isCompact ? '1.28' : '1.5'}; }.meta { margin-top: ${isCompact ? '7px' : '12px'}; display: grid; grid-template-columns: 1fr 1fr; gap: ${isCompact ? '4px 14px' : '7px 18px'}; }.meta strong { color: #334155; }
    .summary-grid { margin-top: ${isA5 ? '8px' : isCompact ? '8px' : '14px'}; display: grid; grid-template-columns: repeat(${columns}, 1fr); gap: ${isA5 ? '5px' : isCompact ? '6px' : '8px'}; }.metric { border: 1px solid #d8e6ee; border-radius: ${isA5 ? '7px' : isCompact ? '7px' : '10px'}; padding: ${isA5 ? '5px' : isCompact ? '5px 6px' : '9px'}; }.metric span { display: block; color: #64748b; font-weight: 700; font-size: ${isA5 ? '6.8px' : isCompact ? '8px' : '10px'}; }.metric strong { display: block; margin-top: ${isA5 ? '3px' : isCompact ? '3px' : '6px'}; font-family: ui-monospace, Menlo, monospace; font-size: ${isA5 ? '8.8px' : isCompact ? '10.5px' : '14px'}; }
    table { width: 100%; border-collapse: collapse; margin-top: ${isA5 ? '5px' : isCompact ? '4px' : '8px'}; table-layout: fixed; } th { background: #0891a6; color: white; text-align: left; padding: ${isA5 ? '3px 4px' : isCompact ? '4px 5px' : '8px'}; font-size: ${isA5 ? '6.8px' : isCompact ? '8px' : '10px'}; line-height: 1.2; } td { border-bottom: 1px solid #e2e8f0; padding: ${isA5 ? '3px 4px' : isCompact ? '4px 5px' : '7px'}; vertical-align: top; word-break: break-word; line-height: ${isA5 ? '1.2' : isCompact ? '1.18' : '1.35'}; } .right { text-align: right; white-space: nowrap; } .center { text-align: center; } .empty { text-align: center; color: #64748b; padding: 18px; }
    .report-grid { display: block; } .compact-report .report-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 14px; align-items: start; margin-top: 8px; } .compact-report .report-grid h3 { margin-top: 0; } .compact-report .report-grid table { margin-top: 4px; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: ${isA5 ? '18px' : isCompact ? '24px' : '36px'}; margin-top: ${isA5 ? '26px' : isCompact ? '24px' : '44px'}; text-align: center; }.signatures span { display: block; border-top: 1px solid #94a3b8; margin-bottom: ${isCompact ? '4px' : '6px'}; }.signatures small, .signatures strong { display: block; }
    .report-pack-section + .report-pack-section { margin-top: ${isA5 ? '16px' : isCompact ? '18px' : '28px'}; padding-top: ${isA5 ? '12px' : isCompact ? '14px' : '20px'}; border-top: 2px solid #d8e6ee; }
    footer { margin-top: ${isA5 ? '14px' : isCompact ? '12px' : '24px'}; color: #64748b; text-align: center; font-size: ${isA5 ? '7px' : isCompact ? '8px' : '10px'}; } @media print { body { background: white; } .toolbar { display: none; } .page { width: auto; min-height: auto; margin: 0; box-shadow: none; padding: 0; } .report-pack-section-break { break-before: page; page-break-before: always; border-top: 0; padding-top: 0; } }
  </style></head><body><div class="toolbar"><button onclick="window.print()">Print / Save PDF</button><button onclick="window.close()">Close</button></div><main class="page${isCompact ? ' compact-report' : ''}">
    <header><div><h1>${escapeHtml(args.hospitalName)}</h1><p class="muted">${escapeHtml(args.centerLabel)}<br/>System generated statement</p></div><div><h2>${escapeHtml(args.title)}</h2><p class="muted"><strong>Generated:</strong> ${escapeHtml(fmtDateTime(new Date().toISOString()))}<br/><strong>Generated By:</strong> ${escapeHtml(args.generatedBy)}</p></div></header>
    <section class="meta"><div><strong>Date:</strong> ${escapeHtml(args.dateFrom)} to ${escapeHtml(args.dateTo)}</div><div><strong>Paper:</strong> ${escapeHtml(pageLabel)} ${escapeHtml(args.orientation)}</div></section>
    ${args.body}
    ${args.includeSignatures ? '<section class="signatures"><div><span></span><strong>Prepared By</strong><small>Signature</small></div><div><span></span><strong>Checked By</strong><small>Signature</small></div><div><span></span><strong>Admin / Accounts</strong><small>Signature</small></div></section>' : ''}
    <footer>This report is generated by HMS. Verify totals before audit submission.</footer>
  </main></body></html>`;
}

function openPrintWindow(html: string, autoPrint = true) {
  const printWindow = window.open('', '_blank', 'width=1120,height=900');
  if (!printWindow) {
    toast.error('Popup blocked. Allow popups to print/save PDF.');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  if (autoPrint) setTimeout(() => printWindow.print(), 350);
}

export default function ReceptionPdfGenerationPage({ role = 'reception' }: PdfPageProps) {
  const { slug = '' } = useParams<{ slug: string }>();
  const location = useLocation();
  const basePath = slug ? `/h/${slug}` : '';
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const queryParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const requestedReport = queryParams.get('report');
  const requestedFrom = queryParams.get('from');
  const requestedTo = queryParams.get('to');
  const requestedPack = queryParams.get('pack');
  const requestedAutoPrint = queryParams.get('autoprint') === '1';
  const isAdminMode = isSupervisorPdfRole(role);
  const [reportType, setReportType] = useState<ReportType>(() => getInitialPdfReportType(requestedReport, role));
  const [packMode, setPackMode] = useState<'single' | 'daily-closing'>(() => (
    isAdminMode && requestedPack === 'daily-closing' ? 'daily-closing' : 'single'
  ));
  const [dateFrom, setDateFrom] = useState(requestedFrom || getTodayGMT6());
  const [dateTo, setDateTo] = useState(requestedTo || requestedFrom || getTodayGMT6());
  const [pageSize, setPageSize] = useState<PageSize>('a4');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [includeSummary, setIncludeSummary] = useState(true);
  const [includeDetails, setIncludeDetails] = useState(true);
  const [includeSignatures, setIncludeSignatures] = useState(true);

  const isDailyClosingPack = isAdminMode && packMode === 'daily-closing';
  const availableReportOptions = useMemo(() => getAvailablePdfReportOptions(role), [role]);
  const availableReportCategories = useMemo(
    () => reportCategories.filter((category) => availableReportOptions.some((option) => option.category === category)),
    [availableReportOptions],
  );
  const selectedReport = availableReportOptions.find((option) => option.value === reportType) ?? availableReportOptions[0];
  const activeReportType = selectedReport?.value ?? 'dailyCollection';
  const pageKicker = isAdminMode ? 'Admin PDF Generation' : 'Reception PDF Generation';
  const pageTitle = isAdminMode ? 'Admin PDF Generation Center' : 'Reception Print Center';
  const pageDescription = isAdminMode
    ? 'Generate collection, doctor, expense, cash activity, handover, due and report delivery PDFs for admin review from one place.'
    : 'Generate front-desk PDFs for daily collection, due/invoice lists, patient/visit/test reports, report delivery and own shift handover. Cash activity, expenses, refunds and discounts stay in Cash Operations for audit-safe printing.';
  const supervisorReportsBackPath = role === 'md'
    ? `${basePath}/md/reports`
    : role === 'director'
      ? `${basePath}/director/reports`
      : role === 'accountant'
        ? `${basePath}/accountant/reports`
        : `${basePath}/reports`;
  const reportsBackPath = isAdminMode ? supervisorReportsBackPath : `${basePath}/reception/reports`;
  const reportsBackLabel = 'Back to Reports';
  const hospitalName = String((user as any)?.hospitalName ?? (user as any)?.tenantName ?? (user as any)?.hospital_name ?? 'Hospital Report Center');
  const generatedBy = String((user as any)?.name ?? (user as any)?.username ?? (isAdminMode ? 'Admin' : 'Reception'));
  const collectionUrl = dateFrom === dateTo
    ? `/api/reports/daily-collection?date=${dateFrom}`
    : `/api/reports/daily-collection?start_date=${dateFrom}&end_date=${dateTo}`;
  const needsCollectionData = isDailyClosingPack || !['expenses', 'cashActivity', 'auditLog', 'shiftHandover', 'dueBills', 'dailyDiscount'].includes(activeReportType);
  const needsExpensesData = isDailyClosingPack || activeReportType === 'expenses';
  const needsCashActivityData = isDailyClosingPack || activeReportType === 'cashActivity' || activeReportType === 'auditLog';
  const needsShiftData = isDailyClosingPack || activeReportType === 'shiftHandover';
  const needsDueBillsData = isDailyClosingPack || activeReportType === 'dueBills';
  const needsDiscountData = activeReportType === 'dailyDiscount';

  const { data: collectionData, isLoading: loadingCollection } = useApiQuery<any>(
    ['reports', 'pdf-center', 'daily-collection', dateFrom, dateTo],
    collectionUrl,
    { enabled: needsCollectionData },
  );
  const { data: expensesData, isLoading: loadingExpenses } = useApiQuery<any>(
    ['reports', 'pdf-center', 'expenses', dateFrom, dateTo],
    `/api/expenses?startDate=${dateFrom}&endDate=${dateTo}`,
    { enabled: needsExpensesData },
  );
  const { data: cashActivityData, isLoading: loadingCash } = useApiQuery<any>(
    ['reports', 'pdf-center', 'cash-activity', dateFrom, dateTo],
    `/api/cash-operations/activity?limit=500&from=${dateFrom}&to=${dateTo}&report=all`,
    { enabled: needsCashActivityData },
  );
  const { data: shiftData, isLoading: loadingShift } = useApiQuery<any>(
    ['reports', 'pdf-center', 'shift-handover', dateFrom, dateTo],
    '/api/reports/shift-handover?from=' + dateFrom + '&to=' + dateTo + '&limit=50',
    { enabled: needsShiftData, retry: false, staleTime: 30_000 },
  );
  const { data: dueBillsData, isLoading: loadingDue } = useApiQuery<any>(
    ['reports', 'pdf-center', 'due-bills', dateTo],
    `/api/bills?status=due&date=${dateTo}`,
    { enabled: needsDueBillsData, retry: false },
  );
  const { data: discountReportData, isLoading: loadingDiscounts } = useApiQuery<any>(
    ['reports', 'pdf-center', 'daily-discount', dateFrom, dateTo],
    `/api/reports/daily-discount?startDate=${dateFrom}&endDate=${dateTo}`,
    { enabled: needsDiscountData },
  );

  const loading = loadingCollection || loadingExpenses || loadingCash || loadingShift || loadingDue || loadingDiscounts;

  const reportHtml = useMemo(() => {
    const bodyData = {
      collection: collectionData,
      expenses: expensesData,
      cashActivity: cashActivityData,
      shift: shiftData,
      dueBills: dueBillsData,
      discountReport: discountReportData,
      includeSummary,
      includeDetails,
      pageSize,
      orientation,
    };
    const body = isDailyClosingPack
      ? buildDailyClosingPackBody(bodyData)
      : buildReportBody(activeReportType, bodyData);
    return buildFullHtml({
      title: isDailyClosingPack ? 'Daily Closing Report Pack' : selectedReport.title,
      centerLabel: pageTitle,
      hospitalName,
      generatedBy,
      dateFrom,
      dateTo,
      pageSize,
      orientation,
      body,
      includeSignatures,
      compact: isDailyClosingPack || (activeReportType === 'dailyCollection' && pageSize === 'a4'),
    });
  }, [activeReportType, cashActivityData, collectionData, dateFrom, dateTo, discountReportData, dueBillsData, expensesData, generatedBy, hospitalName, includeDetails, includeSignatures, includeSummary, isDailyClosingPack, orientation, pageSize, pageTitle, selectedReport?.title, shiftData]);


  const autoPrintKeyRef = useRef('');

  useEffect(() => {
    if (!requestedAutoPrint || !isDailyClosingPack || loading) return;
    const key = `${dateFrom}:${dateTo}:${reportHtml.length}`;
    if (autoPrintKeyRef.current === key) return;
    autoPrintKeyRef.current = key;
    const timer = window.setTimeout(() => openPrintWindow(reportHtml, true), 250);
    return () => window.clearTimeout(timer);
  }, [dateFrom, dateTo, isDailyClosingPack, loading, reportHtml, requestedAutoPrint]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['reports', 'pdf-center'] });
    toast.success('Report data refreshed');
  };

  return (
    <DashboardLayout role={role} fullWidth>
      <div className="mx-auto max-w-screen-2xl space-y-4">
        {(role === 'reception' || role === 'receptionist') ? <ReceptionTopBar role="reception" /> : null}
        <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{pageKicker}</p>
              <h1 className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">{pageTitle}</h1>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">{pageDescription}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to={reportsBackPath} className="btn-secondary text-sm">{reportsBackLabel}</Link>
              <button type="button" className="btn-ghost text-sm" onClick={refresh}><RefreshCw className="h-4 w-4" /> Refresh</button>
            </div>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
          <div className="rounded-2xl bg-slate-100 p-4 shadow-sm dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Live Preview</p>
                <h2 className="text-lg font-bold text-slate-900 dark:text-white">{isDailyClosingPack ? 'Daily Closing Report Pack' : selectedReport.title}</h2>
              </div>
              {loading ? <span className="badge badge-warning">Loading</span> : <span className="badge badge-success">Ready</span>}
            </div>
            <div className="h-[78vh] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-inner">
              <iframe title="PDF report preview" srcDoc={reportHtml} className="h-full w-full" />
            </div>
          </div>

          <aside className="rounded-2xl border border-[var(--color-border)] bg-white p-5 shadow-sm dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-600 text-white"><FileText className="h-5 w-5" /></div>
              <div>
                <h2 className="text-lg font-bold text-[var(--color-text-primary)]">Generate PDF</h2>
                <p className="text-xs text-[var(--color-text-muted)]">Select report, paper and sections.</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <label className="text-sm font-medium text-[var(--color-text-primary)]">Report Type
                <select className="input mt-1" value={activeReportType} onChange={(event) => { setPackMode('single'); setReportType(event.target.value as ReportType); }}>
                  {availableReportCategories.map((category) => (
                    <optgroup key={category} label={category}>
                      {availableReportOptions.filter((option) => option.category === category).map((option) => (
                        <option key={option.value} value={option.value}>{option.title}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <p className="rounded-xl bg-[var(--color-bg-secondary)] p-3 text-xs text-[var(--color-text-muted)]">
                {isDailyClosingPack
                  ? 'Daily cash position, collection, doctor performance, payment method, user-wise collection, due bills, cash activity, approved expenses and shift handover will print as one daily closing pack.'
                  : selectedReport.description}
              </p>

              {isAdminMode && (
                <div className="rounded-xl border border-cyan-100 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-100">
                  <p className="font-bold">Daily night report pack</p>
                  <p className="mt-1 text-cyan-800 dark:text-cyan-200">One click pack for end-of-day admin review.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={isDailyClosingPack ? 'btn-primary text-xs' : 'btn-secondary text-xs'} onClick={() => setPackMode('daily-closing')}>Use Daily Pack</button>
                    {isDailyClosingPack && <button type="button" className="btn-ghost text-xs" onClick={() => setPackMode('single')}>Single report</button>}
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-sm font-medium text-[var(--color-text-primary)]">Date From<input className="input mt-1" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
                <label className="text-sm font-medium text-[var(--color-text-primary)]">Date To<input className="input mt-1" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
              </div>

              <div className="rounded-xl border border-[var(--color-border)] p-3">
                <p className="text-sm font-semibold text-[var(--color-text-primary)]">Sections</p>
                <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSummary} onChange={(event) => setIncludeSummary(event.target.checked)} /> Include summary cards</label>
                <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={includeDetails} onChange={(event) => setIncludeDetails(event.target.checked)} /> Include detail tables</label>
                <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSignatures} onChange={(event) => setIncludeSignatures(event.target.checked)} /> Include signature lines</label>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--color-border)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">Paper Size</p>
                  <label className="mt-3 flex items-center gap-2 text-sm"><input type="radio" checked={pageSize === 'a4'} onChange={() => setPageSize('a4')} /> A4 detailed</label>
                  <label className="mt-2 flex items-center gap-2 text-sm"><input type="radio" checked={pageSize === 'a5'} onChange={() => { setPageSize('a5'); setOrientation('landscape'); }} /> A5 compact</label>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">Orientation</p>
                  <label className="mt-3 flex items-center gap-2 text-sm"><input type="radio" checked={orientation === 'portrait'} onChange={() => setOrientation('portrait')} /> Portrait</label>
                  <label className="mt-2 flex items-center gap-2 text-sm"><input type="radio" checked={orientation === 'landscape'} onChange={() => setOrientation('landscape')} /> Landscape</label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-[var(--color-border)] pt-4">
                <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-sm" onClick={() => openPrintWindow(reportHtml, false)}><Download className="h-4 w-4" /> Preview</button>
                <button type="button" className="btn-primary inline-flex items-center justify-center gap-2 px-3 py-2 text-sm" onClick={() => openPrintWindow(reportHtml, true)}><Printer className="h-4 w-4" /> Print / PDF</button>
              </div>
              <p className="text-xs text-[var(--color-text-muted)]">A5 mode automatically uses compact columns and smaller spacing. Browser print dialog থেকে Save as PDF করলে PDF generate হবে।</p>
            </div>
          </aside>
        </section>
      </div>
    </DashboardLayout>
  );
}
