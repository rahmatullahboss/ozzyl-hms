# Inventory Intelligence Recompute Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Smart Stock Assistant from a polished dashboard foundation into a trustworthy deterministic inventory-intelligence slice by generating real stock snapshots, exposing setup/stale status, and aligning reorder suggestions with those snapshots.

**Architecture:** Add a focused pure computation module under `src/lib/inventory-intelligence/recompute.ts`, then call it from a tenant API recompute endpoint. The dashboard endpoint returns `status`, `snapshotCount`, and `lastComputedAt` so UI never says “Ready” when the intelligence layer has not been computed. Existing reorder suggestions prefer snapshot data and fall back to legacy reorder-level logic only when snapshots are absent.

**Tech Stack:** TypeScript, Hono, Cloudflare D1 prepared statements, Vitest, React 19, Vite, Tailwind utility classes already used in the web app.

## Global Constraints

- No AI magic: all recommendations must be deterministic and explainable.
- Small hospital UX: empty/unconfigured states must be honest and staff-readable.
- Existing migrations must remain additive; do not rewrite historical migrations.
- Existing inventory tables are the source of truth: `InventoryItem`, `InventoryStock`, `InventoryStockTransaction`, PR/PO tables, and 0399 intelligence tables.
- TDD: write failing tests first, verify RED, then implement.
- Keep files focused; do not turn `InventoryDashboard.tsx` into a rules engine.

---

## File Structure

- Create: `src/lib/inventory-intelligence/recompute.ts`
  - Pure functions for stock usability, demand averages, snapshot calculation, recommendation creation, dashboard status.
  - Optional DB orchestration function `recomputeInventoryIntelligence(dbClient, tenantId, options)` that performs SQL reads/upserts.
- Modify: `src/routes/tenant/inventory/intelligence.ts`
  - Add `POST /recompute`.
  - Return `status`, `snapshotCount`, and `lastComputedAt` from `GET /dashboard`.
- Modify: `src/routes/tenant/inventory/reorder.ts`
  - Align reorder enum with migration.
  - Prefer intelligence snapshots for suggestions; fallback to legacy logic.
- Modify: `web/src/pages/inventory/inventoryDashboardSmartHelpers.ts`
  - Add setup/stale-aware verdict helper.
- Modify: `web/src/pages/inventory/InventoryDashboard.tsx`
  - Display setup/stale/last-computed state.
  - Add manual recompute action only if safe through existing API patterns.
- Tests:
  - `test/unit/inventory-intelligence-recompute.test.ts`
  - Update `test/unit/inventory-intelligence-route-helpers.test.ts`
  - Update `test/unit/inventory-dashboard-smart-assistant.test.ts`
  - Update `web/src/pages/inventory/InventoryDashboard.render.test.tsx`

## Task 1: Pure recompute rules

**Files:**
- Create: `src/lib/inventory-intelligence/recompute.ts`
- Test: `test/unit/inventory-intelligence-recompute.test.ts`

**Interfaces:**
- Produces:
  - `isStockLotUsable(lot, today): boolean`
  - `summarizeStockLots(lots, today): { currentStock, usableStock, blockedStock }`
  - `averageDailyUsage(demandRows, today, days): number`
  - `buildItemSnapshot(input): InventoryItemSnapshotComputation`
  - `buildRecommendationForSnapshot(snapshot): InventoryRecommendationDraft | null`
  - `classifyDashboardStatus(input): 'not_configured' | 'stale' | 'ready'`

- [ ] **Step 1: Write failing tests**

```ts
it('excludes expired, rejected, blocked, reserved and damaged stock from usable stock', () => {
  const summary = summarizeStockLots([
    { AvailableQuantity: 100, QCStatus: 'accepted', StockStatus: 'available', ExpiryDate: '2026-08-01' },
    { AvailableQuantity: 50, QCStatus: 'rejected', StockStatus: 'available', ExpiryDate: '2026-08-01' },
    { AvailableQuantity: 20, QCStatus: 'accepted', StockStatus: 'blocked', ExpiryDate: '2026-08-01' },
    { AvailableQuantity: 30, QCStatus: 'accepted', StockStatus: 'available', ExpiryDate: '2026-06-01' },
    { AvailableQuantity: 40, QCStatus: 'accepted', StockStatus: 'available', ExpiryDate: '2026-08-01', ReservedQuantity: 10, DamagedQuantity: 5, BlockedQuantity: 5 },
  ], '2026-07-05');

  expect(summary).toEqual({ currentStock: 240, usableStock: 120, blockedStock: 120 });
});
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run test/unit/inventory-intelligence-recompute.test.ts`
Expected: FAIL because `recompute.ts` does not exist yet.

- [ ] **Step 3: Implement minimal pure functions**

