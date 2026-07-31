# Inventory and Reagent Integrity Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent partial/double reagent deductions, make stock/ledger/QC/expiry rules consistent, populate inventory demand intelligence, and harden reagent lot/config validation without breaking existing HMS API contracts.

**Architecture:** Preserve `InventoryStock` as the quantity source of truth. Add one shared lot policy, derive reagent retry state from canonical inventory consumption plus per-mapping progress, keep legacy lab tables as compatibility projections, and add additive reconciliation/demand aggregation infrastructure.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Zod, Vitest, React/Vite frontend tests.

## Global Constraints

- Work in `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/main-shareholder-merge` on the clean `main` worktree.
- Do not modify the dirty `abdullah` worktree.
- Preserve existing routes and response contracts unless a backward-compatible field is added.
- `InventoryStock` is authoritative for linked reagent quantity.
- Fail closed with HTTP 409 for concurrent quantity changes and HTTP 400 for invalid lot metadata.
- Use TDD for every behavior change.
- Keep reagent mode soft until reconciliation is clean.

---

### Task 1: Shared inventory lot policy

**Files:**
- Create: `src/lib/inventory-lot-policy.ts`
- Modify: `src/lib/inventory-core.ts`
- Modify: `src/lib/inventory-intelligence/recompute.ts`
- Test: `test/inventory-lot-policy.test.ts`
- Test: `test/inventory-core-qc-gates.test.ts`
- Test: `test/unit/inventory-intelligence-forecast.test.ts`

**Interfaces:**
- Produces: `isInventoryLotUsable(row, options)`, `getInventoryUsableQuantity(row)`, `getInventoryLotBlockReason(row, quantity, options)`.
- Consumers: inventory issue service, reagent stock lookup and intelligence recompute.

- [ ] Write failing tests proving same-day expiry is blocked everywhere, `not_required` QC is accepted, after-open expiry is blocked, and reserved/damaged/blocked quantities reduce usable stock.
- [ ] Run the three targeted test files and confirm failures expose the current policy divergence.
- [ ] Implement the shared policy with normalized status/QC/date handling.
- [ ] Refactor `inventory-core.ts` and `recompute.ts` to delegate to the shared policy.
- [ ] Run targeted tests and confirm all pass.

### Task 2: Canonical issue balance and concurrency guards

**Files:**
- Modify: `src/lib/inventory-issue-service.ts`
- Test: `test/integration/routes/inventory/inventory-issues-edge-cases.test.ts`
- Test: `test/inventory-audit-logging.test.ts`

**Interfaces:**
- Consumes: shared lot policy from Task 1.
- Produces: ledger `BalanceQuantity` based on canonical available quantity and guarded stock mutation against reservation/damage/block state.

- [ ] Add failing tests where reserved quantity changes after allocation, and where available=100/reserved=10/issue=20 must write ledger balance 80.
- [ ] Run the targeted tests and confirm current behavior fails.
- [ ] Change allocation records to carry both `availableBefore` and `usableBefore`.
- [ ] Guard the stock update using the loaded available, reserved, damaged and blocked values plus shared policy statuses.
- [ ] Calculate ledger/audit `AvailableQuantity` from canonical available balance, not usable balance.
- [ ] Run targeted tests and confirm all pass.

### Task 3: Reagent progress and demand migration

**Files:**
- Create: `migrations/0400_inventory_reagent_integrity_hardening.sql`
- Test: `test/inventory-reagent-integrity-migration.test.ts`

**Interfaces:**
- Produces tables:
  - `lab_consumable_mapping_progress`
  - `inventory_demand_source_event`
- Adds unique indexes for mapping progress and demand event dedupe.

- [ ] Write a migration contract test asserting the tables, expected/committed/projected quantities, lifecycle status, source-event unique key and tenant-scoped indexes.
- [ ] Run the test and confirm it fails because migration 0400 does not exist.
- [ ] Add the additive migration using `CREATE TABLE IF NOT EXISTS` and `CREATE UNIQUE INDEX IF NOT EXISTS`.
- [ ] Run the migration test and migration manifest build.

