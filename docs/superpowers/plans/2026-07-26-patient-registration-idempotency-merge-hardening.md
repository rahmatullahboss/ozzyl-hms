# Patient Registration Idempotency and Merge Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee at-most-once patient registration for retried requests and make patient merge atomic, reversible, and safe around immutable accounting evidence.

**Architecture:** Store a nullable tenant-scoped registration attempt key on the patient row as the final duplicate-delivery guard. Continue using the shared mutation-idempotency table for request-hash validation and response replay. Merge uses a reviewed static reference registry and records row maps before reference reassignment inside one D1 batch.

**Tech Stack:** TypeScript, Hono, Zod, Drizzle ORM, Cloudflare D1, React, TanStack Query, Vitest.

## Global Constraints

- Preserve tenant, role, and permission boundaries.
- Do not touch unrelated dirty-worktree changes.
- Verified accounting journal lines remain immutable.
- Weak demographic matches are not auto-merged.
- Use failing tests before implementation and a checkpoint commit after each task.

---

### Task 1: Durable Registration Schema

**Files:**
- Create: `migrations/0540_patient_registration_idempotency.sql`
- Modify: `src/db/schema/schema.ts`
- Modify: `tenant-schema.sql`
- Test: `test/patient-registration-idempotency-schema.test.ts`

- [ ] Write a failing contract test asserting a new nullable `patients.registration_idempotency_key` and a unique partial index on `(tenant_id, registration_idempotency_key)`.
- [ ] Run `pnpm exec vitest run test/patient-registration-idempotency-schema.test.ts`; expect failure.
- [ ] Add migration 0433 with the patient column and tenant-scoped partial unique index only.
- [ ] Map the new field as `registrationIdempotencyKey` in Drizzle and mirror the column/index in `tenant-schema.sql`.
- [ ] Re-run the test; expect pass.
- [ ] Commit with `feat(patients): add durable registration idempotency key`.

### Task 2: Recoverable Shared Idempotency State

**Files:**
- Modify: `src/lib/request-idempotency.ts`
- Test: `test/request-idempotency.test.ts`

**Interfaces:**

```ts
export type MutationIdempotencyState = {
  requestHash: string;
  status: 'pending' | 'completed' | 'failed';
  sourceId: string | null;
  responseBody: Record<string, unknown> | null;
};
```

- [ ] Write failing tests for completed replay, same-hash failed-row reclaim, and different-hash conflict.
- [ ] Run `pnpm exec vitest run test/request-idempotency.test.ts`; expect failure.
- [ ] Add a state reader returning request hash, status, source ID, and parsed response.
- [ ] Add a guarded reclaim update that changes only a same-hash `failed` row back to `pending`, clearing source and response fields.
- [ ] Re-run the focused test; expect pass.
- [ ] Commit with `fix(idempotency): support durable mutation recovery`.

### Task 3: Recovery-Safe Patient Registration

**Files:**
- Create: `src/lib/patient-registration-idempotency.ts`
- Modify: `src/schemas/patient.ts`
- Modify: `src/routes/tenant/patients.ts`
- Test: `test/patient-registration-linking.test.ts`

**Interfaces:**

```ts
export const PATIENT_REGISTRATION_MUTATION = 'patient_registration';

export type PatientRegistrationAttempt =
  | { kind: 'new'; ownsReservation: boolean; key: string | null; requestHash: string | null }
  | { kind: 'replay'; responseBody: Record<string, unknown> }
  | { kind: 'recover'; patientId: number; key: string; requestHash: string };
```

- [ ] Add optional trimmed registration-attempt key validation with length 8–128.
- [ ] Write failing route tests: completed replay performs no insert; changed payload with the same key returns 409; a durable patient recovers from pending/failed state; duplicate warning occurs before reservation; successful create stores and completes the key.
- [ ] Run `pnpm exec vitest run test/patient-registration-linking.test.ts`; expect only the new tests to fail.
- [ ] Hash the normalized patient request with the attempt key omitted.
- [ ] After duplicate-warning handling, reserve/replay/recover the attempt. Query recovery by tenant plus `registration_idempotency_key`.
- [ ] Include `registrationIdempotencyKey` in the initial patient insert.
- [ ] Complete the shared idempotency row with the full response. Mark only an owned reservation failed and preserve existing HTTP exceptions.
- [ ] Make serial finalization retry-safe by reading an existing registration serial first and inserting only when none exists; do not add a patient/date uniqueness constraint because repeat same-day visits may be legitimate.
- [ ] Run patient and idempotency tests; expect pass.
- [ ] Commit with `fix(patients): make registration retry safe`.

