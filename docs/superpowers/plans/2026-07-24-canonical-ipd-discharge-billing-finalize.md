# Canonical IPD Discharge Billing Finalize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `ipd-discharge.billing.finalize` so one strict financial mutation atomically commits guarded legacy discharge authority with canonical invoice settlement, deposit application/refund, invoice–encounter linkage and inpatient encounter completion.

**Architecture:** Add an explicit canonical invoice–encounter link and an IPD-specific composite command. Reuse invoice-settlement preparation without sequential command commits, allocate deposit application then refund from one deterministic source snapshot, and execute the existing discharge legacy writes through a row-count-guarded adapter supplied as authoritative statements to the strict coordinator.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, Vitest, Zod, canonical command-batch/idempotency/outbox infrastructure.

## Global Constraints

- Do not deploy, apply migrations, backfill, enable strict mode or mutate production.
- Work only in `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/canonical-ipd-discharge-billing-finalize-20260724` on `fix/canonical-ipd-discharge-billing-finalize-20260724`.
- Preserve current `/ip-billing/discharge-bill` request and response fields.
- Preserve disabled/shadow legacy behavior; strict-only projection must be built inside the canonical callback.
- Do not fabricate service events from provisional, package or bed identifiers.
- IPD ledger remains supplementary and post-commit.
- Every production code change follows TDD and ends in a checkpoint commit.
- Local merge to `main` only after fresh focused, full canonical, TypeScript, governance and build gates.

---

### Task 1: Explicit Invoice–Encounter Authority

**Files:**
- Create: `migrations/0535_canonical_invoice_encounter_links.sql`
- Modify: `src/lib/canonical/ipd-projection.ts`
- Modify: `test/canonical/ipd-projection.test.ts`
- Create: `test/canonical/invoice-encounter-link-schema.test.ts`

**Interfaces:**
- Produces table `canonical_invoice_encounter_links` with one discharge invoice per encounter.
- Produces projection behavior that unions explicit links with legacy service-line inference without duplicates.

- [ ] **Step 1: Write failing schema tests**

Create real-SQLite tests that apply canonical migrations and verify:

```ts
expect(tableColumns).toEqual(expect.arrayContaining([
  'tenant_id',
  'invoice_public_id',
  'encounter_public_id',
  'legacy_admission_id',
  'link_type',
  'source_evidence_sha256',
]));
```

Also verify duplicate invoice links, duplicate discharge links for one encounter, wrong-tenant foreign keys and invalid evidence length fail.

- [ ] **Step 2: Write failing IPD projection tests**

Seed an inpatient encounter, one posted adjustment-only invoice and one explicit link. Assert `projectCanonicalIpdAdmission` returns the linked invoice even though it has no service-event line. Seed an older service-inferred invoice and verify both are returned once.

- [ ] **Step 3: Run RED tests**

Run:

```bash
pnpm exec vitest run test/canonical/invoice-encounter-link-schema.test.ts test/canonical/ipd-projection.test.ts
```

Expected: FAIL because the table and explicit-link query do not exist.

- [ ] **Step 4: Add migration**

Create `0535_canonical_invoice_encounter_links.sql` with tenant-composite foreign keys to `canonical_invoices` and `canonical_encounters`, unique `(tenant_id, invoice_public_id)`, and a partial unique index:

```sql
CREATE UNIQUE INDEX ...
ON canonical_invoice_encounter_links(tenant_id, encounter_public_id)
WHERE link_type='discharge_invoice';
```

- [ ] **Step 5: Update projection**

Load explicitly linked posted invoices by encounter before service-event inference. Keep explicit IDs in a set, exclude them from inference duplication and preserve mixed-encounter issue detection only for inferred invoices.

- [ ] **Step 6: Run GREEN tests and typecheck**

