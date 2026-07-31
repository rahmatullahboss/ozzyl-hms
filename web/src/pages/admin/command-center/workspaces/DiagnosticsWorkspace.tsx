import { useMemo, useState } from 'react';
import TestPerformancePanel from '../../../../components/dashboard/TestPerformancePanel';
import TestPerformanceDrawer from '../../../../components/dashboard/TestPerformanceDrawer';
import AdminKpiInvoiceModal from '../../../../components/dashboard/AdminKpiInvoiceModal';
import { useInvoiceInspectorState } from '../../../../components/invoice-inspector/useInvoiceInspectorState';
import ReagentReconciliationPanel from '../../../../components/dashboard/ReagentReconciliationPanel';
import { useExecutiveDashboardAnalytics } from '../../../../hooks/useExecutiveDashboardAnalytics';
import type { ExecutiveDashboardMetric } from '../../../../hooks/useExecutiveDashboardKpis';
import type {
  ExecutiveDashboardFilters,
  TestPerformanceRow,
  TestSort,
} from '../../../../types/executiveDashboard';

interface Props {
  filters: ExecutiveDashboardFilters;
}

export default function DiagnosticsWorkspace({ filters }: Props) {
  const [page, setPage] = useState(1);
  const [reagentPage, setReagentPage] = useState(1);
  const [sortBy, setSortBy] = useState<TestSort>('quantity');
  const [search, setSearch] = useState(filters.testSearch ?? '');
  const [selectedTest, setSelectedTest] = useState<TestPerformanceRow | null>(null);
  const invoiceInspector = useInvoiceInspectorState();
  const effectiveFilters = useMemo(() => ({ ...filters, testSearch: search }), [filters, search]);
  const enabledPanels = useMemo<Set<ExecutiveDashboardMetric>>(
    () => new Set(['test_volume_table', 'reagent_reconciliation_table']),
    [],
  );
  const analytics = useExecutiveDashboardAnalytics({
    queryKeyScope: 'admin',
    filters: effectiveFilters,
    enabledPanels,
    testPage: page,
    testPageSize: 10,
    testSortBy: sortBy,
    reagentPage,
    reagentPageSize: 10,
  });

  return (
    <section data-testid="workspace-diagnostics" className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
        <h2 data-command-center-workspace-heading tabIndex={-1} className="text-xl font-semibold text-[var(--color-text-primary)]">Diagnostics</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Test volume, billing, collection, due, commission, and reagent reconciliation for the selected period.
        </p>
      </div>
      <TestPerformancePanel
        data={analytics.testPerformance.data}
        loading={analytics.testPerformance.isLoading}
        error={analytics.testPerformance.isError}
        search={search}
        sortBy={sortBy}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        onTestOpen={setSelectedTest}
        onPageChange={setPage}
        onSortChange={(next) => { setSortBy(next); setPage(1); }}
      />
      <ReagentReconciliationPanel
        data={analytics.reagentReconciliation.data}
        loading={analytics.reagentReconciliation.isLoading}
        error={analytics.reagentReconciliation.isError}
        onRetry={() => { void analytics.reagentReconciliation.refetch(); }}
        onPageChange={setReagentPage}
      />
      <TestPerformanceDrawer
        test={selectedTest}
        filters={effectiveFilters}
        queryKeyScope="admin"
        onClose={() => setSelectedTest(null)}
        onInvoiceOpen={invoiceInspector.openInvoice}
      />
      {invoiceInspector.billId !== null ? (
        <AdminKpiInvoiceModal billId={invoiceInspector.billId} onClose={invoiceInspector.closeInvoice} />
      ) : null}
    </section>
  );
}
