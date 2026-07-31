import { useMemo, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import ExpenseAnalysisPanel from '../../../../components/dashboard/ExpenseAnalysisPanel';
import IncomeServicePanel from '../../../../components/dashboard/IncomeServicePanel';
import { useApiQuery } from '../../../../hooks/useApiQuery';
import { useExecutiveDashboardAnalytics } from '../../../../hooks/useExecutiveDashboardAnalytics';
import type { ExecutiveDashboardMetric } from '../../../../hooks/useExecutiveDashboardKpis';
import { queryKeys } from '../../../../lib/queryKeys';
import type {
  ExecutiveDashboardFilters,
  FinancialReconciliationEnvelope,
} from '../../../../types/executiveDashboard';
import PaymentMethodBreakdown from '../../widgets/PaymentMethodBreakdown';
import RevenueTrendChart from '../../widgets/RevenueTrendChart';
import FinancialControlBlock from '../components/FinancialControlBlock';

interface BusinessPerformanceBlock {
  recognizedIncome: number;
  approvedExpensePaid: number;
  operatingResult: number;
  depositReceipts: number;
  depositTreatment: 'liability_not_revenue';
  reconciliation: FinancialReconciliationEnvelope;
}

interface CollectionFlowBlock {
  currentInvoiceCollection: number;
  priorDueCollection: number;
  totalCollection: number;
  depositReceipts: number;
  depositIncludedInTotalCollection: false;
  transactionCount: number;
  reconciliation: FinancialReconciliationEnvelope;
}

interface CashCustodyBlock {
  physicalCashIn: number;
  physicalCashOut: number;
  netCashMovement: number;
  nonCashCollection: number;
  currentDrawerBalance: number;
  currentDrawerTemporalMode: 'current_state';
  reconciliation: FinancialReconciliationEnvelope;
}

interface DoctorLiabilityBlock {
  earned: number;
  waiver: number;
  payable: number;
  paid: number;
  outstanding: number;
  rowCount: number;
  reconciliation: FinancialReconciliationEnvelope;
}

interface FinancialControlResponse {
  businessPerformance: BusinessPerformanceBlock;
  collectionFlow: CollectionFlowBlock;
  cashCustody: CashCustodyBlock;
  doctorLiability: DoctorLiabilityBlock;
}

interface Props {
  filters: ExecutiveDashboardFilters;
}

export default function MoneyWorkspace({ filters }: Props) {
  const navigate = useNavigate();
  const { slug = '' } = useParams<{ slug: string }>();
  const [incomePage, setIncomePage] = useState(1);
  const [expensePage, setExpensePage] = useState(1);
  const enabledPanels = useMemo<Set<ExecutiveDashboardMetric>>(
    () => new Set(['income_service_breakdown', 'expense_source_breakdown']),
    [],
  );
  const analytics = useExecutiveDashboardAnalytics({
    queryKeyScope: 'admin',
    filters,
    enabledPanels,
    incomePage,
    incomePageSize: 10,
    expensePage,
    expensePageSize: 10,
  });
  const financialControl = useApiQuery<FinancialControlResponse>(
    queryKeys.admin.financialControl(filters.startDate, filters.endDate),
    `/api/dashboard/financial-control?startDate=${encodeURIComponent(filters.startDate)}&endDate=${encodeURIComponent(filters.endDate)}`,
  );
  const basePath = `/h/${slug}`;
  const rangeQuery = `from=${encodeURIComponent(filters.startDate)}&to=${encodeURIComponent(filters.endDate)}`;
  const data = financialControl.data;

  return (
    <section data-testid="workspace-money" className="min-w-0 space-y-4">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-4 shadow-sm">
        <h2 data-command-center-workspace-heading tabIndex={-1} className="text-xl font-semibold text-[var(--color-text-primary)]">Money</h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Reconciled business performance, collection flow, cash custody, and doctor liability for the selected period.
        </p>
      </div>

      {financialControl.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
          <span className="flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            Unable to load reconciled financial controls.
          </span>
          <button
            type="button"
            onClick={() => { void financialControl.refetch(); }}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-current px-3 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      ) : financialControl.isLoading ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" aria-label="Loading financial controls">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="skeleton h-96 rounded-2xl" />)}
        </div>
      ) : data ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <FinancialControlBlock
            testId="financial-block-business-performance"
            title="Business performance"
            description="Recognised income and paid operating expense remain separate from patient deposit liabilities."
            formula="Recognised income − paid expense = operating result"
            metrics={[
              { label: 'Recognised income', value: data.businessPerformance.recognizedIncome },
              { label: 'Paid expense', value: data.businessPerformance.approvedExpensePaid },
              { label: 'Operating result', value: data.businessPerformance.operatingResult, emphasis: true },
            ]}
            secondaryMetrics={[
              { label: 'Patient deposits (liability, not revenue)', value: data.businessPerformance.depositReceipts },
            ]}
            reconciliation={data.businessPerformance.reconciliation}
            detailsLabel="Open business performance details"
            onOpenDetails={() => navigate(`${basePath}/cash/collections?${rangeQuery}`)}
          />

          <FinancialControlBlock
            testId="financial-block-collection-flow"
            title="Collection flow"
            description="Payments against current invoices and prior dues are visible independently; deposits are outside the collection total."
            formula="Current invoice collection + prior-due collection = total collection"
            metrics={[
              { label: 'Current invoice collection', value: data.collectionFlow.currentInvoiceCollection },
              { label: 'Prior-due collection', value: data.collectionFlow.priorDueCollection },
              { label: 'Total collection', value: data.collectionFlow.totalCollection, emphasis: true },
            ]}
            secondaryMetrics={[
              { label: 'Patient deposits (separate liability flow)', value: data.collectionFlow.depositReceipts },
            ]}
            reconciliation={data.collectionFlow.reconciliation}
            detailsLabel="Open collection flow details"
            onOpenDetails={() => navigate(`${basePath}/cash/collections?${rangeQuery}#daily-collection-snapshot`)}
          />

          <FinancialControlBlock
            testId="financial-block-cash-custody"
            title="Cash custody"
            description="Physical drawer movements are separated from non-cash payment collection and current drawer state."
            formula="Physical cash in − physical cash out = net cash movement"
            metrics={[
              { label: 'Physical cash in', value: data.cashCustody.physicalCashIn },
              { label: 'Physical cash out', value: data.cashCustody.physicalCashOut },
              { label: 'Net cash movement', value: data.cashCustody.netCashMovement, emphasis: true },
            ]}
            secondaryMetrics={[
              { label: 'Non-cash collection', value: data.cashCustody.nonCashCollection },
              { label: 'Current drawer balance', value: data.cashCustody.currentDrawerBalance, badge: 'Live/current state' },
            ]}
            reconciliation={data.cashCustody.reconciliation}
            detailsLabel="Open cash custody details"
            onOpenDetails={() => navigate(`${basePath}/cash/drawers?${rangeQuery}`)}
          />

          <FinancialControlBlock
            testId="financial-block-doctor-liability"
            title="Doctor liability"
            description="Earned, waived, payable, paid, and outstanding compensation remain distinct server-calculated values."
            formula="Earned − waiver = payable; payable − paid = outstanding"
            metrics={[
              { label: 'Earned', value: data.doctorLiability.earned },
              { label: 'Waiver', value: data.doctorLiability.waiver },
              { label: 'Payable', value: data.doctorLiability.payable },
              { label: 'Paid', value: data.doctorLiability.paid },
              { label: 'Outstanding', value: data.doctorLiability.outstanding, emphasis: true },
            ]}
            reconciliation={data.doctorLiability.reconciliation}
            detailsLabel="Open doctor liability details"
            onOpenDetails={() => navigate(`${basePath}/cash/commissions?${rangeQuery}`)}
          />
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--color-border)] p-8 text-center text-sm text-[var(--color-text-muted)]">
          No financial control response is available for this period.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="min-w-0 lg:col-span-2">
          <RevenueTrendChart filters={filters} />
        </div>
        <PaymentMethodBreakdown filters={filters} />
      </div>

      <IncomeServicePanel
        data={analytics.incomeServices.data}
        loading={analytics.incomeServices.isLoading}
        error={analytics.incomeServices.isError}
        onRetry={() => { void analytics.incomeServices.refetch(); }}
        onPageChange={setIncomePage}
      />
      <ExpenseAnalysisPanel
        data={analytics.expenseAnalysis.data}
        loading={analytics.expenseAnalysis.isLoading}
        error={analytics.expenseAnalysis.isError}
        onRetry={() => { void analytics.expenseAnalysis.refetch(); }}
        onPageChange={setExpensePage}
      />
    </section>
  );
}
