# HMS Canonical Data Architecture Master Plan

> **2026-07-21 continuation:** The historical one-task/worker protocol below remains evidence of how P00–P10 was built. Current continuation is user-authorized single-agent serial execution through `CDB-CONTINUE` on `program/canonical-main-continuous-20260721`, based on current `main`. Normal checkpoint commits are not stop conditions. Production mutation still requires fresh explicit authorization.

**Goal:** Move the entire HMS from overlapping legacy data models to one canonical, tenant-safe, auditable architecture without production data loss or unexplained financial variance.

**Architecture:** Use additive schema expansion, deterministic source mappings, shadow/dual writes, checkpointed backfills, reconciliation, tenant-scoped feature flags, maintenance-window cutovers, and delayed legacy retirement. Keep Cloudflare D1 during logical redesign and use stable public IDs so future local-server sync can be reintroduced safely.

**Tech Stack:** Cloudflare Workers, Cloudflare D1/SQLite, Wrangler, Hono, TypeScript, Drizzle, Vitest, pnpm.

## Global Constraints

- Historical implementation branch `feature/hms-canonical-data-architecture` was merged into `main`; current source of truth is `main` at `fa742f4960a4bef35950bdb4c5a6a6f251782f8e`.
- Current continuation branch is `program/canonical-main-continuous-20260721` in `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/canonical-main-continuous`; the dirty `review/all-branches-20260711` workspace and its `src/lib/financial-reconciliation/**` architecture are not execution bases or canonical authorities.
- `CDB-CONTINUE` works serially in the one continuation branch, may create multiple coherent checkpoint commits per session, and must not spawn or delegate to other agents.
- One production hospital is live; all current production traffic is cloud-only.
- The existing local server is disabled and MUST remain disabled until the cloud canonical model is stable.
- A nightly maintenance/read-only window is available.
- Production changes MUST be rehearsal-tested on a full isolated D1 clone.
- No destructive production migration is allowed in the expansion or first cutover waves.
- Posted money MUST use integer minor units in canonical tables.
- Tenant-owned canonical tables MUST use `tenant_id TEXT NOT NULL`.
- Every financial and sync-capable command MUST be idempotent.
- Ambiguous historical records MUST enter an exception queue; agents MUST NOT guess.
- Financial cutover requires zero unexplained variance.
- Production migration, deployment, merge, or local-server activation requires explicit owner authorization at the relevant gate.

---

## 1. Program artifact map

| Artifact | Purpose |
|---|---|
| `docs/superpowers/specs/2026-07-13-hms-canonical-data-architecture-design.md` | Architecture rationale and target model |
| `docs/superpowers/specs/2026-07-13-hms-canonical-data-architecture-spec.md` | Normative data and migration requirements |
| `docs/superpowers/plans/2026-07-13-hms-canonical-data-architecture-master-plan.md` | Program phases, dependencies, gates, and ownership |
| `docs/superpowers/plans/2026-07-13-hms-canonical-data-architecture-implementation-plan.md` | Historical implementation work breakdown and verification contract |
| `docs/architecture/2026-07-21-main-canonical-completion-gap-audit.md` | Current-main completion and runtime-gap audit |
| `docs/superpowers/specs/2026-07-21-main-based-canonical-continuation-design.md` | Current continuation design and authority rules |
| `docs/superpowers/plans/2026-07-21-main-based-canonical-continuation.md` | Active CDB-102 local hardening and later cutover plan |
| `docs/architecture/canonical-main-continuation-prompt.md` | Single-agent start/resume contract |
| `task-progress.yaml` | Resumable machine-readable task state and current handoff |
| `.ai-bridge/current-plan.md` | Historical bridge context; current handoff is in `task-progress.yaml` |
| `docs/database/canonical-source-of-truth.yaml` | Living entity/fact authority registry to be created in Phase 1 |
| `docs/database/legacy-table-disposition.yaml` | Keep/transform/replace/archive registry to be created in Phase 1 |
| `docs/database/metric-registry.yaml` | Canonical metric contracts to be created before reporting cutover |
| `docs/database/architecture-decisions/` | ADRs created for irreversible decisions |
| `docs/database/migration-runs/` | Staging and production migration/reconciliation evidence |

## 2. Program phases

## P00 — Planning baseline and ownership

**Purpose:** Ensure all later agents start from the same architecture, worktree, task IDs, and safety rules.

**Deliverables:**

- approved design and specification;
- master plan and implementation plan;
- `task-progress.yaml`;
- `.ai-bridge/current-plan.md`;
- clean workspace review.

**Gate P00-G1:** All planning artifacts exist, cross-reference one another, and contain no instruction to mutate production during planning.

## P01 — Production truth audit and clone rehearsal

**Purpose:** Establish the actual live schema/data truth before designing executable migrations.

**Work:**

