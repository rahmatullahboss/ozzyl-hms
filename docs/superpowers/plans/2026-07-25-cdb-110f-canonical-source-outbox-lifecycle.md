# CDB-110F Canonical Source Outbox Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed offline claim, retry, dead-letter, expired-lease recovery, and publication-acknowledgement lifecycle for allowlisted `canonical_outbox_events` without connecting transport or runtime consumers.

**Architecture:** Add lease and evidence columns directly to the canonical outbox, protect semantic fields with triggers, and expose one isolated lifecycle module. Candidate selection is allowlisted and strictly ordered per aggregate; conversion occurs before claim; publication reconverts and compares the exact authenticated envelope; all state transitions use guarded SQL plus `canonical_sync_batch_assertions`.

**Tech Stack:** TypeScript, SQLite/D1-compatible SQL, Node `node:sqlite` test harness, Vitest, existing canonical sync protocol/projector/converter modules.

## Global Constraints

- Work only in `program/cdb-main-continuous-20260725` and its dedicated worktree.
- Keep the dirty owner-facing root checkout read-only.
- Main may be merged into CDB; CDB must not be merged or cherry-picked into main.
- No route, worker, scheduler, transport, network delivery, production access, feature activation, legacy retirement, push, or deployment.
- `localCanonicalOutboxConsumption`, `runtimeConsumptionConnected`, `businessApplyConnected`, and `activationAuthorized` remain `false`.
- Convert source authority before claiming so invalid events remain untouched.
- Preserve strict per-aggregate publication order; unrelated aggregates may progress.
- Every mutable lifecycle transition must assert exactly one affected row inside one database batch.
- Use stable public IDs, UTC timestamps, lowercase SHA-256 evidence, and bounded stable error codes/summaries.

---

### Task 1: Additive outbox lifecycle schema and invariants

**Files:**
- Create: `migrations/0543_canonical_sync_outbox_lifecycle.sql`
- Create: `test/canonical/canonical-sync-outbox-lifecycle-migration.test.ts`

**Interfaces:**
- Consumes: `canonical_outbox_events` from `migrations/0505_canonical_program_foundation.sql`; `canonical_sync_batch_assertions` from `migrations/0542_canonical_sync_inbox_lifecycle.sql`.
- Produces: columns `claim_public_id`, `claim_expires_at_utc`, `last_error_sha256`, `published_envelope_sha256`; lifecycle and immutability triggers; claimable index.

- [ ] **Step 1: Write the migration harness and failing lifecycle tests**

Create a Node SQLite harness that executes migrations `0505`, `0541`, `0542`, then the missing `0543`. Insert a normal pending event and assert these operations:

```ts
expect(columns(sqlite, 'canonical_outbox_events')).toEqual(expect.arrayContaining([
  'claim_public_id',
  'claim_expires_at_utc',
  'last_error_sha256',
  'published_envelope_sha256',
]));
```

Add tests that expect database errors for:

```sql
UPDATE canonical_outbox_events
SET status='processing',locked_at_utc='2026-07-25T10:00:00Z',locked_by='worker-1'
WHERE event_public_id='event-1';
```

because claim ID/expiry are missing; semantic mutation:

```sql
UPDATE canonical_outbox_events SET payload_json='{"changed":true}'
WHERE event_public_id='event-1';
```

and published state without fingerprint:

```sql
UPDATE canonical_outbox_events
SET status='published',published_at_utc='2026-07-25T10:00:00Z'
WHERE event_public_id='event-1';
```

Add positive tests for a fully evidenced processing row, retry row, dead-letter row, and published row.

- [ ] **Step 2: Run the migration test and confirm RED**

Run:

```bash
pnpm vitest run test/canonical/canonical-sync-outbox-lifecycle-migration.test.ts
```

Expected: FAIL because `migrations/0543_canonical_sync_outbox_lifecycle.sql` does not exist.

- [ ] **Step 3: Implement migration 0543**

Add columns with checks:

```sql
ALTER TABLE canonical_outbox_events
  ADD COLUMN claim_public_id TEXT CHECK (
    claim_public_id IS NULL OR (
      length(trim(claim_public_id)) BETWEEN 1 AND 160
      AND claim_public_id GLOB '*[^0-9]*'
    )
  );

ALTER TABLE canonical_outbox_events
  ADD COLUMN claim_expires_at_utc TEXT CHECK (
    claim_expires_at_utc IS NULL OR substr(claim_expires_at_utc, -1) = 'Z'
  );

ALTER TABLE canonical_outbox_events
  ADD COLUMN last_error_sha256 TEXT CHECK (
    last_error_sha256 IS NULL OR (
      length(last_error_sha256) = 64
      AND last_error_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  );

ALTER TABLE canonical_outbox_events
  ADD COLUMN published_envelope_sha256 TEXT CHECK (
    published_envelope_sha256 IS NULL OR (
      length(published_envelope_sha256) = 64
      AND published_envelope_sha256 NOT GLOB '*[^0-9a-f]*'
    )
  );
```

Create index:

```sql
CREATE INDEX IF NOT EXISTS idx_canonical_outbox_sync_claimable
ON canonical_outbox_events(
  tenant_id,status,available_at_utc,claim_expires_at_utc,
  aggregate_type,aggregate_public_id,id
);
```

Create `BEFORE INSERT` and `BEFORE UPDATE` lifecycle triggers enforcing:

```text
processing => claim_public_id, locked_at_utc, locked_by, claim_expires_at_utc present;
processing => claim_expires_at_utc > locked_at_utc;
non-processing => all claim/lock fields null;
published => published_at_utc and published_envelope_sha256 present;
non-published => published_at_utc and published_envelope_sha256 null;
retry/dead_letter => last_error_code and last_error_sha256 present;
pending/processing/published/cancelled => error code/hash/summary null.
```

Create an update trigger that aborts if any immutable semantic field changes:

```text
tenant_id,event_public_id,aggregate_type,aggregate_public_id,event_type,
event_version,payload_json,occurred_at_utc,business_date,idempotency_key,created_at_utc.
```

- [ ] **Step 4: Run migration tests and canonical migration manifest**

Run:

```bash
pnpm vitest run test/canonical/canonical-sync-outbox-lifecycle-migration.test.ts
pnpm build:migrations
```

Expected: migration tests PASS and manifest reports 474 migrations.

- [ ] **Step 5: Commit schema checkpoint**

```bash
git add migrations/0543_canonical_sync_outbox_lifecycle.sql \
  test/canonical/canonical-sync-outbox-lifecycle-migration.test.ts
git commit -m "feat(canonical): harden sync outbox lifecycle schema"
```

---

### Task 2: Deterministic allowlisted candidate conversion and claim

**Files:**
- Create: `src/lib/canonical/local-sync-outbox-lifecycle.ts`
- Create: `test/canonical/canonical-sync-outbox-lifecycle.test.ts`

**Interfaces:**
- Consumes:
  - `CanonicalBatchDatabase`, `CanonicalPreparedStatement` from `command-batch.ts`;
  - `createRequestFingerprint`, `stableCanonicalJson` from `idempotency.ts`;
  - `CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST`, `convertCanonicalOutboxEventToSyncEnvelope` from `local-sync-outbox-converter.ts`;
  - `CanonicalSyncEnvelope`, `validateCanonicalSyncEnvelope` from `local-sync-protocol.ts`.
- Produces:

```ts
export interface CanonicalSyncOutboxClaimReceipt {
  tenantId: string;
  eventPublicId: string;
  claimPublicId: string;
  claimOwnerPublicId: string;
  claimExpiresAtUtc: string;
  attemptCount: number;
  envelopeSha256: string;
  envelope: CanonicalSyncEnvelope;
}

export async function claimNextCanonicalSyncOutboxEnvelope(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    sourceNodePublicId: string;
    claimPublicId: string;
    claimOwnerPublicId: string;
    claimedAtUtc: string;
    claimExpiresAtUtc: string;
    maxAttempts: number;
  },
): Promise<CanonicalSyncOutboxClaimReceipt>;
```

- [ ] **Step 1: Write RED candidate/claim tests**

Build a harness that applies migrations `0505`, canonical entity migrations required by converter fixtures, `0541`, `0542`, and `0543`. Cover:

1. pending allowlisted event is converted and claimed;
2. unsupported earlier event is not selected;
3. later event of the same aggregate is blocked while its predecessor is not published;
4. a later unrelated aggregate may be claimed;
5. due retry is claimable, future retry is not;
6. expired processing lease is reclaimable when attempts remain;
7. active processing lease is not claimable;
8. conversion failure leaves status and attempts unchanged;
9. a second claim using stale candidate evidence fails atomically.

