import type {
  FinancialReconciliationEnvelope as DashboardFinancialReconciliationEnvelope,
} from '../../../packages/shared/src/dashboard';

export type {
  AdminDashboardOverviewResponse,
  AdminDashboardRequest,
  DashboardDateBasis,
  DashboardHealthState,
  DashboardMetricDefinition,
  DashboardMetricResult,
  DashboardPermissionSummary,
  DashboardRolePreset,
  DashboardSourceState,
  DashboardSourceStatus,
  DashboardTemporalMode,
  DashboardWarning,
  FinancialReconciliationEnvelope,
  MetricComparison,
  ReconciliationResult,
} from '../../../packages/shared/src/dashboard';

export type DashboardRange =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | '7d'
  | '30d'
  | 'custom';

export type PatientAgeBucket =
  | '0_5'
  | '6_17'
  | '18_30'
  | '31_45'
  | '46_60'
  | '61_plus'
  | 'unknown';

export interface PatientAgeAggregateMetrics {
  uniquePatients: number;
  visits: number;
  admissions: number;
  services: number;
  billCount: number;
  collection: number;
  averageBill: number;
  repeatPatients: number;
  repeatVisitRate: number;
  patientShare: number;
}

export interface PatientAgeAggregateRow extends PatientAgeAggregateMetrics {
  bucket: PatientAgeBucket;
  label: string;
}

export interface PatientAgeAnalyticsResponse {
  period: ExecutiveDashboardPeriod;
  metadata: {
    contractVersion: 'patient-age-at-service-v1';
    grain: 'age_bucket';
    ageBasis: 'completed_years_at_service_date';
    dateBasis: 'service_date';
    timezone: 'Asia/Dhaka';
    moneyUnit: 'major';
    currencyCode: 'BDT';
    averageBillDenominator: 'unique_bills';
    repeatVisitRateNumerator: 'patients_with_multiple_visits';
    repeatVisitRateDenominator: 'unique_patients';
  };
  rows: PatientAgeAggregateRow[];
  totals: PatientAgeAggregateMetrics;
  warnings: string[];
}

export type PatientAgeDetailView = 'services' | 'doctors' | 'departments' | 'patients';
export type PatientAgeDetailSort = 'name' | 'uniquePatients' | 'visits' | 'services' | 'collection';
export type PatientAgeDetailSortDirection = 'asc' | 'desc';

export interface PatientAgeAggregateDetailRow {
  id: number | string | null;
  name: string;
  category: string | null;
  uniquePatients: number;
  visits: number;
  services: number;
  quantity?: number;
  collection: number;
}

export interface PatientAgePatientDetailRow {
  patientId: number;
  patientCode: string | null;
  patientName: string | null;
  ageAtService: number | null;
  bucket: PatientAgeBucket;
  latestServiceAt: string;
  visits: number;
  admissions: number;
  services: number;
  collection: number;
}

export interface PatientAgeDetailResponse {
  period: ExecutiveDashboardPeriod;
  ageBucket: PatientAgeBucket;
  view: PatientAgeDetailView;
  rows: Array<PatientAgeAggregateDetailRow | PatientAgePatientDetailRow>;
  totals: {
    uniquePatients: number;
    visits: number;
    admissions?: number;
    services: number;
    collection: number;
  };
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
  reconciliation: Record<string, DashboardFinancialReconciliationEnvelope>;
  warnings: string[];
}

export type DoctorSort =
  | 'visits'
  | 'tests'
  | 'visitCollection'
  | 'testCollection'
  | 'testDiscount'
  | 'earnedCommission'
  | 'payableCommission'
  | 'outstandingCommission'
  | 'totalCommission';
export type TestSort = 'quantity' | 'billed' | 'collected' | 'due' | 'testCommission';

export type CommissionReasonCode =
  | 'rule_matched'
  | 'no_matching_rule'
  | 'doctor_missing'
  | 'bill_unpaid'
  | 'cancelled'
  | 'refunded'
  | 'eligible_base_zero'
  | 'doctor_waived'
  | 'manual_adjustment'
  | 'reversal'
  | 'held_for_review';

export interface DoctorAnalyticsQueryContract {
  contractVersion: 'doctor-compensation-v1';
  dataSource: 'legacy' | 'canonical';
  moneyUnit: 'major';
  currencyCode: 'BDT';
  dateBasis: 'tenant-business-date-asia-dhaka';
  cutoverPolicy: 'explicit-provider-switch';
}

