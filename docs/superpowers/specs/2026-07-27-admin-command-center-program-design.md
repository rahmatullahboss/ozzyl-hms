# Admin Command Center Program Design

Date: 2026-07-27
Status: Approved program design
Base: local `main` at `a4a4c47ac99412a50a6b07bc00765e67f1fd41e2`

## 1. Purpose

Transform the hospital-admin dashboard from one long collection of KPI cards and operational widgets into a modular command center that explains money, doctor activity, patient demand, invoices, and management exceptions through consistent drill paths.

This design extends the current dashboard implementation. It does not replace the existing operational ledgers, billing routes, doctor-performance APIs, test-performance APIs, or Action Center.

### Relationship to the 2026-07-22 dashboard pack

The documentation under `docs/admin-dashboard/` remains the research, product-requirement, temporal-semantics, source-health, comparison, role-preset, feature-flag, and QA baseline. This 2026-07-27 pack is the latest-main execution authority and supersedes the older implementation sequence because current `main` now contains richer doctor/test/commission features and requires a more explicit workspace, invoice-inspector, and patient-age decomposition.

The following 2026-07-22 requirements are carried forward without weakening:

- `0`, unavailable, stale, partial, and unreconciled are distinct states.
- Every metric declares temporal mode and date basis.
- Role presets limit the default Overview to ten or fewer primary KPIs.
- Comparisons show absolute and percentage variance with metric-specific desirable direction.
- Source completeness and generated timestamp are visible.
- Migration is additive and feature-flagged until parity is proven.
- Dense analysis belongs in dedicated workspaces.

## 2. User outcomes

A hospital administrator must be able to:

1. Select a reporting period once and know which panels follow it.
2. Distinguish selected-period reporting from live/current operational status.
3. Separate business performance, collections, deposits, physical cash, expenses, and doctor liabilities.
4. Open the detail rows behind every financial total.
5. Select a doctor and understand visits, referred tests, performed tests, collections, discounts, earned commission, waiver, payable, paid, and outstanding.
6. Open the invoice behind a visit, test, payment, due, discount, or commission row.
7. Review invoice items, settlements, discounts, doctor compensation, and audit history in one inspector.
8. Review service demand by patient age at the time of service.
9. Open the existing Action Center for decisions and follow-ups instead of using duplicate dashboard queues.

## 3. Non-goals

The first program does not include:

- A new accounting ledger
- A data warehouse
- AI-generated financial advice
- Forecasting or anomaly prediction
- Cross-hospital benchmarking
- Arbitrary user-built formulas
- Production mutation from dashboard drilldowns
- Replacing the existing Action Center workflow
- Replacing Commission Management settlement workflows

## 4. Existing capabilities to preserve

The implementation must preserve and reuse:

- `ExecutiveDashboardRangeFilter`
- `useExecutiveDashboardKpis`
- `useExecutiveDashboardAnalytics`
- `KpiBreakdownDrawer`
- `DoctorPerformancePanel`
- `DoctorPerformanceDrawer`
- `TestPerformancePanel`
- `TestPerformanceDrawer`
- `IncomeServicePanel`
- `ExpenseAnalysisPanel`
- `ReagentReconciliationPanel`
- `IPDBillingOverview`
- `AdminKpiInvoiceModal` behavior until the shared inspector replaces it
- `/api/dashboard/kpi-summary`
- `/api/dashboard/kpi-breakdown`
- Existing doctor/test/income/expense/reagent dashboard endpoints
- `/api/action-center/summary`
- `/api/billing/:billId`
- Existing role and permission middleware

## 5. Information architecture

### 5.1 Route

The existing route remains:

```text
/h/:slug/dashboard
```

The active workspace and drill context are represented by query parameters:

```text
/h/:slug/dashboard?tab=overview&range=this_month&from=2026-07-01&to=2026-07-27
/h/:slug/dashboard?tab=doctors&doctorId=17&range=7d&from=2026-07-21&to=2026-07-27
/h/:slug/dashboard?tab=money&invoiceId=91&dateBasis=payment_date
```

### 5.2 Top-level workspaces

| Workspace | Primary purpose |
|---|---|
| Overview | Critical status, compact financial picture, Action Center summary, recent activity |
| Money | Business performance, collections, deposits, cash custody, expenses, doctor liabilities |
| Doctors | Doctor performance, visits, referred/performed tests, compensation, activity timeline |
| Patients | Age groups, gender/service aggregates, repeat demand, permitted patient detail |
| IPD | Admission-linked charges, final bills, payments, deposits, dues, discharge settlement |
| Diagnostics | Test performance, lab income, referring/performing roles, reagent reconciliation |
| Inventory | Stock availability, expiry, reorder, purchase requests, consumption exceptions |
| Audit | Financial reconciliation warnings, invoice audit events, staff activity, export history |

### 5.3 Overview limits

The Overview must show no more than ten primary KPI cards. Default primary cards:

1. Total collection
2. Total expense
3. Net operating result
4. Outstanding patient due
5. Doctor payable outstanding
6. Available drawer cash
7. Pending approvals
8. Cash discrepancy count
9. Today/current admitted patients when the selected range is today
10. Critical inventory exceptions

Secondary service totals belong in Money or Diagnostics, not the Overview.

## 6. Period and live-state model

### 6.1 Shared period

The shared period contains:

```ts
export type DashboardRange =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | '7d'
  | '30d'
  | 'custom';

export interface CommandCenterPeriod {
  range: DashboardRange;
  startDate: string;
  endDate: string;
}
```

### 6.2 Per-panel date basis

One date basis cannot be applied to every metric. Each response must declare one of:

```ts
export type ReportingDateBasis =
  | 'service_date'
  | 'bill_date'
  | 'payment_date'
  | 'business_date'
  | 'commission_accrual_date'
  | 'commission_settlement_date'
  | 'current_state';
```

Examples:

- Visit/test activity: `service_date`
- Invoice creation/gross billing: `bill_date`
- Collection/payment method: `payment_date`
- Doctor earned/payable commission: `commission_accrual_date`
- Doctor paid commission: `commission_settlement_date`
- Drawer balance/current admissions/stock on hand: `current_state`

Every panel header displays its basis. `current_state` panels display a Live badge and do not imply that their value belongs to a historical selected range.

### 6.3 URL ownership

The command-center shell owns these query keys:

- `tab`
- `range`
- `from`
- `to`
- `dateBasis`
- `doctorId`
- `testId`
- `invoiceId`

Unknown query keys are preserved so linked report pages can add their own filters.

## 7. Financial semantics

The Money workspace contains four independent control blocks.

### 7.1 Business performance

```text
Recognized/posted income
− operating expense
− executed doctor payout expense when recognized by accounting policy
= operating result
```

It must not include patient deposits as income or drawer balances as revenue.

### 7.2 Collection flow

```text
Current-period invoice collections
+ prior-due collections received in the period
+ other valid receipts
= total collection received
```

Deposit receipts are shown separately because they may represent patient advance liability.

### 7.3 Cash custody

```text
Opening drawer cash
+ physical cash received
− physical cash paid out
− accepted handovers/transfers
= available drawer cash
```

Non-cash collections do not increase physical drawer cash.

### 7.4 Doctor liability

```text
Earned commission
− doctor waiver
± immutable adjustments/reversals
= payable commission
− settled/paid commission
= outstanding commission
```

Performer reserve is displayed separately and must not be silently merged into referrer commission.

## 8. Reconciliation contract

Every financial summary response includes:

```ts
export interface ReconciliationEnvelope {
  summaryTotal: number;
  detailTotal: number;
  unexplainedDifference: number;
  rowCount: number;
  detailGrain: string;
  dateBasis: ReportingDateBasis;
  currencyCode: 'BDT';
  moneyUnit: 'major';
  status: 'reconciled' | 'warning' | 'unavailable';
  warnings: string[];
}
```

Rules:

- `unexplainedDifference = round(summaryTotal - detailTotal, 2)`.
- `reconciled` requires an absolute difference below 0.01.
- Pagination never changes `detailTotal`; it represents all matching rows.
- A response that cannot compute full-detail reconciliation uses `unavailable`, not zero.
- The UI never hides a non-zero unexplained difference.

## 9. Doctor workspace

### 9.1 Summary row

The existing `DoctorPerformanceRow` remains the base. The visible desktop summary prioritizes:

- Doctor
- Visits
- Referred tests
- Performed tests
- Visit collection
- Test collection
- Earned
- Waiver
- Payable
- Paid
- Outstanding
- Last activity

Less common measures move into an expandable row or drawer summary.

### 9.2 Detail navigation

A selected doctor supports:

- Summary
- Activity timeline
- Visits
- Referred tests
- Performed tests
- Compensation ledger

The activity timeline is an ordered read model over existing source rows. It does not create new events.

### 9.3 Compensation explanation

Every compensation row supports:

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

