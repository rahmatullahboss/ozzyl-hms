# Canonical Unpaid Invoice Cancellation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Represent approved unpaid bill cancellation as an atomic canonical invoice lifecycle change with compensation reversal and accounting evidence, without fabricating a credit note.

**Architecture:** Add a focused `cancelUnpaidInvoice` canonical command, a live legacy-to-canonical projection adapter, and route integration through `executeStrictFinancialMutation`. Preserve existing legacy cancellation effects as authoritative statements, add canonical accounting support for `canonical.invoice.cancelled`, and keep clinical cancellation after the financial commit.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, Vitest, Node `DatabaseSync`.

## Global Constraints

- Base all work on local `main` commit `f57539677`.
- Work only on branch `fix/canonical-unpaid-invoice-cancellation-20260723` in its isolated worktree.
- Do not create a credit note for an unpaid cancellation.
- Require zero payment, deposit application, credit and settled compensation authority.
- Use deterministic public IDs, BDT minor units, normalized UTC timestamps and tenant-scoped predicates.
- Strict mode must commit legacy and canonical financial facts atomically or commit neither.
- Shadow mode must preserve legacy success and record canonical failure through the existing coordinator.
- Do not deploy, push, migrate, backfill, change flags or mutate production.
- Use TDD and commit coherent checkpoints.

---

### Task 1: Canonical cancellation command

**Files:**
- Create: `src/lib/canonical/commands/cancel-invoice.ts`
- Create: `test/canonical/cancel-invoice.test.ts`

**Interfaces:**
- Consumes: `CanonicalBatchDatabase`, `CanonicalCommandExecutionOptions`, `readCanonicalCommandReplay`, `runCanonicalBatch`, `createDeterministicSourceId`, `createSourceEvidenceSha256`.
- Produces: `cancelUnpaidInvoice(db, input, execution)` and exported input/result types.

- [ ] **Step 1: Write a real-SQL success test**

Create an in-memory SQLite harness using migrations `0505` through `0513`. Seed one posted unpaid invoice, one canonical compensation accrual with payable balance, and one synthetic legacy authoritative table row. Assert that cancellation:

```ts
expect(await cancelUnpaidInvoice(db, input(), {
  authoritativeStatements: [
    db.prepare(`UPDATE legacy_financial SET status='cancelled' WHERE tenant_id=? AND source_id=? AND status='open'`)
      .bind('tenant-a', 'bill-1'),
  ],
})).toEqual({
  status: 'applied',
  result: {
    invoicePublicId: 'inv-1',
    status: 'cancelled',
    totalMinor: 18500,
    reversedCompensationMinor: 2500,
    reversedCompensationCount: 1,
  },
});
```

Verify invoice status/timestamp, one `service_cancellation` compensation adjustment, accrual payable zero/status reversed, one mapping, one PHI-free outbox event, and the legacy row cancelled.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm exec vitest run test/canonical/cancel-invoice.test.ts
```

Expected: module import failure because `cancel-invoice.ts` does not exist.

- [ ] **Step 3: Implement validation and replay**

Define exact-string, digest, UTC and business-date validators. Build a replay-safe request containing only public IDs, reason code, timestamp, business date and source evidence. Read the invoice after replay detection and require:

```sql
status='posted'
AND paid_minor=0
AND due_minor=total_minor
AND credited_minor=0
AND net_due_minor=total_minor
```

Reject active payment allocations, active deposit applications and posted credit notes with explicit errors.

- [ ] **Step 4: Implement compensation reversal statements**

Load all invoice accruals ordered by `accrual_public_id`. Reject any `settled_minor > 0`. For each row with `payable_minor > 0`:

- derive `adjustment_public_id` from `invoice cancellation source + accrual_public_id`;
- derive a row evidence hash from immutable pre-state;
- insert `canonical_compensation_adjustments` with `adjustment_type='service_cancellation'`;
- update `adjusted_minor += payable_minor`, `payable_minor=0`, `status='reversed'` with optimistic predicates;
- set the adjustment balance guard from the resulting accrual;
- insert a `compensation_adjustment` source mapping.

- [ ] **Step 5: Implement invoice lifecycle and outbox**

Use `runCanonicalBatch` with authoritative statements first. Update the invoice:

```sql
SET status='cancelled', cancelled_at_utc=?, updated_at_utc=?
WHERE tenant_id=? AND invoice_public_id=?
  AND status='posted' AND paid_minor=0 AND due_minor=total_minor
  AND credited_minor=0 AND net_due_minor=total_minor
