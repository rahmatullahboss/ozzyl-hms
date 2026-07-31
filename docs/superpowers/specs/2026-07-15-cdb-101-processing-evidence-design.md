# CDB-101 Processing Evidence Boundary Design

Date: 2026-07-15

## Goal

Add a protected, offline, authorization-bound processing evidence gate between the completed tenant-100 canonical import/second pass and the initial `canonical_reporting_v1` shadow feature-flag write.

The gate proves that canonical processing queues and integrity checks are clean enough to begin reporting shadow observation. It must not execute a production query, migration, import, deployment, repair, export, Time Travel operation, or feature-flag mutation.

## Boundary

The evidence is **post-import and pre-shadow-flag**.

It is not a prerequisite for canonical migrations or the production import because the observations do not exist until those stages have completed. It is not a promotion evidence pack; smoke/observation evidence remains the later post-shadow promotion/rollback gate.

The only mutating wrapper changed by this package is `set-production-canonical-flag.ts`. That wrapper must reject execution before its first Wrangler child process unless a protected processing evidence pack is valid, bound to the same schema-v2 authorization, and clean.

The migration and import wrappers remain unchanged.

## Authorization strategy

The schema-v2 authorization document is not extended with a processing-evidence hash. Doing so would require evidence that cannot exist when the pre-stage authorization is issued and would create a circular dependency.

Instead, the protected evidence pack exact-binds the existing immutable authorization scope:

- authorization ID;
- production database UUID;
- tenant `100`;
- reporting domain;
- migration command ID;
- production import command ID;
- deterministic import run ID;
- bundle SHA-256;
- manifest SHA-256;
- source export SHA-256;
- exact ordered production-import table allowlist;
- shadow feature-flag command ID and planned effective UTC time;
- authorization expiry.

The validator also runs the existing `validateReportingCutoverAuthorization` semantic check at the requested validation time.

## Evidence document

The protected JSON document uses `schemaVersion: 1` and the following units.

### Identity

- `authorizationId`
- `evidenceId`
- `generatedAtUtc`

### Scope

- `productionDatabaseId`
- `tenantId`
- `domain`
- `stage`, exactly `post_import_pre_shadow`
- `migrationCommandId`
- `importCommandId`
- `featureFlagCommandId`
- `featureFlagEffectiveAtUtc`
- `authorizationExpiresAtUtc`
- `deterministicRunId`
- `bundleSha256`
- `manifestSha256`
- `sourceExportSha256`
- `allowedTables`, in the exact authorization order
- `migrationsCompletedAtUtc`
- `importCompletedAtUtc`
- `secondPassCompletedAtUtc`
- `observationStartedAtUtc`
- `observationEndedAtUtc`

### Ordered processing checks

The document contains exactly these seven checks in this order:

1. `unresolved_critical_exceptions`
2. `blocked_outbox`
3. `blocked_accounting`
4. `duplicate_public_ids`
5. `unsafe_integer_amounts`
6. `tenant_isolation`
7. `second_pass_new_rows`

Each check contains:

- `checkId`
- `observedCount`, a non-negative safe integer;
- `completedAtUtc`;
- `evidenceId`;
- `evidenceSha256`.

A non-zero count is valid audit evidence but is not clean enough for the shadow flag. Non-zero observations therefore do not make the document invalid; they make `shadowFlagReady` false.

### Read-only proof

The pack contains one read-only proof with:

- positive `queryCount`;
- `allQueriesReadOnly: true`;
- `changedDbTrueCount: 0`;
- `rowsWritten: 0`;
- `writeStatementCount: 0`;
- `mutationCount: 0`;
- unique evidence ID and SHA-256.

### Table coverage

The pack records `observedTableNames` in the same exact order as the authorization's production-import allowlist. This proves that duplicate, unsafe-integer, tenant-isolation, and queue checks were scoped to the same reviewed canonical import surface.

## Validation rules

The validator rejects:

- malformed JSON, duplicate keys, unknown fields, unsafe keys, excessive size/depth, or sensitive fields;
- files inside the repository, symlinks, hard links, broad file/directory modes, or unavailable paths;
- unsupported schema versions;
- malformed identifiers, hashes, timestamps, counts, or table registries;
- missing, reordered, duplicated, or unexpected processing checks;
- incomplete or mutating read-only proof;
- duplicate evidence IDs or duplicate evidence hashes;
- authorization identity, database, tenant, domain, command, import scope, table, hash, run-ID, flag-plan, or timing mismatches;
- evidence validated after authorization expiry.

