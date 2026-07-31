# P11 Settlement Cancellation Verification

**Checkpoint:** CDB-118

**Task-branch verified:** 2026-07-25T03:59:56+06:00

**Task branch:** `fix/canonical-settlement-cancellation-20260725`

**Task base:** local `main` at `ca536f03dfd23b36a2bc56041bf1160d5db5a2e9`

**Verified task head before this report:** `0a7ef97e0477b43066c06d44939cb82c470a5af1`

**Boundary:** `settlement.cancel`

## Result

Settlement cancellation is now implemented and locally verified as a separate integrated strict financial boundary. This checkpoint does not inherit cancellation authority from CDB-117; it audits the route independently and adds explicit cancellation and reversal authority.

`PUT /tenant/settlements/:id/cancel` now executes through `executeStrictFinancialMutation()` and uses:

- `executeSettlementCancellationOriginalLegacy()` for disabled and shadow legacy authority;
- `prepareSettlementCancellationStrictContext()` and `prepareSettlementCancellationStrictStatements()` for exact strict evidence and guarded compatibility rollback;
- `cancelSettlement()` for canonical payment, deposit, credit-note and invoice reversal authority.

## Checkpoint commits

- `e5028b3b` — cancellation authority audit, design and serial implementation plan;
- `268778e7` — composite atomic canonical cancellation command and adversarial command tests;
- `0a7ef97e` — strict adapter, route integration, accounting reversal intent, governance and route tests.

## Legacy workflow audit

The reviewed legacy cancellation workflow:

1. validates role, active billing counter and open accounting period;
2. loads one active settlement and linked bills;
3. reconstructs cash and deposit amounts with settlement-receipt prefix matching;
4. reconstructs discounts from accounting events and uses a heuristic fallback when discount evidence is absent;
5. rolls bill paid, due, status and settlement linkage back;
6. hard-deletes settlement-created payments, deposit adjustments, counter-cash rows and accounting events;
7. restores linked credit-bill statuses to Pending;
8. marks the settlement inactive and inserts a cancellation audit row;
9. commits the legacy statements as one batch.

Disabled and shadow modes retain that reviewed workflow, including the historical prefix matching, discount fallback warning and success response. The original executor has no canonical schema dependency.

## Audited authority gaps

The legacy route could not be treated as canonical because:

- prefix matching could admit unrelated payment or deposit evidence;
- missing discount events permitted heuristic monetary reconstruction;
- bill and settlement updates were not compare-and-swap guarded;
- posted accounting events could be deleted while their verified vouchers remained posted;
- canonical receipts, tenders, allocations, deposit applications, credit notes and invoice projections remained authoritative after legacy cancellation;
- replay, duplicate mapping, prior partial reversal, stale balances, posting races and paid compensation were not uniformly rejected.

## Strict preflight and compatibility authority

Strict preparation runs only for strict execution, or as a non-authoritative pre-legacy snapshot for shadow projection. Before mutation it requires:

- one active settlement with the exact tenant, patient, receipt, totals, creator, counter and session snapshot;
- one current active counter session with the exact user and counter identity;
- exact linked bill identity and exact total, paid, due, status and settlement linkage;
- one unambiguous canonical settlement mapping;
- one unambiguous canonical invoice mapping using either the reviewed `legacy_bill` bill ID or `legacy_live_bill` invoice-number form;
- exact per-bill payment receipt `${settlementReceipt}-B${billId}`;
- exact per-bill deposit adjustment `${settlementReceipt}-DAD-B${billId}`;
- exact discount allocation and credit-note receipt `${settlementReceipt}-DISC-B${billId}`;
- child cash, deposit and discount totals equal to the settlement header;
- exact canonical receipt, tender, allocation, deposit-application and credit-note mappings;
- canonical and legacy invoice balances reconcile, including discount credit semantics;
- no canonical or mapped legacy practitioner compensation has already been paid or settled;
- no canonical child has been partly or fully reversed;
- every expected accounting event has exact source identity, payload, amount, bill, patient and settlement evidence;
- no accounting event is currently `processing`.

Missing, duplicate, stale or ambiguous evidence fails closed. Strict mode never uses prefix inference or the legacy discount heuristic.

Strict authoritative statements use exact predicates and financial batch assertions for bill rollback, payment deletion, deposit-adjustment deletion, discount-allocation deletion, counter-cash deletion, settlement deactivation and audit insertion. A stale write changes zero rows, fails its assertion and rolls the entire legacy and canonical batch back.

## Composite canonical reversal

`cancelSettlement()` commits one deterministic command envelope containing:

