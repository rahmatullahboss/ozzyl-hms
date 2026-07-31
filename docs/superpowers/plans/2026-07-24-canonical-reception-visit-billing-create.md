# Canonical Reception Visit Billing Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `reception.visit-billing.create` so disabled/shadow modes preserve the current visit-service billing workflow and strict mode atomically commits guarded legacy and canonical service/invoice authority.

**Architecture:** Extract the current compatibility mutation into a reception-specific adapter, add a composite canonical command for visit-service requests/events plus a discount-aware invoice, and make the route an orchestration layer around `executeStrictFinancialMutation()`. Keep request idempotency, scheme evaluation, post-commit finance side effects and the response contract at route level.

**Tech Stack:** TypeScript, Hono, Cloudflare D1 prepared statements/batches, Vitest, Node SQLite production-schema fixtures, canonical command batch/idempotency/source-mapping helpers.

## Global Constraints

- Start from reviewed local `main` `31b3ca6be0812dad46393cf6cbe43f6d5143c483` in `fix/canonical-reception-visit-billing-create-20260724`.
- Preserve the dirty owner root as read-only.
- No push, deploy, production migration, backfill, feature-flag change, traffic change or tenant-data mutation.
- Disabled and shadow behavior must preserve the original SQL order, temporary-claim reset and response.
- Strict-only canonical and financial assertion preparation must be lazy.
- Every strict compatibility mutation that must affect one row is followed by a financial batch assertion.
- Use TDD: run each new test in RED before implementing production code.
- Commit each independently verified slice.
- Do not spawn or delegate another agent.

---

### Task 1: Composite canonical reception visit billing command

**Files:**
- Create: `test/canonical/create-reception-visit-billing.test.ts`
- Create: `src/lib/canonical/commands/create-reception-visit-billing.ts`

**Interfaces:**
- Consumes: `runCanonicalBatch`, `readCanonicalCommandReplay`, `prepareInvoiceSettlementBatch`, `prepareCanonicalBillingServiceMapping`, `buildLegacyLiveInvoiceSourceLineId`, deterministic source IDs/evidence and financial assertions.
- Produces: `createReceptionVisitBilling(db, input, execution)` and the line/result interfaces defined in the design.

- [ ] **Step 1: Write the failing command tests**

Cover:

```ts
it('atomically commits two visit-service requests, accepted events and a discounted invoice')
it('allows a fully discounted invoice with zero final total')
it('replays identical evidence and conflicts on changed evidence')
it('rolls back canonical facts when an authoritative legacy statement fails')
it('uses the legacy invoice source-line identity for every service line')
it('fails before batching when the mapped encounter is unavailable or belongs to another patient')
```

The SQLite harness must include the canonical foundation tables, billing service catalog/mappings, a mapped active encounter and `visit_services` source rows.

- [ ] **Step 2: Run the command test in RED**

Run:

```bash
pnpm vitest run test/canonical/create-reception-visit-billing.test.ts
```

Expected: fail because `create-reception-visit-billing.ts` does not exist.

- [ ] **Step 3: Implement the minimal composite command**

Implement these public inputs:

```ts
export interface CreateReceptionVisitBillingLineInput {
  lineNumber: number;
  visitServiceId: number;
  billingServiceItemId: number;
  serviceType: string;
  description: string;
  legacyReferenceId: number | null;
  quantity: number;
  lineTotalMinor: number;
}

export interface CreateReceptionVisitBillingInput {
  tenantId: string;
  commandIdempotencyKey: string;
  invoiceNo: string;
  legacyPatientId: number;
  legacyVisitId: number;
  issuedAtUtc: string;
  businessDate: string;
  billDiscountMinor: number;
  lines: readonly CreateReceptionVisitBillingLineInput[];
}
```

Validate unique line numbers and visit-service IDs, positive service IDs/quantities, non-negative minor amounts, normalized UTC/business date, non-empty source strings and `billDiscountMinor <= subtotalMinor`.

Resolve the encounter through the mapped `legacy_visit` source and verify active status and patient identity. Prepare unique billing-service mappings. For each line create deterministic request/event IDs from `visitServiceId`, canonical source mappings to `visit_services`, request/event outbox records and a service invoice line whose source identity is:

```ts
buildLegacyLiveInvoiceSourceLineId({
  lineNumber,
  itemCategory: serviceType,
  referenceId: legacyReferenceId,
})
```

Add one negative `RECEPTION_BILL_DISCOUNT` invoice line when needed. Use one outer `runCanonicalBatch()` and pass `execution.authoritativeStatements` unchanged.

- [ ] **Step 4: Run command and regression tests in GREEN**

Run:

