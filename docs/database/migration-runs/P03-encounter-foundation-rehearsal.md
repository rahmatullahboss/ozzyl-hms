# P03 Canonical Encounter Foundation Rehearsal

**Task:** CDB-031 — Promote encounters and map OPD/IPD episodes

**Date:** 2026-07-14

**Worker branch:** `task/cdb-031-encounter-foundation`

## Delivered model

Migration `0425_canonical_encounters.sql` adds five additive, tenant-scoped tables:

- `canonical_encounters`
- `canonical_encounter_participants`
- `canonical_encounter_admission_links`
- `canonical_encounter_addenda`
- `canonical_bed_stays`

All tables use `tenant_id TEXT NOT NULL`, stable public IDs, UTC timestamps, typed relationships, restrictive foreign keys, scoped uniqueness, and additive-only DDL. Legacy appointments, visits, consultations, encounters, admissions, and bed histories remain unchanged.

## Encounter authority and grouping rules

- Existing legacy encounter rows are the highest-priority encounter source.
- Exact appointment-to-visit links map to one canonical encounter.
- Walk-in visits create encounters without inventing appointments.
- Scheduled, cancelled, and no-show appointments remain planning records and do not create encounters.
- A completed/in-progress consultation reuses exactly one same-tenant patient/doctor visit inside the bounded source-time window.
- Multiple consultation candidates create an ambiguous mapping and issue.
- A consultation with no candidate may create a standalone teleconsultation when its lifecycle proves care occurred.
- An admission reuses a visit encounter only when tenant, patient, and explicit `admission_no` match.
- Time proximity alone never merges an admission with a visit.
- Bed stays require an explicit mapped admission encounter.
- Invalid bed intervals or patient/admission mismatches create ambiguous mappings and issues without inserting an invalid canonical interval.
- Practitioner roles are explicit; treating, consulting, and admitting roles are not inferred from one another.
- Missing practitioner mappings create issues and never fabricate participants.
- Signed snapshot and addendum text is never copied. Only SHA-256 hashes, timestamps, and typed source mappings are retained.

## Runtime command

`startEncounter()` uses the canonical atomic command batch to create:

- encounter row;
- explicit participant row;
- source mapping;
- PHI-free outbox event;
- idempotent replay result.

A conflicting request raises the canonical idempotency conflict error. A participant FK failure rolls back the encounter, mapping, and outbox together.

## TDD and adversarial evidence

Initial RED proved the migration, schema module, backfill, and runtime command did not exist.

Hardening RED runs closed:

- no-show/cancelled planning creating encounters;
- consultation multi-candidate guessing;
- admission proximity-based merging;
- signed clinical text copying;
- transaction failure/checkpoint restart;
- cross-tenant source ID collisions;
- missing practitioner mappings;
- invalid bed intervals aborting an otherwise valid admission backfill;
- real source-column drift for encounter addenda (`content`);
- timezone-less legacy candidate matching;
- malformed signed/addendum hash handling.

Focused encounter and command tests: `11` passed.

## Protected source audit

Aggregate source counts before canonical backfill:

- appointments: `748`
- visits: `601`
- consultations: `18`
- legacy encounters: `0`
- legacy encounter addenda: `0`
- admissions: `76`
- patient bed histories: `44`

Deterministic relationship audit:

- appointment/visit exact links: `428`
- appointment with multiple visits: `0`
- visit/appointment cross-tenant mismatch: `0`
- patient mismatch: `0`
- doctor mismatch: `0`
- no-show with visit: `0`
- cancelled with visit: `0`
- walk-in visits: `173`
- exact admission-number visit links: `0`
- admission nearby-visit groups requiring review: `16`
- care-status appointments without visit: `2`
- invalid bed intervals: `0`
- overlapping bed intervals: `0`
- missing practitioner mappings for source doctors: `0`

No patient, practitioner, note, diagnosis, or signed clinical text is included in this report.

## Exact-snapshot local rehearsal

The exact protected post-CDB030 snapshot was copied to an isolated SQLite file. Migration `0425` produced:

- clinical tables: `5`
- migration ledger entry: `1`
- pre-backfill FK violations: `0`

Latest-code first pass across `3` tenant scopes:

- scanned source rows: `1,487`
- encounters created: `686`
- participants created: `547`
- admission links created: `76`
- bed stays created: `44`
- encounter/bed mappings created: `1,487`
- processing issues created: `18`

Latest-code second pass:

- scanned source rows: `1,487`
- encounters created: `0`
- participants created: `0`
- admission links created: `0`
- bed stays created: `0`
- mappings created: `0`
- issues created: `0`

Final exact-snapshot state:

- encounters: `686`
- participants: `547`
- admission links: `76`
- addenda: `0`
- bed stays: `44`
- encounter mappings: `1,443`
- bed-stay mappings: `44`
- issue rows: `18`
- mappings without evidence hash: `0`
- encounters without tenant ownership: `0`
- FK violations: `0`

Issue classes:

- `ENCOUNTER_ADMISSION_NEARBY_VISIT_UNRESOLVED`: `16`
- `ENCOUNTER_APPOINTMENT_WITHOUT_VISIT`: `2`

These are explicit unresolved source conditions, not unexplained reconciliation variance.

## Rehearsal clone

Target:

- name: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- region: APAC

Pre-apply Time Travel bookmark:

`00000013-00000000-000050a7-a7e4c74d9ce25ef893b0cfd13ba140af`

Preflight confirmed:

- only `0425_canonical_encounters.sql` pending;
- clinical tables `0`;
- source counts matched the protected snapshot;
- FK violations `0`.

Wrangler applied `0425` successfully. Post-migration verification found five empty clinical tables, one ledger entry, no pending migration, and zero FK violations.

## Protected backfill bundle

A protected FK-ordered idempotent bundle was generated outside Git from the exact-snapshot result.

- statements representing canonical rows: `2,906`
- file size: `1,489,230` bytes
- SHA-256: `1b7f17f282b8a5af8efa281597c6761cbc86c06a9b4001ef0dcff29fc04ca80a`

The isolated clone imported `2,907` queries successfully and reached bookmark:

`00000013-000002de-000050a7-28717bb7bd8c18febee330e7625461ac`

Remote aggregate result matched the exact snapshot:

- encounters: `686`
- participants: `547`
- admission links: `76`
- addenda: `0`
- bed stays: `44`
- encounter mappings: `1,443`
- bed-stay mappings: `44`
- issue rows/occurrences: `18` / `18`
- mappings without evidence hash: `0`
- encounters without tenant ownership: `0`
- FK violations: `0`
- all legacy source counts preserved.

Post-verification Time Travel bookmark:

`00000014-00000000-000050a7-431ab44066fe27bc0ddf6fee3ecb08ef`

Duplicate-free rerun is proven by the latest-code exact-snapshot second pass, which created zero canonical business rows.

## Production boundary

Fresh production read-only verification showed:

- canonical tables: `0`
- migrations `0423`, `0424`, and `0425` recorded: `0`
- latest migration ledger ID: `447`
- rows written by verification: `0`

Migration `0425` and encounter backfill were applied only to the isolated rehearsal clone. No production mutation, Worker/application deployment, push, `main` merge, Time Travel restore, or local-server activation occurred.

## Protected artifacts

Protected artifacts remain outside Git under:

`/Users/rahmatullahzisan/.hms-canonical-rehearsals/20260714-cdb031-encounters`

They include SQLite snapshots, exact clone configuration, the aggregate-only runner, and raw backfill SQL. They must not be printed, committed, or shared.
