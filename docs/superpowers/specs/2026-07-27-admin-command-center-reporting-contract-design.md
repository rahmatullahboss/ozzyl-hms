# Admin Command Center Reporting Contract Design

Date: 2026-07-27
Status: Approved contract specification
Companion design: `docs/superpowers/specs/2026-07-27-admin-command-center-program-design.md`

## 1. Contract goals

Define stable shared contracts for period handling, date semantics, reconciliation, drill navigation, doctor compensation, invoice inspection, patient age analytics, privacy, and exports.

The reporting layer reads existing operational and financial source tables. It does not create or mutate financial facts.

## 2. Common response metadata

Every new command-center endpoint returns:

```ts
export type ReportingDateBasis =
  | 'service_date'
  | 'bill_date'
  | 'payment_date'
  | 'business_date'
  | 'commission_accrual_date'
  | 'commission_settlement_date'
  | 'current_state';

export interface ReportingPeriod {
  startDate: string;
  endDate: string;
  label: string;
  timeZone: 'Asia/Dhaka';
}

export interface ReportingContractMetadata {
  contractVersion: string;
  period: ReportingPeriod;
  temporalMode: 'period' | 'as_of' | 'live';
  dateBasis: ReportingDateBasis;
  currencyCode: 'BDT';
  moneyUnit: 'major';
  generatedAt: string;
  dataSource: 'legacy' | 'canonical' | 'hybrid';
  sourceStatus: DashboardSourceStatus;
}

export interface DashboardSourceStatus {
  state: 'complete' | 'partial' | 'stale' | 'unavailable';
  requiredSources: string[];
  loadedSources: string[];
  unavailableSources: Array<{
    source: string;
    reasonCode: string;
    message: string;
  }>;
  staleAfterSeconds: number;
}

export interface MetricComparison {
  comparisonLabel: string;
  currentValue: number;
  comparisonValue: number | null;
  absoluteChange: number | null;
  percentageChange: number | null;
  desirableDirection: 'higher' | 'lower' | 'target_range' | 'zero' | 'neutral';
  interpretation: 'positive' | 'negative' | 'neutral' | 'not_comparable';
  reasonCode?: string;
}
```

Money fields use major BDT units and are rounded to two decimal places at response boundaries. SQL aggregation may keep greater precision internally. A failed or missing source is represented by `sourceStatus`; it is never converted into a verified zero. Comparison is optional per metric, but when present it uses the metric registry’s declared direction and an explicitly labeled comparison period.

## 3. Query parameters

### 3.1 Shared period parameters

All selected-period routes accept:

```text
preset=today|yesterday|this_week|this_month|last_month|7d|30d|custom
startDate=YYYY-MM-DD
endDate=YYYY-MM-DD
```

Rules:

- `startDate` and `endDate` override the preset after validation.
- Both dates are required together.
- `startDate` must not be later than `endDate`.
- The default is the tenant’s current business date in Asia/Dhaka.
- A maximum range limit is enforced per endpoint. Initial interactive maximum: 366 days.
- Invalid dates return HTTP 400 with field-level error details.

### 3.2 Paging and sorting

```text
page=1
pageSize=25|50|100
sortBy=<endpoint allowlist>
sortDirection=asc|desc
```

The server rejects unknown sort fields. Pagination happens after the endpoint’s declared detail grain is established.

### 3.3 Drill filters

Supported when relevant:

```text
doctorId=17
testId=42
sourceLabel=Lab
invoiceId=91
ageBucket=0_5|6_17|18_30|31_45|46_60|61_plus|unknown
```

Identity filters use stable IDs rather than display names.

## 4. Reconciliation envelope

```ts
export type ReconciliationStatus = 'reconciled' | 'warning' | 'unavailable';

export interface ReconciliationEnvelope {
  summaryTotal: number;
  detailTotal: number;
  unexplainedDifference: number;
  rowCount: number;
  detailGrain: string;
  status: ReconciliationStatus;
  warnings: string[];
}
```

### 4.1 Invariants

1. `detailTotal` represents all matching detail rows, not the current page.
2. `rowCount` represents rows at the declared grain, not raw joined records.
3. `unexplainedDifference = round(summaryTotal - detailTotal, 2)`.
4. `status = reconciled` when `abs(unexplainedDifference) < 0.01`.
5. `status = warning` when a full total exists and the difference is non-zero.
6. `status = unavailable` when the source cannot compute a trustworthy full-detail total.
7. An empty result is reconciled only when both totals are zero.
8. The UI displays warnings verbatim and never converts `unavailable` into a successful zero.

