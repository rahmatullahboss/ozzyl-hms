# LIS Clinical Release Safety Specification

Date: 2026-08-11
Scope: Laboratory / LIS only
Status: Implementation contract

## 1. Purpose

This specification defines the safety boundary for verifying, validating, publishing, printing, communicating, correcting, and retracting clinical laboratory results. A result that entered through a safe analyzer-ingestion path MUST NOT become unsafe later through a weaker legacy/report route.

The clinical release boundary is fail-closed. If the system cannot prove that every required invariant is satisfied, release/print/portal communication is denied and the report remains held for review.

## 2. Non-goals

- No billing/accounting redesign.
- No unrelated patient, pharmacy, radiology, or reporting work.
- No destructive rewrite of historical laboratory records.
- No automatic inference of clinical thresholds or safety configuration.

## 3. Authoritative release boundary

There SHALL be one domain-level clinical release authority. HTTP routes, UI handlers, analyzer handlers, scheduled jobs, and report-print endpoints may request a release decision but may not directly mark a report/result as released/published/verified in a way that bypasses the authority.

Direct SQL writes that make a report clinically releasable are forbidden outside the authority and explicit migration/backfill tooling.

## 4. Release invariants

A final release MUST atomically prove all applicable invariants below.

### 4.1 Identity and tenant isolation

- The report belongs to the authenticated tenant.
- The report, lab order, order item, patient, visit/episode, accession/specimen, test, component, and result links are mutually consistent.
- Cross-tenant IDs are rejected even when numerically valid.

### 4.2 Specimen integrity

- Required specimens exist and are in an allowed terminal pre-release state.
- Rejected, cancelled, superseded, recollection-pending, or otherwise invalid specimens cannot be released.
- Accession/specimen identity used at verification is the same identity used at release.

### 4.3 Result completeness

- Every mandatory ordered analyte/component has a final result or an explicitly governed non-result disposition allowed by policy.
- No mandatory component is silently omitted.
- Result value/type/unit/method are valid for the configured test/component.

### 4.4 Exact verified snapshot

Verification binds an immutable deterministic snapshot of the clinical content the verifier reviewed.

The snapshot SHALL include, as applicable:

- tenant, patient, episode/visit, order, order item, report, specimen/accession IDs;
- result IDs and immutable/result-version identifiers;
- analyte/component IDs;
- result value and numeric representation;
- unit;
- method/analyzer identity;
- reference interval and critical interval actually applied;
- abnormal/critical flags;
- result/collection timestamps;
- QC, calibration, reagent/control-lot evidence identifiers/versions;
- validation rule-set/version;
- verifier identity and verification timestamp.

A deterministic versioned digest (for example SHA-256 over canonical JSON) SHALL bind the snapshot. Release fails if current clinical content does not exactly match the verified snapshot/version/digest.

### 4.5 QC, calibration and lot safety

When required by the test/method/analyzer policy:

- QC exists, is current, and passed;
- calibration exists, is current, and is in tolerance;
- reagent/control lots are valid, active, and unexpired;
- stale/missing/failed evidence is a hard hold, not a warning-only condition.

### 4.6 Validation rules fail closed

- Safety-critical rule configuration must parse and validate successfully.
- Missing required configuration, malformed JSON/rules, unknown operators, or evaluation system errors hold/quarantine the result.
- A rule engine failure must never be converted to “rule skipped, result accepted”.

### 4.7 Critical thresholds

Critical thresholds may come only from approved configuration/versioned reference data. The system MUST NOT fabricate or infer a critical low/high threshold from the normal reference range.

If a critical threshold is required but not configured, the system records `critical_threshold_not_configured` and requires manual governed review; it does not synthesize a threshold.

### 4.8 Critical-result communication

Where policy requires communication before/at release, the workflow is closed-loop:

`detected -> notification attempted -> recipient identified -> read-back/acknowledgement recorded -> closed`

