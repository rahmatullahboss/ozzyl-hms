import IPDBillingOverview from '../../../../components/dashboard/IPDBillingOverview';
import ExecutiveDuePanel from '../../../../components/dashboard/ExecutiveDuePanel';
import AdminKpiInvoiceModal from '../../../../components/dashboard/AdminKpiInvoiceModal';
import { useInvoiceInspectorState } from '../../../../components/invoice-inspector/useInvoiceInspectorState';
import type { DashboardPeriod } from '../../../../components/dashboard/dashboardPeriod';
import type { ExecutiveDashboardFilters } from '../../../../types/executiveDashboard';

interface Props {
  filters: ExecutiveDashboardFilters;
  basePath: string;
}

export default function IPDWorkspace({ filters, basePath }: Props) {
  const invoiceInspector = useInvoiceInspectorState();
  const period: DashboardPeriod = {
    startDate: filters.startDate,
    endDate: filters.endDate,
    label: filters.startDate === filters.endDate
      ? filters.endDate
      : `${filters.startDate} – ${filters.endDate}`,
  };

  return (
    <section data-testid="workspace-ipd" className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
        <h2 data-command-center-workspace-heading tabIndex={-1} className="text-xl font-semibold text-[var(--color-text-primary)]">IPD</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Admission-linked charges, finalized bills, payments, deposits, current provisional due, and discharge settlement evidence.
        </p>
      </div>
      <ExecutiveDuePanel role="hospital_admin" basePath={basePath} queryKeyScope="admin" />
      <IPDBillingOverview period={period} queryKeyScope="admin" onInvoiceOpen={invoiceInspector.openInvoice} />
      {invoiceInspector.billId !== null ? (
        <AdminKpiInvoiceModal billId={invoiceInspector.billId} onClose={invoiceInspector.closeInvoice} />
      ) : null}
    </section>
  );
}
