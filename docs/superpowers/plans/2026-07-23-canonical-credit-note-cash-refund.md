# Canonical Credit Note Cash Refund Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one atomic canonical command for credit-note cash payouts across deterministic mixed and multi-payment funding without reversing original non-cash tenders.

**Architecture:** Migration 0533 adds parent refund, receipt slice, allocation slice and original-tender attribution tables. A read-only resolver builds stable same-channel-first/newest-first slices. A combined command issues the credit note, reduces invoice payment backing, records actual cash payout authority and emits credit, cash-refund and custody events in one canonical batch. Direct credit-note approval and held-refund approval both reuse the command with their existing guarded legacy statements.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, Vitest, canonical command-batch/outbox/accounting infrastructure, pnpm.

## Global Constraints

- Base local main is `99c0157a5f23d925bd5975f216d23d0c2547e3db`.
- Work only in `fix/canonical-credit-note-cash-refund-20260723` and its isolated worktree.
- Do not overwrite or discard changes from other worktrees.
- Do not deploy, apply migrations, backfill, change feature flags, move traffic or mutate production.
- Cash payout tender is cash; original payment tenders remain unchanged and are lineage only.
- Preserve receivable-only credits on `issueCreditNote` and payment voids on `reversePayment`.
- Use TDD and frequent commits.

---

### Task 1: Add canonical cash-refund schema

**Files:**
- Create: `migrations/0533_canonical_credit_note_cash_refunds.sql`
- Modify: `src/db/schema/canonical/billing.ts`
- Modify: `docs/database/canonical-source-of-truth.yaml`
- Create: `test/canonical/credit-note-cash-refund-schema.test.ts`

**Interfaces:**
- Produces tables:
  - `canonical_credit_note_cash_refunds`
  - `canonical_credit_note_refund_receipts`
  - `canonical_credit_note_refund_allocations`
  - `canonical_credit_note_refund_tender_attributions`

- [ ] Write a failing SQLite migration test asserting all four tables, unique credit-note payout authority, positive money checks, payout tender `cash`, parent/receipt/allocation/tender foreign keys, and balance guards.
- [ ] Run `pnpm exec vitest run test/canonical/credit-note-cash-refund-schema.test.ts`; expect missing migration failure.
- [ ] Add migration 0533 using integer minor units, UTC/business-date checks, immutable source snapshots and composite tenant foreign keys.
- [ ] Add matching Drizzle declarations in `src/db/schema/canonical/billing.ts`.
- [ ] Register all four tables in `docs/database/canonical-source-of-truth.yaml`.
- [ ] Run the schema test, `pnpm build:migrations`, `pnpm canonical:check`, and `pnpm exec tsc --noEmit`; expect all pass and migration count 465.
- [ ] Commit: `feat(canonical): add credit note cash refund schema`.

---

### Task 2: Build deterministic funding attribution resolver

**Files:**
- Create: `src/lib/canonical/live-credit-note-cash-refund.ts`
- Create: `test/canonical/live-credit-note-cash-refund.test.ts`

**Interfaces:**
- Produces:

```ts
export interface CreditNoteCashRefundReceiptSlice {
  receiptSlicePublicId: string;
  receiptPublicId: string;
  amountMinor: number;
  refundedBeforeMinor: number;
  netReceivedBeforeMinor: number;
  sourceEvidenceSha256: string;
}

export interface CreditNoteCashRefundAllocationSlice {
  allocationSlicePublicId: string;
  receiptSlicePublicId: string;
  receiptPublicId: string;
  allocationPublicId: string;
  amountMinor: number;
  reversedBeforeMinor: number;
  remainingBeforeMinor: number;
  sourceEvidenceSha256: string;
}

export interface CreditNoteCashRefundTenderAttribution {
  tenderAttributionPublicId: string;
  receiptSlicePublicId: string;
  receiptPublicId: string;
  tenderPublicId: string;
  amountMinor: number;
  tenderType: string;
  methodCode: string;
  attributableBeforeMinor: number;
  sourceEvidenceSha256: string;
}
```

- [ ] Write RED tests using a query adapter for one cash receipt, multiple receipts, cash-before-card, newest-first, multi-tender receipt, prior attribution subtraction, insufficient allocation, insufficient tender, missing invoice mapping and tenant isolation.
- [ ] Implement exact input validation and load the canonical invoice mapping.
- [ ] Query active allocations joined to posted receipts, and captured tenders with prior posted attribution totals.
- [ ] Implement deterministic slicing: receipts with cash availability first, newest receipt first, stable IDs; cash tender first inside receipt.
- [ ] Generate deterministic public IDs and SHA-256 evidence using existing canonical source helpers.
- [ ] Require receipt, allocation and tender totals each to equal `cashRefundMinor`.
- [ ] Run resolver tests and commit: `feat(canonical): resolve credit refund funding`.

---

### Task 3: Implement combined canonical command and accounting

**Files:**
- Create: `src/lib/canonical/commands/issue-credit-note-cash-refund.ts`
- Create: `test/canonical/issue-credit-note-cash-refund.test.ts`
- Modify: `src/lib/canonical/accounting-poster.ts`
- Modify: `test/canonical/accounting-reconciliation.test.ts`

**Interfaces:**
- Produces:

```ts
export interface IssueCreditNoteCashRefundInput extends IssueCreditNoteInput {
  refundPublicId: string;
  cashRefundMinor: number;
  payoutMethodCode: string;
  legacyCounterId: number;
  legacyCounterSessionId: number;
  receiptSlices: readonly CreditNoteCashRefundReceiptSlice[];
  allocationSlices: readonly CreditNoteCashRefundAllocationSlice[];
  tenderAttributions: readonly CreditNoteCashRefundTenderAttribution[];
  cashRefundEventPublicId: string;
  cashCustodyEventPublicId: string;
}

export async function issueCreditNoteWithCashRefund(
  db: CanonicalBatchDatabase,
  input: IssueCreditNoteCashRefundInput,
  execution?: CanonicalCommandExecutionOptions,
): Promise<CanonicalCommandResult<IssueCreditNoteCashRefundResult>>;
```

