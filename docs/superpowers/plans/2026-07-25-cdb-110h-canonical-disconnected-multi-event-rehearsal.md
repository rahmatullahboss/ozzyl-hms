# CDB-110H Canonical Disconnected Multi-Event Rehearsal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a bounded explicit-step offline rehearsal runner that proves multi-event ordering, unrelated aggregate progress, response-loss recovery, source drain detection, and deterministic aggregate evidence without activating synchronization.

**Architecture:** Export the existing one-event orchestration validator, add a pure rehearsal sequencer around `runCanonicalSyncOrchestrationOnce()`, and exercise it against two in-memory SQLite nodes. Existing source outbox and target inbox remain the only durable lifecycle authorities; the runner creates no queue, worker, route, CLI, file artifact, or network path.

**Tech Stack:** TypeScript, SQLite/D1-compatible prepared statements, Node `node:sqlite` test harness, Vitest, canonical sync protocol/delivery/orchestration modules.

## Global Constraints

- Work only in `program/cdb-main-continuous-20260725` and its dedicated worktree.
- Keep the dirty owner-facing root checkout read-only.
- Main may flow into CDB; CDB must not flow into main.
- No HTTP, fetch, Hono, RPC, queue, worker, scheduler, timer, startup hook, CLI, filesystem export, production access, protected clone access, push, deploy, or feature activation.
- The rehearsal accepts 1–100 explicit steps and never generates timestamps or identifiers.
- Validate every planned step before the first source mutation.
- Execute steps serially and stop on the first `idle` result.
- Return aggregate-only receipts with stable IDs, counters, and SHA-256 hashes; never include envelope payloads, SQL, raw database rows, raw exception messages, or stacks.
- Keep every `localCanonicalOutboxConsumption` value, `runtimeConsumptionConnected`, `businessApplyConnected`, and `activationAuthorized` false.

---

### Task 1: Export orchestration validation and define the rehearsal contract

**Files:**
- Modify: `src/lib/canonical/local-sync-orchestrator.ts`
- Create: `src/lib/canonical/local-sync-rehearsal.ts`
- Create: `test/canonical/canonical-sync-offline-rehearsal.test.ts`

**Interfaces:**
- Export from orchestrator:

```ts
export function validateCanonicalSyncOrchestrationInput(
  input: CanonicalSyncOrchestrationInput,
): void;
```

- Produce from rehearsal module:

```ts
export interface CanonicalSyncOfflineRehearsalStep {
  stepPublicId: string;
  orchestration: CanonicalSyncOrchestrationInput;
}

export interface CanonicalSyncOfflineRehearsalInput {
  rehearsalPublicId: string;
  steps: readonly CanonicalSyncOfflineRehearsalStep[];
}

export type CanonicalSyncOfflineRehearsalStepReceipt = {
  stepPublicId: string;
  status: 'idle' | 'published' | 'retry' | 'dead_letter' | 'source_ack_pending';
  eventPublicId: string | null;
  sourceAttemptCount: number | null;
  targetAttemptCount: number | null;
  targetReplayed: boolean | null;
  retryAtUtc: string | null;
  recoverAfterUtc: string | null;
  errorCode: string | null;
  errorHash: string | null;
};

export interface CanonicalSyncOfflineRehearsalReceipt {
  rehearsalPublicId: string;
  tenantId: string;
  sourceNodePublicId: string;
  plannedStepCount: number;
  executedStepCount: number;
  drained: boolean;
  publishedCount: number;
  retryCount: number;
  deadLetterCount: number;
  sourceAckPendingCount: number;
  idleCount: number;
  uniqueEventCount: number;
  eventPublicIds: string[];
  stepReceipts: CanonicalSyncOfflineRehearsalStepReceipt[];
  transcriptSha256: string;
}

export async function runCanonicalSyncOfflineRehearsal(
  sourceDb: CanonicalBatchDatabase,
  deliveryPort: CanonicalSyncDeliveryPort,
  input: CanonicalSyncOfflineRehearsalInput,
): Promise<CanonicalSyncOfflineRehearsalReceipt>;
```

- [ ] **Step 1: Write RED validation tests**

Create a lightweight source harness and stub delivery port. Add tests that reject before delivery or source mutation:

```ts
await expect(runCanonicalSyncOfflineRehearsal(db, port, {
  rehearsalPublicId: 'rehearsal-1',
  steps: [],
})).rejects.toThrow(/1.*100/i);
```

Add cases for:

