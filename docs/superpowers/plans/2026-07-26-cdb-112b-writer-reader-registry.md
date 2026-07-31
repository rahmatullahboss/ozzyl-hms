# CDB-112B Writer and Reader Registry Implementation Plan

**Design:** `docs/superpowers/specs/2026-07-26-cdb-112b-writer-reader-registry-design.md`  
**Authority matrix:** `docs/database/canonical-authority-matrix.yaml`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Mode:** single-agent serial execution, TDD, local-only

## Goal

Create a deterministic, machine-readable inventory of every statically discoverable writer and reader touching a table governed by the full-HMS authority matrix. Make registry drift a mandatory canonical governance failure and produce a dependency map suitable for command cutover, provider promotion, and legacy retirement planning.

## Task 1 — Contract tests first

Create `test/canonical/canonical-authority-access.test.ts` with RED coverage for:

1. missing scanner/checker modules;
2. reviewed repository registry passes;
3. unregistered discovered writer fails;
4. unregistered discovered reader fails;
5. stale registry entry fails;
6. duplicate access key fails;
7. invalid writer lifecycle status fails;
8. invalid reader provider status fails;
9. unknown table or concept fails;
10. missing path fails;
11. summary drift fails;
12. rejected parallel architecture reference fails;
13. package commands and mandatory `canonical:check` integration.

Run the focused test and preserve the expected RED reason.

## Task 2 — Deterministic discovery core

Create `scripts/canonical/canonical-authority-access.ts`.

Implement:

- JSON-compatible registry readers;
- recursive file listing with stable ordering and excluded directories;
- SQL comment stripping;
- governed table union from matrix, canonical registry, and legacy registry;
- table-to-concept and table-to-domain mappings;
- canonical table set and external target table set;
- raw SQL read/write detection;
- Drizzle schema variable extraction;
- Drizzle query-builder read/write detection;
- merged per-path/table/access records;
- deterministic writer and reader classification;
- deterministic blockers, owners, target providers/commands, operations, and detection methods;
- stable sort and summary.

Use repository paths only. Do not execute application code or contact a database.

## Task 3 — Explicit registry generator

Create `scripts/canonical/generate-canonical-authority-access-registry.ts`.

Requirements:

- accept repository root only;
- discover the current access graph;
- write `docs/database/canonical-authority-access-registry.yaml` as pretty JSON plus newline;
- print aggregate counts only;
- include scan policy and known limitations;
- produce deterministic output except for a reviewed generated-at field; prefer a fixed `reviewedAt` supplied in code or preserve an existing value so repeated generation without code changes is byte-stable;
- never run as part of `canonical:check`.

Add package command `canonical:access-registry-generate`.

## Task 4 — Fail-closed checker

Create `scripts/canonical/check-canonical-authority-access.ts`.

Validate:

- registry identity and policy;
- array shapes and allowed vocabulary;
- unique exact keys;
- sorted operations, methods, concepts, and entries;
- known tables and concepts;
- path existence and rejected architecture exclusion;
- deterministic classification and blocker values;
- actual discovery equals registered discovery exactly;
- no stale or missing writer/reader;
- summary counts;
- required package commands.

Print aggregate success output or one line per stable issue code. Add package command `canonical:access-check` and include it in `canonical:check` after schema and authority checks.

## Task 5 — Generate and review registry

Run the explicit generator once.

Review:

- total governed tables;
- writer and reader counts;
- classifications by status;
- highest-access tables and paths;
- source tables with no statically discovered writer or reader;
- any scanner false positives from schema declarations, comments, or unrelated identifiers;
- every `protected_fixture` classification;
- every canonical module writing a noncanonical table;
- every noncanonical reader under dashboards, reports, portal, marketplace, scheduled, exports, and admin paths.

Fix scanner policy rather than manually deleting generated entries.

## Task 6 — Documentation and retirement dependency report

Create a checkpoint receipt under `docs/database/migration-runs/` containing:

- design and plan commits;
- governed table, writer, and reader totals;
- counts by classification/provider status;
- top retirement blockers;
- static discovery limitations;
- full verification;
- explicit safety state.

Update:

- `docs/architecture/canonical-program-control-center.md`;
- `task-progress.yaml`;
- `.ai-bridge/current-plan.md`;
- continuation contract tests.

The next exact action after CDB-112B is the patient–practitioner–appointment–encounter dependency-foundation design and plan.

## Task 7 — Verification

Run:

```text
pnpm vitest run test/canonical/canonical-authority-access.test.ts
pnpm canonical:access-check
pnpm canonical:check
pnpm exec tsc --noEmit
pnpm vitest run test/canonical
pnpm build:migrations
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm worktree:check -- --mode=task --allow-dirty
```

No web/patient/admin build is required unless runtime or UI code changes.

## Task 8 — Checkpoint commits

Use coherent commits:

1. design and implementation plan;
2. scanner, generator, checker, registry, tests, and package commands;
3. receipt, tracker, control center, handoff, and continuation contracts.

Do not stop on a normal checkpoint unless an execution limit requires a clean handoff. Do not push or integrate to main.

## Stop conditions

Stop before any action that requires:

- production or protected-clone access;
- credentials or secrets;
- route/worker registration;
- local-sync activation;
- feature-flag or traffic change;
- destructive migration;
- legacy writer removal;
- push or CDB-to-main integration;
- an architectural decision that would create another authority for an existing business fact.
