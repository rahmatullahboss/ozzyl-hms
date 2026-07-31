# P01 Isolated D1 Clone Rehearsal

**Task:** CDB-011 — Export production and create an isolated staging clone
**Date:** 2026-07-13
**Worker branch:** `task/cdb-011-d1-clone-rehearsal`
**Program base branch:** `feature/hms-canonical-data-architecture`
**Base commit:** `18d1b0b4`
**Handoff status:** `READY FOR INTEGRATION`

## Final verdict

CDB-011 passed its production-copy and data-reconciliation gate.

- Production was used only for D1 identity reads, Time Travel information, and export.
- No SQL statement, migration, restore, configuration update, or deployment targeted production.
- A new dedicated APAC rehearsal D1 was created.
- The imported clone contains the same 779 non-system tables and the same 79,433 aggregate rows as the production export.
- Every per-table row count matches.
- Missing tables: 0.
- Extra tables: 0.
- Row-count mismatches: 0.
- The rehearsal clone reports 0 active foreign-key violations under its documented import schema.
- The disabled local hospital server was not accessed or enabled.

The rehearsal clone is ready for CDB-012 schema and data-truth auditing, subject to the explicit foreign-key waiver caveat below.

## Verified identities

### Production source

| Field | Value |
|---|---|
| Worker | `hms-saas-production` |
| Binding | `DB` |
| D1 name | `hms-super-admin-production-apac` |
| D1 UUID | `c68a5360-a2c1-44cc-9e71-f21057bea102` |
| Region | `APAC` |
| Production mutation | None |

The production export file timestamp was `2026-07-13T11:44:29Z`. The D1 Time Travel bookmark resolved for that timestamp is:

```text
00001c2c-0000009e-000050a7-91f124f4f05877dc26692233aebe167e
```

### Dedicated rehearsal clone

| Field | Value |
|---|---|
| D1 name | `hms-canonical-rehearsal-20260713-b6036e` |
| D1 UUID | `6f9a17af-8e3e-4b26-85b7-08c653a706db` |
| Region | `APAC` |
| Created at | `2026-07-13T11:45:18.499Z` |
| Final table count | 779 |
| Final database size | 33,083,392 bytes |
| Final import bookmark | `00000009-000012fe-000050a7-62d33a196ef78d6d43fed70fa48c68f1` |

No configured staging database and no pre-existing restore-drill database was reused.

The Cloudflare account reached its D1 database-count limit when a second diagnostic clone was attempted. No existing database was deleted. The task-created clone was safely returned to its known empty point using its own Time Travel bookmark and then reused:

```text
00000000-0000000a-000050a7-5bfc7e9307dadc26f6edb79845e5b7ec
```

Production was never restored.

## Protected artifacts

All data-bearing artifacts remain outside Git under:

```text
/Users/rahmatullahzisan/.hms-canonical-rehearsals/20260713-cdb011
```

The directory is private and SQL/evidence files use restrictive permissions. Signed Cloudflare download URLs are intentionally not persisted in this report.

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| Production export | 34,810,950 | `b6036eea65342b97e4245d4a6714b03d227fb4a683c2592b65f8930951aaceae` |
| Topological import bundle v2 | 19,227,067 | `ea6ef2fcce517238a96fe60f9e9df345d54ad09e975b51c3d89ab74b1ee7ea7a` |
| Import/waiver manifest v2 | 26,414 | `06007a49aaa1bbe8c4ace5ecc485b216832da5301d93ad9a007dc6d87e765e4e` |
| Rehearsal clone export | 34,810,019 | `09e3f02f5a6480a95d0cecb5bd115644ce480713d1406dd002a654aacb1ce814` |
| Final reconciliation report | 51,471 | `2fd40a1cd976f7fd992e9dca30cc60bc63eeb20dd3d2fe73756ab57db36b03f8` |

A non-PHI evidence summary is stored outside Git as `cdb011-evidence.json`.

