# Canonical DB, Inventory MM and Full MM — New Chat Continuation Prompts

> **Historical pre-release prompts — do not execute as current work.** Use [Canonical Core V1 Post-Release Continuation Prompt](./canonical-main-continuation-prompt.md) and the [2026-07-31 roadmap](./2026-07-31-post-canonical-production-roadmap.md). CDB-V1-071B is already deployed.

**Read first:** [`2026-07-29-canonical-inventory-mm-release-control-center.md`](./2026-07-29-canonical-inventory-mm-release-control-center.md)
**Machine state:** [`canonical-inventory-mm-current-state.yaml`](./canonical-inventory-mm-current-state.yaml)

Use only the prompt matching the current gate. Do not skip directly to integration, migration or deployment.

## 1. Immediate prompt — continue Canonical Core V1

```text
@HMS CDB-V1-030M continue করো। প্রথমে current workspace, agents.md, .agent-rules/git-workflow.md, docs/architecture/2026-07-29-canonical-inventory-mm-release-control-center.md, docs/architecture/canonical-inventory-mm-current-state.yaml এবং existing CDB branch-এর docs/architecture/canonical-program-control-center.md, docs/architecture/hms-canonical-parallel-execution-board.yaml, task-progress.yaml ও .ai-bridge/current-plan.md পড়বে। Existing branch program/cdb-main-continuous-20260725 এবং worktree /Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725 verify/resume করবে; কোনো dirty বা unrelated change reset, discard, clean, stash বা overwrite করবে না। Fetch করে local/remote state ও exact HEAD record করবে। Current verified checkpoint CDB-V1-030L-PAYMENT-RECEIPT-TENDER-ALLOCATION-INTEGRATION-VERIFIED থেকে exact next task CDB-V1-030M-SERVICE-CATALOG-PRICING-INTEGRATION execute করবে। billingMaster.ts, priceCategories.ts এবং settings-import-export.ts-এর পাঁচটি remaining service-catalog/pricing writer pair existing canonical service-catalog/effective-price command/provider boundary দিয়ে integrate করবে; exact service/price-category identity, effective interval, currency, integer minor units, atomic compatibility, source mapping, audit, idempotency, outbox, tenant isolation, exact replay, changed replay conflict, overlapping period rejection, stale/concurrent rejection এবং complete rollback prove করবে। Focused tests, applicable protected-core regressions, TypeScript, migration manifest ও canonical governance চালাবে; coherent checkpoint commit করবে এবং central tracker/control docs update করবে। Local CDB branch observed origin branch-এর ahead state reconcile/push করার আগে history review করবে। Inventory branch, Full-MM branch বা main সরাসরি merge করবে না। Production query/mutation, migration/backfill, deploy, flag/provider/traffic change, canonical read promotion, destructive retirement এবং local-sync activation করবে না। Exact checkpoint complete হলে clean handoff দেবে: branch, base/head SHA, commits, tests/counts, migration names, tracker state, next exact action, remote status এবং production_mutation=false।
```

## 2. Later prompt — consolidated integration rehearsal

Run only after the owner/reviewer confirms the required CDB checkpoint is complete, committed, clean and available for integration.

```text
@HMS Canonical + Inventory + Full-MM consolidated integration rehearsal শুরু করো। প্রথমে agents.md, .agent-rules/git-workflow.md, docs/architecture/2026-07-29-canonical-inventory-mm-release-control-center.md, docs/architecture/canonical-inventory-mm-current-state.yaml এবং docs/database/2026-07-29-inventory-main-migration-reconciliation.md পুরোটা পড়বে। সব live worktree/branch/dirty state inspect করবে এবং কোনো existing work reset, discard, clean, stash বা overwrite করবে না। git fetch origin main এবং তিনটি named program branch fetch করে latest origin/main SHA record করবে। Latest origin/main থেকে নতুন single-purpose integration branch/worktree তৈরি করবে; existing program worktree-তে integration করবে না। Reviewed CDB checkpoint প্রথমে integrate করবে। এরপর migration reservation নির্ধারণ করে Inventory branch feature/inventory-modular-monolith-এর final checkpoint c3dbee241e0ee480762339f50c261eb69b92bb41 selectively reconcile করবে। Main/CDB-এর সঙ্গে conflicting migration prefixes 0537, 0538, 0539, 0540, 0541, 0542, 0543, 0550, 0551, 0552, 0553 নতুন non-conflicting range-এ renumber করবে এবং filenames, manifest, tests, fixtures, docs ও exact-name evidence atomically update করবে। migrations/0558d_retire_legacy_inventory_tables.sql ordinary additive release set-এ রাখবে না; destructive retirement আলাদা unauthorized gate হিসেবে hold করবে। Inventory public contracts integrate হওয়ার পরে program/mm-canonical-inventory-sync-20260727-কে latest main + reviewed CDB + INV-MM-121 final checkpoint-এর উপর rebaseline/review করবে; duplicate Inventory authority তৈরি করবে না এবং MM-060 ownership বজায় রাখবে। Full migration determinism/fresh-install, canonical governance, Inventory 1,138-regression scope, protected Reception/Billing, security, RBAC, TypeScript এবং build gates চালাবে। Complete diff/commit review ছাড়া main merge করবে না। এই prompt production D1 read/write, production migration, deploy, traffic/flag change, legacy table drop বা local-sync activation authorize করে না। Integration rehearsal green হলে exact merge recommendation ও remaining production gates লিখে থামবে; explicit main integration instruction ছাড়া main push করবে না।
```

