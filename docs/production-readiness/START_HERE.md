# HMS Engineering and Production Readiness — Start Here

**Last rebaselined:** 2026-07-31 18:52 Asia/Dhaka
**Current architecture status:** CDB-V1-071B is production-released at 100%; post-release observation, Inventory current-main integration, Full-MM rebaseline and inactive-domain Canonical work are the next tracks.

> New engineering sessions start here. Historical pre-release documents remain evidence, but they must not redirect work back to obsolete CDB checkpoints or imply that the current Worker is not deployed.

## 1. Read these current documents first

1. [Post-Canonical Production Roadmap](../architecture/2026-07-31-post-canonical-production-roadmap.md)
2. [Post-Canonical Parallel Execution Board](../architecture/post-canonical-parallel-execution-board.yaml)
3. [Machine-Readable Current State](../architecture/canonical-inventory-mm-current-state.yaml)
4. [Current Next Task](./CURRENT_NEXT_TASK.md)
5. [Task Status](./TASK_STATUS.md)
6. [Production Scope Policy](../architecture/hms-production-scope-policy.md)
7. [Canonical Shadow-Safe Production Deploy Runbook](../operations/canonical-shadow-safe-production-deploy.md)
8. [Cloudflare Tail Logging](../CLOUDFLARE_TAIL_LOGGING.md)

Then inspect live Git branches, worktrees, remote refs, dirty files and external authorization state. Documentation branch heads are observations and must be rechecked before integration.

## 2. Current production fact

```text
origin/main: 3da958da07e7a20d016dbe08176a629bd6f54b65
active Worker: 4ff275b8-f17e-4956-a104-e9083a0a1d57 @ 100%
rollback Worker: 4f5d8f93-92d4-4fda-8fba-c0a2863f1b71 @ 0%
release: CDB-V1-071B-PRODUCTION-DEPLOYMENT-COMPLETE
migration 0571: applied
pending migrations at completion: 0
remaining target reconciliation issues: 0
```

The controlled release is complete. The initial 24/72-hour observation and later authority/retirement gates are not complete.

## 3. Status dimensions

Always distinguish:

- **Code deployed:** route/UI is in the active Worker bundle.
- **Operationally commissioned:** hospital staff are configured, trained and using the module.
- **Canonical authority complete:** one reviewed data authority exists and integration/data/retirement gates passed.

Many optional HMS routes are deployed in the Worker without being operationally commissioned or Canonical-complete.

## 4. Exact immediate work

Run these lanes in parallel with one serial integration owner:

1. `OBS-001` — read-only post-release observation and business reconciliation;
2. `INV-INT-001` — final Inventory branch reconciliation into current main;
3. `MM-RB-001` — Full-MM current-main/final-Inventory rebaseline;
4. `DIAG-AUD-001` — Diagnostics greenfield eligibility audit, or Patient Mobile default-off consumer work.

Do not run another unrelated production release during the initial observation window. Repository-only work may continue immediately.

## 5. Inventory status

```text
branch: feature/inventory-modular-monolith
head: c3dbee241e0ee480762339f50c261eb69b92bb41
development: complete 27/27
current-main integration: pending
production activation: pending separate authorization
legacy retirement: not authorized
```

Inventory needs integration/migration reconciliation, not another feature-development task. Its Canonical-only greenfield policy means no production data backfill is expected, but live references and rollback must still be verified before old tables are retired.

## 6. Full Modular Monolith status

- tasks: 34/45 — 75.6%;
- phases: 8/10 — 80%;
- branch not contained in current main;
- final Inventory dependency must be updated from `INV-MM-089` to `INV-MM-121`;
- `MM-070`–`MM-074` finance work and `MM-090`–`MM-095` retirement/final verification remain.

Start with rebaseline/audit, not a blind branch merge or immediate finance cutover.

## 7. Greenfield inactive-module rule

Canonical-first replacement is appropriate only after proving:

1. the module is not commissioned;
2. relevant live rows are zero or formally irrelevant;
3. no route/report/job/queue/integration depends on the legacy tables;
4. no hidden protected-core money/identity/price/commission/stock authority exists;
5. fresh-install and rollback compatibility pass;
6. destructive retirement remains separate.

Good next candidates: Inventory integration, Diagnostics after audit, workforce/attendance/roster, selected fixed-asset/support-operation contexts and Patient Mobile as a consumer. Pharmacy, accounting, insurance and broad IPD/Nursing/OT changes require stronger live-use and safety review.

## 8. Multi-agent rules

Use maximum four worker sessions plus one integration/review owner.

Workers may run in parallel, but these remain serialized:

- migration number reservation;
- Canonical authority/source registries;
- central trackers;
- `src/index.ts` and route permission composition;
- package/lock files;
- protected billing/commission/finance authority;
- final merge and post-merge verification.

Never reset, clean, stash, discard or overwrite another dirty worktree.

## 9. Production actions remain separate gates

The completed CDB-V1-071B approval does not automatically authorize:

- another production migration or Worker release;
- Inventory production activation;
- provider/read/write authority promotion;
- local-sync activation;
- Legacy table deletion;
- destructive retirement.

Each future production action requires its own exact target, evidence, rollback and authorization.

## 10. Historical documents

The older 2026-07-29 release-control center, continuation prompts and migration reports remain useful for history and branch evidence. Where they conflict with the current roadmap or machine state, the 2026-07-31 documents win.
