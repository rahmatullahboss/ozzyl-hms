# Small-Hospital Reagent and Inventory Billing Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden billing-time reagent consumption for a small hospital without requiring LIS or analyzer integration.

**Architecture:** Keep `InventoryStock` and canonical inventory issues as quantity/cost truth. Add receipt normalization and QC quarantine at the inventory boundary, atomic source-linked reversal at cancellation, deduplicated exceptions, canonical-aware readiness, and consistent soft/strict billing behavior.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, SQLite-compatible SQL, Vitest, React frontend regression suite.

## Global Constraints

- Keep the default policy `soft + billing + allow_result_without_stock` unchanged.
- Do not add an LIS or analyzer dependency to billing-time deduction.
- Preserve generic inventory behavior for non-reagent items.
- Use additive migration `0409` and do not apply it remotely in this task.
- All high-risk changes require failing tests before implementation.
- Keep the dirty `abdullah` workspace untouched.

---

### Task 1: Schema support for source-linked reversals and exception deduplication

**Files:**
- Create: `migrations/0409_small_hospital_reagent_billing_hardening.sql`
- Modify: `tenant-schema.sql`
- Test: `test/inventory-reagent-billing-hardening-migration.test.ts`

**Interfaces:**
- Produces `lab_consumable_movements.reverses_movement_id`.
- Produces `lab_inventory_exceptions.occurrence_count` and `last_occurred_at`.
- Produces unique/index guards consumed by Tasks 3 and 4.

- [ ] Write a migration test that asserts the new columns and indexes exist and the migration does not alter tenant policy values.
- [ ] Run `pnpm vitest run test/inventory-reagent-billing-hardening-migration.test.ts` and verify it fails.
- [ ] Add migration `0409` and fresh-install schema equivalents.
- [ ] Run the migration test and `pnpm build:migrations`.
- [ ] Commit `feat: add reagent billing hardening schema`.

### Task 2: Normalize GR quantity/cost and quarantine canonical reagent lots

**Files:**
- Create: `src/lib/inventory-receipt-normalization.ts`
- Modify: `src/routes/tenant/inventory/gr.ts`
- Modify: `src/lib/lab-inventory-bridge.ts`
- Test: `test/inventory-receipt-normalization.test.ts`
- Test: `test/integration/routes/inventory/inventory-gr.test.ts`
- Test: `test/lab-inventory-bridge-db.test.ts`

**Interfaces:**
- Produces `normalizeInventoryReceiptLot({ receivedQuantity, freeQuantity, landedCostPerPurchaseUnit, unitConversionFactor, itemType })`.
- Returns `stockQuantity`, `costPerIssueUnit`, `qcStatus`, `stockStatus`.

- [ ] Add failing unit tests for factor `10`, free quantity conversion, cost division, factor `1`, invalid factor, and reagent/non-reagent QC states.
- [ ] Add failing route tests proving a lab reagent GR inserts canonical quantity in issue units with `QCStatus='pending'` and `StockStatus='blocked'`.
- [ ] Implement the normalization helper.
- [ ] Load `UnitConversionFactor`, `IssueUnit`, and `ItemType` during GR validation and use normalized values for canonical stock, stock transaction and lab bridge mirror.
- [ ] Preserve GR/PO financial quantities in purchase units.
- [ ] Run focused tests and commit `fix: normalize and quarantine reagent receipts`.

### Task 3: Make reagent cancellation reversal atomic and retry-safe

**Files:**
- Create: `src/lib/lab-consumable-reversal.ts`
- Modify: `src/lib/lab-consumables.ts`
- Modify: `src/lib/lab-consumables.js`
- Test: `test/lab-consumable-reversal-atomic.test.ts`
- Test: `test/lab-cancellation-workflow.test.ts`

**Interfaces:**
- Produces `reverseLabConsumableUsageAtomically(db, input)`.
- Each return movement uses `reverses_movement_id`.
- Canonical consumption rows are marked `OperationStatus='reversed'`.

