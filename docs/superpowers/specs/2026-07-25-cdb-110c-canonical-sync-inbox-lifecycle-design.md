# CDB-110C Canonical Sync Inbox Lifecycle Design

## Status

Approved offline implementation design. This checkpoint adds durable receive/claim/retry/dead-letter/applied receipt authority but does not register a route, consume the canonical outbox at runtime, or apply a canonical business entity.

## Goal

Provide the fail-closed persistence lifecycle required to safely receive and process CDB-110B canonical sync envelopes:

- durable idempotent receive;
- exclusive expiring claims;
- bounded retry scheduling;
- explicit dead-letter transition;
- atomic authoritative business statements plus applied entity-version and inbox receipt;
- race-safe stale-claim rejection.

## Persistence extension

Migration `0542_canonical_sync_inbox_lifecycle.sql` extends `canonical_sync_inbox_events` with:

- `claim_public_id`;
- `claim_owner_public_id`;
- `claim_expires_at_utc`;
- `next_attempt_at_utc`.

It adds a claimable-work index and `canonical_sync_batch_assertions`, a tenant/operation/step-scoped assertion table whose check constraint requires `assertion_value = 1`.

As in canonical financial batches, every guarded mutation is immediately followed by an assertion using SQLite `changes()`. A stale or zero-row mutation violates the assertion and rolls the whole atomic batch back.

## Receive authority

`receiveCanonicalSyncEnvelope()` validates the CDB-110B envelope and:

1. reads existing tenant-scoped event or idempotency evidence;
2. returns replay only when all stored semantics and dependency evidence match;
3. fails closed when event or idempotency identity is reused with different semantics;
4. inserts one pending inbox row and exact dependencies in one atomic batch;
5. handles a concurrent unique-claim race by rereading and replaying or raising a conflict.

The receive path stores stable canonical JSON, payload digest, idempotency key, aggregate version, operation, source node, and UTC timestamps. It does not apply a business entity.

## Claim authority

`claimCanonicalSyncInboxEvent()` claims one exact tenant/event using a caller-provided stable claim public ID and owner node ID.

Eligible rows are:

- `pending`;
- `retry` whose `next_attempt_at_utc` is due;
- `applying` whose claim lease expired.

The guarded update:

- sets `status = applying`;
- records claim/owner/expiry;
- clears retry timing and previous error evidence;
- increments attempt count;
- updates UTC evidence.

A non-expired claim, future retry, applied, conflict, or dead-letter row cannot be claimed.

## Retry and dead-letter authority

`scheduleCanonicalSyncRetry()` requires exact current claim ownership and changes one applying row to retry. It clears the claim, records future `next_attempt_at_utc`, bounded error code/hash, and update time.

`deadLetterCanonicalSyncInboxEvent()` also requires exact claim ownership and changes one applying row to dead-letter with bounded error evidence.

Wrong or stale claims fail the batch assertion and leave the row unchanged.

## Atomic applied receipt

`completeCanonicalSyncInboxEvent()` requires:

- the exact validated envelope;
- exact active claim identity;
- one or more caller-provided authoritative business statements;
- applied UTC time.

One atomic batch commits:

1. caller-provided canonical business statements;
2. guarded insert/update of `canonical_sync_entity_versions`, requiring the exact predecessor version;
3. assertion that exactly one version authority row changed;
4. guarded applying→applied inbox update with exact claim, entity, version, operation, and digest evidence;
5. assertion that exactly one inbox row changed;
6. assertion cleanup.

Version 1 may create the entity-version row. Higher versions require the exact preceding applied version. A duplicate, gap, stale claim, or semantic mismatch rolls back business statements and all sync evidence.

The function cannot be called without authoritative business statements, preventing protocol evidence from falsely claiming a business apply.

## Error evidence

Retry/dead-letter APIs accept bounded stable error codes and lowercase SHA-256 error hashes only. Free-text errors, stack traces, PHI, credentials, or payload content are not persisted.

## Runtime boundary

CDB-110C must not:

- add or alter an HTTP route;
- start a local server;
- read or mutate production;
- consume `canonical_outbox_events` automatically;
- select work globally without tenant/event scope;
- define entity-specific business apply handlers;
- activate cloud/local synchronization;
- merge CDB into `main`.

## Verification

Required tests cover:

- receive and identical replay;
- event/idempotency semantic conflict;
- concurrent receive race;
- pending, due retry, and expired-lease claims;
- rejection of active leases, future retry, terminal states, and wrong claims;
- retry and dead-letter evidence;
- atomic business statement + version + applied receipt;
- rollback on stale claim, version race, missing business statements, and business statement failure;
- multi-version progression;
- tombstone receipt;
- tenant isolation;
- schema constraints and indexes.

## Completion boundary

CDB-110C completes durable offline inbox lifecycle authority only. CDB-110 remains incomplete until outbox conversion, entity-specific canonical apply handlers, transport wiring, disconnected rehearsal/recovery, and explicit activation authorization are complete.
