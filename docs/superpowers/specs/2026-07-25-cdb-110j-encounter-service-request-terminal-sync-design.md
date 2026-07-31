# CDB-110J Encounter and Service-Request Terminal Sync Design

**Status:** approved by the continuous CDB execution mandate

**Date:** 2026-07-25

**Scope:** offline source commands and authenticated source-to-target lifecycle synchronization for encounter cancellation and service-request cancellation

## Context

CDB-110I classified encounter and service request terminal semantics as `lifecycle_state`, not destructive tombstones. Their schemas already support cancelled state, but the canonical sync contract currently carries only:

- encounter started/completed;
- service request created.

CDB-110J must add cancellation source authority, outbox conversion, business payload validation, source projection, target apply, ordering, replay, and disconnected orchestration evidence while keeping runtime synchronization disconnected.

## Goals

1. Add an idempotent canonical encounter-cancellation command.
2. Add an idempotent canonical service-request-cancellation command.
3. Emit deterministic canonical outbox events on the existing aggregate identities.
4. Convert both cancellation events to authenticated sync envelopes with operation `upsert`.
5. Project source authority into typed cancellation business mutations.
6. Apply exact guarded lifecycle transitions on the target.
7. Preserve replay safety and aggregate version ordering.
8. Prove service request cancellation before encounter cancellation when an active request depends on the encounter.
9. Mark encounter and service-request terminal semantics verified offline without connecting runtime consumption.

## Non-goals

- no physical deletion;
- no `tombstone` sync operation for either entity;
- no automatic cancellation cascade;
- no service-event cancellation/reversal implementation;
- no deposit refund projection;
- no network transport, route, worker, scheduler, timer, CLI, startup hook, or feature activation;
- no production access, mutation, deployment, push, legacy retirement, or CDB-to-main integration.

## Source command: service request cancellation

Add to `src/lib/canonical/commands/service-operations.ts`:

```ts
export interface CancelServiceRequestInput {
  tenantId: string;
  requestPublicId: string;
  cancelledAtUtc: string;
  idempotencyKey: string;
  outboxEventPublicId: string;
  businessDate: string;
}

export interface CancelServiceRequestResult {
  requestPublicId: string;
  status: 'cancelled';
  fulfilledQuantity: number;
}

export async function cancelServiceRequest(...)
```

Semantics:

- validate exact public IDs, normalized UTC time, business date, and idempotency inputs;
- read canonical command replay before mutation;
- load the request authority;
- allow cancellation only from `active` or `partially_fulfilled`;
- reject `fulfilled` or already `cancelled` unless it is an exact command replay;
- preserve `requested_quantity`, `fulfilled_quantity`, and `last_event_public_id`;
- set `status='cancelled'`, `cancelled_at_utc`, and `updated_at_utc` through a guarded update;
- emit `canonical.service_request.cancelled` on aggregate `canonical_service_request` and the original request public ID;
- payload contains only request public ID, status, and fulfilled quantity.

The cancellation command does not delete service events and does not reverse already fulfilled work.

## Source command: encounter cancellation

Add to `src/lib/canonical/commands/start-encounter.ts`:

```ts
export interface CancelEncounterInput {
  tenantId: string;
  encounterPublicId: string;
  cancelledAtUtc: string;
  idempotencyKey: string;
  eventPublicId: string;
  businessDate: string;
}

export interface CancelEncounterResult {
  encounterPublicId: string;
  status: 'cancelled';
}

export async function cancelEncounter(...)
```

Semantics:

- validate exact identity/time/idempotency inputs;
- read command replay before mutation;
- load encounter authority;
- allow cancellation only from `in_progress` with no end time;
- require cancellation time not earlier than start time;
- require no dependent service request in `active` or `partially_fulfilled` state;
- guarded update sets `status='cancelled'`, `ended_at_utc=cancelledAtUtc`, and `updated_at_utc`;
- close active encounter participants at the same time where supported by the source command batch;
- emit `canonical.encounter.cancelled` on aggregate `canonical_encounter` and the original encounter public ID;
- payload contains encounter public ID and status.

There is no automatic cascade. Callers must cancel active service requests first. This keeps dependency ordering explicit and fail-closed.

## Outbox conversion

Extend mappings:

```text
canonical_encounter:
  canonical.encounter.cancelled -> upsert

canonical_service_request:
  canonical.service_request.cancelled -> upsert
```

