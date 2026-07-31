# CDB-113H Identity and Episode Production Schema/Backfill Preparation Audit

**Checkpoint:** `CDB-113H-IDENTITY-EPISODE-PRODUCTION-SCHEMA-BACKFILL-PREPARATION`  
**Date:** 2026-07-27  
**Branch:** `program/cdb-main-continuous-20260725`  
**Mode:** read-only repository and production aggregate audit  
**Production mutation:** not authorized and not performed  
**Rows written:** 0

## 1. Purpose

CDB-113G proved that the tenant-100 identity/episode production observation cannot proceed because required authority schema is incomplete. CDB-113H determines the exact migration lineage, semantic pending state, existing-row exposure, backfill order, reconciliation equations, and future authorization stages before any mutation is considered.

No production migration or backfill is authorized by this audit. It is preparation evidence only.

## 2. Production migration ledger and Wrangler view

The production `d1_migrations` table contains 487 records. The reviewed production ledger includes:

- `0540_patient_registration_idempotency.sql`;
- `0541_patient_merge_map_hardening.sql`.

The current repository contains a different `0541` name:

- `0541_canonical_local_sync_protocol.sql`.

Wrangler therefore reports ten pending repository migrations, in this exact order:

1. `0541_canonical_local_sync_protocol.sql`;
2. `0542_canonical_sync_inbox_lifecycle.sql`;
3. `0543_canonical_sync_outbox_lifecycle.sql`;
4. `0544_canonical_tenant_patient_links.sql`;
5. `0545_canonical_practitioner_operational_adoption.sql`;
6. `0546_canonical_appointment_authority.sql`;
7. `0547_patient_merge_map_hardening.sql`;
8. `0548_canonical_encounter_admission_bed_convergence.sql`;
9. `0549_approval_revision_policy.sql`;
10. `0550_canonical_credit_note_cash_refund_reversals.sql`.

The same numeric prefix does not imply the same migration. Production and repository history diverged at `0541`, so selective assumptions based only on sequence numbers are unsafe.

## 3. Semantic migration classification

### 0541–0543: local-sync persistence and lifecycle

`0541_canonical_local_sync_protocol.sql` is truly pending. Production does not contain the canonical sync inbox protocol tables it creates.

`0542_canonical_sync_inbox_lifecycle.sql` depends on the inbox table created by repository `0541`. It adds five lifecycle columns, a batch-assertion table, indexes, and triggers.

`0543_canonical_sync_outbox_lifecycle.sql` is also truly pending. It alters the existing `canonical_outbox_events` table, which already has 66 tenant-100 rows. A clone rehearsal must prove those rows satisfy the new triggers and lifecycle semantics. Applying these migrations must not activate synchronization.

### 0544–0546: patient, practitioner, and appointment authority

`0544_canonical_tenant_patient_links.sql` is truly pending and creates `canonical_tenant_patient_links` plus immutable link events. Tenant 100 has 325 patient source rows. This migration does not copy patient demographics.

`0545_canonical_practitioner_operational_adoption.sql` is truly pending. Production has 30 tenant-100 canonical practitioner rows but lacks the reviewed `version` and `source_evidence_sha256` columns.

`0546_canonical_appointment_authority.sql` is truly pending. It depends on the patient-link authority and the operational practitioner authority. Tenant 100 has 126 appointment rows and 15 consultation rows, for 141 planned-intent source rows.

### 0547: schema-equivalent ledger-name drift

Production already contains the table and all four indexes defined by `0547_patient_merge_map_hardening.sql`, but production records that work as `0541_patient_merge_map_hardening.sql`.

The production schema is exact in structure:

- `patient_merge_record_map` table;
- `idx_merge_record_map_log`;
- `idx_merge_record_map_record`;
- `idx_merge_record_map_tenant`;
- `idx_merge_map_unique_record`.

Tenant 100 currently has 0 rows in the table. Repository `0547` uses `IF NOT EXISTS`, so it should be a schema no-op, but this must be proved on a protected clone before Wrangler is allowed to reconcile the new ledger name. It is not counted as a true missing schema migration.

### 0548: high-risk canonical rebuild

`0548_canonical_encounter_admission_bed_convergence.sql` is truly pending and cannot be treated as an ordinary additive migration.

It creates:

- `canonical_care_locations`;
- `canonical_beds`;
- `canonical_admissions`;
- `canonical_admission_status_events`.

It also rebuilds:

- `canonical_encounters`;
- `canonical_bed_stays`.

Tenant 100 currently has 234 canonical encounter rows and 28 canonical bed-stay rows. Therefore 262 existing canonical rows are exposed to table-rebuild risk. The migration temporarily disables foreign keys, renames/recreates tables, copies rows, drops old tables, and re-enables foreign keys.