- numeric rehearsal ID;
- duplicate step public IDs;
- mixed tenant IDs;
- mixed source nodes;
- mixed source/target owners;
- non-increasing `sourceClaimedAtUtc`;
- a malformed later orchestration input;
- 101 steps.

Assert the source outbox remains pending and the delivery port call count remains zero.

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
pnpm vitest run test/canonical/canonical-sync-offline-rehearsal.test.ts -t validation
```

Expected: FAIL because the rehearsal module/export does not exist.

- [ ] **Step 3: Export the existing orchestration validator**

Rename private `validateInput()` to `validateCanonicalSyncOrchestrationInput()` and call it from `runCanonicalSyncOrchestrationOnce()` without changing validation behavior.

- [ ] **Step 4: Implement complete-plan validation**

In `local-sync-rehearsal.ts`, validate:

```text
rehearsalPublicId: stable non-numeric public ID <= 160
steps: array length 1..100
stepPublicId: unique stable non-numeric public ID <= 160
every orchestration input: validateCanonicalSyncOrchestrationInput()
all tenant/source-node/source-owner/target-owner values: identical
sourceClaimedAtUtc: strictly increasing
```

Run the complete validation loop before calling the one-event orchestrator.

- [ ] **Step 5: Run validation tests and TypeScript**

```bash
pnpm vitest run test/canonical/canonical-sync-offline-rehearsal.test.ts -t validation
pnpm exec tsc --noEmit
```

Expected: validation tests and TypeScript pass.

- [ ] **Step 6: Commit contract checkpoint**

```bash
git add src/lib/canonical/local-sync-orchestrator.ts \
  src/lib/canonical/local-sync-rehearsal.ts \
  test/canonical/canonical-sync-offline-rehearsal.test.ts
git commit -m "feat(canonical): define offline sync rehearsal contract"
```

---

### Task 2: Serial execution, sanitization, drain detection, and digest

**Files:**
- Modify: `src/lib/canonical/local-sync-rehearsal.ts`
- Modify: `test/canonical/canonical-sync-offline-rehearsal.test.ts`

**Interfaces:**
- Consumes the Task 1 interfaces unchanged.
- Produces a complete deterministic receipt with no envelope payload or raw errors.

- [ ] **Step 1: Write RED runner tests with a stub orchestration dependency**

Use a real source database with no claimable rows and a port that records calls. Assert one explicit step produces:

```ts
{
  plannedStepCount: 2,
  executedStepCount: 1,
  drained: true,
  publishedCount: 0,
  retryCount: 0,
  deadLetterCount: 0,
  sourceAckPendingCount: 0,
  idleCount: 1,
  uniqueEventCount: 0,
  eventPublicIds: [],
  stepReceipts: [{
    stepPublicId: 'step-1',
    status: 'idle',
    eventPublicId: null,
    sourceAttemptCount: null,
    targetAttemptCount: null,
    targetReplayed: null,
    retryAtUtc: null,
    recoverAfterUtc: null,
    errorCode: null,
    errorHash: null,
  }],
  transcriptSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
}
```

The second planned step must not call the port.

- [ ] **Step 2: Write RED result-normalization tests**

Build separate isolated fixtures or controlled source states that return each orchestration result. Assert exact sanitized mappings:

```text
published -> event/source/target counts + targetReplayed
retry -> retryAtUtc + error evidence
source_ack_pending -> recoverAfterUtc + error evidence
dead_letter -> error evidence
idle -> all optional evidence null
```

Inspect `JSON.stringify(receipt)` and assert it contains none of:

```text
payload
mutation
patientSyncKey
claimOwnerPublicId
stack
message
sql
```

- [ ] **Step 3: Implement serial execution and stop-on-idle**

Loop only over the validated finite `steps` array:

```ts
for (const step of input.steps) {
  const result = await runCanonicalSyncOrchestrationOnce(sourceDb, deliveryPort, step.orchestration);
  const receipt = sanitize(step.stepPublicId, result);
  receipts.push(receipt);
  if (result.status === 'idle') break;
}
```

Do not use `while`, timers, wall-clock APIs, or generated identifiers.

- [ ] **Step 4: Implement counters, unique identities, and digest**

Derive counters from step receipts. Sort unique non-null event public IDs. Compute:

```ts
const transcriptSha256 = await createRequestFingerprint({
  rehearsalPublicId,
  tenantId,
  sourceNodePublicId,
  plannedStepCount,
  executedStepCount,
  drained,
  publishedCount,
  retryCount,
  deadLetterCount,
  sourceAckPendingCount,
  idleCount,
  uniqueEventCount,
  eventPublicIds,
  stepReceipts,
});
```

- [ ] **Step 5: Run runner tests and TypeScript**

```bash
pnpm vitest run test/canonical/canonical-sync-offline-rehearsal.test.ts
pnpm exec tsc --noEmit
```

Expected: runner/validation tests and TypeScript pass.

- [ ] **Step 6: Commit runner checkpoint**

```bash
git add src/lib/canonical/local-sync-rehearsal.ts \
  test/canonical/canonical-sync-offline-rehearsal.test.ts
