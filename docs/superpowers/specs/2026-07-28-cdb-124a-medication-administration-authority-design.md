# CDB-124A Medication Administration and Reconciliation Authority Design

**Status:** design locked; implementation not started

**Date:** 2026-07-28

## 1. Authority decision

The Canonical design separates medication administration facts from medication reconciliation workflow.

Target table families:

1. `canonical_medication_administration_events`
2. `canonical_medication_reconciliations`
3. `canonical_medication_reconciliation_versions`
4. `canonical_medication_reconciliation_items`
5. `canonical_medication_reconciliation_status_events`

Scheduled dose opportunities are workflow projections, not administration facts. One administration event records one actual administration or non-administration outcome. Administration events are append-only. Correction creates a replacement event. Entered-in-error creates immutable error evidence. Hard delete is forbidden.

Medication reconciliation never becomes administration evidence. Completion does not silently create medication orders or prescriptions. Any resulting medication intent must be created by an explicit Canonical prescription or medication-order command with its own idempotency and source mapping.

## 2. Medication administration event authority

`canonical_medication_administration_events` owns one immutable event chain.

Required fields:

- `tenant_id`
- `administration_event_public_id`
- `event_kind`
- `medication_order_public_id`
- `medication_order_status_version`
- `patient_link_public_id`
- `encounter_public_id`
- `administering_practitioner_public_id`
- optional actor user/system identity
- optional `scheduled_at_utc`
- `occurred_at_utc`
- `recorded_at_utc`
- `outcome_code`
- optional `administered_dose_value_decimal`
- optional `administered_dose_unit_code`
- optional `route_code`
- optional `site_code`
- optional `method_code`
- optional `reason_code`
- optional exact dispense, lot, barcode, or device source identity
- optional `supersedes_administration_event_public_id`
- idempotency key
- request fingerprint SHA-256
- source evidence SHA-256
- immutable creation timestamp

### Event kinds

- `administration`
- `correction`
- `entered_in_error`

An `administration` event represents one attempted scheduled or PRN dose action. A `correction` event replaces one earlier event without editing it. An `entered_in_error` event preserves that the referenced event should no longer be treated as valid clinical evidence.

Each original event may have at most one active replacement. Chains cannot contain cycles and cannot cross tenant, patient, encounter, or medication-order scope.

## 3. Exact scope and identity

Every administration event requires:

- one exact active Canonical medication order;
- the order's current or explicitly accepted `medication_order_status_version` snapshot;
- the same Canonical patient link and encounter owned by that medication order;
- one active administering Canonical practitioner;
- an application user or governed system actor;
- exact source identity for legacy/runtime evidence.

Medicine name, patient/time proximity, schedule similarity, and numeric coincidence are not identity proof. Free-text medication, generic name, strength, dose, route, or frequency never establish a medication-order link.

A source row without exact Canonical medication-order mapping produces a deterministic processing issue and does not create an administration event.

## 4. Administration outcomes

Allowed `outcome_code` values:

- `given`
- `partially_given`
- `withheld`
- `refused`
- `omitted`
- `not_available`
- `cancelled`

Given and partially_given require exact administered dose and route. The dose uses canonical decimal text plus a reviewed unit code; binary floating-point storage is not authoritative.

Non-administration outcomes require a reason code. Free-text remarks may be retained in protected clinical content, but aggregate reconciliation, outbox, readiness, and logs remain PHI-minimised.

`late` is not an outcome authority. It is derived by comparing `scheduled_at_utc` and `occurred_at_utc` against an explicit tolerance policy. `hold` is medication-order workflow state; an individual scheduled opportunity not administered because of a hold is recorded as `withheld` with exact reason evidence.

## 5. Time semantics

- `scheduled_at_utc` is the intended dose opportunity time and may be null for PRN administration.
- `occurred_at_utc` is when the administration or non-administration action occurred.
- `recorded_at_utc` is when the evidence entered the system.
- all timestamps are normalized UTC;
- `recorded_at_utc` cannot precede `occurred_at_utc` without an explicit late-entry reason;
- future schedule rows without an actual outcome are projections and do not migrate as administration events.

## 6. Dose, route, site, and provenance

`administered_dose_value_decimal` and `administered_dose_unit_code` are paired. Reviewed units may include tablet/capsule counts, mass, volume, international units, and other governed medication units.

The actual route is required for `given` and `partially_given`; it may differ from the ordered route only with an explicit variance reason. Site and method are optional typed codes when clinically applicable.

Barcode, dispense, inventory lot, or device evidence is optional but, when present, must use exact paired source type/public ID fields. Barcode success alone does not prove patient, medication, dose, route, or order identity.

## 7. Immutable correction and entered-in-error chain

Original administration rows never update.

A correction:

1. validates the original event and exact scope;
2. creates a replacement event with corrected evidence;
3. sets `supersedes_administration_event_public_id`;
4. preserves both source mappings and outbox receipts;
5. prevents a second active replacement.

An entered-in-error action creates an immutable `entered_in_error` event referencing the target. It does not delete the target. Reports derive current validity from the append-only event chain.

## 8. Medication reconciliation authority

Medication reconciliation is a versioned signed workflow separated from administration.

### `canonical_medication_reconciliations`

The header owns:

- tenant, patient link, and encounter;
- reconciliation type: `admission`, `transfer`, or `discharge`;
- current version pointer;
- current status and status version;
- creating practitioner/actor;
- idempotency and source evidence.

### `canonical_medication_reconciliation_versions`

Each version stores an immutable snapshot:

- version public ID and number;
- draft/final/cancelled state;
- source summary hash;
- signed content hash;
- author and optional finalizing practitioner;
- created/finalized timestamps;
- optional superseded version link.

A draft is never mutated in place. Replacing a draft creates a new version.

### `canonical_medication_reconciliation_items`

Items belong to one exact reconciliation version and contain:

- item sequence;
- source kind: `home`, `inpatient`, `new`, or `unknown`;
- decision: `continue`, `modify`, `discontinue`, or `add`;
- optional exact Canonical prescription/order reference;
- medication description snapshot for audit;
- prior and proposed dose/route/frequency snapshots;
- reason code and evidence hash.

Free-text medication cannot automatically resolve to a prescription or medication order.

### `canonical_medication_reconciliation_status_events`

Immutable lifecycle events cover draft creation, draft replacement, finalization, cancellation, and entered-in-error decisions.

Finalization requires an active practitioner, exact patient/encounter scope, at least one version, deterministic item sequence, content hash, and matching final status event.

Discharge checklist updates remain projections/workflow effects. They must be included in an explicitly atomic compatibility batch when future runtime cutover occurs.

## 9. Command boundary

Planned commands:

1. `recordCanonicalMedicationAdministrationEvent`
2. `correctCanonicalMedicationAdministrationEvent`
3. `enterCanonicalMedicationAdministrationInError`
4. `createCanonicalMedicationReconciliationDraft`
5. `replaceCanonicalMedicationReconciliationDraft`
6. `finalizeCanonicalMedicationReconciliation`
7. `cancelCanonicalMedicationReconciliation`

Every command must provide deterministic IDs, tenant-scoped idempotency, replay before state validation, exact source mapping, optimistic reconciliation status versioning, atomic compatibility/Canonical/outbox statements, PHI-minimised payloads, and full rollback.

## 10. Backfill design

CDB-124D uses eight persistent bounded-backfill partitions:

1. order-linked MAR administration outcomes;
2. order-linked MAR non-administration outcomes;
3. MAR rows without exact Canonical medication-order mapping;
4. schedule-only MAR projection disposition;
5. reconciliation headers;
6. reconciliation items and version reconstruction;
7. reconciliation completion/cancellation lifecycle;
8. prescription/order/discharge effect and duplicate/correction disposition.

Source tables remain read-only. Each row is mapped, skipped as already mapped, classified as projection, or recorded as a deterministic non-PHI issue.

## 11. Reconciliation design

The fixed twenty-two-check reconciliation covers:

1. source mapping ownership;
2. medication-order ownership;
3. medication-order status-version validity;
4. patient-link scope;
5. encounter/patient scope;
6. administering practitioner scope;
7. actor evidence;
8. event-kind validity;
9. outcome validity;
10. dose/unit pairing;
11. given/partial dose and route completeness;
12. non-administration reason completeness;
13. scheduled/occurred/recorded time ordering;
14. replacement-chain ownership and acyclicity;
15. single active replacement;
16. reconciliation header/current-version ownership;
17. reconciliation version sequence and immutability;
18. item sequence and decision validity;
19. final signature/content-hash parity;
20. unresolved critical issues;
21. source fingerprint, foreign-key, and integrity evidence;
22. second-pass idempotency and zero new business rows.

## 12. Provider and cutover rules

Provider flag: `canonical_medication_administration_provider_v1`.

Safety defaults:

- `enabledByDefault: false`
- `defaultMode: legacy`
- `rollbackMode: legacy`
- supported modes: `legacy`, `shadow`, `canonical`

Shadow mode returns legacy-facing administration/reconciliation projections while producing aggregate PHI-minimised parity evidence. Canonical mode requires exact source mappings and fails closed.

No runtime route is switched during design or schema work.

## 13. Production gates

Production activation remains an external gate.

Legacy retirement remains an external gate.

Local tests do not authorize production migration/backfill, provider activation, route cutover, observation, rollback, deployment, or retirement.
