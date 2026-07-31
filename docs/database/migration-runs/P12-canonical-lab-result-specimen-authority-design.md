# P12 Canonical Lab Result and Specimen Authority Design Receipt

**Checkpoint:** `CDB-125A-LAB-RESULT-SPECIMEN-AUTHORITY-DESIGN-VERIFIED`

**Date:** 2026-07-28

**Status:** repository audit and design completed locally; schema and runtime implementation not started

## Design evidence

- audit: `docs/database/audits/2026-07-28-lab-result-specimen-authority-audit.md`
- specification: `docs/superpowers/specs/2026-07-28-cdb-125a-lab-result-specimen-authority-design.md`
- implementation plan: `docs/superpowers/plans/2026-07-28-cdb-125-lab-result-specimen-authority.md`
- design contract: `test/canonical/lab-result-specimen-authority-design-contract.test.ts`

## Authority decision

Existing `canonical_service_requests`, `canonical_service_events`, and `canonical_service_participants` remain the only generic service intent, delivery, and participant authorities. CDB-125 will add lab-specific domain extensions only. It will not create another lab-order authority or copy billing/service status into result authority.

The repository currently contains several valuable but competing or incomplete sources:

- `lab_order_items` combines request line, billing, specimen, mutable result cache, completion, machine, and retraction state;
- `lab_specimens`, `lab_specimen_items`, and `lab_specimen_events` model specimen workflow without one atomic immutable Canonical lifecycle;
- `lab_reports` is a mutable report and review/publish projection;
- `lab_results` is a mutable current observation source;
- `lab_observation_audit` preserves versions but uses legacy identities and `MAX(version) + 1` allocation without a complete database-enforced Canonical contract;
- `lab_result_corrections` preserves correction workflow while the original result is overwritten;
- `lis_ingestion_messages` and `lis_analyzer_inbox` provide strong immutable analyzer staging evidence but remain legacy LIS transport/workflow authorities;
- acceptance and retraction services use D1 batches and important safety controls but mutate legacy current rows rather than create complete immutable Canonical result versions.

Every current table remains a legacy compatibility source. No existing lab table was declared Canonical authority by this design checkpoint.

## Eight planned Canonical table families

1. `canonical_lab_specimens`
2. `canonical_lab_specimen_service_items`
3. `canonical_lab_specimen_status_events`
4. `canonical_lab_result_sets`
5. `canonical_lab_result_versions`
6. `canonical_lab_result_observations`
7. `canonical_lab_result_status_events`
8. `canonical_lab_analyzer_evidence`

The design separates specimen identity/custody, result aggregate/current pointer, complete immutable versions, component observations, lifecycle/signature events, analyzer provenance, and report projection.

## Locked invariants

- exact tenant, patient link, encounter, service request/event, service, specimen, practitioner, and analyzer source scope;
- accession and barcode are identifiers, not patient or order identity proof;
- test name, component name, result value, timestamp, patient proximity, and machine code never establish identity;
- specimen custody events are append-only;
- specimen current state advances only through matching immutable event and optimistic version;
- result observations are immutable within one exact version;
- correction creates a complete replacement version;
- retraction and entered-in-error preserve every prior version and observation;
- result version sequence is database-enforced, not `MAX(version) + 1` application convention;
- numeric result, reference limit, and conversion-factor authority uses canonical decimal TEXT;
- verified, validated, and published status requires an explicit active practitioner and signed-content/content-hash parity;
- analyzer evidence retains exact source identities and hashes while raw payload stays in governed LIS source;
- report rendering, publication delivery, notification delivery, billing, and workflow status remain projections or separate authorities;
- no hard delete of specimen custody, result versions, observations, signatures, retractions, error evidence, or accepted analyzer provenance.

## Thirteen planned commands

Specimen:

1. `registerCanonicalLabSpecimen`
2. `collectCanonicalLabSpecimen`
3. `receiveCanonicalLabSpecimen`
4. `rejectCanonicalLabSpecimen`
5. `createCanonicalLabSpecimenAliquot`

Result/analyzer:

6. `createCanonicalLabResultDraft`
7. `replaceCanonicalLabResultDraft`
8. `verifyCanonicalLabResultVersion`
9. `validateAndPublishCanonicalLabResultVersion`
10. `correctCanonicalLabResultVersion`
11. `retractCanonicalLabResultVersion`
12. `enterCanonicalLabResultInError`
13. `attachCanonicalLabAnalyzerEvidence`

All commands will be tenant-scoped, deterministic where source identities exist, idempotent, replay-before-validation, exact-mapped, PHI-minimised in outbox/receipts, and one D1 atomic batch with full rollback.

## Ten planned persistent backfill partitions

1. service request/event mapping;
2. specimen identity/current state;
3. specimen-service links;
4. specimen custody events and state divergence;
5. manual/current result-set and version reconstruction;
6. observation audit and correction lineage;
7. verification/validation/publication/retraction/error lifecycle;
8. analyzer ingestion/inbox/machine/QC/validation provenance;
9. unmatched, ambiguous, collision, critical-notification, and workflow disposition;
10. duplicate/cache/projection disposition and second-pass proof.

Legacy sources remain read-only. Ambiguous identity creates deterministic non-PHI processing issues. Completed second pass must create zero new business rows.

## Fixed twenty-eight-check reconciliation

The design locks twenty-eight checks covering mappings, specimen patient/encounter/request ownership, specimen-service links, parent scope, current event/status, event sequence, actors, result patient/encounter/request/event/specimen/service ownership, current version, version sequence and supersession, observation sequence/value/decimal/unit/range interpretation, practitioner signature scope, signed content parity, result status events, analyzer uniqueness/ownership, critical issues, source fingerprint/FK/integrity, and second-pass new rows.

## Provider and readiness design

Future provider flag: `canonical_lab_result_specimen_provider_v1`.

- supported modes: `legacy`, `shadow`, `canonical`;
- enabled by default: false;
- default mode: `legacy`;
- rollback mode: `legacy`;
- exact mapping required for canonical and identity-sensitive reads;
- shadow evidence aggregate and PHI-minimised;
- specimen custody, result version, signature/status, and analyzer provenance visible;
- report remains projection;
- runtime route activation count remains zero until separately authorised.

## Next checkpoint

`CDB-125B-CANONICAL-LAB-RESULT-SPECIMEN-SCHEMA`

Revalidate migration number `0558`, write failing SQLite schema tests first, then create one additive migration and one dedicated Canonical Drizzle module for the eight table families. Do not wire routes, enable providers, query or mutate production, apply production migration/backfill, or retire legacy tables.

## Safety state

- migration `0558` created: no;
- Drizzle schema created: no;
- command module created: no;
- provider created: no;
- runtime routes changed: no;
- production query performed: no;
- production mutation performed: no;
- production migration/backfill applied: no;
- local sync activated: no;
- push performed: no;
- CDB-to-main integration performed: no;
- legacy writer freeze or retirement: no.

The active connector exposes no Git commit action. This design checkpoint remains verified-uncommitted with all existing dirty work preserved.