export interface ExecutiveDashboardPeriod {
  startDate: string;
  endDate: string;
  label: string;
  preset?: DashboardRange;
}

export interface ExecutiveDashboardFilters {
  preset: DashboardRange;
  startDate: string;
  endDate: string;
  doctorId?: number;
  testSearch?: string;
}

export interface DoctorPerformanceRow {
  doctorId: number | null;
  doctorName: string;
  visits: number;
  visitCollection: number;
  visitCommission: number;
  tests: number;
  referredTests: number;
  discountedTests: number;
  testGrossAmount: number;
  testDiscountAmount: number;
  testCollection: number;
  referrerCommission: number;
  performerReserveCount: number;
  performedTests: number;
  performerReserve: number;
  testCommission: number;
  otherCommission: number;
  earnedCommission: number;
  doctorWaiver: number;
  payableCommission: number;
  paidCommission: number;
  outstandingCommission: number;
  totalCommission: number;
  lastActivityAt?: string | null;
  lastActivityType?: string | null;
}

export interface DoctorPerformanceResponse {
  period: ExecutiveDashboardPeriod;
  queryContract: DoctorAnalyticsQueryContract;
  totals: Omit<DoctorPerformanceRow, 'doctorId' | 'doctorName'>;
  rows: DoctorPerformanceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
  reconciliation?: Record<string, DashboardFinancialReconciliationEnvelope>;
}

export type DoctorPerformanceDetailsTab =
  | 'visits'
  | 'tests'
  | 'referred-tests'
  | 'performed-tests'
  | 'commissions';

export interface DoctorVisitDetailRow {
  id: string;
  billId?: number | null;
  occurredAt: string;
  patientName: string | null;
  invoiceNo: string | null;
  serviceName: string;
  billedAmount: number;
  collectedAmount: number;
  dueAmount: number;
  status: string | null;
}

export interface DoctorTestDetailRow {
  id: number;
  billId?: number | null;
  occurredAt: string;
  testName: string;
  patientName: string | null;
  referringDoctorName: string;
  orderingDoctorName: string;
  orderingClinicianId: number | null;
  orderingClinicianName: string | null;
  enteredByUserId: number | null;
  enteredByName: string | null;
  performingDoctorId: number | null;
  performingDoctorName: string | null;
  invoiceNo: string | null;
  accessionNo: string | null;
  status: string | null;
  grossAmount: number;
  discountAmount: number;
  netBilledAmount: number;
  billedAmount: number;
  collectedAmount: number;
  dueAmount: number;
  performerReserveAmount: number;
  commissionBaseAmount: number;
  earnedAmount: number;
  waiverAmount: number;
  payableAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  testCommission: number;
}

export interface DoctorCommissionDetailRow {
  id: number;
  billId?: number | null;
  occurredAt: string;
  sourceType: string;
  incentiveType: string | null;
  doctorName: string;
  detailName: string | null;
  referenceNo: string | null;
  grossAmount: number;
  discountAmount: number;
  netBilledAmount: number;
  performerReserveAmount: number;
  commissionBaseAmount: number;
  rateLabel: string | null;
  commissionRuleId: number | string | null;
  commissionRuleVersion: number | null;
  earnedAmount: number;
  waiverAmount: number;
  adjustmentAmount: number;
  payableAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  settlementNo: string | null;
  waiverReason: string | null;
  reasonCode?: CommissionReasonCode;
  reasonLabel?: string;
  amount: number;
  status: string | null;
}

export interface DoctorPerformanceDetailsSummary {
  visits: number;
  visitCollection: number;
  referredTests: number;
  discountedTests: number;
  testGrossAmount: number;
  testDiscountAmount: number;
  testCollection: number;
  performedTests: number;
  performerReserveAmount: number;
  earnedCommission: number;
  doctorWaiver: number;
  payableCommission: number;
  paidCommission: number;
  outstandingCommission: number;
}

export interface DoctorPerformanceDetailsResponse {
  period: ExecutiveDashboardPeriod;
  queryContract: DoctorAnalyticsQueryContract;
  doctorId: number | null;
  tab: DoctorPerformanceDetailsTab;
  summary: DoctorPerformanceDetailsSummary;
  rows: Array<DoctorVisitDetailRow | DoctorTestDetailRow | DoctorCommissionDetailRow>;
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
  reconciliation?: Record<string, DashboardFinancialReconciliationEnvelope>;
}