```

Emit `canonical.invoice.cancelled` with invoice ID, status, total and compensation reversal totals.

- [ ] **Step 6: Add replay and failure tests**

Cover:

- identical replay returns `replayed` without duplicates;
- changed reason code conflicts;
- paid invoice fails;
- active payment allocation fails;
- active deposit application fails;
- posted credit note fails;
- settled compensation fails;
- canonical validation failure rolls back authoritative legacy statements;
- tenant mismatch cannot resolve the invoice.

- [ ] **Step 7: Run command tests and commit**

Run:

```bash
pnpm exec vitest run test/canonical/cancel-invoice.test.ts
```

Commit:

```bash
git add src/lib/canonical/commands/cancel-invoice.ts test/canonical/cancel-invoice.test.ts
git commit -m "feat(canonical): cancel unpaid invoices"
```

---

### Task 2: Live cancellation projection

**Files:**
- Create: `src/lib/canonical/live-unpaid-invoice-cancellation.ts`
- Create: `test/canonical/live-unpaid-invoice-cancellation.test.ts`

**Interfaces:**
- Consumes: legacy bill identity and `canonical_source_mappings`.
- Produces: `resolveLiveUnpaidInvoiceCancellationProjection(db, authority): Promise<CancelUnpaidInvoiceInput>`.

- [ ] **Step 1: Write mapping and identity tests**

Seed mappings for both supported source shapes:

```text
legacy_live_bill / invoice number
legacy_bill / numeric bill id
```

Assert live mapping is preferred, fallback numeric mapping works, deterministic IDs are stable, evidence changes when the immutable bill total changes, and cross-tenant/missing/conflicting mappings fail.

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
pnpm exec vitest run test/canonical/live-unpaid-invoice-cancellation.test.ts
```

Expected: module import failure.

- [ ] **Step 3: Implement the projection**

Validate legacy bill ID, invoice number, total, paid amount, timestamp and reason code. Require legacy paid amount zero. Resolve exactly one mapped invoice and verify its `invoice_number` matches the authority. Create:

```ts
idempotencyKey = `canonical:invoice-cancel:${legacyBillId}`
outboxEventPublicId = createDeterministicSourceId('outevt', tenantId, 'legacy_bill_cancellation', String(legacyBillId))
sourceEvidenceSha256 = createSourceEvidenceSha256({
  sourceType: 'legacy_bill_cancellation',
  billId,
  invoiceNumber,
  totalMinor,
  paidMinor: 0,
  cancelledAtUtc,
  reasonCode,
})
```

- [ ] **Step 4: Run tests and commit**

Commit:

```bash
git add src/lib/canonical/live-unpaid-invoice-cancellation.ts test/canonical/live-unpaid-invoice-cancellation.test.ts
git commit -m "feat(canonical): map unpaid bill cancellations"
```

---

### Task 3: Accounting inverse for invoice cancellation

**Files:**
- Modify: `src/lib/canonical/accounting-poster.ts`
- Modify: `test/canonical/accounting-reconciliation.test.ts`

**Interfaces:**
- Consumes: `canonical.invoice.cancelled` outbox events.
- Produces: a balanced journal preparation that debits patient revenue and credits accounts receivable.

- [ ] **Step 1: Add a failing accounting test**

Seed a cancelled invoice and outbox event, accounting mappings and an open period. Run `postCanonicalAccountingEvent` and assert one voucher with:

```text
patient_revenue: debit total_minor
accounts_receivable: credit total_minor
```

- [ ] **Step 2: Run the focused accounting test and verify RED**

Expected: unsupported event type.

- [ ] **Step 3: Implement cancellation preparation**

Add `canonical.invoice.cancelled` to `SUPPORTED_EVENT_TYPES`, route it to a `prepareInvoiceCancellation()` function, require invoice status `cancelled`, and return the inverse of `prepareInvoice()`.

- [ ] **Step 4: Run accounting tests and commit**

Run:

```bash
pnpm exec vitest run test/canonical/accounting-reconciliation.test.ts
```

Commit:

```bash
git add src/lib/canonical/accounting-poster.ts test/canonical/accounting-reconciliation.test.ts
git commit -m "feat(canonical): post invoice cancellation accounting"
```

