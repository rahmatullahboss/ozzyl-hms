# Admin Financial Control and Action Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans`. Follow TDD. Do not modify production data or financial source tables.

**Goal:** Build the Money workspace around four clearly reconciled blocks—business performance, collection flow, cash custody, and doctor liability—and replace duplicate dashboard exception calculations with one compact consumer of the existing Action Center.

**Architecture:** Add focused reporting services under `src/services/dashboard/` and keep `src/routes/tenant/dashboard.ts` as a thin route orchestrator. Compose existing KPI/cash/commission source-of-truth functions instead of duplicating formulas. Return explicit metadata and reconciliation envelopes. Add range-aware trend and payment-method endpoints. The existing `/api/action-center/summary` remains authoritative.

**Tech Stack:** Hono/Cloudflare Workers, D1 SQL, TypeScript, React, React Query, Vitest, Testing Library.

## Global constraints

- No new financial ledger or materialized financial source of truth.
- Patient deposits are not revenue.
- Non-cash collections are not physical drawer cash.
- Earned/payable commission is not treated as paid expense.
- Executed doctor payouts are shown separately and included in accounting expense only according to existing accounting policy.
- Every money block returns `summaryTotal`, `detailTotal`, and `unexplainedDifference`.
- Pagination never changes the full-detail total.
- The existing Action Center owns approvals, exceptions, collections, tasks, and next-best action.
- No second risk queue is introduced.

---

## Task 1: Extend the shared reconciliation contract for financial blocks

**Prerequisite:** ACC-00 semantic foundation is merged and provides `packages/shared/src/dashboard/types.ts` plus `src/lib/dashboard/reconciliation.ts`.

**Files:**

- Modify: `packages/shared/src/dashboard/types.ts`
- Modify: `src/lib/dashboard/reconciliation.ts`
- Create: `test/unit/dashboard-financial-reconciliation-contract.test.ts`
- Modify: `web/src/types/executiveDashboard.ts`

**Extension:**

The shared reconciliation result gains a required `detailGrain`, an explicit `status`, and warnings while preserving the ACC-00 fields and compatibility adapters.

```ts
export interface FinancialReconciliationEnvelope extends ReconciliationResult {
  detailGrain: string;
  status: 'reconciled' | 'warning' | 'unavailable';
  warnings: string[];
}
```

- [ ] Test exact zero difference.
- [ ] Test sub-cent floating noise normalizes to zero.
- [ ] Test non-zero warning.
- [ ] Test unavailable state.
- [ ] Test empty reconciled result.
- [ ] Test the extension preserves ACC-00 source status, generated timestamp, and provider mode.
- [ ] Implement the additive shared type and helper extension.
- [ ] Run focused tests.

**Commit:**

```bash
git add packages/shared/src/dashboard/types.ts src/lib/dashboard/reconciliation.ts test/unit/dashboard-financial-reconciliation-contract.test.ts web/src/types/executiveDashboard.ts
git commit -m "feat(reporting): extend financial reconciliation contract"
```

---

## Task 2: Build the financial-control service contract

**Files:**

- Create: `src/services/dashboard/financialControl.ts`
- Create: `test/integration/routes/dashboard-financial-control.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`

**Endpoint:**

```text
GET /dashboard/financial-control?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
```

**Required response blocks:**

- `businessPerformance`
- `collectionFlow`
- `cashCustody`
- `doctorLiability`

- [ ] Write tests proving patient deposits are not included in recognized income.
- [ ] Write tests proving prior-due collection is separated from current invoice collection.
- [ ] Write tests proving non-cash collection is excluded from physical cash in.
- [ ] Write tests proving current drawer balance declares `current_state`.
- [ ] Write tests proving earned, waiver, payable, paid, and outstanding doctor amounts remain separate.
- [ ] Write tests for each reconciliation envelope.
- [ ] Write an invalid-period 400 test.
- [ ] Run and verify RED.
- [ ] Implement service functions that call or reuse the same underlying source functions as KPI summary/breakdown.
- [ ] Do not place large SQL blocks directly in the Hono handler.
- [ ] Add only a small route adapter in `dashboard.ts`.
- [ ] Run and verify GREEN.

**Commit:**

```bash
git add src/services/dashboard/financialControl.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-financial-control.test.ts
git commit -m "feat(dashboard): add reconciled financial control summary"
```

