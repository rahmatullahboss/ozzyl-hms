import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import type { ReagentReconciliationResponse, ReagentReconciliationStatus } from '../../types/executiveDashboard';

interface Props {
  data?: ReagentReconciliationResponse;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}

const number = (value: number) => new Intl.NumberFormat('en-BD', { maximumFractionDigits: 2 }).format(Number(value || 0));
const statusLabel = (status: ReagentReconciliationStatus) => status.replace(/_/g, ' ');

function statusClass(status: ReagentReconciliationStatus): string {
  if (status === 'ok') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status === 'low_stock' || status === 'missing_consumption' || status === 'unmapped') return 'bg-amber-50 text-amber-800 border-amber-200';
  return 'bg-red-50 text-red-700 border-red-200';
}

export default function ReagentReconciliationPanel({ data, loading, error, onRetry, onPageChange }: Props) {
  const rows = data?.rows ?? [];
  const page = data?.page ?? 1;
  const unmapped = data?.exceptions?.unmappedCompletedTests ?? 0;
  const unmappedTests = data?.exceptions?.unmappedTests ?? [];

  return (
    <section className="card overflow-hidden" data-testid="reagent-reconciliation-panel">
      <div className="border-b border-[var(--color-border)] p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Laboratory reagent control</p>
        <h2 className="section-title mt-1">Expected versus actual reagent usage</h2>
        <p className="section-subtitle mt-1">
          {data?.period?.label ?? 'Selected reporting period'} · Usage totals remain separated by unit; ml, test, strip, and kit quantities are never added together.
        </p>
        {data?.quantityTotals?.length ? (
          <div className="mt-3 flex flex-wrap gap-2" aria-label="Actual reagent usage by unit">
            {data.quantityTotals.map((total) => (
              <span key={total.unit} className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-secondary)] px-3 py-1 text-xs font-data font-semibold text-[var(--color-text-primary)]">
                {number(total.quantity)} {total.unit}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {unmapped > 0 ? (
        <div role="alert" className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-semibold">{unmapped.toLocaleString()} completed tests are not mapped to any reagent.</p>
              <p className="mt-1 text-xs">Map these tests before relying on expected-consumption variance.</p>
              {unmappedTests.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {unmappedTests.map((test) => (
                    <span key={test.testId} className="rounded-full border border-amber-300 bg-white/70 px-2 py-1 text-xs">
                      {test.testName} · {test.completedTests.toLocaleString()}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3 p-4" aria-label="Loading reagent reconciliation">
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
        </div>
      ) : error ? (
        <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>Unable to load reagent reconciliation.</span>
          <button type="button" className="btn-secondary text-xs" aria-label="Retry reagent reconciliation" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-5 text-sm text-[var(--color-text-muted)]">No reagent usage was found for this period.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full text-sm">
            <thead className="bg-[var(--color-bg-secondary)]">
              <tr>
                <th className="px-4 py-3 text-left">Reagent</th>
                <th className="px-3 py-3 text-right">Completed Tests</th>
                <th className="px-3 py-3 text-right">Expected</th>
                <th className="px-3 py-3 text-right">Actual</th>
                <th className="px-3 py-3 text-right">Returned</th>
                <th className="px-3 py-3 text-right">Variance</th>
                <th className="px-3 py-3 text-right">Current Stock</th>
                <th className="px-3 py-3 text-right">Reorder</th>
                <th className="px-3 py-3 text-left">Unit</th>
                <th className="px-3 py-3 text-left">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map((row) => (
                <tr key={row.consumableId}>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--color-text-primary)]">{row.reagentName}</p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{row.reagentCode ?? 'No code'}</p>
                  </td>
                  <td className="px-3 py-3 text-right font-data">{number(row.completedTests)}</td>
                  <td className="px-3 py-3 text-right font-data">{number(row.expectedUsage)}</td>
                  <td className="px-3 py-3 text-right font-data font-semibold">{number(row.actualUsage)}</td>
                  <td className="px-3 py-3 text-right font-data">{number(row.returnedQuantity)}</td>
                  <td className="px-3 py-3 text-right font-data">{number(row.variance)}</td>
                  <td className="px-3 py-3 text-right font-data">{number(row.currentStock)}</td>
                  <td className="px-3 py-3 text-right font-data">{number(row.reorderLevel)}</td>
                  <td className="px-3 py-3">{row.unit}</td>
                  <td className="px-3 py-3"><span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClass(row.status)}`}>{statusLabel(row.status)}</span></td>
                </tr>
              ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
            <span>Page {page} · {data?.totalRows.toLocaleString() ?? 0} reagents</span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" aria-label="Previous reagent page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" className="btn-secondary" aria-label="Next reagent page" disabled={!data?.hasNextPage} onClick={() => onPageChange(page + 1)}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
