# P10 Canonical Admission Deposit Atomic Verification

**Date:** 2026-07-23

**Rebased local-main base:** `45ac9af42a2e720345ecf256374bba4eec891e6f`

**Branch:** `fix/canonical-admission-deposit-atomic-20260723`

**Production mutation:** false

## Commits

- `1ebff3bcc` — `docs(canonical): design atomic admission deposit`
- `e9ff7d93b` — `docs(canonical): plan atomic admission deposits`
- `af5792e37` — `feat(canonical): add financial batch assertions`
- `9fea3e026` — `test(canonical): prove atomic admission deposits`
- `a49f84113` — `feat(canonical): integrate admission deposits atomically`

## Scope completed

`POST /reception/admit-with-deposit` no longer commits the legacy admission and deposit first and then attempts a separate canonical projection. For positive admission deposits, the route now passes one ordered authoritative statement sequence to `recordDeposit` through `executeStrictFinancialMutation`.

The same transaction sequence owns:

- conditional admission creation;
- guarded bed occupation;
- patient-bed history creation;
- legacy `billing_deposits` receipt creation;
- employee cash transaction creation;
- legacy accounting posting event creation;
- optional admission-fee provisional item creation;
- canonical payment receipt and tender creation;
- canonical deposit creation;
- canonical source mappings; and
- canonical accounting outbox creation.

The route coverage registry now records `reception.admission.deposit.collect` as `integrated` with canonical command `recordDeposit`.

## Financial batch assertions

Migration `0532_canonical_financial_batch_assertions.sql` adds a transaction-local assertion table. The table is registered in the canonical source-of-truth registry and Drizzle meta schema.

Each critical legacy statement is followed immediately by a SQLite `changes()` assertion. A mismatched expected row count violates `assertion_value = 1`, causing D1 to roll back the complete batch. Successful assertion rows are deleted before the batch ends.

The reusable helper provides:

- `prepareFinancialBatchAssertion`;
- `prepareClearFinancialBatchAssertions`; and
- `isFinancialBatchAssertionError` with bounded nested-cause detection.

The helper preserves the concrete prepared-statement subtype, allowing the same API to work with both canonical test adapters and Cloudflare `D1PreparedStatement` arrays without route-level unsafe casts.

## Execution modes

### Disabled

The guarded legacy statement batch executes once. Any failed conditional admission, bed claim or dependent insert rolls back before the route can return success.

### Shadow

The guarded legacy batch executes first. Only after that batch succeeds does the canonical deposit projection run. A canonical shadow failure is recorded through the existing processing-issue path while the already committed legacy authority remains intact.

### Strict

The canonical outbox claim, all guarded legacy statements, canonical receipt, tender, deposit and mappings execute in one D1 batch. Any assertion or canonical failure rolls back every attempted legacy and canonical row.

Admission without a deposit remains a legacy-only clinical path and does not invoke a financial canonical command.

## Concurrency and rollback evidence

The command-level SQLite integration tests prove:

1. A valid available-bed admission commits all legacy and canonical deposit authority together.
2. A concurrent active admission causes the guarded admission assertion to fail, leaving no attempted admission, deposit or canonical rows.
3. A no-longer-available bed causes the guarded claim to fail, leaving no attempted admission, bed history, deposit or canonical rows.

The route additionally guards the legacy deposit, employee cash transaction, accounting event and admission-fee insertion. Assertion errors are translated to safe patient-already-admitted, bed-unavailable or generic state-changed conflict responses.

## Idempotency and post-commit behavior

- The route idempotency reservation is marked failed only before the core financial commit.
- A successful response body is persisted before best-effort audit and cash-ledger shadow work.
- Audit and cash-ledger shadow failures are logged instead of converting an already committed admission into a failed request.
- The admission fee is part of the core batch and is no longer inserted after commit.
- The canonical deposit remains protected by deterministic command idempotency and the canonical outbox claim.

## Verification

| Gate | Result |
|---|---:|
| Full canonical suite after rebase | 107 files, 756 tests passed |
| Reception atomic, route and idempotency regressions | 3 files, 47 tests passed |
| TypeScript `pnpm exec tsc --noEmit` | passed |
| Canonical schema governance | 0 issues |
| Migration manifest generation | 464 migrations generated |
| Full production build | passed |
| `git diff --check` | passed |

## Deployment prerequisite

Migration `0532_canonical_financial_batch_assertions.sql` must be applied before deploying the Worker code that contains this route integration. The positive-deposit route uses the assertion table in disabled, shadow and strict modes. Deploying code before the migration would make admission deposit collection fail because the assertion table would not exist.

No deployment or migration was performed in this checkpoint.

## Safety review

- No production database query, mutation, migration or backfill was executed.
- No Worker deployment, traffic movement, feature flag change, production observation or rollback occurred.
- No historical production authorization was reused.
- Existing local-main `.ai-bridge` changes remain outside this feature worktree and untouched.
- Sequence gaps after a rolled-back attempt remain acceptable because sequence values are identifiers, not financial authority.

## Remaining strict blockers

`reception.admission.deposit.collect` is removed from the strict blocker list.

The remaining explicitly reviewed blocker is:

- `credit-note.cash-refund` — deterministic tender and deposit attribution for mixed or multi-payment refunds remains unresolved.

Other alternate financial writer boundaries remain fail-closed in strict mode until each receives a reviewed atomic canonical adapter.
