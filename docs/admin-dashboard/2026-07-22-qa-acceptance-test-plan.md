# Admin Dashboard Control Center — QA and Acceptance Test Plan

**Date:** 2026-07-22
**Status:** Planned
**Testing model:** TDD + golden reconciliation fixtures + API/UI/E2E gates

## 1. Quality objective

Prove that the dashboard is semantically correct, source-complete, reconciled, permission-safe, accessible, responsive, and performant. Visual plausibility is not evidence of correctness.

## 2. Test layers

1. Semantic utility unit tests
2. Domain provider unit/integration tests
3. Overview API integration tests
4. Detail/reconciliation API integration tests
5. Frontend component tests
6. Dashboard integration tests
7. End-to-end workflows
8. Accessibility checks
9. Performance and payload checks
10. Shadow/parity observation

## 3. Golden fixture dataset

Create deterministic tenant fixtures that cover:

### Billing and collection

- OPD bill paid in full on billing date
- Lab bill partially paid
- IPD bill with deposit applied
- Prior-period bill paid in current period
- Mixed-service bill
- Discounted bill with valid reference
- Discounted bill with missing reference
- Cancelled bill
- Refunded bill
- Cash and non-cash split payments
- Blank/unknown payment method
- Unmapped service category

### Deposit

- New deposit received
- Deposit applied to bill
- Partial deposit refund
- Remaining deposit liability
- Deposit received before invoice creation

### Expense and payout

- Approved cash expense with receipt
- Approved non-cash expense
- Missing expense receipt
- Pending/unexecuted expense
- Doctor payout paid in cash
- Doctor payout paid non-cash

### Cash custody

- Active counter with expected cash
- Cash drop
- Exact handover
- Pending/stale handover
- Closed drawer with zero variance
- Closed drawer with short variance
- Closed drawer with excess variance

### Commission

- Earned commission
- Doctor waiver
- Payable commission
- Partial settlement
- Paid commission
- Outstanding commission
- No-rule/held/cancelled case

### Operations

- OPD registration/consultation flow
- Diagnostic ordered/completed backlog
- Admission/discharge
- Current occupied/available beds
- Pending discharge settlement

### Domain health

- Low stock
- Stock-out
- Expiring item
- QC block
- Unmapped lab test
- Reagent consumption variance

### Security

- User with summary-only permission
- User with patient-detail permission
- User with commission-detail permission
- User without audit permission
- Cross-tenant record attempt

## 4. Semantic utility tests

### Date normalization

- Today in Asia/Dhaka
- Yesterday across month/year boundary
- This week starts Monday as defined
- This month and last month boundaries
- Leap year custom range
- Invalid date
- start > end
- maximum range exceeded

### Previous-period comparison

- One-day range compares with previous day
- Seven-day range compares with previous seven days
- Month range compares with previous equal/defined month
- Zero comparison denominator returns null percentage
- Negative and positive change
- Target-range interpretation

### Temporal modes

- Period metric echoes start/end
- As-of metric uses end date
- Live metric ignores historical dates and declares current time
- Live metric cannot be presented as period metric

### Source status

- Complete zero
- Complete non-zero
- Optional source failure → partial
- Required source failure → unavailable/null
- Stale threshold exceeded
- Partial cannot be healthy

### Reconciliation

- Exact balance
- Positive difference
- Negative difference
- Explicit rounding adjustment
- Current page does not determine detail total

## 5. Metric registry tests

- Every registry key is unique.
- Frontend and backend registry keys match.
- Every metric defines value type, temporal mode, date basis, source, formula, direction, permission, section, and drill target.
- Ambiguous fallback labels are rejected by a test allowlist.
- No `uncategorized_income` appears as a healthy primary category.
- Role presets reference only valid metrics.
- Hospital Admin preset has no more than 10 primary cards.
- Live metrics are not included in period-only aggregate groups.

## 6. Overview API integration tests

### Request validation

- Valid preset
- Valid custom range
- Invalid dates
- Unsupported date basis
- Unauthorized role
- Missing tenant

