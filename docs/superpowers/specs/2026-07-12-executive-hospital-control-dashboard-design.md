# Executive Hospital Control Dashboard — Expert Design Specification

**Date:** 2026-07-12  
**Audience:** Product, Engineering, QA, Hospital Admin, MD, Director  
**Status:** Approved design, implementation-ready after written-spec review  
**Primary goal:** Let an Admin, MD, or Director understand the hospital's financial, clinical-service, doctor, laboratory, commission, approval, and stock position from one dashboard without navigating through many modules.

## 1. Product outcome

The dashboard will become an executive control surface, not a collection of unrelated KPI cards. It must answer these questions quickly for a selected period:

1. How much money was collected?
2. What services generated the money?
3. How much was spent, and on what?
4. What is the resulting net income?
5. Which doctors generated visits and tests?
6. How much visit commission and test commission did each doctor earn?
7. Which tests were ordered, completed, cancelled, billed, collected, and still due?
8. How many CBC, RBS, Creatinine, and other tests were completed?
9. Which reagents were consumed, how much remains, and which tests are not mapped to reagents?
10. What approvals, stock risks, handovers, or operational exceptions need action?

The design must remain tenant-scoped, role-controlled, configurable, and consistent with the existing KPI summary and drilldown architecture.

## 2. Approved product decisions

### 2.1 Doctor attribution

Doctor-related laboratory analytics will expose both roles:

- **Referring Doctor:** The doctor credited for referred test business and test commission.
- **Ordering Doctor:** The doctor who placed or owned the clinical order, when available.

Executive summary tables will group test business and commission by **Referring Doctor**. Drilldown rows will show both Referring Doctor and Ordering Doctor. Ordering Doctor resolves through the persisted `lab_orders.ordered_by -> users.id -> doctors.user_id` relationship; Referring Doctor comes from persisted bill, prescription, or commission attribution. Missing values will be displayed as `Unassigned`, never silently attributed to another doctor.

Visit analytics will use this resolution order:

1. `visits.doctor_id`
2. `bills.referring_doctor_id`
3. `Unassigned Doctor`

### 2.2 No duplicate reporting tables

The implementation will reuse the existing operational facts and dimensions:

- `payments`
- `bills`
- `invoice_items`
- `visits`
- `doctors`
- `patients`
- `lab_order_items`
- `lab_test_catalog`
- `doctor_commission_accruals`
- `expenses`
- `cash_drawer_movements`
- `lab_test_consumable_map`
- `lab_consumable_movements`
- `lab_consumable_stock`
- `InventoryItem`
- `InventoryStock`
- `InventoryStockTransaction`
- `dashboard_kpi_config`

No new transaction or reporting warehouse table is required for this phase. Aggregation will be performed through server-side query helpers and dedicated analytics endpoints. A later daily summary table may be considered only if real production volume proves that indexed operational queries are insufficient.

### 2.3 Consistent analytical grain

Each analytics surface must have one defined grain:

- Collection fact: one payment allocated proportionally to invoice service lines.
- Visit fact: one distinct consultation visit or legacy consultation bill fallback.
- Test-volume fact: one lab order item.
- Commission fact: one doctor commission accrual.
- Expense fact: one paid expense or doctor payout.
- Reagent fact: one consumable movement, aggregated by reagent and unit.
- Stock fact: one inventory item/lot balance.

Facts at different grains must not be summed together inside the same measure. For example, test count and test collection are displayed together in a row but calculated from separate facts.

## 3. Research-backed design principles

The design follows these principles:

- Separate facts from dimensions and keep fact queries at a consistent grain.
- Use shared dimensions such as date, doctor, test, service, patient, and tenant for filtering and grouping.
- Keep top-level summary limited to decision-grade measures; detailed operational monitoring belongs lower in the page.
- Apply one global date range consistently to every dashboard panel.
- Use server-whitelisted metrics and panels; never allow arbitrary SQL or formulas from the UI.
- Keep laboratory reagent visibility tied to test mapping, lot, expiry, QC, usage, return, and stock balance.

Reference guidance reviewed:

