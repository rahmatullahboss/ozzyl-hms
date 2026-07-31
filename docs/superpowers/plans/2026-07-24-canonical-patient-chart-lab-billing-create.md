# Canonical Patient-Chart Lab Billing Create Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `patient-chart.lab-billing.create` with canonical lab service and invoice authority while preserving the exact quick-route legacy and shadow behavior.

**Architecture:** Extend the strict financial coordinator with a lazy async strict-statement factory. Add a patient-chart-specific adapter whose legacy executor preserves the current sequential order/item/bill workflow and whose strict path performs catalog/mapping preflight before preparing an atomic guarded batch; reuse `createLabOrderBilling()` for positive canonical authority.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Vitest, Node SQLite test adapter, existing canonical command/idempotency and financial assertion infrastructure.

## Global Constraints

- Base all work on local `main` commit `ee2c367a0c44d10698efb1a20a6aa36f46f1a036`.
- Work only on branch `fix/canonical-patient-chart-lab-billing-create-20260724` in its isolated worktree.
- Disabled and shadow modes must preserve the original patient-chart quick-lab mutation order, notes, instructions, bill fields and absence of `visit_services` writes.
- Strict-only catalog validation, sequence allocation, guarded predicates and canonical schema access must remain lazy until strict policy is resolved.
- Zero-total quick lab orders remain supported in disabled and shadow modes; strict mode fails closed before sequence allocation because zero-value canonical invoice semantics are outside this checkpoint.
- Do not change patient-chart radiology billing, commission formulas, accounting classification or lab result workflow.
- No deploy, push, production migration, backfill, feature-flag change, traffic movement, tenant mutation, observation, rollback or legacy retirement.
- Use TDD and commit every coherent checkpoint.

---

### Task 1: Async strict financial preparation

**Files:**
- Modify: `src/lib/canonical/strict-financial-mutation.ts:165-271`
- Modify: `test/canonical/strict-financial-mutation-isolation.test.ts`

**Interfaces:**
- Consumes: existing `executeStrictFinancialMutation()` policy resolution and canonical callback.
- Produces:

```ts
type StrictAuthoritativeStatements =
  | readonly CanonicalPreparedStatement[]
  | (() => readonly CanonicalPreparedStatement[])
  | (() => Promise<readonly CanonicalPreparedStatement[]>);
```

The existing `strictAuthoritativeStatements` input and bundled array metadata accept this type.

- [ ] **Step 1: Write RED async-factory tests**

Add one strict-mode test using:

```ts
const strictAuthoritativeStatements = vi.fn(async () => {
  await Promise.resolve();
  return strictStatements;
});
```

Assert the canonical callback receives the resolved statement array and is invoked after the factory resolves.

Add legacy and shadow tests whose async factory throws if called. Assert it is never invoked and the original legacy result remains unchanged.

- [ ] **Step 2: Run RED verification**

Run:

```bash
pnpm vitest run test/canonical/strict-financial-mutation-isolation.test.ts
```

Expected: TypeScript/test failure because the coordinator passes a promise instead of a resolved statement array.

- [ ] **Step 3: Implement async factory resolution**

Change the resolver to:

```ts
const resolveStrictAuthoritativeStatements = async (): Promise<readonly CanonicalPreparedStatement[]> => {
  const configured = input.strictAuthoritativeStatements
    ?? bundledLegacyStatements?.strictAuthoritativeStatements;
  if (typeof configured === 'function') return await configured();
  return configured ?? input.legacyStatements ?? [];
};
```

In strict mode, resolve it before invoking the canonical callback:

```ts
const authoritativeStatements = await resolveStrictAuthoritativeStatements();
return {
  mode: 'strict',
  result: await input.canonical({ authoritativeStatements }),
};
```

Do not evaluate the resolver in disabled or shadow branches.

- [ ] **Step 4: Run GREEN and compatibility verification**

Run:

```bash
pnpm vitest run \
  test/canonical/strict-financial-mutation-isolation.test.ts \
  test/canonical/strict-financial-mutation.test.ts \
  test/canonical/strict-financial-command-batch.test.ts
pnpm exec tsc --noEmit
```

