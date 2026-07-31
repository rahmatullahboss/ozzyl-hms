# Billing Counter Canonical Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fully project billing-counter invoice creation, immediate payment, and deposit deduction into canonical financial tables while keeping legacy authoritative and non-blocking in shadow mode.

**Architecture:** Add a focused billing-counter canonical settlement orchestrator that reuses the existing `issueInvoice`, `collectPayment`, and `applyDeposit` commands. Shadow mode commits legacy first and then applies the canonical sequence idempotently; strict mode remains credit-only until a future composite atomic command exists. Repair historical canonical deposit receipt/deposit mappings using the existing controlled backfill pipeline before production promotion.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Vitest, node:sqlite, Wrangler.

## Global Constraints

- Legacy financial tables remain authoritative.
- `writePolicy=shadow` must never block a user-facing billing mutation.
- Canonical failures must be recorded in `canonical_processing_issues` without raw PHI.
- No schema migration is required.
- Tenant 100 only for live canonical financial projection.
- Production rollout must use immutable Worker versions, 0% candidate verification, then staged traffic promotion.

---

### Task 1: Canonical billing-counter settlement orchestrator

**Files:**
- Create: `src/lib/canonical/billing-counter-settlement.ts`
- Test: `test/canonical/billing-counter-settlement.test.ts`

**Interfaces:**
- Consumes: billing-counter invoice/payment/deposit source data and existing canonical command APIs.
- Produces: `projectBillingCounterSettlement(db, input)` returning invoice, payment, and deposit application command results.

- [ ] Write a failing SQLite-backed test proving a paid invoice creates canonical invoice, receipt, tender, allocation, and correct invoice balance.
- [ ] Write a failing test proving deposit deduction allocates FIFO across available canonical deposits and updates invoice/deposit balances.
- [ ] Implement the minimal orchestrator using existing deterministic projection builders and commands.
- [ ] Verify idempotent replay produces no duplicate canonical rows.

### Task 2: Wire billing-counter route to real canonical settlement

**Files:**
- Modify: `src/routes/tenant/billingCounter.ts`
- Modify: `test/integration/routes/tenant-100-strict-financial.test.ts`

**Interfaces:**
- Consumes: `projectBillingCounterSettlement`.
- Produces: billing-counter canonical callback that projects invoice plus immediate settlement in shadow mode.

- [ ] Write a failing regression assertion requiring the settlement orchestrator in the route.
- [ ] Replace invoice-only canonical callback with settlement orchestration.
- [ ] Preserve the strict credit-only guard because sequential commands are not one strict atomic batch.
- [ ] Run focused route and canonical tests.

### Task 3: Historical canonical deposit repair

**Files:**
- Reuse: `scripts/canonical/backfill-deposit-receipts.ts`
- Reuse: `scripts/canonical/backfill-adjustments.ts`
- Add tests only if production evidence exposes a defect in those scripts.

- [ ] Read-only classify unresolved tenant-100 deposit issues.
- [ ] Run controlled deposit receipt backfill for active deposit liabilities.
- [ ] Rerun adjustment/deposit backfill so canonical deposits and mappings are created.
- [ ] Reconcile canonical deposit available balances against legacy deposit balance aggregates.
- [ ] Keep unsupported adjustment/refund lifecycle rows in the issue queue unless their exact canonical lifecycle mapping can be proven.

### Task 4: Verification and production rollout

**Files:**
- No migration files.

- [ ] Run focused canonical tests, TypeScript, canonical governance, and full build.
- [ ] Commit and push the release branch.
- [ ] Upload an immutable Worker candidate and install it at 0% beside the current stable version.
- [ ] Verify candidate health/version and authenticated read-only smoke.
- [ ] Transition tenant 100 from strict v5 to non-blocking shadow with exact pre/post-state checks.
- [ ] Execute a controlled paid billing-counter smoke and verify legacy plus canonical invoice/payment rows.
- [ ] Promote 5% → 50% → 100%, retaining the previous Worker at 0% for rollback.
- [ ] Run post-deployment reconciliation and record remaining historical canonical issues separately from runtime settlement success.
