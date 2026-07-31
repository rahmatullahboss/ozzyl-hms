# Canonical Billing Provisional Finalize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate provisional invoice finalization under one strict canonical boundary for credit, partial/full payment, deposit-only and combined deposit/payment settlement.

**Architecture:** Add a reusable `issueInvoiceWithSettlement` canonical command that inserts one new invoice directly in its final paid/due state, with zero or one direct payment and zero or more oldest-first deposit applications. Build provisional billing projection and guarded legacy adapter files, then orchestrate them through `executeStrictFinancialMutation` while keeping commission, scheme usage and audit post-commit.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, Vitest, `node:sqlite`, canonical command batch/idempotency/outbox framework.

## Global Constraints

- Production mutation authorization is false.
- Do not deploy, apply migrations, backfill, change feature flags, change traffic, observe production or mutate tenant data.
- Do not create or repair missing canonical deposits during finalization.
- Do not invent canonical service-event authority from provisional item `reference_id`.
- Preserve disabled and shadow legacy behavior.
- Use standard `legacy_live_bill` and `legacy_live_bill_line` identities.
- One direct payment tender maximum; no overpayment or new-deposit creation.
- Deposit funding is deterministic oldest-first and may span multiple canonical deposits.
- Every implementation change follows RED → GREEN → refactor.
- Preserve unrelated dirty work in every other checkout.

---

### Task 1: Generic atomic invoice settlement command

**Files:**
- Create: `src/lib/canonical/commands/issue-invoice-settlement.ts`
- Create: `test/canonical/issue-invoice-settlement.test.ts`
- Modify: `test/canonical/accounting-reconciliation.test.ts`

**Interfaces:**
- Consumes: `IssueInvoiceInput`, `PaymentTenderType`, `allocateOldestAvailableDeposits`, canonical command batch primitives.
- Produces: `issueInvoiceWithSettlement(db, input, execution?)` and typed invoice/payment/deposit settlement inputs.

- [ ] **Step 1: Write the failing credit-invoice and partial-payment tests**

Define:

```ts
export interface InvoiceSettlementPaymentInput {
  receiptPublicId: string;
  receiptNumber: string;
  tenderPublicId: string;
  allocationPublicId: string;
  tenderType: PaymentTenderType;
  methodCode: string;
  amountMinor: number;
  externalTransactionId?: string | null;
  legacyCollectorId?: number | null;
  legacyCounterId?: number | null;
  legacyCounterSessionId?: number | null;
  receivedAtUtc: string;
  sourceType: string;
  sourcePublicId: string;
  sourceTable: string;
  sourceEvidenceSha256: string;
  paymentOutboxEventPublicId: string;
  cashCustodyEventPublicId?: string | null;
}

export interface InvoiceSettlementDepositInput {
  adjustmentNumber: string;
  amountMinor: number;
  appliedAtUtc: string;
  businessDate: string;
  sourceType: string;
  sourceTable: string;
}

export interface IssueInvoiceWithSettlementInput {
  tenantId: string;
  commandIdempotencyKey: string;
  invoice: IssueInvoiceInput;
  payment?: InvoiceSettlementPaymentInput | null;
  deposit?: InvoiceSettlementDepositInput | null;
}
```

Test wished-for results:

```ts
const credit = await issueInvoiceWithSettlement(db, creditInput);
expect(credit.result).toMatchObject({
  totalMinor: 100_000,
  paymentMinor: 0,
  depositMinor: 0,
  paidMinor: 0,
  dueMinor: 100_000,
});

const partial = await issueInvoiceWithSettlement(db, partialCashInput);
expect(partial.result).toMatchObject({
  totalMinor: 100_000,
  paymentMinor: 40_000,
  depositMinor: 0,
  paidMinor: 40_000,
  dueMinor: 60_000,
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm exec vitest run test/canonical/issue-invoice-settlement.test.ts
```

Expected: missing module/export failure.

- [ ] **Step 3: Add RED multi-deposit tests**

Seed two canonical deposits:

```text
DEP-OLD: available 30,000, received first
DEP-NEW: available 50,000, received second
```

Request 60,000 deposit settlement and assert:

```ts
expect(result.result.depositApplications).toEqual([
  { depositPublicId: 'DEP-OLD', amountMinor: 30_000 },
  { depositPublicId: 'DEP-NEW', amountMinor: 30_000 },
]);
expect(readInvoice()).toMatchObject({ paid_minor: 60_000, due_minor: 40_000 });
expect(countEvent('canonical.deposit.applied')).toBe(2);
```

Add deposit plus partial payment:

```ts
expect(result.result).toMatchObject({
  totalMinor: 100_000,
  depositMinor: 30_000,
  paymentMinor: 20_000,
  paidMinor: 50_000,
  dueMinor: 50_000,
});
```

