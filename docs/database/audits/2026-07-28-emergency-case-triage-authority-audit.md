# Emergency Case and Triage Authority Audit

**Checkpoint:** CDB-127A

**Date:** 2026-07-28

**Scope:** repository-static audit only. No production query, mutation, migration, backfill, route change, feature-flag change, deployment, local-sync activation, push, integration, or legacy retirement was performed.

## Executive finding

The HMS repository has an operational Emergency Department module, but it does not yet have one durable authority for an emergency episode extension. The principal mutable source is `er_patients`; the same row currently combines copied patient demographics, visit linkage, arrival details, triage state, performer snapshots, police-case indication, and final disposition. `er_patient_cases` stores selected trauma/animal-bite classification details, while `er_discharge_summaries` stores clinical narrative and also triggers finalization. `visits` independently represents an emergency episode, and `admissions` independently represents emergency admission. These sources can diverge because the current route does not create or update them through one atomic, versioned command boundary.

The target must therefore be a Canonical emergency extension linked to exactly one existing `canonical_encounters` row. It must not create another patient, encounter, practitioner, vital, diagnosis, medication, service-delivery, admission, clinical-document, invoice, or payment authority.

## Current source inventory

### `er_patients`

Classification: operational authority and mixed compatibility source.

Current facts combined in one mutable row:

- ER number and visit linkage;
- duplicated patient demographics and contact data;
- arrival time, mode, referral, brought-by and condition-on-arrival details;
- current workflow status;
- current red/yellow/green triage code;
- mutable triage actor and time;
- performer numeric ID and name snapshot;
- police-case indication;
- mutable final disposition, remarks, actor and time;
- pointer to a discharge summary;
- active/inactive flag.

Material risks:

1. Patient demographics are copied from or written independently of `patients`; the emergency row can become a competing identity/demographic authority.
2. `patient_id`, `visit_id`, performer numeric IDs and copied names are not sufficient Canonical identity evidence by themselves.
3. `triage_code`, `triaged_by`, and `triaged_on` are overwritten in place.
4. Undo triage clears all previous triage evidence instead of appending a correction or entered-in-error event.
5. Final disposition overwrites current state without immutable history or an expected-version guard.
6. `admitted`, `discharged`, `transferred`, `lama`, `dor`, and `death` can be selected from any current state.
7. Admitted finalization does not create or link an `admissions`/`canonical_admissions` fact.
8. Transferred finalization has no exact destination, receiving facility, receiving encounter, referral, transport, or practitioner evidence.
9. LAMA, DOR, and death do not have typed reason/evidence requirements.
10. Hard lifecycle evidence can be hidden through `is_active` or mutable fields.

Disposition: retain as a legacy compatibility source until exact migration, provider observation, rollback proof and separately authorized cutover. It is not Canonical authority.

### `er_patient_cases`

Classification: operational emergency classification source.

It stores main/sub-case numeric values, free-text other details, animal-bite site/time/animal, first-aid fields and address/name snapshots. The current route creates at most one row during initial ER registration and has no versioned correction command. Numeric code meaning is not enforced in the table, and name/text/time similarity cannot establish classification identity.

Disposition: migrate exact coded/source evidence into immutable Canonical emergency classifications. Preserve legacy history read-only. It is not Canonical authority.

### `er_discharge_summaries`

Classification: duplicate clinical-document authority plus legacy compatibility surface.

It stores chief complaints, treatment, investigations, advice, examination and provisional diagnosis as mutable columns. The route then updates `er_patients` to discharged in a separate statement. This creates three problems:

- discharge narrative competes with `canonical_clinical_documents`, `canonical_clinical_document_versions` and signatures;
- provisional diagnosis competes with `canonical_diagnosis_assertions`;
- document creation and emergency disposition are not one atomic boundary.

A signed discharge summary must be a versioned clinical document linked to the emergency encounter. The emergency disposition may reference that exact Canonical document/version, but it must not copy or own the narrative.

Disposition: retain as a legacy compatibility source and map exact summaries into the existing signed clinical-document authority. It is not Canonical authority.

### `er_file_uploads`

Classification: inactive domain extension / attachment compatibility source.

The schema stores ER/patient references and file URLs, but no active emergency route currently creates or reads these rows. File names and URLs do not prove content or clinical-document identity. Exact file content hash, patient/encounter scope and lifecycle should converge through `canonical_clinical_document_attachments` or another reviewed attachment authority.

