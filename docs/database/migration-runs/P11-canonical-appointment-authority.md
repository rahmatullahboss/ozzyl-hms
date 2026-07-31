# P11 Canonical Appointment Authority

**Checkpoint:** `CDB-113D-APPOINTMENT-AUTHORITY-VERIFIED`
**Program:** HMS Canonical Data Architecture
**Branch:** `program/cdb-main-continuous-20260725`
**Audit/plan commit:** `113568cf8`
**Schema/governance commit:** `7a77d3d41`
**Command commit:** `c49eb49b5`
**Provider commit:** `ba9522cc8`
**Backfill/reconciliation commit:** `ba7222e3e`
**Execution mode:** local repository implementation and offline verification only
**Production mutation performed:** no
**Feature flag enabled:** no
**Legacy writes retired:** no
**Local-server synchronization activated:** no
**Push or CDB-to-main integration performed:** no

## Objective

CDB-113D establishes one additive canonical authority for planned appointment intent while preserving the existing canonical encounter model as the authority for actual care. It does not copy patient demographics, practitioner profile data, billing truth, marketplace workflow, queue state, clinical notes, or notification delivery into appointment authority.

The checkpoint provides tenant-scoped appointment schema, immutable lifecycle history, explicit appointment-to-encounter links, version-guarded commands, a disabled legacy/shadow/canonical provider, deterministic resumable backfill, and persistent aggregate reconciliation. Existing appointment, consultation, marketplace, patient-portal, queue, doctor, billing, reporting, and reminder routes remain active compatibility or legacy surfaces. This receipt does not claim runtime cutover, reader promotion, production backfill, provider activation, or retirement.

## Exact access audit

The reviewed appointment audit recorded the following pre-implementation access evidence:

- `appointments`: 8 writer paths and 30 reader paths;
- `consultations`: 3 writer paths and 8 reader paths;
- `doctor_schedules`: 3 writer paths and 8 reader paths;
- 24 literal appointment mutation references across the appointment writer paths.

The audit and serial implementation plan are:

- `docs/database/audits/2026-07-26-appointment-authority-audit.md`;
- `docs/superpowers/plans/2026-07-26-cdb-113d-appointment-authority.md`;
- `test/canonical/appointment-authority-design-contract.test.ts`.

The reviewed architecture rules are exact:

- appointment is planned intent;
- encounter is actual care;
- patient identity is referenced through `patient_link_public_id`;
- practitioner identity is referenced through canonical practitioner public ID;
- billing status and payment state are not appointment authority;
- marketplace booking, doctor schedule, queue, notifications, and clinical documentation remain controlled extensions or projections;
- name, phone, email, specialty, department, legacy numeric-ID coincidence, and time proximity are never accepted as identity or episode-link evidence.

## Additive appointment schema

Migration `migrations/0546_canonical_appointment_authority.sql` and `src/db/schema/canonical/appointments.ts` add:

- `canonical_appointments` for planned intent, requested interval, modality, channel, queue-token assignment, current lifecycle status, optimistic version, reschedule lineage, source evidence, and tenant-scoped identity references;
- `canonical_appointment_status_events` for immutable ordered lifecycle history;
- `canonical_appointment_encounter_links` for explicit appointment-to-encounter fulfilment or origin evidence.

The schema enforces:

- tenant-scoped canonical public IDs;
- positive lifecycle versioning;
- one immutable status-event sequence per appointment;
- typed appointment kind, modality, channel, token assignment, status, event, and encounter-link vocabulary;
- requested end after requested start;
- source-evidence SHA-256 shape;
- tenant-safe foreign keys to patient links, practitioners, appointments, and encounters;
- active non-manual token uniqueness for one practitioner, business date, and token number;
- reschedule lineage without rewriting the previous appointment;
- explicit active encounter-link cardinality.

A lifecycle regression identified and corrected a missing `scheduled` status-event vocabulary value before the schema checkpoint was committed.

## Canonical appointment commands

`src/lib/canonical/commands/manage-appointment.ts` provides reviewed command boundaries for:

- appointment creation;
- lifecycle transition with expected-version guards;
- rescheduling as a new linked appointment plus closure of the prior intent;
- fulfilment through one explicit canonical encounter link;
- encounter-link retirement without deleting historical evidence.

The command layer provides:

- deterministic appointment, event, and link public IDs when omitted;
- exact replay and conflicting-replay rejection;
- patient-link and active-practitioner dependency validation;
- tenant-scoped source mapping and conflict protection;
- optimistic status-version enforcement;
- transition vocabulary validation;
- appointment-versus-encounter separation;
- patient consistency between appointment and encounter;
- atomic caller-supplied compatibility statements while legacy readers remain active;
- rollback of canonical rows, events, source mappings, outbox evidence, links, and compatibility statements on any failure;
- PHI-minimised outbox evidence containing canonical public IDs, typed lifecycle facts, interval metadata, and versions—not names, phone numbers, notes, complaints, legacy patient/doctor IDs, fees, billing state, or room URLs.

The real SQLite command tests cover create, replay, conflict, dependency validation, atomic rollback, versioned transitions, reschedule lineage, explicit fulfilment, patient mismatch, and historical link retirement.

## Disabled appointment provider

`src/lib/canonical/appointment-provider.ts` provides feature-flag modes under `canonical_appointment_provider_v1`:

- legacy;
- shadow;
- canonical.

Missing, disabled, malformed, or unsupported configuration remains legacy. No provider flag was enabled during this checkpoint.

Provider resolution uses:

- exact appointment source mapping;
- exact tenant patient link;
- exact practitioner source mapping when a practitioner is present;
- canonical schedule interval, kind, modality, channel, token assignment, lifecycle version, reschedule lineage, and explicit encounter link.

Provider parity deliberately excludes names, contact details, notes, complaint text, billing status, fee values, payment state, and room URLs. Identity-sensitive marketplace, patient-portal, check-in, and reminder adapters fail closed when exact mappings are absent. Appointment detail remains disabled-safe and can preserve legacy projection while reporting shadow parity.

## Deterministic bounded backfill

`scripts/canonical/backfill-appointments.ts` implements a two-partition backfill:

1. `legacy_appointment` from `appointments`;
2. `legacy_consultation` from `consultations`.

The backfill provides:

- tenant-scoped migration-run and partition checkpoint records;
- bounded `maxSourceRecords` execution;
- pause/resume from the last committed cursor;
- one atomic batch per source row;
- deterministic canonical appointment, status-event, source-mapping, link, issue, and checkpoint IDs;
- normalized UTC interval and tenant business date;
- exact patient-link and practitioner mapping requirements;
- explicit legacy visit or consultation encounter mapping for fulfilment;
- no timestamp-proximity encounter linking;
- no automatic fulfilment when exact encounter evidence is missing;
- active queue-token conflict detection;
- stable processing issues for missing identity, practitioner, encounter, token, or source-evidence conditions;
- source-evidence drift detection;
- second-pass zero-new-business-row proof;
- migration-run summaries containing only aggregate counts.

Legacy `completed`, `concluded`, or `fulfilled` intent becomes canonical `fulfilled` only when one exact mapped encounter with the same patient exists. Otherwise the canonical intent remains `checked_in` and an `APPOINTMENT_FULFILMENT_ENCOUNTER_MISSING` issue is persisted.

## Persistent appointment reconciliation

`scripts/canonical/reconcile-appointment-authority.ts` persists a `canonical_reconciliation_runs` receipt for fifteen fail-closed checks:

1. legacy appointment source mapping cardinality;
2. legacy consultation source mapping cardinality;
3. active patient-link reference validity;
4. active practitioner reference validity;
5. appointment header versus latest status-event parity;
6. contiguous event sequence and version parity;
7. valid lifecycle transition history;
8. reschedule lineage validity;
9. active non-manual token duplicate groups;
10. active appointment-to-encounter link cardinality and target existence;
11. encounter-origin cardinality;
12. appointment and encounter patient consistency;
13. forbidden active fulfilment links on non-fulfilled appointments;
14. mapped canonical appointment target and tenant validity;
15. unresolved appointment processing issues.

