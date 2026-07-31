# Canonical Core V1 — Post-Release Continuation Prompt

**Last rebaselined:** 2026-07-31 after CDB-V1-071B production promotion
**Current roadmap:** [`2026-07-31-post-canonical-production-roadmap.md`](./2026-07-31-post-canonical-production-roadmap.md)
**Current board:** [`post-canonical-parallel-execution-board.yaml`](./post-canonical-parallel-execution-board.yaml)
**Machine-readable state:** [`canonical-inventory-mm-current-state.yaml`](./canonical-inventory-mm-current-state.yaml)

CDB-V1-071B is integrated and production-released. Do not route new sessions back to Gate A, Gate B or pre-release upload work. The immediate Canonical task is post-release observation; independent repository lanes may proceed in parallel.

## Current production fact

```yaml
branch: main
worktree: /Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/main-governance-integration-20260723
origin_main_sha: 3da958da07e7a20d016dbe08176a629bd6f54b65
current_verified_checkpoint: CDB-V1-071B-PRODUCTION-DEPLOYMENT-COMPLETE
next_exact_checkpoint: OBS-001-POST-RELEASE-OBSERVATION-BASELINE
main_integration_state: verified_integrated_main
production_release_state: released_100_percent
active_worker_version: 4ff275b8-f17e-4956-a104-e9083a0a1d57
active_worker_traffic_percent: 100
rollback_worker_version: 4f5d8f93-92d4-4fda-8fba-c0a2863f1b71
rollback_worker_traffic_percent: 0
migration_0571_applied: true
pending_migrations_at_release_completion: 0
remaining_target_issues: 0
provider_flags_changed: false
routes_changed: false
broad_canonical_authority_promoted: false
local_sync_activated: false
legacy_retired: false
```

Protected release receipt:

```text
/Users/rahmatullahzisan/.hms-protected/cdb-v1-071b-execution-20260731120911/final-deployment-receipt.json
SHA-256: e7de7b306b7e75685b86b1b1efebc653e2b2dab4ec8b5ceeb0acca4b52230144
```

## Immediate read-only observation prompt

```text
@HMS OBS-001 শুরু করো। Latest origin/main এবং active production Worker version verify করবে। CDB-V1-071B-এর 24-hour/72-hour post-release observation চালাবে: hms/app/admin health-version, Workers structured errors, 5xx/runtime/D1/schema error, critical-route latency, appointment/visit/invoice/receipt/allocation/commission aggregate reconciliation এবং rollback readiness capture করবে। কোনো migration, backfill, Worker upload/deployment, traffic change, provider flag change, Canonical authority promotion, local-sync activation বা Legacy retirement করবে না। PHI output করবে না; protected evidence outside repo লিখবে এবং repository report only from aggregate/redacted evidence update করবে।
```

## Inventory integration prompt

```text
@HMS INV-INT-001 শুরু করো। Latest origin/main 3da958da07e7a20d016dbe08176a629bd6f54b65 fetch করে fresh dedicated integration-rehearsal worktree বানাবে। Final Inventory branch feature/inventory-modular-monolith at c3dbee241e0ee480762339f50c261eb69b92bb41 review করবে। Post-0571 migration range centrally reserve করে conflicting Inventory migrations ও সব exact references deterministically renumber করবে। 0558d_retire_legacy_inventory_tables.sql ordinary additive release থেকে বাদ রাখবে। Full Inventory, protected-core, security, RBAC, TypeScript, migration manifest, fresh-install এবং build gates চালিয়ে merge recommendation দেবে। Production migration/deploy/activation বা legacy table drop করবে না।
```

## Full-MM rebaseline prompt

```text
@HMS MM-RB-001 শুরু করো। Current main 3da958da07e7a20d016dbe08176a629bd6f54b65, Full-MM branch program/mm-canonical-inventory-sync-20260727 at da3c63bbafd92017252f5aff77d1503dd0081eeb এবং final Inventory c3dbee241e0ee480762339f50c261eb69b92bb41 compare করবে। Existing dirty Full-MM worktree reset/stash/overwrite করবে না। 34/45 tasks, 8/10 phases, reusable commits, conflicts, duplicate Inventory authority, stale INV-MM-089 dependency এবং exact MM-070 entry gate rebaseline করে report দেবে। Blind merge, protected finance runtime change বা production action করবে না।
```

## Inactive-domain audit prompt

```text
@HMS DIAG-AUD-001 শুরু করো। Lab/Radiology diagnostics domain-এর routes, writers, readers, tables, reports, jobs, device/provider integrations, service-price/billing overlap, final Inventory contract dependencies এবং operational commissioning/data presence audit করবে। Domain greenfield Canonical-first নাকি compatibility migration দরকার—evidence-based verdict দেবে। Eligibility prove হওয়ার আগে broad implementation, production read/write, table drop বা protected-core behavior change করবে না।
```

## Parallel execution rule

Maximum four workers plus one serial integration owner:

1. `OBS-001` — production read-only observation;
2. `INV-INT-001` — repository integration rehearsal;
3. `MM-RB-001` — programme rebaseline;
4. `DIAG-AUD-001` or Patient Mobile default-off consumer lane;
5. one integration owner for shared registries, migration numbers, trackers and final merges.

Do not let workers concurrently edit:

- `src/index.ts`;
- package/lock files;
- migration journal or the same migration range;
- Canonical authority/source registries;
- central trackers;
- protected billing, invoice, payment or commission authority.

## Production boundary

The previous CDB-V1-071B authorization has been consumed for that exact release. It does not authorize a new production migration, deployment, traffic change, Inventory activation, provider promotion, local-sync activation or Legacy retirement.

A new production-facing action requires a fresh exact target, evidence, rollback plan, protected authorization and validation.

## Historical evidence

Gate A, Gate B, Gate C, 070A, 070B, 070C, 071, 071A and 071B artifacts remain immutable historical evidence. Do not rerun or rewrite them merely because a new continuation session starts.
