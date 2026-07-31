# P10 Credit Note Cash Refund Verification

**Checkpoint:** CDB-106

**Date:** 2026-07-23

**Branch:** `fix/canonical-credit-note-cash-refund-20260723`

**Rebased local main:** `258c1b6fadcd089808746f9988c162d81b49468d`

**Implementation head before evidence commit:** `e68612c4085c4d37f4de45c950cb267e9a1cbbab`

**Production mutation authorization:** false

## Verdict

`credit-note.cash-refund` is implemented and verified locally for both direct credit-note payout and held-refund approval. The boundary is now registered as `integrated` and uses `issueCreditNoteWithCashRefund`.

The implementation does not treat a cash payout as an original card, mobile-wallet, bank-transfer or gateway reversal. It records the actual payout as cash while preserving immutable original receipt, allocation and tender lineage.

No production deploy, migration application, backfill, feature-flag change, traffic change, observation, rollback or tenant-data mutation was performed.

## Implementation commits

- `05bf9b62f` — design deterministic credit-note cash refund authority
- `28abb8712` — implementation plan
- `f27db9e96` — migration 0533 and canonical schema registry
- `2d2e5a64f` — deterministic receipt/allocation/tender funding resolver
- `ea393a0e4` — combined credit-note cash-refund command and accounting
- `290864d31` — direct credit-note payout integration
- `e68612c40` — held-refund approval integration

## Canonical schema

Migration `0533_canonical_credit_note_cash_refunds.sql` adds:

1. `canonical_credit_note_cash_refunds`
2. `canonical_credit_note_refund_receipts`
3. `canonical_credit_note_refund_allocations`
4. `canonical_credit_note_refund_tender_attributions`

The tables enforce:

- tenant-scoped foreign keys;
- one cash payout authority per canonical credit note;
- cash as the actual payout tender;
- exact receipt refunded/net-received transitions;
- exact allocation reversed/remaining transitions;
- immutable original tender attribution without changing original tender settlement balances;
- positive minor-unit amounts and SHA-256 evidence;
- reconciliation guards and stable public identities.

All four tables are registered in `docs/database/canonical-source-of-truth.yaml` and declared in `src/db/schema/canonical/billing.ts`.

## Deterministic attribution

`resolveLiveCreditNoteCashRefundFunding` resolves mapped canonical payment authority and produces three exact funding layers:

- receipt slices;
- invoice allocation slices;
- original tender attribution slices.

The policy is deterministic:

1. receipts with available original cash funding first;
2. newest eligible receipt first within the same channel class;
3. stable receipt and allocation ID tie-breakers;
4. cash tender first within a receipt, then card, mobile wallet, bank transfer, gateway and other;
5. prior posted credit-note tender attribution is subtracted before new attribution.

The resolver fails before mutation when invoice mapping, allocation funding, receipt funding or original tender attribution is missing or insufficient. It does not repair or invent authority.

## Combined command

`issueCreditNoteWithCashRefund` executes one idempotent canonical command covering:

- canonical credit note and lines;
- parent cash payout authority;
- receipt, allocation and original-tender lineage slices;
- guarded payment allocation deallocation;
- guarded receipt refunded/net-received update;
- one final invoice update for paid, due, credited and net-due balances;
- source mappings;
- credit-note accounting outbox event;
- cash-refund accounting outbox event;
- cash-custody outbox event.

For total credit `T` and cash payout `R`:

```text
invoice paid after      = paid before - R
invoice due after       = due before + R
invoice credited after  = credited before + T
invoice net due after   = net due before + R - T
```

The command rejects `R > T`, insufficient paid balance, excessive credit, stale invoice/payment authority, non-reconciling slice totals and paid or settled compensation conflicts.

Original payment tenders remain unchanged. A card-funded receipt attributed to a cash payout remains a captured card tender with unchanged reversed and remaining balances; the attribution row records only economic lineage.

## Accounting result

The existing credit-note accounting event posts:

- debit sales returns for `T`;
- credit accounts receivable for `T`.

The new `canonical.credit_note.cash_refunded` event posts:

- debit accounts receivable for `R`;
- credit cash on hand for `R`.

Therefore net receivable reduction is `T - R`, and actual cash custody decreases by `R`. Accounting reconciliation tests verify both vouchers balance.

## Route integration

### Direct credit-note approval

`POST /credit-notes/:id/approve` now selects the boundary dynamically:

- `credit-note.approve` when cash refund is zero;
- `credit-note.cash-refund` when a cash payout exists.

The cash path:

- requires an active billing counter session;
- records the legacy payout method as cash;
- keeps the original requested payment method as audit metadata only;
- guards credit-note status, audit log, bill, income, cash and accounting legacy statements;
- passes those statements as authoritative statements to the combined command in strict mode;
- maps missing or stale canonical payment authority to a safe 409 response.

### Held-refund approval

`executeHeldRefundApproval` now sends the existing guarded legacy batch—including credit note, bill, cash hold, counter cash transaction, accounting and commission effects—through `executeStrictFinancialMutation` on `credit-note.cash-refund`.

The cash hold supplies the authoritative counter and counter-session IDs. In strict mode the entire legacy and canonical financial transition is one D1 batch. Clinical cancellation and refund-reserve shadow work remain post-commit and replay-safe.

The existing refund batch assertion detector now traverses nested causes so strict coordinator wrappers do not hide row-count assertion conflicts.

## Concurrency and idempotency evidence

Tests prove:

- replay returns the existing command result without duplicate refund authority;
- a changed request under the same key is rejected;
- stale allocation state rolls back authoritative legacy statements and all canonical rows;
- receipt, allocation and tender plans must reconcile exactly;
- prior tender attribution cannot be reused;
- direct and held route row-count assertions remain fail-closed;
- original non-cash tender state is unchanged;
- held-refund legacy/shadow result identity and strict post-commit identity resolution both work.

## Fresh verification after rebase

### Focused financial and route suite

```text
Test Files  12 passed (12)
Tests       208 passed (208)
```

Covered direct credit notes, held refund cash holds, approvals, combined command, resolver, accounting, route coverage, strict coordinator and nested batch assertions.

### Full canonical suite

```text
Test Files  110 passed (110)
Tests       771 passed (771)
```

### Compiler

```text
./node_modules/.bin/tsc --noEmit
exit 0
```

### Schema governance

```text
Canonical schema governance passed with 0 issues.
```

### Migration manifest

```text
465 migrations generated
```

### Production build

```text
pnpm build
exit 0
```

The build emitted existing Vite chunk-size and deprecation warnings only; no build failure occurred.

## Deployment prerequisite

Migration `0533_canonical_credit_note_cash_refunds.sql` and all preceding canonical migrations must be applied before route code invoking `issueCreditNoteWithCashRefund` is deployed. This document is local verification evidence only and does not authorize production execution.

## Remaining runtime writer boundaries

The completed boundary is removed from the remaining list. The next reviewed checkpoint is:

- `appointment.billing.finalize`

Other alternate financial writers remain fail-closed until their own canonical atomic adapter is implemented and verified.
