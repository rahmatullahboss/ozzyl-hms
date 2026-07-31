# P11 Settlement Finalize Verification

**Checkpoint:** CDB-117

**Verified:** 2026-07-25T01:51:24+06:00

**Task branch:** `fix/canonical-settlement-finalize-20260724`

**Task base:** local `main` at `d6f45d78ee07a181114c86d6a88689d86d311e96`

**Final verified task head before this report:** `192a5065c4f1355b455dad3c7e856fcf29c8b018`

**Latest reviewed local-main base before replay:** `134b9e725`

**CDB-117 replay head on local main:** `c4c27b7b6`

Parallel authentication commits from `94de1f734` through `134b9e725` were preserved and included in the current-main verification.

**Boundary:** `settlement.finalize`

## Result

The final registered P11 runtime boundary is implemented and locally verified as `integrated`.

`POST /tenant/settlements` now executes through `executeStrictFinancialMutation()` and uses:

- `executeSettlementOriginalLegacy()` for disabled and shadow legacy authority;
- `prepareSettlementStrictContext()` and `prepareSettlementStrictStatements()` for guarded strict compatibility authority;
- `finalizeSettlement()` for canonical multi-bill cash, deposit and discount authority.

The existing `PUT /:id/cancel` settlement-cancellation workflow is intentionally outside CDB-117. This checkpoint does not claim canonical cancellation or reversal coverage.

## Checkpoint commits

- `a0ae99530` — settlement finalization design
- `702e28a05` — serial TDD implementation plan
- `8d69dc9ff` — composite canonical settlement command
- `809a4a90e` — original legacy authority adapter
- `2d59d50da` — strict preflight and guarded compatibility authority
- `62f6a5138` — route integration and runtime policy tests
- `a6cf726a0` — coverage registry, continuation contract and shadow-isolation registration
- `192a5065c` — adversarial authority hardening

## Original legacy and shadow authority

The original executor preserves the historical allocation workflow:

1. allocate the settlement receipt;
2. insert one `billing_settlements` header;
3. sort selected bills by ID;
4. allocate cash, then deposit, then discount per bill;
5. update each affected bill using legacy paid semantics;
6. insert one payment receipt per cash-applied bill;
7. insert one deposit-adjustment receipt per deposit-applied bill;
8. insert settlement discount allocations;
9. update selected pending credit-bill statuses;
10. insert aggregate counter cash authority;
11. insert payment, deposit-adjustment and settlement-discount accounting events;
12. insert the settlement audit row;
13. resolve the committed settlement ID;
14. queue accounting and perform the existing cash-ledger shadow side effect.

Legacy payable and per-bill due remain based on `total - paid`, matching the original route even if the stored `due` projection is stale. Every originally requested bill ID is retained for credit-status updates, audit evidence and cash-ledger metadata, including a selected bill that was already fully paid and therefore received no new allocation.

The original executor has no canonical schema dependency, financial assertion or strict-only mapping requirement. Shadow mode commits legacy authority and legacy post-commit behavior first. A canonical projection failure records `CANONICAL_SHADOW_WRITE_FAILED` without changing the committed legacy `201` response.

## Strict preflight and compatibility authority

Strict preparation is lazy and runs only after strict policy selection. Before receipt allocation it verifies:

- every requested bill is present once and belongs to the patient;
- stored legacy `due` still equals `total - paid`;
- no bill is already linked to a settlement;
- each invoice number is present;
- one unambiguous active canonical invoice mapping exists;
- canonical and legacy invoice balances reconcile, including pre-existing credits;
- canonical invoices are posted, BDT-denominated and patient-matched;
- legacy and canonical available deposit balances reconcile;
- the requested deposit deduction is available;
- the accounting period and active counter session remain valid.

Strict authoritative statements atomically commit guarded legacy compatibility rows with canonical facts. Commit-time guards cover:

