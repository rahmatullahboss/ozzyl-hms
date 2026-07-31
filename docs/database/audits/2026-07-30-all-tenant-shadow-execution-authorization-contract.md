# CDB-V1-070A All-Tenant Shadow Execution Authorization Contract

**Prepared:** 2026-07-30  
**Workspace:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Checkpoint:** `CDB-V1-070A-ALL-TENANT-SHADOW-EXECUTION-AUTHORIZATION-CONTRACT-READY`  
**Production mutation performed:** no

## Purpose

Prepare a fresh, fail-closed authorization boundary for the owner-selected all-active-tenant rollout. The contract authorizes nothing by itself. It defines the exact protected external evidence required before any production deployment, traffic change, migration, backfill, provider shadow activation, observation, or rollback action can begin.

The operating model remains:

- active tenants `1`, `100`, `101`, and `102`;
- Legacy continues serving all user-visible reads and writes;
- nine Canonical providers may run only in `shadow` mode;
- expected provider flag scope is 36 exact tenant/provider rows;
- Canonical user-visible read promotion and Canonical primary writes remain prohibited;
- local sync, Legacy retirement, destructive action, push, and CDB-to-main integration remain prohibited.

## Repository package contract

`scripts/canonical/all-tenant-shadow-execution-package.ts` builds and validates a sanitized repository package with:

- exact preparation branch and commit ancestry;
- minimum all-tenant shadow implementation commit `8be5525013a8231b9cccb55957b137fbb385ea34`;
- four exact active tenant IDs from the read-only production preflight;
- 29 ordered migrations from `0541` through `0570`, excluding reserved `0562`: 27 additive migrations plus two data-preserving SQLite table rebuilds (`0548` and `0549`) that require explicit rebuild authorization, row-parity evidence and an exclusive-lock budget;
- four exact bounded backfill modules;
- nine exact provider keys;
- twelve governed consumer IDs and nine source tables;
- ten non-executable phases covering candidate preflight through rollback;
- zero-tolerance integrity, variance, mapping, tenancy, foreign-key, second-pass, and provider-scope thresholds;
- minimum observation duration of 4,320 minutes;
- immediate provider-disable and Worker rollback requirements;
- all production permissions false in the committed package;
- all external execution bindings null in the committed package.

The package hash-binds the rollout plan, this audit, migration manifest, all-tenant shadow SQL contract, aggregate scope validator, protected-clone result, historical CDB-V1-060 package, protected authorization contract, authorization validator, and readiness checker.

## Protected external authorization

`scripts/canonical/all-tenant-shadow-execution-authorization.ts` accepts only a strict protected JSON document outside the repository. Required filesystem protections are:

- parent directory mode `0700`;
- regular file mode `0600`;
- no symlink;
- no hard link;
- no file inside the repository;
- strict duplicate-key, unsafe-key, size, depth, unknown-field, and sensitive-field rejection.

The authorization must bind:

1. exact production D1 name and UUID;
2. current all-active-tenant evidence and checksum;
3. exact integrated `main` candidate commit and build;
4. candidate and retained previous Worker versions;
5. build-manifest and route-fingerprint checksums;
6. current Time Travel bookmark and checksum;
7. protected backup/export evidence and checksum;
8. exact execution window and expiry;
9. single-operator risk acceptance, execution, rollback, and observation ownership;
10. exact 29 migrations and hashes;
11. exact four backfills, tenant scope, hashes, and partition limits;
12. exact four tenants, nine providers, `shadow` mode, Legacy response authority, and 36 expected rows;
13. at least 4,320 observation minutes, positive latency threshold, bounded error-rate threshold, and daily summary requirement;
14. zero-tolerance acceptance values;
15. exact procedure and rollback controls;
16. deterministic deploy, migration, backfill, shadow-activation, and rollback confirmation tokens.

Generic continuation language, including a bare “continue” or “authorize,” cannot satisfy the approval-source contract.

## Permissions model

A valid protected authorization may permit only the bounded operations required for this checkpoint:

- aggregate/read-only production preflight;
- exact candidate deployment with Legacy defaults;
- bounded traffic version change with retained previous Worker;
- exact production schema migrations, with `0548` and `0549` separately classified and authorized as data-preserving table rebuilds rather than additive changes;
- exact bounded all-tenant backfills and second pass;
- exact nine-provider all-tenant shadow activation.

It must keep these permissions false:

- Canonical read promotion;
- Canonical write promotion;
- local-sync activation;
- Legacy retirement;
- destructive action;
- remote database deletion;
- push;
- CDB-to-main integration.

## Readiness and validation tools

- Package writer: `scripts/canonical/prepare-all-tenant-shadow-execution-package.ts`
- Protected validator: `scripts/canonical/validate-all-tenant-shadow-execution-authorization.ts`
- Repository readiness checker: `scripts/canonical/check-all-tenant-shadow-execution-readiness.ts`

The readiness checker is intentionally green when the committed repository package is valid but no protected authorization is supplied. In that state:

- `packageReady=true`;
- `authorizationPresent=false`;
- `authorizationReady=false`;
- `executionReady=false`.

When an authorization path is explicitly supplied, readiness exits non-zero unless every protected gate passes.

## TDD evidence

The implementation was developed through explicit RED→GREEN slices:

- package contract: 4 tests;
- atomic package writer: 5 tests;
- protected authorization contract: 5 tests;
- readiness checker: 4 tests;
- validator CLI: 2 tests.

Combined focused verification: 5 files / 20 tests passed. Root TypeScript passed.

## Safety outcome

No production deployment, traffic change, migration, backfill, provider activation, observation, rollback, Canonical promotion, local-sync activation, Legacy retirement, push, or CDB-to-main integration occurred while preparing this contract.

The exact next gate remains:

`CDB-V1-070-ALL-TENANT-LEGACY-PRIMARY-SHADOW-EXECUTION-EXACT-AUTHORIZATION-REQUIRED`
