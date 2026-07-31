# CDB-110G Canonical Offline Delivery and Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a one-event offline canonical delivery coordinator that claims source authority, receives and applies it on a target database through a typed port, and records exact source publication without activating runtime synchronization.

**Architecture:** Extend the target inbox with read-only semantic inspection, implement a database-backed delivery port around existing inbox/business primitives, then coordinate one source claim against that port. Existing source outbox and target inbox remain the only durable lifecycle stores; no route, fetch client, worker, scheduler, or extra queue is added.

**Tech Stack:** TypeScript, SQLite/D1-compatible prepared statements, Node `node:sqlite` harness, Vitest, canonical sync protocol/inbox/business/source lifecycle modules.

## Global Constraints

- Work only in `program/cdb-main-continuous-20260725` and its dedicated worktree.
- Keep the dirty owner-facing root checkout read-only.
- Main may flow into CDB; CDB must not flow into main.
- No HTTP, fetch, Hono, RPC, queue, route, worker, scheduler, startup hook, shell integration, production access, push, deploy, or feature activation.
- Process exactly one source event per coordinator invocation.
- Existing source outbox and target inbox remain the durable lifecycle authorities.
- All timestamps and owner IDs are explicit inputs; do not use `Date.now()` or `crypto.randomUUID()`.
- Return stable codes and SHA-256 evidence, never raw exception messages or stack traces.
- Keep all `localCanonicalOutboxConsumption` values, `runtimeConsumptionConnected`, `businessApplyConnected`, and `activationAuthorized` false.

---

### Task 1: Read-only target inbox lifecycle inspection

**Files:**
- Modify: `src/lib/canonical/local-sync-inbox.ts`
- Modify: `test/canonical/canonical-sync-inbox.test.ts`

**Interfaces:**
- Consumes: `CanonicalSyncEnvelope`, existing stored envelope/dependency evidence helpers.
- Produces:

```ts
export type CanonicalSyncInboxLifecycleStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'retry'
  | 'dead_letter';

export interface CanonicalSyncInboxLifecycleReceipt {
  tenantId: string;
  eventPublicId: string;
  status: CanonicalSyncInboxLifecycleStatus;
  attemptCount: number;
  claimPublicId: string | null;
  claimOwnerPublicId: string | null;
  claimExpiresAtUtc: string | null;
  nextAttemptAtUtc: string | null;
  appliedAtUtc: string | null;
  errorCode: string | null;
  errorHash: string | null;
}

export async function inspectCanonicalSyncInboxEnvelope(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
): Promise<CanonicalSyncInboxLifecycleReceipt | null>;
```

- [ ] **Step 1: Write failing inspection tests**

Extend the existing inbox SQLite harness and add tests that:

```ts
expect(await inspectCanonicalSyncInboxEnvelope(db, envelope)).toBeNull();
await receiveCanonicalSyncEnvelope(db, envelope, NOW);
expect(await inspectCanonicalSyncInboxEnvelope(db, envelope)).toMatchObject({
  tenantId: '100',
  eventPublicId: envelope.eventPublicId,
  status: 'pending',
  attemptCount: 0,
  claimPublicId: null,
  nextAttemptAtUtc: null,
  appliedAtUtc: null,
});
```

