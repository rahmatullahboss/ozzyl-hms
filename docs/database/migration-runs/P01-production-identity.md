# P01 Production D1 Identity Audit

**Task:** CDB-010 — Identify the live D1 database without mutation
**Date:** 2026-07-13
**Worker branch:** `task/cdb-010-production-d1-identity`
**Program base branch:** `feature/hms-canonical-data-architecture`
**Base commit:** `a6b9c9e08`
**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/reagent-stock-main-integration`
**Handoff status:** READY FOR INTEGRATION

## Scope

This task verifies the production Cloudflare account context, Worker environment, D1 binding, remote D1 identity, and remotely stored schema-migration manifest using read-only Wrangler operations.

The task does **not**:

- execute SQL;
- export or import D1 data;
- create, delete, restore, or modify a D1 database;
- upload or mutate an R2 object;
- deploy a Worker;
- apply a migration;
- enable the local hospital server;
- inspect patient or clinical rows.

## Verified production identity

Final read-only inspection completed successfully at `2026-07-13T10:33:30.623Z`.

| Field | Verified value |
|---|---|
| Wrangler environment | `production` |
| Worker name | `hms-saas-production` |
| D1 binding | `DB` |
| D1 database name | `hms-super-admin-production-apac` |
| D1 database ID | `c68a5360-a2c1-44cc-9e71-f21057bea102` |
| D1 region | `APAC` |
| D1 table count reported by `d1 info` | `779` |
| D1 size reported during final audit | `33,570,816` bytes |
| Authenticated account | `4740…214a` (masked) |
| Account match | `true` |
| Remote database name/ID match | `true` |
| Production manifest bucket | `hms-uploads-production` |
| Manifest key | `system/schema-migrations/2167cc84191043fb30308ed69c2a0817442c853966c2bcd529b364d804967a55.json.gz` |
| Manifest checksum | `sha256:2167cc84191043fb30308ed69c2a0817442c853966c2bcd529b364d804967a55` |
| Key/checksum match | `true` |
| Remote manifest found | `true` |
| Manifest migration count | `432` |
| Remote compressed-object SHA-256 | `2a3882affbb2a4c09849784d8fd84f333891ed01bd30d97b941263b38e18b7ee` |

The report intentionally excludes the operator email, full account ID, OAuth details, and token permissions.

## Independent evidence paths

The production identity was confirmed through four separate read-only sources:

1. `wrangler.toml` `[env.production]` binding configuration.
2. `wrangler whoami --json` authenticated account membership.
3. `wrangler d1 list --json` remote name/UUID inventory.
4. `wrangler d1 info <production-name> --json` remote name, UUID, region, table count, and current database size.

The schema-manifest identity was confirmed by downloading the configured production R2 object through a read-only pipe, locating the gzip payload despite Wrangler's update notice, decoding the manifest, and verifying that its internal checksum equals the digest encoded in its R2 key.

## Implementation delivered

### Read-only inspection command

```bash
pnpm canonical:inspect-production
```

Implementation:

- `scripts/canonical/inspect-production.ts`
- `package.json` script `canonical:inspect-production`

The implementation has an explicit command allowlist. Only these Wrangler operations are permitted:

```text
whoami --json
d1 list --json
d1 info <configured-production-name> --json
r2 object get <configured-production-manifest> --pipe --remote --env production
```

The runner rejects mutation-related command tokens such as `execute`, `export`, `import`, `create`, `delete`, `put`, `restore`, and `deploy`.

### Automated contract coverage

- `test/canonical/production-inspection-contract.test.ts`

Covered behavior:

- parses only the explicit production environment;
- rejects staging, local-server, development, and missing environment values;
- rejects production/staging D1 aliasing;
- masks the account ID;
- verifies account membership;
- verifies remote D1 name and ID through list and info operations;
- handles non-JSON Wrangler notices around JSON output;
- handles Wrangler text preceding binary R2 gzip output;
- verifies manifest key/checksum and migration count;
- prevents mutation commands;
- prevents operator email/full account ID leakage;
- verifies the package command contract.

## Findings

### P01-ID-001 — High — Staging D1 binding drift

`wrangler.toml` currently configures:

```text
hms-super-admin-staging
9e72382e-0d73-49da-90c8-ad5ff6fc5911
```

The authenticated account's remote D1 inventory currently reports the same database name with a different ID:

```text
hms-super-admin-staging
860ffc7b-3add-4b99-9538-1fdb707c9590
```

The nearby configuration comment also references an older production ID that does not match the current production binding.

**Impact:** CDB-011 must not import production data into the configured staging target until the intended staging/clone database is selected by exact UUID and the Wrangler binding is reconciled. Database name alone is insufficient.

**Action owner:** CDB-011 integration/rehearsal agent.

### P01-ID-002 — Medium — Wrangler configuration compatibility warning

Wrangler `4.93.0` reports:

```text
Unexpected fields found in migrations field: "sqlite_classes"
```

A newer Wrangler version is available, but this task deliberately did not change tooling or configuration.

**Impact:** The warning does not prevent the read-only D1 identity checks, but tooling/config compatibility must be resolved separately before relying on an upgraded Wrangler for migration or deployment procedures.

### P01-ID-003 — Information — Existing restore-drill database

The account contains an isolated database named `hms-restore-drill-20260713` with UUID `a9fbe8cb-3fc0-41cf-9272-e561fe65affd`.

This task does not assume that it is the correct CDB-011 staging clone target. Its ownership, contents, retention, and intended use must be verified before any import.

## Commands and evidence

### Expected RED verification

```bash
pnpm vitest run test/canonical/production-inspection-contract.test.ts
```

Initial result: failed because `scripts/canonical/inspect-production.ts` did not exist.

Subsequent RED cycles reproduced and corrected:

- non-string TOML root values;
- Wrangler update text preceding R2 gzip bytes;
- missing `--env` value;
- missing D1-info verification;
- missing package command registration.

### Final verification matrix

| Command | Result |
|---|---|
| `pnpm vitest run test/canonical/production-inspection-contract.test.ts` | exit `0`; 1 file passed; 10 tests passed; 0 failed |
| `pnpm exec tsc --noEmit` | exit `0`; no TypeScript errors |
| `pnpm build:migrations` | exit `0`; 432 conforming migrations generated; 9 pre-existing non-conforming utility/seed files skipped by the existing builder |
| `pnpm canonical:inspect-production` | exit `0`; account, D1 list, D1 info, and remote manifest identity matched |
| `git diff --check` | exit `0`; no whitespace errors before evidence commit |

The final live command used only the command allowlist documented above.

## Safety review

- Production database identity is no longer ambiguous.
- No SQL command was executed.
- No D1 export/import occurred.
- No Cloudflare resource was created, changed, restored, or deleted.
- No object was uploaded to R2.
- No secret or patient data was written to the report.
- The full account ID and operator email are excluded from persisted evidence.
- The local hospital server remains disconnected.

## Tracker handling

The worker branch does not modify the shared `task-progress.yaml` because repository worker protocol reserves shared tracker updates for integration. After review and integration into `feature/hms-canonical-data-architecture`, the integration agent must:

1. mark CDB-010 completed with the final commit and verification evidence;
2. record P01-ID-001 and P01-ID-002 in the program exception/verification queue;
3. make CDB-011 ready only after an exact staging-clone UUID is selected;
4. update `.ai-bridge/current-plan.md` to CDB-011.

## Worker review verdict

### Requirement and safety review

PASS. The task confirms the exact production account, Worker environment, D1 binding/name/UUID, D1 info response, and migration-manifest checksum without SQL or resource mutation. The production identity is suitable as the source for the next clone-rehearsal task. The staging binding drift is explicitly blocking CDB-011 target selection.

### Code-quality review

PASS. The implementation is isolated to a read-only script, one package command, and focused contract tests. Wrangler execution is shell-free and command-allowlisted. Full account identity and operator email are not returned or persisted. No unrelated source, schema, migration, route, or UI file changed.

No unaccepted Critical or High implementation defect remains. P01-ID-001 is a High operational configuration finding that intentionally remains unresolved in this read-only audit and must be handled before CDB-011 imports any data.

## Integration fields

**Worker implementation commit:** `3d6c427e`
**Worker evidence commit:** `a61f9996`
**Program integration commit:** `16ae1566`
**Final program verdict:** PASS — integrated and post-merge verified on `feature/hms-canonical-data-architecture`
