# MD Dashboard KPI Correctness + Handover Action Plan

## Request

Review and fix the MD dashboard so every KPI card, drilldown drawer, and review queue item tells the same financial story. The user reported that clicking a dashboard number opens details with different totals and different calculations. They also reported that pending handover cash appears in the MD review queue but there is no direct approve / collect action from that queue.

## Screenshots / symptoms observed

1. MD dashboard card shows a number, but the detail drawer header shows a different total.
2. `Physical drawer cash movement` card and drawer are inconsistent. The card currently displays a source-specific value, while the drawer may show another total.
3. Income / expense / profit cards can be based on different endpoints than the drawer breakdown.
4. `Pending handover cash` appears as a review item, but the MD cannot directly collect / approve from the review queue.
5. On mobile, the drawer/header area is cramped, and long Bangla titles can be partially hidden behind the fixed top bar/menu region.

## Existing files involved

Frontend:

- `web/src/pages/MDDashboard.tsx`
- `web/src/pages/HospitalAdminDashboard.tsx`
- `web/src/components/dashboard/KpiBreakdownDrawer.tsx`
- `web/src/components/dashboard/KPICard.tsx`
- `web/src/pages/BillingHandoverPage.tsx`
- `web/src/App.tsx`
- `web/src/pages/MDDashboard.test.tsx`
- `web/src/pages/HospitalAdminDashboard.test.tsx`
- `web/src/pages/BillingHandoverPage.test.ts`

Backend:

- `src/routes/tenant/dashboard.ts`
- `src/routes/tenant/billingCounter.ts`
- related cash ledger / custody transfer route if used by `BillingHandoverPage`

Existing plan to extend:

- `docs/superpowers/plans/2026-06-24-next-level-admin-md-dashboard.md`

## Root causes found

### 1. KPI cards and drawer totals are not using one canonical data contract

`MDDashboard.tsx` fetches multiple endpoints:

- `/api/dashboard/daily-income`
- `/api/dashboard/daily-expenses`
- `/api/dashboard/stats`
- `/api/dashboard/kpi-breakdown`

Some cards use `/stats` or `/daily-*` totals, while the drawer uses `/kpi-breakdown` totals. When the SQL logic behind those endpoints differs, the UI displays different numbers for the same business label.

### 2. Cash movement total semantics are unclear

A signed cash movement breakdown can include:

- positive same-day cash bill payments
- positive patient deposits
- negative operating expenses
- negative doctor payouts / cash-outs
- handover / transfer movement

The drawer must decide whether `total` means signed net cash movement or gross movement volume. Current UI mixes a source amount with the drawer total, so a user sees different figures.

### 3. Pending handover totals are calculated from different source sets

Dashboard stats currently focus on one pending handover source, while `kpi-breakdown?metric=pending_handover` also includes cash transfer style rows. This can make the pending handover card and drawer disagree.

### 4. MD review queue is informational, not action-oriented

The cash collection / acceptance actions already exist in `BillingHandoverPage.tsx`, but MD review queue cards do not deep-link to that action page, and the pending handover card is not wired to a handover action flow.

## Design rule: one number, one source of truth

For every clickable money KPI:

1. The card value must equal the drawer header `total` for the same metric and date/range.
2. The drawer source rows must sum to the drawer total according to the documented metric semantics.
3. If a card cannot provide a matching breakdown, do not open the generic KPI drawer. Instead, navigate to the source module.
4. Do not silently use accounting income detail for cash-received cards, or bill-value detail for cash drawer cards.

## Canonical metric dictionary

Use these labels and meanings consistently.

