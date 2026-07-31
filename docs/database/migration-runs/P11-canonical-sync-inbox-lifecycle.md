# P11 Canonical Sync Inbox Lifecycle Verification

**Checkpoint:** CDB-110C

**Verified:** 2026-07-25T06:15:44+06:00

**Branch:** `program/cdb-main-continuous-20260725`

**Worktree:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725`

**Reviewed local-main base:** `6a932aa97d415f52a498165e2c53a49b83dd470a`

**Verified implementation head before this receipt:** `6c91dbeceefb42c60d4ddccf218ae8b7d6c520f5`

## Result

CDB-110C added a durable, tenant-scoped, offline canonical sync inbox lifecycle without connecting an HTTP route, scheduled worker, local-server process, network transport, cloud endpoint, or canonical entity-specific apply handler.

Implemented offline authorities:

- durable exact receive and semantic replay;
- event/idempotency/dependency conflict detection;
- concurrent unique-race reread and replay;
- tenant-isolated inbox identities;
- exclusive expiring claim leases;
- due retry and expired-lease reclamation;
- bounded retry and dead-letter evidence;
- atomic canonical business statements plus entity-version and inbox-applied receipts;
- stale-claim, version-gap, semantic-mismatch, and business-failure rollback;
- version-zero to version-one progression;
- exact subsequent-version progression;
- tombstone receipt evidence without physical-delete semantics.

CDB-110 remains incomplete. The real readiness result remains:

```text
canonical sync entities: 8
ready: 0
blocked: 8
```

The protocol and inbox lifecycle are verified offline, but runtime canonical outbox conversion, transport consumption, and entity-specific cloud/local business apply remain disconnected.

## Persistence extension

Migration `0542_canonical_sync_inbox_lifecycle.sql` extends `canonical_sync_inbox_events` with:

- `occurred_at_utc`;
- `claim_public_id`;
- `claim_owner_public_id`;
- `claim_expires_at_utc`;
- `next_attempt_at_utc`.

It also adds:

- `idx_canonical_sync_inbox_claimable`;
- insert/update lifecycle consistency triggers;
- `canonical_sync_batch_assertions`.

The additive table and columns are represented in `src/db/schema/canonical/meta.ts`; `canonical_sync_batch_assertions` is registered in `docs/database/canonical-source-of-truth.yaml`.

The migration manifest increased from 471 to 472 migrations.

## Receive authority

`receiveCanonicalSyncEnvelope()`:

1. validates the CDB-110B envelope;
2. persists stable canonical payload JSON and exact occurrence evidence;
3. stores deterministic dependencies in the same batch;
4. returns replay only when event, idempotency, payload, operation, aggregate, occurrence, source node, and dependency evidence match;
5. raises a typed conflict when an event or idempotency identity is reused with different semantics;
6. rereads after a concurrent unique-constraint race and returns replay or conflict deterministically.

The same event public ID can exist in different tenants because all uniqueness and reads are tenant-scoped.

## Claim authority

`claimCanonicalSyncInboxEvent()` claims one exact tenant/event only when it is:

- pending;
- retry with `next_attempt_at_utc` due;
- applying with an expired lease.

The guarded mutation records a stable claim public ID, owner public ID, expiry, attempt count, and UTC evidence while clearing stale retry/error state.

Active leases, future retries, applied rows, conflict rows, dead-letter rows, wrong tenants, and missing events fail the row-count assertion and leave state unchanged.

## Retry and dead-letter authority

Retry and dead-letter transitions require:

- exact tenant;
- exact event public ID;
- exact current claim public ID;
- an unexpired lease;
- bounded uppercase error code;
- lowercase SHA-256 error hash.

Retry requires a future UTC `next_attempt_at_utc`. Dead-letter cannot retain retry timing. Neither API stores free-text errors, stack traces, payload content, credentials, or PHI.

## Atomic applied receipt

`completeCanonicalSyncInboxEvent()` requires at least one caller-provided authoritative canonical business statement. One atomic batch commits:

1. authoritative business statements;
2. exact entity-version creation or progression;
3. a row-count assertion proving one version authority changed;
4. exact applying-to-applied inbox transition under the active claim lease;
5. a row-count assertion proving one inbox row changed;
6. assertion cleanup.

Version one may insert a new version authority or advance an existing version-zero placeholder. Higher versions require the exact predecessor. A stale claim, expired lease, version gap, version race, semantic mismatch, or authoritative statement failure rolls back every business and protocol mutation.

`tombstone` is recorded as the last operation. It remains a protocol correction marker and is not treated as a physical-delete instruction.

## TDD and adversarial receipts

The implementation followed RED → GREEN cycles:

- missing migration produced the schema RED receipt;
- missing inbox module produced the lifecycle RED receipt;
- active leases, future retries, wrong claims, terminal states, and version gaps were implemented from failing tests;
- new failing tests proved expired claims could initially retry/dead-letter/complete and that version-zero authority could not advance;
- guarded lease predicates and exact version-one UPSERT fixed those failures;
- concurrent receive race, dependency evidence conflict, tenant isolation, and terminal-state claim rejection were added and verified;
- an implementation cleanup regression (`statement is not defined`) was caught by the focused suite and removed before checkpointing.

Final CDB-110C focused coverage includes:

- lifecycle schema: 1 file / 4 tests;
- inbox lifecycle logic: 1 file / 13 tests;
- combined protocol/inbox/local-sync regression: 8 files / 52 tests;
- continuation plus complete focused receipt suite: 9 files / 58 tests.

## Checkpoint commits

- `34f534268` — CDB-110C inbox lifecycle design and plan;
- `a14313980` — additive lifecycle schema, canonical schema metadata, source-of-truth registration, and schema tests;
- `6c91dbece` — offline receive/claim/retry/dead-letter/applied lifecycle and adversarial tests.

These commits exist only on `program/cdb-main-continuous-20260725`. They were not merged or cherry-picked into local `main`.

The verified tracker, registry evidence, continuation contract, and this report were committed as `9fca5b01d653bc96bec285c73fa5cf072762681e` before the final metadata receipt.

## Verification receipt

| Gate | Receipt |
| --- | --- |
| CDB-110C lifecycle schema | 1 file, 4 tests passed |
| CDB-110C inbox lifecycle | 1 file, 13 tests passed |
| Combined sync regression | 8 files, 52 tests passed |
| Continuation and focused receipt suite | 9 files, 58 tests passed |
| Full canonical suite | 148 files, 1,083 tests passed |
| Canonical governance | 0 issues |
| Legacy retirement readiness | 65 blocked, 0 eligible |
| Canonical local-sync readiness | 8 blocked, 0 ready |
| Protocol foundation | verified offline |
| Inbox lifecycle foundation | verified offline |
| Runtime canonical outbox consumption | disconnected |
| Entity-specific canonical business apply | disconnected |
| TypeScript | `pnpm exec tsc --noEmit` passed |
| Migration manifest | 472 migrations generated |
| Task worktree policy | passed with task-owned receipt changes |
| Web production build | passed |
| Patient production build | passed |
| Admin production build | passed |

Expected SQLite experimental warnings, the reviewed financial-shadow fixture warning, the reviewed settlement legacy fallback warning, patient chunk-size warning, and existing Vite deprecation warnings did not fail any gate.

## Branch relationship

Before this receipt:

```text
main HEAD: 6a932aa97d415f52a498165e2c53a49b83dd470a
CDB HEAD: 6c91dbeceefb42c60d4ddccf218ae8b7d6c520f5
main...CDB: 0 / 21
```

Local `main` did not advance during CDB-110C, so no `main → CDB` synchronization commit was required. No CDB commit flowed to `main`.

## Continuation

The next safe local slice is CDB-110D: convert allowlisted `canonical_outbox_events` evidence into validated CDB-110B envelopes offline, with exact event-type mapping, dependency extraction, replay/version semantics, and no route or transport activation.

CDB-110 remains incomplete until outbox conversion, entity-specific canonical apply handlers, symmetric cloud/local transport, disconnected rehearsal and recovery, and explicit owner activation authorization are complete.

## Safety

No push, deployment, production access, production mutation, network request, cloud pull, outbox flush, route registration, scheduled worker, local-server start, synchronization activation, feature-flag change, legacy-write retirement, or local-main integration occurred. The dirty owner-facing checkout remained read-only and untouched.