- identify production D1 binding, database name, ID, account, environment, and migration manifest;
- record current Time Travel bookmark/timestamp;
- export full production schema/data with Wrangler;
- create isolated staging D1 and import the export;
- inventory tables, columns, indexes, FKs, checks, triggers, views, row counts, and migration drift;
- run `PRAGMA foreign_key_check` and domain-specific orphan/duplicate checks;
- calculate baseline totals for bills, lines, payments, due, deposits, credits, refunds, doctor payables, IPD balances, stock, cash, expenses, and accounting;
- create a redacted audit report and exception inventory.

**Deliverables:**

- `docs/database/migration-runs/P01-production-baseline.md`;
- machine-readable schema snapshot;
- baseline reconciliation outputs;
- staging clone identifier and data-retention record;
- exact list of authoritative runtime write paths.

**Gate P01-G1:** Clone restores successfully and row counts match production export.

**Gate P01-G2:** Every known financial fact has a baseline total and every unexplained mismatch has an exception ID.

## P02 — Governance and canonical foundation

**Purpose:** Prevent additional drift before domain migration begins.

**Work:**

- create canonical schema modules and barrel exports;
- create schema version, migration run, backfill checkpoint, source mapping, outbox, exception, feature-flag, and reconciliation-run tables;
- add migration manifest collision protection;
- add CI rules for money types, tenant IDs, generic references, direct legacy writes, schema export drift, destructive SQL, and metric contracts;
- create source-of-truth and legacy-disposition registries;
- create stable public ID utility and UTC/business-date utility;
- add D1 batch command helper and idempotency claim helper.

**Gate P02-G1:** Additive migration passes manifest, production migration guard, schema import, and rollback rehearsal tests.

**Gate P02-G2:** Governance checks fail on intentionally bad fixtures and pass on the existing approved allowlist.

## P03 — Practitioner, patient-link, encounter, and admission foundation

**Purpose:** Establish canonical identity and clinical episode relationships.

**Work:**

- introduce practitioners and explicit user/employee/referral links;
- backfill internal and external doctors without merging ambiguous identities;
- promote encounters as actual-care authority;
- map appointments, visits, consultations, completion claims, notes, diagnoses, prescriptions, and admissions;
- introduce encounter participants and bed stays;
- add compatibility resolvers for existing routes;
- shadow-read and reconcile encounter counts/statuses.

**Gate P03-G1:** Every active appointment/visit/consultation/admission is mapped or has a classified exception.

**Gate P03-G2:** No route infers performer/referrer/treating roles through a generic doctor fallback in the canonical path.

## P04 — Service catalog, pricing, requests, and service events

**Purpose:** Create one bridge between clinical operations and finance.

**Work:**

- create canonical service catalog and effective-dated prices;
- map billing service items, lab catalog, radiology catalog, consultation, bed, procedures, and pharmacy products;
- create service requests/items and domain extensions;
- create service events and explicit participant roles;
- backfill lab, radiology, doctor visits, IPD rounds, bed charges, procedures, medicines, and other charge facts;
- introduce deterministic source mapping and exception queues;
- shadow-write selected diagnostic and OPD flows.

**Gate P04-G1:** One eligible source fact creates at most one active service event.

**Gate P04-G2:** Service count reconciliation passes per tenant/day/category with only approved exception IDs.

## P05 — Canonical invoicing and line model

**Purpose:** Replace untyped invoice references and independently maintained totals.

**Work:**

- add invoices and typed invoice lines;
- map legacy bills/invoice items to service events;
- define exact line discount, tax, rounding, and cancellation rules;
- create invoice issuance command and adapters;
- preserve invoice numbers, fiscal data, snapshots, counter/session context, and audit history;
- shadow-write invoices while legacy billing remains primary;
- reconcile headers, lines, categories, and service links.

**Gate P05-G1:** Invoice header totals equal active line totals for every canonical invoice.

**Gate P05-G2:** Every active line has a typed service/adjustment event or a classified exception.

## P06 — Receipts, tenders, allocations, deposits, credits, and refunds

**Purpose:** Make collection and due calculations deterministic.

**Work:**

- create receipts, tenders, and persistent allocations;
- backfill legacy payments and infer allocations only under approved deterministic rules;
- classify ambiguous multi-line historical payments;
- migrate deposits as liabilities and add applications;
- normalize credit notes, refunds, reversals, cash holds, and gateway states;
- centralize `collectPayment`, `applyDeposit`, `issueCreditNote`, and `reversePayment` commands;
- stop using `income` as authority;
- reconcile receipt/tender/allocation/invoice totals.

**Gate P06-G1:** Receipt total equals tenders and allocations plus unallocated amount.

**Gate P06-G2:** Invoice due equals canonical lines minus allocations/credits for every migrated invoice.

## P07 — Practitioner compensation and IPD projection

**Purpose:** Consolidate performer, referral, visit, and IPD compensation while rebuilding IPD financial views.

**Work:**

- create effective-dated role-based commission rules;
- migrate commission accruals and performer reserves into one accrual lifecycle;
- create settlement allocations and reversal rules;
- replace generic doctor inference with service-event participants;
- build un-invoiced IPD service projection;
- rebuild IPD ledger from invoices, allocations, deposits, credits, and refunds;
- compare legacy and canonical admission balances.

