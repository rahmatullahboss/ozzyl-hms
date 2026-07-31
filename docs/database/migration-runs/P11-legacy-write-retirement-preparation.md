# P11 Legacy-Write Retirement Preparation Verification

**Checkpoint:** CDB-105A

**Verified:** 2026-07-25T04:41:27+06:00

**Continuous CDB branch:** `program/cdb-main-continuous-20260725`

**Continuous CDB worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `6a932aa97d415f52a498165e2c53a49b83dd470a`

**Verified implementation head before this receipt:** `17ab0a8d4dd1f838f15eb6f311ea2a0975193810`

## Review conclusion

The earlier canonical-data work was not implemented from the dirty review checkout. Git ancestry proves that the historical remote CDB branch `origin/feature/hms-canonical-data-architecture` at `40ebd5feac00dc0aabf35912fb9114fcde6d64f5` is an ancestor of current local `main`.

At review time:

```text
main...origin/feature/hms-canonical-data-architecture = 313 / 0
```

Current local `main` therefore contained every historical CDB commit and 313 additional reviewed commits. No historical CDB commit was missing from `main`.

The reviewed settlement-cancellation task commits were also patch-equivalent on local `main`; the historical task branch contains no unintegrated patch that is required by this continuous branch.

The continuous branch was created from the exact reviewed local-main head `6a932aa97`. Before the first CDB-105A edit:

```text
main...program/cdb-main-continuous-20260725 = 0 / 0
```

This establishes that the current work includes all local-main updates available when CDB-105A started.

## Long-running integration contract

The program now follows an asymmetric synchronization model:

1. reviewed local `main` remains the source and base authority;
2. before each new CDB implementation slice, a clean continuous CDB branch must inspect whether `main` advanced;
3. new reviewed `main` commits are merged into CDB when CDB is behind;
4. CDB checkpoint history is never reset or rewritten to perform synchronization;
5. CDB work is not merged into `main` during the active program;
6. one final CDB-to-main integration occurs only after all executable CDB work, adversarial review, and full verification complete.

`test/canonical/main-based-continuation-contract.test.ts` now enforces that contract while preserving fresh-authorization requirements.

## CDB-105 sequencing decision

Original CDB-105 was split into:

- **CDB-105A — local retirement preparation:** safe local inventory, lifecycle governance, reporting, and continuation policy;
- **CDB-105B — actual legacy-write retirement:** blocked until production canonical cutover and observation evidence proves that the named compatibility or legacy authority is no longer required.

Removal-phase labels such as P05, P06, P07, and P08 are planning targets, not evidence that a write can now be removed. Removing compatibility writes before production cutover would break disabled/shadow parity or strict atomic legacy-plus-canonical behavior.

## Lifecycle-governance result

Every direct-write allowance in `docs/database/legacy-table-disposition.yaml` now requires:

- exact `path` and `table` scope;
- `owner`, `removalPhase`, and `reason`;
- `lifecycleStatus`;
- precise `retirementBlocker`;
- named `retirementTask`;
- ISO-8601 UTC `reviewedAtUtc` evidence.

Allowed lifecycle statuses are:

- `legacy_authority`;
- `canonical_compatibility`;
- `protected_fixture`.

Governance rejects missing evidence, invalid lifecycle states, non-UTC timestamps, duplicate scope, wildcard scope, missing paths, unregistered tables, and stale allowances that no longer match an actual direct write.

## Retirement inventory

The deterministic local-only report records:

| Dimension | Count |
| --- | ---: |
| Registered legacy tables | 5 |
| Exact direct-write allowances | 65 |
| Unique writing paths | 37 |
| `legacy_authority` | 36 |
| `canonical_compatibility` | 26 |
| `protected_fixture` | 3 |

Allowances by table:

| Table | Count |
| --- | ---: |
| `bills` | 23 |
| `invoice_items` | 15 |
| `payments` | 10 |
| `InventoryStockTransaction` | 9 |
| `doctor_commission_accruals` | 8 |

Allowances by owner:

| Owner | Count |
| --- | ---: |
| `billing-platform` | 38 |
| `finance-platform` | 18 |
| `inventory-platform` | 9 |

All 65 entries identify `CDB-105B` as the retirement checkpoint. The report reads only the repository registry and performs no database or network access.

## TDD receipts

The lifecycle contract was developed RED → GREEN:

- missing lifecycle evidence was initially accepted and produced the expected failing test;
- invalid lifecycle state and non-UTC review evidence were initially accepted and produced the expected failing test;
- minimal governance validation made those tests pass;
- the real registry then failed until all 65 entries were classified;
- final focused governance suite passed.

The retirement report was also developed RED → GREEN:

- the report test first failed with module-not-found;
- the local-only validator and aggregator were implemented;
- deterministic aggregate and invalid-evidence tests passed.

## Checkpoint commits

- `c4a6d35ad` — CDB-105A design and serial implementation plan;
- `fbacf6580` — lifecycle evidence governance and classification of all current allowances;
- `17ab0a8d4` — deterministic local retirement inventory report.

These commits remain only on `program/cdb-main-continuous-20260725`. They were not merged or cherry-picked into local `main`.

The verified tracker, continuation contract, and this report were committed as `68e6c0796591cf1c6727427bbe84d7d7ba132d84` before the final metadata receipt.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| Focused CDB-105A suite | 2 files, 15 tests passed |
| Continuation contract | 1 file, 6 tests passed |
| Full canonical suite | 142 files, 1,041 tests passed |
| Canonical governance | 0 issues |
| Retirement inventory | 5 tables, 65 allowances, valid |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Migration manifest | 470 migrations generated |
| Task worktree policy | passed with task-owned dirty receipt files |
| Web production build | passed |
| Patient production build | passed |
| Admin production build | passed |

Expected SQLite experimental warnings, the reviewed settlement legacy fallback warning, shadow-failure fixture output, and existing frontend chunk/deprecation warnings were observed. They did not fail any gate.

## Remaining program blockers

CDB-105A does not claim P10 or P11 completion. Remaining blockers are:

- production domain cutover and observation are incomplete;
- actual CDB-105B legacy-write retirement requires cutover evidence;
- CDB-110 local-server activation requires explicit owner authorization;
- CDB-120 destructive retirement requires explicit owner authorization.

Local analysis and non-destructive preparation may continue. No required compatibility write may be removed solely because its original target phase has passed.

## Safety and production status

No push, remote merge, local-main merge, deployment, production migration, backfill, feature-flag change, traffic change, tenant-data mutation, production observation, rollback, local-server activation, or legacy-write retirement occurred.

The dirty owner-facing checkout `/Users/rahmatullahzisan/Desktop/Dev/hms` remained read-only and untouched.
