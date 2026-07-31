import { useApiQuery } from './useApiQuery';
import { queryKeys } from '../lib/queryKeys';
import type { ExecutiveDashboardMetric } from './useExecutiveDashboardKpis';
import type {
  DoctorPerformanceResponse,
  DoctorSort,
  ExecutiveDashboardFilters,
  ExpenseAnalysisResponse,
  IncomeServiceResponse,
  PatientAgeAnalyticsResponse,
  ReagentReconciliationResponse,
  TestPerformanceResponse,
  TestSort,
} from '../types/executiveDashboard';

export function executiveAnalyticsQuery(filters: ExecutiveDashboardFilters): string {
  const params = new URLSearchParams();
  params.set('preset', filters.preset);
  if (filters.startDate.trim()) params.set('startDate', filters.startDate.trim());
  if (filters.endDate.trim()) params.set('endDate', filters.endDate.trim());
  if (Number.isInteger(filters.doctorId) && Number(filters.doctorId) > 0) {
    params.set('doctorId', String(filters.doctorId));
  }
  const testSearch = filters.testSearch?.trim();
  if (testSearch) params.set('search', testSearch);
  return params.toString();
}

export function useExecutiveDashboardAnalytics(args: {
  queryKeyScope: 'admin' | 'md' | 'director';
  filters: ExecutiveDashboardFilters;
  enabledPanels: Set<ExecutiveDashboardMetric>;
  doctorPage?: number;
  doctorPageSize?: 10 | 25 | 50 | 100;
  doctorSortBy?: DoctorSort;
  testPage?: number;
  testPageSize?: 10 | 25 | 50 | 100;
  testSortBy?: TestSort;
  incomePage?: number;
  incomePageSize?: 10 | 25 | 50 | 100;
  expensePage?: number;
  expensePageSize?: 10 | 25 | 50 | 100;
  reagentPage?: number;
  reagentPageSize?: 10 | 25 | 50 | 100;
  patientAgeEnabled?: boolean;
}) {
  const periodQuery = executiveAnalyticsQuery({
    ...args.filters,
    doctorId: undefined,
    testSearch: undefined,
  });
  const doctorParams = new URLSearchParams(periodQuery);
  if (Number.isInteger(args.filters.doctorId) && Number(args.filters.doctorId) > 0) {
    doctorParams.set('doctorId', String(args.filters.doctorId));
  }
  doctorParams.set('sortBy', args.doctorSortBy ?? 'payableCommission');
  doctorParams.set('sortDirection', 'desc');
  doctorParams.set('page', String(args.doctorPage ?? 1));
  doctorParams.set('pageSize', String(args.doctorPageSize ?? 10));

  const testParams = new URLSearchParams(periodQuery);
  const search = args.filters.testSearch?.trim();
  if (search) testParams.set('search', search);
  testParams.set('sortBy', args.testSortBy ?? 'quantity');
  testParams.set('sortDirection', 'desc');
  testParams.set('page', String(args.testPage ?? 1));
  testParams.set('pageSize', String(args.testPageSize ?? 10));

  const incomeParams = new URLSearchParams(periodQuery);
  incomeParams.set('page', String(args.incomePage ?? 1));
  incomeParams.set('pageSize', String(args.incomePageSize ?? 10));
  const expenseParams = new URLSearchParams(periodQuery);
  expenseParams.set('page', String(args.expensePage ?? 1));
  expenseParams.set('pageSize', String(args.expensePageSize ?? 10));
  const reagentParams = new URLSearchParams(periodQuery);
  reagentParams.set('page', String(args.reagentPage ?? 1));
  reagentParams.set('pageSize', String(args.reagentPageSize ?? 10));

  const doctorQuery = doctorParams.toString();
  const testQuery = testParams.toString();
  const incomeQuery = incomeParams.toString();
  const expenseQuery = expenseParams.toString();
  const reagentQuery = reagentParams.toString();
  const queryOptions = (enabled: boolean) => ({
    enabled,
    refetchInterval: 60_000,
  });

  const doctorPerformance = useApiQuery<DoctorPerformanceResponse>(
    [args.queryKeyScope, 'executive-analytics', 'doctor-performance', doctorQuery],
    `/api/dashboard/doctor-performance?${doctorQuery}`,
    queryOptions(args.enabledPanels.has('doctor_performance_table')),
  );
  const testPerformance = useApiQuery<TestPerformanceResponse>(
    [args.queryKeyScope, 'executive-analytics', 'test-performance', testQuery],
    `/api/dashboard/test-performance?${testQuery}`,
    queryOptions(args.enabledPanels.has('test_volume_table')),
  );
  const incomeServices = useApiQuery<IncomeServiceResponse>(
    [args.queryKeyScope, 'executive-analytics', 'income-services', incomeQuery],
    `/api/dashboard/income-services?${incomeQuery}`,
    queryOptions(args.enabledPanels.has('income_service_breakdown')),
  );
  const expenseAnalysis = useApiQuery<ExpenseAnalysisResponse>(
    [args.queryKeyScope, 'executive-analytics', 'expense-analysis', expenseQuery],
    `/api/dashboard/expense-analysis?${expenseQuery}`,
    queryOptions(args.enabledPanels.has('expense_source_breakdown')),
  );
  const reagentReconciliation = useApiQuery<ReagentReconciliationResponse>(
    [args.queryKeyScope, 'executive-analytics', 'reagent-reconciliation', reagentQuery],
    `/api/dashboard/reagent-reconciliation?${reagentQuery}`,
    queryOptions(args.enabledPanels.has('reagent_reconciliation_table')),
  );
  const patientAge = useApiQuery<PatientAgeAnalyticsResponse>(
    queryKeys.admin.patientAgeAnalytics(periodQuery),
    `/api/dashboard/patient-age-analytics?${periodQuery}`,
    queryOptions(Boolean(args.patientAgeEnabled)),
  );

  return {
    doctorPerformance,
    testPerformance,
    incomeServices,
    expenseAnalysis,
    reagentReconciliation,
    patientAge,
  };
}
