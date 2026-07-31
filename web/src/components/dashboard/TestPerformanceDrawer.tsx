import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useApiQuery } from '../../hooks/useApiQuery';
import { executiveAnalyticsQuery } from '../../hooks/useExecutiveDashboardAnalytics';
import type {
  ExecutiveDashboardFilters,
  TestPerformanceDetailRow,
  TestPerformanceDetailView,
  TestPerformanceDetailsResponse,
  TestPerformanceDetailsSummary,
  TestPerformancePerformedDoctorRow,
  TestPerformanceReferredDoctorRow,
  TestPerformanceRow,
} from '../../types/executiveDashboard';
import {
  DASHBOARD_DIALOG_OVERLAY_CLASS,
  DashboardDialogPortal,
  useDashboardDialogLayer,
} from './DashboardDialogLayer';

interface Props {
  test: TestPerformanceRow | null;
  filters: ExecutiveDashboardFilters;
  queryKeyScope: 'admin' | 'md' | 'director';
  onClose: () => void;
  onInvoiceOpen?: (billId: number) => void;
}

const number = (value: number) => new Intl.NumberFormat('en-BD', { maximumFractionDigits: 0 }).format(Number(value || 0));
const money = (value: number) => new Intl.NumberFormat('en-BD', {
  style: 'currency',
  currency: 'BDT',
  currencyDisplay: 'narrowSymbol',
}).format(Number(value || 0));
const display = (value: string | null | undefined) => value?.trim() || '—';
const titleCase = (value: string | null | undefined) => display(value).replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

