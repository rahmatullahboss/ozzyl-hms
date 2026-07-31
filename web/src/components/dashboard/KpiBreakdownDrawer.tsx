import { ChevronLeft, ChevronRight, Eye, X } from 'lucide-react';
import { formatCurrency } from '../../lib/format';
import { formatDateTimeGMT6 } from '../../lib/date-utils';
import { displayKpiSourceLabel, kpiEmptyState, kpiFormulaNote } from '../../lib/kpiLabels';
import {
  DASHBOARD_DIALOG_OVERLAY_CLASS,
  DashboardDialogPortal,
  useDashboardDialogLayer,
} from './DashboardDialogLayer';

export interface KpiBreakdownSource {
  label: string;
  amount: number;
  count: number;
  direction?: 'in' | 'out';
  key?: string | null;
  doctorId?: number | null;
}

export interface KpiBreakdownRow {
  id: string;
  occurredAt: string;
  sourceType: string;
  sourceLabel: string;
  referenceNo?: string | null;
  counterName?: string | null;
  userName?: string | null;
  amount: number;
  status?: string | null;
  paymentMethod?: string | null;
  grossAmount?: number | null;
  discountAmount?: number | null;
  netAmount?: number | null;
  paidAmount?: number | null;
  dueAmount?: number | null;
  billId?: number | null;
  invoiceNo?: string | null;
  patientName?: string | null;
  patientCode?: string | null;
  discountReference?: string | null;
  discountReason?: string | null;
  serviceNames?: string | null;
  itemCount?: number | null;
  itemName?: string | null;
  itemCode?: string | null;
  unitName?: string | null;
  availableQuantity?: number | null;
  reorderLevel?: number | null;
  storeName?: string | null;
  batchNo?: string | null;
  expiryDate?: string | null;
  qcStatus?: string | null;
  consumedQuantity?: number | null;
}

export interface KpiBreakdownData {
  metric: string;
  title: string;
  total: number;
  valueType?: 'money' | 'count';
  period: {
    startDate: string;
    endDate: string;
    label: string;
  };
  sources: KpiBreakdownSource[];
  totalRows?: number;
  page?: number;
  pageSize?: number;
  hasNextPage?: boolean;
  rows: KpiBreakdownRow[];
}

interface KpiBreakdownDrawerProps {
  title: string;
  data?: KpiBreakdownData;
  loading?: boolean;
  error?: boolean;
  labels: {
    close: string;
    sources: string;
    details: string;
    noRows: string;
    rows?: string;
    invoiceRows?: string;
    viewInvoices?: string;
    showAllDoctors?: string;
  };
  formulaNote?: string;
  onClose: () => void;
  onRowClick?: (row: KpiBreakdownRow) => void;
  onSourceClick?: (source: KpiBreakdownSource) => void;
  onClearSourceFilter?: () => void;
  onPageChange?: (page: number, pageSize: number) => void;
  action?: {
    label: string;
    href: string;
    help?: string;
  };
}

function money(value: number | null | undefined, valueType: 'money' | 'count' = 'money'): string {
  if (valueType === 'count') return Number(value ?? 0).toLocaleString();
  return formatCurrency(Number(value ?? 0), { fractionDigits: 0 });
}

function moneyOrDash(value: number | null | undefined): string {
  return value !== null && value !== undefined ? money(value) : '—';
}