git commit -m "feat(canonical): run bounded offline sync rehearsal"
```

---

### Task 3: Multi-event ordering and response-loss recovery scenario

**Files:**
- Modify: `test/canonical/canonical-sync-offline-rehearsal.test.ts`
- Modify only if required by failing tests: `src/lib/canonical/local-sync-rehearsal.ts`

**Interfaces:**
- Uses the real source lifecycle, converter, one-event orchestrator, target database delivery port, target inbox, and business apply path.
- No new production interface.

- [ ] **Step 1: Build a two-node clinical rehearsal harness**

Source database:

- canonical protocol/inbox/source lifecycle migrations;
- patient `uhid:P-001`;
- encounter A source authority completed (`09:00`–`09:30`);
- encounter B source authority in progress (`09:05`);
- source outbox rows inserted in order:
  1. A started;
  2. A completed;
  3. B started.

Target database:

- canonical protocol/inbox migrations;
- matching patient sync identity;
- empty canonical encounters.

- [ ] **Step 2: Add RED five-step response-loss rehearsal**

Decorate `createCanonicalSyncDatabaseDeliveryPort(targetDb)` so the first delivery delegates and then throws. Supply five explicit orchestration steps:

```text
step 1 at 10:00 -> A v1 target apply, response loss, source retry at 10:10
step 2 at 10:05 -> B v1 publishes while A retry is not due and A v2 is blocked
step 3 at 10:11 -> A v1 replays target and publishes
step 4 at 10:21 -> A v2 completes and publishes
step 5 at 10:31 -> idle/drained
```

Assert step event order:

```ts
[
  ['retry', 'event-a-start'],
  ['published', 'event-b-start'],
  ['published', 'event-a-start'],
  ['published', 'event-a-complete'],
  ['idle', null],
]
```

- [ ] **Step 3: Assert exact source/target convergence**

Source:

```text
A start: published, attempts 2
A complete: published, attempts 1
B start: published, attempts 1
```

Target:

```text
3 inbox events applied
encounter A status completed, version 2
encounter B status in_progress, version 1
2 canonical encounter rows total
no duplicate A row or duplicate applied event
```

Aggregate receipt:

```text
planned 5
executed 5
drained true
published 3
retry 1
idle 1
unique events 3
```

- [ ] **Step 4: Add deterministic transcript test**

Create two independent identical source/target harness pairs and run the same five-step input. Assert the receipts and `transcriptSha256` values are equal.

- [ ] **Step 5: Add terminal/unrelated-progress scenario**

Use a decorated port that returns permanent dead-letter for encounter A version 1, then verify a later explicit step still publishes encounter B while encounter A version 2 remains blocked. Assert receipt counts and source states.

- [ ] **Step 6: Run rehearsal/orchestration/delivery/lifecycle suites**

```bash
pnpm vitest run \
  test/canonical/canonical-sync-offline-rehearsal.test.ts \
  test/canonical/canonical-sync-offline-orchestration.test.ts \
  test/canonical/canonical-sync-offline-delivery.test.ts \
  test/canonical/canonical-sync-outbox-lifecycle.test.ts
pnpm exec tsc --noEmit
```

Expected: all multi-event, one-event, delivery, lifecycle, and TypeScript gates pass.

- [ ] **Step 7: Commit rehearsal scenario checkpoint**

```bash
git add test/canonical/canonical-sync-offline-rehearsal.test.ts \
  src/lib/canonical/local-sync-rehearsal.ts
git commit -m "test(canonical): prove disconnected sync recovery rehearsal"
```

---

### Task 4: Readiness evidence, runtime isolation, and CDB-110H checkpoint

**Files:**
- Modify: `docs/database/canonical-local-sync-entity-registry.yaml`
- Modify: `scripts/canonical/check-canonical-local-sync-readiness.ts`
- Modify: `test/canonical/canonical-local-sync-readiness.test.ts`
- Create: `test/canonical/canonical-sync-rehearsal-runtime-isolation.test.ts`
- Create: `docs/database/migration-runs/P11-canonical-disconnected-multi-event-rehearsal.md`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`

