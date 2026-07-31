/**
 * Reception — Single Document PDF Generators
 *
 * Nine specialist documents used by reception workflows:
 *  1. Duplicate Receipt          (with watermark + copy no)
 *  2. Shift Opening Slip
 *  3. Cash Denomination Sheet    (standalone)
 *  4. Cash Handover Slip
 *  5. Expense Voucher
 *  6. Refund Voucher
 *  7. Discount Voucher
 *  8. Due Collection Receipt
 *  9. Report Delivery Slip
 *
 * All use the shared `receptionPrint.ts` renderer. Each function returns
 * the full HTML string ready to pass to `openPrintWindow()`.
 */

import {
  buildReceptionFooter,
  buildReceptionHeader,
  buildReceptionSignatureBlock,
  escapeHtml,
  formatDateTime,
  money,
  num,
  wrapReceptionPage,
  openPrintWindow,
  type ReceptionContext,
  type WrapOptions,
} from './receptionPrint';

// ── Helpers ──────────────────────────────────────────────────────────────

const DENOMINATION_NOTES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1] as const;

function infoGrid(rows: Array<[string, string]>): string {
  return `<section class="rec-info-grid">${rows
    .map(
      ([label, value]) => `<div class="rec-info-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`,
    )
    .join('')}</section>`;
}

function summaryGrid(
  metrics: Array<{ label: string; value: string; tone?: 'in' | 'out' | 'neutral' }>,
): string {
  return `<section class="rec-summary-grid">${metrics
    .map(
      (m) =>
        `<div class="rec-metric ${m.tone ?? 'neutral'}"><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(m.value)}</strong></div>`,
    )
    .join('')}</section>`;
}

function tableHeaders(...cells: string[]): string {
  return cells.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
}

function tableRow(...cells: Array<{ value: unknown; align?: 'right' | 'center' | 'left' }>): string {
  return cells
    .map((c) => {
      const cls = c.align ? ` class="right"` : '';
      return `<td${cls}>${escapeHtml(c.value)}</td>`;
    })
    .join('');
}

function vatPill(text: string, tone: 'ok' | 'warn' | 'danger' | '' = ''): string {
  return `<span class="rec-pill ${tone}">${escapeHtml(text)}</span>`;
}

function declaration(text: string): string {
  return `
    <section class="rec-section">
      <p style="font-style:italic;color:#334155;border-left:3px solid #0891a6;padding:6px 10px;background:#f0f9ff;margin-top:8px;">
        ${escapeHtml(text)}
      </p>
    </section>
  `;
}

// ── 1. Duplicate Receipt ────────────────────────────────────────────────

export type DuplicateReceiptInput = {
  bill: {
    id: number | string;
    invoiceNo?: string | null;
    invoiceDate?: string | null;
    patientName?: string | null;
    patientCode?: string | null;
    patientMobile?: string | null;
    items?: Array<{ name?: string; qty?: number; rate?: number; discount?: number; net?: number }>;
    subtotal?: number;
    discount?: number;
    total?: number;
    paid?: number;
    due?: number;
    paymentMethod?: string | null;
    status?: string | null;
    counterName?: string | null;
    cashierName?: string | null;
    printCount?: number;
  };
  copyNumber: number;
};

export function buildDuplicateReceiptHtml(
  input: DuplicateReceiptInput,
  ctx: ReceptionContext,
): string {
  const { bill, copyNumber } = input;
  const itemsHtml =
    bill.items && bill.items.length > 0
      ? `<table class="rec-table">
          <thead><tr>${tableHeaders('Item', 'Qty', 'Rate', 'Discount', 'Net')}</tr></thead>
          <tbody>
            ${bill.items
              .map((it) =>
                tableRow(
                  { value: it.name ?? '—' },
                  { value: it.qty ?? 0, align: 'right' },
                  { value: money(it.rate), align: 'right' },
                  { value: money(it.discount), align: 'right' },
                  { value: money(it.net), align: 'right' },
                ),
              )
              .join('')}
          </tbody>
        </table>`
      : `<p class="empty">No itemized breakdown available for this bill.</p>`;

  const body = `
    ${infoGrid([
      ['Invoice No', bill.invoiceNo ?? `BILL-${bill.id}`],
      ['Invoice Date', formatDateTime(bill.invoiceDate)],
      ['Patient', bill.patientName ?? '—'],
      ['Patient ID', bill.patientCode ?? '—'],
      ['Mobile', bill.patientMobile ?? '—'],
      ['Original Print Count', bill.printCount != null ? String(bill.printCount) : '—'],
    ])}
    <section class="rec-section">
      <h3 class="rec-section-title">Items</h3>
      ${itemsHtml}
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">Payment</h3>
      ${summaryGrid([
        { label: 'Subtotal', value: money(bill.subtotal ?? bill.total) },
        { label: 'Discount', value: money(bill.discount), tone: 'out' },
        { label: 'Total', value: money(bill.total), tone: 'in' },
        { label: 'Paid', value: money(bill.paid), tone: 'in' },
        { label: 'Due', value: money(bill.due), tone: bill.due && num(bill.due) > 0 ? 'out' : 'neutral' },
        { label: 'Method', value: bill.paymentMethod ?? '—' },
      ])}
    </section>
    ${buildReceptionSignatureBlock()}
    ${declaration('This is a duplicate copy of the original receipt issued for accounting/patient reference. The original remains valid.')}
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: 'Duplicate Receipt', status: 'paid' },
    body,
    { copyNumber, watermark: 'duplicate', pageSize: 'a5', orientation: 'portrait', hideSignatures: true },
  );
}

