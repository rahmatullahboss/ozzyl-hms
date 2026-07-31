# Emergency Canonical Admission Design

Date: 2026-07-31

## Problem review

The emergency dashboard exposed an `admitted` final disposition, but the emergency finalize endpoint only changed `er_patients.er_status` and `finalized_status`. It did not create an IPD admission, reserve admission idempotency, validate duplicate active admissions, write admission billing context, or establish canonical admission continuity. Emergency demographic editing also targeted the ER snapshot rather than making the canonical patient/master record easy to reach.

## Design

### Emergency to IPD

The emergency UI now uses the existing `/api/admissions` command boundary with:

- `admission_type = emergency`
- `admit_source = emergency`
- `is_emergency = true`
- `billing_mode = emergency`
- one stable idempotency key per admission attempt

That boundary already enforces tenant scope, roles, duplicate active-admission protection, bed allocation safety, audit logging, billing context, and `ensureLiveAdmissionContinuity` for the canonical admission/encounter projection. The ER case is finalized as admitted only after that admission exists. If the admission succeeds but ER finalization fails, the modal retains the admission reference and retries only the linkage; the admission endpoint's idempotency key also makes transport retries safe.

A bed remains optional for emergency lifesaving intake. Bed or ward assignment can be completed later through the standard IPD workflow.

### Patient details

Every emergency row, including finalized and admitted cases, exposes `Edit / Complete Patient Details`. Emergency-sourced rows in the IPD Admissions table also keep a direct `Edit Details` action visible regardless of admission status. Both actions open the existing patient master page for the same `patient_id`; no encounter-local patient copy is created. The API projects a `profile_incomplete` indicator from patient master demographics so staff can identify emergency placeholder profiles without blocking admission.

### Server invariant

`PUT /api/emergency/:id/finalize` now rejects `finalized_status = admitted` unless the same tenant and patient have a real active admission. This prevents legacy or alternate clients from recreating the former false-admission state. ER disposition changes are also audit logged with the linked admission identifier.

## Canonical boundary

This change does not add a new legacy admission writer or duplicate admission SQL. It reuses the admission command that performs canonical live-admission continuity. Active-admission discovery is routed through the existing admission provider: legacy/shadow modes preserve the selected compatibility authority, while canonical mode reads `canonical_tenant_patient_links` and `canonical_admissions` without reading the legacy admissions table. The existing ER compatibility row continues to be updated for current runtime compatibility, but it cannot claim admission without the canonical-continuity admission command succeeding first. The separate canonical emergency-case route activation remains governance-gated and is not implicitly enabled by this feature.

No migration is required because the admission source/type/emergency fields, patient linkage, idempotency storage, audit storage, and canonical continuity mappings already exist.

## Failure and concurrency behavior

- Duplicate or concurrent admission attempts are blocked or replayed by the admission command.
- An already active admission is linked instead of duplicated.
- Missing patient linkage returns a conflict response.
- Unauthorized admission attempts remain rejected by the admission route role checks.
- Tenant and patient lookups remain tenant scoped.
- Incomplete patient details do not block urgent admission.
