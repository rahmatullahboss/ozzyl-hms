# CDB-110F Canonical Source Outbox Lifecycle Design

**Status:** approved by the continuous CDB execution mandate

**Date:** 2026-07-25

**Scope:** offline source-side claim, retry, dead-letter, and publication acknowledgement lifecycle for allowlisted `canonical_outbox_events`

## Context

CDB-110B through CDB-110E now provide:

- a public-ID canonical sync envelope;
- a durable target inbox lifecycle;
- deterministic source outbox-to-envelope conversion;
- authenticated entity-specific business projection;
- atomic target business apply and completion.

The source table already contains `status`, `available_at_utc`, `processing_attempts`, `locked_at_utc`, `locked_by`, `published_at_utc`, and error columns. It does not yet provide a unique claim identity, lease expiry, hashed error evidence, publication-envelope evidence, immutable semantic-field protection, or a verified claim/publication API.

The registry must continue to report all entities as runtime-blocked. This slice verifies lifecycle capability offline only; it does not connect a route, worker, scheduler, transport, or production activation path.

## Goals

1. Claim the next eligible allowlisted source event with a unique lease.
2. Preserve per-aggregate event order while allowing unrelated aggregates to continue.
3. Convert before claiming so unsupported or invalid events do not become stranded processing rows.
4. Reclaim only expired processing leases.
5. Record deterministic retry or dead-letter evidence.
6. Recover crashed expired leases without leaving maximum-attempt rows stranded.
7. Mark publication only when the acknowledged envelope exactly matches current immutable source authority.
8. Prevent lifecycle updates from mutating outbox semantic identity or payload.
9. Keep readiness blocked until an actual runtime consumer and transport are connected.

## Non-goals

- no HTTP or RPC transport;
- no background worker, cron, queue consumer, or scheduler;
- no automatic target inbox delivery;
- no runtime route registration;
- no feature-flag or activation change;
- no production access or mutation;
- no legacy-write retirement;
- no change to canonical business command production.

## Considered approaches

### 1. Reuse existing lock fields without migration

This is the smallest code change, but `locked_by` cannot safely represent both a worker and a unique claim, there is no lease expiry, and publication cannot be bound to an exact envelope digest. It is insufficient for fail-closed replay and ownership semantics.

### 2. Create a separate dispatch table

A new dispatch table could isolate delivery state, but it duplicates outbox lifecycle authority and introduces synchronization between two state machines before transport exists. It also makes recovery and operational inspection harder.

### 3. Additive lifecycle hardening on `canonical_outbox_events` — selected

Keep the existing outbox as the single source authority and add only the missing lease and evidence columns. This preserves current producers, avoids dual lifecycle state, and supports an offline API with exact ownership and publication checks.

## Schema design

Add migration `0543_canonical_sync_outbox_lifecycle.sql` with:

- `claim_public_id TEXT` — unique claim identity for the active processing lease;
- `claim_expires_at_utc TEXT` — lease expiry;
- `last_error_sha256 TEXT` — stable lowercase SHA-256 error evidence;
- `published_envelope_sha256 TEXT` — exact acknowledged canonical envelope fingerprint.

Existing columns retain these meanings:

- `locked_at_utc` — claim acquisition time;
- `locked_by` — claim owner public ID;
- `available_at_utc` — initial availability or retry schedule;
- `processing_attempts` — incremented once per successful claim;
- `published_at_utc` — publication acknowledgement time;
- `last_error_code` and `last_error_summary` — stable code and bounded sanitized summary.

Add lifecycle indexes and triggers that enforce:

- `processing` requires claim ID, owner, acquisition time, and future expiry;
- non-processing states cannot retain claim evidence;
- `published` requires both publication time and envelope fingerprint;
- `retry` and `dead_letter` require error code and error hash;
- pending/published/cancelled rows cannot retain stale error evidence;
- semantic columns cannot change after insert: tenant, event ID, aggregate identity, event type/version, payload, occurrence time, business date, idempotency key, and creation time.

## Candidate ordering

The offline claim API chooses the lowest source `id` that:

- belongs to the requested tenant;
- matches an allowlisted aggregate/event pair;
- is `pending`, due `retry`, or expired `processing`;
- is available at the claim time;
- has not exceeded the configured maximum attempts;
- has no earlier event for the same aggregate whose status is not `published`.

This gives strict per-aggregate ordering without globally blocking unrelated aggregates. A cancelled, dead-lettered, pending, retrying, or active-processing predecessor blocks later versions of that aggregate, preventing target version gaps.