// ── 2. Shift Opening Slip ───────────────────────────────────────────────

export type ShiftOpeningInput = {
  session: {
    id: number | string;
    openedAt?: string | null;
    openingCash: number;
    counterName?: string | null;
    counterCode?: string | null;
    shiftName?: string | null;
    cashierName?: string | null;
    cashierId?: number | string | null;
    employeeId?: number | string | null;
  };
  denominations?: Record<string, number>;
};

export function buildShiftOpeningSlipHtml(
  input: ShiftOpeningInput,
  ctx: ReceptionContext,
): string {
  const { session, denominations } = input;
  const signatures = [
    { role: 'cashier', label: 'Opening Cashier' },
    { role: 'supervisor', label: 'Supervisor' },
  ] satisfies NonNullable<WrapOptions['signatures']>;
  const denomRows = DENOMINATION_NOTES.filter((n) => (denominations?.[`note${n}`] ?? 0) > 0);

  const denomHtml =
    denomRows.length > 0
      ? `<table class="rec-table">
          <thead><tr>${tableHeaders('Note', 'Count', 'Total')}</tr></thead>
          <tbody>
            ${denomRows
              .map((n) => {
                const count = denominations?.[`note${n}`] ?? 0;
                return tableRow(
                  { value: `৳ ${n}` },
                  { value: count, align: 'right' },
                  { value: money(count * n), align: 'right' },
                );
              })
              .join('')}
            <tr><td><strong>Total</strong></td><td></td><td class="right"><strong>${money(session.openingCash)}</strong></td></tr>
          </tbody>
        </table>`
      : `<p class="empty">No denomination breakdown recorded for this opening.</p>`;

  const body = `
    ${infoGrid([
      ['Shift', session.shiftName ?? `#${session.id}`],
      ['Counter', [session.counterCode, session.counterName].filter(Boolean).join(' · ') || '—'],
      ['Opened At', formatDateTime(session.openedAt)],
      ['Cashier', session.cashierName ?? '—'],
      ['Employee ID', String(session.cashierId ?? session.employeeId ?? '—')],
    ])}
    <section class="rec-section">
      <h3 class="rec-section-title">Opening Cash</h3>
      ${summaryGrid([{ label: 'Opening Float', value: money(session.openingCash), tone: 'in' }])}
    </section>
    ${buildReceptionSignatureBlock({ signatures })}
    <section class="rec-section">
      <h3 class="rec-section-title">Denomination Breakdown</h3>
      ${denomHtml}
    </section>
    ${declaration('I, the undersigned, acknowledge that I have received the above opening cash amount in the listed denominations and accept responsibility for its custody during this shift.')}
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: 'Shift Opening Slip', status: 'submitted' },
    body,
    {
      pageSize: 'a5',
      orientation: 'portrait',
      signatures,
      hideSignatures: true,
    },
  );
}