**Interfaces:**
- Registry adds:

```json
{
  "disconnectedMultiEventRehearsalStatus": "verified_offline",
  "disconnectedMultiEventRehearsalModule": "src/lib/canonical/local-sync-rehearsal.ts",
  "disconnectedMultiEventRehearsalTest": "test/canonical/canonical-sync-offline-rehearsal.test.ts"
}
```

- [ ] **Step 1: Write RED readiness and isolation tests**

Require the new status and evidence paths in readiness fixtures/output. Add a recursive scan proving no other application source imports or calls:

```text
local-sync-rehearsal
runCanonicalSyncOfflineRehearsal
```

Assert the rehearsal module contains none of:

```text
fetch(
Hono
CLOUD_SYNC_
setInterval
setTimeout
Date.now
randomUUID
node:fs
node:child_process
process.argv
while (
```

- [ ] **Step 2: Update registry/checker while preserving blockers**

Validate all evidence paths and expose `disconnectedMultiEventRehearsalStatus`. Keep 0 ready / 8 blocked and all connection/activation flags false.

- [ ] **Step 3: Update tracker and continuation contract**

Set:

```yaml
current_checkpoint: CDB-110H-DISCONNECTED-MULTI-EVENT-REHEARSAL-VERIFIED
last_completed_checkpoint: CDB-110H_bounded_multi_event_ordering_response_loss_and_recovery_rehearsal
next_exact_action: design_CDB_110I_reviewed_missing_tombstone_semantics_without_runtime_activation
```

Add a CDB-110H block with design/plan/implementation commits, offline rehearsal status, false runtime/network/worker/activation flags, 0 ready / 8 blocked, and completion evidence path.

- [ ] **Step 4: Write verification report**

Document:

- finite explicit-step architecture;
- full-plan prevalidation;
- aggregate-only transcript and digest;
- same-aggregate ordering;
- unrelated aggregate progress;
- response-loss replay recovery;
- dead-letter behavior;
- exact source/target convergence;
- runtime isolation;
- truthful readiness;
- commits, gates, warnings, branch relationship, and safety non-actions.

- [ ] **Step 5: Run final verification gates**

```bash
pnpm vitest run \
  test/canonical/canonical-sync-offline-rehearsal.test.ts \
  test/canonical/canonical-sync-rehearsal-runtime-isolation.test.ts \
  test/canonical/canonical-sync-offline-orchestration.test.ts \
  test/canonical/canonical-sync-offline-delivery.test.ts \
  test/canonical/canonical-sync-offline-runtime-isolation.test.ts \
  test/canonical/canonical-sync-outbox-runtime-isolation.test.ts \
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

- focused rehearsal/readiness/isolation tests pass;
- full canonical suite passes;
- TypeScript and governance pass;
- readiness remains 0 ready / 8 blocked with disconnected rehearsal verified offline;
- legacy retirement remains 0 eligible;
- migration manifest remains current;
- all three production builds pass.

- [ ] **Step 6: Commit verification and final receipt**

```bash
git add docs/database/canonical-local-sync-entity-registry.yaml \
  scripts/canonical/check-canonical-local-sync-readiness.ts \
  test/canonical/canonical-local-sync-readiness.test.ts \
  test/canonical/canonical-sync-rehearsal-runtime-isolation.test.ts \
  docs/database/migration-runs/P11-canonical-disconnected-multi-event-rehearsal.md \
  task-progress.yaml test/canonical/main-based-continuation-contract.test.ts
git commit -m "docs(canonical): verify CDB-110H disconnected rehearsal"
```

Record the hash in tracker/report, rerun metadata tests, then:

```bash
git add task-progress.yaml docs/database/migration-runs/P11-canonical-disconnected-multi-event-rehearsal.md
git commit -m "docs(canonical): finalize CDB-110H checkpoint receipt"
```

- [ ] **Step 7: Confirm clean relationship**

```bash
git status --short --branch
git rev-list --left-right --count main...HEAD
git log --oneline --decorate -n 16
pnpm worktree:check -- --mode=task
```

Expected: clean dedicated CDB worktree, behind main by 0, and no CDB-to-main integration.
