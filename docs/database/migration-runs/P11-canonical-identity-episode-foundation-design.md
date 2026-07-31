# P11 Canonical Identity and Episode Foundation Design

**Checkpoint:** `CDB-113A-IDENTITY-EPISODE-FOUNDATION-DESIGN-VERIFIED`  
**Program:** HMS Canonical Data Architecture  
**Branch:** `program/cdb-main-continuous-20260725`  
**Design and plan commit:** `13d555967`  
**Execution mode:** repository design and local contract verification only  
**Production mutation performed: no**  
**Legacy writes retired: no**  
**Local-server synchronization activated: no**  
**Push or CDB-to-main integration performed: no**

## Objective

CDB-113A defines the dependency foundation required before prescriptions, diagnostics, clinical records, nursing, emergency, operation theatre, insurance, billing attribution, and reporting can converge safely.

The reviewed documents are:

- `docs/superpowers/specs/2026-07-26-cdb-113a-identity-episode-foundation-design.md`
- `docs/superpowers/plans/2026-07-26-cdb-113a-identity-episode-foundation.md`
- `test/canonical/identity-episode-foundation-design-contract.test.ts`

The design is grounded in the full-HMS authority matrix and the exact writer/reader access registry.

## TDD evidence

### RED

The documentation contract was created before the design and plan. The focused run failed because both files were missing:

```text
pnpm vitest run test/canonical/identity-episode-foundation-design-contract.test.ts
5 tests failed
ENOENT: design document missing
```

### GREEN

After the design and serial implementation plan were written:

```text
pnpm vitest run test/canonical/identity-episode-foundation-design-contract.test.ts
1 file passed
5 tests passed
```

The contract proves that the plan:

- separates appointment intent from actual encounter care;
- reuses existing practitioner authority;
- governs tenant/global patient links without another demographics authority;
- defines appointment, admission, location, bed, and occupancy authority;
- prohibits name-only/phone-only identity matching and time-proximity episode merging;
- defines atomic commands, idempotency, source mapping, outbox, provider comparison, reconciliation, rollback, and retirement;
- preserves additive/local-only implementation and all safety boundaries;
- provides serial checkpoints CDB-113B through CDB-113F.

## Core architectural decisions

### Patient identity

- `patients` remains tenant operational patient data during migration.
- `global_patient_identity` remains an external-governed global/MPI authority.
- `canonical_tenant_patient_links` owns the current relationship.
- `canonical_tenant_patient_link_events` owns immutable link, verify, reject, merge, unmerge, and retirement history.
- Patient demographics are not copied into a new canonical table.
- Phone, name, approximate age, address, guardian, or proximity cannot authorise an automatic verified link.

### Practitioner identity

- Existing canonical practitioner tables remain authority.
- Users, employees, doctor profiles, authentication records, and external referrers remain separate facts linked explicitly.
- Operational commands/providers will migrate writers/readers without another practitioner model.

### Appointment and encounter

- Appointment is planned intent; encounter is actual care.
- New tables: `canonical_appointments`, `canonical_appointment_status_events`, and `canonical_appointment_encounter_links`.
- Canonical encounter remains actual-care authority and gains patient-link/version hardening.
- Time proximity alone never merges care episodes.

### Admission and bed

- New canonical admission header and immutable status events own inpatient lifecycle.
- New canonical care-location and bed resource tables own physical resource identity.
- Canonical bed stays own occupancy intervals.
- Bed occupancy is derived from open stays; pricing and billing remain separate service/finance facts.

## Atomic command boundaries

The design defines:

- `register-or-link-patient`;
- `create-or-reschedule-appointment`;
- `check-in-and-start-encounter`;
- `admit-patient-and-claim-bed`;
- `transfer-bed`;
- `discharge-or-cancel-admission`.

Each command owns required current state, immutable events, source mappings, idempotency, outbox/audit evidence, version guards, and temporary compatibility statements in one reviewed D1 batch.

## Serial implementation program

1. `CDB-113B-PATIENT-LINK-FOUNDATION`
2. `CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION`
3. `CDB-113D-APPOINTMENT-AUTHORITY`
4. `CDB-113E-ENCOUNTER-ADMISSION-BED-CONVERGENCE`
5. `CDB-113F-IDENTITY-EPISODE-READ-PROMOTION`

Every implementation checkpoint updates the authority/source/access registries, tracker, control center, handoff, receipt, tests, verification counts, blockers, and exact next action.

## Reconciliation and cutover requirements

The plan requires:

- one current link per tenant patient;
- verified links resolving to exactly one global UHID;
- event/header parity;
- explicit practitioner links;
- one canonical appointment per mapped source;
- one fulfilment encounter per fulfilled appointment;
- identity agreement across appointment/encounter/admission;
- one active admission per inpatient encounter;
- one open bed stay per bed and admission;
- no overlapping occupancy intervals;
- second-pass zero-new-row proof;
- zero unexplained variance before provider promotion;
- explicit shadow, rollback, observation, and retirement evidence.

## Fresh verification

The completed design checkpoint passed:

- focused design contract: 1 file, 5 tests;
- focused design/continuity bundle: 3 files, 14 tests;
- complete canonical suite: 182 files, 1,307 tests;
- TypeScript: passed;
- canonical schema governance: 0 issues;
- canonical business-authority governance: 0 issues;
- canonical writer/reader access governance: 0 issues;
- migration manifest: 475 migrations;
- local-sync readiness: 0 ready and 8 blocked;
- legacy retirement readiness: 0 eligible and 65 blocked.

The local-sync and retirement results are the expected fail-closed states. They do not indicate an implementation failure and do not authorise activation or retirement.

## Safety result

No migration, schema, command, route, provider, feature flag, production row, protected export, credential, secret, worker, traffic allocation, or local-sync runtime was changed by this design checkpoint.

No existing patient, practitioner, appointment, encounter, admission, bed, billing, or clinical data was modified. No legacy table or writer was retired.

## Continuation

The exact next checkpoint is:

`CDB-113B-PATIENT-LINK-FOUNDATION`

Begin with RED schema/lifecycle/backfill tests, then add an additive patient-link migration and canonical schema, implement the atomic patient-link command, implement deterministic backfill/reconciliation, update all governance registries, and leave a clean verified checkpoint.
