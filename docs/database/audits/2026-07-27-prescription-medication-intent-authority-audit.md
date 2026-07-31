# Prescription and Medication-Intent Canonical Authority Audit

**Checkpoint:** `CDB-121A-PRESCRIPTION-MEDICATION-INTENT-AUTHORITY-DESIGN`
**Date:** 2026-07-27
**Scope:** Repository-local architecture and implementation planning only
**Production mutation:** prohibited

## Executive finding

The HMS has durable prescription and medication-order functionality, but it does not yet have one encounter-linked canonical authority for medication intent.

Four materially different table families currently overlap:

1. `prescriptions` and `prescription_items` are the primary doctor-issued clinical record. They preserve finalisation, locking, version, safety, appointment/admission, reconciliation, and completion-claim provenance, but do not directly own a canonical encounter key.
2. `cln_medication_orders` is a second clinical/CPOE order authority used by nursing and MAR workflows. It stores active medication-order state but is keyed to legacy `visit_id` and user IDs rather than canonical encounter, patient-link, and practitioner identities.
3. `medication_orders` and `medication_order_items` are fulfilment/commercial workflow documents. They must remain linked to a prescription but must not become clinical prescribing authority.
4. `pharmacy_prescriptions` and `pharmacy_prescription_items` are pharmacy-local workflow records that can duplicate prescriber intent. They may remain compatibility/fulfilment projections only.

The canonical authority matrix therefore correctly classifies `prescription_medication_intent` as a canonical gap.

## Current source semantics

### `prescriptions`

- Clinical header and doctor-issued document.
- Tenant and patient scoped.
- Optional appointment, admission, completion-claim, and reconciliation provenance.
- Draft/final/locked semantics exist.
- Final records cannot be directly edited through the main route.
- `prescription_versions` stores historical snapshots.
- `prescription_overrides` and `prescription_safety_checks` preserve safety decisions.
- Free-text diagnosis, advice, lab requests, and vital fields coexist on the header; these are not all medication-order facts.

### `prescription_items`

- Structured medication lines.
- Optional formulary/medicine identity.
- Dose, frequency, duration, instructions, prescribed quantity, and dispensed quantity.
- Dispensing state is operational fulfilment; it is not clinical order validity.

### `cln_medication_orders`

- Inpatient/CPOE medication order state.
- Legacy patient, visit, formulary, medication, dose, route, frequency, priority, schedule, status, prescriber user, verifier user, and idempotency data.
- Used by nursing medication-order, clinical-summary, reconciliation, due-medication, and MAR routes.
- Administration records already link to these order rows, so migration must preserve an explicit compatibility mapping rather than renumbering or deleting history.

### `medication_orders`

- Optional hospital/patient-app fulfilment aggregate.
- Links to final prescriptions and pharmacy sales.
- Owns provider, payment, sale, delivery, and fulfilled quantity workflow.
- Must never be interpreted as a doctor-issued clinical order.

### `pharmacy_prescriptions`

- Pharmacy-local prescription and dispensing workflow.
- May contain prescription-like medication details but does not have sufficient evidence to replace clinical prescription truth.

## Writer inventory

Material medication-intent writers include:

- `src/routes/tenant/prescriptions.ts`;
- prescription creation/finalisation paths in `src/routes/tenant/doctors.ts`;
- `src/routes/tenant/orderSets.ts`;
- `src/routes/tenant/nursing/medication-orders.ts`;
- discharge and medication-reconciliation workflows;
- pharmacy-local prescription creation and dispensing routes.

Only exact, reviewed writers may enter canonical compatibility mode. No broad route family may be declared canonical from table-name similarity.

## Reader inventory

Material readers include:

- doctor and prescription routes;
- patient portal, global portal, hospital links, patient chart, patient timeline, FHIR, AI, and clinical-decision support;
- nursing clinical summary, medication due, MAR, and reconciliation;
- pharmacy fulfilment and dispensing;
- lab attribution and billing projections.

Provider promotion must distinguish clinical prescription document, medication intent, administration, reconciliation, and fulfilment reads.

## Identity and episode binding

A canonical prescription or medication order requires:

- exact tenant patient-link identity;
- exact canonical encounter identity;
- exact canonical prescribing practitioner identity;
- exact source mapping or reviewed compatibility evidence;
- an immutable source-evidence hash.