Expected: all tests and TypeScript pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canonical/strict-financial-mutation.ts test/canonical/strict-financial-mutation-isolation.test.ts
git commit -m "refactor(canonical): await lazy strict preparation"
```

---

### Task 2: Patient-chart quick-lab adapter

**Files:**
- Create: `src/lib/canonical/patient-chart-lab-billing.ts`
- Create: `test/canonical/patient-chart-lab-billing.test.ts`

**Interfaces:**
- Consumes: `prepareFinancialBatchAssertion()`, `prepareClearFinancialBatchAssertions()`, D1 prepared statements and injected sequence/catalog dependencies.
- Produces:

```ts
export interface PatientChartLabRequestItem {
  labTestId: number;
  instructions: string | null;
}

export interface PatientChartResolvedLabItem {
  lineNumber: number;
  duplicateOrdinal: number;
  labTestId: number;
  billingServiceItemId: number | null;
  name: string;
  category: string | null;
  price: number;
  instructions: string | null;
}

export interface PatientChartLabBillingContext {
  tenantId: string;
  userId: number;
  patientId: number;
  visitId: number | null;
  orderingClinicianDoctorId: number | null;
  orderNo: string;
  invoiceNo: string;
  orderDate: string;
  orderedAtUtc: string;
  notes: string | null;
  total: number;
  categoryTotals: {
    testBill: number;
    doctorVisitBill: number;
    admissionBill: number;
    operationBill: number;
    medicineBill: number;
  };
  items: readonly PatientChartResolvedLabItem[];
}

export interface PatientChartLabBillingDependencies {
  nextOrderNo(): Promise<string>;
  nextInvoiceNo(): Promise<string>;
  resolveLabTest(labTestId: number): Promise<{
    id: number;
    name: string;
    category: string | null;
    price: number;
    billingServiceItemId: number | null;
  } | null>;
}

export async function executePatientChartLabOrderOriginalLegacy(
  db: D1Database,
  input: {
    tenantId: string;
    userId: number;
    patientId: number;
    visitId: number | null;
    orderingClinicianDoctorId: number | null;
    orderDate: string;
    orderedAtUtc: string;
    notes: string | null;
    requestItems: readonly PatientChartLabRequestItem[];
    dependencies: PatientChartLabBillingDependencies;
  },
): Promise<{ results: unknown[]; context: PatientChartLabBillingContext }>;

export async function preparePatientChartLabOrderStrictContext(
  input: Parameters<typeof executePatientChartLabOrderOriginalLegacy>[1],
): Promise<PatientChartLabBillingContext>;

export function preparePatientChartLabOrderStrictStatements(
  db: D1Database,
  context: PatientChartLabBillingContext,
): readonly D1PreparedStatement[];
```

- [ ] **Step 1: Write RED original-executor contract tests**

Use a deterministic fake D1 adapter that records SQL call order and returns configured insert IDs.

Assert:

- `nextOrderNo()` runs before the order insert;
- the order insert runs before `resolveLabTest()`;
- notes are bound to `lab_orders`;
- instructions are bound twice to each `lab_order_items` insert, matching the current route;
- `nextInvoiceNo()` runs after all item inserts;
- the bill, invoice items and order-link update follow in the original order;
- no `visit_services`, `canonical_financial_batch_assertions`, canonical table or strict catalog predicate appears.

Add a missing second-test fixture and assert the order header remains inserted before the failure, preserving current legacy semantics.

- [ ] **Step 2: Write RED strict-context tests**

Assert strict context preparation:

- resolves every test before either sequence callback;
- rejects missing tests before sequence allocation;
- rejects `total === 0` before sequence allocation;
- rejects any null `billingServiceItemId` before sequence allocation;
- allocates order then invoice identities only after validation;
- computes duplicate ordinals for repeated lab-test IDs;
- preserves notes and instructions.

- [ ] **Step 3: Write RED strict-statement runtime tests**

Create a real SQLite fixture containing:

- `patients`, `visits`, `lab_test_catalog`, `billing_service_departments`, `billing_service_items`;
- `lab_orders`, `lab_order_items`, `bills`, `invoice_items`;
- `canonical_financial_batch_assertions` from migration `0532`.

Assert the strict batch atomically inserts one order, every item, one bill, every invoice item and one order-to-bill link, then clears assertions.

Add stale catalog price, mismatched visit/patient and duplicate order/invoice tests. Each must leave all quick-lab financial and operational tables unchanged.

- [ ] **Step 4: Run RED verification**

Run:

```bash
pnpm vitest run test/canonical/patient-chart-lab-billing.test.ts
```

Expected: FAIL because the adapter module does not exist.

- [ ] **Step 5: Implement original executor and strict context**

Copy the exact current route SQL and mutation order into `executePatientChartLabOrderOriginalLegacy()`.

The original executor returns `[orderResult, billResult]` as coordinator results and returns a context built from actual catalog resolutions and generated identities.

Implement strict context as a separate preflight. Use `Math.round(price * 100)` only for validating exact two-decimal safety; keep legacy major-unit values in the guarded statements and canonical conversion in the route.

- [ ] **Step 6: Implement guarded strict statements**

Use order/invoice subqueries by tenant plus generated identity. Add one assertion immediately after each critical mutation.

Catalog guards must prove:

```sql
lab_test_catalog.id = ?
AND tenant matches
AND active
AND resolved billing_service_items.id = ?
AND active
AND billing service price = ?
```

Invoice-item identity must use `ORDER BY lab_order_items.id LIMIT 1 OFFSET duplicateOrdinal`.

Finish with `prepareClearFinancialBatchAssertions()`.

- [ ] **Step 7: Run GREEN and regression verification**

Run:

```bash
pnpm vitest run \
  test/canonical/patient-chart-lab-billing.test.ts \
  test/canonical/lab-billing-finalization.test.ts \
  test/canonical/create-lab-order-billing.test.ts