---

### Task 4: Approval route atomic integration

**Files:**
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`
- Create: `test/integration/routes/approvals-canonical-cancellation.test.ts`
- Modify: `test/integration/routes/approvals.test.ts`

**Interfaces:**
- Consumes: `resolveLiveUnpaidInvoiceCancellationProjection`, `cancelUnpaidInvoice`, `executeStrictFinancialMutation`.
- Produces: integrated `bill.cancel.unpaid` route boundary.

- [ ] **Step 1: Characterize disabled and strict behavior**

Add route tests proving:

- disabled policy preserves current bill/item/reserve/commission/income cancellation;
- strict policy with a valid mapping includes legacy and canonical statements in one batch;
- strict missing mapping writes neither side;
- shadow missing mapping commits legacy state and records a canonical shadow failure;
- paid bill still converts to credit-note workflow and never calls unpaid cancellation.

- [ ] **Step 2: Run route tests and verify RED**

Expected: strict boundary remains blocked or canonical command is absent.

- [ ] **Step 3: Build authoritative legacy statements**

Before mutation, load accrued doctor commission rows. Build one statement list containing:

- guarded bill cancellation;
- invoice-item cancellation;
- performer-reserve cancellation;
- doctor-commission cancellation;
- one `INSERT OR IGNORE accounting_posting_events` per loaded commission row using `createPostingEventKey` and `ACCOUNTING_EVENT_TYPES.commissionCancelled`;
- negative income correction.

Remove the pre-commit calls that mutate lab and commission state independently.

- [ ] **Step 4: Execute strict mutation**

Resolve the live canonical input and call:

```ts
await executeStrictFinancialMutation({
  db: env.DB,
  tenantId,
  boundary: 'bill.cancel.unpaid',
  legacyStatements,
  canonical: (options) => cancelUnpaidInvoice(env.DB, canonicalInput, options),
});
```

After a confirmed legacy/shadow/strict financial result, call `cancelLabOrderItemsForBill` idempotently and write the existing audit log.

- [ ] **Step 5: Mark route integrated**

Change the coverage record to:

```ts
status: 'integrated'
canonicalCommand: 'cancelUnpaidInvoice'
```

Update contract tests to require command and strict coordinator usage.

- [ ] **Step 6: Run affected tests and commit**

Run:

```bash
pnpm exec vitest run test/integration/routes/approvals-canonical-cancellation.test.ts test/integration/routes/approvals.test.ts test/canonical/financial-route-coverage.test.ts
```

Commit:

```bash
git add src/routes/tenant/approvals.ts src/lib/canonical/financial-route-coverage.ts test/canonical/financial-route-coverage.test.ts test/integration/routes/approvals-canonical-cancellation.test.ts test/integration/routes/approvals.test.ts
git commit -m "feat(canonical): integrate unpaid bill cancellation"
```

---

### Task 5: Verification and local-main integration

**Files:**
- Create: `docs/database/migration-runs/P10-unpaid-invoice-cancellation-verification.md`
- Modify: `task-progress.yaml`

**Interfaces:**
- Produces: verified checkpoint evidence and removes `bill.cancel.unpaid` from remaining strict blockers.

- [ ] **Step 1: Run full gates**

Run:

```bash
pnpm build:migrations
pnpm exec vitest run test/canonical
pnpm exec vitest run test/integration/routes/approvals-canonical-cancellation.test.ts test/integration/routes/approvals.test.ts
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build
```

- [ ] **Step 2: Review adversarially**

Verify:

- no free-text reason enters canonical outbox;
- no paid/deposit/credit state can be cancelled;
- all legacy financial statements are inside strict authoritative statements;
- clinical cancellation occurs only after confirmed financial commit;
- accounting event is balanced;
- route registry no longer labels the boundary blocked;
- no production action occurred.

- [ ] **Step 3: Record evidence and tracker**

Record commits, tests, counts and remaining blockers. Remove only `bill.cancel.unpaid`; preserve admission deposit, cash refund and alternate writer blockers.

- [ ] **Step 4: Commit, merge and verify local main**

Commit the evidence, confirm local `main` has not moved, rebase if necessary, fast-forward merge, rerun command/route/coverage tests and TypeScript on merged `main`, then remove the temporary branch/worktree. Do not push or deploy.