Disposition: retain read-only until exact attachment mapping exists. It is not Canonical authority.

### `er_mode_of_arrival`

Classification: tenant configuration/domain lookup.

It is seeded by a runtime route with labels such as Ambulance, Walk-in, Police and Referred. A label is configuration, not emergency-case identity. A Canonical arrival assessment may store a normalized code and an exact source reference/snapshot while the lookup remains tenant-managed configuration.

Disposition: retain as a domain lookup. It is not Canonical clinical authority.

### `visits`

Classification: duplicate episode authority and compatibility source.

`src/routes/tenant/emergency.ts` creates a `visits` row with `visit_type='emergency'` and status `initiated`; reception quick-admit creates a different emergency visit with status `checked_in`; appointment flows can also create emergency visit types. The ER route does not reliably update the visit when triage or finalization changes. Existing Canonical encounter authority already defines actual care episodes.

Disposition: map exact legacy visit evidence to `canonical_encounters`. Never create an emergency case from patient name, phone, date or timestamp proximity. After cutover, `visits` can remain a compatibility projection until all readers migrate.

### `admissions`

Classification: separate inpatient authority/compatibility source.

Emergency admissions are created by `src/routes/tenant/admissions.ts` or reception/admission workflows, with `admission_type='emergency'`, `admit_source='emergency'` and `is_emergency=1`. Current ER finalization to admitted does not create or link an admission. Existing `canonical_admissions`, admission status events and encounter/admission links must remain the admission authority.

Disposition: an emergency admitted disposition must reference an exact Canonical admission/encounter relationship; it must not create duplicate admission state.

### `emergency_visits`

Classification: stale or missing projection contract.

`src/routes/tenant/qualityKpi.ts` queries `emergency_visits`, including `arrival_time` and `triage_category`, but no matching table exists in current repository schema or migrations. This read cannot be treated as authority evidence and may fail or silently depend on an unmanaged external schema.

Disposition: remove or replace only during a reviewed reader cutover. Until then, record it as a stale projection gap. It is not Canonical authority.

## Writer audit

### `src/routes/tenant/emergency.ts`

Primary legacy writer and reader.

Observed write paths:

- seed arrival modes;
- optionally create `patients` plus local-sync patient outbox;
- separately create an emergency `visits` row;
- separately create `er_patients`;
- separately create `er_patient_cases`;
- overwrite triage state;
- erase triage evidence through undo;
- overwrite final disposition;
- separately insert `er_discharge_summaries` and then finalize `er_patients`;
- generally update arrival/demographic fields in place.

The patient insert may be batched with a patient outbox, but patient, visit, ER case and case-classification creation do not form one end-to-end transaction. A failure can leave a patient without a visit, a visit without an ER row, or an ER row without case evidence. There is no command replay receipt, expected status version, immutable event history or Canonical source mapping.

### `src/routes/tenant/reception.ts`

Competing emergency arrival path.

Quick-admit atomically creates a temporary `patients` row and a `visits` row with `visit_type='emergency'`, but it creates no `er_patients` row, no triage case and no emergency extension. The visit can therefore appear as emergency care without the ER module seeing it.

Disposition: retain as legacy compatibility until it calls one Canonical patient/encounter/emergency registration command boundary.

### `src/routes/tenant/admissions.ts`

Separate admission writer.

It creates emergency admissions and bed effects, but no exact ER-case/disposition link is required. ER finalization and emergency admission can occur independently or in opposite order.

Disposition: keep admission authority separate; require an exact emergency disposition link to an existing Canonical admission when final disposition is admitted.

### Appointment and visit writers

Appointment/reception workflows can create `visits` with emergency type without creating an ER extension. These are episode compatibility writers, not emergency triage authority.

### `src/routes/tenant/nursing/opd.ts`

The existing authority matrix listed this route as an emergency writer, but repository search found no direct `er_patients`, `er_patient_cases`, `er_discharge_summaries`, or emergency-specific write. It must not remain classified as a direct emergency authority without concrete evidence.

## Reader audit

### `src/routes/tenant/emergency.ts`

Reads current mutable rows for lists, dashboards, detail, cases and discharge summary. It sorts by current triage code and reports current finalized state, but cannot display immutable history because none exists.