```bash
pnpm exec vitest run test/canonical/invoice-encounter-link-schema.test.ts test/canonical/ipd-projection.test.ts
./node_modules/.bin/tsc --noEmit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add migrations/0535_canonical_invoice_encounter_links.sql src/lib/canonical/ipd-projection.ts test/canonical/invoice-encounter-link-schema.test.ts test/canonical/ipd-projection.test.ts
git commit -m "feat(canonical): link discharge invoices to encounters"
```

---

### Task 2: Composite Canonical IPD Discharge Command

**Files:**
- Modify: `src/lib/canonical/commands/issue-invoice-settlement.ts`
- Create: `src/lib/canonical/commands/finalize-ipd-discharge-billing.ts`
- Create: `test/canonical/finalize-ipd-discharge-billing.test.ts`
- Modify: `test/canonical/issue-invoice-settlement.test.ts`
- Modify: `test/canonical/accounting-reconciliation.test.ts`

**Interfaces:**
- Produces `prepareInvoiceSettlementBatch(db, input)` as a reusable non-committing preparation API.
- Produces `finalizeIpdDischargeBilling(db, input, execution)`.

Required input shape:

```ts
interface FinalizeIpdDischargeBillingInput {
  tenantId: string;
  commandIdempotencyKey: string;
  invoiceSettlement: IssueInvoiceWithSettlementInput;
  encounter: {
    legacyAdmissionId: number;
    legacyPatientId: number;
    completedAtUtc: string;
    sourceType: 'legacy_admission_discharge';
    sourcePublicId: string;
    sourceTable: 'admissions';
    sourceEvidenceSha256: string;
    eventPublicId: string;
  };
  depositRefund?: {
    operationPublicId: string;
    amountMinor: number;
    refundReceiptNumber: string;
    tenderType: 'cash';
    methodCode: 'cash';
    sourceType: 'legacy_live_deposit_refund';
    sourcePublicId: string;
    sourceTable: 'billing_deposits';
    sourceEvidenceSha256: string;
    outboxEventPublicId: string;
  } | null;
}
```

- [ ] **Step 1: Write command RED tests**

Cover:

1. credit-pending invoice and encounter completion;
2. full cash settlement;
3. full card settlement;
4. deposit-only settlement;
5. deposit plus payment;
6. deposit application plus excess refund;
7. apply/refund spanning several deposits oldest-first;
8. stale deposit rollback of authoritative legacy statements;
9. missing encounter rollback;
10. already completed encounter rollback;
11. active bed stays completed;
12. replay and changed-request conflict;
13. explicit invoice–encounter link creation.

- [ ] **Step 2: Run RED command test**

```bash
pnpm exec vitest run test/canonical/finalize-ipd-discharge-billing.test.ts
```

Expected: FAIL with missing module/export.

- [ ] **Step 3: Extract invoice settlement preparation**

Refactor `issueInvoiceWithSettlement` so validation and statement generation can return:

```ts
interface PreparedInvoiceSettlementBatch {
  request: unknown;
  statements: CanonicalPreparedStatement[];
  reconciliationStatements: CanonicalPreparedStatement[];
  result: IssueInvoiceWithSettlementResult;
  invoiceEvent: CanonicalCommandEvent;
  availableDepositState: ...;
}
```

The existing public command must still call `runCanonicalBatch` and preserve all current tests.

- [ ] **Step 4: Implement composite command**

The command must:

- read replay before loading mutable sources;
- resolve exact active inpatient encounter/admission link;
- load canonical deposits once;
- prepare invoice settlement application slices;
- allocate refund slices from post-application balances;
- create canonical refund/cash-custody rows and events;
- insert invoice–encounter link;
- update encounter from `in_progress` to `completed` with compare-and-swap predicates;
- complete active bed stays;
- add reconciliation statements proving the encounter is completed and no active bed stay remains;
- call one `runCanonicalBatch` with authoritative legacy statements.

- [ ] **Step 5: Add accounting reconciliation RED/GREEN test**