- [Microsoft Learn, “Understand star schema and the importance for Power BI”](https://learn.microsoft.com/en-us/power-bi/guidance/star-schema): fact tables store events and measures, dimension tables support filtering/grouping, and fact tables should use consistent grain.
- [Grafana documentation, “Dashboard best practices”](https://grafana.com/docs/grafana/latest/visualizations/dashboards/build-dashboards/best-practices/): define a logical monitoring strategy and organize dashboards so the most important signals are easy to identify.
- [World Health Organization, “Laboratory quality management system: handbook”](https://www.who.int/publications/i/item/9789241548274): laboratory quality management requires controlled processes for inventory, reagent handling, quality control, traceability, and monitoring.
- [Bach et al., “Dashboard Design Patterns”](https://arxiv.org/abs/2205.00757): analytical dashboards should balance summary, comparison, detail, and drilldown patterns instead of presenting every measure as an isolated card.

## 4. Dashboard information architecture

The default section order will be:

1. Global controls and data freshness
2. Executive financial overview
3. Doctor-wise visit and test performance
4. Test-wise laboratory performance
5. Income source analysis
6. Expense source analysis
7. Cash control and handover
8. Pending approvals and exceptions
9. General inventory control
10. Laboratory reagent control
11. Radiology/X-ray stock control

Inventory, reagent, and radiology sections will stay at the bottom by default. They remain configurable and can be moved or disabled by authorized users.

## 5. Global controls

The same period filter must drive every KPI and table.

### Presets

- Today
- Yesterday
- This Week
- This Month
- Last Month
- Last 7 Days
- Last 30 Days
- Custom Start Date → End Date

### Additional controls

- Doctor filter
- Test search/filter
- Service filter
- Status filter where relevant
- Refresh button
- Last refreshed timestamp

Changing the global range must invalidate and refetch all enabled executive widgets using the same `startDate` and `endDate` contract.

## 6. Executive financial overview

Default KPI cards:

1. **Total Collection**
2. **Total Expense**
3. **Net Income**
4. **Lab Income**
5. **Other Service Income**
6. **Visit Commission**
7. **Test Commission**
8. **Total Doctor Commission**
9. **Pending Approvals**

`Total Visits` remains available in configuration but is disabled by default because the doctor-performance panel provides better context.

### 6.1 Total Collection

Formula:

```text
Billing/current collection
+ due collection
+ patient deposits received
```

The existing management collection helper remains the source of truth.

### 6.2 Total Expense

Formula:

```text
Paid operating expenses
+ doctor payout/settlement amounts
```

Approved but unpaid expense requests are excluded. Refunds remain separate from expense so they are not double-counted.

### 6.3 Net Income

Business formula approved by the user:

```text
Total Collection - Total Expense
```

### 6.4 Lab Income

Paid collection allocated proportionally to laboratory invoice lines.

### 6.5 Other Service Income

All non-laboratory paid collection, grouped by exact service name in the drilldown. The user-facing dashboard must not stop at coarse labels such as OPD or IPD.

Examples:

- Doctor Consultation
- Admission Fee
- Bed Charge
- ICU Charge
- OT/Procedure
- X-Ray Chest
- Ultrasonography
- Medicine
- Ambulance
- Nursing Service
- Registration Fee

Internal source categories may still be retained for accounting and filtering.

## 7. Commission model

Commission is calculated from `doctor_commission_accruals` and split by `source_type`.

### 7.1 Visit Commission

```text
source_type = 'consultation_fee'
```

### 7.2 Test Commission

```text
source_type IN ('lab_test', 'referral')
```

This preserves the existing hospital contract where test/referral commission is treated as test commission.

### 7.3 Other Doctor Commission

```text
source_type IN ('procedure', 'ipd_round')
```

It is visible in total commission breakdown and can be enabled as a separate card, but is disabled by default.

### 7.4 Total Doctor Commission

```text
Visit Commission
+ Test Commission
+ Other Doctor Commission
```

Doctor payout is an expense/payment event and must not be added to accrued commission or subtracted twice.

## 8. Doctor-wise visit and test performance panel

This is a dedicated analytics table, not a generic KPI drawer.

### Default columns

| Doctor | Visits | Visit Collection | Visit Commission | Tests | Test Collection | Test Commission | Other Commission | Total Commission |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

### Behavior

- Sort by total collection, total commission, visits, or tests.
- Search by doctor name.
- Click a doctor to open a dedicated drawer.
- The drawer has separate tabs: `Visits`, `Tests`, `Commissions`.

### Visit drilldown columns

- Visit date/time
- Patient
- Invoice
- Visit/consultation service
- Billed amount
- Collected amount
- Due
- Visit commission
- Status

### Test drilldown columns

- Test date/time
- Patient
- Test name
- Referring Doctor
- Ordering Doctor
- Invoice/accession
- Test status
- Billed amount
- Collected amount
- Due
- Test commission

### Commission drilldown columns

- Accrual date
- Commission type
- Patient
- Invoice
- Gross basis
- Commission amount
- Paid amount
- Balance
- Status

## 9. Test-wise laboratory performance panel

This panel must make questions such as “How many CBC tests were completed this month?” answerable immediately.

### Default columns

| Test | Ordered | Completed | Cancelled | Pending | Billed | Collected | Due | Test Commission |
|---|---:|---:|---:|---:|---:|---:|---:|---:|

### Counting definitions

- **Ordered:** one active `lab_order_items` row whose parent `lab_orders` order/creation date falls in the selected period.
- **Completed:** status/result status in `completed`, `resulted`, `verified`, or `final`, using completion/verification date.
- **Cancelled:** cancelled status in the selected period.
- **Pending:** active ordered items not yet completed or cancelled.

The primary headline count for a test is **Completed**.

### Financial definitions

- **Billed:** active test invoice-line amount linked by `invoice_items.reference_id = lab_order_items.id` and `item_category = 'test'`.
- **Collected:** payments proportionally allocated to the test line.
- **Due:** billed amount minus allocated collected amount, clamped at zero at row level.
- **Test Commission:** matching test/referral commission accruals.

### Search and drilldown

- Search accepts persisted catalog code, order-item snapshot name, or catalog name. Searching `CBC` matches the catalog code directly.
- Default sorting is completed count descending.
- Click a test to open patient/invoice/order details.
- Test detail shows Referring Doctor and Ordering Doctor separately.

### Paid versus performed distinction

The UI must explain that:

- A completed but unpaid test increases `Completed` but not `Collected`.
- A paid test not yet completed increases `Collected` but not `Completed`.

This prevents operational volume and revenue from being confused.

## 10. Income source analysis

A compact service-level table will replace coarse OPD/IPD presentation.

### Columns

| Service | Category | Transactions | Units | Collection | Share |
|---|---|---:|---:|---:|---:|

### Rules

- Exact service name is the primary row label.
- Category is secondary context only.
- Mixed invoices use proportional payment allocation by active invoice-line value.
- Legacy bills without item rows use existing bill-level fallback categories.
- Deposit remains a separate collection source and is not assigned to a clinical service.

`Other Service Income` opens this table filtered to non-laboratory services.

## 11. Expense source analysis

### Columns

| Expense Category | Transactions | Paid Amount | Payment Method | Approval/Payment Status |
|---|---:|---:|---|---|

### Sources

- Paid rows from `expenses`
- Doctor payouts/settlements from `cash_drawer_movements`

### Drilldown

- Expense date
- Category
- Description
- Amount
- Payment method
- Created by
- Approval status
- Payment status
- Evidence/reference

The dashboard must not treat a pending approval as a paid expense.

## 12. Cash control

Keep cash control separate from management income.

Default cards:

- Physical Cash In
- Physical Cash Out
- Net Cash Movement
- Available Drawer Cash
- Pending Handover

Bank/mobile payments affect collection and income but not physical drawer cash. Cash handover and cash drop change custody, not expense.

## 13. Pending approvals and exceptions

The existing combined approval sources remain:

- General approval requests
- Expense approvals
- Final cash-handover approvals

The exception center should prioritize:

- Unmapped laboratory tests
- Missing reagent consumption
- Reagent QC failure/quarantine
- Low/out-of-stock reagent
- Expired or near-expiry lots
- Outstanding patient due
- Pending handover
- Missing expense evidence

## 14. Laboratory reagent control

The laboratory section reuses existing test-to-consumable mappings and movement tables.

### Default summary cards

- Tests Completed
- Reagent Types Used
- Available Reagent SKUs
- Low-stock Reagents
- Out-of-stock Reagents
- Reagent Lots Near Expiry
- Reagent QC Exceptions
- Unmapped Completed Tests
- Consumption Exceptions

### Reagent usage table

| Reagent | Unit | Opening/Stock In | Used | Returned | Net Used | Current Stock | Reorder Level | Status |
|---|---|---:|---:|---:|---:|---:|---:|---|

### Important unit rule

Quantities with different units must never be summed into one number. `5 tests + 3 ml` is not `8 units`.

- `Reagent Types Used` is a distinct SKU count.
- Exact quantity used is displayed by reagent and unit in the table.
- The panel header shows separate unit totals such as `125 test` and `300 ml`; it never combines them into one scalar KPI.

### Test-to-reagent reconciliation

For mapped tests:

```text
Expected consumption = completed test count × qty_per_test
Actual consumption = usage_out - returns
Variance = actual consumption - expected consumption
```

The dashboard must show:

- Missing mappings
- Missing consumption
- Over-consumption
- Returned/reversed consumption
- Stock shortage exceptions
- QC-blocked lots

A completed test with no active reagent mapping must be shown as an exception, not silently ignored.

## 15. Inventory and radiology placement

General inventory and radiology remain available but are placed below executive, doctor, test, income, expense, cash, and approval sections.

They retain:

- Active stock SKUs
- Low stock
- Out of stock
- Expiry
- Pending purchase requests
- Radiology exams completed
- Radiology consumables issued
- Radiology stock health

## 16. Configurable control-panel model

All scalar cards and analytics panels will be registered in a server whitelist.

### New metric/widget keys

- `visit_commission`
- `test_commission`
- `other_doctor_commission`
- `doctor_performance_table`
- `test_volume_table`
- `income_service_breakdown`
- `expense_source_breakdown`
- `reagent_reconciliation_table`
- `unmapped_lab_tests`
- `consumption_exceptions`

### Configuration capabilities

Authorized Admin/MD/Director users can:

- Enable/disable sections
- Enable/disable individual cards and panels
- Reorder cards and panels
- Rename display labels

They cannot edit formulas, SQL, tenant filters, or source mappings.

The existing `dashboard_kpi_config` table remains the persistence layer. Section master switches are implemented by toggling child widgets. No schema migration is expected unless implementation discovers a requirement that cannot be expressed by the existing fields.

## 17. API architecture

### Existing endpoints retained

```text
GET /api/dashboard/kpi-config
PUT /api/dashboard/kpi-config
GET /api/dashboard/kpi-summary
GET /api/dashboard/kpi-breakdown
```

### New analytics endpoints

```text
GET /api/dashboard/doctor-performance
GET /api/dashboard/test-performance
GET /api/dashboard/income-services
GET /api/dashboard/expense-analysis
GET /api/dashboard/reagent-reconciliation
```

### Shared query parameters

```text
startDate
endDate
doctorId
testId
search
status
page
pageSize
sortBy
sortDirection
```

### Example doctor-performance response

```json
{
  "period": { "startDate": "2026-07-01", "endDate": "2026-07-31", "label": "July 2026" },
  "totals": {
    "visits": 0,
    "visitCollection": 0,
    "visitCommission": 0,
    "tests": 0,
    "testCollection": 0,
    "testCommission": 0,
    "otherCommission": 0,
    "totalCommission": 0
  },
  "rows": [],
  "page": 1,
  "pageSize": 25,
  "totalRows": 0
}
```

All endpoints must enforce tenant scope and existing executive dashboard role permissions.

## 18. Backend module boundaries

The existing large dashboard route should not absorb every new SQL block directly.

Recommended modules:

- `src/lib/executive-doctor-analytics.ts`
- `src/lib/executive-test-analytics.ts`
- `src/lib/executive-income-analytics.ts`
- `src/lib/executive-expense-analytics.ts`
- `src/lib/executive-reagent-analytics.ts`

Each module must expose:

- Summary query/helper
- Paginated detail query/helper
- Stable response mapper
- Testable SQL builder where schema compatibility matters

Card totals and detailed panels must call the same helper or share the same SQL contract.

## 19. Frontend component boundaries

Recommended components:

- `ExecutiveDashboardRangeFilter`
- `ExecutiveFinancialOverview`
- `DoctorPerformancePanel`
- `DoctorPerformanceDrawer`
- `TestPerformancePanel`
- `TestPerformanceDrawer`
- `IncomeServicePanel`
- `ExpenseAnalysisPanel`
- `ReagentReconciliationPanel`

The generic `KpiBreakdownDrawer` remains for scalar financial, cash, approval, and stock metrics. Doctor and test analytics use specialized drawers because their columns and tabs are multidimensional.

Admin, MD, and Director dashboards must reuse the same executive components and data hooks. Role-specific pages may add role-specific operational panels below, but must not duplicate executive formulas.

## 20. Performance and reliability

- KPI summary remains one compact request for enabled scalar metrics.
- Heavy analytics panels load their first page after scalar KPIs.
- Disabled panels do not execute backend queries.
- Drilldown details load only when opened.
- Default page size is 25; supported sizes are 25, 50, and 100.
- Search is server-side and debounced.
- Summary refresh interval is 60 seconds.
- Transaction details are not prefetched for every row.
- Queries must use tenant/date/status indexes already available where possible.
- Real SQLite schema tests must validate SQL builders; mocks alone are insufficient.

If a specialized optional table is unavailable, only the affected panel shows an error/empty-state warning. Finance and other domains must remain available.

## 21. Security and privacy

- Tenant ID comes only from authenticated context.
- No endpoint accepts tenant ID from the client.
- Only permitted executive roles can access the analytics endpoints.
- Patient details appear only in drilldown, not top-level summaries.
- Exported/PDF analytics must preserve existing escaping and access controls.
- No arbitrary formula, SQL, or unsafe field selection is stored in dashboard configuration.

## 22. Testing strategy

### Backend unit/integration cases

- Mixed visit and test invoice proportional allocation
- Legacy bill with no invoice-item rows
- Same doctor with visit and test commissions
- Visit commission excludes lab commission
- Test commission excludes consultation commission
- Total commission equals visit + test + other commission
- Referring and ordering doctor differ
- Missing doctor resolves to Unassigned
- Completed but unpaid CBC
- Paid but incomplete CBC
- Cancelled test
- Duplicate or cancelled lab order item exclusion
- Date-range boundary in Bangladesh local date
- Reagent usage and return reversal
- Mixed reagent units
- Missing test-to-reagent mapping
- Optional lab table failure isolation
- Tenant isolation
- Card total equals panel/drilldown total
- Disabled panel does not execute domain SQL

### Frontend cases

- Global range propagates to all enabled panels
- CBC search returns CBC row
- Doctor row opens visit/test/commission tabs
- Referring and ordering doctor are both visible
- Visit and test commission cards are separate
- Total Visits is disabled by default but configurable
- Inventory/reagent/radiology render below executive analytics
- Section and widget on/off/reorder/rename work
- Empty, loading, error, and partial-data states
- Responsive layout and accessible table/drawer controls

### Acceptance examples

1. For July 2026, searching `CBC` shows completed count, collection, due, and commission.
2. A doctor with 10 visits and 15 referred tests shows separate visit/test values.
3. Visit commission and test commission never appear mixed in either card or doctor row.
4. Other Service Income opens exact services, not only OPD/IPD labels.
5. Reagent usage shows exact quantity and unit by reagent.
6. A mapped CBC count can be reconciled against expected and actual CBC reagent usage.
7. An Admin can hide inventory sections while retaining doctor/test analytics.

## 23. Rollout sequence

### Phase 1 — Contracts and backend analytics

- Lock status, attribution, commission, and date rules with failing tests.
- Add commission split metrics.
- Add doctor-performance and test-performance helpers/endpoints.
- Add service-level income and expense analytics.

### Phase 2 — Executive frontend

- Add shared global range filter.
- Update management cards and ordering.
- Add doctor and test panels/drawers.
- Add income and expense analysis panels.

### Phase 3 — Reagent reconciliation

- Add expected versus actual consumption.
- Add unmapped/missing/variance exceptions.
- Add quantity-by-unit presentation.

### Phase 4 — Configuration and release hardening

- Register new panels/metrics in the whitelist.
- Update configurator and defaults.
- Run full backend, integration, web, typecheck, build, and production rendering tests.
- Perform adversarial review for double-counting, tenant leakage, date boundaries, and mixed units.

## 24. Out of scope for this phase

- Building a separate data warehouse
- Predictive forecasting or AI recommendations
- Changing clinical workflows
- Replacing the detailed Laboratory, Accounting, or Inventory modules
- Arbitrary user-created formulas or SQL
- New mobile-native dashboard

## 25. Definition of done

The feature is complete only when:

- Admin, MD, and Director use the same executive data contracts.
- Total Collection, Expense, and Net Income reconcile with their drilldowns.
- Visit and test commissions are separate and total correctly.
- Doctor-wise visits/tests/collections/commissions are visible from the dashboard.
- Test-wise completed counts such as CBC are searchable by any selected date range.
- Other Service Income shows exact service reasons.
- Expense analysis shows exact categories and paid amounts.
- Reagent usage, stock, mapping, and variance are visible at the bottom of the dashboard.
- All panels remain tenant-scoped, configurable, paginated, and tested.
- Full regression, TypeScript, and production build gates pass.
