# Non-Production Canonical Rewrite Playbook

**Approved:** 2026-07-28  
**Applies to:** every workflow not proven active in the protected production core  
**Default mode:** canonical-only greenfield rewrite  
**Production mutation authorized:** no

## 1. Purpose

This playbook prevents non-production modules from consuming the migration, shadowing and observation work required for live production systems. These modules may be rewritten directly on the final Canonical architecture because they are not active production authorities.

The goal is not to preserve every experimental table, route or screen. The goal is to produce a clean, testable, canonical-only module that can be activated later through its own release gate.

The protected production core is defined only by `docs/architecture/hms-production-scope-policy.md`. A module is not considered non-production merely because an agent assumes it is unused.

## 2. Entry gate: prove the module is non-production

Before deleting, replacing or ignoring legacy module data, create a repository audit that proves:

- no currently deployed protected-core route requires the module table or service;
- no Reception, billing, invoice, payment, hospital setup or doctor commission workflow imports, reads or mutates it;
- no required shared library depends on its legacy authority;
- no owner-approved production data retention requirement has been identified;
- every reusable shared fact already has a registered Canonical owner;
- the selected branch and worktree are the reviewed owner for that bounded context;
- the owner-facing dirty root and every unrelated worktree remain untouched.

If any protected-core dependency is found, classify that dependency as protected compatibility work. Do not perform greenfield deletion until the dependency is removed through the protected-core programme.

## 3. Required module architecture

A rewritten module must contain:

1. Canonical authority or domain-extension schema in `src/db/schema/canonical/**` or the reviewed bounded-context schema root.
2. Atomic application commands in `src/lib/canonical/commands/**` or the reviewed module application layer.
3. A public application API consumed by routes, jobs, UI and other modules.
4. Thin transport adapters containing authentication, validation and response mapping but no independent business authority.
5. Permissions and approval rules with deny-by-default tests.
6. Immutable audit/outbox evidence for material state transitions.
7. Canonical-only operational queries, dashboards, exports and reports.
8. Fresh-install migration coverage and deterministic fixtures.
9. Module regression tests plus protected Reception/core regression tests.

A module must reuse Canonical patient, practitioner, encounter, service, invoice, payment, stock and accounting identities instead of copying those facts into module-local tables.

## 4. Rewrite sequence

### NR-01 — Scope and dependency audit

- list legacy tables, routes, writers, readers, UI screens, jobs, exports and reports;
- identify every protected-core dependency;
- classify each fact as shared Canonical authority, domain extension, workflow document, immutable history or rebuildable projection;
- record whether any real data must be retained;
- produce an exact deletion/retention map.

**Exit:** all runtime surfaces are classified and protected-core dependencies are explicit.

### NR-02 — Final Canonical model

- reuse existing shared authorities;
- add only domain-specific tables;
- use explicit public IDs, tenant ownership, status vocabulary, versioning and immutable correction history;
- prohibit polymorphic numeric-ID coincidence and copied shared identities;
- define unique, foreign-key and lifecycle constraints.

**Exit:** schema and design contract prove there is no competing authority.

### NR-03 — Canonical-only commands

- implement one command boundary per material transition;
- require idempotency, version checks, tenant scope and exact linked identities;
- commit state, audit/outbox and required projections atomically;
- use reversal or correction events instead of deleting financial or clinical history.

**Exit:** no active module write bypasses its reviewed command or public API.

### NR-04 — Canonical-only readers and UI

- replace direct legacy reads with application queries;
- update dashboards, exports, scheduled jobs and hidden admin tools, not only primary screens;
- remove unused compatibility selectors rather than preserving shadow modes without a production purpose.

**Exit:** runtime reader inventory reports zero unresolved legacy-authority reads.

### NR-05 — Repository retirement

- remove legacy routes, services, duplicate schema modules, UI screens, feature flags and obsolete compatibility tests;
- preserve only explicitly required historical migrations or archival evidence;
- run zero-reference checks for forbidden imports, table names and route registration;
- create a local/test retirement migration only after fresh-install and rollback verification.