pnpm exec tsc --noEmit
```

Expected: all tests and TypeScript pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/canonical/patient-chart-lab-billing.ts test/canonical/patient-chart-lab-billing.test.ts
git commit -m "feat(canonical): guard patient chart lab billing"
```

---

### Task 3: Route integration and canonical authority

**Files:**
- Modify: `src/routes/tenant/patients.ts:2726-2843`
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `docs/database/legacy-table-disposition.yaml`
- Create: `test/integration/routes/patient-chart-lab-canonical.test.ts`
- Modify: `test/integration/routes/financial-shadow-route-isolation.test.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`
- Modify: `test/integration/routes/patient-chart-workspace.test.ts` only where strict/shadow behavior needs executable coverage.

**Interfaces:**
- Consumes: Task 1 async strict factory, Task 2 adapter, `createLabOrderBilling()`, `toMinorUnits()`, `loadCanonicalBillPerformerItems()` and existing post-commit helpers.
- Produces: integrated `patient-chart.lab-billing.create` boundary.

- [ ] **Step 1: Write RED route source-contract tests**

Assert the quick-lab handler:

- no longer calls `assertStrictFinancialBoundaryDisabledOrSupported()` for this boundary;
- calls `executeStrictFinancialMutation()`;
- uses `executePatientChartLabOrderOriginalLegacy()` as `legacyExecutor`;
- uses an async `strictAuthoritativeStatements` factory;
- invokes `createLabOrderBilling()` only inside the canonical callback;
- resolves committed IDs by `orderNo` and `invoiceNo` after the coordinator;
- does not add `visit_services` to the quick route.

- [ ] **Step 2: Write RED behavior tests**

Extend the patient-chart mock to support canonical policy modes.

Assert:

- disabled mode still returns `201`, preserves notes/instructions and records the bill-created accounting event;
- shadow canonical failure still returns `201` with the committed order/bill response;
- strict zero-total or missing mapping returns `409` before any order/bill insert;
- strict positive path delegates authoritative statements to `createLabOrderBilling()`.

- [ ] **Step 3: Run RED verification**

Run:

```bash
pnpm vitest run \
  test/integration/routes/patient-chart-lab-canonical.test.ts \
  test/integration/routes/patient-chart-workspace.test.ts \
  test/canonical/financial-route-coverage.test.ts
```

Expected: failures because the route remains blocked and direct.

- [ ] **Step 4: Integrate the route**

Keep patient and active-visit reads. Build dependency callbacks around:

```ts
getNextSequence(c.env.DB, tenantId, 'lab_order', 'LAB')
getNextInvoiceNumber(c.env.DB, tenantId, 'diagnostic')
resolveLabTestBillingRow(c.env.DB, tenantId, labTestId)
```

Use a shared `PatientChartLabBillingContext | null` populated by the legacy executor or async strict factory.

In the canonical callback, require the context and map each item to:

```ts
{
  lineNumber,
  duplicateOrdinal,
  labTestId,
  billingServiceItemId,
  name,
  category,
  grossMinor: Number(toMinorUnits(price)),
  discountMinor: 0,
}
```

Invoke `createLabOrderBilling()` with the strict authoritative statements supplied by the coordinator.

After commit, load order, bill and item identities by generated numbers. Preserve the existing response and audit payload.

