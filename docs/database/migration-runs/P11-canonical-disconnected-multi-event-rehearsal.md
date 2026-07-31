# P11 Canonical Disconnected Multi-Event Rehearsal Verification

**Checkpoint:** CDB-110H

**Verified:** 2026-07-25T22:05:00+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `b6afd871871eb9d595aba10eaa9b9f873169c0d8`

**Verified implementation head before this receipt:** `10f49c0ba187680a846ef2ba82993bb87105aaaf`

## Result

CDB-110H adds a bounded, explicit-step, disconnected canonical synchronization rehearsal around the CDB-110G one-event orchestrator. It proves multi-event ordering and crash/replay convergence without introducing a runtime worker, route, network transport, scheduler, CLI, timer, startup hook, or activation path.

The rehearsal now proves:

- complete-plan validation before the first source database mutation;
- finite serial execution over 1–100 caller-supplied steps;
- stop-on-first-idle drain detection;
- source retry after target apply response loss;
- unrelated aggregate progress while the failed aggregate is not yet retryable;
- replay-safe publication of the already-applied predecessor;
- later same-aggregate version application only after predecessor publication;
- permanent target dead-letter without global queue starvation;
- deterministic aggregate-only transcript receipts and SHA-256 evidence;
- no payload, mutation body, patient identity, SQL, raw exception, or stack leakage.

The implementation remains offline and disconnected from application runtime.

## Rehearsal architecture

`src/lib/canonical/local-sync-rehearsal.ts` accepts:

- one stable rehearsal public ID;
- 1–100 explicit steps;
- one validated `CanonicalSyncOrchestrationInput` per step;
- a typed `CanonicalSyncDeliveryPort`;
- the source `CanonicalBatchDatabase`.

The runner does not invent timestamps, owners, claim IDs, retry times, or target evidence. It validates every step before executing step one, then calls `runCanonicalSyncOrchestrationOnce()` serially. It has no internal retry loop and no unbounded `while` loop.

The existing orchestrator validator is exported as `validateCanonicalSyncOrchestrationInput()` and remains the authority for per-step timeline and ownership validation.

## Full-plan prevalidation

Before any database or delivery call, the rehearsal rejects:

- numeric or malformed rehearsal IDs;
- zero steps or more than 100 steps;
- duplicate step public IDs;
- mixed tenant IDs;
- mixed source-node identities;
- mixed source claim owners;
- mixed target claim owners;
- non-increasing source claim timestamps;
- any malformed later orchestration timeline.

Tests use a guard database and delivery port that throw on access and prove invalid plans cause zero database calls and zero delivery calls.

## Sanitized aggregate receipt

The rehearsal returns only:

- rehearsal and source-node public identities;
- planned and executed step counts;
- drained status;
- published, retry, dead-letter, source-ack-pending, and idle counters;
- sorted unique event public IDs;
- sanitized per-step lifecycle evidence;
- a deterministic transcript SHA-256 digest.

The receipt intentionally excludes canonical envelope payloads, business mutations, patient sync keys, claim-owner identities, raw database rows, SQL, exception messages, and stack traces.

## Primary five-step recovery scenario

The two-node in-memory SQLite rehearsal inserts three source events in this order:

1. encounter A started — aggregate version 1;
2. encounter A completed — aggregate version 2;
3. encounter B started — aggregate version 1.

The explicit rehearsal sequence is:

### Step 1 — target commits, response is lost

Encounter A version 1 is claimed and applied on the target. The decorated offline delivery port throws after the target commit. The source moves the exact claim to retry. The target has one applied inbox event and one encounter row.

### Step 2 — unrelated aggregate progresses

This step runs before encounter A version 1 becomes retryable. Encounter A version 2 remains blocked by its unpublished predecessor. Encounter B version 1 is selected, applied, and published, proving the source queue does not globally stall.

### Step 3 — predecessor replay recovery

After the source retry becomes due, encounter A version 1 is reclaimed. The target returns already-applied replay evidence, no duplicate business mutation occurs, and the source records exact publication with source attempt count 2 and target replay evidence.