### Response contract

- report key/version
- generatedAt
- timezone
- echoed normalized filters
- comparison period
- aggregate health
- primary metrics
- permissions
- no detail rows in overview

### Complete/partial behavior

- All providers success → healthy/balanced
- Optional provider failure → partial with usable unaffected domains
- Required financial provider failure → affected metric null/unavailable
- Stale live provider → stale badge
- Reconciliation failure → unreconciled health and warning

### Tenant and permissions

- Tenant A cannot read Tenant B
- Summary-only user receives no patient identifiers
- Commission details omitted without permission
- Audit events omitted/masked without permission
- Feature flag does not bypass permission checks

## 7. Financial reconciliation tests

For every golden fixture, assert:

- gross billed,
- discount,
- net billed,
- new due,
- collection against current-period bills,
- prior-period due collection,
- deposit received,
- deposit applied,
- refund,
- cash expense,
- doctor payout,
- net cash movement,
- expected drawer cash,
- handover/drop,
- counted cash,
- variance.

Mandatory invariant:

```text
summary total = complete detail total + unexplained difference
```

Also assert:

- screen contract and export contract use identical totals,
- unknown method/unmapped service amounts are preserved in warnings,
- mirrored provider records are not double-counted,
- deposits are not counted as operating revenue,
- prior-period due collection is not presented as current-period billing.

## 8. Action Center tests

- Every dashboard action has a backend rule key.
- Severity is server-owned.
- Normal approved expense does not create an exception.
- Missing expense evidence creates an exception.
- Unknown payment method creates an exception.
- Unmapped service creates an exception.
- Reconciliation mismatch creates or links an exception.
- Age/SLA sorting works.
- Manage versus review-only capability is displayed correctly.
- Filtered target route reproduces only matching items.
- Duplicate frontend `riskRows()` surface is absent.

## 9. Trend and payment tests

### Trend

- Uses selected range
- Correct granularity
- Correct explicit measure label
- Exact values equal server response
- Comparison matches overview metric
- One to three points use stat fallback
- Four or more points use line visualization
- Table alternative contains all points

### Payment mix

- Uses selected period
- Total equals server total
- Percentages sum within rounding policy
- Cash/digital/card/bank/cheque normalized
- Unknown method warning is visible
- Zero total handles percentages safely

## 10. Operations tests

- Period funnel stages use compatible definitions.
- Stage counts follow selected range.
- Current capacity remains visibly live/as-of during historical selection.
- Occupancy target-range interpretation works.
- No invalid conversion rate is displayed when source status is partial.
- Domain health cards link to correctly filtered workspaces.

## 11. Audit tests

- Bill amount change produces business narrative and material severity.
- Discount override includes reference/context.
- Cancellation/refund links to correct record.
- Expense/payout event has correct amount and actor.
- Cash variance is high/critical according to policy.
- Permission change and sensitive export are included.
- Generic low-risk CRUD activity is excluded from dashboard feed.
- Frontend does not infer severity from CRUD verb.
- Patient/financial values are masked according to permission.

## 12. Frontend state tests

For every primary component:

- skeleton/loading
- verified zero
- non-zero
- empty/not applicable
- partial
- stale
- unavailable
- unreconciled
- retry

Specific regression:

- Cash-control request failure must not display handover/pending/variance as verified zero.
- Live widget must show `Live` during historical range.
- Server generatedAt must be displayed instead of client-only refresh time.

## 13. Drillthrough tests

- KPI card opens matching metric preview.
- Source group opens only matching source rows.
- Invoice action opens matching invoice.
- Doctor row preserves doctor/date filters.
- Test row preserves test/date filters.
- Financial reconciliation row opens correct report/action.
- Browser refresh reproduces state.
- Browser back restores filters and selection.
- Copied URL is reproducible for authorized user.
- Unauthorized user is denied or sees masked fields.
- Top counter/user aggregate represents full filtered result or is labeled page-local.

## 14. Accessibility tests

### Automated and component checks

