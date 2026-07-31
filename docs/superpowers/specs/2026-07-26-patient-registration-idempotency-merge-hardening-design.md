# Patient Registration Idempotency and Merge Hardening Design

Date: 2026-07-26

## Problem

Normal `POST /api/patients` does not use the shared mutation-idempotency system. The duplicate-warning query reduces accidental duplicates but cannot protect against double delivery, browser/network retries, or a retry after a partial server failure. The current merge pipeline also has correctness gaps: incomplete patient-reference coverage, confirmation-token replacement bugs, record maps created after reassignment, and unsafe handling of immutable verified accounting rows.

## Goals

1. The same patient-registration attempt must create at most one patient.
2. Reusing the same key with a different payload must fail deterministically.
3. A retry after an interrupted request must recover the already-created patient and return a stable response.
4. Patient merge must map only rows actually moved, update all supported patient references atomically, preserve immutable evidence, and remain reversible/auditable.
5. Existing clients without an idempotency key remain temporarily compatible, while the HMS web client always sends one.

## Chosen Approach

### Registration

Add nullable `registration_idempotency_key` to `patients` with a unique tenant-scoped partial index. The browser generates one stable key per submit attempt and reuses it until the attempt succeeds or the user changes the request after a duplicate warning.

The route will:

1. Run duplicate-warning validation before reserving the key, so a warning does not poison the attempt.
2. Hash the normalized request without the key.
3. Read/reserve the shared mutation idempotency row.
4. If a completed response exists, replay it.
5. If the idempotency row is pending/failed, look up `patients.registration_idempotency_key`:
   - found: reconstruct/finalize the response and complete the idempotency record;
   - not found and failed: safely reclaim the same key for the same request hash;
   - not found and pending: return an in-progress conflict.
6. Insert the patient with the registration key. The database unique index is the final at-most-once guard.
7. Complete the shared idempotency row with the response.

Downstream finalization operations must be retry-safe. Recovery first reads an existing registration serial for the durable patient; it creates a serial only when none exists. No patient/date uniqueness constraint is added because multiple same-day visits may be legitimate.

### Merge

Keep a static, reviewed patient-reference registry rather than runtime table discovery because D1 restricts dynamic PRAGMA/table introspection and runtime-generated identifiers are difficult to secure. The registry supports per-reference policies:

- normal movable patient references;
- verified accounting journal lines retained as immutable historical evidence;
- special patient-id column names handled explicitly where tenant scoping is unambiguous.

Merge apply will execute one D1 batch that:

1. inserts/fetches the merge log by request hash;
2. records column-aware `patient_merge_record_map` rows before changing references while retaining the legacy map for old rollback records;
3. reassigns movable references;
4. deactivates and marks the secondary patient as merged;
5. writes actual per-table counts;
6. marks confirmation applied using the merge-log request hash.

The preview upsert replaces the confirmation-token hash so a repeated preview returns a usable token. Applied confirmations remain replayable. Rollback uses precise map rows and retains a defensive legacy fallback.

## Data and Migration Changes

- Add `patients.registration_idempotency_key TEXT`.
- Add unique partial index on `(tenant_id, registration_idempotency_key)` where the key is not null/empty.
- Do not add a patient/date serial uniqueness constraint; recovery queries the patient's existing registration serial before creating one.
- Update Drizzle schema and fresh tenant baseline.
- Do not change immutable verified accounting journal lines.

## Authorization and Audit

Patient creation keeps `patients:write`. Merge remains restricted to hospital admin, MD, and super admin. Idempotency data stores hashes, keys, source IDs, and response metadata only. Merge preview/apply/rollback remain audited; logs must not include patient clinical payloads.

## Error Handling

- Same key, different request: HTTP 409.
- Same key currently pending with no durable patient: HTTP 409 retry-later.
- Durable patient found after interrupted request: recover and replay HTTP 201.
- Merge conflict or reference uniqueness failure: the D1 batch aborts without partial reference movement.
- Active admission blocks merge.

## Testing

1. Registration: same key/same payload replays one patient.
2. Registration: same key/different payload returns 409.
3. Registration: interrupted request with durable patient recovers without a second insert.
4. Registration: duplicate warning does not reserve/consume the key.
5. Frontend: double submit/retry reuses the same key; success or materially changed retry rotates it.
6. Merge: repeated preview token works.
7. Merge: map rows are captured before reassignment and exclude primary pre-existing rows.
8. Merge: verified accounting lines remain unchanged; movable rows transfer.
9. Merge: confirmation and merge log are idempotent on replay.
10. Registry coverage test detects tenant-scoped patient-reference tables missing from the reviewed registry/exclusion list.

## Scope Boundaries

This change does not automatically merge weak same-name/same-mobile candidates with differing demographics. It does not rewrite the full patient-registration domain into a new service or introduce a Durable Object; the D1 unique key is sufficient for the current write contention and remains the authoritative at-most-once guard.