**Gate P07-G1:** Practitioner payable equals active accruals plus adjustments minus settlements/reversals.

**Gate P07-G2:** Every active admission has zero unexplained balance difference.

## P08 — Pharmacy, inventory, procurement, expense, payroll, cash, and accounting

**Purpose:** Bring the remaining production and future modules under the same event and finance contracts.

**Work:**

- connect prescription/order, dispense, stock movement, service event, invoice line, and payment;
- promote immutable stock movement as stock authority;
- reconcile lots, locations, units, and balances;
- separate expense approval, execution, tender/custody, and journal posting;
- separate payroll run, payable, settlement, and journal posting;
- align cash shadow ledger with canonical receipts/refunds/payouts/expenses;
- centralize accounting outbox and idempotent balanced voucher posting;
- retire duplicate income/legacy journal authorities after reconciliation.

**Gate P08-G1:** Stock movement balances equal approved current stock by item/location/lot.

**Gate P08-G2:** Cash custody and accounting invariants pass with zero unexplained financial variance.

## P09 — Canonical reporting and dashboard cutover

**Purpose:** Ensure all reports use documented facts and date/role semantics.

**Work:**

- create metric registry;
- create shared canonical query modules/views;
- migrate executive, doctor, test, IPD, billing, collection, inventory, and finance reports;
- ensure summary and drill-down share the same fact logic;
- run legacy-versus-canonical shadow reports by day and domain;
- remove query-time proportional allocation and generic doctor fallback.

**Gate P09-G1:** Every production KPI has a metric contract and drill-down parity test.

**Gate P09-G2:** Financial dashboard totals match canonical reconciliation totals exactly.

## P10 — Production domain cutovers

**Purpose:** Switch authoritative reads/writes safely in controlled waves.

**Order:**

1. identity/encounters;
2. service catalog/requests/events;
3. invoices;
4. receipts/allocations/deposits/refunds;
5. compensation/IPD projections;
6. pharmacy/inventory/cash/accounting;
7. reporting.

Each cutover uses:

- tenant-scoped flags;
- pre-cutover export and Time Travel bookmark;
- maintenance/read-only mode for the final delta where required;
- deterministic delta backfill;
- reconciliation and smoke tests;
- go/no-go record;
- documented rollback threshold.

**Gate P10-G1:** Domain observation period passes with no unresolved canonical-write failures or unexplained divergence.

## P11 — Legacy retirement and local-server reintroduction

**Purpose:** Remove parallel truth and prepare safe offline/local operation.

**Work:**

- stop all legacy writes;
- convert required legacy reads to compatibility views;
- remove unused route adapters and direct SQL;
- archive and later drop legacy structures under separate migrations;
- add schema-versioned outbox/inbox sync using public IDs;
- migrate the disabled local server against a production clone;
- test conflict policy for signed clinical and posted financial records;
- activate local sync only after explicit production approval.

**Gate P11-G1:** Repository search finds no active writes to retired tables.

**Gate P11-G2:** Local sync replay, duplicate delivery, network interruption, and schema-version tests pass before activation.

## 3. Mandatory quality gates for every task

Every task must include:

- a failing test or failing audit query before the change;
- minimal implementation;
- focused passing tests;
- tenant-isolation tests;
- idempotency/retry tests for mutation tasks;
- failure-path and rollback evidence;
- tracker update;
- focused commit on the task branch;
- requirement/safety review and code-quality review before integration.

No task may claim completion from code inspection alone.

## 4. Agent ownership and continuity protocol

1. An agent reads `agents.md`, both canonical architecture specs, both plans, and `task-progress.yaml` before work.
2. The agent selects exactly one unblocked task whose dependencies are completed.
3. The agent records ownership in `task-progress.yaml` before modifying code.
4. The agent creates an isolated task branch/worktree from the latest reviewed `feature/hms-canonical-data-architecture` commit.
5. The agent updates task evidence after each test, decision, migration rehearsal, commit, or blocker.
6. A reviewed task integrates back into `feature/hms-canonical-data-architecture`; it does not merge directly into `main`.
7. The agent does not merge the program branch to `main`, deploy, or mutate production unless assigned the integration/cutover role and explicitly authorized.
8. On interruption, the agent records the exact last successful command, changed files, current failing test, next action, and rollback state.
9. A replacement agent resumes from the tracker and run evidence rather than repeating discovery.

## 5. Program stop conditions

Work must stop and be escalated when:

- production database identity is uncertain;
- export/restore rehearsal fails;
- a backfill cannot be made deterministic;
- financial variance is non-zero and unexplained;
- foreign-key or tenant ownership violations increase;
- a canonical write can partially succeed without a recoverable outbox/retry record;
- a migration requires immediate destructive SQL;
- a local server with an unknown schema attempts to reconnect;
- the task workspace contains unrelated dirty changes.

## 6. Completion statement

The project is not complete when new tables merely exist. Completion requires canonical-only active writes, reconciled production facts, retired parallel authorities, documented metrics, enforcement in CI, verified rollback, and safe local-sync readiness.