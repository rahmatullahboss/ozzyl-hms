# P11 Canonical Service-Event and Deposit Terminal Projection Design

**Checkpoint:** CDB-110K

**Status:** design reviewed for offline implementation

## Scope

CDB-110K closes the two remaining entity-specific terminal synchronization gaps without enabling runtime synchronization:

- service-event cancellation;
- deposit refund projection.

Network transport, runtime worker registration, scheduler/route registration, production activation, legacy-write retirement, deployment, and production mutation remain out of scope.

## Service-event terminal semantics

A recorded service event remains the same canonical aggregate when terminalized.

Reviewed source event sequence:

```text
canonical.service_event.recorded   -> service_event version 1 / upsert
canonical.service_event.cancelled  -> service_event version 2 / upsert
```

Cancellation is a lifecycle transition, not a physical delete and not a destructive tombstone.

### Source command contract

A new replay-first `cancelServiceEvent()` command will:

- require an exact posted service-event identity;
- require the service event to be the request's current `last_event_public_id`;
- reject cancellation after request cancellation;
- preserve the original event type, quantity, encounter/service identities, occurrence time, participants, and evidence;
- set the event status to `cancelled` and record `cancelled_at_utc`;
- subtract fulfillment only for event types that originally incremented fulfillment;
- recompute request status from the resulting fulfilled quantity;
- restore `last_event_public_id` to the immediately preceding posted event or `NULL`;
- emit `canonical.service_event.cancelled` on the original service-event aggregate;
- return exact idempotent replay without creating duplicate rows or outbox events.

Limiting cancellation to the current last event avoids hidden reorder/cascade semantics and keeps the request/event transition guarded and serial.

### Historical projection

`canonical.service_event.recorded` must remain projectable after the source row is cancelled. Its original immutable fields remain authoritative; current terminal status must not rewrite the historical recorded event.

### Target apply

Target apply will atomically:

1. guard and reverse the request fulfillment/status/last-event transition;
2. guard and terminalize the service-event row;
3. complete inbox and entity-version receipts.

Any mismatch in prior request balance, prior request status, last event, event status, identity, quantity, time, or source evidence fails closed.

## Deposit refund terminal projection

Deposit refund is an append-only refund fact plus a lifecycle balance transition on the existing deposit entity.

The existing source command already emits:

```text
aggregate_type: canonical_refund
aggregate_public_id: <refundPublicId>
event_type: canonical.deposit.refunded
payload.depositPublicId: <depositPublicId>
```

That accounting event remains unchanged. The sync converter will map it to:

```text
entity_type: deposit
entity_public_id: payload.depositPublicId
operation: upsert
```

The refund aggregate identity is still validated through `payload.refundPublicId == aggregate_public_id`.

### Deposit lifecycle version scope

Deposit entity versions must include source outbox order across two aggregate types:

- `canonical_deposit / canonical.deposit.recorded`;
- `canonical_deposit / canonical.deposit.applied`;
- `canonical_refund / canonical.deposit.refunded`, selected by `payload.depositPublicId`.

This creates one monotonic entity-version stream for the deposit despite the refund fact using its own source aggregate.

Unsupported or malformed deposit/refund predecessors in the same entity scope fail conversion closed.

### Typed mutation

`deposit_refunded` will contain:

- deposit and refund public identities;
- amount, tender type, and method code;
- refund time and business date;
- deposit available balance before/after;
- deposit refunded balance before/after;
- source evidence digest.

The projector will derive refunded-before/refunded-after from the ordered canonical refund facts, rather than from current deposit state, so historical refund events remain projectable after later refunds.

### Target apply

Target apply will atomically:

1. guard and update deposit `refunded_minor` and `available_minor`;
2. insert the exact canonical deposit refund fact;
3. enforce the deposit balance invariant;
4. complete inbox and entity-version receipts.

No refund fact or deposit row is deleted.

## Readiness outcome

After verified implementation:

- terminal semantics verified: 8 of 8 entities;
- terminal sync gaps: 0;
- runtime-ready entities: 0 of 8;
- all entities remain blocked by disconnected local canonical outbox consumption/runtime transport.

## Verification strategy

Serial TDD will cover:

1. replay-safe service-event cancellation source command;
2. converter mapping and cross-aggregate deposit lifecycle versioning;
3. typed payload validation;
4. historical source projection after terminal state;
5. guarded target apply and stale-state rollback;
6. two-node service-event cancellation orchestration and replay;
7. deposit recorded/refunded target convergence and replay;
8. truthful readiness update;
9. full canonical suite, TypeScript, governance, retirement, migration manifest, and production builds.
