# Reagent Stock Canonical Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Reagent Control stock-in and legacy reagent lots appear in the main Inventory/Stock Management module by writing and backfilling the canonical `InventoryStock` ledger.

**Architecture:** Add a focused stock-sync service that owns InventoryItem/InventoryStore resolution, atomic lot creation and legacy backfill. Keep `labMonitoring.ts` as HTTP orchestration only. `InventoryStock` remains quantity truth; `lab_consumable_stock` is a linked compatibility projection.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, SQLite-compatible SQL, Zod, Vitest, React Query.

## Global Constraints

- Preserve tenant scoping on every item, store, stock, transaction and lab row.
- Use D1 `batch()` for canonical lot + transaction + compatibility projection + movement writes.
- Do not remove `lab_consumable_stock`.
- Do not change reagent consumption policy or strict-mode behavior.
- Do not modify unrelated dirty files already present in the branch.
- Use migration prefix `0421` for the new idempotency index.

---

### Task 1: Canonical stock-in contract and idempotency guard

**Files:**
- Create: `migrations/0421_lab_reagent_stock_in_idempotency.sql`
- Modify: `test/lab-consumable-stock-lifecycle-db.test.ts`

**Interfaces:**
- Consumes: existing `/lab-monitoring/stock/in` request.
- Produces: request field `idempotency_key?: string`; response fields `id`, `inventory_stock_id`, `inventory_item_id`, `inventory_store_id`, `qc_status`, `deduplicated`.

- [ ] **Step 1: Add failing DB integration tests**

Add inventory master/ledger tables to the stock lifecycle harness and write tests that POST a reagent lot with an idempotency key. Assert one row exists in each of `InventoryItem`, `InventoryStore`, `InventoryStock`, `InventoryStockTransaction`, and that `lab_consumables.inventory_item_id` plus `lab_consumable_stock.inventory_stock_id` point to those rows. POST the same body again and assert the response has `deduplicated: true` and row counts remain one.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run test/lab-consumable-stock-lifecycle-db.test.ts -t "creates canonical inventory stock"`

Expected: FAIL because `/stock/in` still writes only `lab_consumable_stock` and the response lacks canonical IDs.

- [ ] **Step 3: Add the migration**

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_stock_tx_lab_idempotency
ON InventoryStockTransaction(tenant_id, TransactionType, ReferenceNo)
WHERE TransactionType IN ('lab-stock-in', 'lab-legacy-backfill')
  AND ReferenceNo IS NOT NULL;
```

- [ ] **Step 4: Run migration-manifest verification**

Run: `pnpm build:migrations`

Expected: PASS and include `0421_lab_reagent_stock_in_idempotency.sql` in the generated manifest.

### Task 2: Canonical reagent stock synchronization service

**Files:**
- Create: `src/lib/lab-reagent-stock-sync.ts`
- Modify: `src/routes/tenant/labMonitoring.ts:961-1093`
- Modify: `test/lab-consumable-stock-lifecycle-db.test.ts`

**Interfaces:**
- Produces `createCanonicalReagentStock(db, input)` returning lab stock, inventory stock, inventory item, inventory store, QC status and deduplication state.

- [ ] **Step 1: Implement tenant-scoped InventoryItem and InventoryStore resolvers**
- [ ] **Step 2: Implement one-batch canonical lot, transaction, compatibility and movement write**
- [ ] **Step 3: Extend stock-in validation and route response**
- [ ] **Step 4: Run focused canonical/idempotency tests**

### Task 3: Existing legacy stock backfill

**Files:**
- Modify: `src/lib/lab-reagent-stock-sync.ts`
- Modify: `src/routes/tenant/labMonitoring.ts`
- Modify: `test/lab-consumable-stock-lifecycle-db.test.ts`

**Interfaces:**
- Produces `backfillLegacyReagentStock(db, { tenantId, userId })` and manager-only `POST /stock/backfill-canonical`.

- [ ] **Step 1: Write failing idempotent backfill test**
- [ ] **Step 2: Implement per-row atomic backfill and summary**
- [ ] **Step 3: Add manager-only route**
- [ ] **Step 4: Run focused backfill tests**

### Task 4: Reagent Control action and inventory visibility regression

**Files:**
- Modify: `web/src/pages/LabMonitoringDashboard.tsx`
- Modify: `web/src/pages/LabMonitoringDashboard.test.ts`
- Modify: `web/src/pages/LabMonitoringDashboard.render.test.tsx`
- Modify: existing inventory stock overview route test

- [ ] **Step 1: Add failing frontend assertions for `Sync legacy stock to Inventory`**
- [ ] **Step 2: Add mutation, loading state, toast and query invalidation**
- [ ] **Step 3: Assert inventory overview returns canonical reagent lot**
- [ ] **Step 4: Run focused frontend and backend tests**

### Task 5: Full verification

- [ ] **Step 1:** Run `pnpm test:inventory`
- [ ] **Step 2:** Run `pnpm exec tsc --noEmit`
- [ ] **Step 3:** Run `pnpm --filter web build`
- [ ] **Step 4:** Review final diff and confirm unrelated migration-guard changes were not touched.