export interface DoctorActivityRow {
  eventId: string;
  eventType: string;
  occurredAt: string;
  sourceType: string;
  sourceId: string;
  doctorId: number;
  billId: number | null;
  invoiceNo: string | null;
  patientId: number | null;
  patientName: string | null;
  patientIdentityRedacted: boolean;
  title: string;
  amount: number;
  status: string | null;
  reasonCode: CommissionReasonCode | null;
}

export interface DoctorActivityResponse {
  period: ExecutiveDashboardPeriod;
  doctorId: number;
  rows: DoctorActivityRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export interface TestPerformanceRow {
  testId: number;
  testCode: string | null;
  testName: string;
  quantity: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
}

export interface TestPerformanceResponse {
  period: ExecutiveDashboardPeriod;
  totals: Omit<TestPerformanceRow, 'testId' | 'testCode' | 'testName'>;
  rows: TestPerformanceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export type TestPerformanceDetailView = 'lines' | 'referred' | 'performed';

export interface TestPerformanceDetailsSummary {
  quantity: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
  performerReserve: number;
  referringDoctorCount: number;
  performingDoctorCount: number;
}

export interface TestPerformanceDetailRow {
  id: number;
  billId: number | null;
  occurredAt: string;
  testName: string;
  patientName: string | null;
  quantity: number;
  referringDoctorId: number | null;
  referringDoctorName: string;
  orderingClinicianId: number | null;
  orderingClinicianName: string | null;
  enteredByUserId: number | null;
  enteredByName: string | null;
  performingDoctorId: number | null;
  performingDoctorName: string | null;
  invoiceNo: string | null;
  status: string | null;
  grossAmount: number;
  discountAmount: number;
  billedAmount: number;
  collectedAmount: number;
  dueAmount: number;
  performerReserveAmount: number;
  testCommission: number;
}

export interface TestPerformanceReferredDoctorRow {
  doctorId: number | null;
  doctorName: string;
  quantity: number;
  billed: number;
  collected: number;
  due: number;
  testCommission: number;
  discountedQuantity: number;
  discountAmount: number;
}

export interface TestPerformancePerformedDoctorRow {
  doctorId: number | null;
  doctorName: string;
  quantity: number;
  performerReserve: number;
  completed: number;
  pending: number;
}

export type TestPerformanceDetailsRow =
  | TestPerformanceDetailRow
  | TestPerformanceReferredDoctorRow
  | TestPerformancePerformedDoctorRow;

export interface TestPerformanceDetailsResponse {
  period: ExecutiveDashboardPeriod;
  testId: number;
  view: TestPerformanceDetailView;
  summary: TestPerformanceDetailsSummary;
  rows: TestPerformanceDetailsRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export interface IncomeServiceRow {
  serviceName: string;
  category: string;
  transactions: number;
  units: number;
  collection: number;
  share: number;
}

export interface IncomeServiceResponse {
  period: ExecutiveDashboardPeriod;
  totals: { transactions: number; units: number; collection: number };
  rows: IncomeServiceRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export interface ExpenseAnalysisRow {
  id: string;
  occurredAt: string;
  category: string;
  detail: string;
  paidAmount: number;
  paymentMethod: string;
  status: string;
}

export interface ExpenseAnalysisResponse {
  period: ExecutiveDashboardPeriod;
  totals: { transactions: number; paidAmount: number };
  rows: ExpenseAnalysisRow[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export type ReagentReconciliationStatus =
  | 'ok'
  | 'unmapped'
  | 'missing_consumption'
  | 'over_consumption'
  | 'low_stock'
  | 'out_of_stock'
  | 'qc_blocked';

export interface ReagentReconciliationRow {
  consumableId: number;
  reagentCode: string | null;
  reagentName: string;
  unit: string;
  completedTests: number;
  expectedUsage: number;
  actualUsage: number;
  returnedQuantity: number;
  variance: number;
  currentStock: number;
  reorderLevel: number;
  status: ReagentReconciliationStatus;
}

export interface ReagentReconciliationResponse {
  period: ExecutiveDashboardPeriod;
  rows: ReagentReconciliationRow[];
  quantityTotals: Array<{ unit: string; quantity: number }>;
  exceptions: {
    unmappedCompletedTests: number;
    consumptionExceptions: number;
    unmappedTests: Array<{ testId: number; testName: string; completedTests: number }>;
  };
  availability: { mapping: boolean; movements: boolean; stock: boolean };
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}

export interface ExecutiveAnalyticsQueryState<T> {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}
