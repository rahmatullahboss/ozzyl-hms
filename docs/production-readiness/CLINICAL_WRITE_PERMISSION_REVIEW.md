# Clinical Write Permission Review

**Review date:** 2026-07-12  
**Readiness task:** W0-02 — RBAC, Clinical Write Permission, Approval and Audit Review  
**Reviewed sub-gate:** P0 clinical mutation route-level authorization  
**Sub-gate verdict:** `PASS`  
**Broader W0-02 verdict:** `REVIEW PENDING`

## Scope reviewed

This review covered route-level authorization and tenant/object isolation for the critical clinical write families used in the first hospital pilot:

- vitals
- allergies
- diagnosis
- clinical notes
- assessments
- care plans
- active medications and medication reconciliation
- prescription creation, locking, safety override and fulfilment
- e-prescribing safety checks and safety-override audit paths
- other `/api/clinical/*` resources through explicit route rules

The broader W0-02 task still includes approval segregation, privileged-user scenarios, immutable audit behavior and hospital-specific role-matrix sign-off.

## Findings closed

### 1. Broad clinical permission fallback removed

Previously, `/api/clinical/*` used a broad `note:read` / `note:write` fallback. That allowed unrelated clinical resources such as diagnosis, medication and care-plan routes to share one permission.

The central route matrix now has explicit rules for assessments, problems, history, diagnosis, diet, glucose, care plans, forms, SDOH, ROS, eye examinations, vitals, allergies, medications, notes, images and encounters. Unknown `/api/clinical/*` paths have no rule and are denied.

### 2. Critical clinical enforcement cannot be disabled by the rollout flag

The following prefixes are now always enforced by the central route-permission middleware, even when `RBAC_CENTRAL_ROUTE_MODE=off` or `shadow`:

- `/api/clinical`
- `/api/vitals`
- `/api/allergies`
- `/api/prescriptions`
- `/api/e-prescribing/patient`
- `/api/e-prescribing/check-safety`
- `/api/e-prescribing/safety-checks`
- `/api/e-prescribing/safety-overrides`
- `/api/prescription-fulfilment`

Non-clinical prefixes continue to follow the environment-controlled rollout mode.

### 3. Least-privilege default roles established

- Doctor receives granular clinical charting, prescription, medication-reconciliation and safety-check permissions. Prescription safety override remains explicit.
- `md` is the Managing Director role in this repository and receives no new clinical, prescription or safety-override permission by default; hospital-specific clinical access requires an explicit reviewed override.
- Nurse receives clinical reads and nursing-appropriate writes, but not diagnosis, active-medication reconciliation or prescription write by default.
- Pharmacist receives allergy/medication reads, medication reconciliation and prescription fulfilment, but not prescription authoring or safety override.
- Reception receives prescription read only; reception and accounting roles receive no clinical mutation permissions.
- Tenant role overrides and per-user grants/revocations remain applicable. Legacy plural `prescriptions:*` and pharmacy permissions are expanded only for reviewed clinical tenant-role overrides, before per-user revocations are applied. Static management roles are not inferred as clinical roles, explicit revocations remain effective, and the sensitive safety override is never derived from a broad legacy permission.

### 4. Cross-tenant clinical creation blocked

Clinical create routes now prove that the patient belongs to the authenticated tenant before inserting data. Optional related IDs are also validated against the same tenant and patient:

- visit: `id + patient_id + tenant_id`
- encounter: `id + patient_id + tenant_id`
- prescription: `id + patient_id + tenant_id`
- formulary item: `id + tenant_id + is_active`

The e-prescribing active-medication and safety-check paths now validate patient, optional prescription and optional formulary IDs before seed, safety or insert work begins. Unknown, foreign-tenant and mismatched IDs return 404 without revealing whether another tenant owns the resource.

### 5. Prescription route compatibility and safety elevation corrected

The mandatory permission matrix now matches the actual `/api/prescriptions/override-safety` route. Built-in roles use granular singular `prescription:*` permissions. Existing clinical tenant-role overrides retain ordinary read/write/fulfilment behavior through revocation-safe permission expansion in the resolver; central route checks accept only the resolved granular permission or wildcard. Broad legacy permissions do not unlock safety override.

### 6. Existing-record mutation isolation verified

Critical update/delete routes already query records using both record ID and tenant ID. Automated route tests prove a foreign record ID returns 404 and no update executes.

## Automated evidence

### Focused authorization and isolation suite

Command:

```bash
pnpm exec vitest run test/authz.test.ts test/unit/route-permissions.test.ts test/integration/rbac-overrides.test.ts test/integration/routes/clinical/clinical-cross-tenant-create.test.ts test/integration/routes/clinical/clinical-cross-tenant-mutation.test.ts
```

Result:

- 5 test files passed
- 106 tests passed
- 0 failed

### TypeScript verification

Command:

```bash
pnpm exec tsc --noEmit
```

Result: exit code 0.

### Complete repository test suite

Command:

```bash
pnpm test
```

Result:

- 831 test files passed
- 15,310 tests passed
- 0 failed

The suite emitted expected stderr from stubbed provider failures, deliberate database-error tests and deprecation warnings; the command completed with exit code 0.

### Production build

Command:

```bash
pnpm build
```

Result: exit code 0. Migration manifest generation, main web build, patient/lifestyle build and admin-panel build completed successfully. The build emitted non-blocking chunk-size and Vite deprecation warnings; no additional tracked source diff was produced.

## TDD evidence

- Explicit clinical-route tests initially failed because the broad `note:*` fallback was selected.
- Role and mandatory-enforcement tests initially failed because granular role grants were absent.
- Six of seven foreign-patient create cases initially returned 201; the original medication route was already protected.
- Five foreign/mismatched visit or encounter cases initially returned 201; the original medication prescription link was already protected.
- Adversarial review found singular/plural prescription permission drift and a route-pattern mismatch for the real `override-safety` endpoint; compatibility and sensitive-action tests failed before the fix.
- A second adversarial pass found that `md` means Managing Director in this repository, not medical doctor; role tests failed until unintended clinical, prescription and safety-override grants were removed.
- The same pass reproduced a legacy-compatibility bypass where a granular user revocation could be re-granted by a broad legacy permission. Resolver tests now prove revocations win while independently sourced read access remains intact.
- Medication reconciliation, safety-check and fulfilment routes initially lacked mandatory fine-grained coverage.
- E-prescribing initially accepted foreign patient, prescription and formulary IDs on active-medication and safety-check paths; regression tests reproduced these failures before guards were added.
- One existing safety-route fixture then failed because the new ownership contract was not represented; the fixture was corrected and the full suite reran green.

## Changed implementation areas

- `src/lib/route-permissions.ts`
- `src/lib/route-permissions.js`
- `packages/shared/src/authz.ts`
- `src/middleware/rbac.ts`
- `src/lib/clinical-tenant-guards.ts`
- critical clinical route files under `src/routes/tenant/clinical/`
- `src/routes/tenant/ePrescribing.ts`
- authorization, prescription compatibility, safety and cross-tenant regression tests

## Remaining W0-02 work

The clinical mutation route-level P0 sub-blocker is closed. The following work remains before the entire W0-02 task can receive a final PASS:

- approval segregation and maker/checker scenarios
- audit immutability and privileged-user event review
- break-glass/emergency-access behavior, if enabled
- hospital-specific named role matrix and least-privilege sign-off
- manual multi-role verification in the selected test tenant

No included clinical module is marked `READY` from this engineering review alone.
