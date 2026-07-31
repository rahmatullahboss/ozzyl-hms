# Canonical Pharmacy Billing Finalize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven development and execute tasks serially in the isolated worktree.

**Goal:** Integrate both `pharmacy.billing.finalize` workflows with atomic canonical invoice, settlement and inventory authority while preserving exact disabled/shadow behavior.

**Architecture:** Build one normalized composite canonical sale command and two route-specific legacy/strict adapters. Disabled/shadow execute exact original helpers; strict prepares read-only context, guarded legacy statements and canonical facts for one D1 batch.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Vitest, Node SQLite canonical fixtures.

## Global constraints

- Base: local `main` at `c376b108a`.
- Branch: `fix/canonical-pharmacy-billing-finalize-20260724`.
- Preserve both original legacy workflows and their compensation order.
- Strict-only validation and canonical reads stay lazy.
- Fractional quantities and zero-total sales remain legacy/shadow-only.
- Do not change pharmacy returns, purchase/GRN flows or unrelated CRUD.
- No push, deploy, production mutation, migration/backfill, flag change or observation.

---

### Task 1: Shared normalized pharmacy sale contracts

**Files:**
- Create: `src/lib/canonical/pharmacy-sale-types.ts`
- Create: `test/canonical/pharmacy-sale-types.test.ts`

**Produces:** source-kind, payment-mode, normalized item/context and canonical inventory mapping types; exact money/quantity validation helpers and tender mapping.

- [ ] Write RED tests for exact money conversion, integer quantities, payment identity and tender mapping.
- [ ] Implement minimal shared types/helpers.
- [ ] Run tests and TypeScript.
- [ ] Commit: `feat(canonical): define pharmacy sale contracts`.

---

### Task 2: Composite canonical sale command

**Files:**
- Create: `src/lib/canonical/commands/settle-pharmacy-sale.ts`
- Create: `test/canonical/settle-pharmacy-sale.test.ts`

**Produces:**

```ts
settlePharmacySale(db, input, execution?): Promise<CanonicalCommandResult<SettlePharmacySaleResult>>
```

- [ ] Write RED applied-command test with two items, global discount, card payment, credit due and linked stock movements.
- [ ] Add RED deposit-only/mixed settlement tests.
- [ ] Add RED actual invoice-item and stock-transaction mapping tests.
- [ ] Add RED replay/conflict and authoritative rollback tests.
- [ ] Implement deterministic service request/event/invoice/payment/deposit/inventory identities.
- [ ] Prepare invoice settlement through `prepareInvoiceSettlementBatch()`.
- [ ] Prepare canonical balance updates and linked `sale` movements from preflight balance/version.
- [ ] Add request/event/inventory outbox and source reconciliation statements.
- [ ] Run command, invoice, payment, deposit and inventory regression tests plus TypeScript.
- [ ] Commit: `feat(canonical): add pharmacy sale settlement command`.

---

### Task 3: Provisional conversion adapter

**Files:**
- Create: `src/lib/canonical/pharmacy-provisional-finalization.ts`
- Create: `test/canonical/pharmacy-provisional-finalization.test.ts`

- [ ] Write RED original-executor tests for claim, item/stock validation, stock-first mutation, invoice, optional deposit, status conversion and compensation.
- [ ] Write RED strict-preflight tests for quantity, money, mapping, balance and deposit parity before invoice sequence allocation.
- [ ] Write RED SQLite atomic tests for success, stock race, source-status race, deposit race and duplicate invoice.
- [ ] Implement exact original executor copied from the current route.
- [ ] Implement strict context and guarded statements.
- [ ] Run adapter/command regression and TypeScript.
- [ ] Commit: `feat(canonical): guard pharmacy provisional conversion`.

---

### Task 4: Prescription dispense adapter

**Files:**
- Create: `src/lib/canonical/pharmacy-prescription-finalization.ts`
- Create: `test/canonical/pharmacy-prescription-finalization.test.ts`

- [ ] Write RED original-executor tests for explicit selection, FEFO, stock-first mutation, invoice, optional deposit, prescription status and compensation.
- [ ] Write RED strict-preflight tests for source status, selected quantity, mapping, balance and deposit parity before invoice sequence allocation.
- [ ] Write RED SQLite atomic tests for success, stock race, status race, deposit race and duplicate invoice.
- [ ] Implement exact original executor and separate strict context/statements.
- [ ] Run adapter/command regression and TypeScript.
- [ ] Commit: `feat(canonical): guard pharmacy prescription dispense`.

---

### Task 5: Route integration

**Files:**
- Modify: `src/routes/tenant/pharmacy/advanced.ts`
- Create: `test/integration/routes/pharmacy-canonical-finalization.test.ts`
- Modify: `test/integration/routes/pharmacy-advanced-finalization.test.ts`
- Modify: `test/integration/routes/financial-shadow-route-isolation.test.ts`

- [ ] Write RED source contracts for both legacy executors, async strict factories and one canonical command.
- [ ] Add executable legacy regression, shadow canonical failure and strict preflight-no-mutation tests for both routes.
- [ ] Replace each direct block with coordinator execution and committed-context response.
- [ ] Preserve legacy error/status/compensation behavior inside original helpers.
- [ ] Convert strict conflicts to 409 without exposing internals.
- [ ] Run route and focused canonical tests plus TypeScript.
- [ ] Commit: `feat(canonical): integrate pharmacy finalization routes`.

---

### Task 6: Coverage and governance

**Files:**
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`
- Modify: `docs/database/legacy-table-disposition.yaml`
- Modify: `test/canonical/schema-governance.test.ts` only if exact expectations require it.

- [ ] Set the boundary `integrated` with command `settlePharmacySale` only after both routes are wired.
- [ ] Move exact compatibility-write allowances to the two adapter files.
- [ ] Confirm no finalization financial/stock/deposit SQL remains in the route blocks.
- [ ] Run route coverage, governance checker and shadow isolation tests.
- [ ] Commit: `chore(canonical): register pharmacy finalization authority`.

---

### Task 7: Verification and continuation

**Files:**
- Create: `docs/database/migration-runs/P11-pharmacy-billing-finalize-verification.md`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

- [ ] Run full canonical, TypeScript, governance, build, worktree and diff gates.
- [ ] Perform adversarial review of both historical flows, atomicity, inventory parity, deposit/payment semantics and source mappings.
- [ ] Record exact receipts and next action `radiology.billing.create`.
- [ ] Run continuation contract and commit: `docs(canonical): record pharmacy finalization checkpoint`.
- [ ] Integrate reviewed commits into clean local main and rerun full gates before creating the next worktree.