- [ ] Write RED tests with canonical migrations and seeded invoice/payment authority.
- [ ] Validate exact totals, invoice state, payment-funded amount, allocation/receipt/tender lineage, source-before states, compensation safety and deterministic IDs.
- [ ] Compute final invoice balances once: `paid-R`, `due+R`, `credited+T`, `netDue+R-T`.
- [ ] Insert credit note/lines, refund parent, receipt slices, allocation slices and tender attributions.
- [ ] Update allocations and receipts with guarded before values; do not update original tenders.
- [ ] Update invoice once with all four final balances and add final reconciliation guards.
- [ ] Insert source mappings and three outbox events under one command idempotency claim.
- [ ] Test replay, semantic conflict, mixed tender immutability, stale allocation/receipt/invoice/attribution rollback, insufficient payment-funded value and settled compensation rejection.
- [ ] Add `canonical.credit_note.cash_refunded` accounting: debit accounts receivable, credit cash on hand.
- [ ] Add accounting regression proving credit note `T` plus cash refund `R` gives net receivable reduction `T-R` and balanced vouchers.
- [ ] Run command/accounting tests and commit: `feat(canonical): issue cash refund credit notes`.

---

### Task 4: Integrate direct credit-note approval

**Files:**
- Modify: `src/routes/tenant/creditNotes.ts`
- Modify: `src/lib/canonical/live-credit-note-projection.ts`
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Create: `test/integration/routes/credit-note-cash-refund-canonical.test.ts`
- Modify: `test/integration/routes/credit-notes.test.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`
- Modify: `test/canonical/strict-financial-mutation.test.ts`

**Interfaces:**
- Consumes Task 2 resolver and Task 3 command.

- [ ] Write route RED tests proving zero-cash still uses `credit-note.approve`/`issueCreditNote`, positive cash uses `credit-note.cash-refund`/combined command, original resolver no longer rejects cash, and active counter evidence is passed.
- [ ] Guard the legacy approval, bill, income, cash and accounting rows with `canonical_financial_batch_assertions` and cleanup.
- [ ] For cash refund, resolve funding slices and invoke the combined command with legacy statements.
- [ ] For zero cash, preserve the existing command path.
- [ ] Map missing/insufficient/stale canonical funding to a safe 409.
- [ ] Mark `credit-note.cash-refund` integrated only after both direct and held paths are integrated; during this task keep registry blocked or add a two-route evidence state.
- [ ] Run direct route, credit-note command, financial coverage and strict-policy tests.
- [ ] Commit: `feat(canonical): integrate credit note cash payouts`.

---

### Task 5: Integrate held-refund approval

**Files:**
- Modify: `src/routes/tenant/approvals.ts:1512-2050`
- Create: `test/integration/routes/held-refund-canonical-cash-refund.test.ts`
- Modify: `test/integration/routes/refund-approval-cash-holds.test.ts`
- Modify: `test/integration/routes/approvals.test.ts`
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`

**Interfaces:**
- Consumes the same resolver and combined command as Task 4.

- [ ] Write RED route contracts proving held-refund guarded statements are supplied to `executeStrictFinancialMutation` on `credit-note.cash-refund` and the old direct `DB.batch(statements)` is removed.
- [ ] Build credit-note line inputs from item selection or amount allocation.
- [ ] Resolve funding using the cash-hold amount and counter/session evidence.
- [ ] Execute legacy credit-note creation, bill update, cash hold consumption, commission effects and canonical combined command in one strict mutation.
- [ ] Keep clinical cancellation and shadow reserve consumption post-commit and replay-safe.
- [ ] Mark registry `credit-note.cash-refund` integrated with command `issueCreditNoteWithCashRefund`.
- [ ] Add race tests for consumed hold, changed bill/payment state and insufficient canonical payment history.
- [ ] Run held-refund, approval, direct credit-note and strict coverage tests.
- [ ] Commit: `feat(canonical): integrate held cash refunds`.

---

### Task 6: Adversarial review, full verification and local-main merge

**Files:**
- Create: `docs/database/migration-runs/P10-credit-note-cash-refund-verification.md`
- Modify: `task-progress.yaml`
- Modify if stale: `test/canonical/main-based-continuation-contract.test.ts`

- [ ] Review all schema sums, source-state guards, multi-slice cumulative updates, original tender immutability, outbox uniqueness, legacy statement atomicity and post-commit side effects.
- [ ] Add a failing regression before fixing every Critical or High finding.
- [ ] Run:

```bash
pnpm exec vitest run test/canonical
pnpm exec vitest run test/integration/routes/credit-notes.test.ts \
  test/integration/routes/refund-approval-cash-holds.test.ts \
  test/integration/routes/approvals.test.ts
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build
git diff --check
```

- [ ] Write verification evidence, including migration-before-code deployment requirement and no production action.
- [ ] Remove `credit-note.cash-refund` from explicit blockers and set the next boundary checkpoint from the remaining runtime writer list.
- [ ] Validate YAML and continuation contract; commit `docs(canonical): verify credit note cash refunds`.
- [ ] Rebase the clean branch onto latest local main, refresh evidence SHAs, rerun focused tests and TypeScript, fast-forward merge without touching `.ai-bridge`, run merged focused/full canonical verification, then remove the worktree and branch.
