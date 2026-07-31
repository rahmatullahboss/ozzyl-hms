# CDB-V1-030F encounter care episode route integration audit

**Date:** 2026-07-29  
**Checkpoint:** `CDB-V1-030F-ENCOUNTER-CARE-EPISODE-ROUTE-INTEGRATION-VERIFIED`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Scope:** local protected-core implementation and repository evidence only

## Result

The four remaining protected `encounter_care_episode` writer pairs now cross reviewed atomic command boundaries:

- `src/routes/tenant/doctors.ts` / `encounters` — signed consultation compatibility record plus Canonical encounter completion;
- `src/routes/tenant/doctors.ts` / `visits` — doctor consultation visit conclusion in the same composite appointment/encounter batch;
- `src/routes/tenant/queue.ts` / `visits` — queue visit conclude, cancel and token-completion synchronization; and
- `src/routes/tenant/visits.ts` / `visits` — direct visit create, doctor participant replacement and IPD discharge.

Existing route paths, validation, role/permission checks, successful response envelopes and queue/doctor/visit UI fields remain intact. Canonical completion and cancellation now fail closed when exact identity, version or dependent-request evidence is unavailable.

## Frozen encounter commands

`src/lib/canonical/commands/start-encounter.ts` now exposes the complete reviewed lifecycle:

- `startEncounter`;
- `cancelEncounter`;
- `completeEncounter`;
- `replaceEncounterParticipant`; and
- `prepareCompleteEncounterBatch` for composite command execution.

The protected authority contract was regenerated with `completeEncounter` and `replaceEncounterParticipant` under the existing encounter command module. No parallel encounter authority, provider or status vocabulary was introduced.

`src/lib/canonical/command-batch.ts` now exposes `prepareCanonicalBatch`. It produces the same tenant-scoped request fingerprint, outbox/idempotency claim and ordered business statements as `runCanonicalBatch`, but permits a reviewed outer D1 batch to combine encounter and appointment commands. Exact replay returns the prior result; changed semantic evidence under the same operation key fails with `CanonicalIdempotencyConflictError`.

## Exact route identity

Migration `0567_encounter_visit_route_identity.sql` adds nullable tenant-scoped `visits.canonical_source_key` and a partial unique index. Existing visit rows are not rewritten.

`src/lib/canonical/encounter-route-integration.ts` requires:

- one exact active tenant-patient link for the legacy patient;
- one exact active practitioner mapping when a doctor is present;
- one exact `legacy_visit` source mapping to a Canonical encounter;
- exact patient-link agreement between the visit and mapped encounter; and
- explicit agreement between appointment and visit encounter mappings before composite completion.

Names, labels, numeric coincidence and timestamp proximity do not create encounter identity.

## Direct visit lifecycle

Direct visit creation reserves one explicit legacy visit ID, retains the current visit number and optional consultation-fee behaviour, and commits the legacy visit, optional visit service, master-data audit, Canonical encounter, optional treating participant, exact source mapping, idempotency receipt and outbox in one D1 batch.

When an `Idempotency-Key` is supplied, an exact retry reuses the stored visit number, admission number, visit date and encounter start. It does not run the duplicate-visit guard again or allocate new sequences. Changed patient, doctor, visit type, admission or clinical evidence conflicts under the same key.

A doctor change replaces the active treating participant through an optimistic encounter version and immutable participant history. A legacy active visit without an encounter mapping may be lazily bootstrapped during update using exact patient/practitioner evidence in the same batch. IPD discharge requires an exact mapped in-progress encounter and commits visit discharge/status, audit, Canonical completion, participant closure, receipt and outbox atomically.

## Doctor and queue composite completion

Doctor signed consultation completion resolves the exact legacy visit, exact appointment and one shared Canonical encounter. The prepared encounter-completion claim and statements are inserted into the appointment fulfilment command batch. The batch contains:

- Canonical encounter completion and optional signed snapshot evidence;
- active participant closure;
- legacy signed encounter compatibility record;
- legacy visit and queue completion;
- legacy appointment completion;
- master-data audit;
- Canonical appointment fulfilment and encounter link;
- separate encounter and appointment idempotency/outbox envelopes.

The previous post-commit appointment audit was removed because the reviewed audit now commits inside the atomic batch.

Queue visit conclusion and token completion use the same composite pattern when an appointment is linked. A visit without an appointment completes the Canonical encounter directly with queue/visit compatibility statements. Queue cancellation uses `cancelEncounter` and preserves active-service-request protection. Queue no-show remains the frozen appointment status transition and does not manufacture encounter completion.

## Deterministic governance result

After authority contract, access, identity/episode coverage, protected inventory and writer coverage regeneration:

- governed tables: 260;
- repository writers: 1,008;
- repository readers: 2,597;
- identity/episode eligible readers: 825 across 287 paths and 63 tables;
- protected surfaces: 890;
- protected routes: 44;
- protected UI flows: 28;
- protected writers: 219;
- protected readers: 476;
- protected tables: 83;
- Canonical-command writers: 108;
- atomic-compatibility writers: 53;
- governed-external writers: 3;
- command-required writers: 51;
- isolated fixtures: 4;
- remaining implementation groups: 11;
- unknown writers/readers: 0;
- unclassified protected writers: 0.

The four writer pairs are registered under `encounter-care.doctor-signed-record`, `encounter-care.doctor-visit-completion`, `encounter-care.queue-visit-lifecycle` and `encounter-care.visit-route`. Promotion is fail-closed unless route, adapter, command, migration and replay/rollback evidence all remain present.

## Verification

Fresh local verification:

- encounter/appointment/visit/queue/doctor focused suite: 13 files, 201 tests, 0 failures;
- command batch, encounter command and route adapter contracts: 3 files, 20 tests, 0 failures;
- TypeScript: passed;
- migration manifest: 501 conforming migrations;
- full `pnpm canonical:check`: passed with zero governance issues;
- protected inventory: 890 surfaces, 219 writers, 476 readers, zero unknown assignments;
- protected writer coverage: 51 command-required, 53 atomic-compatibility, zero unclassified;
- dirty-worktree policy: passed.

The existing doctor photo-upload mock warnings remain expected non-failing test noise and are unrelated to this checkpoint.

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

`CDB-V1-030G-SERVICE-DELIVERY-EVENT-ROUTE-INTEGRATION`

Integrate the four remaining `service_delivery_event` writers in `billing-create-batch.ts`, `appointment-billing-finalization.ts`, `billingCancellation.ts` and `visits.ts` with the frozen service-event commands. Preserve billing and visit HTTP/UI behaviour; require exact service, request, encounter, practitioner and financial references; distinguish requested, delivered, billed, cancelled and reversed facts; commit compatibility, Canonical delivery/cancellation evidence, idempotency, audit and outbox atomically; prove replay, stale/concurrent rejection, tenant isolation, integer-money exactness where applicable and complete rollback; then regenerate governance artifacts.
