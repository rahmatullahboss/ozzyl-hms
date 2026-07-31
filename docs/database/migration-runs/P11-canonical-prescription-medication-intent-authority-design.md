# P11 Canonical Prescription and Medication-Intent Authority Design

**Checkpoint:** `CDB-121A-PRESCRIPTION-MEDICATION-INTENT-AUTHORITY-DESIGN-VERIFIED`
**Date:** 2026-07-27
**Branch:** `program/cdb-main-continuous-20260725`
**Previous checkpoint:** `CDB-113H3-PRODUCTION-SCHEMA-AUTHORIZATION-CONTRACT-READY`
**Next checkpoint:** `CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA`

## Result

The canonical roadmap's prescription/medication portion has been decomposed into one reviewable local program with five serial checkpoints:

- `CDB-121A` — audit, design, implementation plan, and design contract;
- `CDB-121B` — additive schema and governance;
- `CDB-121C` — idempotent canonical commands;
- `CDB-121D` — bounded backfill and persistent reconciliation;
- `CDB-121E` — disabled providers, consumer coverage, and local readiness.

Normal checkpoint commits are not stop points. The next safe local checkpoint continues automatically.

## Authority decision

The target canonical tables are:

1. `canonical_prescriptions` — current encounter-linked prescription document state;
2. `canonical_prescription_versions` — immutable document versions;
3. `canonical_medication_orders` — current clinical medication intent;
4. `canonical_medication_order_status_events` — immutable medication-order lifecycle;
5. `canonical_prescription_safety_events` — immutable safety/override evidence.

The target commands are:

- `createCanonicalPrescriptionDraft`;
- `replaceCanonicalPrescriptionDraft`;
- `finalizeCanonicalPrescription`;
- `amendCanonicalPrescription`;
- `transitionCanonicalMedicationOrder`;
- `recordCanonicalPrescriptionSafetyEvent`.

Every prescription and medication order requires an exact canonical tenant-patient link, encounter, prescribing practitioner, source mapping/evidence hash, tenant scope, and stable application-generated public ID.

Names, phone numbers, medicine text, numeric-ID coincidence, and timestamp proximity are prohibited identity or episode evidence.

## Explicitly separate facts

The design does not merge:

- medication administration/MAR;
- medication reconciliation;
- fulfilment, dispense, sale, or delivery;
- pharmacy-local prescription workflow;
- stock movement;
- service event, invoice, payment, deposit, or accounting;
- diagnosis, observation, vital, or signed clinical-document authority.

Commercial `medication_orders` remains fulfilment workflow, not clinical order truth. `cln_medication_orders` remains a legacy CPOE source pending deterministic mapping. Final prescription versions remain immutable and correction uses amendment/supersession.

## Evidence

- Audit: `docs/database/audits/2026-07-27-prescription-medication-intent-authority-audit.md`
- Design: `docs/superpowers/specs/2026-07-27-cdb-121a-prescription-medication-intent-authority-design.md`
- Plan: `docs/superpowers/plans/2026-07-27-cdb-121-prescription-medication-intent-authority.md`
- Contract test: `test/canonical/prescription-medication-intent-design-contract.test.ts`

## Production safety

```text
production_rows_written: 0
production_mutation_performed: false
provider_flag_enabled: false
route_changed: false
traffic_changed: false
deployment_performed: false
local_sync_activated: false
legacy_history_retired: false
push_performed: false
cdb_to_main_integration_performed: false
```

The H3 production-schema gate remains separately blocked. CDB-121 local work does not broaden or reuse H3 authorization.

## Exact next action

Implement `CDB-121B-CANONICAL-PRESCRIPTION-MEDICATION-SCHEMA` with migration `0554_canonical_prescription_medication_intent.sql`, Drizzle module `src/db/schema/canonical/medication.ts`, schema/authority governance, and RED→GREEN schema tests. Do not access or mutate production.
