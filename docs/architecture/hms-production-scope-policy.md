# HMS Production Scope and Canonical-First Development Policy

**Original decision:** 2026-07-27  
**Owner course correction approved:** 2026-07-28  
**Status:** Owner-approved and immediately applicable to every HMS program, branch, tracker, handoff, and new agent session

## 1. Production reality

The current production system has a small **protected core envelope**. It includes only:

1. Reception patient registration/lookup, appointment/check-in, queue, visit and reception-facing patient workflow.
2. Deployed billing, invoice and collection behaviour used with Reception, including receipts, payments and allocations.
3. Deployed hospital setup/master data, including hospitals/tenants, departments, services/tests, prices and required configuration.
4. Deployed doctor/practitioner setup and doctor commission configuration or accrual behaviour used by the live core.
5. Shared users, roles, permissions, audit and other dependencies proven to be required by those live workflows.

Any route, table, command, shared library, report or UI proven to support these live workflows is protected. Everything else is development-only until separately activated.

## 2. Primary program objective

The primary HMS data objective is now:

> Safely move the protected production core from legacy authority to the existing Canonical authority, prove exact parity and rollback on a protected clone, then perform a separately authorized staged production cutover and retire legacy authority without losing reception, financial, identity, configuration or commission data.

The Canonical program must not continue expanding into Operation Theatre, Nursing, Insurance, Payroll, Pharmacy, Inventory, Diagnostics or other non-production domains while the protected-core transition remains unfinished, unless the owner explicitly changes priority.

`CDB-127E` is the frozen local implementation boundary for the previous broad authority-expansion stream. `CDB-128A Operation Theatre` is deferred and is not the next Canonical checkpoint.

## 3. Mandatory protected-core policy

1. The protected core must preserve current HTTP behaviour, tenant and permission checks, transaction and idempotency behaviour, financial calculations, audit behaviour, data compatibility and user-facing workflow until its canonical replacement passes the approved cutover gates.
2. Canonical mappings, commands, shadow reads, compatibility writers and providers may be completed around the protected core.
3. Planning, repository implementation, tests and protected-clone rehearsal for the protected-core transition are owner-approved.
4. Canonical-only cutover of a live protected flow is not authorized by this policy alone. Applying production migrations/backfills, enabling a production provider, changing production traffic, deploying a cutover build, freezing live writes, retiring a live legacy path or deleting production data requires a separate exact authorization for that bounded action.
5. Legacy and Canonical financial totals must be compared in integer minor units. Unexplained variance must be zero before promotion.
6. Patient, practitioner, appointment and encounter identity may be linked only through exact reviewed evidence. Names, phone numbers, timestamp proximity or numeric-ID coincidence are not sufficient identity evidence.
7. Legacy authority is retired in stages: canonical command coverage, shadow evidence, canonical read promotion, canonical write authority, observation, writer/read retirement, read-only archival and only then separately authorized destructive removal.
8. The old production database must remain recoverable and read-only for the approved rollback and retention window. A successful cutover does not authorize immediate table deletion. In exact policy terms, canonical-only cutover of a live protected flow is not authorized without the separate production gate.
9. The local hospital server is stopped. Local sync remains disabled/deferred and is not required for current programme completion.
10. Active dirty worktrees must not be reset, cleaned, stashed, overwritten or opportunistically committed by another programme.

## 4. Non-production canonical rewrite policy

Every workflow outside the protected core may be substantially refactored or fully rewritten canonical-first before activation.

For a verified non-production domain:

1. Do not create production-style legacy backfill, dual-write, shadow-provider or traffic-observation work merely to preserve unused runtime parity.
2. Reuse shared Canonical authorities for patient, practitioner, encounter, service, invoice, payment, inventory and accounting facts. A module may own only its domain extensions and workflow documents.
3. Implement the final canonical schema, commands, public application API, UI, permissions, audit/outbox, tests and fresh-install migrations directly.
4. Delete or retire obsolete non-production runtime code only after proving zero protected-core dependency, zero required repository reference and green regression gates.
5. Do not copy untrusted or unused legacy development data into the clean Canonical database. Preserve only fixtures or records that have an explicit owner-approved business need.
6. Local, test and protected-clone verification is sufficient for development completion. Production observation is a later release/activation gate.
7. Verified-unused non-production legacy source may be removed only after canonical replacement, protected-dependency, repository-reference, regression, fresh-install and rollback checks.