## Import investigation and final approach

### Attempt 1 — direct full export import

The production export was valid and could be loaded into local SQLite. Direct D1 import failed with:

```text
no such table: main.branches
```

The D1 export interleaved some child-table inserts before later parent-table creation. D1 rolled the failed transaction back to the clone's original empty state.

### Attempt 2 — schema-only then data-only

Cloudflare schema-only export succeeded. Wrangler `4.93.0` did not produce a data-only export with `--no-schema`, reporting that nothing was selected for export.

A local data-only dump was generated from the production snapshot. Import still failed because:

1. the production snapshot contains real legacy orphan foreign keys;
2. D1 keeps `foreign_keys=1` and does not allow the import session to disable enforcement;
3. schema triggers rejected historical rows that predated current validation rules;
4. D1 bulk ingestion evaluates work in chunks, so one global deferred-FK transaction was insufficient.

Every failed D1 import reported rollback behavior. The clone was verified before each subsequent retry.

### Production legacy FK findings

Local `pragma_foreign_key_check` against the untouched source snapshot found exactly 49 orphan rows:

| Child table | Parent table | Violations |
|---|---|---:|
| `doctor_commission_accruals_old_0391` | `bills` | 26 |
| `doctor_commission_accruals_old_0391` | `visits` | 15 |
| `billing_deposits` | `bills` | 4 |
| `income` | `bills` | 4 |
| **Total** |  | **49** |

No row values, patient details, diagnoses, notes, phone numbers, or free text were emitted during this check.

### Final import design

The successful import bundle was built from a private local SQLite reconstruction of the production export.

It applies this deterministic order:

```text
Create tables in dependency order
→ Insert historical data parent-before-child
→ Create indexes
→ Create triggers
→ Create views
```

The builder also converts SQLite CLI `unistr(...)` dump syntax into D1-compatible UTF-8 hexadecimal text literals. The final bundle contains zero `unistr(...)` calls.

The final bundle contained:

| Object | Count |
|---|---:|
| Tables | 779 |
| Explicit indexes | 1,645 |
| Triggers | 56 |
| Views | 0 |
| Manual orphan waivers | 4 |
| Cycle/self-reference import waivers | 14 |
| Total documented import waivers | 18 |

The final D1 import succeeded:

- queries executed: 81,914;
- D1-reported logical changes: 79,434;
- final tables: 779;
- final database size: 33.08 MB;
- D1 import duration: approximately 6.56 seconds;
- region/colo: APAC/SIN.

## Foreign-key waiver caveat

The rehearsal clone preserves all production rows but intentionally omits 18 FK declarations that D1 bulk ingestion could not safely satisfy:

1. **Four manual orphan waivers** correspond to the 49 verified production orphan rows listed above.
2. **Fourteen graph waivers** break self-references or true multi-table cycles during chunked ingestion.

The 14 graph waiver edges are:

- `accounting_vouchers.reversal_of_voucher_id → accounting_vouchers`
- `bank_deposit_requests.bank_transaction_id → bank_transactions`
- `bank_transactions.bank_deposit_request_id → bank_deposit_requests`
- `chart_of_accounts.parent_id → chart_of_accounts`
- `InventoryLocation.ParentLocationId → InventoryLocation`
- `InventoryStore.ParentStoreId → InventoryStore`
- `lab_observation_audit.supersedes_observation_id → lab_observation_audit`
- `lab_reports.supersedes_report_id → lab_reports`
- `lab_results.retraction_request_id → lis_result_retraction_requests`
- `lab_specimens.parent_specimen_id → lab_specimens`
- `lis_analyzer_inbox.supersedes_inbox_id → lis_analyzer_inbox`
- `lis_result_retraction_requests.lab_result_id → lab_results`
- `pharmacy_racks.parent_id → pharmacy_racks`
- `TRK_Category.ParentCategoryId → TRK_Category`