Expected receipt example:

```ts
expect(receipt).toMatchObject({
  tenantId: '100',
  eventPublicId: 'event-1',
  claimPublicId: 'claim-1',
  claimOwnerPublicId: 'worker-1',
  attemptCount: 1,
  envelope: {
    eventPublicId: 'event-1',
    sourceNodePublicId: 'node-local-1',
  },
});
expect(receipt.envelopeSha256).toMatch(/^[a-f0-9]{64}$/);
```

- [ ] **Step 2: Run focused test and confirm RED**

```bash
pnpm vitest run test/canonical/canonical-sync-outbox-lifecycle.test.ts
```

Expected: FAIL because lifecycle exports do not exist.

- [ ] **Step 3: Implement validation and assertion helpers**

Create:

```ts
export class CanonicalSyncOutboxStateError extends Error {
  readonly code = 'CANONICAL_SYNC_OUTBOX_STATE';
}

export class CanonicalSyncOutboxPublicationConflictError extends Error {
  readonly code = 'CANONICAL_SYNC_OUTBOX_PUBLICATION_CONFLICT';
}
```

Add validators for exact bounded strings, public IDs, UTC timestamps, positive safe integers, uppercase error codes, lowercase hashes, and sanitized summaries. Duplicate the proven `canonical_sync_batch_assertions` pattern from `local-sync-inbox.ts` in local private helpers:

```ts
prepareClearAssertions(db, tenantId, operationKey)
prepareAssertion(db, { tenantId, operationKey, stepKey, expectedChanges, createdAtUtc })
isAssertionError(error)
```

- [ ] **Step 4: Implement deterministic candidate selection**

Build allowlist SQL from `CANONICAL_SYNC_OUTBOX_EVENT_ALLOWLIST` as exact aggregate/event pairs. Select one candidate with:

```sql
SELECT e.event_public_id
FROM canonical_outbox_events e
WHERE e.tenant_id = ?
  AND (<allowlisted pair predicates>)
  AND e.processing_attempts < ?
  AND (
    (e.status = 'pending' AND e.available_at_utc <= ?)
    OR (e.status = 'retry' AND e.available_at_utc <= ?)
    OR (e.status = 'processing' AND e.claim_expires_at_utc <= ?)
  )
  AND NOT EXISTS (
    SELECT 1 FROM canonical_outbox_events predecessor
    WHERE predecessor.tenant_id = e.tenant_id
      AND predecessor.aggregate_type = e.aggregate_type
      AND predecessor.aggregate_public_id = e.aggregate_public_id
      AND predecessor.id < e.id
      AND predecessor.status <> 'published'
  )
ORDER BY e.id
LIMIT 1
```

Return `CanonicalSyncOutboxStateError` when no candidate exists.

- [ ] **Step 5: Convert before claim, then claim atomically**

Call:

```ts
const envelope = await convertCanonicalOutboxEventToSyncEnvelope(db, {
  tenantId: input.tenantId,
  eventPublicId: candidate.event_public_id,
  sourceNodePublicId: input.sourceNodePublicId,
});
const envelopeSha256 = await createRequestFingerprint(envelope);
```

Then batch:

```sql
UPDATE canonical_outbox_events
SET status='processing',claim_public_id=?,locked_by=?,locked_at_utc=?,
    claim_expires_at_utc=?,processing_attempts=processing_attempts+1,
    published_at_utc=NULL,published_envelope_sha256=NULL,
    last_error_code=NULL,last_error_summary=NULL,last_error_sha256=NULL,
    updated_at_utc=?
WHERE tenant_id=? AND event_public_id=?
  AND processing_attempts < ?
  AND (
    (status IN ('pending','retry') AND available_at_utc <= ?)
    OR (status='processing' AND claim_expires_at_utc <= ?)
  )
  AND NOT EXISTS (<same aggregate predecessor predicate>);
```

Assert exactly one change, clear assertion rows, reload the active claim, verify the attempt count, and return receipt + envelope.

- [ ] **Step 6: Run claim tests and TypeScript**

```bash
pnpm vitest run test/canonical/canonical-sync-outbox-lifecycle.test.ts
pnpm exec tsc --noEmit
```

