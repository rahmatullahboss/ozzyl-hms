/**
 * Reception Print Center
 *
 * Central page for reception-side PDF generation. Replaces the old shared
 * `ReceptionPdfGenerationPage` for the `reception` / `receptionist` role.
 *
 * Sections:
 *   1. Single Documents   — 9 quick-action PDFs (vouchers, slips, delivery slip)
 *   2. Statements & Reports — reception-suitable reports (own scope only)
 *
 * Admin reports (auditLog, doctorPayout, allCounter, departmentIncome,
 * doctorPerformance, referralReport) are NOT exposed here.
 */

import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { FileText, Printer, Receipt, Wallet, Users, FileCheck2, Truck, Ticket, BadgePercent, RefreshCcw, ClipboardList, BadgeDollarSign, Coins, ArrowRightLeft, FileBarChart, Stethoscope, TestTube, Activity, CreditCard, HandCoins, ClipboardCheck, BedDouble } from 'lucide-react';
import toast from 'react-hot-toast';
import DashboardLayout from '../../components/DashboardLayout';
import ReceptionTopBar from '../../components/reception/ReceptionTopBar';
import { useApiQuery, useQueryClient } from '../../hooks/useApiQuery';
import { useAuth } from '../../hooks/useAuth';
import { getTodayGMT6 } from '../../lib/date-utils';
import { api } from '../../lib/apiClient';
import {
  buildCashActivityStatementHtml,
  buildPrintableRows,
  scopeOption,
  type ActivityScope,
} from '../../lib/print/reception/cashActivityStatement';
import {
  buildDenominationSheetHtml,
  buildDiscountVoucherHtml,
  buildDueCollectionReceiptHtml,
  buildDuplicateReceiptHtml,
  buildExpenseVoucherHtml,
  buildHandoverSlipHtml,
  buildReportDeliverySlipHtml,
  buildShiftOpeningSlipHtml,
  buildRefundVoucherHtml,
  openSingleDocumentWindow,
} from '../../lib/print/reception/singleDocuments';
import { openPrintWindow } from '../../lib/print/reception/receptionPrint';

// ── Single-document action definitions ──────────────────────────────────

type SingleDoc = {
  key: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  /** When true, an ID input is shown above the action button. */
  needsId?: 'billId' | 'orderId' | 'expenseId' | 'handoverId';
  build: (input: { id: string; ctx: Ctx }) => string;
  /** Audit metadata for soft logging */
  auditType: string;
};

type Ctx = {
  hospitalName: string;
  branchName?: string | null;
  counterName?: string | null;
  counterCode?: string | null;
  shiftId?: number | string | null;
  shiftName?: string | null;
  cashierName?: string | null;
  generatedBy?: string | null;
  status?: 'draft' | 'submitted' | 'pending_approval' | 'approved' | 'cancelled' | 'paid' | 'partial' | 'due';
  documentNo?: string | null;
  documentTitle?: string | null;
};

