# P12 Canonical Lab Result and Specimen Commands Receipt

**Checkpoint:** `CDB-125C-CANONICAL-LAB-RESULT-SPECIMEN-COMMANDS-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally; uncommitted because the active connector exposes no Git commit action

## Command module

`src/lib/canonical/commands/manage-lab-result-specimen.ts`

## Thirteen command boundaries

1. `registerCanonicalLabSpecimen`
2. `collectCanonicalLabSpecimen`
3. `receiveCanonicalLabSpecimen`
4. `rejectCanonicalLabSpecimen`
5. `createCanonicalLabSpecimenAliquot`
6. `createCanonicalLabResultDraft`
7. `replaceCanonicalLabResultDraft`
8. `verifyCanonicalLabResultVersion`
9. `validateAndPublishCanonicalLabResultVersion`
10. `correctCanonicalLabResultVersion`
11. `retractCanonicalLabResultVersion`
12. `enterCanonicalLabResultInError`
13. `attachCanonicalLabAnalyzerEvidence`

## Verified command guarantees

- replay is read before mutable current-state validation;
- same idempotency key with a different operation fingerprint is rejected;
- exact tenant, patient link, encounter, service request/event, service, specimen, practitioner, version, observation, and analyzer source scope is required;
- specimen registration creates identity, initial immutable custody event, exact service link, source mapping, command receipt, and PHI-minimised outbox in one D1 batch;
- collection, receipt, rejection, and aliquot creation use optimistic specimen status versions and immutable events;
- result draft creation writes result set, immutable version, deterministic ordered observations, status event, exact source mapping, command receipt, and outbox atomically;
- draft replacement and correction create complete replacement versions without rewriting prior content;
- verification binds an active practitioner and exact signed content SHA-256 to one immutable version;
- validation and publication advance the same exact signed version through immutable status events;
- retraction and entered-in-error create replacement/version lifecycle evidence and preserve prior observations;
- numeric result values, reference ranges, and conversion factors are canonical decimal TEXT;
- accepted analyzer evidence requires exact observation/version ownership, payload SHA-256, source identity, observation index, QC, validation, and matching state;
- Canonical outbox payloads exclude patient links, encounters, requests, accessions, barcodes, specimen types, values, and other PHI/clinical content;
- any compatibility, Canonical, mapping, receipt, or outbox statement failure rolls the entire batch back.

## Fresh verification

- command contract: 7 tests passed;
- CDB-125A through CDB-125C combined focused suite: 21 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- schema contract remains 8 tests passed;
- design contract remains 6 tests passed.

## Safety state

- runtime routes changed: no;
- provider created or enabled: no;
- production query or mutation: no;
- production migration or backfill: no;
- local sync activation: no;
- push: no;
- CDB-to-main integration: no;
- legacy specimen, result, report, correction, LIS inbox, or analyzer history retirement: no.

## Next checkpoint

`CDB-125D-CANONICAL-LAB-RESULT-SPECIMEN-BACKFILL-RECONCILIATION`

Implement ten persistent caller-bounded resumable partitions and the fixed twenty-eight-check reconciliation receipt. Legacy source tables must remain read-only and second completed pass must create zero new business rows.