// ── 3. Cash Denomination Sheet (standalone) ─────────────────────────────

export type DenominationSheetInput = {
  shift: {
    id: number | string;
    shiftName?: string | null;
    counterName?: string | null;
    counterCode?: string | null;
    cashierName?: string | null;
    openingCash?: number;
    expectedCash?: number;
    variance?: number;
    closingCashDeclared?: number | null;
  };
  denominations: Record<string, number>;
  countedBy?: string | null;
  checkedBy?: string | null;
  countedAt?: string | null;
  notes?: string | null;
};

export function buildDenominationSheetHtml(
  input: DenominationSheetInput,
  ctx: ReceptionContext,
): string {
  const { shift, denominations, countedBy, checkedBy, countedAt, notes } = input;
  const signatures = [
    { role: 'cashier', label: 'Counted By' },
    { role: 'supervisor', label: 'Checked By' },
    { role: 'admin', label: 'Accounts' },
  ] satisfies NonNullable<WrapOptions['signatures']>;
  const denomRows = DENOMINATION_NOTES;
  const grandTotal = denomRows.reduce((sum, n) => sum + (denominations[`note${n}`] ?? 0) * n, 0);
  const expected = num(shift.expectedCash ?? shift.closingCashDeclared);
  const variance = num(shift.variance ?? grandTotal - expected);

  const body = `
    ${infoGrid([
      ['Shift', shift.shiftName ?? `#${shift.id}`],
      ['Counter', [shift.counterCode, shift.counterName].filter(Boolean).join(' · ') || '—'],
      ['Cashier', shift.cashierName ?? '—'],
      ['Counted At', formatDateTime(countedAt)],
      ['Counted By', countedBy ?? shift.cashierName ?? '—'],
      ['Checked By', checkedBy ?? '—'],
    ])}
    <section class="rec-section">
      <h3 class="rec-section-title">Denomination Count</h3>
      <table class="rec-table">
        <thead><tr>${tableHeaders('Note', 'Count', 'Total')}</tr></thead>
        <tbody>
          ${denomRows
            .map((n) => {
              const count = denominations[`note${n}`] ?? 0;
              return tableRow(
                { value: `৳ ${n}` },
                { value: count, align: 'right' },
                { value: money(count * n), align: 'right' },
              );
            })
            .join('')}
          <tr><td><strong>Total Counted Cash</strong></td><td></td><td class="right"><strong>${money(grandTotal)}</strong></td></tr>
        </tbody>
      </table>
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">Variance Check</h3>
      ${summaryGrid([
        { label: 'Expected Cash', value: money(expected), tone: 'neutral' },
        { label: 'Counted Cash', value: money(grandTotal), tone: 'in' },
        { label: 'Difference', value: money(variance), tone: variance === 0 ? 'neutral' : variance > 0 ? 'in' : 'out' },
        { label: 'Status', value: variance === 0 ? 'BALANCED' : variance > 0 ? 'EXCESS' : 'SHORTAGE', tone: variance === 0 ? 'in' : 'out' },
      ])}
    </section>
    ${buildReceptionSignatureBlock({ signatures })}
    ${notes ? `<section class="rec-section"><h3 class="rec-section-title">Notes</h3><p>${escapeHtml(notes)}</p></section>` : ''}
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: 'Cash Denomination Sheet', status: 'submitted' },
    body,
    {
      pageSize: 'a5',
      orientation: 'portrait',
      signatures,
      hideSignatures: true,
    },
  );
}

// ── 4. Cash Handover Slip ───────────────────────────────────────────────

export type HandoverInput = {
  handover: {
    id: number | string;
    handoverNo?: string | null;
    handoverAt?: string | null;
    fromName?: string | null;
    fromCounter?: string | null;
    toName?: string | null;
    toRole?: string | null;
    toCounter?: string | null;
    amount: number;
    dueAmount?: number;
    variance?: number;
    status?: string | null;
    remarks?: string | null;
    shiftId?: number | string | null;
    shiftName?: string | null;
  };
};