---

## Task 3: Add range-aware payment-method reporting

**Files:**

- Create: `src/services/dashboard/paymentMethodBreakdown.ts`
- Create: `test/integration/routes/dashboard-payment-methods.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `web/src/pages/admin/widgets/PaymentMethodBreakdown.tsx`
- Modify or create: `web/src/pages/admin/widgets/PaymentMethodBreakdown.test.tsx`

**Endpoint:**

```text
GET /dashboard/payment-methods?startDate=...&endDate=...
```

- [ ] Test cash, bKash, Nagad, card, bank transfer, cheque, and unknown methods.
- [ ] Test total and percentage reconciliation.
- [ ] Test source transaction count.
- [ ] Test that deposit receipts are either separately labeled or excluded according to the response contract; never silently mixed.
- [ ] Test range boundaries in Asia/Dhaka.
- [ ] Test frontend request follows the command-center period.
- [ ] Test clicking a method opens its payment/invoice detail filter.
- [ ] Implement and verify.

**Commit:**

```bash
git add src/services/dashboard/paymentMethodBreakdown.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-payment-methods.test.ts web/src/pages/admin/widgets/PaymentMethodBreakdown.tsx web/src/pages/admin/widgets/PaymentMethodBreakdown.test.tsx
git commit -m "feat(dashboard): add range payment method breakdown"
```

---

## Task 4: Add a reconciled financial trend

**Files:**

- Create: `src/services/dashboard/financialTrend.ts`
- Create: `test/integration/routes/dashboard-financial-trend.test.ts`
- Modify: `src/routes/tenant/dashboard.ts`
- Modify: `web/src/pages/admin/widgets/RevenueTrendChart.tsx`
- Modify: `web/src/pages/admin/widgets/RevenueTrendChart.test.tsx`

**Endpoint:**

```text
GET /dashboard/financial-trend?startDate=...&endDate=...&series=collection,expense,result
```

- [ ] Test daily aggregation for short ranges.
- [ ] Test monthly aggregation for long ranges.
- [ ] Test collection, expense, and result totals reconcile with their series points.
- [ ] Test the response declares date basis and granularity.
- [ ] Test the chart uses the selected command-center period rather than internal Today/7D state.
- [ ] Test a table/text alternative exists for accessibility.
- [ ] Implement and verify.

**Commit:**

```bash
git add src/services/dashboard/financialTrend.ts src/routes/tenant/dashboard.ts test/integration/routes/dashboard-financial-trend.test.ts web/src/pages/admin/widgets/RevenueTrendChart.tsx web/src/pages/admin/widgets/RevenueTrendChart.test.tsx
git commit -m "feat(dashboard): add reconciled financial trend"
```

---

## Task 5: Build Money workspace reconciliation UI

**Files:**

- Create: `web/src/pages/admin/command-center/components/ReconciliationStrip.tsx`
- Create: `web/src/pages/admin/command-center/components/ReconciliationStrip.test.tsx`
- Create: `web/src/pages/admin/command-center/components/FinancialControlBlock.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/MoneyWorkspace.tsx`
- Create: `web/src/pages/admin/command-center/workspaces/MoneyWorkspace.test.tsx`
- Modify: `web/src/lib/queryKeys.ts`

- [ ] Test four separate blocks render with correct formulas.
- [ ] Test deposit is visually separate from collection/revenue.
- [ ] Test physical cash is visually separate from non-cash collection.
- [ ] Test doctor liability displays earned, waiver, payable, paid, and outstanding.
- [ ] Test reconciliation warning shows the exact difference.
- [ ] Test unavailable reconciliation does not display a green success state.
- [ ] Test detail action opens the corresponding existing KPI drawer or linked workspace.
- [ ] Implement the Money workspace using the new endpoints and existing drilldown components.
- [ ] Use server totals; do not recalculate commission or accounting formulas in React.

**Commit:**

```bash
git add web/src/pages/admin/command-center/components web/src/pages/admin/command-center/workspaces/MoneyWorkspace.tsx web/src/pages/admin/command-center/workspaces/MoneyWorkspace.test.tsx web/src/lib/queryKeys.ts
git commit -m "feat(admin-dashboard): add reconciled money workspace"
```

---

## Task 6: Consolidate dashboard actions around Action Center

**Files:**

- Create: `web/src/pages/admin/command-center/components/ActionCenterSummaryPanel.tsx`
- Create: `web/src/pages/admin/command-center/components/ActionCenterSummaryPanel.test.tsx`
- Modify: `web/src/pages/admin/command-center/workspaces/OverviewWorkspace.tsx`
- Modify: `web/src/pages/admin/widgets/ActionRequiredPanel.tsx`
- Modify: `web/src/pages/admin/widgets/KPISummaryCards.tsx`
- Modify: `web/src/pages/admin/Dashboard.test.tsx`

- [ ] Test the compact panel uses `/api/action-center/summary`.
- [ ] Test pending approvals, critical exceptions, receivable exposure, overdue tasks, and next-best action.
- [ ] Test action links preserve tenant slug.
- [ ] Test the old local `riskRows` exception center is not rendered.
- [ ] Test no independent approval/security count request is required by the new Overview panel.
- [ ] Preserve `ActionRequiredPanel` temporarily as a thin wrapper only if another route imports it; otherwise remove it after import search.
- [ ] Remove duplicate local exception calculations only after parity tests pass.

**Commit:**

```bash
git add web/src/pages/admin/command-center/components/ActionCenterSummaryPanel.tsx web/src/pages/admin/command-center/components/ActionCenterSummaryPanel.test.tsx web/src/pages/admin/command-center/workspaces/OverviewWorkspace.tsx web/src/pages/admin/widgets/ActionRequiredPanel.tsx web/src/pages/admin/widgets/KPISummaryCards.tsx web/src/pages/admin/Dashboard.test.tsx
git commit -m "refactor(admin-dashboard): consolidate action center summary"
```

---

## Task 7: Add reconciliation observability

**Files:**

- Modify: `src/lib/dashboard/reconciliation.ts`
- Create: `src/services/dashboard/reportingObservability.ts`
- Create: `test/unit/dashboard-reporting-observability.test.ts`

- [ ] Log contract version, period length, date basis, duration, row count, reconciliation status, and non-zero difference through an injected logger interface.
- [ ] Test logs do not contain patient names, invoice descriptions, phone numbers, or clinical text.
- [ ] Test warning logs are emitted for non-zero differences.
- [ ] Keep normal reconciled logging low-volume.

**Commit:**

```bash
git add src/lib/dashboard/reconciliation.ts src/services/dashboard/reportingObservability.ts test/unit/dashboard-reporting-observability.test.ts
git commit -m "chore(reporting): observe dashboard reconciliation"
```

---

## Task 8: Verification

- [ ] Run backend focused tests:

```bash
pnpm exec vitest run \
  test/unit/dashboard-reporting-contract.test.ts \
  test/unit/dashboard-reporting-observability.test.ts \
  test/integration/routes/dashboard-financial-control.test.ts \
  test/integration/routes/dashboard-payment-methods.test.ts \
  test/integration/routes/dashboard-financial-trend.test.ts \
  test/integration/routes/dashboard-kpi-summary.test.ts \
  test/integration/routes/dashboard-kpi-breakdown.test.ts \
  test/integration/routes/dashboard-cash-movement-kpi.test.ts \
  test/integration/routes/dashboard-management-kpis.test.ts
```

- [ ] Run frontend focused tests:

```bash
pnpm --dir web exec vitest run \
  src/pages/admin/command-center/components/ReconciliationStrip.test.tsx \
  src/pages/admin/command-center/components/ActionCenterSummaryPanel.test.tsx \
  src/pages/admin/command-center/workspaces/MoneyWorkspace.test.tsx \
  src/pages/admin/widgets/PaymentMethodBreakdown.test.tsx \
  src/pages/admin/widgets/RevenueTrendChart.test.tsx
```

- [ ] Run root and web type checks.
- [ ] Run web build.
- [ ] Verify each displayed total against its drill total fixture.
- [ ] Inspect SQL parameters for binding and tenant scope.
- [ ] Inspect branch diff for unrelated files.

## Completion evidence

- Four control blocks use distinct semantics.
- Every block displays reconciliation status.
- Trend and payment methods follow the selected range.
- Action Center is the only queue source used by Overview.
- Existing KPI totals and drilldowns remain compatible.