- [ ] **Step 4: Add RED failure and replay tests**

Prove:

```ts
await expect(issueInvoiceWithSettlement(db, insufficientDeposit)).rejects.toThrow(/deposit balance is insufficient/i);
await expect(issueInvoiceWithSettlement(db, settlementOverTotal)).rejects.toThrow(/exceeds invoice total/i);
await expect(issueInvoiceWithSettlement(db, nonCashWithoutReference)).rejects.toThrow(/external transaction/i);
await expect(issueInvoiceWithSettlement(db, staleDepositWithAuthoritativeLegacy)).rejects.toThrow();
expect(count('legacy_financial')).toBe(0);
```

Also prove same-request replay and changed-request conflict.

- [ ] **Step 5: Implement invoice and settlement validation**

Reuse the invoice line validation rules from `issue-invoice-full-payment.ts`, or extract a focused internal helper only when it avoids exact duplicated validation without changing public behavior.

Calculate:

```ts
const depositMinor = input.deposit?.amountMinor ?? 0;
const paymentMinor = input.payment?.amountMinor ?? 0;
if (depositMinor + paymentMinor > totalMinor) {
  throw new RangeError('Settlement amount exceeds invoice total');
}
const paidMinor = depositMinor + paymentMinor;
const dueMinor = totalMinor - paidMinor;
```

Read canonical deposits and call:

```ts
const allocations = allocateOldestAvailableDeposits(depositRows, depositMinor);
```

- [ ] **Step 6: Implement one canonical batch**

Insert the invoice directly with `paid_minor`, `due_minor` and `net_due_minor` equal to final settlement state.

For each deposit slice, insert an application row and exact-snapshot deposit update. Build sequential invoice-before/after values in the application row, but do not separately update the new invoice after insert.

When payment exists, insert one receipt, tender and allocation. Its allocation due-before is `totalMinor - depositMinor`; due-after is final `dueMinor`.

Insert source mappings and outbox events:

```text
canonical.invoice.issued
canonical.payment.receipt.posted (optional)
canonical.cash_custody.collection_recorded (cash only)
canonical.deposit.applied (one per slice)
```

Use command name `canonical.invoice.issue_settlement` and one combined request hash.

- [ ] **Step 7: Run GREEN and accounting tests**

Run:

```bash
pnpm exec vitest run test/canonical/issue-invoice-settlement.test.ts test/canonical/accounting-reconciliation.test.ts
```

Expected: all tests pass and invoice/payment/deposit vouchers leave accounts receivable equal to final due.

- [ ] **Step 8: Commit**

```bash
git add src/lib/canonical/commands/issue-invoice-settlement.ts test/canonical/issue-invoice-settlement.test.ts test/canonical/accounting-reconciliation.test.ts
git commit -m "feat(canonical): issue invoices with atomic settlement"
```

---

### Task 2: Deterministic provisional billing projection

**Files:**
- Create: `src/lib/canonical/live-provisional-billing.ts`
- Create: `test/canonical/live-provisional-billing.test.ts`

**Interfaces:**
- Consumes: exact route item snapshots and `IssueInvoiceWithSettlementInput`.
- Produces: `buildProvisionalInvoiceProjection(input)` and `buildProvisionalSettlementProjection(input)`.

- [ ] **Step 1: Write RED gross/discount projection tests**

Use one item:

```ts
{
  provisionalItemId: 901,
  patientId: 501,
  visitId: 601,
  admissionId: null,
  category: 'test',
  description: 'CBC',
  department: 'Laboratory',
  quantity: 2,
  unitPrice: 500,
  discountAmount: 100,
  totalAmount: 900,
  doctorId: 101,
  referenceId: 55,
}
```

With global discount 50, assert gross line 1,000, item-discount -100, global-discount -50 and total 850 in decimal currency / 85,000 minor units.

Assert every financial line has `serviceEventPublicId: null`.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run test/canonical/live-provisional-billing.test.ts
```

Expected: missing module/export failure.

- [ ] **Step 3: Add standard identity and settlement tests**

Compare invoice and first-line public IDs with `buildLiveInvoiceProjection` using `buildLegacyLiveInvoiceSourceLineId`.

Cover:

```text
credit
partial cash
full card with reference
deposit only
deposit + cash payment
```

Assert stable receipt, tender, allocation and deposit source prefixes.

- [ ] **Step 4: Implement projection**

Validate each item:

```ts
const grossMinor = unitPriceMinor * quantity;
if (grossMinor - itemDiscountMinor !== netMinor) {
  throw new RangeError('Provisional item gross, discount, and net total do not reconcile');
}
```

Build standard live-bill line IDs from stable route order, category and reference ID. Add aggregate item discount and global discount lines.

Normalize payment methods and support optional aliases supplied by the route. Reject missing non-cash reference when building a strict-capable payment projection.

- [ ] **Step 5: Run GREEN**

```bash
pnpm exec vitest run test/canonical/live-provisional-billing.test.ts test/canonical/live-doctor-compensation.test.ts
```

Expected: projection and compensation identity tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canonical/live-provisional-billing.ts test/canonical/live-provisional-billing.test.ts
git commit -m "feat(canonical): project provisional invoice settlement"
```