```bash
pnpm vitest run test/canonical/create-reception-visit-billing.test.ts test/canonical/issue-invoice-settlement.test.ts test/canonical/service-operations-commands.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run TypeScript and commit**

Run:

```bash
pnpm exec tsc --noEmit
```

Commit exact files with:

```text
feat(canonical): add reception visit billing command
```

---

### Task 2: Original and strict reception visit-billing adapter

**Files:**
- Create: `test/canonical/reception-visit-billing.test.ts`
- Create: `src/lib/canonical/reception-visit-billing.ts`
- Modify: `src/lib/canonical/legacy-table-disposition.ts` only if governance requires a narrow adapter allowance.

**Interfaces:**
- Consumes: validated visit/service/discount-allocation evidence and an invoice-number dependency.
- Produces: `executeReceptionVisitBillingOriginalLegacy`, `prepareReceptionVisitBillingStrictContext`, `prepareReceptionVisitBillingStrictStatements`, `ReceptionVisitBillingContext` and `ReceptionVisitBillingError`.

- [ ] **Step 1: Write original-flow RED tests**

Prove the original executor:

- uses one bulk pending-service claim;
- conditionally inserts the bill after full claim;
- preserves discount allocations, invoice-item reference rules, service linkage, lab commission linkage and lab-order linkage;
- preserves the final failed-bill temporary-claim reset;
- performs no canonical-table read or assertion preparation;
- returns the committed bill ID and exact context.

- [ ] **Step 2: Run original-flow tests in RED**

Run:

```bash
pnpm vitest run test/canonical/reception-visit-billing.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the original executor**

Copy the production SQL shape and statement order from the current route. Keep `billLookupSql`, `lab_order_item` reference selection and reset behavior exact. Convert only route-specific HTTP errors into `ReceptionVisitBillingError` with historical status codes.

- [ ] **Step 4: Write strict-preparation and strict-batch RED tests**

Add tests proving:

- missing encounter mapping rejects before `nextInvoiceNo`;
- missing service mapping rejects before `nextInvoiceNo`;
- item arithmetic mismatch rejects before `nextInvoiceNo`;
- full discount remains valid;
- two services plus one lab reference commit atomically;
- service amount, patient, reference, status or bill linkage race rolls back every row;
- lab-order reference race rolls back every row;
- production `trg_bills_insert_accounting_event` creates exactly one event and rolls back with the transaction;
- financial assertion rows are empty after success and rollback.

- [ ] **Step 5: Implement strict preparation and statements**

Strict preparation must re-read active encounter and source/catalog evidence before invoice allocation. Strict statements must use per-service guarded claims and assertions, guarded bill insertion, allocation/item/link assertions, optional lab-order assertion and final assertion cleanup.

Do not include the original reset statement in strict mode; transaction rollback restores claims on failure.

- [ ] **Step 6: Run adapter and regression tests in GREEN**

Run:

```bash
pnpm vitest run test/canonical/reception-visit-billing.test.ts test/canonical/create-reception-visit-billing.test.ts test/reception-integrity-hardening.test.ts
```

Expected: all pass.

- [ ] **Step 7: Run static/governance gates and commit**

Run:

```bash
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
```

Commit exact files with:

```text
feat(canonical): guard reception visit billing
```

---

### Task 3: Route integration through strict financial coordination

**Files:**
- Modify: `src/routes/tenant/reception.ts`
- Create: `test/integration/routes/reception-visit-billing-canonical.test.ts`
- Modify: `test/integration/routes/reception.test.ts`
- Modify: `test/reception-integrity-hardening.test.ts`

**Interfaces:**
- Consumes: Task 1 command and Task 2 adapter.
- Produces: integrated `POST /visits/:visitId/generate-bill` orchestration.

- [ ] **Step 1: Write route source/runtime RED tests**

Assert that the handler:

- removes the direct strict blocker;
- contains `executeStrictFinancialMutation()` with boundary `reception.visit-billing.create`;
- invokes the original executor only from `legacyExecutor`;
- prepares strict statements lazily;
- passes `execution.authoritativeStatements` to `createReceptionVisitBilling()`;
- contains no create-handler `INSERT INTO bills` or `INSERT INTO invoice_items` SQL;
- preserves idempotency replay and the existing response;
- shadow mode returns `201` when canonical mapping fails and records the shadow issue;
- strict missing mapping returns sanitized `409` before invoice allocation;
- strict mapped multi-service request succeeds;
- reloads actual bill and ordered invoice-item IDs before post-commit side effects.

- [ ] **Step 2: Run the route tests in RED**

Run:

```bash
pnpm vitest run test/integration/routes/reception-visit-billing-canonical.test.ts test/integration/routes/reception.test.ts
```

Expected: new integration assertions fail against the direct handler.

- [ ] **Step 3: Refactor the handler**