Expected: all claim tests PASS and TypeScript passes.

- [ ] **Step 7: Commit claim checkpoint**

```bash
git add src/lib/canonical/local-sync-outbox-lifecycle.ts \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts
git commit -m "feat(canonical): add offline sync outbox claims"
```

---

### Task 3: Exact publication acknowledgement

**Files:**
- Modify: `src/lib/canonical/local-sync-outbox-lifecycle.ts`
- Modify: `test/canonical/canonical-sync-outbox-lifecycle.test.ts`

**Interfaces:**
- Consumes: `CanonicalSyncOutboxClaimReceipt` from Task 2.
- Produces:

```ts
export async function completeCanonicalSyncOutboxPublication(
  db: CanonicalBatchDatabase,
  input: {
    receipt: CanonicalSyncOutboxClaimReceipt;
    sourceNodePublicId: string;
    envelope: CanonicalSyncEnvelope;
    publishedAtUtc: string;
  },
): Promise<void>;
```

- [ ] **Step 1: Write RED publication tests**

Cover:

1. exact claimed envelope publishes and clears lease/error fields;
2. persisted `published_envelope_sha256` equals the claim fingerprint;
3. supplied payload/dependency/entity tampering throws `CanonicalSyncOutboxPublicationConflictError` and leaves row `processing`;
4. wrong claim ID, attempt count, owner, or expired lease rejects;
5. source semantic mismatch cannot be created because migration immutability trigger rejects it;
6. replayed publication cannot re-transition an already published row.

- [ ] **Step 2: Run the publication tests and confirm RED**

```bash
pnpm vitest run test/canonical/canonical-sync-outbox-lifecycle.test.ts -t publication
```

Expected: FAIL because `completeCanonicalSyncOutboxPublication` is missing.

- [ ] **Step 3: Implement reconversion and exact comparison**

Validate the supplied envelope, then reconvert:

```ts
const expected = await convertCanonicalOutboxEventToSyncEnvelope(db, {
  tenantId: input.receipt.tenantId,
  eventPublicId: input.receipt.eventPublicId,
  sourceNodePublicId: input.sourceNodePublicId,
});
const expectedSha256 = await createRequestFingerprint(expected);
if (
  expectedSha256 !== input.receipt.envelopeSha256
  || stableCanonicalJson(expected) !== stableCanonicalJson(input.envelope)
) {
  throw new CanonicalSyncOutboxPublicationConflictError(...);
}
```

- [ ] **Step 4: Implement guarded publication transition**

Batch an update plus assertion:

```sql
UPDATE canonical_outbox_events
SET status='published',published_at_utc=?,published_envelope_sha256=?,
    claim_public_id=NULL,claim_expires_at_utc=NULL,locked_at_utc=NULL,locked_by=NULL,
    last_error_code=NULL,last_error_summary=NULL,last_error_sha256=NULL,
    updated_at_utc=?
WHERE tenant_id=? AND event_public_id=?
  AND status='processing'
  AND claim_public_id=?
  AND locked_by=?
  AND claim_expires_at_utc>?
  AND processing_attempts=?;
```

Assert one change. Convert assertion failures to `CanonicalSyncOutboxStateError`.

- [ ] **Step 5: Run publication tests and full lifecycle file**

```bash
pnpm vitest run test/canonical/canonical-sync-outbox-lifecycle.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit publication checkpoint**

```bash
git add src/lib/canonical/local-sync-outbox-lifecycle.ts \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts
git commit -m "feat(canonical): acknowledge sync outbox publication"
```

---

### Task 4: Retry, dead-letter, and expired-lease recovery

**Files:**
- Modify: `src/lib/canonical/local-sync-outbox-lifecycle.ts`
- Modify: `test/canonical/canonical-sync-outbox-lifecycle.test.ts`

**Interfaces:**
- Produces:

```ts
export type CanonicalSyncOutboxFailureStatus = 'retry' | 'dead_letter';

export async function failCanonicalSyncOutboxPublication(
  db: CanonicalBatchDatabase,
  input: {
    receipt: CanonicalSyncOutboxClaimReceipt;
    failedAtUtc: string;
    nextAttemptAtUtc: string;
    maxAttempts: number;
    errorCode: string;
    errorSha256: string;
    errorSummary?: string | null;
  },
): Promise<CanonicalSyncOutboxFailureStatus>;

