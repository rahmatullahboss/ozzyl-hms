# P03 Canonical Practitioner Identity Rehearsal

**Task:** CDB-030 — Introduce practitioners and explicit identity links

**Date:** 2026-07-14

**Worker branch:** `task/cdb-030-practitioner-identity`

## Delivered model

Migration `0424_canonical_practitioners.sql` adds six additive, tenant-scoped canonical tables:

- `canonical_practitioners`
- `canonical_practitioner_user_links`
- `canonical_practitioner_employee_links`
- `canonical_practitioner_identifiers`
- `canonical_practitioner_specialties`
- `canonical_practitioner_departments`

Every table uses `tenant_id TEXT NOT NULL`, UTC timestamps, typed relationships, stable application-generated public identifiers, restrictive foreign keys, and scoped uniqueness. No legacy table is altered, dropped, renamed, or deleted.

## Identity policy

The backfill follows these rules:

- Names are never identity keys.
- Unique normalized registration identifiers may reuse an existing canonical practitioner.
- Explicit tenant-valid user and staff links may reuse an existing canonical practitioner.
- Registration, user, and employee evidence must resolve to the same practitioner.
- Conflicting deterministic evidence creates an ambiguous source mapping and `PRACTITIONER_DETERMINISTIC_IDENTITY_CONFLICT` issue.
- Multiple legacy doctors claiming one user create a grouped `PRACTITIONER_USER_LINK_AMBIGUOUS` issue; no winner is selected.
- Duplicate legacy registration numbers create issues and are not assigned as canonical identifiers.
- Cross-tenant, orphan, or multi-staff links create processing issues and never create unsafe links.
- External referrers remain external unless deterministic evidence proves an existing identity.
- Same-name internal/external or duplicate external names are unresolved rather than guessed.
- Source evidence is stored only as a stable SHA-256 hash; identifying source fields are not copied into logs or evidence reports.
- Every source row, mapping, link, issue, and checkpoint update uses one atomic D1-compatible batch.

## TDD and adversarial evidence

Initial RED proved the migration, schema module, source mapping, and backfill did not exist.

Hardening RED runs then caught and closed:

- duplicate registration ambiguity;
- cross-tenant user links;
- multiple doctors claiming one user;
- canonical identifier claims being silently ignored;
- source evidence drift after mapping;
- transaction failure in the middle of a checkpoint;
- deterministic registration/user claims resolving to different canonical practitioners;
- existing canonical practitioner reuse by unique registration or explicit user evidence.

Focused practitioner tests: `11` passed.

## Protected source audit

The protected rehearsal source contained these aggregate counts:

- internal doctors: `44`
- external referrers: `3`
- doctors with explicit user IDs: `2`
- cross-tenant legacy doctor/user links: `1`
- doctors with registration numbers: `10`
- duplicate registration groups: `0`
- duplicate user-claim groups: `0`
- staff rows: `11`
- explicit staff/user links: `0`

No names, phone numbers, email addresses, registration values, or row-level records are included in this report.

## Exact-snapshot local rehearsal

The exact post-`0423` protected clone snapshot was copied to an isolated SQLite file. The original export and original dirty repository were not modified.

`0424` result:

- new practitioner tables: `6`
- migration ledger entry: `1`
- foreign-key violations: `0`

Latest-code backfill across `2` tenant scopes:

First pass:

- scanned: `47`
- practitioners created: `47`
- source mappings created: `47`
- ambiguous mappings: `0`
- user links: `1`
- employee links: `0`
- issue rows created: `1`

Second pass:

- scanned: `47`
- practitioners created: `0`
- source mappings created: `0`
- ambiguous mappings created: `0`
- user links created: `0`
- employee links created: `0`
- issue rows created: `0`

Final aggregate state:

- practitioners: `47`
- user links: `1`
- employee links: `0`
- identifiers: `10`
- specialties: `44`
- departments: `1`
- source mappings: `47`
- processing issue rows: `1`
- foreign-key violations: `0`

The only source-specific issue class was `PRACTITIONER_USER_TENANT_MISMATCH`, matching the protected preflight anomaly.

## Rehearsal clone migration

Target:

- database: `hms-canonical-rehearsal-20260713-b6036e`
- UUID: `6f9a17af-8e3e-4b26-85b7-08c653a706db`
- region: APAC

Pre-apply Time Travel bookmark:

`00000010-00000000-000050a7-f9116e6e89107a98367d45e622839809`

Preflight:

- pending migrations: only `0424_canonical_practitioners.sql`
- practitioner identity tables: `0`
- source doctors: `44`
- source external referrers: `3`
- cross-tenant legacy user links: `1`
- duplicate registration groups: `0`
- duplicate user-claim groups: `0`
- foreign-key violations: `0`

Wrangler applied `0424` successfully. Post-migration checks found:

- practitioner identity tables: `6`
- canonical practitioner rows before backfill: `0`
- canonical mappings before backfill: `0`
- canonical issues before backfill: `0`
- foreign-key violations: `0`
- no pending migration

## Protected backfill bundle

A protected, FK-ordered, idempotent bundle was generated from the latest-code exact-snapshot result. It was stored outside Git and was not printed.

- statements representing canonical rows: `163`
- file size: `68,640` bytes
- SHA-256: `77c5f30ec7dd2605bcfb92558b4dbadcf153eb02b3402b49eb67425b0996ae52`

The bundle imported successfully into the isolated rehearsal clone.

Remote aggregate result:

- practitioners: `47`
- user links: `1`
- employee links: `0`
- identifiers: `10`
- specialties: `44`
- departments: `1`
- mappings: `47`
- mapped mappings: `47`
- ambiguous mappings: `0`
- processing issue rows: `1`
- issue occurrences: `1`
- unsafe cross-tenant canonical user links: `0`
- mappings without evidence hashes: `0`
- practitioners without tenant ownership: `0`
- foreign-key violations: `0`
- source doctors preserved: `44`
- source external referrers preserved: `3`

The remote import reached bookmark:

`00000011-00000028-000050a7-7470fed64fb5234e45e43406b20d64de`

Post-verification Time Travel bookmark:

`00000012-00000000-000050a7-2d6e9e86e0f72cedb3a0a78845450bd6`

A second remote import attempt was blocked by the command safety filter before execution. The clone was unchanged by that blocked command. Duplicate-free rerun is proven by the latest-code exact-snapshot second pass, which created zero new canonical business rows.

## Verification

- focused practitioner tests: `11` passed
- full canonical and migration-manifest tests before final commit: `12` files, `90` tests passed
- governance: `0` issues
- migration manifest: `434` conforming migrations
- TypeScript: `0` errors
- local exact-snapshot second pass: `0` new canonical rows
- rehearsal clone FK violations: `0`
- production writes: `0`

## Production boundary

Production read-only verification showed:

- canonical tables: `0`
- migrations `0423`/`0424` recorded: `0`
- latest migration ledger ID: `447`
- rows written by verification: `0`

Neither `0423` nor `0424` was applied to production. No Worker/application deployment, push, `main` merge, Time Travel restore, or local-server activation occurred.

## Protected artifacts

Protected artifacts remain outside Git under:

`/Users/rahmatullahzisan/.hms-canonical-rehearsals/20260714-cdb030-practitioner`

They include SQLite snapshots, exact clone configuration, the temporary aggregate-only runner, and the raw backfill bundle. These artifacts may contain identifying source data and must not be printed, committed, or shared.