| Metric key | Label | Meaning | Total rule | Action |
| --- | --- | --- | --- | --- |
| `bill_value` / existing `accounting_income` if retained | Selected-day bill value / হিসাবভুক্ত আয় | Posted bill or service value for selected date/range | Sum of posted non-cancelled bill/service amount | Drawer by service/source |
| `cash_received` | Selected-day cash received / নগদ/পেমেন্ট গ্রহণ | Payments actually received on selected date/range | Sum of received payments by method/source | Drawer by payment method/source |
| `cash_movement` | Physical drawer net cash movement / ড্রয়ার নগদ নেট চলাচল | Cash drawer in/out movement | Signed net: cash in minus cash out | Drawer by source, signed rows |
| `cash_movement_gross` optional | Drawer cash activity volume | Total physical movement volume | Sum absolute amount | Secondary stat only, not primary card unless label says volume |
| `accounting_expenses` | Approved operating expense | Approved expenses only | Sum approved expense amount | Drawer by category/source |
| `accounting_profit` | Income minus approved expense | Bill/accounting income minus approved expense | `accounting_income - accounting_expenses` | Drawer with income sources and negative expense sources |
| `patient_due` | Outstanding patient due | Current unpaid patient receivable | Sum open bill due | Drawer by due status / invoice |
| `patient_advance` | Patient advance liability | Active patient deposit / advance balance | Sum active deposit balance or signed deposits according to existing contract | Drawer by transaction type |
| `pending_handover` | Pending handover cash | Cash waiting for admin/manager/receiver acceptance | Sum all unresolved handover and cash custody transfer amounts | Navigate/action + drawer |
| `total_discount` | Discount given | Waiver/discount value | Sum discount amount | Drawer by reference/person/reason |
| `pending_posting` | Accounting posting queue | Unfinalized accounting events | Count, not money | Navigate to accounting queue |

## Backend implementation plan

### Task 1: Create or refactor canonical KPI total helpers

In `src/routes/tenant/dashboard.ts`, introduce a small canonical layer, for example:

- `getKpiBreakdownByMetric(dbBinding, tenantId, metric, startDate, endDate)`
- `getKpiTotalFromBreakdown(metric, breakdown)`
- `getFinanceKpiTotals(dbBinding, tenantId, startDate, endDate)`

The goal is not to add heavy architecture. The goal is to make `/api/dashboard/stats` and `/api/dashboard/kpi-breakdown` call the same metric functions where a card is clickable.

Rules:

- Keep existing response keys for backwards compatibility.
- Add clearer keys if needed, such as:
  - `finance.billValue`
  - `finance.cashReceived`
  - `finance.cashMovementNet`
  - `finance.cashMovementGross`
  - `finance.approvedExpense`
- Existing keys can map to the canonical values:
  - `todayCollection` should mean cash received, not bill value.
  - `todayExpense` should mean approved expense.
  - `pendingHandoverAmount` should equal `pending_handover` breakdown total.

### Task 2: Fix `cash_movement` semantics

Choose this primary contract:

- `cash_movement.total` = signed net cash movement.
- Each source row is signed.
- Negative rows display as negative amounts.
- Percent/avg calculations should not make the signed total look like gross volume.

If gross movement is useful, add optional fields:

```ts
summary: {
  netTotal: number;
  grossTotal: number;
  cashInTotal: number;
  cashOutTotal: number;
}
```

But keep `total` equal to the card number.

### Task 3: Fix pending handover source consistency

Make `finance.pendingHandoverAmount` and `finance.pendingHandoverCount` use the same unresolved source set as `kpi-breakdown?metric=pending_handover`:

- unresolved `billing_handovers`
- unresolved `billing_counter_cash_transfers`
- unresolved cash custody transfer rows if those are now the source of truth

Avoid double-counting when the same transfer appears in both legacy handover and cash ledger tables. If cash ledger is canonical, prefer the cash ledger row and ignore duplicate legacy rows.

### Task 4: Add missing breakdown aliases only if needed

If current UI needs separate `cash_received` and `bill_value` metrics, add aliases to `/api/dashboard/kpi-breakdown`:

- `metric=cash_received`
- `metric=bill_value`

Keep existing metrics working so current admin tests and routes do not break.

### Task 5: Backend tests

Add or update targeted tests around `src/routes/tenant/dashboard.ts`.

Required assertions:

1. For each clickable KPI, `/api/dashboard/stats` total equals `/api/dashboard/kpi-breakdown` total for the same date/range.
2. `cash_movement.total` equals the signed sum of source rows.
3. `cash_movement.summary.grossTotal` if present equals sum of absolute source rows.
4. `pending_handover` includes all unresolved handover/cash-transfer sources and excludes resolved rows.
5. Cancelled/refunded/draft bills do not inflate income, due, or discount totals.
6. Approved expense only includes approved expenses.

## Frontend implementation plan

### Task 6: Convert MD dashboard from one-off cash drawer state to generic selected KPI state

In `web/src/pages/MDDashboard.tsx`, replace the current `selectedCashKpi` state with a generic state:

```ts
type MDDashboardKpiMetric =
  | 'bill_value'
  | 'cash_received'
  | 'cash_movement'
  | 'accounting_income'
  | 'accounting_expenses'
  | 'accounting_profit'
  | 'patient_due'
  | 'patient_advance'
  | 'pending_handover'
  | 'total_discount'
  | 'pending_posting';

type SelectedKpi = { metric: MDDashboardKpiMetric; title: string; mode?: 'drawer' | 'navigate' };
```

Then use one `KpiBreakdownDrawer` instance for all drawer-backed cards.

### Task 7: Make card values come from canonical totals

For every MD financial card:

- Use the same total that the drawer will show.
- Do not calculate the cash movement card from `cashMovementQ.data?.sources.find(...)`.
- Use `cashMovementQ.data?.total` only if that query is the canonical source; otherwise use `stats.finance.cashMovementNet` after backend fix.

Specific bug to fix:

```tsx
value={fmtBDT(cashMovementQ.data?.sources?.find((s) => s.label === 'mdDashboard.kpi.cashMovementSourceBill')?.amount ?? stats.finance.todayCollection)}
```

Replace this with the canonical cash movement total.

### Task 8: Make MD review queue action-oriented

For `Pending handover cash` review queue item:

- Show amount and count.
- Primary action: `Collect / Approve` or `Review handovers`.
- Navigate to `${base}/cash/handover?status=pending`.
- Add a small note: receiver handovers require `Accept & Start Shift`; admin/MD collection uses `Confirm collected` or `Partial` in the handover page.

For other review queue items:

- `Outstanding patient due` -> `${base}/cash/dues` if route/permission exists; fallback `${base}/billing`.
- `High discount bills` -> `${base}/cash/discounts` if route/permission exists; fallback discount review/settings page.
- `Accounting posting queue` -> `${base}/md/accounting` or accounting queue route.

### Task 9: Make pending handover alert link correct

In `MDDashboard.tsx`, update the alert strip pending handover link from accounting to the handover action page:

- Current: `${base}/md/accounting`
- Desired: `${base}/cash/handover?status=pending`

Ensure the route is accessible for MD through `RoleAwareRoute` and permissions. If not, add the MD permission route explicitly in `web/src/App.tsx`.

### Task 10: Honor status query in `BillingHandoverPage`

`BillingHandoverPage.tsx` already has `statusFilter` state. Add URL query support:

- initialize state from `?status=pending|verified|all`
- update URL when filter changes
- keep old behavior when no query is present

This makes MD dashboard deep-links open the page already filtered to pending handovers.

### Task 11: Add direct actions to the KPI drawer for actionable rows

For `KpiBreakdownDrawer` when metric is `pending_handover`:

- Add row-level `Open handover` / `Collect` action if the row contains a source id/reference.
- If row source is not directly actionable, show a page-level CTA at top: `Open handover collection`.

Keep drawer read-only for due/discount rows unless a safe detail route exists.

### Task 12: Mobile layout polish

In `KpiBreakdownDrawer.tsx`:

- Make the drawer header mobile-safe.
- Prevent long Bangla titles from sitting under the top menu / left overlay.
- Use `max-w-full`, `break-words`, and smaller line-height for title/subtitle on narrow screens.
- Ensure close button remains visible and tappable.
- Keep table horizontally scrollable, but show source summary cards first on mobile.

In `KPICard.tsx` / MD dashboard card grid:

- Ensure Bangla labels do not truncate into meaningless text.
- For mobile, allow 2-line titles and show tooltip/help where labels are ambiguous.

## Frontend tests