const SINGLE_DOCS: SingleDoc[] = [
  {
    key: 'duplicate_receipt',
    title: 'Duplicate Receipt',
    description: 'Reprint a patient bill with watermark + copy number. Audit logged.',
    icon: Receipt,
    needsId: 'billId',
    auditType: 'duplicate_receipt',
    build: ({ id, ctx }) =>
      buildDuplicateReceiptHtml(
        {
          bill: { id: Number(id), printCount: 0 },
          copyNumber: Math.max(2, Math.floor(Date.now() / 1000) % 999),
        },
        ctx,
      ),
  },
  {
    key: 'shift_opening',
    title: 'Shift Opening Slip',
    description: 'Opening cash evidence — generated after counter activation.',
    icon: ClipboardCheck,
    auditType: 'shift_opening',
    build: ({ ctx }) =>
      buildShiftOpeningSlipHtml(
        {
          session: {
            id: ctx.shiftId ?? 'CURRENT',
            openedAt: new Date().toISOString(),
            openingCash: 0,
            counterName: ctx.counterName,
            counterCode: ctx.counterCode,
            shiftName: ctx.shiftName,
            cashierName: ctx.cashierName,
          },
        },
        ctx,
      ),
  },
  {
    key: 'denomination_sheet',
    title: 'Cash Denomination Sheet',
    description: 'Standalone denomination count sheet for shift close.',
    icon: Coins,
    auditType: 'denomination_sheet',
    build: ({ ctx }) =>
      buildDenominationSheetHtml(
        {
          shift: {
            id: ctx.shiftId ?? 'CURRENT',
            shiftName: ctx.shiftName,
            counterName: ctx.counterName,
            counterCode: ctx.counterCode,
            cashierName: ctx.cashierName,
            expectedCash: 0,
          },
          denominations: {},
        },
        ctx,
      ),
  },
  {
    key: 'handover_slip',
    title: 'Cash Handover Slip',
    description: 'Evidence of cash handover between cashiers / admin.',
    icon: ArrowRightLeft,
    needsId: 'handoverId',
    auditType: 'handover_slip',
    build: ({ id, ctx }) =>
      buildHandoverSlipHtml(
        {
          handover: {
            id,
            handoverAt: new Date().toISOString(),
            amount: 0,
            fromName: ctx.cashierName ?? '—',
            fromCounter: ctx.counterName ?? '—',
            status: 'submitted',
          },
        },
        ctx,
      ),
  },
  {
    key: 'expense_voucher',
    title: 'Expense Voucher',
    description: 'Single expense entry with category, vendor, approval status.',
    icon: Wallet,
    needsId: 'expenseId',
    auditType: 'expense_voucher',
    build: ({ id, ctx }) =>
      buildExpenseVoucherHtml(
        {
          expense: {
            id,
            amount: 0,
            status: 'pending',
            paidBy: ctx.cashierName,
          },
        },
        ctx,
      ),
  },
  {
    key: 'refund_voucher',
    title: 'Refund Voucher',
    description: 'Formal refund document with original bill reference + approval.',
    icon: RefreshCcw,
    needsId: 'billId',
    auditType: 'refund_voucher',
    build: ({ id, ctx }) =>
      buildRefundVoucherHtml(
        {
          refund: {
            id,
            originalBillId: id,
            amount: 0,
            status: 'pending',
            requestedBy: ctx.cashierName,
          },
        },
        ctx,
      ),
  },
  {
    key: 'discount_voucher',
    title: 'Discount Voucher',
    description: 'Per-invoice discount record with reference and approval status.',
    icon: BadgePercent,
    needsId: 'billId',
    auditType: 'discount_voucher',
    build: ({ id, ctx }) =>
      buildDiscountVoucherHtml(
        {
          bill: {
            id,
            originalAmount: 0,
            discountAmount: 0,
            netAmount: 0,
            status: 'pending',
            givenBy: ctx.cashierName,
          },
        },
        ctx,
      ),
  },
  {
    key: 'due_collection',
    title: 'Due Collection Receipt',
    description: 'Receipt for collection of outstanding dues from a prior bill.',
    icon: BadgeDollarSign,
    needsId: 'billId',
    auditType: 'due_collection',
    build: ({ id, ctx }) =>
      buildDueCollectionReceiptHtml(
        {
          bill: {
            id,
            total: 0,
            paid: 0,
            due: 0,
            previousDue: 0,
            collectedNow: 0,
            remainingDue: 0,
            collectedBy: ctx.cashierName,
          },
        },
        ctx,
      ),
  },
  {
    key: 'report_delivery',
    title: 'Report Delivery Slip',
    description: 'Per-patient diagnostic report delivery with receiver signature.',
    icon: Truck,
    needsId: 'orderId',
    auditType: 'report_delivery',
    build: ({ id, ctx }) =>
      buildReportDeliverySlipHtml(
        {
          order: {
            id,
            deliveredBy: ctx.cashierName,
          },
        },
        ctx,
      ),
  },
];

