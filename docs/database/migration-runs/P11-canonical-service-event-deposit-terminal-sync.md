# P11 Canonical Service-Event and Deposit Terminal Sync Verification

**Checkpoint:** CDB-110K

**Verified:** 2026-07-26T00:38:00+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `b6afd871871eb9d595aba10eaa9b9f873169c0d8`

**Verified implementation head before this receipt:** `714b76af392c46bbd904ba120ff98db81ddef65d`

## Result

CDB-110K completes the two remaining reviewed terminal lifecycle synchronization paths:

- canonical service-event cancellation;
- canonical deposit refund projection.

Both paths remain lifecycle `upsert` operations. Neither physically deletes canonical data and neither is represented as a destructive tombstone.

The implementation covers replay-safe source commands, deterministic outbox conversion, authenticated mutation validation, historical source projection, guarded target apply, cross-aggregate deposit versioning, atomic inbox/entity-version completion, disconnected two-node orchestration, and duplicate-free source and target replay.

Runtime synchronization remains disconnected.

## Service-event cancellation source authority

`cancelServiceEvent()`:

- validates exact tenant, event, cancellation time, idempotency, outbox event, and business date;
- checks command replay before mutable-state evaluation;
- accepts only a currently posted service event;
- requires the event to be the request's current `last_event_public_id`;
- reverses fulfilled quantity only for quantity-bearing event types;
- preserves zero-decrement semantics for accepted events;
- derives the request's prior active/partially fulfilled/fulfilled status deterministically;
- restores the prior service-event identity when available;
- updates the service event and request in one guarded command batch;
- emits `canonical.service_event.cancelled` on the original service-event aggregate;
- produces no duplicate command receipt or outbox event on exact replay.

A stale request, non-current event, terminal event, invalid time, invalid quantity, or concurrent authority mismatch fails closed.

## Deposit refund source authority and version scope

The existing `refundDeposit()` accounting command remains the source authority. Its outbox row keeps:

```text
aggregate type: canonical_refund
aggregate public ID: refund public ID
event type: canonical.deposit.refunded
```

The converter maps that source fact into the canonical deposit synchronization stream:

```text
entity type: deposit
entity public ID: deposit public ID
operation: upsert
```

Deposit entity versions are derived across both source aggregate families:

```text
canonical_deposit + canonical.deposit.recorded
canonical_deposit + canonical.deposit.applied
canonical_refund + canonical.deposit.refunded
```

This produces one monotonic deposit version stream while preserving the immutable refund fact as its own source aggregate. Unsupported predecessors, ambiguous deposit identity, duplicate authority, malformed refund lineage, or an invalid version sequence fail closed.

## Authenticated terminal mutations

New authenticated mutation kinds:

```text
service_event_cancelled
deposit_refunded
```

Service-event cancellation validation binds:

- service event, request, encounter, and service identities;
- original event type and quantity;
- requested and fulfilled quantities before and after cancellation;
- request status before and after cancellation;
- previous service-event identity;
- original occurrence and exact cancellation timestamps;
- source evidence digest.

Deposit refund validation binds:

- deposit and refund identities;
- exact amount, tender type, and method code;
- refund time and business date;
- deposit available/refunded balances before and after;
- deposit source evidence and refund source evidence.

Wrong identity, operation, kind, time, arithmetic, status, evidence, or lifecycle relationship fails closed before target mutation.

## Historical source projection

Service-event projection preserves event history after terminalization:

- the recorded event can still be projected from a cancelled source event;
- the cancellation event projects only from exact cancelled event/request authority;
- request before/after fulfillment and status are reconstructed from terminal facts;
- previous event ordering is preserved.

Deposit refund projection:

- reads the exact immutable refund fact;
- verifies it belongs to the referenced deposit;
- verifies deposit amount reconciliation;
- reconstructs cumulative prior refund authority;
- derives exact available/refunded balances before and after;
- binds deposit and refund source evidence independently.

## Guarded target apply

Service-event cancellation target apply atomically:

1. verifies the target request is at the exact fulfilled quantity, status, and last-event identity expected by the mutation;
2. verifies the target service event is still posted with exact identity, type, quantity, time, and source evidence;
3. updates the request's fulfilled quantity, status, and previous event identity;
4. marks the service event cancelled with the exact cancellation time;
5. advances the service-event entity version;
6. completes the target inbox receipt.