function SummaryCard({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${emphasized ? 'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/5' : 'border-[var(--color-border)] bg-[var(--color-bg-secondary)]/60'}`}>
      <p className="text-xs font-medium text-[var(--color-text-muted)]">{label}</p>
      <p className={`mt-1 font-data text-base ${emphasized ? 'font-bold text-[var(--color-primary)]' : 'font-semibold text-[var(--color-text-primary)]'}`}>{value}</p>
    </div>
  );
}

function DetailsSummary({ summary }: { summary: TestPerformanceDetailsSummary }) {
  const { t } = useTranslation('dashboard');
  return (
    <div className="border-b border-[var(--color-border)] p-4 sm:p-5">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
        {t('testPerformanceDrawer.summary.title', { defaultValue: 'Complete selected-period summary' })}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <SummaryCard label={t('testPerformanceDrawer.summary.quantity', { defaultValue: 'Quantity' })} value={number(summary.quantity)} />
        <SummaryCard label={t('testPerformanceDrawer.summary.billed', { defaultValue: 'Billed' })} value={money(summary.billed)} />
        <SummaryCard label={t('testPerformanceDrawer.summary.collected', { defaultValue: 'Collected' })} value={money(summary.collected)} />
        <SummaryCard label={t('testPerformanceDrawer.summary.due', { defaultValue: 'Due' })} value={money(summary.due)} emphasized={summary.due > 0} />
        <SummaryCard label={t('testPerformanceDrawer.summary.testCommission', { defaultValue: 'Test Commission' })} value={money(summary.testCommission)} />
        <SummaryCard label={t('testPerformanceDrawer.summary.performerReserve', { defaultValue: 'Performer Reserve' })} value={money(summary.performerReserve)} />
        <SummaryCard label={t('testPerformanceDrawer.summary.referringDoctors', { defaultValue: 'Referring Doctors' })} value={number(summary.referringDoctorCount)} />
        <SummaryCard label={t('testPerformanceDrawer.summary.performingDoctors', { defaultValue: 'Performing Doctors' })} value={number(summary.performingDoctorCount)} />
      </div>
    </div>
  );
}

const textHeader = 'px-3 py-2 text-left whitespace-nowrap';
const numberHeader = 'px-3 py-2 text-right whitespace-nowrap';
const textCell = 'px-3 py-3 whitespace-nowrap';
const numberCell = 'px-3 py-3 text-right font-data whitespace-nowrap';

function ReferredTable({ rows }: { rows: TestPerformanceReferredDoctorRow[] }) {
  const { t } = useTranslation('dashboard');
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[1100px] w-full text-sm">
        <thead className="bg-[var(--color-bg-secondary)]">
          <tr>
            <th className={`${textHeader} sticky left-0 z-10 bg-[var(--color-bg-secondary)]`}>{t('testPerformanceDrawer.columns.doctor', { defaultValue: 'Doctor' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.quantity', { defaultValue: 'Quantity' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.billed', { defaultValue: 'Billed' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.collected', { defaultValue: 'Collected' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.due', { defaultValue: 'Due' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.testCommission', { defaultValue: 'Test Commission' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.discountedQuantity', { defaultValue: 'Discounted Quantity' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.discount', { defaultValue: 'Discount' })}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => (
            <tr key={row.doctorId ?? 'unassigned-referrer'}>
              <td className={`${textCell} sticky left-0 z-[1] bg-[var(--color-bg-card)] font-semibold`}>{display(row.doctorName)}</td>
              <td className={numberCell}>{number(row.quantity)}</td>
              <td className={numberCell}>{money(row.billed)}</td>
              <td className={numberCell}>{money(row.collected)}</td>
              <td className={numberCell}>{money(row.due)}</td>
              <td className={numberCell}>{money(row.testCommission)}</td>
              <td className={numberCell}>{number(row.discountedQuantity)}</td>
              <td className={numberCell}>{money(row.discountAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PerformedTable({ rows }: { rows: TestPerformancePerformedDoctorRow[] }) {
  const { t } = useTranslation('dashboard');
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[760px] w-full text-sm">
        <thead className="bg-[var(--color-bg-secondary)]">
          <tr>
            <th className={`${textHeader} sticky left-0 z-10 bg-[var(--color-bg-secondary)]`}>{t('testPerformanceDrawer.columns.doctor', { defaultValue: 'Doctor' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.quantity', { defaultValue: 'Quantity' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.performerReserve', { defaultValue: 'Performer Reserve' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.completed', { defaultValue: 'Completed' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.pending', { defaultValue: 'Pending' })}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => (
            <tr key={row.doctorId ?? 'unassigned-performer'}>
              <td className={`${textCell} sticky left-0 z-[1] bg-[var(--color-bg-card)] font-semibold`}>{display(row.doctorName)}</td>
              <td className={numberCell}>{number(row.quantity)}</td>
              <td className={numberCell}>{money(row.performerReserve)}</td>
              <td className={numberCell}>{number(row.completed)}</td>
              <td className={numberCell}>{number(row.pending)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LinesTable({ rows, onInvoiceOpen }: { rows: TestPerformanceDetailRow[]; onInvoiceOpen?: (billId: number) => void }) {
  const { t } = useTranslation('dashboard');
  return (
    <div className="overflow-x-auto">
      <table className="min-w-[2600px] w-full text-sm">
        <thead className="bg-[var(--color-bg-secondary)]">
          <tr>
            <th className={`${textHeader} sticky left-0 z-20 bg-[var(--color-bg-secondary)]`}>{t('testPerformanceDrawer.columns.time', { defaultValue: 'Time' })}</th>
            <th className={`${textHeader} sticky left-36 z-20 bg-[var(--color-bg-secondary)]`}>{t('testPerformanceDrawer.columns.patient', { defaultValue: 'Patient' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.quantity', { defaultValue: 'Quantity' })}</th>
            <th className={textHeader}>{t('testPerformanceDrawer.columns.referringDoctor', { defaultValue: 'Referring Doctor' })}</th>
            <th className={textHeader}>{t('testPerformanceDrawer.columns.orderingClinician', { defaultValue: 'Ordering Clinician' })}</th>
            <th className={textHeader}>{t('testPerformanceDrawer.columns.enteredBy', { defaultValue: 'Entered By' })}</th>
            <th className={textHeader}>{t('testPerformanceDrawer.columns.performingDoctor', { defaultValue: 'Performing Doctor' })}</th>
            <th className={textHeader}>{t('testPerformanceDrawer.columns.invoice', { defaultValue: 'Invoice' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.gross', { defaultValue: 'Gross' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.discount', { defaultValue: 'Discount' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.billed', { defaultValue: 'Billed' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.collected', { defaultValue: 'Collected' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.due', { defaultValue: 'Due' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.performerReserve', { defaultValue: 'Performer Reserve' })}</th>
            <th className={numberHeader}>{t('testPerformanceDrawer.columns.testCommission', { defaultValue: 'Test Commission' })}</th>
            <th className={textHeader}>{t('testPerformanceDrawer.columns.status', { defaultValue: 'Status' })}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--color-border)]">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className={`${textCell} sticky left-0 z-10 bg-[var(--color-bg-card)]`}>{display(row.occurredAt)}</td>
              <td className={`${textCell} sticky left-36 z-10 bg-[var(--color-bg-card)]`}>{display(row.patientName)}</td>
              <td className={numberCell}>{number(row.quantity)}</td>
              <td className={textCell}>{display(row.referringDoctorName)}</td>
              <td className={textCell}>{row.orderingClinicianName?.trim() || t('testPerformanceDrawer.notRecorded', { defaultValue: 'Not recorded' })}</td>
              <td className={textCell}>{display(row.enteredByName)}</td>
              <td className={textCell}>{display(row.performingDoctorName)}</td>
              <td className={textCell}>
                {row.billId && row.billId > 0 && onInvoiceOpen ? (
                  <button
                    type="button"
                    className="min-h-11 font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline"
                    aria-label={`Open invoice ${row.invoiceNo || row.billId}`}
                    onClick={() => onInvoiceOpen(row.billId as number)}
                  >
                    {row.invoiceNo || `Bill ${row.billId}`}
                  </button>
                ) : display(row.invoiceNo)}
              </td>
              <td className={numberCell}>{money(row.grossAmount)}</td>
              <td className={numberCell}>{money(row.discountAmount)}</td>
              <td className={numberCell}>{money(row.billedAmount)}</td>
              <td className={numberCell}>{money(row.collectedAmount)}</td>
              <td className={numberCell}>{money(row.dueAmount)}</td>
              <td className={numberCell}>{money(row.performerReserveAmount)}</td>
              <td className={numberCell}>{money(row.testCommission)}</td>
              <td className={textCell}>{titleCase(row.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TestPerformanceDrawer({ test, filters, queryKeyScope, onClose, onInvoiceOpen }: Props) {
  const { t } = useTranslation('dashboard');
  const viewLabel: Record<TestPerformanceDetailView, string> = {
    referred: t('testPerformanceDrawer.tabs.referred', { defaultValue: 'Referred By' }),
    performed: t('testPerformanceDrawer.tabs.performed', { defaultValue: 'Performed By' }),
    lines: t('testPerformanceDrawer.tabs.lines', { defaultValue: 'All Test Lines' }),
  };
  const [view, setView] = useState<TestPerformanceDetailView>('referred');
  const [page, setPage] = useState(1);
  const { dialogRef, initialFocusRef } = useDashboardDialogLayer({ open: Boolean(test), onClose });
  const testId = test?.testId ?? 0;
  const periodQuery = executiveAnalyticsQuery({ ...filters, doctorId: undefined, testSearch: undefined });
  const path = `/api/dashboard/test-performance/${testId}/details?${periodQuery}&view=${view}&page=${page}&pageSize=50`;
  const query = useApiQuery<TestPerformanceDetailsResponse>(
    [queryKeyScope, 'executive-analytics', 'test-details', testId, periodQuery, view, page],
    path,
    { enabled: Boolean(test) },
  );

  useEffect(() => {
    setView('referred');
    setPage(1);
  }, [test?.testId]);

  if (!test) return null;

  const hasCurrentData = Boolean(query.data && !query.isPlaceholderData && query.data.view === view);
  const rows = hasCurrentData ? query.data?.rows ?? [] : [];
  const currentPage = hasCurrentData ? query.data?.page ?? page : page;
  const hasNextPage = hasCurrentData ? query.data?.hasNextPage ?? false : false;

  return (
    <DashboardDialogPortal>
      <div className={`fixed inset-0 ${DASHBOARD_DIALOG_OVERLAY_CLASS} flex justify-end bg-black/40 backdrop-blur-sm`}>
        <section
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
        aria-modal="true"
        aria-label={`${test.testName} ${t('testPerformanceDrawer.detailsSuffix', { defaultValue: 'details' })}`}
        className="flex h-full w-full max-w-[96rem] flex-col bg-[var(--color-bg-card)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4 sm:p-5">
          <div>
            <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">{test.testName}</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              {test.testCode ?? t('testPerformanceDrawer.noCode', { defaultValue: 'No code' })} · {query.data?.period.label ?? `${filters.startDate} → ${filters.endDate}`}
            </p>
            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
              {t('testPerformanceDrawer.roleExplanation', {
                defaultValue: 'Referral, ordering, data entry, performance, and billing-line evidence are separate roles; every view reconciles to the same selected-period totals.',
              })}
            </p>
          </div>
          <button ref={initialFocusRef} type="button" className="btn-ghost p-2" aria-label={t('testPerformanceDrawer.close', { defaultValue: 'Close test details' })} onClick={onClose}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {hasCurrentData && query.data?.summary ? <DetailsSummary summary={query.data.summary} /> : null}

        <div className="border-b border-[var(--color-border)] px-4 pt-3" role="tablist" aria-label={t('testPerformanceDrawer.tabListLabel', { defaultValue: 'Test detail type' })}>
          {(['referred', 'performed', 'lines'] as TestPerformanceDetailView[]).map((nextView) => (
            <button
              key={nextView}
              type="button"
              role="tab"
              aria-selected={view === nextView}
              className={`mr-2 rounded-t-lg px-4 py-2 text-sm font-semibold ${view === nextView ? 'bg-[var(--color-primary)] text-white' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-secondary)]'}`}
              onClick={() => {
                setView(nextView);
                setPage(1);
              }}
            >
              {viewLabel[nextView]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto p-4 sm:p-5">
          {query.isLoading || (!hasCurrentData && !query.isError) ? (
            <div aria-label={t('testPerformanceDrawer.loading', { defaultValue: 'Loading test details' })} className="space-y-3">
              <div className="skeleton h-14 rounded-xl" />
              <div className="skeleton h-14 rounded-xl" />
            </div>
          ) : query.isError ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {t('testPerformanceDrawer.error', { defaultValue: 'Unable to load test details.' })}
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-[var(--color-text-muted)]">
              {t(`testPerformanceDrawer.empty.${view}`, {
                defaultValue: 'No {{view}} evidence was found for this test and period.',
                view: viewLabel[view].toLowerCase(),
              })}
            </p>
          ) : view === 'referred' ? (
            <ReferredTable rows={rows as TestPerformanceReferredDoctorRow[]} />
          ) : view === 'performed' ? (
            <PerformedTable rows={rows as TestPerformancePerformedDoctorRow[]} />
          ) : (
            <LinesTable rows={rows as TestPerformanceDetailRow[]} onInvoiceOpen={onInvoiceOpen} />
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
          <span>
            {t('testPerformanceDrawer.paginationPage', { defaultValue: 'Page' })} {currentPage} ·{' '}
            {hasCurrentData ? query.data?.totalRows.toLocaleString() ?? 0 : 0} {t('testPerformanceDrawer.paginationRows', { defaultValue: 'rows' })}
          </span>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" aria-label={t('testPerformanceDrawer.previousPage', { defaultValue: 'Previous test detail page' })} disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
            <button type="button" className="btn-secondary" aria-label={t('testPerformanceDrawer.nextPage', { defaultValue: 'Next test detail page' })} disabled={!hasNextPage} onClick={() => setPage(currentPage + 1)}>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
        </section>
      </div>
    </DashboardDialogPortal>
  );
}
