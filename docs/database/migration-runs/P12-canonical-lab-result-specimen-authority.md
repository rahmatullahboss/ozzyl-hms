# P12 Canonical Lab Result and Specimen Authority Receipt

**Checkpoint:** `CDB-125E-CANONICAL-LAB-RESULT-SPECIMEN-PROVIDER-READINESS-VERIFIED`

**Date:** 2026-07-28

**Status:** locally ready with provider disabled; production activation and legacy retirement remain blocked; uncommitted because the active connector exposes no Git commit action

## Completed authority surface

CDB-125A through CDB-125E now provide:

- an audited and designed authority boundary reusing Canonical patient, encounter, practitioner, service catalog, service request, and service event identities;
- eight additive Canonical lab domain-extension tables;
- thirteen atomic idempotent specimen, result-version, signature, correction, retraction, error, and analyzer commands;
- ten persistent caller-bounded resumable backfill partitions;
- a fixed twenty-eight-check persisted reconciliation receipt;
- a disabled-safe `canonical_lab_result_specimen_provider_v1` boundary;
- three selected library-only read adapters;
- complete known writer/reader coverage with zero unknown assignments and zero route activation;
- a fail-closed local readiness executable and evidence document.

## Provider contract

Provider modes:

- `legacy`
- `shadow`
- `canonical`

Default mode: `legacy`

Rollback mode: `legacy`

Enabled by default: no

Absent, disabled, or unsupported feature state resolves to `legacy`. Identity-sensitive and Canonical reads require an exact source mapping and fail closed when the mapping is absent.

Legacy and shadow modes preserve the current legacy-facing specimen/result status and effective-time projection. Shadow mode emits only aggregate comparison counts, latency/error state, accepted-exception count, observation time, and deterministic SHA-256 evidence. It excludes patient links, encounters, requests, services, specimen identities, accessions, barcodes, specimen types, result values, observations, analyzer identities, and raw payloads.

Canonical specimen projections expose current state and the complete immutable custody event sequence. Canonical result projections expose current version, complete version lineage, ordered observations, signed lifecycle history, specimen custody, and analyzer provenance. Report rendering and delivery remain projections, not clinical result authority.

## Selected adapters

1. `readLabSpecimenDetailAdapter`
2. `readLabPatientResultTimelineAdapter`
3. `readLabReportSummaryAdapter`

All are library-only. None is imported by a runtime route. Every adapter reports rollback mode `legacy`.

Coverage evidence:

- provider: `src/lib/canonical/lab-result-specimen-provider.ts`
- adapters: `src/lib/canonical/lab-result-specimen-read-adapters.ts`
- coverage registry: `docs/database/canonical-lab-result-specimen-provider-coverage.json`
- readiness evidence: `docs/database/lab-result-specimen-readiness.json`
- readiness executable: `scripts/canonical/check-lab-result-specimen-readiness.ts`

Coverage totals:

- selected adapters: 3
- known direct writers: 6
- known read consumers: 12
- unknown writer assignments: 0
- unknown reader assignments: 0
- runtime route activation: 0

## Fresh verification

- provider contract: 5 tests passed;
- readiness contract: 3 tests passed;
- readiness executable: `localReady=true`, `productionReady=false`, `issueCount=0`;
- CDB-125A–E focused suite: 6 files, 31 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 493 migrations;
- schema governance, continuity, and worktree policy: 3 files, 21 tests passed.

## Local readiness claim

Local readiness: true

Production readiness: false

The local claim means schema, command, bounded migration, reconciliation, disabled provider, selected adapters, coverage, rollback configuration, history visibility, PHI-minimised shadow evidence, and route-import guards are verified in the repository. It does not authorise production migration, backfill, observation, provider enablement, route cutover, writer freeze, or legacy retirement.

## Blocked external gates

### Production activation

Blocked because the provider is disabled, runtime routes are unchanged, production migration/backfill and observation are absent, rollback has not been executed against production, and exact owner authorisation has not been provided.

### Legacy retirement

Blocked because specimen, result, report, correction, LIS inbox, analyzer, notification, patient-portal, timeline, exchange, and other downstream legacy writer/read surfaces remain active. No production observation or explicit retirement authorisation exists.

## Safety state

- provider enabled: no;
- runtime route cutover: no;
- production query: no;
- production mutation: no;
- production migration: no;
- production backfill: no;
- local sync activation: no;
- push: no;
- CDB-to-main integration: no;
- legacy writer freeze: no;
- destructive retirement: no.

## Next checkpoint

`CDB-126A-RADIOLOGY-ACQUISITION-REPORT-AUTHORITY-DESIGN`

Perform a design-only audit of imaging order/service links, modality worklist, acquisition/study/series/instance identities, performer and reporter participation, report versions/signatures/corrections, PACS/DICOM provenance, current writers/readers, duplicate authorities, and retirement blockers. Do not create migration, schema, commands, providers, runtime route changes, or production effects during CDB-126A.