---

### Task 3: Guarded legacy provisional finalization adapter

**Files:**
- Create: `src/lib/canonical/provisional-billing-finalization.ts`
- Create: `test/canonical/provisional-billing-finalization.test.ts`

**Interfaces:**
- Consumes: exact route financial inputs and item snapshots.
- Produces: `prepareProvisionalBillingLegacyStatements(db, input): D1PreparedStatement[]`.

- [ ] **Step 1: Write RED successful-batch test**

Create a real SQLite fixture with `bills`, `invoice_items`, `billing_provisional_items`, `payments`, `emp_cash_transactions`, `billing_deposits`, discount allocations, accounting events and `canonical_financial_batch_assertions`.

Assert a combined deposit/payment settlement creates:

```text
1 bill
N invoice items
N finalized provisional rows
1 payment
1 cash transaction
1 deposit adjustment
3 accounting events
0 remaining assertion rows
```

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run test/canonical/provisional-billing-finalization.test.ts
```

Expected: missing adapter failure.

- [ ] **Step 3: Add RED stale-snapshot tests**

For separate tests, change one stored field after route snapshot:

```text
unit price
quantity
discount amount
total amount
bill status
patient or visit/admission identity
```

Each must throw an assertion CHECK failure and leave every financial table empty.

Add duplicate receipt and duplicate deposit adjustment tests with the same rollback expectation.

- [ ] **Step 4: Implement guarded statements**

Use `prepareFinancialBatchAssertion` after every critical statement and `prepareClearFinancialBatchAssertions` last.

The provisional update `WHERE` clause must bind every exact snapshot field. Bill/payment/deposit identity inserts use `NOT EXISTS` guards. Accounting events use `INSERT OR IGNORE` followed by expected changes = 1.

Move bill-created, payment-received and patient-deposit-adjusted event SQL into this adapter.

- [ ] **Step 5: Run GREEN**

```bash
pnpm exec vitest run test/canonical/provisional-billing-finalization.test.ts
```

Expected: all commit and rollback tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/canonical/provisional-billing-finalization.ts test/canonical/provisional-billing-finalization.test.ts
git commit -m "feat(canonical): guard provisional billing finalization"
```

---

### Task 4: Route and post-commit integration

**Files:**
- Modify: `src/routes/tenant/billingProvisional.ts:205-217,552-896`
- Create: `test/integration/routes/billing-provisional-canonical.test.ts`
- Modify: `test/integration/routes/billing-provisional-scheme.test.ts`
- Modify: closest existing provisional route behavior test if discovered during implementation

**Interfaces:**
- Consumes: Task 1 command, Task 2 projection, Task 3 legacy adapter, strict coordinator.
- Produces: integrated `/billing-provisional/pay` behavior.

- [ ] **Step 1: Write RED source-contract tests**

Assert the finalization flow contains:

```text
executeStrictFinancialMutation
boundary: 'billing-provisional.finalize'
issueInvoiceWithSettlement
buildProvisionalSettlementProjection
prepareProvisionalBillingLegacyStatements
```

Assert doctor payables, scheme usage, bill finalization side effects and audit occur after the strict financial call.

Assert post-commit code no longer calls `recordAccountingPostingEvent` for bill, payment or deposit events.

- [ ] **Step 2: Run RED**

```bash
pnpm exec vitest run test/integration/routes/billing-provisional-canonical.test.ts
```

Expected: strict integration missing.

- [ ] **Step 3: Extend request schema without breaking legacy callers**

Add optional fields:

```ts
external_transaction_id: z.string().trim().min(3).max(128).optional(),
externalTransactionId: z.string().trim().min(3).max(128).optional(),
```

Normalize with:

```ts
const externalTransactionId = data.external_transaction_id ?? data.externalTransactionId ?? null;
```

Do not make the fields conditionally required in Zod; strict canonical validation owns the non-cash requirement.

- [ ] **Step 4: Replace direct batch with strict coordinator**

Build exact projection and legacy statements, then call:

```ts
const financialExecution = await executeStrictFinancialMutation({
  db: c.env.DB,
  tenantId: String(tenantId),
  boundary: 'billing-provisional.finalize',
  legacyStatements,
  canonical: (execution) => issueInvoiceWithSettlement(c.env.DB, projection, execution),
});
```

