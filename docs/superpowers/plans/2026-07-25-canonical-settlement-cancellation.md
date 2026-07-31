# Canonical Settlement Cancellation Implementation Plan

> Execute serially in the dedicated worktree `canonical-settlement-cancellation-20260725` on branch `fix/canonical-settlement-cancellation-20260725`. Do not touch the dirty root, spawn subagents, push, deploy, or perform production actions.

## Phase 1 — Audit checkpoint

1. Record reviewed legacy route behavior and all financial/accounting side effects.
2. Record reusable canonical payment, deposit, credit, compensation, idempotency, and batch-assertion invariants.
3. Confirm `settlement.cancel` is absent from strict boundaries and route coverage.
4. Commit design and plan as the audit checkpoint.

## Phase 2 — RED: composite command

1. Add `test/canonical/cancel-settlement.test.ts` with a SQLite harness using canonical migrations.
2. Add RED cases for:
   - mixed cash/deposit/discount full reversal;
   - authoritative legacy statement rollback;
   - replay and semantic idempotency conflict;
   - prior partial payment reversal;
   - reversed deposit application or credit note;
   - stale invoice/deposit/payment projections;
   - canonical and mapped legacy paid compensation;
   - conflicting/duplicate mappings.
3. Run only the new test and record the expected RED failure.

## Phase 3 — GREEN: composite command

1. Add `src/lib/canonical/commands/cancel-settlement.ts`.
2. Validate exact input ordering, identities, safe integer amounts, UTC timestamp, and business date.
3. Read command replay before mutable-state queries.
4. Revalidate all canonical child facts and compensation safety.
5. Build one canonical batch containing:
   - authoritative legacy statements;
   - credit-note reversal;
   - deposit-application reversal and deposit restoration;
   - payment reversal/refund facts and receipt/tender/allocation restoration;
   - exact invoice restoration;
   - cancellation source mapping;
   - outbox event and command receipt.
6. Run RED test to GREEN, then refactor repeated guards.

## Phase 4 — RED/GREEN: strict adapter and route

1. Add `test/canonical/settlement-cancellation.test.ts`.
2. Add `src/lib/canonical/settlement-cancellation.ts` with:
   - untouched original legacy executor;
   - strict preflight snapshot;
   - strict guarded legacy statements;
   - accounting event/voucher reversal intent;
   - policy-aware shadow snapshot behavior;
   - `executeStrictFinancialMutation` integration.
3. Add adversarial adapter tests for exact missing evidence, stale legacy state, accounting `processing`, and posted-voucher reversed manual journal lines.
4. Replace only the route cancellation mutation body with the adapter call while preserving auth, counter, period validation, error mapping, and response parity.
5. Add route contract tests proving `settlement.cancel`, adapter/command usage, strict atomicity, and disabled/shadow parity.

## Phase 5 — Governance

1. Add only `settlement.cancel` to `STRICT_FINANCIAL_BOUNDARIES`.
2. Add an integrated `financial-route-coverage` record with exact route, command, tables, tests, and verification report.
3. Narrow `legacy-table-disposition.yaml` ownership for settlement cancellation; do not broaden any unrelated allowlist.
4. Add governance RED/GREEN tests.

## Phase 6 — Focused verification and checkpoint commits

1. Run new command, adapter, route, financial coverage, strict boundary, and shadow isolation tests.
2. Run the original CDB-117 six-file settlement suite and confirm no regression.
3. Run TypeScript for affected packages.
4. Review `show_changes`, ensure no generated/unrelated files, and commit coherent checkpoints with exact paths.
5. Continue automatically after each normal checkpoint.

## Phase 7 — Full verification

Run:

- full canonical Vitest suite;
- repository TypeScript checks;
- canonical governance checks;
- migration manifest verification;
- task worktree policy;
- diff/status review;
- web, patient, and admin production builds.

Any failure must be fixed and re-run before integration.

## Phase 8 — Reports and tracker

1. Add `docs/database/migration-runs/P11-settlement-cancellation-verification.md` with:
   - audited workflow;
   - exact strict authority and fail-closed boundaries;
   - commits;
   - focused/full test counts;
   - TypeScript, governance, manifest, policy, and build receipts;
   - explicit no-production-action statement.
2. Update `task-progress.yaml` with exact checkpoint, commits, receipts, and next action.
3. Update only relevant `.ai-bridge` status/decision/context files where required by repository rules.
4. Commit report/tracker checkpoint.

## Phase 9 — Latest-main integration

1. Re-read Git worktree metadata and verify the current local `main` worktree and latest HEAD.
2. Preserve any newly integrated commits from other agents.
3. Replay/cherry-pick reviewed task commits onto the latest clean local `main`.
4. Resolve only task-owned conflicts; never reset or discard other work.
5. Re-run current-main focused and full required verification.
6. Update exact integration receipts and create the final receipt commit on local `main`.
7. Leave all worktrees clean and report no push/deploy/production action.