## 3. Main integration prompt

Run only when the consolidated integration branch is clean, reviewed and all required gates are green.

```text
@HMS verified consolidated Canonical + Inventory + Full-MM integration main-এ integrate করো। Clean dedicated main integration worktree discover/verify করবে, git fetch origin main করবে এবং pnpm worktree:check -- --mode=integration --require-latest-origin-main pass করাবে। Consolidated branch single-purpose, committed, clean, latest origin/main-reconciled, migration-collision-free এবং destructive retirement excluded কিনা verify করবে। Complete branch diff ও commit list review করে main-এ serial merge/fast-forward করবে। Fresh post-merge migration manifest, canonical governance, Inventory, protected Reception/Billing, security, RBAC, TypeScript এবং build verification চালাবে। Green হলে origin/main push করে remote commit containment verify করবে এবং task branch/worktree cleanup policy অনুসরণ করবে। Production migration, production deployment, flag/provider/traffic change, canonical read promotion, legacy table drop এবং local-sync activation করবে না; এগুলোর জন্য আলাদা exact authorization লাগবে। Final report-এ base origin/main SHA, integration branch/head, merge SHA, test counts, origin/main push confirmation, migration disposition, 0558d hold status এবং cleanup status দেবে।
```

## 4. Production preflight prompt

This prompt is read-only unless a separate exact mutation authorization is included.

```text
@HMS Canonical + Inventory production release read-only preflight করো। Verified origin/main release commit, exact production database identity, current Worker/deployment/traffic/feature-flag state, applied and pending migration list, migration order, foreign-key evidence, backup/restore readiness এবং rollback baseline read-onlyভাবে collect করবে। docs/operations/canonical-shadow-safe-production-deploy.md এবং docs/database/2026-07-29-inventory-main-migration-reconciliation.md অনুসরণ করবে। Production pending set-এ destructive 0558d_retire_legacy_inventory_tables.sql থাকলে release BLOCKED ঘোষণা করবে। কোনো migration/backfill apply, deploy/upload, flag/provider/traffic change, table drop, data repair বা local-sync activation করবে না। Exact evidence, blockers এবং আলাদা additive-migration, candidate-deployment, activation ও destructive-retirement authorization requirements লিখে থামবে।
```

## 5. Destructive retirement prompt

Do not use unless the owner explicitly authorizes the exact production database, migration, maintenance window and rollback owner.

```text
@HMS legacy Inventory table retirement gate evaluate করো। এটি evaluation-only unless the same instruction explicitly names production environment/database, approved release commit, exact retirement migration, backup/export and restore evidence, maintenance window, rollback owner, abort thresholds এবং execute authorization। প্রথমে exact live table/row inventory, protected-core dependency scan, foreign keys, background jobs/reports/exports/external consumers, canonical reconciliation, old/new Worker compatibility এবং rollback plan verify করবে। কোনো missing evidence, unexpected row, dependency, FK, reconciliation difference, pending mixed migration বা stale authorization থাকলে fail closed করবে এবং drop/apply করবে না। Ordinary Worker release-এর সঙ্গে destructive retirement combine করবে না।
```

## 6. Never infer authorization

The following phrases do not authorize production work:

- “continue”;
- “main-এ merge করো”;
- “deploy করো” without exact environment/release/migration scope;
- an old approval document;
- a previously applied canonical migration;
- a green local/fresh-install test;
- Inventory development completion.

Production migration, deployment, activation, traffic promotion and destructive retirement are separate approvals.
