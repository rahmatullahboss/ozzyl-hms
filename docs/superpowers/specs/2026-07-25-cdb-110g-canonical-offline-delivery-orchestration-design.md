# CDB-110G Canonical Offline Delivery and Orchestration Design

**Status:** approved by the continuous CDB execution mandate

**Date:** 2026-07-25

**Scope:** one-event offline source claim, target receive/claim/apply, and source publication orchestration through a typed delivery port

## Context

CDB-110B through CDB-110F now provide all durable primitives required for a canonical event to move between two database nodes:

- public-ID protocol envelopes;
- a durable target inbox with receive, claim, retry, dead-letter, and atomic apply completion;
- deterministic source outbox conversion;
- authenticated business projections and entity-specific target apply;
- a durable source outbox claim, retry, dead-letter, lease recovery, and publication acknowledgement lifecycle.

The remaining gap is coordination. No canonical module currently performs the complete source-to-target sequence, and no canonical transport interface exists. The repository has a legacy `/api/sync/ingest` route and shell worker, but those use generic entity IDs and snapshot-era contracts. CDB-110G must not wire the canonical protocol into that route or worker.

## Goals

1. Define a typed delivery port that can later be implemented over a network without changing orchestration semantics.
2. Provide an offline database-backed target adapter for deterministic tests and rehearsals.
3. Coordinate exactly one source event through claim, receive, target claim, business apply, and source publication acknowledgement.
4. Recover safely when the target already applied the event but the source did not record publication.
5. Preserve source and target retry/dead-letter evidence independently.
6. Return stable machine-readable outcomes without exposing raw error messages.
7. Keep every runtime route, worker, scheduler, and feature flag disconnected.

## Non-goals

- no HTTP, WebSocket, queue, RPC, or fetch implementation;
- no modification of `/api/sync/ingest`;
- no worker, cron, scheduler, startup hook, or shell-script integration;
- no multi-event batch loop;
- no production access or mutation;
- no synchronization activation;
- no legacy snapshot replacement;
- no legacy-write retirement;
- no new user-facing configuration;
- no automatic wall-clock or random-ID generation inside the coordinator.

## Considered approaches

### 1. Reuse the existing generic HTTP sync route

This would offer an immediate transport, but the route uses generic entity IDs, legacy payload hashes, mapping tables, and snapshot-era apply semantics. Adding canonical behavior there would mix two protocols and create a premature runtime activation surface.

### 2. Add a second persisted dispatch queue

A delivery queue could record transport attempts, but the source canonical outbox already owns durable delivery state, and the target inbox already owns durable receive/apply state. A third queue would duplicate lifecycle authority before a real transport exists.

### 3. Typed delivery port plus offline database adapter — selected

The coordinator depends on an interface, not on fetch or routes. An offline adapter wraps a target database and invokes the existing target inbox/business primitives. Existing source and target tables remain the durable evidence. A later network adapter can implement the same request/response contract without changing the coordinator.

## Architecture

Create three focused units:

1. `local-sync-inbox.ts` gains a read-only, evidence-validating inbox inspection function.
2. `local-sync-delivery.ts` defines the delivery port and provides the offline target database adapter.
3. `local-sync-orchestrator.ts` coordinates one source claim and one delivery outcome.

The coordinator never imports Hono, environment variables, fetch, filesystem APIs, shell scripts, or application startup modules.

## Target inbox inspection

Add:

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

The function validates the supplied envelope and compares all stored envelope and dependency evidence using the same canonical equality rules as receive replay handling. A same-ID or same-idempotency row with different evidence throws `CanonicalSyncInboxConflictError`. It performs no mutation.

## Delivery port

