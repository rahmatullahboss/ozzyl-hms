import { useEffect, useMemo, useState } from 'react';
import { Download, Eye, FileText, Printer, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, formatDateTime as formatDisplayDateTime } from '../../../lib/format';
import { api } from '../../../lib/apiClient';
import type { CashOverview } from './CashOverviewCards';

type ActivityRow = {
  id: string;
  source?: string;
  createdAt?: string;
  actorName?: string | null;
  movementType?: string;
  referenceType?: string;
  referenceId?: number | null;
  referenceNo?: string | null;
  invoiceNo?: string | null;
  amount?: number;
  description?: string | null;
  transferNo?: string | null;
  transferStatus?: string | null;
  transferByName?: string | null;
  transferToName?: string | null;
  destinationType?: string | null;
  custodyLabel?: string | null;
  receivedAmount?: number | null;
  dueAmount?: number | null;
  receivedAt?: string | null;
};

export type ActivityScope = 'all' | 'expenses' | 'doctorPayouts' | 'cashTransfers' | 'bankDeposits' | 'patientPayments' | 'refunds' | 'shiftSummary';
type Orientation = 'portrait' | 'landscape';
type PageSize = 'a4' | 'a5';

type PrintableRow = ActivityRow & {
  category: ActivityScope;
  typeLabel: string;
  cashIn: number;
  cashOut: number;
  runningBalance: number;
};

type RecentCashActivityProps = {
  activity?: ActivityRow[];
  overview?: CashOverview;
  hospitalName?: string;
  generatedBy?: string | null;
  dateFrom?: string;
  dateTo?: string;
  queryFilters?: Record<string, string>;
  defaultScope?: ActivityScope;
};

type ActivityResponse = {
  activity: ActivityRow[];
};

type ScopeOption = {
  value: ActivityScope;
  label: string;
  shortLabel: string;
  helper: string;
  summaryDefault: boolean;
};

const scopeOptions: ScopeOption[] = [
  { value: 'all', label: 'Full Cash Activity Statement', shortLabel: 'All', helper: 'Cash in/out with running balance', summaryDefault: true },
  { value: 'patientPayments', label: 'Patient Collection Statement', shortLabel: 'Income', helper: 'Bill / due collection only', summaryDefault: false },
  { value: 'expenses', label: 'Petty Cash Expense Statement', shortLabel: 'Expense', helper: 'Only expense rows by category/payee', summaryDefault: false },
  { value: 'doctorPayouts', label: 'Doctor Payout Statement', shortLabel: 'Doctor Payout', helper: 'Doctor payout list only', summaryDefault: false },
  { value: 'cashTransfers', label: 'Cash Transfer Statement', shortLabel: 'Transfer', helper: 'Counter/admin custody transfer', summaryDefault: false },
  { value: 'bankDeposits', label: 'Bank Deposit Statement', shortLabel: 'Bank Deposit', helper: 'Bank deposit request/custody', summaryDefault: false },
  { value: 'refunds', label: 'Refund Statement', shortLabel: 'Refund', helper: 'Cash refunds/returns only', summaryDefault: false },
  { value: 'shiftSummary', label: 'Shift Close / Handover Statement', shortLabel: 'Shift Close', helper: 'Shift close and handover only', summaryDefault: true },
];

function money(value: unknown) {
  return formatCurrency(Number(value ?? 0), { fractionDigits: 2 });
}

function toMoneyNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value?: string | null) {
  if (!value) return '';
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? '';
}

function formatLocalNaiveTimestamp(value?: string | null): string | null {
  if (!value) return null;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const [, year, month, day, hourRaw, minute] = match;
  const hour24 = Number(hourRaw);
  if (!Number.isFinite(hour24)) return null;
  const hour12 = hour24 % 12 || 12;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  return `${day}-${month}-${year}, ${hour12}:${minute} ${period}`;
}

function formatDateTime(value?: string | null) {
  return formatLocalNaiveTimestamp(value) ?? formatDisplayDateTime(value);
}

