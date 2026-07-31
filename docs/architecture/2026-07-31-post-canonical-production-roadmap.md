# Ozzyl HMS — Post-Canonical Production Roadmap

**Authoritative review time:** 2026-07-31 18:52 Asia/Dhaka
**Repository baseline:** `3da958da07e7a20d016dbe08176a629bd6f54b65`
**Production Worker:** `hms-saas-production`
**Active version:** `4ff275b8-f17e-4956-a104-e9083a0a1d57` at 100% traffic
**Rollback version:** `4f5d8f93-92d4-4fda-8fba-c0a2863f1b71` retained at 0%
**Purpose:** Replace the stale pre-release sequencing with the current post-deployment monitoring, Inventory integration, Full-MM rebaseline and inactive-module execution plan.

> This document is the owner-facing source of truth after CDB-V1-071B. Historical documents remain useful for evidence, but any statement saying Canonical production deployment is still pending is superseded by this review.

## 1. Executive decision

Do **not** stop engineering and wait passively for new production data. Use two concurrent tracks:

1. **Production observation track:** watch the newly promoted Canonical-compatible release, collect real-traffic evidence and keep rollback ready.
2. **Repository development track:** continue work that cannot affect the protected live core—first Inventory integration/reconciliation, Full-MM rebaseline and one audited inactive bounded context.

For the first 24 hours after deployment, avoid another unrelated production migration or Worker release unless it is an emergency. Repository-only work in isolated branches can continue immediately.

## 2. What is complete now

### 2.1 Protected production core release

The release containing Reception/patient identity, appointments/visits, billing/invoice/collection, hospital/service setup, doctor/practitioner/commission dependencies and the required auth/RBAC/audit support is deployed.

| Gate | State |
|---|---|
| `origin/main` release commit | `3da958da07e7a20d016dbe08176a629bd6f54b65` |
| Worker candidate upload | Complete |
| 5% canary | Passed |
| 50% rollout | Passed |
| 100% promotion | Complete |
| Custom-domain health/version sampling | Passed on `hms.ozzyl.com`, `app.ozzyl.com`, `admin.ozzyl.com` |
| Migration `0571` | Applied |
| Pending production migrations | 0 at release completion |
| Admission/bed reconciliation | 38 admissions and 16 bed stays converged |
| Processing issues | 54 resolved, 4 formally waived, 0 target issues open |
| Mandatory second pass | Zero new business rows |
| Rollback Worker | Retained at 0% |

Protected completion receipt:

```text
/Users/rahmatullahzisan/.hms-protected/cdb-v1-071b-execution-20260731120911/final-deployment-receipt.json
SHA-256: e7de7b306b7e75685b86b1b1efebc653e2b2dab4ec8b5ceeb0acca4b52230144
```

### 2.2 What “deployed” does not mean

CDB-V1-071B completes the controlled Worker release. It does **not** automatically complete all of these later lifecycle gates:

- sustained real-traffic observation;
- business-level zero-variance monitoring over new invoices, collections, appointments and doctor commissions;
- promotion of every Canonical read/write provider or flag;
- retirement of every compatibility or Legacy path;
- destructive deletion of old tables;
- commissioning every HMS module at a hospital.

Legacy final-response authority and explicitly unchanged provider flags remain separate from the Worker release. Future authority promotion and retirement require their own evidence and approvals.

## 3. Use three status dimensions for every module

A route being present in `src/index.ts` means its code is included in the production Worker bundle. That is not enough to say the module is live or Canonical-complete.

| Dimension | Meaning |
|---|---|
| **Code deployed** | API/UI code is contained in the active Worker/assets. Many optional modules meet this condition. |
| **Operationally commissioned** | The hospital has configured the module, trained staff, entered opening data and is actually using it. |
| **Canonical authority complete** | The module owns its data through reviewed Canonical commands/queries, has no duplicate authority and has passed integration, migration, reconciliation and retirement gates. |

Therefore Lab, Inventory, HR, IPD, OT, Nursing, Radiology and support-operation routes may be deployed in the Worker while still being uncommissioned and/or not fully Canonical-authoritative.

## 4. Program progress

### 4.1 Canonical protected core

| Stage | State |
|---|---|
| Surface inventory and authority contracts | Complete |
| Writer command coverage | Complete for the protected program checkpoint |
| Main integration | Complete |
| Production migrations/reconciliation | Complete for CDB-V1-071B |
| Controlled Worker promotion | Complete |
| 24/72-hour observation | Pending |
| Business variance review on new live records | Pending |
| Broad provider/read/write authority promotion | Separate future gate |
| Legacy compatibility retirement | Separate future gate |

**Owner interpretation:** the production release is complete; the transition programme remains open for observation and later authority/retirement decisions.

### 4.2 Inventory Modular Monolith

Authoritative program branch:

```text
branch: feature/inventory-modular-monolith
head: c3dbee241e0ee480762339f50c261eb69b92bb41
status: development complete — 27/27
```

Recorded verification:

- focused architecture: 35/35;
- Inventory tests: 1,138/1,138;
- protected Reception/Billing: 183/183;
- security: 45/45;
- RBAC: 1,039/1,039;
- TypeScript errors: 0;
- Canonical Inventory tables: 39/39;
- registry targets: 31/31;
- legacy runtime write/read/import/schema references: 0/0/0/0;
- foreign-key violations: 0.

Inventory is **not a new implementation project**. Its current status is:

| Inventory stage | State |
|---|---|
| Feature/domain development | 100% on program branch |
| Program verification | Complete |
| Reconciliation with current `main` | Pending |
| Migration renumbering after current main migrations | Pending |
| Integration into `origin/main` | Pending |
| Production additive schema activation | Pending separate authorization |
| Operational commissioning/opening stock | Pending hospital-specific decision |
| Legacy table retirement | Not authorized; must remain separate |

The owner-approved policy says Inventory is Canonical-only greenfield and a production data migration is not expected. This reduces complexity, but it does not remove the need to verify live rows, background jobs, reports, foreign keys, fresh-install schema and rollback before retiring old tables.

### 4.3 Full Modular Monolith

Last reviewed programme state:

- planned tasks: **34/45 = 75.6%**;
- phases: **8/10 = 80%**;
- implemented top-level module boundaries on the Full-MM branch: 10;
- remaining tasks: 11;
- branch `program/mm-canonical-inventory-sync-20260727` is not contained in current `main`;
- the branch must be rebaselined onto current Canonical main and final Inventory contracts.

Remaining high-level work:

1. `MM-070`–`MM-074`: financial boundary characterization, public APIs, adapters, consumers and zero-variance verification;
2. `MM-090`–`MM-095`: compatibility-retirement eligibility, bounded retirement and final verification.

The 75.6% task figure is structural progress, not 75.6% production conversion.

### 4.4 Monitoring and operations

Already present:

- public `/api/health` returns Worker version identity;
- Workers Observability is enabled;
- structured `[SERVER_ERROR]` logging exists;
- `pnpm tail:production` and `pnpm tail:production:all` exist;
- Admin/MD operational dashboards and cash-control APIs exist;
- previous Worker remains available for rollback.

Still needed for durable monitoring:

- 24-hour and 72-hour post-release evidence reports;
- version-bound 5xx/runtime/D1/schema error counts;
- latency and error-rate baseline by critical route family;
- new-record reconciliation for appointments, visits, invoices, receipts, allocations and commissions;
- durable log export/Tail Worker/Logpush instead of relying only on an interactive tail;
- alert delivery, ownership and incident-response drill;
- dashboard timestamps and clearer drill-downs where still missing.

## 5. Can inactive modules be rewritten directly on Canonical tables?

Yes—**when they are proven uncommissioned and outside the protected production core**. The greenfield approach is substantially easier because it can avoid dual-write, historical backfill and parity mapping.

Before treating a module as greenfield, prove all of these:

1. the hospital has not commissioned the module;
2. relevant production legacy tables have zero business rows or a formally accepted irrelevant dataset;
3. no route, report, export, cron, queue, notification, local-sync worker or integration still depends on those tables;
4. the module does not silently share money, patient identity, service pricing, doctor commission or stock authority with the protected core;
5. fresh-hospital bootstrap can create the Canonical schema and required master data;
6. rollback can restore the previous Worker without requiring a missing legacy write path;
7. destructive table removal is held for a later, separately authorized maintenance gate.

“Not used by staff” is not enough evidence to drop a table. Use additive Canonical schema first; retire old tables only after zero-reference and recovery evidence.

## 6. Module priority matrix

| Module/domain | Current engineering state | Canonical-first suitability | Recommended next action |
|---|---|---|---|
| Inventory/procurement/stores | Development complete on separate branch; not in main | **Very high** | Integration rehearsal, migration renumbering, full tests, then separate production activation |
| Lab/Radiology diagnostics | Broad code/contracts exist; commissioning varies | **High after audit** | Read-only consumer/authority/data audit before implementation |
| HR/attendance/roster/payroll | Workforce boundary exists; finance posting remains a dependency | **High for workforce, medium for payroll** | Continue workforce independently; defer payroll-accounting finalization until finance APIs freeze |
| Fixed assets/maintenance | Inventory adapter work exists; accounting link remains | **Medium-high** | Reuse Inventory public contracts; define finance posting boundary |
| IPD/Nursing/OT | Broad code exists; patient-safety and bed/medication effects are complex | **Medium** | Commissioning and Canonical convergence in bounded subdomains, not one broad rewrite |
| Pharmacy | Potentially live and overlaps billing, prescriptions and Inventory | **Low as immediate broad rewrite** | First reconcile live usage and integrate final Inventory contracts |
| Accounting/insurance | Directly overlaps protected money authority | **Low until finance freeze** | Execute Full-MM finance tasks serially after rebaseline |
| Housekeeping/laundry/kitchen/mortuary/waste | Usually uncommissioned and weakly coupled | **High technically, lower business priority** | Canonical-first only when selected for the first-hospital scope |
| Patient mobile/portal consumer | Separate product consumer; must not become backend authority | **High as independent lane** | Continue default-off consumer work against stable public APIs |
| AI/AgentOS/Foundry | Optional future platform | **Deferred** | Do not distract from Core HMS observation and module commissioning |

