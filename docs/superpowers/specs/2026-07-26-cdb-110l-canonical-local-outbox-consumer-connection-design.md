# CDB-110L Canonical Local Outbox Consumer Connection Design

**Status:** approved by the continuous CDB execution mandate

**Date:** 2026-07-26

**Scope:** typed, explicit one-event connection from a local canonical source outbox to the existing canonical delivery/orchestration boundary, without runtime registration or activation

## Context

CDB-110B through CDB-110K now provide:

- canonical public-ID envelopes;
- durable target inbox receive/claim/retry/dead-letter/apply completion;
- deterministic source outbox conversion;
- authenticated business projection and guarded target apply for all eight entity families;
- durable source claim/retry/dead-letter/publication lifecycle;
- a typed delivery port and one-event source-to-target orchestrator;
- bounded disconnected rehearsals;
- verified offline terminal semantics for all eight entity families.

The remaining readiness reason for every entity is `LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING`.

The repository also contains a legacy local-server shell worker and `/api/sync/outbox/flush` route. They use `local_sync_outbox`, generic entity IDs, snapshot-era payloads, legacy mapping responses, and direct `fetch`. They are not canonical protocol consumers and must not be reused, modified, or treated as evidence for canonical consumption.

## Goal

Add a small application-facing connection contract that binds:

1. a canonical source database;
2. a canonical delivery port;
3. the existing one-event orchestrator.

The contract proves that an application runtime can later be given an explicit canonical consumer dependency without changing canonical lifecycle semantics.

CDB-110L verifies this contract offline only. It does not register or activate it.

## Non-goals

- no Hono route;
- no modification of `src/routes/sync.ts`;
- no modification of `scripts/local-server/sync-worker.sh`;
- no `fetch`, HTTP, WebSocket, queue, RPC, or socket transport;
- no timer, scheduler, cron, startup hook, background loop, or unbounded loop;
- no environment-variable lookup;
- no `Date.now()`, random UUID, implicit clock, or implicit claim identity;
- no production access or mutation;
- no feature flag or traffic change;
- no runtime registration;
- no readiness promotion to connected/ready;
- no legacy-write retirement.

## Considered approaches

### 1. Reuse the legacy `/api/sync/outbox/flush` route

Rejected. The route selects from `local_sync_outbox`, sends generic `entityType/entityId` payloads, and applies mapping-era semantics. Mixing canonical envelopes into that route would create protocol ambiguity and premature activation.

### 2. Register the canonical orchestrator in the shell worker

Rejected. This would be an actual runtime worker connection, require environment/network decisions, and violate the current no-registration/no-activation boundary.

### 3. Add another bounded rehearsal wrapper

Rejected. `local-sync-rehearsal.ts` already owns explicit multi-step rehearsal receipts. A second rehearsal wrapper would duplicate test-only semantics rather than provide an application-facing dependency boundary.

### 4. Typed explicit consumer connection — selected

Create `src/lib/canonical/local-sync-consumer.ts` with a connection factory that validates and binds a source database and delivery port, then exposes exactly one operation:

```ts
consumeOnce(input: CanonicalSyncOrchestrationInput): Promise<CanonicalSyncOrchestrationResult>
```

`consumeOnce()` validates the full orchestration input before source mutation and delegates exactly once to `runCanonicalSyncOrchestrationOnce()`.

## Public contract

```ts
export interface CanonicalSyncLocalOutboxConsumerConnection {
  readonly kind: 'canonical_local_outbox_consumer';
  consumeOnce(
    input: CanonicalSyncOrchestrationInput,
  ): Promise<CanonicalSyncOrchestrationResult>;
}

export function createCanonicalSyncLocalOutboxConsumerConnection(
  sourceDb: CanonicalBatchDatabase,
  deliveryPort: CanonicalSyncDeliveryPort,
): CanonicalSyncLocalOutboxConsumerConnection;
```

## Validation and failure behavior

Connection creation fails before returning when:

- `sourceDb.prepare` is missing;
- `sourceDb.batch` is missing;
- `deliveryPort.deliver` is missing.

`consumeOnce()`:

1. validates the caller-supplied orchestration input using `validateCanonicalSyncOrchestrationInput()`;
2. calls `runCanonicalSyncOrchestrationOnce()` exactly once;
3. returns its stable machine-readable result unchanged.

Invalid input must fail before source claim or delivery. The connection does not catch or rewrite unexpected programming errors because the orchestrator already owns stable transport/lifecycle outcomes.

## Lifecycle ownership

The connection creates no durable state. Ownership remains:

- source outbox lifecycle table: source claim/retry/dead-letter/publication;
- target inbox lifecycle table: target receive/claim/retry/dead-letter/apply;
- canonical business tables and entity versions: target business convergence;
- caller: timestamps, owner identities, maximum attempts, and invocation policy.

## Runtime isolation

Static tests must prove:

- no application route, Worker entry point, scheduler, startup file, shell script, or local-server loop imports the consumer connection;
- the consumer module contains no network, framework, timer, environment, wall-clock, random-ID, filesystem, or process primitive;
- only approved canonical offline modules and tests reference the connection factory before a separately authorized runtime-registration task.

## Readiness model

Extend `protocolFoundation` with offline capability evidence:

```json
{
  "localOutboxConsumerContractStatus": "verified_offline",
  "localOutboxConsumerModule": "src/lib/canonical/local-sync-consumer.ts",
  "localOutboxConsumerTest": "test/canonical/canonical-sync-local-outbox-consumer.test.ts",
  "localOutboxConsumerRuntimeIsolationTest": "test/canonical/canonical-sync-local-outbox-consumer-runtime-isolation.test.ts"
}
```

Do not change:

```text
runtimeConsumptionConnected: false
businessApplyConnected: false
localCanonicalOutboxConsumption: false (all entities)
ready entity count: 0
blocked entity count: 8
```

Every entity remains blocked on `LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING` because the contract is not registered in an application runtime.

## Testing

Focused tests cover:

- invalid source database rejection;
- invalid delivery port rejection;
- full input validation before source mutation;
- exactly one orchestrator invocation per `consumeOnce()`;
- published result propagation;
- idle result propagation;
- retry, dead-letter, and source-ack-pending propagation;
- no duplicate claim/delivery caused by the connection wrapper;
- static runtime isolation;
- readiness metadata evidence while 0/8 ready remains unchanged.

## Acceptance criteria

CDB-110L is complete when:

1. the typed connection module exists and is TypeScript-clean;
2. focused behavior tests pass;
3. runtime-isolation tests prove no registration or network/runtime primitive;
4. readiness metadata records `verified_offline` capability;
5. all eight entities remain blocked and zero ready;
6. full canonical, governance, retirement, migration-manifest, and production-build gates pass;
7. tracker and verification receipts identify the next authorization-gated runtime-registration scope.

## Safety

No push, deployment, production access, production mutation, network request, route registration, Worker/scheduler/startup registration, synchronization activation, feature-flag change, local-server enablement, legacy-write retirement, or CDB-to-main integration is authorized by this design.
