# CDB-112B Full-HMS Writer and Reader Registry Design

**Program:** HMS Canonical Data Architecture  
**Checkpoint:** `CDB-112B-WRITER-READER-REGISTRIES`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Execution posture:** repository-local discovery and governance only  
**Production mutation:** prohibited  
**Local-sync expansion:** paused

## 1. Problem

The authority matrix defines which business concept owns each shared fact, but it currently contains only reviewed high-risk writer and reader examples. The legacy retirement registry governs five table families and 65 exact direct-write allowances. The rest of the HMS still contains hundreds of route, library, scheduled, portal, marketplace, reporting, pharmacy, inventory, clinical, HR, and migration paths that can read or mutate tables participating in shared authority.

Without an exact access registry, a legacy table may appear safe to retire while a hidden dashboard, scheduled job, export, route, or helper still reads it. A new direct writer may also bypass the canonical command boundary without changing the schema registry.

CDB-112B creates a deterministic repository-derived inventory for all table names already classified by `canonical-authority-matrix.yaml`.

## 2. Scope

The governed table set is the union of:

1. every `currentSources[].table` in `docs/database/canonical-authority-matrix.yaml`;
2. every registered canonical table in `docs/database/canonical-source-of-truth.yaml`;
3. every table in `docs/database/legacy-table-disposition.yaml`.

At design time the matrix contains 128 unique current-source table names and 69 canonical tables. Some canonical tables also appear as current sources. The registry checker calculates the current values rather than hard-coding them.

The scan roots are:

- `src/**` for runtime, scheduled, route, service, helper, and schema-adjacent access;
- `scripts/canonical/**` for canonical audit, backfill, rehearsal, reconciliation, cutover, and recovery tools.

The initial registry intentionally excludes:

- `test/**`, because test fixtures are governed separately from production/runtime access;
- `migrations/**`, because historical DDL/DML is immutable migration evidence rather than an active runtime writer;
- generated artifacts, dependencies, worktrees, and `.git`;
- comments when detecting raw SQL operations;
- schema declarations that only define a table and do not execute a query.

Migration and seed tools that remain callable from `src/**` or `scripts/canonical/**` are still discovered and explicitly classified.

## 3. Deliverables

### Registry

`docs/database/canonical-authority-access-registry.yaml`

The file is JSON-compatible YAML and contains:

- registry identity and scan policy;
- governed table count;
- exact writer and reader entries;
- operation types;
- associated authority concept IDs;
- path classification;
- lifecycle/provider status;
- owner;
- retirement blocker;
- target provider or command boundary;
- discovery evidence and known limitations;
- exact summary counts.

### Discovery and checker

- `scripts/canonical/canonical-authority-access.ts` — reusable deterministic scanner and classifier;
- `scripts/canonical/generate-canonical-authority-access-registry.ts` — explicit registry refresh command;
- `scripts/canonical/check-canonical-authority-access.ts` — fail-closed drift checker;
- `test/canonical/canonical-authority-access.test.ts` — TDD and tamper coverage.

### Package commands

- `canonical:access-registry-generate`
- `canonical:access-check`
- mandatory integration into `canonical:check`

Generation is never run implicitly by the checker. A code change that introduces or removes a governed access fails until the registry change is reviewed and regenerated explicitly.

## 4. Access detection

### Raw SQL

The scanner strips block and line comments, then detects governed table names in common SQL operation contexts.

Writer operations:

- `INSERT INTO`
- `REPLACE INTO`
- `UPDATE`
- `DELETE FROM`

Reader operations:

- `FROM`
- `JOIN`

An entry may contain both read and write operations for the same path/table. The registry stores them separately because writer cutover and reader promotion have different blockers.

### Drizzle access

The scanner builds a repository-wide map from exported schema variables to physical table names by reading `sqliteTable`, `sqliteView`, and equivalent declarations under `src/db/schema/**`.

It then detects common query-builder contexts:

Writer operations:

- `.insert(schemaVariable)`
- `.update(schemaVariable)`
- `.delete(schemaVariable)`

Reader operations:

- `.from(schemaVariable)`
- `.leftJoin(schemaVariable)`
- `.innerJoin(schemaVariable)`
- `.rightJoin(schemaVariable)`
- `.fullJoin(schemaVariable)`

