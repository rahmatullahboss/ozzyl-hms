# CDB-110C Canonical Sync Inbox Lifecycle Implementation Plan

> **Execution:** Follow TDD in the continuous CDB worktree. Do not register routes, activate a server, access production, or merge to `main`.

**Goal:** Add durable receive, claim, retry/dead-letter, and atomic applied-version receipt authority for CDB-110B envelopes.

**Architecture:** Extend the additive sync schema with lease/retry columns and a canonical sync batch-assertion table. Reuse the repository's `changes()` assertion pattern so guarded zero-row mutations abort the atomic D1 batch. Implement a database adapter module that validates protocol envelopes but remains disconnected from runtime routing.

## Constraints

- Branch: `program/cdb-main-continuous-20260725`.
- Sync reviewed `main → CDB` if main advances before a new slice.
- No interim CDB→main integration.
- No HTTP route, scheduled worker, fetch, local-server process, cloud/local tenant access, entity-specific apply handler, deployment, or flag change.
- Error persistence is code/hash only; no free text or PHI.

## Task 1: Extend the inbox lifecycle schema

**Files:**
- Create: `migrations/0542_canonical_sync_inbox_lifecycle.sql`
- Modify: `src/db/schema/canonical/meta.ts`
- Modify: `docs/database/canonical-source-of-truth.yaml`
- Create: `test/canonical/canonical-sync-inbox-lifecycle-schema.test.ts`

- [ ] RED: expect claim, owner, expiry, and next-attempt columns.
- [ ] RED: expect claimable-work index and `canonical_sync_batch_assertions`.
- [ ] RED: invalid numeric claim IDs, non-UTC dates, incomplete claim triples, and assertion value zero fail constraints.
- [ ] Implement additive migration and matching Drizzle/source-of-truth entries.
- [ ] Run schema test and governance GREEN.
- [ ] Build migration manifest; expected count 472.
- [ ] Commit schema slice.

## Task 2: Implement durable receive and replay/conflict

**Files:**
- Create: `src/lib/canonical/local-sync-inbox.ts`
- Create: `test/canonical/canonical-sync-inbox.test.ts`

**Interfaces:**

```ts
export type CanonicalSyncReceiveResult =
  | { status: 'received'; eventPublicId: string }
  | { status: 'replayed'; eventPublicId: string };

export async function receiveCanonicalSyncEnvelope(
  db: CanonicalBatchDatabase,
  envelope: CanonicalSyncEnvelope,
  receivedAtUtc: string,
): Promise<CanonicalSyncReceiveResult>;
```

- [ ] RED: receive inserts one pending inbox row and exact dependencies.
- [ ] RED: identical receive replays.
- [ ] RED: event/idempotency identity with different semantics conflicts.
- [ ] RED: concurrent unique race rereads and replays/conflicts.
- [ ] RED: tenant scope is exact.
- [ ] Implement receive with stable payload JSON and guarded race handling.

## Task 3: Implement claim, retry, and dead-letter transitions

**Files:**
- Modify: `src/lib/canonical/local-sync-inbox.ts`
- Modify: `test/canonical/canonical-sync-inbox.test.ts`

**Interfaces:**

```ts
export interface CanonicalSyncClaimReceipt {
  tenantId: string;
  eventPublicId: string;
  claimPublicId: string;
  claimOwnerPublicId: string;
  claimExpiresAtUtc: string;
  attemptCount: number;
}

export async function claimCanonicalSyncInboxEvent(...): Promise<CanonicalSyncClaimReceipt>;
export async function scheduleCanonicalSyncRetry(...): Promise<void>;
export async function deadLetterCanonicalSyncInboxEvent(...): Promise<void>;
```

- [ ] RED: pending, due retry, and expired applying leases are claimable.
- [ ] RED: active lease, future retry, terminal states, and wrong tenant/event are rejected.
- [ ] RED: claim increments attempts and clears prior retry/error evidence.
- [ ] RED: retry requires exact claim and future next-attempt UTC.
- [ ] RED: dead-letter requires exact claim.
- [ ] Implement `changes()` assertions and cleanup.

## Task 4: Implement atomic applied receipt and version authority

**Files:**
- Modify: `src/lib/canonical/local-sync-inbox.ts`
- Modify: `test/canonical/canonical-sync-inbox.test.ts`

**Interface:**

```ts
export async function completeCanonicalSyncInboxEvent(
  db: CanonicalBatchDatabase,
  input: {
    envelope: CanonicalSyncEnvelope;
    claimPublicId: string;
    appliedAtUtc: string;
    authoritativeStatements: readonly CanonicalPreparedStatement[];
  },
): Promise<void>;
```

- [ ] RED: require at least one authoritative statement.
- [ ] RED: version 1 creates version evidence; version 2 advances exact predecessor.
- [ ] RED: stale claim, version gap/race, semantic mismatch, and authoritative statement failure roll back everything.
- [ ] RED: applying→applied clears claim/retry/error evidence and records applied UTC.
- [ ] RED: tombstone operation is recorded.
- [ ] Implement one atomic batch with version and inbox assertions.
- [ ] Commit inbox lifecycle implementation.

## Task 5: Verify and record CDB-110C

**Files:**
- Modify: `docs/database/canonical-local-sync-entity-registry.yaml`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`
- Create: `docs/database/migration-runs/P11-canonical-sync-inbox-lifecycle.md`

- [ ] Record protocol inbox lifecycle foundation without claiming runtime consumption or business apply readiness.
- [ ] Keep all eight entities blocked.
- [ ] Run focused schema/inbox/protocol/local-sync regressions.
- [ ] Run full canonical suite, governance, retirement/readiness checks, TypeScript, 472 migration manifest, task policy, diff check, and all builds.
- [ ] Commit receipt on CDB branch only and confirm `main` unchanged.

## Completion

CDB-110C completes durable offline inbox lifecycle authority. Outbox conversion, entity-specific apply handlers, transport/recovery rehearsal, and activation remain later CDB-110 work.