Implement deterministic stock usability and snapshot calculation using existing forecast helpers.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run test/unit/inventory-intelligence-recompute.test.ts test/unit/inventory-intelligence-forecast.test.ts`
Expected: PASS.

## Task 2: DB recompute endpoint

**Files:**
- Modify: `src/lib/inventory-intelligence/recompute.ts`
- Modify: `src/routes/tenant/inventory/intelligence.ts`
- Test: `test/unit/inventory-intelligence-route-helpers.test.ts`

**Interfaces:**
- Produces:
  - `POST /api/inventory/intelligence/recompute`
  - Response: `{ message, recomputedItems, generatedRecommendations, status, lastComputedAt }`
  - `GET /dashboard` status fields: `{ status, snapshotCount, lastComputedAt }`

- [ ] **Step 1: Write failing route helper tests**

```ts
expect(classifyDashboardStatus({ snapshotCount: 0, lastComputedAt: null, now: '2026-07-05T00:00:00.000Z' })).toBe('not_configured');
expect(classifyDashboardStatus({ snapshotCount: 2, lastComputedAt: '2026-07-01T00:00:00.000Z', now: '2026-07-05T00:00:00.000Z' })).toBe('stale');
expect(classifyDashboardStatus({ snapshotCount: 2, lastComputedAt: '2026-07-05T00:00:00.000Z', now: '2026-07-05T12:00:00.000Z' })).toBe('ready');
```

- [ ] **Step 2: Verify RED**

Run: `pnpm exec vitest run test/unit/inventory-intelligence-route-helpers.test.ts`
Expected: FAIL because status helper is not exported yet.

- [ ] **Step 3: Implement dashboard status + recompute endpoint**

Use SQL reads for active items, stock lots, demand rows, open PR and open PO quantities. Upsert snapshots and generated recommendation cards.

- [ ] **Step 4: Verify GREEN**

Run: `pnpm exec vitest run test/unit/inventory-intelligence-route-helpers.test.ts test/unit/inventory-intelligence-recompute.test.ts`
Expected: PASS.

## Task 3: Reorder endpoint uses intelligence first

**Files:**
- Modify: `src/routes/tenant/inventory/reorder.ts`
- Test: root/unit tests where helper coverage is practical, or keep build verification if route integration harness is too heavy.

**Interfaces:**
- Existing `GET /api/inventory/reorder/suggestions` still returns `suggestions`.
- New suggestion rows may include:
  - `source: 'intelligence_snapshot' | 'legacy_reorder_level'`
  - `days_of_cover`
  - `estimated_stockout_date`
  - `recommendation_status`

- [ ] **Step 1: Align enum**

Change zod enum to `['max_minus_current', 'reorder_x2_minus_current', 'fixed']` to match migration 0256.

- [ ] **Step 2: Add intelligence-first SQL**

Query `inventory_stock_intelligence_snapshot` joined to `InventoryItem` and `InventoryVendor`. If snapshot rows exist for low/watch/stockout, return them. If table is missing or no rows exist, run legacy query.

- [ ] **Step 3: Verify**

Run root unit tests and web build.

## Task 4: UI setup/stale state

**Files:**
- Modify: `web/src/pages/inventory/inventoryDashboardSmartHelpers.ts`
- Modify: `web/src/pages/inventory/InventoryDashboard.tsx`
- Test: `test/unit/inventory-dashboard-smart-assistant.test.ts`, `web/src/pages/inventory/InventoryDashboard.render.test.tsx`

**Interfaces:**
- `smartStockVerdict(summary, intelligence, status?)` returns:
  - `Setup needed` when status is `not_configured`
  - `Refresh needed` when status is `stale`
  - existing Ready/Ready with risk/Blocked today when status is `ready`

- [ ] **Step 1: Write failing helper/render tests**

Test helper verdict and UI shows setup/stale copy.

- [ ] **Step 2: Verify RED**

Run helper and render tests and confirm failure.

- [ ] **Step 3: Implement UI changes**

Add status fields to response type, copy, and last-computed display.

- [ ] **Step 4: Verify GREEN**

Run helper tests, render test, web build.

## Task 5: Final verification and review

**Files:**
- Docs: update this plan if implementation deviates.

- [ ] Run:
  - `pnpm exec vitest run test/unit/inventory-intelligence-recompute.test.ts test/unit/inventory-intelligence-route-helpers.test.ts test/unit/inventory-dashboard-smart-assistant.test.ts test/unit/inventory-intelligence-forecast.test.ts`
  - `cd web && pnpm exec vitest run src/pages/inventory/InventoryDashboard.render.test.tsx`
  - `pnpm --filter web build`
- [ ] Inspect git status and summarize changed files.
- [ ] Report known remaining gaps honestly.

## Self-Review

- Spec coverage: Covers P0 recompute, P0 reorder snapshot preference, P1 stale/setup status, P1 enum mismatch, and UI trust-state. Duplicate readiness panel cleanup is intentionally deferred because it is visual polish, not core data trust.
- Placeholder scan: No TBD/TODO placeholders remain in plan steps.
- Type consistency: Status names are consistent across backend helper and UI helper.