This does **not** authorize removing those constraints from the future canonical production schema. The complete source definitions and every waiver are preserved in the protected manifest.

CDB-012 must therefore use:

- the original production export/local source snapshot for exact legacy schema and FK-violation truth;
- the rehearsal clone for row-level aggregate auditing, migration rehearsals, backfills, and reconciliation;
- the waiver manifest whenever comparing source and clone schema.

## Reconciliation result

The clone was exported after import and compared locally with the original production export. The reconciliation utility emits table names and counts only.

```json
{
  "exactMatch": true,
  "sourceTableCount": 779,
  "cloneTableCount": 779,
  "sourceTotalRowCount": 79433,
  "cloneTotalRowCount": 79433,
  "missingTableCount": 0,
  "extraTableCount": 0,
  "rowCountMismatchCount": 0
}
```

A remote clone-only check also returned:

```json
{
  "violation_count": 0
}
```

The remote check performed no writes.

## Repository deliverables

- `scripts/canonical/export-production.sh`
- `scripts/canonical/import-staging.sh`
- `scripts/canonical/reconcile-clone-exports.ts`
- `scripts/canonical/apply-fk-waivers.ts`
- `scripts/canonical/build-clone-import.ts`
- `test/canonical/clone-script-contract.test.ts`
- `test/canonical/clone-reconciliation.test.ts`
- `test/canonical/fk-waiver-schema.test.ts`
- `test/canonical/clone-import-bundle.test.ts`
- `docs/database/migration-runs/P01-clone-rehearsal.md`

The import script now requires separate checksums for:

- the immutable original production export used for reconciliation; and
- the validated topological import bundle executed against the clone.

It refuses:

- identical production/clone identities;
- configured drifted staging targets;
- the pre-existing restore-drill target;
- missing or checksum-mismatched artifacts;
- non-empty clone targets;
- SQL execution against production;
- overwriting clone exports, metadata, or reconciliation evidence.

## Verification

| Command | Result |
|---|---|
| `bash -n scripts/canonical/export-production.sh` | PASS |
| `bash -n scripts/canonical/import-staging.sh` | PASS |
| Focused CDB-010/CDB-011 Vitest suite | PASS — 5 files, 30 tests, 0 failures |
| `pnpm exec tsc --noEmit` | PASS — 0 errors |
| `pnpm build:migrations` | PASS — 432 conforming migrations; 9 pre-existing utility/seed SQL files skipped |
| `pnpm canonical:inspect-production` | PASS — production identity and remote manifest still matched; read-only |
| `git diff --check` | PASS |

Final verification completed at approximately `2026-07-13T12:29:48Z` UTC.

## Known tooling warning

Wrangler `4.93.0` repeatedly reports:

```text
Unexpected fields found in migrations field: "sqlite_classes"
```

Wrangler also reports that a newer release is available. CDB-011 did not combine a Wrangler upgrade or configuration cleanup with the clone rehearsal because the required read/export/create/import/reconciliation operations completed successfully.

This warning remains an explicit follow-up item; it is not evidence of a failed clone.

## Security and retention

- Data-bearing SQL and SQLite artifacts are outside Git.
- They must not be uploaded to chat, email, issue trackers, or source control.
- The rehearsal D1 and local artifacts are restricted to the canonical audit program.
- CDB-012 must record the approved deletion/retention date after baseline evidence is captured.
- No signed export URL is included in committed evidence.

## Handoff

**Worker implementation commits:**

- `a2ea5aa8` — initial protected export/import/reconciliation tooling
- `2ddb8298` — initial blocked-run evidence
- `168618f1` — successful live clone retry, compatibility tooling, and final reconciliation evidence

**Production state:** read-only export completed; no mutation
**Clone state:** populated and exactly row-count reconciled
**Rollback state:** clone Time Travel bookmarks recorded; production rollback not required
**Next task after integration:** CDB-012 — capture live schema and baseline reconciliation
**Final worker verdict:** `READY FOR INTEGRATION`