- settlement receipt uniqueness;
- active counter-session identity;
- exact legacy and canonical deposit totals;
- exact legacy bill total, paid, due, status, patient, invoice and unlinked state;
- exact canonical invoice mapping and balance snapshot;
- absence of a second conflicting mapping for the same bill identity;
- payment, deposit-adjustment, discount-allocation and accounting-event uniqueness;
- exact required row counts through financial batch assertions.

The optional credit-status update remains non-asserted because a selected bill may have no pending credit-status row. All assertion rows are cleared before commit.

## Composite canonical command

`finalizeSettlement()` commits one deterministic outer command envelope containing:

- one posted canonical payment receipt, tender and invoice allocation per cash-applied bill;
- FIFO canonical deposit applications across available patient deposits;
- one canonical credit note and line per discounted bill;
- optimistic canonical invoice balance updates;
- child payment, cash-custody, deposit-application and credit-note outbox events;
- canonical source mappings to the exact committed legacy settlement, payment, deposit-adjustment and discount-allocation rows;
- one settlement-level outbox event.

Accounting semantics are explicit:

- cash and deposit application increase canonical `paid_minor` and reduce `due_minor`;
- settlement discount increases `credited_minor` and reduces `net_due_minor` without increasing paid authority;
- final legacy due equals canonical net due;
- a partial settlement against an invoice with existing credit preserves `paid + due = total` and `net_due = due - credited`.

Deposit updates bind the planned FIFO identity through commit using amount, received timestamp, applied, refunded and available balances. A timestamp or balance race rolls back the outer batch.

## Adversarial review

The final review added executable coverage for:

- stale legacy `due` parity;
- preservation of every requested bill ID;
- legacy post-commit execution before shadow canonical projection;
- strict post-commit execution exactly once after atomic commit;
- conflicting invoice mapping appearing after preflight;
- canonical invoice, legacy bill, counter-session and deposit races;
- deposit FIFO timestamp identity drift;
- duplicate settlement, payment, deposit-adjustment, discount-allocation and accounting-event identities;
- pre-existing canonical invoice credits with mixed cash, deposit and discount;
- missing or changed settlement, payment, deposit-adjustment and discount-allocation source evidence;
- paid practitioner compensation blocking settlement discount before mutation.

All tested failures leave no canonical partial facts, outbox residue or financial assertion residue.

## Governance

`FINANCIAL_ROUTE_COVERAGE['settlement.finalize']` now records:

```text
status: integrated
canonicalCommand: finalizeSettlement
```

All registered strict financial runtime boundaries are now integrated locally. `remaining_runtime_boundaries` is empty and `explicit_strict_blockers` is empty.

Compatibility writer ownership is registered narrowly for the settlement adapter. The cancellation route allowances remain because cancellation is a separate legacy reversal workflow. Canonical schema governance reports zero issues.

## Verification receipt

Task-branch verification completed on `192a5065c4f1355b455dad3c7e856fcf29c8b018`:

| Gate | Receipt |
| --- | --- |
| Focused adversarial suite | 6 files, 85 tests passed |
| Full canonical suite | 139 files, 1,024 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Migration manifest | 469 migrations generated |
| Task worktree policy | passed, clean task branch |
| Web production build | passed |
| Patient production build | passed |
| Admin production build | passed |
| Diff check | passed |

### Current-main integration receipt

The reviewed CDB-117 commit chain was replayed without conflict onto local `main` after the preserved authentication commits. Current-main code and build verification completed on `c4c27b7b6`:

| Gate | Receipt |
| --- | --- |
| Focused settlement suite | 6 files, 85 tests passed |
| Full canonical suite | 139 files, 1,024 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Migration manifest | 470 migrations generated, including the parallel authentication migration |
| Integration worktree policy | passed, clean local `main` |
| Web production build | passed |
| Patient production build | passed |
| Admin production build | passed |
| Parallel authentication commits | preserved |

Expected test-only SQLite experimental warnings and existing frontend chunk/deprecation warnings were observed. They did not fail any gate.

## Safety and production status

No push, remote merge, deployment, production migration, backfill, feature-flag change, traffic change, tenant-data mutation, production observation or rollback was performed.

Fresh production authorization is still required for any production action.
