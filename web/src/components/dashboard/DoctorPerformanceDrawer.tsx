import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { executiveAnalyticsQuery } from '../../hooks/useExecutiveDashboardAnalytics';
import type {
  DoctorActivityResponse,
  DoctorCommissionDetailRow,
  DoctorPerformanceDetailsResponse,
  DoctorPerformanceDetailsSummary,
  DoctorPerformanceDetailsTab,
  DoctorPerformanceRow,
  DoctorTestDetailRow,
  DoctorVisitDetailRow,
  ExecutiveDashboardFilters,
} from '../../types/executiveDashboard';
import CommissionCalculationBridge from './CommissionCalculationBridge';
import {
  DASHBOARD_DIALOG_OVERLAY_CLASS,
  DashboardDialogPortal,
  useDashboardDialogLayer,
} from './DashboardDialogLayer';
import DoctorActivityTimeline from './DoctorActivityTimeline';

interface Props {
  doctor: DoctorPerformanceRow | null;
  filters: ExecutiveDashboardFilters;
  queryKeyScope: 'admin' | 'md' | 'director';
  onClose: () => void;
  onInvoiceOpen?: (billId: number) => void;
}

type DrawerTab = 'summary' | 'activity' | 'visits' | 'referred-tests' | 'performed-tests' | 'compensation';

const DRAWER_TABS: Array<{ value: DrawerTab; label: string }> = [
  { value: 'summary', label: 'Summary' },
  { value: 'activity', label: 'Activity' },
  { value: 'visits', label: 'Visits' },
  { value: 'referred-tests', label: 'Referred Tests' },
  { value: 'performed-tests', label: 'Performed Tests' },
  { value: 'compensation', label: 'Compensation' },
];

const count = (value: number) => new Intl.NumberFormat('en-BD', { maximumFractionDigits: 0 }).format(Number(value || 0));
const money = (value: number) => `৳${new Intl.NumberFormat('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0))}`;
const display = (value: string | null | undefined) => value?.trim() || 'Not recorded';
const titleCase = (value: string | null | undefined) => {
  const normalized = value?.trim().replace(/[_-]+/g, ' ');
  return normalized ? normalized.replace(/\b\w/g, (letter) => letter.toUpperCase()) : 'Not recorded';
};

function endpointTab(tab: DrawerTab): DoctorPerformanceDetailsTab {
  if (tab === 'compensation') return 'commissions';
  if (tab === 'referred-tests' || tab === 'performed-tests' || tab === 'visits') return tab;
  return 'visits';
}

