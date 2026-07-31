# CDB-121A Prescription and Medication-Intent Canonical Authority Design

**Date:** 2026-07-27
**Checkpoint:** `CDB-121A-PRESCRIPTION-MEDICATION-INTENT-AUTHORITY-DESIGN`
**Program:** HMS Canonical Data Architecture
**Production boundary:** local design and implementation only; no production mutation

## 1. Goal

Create one encounter-linked canonical authority for doctor-issued prescriptions and clinical medication orders while preserving immutable versions, explicit prescriber identity, safety decisions, and lifecycle history. Keep medication administration, medication reconciliation, fulfilment, dispensing, stock, billing, and payment as separate typed facts.

## 2. Scope decomposition

Task 2.4 of the full canonical roadmap contains several independent clinical authorities. It is decomposed as follows:

1. prescription and medication-order intent;
2. observation/vital authority;
3. signed clinical documents, diagnoses, allergies, problems, forms, assessments, and addenda;
4. medication administration/MAR;
5. medication reconciliation.

CDB-121 implements only item 1. Later checkpoints consume its stable patient, encounter, practitioner, prescription, and medication-order public IDs.

## 3. Rejected approaches

### 3.1 Promote `prescriptions` in place

Rejected. The legacy table mixes clinical document, vital snapshots, diagnosis/advice text, sharing, delivery compatibility, dispense projection, appointment/admission references, and locking. Adding a canonical encounter ID alone would not separate authority or provide typed immutable versions and lifecycle events.

### 3.2 Promote `cln_medication_orders` as the only authority

Rejected. It is an inpatient/CPOE current-state table keyed to legacy patient/visit/user IDs. It does not represent a signed prescription document or immutable prescription version and cannot safely absorb outpatient prescription history.

### 3.3 Treat fulfilment `medication_orders` as clinical orders

Rejected. That table owns provider, sale, payment, and delivery workflow. A patient may never purchase or may use another pharmacy; fulfilment cannot determine clinical intent.

### 3.4 Parse free-text prescriptions into structured orders

Rejected. Medicine names, consultation text, and `prescriptions.lab_tests` are not deterministic identity or order evidence. Unstructured historical content remains preserved text and may be reviewed manually later.

## 4. Target aggregate

### 4.1 `canonical_prescriptions`

Current aggregate state for a clinical prescription document.

Required fields:

- `tenant_id`;
- `prescription_public_id`;
- `patient_link_public_id`;
- `encounter_public_id`;
- `prescribing_practitioner_public_id`;
- `current_version_public_id` when a version exists;
- `current_status`;
- `status_version`;
- `authored_at_utc`;
- `finalized_at_utc` when final;
- `cancelled_at_utc` when cancelled;
- `idempotency_key`;
- `request_fingerprint_sha256`;
- `source_evidence_sha256`;
- UTC audit timestamps.

Status vocabulary:

- `draft`;
- `final`;
- `amended`;
- `cancelled`;
- `entered_in_error`.

The table does not own diagnosis, vital, delivery, dispense, billing, payment, or stock truth.

### 4.2 `canonical_prescription_versions`

Immutable prescription document versions.

Required fields:

- `version_public_id`;
- parent `prescription_public_id`;
- `version_number`;
- optional `supersedes_version_public_id`;
- `version_status` (`draft`, `final`, `amendment`, `retracted`, `entered_in_error`);
- `content_sha256`;
- optional `signed_snapshot_sha256`;
- authoring/finalisation timestamps;
- authoring and signing practitioner public IDs;
- actor user/system identity;
- source evidence hash.

The canonical program stores only hashes in outbox/reconciliation evidence. Clinical content may remain in the protected source document during compatibility and can later move to a dedicated encrypted clinical-document payload store without changing the public identity contract.

### 4.3 `canonical_medication_orders`

Current clinical medication intent, one row per medication line/order.

Required fields:

- `medication_order_public_id`;
- patient, encounter, and prescribing practitioner public IDs;
- optional prescription/version public IDs;
- optional canonical/formulary medication code and source system;
- display snapshot fields needed for clinical rendering;
- dose, route, frequency, duration, instructions, priority;
- start/end timestamps;
- `current_status`;
- `status_version`;
- source/idempotency/evidence fields;
- UTC audit timestamps.

Status vocabulary:

- `draft`;
- `active`;
- `on_hold`;
- `completed`;
- `stopped`;
- `cancelled`;
- `entered_in_error`.

Display snapshots are not medication master identity. Future formulary convergence may attach a canonical medication item without rewriting historical display text.

### 4.4 `canonical_medication_order_status_events`

Immutable lifecycle events with:

- event public ID;
- medication-order public ID;
- from/to status;
- event version;
- reason code;
- occurred timestamp;
- actor identity;
- evidence hash.

Every current-state transition must co-commit exactly one event.

### 4.5 `canonical_prescription_safety_events`

Immutable safety evaluation/override evidence.

Required fields:

- event public ID;
- prescription and optional version/order public IDs;
- event type (`allergy_check`, `interaction_check`, `duplicate_therapy_check`, `dose_check`, `override`, `waiver`, `other`);
- outcome (`passed`, `warning`, `blocked`, `overridden`, `not_applicable`);
- severity;
- reason/evidence code;
- actor practitioner/user/system identity;
- occurred timestamp;
- source evidence hash.

It stores no unrestricted allergy, diagnosis, or medication narrative in aggregate evidence.

## 5. Referential rules

