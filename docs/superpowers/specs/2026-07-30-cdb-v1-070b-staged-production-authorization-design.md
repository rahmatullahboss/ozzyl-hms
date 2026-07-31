# CDB-V1-070B Staged Production Authorization Design

**Date:** 2026-07-30  
**Branch:** `program/cdb-main-continuous-20260725`  
**Production database:** `hms-super-admin-production-apac` (`c68a5360-a2c1-44cc-9e71-f21057bea102`)  
**User-facing authority:** Legacy remains authoritative throughout the preparation stage  
**Production mutation status:** not authorized and not executed

## Problem

The CDB-V1-070A final shadow execution authorization requires evidence that cannot exist before some protected production-facing preparation occurs:

- the candidate Worker version ID exists only after a zero-traffic version upload;
- the retained previous Worker and exact route fingerprint require current Worker metadata capture;
- a fresh Time Travel bookmark and protected export require bounded production operations;
- fresh active-tenant and migration-ledger evidence require production reads.

CDB-V1-070A also requires its final authorization to be execution-ready before any phase starts. Those two requirements form a circular dependency: final authorization needs preparation evidence, while preparation evidence needs authorization.

The safe correction is a staged authorization model.

## Decision

Split production-facing work into two separately authorized gates.

### Gate A — Preparation evidence authorization

Gate A may authorize only the minimum operations required to create final execution evidence:

1. build and verify the exact integrated `main` candidate locally;
2. upload one immutable candidate Worker version at zero traffic;
3. read current active-tenant, migration-ledger, Worker-version and route metadata;
4. capture a fresh D1 Time Travel bookmark;
5. create a protected production export;
6. write a protected, sanitized preparation-evidence receipt.

Gate A must prohibit:

- assigning traffic to the candidate Worker;
- applying database migrations;
- running Canonical backfills;
- enabling provider flags;
- changing user-visible read or write authority;
- local-sync activation;
- Legacy retirement;
- destructive actions;
- remote database deletion;
- CDB-to-main integration or push as part of the evidence collector.

The candidate version may exist at zero traffic, while the current Legacy-serving Worker remains at 100% traffic.

### Gate B — Final shadow execution authorization

Gate B remains responsible for the actual zero-downtime schema convergence, bounded backfills and all-tenant shadow activation. It must bind a validated Gate A receipt containing:

- exact candidate and previous Worker versions;
- build-manifest and route-fingerprint hashes;
- active-tenant evidence;
- migration-ledger evidence;
- Time Travel bookmark evidence;
- protected export evidence;
- proof of zero candidate traffic and zero production data mutation during Gate A.

Gate B may then authorize the exact 29 migrations, four bounded backfills and nine-provider shadow activation. Canonical user-visible reads/writes and Legacy retirement remain excluded.

## Gate A repository package

The repository must provide a sanitized non-executable package that binds:

- this design and its implementation plan;
- the historical CDB-V1-070A execution package and SHA-256;
- the exact production database name and UUID;
- expected active tenants `1`, `100`, `101`, and `102`;
- the exact production Worker service and routes;
- the 504-entry migration manifest;
- the preparation authorization contract, validator and readiness checker;
- non-executing command templates for candidate build, zero-traffic upload, aggregate reads, bookmark capture, export capture and evidence verification;
- immediate rollback by deleting or retaining the zero-traffic candidate version without changing active traffic.

Every repository permission remains false. The package is ready when its immutable repository bindings are valid; it is never execution-ready without a protected Gate A authorization.

## Gate A protected authorization

The protected JSON document must be stored outside the repository under a mode-700 directory as a mode-600 regular file with no symlink or hard link. It must bind:

- exact authorization ID and UTC validity window;
- owner identity and explicit approval source `user_explicit_all_tenant_shadow_preparation_evidence_authorization`;
- exact production D1 identity;
- exact integrated `main` candidate commit and build SHA;
- preparation-package path/hash/preparation commit;
- historical CDB-V1-070A package path/hash;
- exact Worker service, environment, entrypoint, compatibility date and routes;
- exact expected tenant set and read-only aggregate scope;
- protected evidence output identity;
- permission booleans that allow only production reads, zero-traffic Worker-version upload, Time Travel bookmark capture and backup export capture;
- deterministic read, version-upload, backup-capture and abort tokens.

Generic continuation, a bare `authorize`, or an all-tenant shadow execution approval must not satisfy Gate A. Gate A requires its own explicit preparation-evidence authorization source.

## Gate A evidence receipt

The later executor must produce one protected receipt with:

- production database identity;
- candidate repository/build identity;
- candidate Worker version at 0% traffic;
- previous Worker version still active at 100% traffic;
- exact active routes and route fingerprint;
- exact active tenants and migration-ledger status;
- Time Travel bookmark and protected export IDs/hashes;
- aggregate-only evidence markers;
- rows written `0`;
- migrations applied `0`;
- backfills executed `0`;
- provider flags changed `0`;
- traffic changed `false`;
- Legacy response authority unchanged;
- issue count `0`.

The receipt itself is not implemented in CDB-V1-070B; CDB-V1-070C will implement and validate it before regenerating the final execution package.

## Failure handling

Gate A fails closed when any of the following occurs:

- target database identity differs;
- candidate is not an exact integrated `main` commit containing the minimum CDB implementation;
- the candidate upload receives non-zero traffic;
- the previous Worker is not retained and active;
- active routes differ from the expected route set;
- active tenants differ from the bounded expected set without a fresh scope correction;
- any production row is written;
- any migration, backfill or provider flag change occurs;
- bookmark/export evidence is missing or cannot be restored by the named owner;
- any protected file fails path or permission checks;
- any confirmation token is stale.

No later phase may infer or repair missing evidence.

## Testing

The repository implementation must use TDD and cover:

- exact sanitized package construction and drift rejection;
- strict protected authorization parsing;
- exact target, candidate, Worker, route and tenant scope;
- permission separation between preparation and execution;
- deterministic confirmation tokens;
- protected-file path/mode/link rejection;
- repository readiness with `packageReady=true`, `authorizationReady=false`, `executionReady=false` when no protected authorization is supplied;
- validator CLI argument and non-executing output contracts;
- continuity and governance preservation.

## Exit

CDB-V1-070B is complete when the Gate A repository package and protected authorization validator are committed, verified and non-executable. No production query, upload, bookmark, export, deployment, migration, backfill, flag change, traffic change, push or main integration is performed by this checkpoint.

The next gate becomes:

`CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED`