Define:

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
  | {
      status: 'applied';
      eventPublicId: string;
      targetAttemptCount: number;
      replayed: boolean;
    }
  | {
      status: 'retry';
      eventPublicId: string;
      targetAttemptCount: number;
      retryAtUtc: string;
      errorCode: string;
      errorHash: string;
    }
  | {
      status: 'dead_letter';
      eventPublicId: string;
      targetAttemptCount: number;
      errorCode: string;
      errorHash: string;
    }
  | {
      status: 'busy';
      eventPublicId: string;
      targetAttemptCount: number;
      retryAtUtc: string;
      errorCode: 'CANONICAL_SYNC_TARGET_BUSY';
      errorHash: string;
    };

export interface CanonicalSyncDeliveryPort {
  deliver(request: CanonicalSyncDeliveryRequest): Promise<CanonicalSyncDeliveryResult>;
}
```

The result never includes a raw exception message or stack trace.

## Offline target adapter

`createCanonicalSyncDatabaseDeliveryPort(targetDb)` returns a delivery port whose `deliver()` method performs:

1. validate request timestamps and maximum attempts;
2. call `receiveCanonicalSyncEnvelope()`;
3. inspect the exact target inbox evidence;
4. return `applied` with `replayed: true` when the event is already applied;
5. return `dead_letter` when the target already dead-lettered the event;
6. return `busy` when an active target claim exists;
7. return `retry` when a future target retry is not due;
8. claim pending, due-retry, or expired-applying target evidence;
9. call `completeCanonicalSyncBusinessEvent()`;
10. return `applied` when the business mutation and target receipt commit;
11. on failure, generate stable bounded error evidence and schedule target retry or dead-letter according to the target claim attempt count and configured maximum.

The adapter performs no source mutation.

## Target error classification

Classify errors conservatively:

### Permanent

- canonical protocol conflict;
- target inbox semantic conflict;
- authenticated business-payload validation failure;
- invalid deterministic caller input (`TypeError` or `RangeError`).

Permanent errors dead-letter the active target claim immediately.

### Retryable

- business apply/dependency/version assertion failure;
- target inbox state race;
- unknown operational error.

Retryable errors schedule retry until `targetMaxAttempts`; the final attempt dead-letters.

Error evidence contains only:

```text
phase
error class name
stable code when available
SHA-256 of the original message
```

The raw message is not returned or persisted as a user-visible summary.

## One-event source coordinator

Define:

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

export type CanonicalSyncOrchestrationResult =
  | { status: 'idle' }
  | {
      status: 'published';
      eventPublicId: string;
      sourceAttemptCount: number;
      targetAttemptCount: number;
      targetReplayed: boolean;
    }
  | {
      status: 'retry';
      eventPublicId: string;
      sourceAttemptCount: number;
      retryAtUtc: string;
      errorCode: string;
      errorHash: string;
    }
  | {
      status: 'dead_letter';
      eventPublicId: string;
      sourceAttemptCount: number;
      errorCode: string;
      errorHash: string;
    }
  | {
      status: 'source_ack_pending';
      eventPublicId: string;
      sourceAttemptCount: number;
      targetAttemptCount: number;
      recoverAfterUtc: string;
      errorCode: 'CANONICAL_SYNC_SOURCE_ACK_PENDING';
      errorHash: string;
    };
```

`runCanonicalSyncOrchestrationOnce(sourceDb, deliveryPort, input)`:

1. validates a monotonic explicit timeline;
2. derives deterministic source and target claim public IDs from stable request evidence;
3. calls `claimNextCanonicalSyncOutboxEnvelope()`;
4. returns `idle` when no event is claimable or a claim race is lost;
5. submits the exact claimed envelope to the delivery port;
6. on target `applied`, calls `completeCanonicalSyncOutboxPublication()`;
7. on target `retry` or `busy`, schedules source retry no earlier than both source and target retry evidence;
8. on target `dead_letter`, dead-letters the exact source claim immediately;
9. on transport throw/no result, schedules source retry or final dead-letter using source attempts;
10. if the target applied but source acknowledgement fails because source ownership expired or raced, returns `source_ack_pending` without attempting an invalid source failure transition.

