# CDB-113C Practitioner Operational Adoption Audit

**Date:** 2026-07-26  
**Program:** HMS Canonical Data Architecture  
**Branch:** `program/cdb-main-continuous-20260725`  
**Base checkpoint:** `CDB-113B-PATIENT-LINK-FOUNDATION-VERIFIED`  
**Target checkpoint:** `CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION`  
**Production mutation:** none  
**Local-sync expansion:** paused  
**Legacy retirement:** not authorised

## 1. Purpose

The canonical practitioner schema exists, but most operational doctor creation, profile maintenance, external-referrer maintenance, authentication linking, scheduling validation, clinical attribution, public discovery, and reporting still use legacy tables directly. This audit converts the writer/reader registry into one executable adoption boundary.

The objective is not to replace every `doctors` reader in one change. The objective is to establish one operational mutation contract, one provider abstraction, deterministic source mapping, explicit role links, measurable shadow parity, and a serial path for safe reader promotion.

Authentication user is not practitioner identity. Employee is not practitioner identity. External referrer is an external practitioner role, not a copied internal doctor. Name-only practitioner matching is prohibited.

## 2. Exact governed access evidence

The evidence source is `docs/database/canonical-authority-access-registry.yaml`, regenerated at CDB-113B.

### 2.1 Legacy practitioner-related tables

- `doctors`: 4 writers and 72 readers.
- `doctor_auth`: 1 writer and 1 reader.
- `external_referring_doctors`: 1 writer and 2 readers.
- `users`: 9 writers and 66 readers.

The registry does not currently identify direct SQL access under table name `staff`, but the practitioner backfill reads the operational staff table in its controlled fixture and source-link logic. Staff/employee linkage therefore remains a reviewed identity boundary even where the static detector does not classify a direct production path under that exact table name.

### 2.2 Canonical practitioner tables

- `canonical_practitioners`: 3 writers and 7 readers.
- `canonical_practitioner_user_links`: 1 writer and 1 reader.
- `canonical_practitioner_employee_links`: 1 writer and 1 reader.
- `canonical_practitioner_identifiers`: 1 writer and 1 reader.
- `canonical_practitioner_specialties`: 1 writer and 0 readers.
- `canonical_practitioner_departments`: 1 writer and 0 readers.

Most canonical writes currently come from `scripts/canonical/backfill-practitioners.ts`; two compensation paths also ensure canonical practitioner rows. There is no general operational command for doctor/referrer CRUD, link lifecycle, identifier lifecycle, or specialty/department assignment.

## 3. Exact legacy writer inventory

### 3.1 `doctors`

The four direct writer paths are:

1. `src/routes/tenant/doctors.ts`
   - hospital-admin doctor create;
   - doctor/admin profile update;
   - marketplace publish;
   - activate/deactivate;
   - user invitation and profile-related maintenance in adjacent route sections.
2. `src/routes/doctor-auth.ts`
   - authentication registration can create a doctor row and a `doctor_auth` row;
   - authentication data is currently coupled to professional identity creation.
3. `src/routes/public-invite.ts`
   - invitation acceptance can create/update user and doctor linkage.
4. `src/routes/marketplace-admin.ts`
   - marketplace administration can change doctor publication/profile state.

These paths must not continue as independent practitioner identity authorities. During adoption they may remain compatibility writers only when their statements are co-committed through a canonical command boundary.

### 3.2 `doctor_auth`

`src/routes/doctor-auth.ts` is the only direct writer and reader. `doctor_auth` proves authentication/account state. It does not own professional identity, BMDC registration, specialty, department, clinical role, attribution, or compensation identity.

### 3.3 `external_referring_doctors`

`src/routes/tenant/externalReferringDoctors.ts` owns create/update/delete today. It also reuses a row by exact name plus phone in one workflow. That heuristic may remain a user-facing duplicate warning but must never become canonical identity evidence. Delete must become canonical retirement plus compatibility handling rather than hard deletion after adoption.