export function formatReportTime(value?: string | null) {
  if (!value) return '—';
  const local = formatLocalNaiveTimestamp(value);
  if (local) return local.split(', ')[1] ?? local;
  const text = String(value);
  const match = text.match(/(?:T|\s)(\d{1,2}):(\d{2})(?::\d{2})?/);
  if (match) {
    const hour24 = Number(match[1]);
    const minute = match[2];
    if (Number.isFinite(hour24)) {
      const suffix = hour24 >= 12 ? 'PM' : 'AM';
      const hour12 = hour24 % 12 || 12;
      return `${hour12}:${minute} ${suffix}`;
    }
  }
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

export function formatReportDateTime(value?: string | null) {
  const local = formatLocalNaiveTimestamp(value);
  if (local) return local;
  const date = dateOnly(value);
  if (!date) return formatReportTime(value);
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}, ${formatReportTime(value)}`;
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const RECEIPT_NO_PATTERN = /\bRCP-[A-Za-z0-9-]+\b/g;

type ReportDescriptionRow = Pick<ActivityRow, 'description' | 'referenceType' | 'movementType' | 'referenceNo' | 'invoiceNo'>;

function summarizeReportDescription(row: ReportDescriptionRow): string {
  const text = `${row.referenceType || ''} ${row.movementType || ''} ${row.description || ''} ${row.invoiceNo || row.referenceNo || ''}`.toLowerCase();
  const invoice = String(row.invoiceNo || row.referenceNo || '').toUpperCase();
  if (text.includes('opening')) return 'Opening';
  if (text.includes('counter session')) return 'Session opened';
  if (text.includes('doctor') || text.includes('commission')) return 'Doctor Payout';
  if (text.includes('expense')) return 'Expense';
  if (text.includes('bank')) return 'Bank Deposit';
  if (text.includes('transfer') || text.includes('custody')) return 'Transfer';
  if (text.includes('return') || text.includes('refund')) return 'Refund';
  if (text.includes('due') || text.includes('receivable')) return 'Due Collection';
  if (invoice.startsWith('INV-A') || text.includes('appointment') || text.includes('consultation')) return 'Appointment';
  if (invoice.startsWith('INV-D') || text.includes('diagnostic') || text.includes('test') || text.includes('lab') || text.includes('billing counter')) return 'Test';
  if (text.includes('payment') || text.includes('bill') || text.includes('invoice')) return 'Patient Payment';
  return row.description || row.referenceType || row.movementType || '—';
}

export function formatReportReference(row: Pick<ActivityRow, 'referenceNo' | 'invoiceNo' | 'transferNo' | 'referenceId' | 'referenceType'>): string {
  return row.referenceNo
    || row.invoiceNo
    || row.transferNo
    || (row.referenceId ? `${row.referenceType ?? 'REF'}-${row.referenceId}` : row.referenceType || '—');
}

export function formatReportDescription(row: Pick<ActivityRow, 'description' | 'referenceType' | 'movementType' | 'referenceNo' | 'invoiceNo'>): string {
  const rawDescription = String(row.description ?? '').trim();
  const combined = String(row.referenceType || '') + ' ' + String(row.movementType || '') + ' ' + rawDescription;
  const description = rawDescription && combined.toLowerCase().includes('expense')
    ? rawDescription
    : summarizeReportDescription(row);
  const invoiceNo = row.invoiceNo || (row.referenceType === 'bill' ? row.referenceNo : null);
  return invoiceNo ? String(description).replace(RECEIPT_NO_PATTERN, invoiceNo) : String(description);
}

function transferMeta(row: ActivityRow): string[] {
  const meta: string[] = [];
  if (row.transferNo) meta.push('Transfer ' + row.transferNo);
  if (row.transferStatus) meta.push('Status: ' + row.transferStatus);
  if (row.transferByName || row.transferToName) meta.push('From ' + (row.transferByName ?? '—') + ' to ' + (row.transferToName ?? '—'));
  if (row.dueAmount && Number(row.dueAmount) > 0) meta.push('Due ' + money(row.dueAmount));
  if (row.receivedAmount && Number(row.receivedAmount) > 0) meta.push('Received ' + money(row.receivedAmount));
  if (row.custodyLabel) meta.push(row.custodyLabel);
  return meta;
}

function classifyActivity(row: ActivityRow): { category: ActivityScope; typeLabel: string } {
  const referenceType = String(row.referenceType ?? '').toLowerCase();
  const movementType = String(row.movementType ?? '').toLowerCase();
  const description = String(row.description ?? '').toLowerCase();
  const combined = `${referenceType} ${movementType} ${description}`;

  if (referenceType === 'counter_opening' || String(row.source ?? '').toLowerCase() === 'counter_session') return { category: 'all', typeLabel: 'Opening Cash' };
  if (combined.includes('expense')) return { category: 'expenses', typeLabel: 'Expense' };
  if (combined.includes('doctor') || combined.includes('commission')) return { category: 'doctorPayouts', typeLabel: 'Doctor Payout' };
  if (combined.includes('bank_deposit') || combined.includes('bank deposit')) return { category: 'bankDeposits', typeLabel: 'Bank Deposit' };
  if (combined.includes('salesreturn') || combined.includes('return') || combined.includes('refund')) return { category: 'refunds', typeLabel: 'Refund' };
  if (combined.includes('cashsales') || combined.includes('collectionfromreceivable') || combined.includes('invoice') || combined.includes('bill') || combined.includes('payment')) {
    return { category: 'patientPayments', typeLabel: 'Patient Payment' };
  }
  if (combined.includes('shift') || combined.includes('handover') || combined.includes('close')) return { category: 'shiftSummary', typeLabel: 'Shift / Handover' };
  if (combined.includes('transfer')) return { category: 'cashTransfers', typeLabel: movementType === 'cash_in' ? 'Transfer In' : 'Cash Transfer' };
  return { category: movementType === 'cash_in' ? 'patientPayments' : 'all', typeLabel: row.referenceType || row.movementType || 'Cash Activity' };
}

function getCashDirection(row: ActivityRow) {
  const movementType = String(row.movementType ?? '').toLowerCase();
  const amount = toMoneyNumber(row.amount);
  if (movementType === 'opening' || String(row.referenceType ?? '').toLowerCase() === 'counter_opening' || String(row.source ?? '').toLowerCase() === 'counter_session') return { cashIn: 0, cashOut: 0 };
  if (movementType === 'cash_in') return { cashIn: amount, cashOut: 0 };
  if (movementType === 'cash_out' || movementType === 'cash_drop' || movementType === 'handover') return { cashIn: 0, cashOut: amount };
  return amount >= 0 ? { cashIn: amount, cashOut: 0 } : { cashIn: 0, cashOut: Math.abs(amount) };
}

function filterByDate(rows: ActivityRow[], from: string, to: string) {
  return rows.filter((row) => {
    const rowDate = dateOnly(row.createdAt);
    if (!rowDate) return true;
    if (from && rowDate < from) return false;
    if (to && rowDate > to) return false;
    return true;
  });
}

export function buildPrintableRows(rows: ActivityRow[], openingCash: number): PrintableRow[] {
  let runningBalance = toMoneyNumber(openingCash);
  return [...rows]
    .sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id)))
    .map((row) => {
      const { category, typeLabel } = classifyActivity(row);
      const { cashIn, cashOut } = getCashDirection(row);
      runningBalance = toMoneyNumber(runningBalance + cashIn - cashOut);
      return { ...row, category, typeLabel, cashIn, cashOut, runningBalance };
    });
}

function scopeRows(rows: PrintableRow[], scope: ActivityScope) {
  if (scope === 'all') return rows;
  return rows.filter((row) => row.category === scope);
}

function reportNo() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  return `CAR-${stamp}`;
}

function scopeOption(scope: ActivityScope) {
  return scopeOptions.find((option) => option.value === scope) ?? scopeOptions[0];
}

export function buildCashActivityReportHtml(params: {
  rows: PrintableRow[];
  allRows: PrintableRow[];
  overview?: CashOverview;
  hospitalName: string;
  generatedBy: string;
  scope: ActivityScope;
  from: string;
  to: string;
  includeSummary: boolean;
  includeRunningBalance: boolean;
  includeSignatures: boolean;
  orientation: Orientation;
  pageSize: PageSize;
  periodOpeningBalance?: number;
}) {
  const option = scopeOption(params.scope);
  const openingCash = toMoneyNumber(params.periodOpeningBalance ?? params.overview?.openingCash);
  const cashIn = params.rows.reduce((sum, row) => sum + row.cashIn, 0);
  const cashOut = params.rows.reduce((sum, row) => sum + row.cashOut, 0);
  const netAmount = toMoneyNumber(cashIn - cashOut);
  const transferOut = params.rows.filter((row) => row.category === 'cashTransfers').reduce((sum, row) => sum + row.cashOut, 0);
  const bankDeposit = params.rows.filter((row) => row.category === 'bankDeposits').reduce((sum, row) => sum + row.cashOut, 0);
  const closingBalance = params.allRows.length > 0 ? params.allRows[params.allRows.length - 1].runningBalance : toMoneyNumber(params.overview?.currentDrawerBalance ?? openingCash);
  const generatedAt = formatDateTime(new Date().toISOString());
  const overviewRecord = params.overview as (Record<string, unknown> | undefined);
  const cashierName = String(
    overviewRecord?.operatorName
      ?? overviewRecord?.cashierName
      ?? params.rows.find((row) => row.actorName)?.actorName
      ?? params.allRows.find((row) => row.actorName)?.actorName
      ?? params.generatedBy
      ?? '—',
  );
  const id = reportNo();
  const pageLabel = params.pageSize.toUpperCase();
  const isA5 = params.pageSize === 'a5';
  const isStatement = params.scope !== 'all' && params.scope !== 'shiftSummary';
  const pageWidth = isA5
    ? (params.orientation === 'landscape' ? '190mm' : '128mm')
    : (params.orientation === 'landscape' ? '277mm' : '190mm');
  const pageMinHeight = isA5
    ? (params.orientation === 'landscape' ? '128mm' : '190mm')
    : (params.orientation === 'landscape' ? '190mm' : '277mm');
  const pagePadding = isA5 ? '5mm' : '8mm';
  const pageMargin = isA5 ? '6mm' : '8mm';
  const bodyFontSize = isA5 ? '8px' : '9px';
  const tablePadding = isA5 ? '3px 4px' : '4px 5px';
  const colSpan = params.includeRunningBalance ? 8 : 7;

  const summaryHtml = params.includeSummary ? (isStatement ? `
    <section class="summary-strip">
      <div><span>Rows</span><strong>${params.rows.length}</strong></div>
      <div><span>Cash In</span><strong class="in">${escapeHtml(money(cashIn))}</strong></div>
      <div><span>Cash Out</span><strong class="out">${escapeHtml(money(cashOut))}</strong></div>
      <div><span>${isStatement ? 'Net Amount' : 'Closing Balance'}</span><strong>${escapeHtml(money(isStatement ? netAmount : closingBalance))}</strong></div>
    </section>
  ` : `
    <section class="summary-grid">
      <div class="metric"><span>Opening Cash</span><strong>${escapeHtml(money(openingCash))}</strong></div>
      <div class="metric green"><span>Cash In</span><strong>${escapeHtml(money(cashIn))}</strong></div>
      <div class="metric red"><span>Cash Out</span><strong>${escapeHtml(money(cashOut))}</strong></div>
      <div class="metric orange"><span>Transfer Out</span><strong>${escapeHtml(money(transferOut))}</strong></div>
      <div class="metric indigo"><span>Bank Deposit</span><strong>${escapeHtml(money(bankDeposit))}</strong></div>
      <div class="metric teal"><span>Closing Balance</span><strong>${escapeHtml(money(closingBalance))}</strong></div>
    </section>
  `) : '';

  const rowsHtml = params.rows.length > 0 ? params.rows.map((row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(formatReportTime(row.createdAt))}</td>
      <td><span class="badge ${escapeHtml(row.category)}">${escapeHtml(row.typeLabel)}</span></td>
      <td>${escapeHtml(formatReportReference(row))}</td>
      <td>${escapeHtml(formatReportDescription(row))}</td>
      <td class="amount in">${row.cashIn > 0 ? escapeHtml(money(row.cashIn)) : '—'}</td>
      <td class="amount out">${row.cashOut > 0 ? escapeHtml(money(row.cashOut)) : '—'}</td>
      ${params.includeRunningBalance ? `<td class="amount">${escapeHtml(money(row.runningBalance))}</td>` : ''}
      <td>${escapeHtml(row.actorName || params.generatedBy || '—')}</td>
    </tr>
  `).join('') : `<tr><td colspan="${colSpan}" class="empty">No cash activity found for selected filters.</td></tr>`;

  const signaturesHtml = params.includeSignatures ? `
    <section class="signatures">
      <div><span></span><strong>Cashier</strong><small>Signature</small><small>Date: ____________</small></div>
      <div><span></span><strong>Supervisor</strong><small>Signature</small><small>Date: ____________</small></div>
      <div><span></span><strong>Admin / Accounts</strong><small>Signature</small><small>Date: ____________</small></div>
    </section>
  ` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(option.label)}</title>
  <style>
    @page { size: ${pageLabel} ${params.orientation}; margin: ${pageMargin}; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #f8fafc; color: #153044; font-family: Arial, Helvetica, sans-serif; font-size: ${bodyFontSize}; }
    .no-print { display: flex; justify-content: center; gap: 10px; padding: 12px; background: #f1f5f9; border-bottom: 1px solid #dbe5ee; }
    .no-print button { border: 0; border-radius: 8px; padding: 9px 16px; font-weight: 700; cursor: pointer; }
    .primary { background: #0891a6; color: #fff; }
    .secondary { background: #e2e8f0; color: #153044; }
    .page { width: ${pageWidth}; min-height: ${pageMinHeight}; margin: 10px auto; background: #fff; padding: ${pagePadding}; box-shadow: 0 8px 24px rgba(15,23,42,.16); }
    header { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; border-bottom: 1.5px solid #0891a6; padding-bottom: ${isA5 ? '5px' : '7px'}; }
    h1 { margin: 0; color: #0f4055; font-size: ${isA5 ? '12px' : '15px'}; line-height: 1.15; }
    h2 { margin: 0; color: #0f4055; font-size: ${isA5 ? '11px' : '14px'}; line-height: 1.15; text-align: right; }
    .muted { color: #64748b; line-height: 1.18; margin: 2px 0 0; }
    .meta { margin-top: ${isA5 ? '5px' : '7px'}; display: grid; grid-template-columns: repeat(3, 1fr); gap: 3px 12px; }
    .meta-row { display: grid; grid-template-columns: ${isA5 ? '46px' : '70px'} 1fr; gap: 4px; }
    .meta-row strong { color: #334155; }
    .summary-strip { margin-top: ${isA5 ? '9px' : '13px'}; display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid #d8e6ee; border-radius: 10px; overflow: hidden; }
    .summary-strip div { padding: ${isA5 ? '6px' : '9px'}; border-right: 1px solid #d8e6ee; }
    .summary-strip div:last-child { border-right: 0; }
    .summary-strip span, .metric span { display: block; color: #64748b; font-weight: 700; font-size: ${isA5 ? '6.5px' : '7.5px'}; line-height: 1.05; white-space: nowrap; }
    .summary-strip strong, .metric strong { display: block; margin-top: 2px; font-family: ui-monospace, Menlo, monospace; font-size: ${isA5 ? '8.5px' : '10px'}; line-height: 1.05; white-space: nowrap; }
    .summary-grid { margin-top: ${isA5 ? '5px' : '7px'}; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: ${isA5 ? '3px' : '4px'}; }
    .metric { border: 1px solid #d8e6ee; border-radius: 6px; padding: ${isA5 ? '4px' : '5px'}; min-height: 32px; }
    .green strong, .in { color: #047857; } .red strong, .out { color: #dc2626; } .orange strong { color: #ea580c; } .indigo strong { color: #2563eb; } .teal strong { color: #0891a6; }
    table { width: 100%; border-collapse: collapse; margin-top: ${isA5 ? '5px' : '7px'}; table-layout: fixed; }
    th { background: #0891a6; color: white; text-align: left; padding: ${tablePadding}; font-size: ${isA5 ? '7px' : '9px'}; }
    td { border-bottom: 1px solid #e2e8f0; padding: ${tablePadding}; vertical-align: top; word-break: break-word; }
    th:nth-child(1), td:nth-child(1) { width: 24px; }
    th:nth-child(2), td:nth-child(2) { width: ${isA5 ? '38px' : '56px'}; }
    th:nth-child(3), td:nth-child(3) { width: ${isA5 ? '58px' : '92px'}; }
    th:nth-child(6), td:nth-child(6), th:nth-child(7), td:nth-child(7), th:nth-child(8), td:nth-child(8) { width: ${isA5 ? '58px' : '88px'}; }
    .amount { text-align: right; font-family: ui-monospace, Menlo, monospace; white-space: nowrap; }
    .badge { display: inline-block; border-radius: 999px; padding: 2px 5px; font-weight: 700; font-size: ${isA5 ? '6.5px' : '8.5px'}; background: #e0f2fe; color: #0369a1; }
    .expenses { background: #fee2e2; color: #b91c1c; } .doctorPayouts { background: #ede9fe; color: #6d28d9; } .cashTransfers { background: #ffedd5; color: #c2410c; }
    .bankDeposits { background: #dbeafe; color: #1d4ed8; } .patientPayments { background: #dcfce7; color: #15803d; } .refunds { background: #ffe4e6; color: #be123c; }
    .empty { text-align: center; color: #64748b; padding: 24px; }
    .signatures { display: grid; grid-template-columns: repeat(3, 1fr); gap: ${isA5 ? '18px' : '38px'}; margin-top: ${isA5 ? '30px' : '48px'}; text-align: center; }
    .signatures span { display: block; border-top: 1px solid #94a3b8; margin-bottom: 7px; }
    .signatures strong, .signatures small { display: block; }
    footer { margin-top: 20px; color: #64748b; text-align: center; font-size: ${isA5 ? '7px' : '9px'}; }
    @media print { body { background: white; } .no-print { display: none; } .page { margin: 0; width: auto; min-height: auto; box-shadow: none; padding: 0; } }
  </style>
</head>
<body>
  <div class="no-print"><button class="primary" onclick="window.print()">Print / Save PDF</button><button class="secondary" onclick="window.close()">Close</button></div>
  <main class="page">
    <header>
      <div><h1>${escapeHtml(params.hospitalName)}</h1><p class="muted">Cash Operations · Reception<br/>System generated statement</p></div>
      <div><h2>${escapeHtml(option.label)}</h2><p class="muted"><strong>Generated:</strong> ${escapeHtml(generatedAt)}<br/><strong>By:</strong> ${escapeHtml(params.generatedBy)}<br/><strong>ID:</strong> ${escapeHtml(id)}</p></div>
    </header>
    <section class="meta">
      <div class="meta-row"><strong>Date</strong><span>${escapeHtml(params.from || 'Session start')} to ${escapeHtml(params.to || 'Current')}</span></div>
      <div class="meta-row"><strong>Scope</strong><span>${escapeHtml(option.shortLabel)}</span></div>
      <div class="meta-row"><strong>Cashier</strong><span>${escapeHtml(cashierName)}</span></div>
      <div class="meta-row"><strong>Counter</strong><span>${escapeHtml(params.overview?.counterName || params.overview?.counterId || 'Active counter')}</span></div>
      <div class="meta-row"><strong>Rows</strong><span>${params.rows.length}</span></div>
      <div class="meta-row"><strong>Paper</strong><span>${escapeHtml(pageLabel)} ${escapeHtml(params.orientation)}</span></div>
    </section>
    ${summaryHtml}
    <table>
      <thead><tr><th>#</th><th>Time</th><th>Type</th><th>Reference</th><th>Description</th><th>Cash In</th><th>Cash Out</th>${params.includeRunningBalance ? '<th>Balance</th>' : ''}<th>User</th></tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    ${signaturesHtml}
    <footer>This is a system generated report. Printed copies should be signed when used for handover/audit.</footer>
  </main>
</body>
</html>`;
}

function openPrintWindow(html: string, autoPrint = true) {
  const printWindow = window.open('', '_blank', 'width=1100,height=900');
  if (!printWindow) {
    window.alert('Please allow popups to print cash activity.');
    return;
  }
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  if (autoPrint) setTimeout(() => printWindow.print(), 350);
}

export default function RecentCashActivity({
  activity = [],
  overview,
  hospitalName = 'Hospital Cash Operations',
  generatedBy,
  dateFrom,
  dateTo,
  queryFilters,
  defaultScope = 'all',
}: RecentCashActivityProps) {
  const { t } = useTranslation('cashOperations');
  const [showPrintPanel, setShowPrintPanel] = useState(false);
  const [scope, setScope] = useState<ActivityScope>(defaultScope);
  const [from, setFrom] = useState(dateFrom || todayInput());
  const [to, setTo] = useState(dateTo || todayInput());
  const [includeSummary, setIncludeSummary] = useState(scopeOption(defaultScope).summaryDefault);
  const [includeRunningBalance, setIncludeRunningBalance] = useState(true);
  const [includeSignatures, setIncludeSignatures] = useState(defaultScope === 'all' || defaultScope === 'shiftSummary');
  const [orientation, setOrientation] = useState<Orientation>('portrait');
  const [pageSize, setPageSize] = useState<PageSize>('a5');
  const [reportActivity, setReportActivity] = useState<ActivityRow[] | null>(null);
  const [contextActivity, setContextActivity] = useState<ActivityRow[] | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    if (showPrintPanel) return;
    setFrom(dateFrom || todayInput());
    setTo(dateTo || todayInput());
    setScope(defaultScope);
    setIncludeSummary(scopeOption(defaultScope).summaryDefault);
    setIncludeSignatures(defaultScope === 'all' || defaultScope === 'shiftSummary');
  }, [dateFrom, dateTo, defaultScope, showPrintPanel]);

  useEffect(() => {
    if (!showPrintPanel) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ ...(queryFilters ?? {}), limit: '2000' });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const contextParams = new URLSearchParams({ ...(queryFilters ?? {}), limit: '2000' });
    if (to) contextParams.set('to', to);
    setReportLoading(true);
    setReportError(null);
    Promise.all([
      api.get<ActivityResponse>(`/api/cash-operations/activity?${params.toString()}`),
      api.get<ActivityResponse>(`/api/cash-operations/activity?${contextParams.toString()}`),
    ])
      .then(([response, contextResponse]) => {
        if (!controller.signal.aborted) {
          setReportActivity(response.activity ?? []);
          setContextActivity(contextResponse.activity ?? []);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setReportActivity(null);
          setContextActivity(null);
          setReportError(error instanceof Error ? error.message : 'Unable to load full cash activity report.');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setReportLoading(false);
      });
    return () => controller.abort();
  }, [from, queryFilters, showPrintPanel, to]);

  const sourceActivity = reportActivity ?? activity;
  const contextSourceActivity = contextActivity ?? sourceActivity;
  const contextPrintableRows = useMemo(() => buildPrintableRows(contextSourceActivity, overview?.openingCash ?? 0), [contextSourceActivity, overview?.openingCash]);
  const rowsUpToReportEnd = useMemo(() => contextPrintableRows.filter((row) => {
    const rowDate = dateOnly(row.createdAt);
    return !to || !rowDate || rowDate <= to;
  }), [contextPrintableRows, to]);
  const rowsInsideReportRange = useMemo(() => rowsUpToReportEnd.filter((row) => {
    const rowDate = dateOnly(row.createdAt);
    if (!rowDate) return true;
    if (from && rowDate < from) return false;
    return true;
  }), [from, rowsUpToReportEnd]);
  const printableRows = useMemo(() => scopeRows(rowsInsideReportRange, scope), [rowsInsideReportRange, scope]);
  const periodOpeningBalance = useMemo(() => {
    if (!from) return toMoneyNumber(overview?.openingCash);
    const previousRows = contextPrintableRows.filter((row) => {
      const rowDate = dateOnly(row.createdAt);
      return rowDate && rowDate < from;
    });
    const previousRow = previousRows[previousRows.length - 1];
    if (previousRow) return toMoneyNumber(previousRow.runningBalance);
    const firstInRange = rowsInsideReportRange[0];
    if (firstInRange) return toMoneyNumber(firstInRange.runningBalance - firstInRange.cashIn + firstInRange.cashOut);
    return toMoneyNumber(overview?.openingCash);
  }, [contextPrintableRows, from, overview?.openingCash, rowsInsideReportRange]);
  const allPrintableRows = rowsUpToReportEnd;
  const selectedScope = scopeOption(scope);
  const printHtml = useMemo(() => buildCashActivityReportHtml({
    rows: printableRows,
    allRows: allPrintableRows,
    overview,
    hospitalName,
    generatedBy: generatedBy || 'Reception',
    scope,
    from,
    to,
    includeSummary,
    includeRunningBalance,
    includeSignatures,
    orientation,
    pageSize,
    periodOpeningBalance,
  }), [allPrintableRows, from, generatedBy, hospitalName, includeRunningBalance, includeSignatures, includeSummary, orientation, overview, pageSize, periodOpeningBalance, printableRows, scope, to]);

  const totalIn = printableRows.reduce((sum, row) => sum + row.cashIn, 0);
  const totalOut = printableRows.reduce((sum, row) => sum + row.cashOut, 0);
  const closingBalance = allPrintableRows.length ? allPrintableRows[allPrintableRows.length - 1].runningBalance : overview?.currentDrawerBalance ?? periodOpeningBalance;

  const openPanel = () => {
    const option = scopeOption(defaultScope);
    setScope(defaultScope);
    setIncludeSummary(option.summaryDefault);
    setIncludeSignatures(defaultScope === 'all' || defaultScope === 'shiftSummary');
    setShowPrintPanel(true);
  };

  const selectScope = (nextScope: ActivityScope) => {
    const option = scopeOption(nextScope);
    setScope(nextScope);
    setIncludeSummary(option.summaryDefault);
    setIncludeSignatures(nextScope === 'all' || nextScope === 'shiftSummary');
  };

  const previewSummaryClass = pageSize === 'a5' ? 'mt-3 grid grid-cols-2 gap-2' : 'mt-4 grid gap-2 sm:grid-cols-3 xl:grid-cols-6';
  const previewMaxWidth = pageSize === 'a5' ? (orientation === 'landscape' ? 760 : 500) : 900;

  return (
    <aside className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900" aria-labelledby="recent-cash-activity-title">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 id="recent-cash-activity-title" className="text-lg font-bold text-[var(--color-text-primary)]">{t('activity.title')}</h2>
          <p className="text-xs text-[var(--color-text-muted)]">{activity.length} recent rows · print can filter by operation type</p>
        </div>
        <button type="button" className="btn-secondary inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={openPanel}>
          <Printer className="h-4 w-4" />
          Print
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {activity.length > 0 ? activity.slice(0, 12).map((item) => {
          const { typeLabel } = classifyActivity(item);
          const direction = getCashDirection(item);
          const meta = transferMeta(item);
          return (
            <div key={item.id} className="rounded-lg border border-[var(--color-border)] p-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[var(--color-text-primary)]">{item.description || item.referenceType || item.movementType}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">{typeLabel} · {formatReportDateTime(item.createdAt)}</p>
                  {meta.length ? <p className="mt-1 text-xs text-amber-700">{meta.join(' · ')}</p> : null}
                </div>
                <p className={`font-data font-semibold ${direction.cashIn > 0 ? 'text-emerald-700' : direction.cashOut > 0 ? 'text-red-700' : ''}`}>{money(item.amount)}</p>
              </div>
            </div>
          );
        }) : (
          <p className="rounded-lg border border-dashed border-[var(--color-border)] p-4 text-sm text-[var(--color-text-muted)]">{t('activity.empty')}</p>
        )}
      </div>

      {showPrintPanel ? (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Print Cash Activity">
          <div className="mx-auto grid max-w-7xl gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="rounded-2xl bg-slate-100 p-4 shadow-2xl">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Preview</p>
                  <h3 className="text-lg font-bold text-slate-900">{selectedScope.label}</h3>
                </div>
                <button type="button" className="btn-ghost px-3 py-2" onClick={() => setShowPrintPanel(false)}><X className="h-4 w-4" /></button>
              </div>
              <div className="max-h-[80vh] overflow-auto rounded-xl bg-white p-4 shadow-inner">
                <div className="mx-auto w-full rounded-lg border border-slate-200 bg-white p-5 text-slate-800 shadow-sm" style={{ maxWidth: previewMaxWidth }}>
                  <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-cyan-600 pb-3">
                    <div>
                      <h4 className="text-lg font-bold text-cyan-800">{hospitalName}</h4>
                      <p className="mt-1 text-xs text-slate-500">Cash Operations · Reception</p>
                    </div>
                    <div className="text-right">
                      <h4 className="text-lg font-bold text-slate-900">{selectedScope.label}</h4>
                      <p className="mt-1 text-xs text-slate-500">Generated by {generatedBy || 'Reception'}</p>
                    </div>
                  </div>
                  {reportLoading ? <p className="mt-4 rounded-lg bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-700">Loading full activity report…</p> : null}
                  {reportError ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{reportError}</p> : null}
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                    <p><strong>Date:</strong> {from || 'Session start'} to {to || 'Current'}</p>
                    <p><strong>Scope:</strong> {selectedScope.shortLabel}</p>
                    <p><strong>Paper:</strong> {pageSize.toUpperCase()} {orientation}</p>
                    <p><strong>Rows:</strong> {printableRows.length}</p>
                  </div>
                  {includeSummary ? (
                    <div className={previewSummaryClass}>
                      <div className="rounded-lg border border-cyan-100 p-2"><p className="text-[11px] text-slate-500">B/F Cash</p><p className="font-data font-bold">{money(periodOpeningBalance)}</p></div>
                      <div className="rounded-lg border border-emerald-100 p-2"><p className="text-[11px] text-slate-500">Cash In</p><p className="font-data font-bold text-emerald-700">{money(totalIn)}</p></div>
                      <div className="rounded-lg border border-red-100 p-2"><p className="text-[11px] text-slate-500">Cash Out</p><p className="font-data font-bold text-red-700">{money(totalOut)}</p></div>
                      <div className="rounded-lg border border-teal-100 p-2"><p className="text-[11px] text-slate-500">Closing / Net</p><p className="font-data font-bold text-cyan-700">{scope === 'all' || scope === 'shiftSummary' ? money(closingBalance) : money(totalIn - totalOut)}</p></div>
                    </div>
                  ) : null}
                  <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                    <table className="min-w-[760px] w-full text-left text-[11px]">
                      <thead className="bg-cyan-700 text-white"><tr><th className="p-2 w-10">#</th><th className="p-2 w-16">Time</th><th className="p-2 w-28">Type</th><th className="p-2 min-w-[220px]">Description</th><th className="p-2 w-24 text-right">In</th><th className="p-2 w-24 text-right">Out</th>{includeRunningBalance ? <th className="p-2 w-28 text-right">Balance</th> : null}</tr></thead>
                      <tbody>
                        {printableRows.slice(0, 18).map((row, index) => (
                          <tr key={row.id} className="border-b border-slate-100">
                            <td className="p-2">{index + 1}</td>
                            <td className="p-2">{formatReportTime(row.createdAt)}</td>
                            <td className="p-2">{row.typeLabel}</td>
                            <td className="p-2 whitespace-normal break-words leading-snug">
                              <span>{formatReportDescription(row)}</span>
                              {formatReportReference(row) !== '—' ? <span className="mt-0.5 block text-[10px] text-slate-500">Ref: {formatReportReference(row)}</span> : null}
                            </td>
                            <td className="p-2 text-right font-data text-emerald-700">{row.cashIn ? money(row.cashIn) : '—'}</td>
                            <td className="p-2 text-right font-data text-red-700">{row.cashOut ? money(row.cashOut) : '—'}</td>
                            {includeRunningBalance ? <td className="p-2 text-right font-data">{money(row.runningBalance)}</td> : null}
                          </tr>
                        ))}
                        {printableRows.length === 0 ? <tr><td className="p-6 text-center text-slate-500" colSpan={includeRunningBalance ? 7 : 6}>No activity found for selected filters.</td></tr> : null}
                      </tbody>
                    </table>
                  </div>
                  {printableRows.length > 18 ? <p className="mt-2 text-xs text-slate-500">Preview shows first 18 rows. Print/export includes all {printableRows.length} rows.</p> : null}
                </div>
              </div>
            </div>

            <div className="rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-600 text-white"><Printer className="h-5 w-5" /></div>
                  <div>
                    <h3 className="text-lg font-bold text-[var(--color-text-primary)]">Print Statement</h3>
                    <p className="text-xs text-[var(--color-text-muted)]">Choose the exact operation report to print.</p>
                  </div>
                </div>
                <button type="button" className="btn-ghost px-2 py-2" onClick={() => setShowPrintPanel(false)}><X className="h-4 w-4" /></button>
              </div>

              <div className="mt-5 space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm font-medium text-[var(--color-text-primary)]">Date From<input className="input mt-1" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
                  <label className="text-sm font-medium text-[var(--color-text-primary)]">Date To<input className="input mt-1" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
                </div>

                <div>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">Report Type</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {scopeOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => selectScope(option.value)}
                        className={`rounded-xl border p-3 text-left transition ${scope === option.value ? 'border-cyan-300 bg-cyan-50 text-cyan-800 ring-2 ring-cyan-100' : 'border-[var(--color-border)] hover:border-cyan-200 hover:bg-[var(--color-bg-subtle)]'}`}
                      >
                        <span className="flex items-center gap-2 text-sm font-bold"><FileText className="h-4 w-4" />{option.shortLabel}</span>
                        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">{option.helper}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-[var(--color-border)] p-3">
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">Include Options</p>
                  <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSummary} onChange={(event) => setIncludeSummary(event.target.checked)} /> Include compact totals</label>
                  <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={includeRunningBalance} onChange={(event) => setIncludeRunningBalance(event.target.checked)} /> Include running balance</label>
                  <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={includeSignatures} onChange={(event) => setIncludeSignatures(event.target.checked)} /> Include signatures</label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-[var(--color-border)] p-3">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">Paper Size</p>
                    <label className="mt-3 flex items-center gap-2 text-sm"><input type="radio" checked={pageSize === 'a4'} onChange={() => setPageSize('a4')} /> A4 detailed</label>
                    <label className="mt-2 flex items-center gap-2 text-sm"><input type="radio" checked={pageSize === 'a5'} onChange={() => setPageSize('a5')} /> A5 compact</label>
                  </div>
                  <div className="rounded-xl border border-[var(--color-border)] p-3">
                    <p className="text-sm font-semibold text-[var(--color-text-primary)]">Orientation</p>
                    <label className="mt-3 flex items-center gap-2 text-sm"><input type="radio" checked={orientation === 'portrait'} onChange={() => setOrientation('portrait')} /> Portrait</label>
                    <label className="mt-2 flex items-center gap-2 text-sm"><input type="radio" checked={orientation === 'landscape'} onChange={() => setOrientation('landscape')} /> Landscape</label>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 border-t border-[var(--color-border)] pt-4">
                  <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-sm" onClick={() => openPrintWindow(printHtml, false)}><Eye className="h-4 w-4" /> Preview</button>
                  <button type="button" className="btn-primary inline-flex items-center justify-center gap-2 px-3 py-2 text-sm" onClick={() => openPrintWindow(printHtml, true)}><Printer className="h-4 w-4" /> Print</button>
                  <button type="button" className="btn-secondary inline-flex items-center justify-center gap-2 px-3 py-2 text-sm" onClick={() => openPrintWindow(printHtml, true)}><Download className="h-4 w-4" /> PDF</button>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">Rows selected: {printableRows.length}. {selectedScope.label}. PDF uses browser print dialog's Save as PDF option.</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
