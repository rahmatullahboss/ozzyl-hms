import { useEffect, useMemo, useState } from 'react';
import DoctorPerformancePanel from '../../../../components/dashboard/DoctorPerformancePanel';
import DoctorPerformanceDrawer from '../../../../components/dashboard/DoctorPerformanceDrawer';
import AdminKpiInvoiceModal from '../../../../components/dashboard/AdminKpiInvoiceModal';
import { useInvoiceInspectorState } from '../../../../components/invoice-inspector/useInvoiceInspectorState';
import { useExecutiveDashboardAnalytics } from '../../../../hooks/useExecutiveDashboardAnalytics';
import type { ExecutiveDashboardMetric } from '../../../../hooks/useExecutiveDashboardKpis';
import type {
  DoctorPerformanceRow,
  DoctorSort,
  ExecutiveDashboardFilters,
} from '../../../../types/executiveDashboard';

interface Props {
  filters: ExecutiveDashboardFilters;
  doctorId?: number;
  onDoctorIdChange?: (doctorId: number | null) => void;
}

export default function DoctorsWorkspace({ filters, doctorId, onDoctorIdChange }: Props) {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<DoctorSort>('payableCommission');
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorPerformanceRow | null>(null);
  const invoiceInspector = useInvoiceInspectorState();
  const enabledPanels = useMemo<Set<ExecutiveDashboardMetric>>(
    () => new Set(['doctor_performance_table']),
    [],
  );
  const analytics = useExecutiveDashboardAnalytics({
    queryKeyScope: 'admin',
    filters,
    enabledPanels,
    doctorPage: page,
    doctorPageSize: 10,
    doctorSortBy: sortBy,
  });

  useEffect(() => {
    if (!doctorId) {
      setSelectedDoctor(null);
      return;
    }
    const matchingDoctor = analytics.doctorPerformance.data?.rows.find((doctor) => doctor.doctorId === doctorId);
    if (matchingDoctor) setSelectedDoctor(matchingDoctor);
  }, [analytics.doctorPerformance.data?.rows, doctorId]);

  const openDoctor = (doctor: DoctorPerformanceRow) => {
    setSelectedDoctor(doctor);
    onDoctorIdChange?.(doctor.doctorId && doctor.doctorId > 0 ? doctor.doctorId : null);
  };

  const closeDoctor = () => {
    setSelectedDoctor(null);
    onDoctorIdChange?.(null);
  };

  return (
    <section data-testid="workspace-doctors" className="space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
        <h2 data-command-center-workspace-heading tabIndex={-1} className="text-xl font-semibold text-[var(--color-text-primary)]">Doctors</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Doctor-wise visits, referred and performed tests, collection, waiver, payable, paid, and outstanding compensation.
        </p>
      </div>
      <DoctorPerformancePanel
        data={analytics.doctorPerformance.data}
        loading={analytics.doctorPerformance.isLoading}
        error={analytics.doctorPerformance.isError}
        sortBy={sortBy}
        onDoctorOpen={openDoctor}
        onPageChange={setPage}
        onSortChange={(next) => { setSortBy(next); setPage(1); }}
      />
      <DoctorPerformanceDrawer
        doctor={selectedDoctor}
        filters={filters}
        queryKeyScope="admin"
        onClose={closeDoctor}
        onInvoiceOpen={invoiceInspector.openInvoice}
      />
      {invoiceInspector.billId !== null ? (
        <AdminKpiInvoiceModal billId={invoiceInspector.billId} onClose={invoiceInspector.closeInvoice} />
      ) : null}
    </section>
  );
}