- immutable payment reversal and refund facts;
- full reversal of the exact payment allocation, tender and receipt projections;
- reversal of the exact settlement deposit applications and restoration of deposit available balances;
- reversal of the exact settlement credit notes;
- restoration of canonical invoice paid, due, credited and net-due values to the pre-settlement snapshot;
- deterministic payment-reversal, refund and settlement-cancellation source mappings;
- cash-custody and settlement-cancelled outbox events;
- one idempotent command receipt.

Existing generic reversal commands were not called serially. Their reviewed invariants were reused inside this single composite command so strict legacy and canonical authority commit or roll back together.

Identical command replay returns the stored result. Reusing the command key with different cancellation semantics raises a canonical idempotency conflict.

## Accounting reversal authority

Strict cancellation distinguishes posted and unposted accounting events:

- `pending`, `failed`, `dead_letter` and `approved` settlement-created events are deleted with exact guards so they cannot post later;
- `processing` events fail closed as an active posting race;
- posted events and verified vouchers are preserved;
- each posted voucher produces a deterministic pending `manual_journal` event with every original debit and credit swapped;
- voucher identity, status, exact line count, account, amount, memo and balanced total are guarded at commit time.

This prevents deletion of accounting evidence while leaving an unreversed verified voucher.

## Adversarial coverage

Executable tests cover:

- mixed cash, deposit and discount reversal;
- atomic legacy and canonical commit and rollback;
- identical replay and semantic idempotency conflict;
- conflicting settlement and invoice source mappings;
- missing deposit, discount and source-mapping evidence;
- stale invoice, payment, deposit and legacy bill balances;
- prior partial payment reversal;
- already-reversed deposit applications and credit notes;
- paid mapped legacy compensation and settled canonical compensation;
- accounting `processing` races;
- exact posted-voucher manual-journal reversal lines;
- disabled and shadow legacy workflow and response-contract preservation;
- removal of cancellation SQL ownership from the route;
- narrow strict-boundary and route-coverage registration.

All tested strict failures leave no partial canonical reversal, cancellation mapping, outbox residue or legacy cancellation authority.

## Governance

`FINANCIAL_ROUTE_COVERAGE['settlement.cancel']` records:

```text
status: integrated
canonicalCommand: cancelSettlement
routeFile: src/routes/tenant/settlements.ts
```

Only `settlement.cancel` was added. No unrelated route was allowlisted. The stale cancellation `bills` and `payments` allowances were moved from the route to the exact settlement-cancellation adapter path. Canonical schema governance reports zero issues.

`remaining_runtime_boundaries` and `explicit_strict_blockers` remain empty.

## Task-branch verification receipt

Task-branch verification completed on `0a7ef97e0477b43066c06d44939cb82c470a5af1`:

| Gate | Receipt |
| --- | --- |
| Focused cancellation and settlement suite | 8 files, 94 tests passed |
| Full canonical suite | 141 files, 1,036 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Migration manifest | 470 migrations generated |
| Task worktree policy | passed, clean task branch |
| Web production build | passed |
| Patient production build | passed |
| Admin production build | passed |
| Diff check | passed |

Expected test-only SQLite experimental warnings, the intentional legacy discount-fallback warning and existing frontend chunk/deprecation warnings were observed. They did not fail any gate.

## Current-main integration receipt

Git metadata was re-read immediately before integration. The local `main` worktree remained clean at the reviewed base `ca536f03dfd23b36a2bc56041bf1160d5db5a2e9`; no new parallel commit had appeared after task-branch creation.

The reviewed task commits replayed conflict-free onto local `main` as:

- `ea81597c9` — cancellation authority audit, design and implementation plan;
- `6f6a3d2ad` — atomic canonical settlement cancellation command;
- `7aff0a2bc` — strict adapter, route integration and governance;
- `9f37006d8` — task-branch verification report.

Current-main verification completed on replay head `9f37006d8bf9adfec2179fd8f781bb66a0e2b388`:

| Gate | Receipt |
| --- | --- |
| Focused cancellation and settlement suite | 8 files, 94 tests passed |
| Full canonical suite | 141 files, 1,036 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Migration manifest | 470 migrations generated |
| Integration worktree policy | passed, clean local `main` |
| Web production build | passed |
| Patient production build | passed |
| Admin production build | passed |
| Current-main diff check | passed |

The unsupported policy-checker mode `main` was not treated as a product failure; the repository-supported `integration` mode passed on the linked `main` worktree. No implementation changed after these current-main gates.

Current-main verification and tracker receipts were committed as `c5ff1200e2b79beaeabc6bea765a68eaf50e5572` before the final integration receipt commit.

## Safety and production status

No push, remote merge, deployment, production migration, backfill, feature-flag change, traffic change, tenant-data mutation, production observation or rollback was performed.

Fresh explicit authorization remains required for every production action.
