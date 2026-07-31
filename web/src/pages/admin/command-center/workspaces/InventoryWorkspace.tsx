import { AlertTriangle, Boxes, Clock3, PackageX } from 'lucide-react';
import { useApiQuery } from '../../../../hooks/useApiQuery';
import type { ExecutiveDashboardFilters } from '../../../../types/executiveDashboard';

interface Props {
  filters: ExecutiveDashboardFilters;
}

interface InventorySummaryResponse {
  metrics: Array<{
    metric: string;
    title: string;
    total: number;
    valueType: 'money' | 'count';
  }>;
}

const INVENTORY_METRICS = [
  'inventory_stock_skus',
  'inventory_low_stock',
  'inventory_out_of_stock',
  'inventory_expiring_soon',
  'inventory_expired',
  'inventory_pending_purchase',
  'radiology_stock_skus',
  'radiology_low_stock',
  'radiology_out_of_stock',
  'radiology_expiring_soon',
  'radiology_issue_lines',
] as const;

function iconFor(metric: string) {
  if (metric.includes('out_of_stock') || metric.includes('expired')) return PackageX;
  if (metric.includes('expiring')) return Clock3;
  if (metric.includes('low_stock') || metric.includes('issue')) return AlertTriangle;
  return Boxes;
}

export default function InventoryWorkspace({ filters }: Props) {
  const params = new URLSearchParams({
    preset: filters.preset,
    startDate: filters.startDate,
    endDate: filters.endDate,
    metrics: INVENTORY_METRICS.join(','),
  });
  const query = useApiQuery<InventorySummaryResponse>(
    ['admin', 'command-center', 'inventory', params.toString()],
    `/api/dashboard/kpi-summary?${params.toString()}`,
    { refetchInterval: 60_000 },
  );
  const metrics = query.data?.metrics ?? [];

  return (
    <section data-testid="workspace-inventory" className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 data-command-center-workspace-heading tabIndex={-1} className="text-xl font-semibold text-[var(--color-text-primary)]">Inventory</h2>
          <span className="rounded-full border border-[var(--color-border)] px-2.5 py-1 text-xs font-semibold text-[var(--color-text-secondary)]">Live/current state</span>
        </div>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Current availability, low stock, stock-out, expiry, purchase requests, and radiology consumable exceptions.
        </p>
      </div>
      {query.isError ? (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Unable to load inventory control metrics.
        </div>
      ) : query.isLoading ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => <div key={index} className="skeleton h-32 rounded-2xl" />)}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-5">
          {metrics.map((metric) => {
            const Icon = iconFor(metric.metric);
            return (
              <article key={metric.metric} className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{metric.title}</p>
                  <Icon className="h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
                </div>
                <p className="mt-3 font-data text-2xl font-bold tabular-nums text-[var(--color-text-primary)]">
                  {Number(metric.total ?? 0).toLocaleString('en-US')}
                </p>
              </article>
            );
          })}
          {metrics.length === 0 ? (
            <div className="col-span-full rounded-xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
              No inventory metrics were returned for this period.
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