Then claim and complete the event and assert `applying` and `applied` receipts. Add a tampered envelope with the same event or idempotency identity and expect `CanonicalSyncInboxConflictError`.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm vitest run test/canonical/canonical-sync-inbox.test.ts -t inspect
```

Expected: FAIL because `inspectCanonicalSyncInboxEnvelope` is not exported.

- [ ] **Step 3: Add stored lifecycle row shape**

Add a private row interface containing:

```ts
interface InboxLifecycleRow extends InboxEvidenceRow {
  status: string;
  attempt_count: number;
  claim_public_id: string | null;
  claim_owner_public_id: string | null;
  claim_expires_at_utc: string | null;
  next_attempt_at_utc: string | null;
  applied_at_utc: string | null;
  error_code: string | null;
  error_hash: string | null;
}
```

- [ ] **Step 4: Implement semantic inspection**

Validate the envelope, load a row by event ID or idempotency key, load ordered dependency evidence, and require the same `evidenceMatches()` and dependency equality used by replay handling. Return `null` when no row exists. Reject unsupported stored status, invalid attempt count, or inconsistent lifecycle evidence with `CanonicalSyncInboxStateError`.

- [ ] **Step 5: Run inbox tests and TypeScript**

```bash
pnpm vitest run test/canonical/canonical-sync-inbox.test.ts
pnpm exec tsc --noEmit
```

Expected: all inbox tests and TypeScript pass.

- [ ] **Step 6: Commit inspection checkpoint**

```bash
git add src/lib/canonical/local-sync-inbox.ts test/canonical/canonical-sync-inbox.test.ts
git commit -m "feat(canonical): inspect sync inbox lifecycle"
```

---

### Task 2: Typed offline target delivery port

**Files:**
- Create: `src/lib/canonical/local-sync-delivery.ts`
- Create: `test/canonical/canonical-sync-offline-delivery.test.ts`

**Interfaces:**
- Consumes:
  - `receiveCanonicalSyncEnvelope`, `inspectCanonicalSyncInboxEnvelope`, `claimCanonicalSyncInboxEvent`, `scheduleCanonicalSyncRetry`, `deadLetterCanonicalSyncInboxEvent`;
  - `completeCanonicalSyncBusinessEvent`;
  - canonical conflict/payload/apply/state error classes;
  - `createRequestFingerprint`.
- Produces:

```ts
export interface CanonicalSyncDeliveryRequest {
  envelope: CanonicalSyncEnvelope;
  receivedAtUtc: string;
  targetClaimPublicId: string;
  targetClaimOwnerPublicId: string;
  targetClaimedAtUtc: string;
  targetClaimExpiresAtUtc: string;
  targetAppliedAtUtc: string;
  targetNextAttemptAtUtc: string;
  targetMaxAttempts: number;
}

export type CanonicalSyncDeliveryResult =
  | { status: 'applied'; eventPublicId: string; targetAttemptCount: number; replayed: boolean }
  | { status: 'retry'; eventPublicId: string; targetAttemptCount: number; retryAtUtc: string; errorCode: string; errorHash: string }
  | { status: 'dead_letter'; eventPublicId: string; targetAttemptCount: number; errorCode: string; errorHash: string }
  | { status: 'busy'; eventPublicId: string; targetAttemptCount: number; retryAtUtc: string; errorCode: 'CANONICAL_SYNC_TARGET_BUSY'; errorHash: string };

export interface CanonicalSyncDeliveryPort {
  deliver(request: CanonicalSyncDeliveryRequest): Promise<CanonicalSyncDeliveryResult>;
}

export function createCanonicalSyncDatabaseDeliveryPort(
  targetDb: CanonicalBatchDatabase,
): CanonicalSyncDeliveryPort;
```

- [ ] **Step 1: Build a two-node delivery harness and RED tests**

Use one target SQLite database with real canonical migrations and a valid encounter envelope fixture. Cover:

```ts
const port = createCanonicalSyncDatabaseDeliveryPort(targetDb);
const result = await port.deliver(request);
expect(result).toEqual({
  status: 'applied',
  eventPublicId: envelope.eventPublicId,
  targetAttemptCount: 1,
  replayed: false,
});
```

Verify target business rows, entity version, and inbox `applied` receipt. Deliver the same envelope again and expect `replayed: true` with no duplicate business rows.

Add pre-existing target states:

- active `applying` returns `busy` and claim expiry;
- future `retry` returns `retry` without claiming;
- existing `dead_letter` returns `dead_letter`.

- [ ] **Step 2: Run focused delivery tests and confirm RED**

```bash
pnpm vitest run test/canonical/canonical-sync-offline-delivery.test.ts
```

Expected: FAIL because the delivery module does not exist.

- [ ] **Step 3: Implement request validation and stable error evidence**

Validate public IDs, UTC timestamps, positive maximum attempts, claim expiry, apply time, and retry time. Add:

```ts
async function errorEvidence(phase: string, error: unknown): Promise<{
  errorCode: string;
  errorHash: string;
  permanent: boolean;
}>;
```

Build the hash from stable canonical JSON containing `phase`, error class name, optional stable `code`, and a SHA-256 hash of the original message. Never return the raw message.

Treat protocol conflicts, inbox conflicts, business payload errors, `TypeError`, and `RangeError` as permanent. Treat business apply errors, inbox state races, and unknown errors as retryable.

- [ ] **Step 4: Implement state-aware delivery**

The adapter must:

```ts
await receiveCanonicalSyncEnvelope(targetDb, request.envelope, request.receivedAtUtc);
const state = await inspectCanonicalSyncInboxEnvelope(targetDb, request.envelope);
```

Branch exactly:

```text
applied -> applied replay
active applying -> busy
future retry -> retry
existing dead_letter -> dead_letter
pending / due retry / expired applying -> claim and apply
```

Use `completeCanonicalSyncBusinessEvent()` after claim. On caught failure after a claim, use target attempt count and classification to call target retry or dead-letter. Return the matching stable result.

- [ ] **Step 5: Add failure tests**

Add fixtures that force:

- retryable dependency/apply failure below max -> target retry;
- retryable failure at max -> target dead-letter;
- authenticated payload failure -> immediate target dead-letter;
- claim race -> retry/busy result without duplicate mutation.

- [ ] **Step 6: Run delivery, inbox, business, and TypeScript suites**

```bash
pnpm vitest run \
  test/canonical/canonical-sync-offline-delivery.test.ts \
  test/canonical/canonical-sync-inbox.test.ts \
  test/canonical/canonical-sync-business-completion.test.ts