**Exit:** the repository contains one runtime authority for the module and the protected core remains green.

### NR-06 — Final development verification

Run focused module tests plus the applicable repository gates:

```text
pnpm exec tsc --noEmit
pnpm build:migrations
pnpm canonical:check
pnpm worktree:check -- --mode=task --allow-dirty
```

Also run the protected Reception/core regression suite selected by the module tracker. Record exact commands, counts and failures in the module run receipt.

**Exit:** the module is development-complete and release-inactive.

## 5. What not to build for a non-production rewrite

Do not build these merely for unused legacy parity:

- production tenant backfill from unused module tables;
- long-running dual-write mode;
- production shadow observation;
- compatibility providers with no live consumer;
- route-by-route legacy traffic canaries;
- preservation of obsolete UI behaviour;
- migration of synthetic, demo or unknown-quality development rows;
- another shared patient, practitioner, service, invoice, payment, stock or accounting authority.

Migration or backfill tooling is required only when the owner identifies real data that must be retained.

## 6. Data-retention decision

For every legacy table, select exactly one disposition:

- `drop_from_fresh_install`: no required data and no runtime reference;
- `archive_repository_only`: retain migration or design history but no runtime import;
- `one_time_local_fixture_conversion`: convert only deterministic fixtures required by tests;
- `owner_approved_data_import`: preserve specifically identified business data using exact mappings and reconciliation;
- `protected_dependency`: cannot retire until the protected core no longer depends on it.

Unknown data is not automatically migrated. Ambiguity must be documented rather than silently copied into the Canonical database.

## 7. Parallel-agent execution

Multiple agents may execute independent non-production rewrites while the Canonical Core V1 agent continues the protected production transition.

Use this model:

- one primary agent owns Canonical Core V1 and never edits non-production module internals;
- one worker agent owns one bounded context and one dedicated branch/worktree;
- one integration/review agent serializes shared-file changes and updates the central board;
- workers do not edit central trackers, migration manifests, shared schema indexes, package locks, shared authz catalogs or global route registries unless their task explicitly grants ownership;
- a migration number must be reserved on the central parallel board before a worker creates a migration;
- two agents must not edit the same bounded context, route family or public contract concurrently;
- each worker stops at a reviewed checkpoint or `READY FOR INTEGRATION`; it does not merge itself into another programme branch;
- all integrations run fresh protected-core regression tests.

The machine-readable lane and ownership registry is `docs/architecture/hms-canonical-parallel-execution-board.yaml`.

## 8. Current branch ownership

- `program/cdb-main-continuous-20260725`: Canonical Core V1 transition, Canonical governance and shared authority contracts.
- `feature/inventory-modular-monolith`: canonical-only Inventory replacement and its reviewed cross-domain adapters.
- `program/mm-canonical-inventory-sync-20260727`: Full Modular Monolith boundaries and public API consumption; it must not create another Canonical or Inventory authority.
- `feature/patient-mobile-app-canonical-20260725`: canonical-only Patient Mobile foundations; production release remains separately gated.

Before opening a new domain worktree, inspect the central board and all live branches to confirm that no other agent already owns the domain.

## 9. Recommended concurrent lanes

The fastest safe default is:

1. Canonical Core V1 protected production transition.
2. Existing Inventory canonical-only programme through its own tracker.
3. Patient Mobile canonical-only foundation work.
4. One additional isolated domain rewrite, such as Diagnostics runtime consumers, Pharmacy, OT/Nursing, Insurance or Payroll, only after its dependencies and branch ownership are recorded.

Do not start every remaining module at once. Limit parallel workers to independently reviewable domains and keep one integration agent available; otherwise shared migration, schema and contract conflicts erase the expected speed gain.

## 10. Activation after rewrite

Development completion does not activate production. A rewritten module receives a separate release plan containing:

- additive production migration review;
- required real-data import, if any;
- staging or protected-clone validation;
- security, permissions and observability evidence;
- rollback proof;
- explicit owner authorization;
- controlled activation and post-activation observation.

No non-production module may inherit production authorization from the Canonical Core V1 programme.
