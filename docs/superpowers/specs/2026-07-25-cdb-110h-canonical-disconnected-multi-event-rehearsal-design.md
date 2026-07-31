# CDB-110H Canonical Disconnected Multi-Event Rehearsal Design

**Status:** approved by the continuous CDB execution mandate

**Date:** 2026-07-25

**Scope:** deterministic, explicit-step, offline multi-event rehearsal and recovery evidence over the CDB-110G one-event orchestrator

## Context

CDB-110G proves that one canonical source event can be claimed, received, applied, and acknowledged through a typed offline delivery port. It also proves isolated response-loss and source-acknowledgement recovery cases.

The next gap is program-level rehearsal evidence across multiple source events. The repository does not yet prove, in one repeatable disconnected flow, that:

- a failed/retrying predecessor blocks later events of the same aggregate;
- an unrelated aggregate can still progress;
- a target-applied response-loss event can later replay and publish exactly once;
- same-aggregate versions resume in order after predecessor recovery;
- a drained source is detected without an unbounded loop;
- the resulting evidence is aggregate-only and contains no payload, PHI, SQL, or raw errors.

CDB-110H must remain offline and must not become a worker implementation.

## Goals

1. Provide a reusable explicit-step rehearsal runner around `runCanonicalSyncOrchestrationOnce()`.
2. Validate the complete rehearsal plan before the first source mutation.
3. Execute a bounded number of caller-supplied orchestration steps serially.
4. Stop after the source is drained while preserving a sanitized transcript.
5. Produce deterministic aggregate counters and a SHA-256 transcript digest.
6. Prove same-aggregate ordering, unrelated-aggregate progress, response-loss replay recovery, and exact target/source convergence.
7. Keep every route, network adapter, worker, scheduler, startup hook, and activation flag disconnected.

## Non-goals

- no HTTP, fetch, RPC, queue, or network adapter;
- no application worker, daemon, cron, timer, scheduler, or startup registration;
- no automatic wall-clock or random-ID generation;
- no unbounded `while` loop;
- no production or protected rehearsal-clone access;
- no filesystem snapshot, SQL bundle, raw database export, or PHI artifact;
- no runtime synchronization activation;
- no multi-tenant rehearsal in one invocation;
- no remaining entity tombstone implementation;
- no legacy-write retirement;
- no CDB-to-main integration.

## Considered approaches

### 1. Test-only orchestration loops

Vitest could directly call the one-event orchestrator repeatedly. This would prove a scenario, but it would not provide a reusable validated runner or a stable aggregate receipt for later disconnected drills.

### 2. CLI rehearsal command

A CLI could create fixtures and execute a sequence. This would introduce process, file, and argument surfaces before a runtime or operator contract has been reviewed. It would also make accidental external database use easier.

### 3. Explicit-step library runner with aggregate receipt — selected

A pure library module accepts a bounded list of already explicit orchestration inputs, validates the whole plan first, calls the one-event orchestrator serially, stops on `idle`, and returns a sanitized deterministic receipt. Tests construct two in-memory SQLite nodes and may decorate the offline delivery port to simulate response loss.

## Architecture

Create one focused module:

```text
src/lib/canonical/local-sync-rehearsal.ts
```

It depends only on:

- `CanonicalBatchDatabase`;
- `CanonicalSyncDeliveryPort`;
- `runCanonicalSyncOrchestrationOnce()`;
- exported orchestration input validation;
- `createRequestFingerprint()`.

The one-event orchestrator remains the only unit that changes source lifecycle state. The delivery port remains the only target coordination interface. The rehearsal runner only validates, sequences, summarizes, and hashes results.

## Orchestration validation export

Rename the private orchestration input validator to:

```ts
export function validateCanonicalSyncOrchestrationInput(
  input: CanonicalSyncOrchestrationInput,
): void;
```

`runCanonicalSyncOrchestrationOnce()` continues to call it. The rehearsal runner calls it for every planned step before executing step one. This prevents a later malformed step from being discovered after earlier source mutations.

## Rehearsal input

Define:

```ts
export interface CanonicalSyncOfflineRehearsalStep {
  stepPublicId: string;
  orchestration: CanonicalSyncOrchestrationInput;
}

export interface CanonicalSyncOfflineRehearsalInput {
  rehearsalPublicId: string;
  steps: readonly CanonicalSyncOfflineRehearsalStep[];
}
```

Validation rules:

- `rehearsalPublicId` is a non-numeric stable public ID, maximum 160 characters;
- `steps` contains 1–100 entries;
- every `stepPublicId` is a unique non-numeric stable public ID, maximum 160 characters;
- every orchestration input validates before any execution;
- all steps use the same tenant, source node, source claim owner, and target claim owner;
- `sourceClaimedAtUtc` is strictly increasing between steps;
- a later step may intentionally run before a prior event's retry time so an unrelated aggregate can prove non-blocking progress; each step's own timeline must still be internally valid;
- no step object or result contains a payload or raw database row.

The runner does not invent missing timestamps or owners.

## Sanitized step receipt

Define:

```ts
export type CanonicalSyncOfflineRehearsalStepReceipt = {
  stepPublicId: string;
  status:
    | 'idle'
    | 'published'
    | 'retry'
    | 'dead_letter'
    | 'source_ack_pending';
  eventPublicId: string | null;
  sourceAttemptCount: number | null;
  targetAttemptCount: number | null;
  targetReplayed: boolean | null;
  retryAtUtc: string | null;
  recoverAfterUtc: string | null;
  errorCode: string | null;
  errorHash: string | null;
};
```