export interface CommissionExplanation {
  ruleId: number | null;
  ruleVersion: string | null;
  rateLabel: string | null;
  grossAmount: number;
  discountAmount: number;
  performerReserveAmount: number;
  commissionBaseAmount: number;
  earnedAmount: number;
  waiverAmount: number;
  adjustmentAmount: number;
  payableAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  reasonCode: CommissionReasonCode;
  reasonLabel: string;
}
```

Historical rows use stored snapshots where available. The reporting layer must not recalculate old compensation using a current rule.

## 10. Invoice inspector

### 10.1 Shared component

Create a shared `InvoiceInspector` used by dashboard, doctor, test, IPD, due, discount, collection, and commission surfaces.

Supported tabs:

- Summary
- Items & tests
- Payments & deposits
- Discount & referral
- Doctor compensation
- Audit timeline

### 10.2 URL behavior

Opening an invoice writes `invoiceId=<billId>` to the current URL. Closing removes it while preserving the selected workspace, period, and other filters.

Direct navigation to a URL containing `invoiceId` opens the inspector after authorization.

### 10.3 Read-only behavior

The inspector is read-only. Existing billing, cancellation, refund, settlement, and commission management pages remain responsible for mutations.

## 11. Patient age analytics

### 11.1 Age definition

Age is calculated on the service date:

```text
ageAtService = completed years between date_of_birth and service_date
```

Patients without a valid date of birth are grouped as `unknown`, never inferred from free-text age.

### 11.2 Buckets

- 0–5
- 6–17
- 18–30
- 31–45
- 46–60
- 61+
- Unknown

### 11.3 Aggregate response

The aggregate response contains no patient name, patient code, phone, address, or medical detail. It includes:

- Unique patients
- Visits/encounters
- Admissions
- Test/service quantity
- Collection
- Average bill
- Repeat-visit rate
- Top departments
- Top doctors
- Top tests/services

### 11.4 Detail permission

Aggregate age analytics use the existing admin/report access guard. Patient-identifying detail additionally requires `patients:read`. When that permission is absent, the detail endpoint returns aggregate service rows only.

## 12. Action Center consolidation

The dashboard does not calculate a second management queue.

Overview behavior:

- Fetch `/api/action-center/summary`.
- Show compact counts for pending approvals, critical exceptions, receivable exposure, overdue tasks, and next-best action.
- Link to `/h/:slug/action` or the provided workstream route.
- Remove the local `riskRows` exception center after parity tests prove that the Action Center covers its valid cases.
- Replace `ActionRequiredPanel` with the compact Action Center summary or make it a thin consumer of the same response.

## 13. UI and responsive behavior

### 13.1 Visual style

- Data-dense enterprise healthcare dashboard
- Existing cyan/green semantic token system
- Subtle motion only
- Lucide icons
- Tabular figures for money and counts
- No color-only status communication

### 13.2 Breakpoints

- 375 px: workspace selector, stacked KPI pairs, detail cards, no forced wide tables
- 768 px: compact tables with priority columns and expandable rows
- 1,024 px: persistent workspace tabs and two-column panels
- 1,440 px: full management grid with controlled density

### 13.3 Table strategy

Large tables use:

- Priority column presets
- Column chooser on desktop
- Expandable row detail
- Sticky identity column only when the container can support it
- Server-side pagination
- Accessible sortable headers using `aria-sort`

A 1,800–3,000 px minimum table width is not an acceptable mobile strategy.

## 14. Loading, empty, and error behavior

- Each workspace has an independent loading boundary.
- Changing period preserves the shell and displays panel skeletons.
- Failed panels show cause, retry, and the selected period.
- A stale live panel displays its last refresh time.
- Empty states distinguish “no matching activity” from “data unavailable”.
- A reconciliation warning remains visible even if row loading fails.

## 15. Security and privacy

- All routes remain tenant-scoped.
- Existing admin and dashboard guards remain mandatory.
- Patient identity requires `patients:read` where introduced.
- Aggregate patient analytics contain no patient identity.
- Invoice inspector authorization uses the existing billing read authorization before returning any patient or financial details.
- Audit rows are append-only read models and do not expose secrets, tokens, or raw internal payloads.
- Exports apply the same permissions and filters as the screen.

## 16. Performance

- Overview requests only the metrics visible on Overview.
- Workspace queries are enabled only for the active workspace.
- Detail drawers and invoice inspector load on demand.
- Full-detail reconciliation is computed server-side.
- Date filters use tenant business-day boundaries in Asia/Dhaka.
- Large result sets use server pagination.
- New service modules own SQL/query construction; route handlers remain orchestration-only.

## 17. Testing strategy

### Contract tests

- Period and date-basis parsing
- Summary/detail reconciliation
- Doctor commission explanation
- Invoice inspector authorization and composition
- Age-at-service bucket boundaries
- Patient redaction
- Action Center parity

### Component tests

- URL synchronization
- Workspace navigation
- Live versus selected-period labels
- Invoice deep link open/close
- Responsive priority columns
- Keyboard navigation and focus restoration

### End-to-end tests

1. Select a custom range and open Money.
2. Drill collection → invoice → payment.
3. Select a doctor → compensation row → invoice.
4. Open a direct invoice deep link.
5. Review an age bucket without patient-detail permission.
6. Open Action Center from the Overview.

## 18. Rollout sequence

1. Shared semantic foundation, role presets, source health, comparisons, and feature flag
2. Shell and period contract
3. Financial control and Action Center consolidation
4. Doctor/commission explainability
5. Shared invoice inspector
6. Patient age analytics
7. Export, branch comparison, and advanced comparison UI after reconciliation evidence

Each phase is feature-flag-safe at the route or UI-entry level and must preserve current dashboard behavior until its replacement passes focused regression tests.

## 19. Definition of done

The program is done only when all success criteria in the current-state review are met, every financial workspace returns reconciliation metadata, every invoice-bearing row uses the shared inspector, and no dashboard section silently mixes historical and live semantics.
