# Reagent Stock Default List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every active reagent stock lot immediately when the Stock tab opens, with the existing selector acting as an optional filter.

**Architecture:** Add one tenant-scoped aggregate stock-lots endpoint that merges canonical InventoryStock and legacy lab stock projections. Replace the selected-consumable detail query in the React page with this endpoint and include reagent identity on each row.

**Tech Stack:** Hono, Cloudflare D1/SQLite, React 19, TanStack Query, Vitest, Testing Library, TypeScript.

## Global Constraints

- Preserve tenant isolation.
- Preserve current canonical-versus-legacy ledger behavior and action restrictions.
- Do not add migrations or unrelated refactors.
- Use TDD: failing API/UI tests before production changes.

---

### Task 1: Aggregate stock-lots API

**Files:**
- Modify: `test/lab-consumable-stock-lifecycle-db.test.ts`
- Modify: `src/routes/tenant/labMonitoring.ts`
- Modify: `src/routes/tenant/labMonitoring.js`

**Interfaces:**
- Produces: `GET /lab-monitoring/stock/lots?consumable_id=<positive integer>` returning `{ data: StockLot[] }`.

- [ ] **Step 1: Write the failing integration test**

Create two consumables, one legacy lot, one canonical-linked lot, and one legacy shadow lot for the linked consumable. Assert the unfiltered endpoint returns the legacy and canonical lots only, with consumable metadata. Assert the filtered endpoint returns only the requested consumable.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts -t "lists active stock lots across all consumables"`
Expected: FAIL because `/stock/lots` does not exist.

- [ ] **Step 3: Implement the endpoint**

Add tenant-scoped legacy and canonical projections, schema fallbacks, optional positive-integer filtering, canonical-shadow exclusion, and deterministic sorting.

- [ ] **Step 4: Run test to verify it passes**

Run the same focused command.
Expected: PASS.

### Task 2: Default all-lots Stock tab

**Files:**
- Modify: `web/src/pages/LabMonitoringDashboard.render.test.tsx`
- Modify: `web/src/pages/LabMonitoringDashboard.tsx`

**Interfaces:**
- Consumes: `GET /api/lab-monitoring/stock/lots`.
- Produces: Stock tab default all-lots view with optional consumable filter.

- [ ] **Step 1: Write the failing render test**

Mock aggregate lots for two reagents, open the Stock tab, and assert both rows are visible without selecting a reagent. Change the selector and assert the query switches to the selected reagent projection.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.render.test.tsx`
Expected: FAIL because the page still requires a selection.

- [ ] **Step 3: Implement the React query and table changes**

Use a `stock-lots` query keyed by the optional selected ID, update selector copy, remove the selection-required empty state, and show reagent name/code in every lot row.

- [ ] **Step 4: Run test to verify it passes**

Run the focused render suite.
Expected: PASS.

### Task 3: Verification and commit

**Files:**
- Verify all files above.

- [ ] **Step 1: Run focused suites**

Run:

```bash
pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts
pnpm --filter web exec vitest run src/pages/LabMonitoringDashboard.test.ts src/pages/LabMonitoringDashboard.render.test.tsx
pnpm --filter web build
```

Expected: all tests pass and the web build succeeds.

- [ ] **Step 2: Review diff and commit**

```bash
git diff --check
git status --short
git add docs/superpowers/specs/2026-07-13-reagent-stock-default-list-design.md docs/superpowers/plans/2026-07-13-reagent-stock-default-list.md test/lab-consumable-stock-lifecycle-db.test.ts src/routes/tenant/labMonitoring.ts src/routes/tenant/labMonitoring.js web/src/pages/LabMonitoringDashboard.render.test.tsx web/src/pages/LabMonitoringDashboard.tsx
git commit -m "fix: show reagent stock lots by default"
```
