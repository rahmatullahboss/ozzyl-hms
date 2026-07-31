# P11 Canonical Practitioner Operational Adoption

**Checkpoint:** `CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION-VERIFIED`  
**Program:** HMS Canonical Data Architecture  
**Branch:** `program/cdb-main-continuous-20260725`  
**Audit/plan commit:** `c4d37b3d5`  
**Schema commit:** `e069abd55`  
**Command commit:** `5448044d4`  
**Provider commit:** `cdfb90ff6`  
**Backfill/reconciliation commit:** `ac4915e25`  
**Execution mode:** local repository implementation and offline verification only  
**Production mutation performed:** no  
**Feature flag enabled:** no  
**Legacy writes retired:** no  
**Local-server synchronization activated:** no  
**Push or CDB-to-main integration performed:** no

## Objective

CDB-113C operationalizes the existing canonical practitioner identity model without creating a second doctor authority and without treating authentication, employment, marketplace profile, scheduling, or compensation data as practitioner identity.

The checkpoint provides reusable canonical mutation boundaries, a disabled legacy/shadow/canonical provider, deterministic backfill evidence, and persistent reconciliation. Legacy doctor/referrer routes and readers remain active compatibility surfaces; this checkpoint does not claim runtime cutover or retirement.

## Exact access audit

The reviewed practitioner audit found:

- `doctors`: 4 writers and 72 readers at audit time;
- `doctor_auth`: 1 writer and 1 reader;
- `external_referring_doctors`: 1 writer and 2 readers;
- `users`: 9 writers and 66 readers;
- six existing canonical practitioner tables, with most writes previously limited to backfill and compensation paths.

The full audit and serial plan are:

- `docs/database/audits/2026-07-26-practitioner-operational-adoption-audit.md`
- `docs/superpowers/plans/2026-07-26-cdb-113c-practitioner-operational-adoption.md`
- `test/canonical/practitioner-operational-adoption-design-contract.test.ts`

Authentication user is not practitioner identity. Employee is not practitioner identity. External referrer is an external practitioner role rather than a copied internal doctor. Name, phone, email, specialty, department, or numeric-ID coincidence is never accepted as identity evidence.

## Additive operational schema

Migration `migrations/0545_canonical_practitioner_operational_adoption.sql` adds only:

- positive practitioner `version`;
- lowercase SHA-256 `source_evidence_sha256`;
- an operational version lookup index.

The six existing canonical practitioner tables remain the authority. No password, authentication row, email, phone, fee, marketplace visibility, appointment slot, schedule, or other profile/workflow fact was copied into canonical practitioner identity.

Existing rows receive migration-safe defaults. New backfilled and command-created rows receive version 1 plus actual source evidence hashes.

## Canonical practitioner commands

`src/lib/canonical/commands/manage-practitioner.ts` provides:

- `createPractitioner` for internal and external practitioners;
- `updateOrRetirePractitioner` with exact expected-version guards;
- `linkOrUnlinkPractitionerUser`;
- `linkOrUnlinkPractitionerEmployee`;
- `managePractitionerIdentifier`;
- `assignPractitionerClassification` for specialty and department.

The command layer provides:

- deterministic public IDs when omitted;
- exact source mapping and source-mapping conflict detection;
- idempotent replay and conflicting-replay rejection;
- tenant-scoped registration uniqueness;
- user/staff one-to-one link enforcement;
- lifecycle retirement instead of identity deletion;
- caller-supplied `authoritativeStatements` for atomic legacy compatibility;
- rollback of canonical, mapping, outbox, and compatibility statements on any failure;
- PHI-minimised outbox events containing public IDs, typed status, kind, classification key, and version—not display names, registration display values, user/staff IDs, credentials, contact details, or profile text.

## Disabled practitioner provider

`src/lib/canonical/practitioner-provider.ts` provides feature-flag modes under `canonical_practitioner_provider_v1`:

- legacy;
- shadow;
- canonical.

The missing, disabled, or unsupported flag state resolves to legacy. No flag was enabled during this checkpoint.

Provider identity is practitioner public ID. Legacy doctor/referrer IDs are compatibility metadata only. Identity-sensitive operations require an explicit mapped source. Shadow comparison checks mapping, kind, status, identifiers, specialties, departments, and user/employee links; display-name similarity is not used for parity or identity resolution.

Disabled-safe adapters exist for:

- global/search resolution;
- appointment practitioner validation;
- public/marketplace listing;
- encounter participant resolution.

These adapters preserve legacy behavior while the flag remains disabled. The checkpoint does not claim that all 74 current `doctors` readers have been promoted.