### 3.4 `users`

Nine direct user writers cover admin, platform staff, invitation, registration, reset, tenant authentication, MFA, and user management. These are authentication/authorization operations. Practitioner commands may link to an existing reviewed user ID but must not assume every user is a practitioner or every practitioner has a user.

## 4. Reader concentration and migration waves

Seventy-two `doctors` readers make a big-bang cutover unsafe. They span:

- global/public portal and prerendering;
- marketplace listing, reviews, and administration;
- appointment, consultation, queue, and schedule validation;
- encounters, visits, admissions, discharge, nursing, and prescriptions;
- laboratory and radiology attribution;
- billing, commissions, doctor payouts, and executive analytics;
- patient chart, timeline, portal, and reminders;
- FHIR and external interfaces;
- reports, dashboards, and scheduled work.

The first provider wave is intentionally small and reversible:

1. global/search resolver;
2. appointment practitioner validation;
3. public/marketplace list adapter;
4. encounter participant resolver.

Feature flag remains disabled until local shadow comparison is deterministic and production authorization is separately granted.

## 5. Operational mutation groups

The reviewed command surface must create internal practitioner, create external practitioner, update or retire practitioner, link or unlink user, link or unlink employee, add, verify, reject, or retire identifier, and assign specialty or department.

### 5.1 Create internal practitioner

Inputs include stable tenant/source identity, display name, reviewed status, optional user/staff links, optional BMDC/employee identifier, specialty, and department. The canonical command creates one practitioner public ID, source mapping, canonical rows, PHI-minimised outbox event, and caller-supplied compatibility statements through `authoritativeStatements` in one batch.

### 5.2 Create external practitioner

An external referrer becomes `practitioner_kind='external'`. It may have specialty and a source mapping to `external_referring_doctors`. Phone/chamber remain domain/profile compatibility details outside canonical identity authority. External creation does not require authentication user or employee linkage.

### 5.3 Update or retire practitioner

Update uses expected version and exact practitioner public ID. Status transition is explicit. Retirement/deactivation never hard-deletes canonical practitioner identity. Legacy `is_active` or external-referrer compatibility updates are co-committed while legacy readers remain.

### 5.4 Link or unlink user

One active user link per practitioner and one active practitioner link per tenant user are enforced by existing uniqueness. Link evidence is `legacy_doctor_user_id` or `approved_manual`. Unlink changes link status to `retired`; it does not delete authentication history.

### 5.5 Link or unlink employee

One active employee/staff link per practitioner and one practitioner per tenant staff ID are enforced. Employee is not practitioner identity. Link evidence is explicit and tenant-scoped.

### 5.6 Add, verify, reject, or retire identifier

BMDC, employee code, or other reviewed identifiers use normalized values and issuer keys. Registration identifier uniqueness is tenant-scoped and cannot be inferred by display name. Verification status changes are explicit and replay-safe.

### 5.7 Assign specialty or department

Specialty and department are typed practitioner associations, not free-text identity keys. Assignment uses normalized keys, display text, explicit primary status, idempotency, and source evidence. Provider comparison includes these associations.

## 6. Required command properties

Every operational command must provide:

- exact non-empty tenant and public/source IDs;
- deterministic practitioner/event IDs when appropriate;
- normalized UTC timestamps;
- SHA-256 source evidence;
- source mapping conflict detection;
- idempotency replay and conflict behavior;
- expected version for updates;
- canonical rows and PHI-minimised outbox in one batch;
- optional `authoritativeStatements` for atomic legacy compatibility;
- rollback of canonical, mapping, outbox, and compatibility writes on any failure;
- no name-only or numeric-ID-coincidence identity resolution.

## 7. Provider contract

### Legacy mode

Legacy mode reads the current source tables and returns a normalized practitioner projection. It must resolve a canonical public ID through source mapping when available; legacy ID remains compatibility metadata only.