Keep common visit, pending-service, discount and scheme validation before the coordinator. Build `ReceptionVisitBillingPreparationInput` without allocating an invoice number.

Use refs for the selected mode context and legacy bill ID. After execution, reload the bill by tenant/invoice and reload active invoice items ordered by ID. In strict mode require the invoice-item count to equal service count and pass actual item IDs to finalization.

Use:

```ts
skipBillAccountingEvent: financialExecution.mode === 'strict'
```

Map strict assertion/canonical conflicts to a sanitized `409`. Preserve historical validation and idempotency errors.

- [ ] **Step 4: Run route and existing reception suites in GREEN**

Run:

```bash
pnpm vitest run test/integration/routes/reception-visit-billing-canonical.test.ts test/integration/routes/reception.test.ts test/reception-integrity-hardening.test.ts test/integration/routes/billing-scheme-audit-coverage.test.ts
```

Expected: all pass.

- [ ] **Step 5: Run TypeScript and commit**

Run:

```bash
pnpm exec tsc --noEmit
```

Commit exact files with:

```text
feat(canonical): integrate reception visit billing
```

---

### Task 4: Coverage, shadow isolation and continuation metadata

**Files:**
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`
- Modify: `test/integration/routes/financial-shadow-route-isolation.test.ts`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

**Interfaces:**
- Consumes: integrated route and adapter.
- Produces: registry status `integrated`, shadow source contract and CDB-117 continuation expectation.

- [ ] **Step 1: Write/update coverage expectations**

Change the registry expectation to:

```ts
{
  boundary: 'reception.visit-billing.create',
  status: 'integrated',
  routeFile: 'src/routes/tenant/reception.ts',
  canonicalCommand: 'createReceptionVisitBilling',
}
```

Remove reception from blocked alternate writers. Add a shadow-isolation test that extracts `executeReceptionVisitBillingOriginalLegacy()` and rejects canonical tables, financial assertions, mapping checks and strict predicates.

Update continuation expectations so only `settlement.finalize` remains.

- [ ] **Step 2: Run coverage tests**

Run:

```bash
pnpm vitest run test/canonical/financial-route-coverage.test.ts test/integration/routes/financial-shadow-route-isolation.test.ts test/canonical/main-based-continuation-contract.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run governance and commit**

Run:

```bash
pnpm canonical:check
pnpm exec tsc --noEmit
```

Commit exact files with:

```text
chore(canonical): register reception visit authority
```

---

### Task 5: Adversarial review, verification report and current-main integration

**Files:**
- Create: `docs/database/migration-runs/P11-reception-visit-billing-create-verification.md`
- Modify: `task-progress.yaml`
- Modify: tests only when an adversarial finding first receives a failing regression.

**Interfaces:**
- Consumes: all CDB-116 commits.
- Produces: verified clean task branch, current-main replay receipt and CDB-117 handoff.

- [ ] **Step 1: Perform adversarial review**

Audit:

- original SQL/order parity;
- invoice/source-line identity versus `recordBillFinalizationSideEffects()`;
- full-discount arithmetic;
- production bill trigger behavior;
- service and lab-reference races;
- duplicate source mappings and canonical command replay;
- idempotency after post-commit failures;
- route allowance ownership;
- patient/visit/encounter tenant isolation;
- no leaked SQL/patient details in strict errors.

For each defect, add a failing regression before changing production code and commit the verified fix separately.

- [ ] **Step 2: Run the focused gate**

Run the command, adapter, route, reception integrity, scheme, shadow, coverage and continuation suites together. Record exact file/test counts.

- [ ] **Step 3: Run full task-branch gates**

Run separately:

```bash
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm worktree:check -- --mode=task
pnpm build:web
pnpm build:patient
pnpm build:admin
```

Also confirm `git diff --check` and a clean task branch.

- [ ] **Step 4: Write report/tracker and commit**

The report must document original/shadow parity, strict authority, canonical command, trigger parity, adversarial findings, exact verification, safety statement and current-main replay requirement.

Update tracker:

```text
last_completed_checkpoint: CDB-116_reception_visit_billing_create_integrated
current_checkpoint: CDB-117-SETTLEMENT-FINALIZE-NEXT
remaining_runtime_boundaries:
  - settlement.finalize
```

Commit with:

```text
docs(canonical): record reception visit checkpoint
```

- [ ] **Step 5: Replay onto current local main and verify**

Use the dedicated clean main integration worktree. Replay only reviewed CDB-116 commits serially. Run the focused gate, full canonical suite, TypeScript, governance, migrations, integration worktree policy and all three builds again.

- [ ] **Step 6: Record the main integration receipt**

Update the report and tracker with current-main commit IDs and verification counts. Commit on local `main` with:

```text
docs(canonical): record reception visit main integration
```

Do not push or deploy.
