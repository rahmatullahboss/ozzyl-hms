# CDB-101 Foreign-Key Disposition Evidence Design

Date: 2026-07-15

Status: preparation-only; no production repair, waiver approval, or live request

## Goal

Create a strict offline evidence boundary for the 49 known production foreign-key violations that blocks reporting cutover until:

- all 8 active financial orphan rows are repaired and independently verified;
- all 41 `_old_0391` archival orphan rows are either repaired or covered by exact formal-waiver evidence;
- no active financial row is waived;
- before/after aggregate observations are read-only, immutable, and bound to exact hashes;
- the resulting summary is compatible with the schema-v2 reporting authorization contract.

## Separation from CDB-011 clone waivers

`scripts/canonical/apply-fk-waivers.ts` is a clone-schema transformation helper. It may remove constraints from a rehearsal schema and must never be interpreted as production disposition evidence.

CDB-101 production policy is stricter:

- `billing_deposits -> bills` count 4: repair required;
- `income -> bills` count 4: repair required;
- `doctor_commission_accruals_old_0391 -> bills` count 26: repair or exact formal waiver;
- `doctor_commission_accruals_old_0391 -> visits` count 15: repair or exact formal waiver.

The new validator never edits SQL or a database.

## Protected evidence document

The exact schema-v1 evidence pack contains:

- exact production database name and UUID;
- reporting domain and tenant-100 cutover binding;
- one read-only before observation totaling 49 violations in four exact groups;
- two active-financial repair records totaling 8 repaired rows and zero remaining;
- two archival formal-waiver records totaling 41 waived rows, with retired-source, no-active-writer, canonical-import exclusion, reporting exclusion, and P11 removal-phase attestations;
- one read-only after observation totaling 41 remaining violations in only the two archival groups;
- exact timestamps, identifiers, SHA-256 evidence bindings, and safe machine identifiers;
- aggregate totals proving repaired 8, waived 41, unknown 0, and active financial waiver 0.

The document must not contain SQL, row identifiers, patient/practitioner identities, credentials, headers, tokens, free-form notes, or arbitrary fields.

## Shared protected JSON primitive

Extract a reusable local primitive from the authorization boundary for:

- bounded JSON text;
- duplicate-key detection at every depth;
- invalid JSON and excessive-depth rejection;
- prototype-pollution key rejection;
- protected file outside the repository;
- real mode-700 parent directory;
- mode-600 regular file;
- no symlink or hard link;
- no-follow open;
- lstat/fstat device and inode binding;
- sanitized issue codes with no local path or source-value disclosure.

Both authorization and FK evidence readers use this primitive.

## Semantic rules

Evidence is ready only when:

1. the before observation exactly matches 4 + 4 + 26 + 15 = 49;
2. both active groups are disposition `repair_required`;
3. active groups each show 4 repaired, 0 remaining, 0 waived;
4. active repair records include owner, completion time, repair strategy ID, evidence ID/hash, audit-trail evidence ID/hash, affected row count 4, and `hardDeletePerformed=false`;
5. both archival groups use `formal_waiver` or completed repair; the initial template uses formal waiver;
6. formal waivers retain the exact 26/15 remaining counts and waive exactly those counts;
7. archival waiver owner approval, evidence hashes, retired-source/no-writer/import-exclusion/reporting-exclusion, and `legacy_retirement_p11` are all present;
8. the after observation is later than all repair completions and waiver approvals and contains only the exact 26/15 archival groups;
9. before and after observations state `changedDb=false` and `rowsWritten=0`;
10. all evidence IDs and hashes are unique where uniqueness is required;
11. aggregate assertions equal repaired 8, waived 41, remaining 41, unknown 0, active-financial waived 0;
12. no unknown FK group or widened table scope exists.

## Output

The offline validator returns only:

- document and evidence readiness;
- stable issue codes;
- evidence bundle SHA-256;
- aggregate counts;
- authorization-compatible disposition groups;
- `aggregateOnly=true`;
- `networkRequestPerformed=false`;
- `productionMutationPerformed=false`.

It never returns owner identities, raw hashes from source fields, paths, row data, SQL, or free-form evidence.

## Out of scope

- querying production;
- generating repair SQL;
- applying repairs;
- removing constraints;
- approving a waiver;
- issuing schema-v2 authorization;
- deployment, migration, import, feature flag, export, restore, push, or `main` merge.