## Explicit source permanent failure

Add an exact receipt-owned helper to `local-sync-outbox-lifecycle.ts`:

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

It uses the same guarded ownership and expiry checks as retry/dead-letter failure handling but always transitions the exact active claim to `dead_letter`. This is used only when the target returned permanent dead-letter evidence.

## Crash and replay semantics

### Target applied, response lost

The source schedules retry because it did not receive a successful delivery result. On a later source attempt, target receive is replay-safe, inspection returns `applied`, and the source records publication without reapplying business state.

### Target applied, source publication acknowledgement failed

The coordinator returns `source_ack_pending`. After the source lease expires, CDB-110F recovery makes it retryable. The next target delivery observes the already-applied target event and completes source publication.

### Target received but not applied

A repeated source delivery replays receive evidence and resumes from target inbox status. Active target ownership returns `busy`; due retry or expired target ownership may be claimed.

### Permanent target conflict

The target is dead-lettered with stable error evidence, and the exact source claim is dead-lettered without repeated delivery.

## Timestamp rules

All timestamps are caller-supplied UTC values. The coordinator validates:

```text
sourceClaimedAtUtc <= targetReceivedAtUtc
sourceClaimedAtUtc <= targetClaimedAtUtc
sourceClaimedAtUtc < sourceClaimExpiresAtUtc
targetClaimedAtUtc < targetClaimExpiresAtUtc
targetClaimedAtUtc <= targetAppliedAtUtc
targetAppliedAtUtc <= sourcePublishedAtUtc
sourcePublishedAtUtc < sourceClaimExpiresAtUtc for the normal success path
sourceNextAttemptAtUtc > sourceClaimedAtUtc
targetNextAttemptAtUtc > targetClaimedAtUtc
```

The modules never call `Date.now()` or `crypto.randomUUID()`.

## Testing

Add focused tests for:

- exact inbox inspection and conflict detection;
- first-time receive, target claim, business apply, and source publication;
- target applied replay completing source publication without duplicate business rows;
- target active claim returning busy and scheduling source retry;
- future target retry propagating a no-earlier source retry;
- target retryable apply failure and final-attempt dead-letter;
- permanent target payload/conflict dead-lettering both sides;
- transport throw scheduling source retry/final dead-letter;
- target applied with simulated response loss, then replay recovery;
- target applied with expired source acknowledgement returning `source_ack_pending`;
- deterministic claim IDs and stable error hashes;
- monotonic timeline validation;
- no fetch, Hono, route, worker, scheduler, startup, or shell-script caller;
- readiness metadata remains offline and all eight entities remain blocked.

## Readiness and governance

Extend the registry protocol foundation with:

```json
{
  "offlineDeliveryOrchestrationStatus": "verified_offline",
  "offlineDeliveryModule": "src/lib/canonical/local-sync-delivery.ts",
  "offlineOrchestrationModule": "src/lib/canonical/local-sync-orchestrator.ts",
  "offlineOrchestrationTest": "test/canonical/canonical-sync-offline-orchestration.test.ts"
}
```

Do not change:

- any `localCanonicalOutboxConsumption` value;
- `runtimeConsumptionConnected`;
- `businessApplyConnected`;
- `activationAuthorized`.

Offline end-to-end capability is not runtime readiness.

## Checkpoints

1. target inbox inspection;
2. offline target delivery adapter;
3. source permanent dead-letter helper and one-event coordinator;
4. crash/replay/failure coverage;
5. readiness, runtime isolation, verification report, and clean checkpoint.

## Continuation

After CDB-110G, the next safe scope is disconnected multi-event rehearsal and recovery evidence. Network transport and runtime worker registration remain separate explicitly authorized tasks.

## Safety invariant

CDB-110G must end with no push, deployment, production access, production mutation, network request, route registration, worker/scheduler registration, local-server startup, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration.
