# P12 Canonical Radiology Acquisition and Report Authority Receipt

**Checkpoint:** `CDB-126E-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-PROVIDER-READINESS-VERIFIED`

**Date:** 2026-07-28

**Status:** local-ready with provider disabled; production activation and legacy retirement remain blocked; changes are uncommitted because the active connector exposes no Git commit action

## Completed local authority

CDB-126A through CDB-126E now provide:

- the reviewed authority audit, design, and implementation plan;
- nine additive tenant-scoped Canonical imaging table families;
- sixteen atomic, idempotent acquisition, DICOM hierarchy, provenance, report-version, signature, correction, retraction, and entered-in-error commands;
- ten persistent caller-bounded resumable read-only backfill partitions;
- one fixed thirty-check persisted reconciliation receipt;
- a disabled-safe legacy/shadow/canonical provider;
- four library-only selected read adapters;
- complete known writer/reader coverage with zero unknown assignments;
- fail-closed local readiness and explicit blocked production/retirement gates.

## Provider contract

Provider:
`src/lib/canonical/radiology-acquisition-report-provider.ts`

Feature flag:
`canonical_radiology_acquisition_report_provider_v1`

Modes:

- `legacy`
- `shadow`
- `canonical`

Safety defaults:

- enabled by default: false;
- default mode: legacy;
- rollback mode: legacy;
- unsupported or disabled flag state: legacy;
- canonical and shadow modes require exact source mapping;
- identity-sensitive legacy reads also require exact mapping;
- canonical mode fails closed when acquisition, Study, report, or source scope is unresolved;
- no runtime route imports or activates the provider.

## Canonical read projection

Canonical mode exposes reviewed history without creating new authority:

- acquisition current state and immutable status-event sequence;
- exact Study Instance UID hierarchy;
- exact Series Instance UID and SOP Instance UID/SOP Class hierarchy where authoritative rows exist;
- immutable object content SHA-256 and storage provider/key/generation;
- immutable modality, AE, PACS endpoint, protocol, transfer, hash, storage, disposition, actor, and time provenance;
- complete report-version lineage;
- content hash and signed-content hash parity;
- author, verifier, and finaliser practitioner identities;
- verification, finalisation, publication, correction, retraction, and entered-in-error history;
- rendering content from the immutable selected version while keeping templates, film, billing, print, notification, and delivery caches as projections.

Raw DICOM pixel data and unrestricted transport payloads are not stored or returned by the Canonical provider.

## Four selected library adapters

Adapter module:
`src/lib/canonical/radiology-acquisition-report-read-adapters.ts`

1. `readRadiologyAcquisitionWorklistAdapter`
2. `readRadiologyPacsHierarchyAdapter`
3. `readRadiologyPatientTimelineAdapter`
4. `readRadiologyReportRenderingAdapter`

All four remain library-only, route-inactive, and rollback to legacy.

Shadow mode preserves the legacy-facing status/time while comparing Canonical scope, lifecycle, hierarchy, provenance, report, signed history, and effective-time parity. Persistable shadow evidence contains aggregate counts and booleans only; it excludes patient, encounter, request, acquisition, UID, AE-title, storage-key, report-content, and other clinical identifiers.

## Coverage and readiness

Coverage:
`docs/database/canonical-radiology-acquisition-report-provider-coverage.json`

Readiness:
`docs/database/radiology-acquisition-report-readiness.json`

Checker:
`scripts/canonical/check-radiology-acquisition-report-readiness.ts`

Coverage summary:

- selected adapters: 4;
- known writers: 8;
- known readers: 11;
- unknown writer assignments: 0;
- unknown reader assignments: 0;
- runtime route activation count: 0.

Executable readiness result:

- local ready: true;
- production ready: false;
- readiness issues: 0;
- provider enabled: false;
- route cutover performed: false;
- production observation present: false;
- rollback execution evidence present: false;
- owner authorization present: false;
- legacy retirement approved: false.

## Verification

- CDB-126A–E focused suite: 6 files, 30 tests passed;
- provider contract: 5 tests passed;
- readiness contract: 3 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 494 migrations;
- final schema governance, program continuity, and worktree policy: 3 files, 21 tests passed after metadata synchronization.

## Safety state

- production query performed: no;
- production mutation performed: no;
- production migration or backfill applied: no;
- provider flag enabled: no;
- runtime route changed: no;
- traffic or deployment changed: no;
- local sync activated: no;
- push or CDB-to-main integration performed: no;
- legacy requisition, report, RIS, PACS, DICOM, storage, film, billing, rendering, notification, or audit history retired: no.

## Blocked external gates

### Production activation

Blocked until separately authorized production migration, exact bounded production backfill, thirty-check reconciliation, source fingerprints, integrity proof, shadow observation, latency/error evidence, rollback execution proof, and owner approval exist.

### Legacy retirement

Blocked until every legacy writer and reader is cut over, exact mappings and historical preservation are proven, observation and rollback gates pass, and explicit retirement authorization is granted.

## Next checkpoint

`CDB-127A-EMERGENCY-CASE-TRIAGE-AUTHORITY-DESIGN`

Audit current emergency registration, triage, case, encounter, nursing, transfer, discharge, billing, reporting, and timeline authorities. Reuse Canonical patient, encounter, practitioner, service request/event, clinical document, diagnosis, vital, and medication authorities. Design only; do not create runtime schema or mutate production during CDB-127A.