Aggregate versions remain derived from outbox row order. Typical versions:

```text
encounter started: 1
encounter cancelled: 2
service request created: 1
service request cancelled: 2
```

## Business mutations

Add mutation kinds:

```ts
encounter_cancelled
service_request_cancelled
```

### EncounterCancelledMutation

```ts
{
  kind: 'encounter_cancelled';
  entityPublicId: string;
  encounterType: EncounterStartedMutation['encounterType'];
  startedAtUtc: string;
  cancelledAtUtc: string;
  sourceEvidenceSha256: string;
}
```

### ServiceRequestCancelledMutation

```ts
{
  kind: 'service_request_cancelled';
  entityPublicId: string;
  encounterPublicId: string | null;
  servicePublicId: string;
  requestedQuantity: number;
  fulfilledQuantity: number;
  requestedAtUtc: string;
  cancelledAtUtc: string;
  sourceEvidenceSha256: string;
}
```

Both contracts require sync operation `upsert`.

## Source projection

### Encounter cancellation

Load current encounter authority and verify:

- event identity matches;
- event payload status is `cancelled`;
- source status is `cancelled`;
- `ended_at_utc` equals event occurrence time;
- cancellation time is not before start time;
- source evidence is valid.

Historical started-event projection must continue to work after the source encounter becomes cancelled.

### Service request cancellation

Load request authority including status, requested quantity, fulfilled quantity, request time, cancellation time, encounter/service identities, and source evidence. Verify:

- event identity and payload status;
- payload fulfilled quantity equals source authority;
- source status is `cancelled`;
- cancellation time equals event occurrence time;
- fulfilled quantity is non-negative and not greater than requested quantity.

Historical created-event projection must continue to work after cancellation.

## Target apply

### Encounter cancellation

Guarded update:

```text
status: in_progress -> cancelled
ended_at_utc: null -> cancelledAtUtc
```

Require exact encounter type, start time, and source evidence. Replay is handled by inbox/version authority; a stale or conflicting lifecycle transition fails the assertion batch.

### Service request cancellation

Guarded update:

```text
status: active|partially_fulfilled -> cancelled
cancelled_at_utc: null -> cancelledAtUtc
```

Require exact request quantity, fulfilled quantity, service identity, encounter identity, request time, last known source evidence, and no terminal prior state.

No service events or fulfilled quantities are deleted or decremented.

## Ordered disconnected scenario

Use separate source and target SQLite nodes:

1. encounter started and published;
2. service request created and published;
3. encounter cancellation attempt fails locally while request is active;
4. service request cancelled and published as aggregate version 2;
5. encounter cancelled and published as aggregate version 2;
6. target has both entities in cancelled state with exact times and versions;
7. replay of both source commands returns stored command receipts without duplicate outbox events;
8. redelivery of already-applied sync events returns replay evidence without duplicate target mutations.

## Failure cases

Tests must reject without partial mutation:

- encounter cancellation before start time;
- encounter cancellation with active or partially fulfilled request;
- encounter cancellation after completion/cancellation;
- request cancellation after fulfilment;
- request cancellation with malformed time or identity;
- cancellation envelope with wrong operation, event type, version, time, source evidence, quantity, dependency, or payload;
- target apply against missing predecessor/version or conflicting target row.

## Readiness update

After verification:

```text
encounter terminalSemanticsVerified: true
service_request terminalSemanticsVerified: true
```

Readiness remains:

```text
ready: 0
blocked: 8
runtime consumption connected: false
```

Only service event and deposit retain `TERMINAL_SEMANTICS_MISSING`.

## Files

Expected implementation surfaces:

- `src/lib/canonical/commands/start-encounter.ts`
- `src/lib/canonical/commands/service-operations.ts`
- `src/lib/canonical/local-sync-outbox-converter.ts`
- `src/lib/canonical/local-sync-business-payload.ts`
- `src/lib/canonical/local-sync-business-projector.ts`
- `src/lib/canonical/local-sync-business-apply.ts`
- focused command, converter, projector/apply, orchestration, readiness, and isolation tests
- registry, tracker, and verification report

## Safety invariant

CDB-110J must end with no runtime caller, route, network adapter, worker, scheduler, production mutation, deployment, push, feature activation, physical delete, legacy-write retirement, or CDB-to-main integration.
