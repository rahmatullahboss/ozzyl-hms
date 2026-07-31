# CDB-V1-060 Production Authorization Package Design

## Status

Approved continuation of the existing Canonical Core V1 runbook after `CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-VERIFIED`.

## Goal

Prepare a deterministic, reviewable and fail-closed production authorization package for the future `CDB-V1-070` staged production cutover without querying or mutating production, enabling providers, deploying, changing traffic, activating local sync, retiring legacy authority, pushing, or integrating CDB into `main`.

## Selected approach

Use a repository-side sanitized package plus a strict executable checker.

The package binds everything that can be proven locally:

- CDB-V1-050 verified result and checksum;
- candidate branch, implementation commit and build identifier;
- exact 19 migration names and repository SHA-256 values;
- exact four bounded backfill scripts and SHA-256 values;
- tenant/domain/provider/consumer/source-table scope derived from reviewed contracts, without row identifiers;
- exact non-executing command templates for preflight, backup verification, migrations, backfills, reconciliation, shadow canary, observation and rollback;
- zero-tolerance abort conditions and first-cutover retirement exclusions;
- smoke, reconciliation and rollback expectations inherited from the successful protected-clone rehearsal.

The same package records external bindings that cannot be created from repository state. These remain explicit `null` or empty values rather than invented data:

- production database identity observed at execution time;
- backup/export identity and checksum;
- maintenance or write-freeze window;
- execution, rollback and observation owners;
- owner approval evidence;
- canary observation duration and final thresholds;
- candidate deployed worker/build evidence;
- production snapshot/bookmark evidence.

Because those bindings are absent, the package checker must report:

- `packageReady: true` when all repository-side content is complete and internally consistent;
- `executionReady: false` until a separate protected external authorization document supplies all owner/external bindings and authorizes exact actions;
- no production or network action performed.

## Architecture

### 1. Package contract

`scripts/canonical/production-authorization-package.ts` owns types, constants, deterministic package construction, hash verification and fail-closed evaluation.

It must reject:

- stale or malformed CDB-V1-050 evidence;
- migration/backfill name or hash drift;
- broad tenant/domain/provider scope;
- executable production permissions in the prepared repository package;
- missing rollback/abort commands;
- canonical-write or legacy-retirement authorization in the first cutover;
- unsafe shell constructs in command templates;
- any claim that production/network/deployment actions occurred.

### 2. Preparation CLI

`scripts/canonical/prepare-production-authorization-package.ts` reads only repository files and Git metadata. It writes the sanitized JSON package in `docs/database/`.

The CLI never invokes Wrangler, D1, Cloudflare, deployment, database or network commands. It may invoke local Git commands only to resolve branch and commit.

### 3. Readiness checker

`scripts/canonical/check-production-authorization-package-readiness.ts` validates the committed package against the current repository files and emits aggregate status.

The checker is included in `pnpm canonical:check`.

### 4. Evidence and continuity

The checkpoint produces:

- `docs/database/cdb-v1-060-production-authorization-package.json`;
- `docs/database/audits/2026-07-30-production-authorization-package-preparation.md`;
- focused tests and continuity updates;
- a checkpoint commit followed by evidence/metadata commits.

## Exact bounded scope

- tenant template count: 1;
- approved initial tenant: `100` only when a future protected authorization explicitly binds it;
- provider count: 9;
- consumer count: 12;
- source-table count: 9;
- migration count: 19;
- backfill count: 4;
- first-cutover mode: read shadow only;
- canonical writes: prohibited;
- worker traffic change: prohibited unless separately authorized in CDB-V1-070;
- legacy retirement: excluded;
- destructive migration: excluded.

## Data flow

1. Resolve current branch and implementation commit locally.
2. Validate the committed CDB-V1-050 result with its executable checker.
3. Hash the exact migration, backfill, runbook and governance inputs.
4. Build deterministic package sections and command templates.
5. Evaluate repository completeness and external authorization gaps.
6. Write sanitized package.
7. Run focused tests, TypeScript, migration manifest and full Canonical governance.
8. Commit evidence and update continuation metadata.

## Error handling

All validation is fail-closed. Unknown fields, malformed hashes, command drift, scope expansion, missing rollback, stale evidence and unsafe permissions produce issues and prevent `packageReady` or `executionReady`.

The preparation CLI writes no partial package when validation fails.

## Testing

Tests cover:

- exact deterministic package construction;
- stale migration/backfill/result hashes;
- scope expansion rejection;
- production execution permissions remaining false;
- unresolved external bindings keeping `executionReady=false`;
- command-template safety and required phases;
- result/audit/continuity contract updates;
- full `canonical:check` integration.

## Safety boundary

CDB-V1-060 prepares documentation and machine-readable authorization inputs only. It does not authorize or execute CDB-V1-070. A fresh exact protected authorization must be generated later and bound to the then-current candidate commit/build, database identity, backup/export, owners, window, thresholds and canary scope.