export function buildHandoverSlipHtml(input: HandoverInput, ctx: ReceptionContext): string {
  const h = input.handover;
  const signatures = [
    { role: 'cashier', label: 'Handed Over By' },
    { role: 'receiver', label: 'Received By' },
    { role: 'admin', label: 'Witness / Admin' },
  ] satisfies NonNullable<WrapOptions['signatures']>;
  const variance = num(h.variance ?? 0);

  const body = `
    ${infoGrid([
      ['Handover No', h.handoverNo ?? `HO-${h.id}`],
      ['Date / Time', formatDateTime(h.handoverAt)],
      ['Shift', h.shiftName ?? (h.shiftId ? `#${h.shiftId}` : '—')],
      ['Status', h.status ?? 'Pending'],
    ])}
    <section class="rec-section">
      <h3 class="rec-section-title">From</h3>
      ${infoGrid([
        ['Cashier', h.fromName ?? '—'],
        ['Counter', h.fromCounter ?? '—'],
      ])}
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">To</h3>
      ${infoGrid([
        ['Receiver', h.toName ?? '—'],
        ['Role', h.toRole ?? '—'],
        ['Counter', h.toCounter ?? '—'],
      ])}
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">Amounts</h3>
      ${summaryGrid([
        { label: 'Handover Amount', value: money(h.amount), tone: 'in' },
        { label: 'Due Pending', value: money(h.dueAmount), tone: h.dueAmount && num(h.dueAmount) > 0 ? 'out' : 'neutral' },
        { label: 'Variance', value: money(variance), tone: variance === 0 ? 'neutral' : variance > 0 ? 'in' : 'out' },
        { label: 'Variance Note', value: variance === 0 ? 'Balanced' : variance > 0 ? 'Excess' : 'Shortage' },
      ])}
    </section>
    ${buildReceptionSignatureBlock({ signatures })}
    ${h.remarks ? `<section class="rec-section"><h3 class="rec-section-title">Remarks</h3><p>${escapeHtml(h.remarks)}</p></section>` : ''}
    ${declaration('The above cash has been physically handed over and acknowledged. Receiver confirms receipt of the stated amount.')}
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: 'Cash Handover Slip', status: h.status === 'received' ? 'approved' : 'pending_approval' },
    body,
    {
      pageSize: 'a5',
      orientation: 'portrait',
      signatures,
      hideSignatures: true,
    },
  );
}

// ── 5. Expense Voucher ──────────────────────────────────────────────────

export type ExpenseVoucherInput = {
  expense: {
    id: number | string;
    voucherNo?: string | null;
    date?: string | null;
    category?: string | null;
    description?: string | null;
    vendor?: string | null;
    amount: number;
    paymentMethod?: string | null;
    status?: string | null;
    approvedBy?: string | null;
    paidBy?: string | null;
    receiptRef?: string | null;
  };
};