export async function recoverExpiredCanonicalSyncOutboxLease(
  db: CanonicalBatchDatabase,
  input: {
    tenantId: string;
    eventPublicId: string;
    recoveredAtUtc: string;
    maxAttempts: number;
    errorCode: string;
    errorSha256: string;
    errorSummary?: string | null;
  },
): Promise<CanonicalSyncOutboxFailureStatus>;
```

- [ ] **Step 1: Write RED failure/recovery tests**

Cover:

1. attempt below max transitions to due-future `retry` and clears lease;
2. attempt at max transitions to `dead_letter` with no retry schedule semantics beyond existing availability timestamp;
3. failure transition requires exact active unexpired receipt and attempt count;
4. retry time must be later than failure time;
5. expired lease cannot be failed by old owner;
6. recovery below max moves expired processing row to immediately due retry;
7. recovery at max dead-letters expired processing row;
8. active lease cannot be recovered;
9. later same-aggregate event remains blocked by retry/dead-letter predecessor;
10. unrelated aggregate remains claimable.

- [ ] **Step 2: Run failure tests and confirm RED**

```bash
pnpm vitest run test/canonical/canonical-sync-outbox-lifecycle.test.ts -t "retry|dead-letter|recover"
```

Expected: FAIL because failure/recovery functions are missing.

- [ ] **Step 3: Implement receipt-owned failure transition**

Choose status from the receipt attempt count:

```ts
const status = input.receipt.attemptCount >= input.maxAttempts
  ? 'dead_letter'
  : 'retry';
```

For retry require `nextAttemptAtUtc > failedAtUtc`. Batch a guarded update:

```sql
UPDATE canonical_outbox_events
SET status=?,available_at_utc=?,claim_public_id=NULL,claim_expires_at_utc=NULL,
    locked_at_utc=NULL,locked_by=NULL,published_at_utc=NULL,
    published_envelope_sha256=NULL,last_error_code=?,last_error_summary=?,
    last_error_sha256=?,updated_at_utc=?
WHERE tenant_id=? AND event_public_id=?
  AND status='processing' AND claim_public_id=? AND locked_by=?
  AND claim_expires_at_utc>? AND processing_attempts=?;
```

Use `failedAtUtc` as `available_at_utc` for dead-letter because status controls eligibility; use the future retry timestamp for retry.

- [ ] **Step 4: Implement expired-lease recovery**

Load the exact processing attempt count for the requested event, require `claim_expires_at_utc <= recoveredAtUtc`, choose retry/dead-letter using the same maximum policy, and update only if the loaded attempt count and expired claim still match. For retry set `available_at_utc = recoveredAtUtc`, making it immediately due for a fresh claim.

- [ ] **Step 5: Run lifecycle, migration, converter, and TypeScript tests**

```bash
pnpm vitest run \
  test/canonical/canonical-sync-outbox-lifecycle-migration.test.ts \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts \
  test/canonical/canonical-sync-outbox-converter.test.ts
pnpm exec tsc --noEmit
```

Expected: all tests PASS and TypeScript passes.

- [ ] **Step 6: Commit failure/recovery checkpoint**

```bash
git add src/lib/canonical/local-sync-outbox-lifecycle.ts \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts
git commit -m "feat(canonical): add outbox retry recovery lifecycle"
```

---

### Task 5: Readiness evidence, runtime isolation, and CDB-110F checkpoint

**Files:**
- Modify: `docs/database/canonical-local-sync-entity-registry.yaml`
- Modify: `scripts/canonical/check-canonical-local-sync-readiness.ts`
- Modify: `test/canonical/canonical-local-sync-readiness.test.ts`
- Create: `test/canonical/canonical-sync-outbox-runtime-isolation.test.ts`
- Create: `docs/database/migration-runs/P11-canonical-source-outbox-lifecycle.md`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

**Interfaces:**
- Registry protocol foundation adds:

```json
{
  "sourceOutboxLifecycleStatus": "verified_offline",
  "sourceOutboxLifecycleMigration": "migrations/0543_canonical_sync_outbox_lifecycle.sql",
  "sourceOutboxLifecycleModule": "src/lib/canonical/local-sync-outbox-lifecycle.ts",
  "sourceOutboxLifecycleTest": "test/canonical/canonical-sync-outbox-lifecycle.test.ts"
}
```

- [ ] **Step 1: Write RED readiness and runtime-isolation tests**

Update readiness fixture expectations to require all four fields and evidence paths. Add a recursive source scan excluding the lifecycle module itself:

```ts
expect(runtimeReferences).toEqual([]);
```

where a reference is any other `src/**/*.{ts,tsx,js,mjs}` file containing:

```text
local-sync-outbox-lifecycle
claimNextCanonicalSyncOutboxEnvelope
completeCanonicalSyncOutboxPublication
failCanonicalSyncOutboxPublication
recoverExpiredCanonicalSyncOutboxLease
```

- [ ] **Step 2: Run tests and confirm RED**

```bash
pnpm vitest run \
  test/canonical/canonical-local-sync-readiness.test.ts \
  test/canonical/canonical-sync-outbox-runtime-isolation.test.ts
