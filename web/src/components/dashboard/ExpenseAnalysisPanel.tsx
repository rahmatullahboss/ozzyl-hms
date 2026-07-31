import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { formatDisplayDate } from '../../lib/date-utils';
import { formatCurrency } from '../../lib/format';
import type { ExpenseAnalysisResponse } from '../../types/executiveDashboard';

interface Props {
  data?: ExpenseAnalysisResponse;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}

const MISSING_DESCRIPTION = 'No description provided';

export default function ExpenseAnalysisPanel({ data, loading, error, onRetry, onPageChange }: Props) {
  const rows = data?.rows ?? [];
  const page = data?.page ?? 1;

  return (
    <section className="card overflow-hidden" data-testid="expense-analysis-panel">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Expense analysis</p>
          <h2 className="section-title mt-1">Paid operating expense and executed doctor payout</h2>
          <p className="section-subtitle mt-1">
            {data?.period?.label ?? 'Selected reporting period'} · Approved-but-unpaid and rejected expenses are not counted as paid expense.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 text-right text-xs">
          <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2">
            <p className="text-[var(--color-text-muted)]">Transactions</p>
            <p className="font-data font-bold">{data?.totals?.transactions?.toLocaleString() ?? '—'}</p>
          </div>
          <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2">
            <p className="text-[var(--color-text-muted)]">Paid amount</p>
            <p className="font-data font-bold">{data?.totals ? formatCurrency(data.totals.paidAmount) : '—'}</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 p-4" aria-label="Loading expense analysis">
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
        </div>
      ) : error ? (
        <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>Unable to load expense analysis.</span>
          <button type="button" className="btn-secondary text-xs" aria-label="Retry expense analysis" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-5 text-sm text-[var(--color-text-muted)]">No paid expenses were found for this period.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-[1040px] w-full text-sm">
              <thead className="bg-[var(--color-bg-secondary)]">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-3 py-3 text-left">Category</th>
                  <th className="px-3 py-3 text-left">Details</th>
                  <th className="px-3 py-3 text-right">Paid Amount</th>
                  <th className="px-3 py-3 text-left">Payment Method</th>
                  <th className="px-3 py-3 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="whitespace-nowrap px-4 py-3 align-top text-[var(--color-text-secondary)]">
                      {formatDisplayDate(row.occurredAt)}
                    </td>
                    <td className="px-3 py-3 align-top font-semibold text-[var(--color-text-primary)]">{row.category}</td>
                    <td className="min-w-72 px-3 py-3 align-top text-[var(--color-text-secondary)] break-words">
                      {row.detail || MISSING_DESCRIPTION}
                    </td>
                    <td className="px-3 py-3 align-top text-right font-data font-semibold">{formatCurrency(row.paidAmount)}</td>
                    <td className="px-3 py-3 align-top text-[var(--color-text-secondary)]">{row.paymentMethod || '—'}</td>
                    <td className="px-3 py-3 align-top text-[var(--color-text-secondary)]">{row.status || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
            <span>Page {page} · {data?.totalRows.toLocaleString() ?? 0} transactions</span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" aria-label="Previous expense page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" className="btn-secondary" aria-label="Next expense page" disabled={!data?.hasNextPage} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
