# P11 Canonical Source Outbox Lifecycle Verification

**Checkpoint:** CDB-110F

**Verified:** 2026-07-25T18:27:00+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `b6afd871871eb9d595aba10eaa9b9f873169c0d8`

**Verified implementation head before this receipt:** `8e5a28667`

## Result

CDB-110F now provides an offline, fail-closed source lifecycle for allowlisted `canonical_outbox_events`:

- deterministic claim selection;
- authenticated conversion before source mutation;
- unique claim identity and expiring ownership lease;
- exact publication-envelope acknowledgement;
- receipt-owned retry and dead-letter transitions;
- crashed-worker expired-lease recovery;
- strict per-aggregate ordering;
- immutable source semantic authority;
- atomic transition assertions.

The implementation remains offline-only. It does not register a route, worker, scheduler, transport, network client, local-server process, feature activation, or production execution path.

The real readiness state remains:

```text
canonical sync entities: 8
ready: 0
blocked: 8
protocol foundation: verified_offline
inbox lifecycle: verified_offline
outbox conversion: verified_offline
business apply: verified_offline
source outbox lifecycle: verified_offline
runtime consumption connected: false
business apply connected: false
```

## Additive lifecycle schema

The CDB sync migrations were renumbered after the latest local `main` introduced `0538_doctor_commission_recovery_compatibility.sql`. The branch-only canonical sync migrations now use the next free ordered numbers:

- `0541_canonical_local_sync_protocol.sql`;
- `0542_canonical_sync_inbox_lifecycle.sql`;
- `0543_canonical_sync_outbox_lifecycle.sql`.

This left the main-owned doctor-commission recovery migration unchanged and restored unique governed migration numbers.

Migration `0543_canonical_sync_outbox_lifecycle.sql` adds:

- `claim_public_id`;
- `claim_expires_at_utc`;
- `last_error_sha256`;
- `published_envelope_sha256`;
- a source claimability index;
- lifecycle insert/update triggers;
- immutable semantic-authority trigger.

The schema requires complete claim evidence only for `processing`, complete publication evidence only for `published`, and stable error evidence for `retry` or `dead_letter`. Retry availability may equal the recovery timestamp so an expired lease can become immediately due without becoming earlier than its lifecycle update.

The immutable trigger blocks changes to tenant, event identity, aggregate identity, event type/version, payload, occurrence time, business date, idempotency key, and creation time after insertion.

## Deterministic candidate and ordering policy

`claimNextCanonicalSyncOutboxEnvelope()` selects the lowest source row ID that:

- belongs to the requested tenant;
- matches the exact converter allowlist;
- is pending, due retry, or expired processing;
- has attempts below the configured maximum;
- has no earlier unpublished event for the same aggregate.

A retrying, processing, cancelled, dead-lettered, or otherwise unpublished predecessor blocks later events of the same aggregate. An unrelated aggregate remains eligible, avoiding a global queue stall while preserving target aggregate versions.

Unsupported events are not selected. The chosen row is converted into the authenticated sync envelope before any source lifecycle mutation. Conversion or projection failure therefore leaves status, attempt count, claim evidence, and payload untouched.

The guarded claim batch increments attempts once, replaces expired lease evidence atomically, clears stale publication/error evidence, and requires exactly one changed row through `canonical_sync_batch_assertions`.

## Exact publication acknowledgement

`completeCanonicalSyncOutboxPublication()`:

1. validates the supplied envelope;
2. reconverts the immutable source event with the same source-node identity;
3. requires exact stable canonical equality;
4. requires the reconverted SHA-256 fingerprint to match the claim receipt;
5. requires exact claim ID, owner, expiry, attempt count, and an unexpired lease;
6. marks the source row published and clears claim/error evidence atomically.

Payload, entity, dependency, fingerprint, owner, attempt, expiry, and replay mismatches fail closed without publishing the source row.

This API acknowledges an already completed delivery. It does not send an envelope or invoke a target.

## Retry, dead-letter, and lease recovery

`failCanonicalSyncOutboxPublication()` requires the exact active receipt and unexpired ownership:

- attempts below maximum transition to future `retry`;
- attempts at maximum transition to `dead_letter`;
- both retain stable error code, optional bounded sanitized summary, and SHA-256 error evidence;
- both clear all active claim evidence.

`recoverExpiredCanonicalSyncOutboxLease()` does not trust the expired owner. It reloads the stored attempts and expiry, then:

- moves an expired below-maximum claim to immediately due `retry`;
- moves an expired final-attempt claim to `dead_letter`;
- rejects active leases and raced state changes.

This prevents a crashed worker from permanently stranding a source event in `processing`.

## Runtime isolation and readiness truthfulness

`test/canonical/canonical-sync-outbox-runtime-isolation.test.ts` recursively scans application source and proves no other source file imports or calls:

- `local-sync-outbox-lifecycle`;
- `claimNextCanonicalSyncOutboxEnvelope`;
- `completeCanonicalSyncOutboxPublication`;
- `failCanonicalSyncOutboxPublication`;
- `recoverExpiredCanonicalSyncOutboxLease`.

The registry records `sourceOutboxLifecycleStatus: verified_offline` and exact migration/module/test evidence. It intentionally keeps:

- every `localCanonicalOutboxConsumption` value false;
- `runtimeConsumptionConnected: false`;
- `businessApplyConnected: false`;
- `activationAuthorized: false`.

All eight entities remain blocked on runtime consumption. Encounter, service request, service event, deposit, compensation, and inventory also remain blocked on reviewed tombstone semantics.

## Checkpoint commits

- `328b1c78` — CDB-110F source lifecycle design;
- `c17953f1` — CDB-110F implementation plan;
- `1c1f1141` — additive source outbox lifecycle schema;
- `2a863c64` — deterministic offline source claims;
- `59c5ab50` — exact publication acknowledgement;
- `942fac0e` — retry, dead-letter, and expired-lease recovery;
- `8e5a2866` — conflict-free latest local `main` to CDB synchronization;
- `ec561d19` — migration renumbering, readiness evidence, runtime isolation, and verification receipt.

These commits exist only on `program/cdb-main-continuous-20260725`. No CDB commit was merged or cherry-picked into local `main`.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| Focused renumbered protocol/lifecycle/readiness suite | 8 files, 53 tests passed |
| Full canonical suite | 163 files, 1,176 tests passed |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Canonical governance | 0 issues |
| Canonical local-sync readiness | 8 blocked, 0 ready; source lifecycle verified offline |
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
CDB implementation HEAD: 8e5a28667
main...CDB: 0 / 43
```

The CDB branch contains the latest local `main`. The dirty owner-facing root checkout remained read-only and untouched.

## Continuation

The next safe local scope is CDB-110G: design and implement offline delivery transport plus claim/receive/apply orchestration without registering a runtime worker or activating synchronization.

CDB-110 remains incomplete until delivery transport, automatic orchestration, disconnected recovery rehearsal, remaining tombstone semantics, legacy-write retirement evidence, production observation, and explicit owner activation authorization are complete.

## Safety

No push, deployment, production access, production mutation, network request, envelope delivery, target receive orchestration, route registration, scheduled worker, local-server start, synchronization activation, feature-flag change, legacy-write retirement, or CDB-to-main integration occurred.
