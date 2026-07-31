# P10 Canonical Unpaid Invoice Cancellation Verification

**Date:** 2026-07-23

**Rebased local-main base:** `85a8ef7ecff0e84a6b64f0206cde674fb70fdaf9`

**Branch:** `fix/canonical-unpaid-invoice-cancellation-20260723`

**Production mutation:** false

## Commits

- `b320025e1` — `docs(canonical): design unpaid invoice cancellation`
- `f9e349f48` — `feat(canonical): cancel unpaid invoices`
- `10347b0be` — `feat(canonical): map unpaid bill cancellations`
- `33ef17fa7` — `feat(canonical): post invoice cancellation accounting`
- `dda258029` — `feat(canonical): integrate unpaid bill cancellation`
- `893778f11` — `fix(canonical): harden invoice cancellation races`

## Scope completed

The approved unpaid bill cancellation path now uses the existing canonical invoice lifecycle instead of fabricating a credit note. The implementation:

- resolves an existing mapped canonical invoice from the legacy bill authority;
- requires the legacy and canonical invoice to remain fully unpaid and uncredited;
- rejects active payment allocations, deposit applications and posted credit notes;
- rejects settled canonical compensation;
- transitions the canonical invoice from `posted` to `cancelled`;
- creates deterministic, replay-safe canonical outbox evidence;
- reverses unpaid canonical compensation with `service_cancellation` adjustments;
- posts invoice-cancellation accounting as the exact inverse of invoice issuance;
- commits legacy bill, invoice-item, performer-reserve, commission and accounting effects through the same strict financial mutation boundary;
- leaves paid bill cancellation on the existing credit-note workflow; and
- runs clinical lab cancellation only after the financial transaction commits.

The route registry now records `bill.cancel.unpaid` as `integrated` with canonical command `cancelUnpaidInvoice`.

## Atomicity and concurrency review

Three adversarial race findings were fixed before integration:

1. If authoritative legacy statements change canonical invoice balances before the guarded cancellation update, the canonical guard fails and the entire batch rolls back.
2. If a new payable canonical compensation accrual appears after validation but before the atomic batch, the post-compensation invoice guard fails and the entire batch rolls back.
3. If the legacy doctor-commission accrual count changes between preview and mutation, the `changes()` assertion fails and the legacy plus canonical batch rolls back, preventing a cancelled commission without its matching accounting event.

Replay, semantic idempotency conflict, tenant isolation, paid balance, active payment allocation, active deposit application, posted credit note, settled compensation and both race rollback paths are covered by tests.

## Accounting result

For an unpaid cancelled invoice, the canonical accounting poster creates the exact inverse of invoice issuance:

- debit `patient_revenue`;
- credit `accounts_receivable`.

The voucher remains balanced in integer minor units and requires the invoice to be canonically cancelled, unpaid and uncredited.

## Verification

| Gate | Result |
|---|---:|
| Full canonical suite after rebase | 105 files, 749 tests passed |
| Approval cancellation and full approval route regressions | 2 files, 131 tests passed |
| TypeScript `pnpm exec tsc --noEmit` | passed |
| Canonical schema governance | 0 issues |
| Migration manifest generation | 463 migrations generated |
| Full production build | passed |
| `git diff --check` | passed |

The full canonical suite includes the command, live mapping adapter, accounting poster, route coverage, strict policy and tracker continuation contracts.

## Safety review

- No free-text approval reason is used as the canonical reason code; the command persists the stable code `approved_unpaid_bill_cancellation`.
- No paid, allocated, deposit-applied, credited or settled-compensation invoice can use this cancellation command.
- The legacy financial statements are supplied as authoritative statements to `executeStrictFinancialMutation`.
- Clinical cancellation occurs only after confirmed financial commit.
- No migration, backfill, production deployment, Worker traffic change, feature flag change, tenant mutation, production observation, rollback or legacy retirement occurred.
- Historical production authorization was not reused.

## Remaining strict blockers

`bill.cancel.unpaid` is removed from the blocker list. Remaining explicitly reviewed blockers are:

- `reception.admission.deposit.collect` — admission claim and canonical deposit still require one reviewed atomic command;
- `credit-note.cash-refund` — mixed and multi-payment tender/deposit attribution remains unresolved.

The alternate direct-writer boundaries discovered in the financial writer coverage checkpoint remain fail-closed in strict mode until each receives a reviewed atomic canonical adapter.
