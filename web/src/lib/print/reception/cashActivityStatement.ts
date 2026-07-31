/**
 * Reception — Cash Activity Statement (Print Module)
 *
 * Extracted from the old `RecentCashActivity.tsx` (which used a custom HTML
 * generator). Now uses the shared `receptionPrint.ts` renderer so headers,
 * footers, and styling match the rest of the reception document family.
 *
 * Exports:
 *  - `ActivityRow` / `ActivityScope` / `PrintableRow` — types
 *  - `buildPrintableRows` — computes running balance + classification
 *  - `buildCashActivityStatementHtml` — full HTML for the print window
 */

import {
  buildReceptionHeader,
  buildReceptionFooter,
  escapeHtml,
  formatDateTime,
  money,
  num,
  wrapReceptionPage,
  openPrintWindow,
  type Orientation,
  type PageSize,
  type ReceptionContext,
} from './receptionPrint';

// ── Types ────────────────────────────────────────────────────────────────

export type ActivityRow = {
  id: string;
  source?: string;
  createdAt?: string;
  actorName?: string | null;
  movementType?: string;
  referenceType?: string;
  referenceId?: number | null;
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

export type ActivityScope =
  | 'all'
  | 'expenses'
  | 'doctorPayouts'
  | 'cashTransfers'
  | 'bankDeposits'
  | 'patientPayments'
  | 'refunds'
  | 'shiftSummary';

export type PrintableRow = ActivityRow & {
  category: ActivityScope;
  typeLabel: string;
  cashIn: number;
  cashOut: number;
  runningBalance: number;
};

export type ScopeOption = {
  value: ActivityScope;
  label: string;
  shortLabel: string;
  helper: string;
  summaryDefault: boolean;
};

export const SCOPE_OPTIONS: ScopeOption[] = [
  { value: 'all', label: 'Full Cash Activity Statement', shortLabel: 'All', helper: 'Cash in/out with running balance', summaryDefault: true },
  { value: 'patientPayments', label: 'Patient Collection Statement', shortLabel: 'Income', helper: 'Bill / due collection only', summaryDefault: false },
  { value: 'expenses', label: 'Petty Cash Expense Statement', shortLabel: 'Expense', helper: 'Only expense rows by category/payee', summaryDefault: false },
  { value: 'doctorPayouts', label: 'Doctor Payout Statement', shortLabel: 'Doctor Payout', helper: 'Doctor payout list only', summaryDefault: false },
  { value: 'cashTransfers', label: 'Cash Transfer Statement', shortLabel: 'Transfer', helper: 'Counter/admin custody transfer', summaryDefault: false },
  { value: 'bankDeposits', label: 'Bank Deposit Statement', shortLabel: 'Bank Deposit', helper: 'Bank deposit request/custody', summaryDefault: false },
  { value: 'refunds', label: 'Refund Statement', shortLabel: 'Refund', helper: 'Cash refunds/returns only', summaryDefault: false },
  { value: 'shiftSummary', label: 'Shift Close / Handover Statement', shortLabel: 'Shift Close', helper: 'Shift close and handover only', summaryDefault: true },
];

// ── Row classification & direction ──────────────────────────────────────

export function classifyActivity(row: ActivityRow): { category: ActivityScope; typeLabel: string } {
  const referenceType = String(row.referenceType ?? '').toLowerCase();
  const movementType = String(row.movementType ?? '').toLowerCase();
  const description = String(row.description ?? '').toLowerCase();
  const combined = `${referenceType} ${movementType} ${description}`;

  if (combined.includes('expense')) return { category: 'expenses', typeLabel: 'Expense' };
  if (combined.includes('doctor') || combined.includes('commission')) return { category: 'doctorPayouts', typeLabel: 'Doctor Payout' };
  if (combined.includes('bank_deposit') || combined.includes('bank deposit')) return { category: 'bankDeposits', typeLabel: 'Bank Deposit' };
  if (combined.includes('salesreturn') || combined.includes('return') || combined.includes('refund')) return { category: 'refunds', typeLabel: 'Refund' };
  if (
    combined.includes('cashsales') ||
    combined.includes('collectionfromreceivable') ||
    combined.includes('invoice') ||
    combined.includes('bill') ||
    combined.includes('payment')
  ) {
    return { category: 'patientPayments', typeLabel: 'Patient Payment' };
  }
  if (combined.includes('shift') || combined.includes('handover') || combined.includes('close')) {
    return { category: 'shiftSummary', typeLabel: 'Shift / Handover' };
  }
  if (combined.includes('transfer')) {
    return { category: 'cashTransfers', typeLabel: movementType === 'cash_in' ? 'Transfer In' : 'Cash Transfer' };
  }
  return { category: movementType === 'cash_in' ? 'patientPayments' : 'all', typeLabel: row.referenceType || row.movementType || 'Cash Activity' };
}

export function getCashDirection(row: ActivityRow): { cashIn: number; cashOut: number } {
  const movementType = String(row.movementType ?? '').toLowerCase();
  const amount = num(row.amount);
  if (movementType === 'opening') return { cashIn: 0, cashOut: 0 };
  if (movementType === 'cash_in') return { cashIn: amount, cashOut: 0 };
  if (movementType === 'cash_out' || movementType === 'cash_drop' || movementType === 'handover') {
    return { cashIn: 0, cashOut: amount };
  }
  return amount >= 0 ? { cashIn: amount, cashOut: 0 } : { cashIn: 0, cashOut: Math.abs(amount) };
}

export function transferMeta(row: ActivityRow): string[] {
  const meta: string[] = [];
  if (row.transferNo) meta.push('Transfer ' + row.transferNo);
  if (row.transferStatus) meta.push('Status: ' + row.transferStatus);
  if (row.transferByName || row.transferToName) meta.push('From ' + (row.transferByName ?? '—') + ' to ' + (row.transferToName ?? '—'));
  if (row.dueAmount && Number(row.dueAmount) > 0) meta.push('Due ' + money(row.dueAmount));
  if (row.receivedAmount && Number(row.receivedAmount) > 0) meta.push('Received ' + money(row.receivedAmount));
  if (row.custodyLabel) meta.push(row.custodyLabel);
  return meta;
}

// ── Date filtering ──────────────────────────────────────────────────────

function dateOnly(value?: string | null): string {
  if (!value) return '';
  const match = String(value).match(/\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? '';
}

export function filterByDate(rows: ActivityRow[], from: string, to: string): ActivityRow[] {
  return rows.filter((row) => {
    const rowDate = dateOnly(row.createdAt);
    if (!rowDate) return true;
    if (from && rowDate < from) return false;
    if (to && rowDate > to) return false;
    return true;
  });
}

// ── Printable rows (running balance) ────────────────────────────────────

export function buildPrintableRows(rows: ActivityRow[], openingCash: number): PrintableRow[] {
  let runningBalance = num(openingCash);
  return [...rows]
    .sort(
      (a, b) =>
        String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || String(a.id).localeCompare(String(b.id)),
    )
    .map((row) => {
      const { category, typeLabel } = classifyActivity(row);
      const { cashIn, cashOut } = getCashDirection(row);
      runningBalance = num(runningBalance + cashIn - cashOut);
      return { ...row, category, typeLabel, cashIn, cashOut, runningBalance };
    });
}

export function scopeRows(rows: PrintableRow[], scope: ActivityScope): PrintableRow[] {
  if (scope === 'all') return rows;
  return rows.filter((row) => row.category === scope);
}

export function scopeOption(scope: ActivityScope): ScopeOption {
  return SCOPE_OPTIONS.find((option) => option.value === scope) ?? SCOPE_OPTIONS[0];
}

// ── Report number ───────────────────────────────────────────────────────

export function reportNo(prefix = 'CAR'): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  return `${prefix}-${stamp}`;
}

// ── HTML builder ─────────────────────────────────────────────────────────

export type CashActivityStatementParams = {
  ctx: ReceptionContext;
  rows: PrintableRow[];
  allRows: PrintableRow[];
  scope: ActivityScope;
  from: string;
  to: string;
  includeSummary: boolean;
  includeRunningBalance: boolean;
  includeSignatures: boolean;
  orientation: Orientation;
  pageSize: PageSize;
  periodOpeningBalance: number;
  cashierName?: string | null;
  documentNo?: string;
  audit?: () => void | Promise<void>;
};

/**
 * Build full HTML document for the cash activity statement.
 * Uses the shared reception renderer (header / footer / watermark / QR).
 */
export function buildCashActivityStatementHtml(params: CashActivityStatementParams): string {
  const {
    ctx,
    rows,
    allRows,
    scope,
    from,
    to,
    includeSummary,
    includeRunningBalance,
    includeSignatures,
    orientation,
    pageSize,
    periodOpeningBalance,
    cashierName,
  } = params;

  const option = scopeOption(scope);
  const openingCash = num(periodOpeningBalance);
  const cashIn = rows.reduce((sum, row) => sum + row.cashIn, 0);
  const cashOut = rows.reduce((sum, row) => sum + row.cashOut, 0);
  const netAmount = num(cashIn - cashOut);
  const transferOut = rows.filter((row) => row.category === 'cashTransfers').reduce((sum, row) => sum + row.cashOut, 0);
  const bankDeposit = rows.filter((row) => row.category === 'bankDeposits').reduce((sum, row) => sum + row.cashOut, 0);
  const closingBalance = allRows.length > 0 ? allRows[allRows.length - 1].runningBalance : openingCash;
  const isStatement = scope !== 'all' && scope !== 'shiftSummary';
  const colSpan = includeRunningBalance ? 8 : 7;

  const summaryHtml = includeSummary
    ? `
    <section class="rec-summary-grid">
      <div class="rec-metric neutral"><span>Opening Cash</span><strong>${escapeHtml(money(openingCash))}</strong></div>
      <div class="rec-metric in"><span>Cash In</span><strong>${escapeHtml(money(cashIn))}</strong></div>
      <div class="rec-metric out"><span>Cash Out</span><strong>${escapeHtml(money(cashOut))}</strong></div>
      <div class="rec-metric out"><span>Transfer Out</span><strong>${escapeHtml(money(transferOut))}</strong></div>
      <div class="rec-metric out"><span>Bank Deposit</span><strong>${escapeHtml(money(bankDeposit))}</strong></div>
      <div class="rec-metric neutral"><span>${isStatement ? 'Net Amount' : 'Closing Balance'}</span><strong>${escapeHtml(money(isStatement ? netAmount : closingBalance))}</strong></div>
    </section>
  `
    : '';

  const rowsHtml =
    rows.length > 0
      ? rows
          .map(
            (row, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(formatDateTime(row.createdAt))}</td>
      <td><span class="rec-pill ${pillClass(row.category)}">${escapeHtml(row.typeLabel)}</span></td>
      <td>${escapeHtml(row.referenceId ? `${row.referenceType ?? 'REF'}-${row.referenceId}` : row.referenceType || '—')}</td>
      <td>${escapeHtml(row.description || row.referenceType || row.movementType || '—')}</td>
      <td class="right">${row.cashIn > 0 ? escapeHtml(money(row.cashIn)) : '—'}</td>
      <td class="right">${row.cashOut > 0 ? escapeHtml(money(row.cashOut)) : '—'}</td>
      ${includeRunningBalance ? `<td class="right">${escapeHtml(money(row.runningBalance))}</td>` : ''}
      <td>${escapeHtml(row.actorName || ctx.generatedBy || '—')}</td>
    </tr>`,
          )
          .join('')
      : `<tr><td colspan="${colSpan}" class="empty">No cash activity found for selected filters.</td></tr>`;

  const metaHtml = `
    <section class="rec-info-grid">
      <div class="rec-info-row"><strong>Date</strong><span>${escapeHtml(from || 'Session start')} to ${escapeHtml(to || 'Current')}</span></div>
      <div class="rec-info-row"><strong>Scope</strong><span>${escapeHtml(option.shortLabel)}</span></div>
      <div class="rec-info-row"><strong>Cashier</strong><span>${escapeHtml(cashierName ?? ctx.cashierName ?? '—')}</span></div>
      <div class="rec-info-row"><strong>Counter</strong><span>${escapeHtml(ctx.counterName || ctx.counterCode || 'Active counter')}</span></div>
      <div class="rec-info-row"><strong>Rows</strong><span>${rows.length}</span></div>
      <div class="rec-info-row"><strong>Paper</strong><span>${escapeHtml(pageSize.toUpperCase())} ${escapeHtml(orientation)}</span></div>
    </section>
  `;

  const body = `
    ${metaHtml}
    ${summaryHtml}
    <section class="rec-section">
      <h3 class="rec-section-title">Activity</h3>
      <table class="rec-table">
        <thead>
          <tr>
            <th style="width:24px">#</th>
            <th style="width:80px">Time</th>
            <th style="width:120px">Type</th>
            <th>Reference</th>
            <th>Description</th>
            <th class="right" style="width:90px">Cash In</th>
            <th class="right" style="width:90px">Cash Out</th>
            ${includeRunningBalance ? '<th class="right" style="width:100px">Balance</th>' : ''}
            <th style="width:120px">User</th>
          </tr>
        </thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </section>
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: option.label, documentNo: params.documentNo ?? reportNo() },
    body,
    {
      pageSize,
      orientation,
      hideToolbar: false,
    },
  );
}

function pillClass(scope: ActivityScope): string {
  switch (scope) {
    case 'expenses':
      return 'danger';
    case 'doctorPayouts':
      return '';
    case 'cashTransfers':
      return 'warn';
    case 'bankDeposits':
      return '';
    case 'patientPayments':
      return 'ok';
    case 'refunds':
      return 'danger';
    case 'shiftSummary':
      return '';
    default:
      return '';
  }
}

// ── Open print window ────────────────────────────────────────────────────

export function openCashActivityStatementWindow(html: string, autoPrint = true): Window | null {
  return openPrintWindow(html, { autoPrint });
}

// Re-export shared utilities so the panel UI doesn't need to import them twice.
export { buildReceptionHeader, buildReceptionFooter, escapeHtml, formatDateTime, money };