### Task 4: Retry-safe mapped reagent consumption

**Files:**
- Modify: `src/lib/lab-consumables.ts`
- Test: `test/lab-consumables-hardening.test.ts`
- Test: `test/lab-consumable-stock-lifecycle-db.test.ts`
- Test: `test/lab-consumables-automation.test.ts`

**Interfaces:**
- Produces internal helpers:
  - `loadCanonicalCommittedQuantityForMapping(...)`
  - `loadProjectedLabMovementQuantity(...)`
  - `upsertMappingProgress(...)`
  - `projectMissingLabMovement(...)`
- Completion means every mandatory mapping has committed quantity equal to expected quantity.

- [ ] Add a failing test where mapping A is consumed, mapping B fails, and retry consumes only mapping B.
- [ ] Add a failing test where canonical issue succeeds but movement projection fails; retry must backfill projection without deducting stock again.
- [ ] Add a failing duplicate-submit test proving a completed order item returns zero new usage.
- [ ] Replace the early `hasExistingConsumptionForOrderItem` completion shortcut with per-mapping expected/committed/projected reconciliation.
- [ ] For canonical inventory-linked reagents, derive committed quantity from `InventoryConsumption` + `InventoryConsumptionItem` using tenant, `IssueType='lab_consumption'`, `LabOrderId`, `BillingReferenceId=labOrderItemId`, and inventory item.
- [ ] Consume only `expected - committed`; after canonical commit, insert/backfill only the missing lab movement projection.
- [ ] Persist progress after every mapping; mark outer claim committed only when all mandatory mappings are complete.
- [ ] Retain failed claims for retry and create one deduplicated/open exception per failure reason/order item.
- [ ] Run the reagent test group and confirm all pass.

### Task 5: Reagent reconciliation endpoint

**Files:**
- Create: `src/lib/lab-reagent-reconciliation.ts`
- Modify: `src/routes/tenant/labMonitoring.ts`
- Test: `test/lab-reagent-reconciliation.test.ts`
- Test: `test/integration/routes/inventory/inventory-api-permission-guards.test.ts`

**Interfaces:**
- Produces: `reconcileLabReagentOrderItem(db, input)` and `GET /api/lab-monitoring/inventory-reconciliation`.
- Response fields: `orderItemId`, `expectedQuantity`, `canonicalCommittedQuantity`, `projectedQuantity`, `status`, `issues`.

- [ ] Add failing unit tests for complete, partial canonical, missing projection and duplicate projection cases.
- [ ] Add route permission test requiring lab inventory manager/admin access.
- [ ] Implement reconciliation queries and severity classification without destructive repair.
- [ ] Add route filters for status and optional order item id.
- [ ] Run targeted tests.

### Task 6: Demand aggregation and intelligence status

**Files:**
- Create: `src/lib/inventory-intelligence/demand.ts`
- Modify: `src/lib/inventory-issue-service.ts`
- Modify: `src/lib/inventory-intelligence/recompute.ts`
- Modify: `src/routes/tenant/inventory/intelligence.ts`
- Test: `test/unit/inventory-intelligence-demand.test.ts`
- Test: `test/unit/inventory-intelligence-route-helpers.test.ts`

**Interfaces:**
- Produces: `recordInventoryDemand(db, { tenantId, itemId, demandDate, quantity, sourceType, sourceId })`.
- Uses `inventory_demand_source_event` for idempotency and upserts `inventory_demand_daily`.

- [ ] Add failing tests proving duplicate source events count once and separate events aggregate by day/item.
- [ ] Implement event claim then daily upsert for final consumption movement types only.
- [ ] Call demand recording after committed inventory issue lines, using a stable source id derived from consumption item id.
- [ ] Update intelligence status so snapshots with no demand events show `not_configured`/learning rather than a trusted ready forecast.
- [ ] Run targeted tests.