Deposit refund target apply atomically:

1. verifies the target deposit is posted, unreversed, reconciled, and at the exact before balances;
2. updates refunded and available balances;
3. inserts or exactly replays the immutable canonical refund fact;
4. verifies the after-state reconciliation and evidence;
5. advances the deposit entity version;
6. completes the target inbox receipt.

Any stale target state, missing predecessor, duplicate conflict, evidence mismatch, assertion failure, or version gap rolls back business rows, entity version, and inbox completion together.

## Disconnected two-node orchestration

### Service-event lifecycle

The rehearsal uses real source commands, migrations, converter, source outbox lifecycle, delivery adapter, target inbox, business apply, and source publication lifecycle.

Verified sequence:

```text
encounter started
service request created
service event recorded
service event cancelled
```

The target converges to:

```text
request fulfilled quantity: 0
request status: active
request last event: null
service event status: cancelled
service-event entity version: 2
```

Exact source command replay creates no duplicate outbox row. Exact target redelivery returns applied replay evidence and creates no duplicate inbox or business row.

### Deposit refund lifecycle

Verified sequence:

```text
payment receipt posted
deposit recorded
deposit refunded
```

The target converges to:

```text
receipt total/unallocated: 500 / 500
deposit amount/refunded/available: 500 / 100 / 400
refund fact count: 1
deposit entity version: 2
```

The refund outbox fact originates from `canonical_refund` but advances the `deposit` entity stream. Source command replay and target redelivery remain duplicate-free.

## Readiness truthfulness

All eight reviewed canonical entity families now have verified offline terminal semantics:

```text
terminal semantics verified: 8 of 8
terminal semantics gaps: 0
entity count: 8
runtime ready: 0
blocked: 8
runtime consumption connected: false
business apply connected: false
```

Each entity remains blocked only on:

```text
LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING
```

No entity is falsely marked runtime-ready. Network transport, runtime worker registration, production observation, feature activation, and legacy-write retirement remain separate authorization-gated scopes.

## Checkpoint commits

- `e79eef15a` — CDB-110K service-event/deposit terminal sync design;
- `173b2064a` — serial implementation plan;
- `2ef94dd3e` — replay-safe current service-event cancellation command;
- `a4daf0681` — converter, authenticated payload, and historical projector support;
- `0aff2948a` — guarded target service-event cancellation and deposit-refund apply;
- `714b76af3` — two-node orchestration, replay convergence, and readiness evidence;
- `89d1c0850` — tracker update and verification receipt.

These commits exist only on `program/cdb-main-continuous-20260725`. No CDB commit was merged or cherry-picked into local `main`.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| Focused source command/payload/projector/converter suites | passed |
| Target apply clinical/payment-deposit | 2 files, 15 tests passed |
| Two-node orchestration and readiness | 3 files, 10 tests passed |
| Full canonical suite | 170 files, 1,231 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Canonical local-sync readiness | 8 blocked, 0 ready; 0 terminal gaps |
| Legacy retirement readiness | 65 blocked, 0 eligible |
| Migration manifest | 474 migrations generated |
| Web production build | passed |
| Patient production build | passed; existing chunk-size warning only |
| Admin production build | passed; existing Vite deprecation warnings only |

Expected SQLite experimental warnings and reviewed fixture diagnostics did not fail any gate.

## Branch relationship

Before this receipt:

```text
main HEAD: b6afd871871eb9d595aba10eaa9b9f873169c0d8
CDB implementation HEAD: 714b76af392c46bbd904ba120ff98db81ddef65d
main...CDB: 0 / 75
```

The CDB branch contains the latest local `main`. The owner-facing dirty root checkout remained read-only and untouched.

## Continuation

The next safe scope is CDB-110L: design and verify the local canonical outbox consumption connection contract without registering a runtime worker, route, scheduler, network transport, or production activation.

Production observation, owner authorization, runtime registration, network transport, legacy-write retirement, and CDB-to-main integration remain separate scopes.

## Safety

No physical deletion, push, deployment, production access, protected rehearsal-clone access, production mutation, network request, route registration, worker/scheduler registration, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration occurred.
