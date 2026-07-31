# P12 Canonical Lab Result and Specimen Schema Receipt

**Checkpoint:** `CDB-125B-CANONICAL-LAB-RESULT-SPECIMEN-SCHEMA-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally; uncommitted because the active connector exposes no Git commit action

## Added schema

Migration: `migrations/0558_canonical_lab_result_specimen.sql`

Drizzle module: `src/db/schema/canonical/lab-result-specimen.ts`

Canonical table families:

1. `canonical_lab_specimens`
2. `canonical_lab_specimen_service_items`
3. `canonical_lab_specimen_status_events`
4. `canonical_lab_result_sets`
5. `canonical_lab_result_versions`
6. `canonical_lab_result_observations`
7. `canonical_lab_result_status_events`
8. `canonical_lab_analyzer_evidence`

## Database guarantees

- existing Canonical service request/event, patient-link, encounter, practitioner, and service catalog authorities are reused;
- specimen patient, encounter, request, service, accession, barcode, and parent scope is exact and tenant-bound;
- specimen current state changes only through matching immutable custody events and optimistic status version;
- specimen service links prove exact request/event/service ownership;
- result sets prove exact patient, encounter, request, event, specimen, and service scope;
- result versions are contiguous, immutable, and same-scope;
- one direct replacement is allowed per superseded version;
- observations are immutable, deterministic, version-bound components;
- numeric values and reference ranges use canonical decimal TEXT rather than REAL;
- verification status events require an explicit practitioner and signed-content/content-hash parity;
- result current state changes only through matching version/status evidence;
- analyzer evidence uses exact source identity, payload SHA-256, observation index, QC/validation/match/disposition, and accepted observation ownership;
- specimen, service-link, custody, version, observation, status, and analyzer history cannot be hard-deleted.

## Verification

- design contract: 6 tests passed;
- schema contract: 8 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 493 migrations;
- all eight tables are registered in Canonical source-of-truth governance.

## Safety state

- no runtime route changes;
- no command module created during CDB-125B;
- no provider created or enabled;
- no production query or mutation;
- no production migration or backfill;
- no local sync activation;
- no push;
- no CDB-to-main integration;
- no legacy specimen/result/report/analyzer retirement.