- [ ] **Step 5: Preserve post-commit side effects**

Call `recordBillFinalizationSideEffects()` with:

```ts
skipBillAccountingEvent: financialExecution.mode === 'strict'
```

Load canonical performer items and map the quick-route item identities before reserve/commission calculation. Keep `accrueLabOrderDoctorCommissions()`, accounting queue scheduling and audit logging after the financial commit.

Do not swallow existing quick-route side-effect errors unless the current route already does so.

- [ ] **Step 6: Update route registry and governance**

Set:

```ts
FINANCIAL_ROUTE_COVERAGE['patient-chart.lab-billing.create'] = {
  status: 'integrated',
  canonicalCommand: 'createLabOrderBilling',
  ...
};
```

Remove this boundary from `alternateWriterCoverage` expectations.

Move only the exact `bills` allowance attributable to quick lab billing to `src/lib/canonical/patient-chart-lab-billing.ts`. Preserve route-file allowances needed by patient-chart radiology.

- [ ] **Step 7: Run focused GREEN verification**

Run:

```bash
pnpm vitest run \
  test/canonical/strict-financial-mutation-isolation.test.ts \
  test/canonical/patient-chart-lab-billing.test.ts \
  test/canonical/create-lab-order-billing.test.ts \
  test/canonical/financial-route-coverage.test.ts \
  test/canonical/schema-governance.test.ts \
  test/integration/routes/patient-chart-lab-canonical.test.ts \
  test/integration/routes/patient-chart-workspace.test.ts \
  test/integration/routes/financial-shadow-route-isolation.test.ts
pnpm exec tsc --noEmit
pnpm canonical:check
```

- [ ] **Step 8: Review and commit**

Verify the diff contains no quick-route `visit_services` write, no strict preflight in legacy/shadow, no zero-value global invoice rule change and no radiology change.

Commit:

```bash
git add \
  src/routes/tenant/patients.ts \
  src/lib/canonical/financial-route-coverage.ts \
  docs/database/legacy-table-disposition.yaml \
  test/integration/routes/patient-chart-lab-canonical.test.ts \
  test/integration/routes/financial-shadow-route-isolation.test.ts \
  test/integration/routes/patient-chart-workspace.test.ts \
  test/canonical/financial-route-coverage.test.ts
git commit -m "feat(canonical): integrate patient chart lab billing"
```

---

### Task 4: CDB-112 verification and continuation checkpoint

**Files:**
- Modify: `task-progress.yaml`
- Create: `docs/database/migration-runs/P11-patient-chart-lab-billing-create-verification.md`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

**Interfaces:**
- Produces: reviewed CDB-112 evidence and exact next action `patient-chart.radiology-billing.create`.

- [ ] **Step 1: Run full fresh verification**

Run:

```bash
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build
pnpm worktree:check -- --mode=task --allow-dirty
git diff --check
```

Record exact test-file, test and migration counts from the output.

- [ ] **Step 2: Perform final adversarial review**

Confirm:

- original legacy executor matches the pre-integration route order and SQL;
- async strict preparation is never called in legacy/shadow;
- strict zero/mapping failure happens before sequence allocation;
- strict authoritative and canonical facts share one batch;
- source mappings select actual committed quick-route item IDs;
- post-commit accounting is skipped only in strict mode;
- radiology route and production controls are untouched.

Fix every Critical or High finding and rerun affected gates.

- [ ] **Step 3: Write verification report and tracker**

Record implementation commits, architecture, failure behavior, fresh verification counts, production safety statement and remaining boundaries.

Set the next exact action to:

```text
design_and_integrate_patient_chart_radiology_billing_create_from_latest_reviewed_local_main
```

- [ ] **Step 4: Run continuation contract and commit**

Run:

```bash
pnpm vitest run test/canonical/main-based-continuation-contract.test.ts
git diff --check
```

Commit:

```bash
git add \
  task-progress.yaml \
  docs/database/migration-runs/P11-patient-chart-lab-billing-create-verification.md \
  test/canonical/main-based-continuation-contract.test.ts
git commit -m "docs(canonical): record patient chart lab checkpoint"
```

- [ ] **Step 5: Integrate locally and continue**

After the task branch is clean and verified, integrate the reviewed commits into the clean local `main` integration worktree, rerun full canonical/static/build gates on `main`, create a dedicated non-main worktree for `patient-chart.radiology-billing.create`, and continue without push or production action.
