# CDB-V1-050A protected-clone rehearsal authorization contract

**Date:** 2026-07-30
**Branch:** `program/cdb-main-continuous-20260725`
**Checkpoint:** `CDB-V1-050A-PROTECTED-CLONE-REHEARSAL-AUTHORIZATION-CONTRACT-READY`

## Outcome

The repository-side authorization and preflight contract for `CDB-V1-050` is implemented and verified. The owner explicitly authorized continuation, but no protected external authorization document currently binds the exact clone/database identity, source snapshot and backup checksums, tenant/source-row scope, migration/backfill set, execution window and named operational owners. Therefore the contract is ready while remote execution remains fail closed.

No protected clone or production system was queried or mutated. No migration, backfill, provider promotion, rollback, deployment, traffic change, local-sync activation, push or CDB-to-main integration occurred.

## Implemented controls

- `scripts/canonical/protected-clone-rehearsal-authorization.ts`
  - strict duplicate-key, unsafe-key, unknown-field and sensitive-field rejection;
  - protected regular-file enforcement outside the repository;
  - `0700` parent directory and `0600` authorization-file requirements;
  - symlink and hard-link rejection;
  - exact protected-clone target distinct from the production database name and UUID;
  - exact current branch, repository commit/build, comparison-package checksum, migration-manifest checksum and 504-entry manifest count;
  - source snapshot identity/checksum/export-time/read-only binding;
  - backup identity/checksum, restore authority, stop-on-first-failure and legacy rollback binding;
  - up to 10 exact tenants and 100 tenant-bound source-row scopes;
  - exact provider/consumer/source-table tuple allowlist across nine providers, twelve consumers and nine source tables;
  - ordered migration checksum validation and bounded backfill checksum/partition validation;
  - named execution, rollback and observation owners;
  - bounded current UTC execution window and expiry;
  - zero-tolerance integrity, foreign-key, variance, provider, mapping, tenant, latency, second-pass and source-mutation acceptance;
  - aggregate-only non-executing plan and receipt generation.
- `scripts/canonical/validate-protected-clone-rehearsal-authorization.ts`
  - validates one external authorization file;
  - emits only sanitized issues, aggregate receipt and a non-executing rehearsal plan;
  - exits non-zero unless the exact package is execution-ready.
- `scripts/canonical/check-protected-clone-rehearsal-readiness.ts`
  - verifies the repository-side contract and evidence document;
  - remains `executionReady: false` while the external bindings are absent.
- `docs/database/cdb-v1-050-protected-clone-rehearsal-readiness.json`
  - records owner intent, contract limits, permission matrix and the blocked execution state.

## Permission boundary

Allowed only by an exact valid CDB-V1-050 authorization:

- protected-clone read;
- protected-clone schema migration;
- protected-clone bounded backfill;
- provider-promotion rehearsal;
- rollback rehearsal.

Always excluded from this checkpoint:

- production read or mutation;
- production provider activation;
- deployment or traffic change;
- local-sync activation;
- legacy retirement;
- remote database deletion;
- push or CDB-to-main integration.

## Verification evidence

- focused authorization and continuity verification: 4 files / 23 tests passed;
- combined provider/consumer/authorization/continuity regression: 11 files / 63 tests passed;
- root TypeScript: passed;
- migration manifest: 504 governed migrations;
- full `canonical:check`: passed, including `contractReady: true`, `executionReady: false`, `issueCount: 0`;
- protected clone and production network requests: none;
- protected clone and production mutations: none.

## Commit evidence

- implementation: `4a4ac0154`;
- evidence: `fd585fa04`;
- final metadata: current branch HEAD after metadata finalization.

## Exact next gate

`CDB-V1-050-PROTECTED-CLONE-MIGRATION-BACKFILL-AND-ROLLBACK-REHEARSAL-EXACT-AUTHORIZATION-REQUIRED`

Execution requires a fresh protected external JSON authorization file that validates against the current repository HEAD and current execution window. Historical or generic authorization is not reusable.
