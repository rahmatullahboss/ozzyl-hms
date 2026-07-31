# Canonical Financial Writer Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover every tenant route that directly writes legacy invoice, payment or deposit authority and make unsupported alternate writers fail closed under canonical strict mode.

**Architecture:** Extend the existing typed strict-boundary registry rather than adding a second authority. A source-wide contract test scans tenant route files for direct SQL writers. Alternate flows remain unchanged in disabled/shadow mode but call the existing strict guard before mutation; later plans can replace each blocked entry with an atomic canonical adapter.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Vitest, Node filesystem APIs.

## Global Constraints

- Base all work on local `main` commit `0ac5c8e4206725386c4a2acc4ca325120e20493e`.
- Work only on branch `fix/canonical-financial-writer-coverage-20260723` in its isolated worktree.
- Preserve existing disabled and shadow behavior.
- Strict mode must reject unsupported routes before financial mutation.
- Do not invent canonical source mappings or identities.
- Do not deploy, push, migrate, backfill, change flags or mutate production.
- Use TDD and commit each coherent checkpoint.

---

### Task 1: Source-wide financial writer contract

**Files:**
- Modify: `test/canonical/financial-route-coverage.test.ts`

**Interfaces:**
- Consumes: `STRICT_FINANCIAL_BOUNDARIES` and `FINANCIAL_ROUTE_COVERAGE`.
- Produces: a recursive source scan that returns tenant route files containing direct inserts into `bills`, `payments`, or `billing_deposits`.

- [ ] **Step 1: Add recursive route discovery and expected new boundaries**

Add a helper that recursively reads `src/routes/tenant`, selects `.ts` files and detects:

```ts
/\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:bills|payments|billing_deposits)\b/i
```

Extend the expected boundary list with:

```ts
'appointment.billing.finalize',
'billing-provisional.finalize',
'ipd-discharge.billing.finalize',
'lab.billing.create',
'payment-gateway.verify',
'patient-chart.lab-billing.create',
'patient-chart.radiology-billing.create',
'pharmacy.billing.finalize',
'radiology.billing.create',
'reception.visit-billing.create',
'settlement.finalize',
```

Assert every discovered direct-writer file appears in at least one `FINANCIAL_ROUTE_COVERAGE` record.

- [ ] **Step 2: Add blocked-route guard assertions**

Assert each new boundary is `blocked_in_strict`, references the exact route file from the design, and the source contains:

```ts
assertStrictFinancialBoundaryDisabledOrSupported(..., '<boundary>')
```

Require two occurrences for `pharmacy.billing.finalize` because two independent finalization flows write deposits.

- [ ] **Step 3: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run test/canonical/financial-route-coverage.test.ts
```

Expected: failure because the new boundaries, registry records and guard calls do not exist.

---

### Task 2: Register unsupported alternate writers

**Files:**
- Modify: `src/lib/canonical/strict-financial-boundaries.ts`
- Modify: `src/lib/canonical/financial-route-coverage.ts`

**Interfaces:**
- Produces: nine new `StrictFinancialBoundary` literals and matching `blocked_in_strict` coverage records.

- [ ] **Step 1: Add boundary literals**

Insert the nine boundary names into `STRICT_FINANCIAL_BOUNDARIES` without changing existing names or order-sensitive behavior.

- [ ] **Step 2: Add coverage records**

For each boundary, add a `blocked_in_strict` record with the exact route path, `canonicalCommand: null`, and a reason explaining which composite legacy facts lack a reviewed atomic canonical adapter.

- [ ] **Step 3: Run the focused test**

Run the coverage test. Expected: it still fails only on missing route guard calls.

---

### Task 3: Guard every unsupported mutation before writes

**Files:**
- Modify: `src/routes/tenant/appointments.ts`
- Modify: `src/routes/tenant/billingProvisional.ts`
- Modify: `src/routes/tenant/ipBilling.ts`
- Modify: `src/routes/tenant/lab.ts`
- Modify: `src/routes/tenant/payments.ts`
- Modify: `src/routes/tenant/patients.ts`
- Modify: `src/routes/tenant/pharmacy/advanced.ts`
- Modify: `src/routes/tenant/radiology/orders.ts`
- Modify: `src/routes/tenant/reception.ts`
- Modify: `src/routes/tenant/settlements.ts`

**Interfaces:**
- Consumes: `assertStrictFinancialBoundaryDisabledOrSupported(db, tenantId, boundary)`.
- Produces: strict-mode fail-closed behavior with disabled/shadow compatibility.

- [ ] **Step 1: Import the strict guard in each route module**

Use the existing import path relative to each module. Do not add duplicate imports where the helper is already present.

- [ ] **Step 2: Add one guard per financial flow**

Place each call after tenant/user authentication and input parsing but before sequence allocation, claim-state changes, invoice insertion, payment insertion, deposit insertion, stock deduction, or any other financial mutation.

For `pharmacy/advanced.ts`, place a guard in both the provisional-conversion and prescription-dispense finalization handlers.

- [ ] **Step 3: Run the coverage test and verify GREEN**

Run:

```bash
pnpm exec vitest run test/canonical/financial-route-coverage.test.ts
```

Expected: all tests pass.

- [ ] **Step 4: Run affected route tests**

Run the existing appointment, provisional billing, IPD billing, lab, gateway payment, pharmacy, radiology, reception and settlement tests that are available in the repository. Fix only regressions caused by the new guards.

---

### Task 4: Verification, review and integration evidence

**Files:**
- Create: `docs/database/migration-runs/P10-financial-writer-coverage-verification.md`
- Modify: `task-progress.yaml`

**Interfaces:**
- Produces: current-main checkpoint evidence and an explicit list of blocked boundaries still requiring command integration.

- [ ] **Step 1: Run verification gates**

Run:

```bash
pnpm exec vitest run test/canonical/financial-route-coverage.test.ts test/canonical/strict-financial-policy.test.ts
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm exec vitest run test/canonical
```

Run the full production build if the canonical suite and TypeScript pass.

- [ ] **Step 2: Review the diff adversarially**

Check that every guard precedes the first mutation, no route is mislabeled integrated, no disabled/shadow behavior changes, and the recursive scan cannot match `bills_idempotency_keys` accidentally.

- [ ] **Step 3: Record evidence**

Document base/head commits, tests, source-wide writer count, new blocked boundaries, remaining strict blockers and confirmation that production mutation was false.

Update `task-progress.yaml` current-main source SHA, verification counts and remaining blocked boundaries without deleting historical evidence.

- [ ] **Step 4: Commit and merge locally**

Commit the verified branch. Re-check local `main` has not moved, merge the branch into local `main`, rerun the focused coverage test and TypeScript on the merged result, then remove the temporary worktree and branch. Do not push or deploy.