For invoice `T=10000`, deposit application `D=7000`, cash refund `R=2000`, payment `P=3000`, verify:

```text
accounts receivable net = 0
patient deposit liability reduction = 9000
cash movement = +3000 - 2000
invoice net due = 0
```

- [ ] **Step 6: Run command and regression suites**

```bash
pnpm exec vitest run test/canonical/finalize-ipd-discharge-billing.test.ts test/canonical/issue-invoice-settlement.test.ts test/canonical/accounting-reconciliation.test.ts
./node_modules/.bin/tsc --noEmit
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/canonical/commands/issue-invoice-settlement.ts src/lib/canonical/commands/finalize-ipd-discharge-billing.ts test/canonical/finalize-ipd-discharge-billing.test.ts test/canonical/issue-invoice-settlement.test.ts test/canonical/accounting-reconciliation.test.ts
git commit -m "feat(canonical): finalize IPD discharge settlement atomically"
```

---

### Task 3: Deterministic IPD Discharge Projection

**Files:**
- Create: `src/lib/canonical/live-ipd-discharge-billing.ts`
- Create: `test/canonical/live-ipd-discharge-billing.test.ts`

**Interfaces:**
- Produces `buildIpdDischargeBillingProjection(input): Promise<FinalizeIpdDischargeBillingInput>`.

Projection input must include:

- tenant, patient, admission and invoice identities;
- exact discharge timestamp/business date;
- provisional-item snapshots;
- package snapshot;
- bed-charge segment snapshots;
- discount and final total;
- direct payment/refund/deposit identities;
- encounter/admission evidence.

- [ ] **Step 1: Write projection RED tests**

Assert:

- invoice uses `legacy_live_bill` identity;
- all provisional/package/bed lines are financial adjustments with no fabricated service event;
- item discounts and global discount are separate negative lines;
- line sum equals final total;
- deposit apply plus refund equals requested deposit;
- cash and non-cash payment mapping follows existing tender mapping;
- non-cash payment requires external transaction/reference authority;
- credit-pending mode allows positive due;
- settled mode requires zero due;
- duplicate provisional/bed IDs and stale arithmetic are rejected;
- evidence hashes are stable and source-specific.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run test/canonical/live-ipd-discharge-billing.test.ts
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement minimal deterministic projection**

Reuse existing money, source-ID, evidence, tender and live-bill identity helpers. Do not query the database in the projection module.

- [ ] **Step 4: Run GREEN and typecheck**

```bash
pnpm exec vitest run test/canonical/live-ipd-discharge-billing.test.ts
./node_modules/.bin/tsc --noEmit
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/canonical/live-ipd-discharge-billing.ts test/canonical/live-ipd-discharge-billing.test.ts
git commit -m "feat(canonical): project IPD discharge billing authority"
```

---

### Task 4: Guarded Legacy IPD Discharge Adapter

**Files:**
- Create: `src/lib/canonical/ipd-discharge-billing-finalization.ts`
- Create: `test/canonical/ipd-discharge-billing-finalization.test.ts`
- Modify: `docs/database/legacy-table-disposition.yaml`

**Interfaces:**
- Produces `prepareIpdDischargeLegacyStatements(db, input): D1PreparedStatement[]`.
- Produces metadata identifying the bill and approval insert statement indexes for disabled/shadow result recovery.

- [ ] **Step 1: Write real-SQLite RED tests**

Create the minimum legacy schema and cover:

- settled discharge with bill/item/payment/deposit/accounting/admission/bed writes;
- credit-pending approval request and discharge update in the same batch;
- excess deposit refund and cash out;
- stale admission status rollback;
- stale provisional price/quantity/discount/net/status rollback;
- stale bed rate/dates/amount/billed status rollback;
- duplicate invoice, payment receipt, deposit adjustment and refund receipt rollback;
- admission patient mismatch rollback;
- zero critical row changes fail the batch;
- assertion rows cleared after success;
- exact legacy source text preserved.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run test/canonical/ipd-discharge-billing-finalization.test.ts
```

Expected: FAIL with missing module.

- [ ] **Step 3: Implement guarded builder**

Move only financial/discharge authority statements into the adapter. Use `prepareFinancialBatchAssertion` after every critical statement and `prepareClearFinancialBatchAssertions` last.

Insert legacy accounting events inside the batch using unique source event keys. Return indexes required to recover `billId` and optional `approvalRequestId` from D1 batch results.

- [ ] **Step 4: Move governance allowances**

Move direct-write allowances for `bills`, `invoice_items`, `payments` and the relevant deposit/approval tables from `src/routes/tenant/ipBilling.ts` to the focused adapter where governance requires it.

- [ ] **Step 5: Run GREEN, governance and typecheck**

```bash
pnpm exec vitest run test/canonical/ipd-discharge-billing-finalization.test.ts
pnpm canonical:check
./node_modules/.bin/tsc --noEmit
```

Expected: tests pass and governance reports 0 issues.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canonical/ipd-discharge-billing-finalization.ts test/canonical/ipd-discharge-billing-finalization.test.ts docs/database/legacy-table-disposition.yaml
git commit -m "feat(canonical): guard IPD discharge legacy authority"
```

---

### Task 5: Route Integration and Post-Commit Ordering

**Files:**
- Modify: `src/routes/tenant/ipBilling.ts`
- Create: `test/integration/routes/ipd-discharge-canonical.test.ts`
- Modify: `test/integration/routes/ip-billing.test.ts`
- Modify: `test/integration/routes/prod-compatibility.test.ts`

**Interfaces:**
- Route calls `executeStrictFinancialMutation` with boundary `ipd-discharge.billing.finalize`.
- Strict callback builds projection inside the callback and calls `finalizeIpdDischargeBilling`.

- [ ] **Step 1: Write route contract RED tests**

Assert source and behavior contracts:

- no direct `db.$client.batch(batchStmts)` for discharge financial authority;
- projection is built inside canonical callback;
- guarded adapter provides legacy statements;
- strict command receives authoritative statements;
- duplicate post-commit accounting-event calls are removed;
- `recordBillFinalizationSideEffects` uses `skipBillAccountingEvent: true`;
- doctor accrual, IPD ledger, audit and idempotency completion occur after strict commit;
- nested canonical causes map to safe 409;
- disabled/shadow bill and approval IDs use batch metadata;
- existing response body remains unchanged.

- [ ] **Step 2: Run RED route tests**

```bash
pnpm exec vitest run test/integration/routes/ipd-discharge-canonical.test.ts test/integration/routes/ip-billing.test.ts test/integration/routes/prod-compatibility.test.ts
```

Expected: contract test fails before route refactor.

- [ ] **Step 3: Refactor route**

Replace the main discharge batch construction with:

```ts
const legacy = prepareIpdDischargeLegacyStatements(c.env.DB, legacyInput);
const financialExecution = await executeStrictFinancialMutation({
  db: c.env.DB,
  tenantId: String(tenantId),
  boundary: 'ipd-discharge.billing.finalize',
  legacyStatements: legacy.statements,
  canonical: async (execution) => {
    const projection = await buildIpdDischargeBillingProjection(projectionInput);
    return finalizeIpdDischargeBilling(c.env.DB, projection, execution);
  },
});
```

Preserve existing idempotency reservation/completion and credit approval response fields.

- [ ] **Step 4: Remove duplicate post-commit financial authority**

Remove direct post-commit bill/payment/deposit/refund accounting event creation and canonical cash shadow collection. Queue workers after commit. Keep supplementary IPD ledger and audit behavior.

- [ ] **Step 5: Run route and canonical focused suites**

