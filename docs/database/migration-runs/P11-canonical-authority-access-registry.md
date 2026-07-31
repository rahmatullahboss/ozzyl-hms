# P11 Canonical Authority Writer and Reader Access Registry

**Checkpoint:** `CDB-112B-WRITER-READER-REGISTRIES-VERIFIED`  
**Program:** HMS Canonical Data Architecture  
**Branch:** `program/cdb-main-continuous-20260725`  
**Design commit:** `f6230195d`  
**Implementation commit:** `5e59706d7`  
**Execution mode:** local repository discovery and governance only  
**Production mutation performed: no**  
**Legacy writes retired: no**  
**Local-server synchronization activated: no**  
**Push or CDB-to-main integration performed: no**

## Objective

CDB-112B turns the full-HMS authority matrix into an exact code-dependency registry. It identifies statically discoverable writers and readers for every governed table and makes repository drift a mandatory fail-closed governance error.

The machine-readable registry is:

- `docs/database/canonical-authority-access-registry.yaml`

The human-readable dependency audit is:

- `docs/database/audits/2026-07-26-canonical-authority-access-audit.md`

Implementation:

- `scripts/canonical/canonical-authority-access.ts`
- `scripts/canonical/generate-canonical-authority-access-registry.ts`
- `scripts/canonical/check-canonical-authority-access.ts`
- `test/canonical/canonical-authority-access.test.ts`

## TDD evidence

### RED

The contract test was created before scanner/checker modules. The first focused run failed because the discovery module did not exist:

```text
Error: Cannot find module '../../scripts/canonical/canonical-authority-access'
```

### GREEN

After implementing deterministic discovery, explicit generation, and fail-closed comparison, the focused suite passed:

```text
pnpm vitest run test/canonical/canonical-authority-access.test.ts
1 file passed
8 tests passed
```

Tamper coverage proves failure for:

- an unregistered discovered writer;
- an unregistered discovered reader;
- stale or duplicate registry entries;
- invalid writer lifecycle status;
- invalid reader provider status;
- unknown table or business concept;
- missing repository path;
- summary drift;
- a rejected `src/lib/financial-reconciliation/**` reference;
- missing generation/check commands or missing `canonical:check` integration.

## Discovery contract

The governed table set is the union of:

- 128 current-source tables in the authority matrix;
- 69 registered canonical tables;
- 5 registered legacy-disposition tables.

After overlap, the unique governed set is 181 tables.

Scan roots:

- `src/**`
- `scripts/canonical/**`

Detected raw SQL operations:

- writers: insert, replace, update, delete;
- readers: from, join.

Detected Drizzle operations:

- writers: insert, update, delete;
- readers: from and typed joins.

Tests, immutable migration SQL, generated manifests, dependencies, worktrees, comments, and build artifacts are excluded according to the reviewed policy. Callable fixtures under `src/**` remain visible and classified.

The scanner was optimized from per-file/per-table regex evaluation to precompiled combined matchers. Registry generation retained identical counts while improving from approximately 17 seconds to under one second in the reviewed local run.

## Exact registry result

| Measure | Count |
| --- | ---: |
| Governed tables | 181 |
| Writer access pairs | 810 |
| Reader access pairs | 1,906 |
| Tables with writers | 172 |
| Tables without writers | 9 |
| Tables with readers | 166 |
| Tables without readers | 15 |

### Writer lifecycle counts

| Status | Count |
| --- | ---: |
| `canonical_authority` | 206 |
| `canonical_compatibility` | 65 |
| `legacy_authority` | 414 |
| `protected_fixture` | 10 |
| `migration_backfill` | 115 |
| `blocked_in_canonical_mode` | 0 |
| `retirement_candidate` | 0 |

### Reader provider counts

| Status | Count |
| --- | ---: |
| `canonical` | 425 |
| `legacy` | 1,201 |
| `compatibility` | 197 |
| `external` | 83 |
| `shadow` | 0 |

An access pair is one exact `path + table + access-type` dependency, not a count of database rows, SQL statements, HTTP endpoints, or business operations.

## Package commands

Explicit registry refresh:

```text
pnpm canonical:access-registry-generate
```

Fail-closed drift check:

```text
pnpm canonical:access-check
```

Mandatory combined governance:

```text
pnpm canonical:check
```

The combined command now runs:

1. schema governance;
2. business-authority governance;
3. writer/reader access governance.

The checker never regenerates the registry automatically. A new governed access must be intentionally generated, reviewed, and committed.

## Full verification

Fresh verification passed:

- focused CDB-112B access suite: 1 file, 8 tests;
- complete canonical suite: 181 files, 1,302 tests;
- TypeScript: passed;
- schema-governance issues: 0;
- business-authority governance issues: 0;
- authority-access governance issues: 0;
- migration manifest: 475 migrations;
- local-sync readiness: 0 ready, 8 blocked;
- legacy retirement readiness: 0 eligible, 65 blocked.

The local-sync and retirement results are expected safety states. This checkpoint does not authorise activation or removal.

## Important findings

The registry exposes the remaining program scale:

- 414 active legacy-authority writer dependencies still need canonical command cutover or explicit retention decisions;
- 65 canonical modules still preserve legacy compatibility writes;
- 1,201 legacy reader dependencies still require provider migration;
- 197 canonical/compatibility consumers still depend on legacy sources;
- patient, bill, doctor, user, diagnostic-order, invoice, admission, visit, deposit, payment, and inventory tables have the highest shared-reader concentration.

These findings support the next dependency order: patient/practitioner identity, appointment intent, encounter actual-care authority, admission/bed extensions, and their read-provider migration before isolated downstream module work.

## Static-analysis limitations

The registry cannot alone prove:

- dynamic table names with no literal governed token;
- locally renamed Drizzle imports;
- external dependency-generated SQL;
- database triggers;
- remote code outside scan roots;
- actual production traffic or criticality.

Destructive retirement still requires protected evidence, runtime/query telemetry where available, reconciliation, provider parity, observation, rollback proof, and fresh owner authorization.

## Safety result

No database, protected export, remote route, credential, secret, feature flag, traffic allocation, deployment, migration application, backfill, or runtime synchronization process was accessed or changed.

No legacy writer or reader was removed. No destructive SQL was added. The machine registry contains repository paths and table names only; it contains no PHI or production row values.

## Continuation

The exact next checkpoint is:

`CDB-113A-IDENTITY-EPISODE-FOUNDATION-DESIGN`

Create a reconciled design and implementation plan for tenant/global patient identity, practitioner operational adoption, canonical appointment intent, encounter/admission/bed-stay convergence, source mappings, backfill/reconciliation, command boundaries, provider adapters, cutover, and rollback. Commit that design before schema or runtime implementation.