Required chronology is:

`maintenance window start <= migrations complete <= import complete <= second pass complete <= observation start <= every check complete <= observation end <= evidence generated <= validation time <= authorization expiry`

The observation must end no later than the planned shadow effective time.

## Receipt semantics

The aggregate-only receipt exposes:

- `documentReady`
- `evidenceReady`
- `authorizationBound`
- `shadowFlagReady`
- issue count and issue codes
- the seven aggregate observed counts
- check count, observed table count, and read-only query count
- `aggregateOnly: true`
- `networkRequestPerformed: false`
- `productionMutationPerformed: false`
- `externalCommandPerformed: false`

`evidenceReady` means the evidence pack is structurally and semantically complete. It may still contain non-zero findings.

`authorizationBound` means the pack exact-matches a currently valid schema-v2 authorization.

`shadowFlagReady = evidenceReady && authorizationBound && every required observed count === 0`.

The receipt must omit authorization IDs, command IDs, import run IDs, hashes, owner IDs, evidence IDs, paths, raw query output, table row content, credentials, and PHI.

## CLI

Offline validation command:

```bash
pnpm canonical:validate-reporting-processing-evidence -- \
  --evidence <protected-processing-evidence.json> \
  --authorization <protected-reporting-authorization-v2.json> \
  [--at-utc <UTC>]
```

The CLI rejects `--execute`, positional arguments, duplicate arguments, unknown arguments, and missing protected inputs. It performs no child process or network operation.

## Feature-flag wrapper integration

The future authorized flag invocation gains one required argument:

```bash
--processing-evidence <protected-processing-evidence.json>
```

Pre-request order becomes:

1. protected schema-v2 authorization;
2. protected FK disposition evidence;
3. protected maintenance/recovery evidence;
4. protected Worker build/version evidence;
5. protected processing evidence;
6. only then D1 identity and current-flag reads.

The wrapper must require `shadowFlagReady: true`. It passes the already-loaded, validated authorization object into the processing evidence gate rather than re-reading the authorization path, preventing authorization-file substitution between gates. Any missing, invalid, mismatched, expired, or non-clean processing evidence returns an aggregate receipt and exits before the first child process.

## Repository artifacts

Create:

- `scripts/canonical/reporting-processing-evidence.ts`
- `scripts/canonical/validate-reporting-processing-evidence.ts`
- `test/canonical/reporting-processing-evidence.test.ts`
- `test/canonical/fixtures/reporting-processing-evidence-fixture.ts`
- `docs/database/migration-runs/production/CDB-101-reporting-processing-evidence-template.json`
- `docs/database/migration-runs/production/CDB-101-reporting-processing-evidence.md`

Modify:

- `scripts/canonical/set-production-canonical-flag.ts`
- `scripts/canonical/reporting-cutover-operations.ts`
- `scripts/canonical/production-cutover-contract.ts`
- `test/canonical/production-cutover-contract.test.ts`
- existing authorization/FK/maintenance/Worker wrapper regression tests
- `docs/database/migration-runs/production/CDB-101-reporting-operational-readiness.md`
- `docs/database/migration-runs/production/CDB-101-reporting-execution-evidence-template.json`
- `package.json`

## Testing

Use RED-GREEN-REFACTOR.

Tests cover:

- clean authorization-bound evidence;
- valid non-zero audit evidence with `shadowFlagReady: false`;
- exact check registry and table coverage;
- import/hash/run/command/database/tenant/domain/flag-plan binding;
- chronology and expiry;
- read-only proof;
- duplicate IDs/hashes;
- strict JSON and protected-file controls;
- aggregate receipt redaction;
- offline CLI success and refusal;
- flag-wrapper zero-child refusal for missing, invalid, mismatched, expired, or non-clean evidence;
- repository template structural exactness and fail-closed values.

## Safety and non-goals

This package does not create real production evidence. It does not collect live data. It does not reduce the authoritative 17-blocker count. It does not apply migrations, import a bundle, enable a flag, repair FK rows, deploy a Worker, export production, invoke Time Travel, push, or merge to `main`.
