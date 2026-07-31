import { FileText, Printer, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import type {
  AdminDashboardOverviewResponse,
  DashboardMetricResult,
} from '../../../../../../packages/shared/src/dashboard';
import type { ExecutiveDashboardFilters } from '../../../../types/executiveDashboard';
import ActionCenterSummaryPanel from '../components/ActionCenterSummaryPanel';
import OverviewKpiGrid from '../components/OverviewKpiGrid';

interface Props {
  overview: AdminDashboardOverviewResponse;
  basePath: string;
  filters: ExecutiveDashboardFilters;
}

function tenantPath(basePath: string, route: string): string {
  if (route.startsWith('/h/')) return route;
  return `${basePath}${route.startsWith('/') ? route : `/${route}`}`;
}

function metricPath(basePath: string, metric: DashboardMetricResult): string {
  const path = tenantPath(basePath, metric.drill.route);
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(metric.drill.query)) params.set(key, String(value));
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

export default function OverviewWorkspace({ overview, basePath, filters }: Props) {
  const navigate = useNavigate();
  const pdfCenterPath = `${basePath}/reports/pdf?from=${filters.startDate}&to=${filters.endDate}`;
  const dailyPackPath = `${basePath}/reports/pdf?pack=daily-closing&from=${filters.startDate}&to=${filters.endDate}&autoprint=1`;

  return (
    <section data-testid="workspace-overview" className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-primary)]">Decision overview</p>
            <h2 data-command-center-workspace-heading tabIndex={-1} className="mt-1 text-xl font-semibold text-[var(--color-text-primary)]">Overview</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">
              Primary role-based signals only. Detailed doctor, diagnostic, inventory, and audit analysis stays in its own workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => navigate(pdfCenterPath)}
              className="btn-secondary cursor-pointer text-xs"
              aria-label="Open PDF Center for selected dashboard range"
            >
              <FileText className="h-4 w-4" aria-hidden="true" />
              PDF Center
            </button>
            <button
              type="button"
              onClick={() => navigate(dailyPackPath)}
              className="btn-primary cursor-pointer text-xs"
              aria-label="Print daily closing PDF pack for selected dashboard range"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Daily Pack
            </button>
          </div>
        </div>
      </div>

      <OverviewKpiGrid
        metrics={overview.primaryMetrics}
        onOpenMetric={(metric) => navigate(metricPath(basePath, metric))}
      />

      <ActionCenterSummaryPanel />

      <div className="flex items-start gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 text-sm shadow-sm">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[var(--color-primary)]" aria-hidden="true" />
        <div>
          <p className="font-semibold text-[var(--color-text-primary)]">Data health: {overview.health.state.replace(/_/g, ' ')}</p>
          <p className="mt-1 text-[var(--color-text-muted)]">
            Values marked unavailable or partial are not converted into verified zeroes.
          </p>
        </div>
      </div>
    </section>
  );
}