### Task 4: Stable Web Attempt Key

**Files:**
- Modify: `web/src/pages/PatientForm.tsx`
- Test: `web/src/pages/PatientForm.idempotency.test.tsx`

- [ ] Write a failing test proving transport retries reuse one key while a successful/new/materially changed attempt rotates it.
- [ ] Run `pnpm --filter web exec vitest run src/pages/PatientForm.idempotency.test.tsx`; expect failure.
- [ ] Store the active key in a React ref. Include it only for patient creation, never edit.
- [ ] Keep it across network retries; rotate after success, explicit reset, or duplicate-warning override that changes the request.
- [ ] Re-run the web test; expect pass.
- [ ] Commit with `fix(web): reuse patient registration attempt keys`.

### Task 5: Atomic Merge Mapping and Confirmation Replay

**Files:**
- Modify: `src/lib/mpi-merge.ts`
- Modify: `src/routes/tenant/patientDuplicates.ts`
- Test: `test/mpi-merge.test.ts`

- [ ] Write failing tests proving repeated preview stores the returned token hash, row maps precede updates, maps contain only secondary-owned rows, replay reports original moved counts, and secondary becomes inactive/linked to primary.
- [ ] Run `pnpm exec vitest run test/mpi-merge.test.ts`; expect failure.
- [ ] Update preview conflict handling to replace token hash, payload, and expiry while preserving applied replay state.
- [ ] Build one D1 batch in this order: merge-log insert; per-reference map insert; corresponding reference update; secondary patient state update; count update; confirmation-applied update.
- [ ] Resolve merge-log IDs inside map statements by tenant plus request hash, so mapping remains atomic and occurs before reassignment.
- [ ] Remove the duplicate route-level table list and reuse shared registry/count logic.
- [ ] Re-run merge tests; expect pass.
- [ ] Commit with `fix(mpi): make patient merge mapping atomic`.

### Task 6: Complete Patient Reference Registry

**Files:**
- Create: `src/lib/patient-reference-registry.ts`
- Modify: `src/lib/mpi-merge.ts`
- Test: `test/patient-reference-registry.test.ts`
- Test: `test/mpi-merge.test.ts`

**Interfaces:**

```ts
export type PatientReferencePolicy = 'move' | 'retain_verified_accounting';
export type PatientReferenceDefinition = {
  table: string;
  column: string;
  tenantColumn: string;
  policy: PatientReferencePolicy;
};
```

- [ ] Write a failing SQLite/schema coverage test that discovers tenant-scoped patient references and requires every one in the registry or an explained exclusion list.
- [ ] Explicitly cover alternative columns such as legacy, family parent/child, and cross-hospital local patient IDs where tenant scope is unambiguous.
- [ ] Run `pnpm exec vitest run test/patient-reference-registry.test.ts`; expect missing-reference failures.
- [ ] Populate the reviewed registry from current schema. Exclude merge log/audit/confirmation identity fields from movement.
- [ ] Assign verified accounting lines the retain policy. Move only accounting rows whose voucher is not verified, and include retained counts in audit metadata.
- [ ] Run registry and merge tests; expect pass.
- [ ] Commit with `fix(mpi): cover patient references safely`.

### Task 7: Verification and Runbook

**Files:**
- Create: `docs/operations/patient-registration-idempotency-merge-runbook.md`

- [ ] Document migration order, pending/failed registration-attempt queries, merge preview/apply/rollback, backup requirements, and immutable-accounting behavior.
- [ ] Run focused backend tests for schema, shared idempotency, patient registration, merge, and registry coverage; expect zero failures.
- [ ] Run the focused PatientForm web test; expect pass.
- [ ] Run `pnpm exec tsc --noEmit`; expect exit 0.
- [ ] Run `pnpm build:migrations`; expect migration 0433 in the generated manifest.
- [ ] Inspect the final diff, commit the runbook, and verify the isolated worktree is clean.