// ── Reception-suitable report definitions ───────────────────────────────

type ReportType =
  | 'dailyCollection'
  | 'paymentMethod'
  | 'userCollection'
  | 'dueBills'
  | 'invoiceSummary'
  | 'patientRegistration'
  | 'visitReport'
  | 'testReport'
  | 'reportDelivery'
  | 'ipdAdmission'
  | 'serviceItemSales'
  | 'cashActivity'
  | 'shiftHandover';

type ReportOption = {
  value: ReportType;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
};

const RECEPTION_REPORTS: ReportOption[] = [
  { value: 'dailyCollection', title: 'Daily Collection Report', description: 'Date-wise collection + payment method + service totals.', icon: Coins },
  { value: 'paymentMethod', title: 'Payment Method Report', description: 'Cash, bKash, Nagad, card, bank split.', icon: CreditCard },
  { value: 'userCollection', title: 'User Collection Report', description: 'Cashier-wise sales, due collection, discount and net.', icon: Users },
  { value: 'dueBills', title: 'Due Bills Report', description: 'Outstanding bills for follow-up.', icon: ClipboardList },
  { value: 'invoiceSummary', title: 'Invoice Summary', description: 'All invoice rows with paid / due status.', icon: FileText },
  { value: 'patientRegistration', title: 'Patient Registration', description: 'New patient registrations summary.', icon: FileCheck2 },
  { value: 'visitReport', title: 'Visit Report', description: 'Doctor visit-only totals + commission.', icon: Stethoscope },
  { value: 'testReport', title: 'Test Report', description: 'Diagnostic test-only totals + commission.', icon: TestTube },
  { value: 'reportDelivery', title: 'Report Delivery Queue', description: 'Ready / pending lab report delivery list.', icon: Ticket },
  { value: 'ipdAdmission', title: 'IPD Admission Report', description: 'Admission, discharge and running admitted patient summary.', icon: BedDouble },
  { value: 'serviceItemSales', title: 'Service Item Sales', description: 'Service category / item billed sales totals.', icon: FileBarChart },
  { value: 'cashActivity', title: 'Cash Activity Statement', description: 'Cash in / out with running balance.', icon: Activity },
  { value: 'shiftHandover', title: 'Shift Handover Report', description: 'Cashier accountability + variance.', icon: HandCoins },
];

// ── Page ────────────────────────────────────────────────────────────────

type CashActivityResponse = { activity: Array<{ id: string; source?: string; createdAt?: string; actorName?: string | null; movementType?: string; referenceType?: string; referenceId?: number | null; amount?: number; description?: string | null }> };

