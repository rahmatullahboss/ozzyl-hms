# Main-Based Canonical Continuous Implementation Plan

> **Execution mode:** User-authorized single-agent continuous execution in this chat. Do not spawn or delegate. A normal checkpoint commit is not a stop condition.

**Goal:** Continue the already-merged HMS canonical program from current `main`, close the remaining strict/shadow financial route integrations, pass the complete local cutover gate, and stop only when the next exact action requires fresh production authorization or elapsed observation.

**Executor:** `CDB-CONTINUE`

**Base:** `main` at `fa742f4960a4bef35950bdb4c5a6a6f251782f8e`

**Branch:** `program/canonical-main-continuous-20260721`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/canonical-main-continuous`

## Governing documents

- `docs/architecture/2026-07-21-main-canonical-completion-gap-audit.md`
- `docs/superpowers/specs/2026-07-21-main-based-canonical-continuation-design.md`
- `docs/superpowers/plans/2026-07-13-hms-canonical-data-architecture-master-plan.md`
- `docs/superpowers/specs/2026-07-13-hms-canonical-data-architecture-spec.md`
- `task-progress.yaml`

## Global rules

1. `main` is the source of truth. Do not use `review/all-branches-20260711` or `integration/main-unified-20260719` as a base.
2. Extend `src/lib/canonical/**`; do not create or import a second `financial-reconciliation` authority.
3. Use TDD: focused RED, minimal implementation, focused GREEN, regression verification.
4. Preserve tenant isolation, integer minor-unit accounting, business date, idempotency, original-event identity, cash custody, balanced accounting and audit evidence.
5. Existing legacy side effects remain authoritative until an explicitly authorized strict cutover.
6. Shadow canonical failure must not falsely report canonical success.
7. Strict mode must fail before any partial legacy mutation.
8. No deploy, production migration, backfill, traffic change, flag mutation, production QA, rollback or legacy retirement without fresh explicit authorization.
9. Commit at logical boundaries and continue immediately to the next safe checkpoint.

## Checkpoint 1 — CDB-102A: Main audit and continuation contract

**Files:**

- Create: `docs/architecture/2026-07-21-main-canonical-completion-gap-audit.md`
- Create: `docs/superpowers/specs/2026-07-21-main-based-canonical-continuation-design.md`
- Create: `docs/superpowers/plans/2026-07-21-main-based-canonical-continuation.md`
- Create: `docs/architecture/canonical-main-continuation-prompt.md`
- Create: `test/canonical/main-based-continuation-contract.test.ts`
- Modify: `task-progress.yaml`
- Modify: `_bmad-output/_progress/00-design-log.md`
- Modify: `docs/superpowers/plans/2026-07-13-hms-canonical-data-architecture-master-plan.md`

**Contract requirements:**

- current base SHA and main-based branch/worktree recorded;
- production authorization false;
- duplicate review architecture explicitly rejected;
- CDB-102 added as local P10 hardening;
- single continuous executor recorded;
- old historical evidence retained;
- architecture contract checks all paths and policy statements.

**Verification:**

```bash
pnpm vitest run test/canonical/main-based-continuation-contract.test.ts
pnpm exec tsc --noEmit
```

**Commit:** `docs(canonical): establish main-based continuous continuation`

After commit, continue to Checkpoint 2.

## Checkpoint 2 — CDB-102B: Strict financial boundary registry

**Purpose:** Make runtime coverage explicit and prevent a declared boundary from existing only as a string constant.

**Files:**

- Modify: `src/lib/canonical/strict-financial-boundaries.ts`
- Create: `src/lib/canonical/financial-route-coverage.ts`
- Create: `test/canonical/financial-route-coverage.test.ts`
- Modify route files only as needed to register adapters.

**RED test:**

Assert that each required mutation has one status:

- `integrated`: route invokes `executeStrictFinancialMutation` with a canonical command;
- `blocked_in_strict`: route calls `assertStrictFinancialBoundaryDisabledOrSupported` and is allowed only in disabled/shadow mode;
- never `declared_unenforced`.

Required boundaries:

- billing.create;
- billing-counter.invoice.create;
- billing.payment.collect;
- deposit.collect;
- deposit.refund;
- deposit.apply;
- credit-note.approve;
- payment.reverse;
- bill.cancel.unpaid.

The RED test must fail on the current main state because several boundaries are not route-wired or fail-closed.

**Implementation:**

- add missing boundary names;
- add a typed registry with route, command and coverage status;
- add fail-closed helper usage for unsupported strict boundaries;
- do not yet claim deposit/reversal boundaries integrated until their route code is wired.

**Verification:** focused test, strict policy tests, TypeScript.

**Commit:** `feat(canonical): enforce financial route coverage registry`

Continue to Checkpoint 3.

## Checkpoint 3 — CDB-102C: Deposit collection canonical wiring

**Purpose:** Route patient deposit collection through `recordDeposit`.

**Files:**

- Modify: `src/routes/tenant/deposits.ts`
- Create: `src/lib/canonical/live-deposit-projection.ts`
- Create or modify: `test/integration/routes/deposits-canonical-strict.test.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`

**RED cases:**

1. disabled mode writes only legacy deposit/cash/accounting facts;
2. shadow mode writes legacy facts and canonical receipt/tender/deposit/mapping/outbox;
3. shadow mapping/command failure preserves legacy success and exposes canonical failure evidence;
4. strict mode commits legacy and canonical rows atomically;
5. strict validation failure commits neither legacy nor canonical rows;
6. retry with the same idempotency key returns the original response without duplicate canonical facts;
7. tenant mismatch fails.

**Projection:**

Build deterministic public IDs and evidence from:

- tenant;
- deposit receipt number;
- patient;
- amount;
- payment method;
- counter/session;
- business date;
- legacy source row identity.

Use `recordDeposit` via `executeStrictFinancialMutation` with the existing legacy batch as authoritative statements.

Preserve existing accounting posting, audit and legacy cash-ledger shadow behavior until a later cleanup proves it redundant.

**Verification:** focused route tests, canonical deposit lifecycle tests, TypeScript.

**Commit:** `feat(canonical): wire deposit collection into strict mutation`

Continue to Checkpoint 4.

## Checkpoint 4 — CDB-102C2: Deposit refund and application source allocation

**Purpose:** Wire deposit refunds and bill adjustments without inventing aggregate deposit identity.

**Files:**

- Modify: `src/lib/canonical/live-deposit-projection.ts`
- Modify: `src/routes/tenant/deposits.ts`
- Create/modify: `test/integration/routes/deposits-canonical-strict.test.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`

**RED cases:**

- deterministic oldest-available mapped deposit allocation;
- multiple source deposits may satisfy one legacy aggregate adjustment/refund;
- insufficient canonical mapped balance fails strict mode before legacy writes;
- shadow mode legacy success plus visible canonical failure when source mapping is incomplete;
- cash refund creates a distinct deterministic custody event;
- strict multi-source operation is atomic;
- replay is idempotent.

**Implementation decision:**

Prefer a dedicated adapter that resolves and invokes per-source canonical commands within one `runCanonicalBatch`-compatible unit. Do not call multiple independent strict mutations that could partially succeed.

**Verification:** focused tests, `test/canonical/adjustment-lifecycle.test.ts`, TypeScript.

**Commit:** `feat(canonical): wire deposit refund and application lifecycle`

Continue to Checkpoint 5.

## Checkpoint 5 — CDB-102D: Payment reversal wiring

**Purpose:** Route `payment_void` approvals and legacy payment-reversal aliases through canonical `reversePayment`.

**Files:**

- Create: `src/lib/canonical/live-payment-reversal-projection.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Create/modify: `test/integration/routes/approvals-canonical-reversal.test.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`

**RED cases:**

- resolves invoice, receipt, tender and allocation mappings for the original payment;
- blocks settled compensation/reserve as canonical command requires;
- disabled mode preserves existing legacy reversal;
- shadow mode creates canonical reversal/refund and preserves legacy response;
- strict mode commits legacy reversal, bill balance, custody, canonical reversal/refund and outbox atomically;
- missing mapping fails strict mode without a legacy reversal;
- full/partial reversal balances reconcile;
- replay does not duplicate;
- cross-tenant source IDs fail.

**Implementation:**

- extract the existing legacy reversal statements without changing their semantics;
- build deterministic canonical reversal input from persisted original payment and mappings;
- use `executeStrictFinancialMutation` with boundary `payment.reverse`;
- retain audit creation after verified commit.

**Verification:** focused approval/reversal tests, canonical adjustment lifecycle, TypeScript.

**Commit:** `feat(canonical): wire approved payment reversals`

Continue to Checkpoint 6.

## Checkpoint 6 — CDB-102D2: Credit-note and held-refund wiring

**Purpose:** Route approved credit notes/refunds through `issueCreditNote` and the correct canonical refund/reversal lifecycle.

**Files:**

- Create: `src/lib/canonical/live-credit-note-projection.ts`
- Modify: `src/routes/tenant/approvals.ts`
- Create/modify: `test/integration/routes/approvals-canonical-refund.test.ts`
- Modify: `test/canonical/financial-route-coverage.test.ts`

**RED cases:**

- mapped invoice and invoice-line identities;
- item and amount-based credit notes;
- receivable-only reduction versus actual cash refund separated;
- held cash refund preserves cash hold consumption/release;
- canonical credit note, legacy credit note, bill balances and accounting evidence reconcile;
- strict failure leaves request/hold and legacy financial state unchanged;
- shadow canonical failure remains observable;
- retries are idempotent;
- clinical/commission cancellation side effects run only after the financial commit is confirmed.

**Implementation:**

- use canonical `issueCreditNote` for invoice value reduction;
- use canonical payment/deposit reversal only when the refund returns previously received money;
- keep one legacy approval decision and one financial commit boundary;
- avoid creating a pending credit note as if it were an approved canonical fact.

**Verification:** focused refund approval tests, canonical adjustment/compensation tests, TypeScript.

**Commit:** `feat(canonical): wire approved credit notes and refunds`

Continue to Checkpoint 7.

## Checkpoint 7 — CDB-102E: Unpaid cancellation strict behavior

**Purpose:** Ensure unpaid bill cancellation is either canonically represented or explicitly blocked in strict mode.

**Files:**

- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/lib/canonical/financial-route-coverage.ts`
- Create/modify: `test/integration/routes/approvals-canonical-cancellation.test.ts`

**Characterization first:**

Determine whether current canonical invoice schema supports a posted invoice cancellation/void without fabricating a credit note. If a correct existing command exists, wire it. Otherwise:

- allow existing behavior in disabled/shadow mode;
- call the strict-boundary guard and fail closed under strict mode;
- record the boundary as `blocked_in_strict` with exact reason;
- create a follow-up command plan only if the product requires strict unpaid cancellation before P10 promotion.

Paid bill cancellation continues to convert to credit/refund workflow.

**Verification:** focused cancellation tests and route coverage.

**Commit:** `fix(canonical): fail closed for unsupported strict cancellations`

Continue to Checkpoint 8.

## Checkpoint 8 — CDB-102 local completion gate

**Files:**

- Modify: `task-progress.yaml`
- Modify: audit/plan if implementation discoveries changed the verdict.
- Create: `docs/database/migration-runs/P10-main-route-hardening-verification.md`

**Commands:**

```bash
pnpm vitest run <all focused new route tests>
pnpm vitest run test/canonical
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build
```

Also run relevant existing approval/deposit/billing integration suites.

**Acceptance:**

- every strict boundary integrated or explicitly fail-closed;
- no duplicate architecture or migration;
- all focused and canonical tests pass;
- schema governance 0 issues;
- full build passes;
- production mutation false;
- CDB-102 complete;
- CDB-101 remains waiting for fresh production authorization and real observation.

**Commit:** `test(canonical): complete main-based route hardening gate`

## Checkpoint 9 — CDB-101 production resume gate

Stop here unless the user provides fresh explicit production authorization with environment, tenant/domain scope, approved build, action, backup/Time Travel evidence, rollback owner, observation duration and abort thresholds.

Authorized actions may include controlled reversal/refund/cancellation manual QA, protected reconciliation, shadow observation and rollback verification. They do not automatically authorize canonical read promotion, strict/canonical-only activation, traffic movement or P11 retirement.

## Checkpoint 10 — P11

Begin CDB-105/CDB-110/CDB-120 only after P10 passes and the user separately authorizes legacy-write retirement, compatibility views, local-sync testing and any destructive migration. Until then, preserve legacy data and disconnected local-server state.

## Continuous handoff format

Before any allowed stop, update:

- current checkpoint;
- commits created in the session;
- exact changed files;
- focused and aggregate test counts;
- TypeScript/build/governance status;
- exact next action;
- unresolved risks;
- production mutation status;
- worktree cleanliness;
- resume command.
