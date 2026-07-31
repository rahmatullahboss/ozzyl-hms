# HMS — Current Next Task

**Last updated:** 2026-07-31 18:52 Asia/Dhaka
**Repository baseline:** `3da958da07e7a20d016dbe08176a629bd6f54b65`
**Production state:** CDB-V1-071B released at 100%; initial observation pending
**Authoritative roadmap:** [Post-Canonical Production Roadmap](../architecture/2026-07-31-post-canonical-production-roadmap.md)
**Parallel board:** [Post-Canonical Parallel Execution Board](../architecture/post-canonical-parallel-execution-board.yaml)

> Do not wait idle for production data. Run read-only observation while independent repository lanes continue. Do not start another unrelated production migration or release during the initial observation window.

## 1. Current production fact

```text
origin/main: 3da958da07e7a20d016dbe08176a629bd6f54b65
release checkpoint: CDB-V1-071B-PRODUCTION-DEPLOYMENT-COMPLETE
active Worker: 4ff275b8-f17e-4956-a104-e9083a0a1d57 @ 100%
rollback Worker: 4f5d8f93-92d4-4fda-8fba-c0a2863f1b71 @ 0%
migration 0571: applied
pending migrations at release completion: 0
remaining CDB-V1-071B target issues: 0
```

CDB-V1-071B production deployment is complete. Post-release monitoring, broader authority promotion and Legacy retirement remain separate lifecycle gates.

## 2. Start now — parallel lanes

### `OBS-001 — Post-Release Observation Baseline`

Run read-only observation for the new release:

- custom-domain health and Worker version;
- 5xx/runtime/D1/schema errors;
- critical-route latency;
- new appointment/visit/invoice/receipt/allocation/commission reconciliation;
- rollback readiness;
- 24-hour and 72-hour evidence reports.

No migration, deployment, traffic change, provider flag change or authority promotion is allowed in this lane.

### `INV-INT-001 — Inventory Latest-Main Integration Rehearsal`

Inventory feature development is already complete:

```text
branch: feature/inventory-modular-monolith
head: c3dbee241e0ee480762339f50c261eb69b92bb41
tasks: 27/27
```

Next work is not another Inventory feature task. Create a fresh latest-main integration rehearsal and:

1. review the complete Inventory/main diff;
2. reserve a migration range after current `0571`;
3. renumber conflicting Inventory migrations and every exact reference;
4. exclude `0558d_retire_legacy_inventory_tables.sql` from the additive release;
5. run Inventory, protected-core, security, RBAC, TypeScript, migration, fresh-install and build gates;
6. stop with a reviewed merge recommendation—no production action.

### `MM-RB-001 — Full-MM Current-Main Rebaseline Audit`

The Full-MM programme is approximately 34/45 tasks and 8/10 phases, but its branch is not in current main and contains an older Inventory dependency. Recalculate it against:

- current Canonical main `3da958...`;
- final Inventory `c3dbee...`;
- current protected finance/core boundaries.

Preserve the existing dirty Full-MM worktree. Do not blindly merge it or duplicate Inventory authority.

### `DIAG-AUD-001 — Diagnostics Canonical Greenfield Eligibility Audit`

Audit Lab/Radiology routes, writers, readers, tables, billing/service-price overlap, Inventory consumers and actual commissioning/data presence. Stop before implementation until the domain is proven greenfield or a compatibility plan is defined.

Patient Mobile default-off consumer work may be used instead of this lane if product delivery is the higher priority.

## 3. Agent allocation

Use maximum four worker sessions plus one integration/review owner:

| Session | Task | Production effect |
|---|---|---|
| Agent 1 | `OBS-001` | Read-only observation |
| Agent 2 | `INV-INT-001` | Repository rehearsal only |
| Agent 3 | `MM-RB-001` | Repository/read-only rebaseline |
| Agent 4 | `DIAG-AUD-001` or Patient Mobile | Audit/independent consumer only |
| Integration owner | Serial review, migration reservation, tracker and merge control | No implicit production authorization |

Do not give two agents the same module, migration range, authority registry, central tracker, `src/index.ts`, package file or protected finance/core surface.

## 4. What may be Canonical-first

A module that is not commissioned and has no relevant live data can usually be developed directly on Canonical architecture without historical mapping/backfill. This is a good fit for:

- Inventory/procurement/stores after integration reconciliation;
- Diagnostics after the eligibility audit;
- workforce/attendance/roster;
- selected fixed-asset and support-operation contexts;
- Patient Mobile as a consumer of stable APIs.

Do not assume Pharmacy, accounting, insurance, IPD/Nursing/OT or any table is safely greenfield merely because staff say it is unused. Verify live rows and every route/report/job/integration reference first.

## 5. Immediate sequence

```text
1. Begin OBS-001 now.
2. Begin INV-INT-001 now.
3. Run MM-RB-001 in parallel.
4. Run one inactive-domain audit or Patient Mobile lane in parallel.
5. Merge reviewed repository work serially.
6. After the initial observation verdict, decide the next separately authorized production release.
7. Keep destructive Legacy retirement for a later maintenance gate.
```

## 6. Current blockers and decisions

| Area | Current state | Exit condition |
|---|---|---|
| CDB post-release observation | `PENDING` | 24/72-hour health, error and business reconciliation evidence |
| Inventory main integration | `PENDING` | Migration-renumbered latest-main integration passes full gates |
| Inventory production activation | `NOT AUTHORIZED` | Integrated candidate plus exact additive migration/deploy approval |
| Full-MM | `REBASELINE REQUIRED` | Current-main/final-Inventory dependency map and MM-070 gate accepted |
| Inactive module rewrite | `AUDIT FIRST` | Greenfield eligibility and protected-core overlap are proven |
| Legacy table drop | `HOLD` | Zero-reference, backup/restore, rollback and exact destructive authorization |

## 7. Status vocabulary

- **Code deployed:** the route/UI is in the active Worker bundle.
- **Operationally commissioned:** the hospital has configured and is using the module.
- **Canonical authority complete:** the module has one reviewed authority and has passed integration/data/retirement gates.
- **Production released:** approved migrations and controlled Worker promotion are complete.
- **Observed stable:** the defined real-traffic observation window is complete.
- **Retired:** separately authorized destructive cleanup is complete.

Never treat these as the same status.