Required fields include recipient, notifier, channel, timestamps, acknowledgement/read-back evidence, and escalation outcome. An unresolved critical communication cannot be treated as completed merely because a notification was queued/sent.

### 4.9 Separation of duties

Where configured, the verifier and final validator/releaser MUST be different authenticated users. Actor identity is obtained from trusted authentication context; caller-supplied actor IDs are not authoritative.

### 4.10 Idempotency and concurrency

- Replaying the same release request is idempotent and cannot duplicate audit/outbox side effects.
- A concurrent change to report/result/specimen/QC evidence causes an optimistic-concurrency failure and forces re-review.
- Release is a compare-and-set style state transition; no lost update is allowed.

### 4.11 Atomic audit/outbox

The final state transition, immutable release evidence, audit record, and critical/domain outbox event are committed atomically where the storage platform permits. A partial publish with missing audit/outbox evidence is forbidden.

## 5. Printing, portal and external communication

A printable/final patient-facing report is a clinical release surface, not a harmless read endpoint.

- Final report print/download/portal delivery requires a currently valid released snapshot.
- Draft/preliminary output must be explicitly watermarked and permission-restricted.
- Printed/generated artifacts bind the release snapshot/version/digest.
- A correction/retraction invalidates stale final artifacts and patient-facing “current” pointers.

## 6. Corrections and amendments

Published clinical content is immutable history.

A correction creates a new version/supersession record that references the prior version and records reason, actor, timestamps, and changed fields. Previous release evidence remains queryable. The corrected version requires the configured verification/release workflow again.

No correction silently rewrites historical released values as if the previous result never existed.

## 7. Retraction

Retraction is explicit, audited, tenant-scoped and irreversible as history. Downstream patient/doctor/external views must no longer present the retracted release as current. Any re-release is a new governed version.

## 8. Machine-readable failure model

Clinical release failures use stable codes, including at minimum:

- `report_not_found`
- `report_retracted`
- `tenant_mismatch`
- `specimen_invalid`
- `mandatory_result_missing`
- `verified_snapshot_missing`
- `verified_snapshot_changed`
- `qc_missing_or_stale`
- `qc_failed`
- `calibration_missing_or_stale`
- `calibration_failed`
- `reagent_or_control_lot_invalid`
- `validation_configuration_invalid`
- `validation_failed`
- `critical_threshold_not_configured`
- `critical_communication_incomplete`
- `separation_of_duties_violation`
- `release_version_conflict`

The API may map these to 409/422/403 as appropriate, but MUST NOT collapse safety failures into generic success or silently continue.

## 9. Adversarial acceptance scenarios

The production safety suite MUST prove that release fails for:

1. result changed after verification;
2. component added/removed after verification;
3. wrong/cross-tenant report ID;
4. rejected or recollection-pending specimen;
5. missing mandatory component;
6. stale/failed/missing QC;
7. stale/out-of-tolerance calibration;
8. expired/invalid reagent or control lot;
9. malformed/unknown validation rule configuration;
10. validation engine system error;
11. same verifier and releaser when SoD is required;
12. unresolved required critical-result communication;
13. duplicate/replayed release request creating duplicate side effects;
14. concurrent validator race;
15. correction followed by use of an old final artifact;
16. direct legacy endpoint attempting to bypass the release authority;
17. final print/portal fetch before release;
18. missing critical threshold when policy requires one.

## 10. Production gate

Unrestricted patient-impacting production remains NO-GO until:

- all P0 invariants above are implemented;
- all known direct publish/verify/final-print bypasses are removed or fail-closed;
- the LIS clinical-safety suite is part of the production CI gate;
- migration/schema compatibility is proven on current main;
- a supervised pilot produces acceptable parity and operational evidence.

## 11. Compatibility rule for this reference branch

This document is being authored against the accessible repository snapshot. The user’s newer local Laboratory worktree remains the source that must be rebased/reconciled before integration. Any code from this reference branch is transplant material until the current local branch is verified and its tests pass.