A clean fixture persists a passing 15/15 aggregate receipt. Missing source mappings, lifecycle header corruption, and unresolved appointment issues persist a failed receipt with exact mismatch-check counts. Evidence hashing is deterministic across reruns and excludes row-level identity, schedule text, practitioner names, patient IDs, complaints, notes, billing values, and other PHI-sensitive source content.

## Governance result

The canonical registries now record:

- 46 classified business concepts;
- 17 implemented canonical concepts;
- 10 partial canonical concepts;
- 17 material canonical gaps;
- 2 externally governed concepts;
- 74 registered canonical tables;
- 186 governed source/canonical/legacy tables;
- 839 exact writer access pairs;
- 1,981 exact reader access pairs;
- 219 canonical-authority writer pairs;
- 131 migration/backfill writer pairs;
- 414 active legacy-authority writer pairs;
- 65 canonical-compatibility writer pairs;
- 484 canonical reader pairs;
- 210 compatibility reader pairs;
- 86 external reader pairs;
- 1,201 legacy reader pairs;
- 0 schema-governance issues;
- 0 business-authority issues;
- 0 writer/reader access-governance issues.

`appointment_intent` remains `partial_canonical` in `docs/database/canonical-authority-matrix.yaml`. The target schema, commands, provider, backfill, and reconciliation are locally implemented, but active legacy writers/readers, disabled provider state, production backfill, shadow observation, rollback evidence, reader promotion, and retirement authorization remain unresolved.

## Fresh verification

The completed checkpoint passed:

- CDB-113D focused implementation bundle: 9 files, 58 tests;
- complete canonical suite with a 15-second per-test verification timeout for subprocess-heavy evidence suites: 196 files, 1,385 tests;
- TypeScript: passed;
- canonical schema governance: 0 issues;
- canonical business-authority governance: 0 issues;
- canonical writer/reader access governance: 0 issues;
- migration manifest: 478 migrations;
- local-sync readiness: 0 ready and 8 blocked;
- legacy retirement readiness: 0 eligible and 65 blocked.

The readiness results are expected fail-closed safety states. They do not authorize synchronization activation, provider-flag activation, production cutover, migration or backfill execution, reader promotion, traffic changes, observation, rollback, or legacy retirement.

## Safety result

No production database, protected export, credential, secret, feature flag, route traffic, worker, scheduler, local server, or synchronization runtime was accessed or changed.

No migration or backfill was applied to production or staging. No appointment, consultation, marketplace booking, patient, practitioner, encounter, visit, queue, billing, payment, clinical record, notification, report, or legacy table was changed or retired. No branch was pushed and CDB was not integrated to `main`.

## Remaining appointment work

The appointment target model, command layer, provider, backfill, and reconciliation are implemented locally, but runtime adoption remains incomplete:

- eight legacy `appointments` writer paths still require reviewed command integration or explicit compatibility classification;
- three legacy `consultations` writer paths still require telemedicine-intent convergence;
- marketplace booking, patient portal, queue, doctor completion, billing finalization, reminders, reports, dashboards, exports, and scheduled consumers still read legacy authority;
- the appointment provider flag remains disabled;
- production backfill and reconciliation have not run;
- shadow parity observation has not run;
- rollback evidence and owner authorization are absent;
- legacy appointment and consultation writers/readers are not eligible for retirement.

These remain governed cutover work. They must not be mistaken for schema or command incompleteness, and they must not be silently folded into admission or bed authority.

## Continuation

The exact next program checkpoint is:

`CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE`

Before the next implementation slice, review the current local `main` delta because the CDB branch is behind `main`; merge only reviewed safe `main` changes into the clean CDB branch under the main-to-CDB-only rule. Then audit and implement canonical admission lifecycle, admission-to-encounter linkage, care-location/bed identity, interval-based bed stays, transfer/discharge commands, deterministic backfill, persistent reconciliation, and disabled providers without production mutation, feature activation, local-sync expansion, destructive retirement, push, or CDB-to-main integration.
