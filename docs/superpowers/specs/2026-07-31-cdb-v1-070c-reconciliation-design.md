# CDB-V1-070C Schema-Ledger and Archival FK Reconciliation Design

## Purpose

CDB-V1-070B Gate A completed with the exact `main` candidate `8111246d9362b66f380c3248af29ad61b671e4f3`, one zero-traffic Worker version, an exact production tenant aggregate, a Time Travel bookmark, and a protected D1 export. Gate B local rehearsal then found two fail-closed blockers:

1. Four migration files are absent from `d1_migrations`, while their complete post-migration schema already exists in production:
   - `0549_approval_revision_policy.sql`
   - `0551_workforce_roster_integrity.sql`
   - `0552_attendance_projection_integrity.sql`
   - `0570_doctor_commission_rule_version_snapshot.sql`
2. `PRAGMA foreign_key_check` reports exactly 41 historical violations in archival table `doctor_commission_accruals_old_0391`: 26 references to `bills` and 15 references to `visits`. Existing repository governance treats these as formal archival-waiver candidates, but the current all-tenant Gate B contract requires zero effective unwaived violations.

CDB-V1-070C creates a separate, narrowly scoped authorization and readiness contract for resolving those blockers. It does not execute production reconciliation and does not authorize Gate B shadow execution.

## Decision

Use a new fail-closed reconciliation gate instead of changing historical migrations or weakening the current Gate B validator.

Rejected alternatives:

- **Rewrite the four historical migration files to be idempotent.** This would change immutable migration artifacts and make repository history disagree with already reviewed hashes.
- **Let Gate B ignore duplicate-column errors or raw FK violations.** This would weaken a production safety gate and make execution behavior dependent on ad hoc operator judgment.
- **Drop or rewrite the archival table.** This would be destructive and is outside the current authorization boundary.

The selected design adds a package, protected authorization validator, readiness checker, and deterministic confirmation tokens. Every command remains a non-executable template until a future exact authorization document is supplied and validated.

## Scope

### Exact production target

- D1 database name: `hms-super-admin-production-apac`
- D1 database UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`
- Candidate commit/build SHA: supplied by protected evidence and required to be an immutable `main` commit containing this implementation
- Tenant scope: `1`, `100`, `101`, `102`

### Reconciliation entries

Each of the four schema-ledger entries binds:

- exact migration filename and repository SHA-256;
- protected aggregate schema evidence ID and SHA-256;
- protected aggregate ledger-state evidence ID and SHA-256;
- `ledgerEntryInitiallyAbsent=true`;
- `postSchemaExact=true`;
- action `record_preapplied_migration_without_ddl`;
- maximum expected ledger rows written: one.

A future executor may insert only the exact four migration-ledger records after re-reading the schema and ledger and proving the evidence is still current. It may not execute the migration SQL, issue DDL, modify business tables, or infer additional reconciliation entries.

### Archival FK disposition

The protected authorization binds exactly two archival groups:

- `doctor_commission_accruals_old_0391 -> bills`: raw 26, formally waived 26, effective unwaived 0;
- `doctor_commission_accruals_old_0391 -> visits`: raw 15, formally waived 15, effective unwaived 0.

It also requires:

- active-table FK violations: zero;
- unknown FK groups: zero;
- archival table status confirmed;
- active writer disabled;
- excluded from canonical import;
- excluded from reporting source selection;
- removal phase fixed to `legacy_retirement_p11`;
- no archival-table mutation or deletion.

This gate records and verifies formal disposition evidence. It does not erase raw historical FK rows and does not authorize legacy retirement.

## Authorization boundary

The only accepted approval source is:

`user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization`

Allowed by that future authorization:

- aggregate non-PHI production reads;
- exact four-row migration-ledger reconciliation;
- protected archival FK disposition evidence refresh;
- protected receipt and manifest creation.

Explicitly prohibited:

- migration SQL or DDL execution;
- business-table writes or backfills;
- provider flag changes;
- Worker upload, deployment, traffic assignment, or route changes;
- Canonical read/write promotion;
- local-sync activation;
- Legacy retirement;
- archival table mutation or deletion;
- destructive action or database deletion;
- repository push or CDB-to-main integration as part of production execution.

## Components

### `all-tenant-reconciliation-package.ts`

Builds and evaluates the immutable repository package. It binds the design, plan, contract, validator, readiness checker, current all-tenant execution package, the four migration files, exact tenant scope, exact archival FK groups, command templates, permissions, and unresolved external evidence fields.

### `all-tenant-reconciliation-authorization.ts`

Strictly parses protected JSON, rejects duplicate/unsafe/sensitive/unknown fields, validates target/timing/owner/repository/evidence/scope/procedure/permissions, and derives deterministic confirmation tokens.

### Validator CLI

Loads a mode-600 regular file from a mode-700 directory outside the repository and returns a non-executing reconciliation plan only when every binding is exact.

### Readiness checker

Evaluates repository package readiness first. With no authorization, it reports `packageReady=true`, `authorizationReady=false`, and `executionReady=false`. With exact protected authorization, it reports whether the bounded reconciliation is ready; it never performs a network request or mutation.

## Data flow

1. Build and verify the immutable CDB-V1-070C package from repository files.
2. Collect fresh protected aggregate production evidence outside the repository.
3. Create an exact protected authorization document bound to those evidence hashes.
4. Validate the protected authorization and deterministic tokens.
5. Produce a non-executing phase plan.
6. Only a separately implemented and reviewed executor may later perform the authorized reconciliation.
7. After reconciliation evidence proves four exact ledger rows and effective unwaived FK count zero, rebuild Gate B external bindings and request a separate exact Gate B execution authorization.

## Fail-closed conditions

Authorization or readiness fails if any of the following is true:

- candidate, database, tenant scope, package, migration hash, or evidence hash drifts;
- any target ledger entry is already present in the pre-reconciliation evidence;
- any post-schema assertion is false;
- a fifth reconciliation entry is added or one of the four entries is missing;
- raw archival counts differ from 26 and 15;
- any active or unknown FK violation exists;
- archival exclusion/retirement assertions are incomplete;
- permissions include DDL, backfill, provider, traffic, promotion, sync, retirement, destructive, deletion, push, or integration authority;
- authorization timing is invalid or expired;
- authorization file protection is weak, linked, or inside the repository;
- confirmation tokens do not match the exact document.

## Testing

Tests must cover:

- package build and immutable file/hash binding;
- unresolved external binding reporting;
- exact protected authorization acceptance;
- generic approval rejection;
- target, candidate, tenant, migration, schema evidence, ledger evidence, and FK group drift rejection;
- rejection of DDL, data-write, traffic, provider, promotion, retirement, destructive, and repository permissions;
- timing, token, duplicate-key, unsafe-key, sensitive-field, unknown-field, symlink, hard-link, and weak-permission rejection;
- readiness behavior with no authorization and with exact authorization;
- non-executing plans with all operation flags false.

## Completion criteria

CDB-V1-070C implementation is complete when the package, authorization contract, validator, readiness checker, package JSON, documentation, package scripts, and focused tests pass on a clean branch. Production reconciliation remains unexecuted and requires a new exact user authorization.