### 4.2 Standard financial response

```ts
export interface ReconciledPagedResponse<Row> {
  metadata: ReportingContractMetadata;
  reconciliation: ReconciliationEnvelope;
  rows: Row[];
  page: number;
  pageSize: number;
  totalRows: number;
  hasNextPage: boolean;
}
```

Existing endpoints may add `metadata` and `reconciliation` backward-compatibly while preserving their existing top-level fields until consumers migrate.

## 5. Dashboard shell URL contract

```ts
export type CommandCenterTab =
  | 'overview'
  | 'money'
  | 'doctors'
  | 'patients'
  | 'ipd'
  | 'diagnostics'
  | 'inventory'
  | 'audit';

export interface CommandCenterUrlState {
  tab: CommandCenterTab;
  preset: DashboardRange;
  startDate: string;
  endDate: string;
  dateBasis?: ReportingDateBasis;
  doctorId?: number;
  testId?: number;
  invoiceId?: number;
}
```

Canonical URL keys:

```text
tab, range, from, to, dateBasis, doctorId, testId, invoiceId
```

URL behavior:

- Invalid tabs fall back to `overview` and are normalized with `replace` navigation.
- Missing period values use the existing Today resolver.
- Opening a doctor switches to `tab=doctors` and sets `doctorId`.
- Opening a test switches to `tab=diagnostics` and sets `testId`.
- Opening an invoice preserves the current tab and adds `invoiceId`.
- Closing a drawer removes only its identity parameter.
- Browser Back restores the previous drawer, tab, and filters.

## 6. Financial control contracts

### 6.1 Financial overview

Endpoint:

```text
GET /api/dashboard/financial-control
```

Response:

```ts
export interface FinancialControlResponse {
  metadata: ReportingContractMetadata;
  businessPerformance: {
    recognizedIncome: number;
    operatingExpense: number;
    doctorPayoutExpense: number;
    operatingResult: number;
    reconciliation: ReconciliationEnvelope;
  };
  collectionFlow: {
    currentInvoiceCollection: number;
    priorDueCollection: number;
    otherReceipts: number;
    totalCollection: number;
    depositReceipts: number;
    reconciliation: ReconciliationEnvelope;
  };
  cashCustody: {
    openingCash: number;
    physicalCashIn: number;
    physicalCashOut: number;
    acceptedHandovers: number;
    availableDrawerCash: number;
    dateBasis: 'current_state';
    reconciliation: ReconciliationEnvelope;
  };
  doctorLiability: {
    earned: number;
    waiver: number;
    adjustment: number;
    payable: number;
    paid: number;
    outstanding: number;
    reconciliation: ReconciliationEnvelope;
  };
}
```

Implementation may compose existing KPI services. It must not independently reproduce their SQL formulas in the route handler.

### 6.2 Payment-method breakdown

The existing daily collection route is insufficient for a shared multi-day period unless it already supports ranges. The command center uses:

```text
GET /api/dashboard/payment-methods?startDate=...&endDate=...
```

```ts
export interface PaymentMethodBreakdownRow {
  paymentMethod: string;
  amount: number;
  transactionCount: number;
  sharePercent: number;
}

export interface PaymentMethodBreakdownResponse {
  metadata: ReportingContractMetadata & { dateBasis: 'payment_date' };
  reconciliation: ReconciliationEnvelope;
  total: number;
  rows: PaymentMethodBreakdownRow[];
}
```

Selecting a payment method opens invoice/payment rows using the same period and method filter.

### 6.3 Trend response

```text
GET /api/dashboard/financial-trend?startDate=...&endDate=...&series=collection,expense,result
```

```ts
export interface FinancialTrendPoint {
  date: string;
  collection: number;
  expense: number;
  result: number;
}

export interface FinancialTrendResponse {
  metadata: ReportingContractMetadata;
  points: FinancialTrendPoint[];
  totals: { collection: number; expense: number; result: number };
  reconciliation: {
    collection: ReconciliationEnvelope;
    expense: ReconciliationEnvelope;
    result: ReconciliationEnvelope;
  };
}
```

The server chooses daily or monthly aggregation based on range length and returns the granularity in `contractVersion` or an explicit `granularity` field.

## 7. Action Center summary contract

The existing `/api/action-center/summary` remains authoritative.

The dashboard consumes these fields:

```ts
export interface CommandCenterActionSummary {
  pendingApprovals: number;
  criticalExceptions: number;
  receivableExposureMinor: number | null;
  receivableCurrencyCode: string | null;
  overdueTasks: number;
  nextBestAction: {
    href: string;
    label: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
  } | null;
}
```

No dashboard endpoint creates alternate approval, exception, collection, or task counts.

## 8. Doctor-performance extension

Existing endpoints remain:

```text
GET /api/dashboard/doctor-performance
GET /api/dashboard/doctor-performance/details
```

### 8.1 Summary extension

Add backward-compatible fields:

```ts
export interface DoctorPerformanceExtension {
  lastActivityAt: string | null;
  lastActivityType: string | null;
  reconciliation: {
    visitCollection: ReconciliationEnvelope;
    testCollection: ReconciliationEnvelope;
    payableCommission: ReconciliationEnvelope;
    paidCommission: ReconciliationEnvelope;
  };
}
```

The top-level response includes overall reconciliation. Per-doctor row reconciliation is optional only when it can be computed without N+1 queries; the first release requires overall reconciliation and exact row totals.

### 8.2 Activity timeline

Endpoint:

```text
GET /api/dashboard/doctor-performance/activity?doctorId=17&startDate=...&endDate=...&page=1&pageSize=50
```

```ts
export type DoctorActivityType =
  | 'visit'
  | 'test_referred'
  | 'test_performed'
  | 'test_verified'
  | 'commission_accrued'
  | 'commission_waived'
  | 'commission_adjusted'
  | 'commission_settled'
  | 'invoice_cancelled'
  | 'refund_recorded';

export interface DoctorActivityRow {
  id: string;
  occurredAt: string;
  type: DoctorActivityType;
  title: string;
  detail: string;
  billId: number | null;
  invoiceNo: string | null;
  patientName: string | null;
  amount: number | null;
  status: string | null;
  actorName: string | null;
}
```

Patient fields are returned only when the caller is authorized to view them.

### 8.3 Commission explanation extension

Extend existing doctor commission detail rows:

```ts
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

export interface DoctorCommissionExplanationFields {
  billId: number | null;
  ruleId: number | null;
  ruleVersion: string | null;
  adjustmentAmount: number;
  reasonCode: CommissionReasonCode;
  reasonLabel: string;
}
```

If historical rule identity is unavailable, `ruleId` and `ruleVersion` are null and the response warning explains that limitation. The server never invents a rule identity from current configuration.

## 9. Shared invoice inspector contract

Endpoint:

```text
GET /api/billing/:billId/inspector
```

Response:

```ts
export interface InvoiceInspectorResponse {
  metadata: ReportingContractMetadata;
  invoice: {
    billId: number;
    invoiceNo: string;
    status: string;
    createdAt: string;
    patient: {
      id: number | null;
      code: string | null;
      name: string | null;
    };
    admissionId: number | null;
    appointmentId: number | null;
    grossAmount: number;
    discountAmount: number;
    netAmount: number;
    paidAmount: number;
    depositAdjustedAmount: number;
    dueAmount: number;
  };
  items: Array<{
    id: number;
    category: string;
    description: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    orderingDoctorId: number | null;
    orderingDoctorName: string | null;
    referringDoctorId: number | null;
    referringDoctorName: string | null;
    performingDoctorId: number | null;
    performingDoctorName: string | null;
    verifyingDoctorId: number | null;
    verifyingDoctorName: string | null;
  }>;
  payments: Array<{
    id: number;
    occurredAt: string;
    receiptNo: string | null;
    paymentMethod: string;
    paymentType: string | null;
    amount: number;
    receivedBy: string | null;
    counterName: string | null;
  }>;
  deposits: Array<{
    id: number;
    occurredAt: string;
    receiptNo: string | null;
    transactionType: string;
    amount: number;
    remarks: string | null;
  }>;
  discount: {
    amount: number;
    referenceName: string | null;
    reason: string | null;
    allocations: Array<{
      source: string;
      amount: number;
      fundedBy: string | null;
    }>;
  };
  compensation: Array<{
    id: number;
    doctorId: number | null;
    doctorName: string;
    sourceType: string;
    incentiveType: string | null;
    detailName: string | null;
    ruleId: number | null;
    ruleVersion: string | null;
    grossAmount: number;
    discountAmount: number;
    performerReserveAmount: number;
    commissionBaseAmount: number;
    rateLabel: string | null;
    earnedAmount: number;
    waiverAmount: number;
    adjustmentAmount: number;
    payableAmount: number;
    paidAmount: number;
    outstandingAmount: number;
    reasonCode: CommissionReasonCode;
    status: string;
  }>;
  audit: Array<{
    id: string;
    occurredAt: string;
    eventType: string;
    title: string;
    detail: string;
    actorName: string | null;
    referenceNo: string | null;
  }>;
  reconciliation: {
    invoice: ReconciliationEnvelope;
    payments: ReconciliationEnvelope;
    compensation: ReconciliationEnvelope;
  };
  actions: {
    fullBillingPath: string;
    printablePath: string | null;
    pdfPath: string | null;
  };
}
```