## Backfill hardening

`scripts/canonical/backfill-practitioners.ts` remains the existing deterministic backfill. CDB-113C hardens it rather than rewriting it:

- internal and external new practitioners receive actual source-evidence hashes;
- version defaults are explicit under migration 0545;
- duplicate BMDC evidence remains ambiguous;
- duplicate external names never merge identities;
- cross-tenant user/staff links remain blocked;
- evidence drift remains a stable processing issue;
- resumable checkpoints remain intact;
- second pass creates zero new business rows.

## Persistent practitioner reconciliation

`scripts/canonical/reconcile-practitioner-operational-adoption.ts` persists a `canonical_reconciliation_runs` receipt for ten fail-closed checks:

1. doctor/source mapping cardinality and canonical internal-kind resolution;
2. external-referrer mapping cardinality and canonical external-kind resolution;
3. legacy BMDC to verified canonical identifier parity;
4. doctor/user link parity;
5. doctor/staff employee-link parity;
6. unresolved practitioner identity issues;
7. active/inactive status compatibility;
8. duplicate-name collapse to one canonical identity;
9. cross-tenant or missing user/staff link targets;
10. orphan canonical user, employee, identifier, specialty, or department associations.

A valid fixture persists a passing aggregate receipt. Tampered source mapping, status, or link state persists a failed receipt. Duplicate normalized names mapped to one canonical identity and open ambiguity evidence fail closed. The receipt contains only aggregate counts and hashes; it excludes names, registration values, contact details, credentials, and profile text.

## Governance result

The canonical registries now record:

- 46 classified business concepts;
- 17 implemented canonical concepts;
- 9 partial canonical concepts;
- 18 canonical gaps;
- 2 externally governed concepts;
- 71 registered canonical tables;
- 183 governed source/canonical/legacy tables;
- 827 exact writer access pairs;
- 1,944 exact reader access pairs;
- 215 canonical-authority writer pairs;
- 123 migration/backfill writer pairs;
- 414 active legacy-authority writer pairs;
- 65 canonical-compatibility writer pairs;
- 454 canonical reader pairs;
- 203 compatibility reader pairs;
- 86 external reader pairs;
- 1,201 legacy reader pairs;
- 0 schema-governance issues;
- 0 business-authority issues;
- 0 writer/reader access-governance issues.

`practitioner_identity` remains `partial_canonical` in the authority matrix because legacy doctor/referrer routes and many operational readers have not been cut over. The matrix now records the command, provider, hardened backfill, and reconciliation evidence without falsely claiming runtime promotion.

## Fresh verification

The completed checkpoint passed:

- CDB-113C focused implementation bundle: 11 files, 77 tests;
- complete canonical suite: 190 files, 1,351 tests;
- TypeScript: passed;
- canonical schema governance: 0 issues;
- canonical business-authority governance: 0 issues;
- canonical writer/reader access governance: 0 issues;
- migration manifest: 477 migrations;
- local-sync readiness: 0 ready and 8 blocked;
- legacy retirement readiness: 0 eligible and 65 blocked.

The readiness results are expected fail-closed safety states. They do not authorize synchronization activation, provider-flag activation, production cutover, migration execution, or legacy retirement.

## Safety result

No production database, protected export, credential, secret, feature flag, route traffic, worker, scheduler, local server, or synchronization runtime was accessed or changed.

No migration or backfill was applied to production or staging. No legacy doctor, referrer, user, staff, practitioner, appointment, encounter, billing, compensation, or clinical record was changed or retired. No branch was pushed and CDB was not integrated to `main`.

## Remaining practitioner work

The practitioner target model, command layer, provider, backfill, and reconciliation are implemented locally, but runtime adoption remains incomplete:

- four legacy `doctors` writer paths still require explicit command integration;
- the external-referrer route still requires compatibility integration and retirement semantics;
- `doctor_auth` remains a separate authentication boundary and must not become professional identity authority;
- practitioner provider mode remains disabled;
- current doctor/referrer consumers still require serial shadow and canonical read promotion;
- production evidence, observation, rollback authorization, and legacy retirement are absent.

These remain governed cutover work and are not silently folded into appointment authority.

## Continuation

The exact next program checkpoint is:

`CDB-113D-APPOINTMENT-AUTHORITY`

Before implementation, review the one upstream `main` commit currently ahead of this CDB branch and merge it only if it is reviewed and safe under the main-to-CDB rule. Then add RED appointment schema and lifecycle tests, implement canonical appointment intent/status/link authority, preserve appointment-versus-encounter separation, and keep production mutation, provider activation, local-sync expansion, and legacy retirement prohibited.