- [ ] Add a SQLite-backed test with two source movements proving all stock/return rows roll back when the second assertion fails.
- [ ] Add retry tests proving completed reversal is idempotent and partial legacy return rows do not suppress missing reversals.
- [ ] Add a test proving reversed canonical issues are excluded from committed allocation lookup and claims/progress are reset after success.
- [ ] Implement batch statement construction with exact stock snapshots and source-linked return rows.
- [ ] Replace the sequential reversal implementation with the atomic service.
- [ ] Regenerate the JavaScript sibling using the repository's TypeScript build/transpile convention.
- [ ] Run focused tests and commit `fix: make reagent reversal atomic and idempotent`.

### Task 4: Deduplicate open inventory exceptions

**Files:**
- Modify: `src/lib/lab-consumables.ts`
- Modify: `src/lib/lab-consumables.js`
- Test: `test/lab-consumable-exception-deduplication.test.ts`

**Interfaces:**
- `recordLabInventoryException` upserts one open exception key and increments `occurrence_count`.

- [ ] Add failing DB tests for repeated same exception, different consumable/reason, and resolved-then-new occurrence.
- [ ] Implement open-exception upsert with backward-compatible fallback for pre-0409 schemas.
- [ ] Run focused tests and commit `fix: deduplicate reagent inventory exceptions`.

### Task 5: Count canonical reagent lots in readiness

**Files:**
- Modify: `src/lib/lab-inventory-policy.ts`
- Modify: `src/lib/lab-inventory-policy.js`
- Test: `test/lab-consumable-stock-lifecycle-db.test.ts`

**Interfaces:**
- `getLabInventoryStrictModeReadiness` reports canonical and unlinked legacy stock without double-counting mirrors.

- [ ] Add failing tests for canonical usable stock, canonical after-open risk, pending canonical QC, and linked mirror non-duplication.
- [ ] Replace legacy-only stocked/onboard queries with combined canonical+unlinked-legacy queries.
- [ ] Expand shortage exception count to include known stock-shortage reason aliases.
- [ ] Run focused tests and commit `fix: include canonical reagent stock in readiness`.

### Task 6: Apply strict/soft policy consistently in all billing entry points

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts`
- Test: `test/integration/routes/billing-counter.test.ts`
- Test: `test/billing-reagent-alerts.test.ts`

**Interfaces:**
- General billing counter consumes with the same `LabInventoryPolicy` used by prescription lab billing.

- [ ] Add failing tests proving soft mode returns warnings and strict mode propagates a billing-time consumption failure.
- [ ] Load policy once in the general billing helper, use its mapping requirement, and call `shouldBlockLabInventoryException` before converting an error to a warning.
- [ ] Run focused tests and commit `fix: align billing reagent policy enforcement`.

### Task 7: A-to-Z audit documentation and regression verification

**Files:**
- Create: `docs/reports/2026-07-10-small-hospital-reagent-inventory-review.md`
- Modify: `docs/qa/inventory-test-coverage.md`
- Modify: `package.json` only if new tests are not already included by existing patterns.

**Interfaces:**
- Documents current architecture, fixed gaps, remaining P2 work, phase-1 operating SOP and LIS/hybrid transition criteria.

- [ ] Run focused tests from Tasks 1–6.
- [ ] Run `pnpm build:migrations`.
- [ ] Run `pnpm exec tsc --noEmit`.
- [ ] Run `pnpm test:inventory`.
- [ ] Run `pnpm --filter web build`.
- [ ] Run `git diff --check`.
- [ ] Write the review report with evidence and explicit remaining risks.
- [ ] Commit `docs: record reagent inventory best-practice review`.

### Task 8: Merge readiness review

**Files:**
- Review all branch changes against the design and plan.

- [ ] Verify no tenant policy, remote database, deployment or LIS primary-trigger change occurred.
- [ ] Verify the original dirty workspace remains untouched.
- [ ] Perform adversarial review for double deduction, double reversal, partial batch, unit mismatch, QC bypass and false readiness.
- [ ] Fix any Critical/Important finding with tests.
- [ ] Re-run the full verification commands before reporting completion.
