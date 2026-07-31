# P12 Canonical Radiology Acquisition and Report Commands Receipt

**Checkpoint:** `CDB-126C-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-COMMANDS-VERIFIED`

**Date:** 2026-07-28

**Status:** completed and verified locally; uncommitted because the active connector exposes no Git commit action

## Command module

`src/lib/canonical/commands/manage-radiology-acquisition-report.ts`

## Sixteen atomic commands

Acquisition lifecycle:

1. `registerCanonicalImagingAcquisition`
2. `startCanonicalImagingAcquisition`
3. `completeCanonicalImagingAcquisition`
4. `cancelCanonicalImagingAcquisition`
5. `enterCanonicalImagingAcquisitionInError`

DICOM hierarchy and provenance:

6. `registerCanonicalImagingStudy`
7. `registerCanonicalImagingSeries`
8. `registerCanonicalImagingInstance`
9. `recordCanonicalImagingProvenance`

Report version and signature lifecycle:

10. `createCanonicalImagingReportDraft`
11. `replaceCanonicalImagingReportDraft`
12. `verifyCanonicalImagingReportVersion`
13. `finalizeAndPublishCanonicalImagingReportVersion`
14. `correctCanonicalImagingReportVersion`
15. `retractCanonicalImagingReportVersion`
16. `enterCanonicalImagingReportInError`

## Verified command guarantees

- every command is tenant-scoped and uses an explicit idempotency key;
- the full operation fingerprint is stable and the replay receipt is read before mutable-state validation;
- replay returns the original result after current state advances;
- reusing an idempotency key with changed input fails as an idempotency conflict;
- exact patient link, encounter, service request/event, imaging service, practitioner, acquisition, study, series, instance, report, source, content hash, and storage scope is required;
- accession, modality, patient/name/time proximity, descriptions, counts, object keys, or report-text similarity never establish identity;
- acquisition registration creates the header, initial immutable event, current pointer, source mapping, receipt, and PHI-minimised outbox atomically;
- acquisition start, completion, cancellation, and entered-in-error transitions use expected status version and immutable lifecycle events;
- completion requires an exact posted service event and active performer;
- study, series, and SOP instance registrations require exact UID hierarchy and tenant scope;
- the same SOP Instance UID with a changed object content SHA-256 fails as a collision instead of overwriting accepted evidence;
- accepted object content hash and storage provider/key/generation remain immutable;
- provenance records exact modality, AE, PACS endpoint, transfer, object hash, storage, disposition, actor, and time evidence without raw DICOM pixel data;
- report creation atomically creates report set, complete immutable version, initial status event, current pointers, source mapping, receipt, and outbox;
- draft replacement and correction create complete replacement versions and preserve prior clinical content;
- verification, finalisation, and publication bind exact active practitioners to the exact content SHA-256;
- retraction and entered-in-error create replacement versions and preserve all prior content, signatures, and lineage;
- compatibility statements, Canonical facts, mappings, receipts, and outbox rows commit or roll back together;
- injected statement failure rolls the complete D1 batch back.

## Verification

- focused command contract: 1 file, 6 grouped tests passed, covering all sixteen commands;
- CDB-126A–C focused suite: 3 files, 20 tests passed;
- `pnpm exec tsc --noEmit`: passed;
- `pnpm build:migrations`: passed with 494 migrations;
- schema governance, continuity, and worktree policy: 3 files, 21 tests passed.

## Safety state

- runtime routes changed: no;
- provider or adapter created/enabled: no;
- production query or mutation: no;
- production migration or backfill: no;
- local sync activation: no;
- push or main integration: no;
- legacy writer freeze or retirement: no.

## Next checkpoint

`CDB-126D-CANONICAL-RADIOLOGY-ACQUISITION-REPORT-BACKFILL-RECONCILIATION`

Implement ten persistent caller-bounded resumable partitions and the fixed thirty-check reconciliation. Keep every legacy requisition, report, DICOM study, RIS queue, film, invoice, storage, and audit source read-only. Ambiguous or missing DICOM hierarchy must create deterministic non-PHI processing issues. A second completed pass must create zero new business rows.