```

Expected: FAIL because registry/checker metadata and isolation test file are incomplete.

- [ ] **Step 3: Update registry and readiness checker**

Add the four verified-offline evidence fields and validate that every path exists. Expose `sourceOutboxLifecycleStatus` in readiness output. Keep every entity's `localCanonicalOutboxConsumption` false and keep readiness at 0 ready / 8 blocked.

- [ ] **Step 4: Update tracker and continuation contract**

Set:

```yaml
current_checkpoint: CDB-110F-SOURCE-OUTBOX-LIFECYCLE-VERIFIED
last_completed_checkpoint: CDB-110F_offline_source_outbox_claim_publication_retry_and_recovery_lifecycle
next_exact_action: design_CDB_110G_offline_delivery_transport_and_claim_apply_orchestration_without_runtime_activation
```

Add a `cdb_110f_source_outbox_lifecycle` block recording offline verification and all connection/activation flags as false. Update the continuation contract literals.

- [ ] **Step 5: Write evidence report**

Document:

- schema and immutable triggers;
- allowlisted candidate ordering;
- conversion-before-claim;
- exact publication fingerprint acknowledgement;
- retry/dead-letter/expired recovery;
- runtime isolation;
- readiness remaining blocked;
- commits and verification receipts;
- explicit safety non-actions.

- [ ] **Step 6: Run final verification gates**

```bash
pnpm vitest run \
  test/canonical/canonical-sync-outbox-lifecycle-migration.test.ts \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts \
  test/canonical/canonical-sync-outbox-runtime-isolation.test.ts \
  test/canonical/canonical-sync-outbox-converter.test.ts \
  test/canonical/canonical-local-sync-readiness.test.ts \
  test/canonical/main-based-continuation-contract.test.ts
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm build:migrations
pnpm --filter web build
pnpm build:patient
pnpm build:admin
```

Expected:

- focused lifecycle/readiness suite passes;
- full canonical suite passes;
- TypeScript passes;
- governance reports 0 issues;
- readiness remains 0 ready / 8 blocked with source lifecycle verified offline;
- retirement remains 0 eligible;
- migration manifest reports 474 migrations;
- all three production builds pass.

- [ ] **Step 7: Commit verification checkpoint and final receipt**

First commit implementation evidence:

```bash
git add docs/database/canonical-local-sync-entity-registry.yaml \
  scripts/canonical/check-canonical-local-sync-readiness.ts \
  test/canonical/canonical-local-sync-readiness.test.ts \
  test/canonical/canonical-sync-outbox-runtime-isolation.test.ts \
  docs/database/migration-runs/P11-canonical-source-outbox-lifecycle.md \
  task-progress.yaml test/canonical/main-based-continuation-contract.test.ts
git commit -m "docs(canonical): verify CDB-110F outbox lifecycle"
```

Record that hash in tracker/report, then commit the metadata-only receipt:

```bash
git add task-progress.yaml docs/database/migration-runs/P11-canonical-source-outbox-lifecycle.md
git commit -m "docs(canonical): finalize CDB-110F checkpoint receipt"
```

- [ ] **Step 8: Confirm clean branch relationship**

```bash
git status --short --branch
git rev-list --left-right --count main...HEAD
git log --oneline --decorate -n 12
```

Expected: clean CDB worktree, behind main by 0, no CDB-to-main integration.