export function buildExpenseVoucherHtml(input: ExpenseVoucherInput, ctx: ReceptionContext): string {
  const e = input.expense;
  const signatures = [
    { role: 'prepared_by', label: 'Paid By (Receptionist)' },
    { role: 'receiver', label: 'Received By (Vendor)' },
    { role: 'admin', label: 'Approved By (Admin/Accounts)' },
  ] satisfies NonNullable<WrapOptions['signatures']>;
  const status = (e.status ?? 'pending') as 'pending' | 'approved' | 'rejected' | string;

  const body = `
    ${infoGrid([
      ['Voucher No', e.voucherNo ?? `EXP-${e.id}`],
      ['Date', formatDateTime(e.date)],
      ['Category', e.category ?? '—'],
      ['Status', status.toUpperCase()],
    ])}
    <section class="rec-section">
      <h3 class="rec-section-title">Particulars</h3>
      ${infoGrid([
        ['Vendor / Person', e.vendor ?? '—'],
        ['Description', e.description ?? '—'],
        ['Receipt Ref', e.receiptRef ?? '—'],
        ['Paid By', e.paidBy ?? ctx.cashierName ?? '—'],
        ['Payment Method', e.paymentMethod ?? 'Cash'],
      ])}
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">Amount</h3>
      ${summaryGrid([{ label: 'Expense Amount', value: money(e.amount), tone: 'out' }])}
    </section>
    ${buildReceptionSignatureBlock({ signatures })}
    ${declaration('This expense voucher is submitted for approval. Reception may enter but final approval rests with Admin/Accounts.')}
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: 'Expense Voucher', status: status as any },
    body,
    {
      pageSize: 'a5',
      orientation: 'portrait',
      signatures,
      hideSignatures: true,
    },
  );
}

// ── 6. Refund Voucher ───────────────────────────────────────────────────

export type RefundVoucherInput = {
  refund: {
    id: number | string;
    voucherNo?: string | null;
    originalInvoiceNo?: string | null;
    originalBillId?: number | string | null;
    patientName?: string | null;
    patientId?: string | null;
    patientMobile?: string | null;
    amount: number;
    reason?: string | null;
    method?: string | null;
    requestedBy?: string | null;
    approvedBy?: string | null;
    paidBy?: string | null;
    status?: string | null;
    createdAt?: string | null;
  };
};

export function buildRefundVoucherHtml(input: RefundVoucherInput, ctx: ReceptionContext): string {
  const r = input.refund;
  const signatures = [
    { role: 'cashier', label: 'Paid By (Cashier)' },
    { role: 'patient', label: 'Received By (Patient)' },
    { role: 'admin', label: 'Approved By (Admin)' },
  ] satisfies NonNullable<WrapOptions['signatures']>;
  const status = (r.status ?? 'pending') as 'pending' | 'approved' | 'paid' | 'rejected' | string;

  const body = `
    ${infoGrid([
      ['Refund No', r.voucherNo ?? `REF-${r.id}`],
      ['Original Invoice', r.originalInvoiceNo ?? (r.originalBillId ? `BILL-${r.originalBillId}` : '—')],
      ['Date', formatDateTime(r.createdAt)],
      ['Status', status.toUpperCase()],
    ])}
    <section class="rec-section">
      <h3 class="rec-section-title">Patient</h3>
      ${infoGrid([
        ['Name', r.patientName ?? '—'],
        ['Patient ID', r.patientId ?? '—'],
        ['Mobile', r.patientMobile ?? '—'],
      ])}
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">Refund</h3>
      ${summaryGrid([
        { label: 'Refund Amount', value: money(r.amount), tone: 'out' },
        { label: 'Method', value: r.method ?? 'Cash' },
        { label: 'Requested By', value: r.requestedBy ?? ctx.cashierName ?? '—' },
        { label: 'Approved By', value: r.approvedBy ?? 'Pending approval' },
      ])}
    </section>
    ${buildReceptionSignatureBlock({ signatures })}
    <section class="rec-section">
      <h3 class="rec-section-title">Reason</h3>
      <p>${escapeHtml(r.reason ?? '—')}</p>
    </section>
    ${declaration('The above refund has been processed and the patient acknowledges receipt. No cash shall leave the drawer without this voucher being signed by the receiver.')}
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: 'Refund Voucher', status: status as any },
    body,
    {
      pageSize: 'a5',
      orientation: 'portrait',
      signatures,
      hideSignatures: true,
    },
  );
}

// ── 7. Discount Voucher ─────────────────────────────────────────────────

export type DiscountVoucherInput = {
  bill: {
    id: number | string;
    invoiceNo?: string | null;
    patientName?: string | null;
    patientId?: string | null;
    originalAmount: number;
    discountAmount: number;
    discountPercent?: number;
    netAmount: number;
    referenceName?: string | null;
    reason?: string | null;
    approvedBy?: string | null;
    givenBy?: string | null;
    status?: string | null;
    createdAt?: string | null;
  };
};