function SummaryCard({ label, value, valueType = 'money', emphasis = false }: {
  label: string;
  value: number;
  valueType?: 'money' | 'count';
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-xl border p-3 ${emphasis ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary-light)]/40' : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60'}`}>
      <p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p>
      <p className={`mt-1 font-data text-base ${emphasis ? 'font-bold text-[var(--color-primary)]' : 'font-semibold text-[var(--color-text-primary)]'}`}>
        {valueType === 'count' ? count(value) : money(value)}
      </p>
    </div>
  );
}

function DoctorSummary({ summary }: { summary: DoctorPerformanceDetailsSummary }) {
  return (
    <section aria-label="Doctor selected-period summary">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Complete selected-period summary</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        <SummaryCard label="Visits" value={summary.visits} valueType="count" />
        <SummaryCard label="Referred Tests" value={summary.referredTests} valueType="count" />
        <SummaryCard label="Discounted Tests" value={summary.discountedTests} valueType="count" />
        <SummaryCard label="Performed Tests" value={summary.performedTests} valueType="count" />
        <SummaryCard label="Visit Collection" value={summary.visitCollection} />
        <SummaryCard label="Test Gross" value={summary.testGrossAmount} />
        <SummaryCard label="Test Discount" value={summary.testDiscountAmount} />
        <SummaryCard label="Test Collection" value={summary.testCollection} />
        <SummaryCard label="Performer Reserve" value={summary.performerReserveAmount} />
        <SummaryCard label="Earned" value={summary.earnedCommission} />
        <SummaryCard label="Doctor Waiver" value={summary.doctorWaiver} />
        <SummaryCard label="Payable" value={summary.payableCommission} emphasis />
        <SummaryCard label="Paid" value={summary.paidCommission} />
        <SummaryCard label="Outstanding" value={summary.outstandingCommission} emphasis={summary.outstandingCommission > 0} />
      </div>
      <p className="mt-3 text-xs text-[var(--color-text-muted)]">Server totals cover all matching rows. Detail pages are evidence views and do not recalculate compensation.</p>
    </section>
  );
}

function InvoiceButton({ billId, invoiceNo, onInvoiceOpen }: {
  billId?: number | null;
  invoiceNo?: string | null;
  onInvoiceOpen?: (billId: number) => void;
}) {
  if (!billId || !onInvoiceOpen) return invoiceNo ? <span className="text-xs text-[var(--color-text-muted)]">{invoiceNo}</span> : null;
  return (
    <button
      type="button"
      className="min-h-11 rounded-lg border border-[var(--color-border)] px-3 text-sm font-semibold text-[var(--color-primary)] hover:bg-[var(--color-bg-secondary)]"
      aria-label={`Open invoice ${invoiceNo || billId}`}
      onClick={() => onInvoiceOpen(billId)}
    >
      {invoiceNo || `Bill ${billId}`}
    </button>
  );
}

function VisitsList({ rows, onInvoiceOpen }: { rows: DoctorVisitDetailRow[]; onInvoiceOpen?: (billId: number) => void }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <article key={row.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-[var(--color-text-primary)]">{display(row.serviceName)}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{display(row.occurredAt)} · {display(row.patientName)} · {titleCase(row.status)}</p>
            </div>
            <InvoiceButton billId={row.billId} invoiceNo={row.invoiceNo} onInvoiceOpen={onInvoiceOpen} />
          </div>
          <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
            <div><dt className="text-xs text-[var(--color-text-muted)]">Billed</dt><dd className="font-data font-semibold">{money(row.billedAmount)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Collected</dt><dd className="font-data font-semibold">{money(row.collectedAmount)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Due</dt><dd className="font-data font-semibold">{money(row.dueAmount)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

function TestsList({ rows, onInvoiceOpen }: { rows: DoctorTestDetailRow[]; onInvoiceOpen?: (billId: number) => void }) {
  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <article key={row.id} className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)]/40 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="font-semibold text-[var(--color-text-primary)]">{display(row.testName)}</p>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">{display(row.occurredAt)} · {display(row.patientName)} · {titleCase(row.status)}</p>
            </div>
            <InvoiceButton billId={row.billId} invoiceNo={row.invoiceNo} onInvoiceOpen={onInvoiceOpen} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
            <div><dt className="text-xs text-[var(--color-text-muted)]">Referring doctor</dt><dd className="text-sm font-semibold">{display(row.referringDoctorName)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Ordering clinician</dt><dd className="text-sm font-semibold">{display(row.orderingClinicianName)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Performing doctor</dt><dd className="text-sm font-semibold">{display(row.performingDoctorName)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Accession</dt><dd className="text-sm font-semibold">{display(row.accessionNo)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Gross / discount</dt><dd className="font-data text-sm font-semibold">{money(row.grossAmount)} / {money(row.discountAmount)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Collected / due</dt><dd className="font-data text-sm font-semibold">{money(row.collectedAmount)} / {money(row.dueAmount)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Earned / waiver</dt><dd className="font-data text-sm font-semibold">{money(row.earnedAmount)} / {money(row.waiverAmount)}</dd></div>
            <div><dt className="text-xs text-[var(--color-text-muted)]">Payable / outstanding</dt><dd className="font-data text-sm font-bold">{money(row.payableAmount)} / {money(row.outstandingAmount)}</dd></div>
          </dl>
        </article>
      ))}
    </div>
  );
}

export default function DoctorPerformanceDrawer({ doctor, filters, queryKeyScope, onClose, onInvoiceOpen }: Props) {
  const [tab, setTab] = useState<DrawerTab>('summary');
  const [page, setPage] = useState(1);
  const { dialogRef, initialFocusRef } = useDashboardDialogLayer({ open: Boolean(doctor), onClose });
  const doctorId = doctor?.doctorId == null ? 'unassigned' : String(doctor.doctorId);
  const periodQuery = executiveAnalyticsQuery({ ...filters, doctorId: undefined, testSearch: undefined });
  const selectedEndpointTab = endpointTab(tab);
  const detailsPath = `/api/dashboard/doctor-performance/details?doctorId=${encodeURIComponent(doctorId)}&tab=${selectedEndpointTab}&${periodQuery}&page=${page}&pageSize=50`;
  const activityPath = `/api/dashboard/doctor-performance/activity?doctorId=${encodeURIComponent(doctorId)}&${periodQuery}&page=${page}&pageSize=50`;
  const detailsQuery = useApiQuery<DoctorPerformanceDetailsResponse>(
    [queryKeyScope, 'executive-analytics', 'doctor-details', doctorId, selectedEndpointTab, periodQuery, page],
    detailsPath,
    { enabled: Boolean(doctor) && tab !== 'activity', placeholderData: undefined },
  );
  const activityQuery = useApiQuery<DoctorActivityResponse>(
    [queryKeyScope, 'executive-analytics', 'doctor-activity', doctorId, periodQuery, page],
    activityPath,
    { enabled: Boolean(doctor) && tab === 'activity', placeholderData: undefined },
  );

  useEffect(() => {
    setTab('summary');
    setPage(1);
  }, [doctor?.doctorId]);

  useEffect(() => {
    setPage(1);
  }, [filters.startDate, filters.endDate]);

  if (!doctor) return null;

  const isActivity = tab === 'activity';
  const activeQuery = isActivity ? activityQuery : detailsQuery;
  const hasCurrentData = Boolean(activeQuery.data) && !activeQuery.isPlaceholderData;
  const detailRows = !isActivity && hasCurrentData ? detailsQuery.data?.rows ?? [] : [];
  const activityRows = isActivity && hasCurrentData ? activityQuery.data?.rows ?? [] : [];
  const currentPage = hasCurrentData ? activeQuery.data?.page ?? page : page;
  const totalRows = hasCurrentData ? activeQuery.data?.totalRows ?? 0 : 0;
  const hasNextPage = hasCurrentData ? activeQuery.data?.hasNextPage ?? false : false;
  const showPagination = tab !== 'summary';

  const content = (() => {
    if (activeQuery.isLoading || (activeQuery.isPlaceholderData && !activeQuery.isError)) {
      return <div aria-label="Loading doctor details" className="space-y-3"><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-24 rounded-xl" /></div>;
    }
    if (activeQuery.isError) {
      return <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Unable to load doctor details.</div>;
    }
    if (tab === 'summary') {
      return hasCurrentData && detailsQuery.data?.summary ? <DoctorSummary summary={detailsQuery.data.summary} /> : null;
    }
    if (isActivity) {
      return activityRows.length > 0
        ? <DoctorActivityTimeline rows={activityRows} onInvoiceOpen={onInvoiceOpen} />
        : <p className="text-sm text-[var(--color-text-muted)]">No activity was found for this doctor and period.</p>;
    }
    if (detailRows.length === 0) {
      return <p className="text-sm text-[var(--color-text-muted)]">No evidence was found for this doctor and period.</p>;
    }
    if (tab === 'visits') return <VisitsList rows={detailRows as DoctorVisitDetailRow[]} onInvoiceOpen={onInvoiceOpen} />;
    if (tab === 'referred-tests' || tab === 'performed-tests') return <TestsList rows={detailRows as DoctorTestDetailRow[]} onInvoiceOpen={onInvoiceOpen} />;
    return (
      <div className="space-y-3">
        {(detailRows as DoctorCommissionDetailRow[]).map((row) => (
          <CommissionCalculationBridge key={row.id} row={row} onInvoiceOpen={onInvoiceOpen} />
        ))}
      </div>
    );
  })();

  return (
    <DashboardDialogPortal>
      <div className={`fixed inset-0 ${DASHBOARD_DIALOG_OVERLAY_CLASS} flex justify-end bg-black/40 backdrop-blur-sm`}>
        <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`${doctor.doctorName} performance details`} className="flex h-full w-full max-w-6xl flex-col bg-[var(--color-bg-card)] shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4 sm:p-5">
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{doctor.doctorName}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">{detailsQuery.data?.period.label ?? activityQuery.data?.period.label ?? `${filters.startDate} → ${filters.endDate}`} · Operational and compensation evidence</p>
          </div>
          <button ref={initialFocusRef} type="button" className="btn-ghost min-h-11 min-w-11 p-2" aria-label="Close doctor details" onClick={onClose}><X className="h-5 w-5" aria-hidden="true" /></button>
        </div>

        <div className="overflow-x-auto border-b border-[var(--color-border)] px-3 pt-3" role="tablist" aria-label="Doctor detail type">
          <div className="flex min-w-max gap-1">
            {DRAWER_TABS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                className={`min-h-11 rounded-t-lg px-4 py-2 text-sm font-semibold ${tab === value ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}`}
                onClick={() => { setTab(value); setPage(1); }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-5">{content}</div>

        {showPagination ? (
          <div className="flex items-center justify-between border-t border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
            <span>Page {currentPage} · {totalRows.toLocaleString()} rows</span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary min-h-11 min-w-11" aria-label="Previous doctor detail page" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" className="btn-secondary min-h-11 min-w-11" aria-label="Next doctor detail page" disabled={!hasNextPage} onClick={() => setPage(currentPage + 1)}><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          </div>
        ) : null}
        </section>
      </div>
    </DashboardDialogPortal>
  );
}
