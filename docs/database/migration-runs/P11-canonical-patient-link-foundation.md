# P11 Canonical Patient Link Foundation

**Checkpoint:** `CDB-113B-PATIENT-LINK-FOUNDATION-VERIFIED`  
**Program:** HMS Canonical Data Architecture  
**Branch:** `program/cdb-main-continuous-20260725`  
**Implementation commit:** `4166cd67d`  
**Execution mode:** local repository implementation and offline verification only  
**Production mutation performed:** no  
**Legacy writes retired:** no  
**Local-server synchronization activated:** no  
**Push or CDB-to-main integration performed:** no

## Objective

CDB-113B establishes an explicit, tenant-scoped relationship between a tenant patient record and the governed global/MPI patient identity without introducing a second patient-demographics authority.

The relationship authority is:

- `canonical_tenant_patient_links` for current relationship state;
- `canonical_tenant_patient_link_events` for immutable relationship history;
- `patients` remains tenant operational patient data during migration;
- `global_patient_identity` remains the external-governed global/MPI person identity.

## Implemented artifacts

### Additive schema

- `migrations/0544_canonical_tenant_patient_links.sql`
- `src/db/schema/canonical/patient-identity.ts`
- `src/db/schema/canonical/index.ts`

The schema enforces:

- text tenant ownership;
- stable public IDs;
- one current link per tenant patient;
- checked lifecycle and verification levels;
- verified links requiring a non-empty global UHID and reviewed exact evidence;
- tenant/global verified-link uniqueness;
- SHA-256 evidence constraints;
- optimistic version progression;
- immutable event sequence and idempotency uniqueness;
- tenant-scoped restrictive event-to-link foreign keys;
- explicit merge/unmerge source and target evidence;
- no copied name, phone, email, address, date of birth, gender, national ID, guardian, or other demographics.

### Atomic command

- `src/lib/canonical/commands/register-or-link-patient.ts`

The command supports registration, candidate detection, exact verified linking, unlink, merge, unmerge, reject, and retirement transitions. It provides:

- deterministic patient-link and event public IDs when callers omit them;
- exact request fingerprint and replay/conflict semantics;
- expected-version guards;
- current-state update and immutable event in one reviewed batch;
- source mapping;
- stable processing issue for ambiguous candidate evidence;
- PHI-minimised outbox payload;
- rollback of all facts when any required statement fails.

Phone, name, address, approximate age, guardian, and time proximity are never accepted as automatic verified-link evidence.

### Resumable backfill

- `scripts/canonical/backfill-tenant-patient-links.ts`

The backfill provides:

- tenant-scoped deterministic source IDs;
- exact unique-UHID automatic verification only;
- candidate issues for duplicate or unresolved UHID evidence;
- no automatic link from phone, name, address, national ID, or mutable demographic similarity in the implemented path;
- bounded `chunkSize` and `afterLegacyPatientId` cursor execution;
- durable paused/completed checkpoints;
- migration-run, source-mapping, event, evidence-hash, and issue receipts;
- second-pass zero-new-row proof;
- source-patient preservation.

### Persistent reconciliation

- `scripts/canonical/reconcile-tenant-patient-links.ts`

Each reconciliation persists a `canonical_reconciliation_runs` receipt for seven fail-closed checks:

1. tenant patient count matches link count;
2. no duplicate current tenant-patient links;
3. every verified relationship resolves to exactly one active global UHID;
4. no forbidden evidence type is used by a verified link;
5. latest immutable event status, identity, and sequence match current state/version;
6. merge/unmerge source and target evidence is valid;
7. no cross-tenant event/link mismatch exists.

A tampered current row produces a failed reconciliation receipt rather than silent acceptance.

## TDD evidence

### RED

The first focused run failed for the intended reasons:

- migration `0544_canonical_tenant_patient_links.sql` did not exist;
- canonical patient-link schema did not exist;
- `register-or-link-patient` did not exist;
- tenant-patient backfill did not exist.

The RED run reported 3 failed files, including missing modules and five missing-schema assertions.

### GREEN

The final focused patient-link bundle passed:

```text
Test Files  3 passed (3)
Tests       18 passed (18)
```

Coverage includes:

- five schema/constraint tests;
- eight command/lifecycle/idempotency/version/rollback tests;
- five backfill/chunking/second-pass/reconciliation tests.

## Governance result

The canonical registries now record:

- 46 classified business concepts;
- 17 implemented canonical concepts;
- 9 partial canonical concepts;
- 18 canonical gaps;
- 2 externally governed concepts;
- 71 registered canonical tables;
- 183 governed source/canonical/legacy tables;
- 821 exact writer access pairs;
- 1,917 exact reader access pairs;
- 414 active legacy-authority writer pairs;
- 1,201 legacy reader pairs;
- 0 schema-governance issues;
- 0 business-authority issues;
- 0 writer/reader access-governance issues.

The authority matrix keeps global patient identity externally governed and assigns only the relationship fact to the new `tenant_patient_linkage` canonical concept.

## Fresh verification

The completed checkpoint passed:

- focused patient-link suite: 3 files, 18 tests;
- patient-link/governance/continuity bundle: 7 files, 43 tests;
- complete canonical suite: 185 files, 1,325 tests;
- TypeScript: passed;
- canonical schema governance: 0 issues;
- canonical business-authority governance: 0 issues;
- canonical writer/reader access governance: 0 issues;
- migration manifest: 476 migrations;
- local-sync readiness: 0 ready and 8 blocked;
- legacy retirement readiness: 0 eligible and 65 blocked.

The readiness results are expected fail-closed safety states. They do not authorise synchronization activation, runtime cutover, production mutation, or legacy retirement.

## Safety result

No production database, protected export, credential, secret, route flag, traffic allocation, worker, scheduler, local server, or synchronization runtime was accessed or changed.

No migration or backfill was applied to production or staging. No legacy patient, MPI, practitioner, appointment, encounter, billing, or clinical record was changed or retired. No branch was pushed and CDB was not integrated to `main`.

## Continuation

The exact next checkpoint is:

`CDB-113C-PRACTITIONER-OPERATIONAL-ADOPTION`

Begin by classifying exact practitioner writers and readers for `doctors`, `doctor_auth`, `external_referring_doctors`, `users`, staff links, and canonical practitioner tables. Then add RED operational command/provider tests, consolidate practitioner mutation boundaries and selected disabled provider adapters, harden backfill/reconciliation, update all governance and continuity documents, and leave another clean verified checkpoint without production mutation, local-sync expansion, or legacy retirement.