A protected export, Time Travel bookmark, clone rehearsal, exact pre/post row and schema parity, FK checks, rollback timing, a maintenance window, and a named rollback owner are mandatory before production authorization.
### 0549–0550: approval revision and refund-reversal authority

`0549_approval_revision_policy.sql` is truly pending but is outside the identity/episode domain. It rebuilds approval decision and event tables to add revision-scoped uniqueness and immutable supersession history. A protected clone must prove exact row preservation and the new revision constraints.

`0550_canonical_credit_note_cash_refund_reversals.sql` is truly pending but is outside the identity/episode domain. It adds immutable canonical cash-refund reversal authority and must pass schema, FK, and no-runtime-activation checks on the protected clone.

The complete pending set is therefore nine true pending migrations plus one schema-equivalent ledger-name drift. The identity/episode subset remains eight files: seven true pending plus the `0547` ledger drift.

## 4. CDB-113G missing authorities

The production observation requires four authorities that do not exist:

- `canonical_tenant_patient_links`;
- `canonical_appointments`;
- `canonical_admissions`;
- `canonical_beds`.

The full serial migration chain also introduces supporting sync, patient-link event, appointment event/link, location, admission-event, and lifecycle schema. The missing-authority count of four is the observation blocker, not the complete migration footprint.

## 5. Tenant-100 aggregate baseline

All values were collected through count-only queries. No row content was retained.

| Source or authority | Rows |
|---|---:|
| patients | 325 |
| doctors | 29 |
| external referring doctors | 1 |
| practitioner sources total | 30 |
| canonical practitioners | 30 |
| appointments | 126 |
| consultations | 15 |
| appointment intents total | 141 |
| legacy encounters | 0 |
| visits | 164 |
| canonical encounters | 234 |
| admissions | 65 |
| beds | 31 |
| patient bed info rows | 32 |
| canonical bed stays | 28 |
| canonical outbox events | 66 |
| patient merge record map | 0 |

Every production query reported `changed_db=false` and `rows_written=0` when it executed successfully. Two oversized compound-select attempts were rejected by D1 before returning a result; neither caused a mutation.

## 6. Required serial backfill order

After schema exists on a protected clone, backfill must run serially:

1. **Patient links** — `scripts/canonical/backfill-tenant-patient-links.ts`;
2. **Practitioners** — `scripts/canonical/backfill-practitioners.ts`;
3. **Appointments** — `scripts/canonical/backfill-appointments.ts` after patient/practitioner evidence;
4. **Encounter/admission/bed** — `scripts/canonical/backfill-encounter-admission-bed-convergence.ts` after patient, practitioner, and appointment evidence.

Each stage requires a bounded resume key, stable issue IDs, a second pass that writes zero new business rows, and persistent aggregate reconciliation.

## 7. Reconciliation requirements

Future clone and production evidence must prove at least:

- migration names and SHA-256 hashes match the reviewed manifest;
- all required tables, columns, indexes, triggers, and constraints exist;
- patient source rows equal link rows plus stable unresolved issue rows;
- practitioner sources equal mapped practitioners plus stable issue rows;
- appointment/consultation sources equal canonical mappings plus stable issue rows;
- canonical encounter count before and after `0548` is exactly equal;
- canonical bed-stay count before and after `0548` is exactly equal;
- one active admission per inpatient encounter;
- one open bed stay per bed and per admission;
- zero cross-tenant links;
- zero unexplained duplicate active mappings;
- zero new business rows on every second pass;
- zero active FK violations;
- all five provider flags remain disabled.

## 8. Future stage gates

The machine preparation separates six stages:

- `H0_PROTECTED_EXPORT_AND_CLONE`;
- `H1_CLONE_SERIAL_MIGRATION_REHEARSAL`;
- `H2_CLONE_BACKFILL_RECONCILIATION`;
- `H3_PRODUCTION_SCHEMA_AUTHORIZATION`;
- `H4_PRODUCTION_BACKFILL_AUTHORIZATION`;
- `H5_REPEAT_READONLY_OBSERVATION`.

Every stage is currently unauthorized. Production schema application and tenant-100 backfill require separate authorizations; approval of one must not imply approval of the other.

## 9. Safety result

- production migration applied: no;
- production backfill applied: no;
- production data mutation: no;
- provider flag changed: no;
- route or traffic changed: no;
- deployment performed: no;
- local sync activated: no;
- legacy reader or writer retired: no;
- push or CDB-to-main integration: no.

No production migration or backfill is authorized.

## 10. Exact next checkpoint

`CDB-113H1-PROTECTED-CLONE-MIGRATION-REHEARSAL-AUTHORIZATION-REQUIRED`

The next action is to obtain a fresh exact authorization for a protected production export and isolated clone rehearsal only. The authorization must specify protected paths, clone identity, allowed migration hashes, Time Travel evidence, no-production-mutation boundary, rollback evidence, and stop conditions.