export default function ReceptionPrintCenter() {
  const { slug = '' } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState(getTodayGMT6());
  const [dateTo, setDateTo] = useState(getTodayGMT6());
  const [reportType, setReportType] = useState<ReportType>('dailyCollection');
  const [docInputs, setDocInputs] = useState<Record<string, string>>({});
  const [cashScope, setCashScope] = useState<ActivityScope>('all');

  const hospitalName = String((user as any)?.hospitalName ?? (user as any)?.tenantName ?? (user as any)?.hospital_name ?? 'Hospital');
  const generatedBy = String((user as any)?.name ?? (user as any)?.username ?? 'Reception');

  // ── Build reception context from auth/active counter ──────────────────
  const ctx: Ctx = useMemo(
    () => ({
      hospitalName,
      branchName: (user as any)?.branchName ?? null,
      counterName: (user as any)?.counterName ?? (user as any)?.activeCounterName ?? 'Reception Counter',
      counterCode: (user as any)?.counterCode ?? null,
      shiftId: (user as any)?.activeShiftId ?? null,
      shiftName: (user as any)?.activeShiftName ?? null,
      cashierName: (user as any)?.name ?? null,
      generatedBy,
    }),
    [generatedBy, hospitalName, user],
  );

  // Cash Activity is rendered locally; other reports load data in the PDF designer.
  const { data: cashActivityData } = useApiQuery<CashActivityResponse>(
    ['reception-print', 'cash-activity', dateFrom, dateTo],
    `/api/cash-operations/activity?limit=500&from=${dateFrom}&to=${dateTo}`,
  );

  // ── Single-document actions ──────────────────────────────────────────
  const runSingleDoc = (doc: SingleDoc) => {
    if (doc.needsId && !docInputs[doc.needsId]?.trim()) {
      toast.error(`Please enter ${doc.needsId.replace('Id', ' ID').toUpperCase()}`);
      return;
    }
    const id = doc.needsId ? docInputs[doc.needsId].trim() : '';
    const html = doc.build({ id, ctx });
    const win = openSingleDocumentWindow(html, {
      autoPrint: true,
      onAfterPrint: () => {
        // Soft audit (fire-and-forget). Backend route added in Step 6.
        void api.post('/api/reception/print-audit', {
          documentType: doc.auditType,
          documentId: id || 'CURRENT',
          copyNumber: 1,
          generatedAt: new Date().toISOString(),
        }).catch(() => { /* silent fail — audit is best-effort */ });
        // For duplicate receipts specifically, also increment the bill's print_count
        // so the backend can detect reprints.
        if (doc.key === 'duplicate_receipt' && id) {
          void api.post(`/api/billing/${encodeURIComponent(id)}/print-count`, {}).catch(() => { /* silent fail */ });
        }
      },
    });
    if (!win) toast.error('Popup blocked — allow popups to print.');
  };

  const openReportDesigner = (type: ReportType) => {
    const params = new URLSearchParams({ report: type, from: dateFrom, to: dateTo });
    const url = `${slug ? `/h/${slug}` : ''}/reception/reports/pdf?${params.toString()}`;
    window.open(url, '_blank');
    toast.success(`Opening ${titleForType(type)} designer…`);
  };

  // ── Report actions ───────────────────────────────────────────────────
  const runReport = (type: ReportType) => {
    if (type === 'cashActivity') {
      // Use the new reception renderer for cash activity (8-scope statement)
      const activity = cashActivityData?.activity ?? [];
      const printableRows = buildPrintableRows(activity, 0);
      const html = buildCashActivityStatementHtml({
        ctx,
        rows: printableRows,
        allRows: printableRows,
        scope: cashScope,
        from: dateFrom,
        to: dateTo,
        includeSummary: true,
        includeRunningBalance: true,
        includeSignatures: true,
        orientation: 'portrait',
        pageSize: 'a4',
        periodOpeningBalance: 0,
      });
      const win = openPrintWindow(html, { autoPrint: true });
      if (!win) toast.error('Popup blocked.');
      return;
    }

    openReportDesigner(type);
  };

  return (
    <DashboardLayout role="reception" fullWidth>
      <div className="mx-auto max-w-screen-2xl space-y-4">
        <ReceptionTopBar role="reception" />

        <section className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">Reception</p>
              <h1 className="mt-1 text-xl font-bold text-[var(--color-text-primary)]">Reception Print Center</h1>
              <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                Generate single documents (vouchers, slips, delivery slip) and statements for your shift. Counter is locked to your active counter.
              </p>
            </div>
            <button
              type="button"
              className="btn-ghost inline-flex items-center gap-2 text-sm"
              onClick={() => {
                queryClient.invalidateQueries({ queryKey: ['reception-print'] });
                toast.success('Data refreshed');
              }}
            >
              <RefreshCcw className="h-4 w-4" /> Refresh
            </button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="text-sm font-medium text-[var(--color-text-primary)]">Date From
              <input className="input mt-1" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="text-sm font-medium text-[var(--color-text-primary)]">Date To
              <input className="input mt-1" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
            <div className="text-sm">
              <strong className="text-[var(--color-text-muted)]">Active Counter:</strong>
              <p className="mt-1 font-mono text-sm">
                {ctx.counterName ?? '—'} {ctx.shiftName ? `· ${ctx.shiftName}` : ''}
              </p>
            </div>
          </div>
        </section>

        {/* Single Documents */}
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            Single Documents
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SINGLE_DOCS.map((doc) => {
              const Icon = doc.icon;
              return (
                <div key={doc.key} className="rounded-xl border border-[var(--color-border)] bg-white p-4 shadow-sm dark:bg-slate-900">
                  <div className="flex items-start gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-600 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-bold text-[var(--color-text-primary)]">{doc.title}</h3>
                      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{doc.description}</p>
                    </div>
                  </div>
                  {doc.needsId ? (
                    <label className="mt-3 block text-xs font-medium text-[var(--color-text-primary)]">
                      {doc.needsId.replace('Id', ' ID').toUpperCase()}
                      <input
                        className="input mt-1"
                        type="text"
                        value={docInputs[doc.needsId] ?? ''}
                        onChange={(e) => setDocInputs((s) => ({ ...s, [doc.needsId!]: e.target.value }))}
                        placeholder={`Enter ${doc.needsId}`}
                      />
                    </label>
                  ) : null}
                  <button
                    type="button"
                    className="btn-primary mt-3 inline-flex w-full items-center justify-center gap-2 text-sm"
                    onClick={() => runSingleDoc(doc)}
                  >
                    <Printer className="h-4 w-4" /> Generate
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* Statements & Reports */}
        <section>
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
            Statements &amp; Reports
          </h2>

          <div className="mb-3 flex flex-wrap items-center gap-3">
            <label className="text-xs font-medium text-[var(--color-text-primary)]">
              Selected:
              <select
                className="input ml-1 inline-block w-auto"
                value={reportType}
                onChange={(e) => setReportType(e.target.value as ReportType)}
              >
                {RECEPTION_REPORTS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.title}</option>
                ))}
              </select>
            </label>

            {reportType === 'cashActivity' ? (
              <label className="text-xs font-medium text-[var(--color-text-primary)]">
                Scope:
                <select
                  className="input ml-1 inline-block w-auto"
                  value={cashScope}
                  onChange={(e) => setCashScope(e.target.value as ActivityScope)}
                >
                  {(['all', 'patientPayments', 'expenses', 'doctorPayouts', 'cashTransfers', 'bankDeposits', 'refunds', 'shiftSummary'] as ActivityScope[]).map((s) => (
                    <option key={s} value={s}>{scopeOption(s).label}</option>
                  ))}
                </select>
              </label>
            ) : null}

            <button
              type="button"
              className="btn-primary inline-flex items-center gap-2 text-sm"
              onClick={() => runReport(reportType)}
            >
              <Printer className="h-4 w-4" /> Generate
            </button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {RECEPTION_REPORTS.map((opt) => {
              const Icon = opt.icon;
              const active = opt.value === reportType;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setReportType(opt.value)}
                  className={`rounded-xl border p-3 text-left transition ${active ? 'border-cyan-400 bg-cyan-50 ring-2 ring-cyan-100 dark:bg-cyan-950/30' : 'border-[var(--color-border)] bg-white hover:border-cyan-200 dark:bg-slate-900'}`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`grid h-8 w-8 place-items-center rounded-lg ${active ? 'bg-cyan-600 text-white' : 'bg-cyan-100 text-cyan-700'}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-[var(--color-text-primary)]">{opt.title}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--color-text-muted)] line-clamp-2">{opt.description}</p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <p className="text-xs text-[var(--color-text-muted)]">
          Counter / shift context: <strong>{ctx.counterName ?? '—'}</strong> · Cashier: <strong>{ctx.cashierName ?? '—'}</strong>.
          All prints are audit-logged with your user ID and timestamp.
        </p>
      </div>
    </DashboardLayout>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function titleForType(t: string): string {
  return RECEPTION_REPORTS.find((r) => r.value === t)?.title ?? t;
}
