# CDB-113F Identity and Episode Read-Promotion Audit

**Date:** 2026-07-27  
**Program:** HMS Canonical Data Architecture  
**Checkpoint:** `CDB-113F-IDENTITY-EPISODE-READ-PROMOTION`  
**Branch:** `program/cdb-main-continuous-20260725`  
**Authoritative worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`  
**Reviewed implementation base:** `6ef1c713e`  
**Production access or mutation:** none  
**Provider activation authorised:** no  
**Legacy retirement authorised:** no

## 1. Purpose

CDB-113B through CDB-113E established additive canonical identity and episode authorities, commands, disabled providers, deterministic backfills, and reconciliation. Those checkpoints did not promote operational readers. This audit defines the local-only reader-promotion checkpoint required before any later authorised canary.

The checkpoint must answer five questions without guessing:

1. Which active repository readers depend on patient identity, practitioner identity, appointment intent, encounter actual-care facts, or admission/bed occupancy facts?
2. Which one of the five reviewed provider families owns each exact `path + table` reader dependency?
3. Which consumers can be adopted locally through disabled-safe adapters while retaining legacy response behaviour?
4. What parity, privacy, latency, rollback, and mapping evidence is required before a provider can be declared locally ready?
5. Which exact writer and reader retirement gates remain blocked after local readiness is implemented?

This checkpoint does not authorise production traffic, production data access, feature-flag activation, backfill execution, route cutover, local-sync activation, or legacy retirement.

## 2. Reviewed source evidence

The source of truth is the current branch code and tests followed by:

- `docs/architecture/canonical-program-control-center.md`;
- `task-progress.yaml`;
- `docs/database/canonical-authority-matrix.yaml`;
- `docs/database/canonical-authority-access-registry.yaml`;
- `docs/database/audits/2026-07-26-canonical-authority-access-audit.md`;
- `docs/superpowers/specs/2026-07-26-cdb-113a-identity-episode-foundation-design.md`;
- `docs/superpowers/plans/2026-07-26-cdb-113a-identity-episode-foundation.md`;
- `docs/database/migration-runs/P11-canonical-tenant-patient-link-foundation.md`;
- `docs/database/migration-runs/P11-canonical-practitioner-operational-adoption.md`;
- `docs/database/migration-runs/P11-canonical-appointment-authority.md`;
- `docs/database/migration-runs/P11-canonical-encounter-admission-bed-convergence.md`;
- current patient, practitioner, appointment, encounter, and admission/bed provider modules.

The current access registry records 190 governed tables, 858 exact writer pairs, and 2,053 exact reader pairs with zero governance issues. CDB-113F narrows that graph to the identity/episode concepts defined below.

## 3. Provider families and authority boundaries

### Patient identity provider

Owns tenant-patient relationship resolution and global-identity relationship evidence. It may return legacy demographic fields only from the existing legacy patient source while the provider mode is legacy or shadow. It must not copy demographics into canonical relationship tables or treat phone/name matching as identity evidence.

Reviewed concepts:

- `patient_identity`;
- `tenant_patient_linkage`.

Reviewed tables include:

- `patients`;
- `global_patient_identity`;
- `canonical_tenant_patient_links`;
- `canonical_tenant_patient_link_events`;
- `patient_aliases`;
- `mpi_duplicate_suspects`.

### Practitioner provider

Owns practitioner identity and explicit practitioner/user/employee/identifier/classification relationships. Authentication users and employees remain separate roles. Display name, contact fields, specialty labels, and numeric-ID coincidence do not establish practitioner identity.

Reviewed concepts:

- `practitioner_identity`;
- `practitioner_account_links`.

### Appointment provider

Owns planned appointment intent, immutable status history, reschedule lineage, and explicit appointment-to-encounter links. Appointment fee display data is not invoice or payment authority.

Reviewed concept:

- `appointment_intent`.

### Encounter provider

Owns actual care, participants, signed history references, actual-care lifecycle, and encounter-linked evidence. It does not own planned appointment intent or inpatient admission lifecycle.

Reviewed concepts:

- `encounter_care_episode`;
- `emergency_case_extension`;
- clinical-document readers that require exact encounter context.

### Admission/bed provider

Owns inpatient admission lifecycle, care-location identity, bed-resource identity, and interval-based bed occupancy. It does not own price, admission fees, invoices, deposits, payments, nursing assignment, diagnosis, or financial discharge status.

Reviewed concepts:

- `inpatient_admission_link`;
- `bed_occupancy_interval`.

## 4. Exact current reader inventory

A deterministic classification over the current access registry identifies:

| Measure | Count |
| --- | ---: |
| Eligible identity/episode reader pairs | 616 |
| Unique source paths | 249 |
| Unique governed tables | 41 |
| Unknown provider assignments | 0 |
| Legacy reader pairs | 375 |
| Compatibility reader pairs | 53 |
| Canonical reader pairs | 102 |
| External-governed reader pairs | 86 |

### Provider distribution

| Provider | Total | Legacy | Compatibility | Canonical | External |
| --- | ---: | ---: | ---: | ---: | ---: |
| Patient identity | 178 | 136 | 10 | 13 | 19 |
| Practitioner | 187 | 80 | 8 | 32 | 67 |
| Appointment | 47 | 31 | 7 | 9 | 0 |
| Encounter | 98 | 60 | 14 | 24 | 0 |
| Admission/bed | 106 | 68 | 14 | 24 | 0 |

These counts are exact `path + table` dependencies, not route counts. One route can have multiple governed dependencies and one provider can cover many consumers.

## 5. Mixed-source classification rules

Some legacy tables contain more than one historical meaning. The provider registry must classify each exact reader deterministically rather than assigning one provider to the table globally.

### `consultations`

- appointment/backfill/reconciliation/marketplace paths that consume planned scheduling intent map to the appointment provider;
- clinical consultation, patient chart, patient timeline, and encounter backfill paths map to the encounter provider;
- no classification may infer the provider from timestamps or status text alone.

### `visits`

`visits` maps to encounter because it records actual operational care context. Any appointment link must be explicit and remains an appointment-provider concern.

### `admissions`, `beds`, and `patient_bed_infos`

These map to admission/bed. Financial readers may retain money calculations in their own authority, but identity, lifecycle, bed, location, and occupancy references must come through admission/bed provider evidence before read promotion.

### `patients`, `doctors`, and `users`

- patient relationship resolution maps to patient identity;
- practitioner identity/account relationships map to practitioner;
- authentication facts remain external governed and must not be collapsed into practitioner identity.

## 6. Existing provider state

The branch already contains disabled-safe modules for:

- `src/lib/canonical/practitioner-provider.ts`;
- `src/lib/canonical/appointment-provider.ts`;
- `src/lib/canonical/encounter-provider.ts`;
- `src/lib/canonical/admission-bed-provider.ts`.

Their feature flags default to legacy when the flag is absent, disabled, malformed, unsupported, or when the feature-flag table does not exist. They support shadow comparison and canonical resolution only with exact mapping evidence. None is currently imported by an operational route consumer.

The missing provider is patient identity. CDB-113F must add a disabled-safe patient identity provider before declaring coverage complete.

## 7. Selected local adoption scope

CDB-113F will not attempt to rewrite all 375 legacy readers. It will create a complete provider coverage registry and adopt a bounded, representative set of read adapters locally while keeping runtime flags disabled:

- patient identity detail/link resolution;
- practitioner detail/search/marketplace projection;
- appointment detail, patient portal, marketplace, check-in, and reminder projections;
- encounter detail, patient timeline, mutation validation, and paid-visit episode evidence;
- admission detail, census, bed availability, and occupancy-history projection.

These adapters are provider consumers even when they remain library-level boundaries. Route contracts can later call them without exposing private canonical tables. A consumer is locally adopted only when tests prove disabled-default legacy behaviour, shadow parity evidence, canonical fail-closed semantics, privacy, and rollback mode.

No production or environment flag is changed in this checkpoint.

## 8. Shadow parity contract

Every provider comparison must produce aggregate evidence only. Required fields include:

- provider family and consumer ID;
- tenant-scoped stable consumer key or its hash;
- mode;
- comparison count;
- parity result;
- stable variance IDs;
- variance classes;
- elapsed milliseconds;
- error count;
- observed-at UTC;
- rollback mode.

Forbidden evidence includes:

- patient or practitioner names;
- phone, email, address, care-of data, or free-form notes;
- diagnoses, clinical narratives, prescriptions, or result content;
- appointment notes;
- bed/ward display labels;
- invoice, payment, deposit, or money amounts;
- authentication credentials or secrets.

Critical parity requires zero unexplained critical variance. Intentional differences must use reviewed stable classifications and cannot be silently treated as parity.

## 9. Stable variance classes

The local comparison layer must support at least:

- `MAPPING_MISSING`;
- `MAPPING_AMBIGUOUS`;
- `CROSS_TENANT_REFERENCE`;
- `PATIENT_LINK_MISMATCH`;
- `PRACTITIONER_LINK_MISMATCH`;
- `STATUS_MISMATCH`;
- `INTERVAL_MISMATCH`;
- `PARTICIPANT_MISMATCH`;
- `LOCATION_MISMATCH`;
- `BED_OCCUPANCY_MISMATCH`;
- `LIFECYCLE_MISMATCH`;
- `INTENT_ACTUAL_CARE_COLLAPSE`;
- `PROVIDER_ERROR`;
- `LATENCY_BUDGET_EXCEEDED`.

Variance IDs must be deterministic from non-PHI facts such as provider, consumer ID, tenant ID, source type, source public ID, variance class, and reviewed evidence hash.

## 10. Local readiness contract

The fail-closed readiness checker must require:

1. the provider coverage registry is generated from the current access-registry hash;
2. all 616 current eligible reader pairs have exactly one provider and zero unknown assignments;
3. all five provider families have modules and disabled-default feature flags;
4. selected adapters have focused tests for legacy, shadow, canonical, privacy, tenant isolation, and rollback;
5. critical shadow receipts contain zero unexplained variance;
6. accepted exceptions have stable IDs, classification, owner, reason, and expiry/review state;
7. second-pass patient/practitioner/appointment/encounter/admission-bed backfill evidence is present;
8. source mapping coverage or accepted issue IDs exist for identity-sensitive selected consumers;
9. all feature flags remain disabled in repository defaults and no production flag evidence is claimed;
10. rollback is mode-to-legacy and preserves canonical evidence;
11. access governance, TypeScript, focused tests, canonical suite, and required builds pass.

The checker must return blocked, not ready, when evidence is absent. It must never activate a provider.

## 11. Retirement impact

Identity/episode retirement gates remain blocked until all of the following are complete for each exact reader/writer family:

- canonical command cutover;
- complete provider coverage;
- authorised reader promotion;
- measured observation;
- zero unexplained critical variance;
- rollback evidence freshness;
- access-registry path clearance;
- owner authorisation.

CDB-113F may add retirement domain records and readiness evidence, but it cannot mark production cutover, observation, owner authorisation, legacy authority retirement, compatibility-adapter retirement, or fixture retirement complete.

## 12. Verification and safety

Required local verification:

```text
pnpm vitest run <CDB-113F focused tests>
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm canonical:identity-episode-coverage-check
pnpm canonical:identity-episode-readiness
pnpm vitest run test/canonical
pnpm build:migrations
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm worktree:check -- --mode=task --allow-dirty
```

Affected web/patient/admin builds are required only if their runtime/API/UI code changes.

CDB-113F must not:

- access production, protected exports, credentials, or secrets;
- apply migrations or backfills;
- enable patient, practitioner, appointment, encounter, admission, or bed provider flags;
- change production traffic or scheduled work;
- activate local sync;
- remove or block a legacy reader/writer;
- add destructive migrations;
- infer identity from names, phone, labels, numeric-ID coincidence, or timestamp proximity;
- rewrite signed clinical history;
- push or integrate CDB to `main`.

## 13. Exact implementation direction

The serial plan is `docs/superpowers/plans/2026-07-27-cdb-113f-identity-episode-read-promotion.md`.

The checkpoint proceeds through:

1. audit, provider classification, design contract, and serial plan;
2. deterministic provider coverage registry and fail-closed checker;
3. disabled-safe patient identity provider;
4. PHI-minimised shadow receipt and selected local adapter evidence;
5. fail-closed local readiness checker and retirement-gate updates;
6. full verification, receipt, tracker, control center, handoff, and clean metadata commit.

The exact next action after CDB-113F local verification will be recorded from the remaining full-HMS canonical authority gaps. No production canary is implied by local readiness.