The scanner records the detection method (`raw_sql` or `drizzle`) and merges duplicate operation evidence deterministically.

### Fail-closed limitations

Dynamic table names, SQL assembled without a literal governed table token, aliases of imported schema variables, stored SQL outside the scan roots, and runtime access generated by external libraries may not be inferable statically. The registry therefore records known limitations and requires future runtime/query telemetry before destructive retirement.

Static completeness is a necessary governance gate, not sufficient production-retirement evidence.

## 5. Writer classification

Allowed writer lifecycle statuses:

- `canonical_authority`
- `canonical_compatibility`
- `legacy_authority`
- `protected_fixture`
- `migration_backfill`
- `blocked_in_canonical_mode`
- `retirement_candidate`

Deterministic defaults:

1. A writer to a registered canonical table is `canonical_authority`.
2. A writer under `scripts/canonical/**` is `migration_backfill` unless it writes a canonical authority table as part of an approved command/recovery tool.
3. A writer under `src/lib/canonical/**` to a noncanonical governed table is `canonical_compatibility`.
4. A writer in an explicit seed/init/smoke-fixture path is `protected_fixture`.
5. Other active writers to noncanonical governed tables are `legacy_authority`.
6. Explicit manual overrides are not allowed in the initial generated registry; classification changes require changing the deterministic policy and tests so hidden exceptions cannot accumulate.

Writer owner is derived from the authority concept domain. Multiple concept IDs are retained when one physical legacy table currently carries more than one business fact.

Writer retirement blockers:

- canonical authority: `NONE`
- canonical compatibility: `COMPATIBILITY_WRITE_REQUIRES_READ_PROMOTION_OBSERVATION_AND_APPROVAL`
- legacy authority: `CANONICAL_WRITE_CUTOVER_INCOMPLETE`
- protected fixture: `FIXTURE_SCOPE_REVIEW_REQUIRED`
- migration/backfill: `MIGRATION_TOOL_RETAIN_UNTIL_PROGRAM_CLOSE`
- blocked/retirement statuses use explicit policy-specific blockers.

## 6. Reader classification

Allowed provider statuses:

- `canonical`
- `shadow`
- `legacy`
- `compatibility`
- `external`

Deterministic defaults:

1. Readers of registered canonical tables are `canonical`.
2. Readers of tables owned by an `external_governed` target concept are `external` unless the same table is being used as a legacy source for another canonical concept; all concept IDs remain visible.
3. Canonical modules reading noncanonical sources are `compatibility` or `shadow` according to their path/provider role.
4. Other readers of noncanonical governed sources are `legacy`.

Reader blockers:

- canonical/external: `NONE`
- shadow: `SHADOW_PARITY_AND_OBSERVATION_INCOMPLETE`
- compatibility: `COMPATIBILITY_READER_REQUIRED_UNTIL_LEGACY_RETIREMENT`
- legacy: `CANONICAL_READ_PROVIDER_NOT_PROMOTED`

A legacy table cannot become retirement-eligible while any active `legacy`, `shadow`, or `compatibility` reader remains unapproved.

## 7. Registry invariants

The checker fails when:

- the registry is missing or malformed;
- scan policy differs from the reviewed contract;
- a governed table or authority concept referenced by an entry is unknown;
- an entry path does not exist;
- classifications or statuses are invalid;
- two entries have the same path/table/access key;
- actual repository discovery contains an unregistered access;
- the registry contains a stale access no longer discovered;
- operations or detection methods differ;
- summary counts drift;
- a rejected parallel architecture is referenced;
- package commands are missing or `canonical:check` omits the access checker.

Registry ordering is stable by access type, table, and path. Operation and concept arrays are sorted.

## 8. International-grade cutover use

The access registry becomes the code-level dependency map for:

- command-boundary migration planning;
- provider adapter planning;
- hidden reader discovery;
- domain cutover scope;
- compatibility duration;
- retirement eligibility;
- rollback impact analysis;
- review of new modules and schema proposals.

It does not itself authorize cutover or retirement. Protected-clone reconciliation, runtime observation, owner authorization, and rollback evidence remain mandatory.

## 9. Safety

CDB-112B performs no production queries or writes, uses no secrets, registers no routes/workers, does not activate local sync, and does not remove a legacy writer. The generated registry contains repository paths and table names only; it contains no PHI, credentials, production row values, or protected artifact paths.
