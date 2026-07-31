# CDB-V1-030E appointment intent route integration audit

**Date:** 2026-07-29  
**Checkpoint:** `CDB-V1-030E-APPOINTMENT-INTENT-ROUTE-INTEGRATION-VERIFIED`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Scope:** local protected-core implementation and repository evidence only

## Result

The four remaining protected appointment-intent writers now have reviewed atomic boundaries:

- `src/routes/tenant/doctors.ts` / `appointments` — doctor dashboard status, immutable reassignment, signed consultation fulfilment and report-review fulfilment;
- `src/routes/tenant/queue.ts` / `appointments` — visit conclusion, queue completion and no-show synchronization;
- `src/routes/tenant/doctorSchedules.ts` / `doctor_schedules` — practitioner-linked schedule domain extension; and
- `src/lib/canonical/appointment-billing-finalization.ts` / `appointments` — strict financial billing projection, not appointment planning authority.

The existing HTTP status codes, response envelopes, doctor ownership checks, queue response fields, schedule role guards and appointment billing response contracts remain unchanged.

## Exact appointment identity and lifecycle

Migration `0565_appointment_route_identity.sql` adds nullable tenant-scoped `appointments.canonical_source_key`. Existing rows are not rewritten. Runtime mutations use exact `(tenant_id, legacy appointment id or adopted source key)` identity and the frozen appointment command boundary.

- Patient identity requires one exact active tenant-patient link.
- Doctor identity requires one exact active Canonical practitioner mapping.
- Completion requires one exact active encounter mapping from the linked visit or appointment; timestamp proximity, names and numeric coincidence are not accepted.
- Unmapped legacy appointments may be bootstrapped only through the reviewed route-bootstrap actor.
- A fulfilled bootstrap requires exact encounter evidence and creates one active appointment-encounter link.
- Doctor reassignment creates immutable reschedule lineage and a new source identity instead of rewriting Canonical appointment history.
- Exact retries replay even when transport event time changes; changed semantic evidence under the same operation key fails with `CanonicalIdempotencyConflictError`.

## Queue and doctor atomicity

Doctor and queue appointment mutations commit one D1 batch containing the reviewed legacy appointment/visit/queue compatibility statements, master-data audit, Canonical appointment/status/link facts, exact source mapping, idempotency receipt and PHI-minimised outbox event.

Queue completion and visit conclusion fail closed when one exact encounter mapping is unavailable. Queue no-show uses the frozen status transition command. Non-appointment queue status changes remain one local D1 batch and do not manufacture appointment authority.

Signed consultation completion and report-review completion use explicit encounter mappings. No silent episode matching or post-commit appointment synchronization remains in the promoted paths.

## Schedule domain extension

Migration `0566_appointment_schedule_route_identity.sql` adds nullable tenant-scoped `doctor_schedules.canonical_source_key`. The schedule route is explicitly a `domain_extension`; it does not become a second appointment intent authority.

Create, update and retirement require an exact active practitioner mapping and commit the legacy schedule row, audit statement, versioned source mapping, command receipt and outbox event atomically. Retired schedule mappings cannot be reopened or retired again under a new operation key. Existing schedule HTTP responses and role guards are preserved.

## Billing projection boundary

`prepareAppointmentBillingStrictStatements` remains governed by `appointment.billing.finalize`. Its appointment update changes only billing projection fields and is guarded by expected billing status plus strict financial batch assertions. It is registered as `appointment-intent.billing-projection`; it does not create or rewrite appointment planning, practitioner, timing, queue or encounter authority.

## Deterministic governance result

After access, identity/episode coverage, protected inventory and writer coverage regeneration:

- governed tables: 260;
- repository writers: 1,007;
- repository readers: 2,593;
- identity/episode eligible readers: 822 across 286 paths and 63 tables;
- protected surfaces: 886;
- protected routes: 44;
- protected UI flows: 28;
- protected writers: 219;
- protected readers: 472;
- protected tables: 83;
- Canonical-command writers: 108;
- atomic-compatibility writers: 49;
- governed-external writers: 3;
- command-required writers: 55;
- isolated fixtures: 4;
- remaining implementation groups: 12;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

The four writers are registered under strict boundaries `appointment-intent.doctor-dashboard`, `appointment-intent.queue-sync`, `appointment-intent.doctor-schedule-extension` and `appointment-intent.billing-projection`. Promotion is fail-closed unless route/module, frozen commands, migrations and replay/rollback evidence all remain present.

## Verification

Fresh local verification:

- appointment, queue, schedule, billing and doctor focused suite: 12 files, 196 tests, 0 failures;
- appointment command and adapter contracts: 18 tests, 0 failures;
- queue focused contracts: 89 tests, 0 failures;
- schedule SQLite route contract: 3 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 500 conforming migrations;
- full `pnpm canonical:check`: passed with zero governance issues;
- protected inventory: 886 surfaces, 219 writers, 472 readers, zero unknown assignments;
- protected writer coverage: 55 command-required, 49 atomic-compatibility, zero unclassified.

## Safety state

- production query performed: no;
- production mutation performed: no;
- production migration/backfill applied: no;
- provider or feature flag enabled: no;
- route or traffic cutover: no;
- deployment: no;
- local sync activation: no;
- legacy retirement or deletion: no;
- push: no;
- CDB-to-main integration: no.

## Exact next bounded slice

`CDB-V1-030F-ENCOUNTER-CARE-EPISODE-ROUTE-INTEGRATION`

Integrate the four remaining `encounter_care_episode` writers in `doctors.ts`, `queue.ts` and `visits.ts` with the frozen encounter commands. Preserve doctor, queue and visit HTTP/UI behaviour; require exact patient, practitioner, appointment and encounter mappings; commit compatibility, Canonical encounter/participant/status evidence, mapping, idempotency, audit and outbox atomically; prove replay, stale/concurrent transition rejection, tenant isolation and complete rollback; then regenerate governance artifacts.