export function buildDiscountVoucherHtml(input: DiscountVoucherInput, ctx: ReceptionContext): string {
  const b = input.bill;
  const signatures = [
    { role: 'cashier', label: 'Given By (Reception)' },
    { role: 'supervisor', label: 'Reviewed By' },
    { role: 'admin', label: 'Approved By (Admin)' },
  ] satisfies NonNullable<WrapOptions['signatures']>;
  const percent = b.discountPercent != null
    ? b.discountPercent
    : b.originalAmount > 0
    ? (b.discountAmount / b.originalAmount) * 100
    : 0;
  const status = (b.status ?? 'pending') as 'pending' | 'approved' | 'rejected' | string;

  const body = `
    ${infoGrid([
      ['Invoice No', b.invoiceNo ?? `BILL-${b.id}`],
      ['Date', formatDateTime(b.createdAt)],
      ['Patient', b.patientName ?? '—'],
      ['Patient ID', b.patientId ?? '—'],
      ['Status', status.toUpperCase()],
    ])}
    <section class="rec-section">
      <h3 class="rec-section-title">Discount Breakdown</h3>
      ${summaryGrid([
        { label: 'Original Amount', value: money(b.originalAmount) },
        { label: 'Discount', value: money(b.discountAmount), tone: 'out' },
        { label: 'Discount %', value: `${percent.toFixed(1)}%` },
        { label: 'Net Payable', value: money(b.netAmount), tone: 'in' },
      ])}
    </section>
    ${buildReceptionSignatureBlock({ signatures })}
    <section class="rec-section">
      <h3 class="rec-section-title">Approval</h3>
      ${infoGrid([
        ['Reference Name', b.referenceName ?? '—'],
        ['Reason', b.reason ?? '—'],
        ['Given By', b.givenBy ?? ctx.cashierName ?? '—'],
        ['Approved By', b.approvedBy ?? 'Pending approval'],
      ])}
    </section>
    ${declaration('Reception may record this discount, but final approval rests with Admin/Accounts. The patient is charged only the net amount after discount.')}
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: 'Discount Voucher', status: status as any },
    body,
    {
      pageSize: 'a5',
      orientation: 'portrait',
      signatures,
      hideSignatures: true,
    },
  );
}

// ── 8. Due Collection Receipt ──────────────────────────────────────────

export type DueCollectionInput = {
  bill: {
    id: number | string;
    invoiceNo?: string | null;
    patientName?: string | null;
    patientId?: string | null;
    patientMobile?: string | null;
    total: number;
    paid: number;
    due: number;
    previousDue: number;
    collectedNow: number;
    remainingDue: number;
    paymentMethod?: string | null;
    collectedBy?: string | null;
    counterName?: string | null;
    collectedAt?: string | null;
  };
};

export function buildDueCollectionReceiptHtml(input: DueCollectionInput, ctx: ReceptionContext): string {
  const b = input.bill;
  const signatures = [
    { role: 'cashier', label: 'Collected By', subLabel: b.collectedBy ?? ctx.cashierName ?? undefined },
    { role: 'patient', label: 'Received By (Patient)' },
  ] satisfies NonNullable<WrapOptions['signatures']>;

  const body = `
    ${infoGrid([
      ['Receipt No', `DUE-${b.id}-${Date.now().toString(36).toUpperCase()}`],
      ['Original Invoice', b.invoiceNo ?? `BILL-${b.id}`],
      ['Collected At', formatDateTime(b.collectedAt)],
      ['Counter', b.counterName ?? ctx.counterName ?? '—'],
    ])}
    <section class="rec-section">
      <h3 class="rec-section-title">Patient</h3>
      ${infoGrid([
        ['Name', b.patientName ?? '—'],
        ['Patient ID', b.patientId ?? '—'],
        ['Mobile', b.patientMobile ?? '—'],
      ])}
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">Collection</h3>
      ${summaryGrid([
        { label: 'Previous Due', value: money(b.previousDue), tone: 'out' },
        { label: 'Collected Now', value: money(b.collectedNow), tone: 'in' },
        { label: 'Remaining Due', value: money(b.remainingDue), tone: b.remainingDue > 0 ? 'out' : 'neutral' },
        { label: 'Payment Method', value: b.paymentMethod ?? 'Cash' },
        { label: 'Bill Total', value: money(b.total) },
        { label: 'Total Paid', value: money(b.paid), tone: 'in' },
      ])}
    </section>
    ${buildReceptionSignatureBlock({ signatures })}
    ${declaration('This is a receipt for collection of outstanding dues from the original bill referenced above. Any balance shown as "Remaining Due" is still payable.')}
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: 'Due Collection Receipt', status: b.remainingDue > 0 ? 'partial' : 'paid' },
    body,
    {
      pageSize: 'a5',
      orientation: 'portrait',
      signatures,
      hideSignatures: true,
    },
  );
}

