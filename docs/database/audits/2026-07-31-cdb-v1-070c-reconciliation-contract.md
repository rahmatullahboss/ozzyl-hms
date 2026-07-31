# CDB-V1-070C Schema-Ledger and Archival FK Reconciliation Contract

Date: 2026-07-31

Checkpoint: `CDB-V1-070C-SCHEMA-LEDGER-ARCHIVAL-FK-RECONCILIATION-AUTHORIZATION-CONTRACT-READY`

## Status

This document defines a **prepared but not authorized** production-reconciliation boundary. It does not authorize a production read, migration-ledger write, migration SQL execution, DDL, business-table write, backfill, provider flag change, Worker upload/deployment, traffic or route change, Canonical promotion, local-sync activation, Legacy retirement, archival-table mutation/deletion, destructive action, database deletion, repository push, or CDB-to-main integration.

Every command in the repository package is a non-executable template. A separate executor must be implemented and reviewed before any production reconciliation can occur.

## Exact target

- Platform: Cloudflare D1
- Database: `hms-super-admin-production-apac`
- Database UUID: `c68a5360-a2c1-44cc-9e71-f21057bea102`
- Environment: production
- Tenant scope: `1`, `100`, `101`, `102`
- PHI read: prohibited
- Row-level patient read: prohibited
- Final response authority: Legacy
- Worker traffic and routes: unchanged

## Exact schema-ledger divergence

Protected Gate B rehearsal proved that the following four migration files are absent from the D1 migration ledger while their complete post-migration schema is already present:

1. `0549_approval_revision_policy.sql`
2. `0551_workforce_roster_integrity.sql`
3. `0552_attendance_projection_integrity.sql`
4. `0570_doctor_commission_rule_version_snapshot.sql`

The only future reconciliation action permitted by an exact authorization is:

`record_preapplied_migration_without_ddl`

The bounded operation may atomically record exactly four ledger rows after fresh aggregate evidence reconfirms all four ledger entries are absent and every exact post-schema assertion remains true. The operation must not execute any migration file or DDL statement and must not write a business-table row.

Expected aggregate transition:

- Pending migrations before: 29
- Ledger rows recorded: 4
- Pending migrations after: 25
- Migration SQL statements executed: 0
- DDL statements executed: 0
- Business rows written: 0

If any target ledger entry already exists, any schema assertion changes, a fifth candidate appears, or an expected migration disappears, execution must abort automatically before a write.

## Exact archival FK disposition

The protected production export contains exactly 41 historical foreign-key violations in archival table `doctor_commission_accruals_old_0391`:

- Parent `bills`: raw 26, formally waived 26, effective unwaived 0
- Parent `visits`: raw 15, formally waived 15, effective unwaived 0

Required assertions:

- active-table FK violations: 0
- unknown FK groups: 0
- archival table identity confirmed
- active writer disabled
- excluded from Canonical import
- excluded from reporting source selection
- removal phase fixed to `legacy_retirement_p11`
- archival-table mutation prohibited
- archival-table deletion prohibited

This gate records and verifies protected formal-disposition evidence. It does not remove, modify, repair, hide, or delete the raw archival rows, and it does not authorize Legacy retirement.

## Exact future approval source

The only accepted approval source is:

`user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization`

Generic instructions such as `continue`, `ok`, `authorize`, or broad production approval are invalid.

A valid protected authorization must bind:

- exact candidate `main` commit and build SHA;
- exact package bytes and preparation commit;
- exact Gate A preparation receipt ID and SHA-256;
- exact Gate B preparation receipt ID and SHA-256;
- exact four migration names and repository SHA-256 values;
- separate fresh aggregate schema and ledger evidence IDs/hashes for every entry;
- `ledgerEntryInitiallyAbsent=true` and `postSchemaExact=true` for every entry;
- exact archival FK evidence ID/hash and the 26/15 groups;
- exact tenant scope and production target;
- execution, rollback, evidence-custodian, and risk-acceptance identities;
- bounded UTC authorization window;
- deterministic read, ledger-reconciliation, archival-disposition, and abort tokens;
- protected output directory and receipt identities.

The authorization file must be a mode-600 regular file with one hard link, inside a mode-700 directory outside the repository. Symlinks, hard links, weak permissions, duplicate keys, unsafe keys, sensitive fields, unknown fields, expired timing, package drift, evidence drift, and broad permissions are rejected.

## Permissions under a future exact authorization

Allowed:

- aggregate non-PHI production reads required to refresh exact schema, ledger, and archival FK evidence;
- one atomic exact four-row migration-ledger reconciliation;
- protected archival FK formal-disposition evidence refresh;
- protected receipt and evidence-manifest creation.

Prohibited:

- migration SQL execution;
- production DDL;
- business-table writes;
- production backfills;
- provider flag changes;
- Worker version upload or deployment;
- traffic assignment/change;
- route change;
- Canonical read/write promotion;
- local-sync activation;
- Legacy retirement;
- archival-table mutation or deletion;
- destructive action or remote database deletion;
- push or CDB-to-main integration as part of the production operation.

## Fail-closed procedure

1. Validate the protected authorization and deterministic tokens.
2. Verify the candidate, package, Gate A evidence, Gate B evidence, database, and tenant bindings.
3. Capture fresh aggregate schema and migration-ledger evidence.
4. Abort if any target ledger row exists or any exact post-schema assertion is false.
5. Capture fresh aggregate archival FK evidence and abort if active or unknown violations are non-zero, or if the archival groups differ from 26 and 15.
6. In one bounded transaction, record exactly the four approved ledger rows and no other write.
7. Re-read aggregate ledger state and prove pending migration count 25 and exact row count four.
8. Refresh protected archival disposition evidence without modifying archival data.
9. Verify zero migration SQL, zero DDL, zero business-table writes, zero backfills, zero provider changes, zero traffic/route changes, and Legacy authority unchanged.
10. Write protected receipt and evidence manifest. Abort on first failure or operator unavailability.

## Current readiness

The committed package may become repository-ready without an authorization. In that state the required output is:

- `packageReady=true`
- `authorizationReady=false`
- `executionReady=false`
- network request performed: false
- production read performed: false
- production mutation performed: false
- migration ledger rows written: 0
- traffic changed: false

CDB-V1-070C production reconciliation remains unauthorized until an exact protected authorization is supplied and validated. Completion of this contract does not authorize Gate B shadow execution; Gate B requires a separate exact authorization after reconciliation evidence is complete.