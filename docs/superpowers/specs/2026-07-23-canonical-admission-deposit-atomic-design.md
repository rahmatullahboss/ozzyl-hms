# Canonical Admission Deposit Atomic Boundary Design

**Date:** 2026-07-23

**Checkpoint:** CDB-105

**Branch:** `fix/canonical-admission-deposit-atomic-20260723`

**Base local main:** `dbfcd41d068741003770612bd7fbcdecfdce5877`

**Production mutation authorization:** false

## Problem

`POST /reception/admit-with-deposit` currently commits the conditional legacy admission, bed assignment, legacy deposit, cash transaction and legacy accounting event first. It then invokes `recordDeposit` as a separate post-commit canonical projection. This ordering is acceptable for shadow observation but cannot be promoted to strict mode because a canonical failure would occur after the admission and deposit authority had already committed.

The route also needs a fail-closed way to prove that its conditional admission claim and every dependent financial step actually changed the expected number of rows. A post-commit reload is too late for strict rollback, and a canonical-only post-state guard would attempt a shadow write even when the admission claim lost a concurrency race.

## Goals

- Make the admission claim and canonical deposit one reviewed atomic strict mutation.
- Preserve disabled and shadow semantics.
- Fail before the canonical shadow attempt when the conditional legacy admission or any required dependent legacy step does not occur.
- Keep paid cash custody shadowing, audit logging and accounting queueing outside the financial authority transaction.
- Keep admission-without-deposit behavior legacy-only.
- Avoid inventing a second deposit model or duplicating `recordDeposit`.
- Do not deploy, migrate, backfill, change flags or mutate production.

## Approaches considered

### 1. Canonical post-state reconciliation guard only

The route could pass all legacy statements to `recordDeposit` and add a canonical reconciliation statement that checks the admission and legacy deposit after canonical insertion.

**Rejected:** in shadow mode the legacy batch commits first. If the conditional admission insert changes zero rows, the coordinator would still invoke canonical projection, record a misleading shadow failure and claim legacy authority committed even though the admission claim did not succeed.

### 2. Reuse `billing_refund_batch_guard`

The refund guard already supports `changes()` assertions.

**Rejected:** admission collection is not a refund operation. Reusing a refund-owned table and helper would create misleading schema ownership and couple unrelated financial flows.

### 3. Generic ephemeral financial batch assertions

Add a small additive table and helper dedicated to transaction-local row-count assertions. Each critical legacy statement is immediately followed by an assertion based on SQLite `changes()`. Successful assertions are deleted before the batch ends.

**Selected:** it fails the legacy batch before canonical shadow execution, participates in the same strict canonical batch, requires no duplicate deposit command and is reusable by later alternate financial writers.

## Architecture

### Generic assertion authority

Add migration `0532_canonical_financial_batch_assertions.sql` with table:

- `tenant_id TEXT NOT NULL`
- `operation_key TEXT NOT NULL`
- `step_key TEXT NOT NULL`
- `assertion_value INTEGER NOT NULL CHECK (assertion_value = 1)`
- `created_at_utc TEXT NOT NULL`
- primary key `(tenant_id, operation_key, step_key)`

The table is not a business ledger. Rows exist only while a D1 batch is executing and are deleted by the last authoritative statement. If an assertion receives zero or an unexpected row count, the CHECK constraint fails and D1 rolls back the whole batch.

Create `src/lib/canonical/financial-batch-assertion.ts` with:

- `prepareFinancialBatchAssertion`
- `prepareClearFinancialBatchAssertions`
- `isFinancialBatchAssertionError`

The helper validates expected row counts and exact identifiers. It does not inspect PHI or store request content.

### Route transaction

For `depositAmount > 0`, the route will build one ordered `legacyStatements` array:

1. conditional admission insert;
2. assert one admission inserted;
3. when a bed is requested, guarded `available -> occupied` update;
4. assert one bed updated;
5. insert one patient-bed history row;
6. assert one bed-history row inserted;
7. insert one legacy `billing_deposits` row linked to the new admission;
8. assert one deposit row inserted;
9. insert one employee cash transaction;
10. assert one cash transaction inserted;
11. insert one legacy accounting posting event;
12. assert one accounting event inserted;
13. when admission fee is positive, insert its provisional charge and assert one row inserted;
14. clear all temporary assertion rows.

The route then calls `executeStrictFinancialMutation` once:

- boundary: `reception.admission.deposit.collect`
- legacy statements: the ordered statements above
- canonical callback: build the deterministic live deposit projection and invoke `recordDeposit`

Coordinator behavior remains:

- disabled: one guarded legacy batch;
- shadow: one guarded legacy batch, then canonical projection; canonical failure records a shadow issue without rolling back legacy authority;
- strict: canonical outbox claim, all guarded legacy statements and canonical receipt/tender/deposit/mapping writes in one D1 batch.

For `depositAmount = 0`, the route continues to execute a legacy admission batch without invoking a financial canonical command. Admission-fee provisional creation should still be included in the legacy batch so a successful response cannot omit the requested charge.

### Post-commit handling

After the core batch succeeds:

- reload the admission and deposit identifiers;
- construct and complete the route idempotency response;
- perform audit logging;
- write the cash-ledger shadow as best-effort and log failure instead of failing an already committed request;
- queue legacy/canonical accounting posting.

A failed core batch marks the external route idempotency reservation failed. A post-commit shadow or audit failure must not turn a committed admission into a failed idempotency response.

## Concurrency and rollback behavior

- A concurrent active admission causes the conditional admission insert to change zero rows; the adjacent assertion fails before canonical shadow execution.
- A concurrent bed claim causes either the admission insert or guarded bed update assertion to fail.
- Missing dependent rows, cash transaction or accounting event cause their adjacent assertion to fail.
- In strict mode any assertion or canonical failure rolls back admission, bed state, bed history, legacy deposit, cash transaction, accounting event, provisional fee, canonical receipt, tender, deposit, mappings and outbox claim.
- Sequence numbers may have gaps after a failed attempt; they are identifiers, not accounting authority.
- Canonical command replay remains controlled by the deterministic deposit idempotency key and outbox claim.

## Error handling

Financial assertion failures are translated into a safe conflict response. The route rechecks the active admission and bed state to preserve specific existing messages where possible:

- patient already admitted;
- bed no longer available;
- otherwise admission/deposit state changed and the caller should refresh.

Non-assertion database failures remain server errors. No raw SQL or constraint detail is returned.

## Registry and governance

Update `reception.admission.deposit.collect` from `blocked_in_strict` to `integrated` with canonical command `recordDeposit`.

The new assertion table is canonical infrastructure, not a legacy authority. No new direct legacy-write allowance is required beyond the existing reception route allowances.

## Tests

- Migration/schema test for the assertion table and CHECK constraint.
- Helper tests proving exact expected row counts pass, mismatches rollback and cleanup leaves zero rows.
- Command-batch integration test proving admission plus deposit succeeds atomically in strict mode.
- Race tests for duplicate active admission and bed loss with zero legacy and canonical partial state.
- Route source contract proving a single `executeStrictFinancialMutation` owns the admission deposit path and the post-commit empty-legacy projection is removed.
- Existing reception idempotency and conditional admission tests.
- Full canonical suite, affected reception routes, TypeScript, migration manifest, governance and production build.

## Out of scope

- Canonicalizing admissions or bed-management clinical authority.
- Deploying migration 0532.
- Repairing production deposit history.
- Enabling Tenant 100 strict mode.
- Promoting canonical reads.
- Integrating the separate admission-without-deposit route into a canonical clinical command.