### `src/routes/tenant/qualityKpi.ts`

Reads missing/stale `emergency_visits`; this is a broken or unmanaged projection dependency.

### `src/routes/tenant/doctors.ts`

Aggregates emergency activity from visit/admission fields rather than ER case facts. It is a reporting projection consumer, not emergency authority.

### `src/routes/tenant/ipdReports.ts`

Counts `admissions.is_emergency`; this is inpatient reporting derived from admission authority. It must not determine emergency triage or ER disposition identity.

### `src/routes/tenant/patients-timeline.ts`

Current repository search found no `er_patients` or ER discharge-summary read. The patient timeline therefore omits the dedicated ER case even when it may show visits, admissions, diagnostics or other events. It is a future selected adapter surface, not a current ER authority reader.

### `src/routes/tenant/reports.ts`

The existing authority matrix listed this path as an emergency reader, but repository search found no direct ER table evidence. It must be removed from exact reader coverage unless a concrete query is added.

### `src/lib/patient-reference-registry.ts`

Tracks patient references in `er_patients`, `er_discharge_summaries`, and `er_file_uploads` for patient move/merge operations. It is identity-maintenance infrastructure, not emergency clinical authority.

## Authority separation

The following existing authorities must be reused:

- tenant/patient relationship: `canonical_tenant_patient_links`;
- actual care episode: `canonical_encounters`;
- practitioner identity: `canonical_practitioners`;
- service intent and delivery: `canonical_service_requests`, `canonical_service_events`, `canonical_service_participants`;
- signed discharge/clinical narrative: `canonical_clinical_documents`, versions, signatures and attachments;
- diagnosis: `canonical_diagnosis_assertions` and status events;
- vital observations: `canonical_vital_observation_sets`, components and status events;
- medication administration and reconciliation: existing medication authorities;
- inpatient admission: `canonical_admissions` and links;
- billing, invoice, payment and accounting: existing Canonical finance authorities.

The emergency extension owns only:

- emergency case identity linked to one Canonical encounter;
- versioned arrival assessment and operational arrival facts;
- immutable emergency lifecycle events;
- immutable versioned triage assessments and acuity;
- immutable versioned emergency classifications;
- immutable dispositions and exact links to admission, transfer, discharge document or other terminal evidence.

## Required design invariants

1. One emergency case per Canonical encounter.
2. Exact tenant/patient/encounter mapping is mandatory.
3. Patient name, phone, copied demographics, numeric ID coincidence and timestamp proximity are forbidden identity evidence.
4. Arrival assessment starts at version 1 and is immutable; correction creates a replacement.
5. Triage assessment records acuity, triage practitioner, observed time and recorded time separately.
6. Red/yellow/green may be supported for compatibility, but the stored normalized acuity contract must be explicit and versioned.
7. Undo triage cannot delete evidence; it creates a correction or entered-in-error replacement and status event.
8. Case classification is immutable/versioned and cannot be inferred from free text.
9. Final disposition is append-only and must follow a valid lifecycle state.
10. Admitted requires exact Canonical admission evidence.
11. Discharged requires an exact signed discharge-summary clinical-document version when a summary is asserted.
12. Transferred requires typed destination/referral evidence.
13. LAMA, DOR and death require typed reason and actor evidence.
14. Hard delete is forbidden for cases, assessments, events, classifications and dispositions.
15. Every write is tenant-scoped, replay-safe, idempotent and optimistic-version guarded.
16. Source compatibility writes, Canonical facts, source mappings, command receipt and PHI-minimised outbox commit atomically.
17. Production and runtime activation remain separate authorization gates.

## Recommended implementation sequence

- CDB-127A: design-only audit/specification/plan/contract.
- CDB-127B: six-table additive schema.
- CDB-127C: nine atomic commands.
- CDB-127D: eight-partition bounded backfill and fixed twenty-four-check reconciliation.
- CDB-127E: disabled-safe provider, selected adapters, coverage, rollback and readiness.

## Current safety conclusion

No existing emergency source should be frozen, deleted or reclassified as a projection at runtime yet. The current route remains the legacy compatibility source until local implementation, exact migration evidence, production observation, rollback proof and explicit owner authorization are complete. CDB-127A is design-only.