Map nested financial assertion errors and strict canonical settlement conflicts to safe 409 responses.

Resolve bill ID from coordinator legacy result where available, then query by tenant and invoice number as fallback.

- [ ] **Step 5: Preserve post-commit behavior**

After financial commit:

```text
createDoctorPayableAccrualsForProvisionalItems
recordBillingSchemeUsage
recordBillFinalizationSideEffects with skipBillAccountingEvent: true
createAuditLog
queueAccountingPosting
```

Remove post-commit payment/deposit accounting event creation.

- [ ] **Step 6: Add route behavior tests**

Cover credit, partial payment, deposit-only, combined settlement and non-cash reference handling. Verify strict failure prevents legacy bill/payment/deposit writes and existing response fields remain unchanged.

- [ ] **Step 7: Run GREEN**

```bash
pnpm exec vitest run test/integration/routes/billing-provisional-canonical.test.ts test/integration/routes/billing-provisional-scheme.test.ts
```

Expected: all route tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/routes/tenant/billingProvisional.ts test/integration/routes/billing-provisional-canonical.test.ts test/integration/routes/billing-provisional-scheme.test.ts
git commit -m "feat(canonical): finalize provisional billing atomically"
```

---

### Task 5: Registry, review, evidence and local-main integration

**Files:**
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`
- Modify: `docs/database/legacy-table-disposition.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`
- Modify: `task-progress.yaml`
- Create: `docs/database/migration-runs/P10-billing-provisional-finalize-verification.md`

**Interfaces:**
- Consumes: completed command, projection, adapter and route tests.
- Produces: integrated registry state and CDB-109 handoff.

- [ ] **Step 1: Write RED registry expectation**

Expect:

```ts
expect(FINANCIAL_ROUTE_COVERAGE['billing-provisional.finalize']).toMatchObject({
  status: 'integrated',
  canonicalCommand: 'issueInvoiceWithSettlement',
});
```

Run the route coverage test and confirm it fails against `blocked_in_strict`.

- [ ] **Step 2: Update registry and governance path**

Set the boundary to integrated only after every settlement mode is green. Move legacy table allowances for `bills`, `invoice_items`, `payments` and `billing_deposits` from the route to the focused guarded adapter path when governance requires it.

- [ ] **Step 3: Run adversarial review**

Review every branch for:

- stale deposit preflight;
- stale provisional financial values;
- direct payment plus deposit exceeding invoice total;
- legacy/canonical paid arithmetic mismatch;
- non-cash payment without reference;
- duplicate receipt or adjustment number;
- multiple deposit slice order instability;
- accounting event duplication;
- commission before canonical invoice commit;
- fabricated service authority;
- shadow-mode compatibility.

Every Critical/High finding requires a failing regression test before the fix.

- [ ] **Step 4: Run final gates**

```bash
pnpm exec vitest run test/canonical/issue-invoice-settlement.test.ts test/canonical/live-provisional-billing.test.ts test/canonical/provisional-billing-finalization.test.ts test/integration/routes/billing-provisional-canonical.test.ts test/integration/routes/billing-provisional-scheme.test.ts test/canonical/accounting-reconciliation.test.ts test/canonical/financial-route-coverage.test.ts
pnpm exec vitest run test/canonical
./node_modules/.bin/tsc --noEmit
pnpm canonical:check
pnpm build
```

Expected: all tests pass, TypeScript exits 0, governance reports 0, manifest remains 465 unless latest main changes it, and build exits 0.

- [ ] **Step 5: Write verification evidence and tracker**

Record exact counts, commit SHAs, accounting behavior, oldest-first allocation, concurrency tests, no-production-mutation statement and next boundary.

Set:

```yaml
current_checkpoint: CDB-109-IPD-DISCHARGE-BILLING-FINALIZE-NEXT
last_completed_checkpoint: CDB-108_billing_provisional_finalize_integrated
next_exact_action: design_and_integrate_ipd_discharge_billing_finalize_from_latest_local_main
```

Remove `billing-provisional.finalize` from remaining boundaries.

- [ ] **Step 6: Commit evidence**

```bash
git diff --check
git add src/lib/canonical/financial-route-coverage.ts test/canonical/financial-route-coverage.test.ts docs/database/legacy-table-disposition.yaml test/canonical/main-based-continuation-contract.test.ts task-progress.yaml docs/database/migration-runs/P10-billing-provisional-finalize-verification.md
git commit -m "docs(canonical): verify provisional billing finalization"
```

- [ ] **Step 7: Rebase and merge locally**

If local `main` advanced, rebase the clean branch, rerun focused/full gates, align evidence SHAs, then fast-forward the dedicated local-main worktree. Preserve every existing `.ai-bridge` change. Do not push or deploy without separate explicit authorization.