Accepted deterministic encounter evidence, in order:

1. completion claim with an exact encounter mapping;
2. active canonical appointment-to-encounter link;
3. canonical admission-to-encounter link;
4. exact legacy visit/encounter source mapping for CPOE orders;
5. reviewed manual mapping.

Names, phone numbers, medicine text, doctor numeric-ID coincidence, patient numeric-ID coincidence across tenants, and timestamp proximity are prohibited as identity or episode evidence.

## Version and immutability requirements

- Draft content may change under optimistic version and idempotency guards.
- Final prescription content is immutable.
- Finalisation creates an immutable canonical prescription version and activates its medication orders.
- Correction creates an amendment/superseding version; it does not update the signed version in place.
- Cancellation, stop, hold, resume, completion, and entered-in-error are explicit events.
- Safety override decisions remain immutable and reference the exact prescription version/order scope.
- Fulfilment or administration never changes the signed prescription content.

## Authority boundaries

The target authority must keep these facts distinct:

- prescription document;
- prescription document version;
- medication order/current intent;
- medication-order lifecycle event;
- safety decision;
- medication administration;
- medication reconciliation;
- fulfilment/dispense/sale;
- stock movement and invoice/payment facts.

The first implementation slice covers prescription document, version, medication intent, lifecycle, and safety-decision authority. MAR, administration, and reconciliation remain dependent later checkpoints.

## Backfill classifications

### Deterministic

- `prescriptions` with exact patient, prescriber, and encounter evidence;
- `prescription_items` under a deterministic prescription;
- `prescription_versions` with valid version numbers and stable source ownership;
- safety overrides/checks with exact prescription ownership;
- `cln_medication_orders` with exact patient, encounter, and prescribing practitioner evidence.

### Ambiguous

- prescription with no exact encounter;
- unresolved patient or practitioner mapping;
- conflicting appointment/admission/completion-claim episode links;
- duplicate final prescriptions for one source without explicit version lineage;
- CPOE order that appears textually similar to a prescription item without an explicit source link;
- invalid version snapshot or tenant mismatch;
- free-text consultation prescription or `prescriptions.lab_tests` content.

Ambiguous rows become stable processing issues. They are never guessed or silently dropped.

## Reconciliation equations

At minimum, local and protected-clone reconciliation must prove:

1. every canonical prescription has one tenant patient link and one encounter;
2. every canonical prescription has one prescribing practitioner;
3. every final prescription has at least one immutable version;
4. active version numbers are unique and contiguous within accepted source evidence;
5. every canonical medication order belongs to the same tenant, patient, encounter, practitioner, and prescription version when linked;
6. every source prescription/item/version/safety row is mapped or has a stable issue;
7. every source CPOE medication order is mapped or has a stable issue;
8. commercial `medication_orders` rows create zero clinical-order authority rows by themselves;
9. pharmacy-local prescription rows create zero duplicate clinical authority without an explicit mapping;
10. final signed hashes are immutable;
11. second pass creates zero new business rows;
12. source-table fingerprints remain unchanged;
13. foreign-key violations remain zero;
14. integrity check remains `ok`.

## Security and privacy

- Canonical outbox, reconciliation receipts, tests, logs, and tracker evidence must contain IDs, counts, status codes, and hashes only.
- Medication names, diagnosis, advice, instructions, patient details, and signed snapshot content must not appear in aggregate evidence.
- Full clinical content remains inside tenant-scoped clinical tables and authorised clinical APIs.

## Recommended serial checkpoints

1. `CDB-121A` — audit, design, implementation plan, and design contract.
2. `CDB-121B` — additive canonical schema and governance.
3. `CDB-121C` — idempotent prescription and medication-order commands.
4. `CDB-121D` — bounded backfill and fail-closed reconciliation.
5. `CDB-121E` — disabled provider adapters and selected local read promotion.
6. A separate exact production migration/backfill/observation/cutover sequence.

## Safety state

- Production query performed: no.
- Production rows written: 0.
- Migration applied remotely: no.
- Provider flag enabled: no.
- Route or traffic changed: no.
- Deployment performed: no.
- Local sync activated: no.
- Legacy history retired: no.
- Push or CDB-to-main integration performed: no.
