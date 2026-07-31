# CDB-110B Canonical Sync Protocol Foundation Design

## Status

Approved offline implementation design. This checkpoint adds an additive persistence contract and pure protocol/planning code only. It does not connect a route, worker, network client, cloud endpoint, or local-server process.

## Goal

Create the canonical transport foundation required by CDB-110A:

- a versioned tenant-scoped sync envelope using stable public IDs;
- durable inbox, dependency, and applied-version evidence;
- deterministic replay, conflict, version-gap, dependency, and tombstone semantics;
- stable dependency-aware planning suitable for later local and cloud apply implementations.

## Protocol identity

Every envelope contains:

- `protocolVersion: 1`;
- `tenantId`;
- `eventPublicId`;
- `entityType`;
- `entityPublicId`;
- `eventType`;
- positive integer `aggregateVersion`;
- `operation: upsert | tombstone`;
- UTC `occurredAtUtc`;
- `sourceNodePublicId`;
- deterministic `idempotencyKey`;
- canonical JSON `payload` and lowercase SHA-256 `payloadSha256`;
- exact dependencies containing entity type, public ID, and minimum version.

Internal numeric database IDs are prohibited from protocol identity. Entity public IDs may be deterministic application IDs and therefore are not required to be ULIDs, but they must be bounded, non-empty, and tenant-scoped by the envelope.

## Stable canonical payload

Payload serialization reuses the existing canonical stable-JSON rules:

- plain objects and arrays only;
- recursively sorted object keys;
- finite numbers;
- no `undefined`, bigint, functions, symbols, sparse arrays, circular references, or class instances.

The payload digest is SHA-256 over stable canonical JSON. Key order must not change the digest.

## Durable persistence model

Add migration `0541_canonical_local_sync_protocol.sql` with three additive tables.

### `canonical_sync_inbox_events`

Stores one durable receipt per tenant/event and per tenant/idempotency key:

- public inbox ID;
- protocol and aggregate identity;
- operation and payload evidence;
- source node;
- lifecycle status: `pending`, `applying`, `applied`, `conflict`, `retry`, `dead_letter`;
- attempt count and UTC timestamps;
- bounded error code and error hash.

The table has unique `(tenant_id, event_public_id)` and `(tenant_id, idempotency_key)` constraints.

### `canonical_sync_inbox_dependencies`

Stores exact dependency evidence for each inbox event:

- dependent tenant and inbox event;
- dependency entity type/public ID;
- positive minimum version;
- exact primary key preventing duplicates;
- tenant-scoped foreign key to the inbox receipt.

### `canonical_sync_entity_versions`

Stores current applied protocol authority for each tenant/entity/public ID:

- non-negative applied version;
- last event public ID and operation;
- last payload SHA-256;
- update timestamp;
- exact tenant/entity/public-ID primary key.

The table is protocol evidence, not a replacement for canonical business tables.

## Planner inputs

The pure planner receives:

- an expected tenant ID;
- zero or more validated envelopes;
- current applied entity-version snapshots.

No database or network access occurs inside the planner.

## Planner results

The planner returns deterministic arrays:

- `ready` — envelopes that may be applied in stable dependency order;
- `replay` — already-applied identical events or duplicate identical event envelopes;
- `blocked` — envelopes waiting on version or dependency evidence.

Stable blocked reason codes:

- `VERSION_GAP`;
- `DEPENDENCY_MISSING`.

Conflicting evidence throws a typed fail-closed error:

- duplicate event public ID with different semantics;
- same entity/version with different event or payload;
- historical version that does not match current applied evidence;
- mixed tenant input;
- invalid self-dependency;
- dependency cycle.

## Version semantics

For each tenant/entity/public ID:

- next version is exactly current applied version + 1;
- a higher version is blocked as `VERSION_GAP`;
- a lower/equal version is replay only when the event, operation, and payload digest match current evidence;
- otherwise it is a conflict;
- multiple new versions for the same entity may be planned serially when every predecessor is present.

## Dependency semantics

A dependency is satisfied by either:

- current applied entity version at or above `minimumVersion`; or
- a ready predecessor envelope in the same plan that reaches the minimum version.

Planning uses deterministic topological iteration and event-public-ID tie-breaking. Missing dependencies remain blocked. Cycles fail closed instead of being silently blocked forever.

## Tombstone semantics

`tombstone` is a protocol correction operation, not a physical delete instruction. Apply implementations must later translate it into canonical domain-appropriate cancellation/reversal/retirement behavior. CDB-110B only validates and plans the operation.

## Idempotency

The idempotency key is deterministically derived from protocol version, tenant, event, aggregate identity/version, operation, payload digest, source node, and sorted dependency evidence. Reusing a key or event ID with different semantics is a conflict.

## Activation and routing boundary

CDB-110B must not:

- register or alter an HTTP route;
- consume `canonical_outbox_events` at runtime;
- start or configure the local server;
- perform cloud pull/push;
- apply an inbox event to a canonical business table;
- modify production or local tenant data;
- merge into local `main`.

Those belong to later CDB-110 slices and final explicit activation authorization.

## Verification

Required gates:

- migration schema/constraint tests;
- payload canonicalization and digest tests;
- envelope validation/idempotency tests;
- replay, conflict, version-gap, missing-dependency, chain-order, cycle, tombstone, and cross-tenant planner tests;
- CDB-110A readiness remains blocked because no runtime consumption/apply is claimed;
- full canonical suite, governance, TypeScript, migration manifest, worktree policy, and builds.

## Completion boundary

CDB-110B completes the offline protocol foundation only. CDB-110 remains incomplete until transport, inbox persistence/apply, recovery rehearsal, and activation gates are separately implemented and verified.