Authorization is checked before composing any section. A missing optional source returns an empty array and a warning, not an HTTP 500.

## 10. Patient age analytics contract

### 10.1 Summary endpoint

```text
GET /api/dashboard/patient-age-analytics?startDate=...&endDate=...
```

```ts
export type PatientAgeBucket =
  | '0_5'
  | '6_17'
  | '18_30'
  | '31_45'
  | '46_60'
  | '61_plus'
  | 'unknown';

export interface PatientAgeSummaryRow {
  bucket: PatientAgeBucket;
  label: string;
  uniquePatients: number;
  visits: number;
  admissions: number;
  services: number;
  collection: number;
  averageBill: number;
  repeatVisitRate: number;
}

export interface PatientAgeAnalyticsResponse {
  metadata: ReportingContractMetadata & { dateBasis: 'service_date' };
  totals: Omit<PatientAgeSummaryRow, 'bucket' | 'label'>;
  rows: PatientAgeSummaryRow[];
  unknownDobCount: number;
  warnings: string[];
}
```

### 10.2 Bucket drill endpoint

```text
GET /api/dashboard/patient-age-analytics/details?ageBucket=18_30&startDate=...&endDate=...&view=services
```

Views:

```text
services | doctors | departments | patients
```

The `patients` view requires `patients:read`. Without it, HTTP 403 is returned for that view while aggregate views remain available.

### 10.3 Age SQL definition

The age-at-service calculation must use completed years and handle month/day ordering. A service before the recorded date of birth is classified as `unknown` and produces a warning count.

The implementation test suite must cover:

- Birthday on service date
- Day before birthday
- Leap-day birth date
- Null date of birth
- Invalid date of birth
- Service date before date of birth
- Every bucket boundary

## 11. Privacy and field redaction

```ts
export interface PatientIdentityPolicy {
  canViewPatientIdentity: boolean;
}
```

When false:

- `patientName` becomes null.
- `patientCode` becomes null.
- Patient ID is omitted or null.
- Aggregate counts and money remain unchanged.
- The response includes `patientIdentityRedacted: true` where detail rows are returned.

The server performs redaction. The frontend must not receive hidden fields and then conceal them with CSS.

## 12. Error contract

```ts
export interface ReportingErrorResponse {
  error: string;
  code:
    | 'INVALID_PERIOD'
    | 'INVALID_FILTER'
    | 'INVALID_SORT'
    | 'RANGE_TOO_LARGE'
    | 'NOT_AUTHORIZED'
    | 'NOT_FOUND'
    | 'REPORT_UNAVAILABLE';
  fieldErrors?: Record<string, string>;
  recovery?: string;
}
```

Errors identify the invalid field and a recovery action. Internal SQL or schema details are never returned.

## 13. Compatibility and migration

1. Existing endpoint fields remain during consumer migration.
2. New metadata fields are additive.
3. The shared inspector is introduced beside `AdminKpiInvoiceModal` and then replaces it consumer by consumer.
4. Existing dashboard configuration rows remain valid; new workspace placement is derived from section and metric type.
5. Existing URLs without command-center query parameters continue to open Overview/Today.
6. Existing report and Commission Management routes remain available.

## 14. Observability

Each reporting request logs:

- Tenant identifier in the existing protected logging format
- Contract version
- Endpoint
- Period length
- Date basis
- Result row count
- Query duration
- Reconciliation status
- Unexplained difference when non-zero

Logs never include patient names, invoice item descriptions, phone numbers, or free-text clinical content.

## 15. Acceptance contract

A feature is not complete unless:

- Summary and full-detail totals reconcile or a visible warning explains why they cannot.
- Period and date basis are returned by the server and shown by the UI.
- Pagination preserves full-detail reconciliation totals.
- Stable IDs drive all drill filters.
- Patient identity is server-redacted without `patients:read`.
- Direct invoice URLs restore the inspector.
- Existing source-of-truth totals remain unchanged unless a separately reviewed correctness fix is required.