pnpm exec tsc --noEmit
```

Expected: all focused tests and TypeScript pass.

- [ ] **Step 7: Commit target adapter checkpoint**

```bash
git add src/lib/canonical/local-sync-delivery.ts \
  test/canonical/canonical-sync-offline-delivery.test.ts
git commit -m "feat(canonical): add offline sync delivery port"
```

---

### Task 3: Source permanent dead-letter and one-event coordinator

**Files:**
- Modify: `src/lib/canonical/local-sync-outbox-lifecycle.ts`
- Modify: `test/canonical/canonical-sync-outbox-lifecycle.test.ts`
- Create: `src/lib/canonical/local-sync-orchestrator.ts`
- Create: `test/canonical/canonical-sync-offline-orchestration.test.ts`

**Interfaces:**
- Adds:

```ts
export async function deadLetterCanonicalSyncOutboxPublication(
  db: CanonicalBatchDatabase,
  input: {
    receipt: CanonicalSyncOutboxClaimReceipt;
    failedAtUtc: string;
    errorCode: string;
    errorSha256: string;
    errorSummary?: string | null;
  },
): Promise<void>;
```

- Produces coordinator interfaces from the approved design:

```ts
export interface CanonicalSyncOrchestrationTimeline {
  sourceClaimedAtUtc: string;
  sourceClaimExpiresAtUtc: string;
  targetReceivedAtUtc: string;
  targetClaimedAtUtc: string;
  targetClaimExpiresAtUtc: string;
  targetAppliedAtUtc: string;
  sourcePublishedAtUtc: string;
  sourceNextAttemptAtUtc: string;
  targetNextAttemptAtUtc: string;
}

export async function runCanonicalSyncOrchestrationOnce(
  sourceDb: CanonicalBatchDatabase,
  deliveryPort: CanonicalSyncDeliveryPort,
  input: {
    tenantId: string;
    sourceNodePublicId: string;
    sourceClaimOwnerPublicId: string;
    targetClaimOwnerPublicId: string;
    sourceMaxAttempts: number;
    targetMaxAttempts: number;
    timeline: CanonicalSyncOrchestrationTimeline;
  },
): Promise<CanonicalSyncOrchestrationResult>;
```

- [ ] **Step 1: Write RED source permanent dead-letter tests**

Claim a source event, call `deadLetterCanonicalSyncOutboxPublication()`, and assert exact active receipt becomes `dead_letter` with claim evidence cleared. Wrong owner, attempt, expired claim, invalid code/hash, and replay must fail without mutation.

- [ ] **Step 2: Implement source permanent dead-letter helper**

Reuse CDB-110F validators and the guarded assertion batch. Require exact tenant/event/claim/owner/expiry/attempt and unexpired ownership. Set status `dead_letter`, clear lease/publication fields, retain stable error evidence, and assert one changed row.

- [ ] **Step 3: Write RED successful orchestration test**

Use separate source and target SQLite databases. Insert a valid canonical source event and target dependencies. Run the coordinator and expect:

```ts
expect(result).toMatchObject({
  status: 'published',
  eventPublicId: sourceEventPublicId,
  sourceAttemptCount: 1,
  targetAttemptCount: 1,
  targetReplayed: false,
});
```

Assert source status `published`, target inbox `applied`, target business row present, and no duplicate rows.

- [ ] **Step 4: Implement timeline validation and deterministic claim IDs**

Validate all timestamps using the approved ordering. Derive IDs with `createRequestFingerprint()`:

```ts
const sourceClaimPublicId = `sync-source-claim-${fingerprint.slice(0, 40)}`;
const targetClaimPublicId = `sync-target-claim-${fingerprint.slice(0, 40)}`;
```

No random or wall-clock APIs.

- [ ] **Step 5: Implement orchestration result handling**

Flow:

```ts
const sourceReceipt = await claimNextCanonicalSyncOutboxEnvelope(...);
const targetResult = await deliveryPort.deliver(...);
```

Then:

```text
target applied -> exact source publication acknowledgement
target retry/busy -> source retry at max(sourceNextAttemptAtUtc,target retryAtUtc)
target dead_letter -> exact source permanent dead-letter
transport throw -> source retry/final dead-letter according to source attempts
source claim state error before receipt -> idle
source publication state error after target applied -> source_ack_pending
```

Generate stable transport/source-ack error hashes without returning raw messages.

- [ ] **Step 6: Run basic coordinator and lifecycle tests**

```bash
pnpm vitest run \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts \
  test/canonical/canonical-sync-offline-orchestration.test.ts
