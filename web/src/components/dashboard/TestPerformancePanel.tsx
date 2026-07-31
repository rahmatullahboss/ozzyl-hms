import { ArrowDownUp, ChevronLeft, ChevronRight, FlaskConical, Search } from 'lucide-react';
import type { TestPerformanceResponse, TestPerformanceRow, TestSort } from '../../types/executiveDashboard';

interface Props {
  data?: TestPerformanceResponse;
  loading: boolean;
  error: boolean;
  search: string;
  sortBy: TestSort;
  onSearchChange: (value: string) => void;
  onTestOpen: (test: TestPerformanceRow) => void;
  onPageChange: (page: number) => void;
  onSortChange: (sortBy: TestSort) => void;
}

const number = (value: number) => new Intl.NumberFormat('en-BD', { maximumFractionDigits: 0 }).format(Number(value || 0));

function SortHeader({ label, value, active, onChange }: { label: string; value: TestSort; active: boolean; onChange: (value: TestSort) => void }) {
  return (
    <button
      type="button"
      aria-label={`Sort by ${label.toLowerCase()}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap ${active ? 'font-bold text-[var(--color-primary)]' : 'font-semibold text-[var(--color-text-secondary)]'}`}
      onClick={() => onChange(value)}
    >
      {label}
      <ArrowDownUp className="h-3.5 w-3.5" aria-hidden="true" />
    </button>
  );
}

export default function TestPerformancePanel({ data, loading, error, search, sortBy, onSearchChange, onTestOpen, onPageChange, onSortChange }: Props) {
  const rows = data?.rows ?? [];
  const page = data?.page ?? 1;

  return (
    <section className="card overflow-hidden" data-testid="test-performance-panel">
      <div className="flex flex-col gap-3 border-b border-[var(--color-border)] p-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Test performance</p>
          <h2 className="section-title mt-1">Test-wise quantity, billing, collection, due, and commission</h2>
          <p className="section-subtitle mt-1">
            {data?.period?.label ?? 'Selected reporting period'} · Billed test lines in the selected period are counted even when no historical lab-order record exists.
          </p>
        </div>
        <label className="relative block w-full max-w-sm">
          <span className="sr-only">Search tests</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search tests"
            placeholder="Search CBC, RBS, X-Ray…"
            className="input w-full pl-9"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>
      </div>

      {loading ? (
        <div className="space-y-3 p-4" aria-label="Loading test performance">
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
          <div className="skeleton h-12 rounded-xl" />
        </div>
      ) : error ? (
        <div role="alert" className="m-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Unable to load test performance.</div>
      ) : rows.length === 0 ? (
        <p className="p-5 text-sm text-[var(--color-text-muted)]">No tests matched this period and search.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="min-w-[820px] w-full text-sm">
              <thead className="bg-[var(--color-bg-secondary)] text-left">
                <tr>
                  <th className="sticky left-0 z-10 bg-[var(--color-bg-secondary)] px-4 py-3 font-semibold text-[var(--color-text-secondary)]">Test</th>
                  <th className="px-3 py-3 text-right"><SortHeader label="Quantity" value="quantity" active={sortBy === 'quantity'} onChange={onSortChange} /></th>
                  <th className="px-3 py-3 text-right"><SortHeader label="Billed" value="billed" active={sortBy === 'billed'} onChange={onSortChange} /></th>
                  <th className="px-3 py-3 text-right"><SortHeader label="Collected" value="collected" active={sortBy === 'collected'} onChange={onSortChange} /></th>
                  <th className="px-3 py-3 text-right"><SortHeader label="Due" value="due" active={sortBy === 'due'} onChange={onSortChange} /></th>
                  <th className="px-3 py-3 text-right"><SortHeader label="Test Commission" value="testCommission" active={sortBy === 'testCommission'} onChange={onSortChange} /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-border)]">
                {rows.map((test) => (
                  <tr key={test.testId} className="hover:bg-[var(--color-bg-secondary)]/70">
                    <td className="sticky left-0 bg-[var(--color-bg-card)] px-4 py-3">
                      <button type="button" className="text-left font-semibold text-[var(--color-primary)] hover:underline" aria-label={`Open ${test.testName} details`} onClick={() => onTestOpen(test)}>
                        <span className="block">{test.testName}</span>
                        <span className="text-xs font-normal text-[var(--color-text-muted)]">{test.testCode ?? 'No code'}</span>
                      </button>
                    </td>
                    <td className="px-3 py-3 text-right font-data font-bold">{number(test.quantity)}</td>
                    <td className="px-3 py-3 text-right font-data">{number(test.billed)}</td>
                    <td className="px-3 py-3 text-right font-data">{number(test.collected)}</td>
                    <td className="px-3 py-3 text-right font-data">{number(test.due)}</td>
                    <td className="px-3 py-3 text-right font-data">{number(test.testCommission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-[var(--color-border)] p-3 text-xs text-[var(--color-text-muted)]">
            <span>Page {page} · {data?.totalRows.toLocaleString() ?? 0} tests</span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-xs" aria-label="Previous test page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" className="btn-secondary text-xs" aria-label="Next test page" disabled={!data?.hasNextPage} onClick={() => onPageChange(page + 1)}><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
        </>
      )}
      <FlaskConical className="sr-only" aria-hidden="true" />
    </section>
  );
}