- axe or equivalent where available
- unique labels and IDs
- valid dialog semantics
- accessible names for icon buttons
- table headers
- status text in addition to color

### Keyboard script

1. Tab to date preset.
2. Change period.
3. Reach data-health disclosure.
4. Open KPI.
5. Navigate source and detail table.
6. Open full workspace link.
7. Close drawer with Escape.
8. Verify focus returns to trigger.
9. Navigate chart data table.
10. Open Action Center item.

### Screen-reader expectations

- Page title and reporting context announced.
- KPI announces label, value, comparison, temporal mode, and health.
- Trend has a concise text summary.
- Loading and error status uses appropriate live regions without repeated noise.

### Responsive checks

Viewports:

- 375 px
- 768 px
- 1024 px
- 1440 px

No page-level horizontal overflow. Critical data remains readable without hover.

## 15. Performance tests

### Static/request budget

- Count default above-fold API requests.
- Assert optional panels are not requested before enabled/visible.
- Measure uncompressed response size.
- Verify no detail rows in overview.

### Integration timing

Record provider and total route duration for:

- empty tenant,
- typical tenant,
- high-volume fixture,
- 30-day range,
- 366-day maximum range.

### Query review

- `EXPLAIN QUERY PLAN` for high-volume D1 queries where practical
- tenant/date indexes used
- no unbounded full scan
- no query inside row loop
- bounded provider concurrency

### Browser performance

- stable layout during load
- optional below-fold lazy loading
- no unnecessary chart animation
- no repeated polling of hidden sections

Performance targets are validated against the project environment; regressions require documented approval rather than silent acceptance.

## 16. Security tests

- tenant isolation
- role/permission matrix
- field masking
- export permission
- Action Center mutation permission
- sensitive detail audit event
- query parameter tampering
- invalid metric/source key
- pagination and sort allowlists
- error messages contain no PHI
- observability payload contains no PHI

## 17. Compatibility tests

- Existing legacy KPI endpoints continue during flagged migration.
- Admin dashboard old path works when feature flag is off.
- MD/director dashboards remain functional.
- Existing tenant KPI configuration remains readable.
- Reset-to-preset does not silently overwrite customization.
- English and Bangla labels preserve equivalent meanings.

## 18. Suggested verification commands

Use targeted commands while developing, then the full relevant gate:

```bash
pnpm exec vitest run test/unit/admin-dashboard-semantics.test.ts
pnpm exec vitest run test/integration/routes/admin-dashboard-overview.test.ts
pnpm exec vitest run test/integration/routes/admin-dashboard-reconciliation.test.ts
pnpm --filter web exec vitest run src/pages/admin src/components/dashboard
pnpm exec tsc --noEmit
pnpm --filter web build
```

When E2E fixtures and environment are available:

```bash
BASE_URL=http://localhost:${HMS_API_PORT:-8788} playwright test test/e2e/admin-dashboard-control-center.spec.ts --project=e2e
```

Production E2E is not run without explicit authorization and the existing production safety gates.

## 19. Release gate matrix

| Gate | Required result |
|---|---|
| Semantic registry | All required fields; no ambiguous primary labels |
| Unit tests | Pass |
| API integration | Pass |
| Reconciliation fixtures | Zero unexplained difference except explicit exception cases |
| UI component tests | Pass |
| TypeScript | Pass |
| Web build | Pass |
| Accessibility | No critical violations; keyboard script passes |
| Responsive | No page-level overflow at required viewports |
| Security | Tenant/permission/masking tests pass |
| Performance | Request/payload/query budgets pass or approved exception exists |
| Shadow parity | No material unexplained difference |
| Pilot observation | No unresolved critical data-health issue |

## 20. Definition of done

A task is not complete because a card renders or a test of one total passes. Completion requires:

- semantic definition,
- correct source and period,
- complete/partial state,
- reconciliation where financial,
- permission enforcement,
- keyboard/responsive behavior,
- targeted tests,
- no regression in current consumers,
- verified commands and evidence recorded.
