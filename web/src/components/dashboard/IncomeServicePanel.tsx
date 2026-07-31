import { ChevronLeft, ChevronRight, RefreshCw, WalletCards } from 'lucide-react';
import { formatCurrency } from '../../lib/format';
import type { IncomeServiceResponse } from '../../types/executiveDashboard';

interface Props {
  data?: IncomeServiceResponse;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onPageChange: (page: number) => void;
}

export default function IncomeServicePanel({ data, loading, error, onRetry, onPageChange }: Props) {
  const rows = data?.rows ?? [];
  const page = data?.page ?? 1;

  return (
    <section className="card overflow-hidden" data-testid="income-service-panel">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Income analysis</p>
          <h2 className="section-title mt-1">Collection by exact service</h2>
          <p className="section-subtitle mt-1">
            {data?.period?.label ?? 'Selected reporting period'} · Service names come from the billed line item; categories are secondary context only.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-right text-xs">
          <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2">
            <p className="text-[var(--color-text-muted)]">Transactions</p>
            <p className="font-data font-bold">{data?.totals?.transactions?.toLocaleString() ?? '—'}</p>
          </div>
          <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2">
            <p className="text-[var(--color-text-muted)]">Units</p>
            <p className="font-data font-bold">{data?.totals?.units?.toLocaleString() ?? '—'}</p>
          </div>
          <div className="rounded-lg bg-[var(--color-bg-secondary)] p-2">
            <p className="text-[var(--color-text-muted)]">Collection</p>
            <p className="font-data font-bold">{data?.totals ? formatCurrency(data.totals.collection) : '—'}</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3 p-4" aria-label="Loading income service analysis">
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
        </div>
      ) : error ? (
        <div role="alert" className="m-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <span>Unable to load income service analysis.</span>
          <button type="button" className="btn-secondary text-xs" aria-label="Retry income analysis" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="p-5 text-sm text-[var(--color-text-muted)]">No collected services were found for this period.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-sm">
              <thead className="bg-[var(--color-bg-secondary)]">
                <tr>
                  <th className="px-4 py-3 text-left">Service</th>
                  <th className="px-3 py-3 text-right">Transactions</th>
                  <th className="px-3 py-3 text-right">Units</th>
                  <th className="px-3 py-3 text-right">Collection</th>
                  <th className="px-3 py-3 text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.map((row) => (
                  <tr key={`${row.category}:${row.serviceName}`}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-[var(--color-text-primary)]">{row.serviceName}</p>
                      <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">{row.category}</p>
                    </td>
                    <td className="px-3 py-3 text-right font-data">{row.transactions.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right font-data">{row.units.toLocaleString()}</td>
                    <td className="px-3 py-3 text-right font-data font-semibold">{formatCurrency(row.collection)}</td>
                    <td className="px-3 py-3 text-right font-data">{row.share.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
            <span>Page {page} · {data?.totalRows.toLocaleString() ?? 0} services</span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary" aria-label="Previous income page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" className="btn-secondary" aria-label="Next income page" disabled={!data?.hasNextPage} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </>
      )}
      <WalletCards className="sr-only" aria-hidden="true" />
    </section>
  );
}