```bash
pnpm exec vitest run test/integration/routes/ipd-discharge-canonical.test.ts test/integration/routes/ip-billing.test.ts test/integration/routes/prod-compatibility.test.ts test/canonical/finalize-ipd-discharge-billing.test.ts test/canonical/live-ipd-discharge-billing.test.ts test/canonical/ipd-discharge-billing-finalization.test.ts
./node_modules/.bin/tsc --noEmit
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/routes/tenant/ipBilling.ts test/integration/routes/ipd-discharge-canonical.test.ts test/integration/routes/ip-billing.test.ts test/integration/routes/prod-compatibility.test.ts
git commit -m "feat(canonical): integrate IPD discharge billing boundary"
```

---

### Task 6: Registry, Adversarial Review, Evidence and Local Merge

**Files:**
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`
- Modify: `task-progress.yaml`
- Create: `docs/database/migration-runs/P10-ipd-discharge-billing-finalize-verification.md`

**Interfaces:**
- Registry marks `ipd-discharge.billing.finalize` integrated with `finalizeIpdDischargeBilling`.
- Tracker removes the last runtime writer boundary and advances to the next program gate without claiming production authorization.

- [ ] **Step 1: Write registry RED test**

```ts
expect(FINANCIAL_ROUTE_COVERAGE['ipd-discharge.billing.finalize']).toMatchObject({
  status: 'integrated',
  canonicalCommand: 'finalizeIpdDischargeBilling',
  routeFile: 'src/routes/tenant/ipBilling.ts',
});
```

Remove the boundary from unsupported-writer expectations.

- [ ] **Step 2: Run RED and update registry**

```bash
pnpm exec vitest run test/canonical/financial-route-coverage.test.ts
```

Expected before implementation: FAIL; after registry update: PASS.

- [ ] **Step 3: Perform adversarial review**

Review:

- deposit apply/refund sequencing;
- canonical/legacy arithmetic parity;
- encounter and bed-stay compare-and-swap guards;
- invoice–encounter projection duplicates;
- shadow compatibility;
- non-cash authority;
- credit approval atomicity;
- accounting event duplication;
- safe error output;
- source evidence uniqueness;
- request and canonical idempotency interaction.

Add a failing regression for every valid High finding before fixing it.

- [ ] **Step 4: Run final gates**

```bash
pnpm exec vitest run test/canonical/finalize-ipd-discharge-billing.test.ts test/canonical/live-ipd-discharge-billing.test.ts test/canonical/ipd-discharge-billing-finalization.test.ts test/canonical/ipd-projection.test.ts test/integration/routes/ipd-discharge-canonical.test.ts test/integration/routes/ip-billing.test.ts test/integration/routes/prod-compatibility.test.ts test/canonical/accounting-reconciliation.test.ts test/canonical/financial-route-coverage.test.ts test/canonical/strict-financial-mutation.test.ts
pnpm exec vitest run test/canonical
./node_modules/.bin/tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm build
```

Expected: all tests pass, governance 0, migration manifest increments by one, build succeeds.

- [ ] **Step 5: Write evidence and tracker update**

Record exact fresh counts, migration manifest count, commits, findings fixed, no-production-mutation statement and next exact action. Do not claim strict activation or production observation.

- [ ] **Step 6: Commit evidence**

```bash
git add src/lib/canonical/financial-route-coverage.ts test/canonical/financial-route-coverage.test.ts test/canonical/main-based-continuation-contract.test.ts task-progress.yaml docs/database/migration-runs/P10-ipd-discharge-billing-finalize-verification.md
git commit -m "docs(canonical): verify IPD discharge billing finalization"
```

- [ ] **Step 7: Rebase and local merge**

Rebase onto the latest clean local `main`, rerun focused/full canonical/TypeScript/governance/build gates, fast-forward local `main`, verify merged state, remove the temporary worktree and delete the feature branch.

Do not push remote `main`; repository policy treats a push as a production deployment trigger and no production release authorization was provided.