### Step 4 — later same-aggregate version

Encounter A version 2 becomes claimable only after version 1 is published. The target applies completion against aggregate version 1 and advances the entity version to 2. The source records publication.

### Step 5 — drain

No event remains claimable. The orchestrator returns `idle`; the rehearsal marks `drained: true` and stops.

Expected and verified aggregate receipt:

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

## Exact convergence evidence

Source outbox state after the primary rehearsal:

```text
event-a-start: published, processing attempts 2
event-a-complete: published, processing attempts 1
event-b-start: published, processing attempts 1
```

Target state:

```text
3 inbox events applied
encounter A: completed, applied version 2
encounter B: in_progress, applied version 1
2 canonical encounter rows
no duplicate target event or encounter row
```

Two independently constructed identical source/target harness pairs produce identical receipts and identical transcript SHA-256 values.

## Terminal predecessor behavior

A separate rehearsal returns permanent target dead-letter for encounter A version 1. The source records exact dead-letter evidence. A later explicit step still publishes encounter B version 1, while encounter A version 2 remains pending because its predecessor was not published. This proves terminal aggregate failure does not hide unrelated work and does not violate same-aggregate ordering.

## Runtime isolation

`test/canonical/canonical-sync-rehearsal-runtime-isolation.test.ts` proves:

- no application source outside the rehearsal module imports or calls the rehearsal runner;
- the module contains no `fetch`, Hono, cloud-sync environment access, timer, wall-clock, random-ID, filesystem, child-process, process-argument, or unbounded-loop primitive.

The existing delivery/orchestration isolation contract allows the rehearsal module as an approved offline caller while continuing to reject routes, workers, schedulers, startup code, and other runtime consumers.

## Readiness truthfulness

The protocol foundation now records:

```json
{
  "disconnectedMultiEventRehearsalStatus": "verified_offline",
  "disconnectedMultiEventRehearsalModule": "src/lib/canonical/local-sync-rehearsal.ts",
  "disconnectedMultiEventRehearsalTest": "test/canonical/canonical-sync-offline-rehearsal.test.ts"
}
```

The readiness result remains intentionally blocked:

```text
canonical sync entities: 8
ready: 0
blocked: 8
disconnected multi-event rehearsal: verified_offline
runtime consumption connected: false
business apply connected: false
activation authorized: false
```

All eight entities remain blocked on local canonical outbox runtime consumption. Encounter, service request, service event, deposit, compensation accrual, and inventory movement also remain blocked on reviewed tombstone semantics.

Legacy retirement remains blocked for all 65 registered allowances; none is eligible.

## Checkpoint commits

- `b5c310ecc` — CDB-110H disconnected multi-event rehearsal design;
- `db21b3fc6` — CDB-110H implementation plan;
- `10f49c0ba` — bounded rehearsal runner, validation, ordering, response-loss recovery, terminal behavior, and deterministic receipts;
- `69c20d174` — readiness evidence, runtime isolation, tracker update, and verification receipt.

These commits exist only on `program/cdb-main-continuous-20260725`. No CDB commit was merged or cherry-picked into local `main`.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| Focused rehearsal/readiness/isolation integration | 5 files, 20 tests passed |
| Rehearsal/orchestration/delivery/lifecycle regression | 4 files, 40 tests passed |
| Full canonical suite | 168 files, 1,206 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Canonical local-sync readiness | 8 blocked, 0 ready; disconnected rehearsal verified offline |
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
CDB implementation HEAD: 10f49c0ba187680a846ef2ba82993bb87105aaaf
```

The CDB branch contains the latest local `main`. The owner-facing root checkout remained read-only and untouched.

## Continuation

The next safe local scope is CDB-110I: review and implement the six missing entity tombstone semantics without runtime synchronization activation.

Network transport, runtime worker registration, production observation, legacy-write retirement, and owner activation remain separate authorization-gated scopes.

## Safety

No push, deployment, production access, protected rehearsal-clone access, production mutation, network request, route registration, worker/scheduler registration, CLI execution path, local-server start, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration occurred.