## 7. Recommended execution phases

### Phase A — immediate post-release window: now to 24 hours

Run production observation without blocking repository work:

- public health/version checks on all three custom domains;
- error-only Cloudflare tail or durable observability query;
- confirm no pending migration and no target reconciliation issue reopens;
- watch D1/schema errors, unexpected 5xx and latency changes;
- compare new reception/billing/commission records against expected business totals;
- keep the rollback version unchanged at 0%;
- do not perform another unrelated production release during the observation window.

If real traffic is low, do not wait indefinitely. Use a controlled demo/non-PHI transaction set or a non-production tenant to exercise the critical flow.

### Phase B — parallel repository work during observation

Start these independent lanes now:

1. **OBS-001 — Post-release observation baseline**
   Read-only production evidence and incident register. No repository authority change.

2. **INV-INT-001 — Inventory latest-main integration rehearsal**
   Reconcile `c3dbee...` against `3da958...`, reserve a new migration range after `0571`, rename every conflicting migration/reference, exclude destructive retirement, and produce a merge recommendation.

3. **MM-RB-001 — Full-MM rebaseline audit**
   Recalculate the 34/45 programme against current main and final Inventory contracts; identify reusable commits, conflicts, duplicate authority and the exact MM-070 entry gate. Do not merge the existing dirty programme worktree blindly.

4. **DIAG-AUD-001 — Diagnostics Canonical claim audit**
   Inventory Lab/Radiology routes, writers, readers, schemas, Inventory consumers, billing/service-price dependencies and production row usage. Stop before broad implementation until greenfield eligibility is proven.

An optional fourth independent product lane may continue Patient Mobile default-off consumer work instead of Diagnostics if product delivery is the higher priority.

### Phase C — after the first observation verdict

If production health and business reconciliation remain green:

1. integrate the reviewed Inventory branch through a fresh latest-main integration branch;
2. run the complete Inventory, protected-core, security, RBAC, TypeScript, migration, build and fresh-install gates;
3. obtain a separate additive production migration/deployment authorization for Inventory;
4. begin one audited inactive bounded-context implementation;
5. keep protected finance/reception changes serial and evidence-gated.

### Phase D — Full-MM completion

After current main and Inventory contracts are stable:

1. rebaseline and execute MM-070 through MM-074 serially;
2. prove exact integer-minor-unit finance reconciliation;
3. identify non-financial compatibility paths eligible for retirement;
4. retire only disjoint, proven-unused paths in separate tasks;
5. keep financial retirement and destructive database actions separately authorized;
6. finish MM-094 and MM-095 integrated verification.

### Phase E — hospital commissioning

Code completion is followed by operational commissioning:

- module configuration and opening balances;
- role/SOP and staff training;
- realistic department E2E;
- backup/restore and downtime drill;
- provider/device commissioning;
- accountable departmental sign-off.

## 8. Multi-agent operating model

Use **maximum four worker sessions plus one integration/review owner**.

| Lane | Owner | May run in parallel? | Shared-risk rule |
|---|---|---:|---|
| Production observation | Agent 1 | Yes | Read-only; no deployment or flag changes |
| Inventory integration rehearsal | Agent 2 | Yes | Own branch; migration numbers reserved by integrator |
| Full-MM rebaseline audit | Agent 3 | Yes | Do not modify the existing dirty programme branch without ownership |
| Diagnostics audit or Patient Mobile | Agent 4 | Yes | Must not alter protected core contracts |
| Integration/review | One serial owner | No concurrent merges | Owns central trackers, registries, migration journal, `src/index.ts`, package files and final verification |

Do not run multiple workers concurrently on:

- billing/invoice/payment/commission authority;
- the same migration range;
- `src/index.ts` or central route permission files;
- Canonical authority/source registries;
- `package.json`/lockfile;
- central programme trackers;
- the same module or shared schema.

Workers can develop in parallel; integration remains serial.

## 9. Immediate owner decision

The correct next move is:

```text
Do not wait idle.
Keep CDB-V1-071B under observation.
Start Inventory integration rehearsal now.
Run Full-MM rebaseline and one inactive-domain audit in parallel.
Do not start another protected-core production mutation during the initial observation window.
```

Inventory should be treated as **development complete but unreleased**, not as unfinished feature development. Other inactive modules can be Canonical-first, but only after a short greenfield eligibility audit proves that no live data or shared authority will be lost.

## 10. Completion definitions

- **Production Worker released:** current candidate is at 100% with health and rollback evidence. This is complete for CDB-V1-071B.
- **Post-release observation complete:** defined 24/72-hour health, error and business reconciliation evidence is accepted.
- **Inventory repository integration complete:** final Inventory contracts are reconciled into current main with fresh tests.
- **Inventory production activation complete:** separately approved additive migrations and controlled release are complete.
- **Module Canonical complete:** no duplicate authority remains and the module has passed integration, data, operational and retirement gates.
- **Legacy retirement complete:** separately authorized destructive maintenance has safely removed proven-unused live structures.