Detailed execution rules are in `docs/architecture/non-production-canonical-rewrite-playbook.md`.

## 5. Clean Canonical database rule

A clean Canonical database does not require immediate physical deletion of every old table. It requires:

- one authoritative representation for each business fact;
- no new writes to retired legacy authority;
- all operational reads routed through the approved Canonical provider or a temporary compatibility surface;
- immutable financial and clinical correction history;
- explicit typed relationships and source mappings;
- rebuildable projections rather than competing balances;
- dormant legacy data retained only as mapped history, compatibility or rollback evidence.

Physical drop or irreversible deletion is the final optional step and always requires separate destructive authorization.

## 6. Program ownership and branch interaction

The user may run multiple user-launched agents in parallel, but each agent must own one bounded context in one dedicated branch/worktree and shared integration files must remain serially controlled.

- Canonical Data Architecture owns canonical schemas, business-fact authority, commands, mappings, reconciliation, migration and protected-core cutover rules.
- Full-system Modular Monolith owns module boundaries, dependency direction, public application APIs and thin transport adapters. It must not create another data authority.
- Inventory Modular Monolith owns the canonical Inventory bounded-context implementation. Inventory is non-production and remains a canonical-only greenfield replacement; Full MM consumes its reviewed public contracts.
- Canonical Finance is a domain inside the single Canonical program. Deployed billing/invoice/collection and doctor commission remain protected; non-production payroll, expense, accounting extensions and other finance workflows may be rewritten canonical-first.
- Patient Mobile, Diagnostics, IPD, Pharmacy, OT, Nursing, Insurance, advanced Inventory and other non-production products may be rewritten canonical-first, but they are not allowed to delay or redefine the protected-core migration programme.

## 7. Two separate gates

### Development and rehearsal gate

Allowed without production mutation:

- repository audits and exact production-surface inventories;
- Canonical schema, command, provider and compatibility implementation;
- deterministic migration and reconciliation tooling;
- protected local-clone migration rehearsal using approved sanitized/exported evidence;
- shadow-comparison tooling, tests, observability and rollback automation;
- non-production canonical-only rewrite and repository retirement.

### Production execution gate

Requires a fresh exact authorization package:

- production database access beyond an approved read-only evidence query;
- production migrations or backfills;
- provider/feature-flag activation;
- write freeze or traffic change;
- deployment or cutover;
- production observation window;
- live writer/reader retirement;
- destructive table, column or data removal.

## 8. Global execution priority

Until the protected-core Canonical transition is complete, the default priority is:

1. checkpoint and preserve all verified CDB-122 through CDB-127E work;
2. inventory the exact protected production core and its active readers/writers;
3. freeze Canonical Core V1 scope and invariants;
4. complete protected-core Canonical command and provider coverage;
5. build and pass clone migration, backfill, reconciliation and rollback rehearsal;
6. obtain exact authorization for one bounded production cutover slice;
7. promote reads and writes in controlled stages, observe and retain rollback;
8. retire legacy authority route-by-route and table-family-by-table-family;
9. resume deferred non-production modules only after the owner confirms priority.

No new agent should choose OT, Nursing, Insurance, Payroll, Pharmacy or another broad CDB authority checkpoint as the next task while this priority remains active. Local sync remains disabled/deferred and is not required for current programme completion.

## 9. Handoff requirement

Every active program branch must reference this policy in its tracker or resume handoff. A future agent must state:

- the exact protected production core;
- the current protected-core migration checkpoint;
- whether production access or mutation is authorized;
- which non-production domains are greenfield rewrites;
- which branch owns each bounded context;
- the exact next verification or implementation action;
- the explicit actions that remain prohibited.

The authoritative cutover runbook is `docs/database/canonical-core-v1-production-cutover-runbook.md`. The machine-readable next action is `task-progress.yaml`, and the shortest handoff is `.ai-bridge/current-plan.md`.
