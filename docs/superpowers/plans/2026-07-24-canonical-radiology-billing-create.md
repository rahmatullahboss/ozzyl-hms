# CDB-115 Canonical Radiology Billing Create Plan

## Goal

Integrate `radiology.billing.create` without changing the primary RIS legacy/shadow workflow, while making strict mode atomically authoritative across the legacy requisition/bill writes and the existing canonical radiology service/invoice command.

## Task 1 — Baseline and design

1. Verify latest reviewed local main and isolated worktree policy.
2. Read route, catalog resolver, idempotency, billing-finalization, accounting and existing patient-chart radiology adapter/command.
3. Run the focused radiology baseline.
4. Record the design and implementation plan.
5. Commit the design checkpoint.

Verification:

```bash
pnpm vitest run \
  test/canonical/create-radiology-requisition-billing.test.ts \
  test/canonical/patient-chart-radiology-billing.test.ts \
  test/integration/routes/patient-chart-radiology-canonical.test.ts \
  test/integration/routes/radiology-orders-accounting.test.ts \
  test/radiology-billing-gate.test.ts
```

## Task 2 — RIS adapter RED tests

Create `test/canonical/radiology-order-billing.test.ts` with recording and SQLite harnesses.

RED coverage:

- original validation/enrichment/sequence/write order;
- free-text zero-value success;
- source fields retained in requisition insert;
- strict mapping and positive price rejected before sequences;
- strict current source-reference ownership;
- atomic strict success;
- rollback on price, item/type, patient, visit, admission and prescriber races.

Commit tests only if a clean RED checkpoint is useful; otherwise proceed directly to Task 3.

## Task 3 — RIS adapter implementation

Create `src/lib/canonical/radiology-order-billing.ts`.

Implement:

- domain error with HTTP status;
- source/context/dependency contracts;
- exact original executor;
- strict preparation with pre-sequence validation;
- guarded strict authoritative statements and financial assertions.

Run adapter, patient-chart radiology and canonical command regressions plus TypeScript.

Commit:

```text
feat(canonical): guard radiology order billing
```

## Task 4 — Route integration RED tests

Create `test/integration/routes/radiology-orders-canonical.test.ts`.

Source contract:

- coordinator, original executor, strict context/statements and canonical command are wired;
- direct requisition/bill/invoice-item mutation SQL is removed from the handler;
- canonical callback is lazy;
- actual committed identities are reloaded;
- idempotency response contract remains.

Runtime policy coverage:

- legacy mapped success;
- legacy free-text zero-value success;
- shadow mapping failure preserves `201` and records an issue;
- strict missing mapping returns `409` before sequence or mutation;
- strict mapped success includes canonical authority.

## Task 5 — Route integration

Refactor only the create handler in `src/routes/tenant/radiology/orders.ts`:

1. keep request idempotency reservation/replay outside the coordinator;
2. build adapter input and request-local context;
3. call `executeStrictFinancialMutation()`;
4. run `createRadiologyRequisitionBilling()` in the canonical callback;
5. reload actual requisition, bill and invoice-item identities;
6. run existing post-commit finalization/accounting/audit/idempotency completion;
7. map adapter and strict conflicts to existing 4xx/409 behavior;
8. leave all other RIS endpoints untouched.

Run route source/runtime tests, accounting/billing-gate regressions and TypeScript.

Commit:

```text
feat(canonical): integrate radiology order billing
```

## Task 6 — Coverage and shadow isolation

1. Add the RIS original executor to `financial-shadow-route-isolation.test.ts`.
2. Mark `radiology.billing.create` integrated in `financial-route-coverage.ts`.
3. Remove it from alternate blocked-writer expectations.
4. Add the explicit integrated-command assertion.
5. Audit legacy-table governance and make only a justified narrow update.

Run coverage, governance and continuation tests.

Commit:

```text
chore(canonical): register radiology order authority
```

## Task 7 — Adversarial review

Review and test:

- strict preparation laziness;
- free-text/zero-value shadow behavior;
- sequence timing;
- current item/type/service/price parity;
- visit/admission patient ownership;
- prescriber activity race;
- accession/invoice uniqueness;
- requisition/bill/invoice-item identity linkage;
- canonical source mappings;
- accounting side-effect duplication;
- idempotency replay and failure marking;
- route response and error sanitization.

Commit any High/Critical correction separately.

## Task 8 — Full verification and documentation

Run:

```bash
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build:migrations
pnpm worktree:check -- --mode=task
pnpm build:web
pnpm build:patient
pnpm build:admin
git diff --check
```

Create `docs/database/migration-runs/P11-radiology-billing-create-verification.md` and update `task-progress.yaml` plus the continuation contract.

Commit:

```text
docs(canonical): record radiology order checkpoint
```

## Task 9 — Current-main integration

1. Locate the clean main worktree.
2. Run integration worktree policy.
3. Replay only reviewed CDB-115 commits onto latest local main.
4. Resolve conflicts without losing unrelated work.
5. Rerun focused, full canonical, static, governance, migration and build gates.
6. Record the current-main integration receipt.

No push, deployment, production migration, flag change or tenant mutation.