Update `web/src/pages/MDDashboard.test.tsx`:

1. Renders corrected financial labels.
2. Cash movement card uses canonical total, not bill-only source amount.
3. Clicking cash movement opens drawer and card value equals drawer total in mocked response.
4. Pending handover review queue action navigates to `/cash/handover?status=pending`.
5. Pending handover alert strip link navigates to `/cash/handover?status=pending`.
6. Patient due / discount review actions navigate to safe source routes.
7. Drawer renders actionable CTA for `pending_handover`.

Update `web/src/pages/HospitalAdminDashboard.test.tsx`:

1. Admin dashboard card value equals drawer total for the same mocked KPI.
2. `pending_handover` uses the same amount/count as the drawer.
3. Existing admin date selector behavior still works.

Update `web/src/pages/BillingHandoverPage.test.ts` or add TSX test if needed:

1. `?status=pending` initializes the pending filter.
2. Changing filter updates state/URL without breaking default behavior.
3. MD/admin role still sees collection buttons.

## Backend tests

Add or update backend tests for dashboard KPI consistency:

- `test/dashboard-kpi-consistency.test.ts` or existing dashboard test file.

Minimum seeded scenario:

- bills: Lab 4700, OPD 900
- approved expense: 1400
- patient due: 4000
- discount: one high discount bill
- pending handover: one counter handover and one cash custody transfer
- resolved handover: must not count
- cancelled/refunded bill: must not count

Assertions:

- `stats.finance.todayCollection` matches `cash_received` total if cash_received is exposed.
- `stats.finance.cashMovementNet` matches `kpi-breakdown?metric=cash_movement.total`.
- `stats.finance.pendingHandoverAmount` matches `kpi-breakdown?metric=pending_handover.total`.
- `stats.finance.todayExpense` matches `kpi-breakdown?metric=accounting_expenses.total`.
- `todaySummary.totalDiscount` matches `kpi-breakdown?metric=total_discount.total`.

## Execution order

1. Add failing frontend tests for MD cash movement and pending handover action.
2. Add failing backend consistency tests for stats vs breakdown totals.
3. Refactor backend KPI totals to canonical helpers.
4. Fix `cash_movement` signed/net total contract.
5. Fix pending handover total source set.
6. Update `MDDashboard.tsx` to use generic KPI drawer state and canonical totals.
7. Add action CTAs and correct navigation for pending handover, due, discount.
8. Add `BillingHandoverPage` query param support.
9. Polish mobile drawer/card layout.
10. Run targeted tests.
11. Run broader dashboard tests.
12. Run build/type checks if the repository baseline allows it.

## Validation commands

Run targeted tests first:

```bash
pnpm --filter web test -- MDDashboard.test.tsx HospitalAdminDashboard.test.tsx BillingHandoverPage.test.ts
```

Then backend/dashboard tests:

```bash
pnpm test -- dashboard
```

If repository scripts differ, use the existing nearest test commands. After targeted tests pass:

```bash
pnpm build:migrations
pnpm test
pnpm build
```

If pre-existing baseline failures appear, document them clearly and show that the new targeted tests pass.

## Acceptance criteria

This work is done only when all are true:

1. Every clickable MD money KPI opens a drawer whose total exactly matches the card value for the selected date/range.
2. Cash movement card no longer shows only bill payments while the drawer shows another total.
3. Signed cash-out rows do not make the total confusing; net and gross are clearly labeled if both are shown.
4. Pending handover card and drawer include the same unresolved source rows.
5. MD review queue has a direct action path for pending handover cash.
6. The handover action page opens filtered to pending handovers when linked from MD dashboard.
7. Mobile drawer header and Bangla KPI titles are readable and not hidden under fixed UI.
8. Tests cover the mismatch that the user reported.

## Safety notes

- No schema migration should be needed unless a missing canonical source id must be persisted. Prefer no schema change.
- Do not log patient-sensitive data.
- Do not fake KPI numbers in the frontend.
- If old legacy handover and new cash ledger both contain the same event, deduplicate instead of summing twice.
- Preserve backwards-compatible API keys because admin, director, and tests may already consume them.