pnpm exec tsc --noEmit
```

Expected: source lifecycle and basic orchestration tests pass.

- [ ] **Step 7: Commit coordinator checkpoint**

```bash
git add src/lib/canonical/local-sync-outbox-lifecycle.ts \
  src/lib/canonical/local-sync-orchestrator.ts \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts \
  test/canonical/canonical-sync-offline-orchestration.test.ts
git commit -m "feat(canonical): orchestrate offline sync delivery"
```

---

### Task 4: Crash, replay, and failure convergence

**Files:**
- Modify: `src/lib/canonical/local-sync-delivery.ts`
- Modify: `src/lib/canonical/local-sync-orchestrator.ts`
- Modify: `test/canonical/canonical-sync-offline-delivery.test.ts`
- Modify: `test/canonical/canonical-sync-offline-orchestration.test.ts`

**Interfaces:**
- Consumes all Task 2/3 public types without renaming.
- Produces complete replay/failure behavior required by the design.

- [ ] **Step 1: Add RED target-applied response-loss recovery test**

Wrap the database delivery port in a test port that delegates once, then throws after the target commits. The first coordinator run must schedule source retry while target is already applied. Recover or reclaim the source on the next due attempt, deliver again, observe target replayed-applied, and publish source without duplicate target rows.

- [ ] **Step 2: Add RED source acknowledgement pending test**

Use a port that applies target state, then mutate/expire the source claim before the coordinator acknowledges publication. Expect:

```ts
{
  status: 'source_ack_pending',
  eventPublicId,
  sourceAttemptCount: 1,
  targetAttemptCount: 1,
  recoverAfterUtc: sourceClaimExpiresAtUtc,
  errorCode: 'CANONICAL_SYNC_SOURCE_ACK_PENDING',
  errorHash: expect.stringMatching(/^[a-f0-9]{64}$/),
}
```

The coordinator must not attempt an invalid source retry/dead-letter transition.

- [ ] **Step 3: Add target busy/future retry propagation tests**

Pre-create target `applying` with active expiry and target `retry` with future schedule. Ensure source retry is no earlier than both the configured source retry and target-provided retry/expiry.

- [ ] **Step 4: Add permanent and transient failure tests**

Cover:

- target permanent dead-letter -> source immediate dead-letter;
- transport throw below source max -> source retry;
- transport throw at source max -> source dead-letter;
- target retry at max -> target/source terminal convergence;
- deterministic claim IDs and repeated stable error hashes;
- invalid timeline rejected before any source mutation.

- [ ] **Step 5: Implement minimal convergence fixes**

Adjust delivery/coordinator code only as required by failing tests. Preserve one-event scope and existing public interfaces.

- [ ] **Step 6: Run complete offline delivery/orchestration suite**

```bash
pnpm vitest run \
  test/canonical/canonical-sync-offline-delivery.test.ts \
  test/canonical/canonical-sync-offline-orchestration.test.ts \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts \
  test/canonical/canonical-sync-inbox.test.ts \
  test/canonical/canonical-sync-business-completion.test.ts
pnpm exec tsc --noEmit
```

Expected: all offline end-to-end, lifecycle, inbox, business, and TypeScript gates pass.

- [ ] **Step 7: Commit recovery checkpoint**

```bash
git add src/lib/canonical/local-sync-delivery.ts \
  src/lib/canonical/local-sync-orchestrator.ts \
  test/canonical/canonical-sync-offline-delivery.test.ts \
  test/canonical/canonical-sync-offline-orchestration.test.ts