### Shadow mode

Shadow mode returns the legacy projection and compares it with canonical state. Comparison covers:

- source mapping;
- practitioner kind and status;
- identifiers and verification status;
- specialties and departments;
- user and employee links.

It does not compare identity by name. Display-name differences may be reported as profile variance but cannot merge or split identities.

### Canonical mode

Canonical mode returns canonical practitioner state. Practitioner public ID is identity; legacy ID is compatibility metadata only. Missing or ambiguous source mapping fails closed for identity-sensitive operations.

## 8. Selected provider adapters

### Global/search resolver

Resolves by explicit source mapping, canonical public ID, or verified identifier. Free-text search may filter display text after identities are already established but cannot create a mapping.

### Appointment practitioner validation

Validates active internal practitioner status and returns practitioner public ID plus optional legacy doctor ID for compatibility. It never validates solely by a doctor name.

### Public/marketplace list adapter

Combines canonical identity/status with legacy profile and marketplace extension fields while the feature flag remains disabled. Publication visibility is profile/workflow state, not practitioner identity.

### Encounter participant resolver

Returns an explicit practitioner public ID for treating, consulting, admitting, requesting, performing, reporting, or verifying roles. Numeric legacy IDs are resolved through source mapping.

## 9. Backfill and reconciliation hardening

The existing practitioner backfill already supports legacy doctors and external referrers, deterministic IDs, explicit source mappings, duplicate registration issues, duplicate user-link issues, employee links, and name-conflict issues. CDB-113C must preserve those controls and add operational evidence for newly command-managed sources.

Required reconciliation:

- doctor/source mapping cardinality;
- external referrer mapping;
- registration identifier uniqueness;
- user/staff link uniqueness;
- missing or ambiguous practitioner issues;
- active provider parity;
- no name-only mapping;
- no cross-tenant user/staff linkage;
- canonical/legacy status compatibility while legacy readers remain;
- second-pass zero-new-row behavior for backfill.

Reconciliation persists aggregate evidence and stable issue fingerprints without leaking credentials, phone numbers, email addresses, registration values, or free-text profile data.

## 10. Migration design

The existing six canonical practitioner tables remain authority. CDB-113C uses an additive migration to add operational version/evidence fields and any required lifecycle indexes or triggers. It does not create a competing practitioner table.

The migration must be idempotent in the project migration-manifest sense, D1-compatible, and safe for existing canonical rows. Existing backfill rows receive deterministic default version semantics; no remote migration is applied during this checkpoint.

## 11. Risk classification

### High risk

- treating `doctor_auth` as professional identity;
- linking by name, phone, email, specialty, or numeric coincidence;
- creating a second practitioner authority;
- partial legacy/canonical writes;
- enabling canonical provider mode before mapping/reconciliation evidence;
- hard-deleting external referrers or practitioners with historical clinical/financial references.

### Controlled risk

- display-name/profile differences;
- marketplace visibility and biography extension fields;
- consultation fee and scheduling extension fields;
- legacy integer ID compatibility metadata.

These controlled differences are not identity variance.

## 12. Serial implementation checkpoints

1. `CDB-113C.1-PRACTITIONER-OPERATIONAL-AUDIT`
2. `CDB-113C.2-PRACTITIONER-COMMANDS`
3. `CDB-113C.3-PRACTITIONER-PROVIDER`
4. `CDB-113C.4-PRACTITIONER-RECONCILIATION`
5. `CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION-VERIFIED`

The next program checkpoint after verified CDB-113C is `CDB-113D-APPOINTMENT-AUTHORITY`.

## 13. Safety boundaries

Production mutation is not authorised. Local-sync expansion remains paused. Destructive legacy retirement is not authorised.

Do not access production databases, protected exports, credentials, or secrets. Do not deploy, apply migrations/backfills, enable provider flags, change traffic, run production observation, retire legacy writes, push, or integrate CDB to `main` without fresh explicit authorization.
