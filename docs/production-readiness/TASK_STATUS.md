# HMS Architecture and Production Readiness Task Status

**Last updated:** 2026-07-31 18:52 Asia/Dhaka
**Observed Git baseline:** `origin/main` at `3da958da07e7a20d016dbe08176a629bd6f54b65`
**Authoritative roadmap:** [`../architecture/2026-07-31-post-canonical-production-roadmap.md`](../architecture/2026-07-31-post-canonical-production-roadmap.md)
**Machine-readable board:** [`../architecture/post-canonical-parallel-execution-board.yaml`](../architecture/post-canonical-parallel-execution-board.yaml)

> Statuses below separate code deployment, operational commissioning, Canonical authority, repository integration, production release, observation and destructive retirement. A module may have deployed routes without being commissioned or Canonical-complete.

## 1. Current architecture and release board

| Program or gate | Current status | Verified evidence | Exact next action | Production effect now |
|---|---|---|---|---|
| CDB-V1-071B repository integration | `INTEGRATED TO MAIN` | `3da958da07e7a20d016dbe08176a629bd6f54b65` on `origin/main` | Keep release commit stable during observation | Already released |
| CDB-V1-071B production Worker | `PRODUCTION RELEASED` | Worker `4ff275b8-f17e-4956-a104-e9083a0a1d57` at 100% | `OBS-001` 24/72-hour observation | Active at 100% |
| CDB migration/reconciliation | `PASS` | `0571` applied; pending 0; 54 issues resolved; 4 waived; 0 open | Watch for reopened/new variance | Completed for this release |
| Post-release observation | `READY TO START` | Health/version and rollback baseline exist | `OBS-001` | Read-only only |
| Inventory Modular Monolith development | `COMPLETE — PROGRAM BRANCH` | 27/27 at `c3dbee241e0ee480762339f50c261eb69b92bb41` | Do not create new Inventory feature task | None |
| Inventory latest-main integration | `READY TO START` | Final branch clean; current main does not contain it | `INV-INT-001` migration reconciliation and integration rehearsal | Repository only |
| Inventory production activation | `NOT AUTHORIZED` | No integrated current-main Inventory candidate | Finish integration and request exact additive release approval | None |
| Full Modular Monolith | `REBASELINE REQUIRED` | 34/45 tasks; 8/10 phases; branch `da3c63...` not in main | `MM-RB-001` | None |
| Diagnostics inactive-domain audit | `READY TO START` | Broad Lab/Radiology code exists; commissioning status must be proven | `DIAG-AUD-001` | Read-only/audit only |
| Broad Canonical provider/read/write promotion | `DEFERRED — SEPARATE GATE` | Worker release did not change provider flags | Observe and build zero-variance evidence | None |
| Legacy compatibility retirement | `NOT AUTHORIZED — HOLD` | Rollback version retained; destructive evidence incomplete | Later bounded retirement tasks | None |
| Local-sync activation | `DISABLED / DEFERRED` | No current activation programme | Separate operational programme | None |

## 2. CDB-V1-071B production completion record

| Evidence | Result |
|---|---:|
| Active Worker | `4ff275b8-f17e-4956-a104-e9083a0a1d57` |
| Candidate traffic | 100% |
| Rollback Worker | `4f5d8f93-92d4-4fda-8fba-c0a2863f1b71` |
| Rollback traffic | 0% |
| Migration `0571` | Applied |
| Pending migrations at completion | 0 |
| Canonical admissions converged | 38 |
| Canonical bed stays converged | 16 |
| Dependency issues resolved | 54 |
| Cache variance waived | 4 |
| Remaining target issues | 0 |
| Second-pass new business rows | 0 |
| Source legacy writes | 0 |
| Unexpected tenant writes | 0 |

Protected receipt SHA-256:

```text
e7de7b306b7e75685b86b1b1efebc653e2b2dab4ec8b5ceeb0acca4b52230144
```

This marks the controlled Worker release complete. It does not mark all Canonical provider promotion or Legacy retirement complete.

## 3. Immediate parallel tasks

| Task | Status | Owner model | Scope | Stop condition |
|---|---|---|---|---|
| `OBS-001` | `READY TO START` | Production observation worker | Version, health, errors, latency, business reconciliation, rollback readiness | Any error/variance becomes an incident; no mutation |
| `INV-INT-001` | `READY TO START` | Inventory integration worker | Current-main diff, post-0571 migration reservation, renumber, tests, merge recommendation | Stop before production |
| `MM-RB-001` | `READY TO START` | Full-MM rebaseline worker | Current main + final Inventory dependency and reusable-commit map | Preserve existing dirty programme worktree |
| `DIAG-AUD-001` | `READY TO START` | Diagnostics audit worker | Lab/Radiology authority, consumers, live-data and greenfield eligibility | No broad implementation before verdict |
| Integration owner | `REQUIRED` | One serial owner | Shared registries, migration numbers, central trackers, merge and post-merge verification | Integrate one reviewed worker at a time |

Recommended maximum: four workers plus one integration/review owner.