## Conversion and claim flow

`claimNextCanonicalSyncOutboxEnvelope` performs:

1. validate tenant, node, claim, owner, time, and attempt inputs;
2. select one deterministic allowlisted candidate;
3. convert it to the authenticated CDB-110B/CDB-110E envelope before mutation;
4. calculate the stable envelope fingerprint;
5. atomically update the exact candidate to `processing`, increment attempts, set claim evidence, and clear stale publication/error evidence;
6. assert exactly one row changed;
7. return the claim receipt, envelope, and fingerprint.

If conversion fails, no lifecycle row changes. If another claimant wins, the guarded update fails closed and the caller may retry the operation.

## Publication acknowledgement

`completeCanonicalSyncOutboxPublication`:

1. validates the supplied envelope;
2. reconverts the claimed source row using the same source node identity;
3. requires exact canonical equality and matching fingerprint;
4. requires the active claim ID and an unexpired lease;
5. atomically changes the row to `published`, records publication time/fingerprint, clears claim and error evidence, and asserts one row changed.

This API acknowledges publication only. It does not send data anywhere.

## Failure lifecycle

`failCanonicalSyncOutboxPublication` accepts the claim receipt, a maximum-attempt policy, stable error code/hash, optional sanitized summary, and retry time.

- If `attemptCount < maxAttempts`, transition to `retry`, clear the lease, and set `available_at_utc` to the future retry time.
- If `attemptCount >= maxAttempts`, transition to `dead_letter`, clear the lease, and retain no future retry schedule.
- Both paths require the active unexpired claim and exact attempt count.

An expired owner cannot publish, retry, or dead-letter the event.

`recoverExpiredCanonicalSyncOutboxLease` handles worker loss without trusting the expired owner:

- when `processing_attempts < maxAttempts`, it clears the expired lease and moves the row to immediately due `retry` with stable lease-expiry evidence;
- when `processing_attempts >= maxAttempts`, it clears the expired lease and moves the row to `dead_letter`;
- it requires the stored lease to be expired at the recovery time and asserts exactly one row changed.

This prevents a crash on the final allowed attempt from leaving the aggregate permanently stuck in `processing`.

## Module boundaries

Create `src/lib/canonical/local-sync-outbox-lifecycle.ts` containing only offline lifecycle primitives. It may depend on:

- `command-batch.ts` for the portable database interface;
- `idempotency.ts` for stable fingerprints;
- `local-sync-outbox-converter.ts` for allowlisting and authenticated conversion;
- `local-sync-protocol.ts` for envelope validation.

No route, worker, scheduler, or application startup module may import it in CDB-110F.

## Error model

Use explicit errors:

- `CanonicalSyncOutboxStateError` for no candidate, lost claim, expired lease, wrong state, predecessor block, or attempt mismatch;
- `CanonicalSyncOutboxPublicationConflictError` for supplied-envelope or fingerprint mismatch;
- native `TypeError`/`RangeError` for invalid caller inputs.

Database assertions use the existing `canonical_sync_batch_assertions` transaction guard so failed state transitions roll back fully.

## Testing

Add focused tests for:

- migration lifecycle and semantic immutability triggers;
- deterministic allowlisted candidate selection;
- strict per-aggregate ordering with unrelated aggregate progress;
- pending claim, due retry claim, and expired lease reclaim;
- conversion failure leaving the source row untouched;
- concurrent/lost claim rejection;
- exact publication envelope acknowledgement;
- envelope tampering rejection;
- retry and max-attempt dead-letter transitions;
- expired-owner transition rejection;
- no runtime route/worker/scheduler imports;
- readiness metadata remaining blocked despite `sourceOutboxLifecycleStatus: verified_offline`.

## Readiness and governance

Extend the registry protocol foundation with:

- `sourceOutboxLifecycleStatus: verified_offline`;
- lifecycle migration/module/test evidence paths.

Do not change:

- `localCanonicalOutboxConsumption: false`;
- `runtimeConsumptionConnected: false`;
- `businessApplyConnected: false`;
- `activationAuthorized: false`.

After CDB-110F, the next safe scope is offline delivery-transport and orchestration design. Runtime activation remains a separate explicitly authorized terminal task.

## Safety invariant

CDB-110F must end with a clean local checkpoint and evidence that no push, deployment, production mutation, network delivery, route registration, worker startup, scheduler registration, synchronization activation, legacy retirement, or CDB-to-main integration occurred.