// ── 9. Report Delivery Slip ────────────────────────────────────────────

export type ReportDeliveryInput = {
  order: {
    id: number | string;
    orderNo?: string | null;
    invoiceNo?: string | null;
    patientName?: string | null;
    patientId?: string | null;
    patientMobile?: string | null;
    tests?: Array<{ name?: string; status?: string }>;
    orderStatus?: string | null;
    deliveredTo?: string | null;
    receiverPhone?: string | null;
    deliveredBy?: string | null;
    deliveredAt?: string | null;
    priority?: 'normal' | 'urgent' | string;
    paymentStatus?: string | null;
  };
};

export function buildReportDeliverySlipHtml(input: ReportDeliveryInput, ctx: ReceptionContext): string {
  const o = input.order;
  const tests = o.tests ?? [];
  const priorityTone = o.priority === 'urgent' ? 'danger' : '';

  const body = `
    ${infoGrid([
      ['Delivery Slip No', `DLV-${o.id}-${Date.now().toString(36).toUpperCase()}`],
      ['Order No', o.orderNo ?? `LAB-${o.id}`],
      ['Invoice No', o.invoiceNo ?? '—'],
      ['Delivered At', formatDateTime(o.deliveredAt)],
    ])}
    <section class="rec-section">
      <h3 class="rec-section-title">Patient</h3>
      ${infoGrid([
        ['Name', o.patientName ?? '—'],
        ['Patient ID', o.patientId ?? '—'],
        ['Mobile', o.patientMobile ?? '—'],
      ])}
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">Tests Delivered</h3>
      ${
        tests.length > 0
          ? `<table class="rec-table">
              <thead><tr>${tableHeaders('Test', 'Status')}</tr></thead>
              <tbody>
                ${tests.map((t) => tableRow({ value: t.name ?? '—' }, { value: (t.status ?? 'Ready').toUpperCase() })).join('')}
              </tbody>
            </table>`
          : `<p class="empty">No test items recorded.</p>`
      }
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">Order Status</h3>
      ${summaryGrid([
        { label: 'Order Status', value: o.orderStatus ?? 'Ready' },
        { label: 'Priority', value: (o.priority ?? 'normal').toUpperCase() },
        { label: 'Payment', value: o.paymentStatus ?? '—' },
        { label: 'Delivered By', value: o.deliveredBy ?? ctx.cashierName ?? '—' },
      ])}
    </section>
    <section class="rec-section">
      <h3 class="rec-section-title">Receiver</h3>
      ${infoGrid([
        ['Delivered To', o.deliveredTo ?? 'Patient / Attendant'],
        ['Receiver Phone', o.receiverPhone ?? '—'],
      ])}
    </section>
    ${declaration('The above diagnostic report has been delivered to the named receiver. The receiver acknowledges receipt and confirms that the report is sealed and unopened.')}
  `;

  return wrapReceptionPage(
    { ...ctx, documentTitle: 'Report Delivery Slip', status: 'submitted' },
    body,
    {
      pageSize: 'a5',
      orientation: 'portrait',
      signatures: [
        { role: 'delivered_to', label: 'Delivered To (Patient / Attendant)' },
        { role: 'receiver', label: 'Delivered By (Reception)' },
      ],
    },
  );
}

// ── Convenience: open print window with audit callback ──────────────────

export function openSingleDocumentWindow(
  html: string,
  options: WrapOptions & { autoPrint?: boolean } = {},
): Window | null {
  return openPrintWindow(html, { autoPrint: options.autoPrint ?? true, onAfterPrint: options.onAfterPrint });
}