## 4. Inventory completion and release distinction

Inventory programme evidence:

| Evidence | Result |
|---|---:|
| Tasks | 27/27 |
| Latest integrated task | `INV-MM-121` |
| Focused architecture | 35/35 |
| Inventory tests | 1,138/1,138 |
| Protected Reception/Billing | 183/183 |
| Security | 45/45 |
| RBAC | 1,039/1,039 |
| TypeScript errors | 0 |
| Canonical Inventory tables | 39/39 |
| Registry targets | 31/31 |
| Legacy runtime write/read/import/schema references | 0/0/0/0 |
| Foreign-key violations | 0 |

Exact interpretation:

- feature/domain development: complete;
- final programme verification: complete;
- current-main integration: pending;
- migration renumbering/reconciliation: pending;
- production additive migration/deployment: not authorized;
- opening stock/operational commissioning: pending;
- destructive legacy table retirement: held separately.

Do not assign another `INV-MM` implementation task. Assign `INV-INT-001`.

## 5. Full Modular Monolith status

Last verified structural progress:

- 34 of 45 tasks complete — 75.6%;
- 8 of 10 phases complete — 80%;
- 10 top-level module boundaries exist on the programme branch;
- 11 tasks remain: `MM-070`–`MM-074` and `MM-090`–`MM-095`;
- final Inventory contract dependency must move from `INV-MM-089` to `INV-MM-121`;
- branch is not contained in current main;
- existing dirty files must be preserved and reviewed, not reset or blindly merged.

The next task is rebaseline/audit, not immediate protected finance implementation.

## 6. Inactive module policy

A non-commissioned module can be rewritten Canonical-first when the following are proven:

1. no active operational use;
2. no relevant live business rows, or the rows are formally irrelevant;
3. no route/report/export/job/queue/integration dependency on legacy tables;
4. no hidden protected-core money, identity, service-price, commission or stock authority;
5. fresh-install and rollback compatibility pass;
6. any destructive retirement remains a separate authorization.

Preferred sequence:

1. Inventory integration;
2. Diagnostics eligibility audit;
3. workforce/fixed-asset or selected support-operation work;
4. IPD/Nursing/OT in bounded patient-safety slices;
5. Pharmacy and finance only after live-use and authority overlap are frozen.

## 7. Monitoring status

### Present now

- version-bound `/api/health`;
- Cloudflare Workers Observability;
- structured server error logging;
- `pnpm tail:production`;
- Admin/MD and cash-control monitoring APIs;
- rollback Worker retained.

### Still pending

- 24-hour and 72-hour release evidence;
- critical-route 5xx/error/latency baseline;
- new appointment/visit/invoice/receipt/allocation/commission reconciliation;
- durable log export and alerting;
- incident owner and on-call drill;
- module-specific operational commissioning dashboards.

## 8. Active blockers

| ID | Priority | Blocker | Current state | Exit condition |
|---|---|---|---|---|
| OBS-01 | P0 | New production release has limited observation time | Open | 24/72-hour reports accepted |
| INT-01 | P0 | Inventory migration numbers conflict with historical current-main range | Open | Reserve post-0571 range and update every reference |
| INT-02 | P0 | Inventory final branch not in current main | Open | Reviewed integration passes full gates |
| MM-01 | P1 | Full-MM branch is stale against current main/final Inventory | Open | `MM-RB-001` accepted |
| MON-01 | P1 | Monitoring is not yet durable/alerted | Open | Log export, alert delivery and incident drill |
| MOD-01 | P1 | “Unused module” has not been proven greenfield | Open per domain | Eligibility audit with live-data/reference evidence |
| DB-01 | P0 | Destructive Inventory retirement migration exists | Hold | Separate maintenance evidence and exact approval |

## 9. Status definitions

- `READY TO START`: exact bounded task may begin in its own worktree.
- `IN PROGRESS`: one owner has claimed and is actively executing the task.
- `READY FOR INTEGRATION`: clean verified worker branch exists; not yet in main.
- `INTEGRATED TO MAIN`: post-merge verification passed and origin/main contains it.
- `PRODUCTION RELEASED`: controlled migration/deploy/traffic gate completed.
- `OBSERVED STABLE`: defined real-traffic observation and business reconciliation passed.
- `COMPLETE — PROGRAM BRANCH`: programme implementation complete on its branch, later integration/release may remain.
- `REBASELINE REQUIRED`: branch dependencies/history must be reconciled before implementation or merge.
- `RETIRED`: separately authorized compatibility/data retirement completed.

## 10. Claim rules

1. A deployed route is not proof of operational commissioning.
2. Operational commissioning is not proof of Canonical authority completion.
3. Inventory development completion is not current-main integration or production activation.
4. CDB Worker release completion is not broad provider promotion or Legacy retirement.
5. Do not infer a safe table drop from “no one uses this page.”
6. Workers may develop in parallel; merges, migration reservations and shared tracker updates are serial.
7. Every production mutation/deployment/activation/retirement remains an exact external-action gate.