function statusText(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '—';
  return raw.replace(/[_-]+/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function quantityWithUnit(
  value: number | null | undefined,
  unit: string | null | undefined,
  suffix?: string,
): string {
  if (value === null || value === undefined) return '—';
  const numeric = Number(value);
  const display = Number.isFinite(numeric)
    ? numeric.toLocaleString(undefined, { maximumFractionDigits: 3 })
    : '0';
  return [display, String(unit ?? '').trim() || null, suffix || null].filter(Boolean).join(' ');
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  return formatDateTimeGMT6(value).split(' ')[0] || '—';
}

function isInventoryDetailRow(row: KpiBreakdownRow): boolean {
  return Boolean(
    row.itemName
    || row.itemCode
    || row.unitName
    || row.availableQuantity !== null && row.availableQuantity !== undefined
    || row.consumedQuantity !== null && row.consumedQuantity !== undefined
    || row.batchNo
    || row.storeName
    || row.expiryDate
    || row.qcStatus,
  );
}

function rowPrimaryReference(row: KpiBreakdownRow): string {
  return row.invoiceNo || row.referenceNo || (row.billId ? `Bill #${row.billId}` : '—');
}

function topSource(data?: KpiBreakdownData): KpiBreakdownSource | null {
  if (!data?.sources?.length) return null;
  return [...data.sources].sort((a, b) => Math.abs(Number(b.amount ?? 0)) - Math.abs(Number(a.amount ?? 0)))[0] ?? null;
}

function sourcePercentage(source: KpiBreakdownSource, sources: KpiBreakdownSource[]): number {
  const total = sources.reduce((sum, item) => sum + Math.abs(Number(item.amount || 0)), 0);
  if (total <= 0) return 0;
  return Math.round((Math.abs(Number(source.amount || 0)) / total) * 100);
}

function KpiSourceSummaryRow({
  source,
  sources,
  valueType,
  countLabel,
  viewInvoicesLabel,
  onClick,
}: {
  source: KpiBreakdownSource;
  sources: KpiBreakdownSource[];
  valueType: 'money' | 'count';
  countLabel: string;
  viewInvoicesLabel: string;
  onClick?: () => void;
}) {
  const sourceLabel = displayKpiSourceLabel(source.label);
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-[var(--color-text-primary)]">{sourceLabel}</p>
          <p className="text-xs text-[var(--color-text-muted)]">
            {source.count.toLocaleString()} {countLabel} · {sourcePercentage(source, sources)}% · avg {money(source.count ? source.amount / source.count : 0, valueType)}
          </p>
        </div>
        <p className="font-data font-semibold text-[var(--color-text-primary)]">{money(source.amount, valueType)}</p>
      </div>
      {onClick ? <p className="mt-2 text-[0.7rem] font-semibold text-[var(--color-primary)]">{viewInvoicesLabel} →</p> : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="w-full rounded-lg border border-[var(--color-border)] p-3 text-left text-sm transition hover:border-[var(--color-primary)] hover:bg-[var(--color-bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
        aria-label={`${viewInvoicesLabel} for ${sourceLabel}`}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <div className="rounded-lg border border-[var(--color-border)] p-3 text-sm">{content}</div>;
}

function topCounterOrUser(rows?: KpiBreakdownRow[]): string {
  const counts = new Map<string, number>();
  for (const row of rows ?? []) {
    const key = row.counterName || row.userName;
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
}

function rowContext(row: KpiBreakdownRow): string {
  const patient = [row.patientName, row.patientCode ? `(${row.patientCode})` : null].filter(Boolean).join(' ');
  const discount = Number(row.discountAmount ?? 0);
  const discountText = discount <= 0 ? 'No discount' : (row.discountReference?.trim() || 'Missing');
  const discountReference = `Discount ref: ${discountText}`;
  const reason = row.discountReason ? `Reason: ${row.discountReason}` : null;
  return [patient || null, discountReference, reason].filter(Boolean).join(' · ');
}

export default function KpiBreakdownDrawer({ title, data, loading, error, labels, formulaNote, onClose, onRowClick, onSourceClick, onClearSourceFilter, onPageChange, action }: KpiBreakdownDrawerProps) {
  const { dialogRef, initialFocusRef } = useDashboardDialogLayer({ open: true, onClose });
  const valueType = data?.valueType ?? 'money';
  const isCommissionBreakdown = Boolean(data?.metric?.includes('commission'));
  const sourceCountLabel = isCommissionBreakdown ? (labels.invoiceRows || 'invoices') : (labels.rows || 'rows');
  const summaryCountLabel = isCommissionBreakdown ? (labels.invoiceRows || 'Invoices') : (labels.rows || 'Rows');
  const viewInvoicesLabel = labels.viewInvoices || 'View invoices';
  const visibleRows = data?.rows?.length ?? 0;
  const totalRows = data?.totalRows ?? visibleRows;
  const currentPage = data?.page ?? 1;
  const pageSize = data?.pageSize ?? 50;
  const startRow = totalRows === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endRow = Math.min(totalRows, (currentPage - 1) * pageSize + visibleRows);
  const primarySource = topSource(data);
  const emptyText = kpiEmptyState(data?.metric, labels.noRows);
  const inventoryDetails = Boolean(data?.rows?.some(isInventoryDetailRow));

  return (
    <DashboardDialogPortal>
      <div className={`fixed inset-0 ${DASHBOARD_DIALOG_OVERLAY_CLASS} flex justify-end bg-black/40 backdrop-blur-sm`}>
        <section
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex h-full w-full max-w-5xl flex-col bg-[var(--color-bg-card)] shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] p-4 sm:p-5">
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-lg font-semibold leading-tight text-[var(--color-text-primary)] sm:text-xl">{title}</h2>
            {data?.period ? (
              <p className="mt-1 break-words text-sm text-[var(--color-text-muted)]">
                {data.period.label} · {money(data.total, valueType)} · {totalRows.toLocaleString()} {sourceCountLabel}
              </p>
            ) : null}
            <p className="mt-1 max-w-3xl text-xs text-[var(--color-text-muted)]">{formulaNote || kpiFormulaNote(data?.metric)}</p>
          </div>
          <button ref={initialFocusRef} type="button" className="btn-ghost shrink-0 p-2" onClick={onClose} aria-label={labels.close}>
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="space-y-3">
              <div className="skeleton h-16 rounded-xl" />
              <div className="skeleton h-32 rounded-xl" />
              <div className="skeleton h-32 rounded-xl" />
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              Failed to load source breakdown.
            </div>
          ) : (
            <div className="space-y-5">
              {action ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-semibold">{action.label}</p>
                      {action.help ? <p className="mt-1 text-xs text-amber-800">{action.help}</p> : null}
                    </div>
                    <a className="btn-primary self-start whitespace-nowrap sm:self-auto" href={action.href}>{action.label}</a>
                  </div>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Total</p>
                  <p className="mt-1 font-data text-lg font-bold text-[var(--color-text-primary)]">{money(data?.total, valueType)}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{summaryCountLabel}</p>
                  <p className="mt-1 font-data text-lg font-bold text-[var(--color-text-primary)]">{totalRows.toLocaleString()}</p>
                  <p className="text-[0.68rem] text-[var(--color-text-muted)]">Showing {startRow.toLocaleString()}–{endRow.toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Top source</p>
                  <p className="mt-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">{primarySource ? displayKpiSourceLabel(primarySource.label) : '—'}</p>
                </div>
                <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-[var(--color-text-muted)]">Top counter/user</p>
                  <p className="mt-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">{topCounterOrUser(data?.rows)}</p>
                </div>
              </div>

              <div className="card p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="section-title">{labels.sources}</h3>
                  {onClearSourceFilter ? (
                    <button type="button" className="btn-ghost px-2 py-1 text-xs" onClick={onClearSourceFilter}>
                      ← {labels.showAllDoctors || 'Show all doctors'}
                    </button>
                  ) : null}
                </div>
                {data?.sources?.length ? (
                  <div className="space-y-2">
                    {data.sources.map((source) => {
                      const hasStableSourceIdentity = source.doctorId !== null && source.doctorId !== undefined
                        || Boolean(source.key);
                      return (
                        <KpiSourceSummaryRow
                          key={source.key || source.label}
                          source={source}
                          sources={data.sources}
                          valueType={valueType}
                          countLabel={sourceCountLabel}
                          viewInvoicesLabel={viewInvoicesLabel}
                          onClick={onSourceClick && hasStableSourceIdentity ? () => onSourceClick(source) : undefined}
                        />
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-[var(--color-text-muted)]">{emptyText}</p>
                )}
              </div>

              <div className="card overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="section-title">{labels.details}</h3>
                    <p className="mt-1 text-xs font-medium text-[var(--color-text-muted)]">Showing {startRow.toLocaleString()}–{endRow.toLocaleString()} of {totalRows.toLocaleString()}</p>
                  </div>
                  <select className="input h-8 w-24 py-1 text-xs" value={pageSize} onChange={(event) => onPageChange?.(1, Number(event.target.value))} aria-label="Rows per page">
                    {[25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
                  </select>
                </div>
                <div className="overflow-x-auto">
                  {inventoryDetails ? (
                    <table className="table-base">
                      <thead>
                        <tr>
                          <th>Time</th>
                          <th>Item</th>
                          <th>Code / Reference</th>
                          <th>Stock / Usage</th>
                          <th>Reorder</th>
                          <th>Store</th>
                          <th>Batch</th>
                          <th>Expiry</th>
                          <th>QC / Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data?.rows?.length ? data.rows.map((row) => {
                          const isUsage = row.consumedQuantity !== null && row.consumedQuantity !== undefined;
                          const quantity = isUsage ? row.consumedQuantity : (row.availableQuantity ?? row.amount);
                          const rowStatus = row.qcStatus || row.status;
                          return (
                            <tr key={row.id}>
                              <td className="whitespace-nowrap text-sm">{formatDateTimeGMT6(row.occurredAt)}</td>
                              <td className="min-w-44 text-sm">
                                <div className="font-semibold text-[var(--color-text-primary)]">{row.itemName || row.sourceLabel || '—'}</div>
                                {row.serviceNames && row.serviceNames !== row.itemName ? (
                                  <div className="text-xs text-[var(--color-text-muted)]">{row.serviceNames}</div>
                                ) : null}
                              </td>
                              <td className="font-data text-sm">{row.itemCode || row.referenceNo || '—'}</td>
                              <td className="whitespace-nowrap font-data text-sm font-semibold">
                                {quantityWithUnit(quantity, row.unitName, isUsage ? 'used' : undefined)}
                              </td>
                              <td className="whitespace-nowrap font-data text-sm">{quantityWithUnit(row.reorderLevel, row.unitName)}</td>
                              <td className="text-sm text-[var(--color-text-secondary)]">{row.storeName || '—'}</td>
                              <td className="font-data text-sm">{row.batchNo || '—'}</td>
                              <td className="whitespace-nowrap text-sm">{dateOnly(row.expiryDate)}</td>
                              <td><span className="badge badge-secondary">{statusText(rowStatus)}</span></td>
                            </tr>
                          );
                        }) : (
                          <tr>
                            <td colSpan={9} className="py-10 text-center text-sm text-[var(--color-text-muted)]">{emptyText}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  ) : (
                  <table className="table-base">
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Source</th>
                        <th>Invoice / Reference</th>
                        <th>Patient / Discount Ref.</th>
                        <th>Counter/User</th>
                        <th>Items / Tests</th>
                        <th>Gross</th>
                        <th>Discount</th>
                        <th>Paid</th>
                        <th>Due</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data?.rows?.length ? data.rows.map((row) => {
                        const canOpenInvoice = Boolean(row.billId && onRowClick);
                        const primaryReference = rowPrimaryReference(row);
                        return (
                          <tr
                            key={row.id}
                            role={canOpenInvoice ? 'button' : undefined}
                            tabIndex={canOpenInvoice ? 0 : undefined}
                            aria-label={canOpenInvoice ? `Open invoice ${primaryReference}` : undefined}
                            className={canOpenInvoice ? 'cursor-pointer hover:bg-[var(--color-bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-primary)]' : undefined}
                            onClick={canOpenInvoice ? () => onRowClick?.(row) : undefined}
                            onKeyDown={canOpenInvoice ? (event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                onRowClick?.(row);
                              }
                            } : undefined}
                          >
                            <td className="whitespace-nowrap text-sm">{formatDateTimeGMT6(row.occurredAt)}</td>
                            <td className="text-sm">{displayKpiSourceLabel(row.sourceLabel || row.sourceType)}</td>
                            <td className="font-data text-sm">
                              {canOpenInvoice ? (
                                <button
                                  type="button"
                                  className="font-semibold text-[var(--color-primary)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] rounded-sm"
                                  onClick={(event) => { event.stopPropagation(); onRowClick?.(row); }}
                                >
                                  {primaryReference}
                                </button>
                              ) : (
                                <div className="font-semibold text-[var(--color-text-primary)]">{primaryReference}</div>
                              )}
                              {row.referenceNo && row.referenceNo !== primaryReference ? (
                                <div className="text-xs text-[var(--color-text-muted)]">{row.referenceNo}</div>
                              ) : null}
                            </td>
                            <td className="min-w-44 text-sm text-[var(--color-text-secondary)]">{rowContext(row) || '—'}</td>
                            <td className="text-sm text-[var(--color-text-secondary)]">
                              {[row.counterName, row.userName].filter(Boolean).join(' · ') || '—'}
                            </td>
                            <td className="max-w-56 text-sm text-[var(--color-text-secondary)]">
                              <span className="line-clamp-2">{row.serviceNames || (row.itemCount ? `${row.itemCount} items` : '—')}</span>
                            </td>
                            <td className="font-data text-sm">{moneyOrDash(row.grossAmount)}</td>
                            <td className="font-data text-sm text-amber-700">{moneyOrDash(row.discountAmount)}</td>
                            <td className="font-data text-sm text-emerald-700">{moneyOrDash(row.paidAmount)}</td>
                            <td className="font-data text-sm text-red-700">{moneyOrDash(row.dueAmount)}</td>
                            <td className="font-data font-semibold">{money(row.amount, valueType)}</td>
                            <td><span className="badge badge-secondary">{statusText(row.status)}</span></td>
                            <td>
                              {row.billId ? (
                                <button type="button" className="btn-ghost inline-flex items-center gap-1 px-2 py-1 text-xs" onClick={(event) => { event.stopPropagation(); onRowClick?.(row); }}>
                                  <Eye className="h-3.5 w-3.5" aria-hidden="true" /> View invoice
                                </button>
                              ) : <span className="text-xs text-[var(--color-text-muted)]">—</span>}
                            </td>
                          </tr>
                        );
                      }) : (
                        <tr>
                          <td colSpan={13} className="py-10 text-center text-sm text-[var(--color-text-muted)]">{emptyText}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
                  <button type="button" className="btn-ghost inline-flex items-center gap-1 px-2 py-1" disabled={!onPageChange || currentPage <= 1} onClick={() => onPageChange?.(currentPage - 1, pageSize)}>
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Previous
                  </button>
                  <span>Page {currentPage.toLocaleString()}</span>
                  <button type="button" className="btn-ghost inline-flex items-center gap-1 px-2 py-1" disabled={!onPageChange || !data?.hasNextPage} onClick={() => onPageChange?.(currentPage + 1, pageSize)}>
                    Next <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        </section>
      </div>
    </DashboardDialogPortal>
  );
}