- Every prescription and medication order belongs to one tenant.
- Every prescription and medication order references one exact canonical tenant-patient link.
- Every prescription and medication order references one exact canonical encounter.
- Every prescription and medication order references one exact canonical prescribing practitioner.
- A linked medication order must match its prescription/version tenant, patient, encounter, and prescriber.
- A prescription current-version pointer must reference its own prescription.
- A final prescription must point to a final or amendment version.
- Version numbers are unique per prescription.
- Status-event versions are unique and strictly positive per medication order.
- No cascade delete may remove signed/final clinical history.

## 6. Command boundaries

### 6.1 Create draft prescription

`createCanonicalPrescriptionDraft`:

- validates patient, encounter, and practitioner authority;
- creates deterministic public IDs;
- creates prescription, draft version, medication orders, source mappings, PHI-minimised outbox, and batch assertions atomically;
- supports exact idempotent replay and rejects conflicting replay.

### 6.2 Replace draft content

`replaceCanonicalPrescriptionDraft`:

- requires expected status version;
- never edits a final version;
- creates a new draft version and replaces draft medication orders through explicit `entered_in_error`/replacement events rather than deleting signed history;
- updates current version/status atomically.

### 6.3 Finalise prescription

`finalizeCanonicalPrescription`:

- requires expected status version;
- verifies at least one medication order;
- records final content/signature hash;
- changes draft orders to active;
- creates immutable lifecycle events and outbox evidence atomically.

### 6.4 Amend prescription

`amendCanonicalPrescription`:

- creates a superseding amendment version;
- stops/replaces affected prior medication orders with explicit events;
- creates replacement orders;
- retains the original final version unchanged.

### 6.5 Transition standalone medication order

`transitionCanonicalMedicationOrder`:

- supports hold, resume, stop, complete, cancel, and entered-in-error under an explicit transition matrix;
- uses optimistic version and idempotency guards;
- cannot record administration.

### 6.6 Record safety event

`recordCanonicalPrescriptionSafetyEvent`:

- records an immutable evaluation/override event;
- override requires explicit reason and actor authority;
- does not mutate prescription content by itself.

## 7. Legacy compatibility

Initial runtime mode remains legacy by default.

Reviewed writer adapters may use:

- `legacy` — existing writes only;
- `shadow` — existing writes remain authority; canonical write/evidence is attempted after or within reviewed atomic boundaries without changing the legacy response;
- `canonical` — future authorised mode after backfill, reconciliation, observation, rollback, and route promotion.

A missing, malformed, disabled, or unsupported provider flag resolves to legacy.

No legacy writer is removed by CDB-121.

## 8. Backfill design

### 8.1 Partitions

1. prescription headers and deterministic encounter/patient/practitioner mappings;
2. prescription versions;
3. prescription items as medication orders;
4. safety checks and overrides;
5. standalone `cln_medication_orders`;
6. reconciliation and zero-new-row second pass.

### 8.2 Deterministic IDs

Public IDs derive from tenant, source table, source row ID, and stable source evidence. IDs never derive from names or timestamps alone.

### 8.3 Encounter resolution

Resolution order:

1. exact completion-claim encounter;
2. exact active appointment-encounter link;
3. exact canonical admission encounter;
4. exact legacy visit/encounter source mapping for CPOE;
5. approved manual mapping.

Multiple conflicting candidates produce a stable issue.

### 8.4 Duplicate prevention

- `cln_medication_orders` is never merged with a prescription item from text similarity.
- It may link to a prescription order only through an explicit reviewed source identifier/mapping.
- fulfilment `medication_orders` and pharmacy-local prescriptions do not create clinical orders without explicit source mapping.

## 9. Reconciliation and readiness

The persistent reconciliation receipt contains fixed checks for source coverage, identity/episode linkage, version continuity, status/event parity, safety evidence, tenant safety, orphan references, duplicate authority, second-pass idempotency, source immutability, FK integrity, and database integrity.

Local read promotion may become ready only when:

- schema, commands, backfill, reconciliation, and provider tests pass;
- all selected readers have deterministic provider assignments;
- all feature flags remain disabled by default;
- no retirement gate is claimed.

Production readiness additionally requires a separate exact schema/backfill authorization, protected clone rehearsal, aggregate-only observation, rollback evidence, and owner-approved route/traffic change.

## 10. Security

- Tenant scope is mandatory on every query and mutation.
- Patient, encounter, practitioner, prescription, version, and order identities are exact public IDs.
- Outbox and reconciliation evidence contain hashes, counts, status codes, and IDs only.
- Medication names, dose text, instructions, diagnosis, advice, patient data, and signed content are excluded from logs and aggregate receipts.
- Final and amended versions are immutable.
- No hard delete exists for canonical prescription/order history.

## 11. Planned checkpoints

- `CDB-121A` — design and contract.
- `CDB-121B` — additive migration, Drizzle schema, source-of-truth and authority governance.
- `CDB-121C` — commands and atomic compatibility contracts.
- `CDB-121D` — bounded backfill and reconciliation.
- `CDB-121E` — disabled providers, consumer coverage, and local read-promotion readiness.

Normal checkpoint commits are not stop points. Execution continues serially while the next checkpoint is safe and local.

## 12. Explicit exclusions

CDB-121 does not:

- apply a production migration or backfill;
- change provider flags, routes, traffic, or deployment;
- implement medication administration/MAR authority; CDB-121 does not implement medication administration/MAR authority;
- implement medication reconciliation authority; CDB-121 does not implement medication reconciliation authority;
- canonicalise diagnosis, observations, vitals, or signed clinical documents;
- parse free text into structured medication identity;
- make fulfilment or pharmacy-local records clinical authority;
- retire legacy history;
- activate local sync;
- push or integrate CDB into `main`.
