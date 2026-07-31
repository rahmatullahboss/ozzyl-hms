# CDB-101 Reporting Operational Readiness Design

Date: 2026-07-14

## Goal

Close every safe, non-mutating operational gap that can be closed before a live reporting-domain cutover, while preserving a hard fail-closed boundary around production deployment, migration application, canonical import, feature-flag mutation, export, restore, and active-route switching.

## Scope

This design adds reviewed local tooling and contracts for:

1. exact production migration authorization and execution planning for `0423` through `0433`;
2. a production canonical bundle importer contract with checksum, tenant, table, command-ID, and confirmation gates;
3. a tenant-scoped `canonical_feature_flags` writer contract;
4. machine-readable classification of the 49 known production FK violations;
5. deployed Worker version and legacy-route evidence contracts;
6. exact deployment, rollback-owner, observation-owner, maintenance-window, expiry, export, bookmark, smoke, rollback, and reopen evidence requirements;
7. an actionable resolution record for each of the 17 current blockers.

No tool added by this task performs a production mutation unless all authorization gates are satisfied and an explicit execution switch and confirmation token are supplied. This task will not invoke any execution switch.

## Architecture

### Shared fail-closed contract library

`scripts/canonical/production-cutover-contract.ts` is the single authority for production identity, tenant scope, migration scope, deterministic command IDs, time-window validation, owner contracts, FK classification, canonical bundle SQL validation, feature-flag SQL generation, and the 17-blocker resolution matrix.

The library contains no network access. It accepts plain data and returns stable validation issues, plans, and SQL/command descriptions. This makes every safety rule directly testable.

### Read-only planning CLI

`scripts/canonical/reporting-cutover-operations.ts` loads the authorization record, calculates expected command IDs, validates the contract at a supplied instant, and prints aggregate-only JSON. It does not call Wrangler and does not modify files or databases.

### Authorized execution wrappers

Three wrappers are prepared but remain unexecuted:

- `apply-production-canonical-migrations.ts` verifies exact database identity, branch commit, authorization, current time, and the exact pending migration set before allowing Wrangler's migration command.
- `import-production-canonical-bundle.ts` verifies the bundle and manifest hashes, tenant scope, allowed canonical tables, SQL statement policy, exact command ID, and confirmation token before allowing a remote D1 file execution.
- `set-production-canonical-flag.ts` verifies exact tenant/key/domain/mode, expected previous state, command ID, authorization window, and confirmation token before allowing one tenant-scoped upsert.

All wrappers default to planning/refusal. Their command runners are injectable for tests. Production execution is possible only through explicit `--execute` plus exact confirmation tokens, and is outside this task's authorization.

## Foreign-key disposition

The current 49 violations are classified by aggregate key:

- 26 `doctor_commission_accruals_old_0391 -> bills`: archival-table waiver candidate only after proving the table is retired and excluded from canonical source selection.
- 15 `doctor_commission_accruals_old_0391 -> visits`: same archival-table waiver candidate conditions.
- 4 `billing_deposits -> bills`: active financial repair required; no reporting GO waiver.
- 4 `income -> bills`: active financial repair required; no reporting GO waiver.

The operational contract accepts neither a count-only blanket waiver nor a partial waiver. Each group needs an exact count, child table, parent table, disposition, evidence ID, owner ID, and removal phase. Active financial groups must be repaired.

## Migration procedure

Wrangler applies every pending migration; it cannot be given a filename subset in the installed version. Therefore the wrapper first obtains the remote pending list and requires it to equal the authorized ordered set `0423` through `0433` exactly. Any additional, missing, reordered, or unknown pending migration causes refusal. Only then may the approved command run:

`pnpm exec wrangler d1 migrations apply DB --env production --remote`

The authorization binds this command to the production D1 UUID, candidate commit, repository manifest SHA-256, command ID, maintenance window, expiry, rollback owner, and observation owner.

## Canonical import procedure

The production importer accepts a reviewed DML-only bundle and a manifest. The bundle may mutate only allowlisted `canonical_*` tables and may not contain DDL, PRAGMA, ATTACH, DETACH, VACUUM, legacy-table writes, or transaction-control surprises. The manifest binds source export hash, bundle hash, manifest hash, tenant `100`, table set, deterministic run ID, second-pass requirement, and row-count summary to the approved command ID.

A bundle generator remains a separate reviewed artifact because the existing clone importer is intentionally unsafe for production targeting. Until a reviewed production bundle exists, import authorization remains false.

## Feature flag procedure

The flag writer permits only:

- database UUID `c68a5360-a2c1-44cc-9e71-f21057bea102`;
- tenant `100`;
- key `canonical_reporting_v1`;
- domain `reporting`;
- initial mode `shadow`;
- expected previous state absent or disabled;
- one tenant-scoped upsert with version increment;
- read-before and read-after verification.

It does not authorize `canonical` mode unless a separate promotion authorization is present.

## Deployment and route evidence

The authorization records candidate commit, candidate Worker version ID, previous Worker version ID, build manifest hash, route fingerprint hash, and an active-route evidence ID. Verification uses read-only Wrangler deployment/version inspection and authenticated read-only legacy-route smoke checks. A deployment is accepted only when the candidate version metadata is bound to the authorized commit and all active legacy reporting route fingerprints and responses remain unchanged.

## Owner and timing contracts

Rollback and observation owners must be distinct named operational identities. Each contract records owner ID, acknowledgement time, communication channel ID, primary responsibility, backup owner ID, and decision authority. The authorization expires no later than the maintenance-window end plus the approved observation grace period, and it must still be valid at every mutating gate.

Rollback timing records separate timestamps for trigger detection, flag disable, Worker rollback, database restore decision, legacy verification, write reopen, and observation handoff. Reopen duration and rollback duration are calculated independently.

## Testing

RED-first tests cover malformed authorization, time boundaries, exact command IDs, migration list drift, bundle SQL rejection, tenant isolation, flag SQL scope, FK classification, owner identity separation, deployment evidence, export/bookmark requirements, smoke coverage, and all 17 blocker resolutions.

## Safety boundary

This task may run local tests, TypeScript, migration manifest build, governance, static diff checks, and aggregate-only production reads. It must not run any production mutation, deploy, export, restore, feature flag, active-route switch, push, or merge to `main`.