### Task 7: Reorder partial update hardening

**Files:**
- Modify: `src/routes/tenant/inventory/reorder.ts`
- Test: `test/integration/routes/inventory/reorder.test.ts`

**Interfaces:**
- Preserves omitted config fields and persists canonical formula `reorder_x2_minus_current`.

- [ ] Add failing tests for updating only vendor, only enabled state and only formula.
- [ ] Load the current item config before update.
- [ ] Bind each omitted field to its existing value instead of false/null/default.
- [ ] Keep alias input accepted but store the canonical formula.
- [ ] Run reorder tests.

### Task 8: Reagent lot metadata validation and direct adjustment safety

**Files:**
- Modify: `src/schemas/inventory.ts`
- Modify: `src/routes/tenant/inventory/gr.ts`
- Modify: `src/routes/tenant/inventory/stock.ts`
- Modify: `src/routes/tenant/inventory/importExport.ts`
- Test: `test/integration/routes/inventory/inventory-items.test.ts`
- Test: `test/integration/routes/inventory/inventory-gr.test.ts`
- Test: `test/integration/routes/inventory/inventory-stock.test.ts`
- Test: `test/integration/routes/inventory/inventory-import-export.test.ts`

**Interfaces:**
- `lab_reagent` item master requires `IsBatchRequired=true` and `IsExpiryRequired=true`.
- Stock creation requires caller-supplied batch/expiry when item policy requires them.

- [ ] Add failing item-master validation tests for reagent flags.
- [ ] Add failing GRN/opening-stock tests for missing required batch/expiry.
- [ ] Add failing adjustment-in test proving expiry is not fabricated.
- [ ] Add Zod `superRefine` validation for reagent flags.
- [ ] Validate item policy in GRN/import/adjustment before stock creation.
- [ ] Remove automatic one-year expiry generation; require explicit expiry for expiry-controlled items and permit null only for non-expiry items.
- [ ] Ensure new-stock plus ledger creation uses one D1 batch where possible; if the batch fails, no stock row remains.
- [ ] Run targeted tests.

### Task 9: Legacy projection and focused regression cleanup

**Files:**
- Modify: `src/lib/lab-inventory-bridge.ts`
- Modify: `test/lab-consumable-stock-out-hardening.test.ts`
- Test: `test/lab-inventory-bridge-db.test.ts`
- Test: `test/lab-inventory-bridge-contract.test.ts`

**Interfaces:**
- Inventory-linked lab stock is metadata/projection only; canonical quantity remains in `InventoryStock`.

- [ ] Update the stale manual stock-out expectation to include `movement_ids`.
- [ ] Add bridge tests proving linked stock reads canonical inventory quantity and legacy quantity is not independently consumed.
- [ ] Add explicit comments/fields marking compatibility projection behavior.
- [ ] Run focused bridge/reagent tests.

### Task 10: Full verification and review

**Files:**
- Modify if needed: `package.json`
- Modify: `docs/qa/inventory-test-coverage.md`
- Create: `docs/reports/2026-07-10-inventory-reagent-integrity-hardening.md`

**Interfaces:**
- `pnpm test:inventory` must include the main reagent hardening suites so future green runs cannot omit them.

- [ ] Extend `test:inventory` with reagent consumption, reconciliation, lot-policy, migration and intelligence-demand tests.
- [ ] Run targeted reagent tests.
- [ ] Run `pnpm test:inventory`.
- [ ] Run `pnpm build:migrations`.
- [ ] Run `pnpm --filter web build` if frontend types/contracts changed.
- [ ] Review the final diff for tenant scoping, raw SQL placeholders, migration compatibility and unrelated changes.
- [ ] Write the verification report with exact commands/results and remaining limitations.
