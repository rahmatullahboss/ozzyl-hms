# HMS Canonical Database, Inventory MM and Full MM — Release Control Center

> **Historical pre-release control center.** Current execution is governed by [2026-07-31 Post-Canonical Production Roadmap](./2026-07-31-post-canonical-production-roadmap.md). CDB-V1-071B is already deployed at 100%; retain this file for migration and branch-history evidence only.

**Last verified:** 2026-07-29 18:06 Asia/Dhaka
**Machine-readable state:** [`canonical-inventory-mm-current-state.yaml`](./canonical-inventory-mm-current-state.yaml)
**Continuation commands:** [`2026-07-29-canonical-inventory-mm-continuation-prompt.md`](./2026-07-29-canonical-inventory-mm-continuation-prompt.md)
**Migration reconciliation:** [`../database/2026-07-29-inventory-main-migration-reconciliation.md`](../database/2026-07-29-inventory-main-migration-reconciliation.md)

> এই ফাইলটি Canonical Database, Inventory Modular Monolith, Full Modular Monolith, `main` integration, database migration এবং production deployment সম্পর্কিত নতুন chat/session-এর প্রথম entry point। কোনো agent শুধু পুরোনো `.ai-bridge`, tracker বা branch name দেখে কাজ শুরু করবে না; live Git state verify করে এই control center-এর sequence অনুসরণ করবে।

## 1. Executive verdict

### Inventory

Inventory Modular Monolith-এর **development program complete**:

- 27/27 `INV-MM` task complete;
- latest integrated task `INV-MM-121`;
- final program branch `feature/inventory-modular-monolith`;
- final program head `c3dbee241e0ee480762339f50c261eb69b92bb41`;
- branch is synchronized with `origin/feature/inventory-modular-monolith`;
- no further `INV-MM` implementation task is scheduled.

এই completion-এর অর্থ repository/program-level Inventory implementation এবং verification complete। এর অর্থ **`main` integration, production migration, production activation, deployment বা live legacy table drop complete নয়**।

### Canonical Database

Canonical Core V1 program এখনো active:

- branch `program/cdb-main-continuous-20260725`;
- worktree `.worktrees/cdb-main-continuous-20260725`;
- observed head `d8726db6d1cbd23d58ac8ad07243a2dd208bbf94`;
- current verified checkpoint `CDB-V1-030L-PAYMENT-RECEIPT-TENDER-ALLOCATION-INTEGRATION-VERIFIED`;
- exact next checkpoint `CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION`;
- 20 command-required writer এবং 5 implementation group এখনো বাকি;
- local branch observed remote branch-এর তুলনায় 20 commits ahead, তাই cross-program integration-এর আগে reviewed checkpoints remote-এ publish/verify করতে হবে।

### Full Modular Monolith

Full MM program complete নয়:

- branch `program/mm-canonical-inventory-sync-20260727`;
- worktree `.worktrees/mm-canonical-inventory-sync-20260727`;
- observed head `da3c63bbafd92017252f5aff77d1503dd0081eeb`;
- current task `MM-060`;
- branch-এর recorded Inventory checkpoint `INV-MM-089`, কিন্তু Inventory program এখন `INV-MM-121` পর্যন্ত complete;
- branch-টিকে latest `main`, reviewed CDB checkpoint এবং Inventory final checkpoint-এর উপর rebaseline করতে হবে;
- Full MM Inventory public contracts consume করবে; দ্বিতীয় Inventory authority তৈরি করবে না।

### Release verdict

**এখন direct Inventory → `main` merge বা program branch থেকে production deploy করা যাবে না।**

প্রধান blocker:

1. active CDB এবং Full-MM program এখনো unfinished;
2. latest `main` এবং Inventory branch substantially diverged;
3. 11টি migration prefix collision আছে;
4. production D1-এর exact pending migration set এই review-তে query করা হয়নি;
5. `0558d_retire_legacy_inventory_tables.sql` destructive এবং ordinary release migration হিসেবে apply করা অনুমোদিত নয়;
6. canonical financial shadow-safe candidate deployment workflow এখনো mandatory।

## 2. Verified branch snapshot

Observed after fetching the named branches on 2026-07-29:

| Program | Branch head | Remote relation | Divergence from observed `main` |
|---|---|---|---|
| `main` | `849cf757b0b83bf30585112fdaee18db31f2950b` | matched fetched `origin/main` at observation | baseline |
| Inventory MM | `c3dbee241e0ee480762339f50c261eb69b92bb41` | 0 ahead / 0 behind its origin branch | `main`-only 193 / Inventory-only 535 |
| Canonical DB | `d8726db6d1cbd23d58ac8ad07243a2dd208bbf94` | local 20 ahead / 0 behind its origin branch | `main`-only 113 / CDB-only 202 |
| Full MM | `da3c63bbafd92017252f5aff77d1503dd0081eeb` | local 1 ahead / 0 behind its origin branch | `main`-only 114 / Full-MM-only 653 |

These numbers are observations, not permanent constants. Every new integration session must fetch and recalculate them.

## 3. Inventory completion evidence

Final Inventory program evidence recorded on `feature/inventory-modular-monolith`:

| Gate | Result |
|---|---:|
| Focused final architecture | 35/35 |
| Inventory backend | 879/879 |
| Inventory frontend | 259/259 |
| Inventory total | 1,138/1,138 |
| Protected Reception/Billing | 183/183 |
| Security | 45/45 |
| Generated RBAC | 1,039/1,039 |
| TypeScript | 0 errors |
| Canonical governance | 0 issues |
| Canonical Inventory tables | 39/39 |
| Registry targets | 31/31 |
| Runtime write/read/import/schema legacy references | 0/0/0/0 |
| Active/unresolved remediation debt | 0/0 |
| Foreign-key violations | 0 |

Normative Inventory evidence remains on the Inventory branch:

- `docs/inventory-hardening/START_HERE.md`;
- `docs/inventory-hardening/CURRENT_EXECUTION_STATE.yaml`;
- `docs/inventory-hardening/task-progress.yaml`;
- `docs/inventory-hardening/runs/INV-MM-121.md`.

## 4. Mandatory reading order for a new session

1. `agents.md`
2. `.agent-rules/git-workflow.md`
3. `docs/architecture/2026-07-29-canonical-inventory-mm-release-control-center.md`
4. `docs/architecture/canonical-inventory-mm-current-state.yaml`
5. `docs/architecture/hms-production-scope-policy.md`
6. `docs/database/2026-07-29-inventory-main-migration-reconciliation.md`
7. `docs/operations/canonical-shadow-safe-production-deploy.md`
8. the current CDB branch `docs/architecture/canonical-program-control-center.md`
9. the current CDB branch `docs/architecture/hms-canonical-parallel-execution-board.yaml`
10. the Inventory branch final tracker and `INV-MM-121` run report
11. the Full-MM branch `.ai-bridge/current-plan.md`
12. live Git status, worktrees, commits, remote refs, migration files and tests

When documents disagree, current code/tests on the correct branch and freshly fetched Git state win. Historical production authorization never becomes current authorization.

## 5. Exact next task

The immediate implementation task is:

```text
CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION
```

It must continue on the existing owned CDB branch/worktree after verifying identity, dirty state and remote state. Do not recreate the program, reset it, merge it to `main`, or begin production work merely because the checkpoint passes.

The target work covers the five remaining service-catalog/pricing writer pairs across:

- `src/routes/tenant/billingMaster.ts`;
- `src/routes/tenant/priceCategories.ts`;
- `src/routes/tenant/settings-import-export.ts`.

Reuse existing canonical service-catalog/effective-price commands and preserve protected HTTP/import/export behaviour, exact identity, effective intervals, currency, integer minor units, idempotency, atomic compatibility, audit/source mapping and outbox semantics.

## 6. Ordered integration sequence after the reviewed CDB checkpoint

Do not merge the existing program branches directly into `main`. Use this sequence:

1. Complete, verify, commit and publish the reviewed CDB checkpoint.
2. Fetch latest `origin/main` and create a new single-purpose consolidated integration branch/worktree from that exact SHA.
3. Integrate the reviewed CDB checkpoint first.
4. Reserve a new non-conflicting migration range after all accepted CDB migrations.
5. Rebase/replay or selectively integrate the Inventory final program while renumbering conflicting Inventory migrations and updating every manifest/test/reference deterministically.
6. Keep the destructive legacy retirement migration outside the ordinary additive migration release set.
7. Rebaseline Full MM on the consolidated latest `main` + reviewed CDB + Inventory final contracts.
8. Continue/review `MM-060` and integrate only the reviewed Full-MM slice that consumes, rather than duplicates, Inventory authority.
9. Run complete migration, canonical, Inventory, protected-core, security, RBAC, TypeScript and build gates on the consolidated branch.
10. Review the entire branch diff and commit list.
11. Merge to clean current `main`, run fresh post-merge verification and push `origin/main` under the repository integration workflow.
12. Stop. `main` integration does not itself authorize a production migration, feature activation, traffic change, deployment or destructive retirement.

## 7. Migration decision

Inventory introduces additive canonical schema/workflow migrations that will be required before Inventory runtime activation. However, their current filenames cannot be merged unchanged because `main` already uses several of the same numeric prefixes for different migrations.

Verified collision prefixes:

```text
0537, 0538, 0539, 0540, 0541, 0542, 0543, 0550, 0551, 0552, 0553
```

The integration agent must allocate a new range after current accepted CDB reservations. Renaming requires updating:

- filenames;
- migration manifest/order expectations;
- tests and fixtures;
- documentation and run reports;
- any exact migration-name authorization or evidence contracts.

Detailed matrix: [`../database/2026-07-29-inventory-main-migration-reconciliation.md`](../database/2026-07-29-inventory-main-migration-reconciliation.md).

## 8. Legacy Inventory table retirement

The repository-level zero-reference and fresh-install gates passed, but that does not prove production retirement safety.

`migrations/0558d_retire_legacy_inventory_tables.sql` must remain held until a separately authorized retirement task proves:

- exact live table existence and row counts;
- no protected-core route, job, report, export or external consumer still depends on the tables;
- no live foreign-key dependency;
- canonical data/reconciliation completeness;
- production backup and restore drill;
- old/new Worker compatibility and rollback plan;
- exact maintenance window and abort criteria;
- explicit destructive production authorization.

Do not hide this destructive migration inside a normal `wrangler d1 migrations apply` pending set. Wrangler may apply every pending migration rather than a selected subset.

## 9. Production release is a separate program

After verified `origin/main` integration, the following remain separate gates:

1. read-only production identity and pending-migration preflight;
2. production backup/restore evidence;
3. additive migration approval and execution;
4. candidate Worker upload at 0% traffic;
5. candidate-bound health/authenticated smoke;
6. canonical financial reconciliation;
7. controlled traffic promotion;
8. feature/provider activation;
9. later destructive legacy retirement.

While canonical financial shadow mode is active, do not use plain:

```text
wrangler deploy --env production
pnpm deploy:production
```

Follow `docs/operations/canonical-shadow-safe-production-deploy.md`.

## 10. Explicitly unauthorized in the current state

Unless the owner provides a fresh exact authorization, no agent may:

- query or mutate production D1;
- apply production migrations/backfills;
- drop/rename live tables or columns;
- deploy a Worker or change traffic;
- promote canonical reads or strict authority;
- change provider/feature flags;
- activate local sync;
- merge unfinished CDB/Full-MM branches directly to `main`;
- infer production migration state from repository filenames alone.

## 11. Completion definitions

### Inventory development complete

The Inventory program branch is closed, all 27 tasks are integrated, and final repository verification is green.

### Consolidated repository integration complete

Latest reviewed CDB, Inventory and applicable Full-MM changes are reconciled on latest `origin/main`, all migration collisions are resolved, full post-merge verification passes, and the commits are confirmed on `origin/main`.

### Production release complete

Approved additive migrations are applied and verified, a shadow-safe candidate passes smoke/reconciliation, controlled traffic promotion succeeds, and rollback evidence is recorded.

### Legacy retirement complete

A separately approved destructive maintenance operation removes only proven-unused live legacy tables after all retirement evidence and restore safeguards pass.

These are four different completion states. Never collapse them into one statement such as “merge and deploy is enough.”