The receipt deliberately excludes:

- canonical envelope payload;
- business mutation body;
- patient or practitioner identity;
- SQL or database row values;
- exception message or stack trace;
- claim-owner secrets or transport credentials.

## Aggregate rehearsal receipt

Define:

```ts
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
```

`eventPublicIds` contains sorted unique public event IDs only. `transcriptSha256` is computed over stable canonical JSON containing all receipt fields except the digest itself.

## Execution semantics

`runCanonicalSyncOfflineRehearsal(sourceDb, deliveryPort, input)`:

1. validates the complete rehearsal plan;
2. executes steps serially in array order;
3. converts each orchestration result to a sanitized step receipt;
4. continues after `published`, `retry`, `dead_letter`, or `source_ack_pending` so unrelated aggregate progress can be rehearsed;
5. stops immediately after the first `idle` result because the source is drained or no work is due at that explicit point;
6. does not execute remaining planned steps after `idle`;
7. derives counts, sorted event identities, and transcript digest;
8. returns the aggregate receipt.

There is no internal retry loop. Recovery happens only when a later explicit step is supplied with a later validated timeline.

## Primary disconnected scenario

The main rehearsal uses separate in-memory source and target SQLite databases with three source events inserted in this order:

1. encounter A version 1 — started;
2. encounter A version 2 — completed;
3. encounter B version 1 — started.

The source authority already contains encounter A’s final completed row and encounter B’s in-progress row, allowing both historical events for A to project from authenticated authority.

The explicit steps are:

### Step 1 — response lost after target commit

- source claims encounter A version 1;
- target receives and applies it;
- decorated delivery port throws after target commit;
- source transitions to retry;
- target has one applied event and one encounter row.

### Step 2 — unrelated aggregate progresses

- run before encounter A’s retry becomes due;
- encounter A version 1 is future retry;
- encounter A version 2 remains blocked by its unpublished predecessor;
- encounter B version 1 is selected and published;
- proves the queue does not globally stall.

### Step 3 — predecessor replay recovery

- run after encounter A version 1 becomes due;
- source reclaims version 1;
- target returns already-applied replay evidence;
- source records publication without duplicate target business mutation.

### Step 4 — later same-aggregate version

- encounter A version 2 becomes claimable only after version 1 is published;
- target applies completion against aggregate version 1;
- target version advances to 2;
- source records publication.

### Step 5 — drain detection

- no source event remains claimable;
- runner receives `idle`, marks `drained: true`, and stops.

Expected aggregate receipt:

```text
planned steps: 5
executed steps: 5
drained: true
published: 3
retry: 1
dead-letter: 0
source-ack-pending: 0
idle: 1
unique events: 3
```

## Additional recovery scenarios

Focused tests also prove:

- a permanent target dead-letter for one aggregate does not hide later unrelated work;
- source acknowledgement pending is preserved as evidence and does not become a false success;
- repeated identical rehearsal inputs over identical isolated databases produce identical sanitized transcript digests;
- duplicate step IDs, mixed tenants/nodes/owners, invalid later timelines, or more than 100 steps are rejected before source mutation;
- an early `idle` prevents trailing steps from running.

## Runtime isolation

Add a runtime-isolation test proving:

- no application source outside the rehearsal module imports or calls `runCanonicalSyncOfflineRehearsal`;
- the rehearsal module contains no fetch, Hono, cloud-sync environment access, Node network import, timer, wall-clock, random-ID, filesystem, child-process, or process-argument primitive;
- no route, worker, scheduler, startup, or shell script references the rehearsal module.

## Readiness and tracker

Extend the registry protocol foundation with:

```json
{
  "disconnectedMultiEventRehearsalStatus": "verified_offline",
  "disconnectedMultiEventRehearsalModule": "src/lib/canonical/local-sync-rehearsal.ts",
  "disconnectedMultiEventRehearsalTest": "test/canonical/canonical-sync-offline-rehearsal.test.ts"
}
```

Do not change:

- any `localCanonicalOutboxConsumption` value;
- `runtimeConsumptionConnected`;
- `businessApplyConnected`;
- `activationAuthorized`.

All eight entities remain blocked. A disconnected library rehearsal is not a runtime worker, network transport, production observation, or activation authorization.

## Verification

Required gates:

- focused rehearsal, orchestration, delivery, lifecycle, readiness, isolation, and continuation tests;
- full canonical suite;
- TypeScript;
- canonical governance;
- canonical local-sync readiness;
- legacy retirement readiness;
- migration manifest;
- web, patient, and admin production builds.

## Checkpoints

1. exported orchestration validation and rehearsal contract;
2. serial runner and sanitized deterministic receipt;
3. multi-event ordering and response-loss recovery scenario;
4. validation, early-drain, terminal, and digest coverage;
5. readiness, isolation, verification report, and clean checkpoint.

## Continuation

After CDB-110H, the next safe scope is reviewed missing tombstone semantics for the six blocked entities. Network transport and runtime worker registration remain separate explicitly authorized scopes.

## Safety invariant

CDB-110H must end with no push, deployment, production access, protected clone access, production mutation, network request, route registration, worker/scheduler registration, process execution path, local-server startup, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration.
