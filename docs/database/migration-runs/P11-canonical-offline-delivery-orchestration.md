# P11 Canonical Offline Delivery and Orchestration Verification

**Checkpoint:** CDB-110G

**Verified:** 2026-07-25T19:49:00+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `b6afd871871eb9d595aba10eaa9b9f873169c0d8`

**Verified implementation head before this receipt:** `788d7dba70578fd153fe9dd30629a7c65a80dc90`

## Result

CDB-110G now provides a one-event, fully offline canonical source-to-target orchestration path:

- deterministic source claim;
- exact authenticated envelope delivery through a typed port;
- target receive replay protection;
- target claim and business apply;
- exact source publication acknowledgement;
- source and target retry/dead-letter convergence;
- response-loss replay recovery;
- source acknowledgement race recovery evidence;
- deterministic claim IDs and stable error hashes.

The implementation remains disconnected from application runtime. It does not register a route, fetch client, worker, scheduler, cron, timer, startup hook, shell integration, feature flag, network transport, or production execution path.

The real readiness state remains:

```text
canonical sync entities: 8
ready: 0
blocked: 8
protocol foundation: verified_offline
inbox lifecycle: verified_offline
outbox conversion: verified_offline
business apply: verified_offline
source outbox lifecycle: verified_offline
offline delivery/orchestration: verified_offline
runtime consumption connected: false
business apply connected: false
activation authorized: false
```

## Architecture

The orchestration uses existing durable lifecycle authorities rather than creating a third persisted dispatch queue:

- `canonical_outbox_events` owns source claim, retry, dead-letter, lease, and publication state;
- `canonical_sync_inbox_events` owns target receive, claim, retry, dead-letter, and applied state;
- canonical business tables and `canonical_sync_entity_versions` own target business authority and aggregate version progression.

`src/lib/canonical/local-sync-delivery.ts` defines a typed `CanonicalSyncDeliveryPort`. The database-backed offline adapter implements that interface against a target `CanonicalBatchDatabase`. A future explicitly authorized network adapter can implement the same port without changing source orchestration semantics.

`src/lib/canonical/local-sync-orchestrator.ts` coordinates exactly one source event per invocation. No batch loop, process daemon, timer, or runtime registration exists.

## Target inbox inspection

`inspectCanonicalSyncInboxEnvelope()` was added to `local-sync-inbox.ts`. It:

- validates the supplied canonical envelope;
- loads an existing target row by event or idempotency identity;
- compares all stored semantic and dependency evidence;
- returns pending, applying, applied, retry, or dead-letter lifecycle evidence;
- rejects conflicting evidence with `CanonicalSyncInboxConflictError`;
- rejects inconsistent stored lifecycle evidence with `CanonicalSyncInboxStateError`;
- performs no mutation.

This inspection allows replay-safe orchestration without weakening receive semantics.

## Offline delivery port

`createCanonicalSyncDatabaseDeliveryPort(targetDb)` performs:

1. request and timestamp validation;
2. canonical envelope validation;
3. replay-safe target receive;
4. exact inbox inspection;
5. active-claim busy detection;
6. future-retry propagation;
7. pending, due-retry, or expired-claim acquisition;
8. canonical business apply and target applied receipt;
9. target retry or dead-letter transition on apply failure.

Delivery results are restricted to `applied`, `retry`, `dead_letter`, or `busy`. They include stable codes and SHA-256 evidence, not raw exception messages or stack traces.

Permanent target failures include protocol conflicts, semantic inbox conflicts, malformed authenticated business payloads, and invalid deterministic caller input. Retryable failures include target apply assertion failures, inbox state races, and unknown operational failures. A retryable final attempt becomes dead-letter.

## One-event source orchestration

`runCanonicalSyncOrchestrationOnce()`:

1. validates all caller-supplied UTC timestamps and monotonic ordering before source mutation;
2. derives deterministic source and target claim public IDs from stable request evidence;
3. claims the next eligible source envelope;
4. returns `idle` when no event is claimable or a claim race is lost;
5. submits the exact claimed envelope through the delivery port;
6. acknowledges exact source publication after target apply;
7. propagates target retry or active-claim expiry to a no-earlier source retry;
8. dead-letters the exact source claim when the target provides permanent evidence;
9. schedules source retry or final dead-letter when delivery throws;
10. returns `source_ack_pending` when target apply succeeded but source publication ownership raced or expired.

The coordinator never calls `Date.now()` or `crypto.randomUUID()`. Repeated identical inputs produce the same source claim ID, target claim ID, and error hash.

## Source permanent dead-letter

`deadLetterCanonicalSyncOutboxPublication()` was added to the source lifecycle. It requires exact:

- tenant and event identity;
- claim public ID;
- claim owner;
- claim expiry;
- attempt count;
- active, unexpired processing state;
- stable uppercase error code;
- lowercase SHA-256 error evidence.

The guarded assertion batch changes exactly one source row, clears active claim/publication fields, and preserves terminal error evidence. Stale owner, stale attempt, expired ownership, invalid evidence, and replay fail closed without mutation.

## Crash and replay convergence

### Target applied, response lost

The target commits business state and the applied inbox receipt, but the test transport throws before returning the result. The source records retry. A later source claim redelivers the exact envelope; target receive and inspection return the already-applied receipt, no business row is duplicated, and source publication completes with `targetReplayed: true`.

### Target applied, source acknowledgement raced

The target commits applied state, but the source claim identity changes before publication acknowledgement. The coordinator returns `source_ack_pending` and does not attempt an invalid retry/dead-letter transition. Existing source lease recovery can later make the row claimable; the target replay then permits exact source publication.

### Active target claim or future target retry

The delivery port returns target ownership expiry or retry time. The source retry is scheduled at the later of configured source retry and target evidence, preventing premature redelivery.

### Permanent target evidence

The target dead-letter result is copied to the exact active source claim through the permanent source dead-letter helper, converging both lifecycle authorities without repeated delivery.

## Runtime isolation

`test/canonical/canonical-sync-offline-runtime-isolation.test.ts` proves:

- no other application source imports or calls the delivery/orchestration modules or their public entry points;
- the delivery and orchestration modules contain no `fetch`, Hono, cloud-sync environment reference, timer, wall-clock, random-ID, or Node network primitive.

The existing source outbox and business completion isolation tests were narrowed only to allow the approved offline modules. Routes, workers, schedulers, startup code, and shell scripts remain prohibited callers.

## Readiness truthfulness

The canonical local-sync registry now records:

```json
{
  "offlineDeliveryOrchestrationStatus": "verified_offline",
  "offlineDeliveryModule": "src/lib/canonical/local-sync-delivery.ts",
  "offlineOrchestrationModule": "src/lib/canonical/local-sync-orchestrator.ts",
  "offlineOrchestrationTest": "test/canonical/canonical-sync-offline-orchestration.test.ts"
}
```

It intentionally keeps every `localCanonicalOutboxConsumption` value false and retains:

- `runtimeConsumptionConnected: false`;
- `businessApplyConnected: false`;
- `activationAuthorized: false`.

All eight entities remain blocked on runtime consumption. Encounter, service request, service event, deposit, compensation, and inventory also remain blocked on reviewed tombstone semantics.

## Checkpoint commits

- `149aa2e9` — CDB-110G offline delivery/orchestration design;
- `20676dae` — CDB-110G implementation plan;
- `38dded08` — exact target inbox lifecycle inspection;
- `6521f0ab9` — typed offline target delivery port;
- `788d7dba7` — source permanent dead-letter and one-event orchestration with crash/replay convergence;
- `9d780accd` — readiness evidence, runtime isolation, tracker update, and verification receipt.

These commits exist only on `program/cdb-main-continuous-20260725`. No CDB commit was merged or cherry-picked into local `main`.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| Focused CDB-110G suite | 7 files, 63 tests passed |
| Full canonical suite | 166 files, 1,199 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Canonical local-sync readiness | 8 blocked, 0 ready; offline delivery/orchestration verified |
| Legacy retirement readiness | 65 blocked, 0 eligible |
| Migration manifest | 474 migrations generated |
| Web production build | passed |
| Patient production build | passed; existing chunk-size warning only |
| Admin production build | passed; existing Vite deprecation warnings only |

Expected SQLite experimental warnings, the reviewed financial-shadow warning, and the reviewed settlement fallback warning did not fail any gate.

## Branch relationship

Before this receipt:

```text
main HEAD: b6afd871871eb9d595aba10eaa9b9f873169c0d8
CDB implementation HEAD: 788d7dba70578fd153fe9dd30629a7c65a80dc90
main...CDB: 0 / 50
```

The CDB branch contains the latest local `main`. The dirty owner-facing root checkout remained read-only and untouched.

## Continuation

The next safe local scope is CDB-110H: disconnected multi-event rehearsal and recovery evidence without network transport, runtime worker registration, or synchronization activation.

CDB-110 remains incomplete until multi-event rehearsal, remaining tombstone semantics, reviewed network/runtime integration, legacy-write retirement evidence, production observation, and explicit owner activation authorization are complete.

## Safety

No push, deployment, production access, production mutation, network request, route registration, fetch client, worker/scheduler registration, local-server start, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration occurred.