git commit -m "test(canonical): prove offline sync recovery convergence"
```

---

### Task 5: Readiness evidence, runtime isolation, and CDB-110G checkpoint

**Files:**
- Modify: `docs/database/canonical-local-sync-entity-registry.yaml`
- Modify: `scripts/canonical/check-canonical-local-sync-readiness.ts`
- Modify: `test/canonical/canonical-local-sync-readiness.test.ts`
- Create: `test/canonical/canonical-sync-offline-runtime-isolation.test.ts`
- Create: `docs/database/migration-runs/P11-canonical-offline-delivery-orchestration.md`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

**Interfaces:**
- Registry adds:

```json
{
  "offlineDeliveryOrchestrationStatus": "verified_offline",
  "offlineDeliveryModule": "src/lib/canonical/local-sync-delivery.ts",
  "offlineOrchestrationModule": "src/lib/canonical/local-sync-orchestrator.ts",
  "offlineOrchestrationTest": "test/canonical/canonical-sync-offline-orchestration.test.ts"
}
```

- [ ] **Step 1: Write RED readiness and isolation tests**

Require all evidence fields/paths in readiness fixtures and output. Add a recursive source scan proving no other application source imports or calls the delivery/orchestration modules or exported coordinator. Also assert both new modules contain none of:

```text
fetch(
Hono
CLOUD_SYNC_
setInterval
setTimeout
cron
schedule
```

- [ ] **Step 2: Update registry/checker while preserving blockers**

Validate all evidence paths and expose `offlineDeliveryOrchestrationStatus`. Keep 0 ready / 8 blocked and all connection/activation flags false.

- [ ] **Step 3: Update tracker and continuation contract**

Set:

```yaml
current_checkpoint: CDB-110G-OFFLINE-DELIVERY-ORCHESTRATION-VERIFIED
last_completed_checkpoint: CDB-110G_one_event_offline_claim_receive_apply_publish_orchestration
next_exact_action: design_CDB_110H_disconnected_multi_event_rehearsal_and_recovery_evidence_without_runtime_activation
```

Add a CDB-110G block with implementation commits, offline status, 8 blocked/0 ready, and all runtime/transport activation flags false.

- [ ] **Step 4: Write verification report**

Document port architecture, source/target state ownership, replay/crash convergence, error classification, runtime isolation, truthful readiness, commits, verification counts, and explicit safety non-actions.

- [ ] **Step 5: Run final verification gates**

```bash
pnpm vitest run \
  test/canonical/canonical-sync-offline-delivery.test.ts \
  test/canonical/canonical-sync-offline-orchestration.test.ts \
  test/canonical/canonical-sync-offline-runtime-isolation.test.ts \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts \
  test/canonical/canonical-sync-inbox.test.ts \
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

- focused offline orchestration/readiness tests pass;
- full canonical suite passes;
- TypeScript and governance pass;
- readiness remains 0 ready / 8 blocked with offline delivery orchestration verified;
- legacy retirement remains 0 eligible;
- migration manifest remains current;
- all three production builds pass.

- [ ] **Step 6: Commit verification and final receipt**

Create implementation evidence commit:

```bash
git add docs/database/canonical-local-sync-entity-registry.yaml \
  scripts/canonical/check-canonical-local-sync-readiness.ts \
  test/canonical/canonical-local-sync-readiness.test.ts \
  test/canonical/canonical-sync-offline-runtime-isolation.test.ts \
  docs/database/migration-runs/P11-canonical-offline-delivery-orchestration.md \
  task-progress.yaml test/canonical/main-based-continuation-contract.test.ts
git commit -m "docs(canonical): verify CDB-110G offline orchestration"
```

Record the hash in tracker/report, then:

```bash
git add task-progress.yaml docs/database/migration-runs/P11-canonical-offline-delivery-orchestration.md
git commit -m "docs(canonical): finalize CDB-110G checkpoint receipt"
```

- [ ] **Step 7: Confirm clean relationship**

```bash
git status --short --branch
git rev-list --left-right --count main...HEAD
git log --oneline --decorate -n 14
pnpm worktree:check -- --mode=task
```

Expected: clean dedicated CDB worktree, behind main by 0, and no CDB-to-main integration.
