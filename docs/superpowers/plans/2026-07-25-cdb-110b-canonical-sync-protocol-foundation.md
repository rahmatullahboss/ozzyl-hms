# CDB-110B Canonical Sync Protocol Foundation Implementation Plan

> **Execution:** Follow TDD in the continuous CDB worktree. Keep all implementation offline and unconnected.

**Goal:** Add an additive canonical sync inbox/version schema plus pure versioned envelope and dependency-planning logic.

**Architecture:** Reuse canonical stable JSON and SHA-256 request fingerprinting. Persist future receive/apply evidence in additive tenant-scoped tables. Implement a pure planner that never accesses a database or network and deterministically classifies ready, replay, blocked, and conflict inputs.

## Constraints

- Branch: `program/cdb-main-continuous-20260725`.
- Synchronize reviewed `main → CDB` before a new slice if main advances.
- No `CDB → main` integration during the active program.
- No route registration, Worker binding, fetch, cloud/local database execution, local-server start, deployment, production action, or feature-flag change.
- Migration is additive only.

## Task 1: Add the durable protocol schema

**Files:**
- Create: `migrations/0541_canonical_local_sync_protocol.sql`
- Create: `test/canonical/canonical-local-sync-protocol-schema.test.ts`

- [ ] Write RED tests expecting the migration and three tables.
- [ ] Assert tenant-scoped event and idempotency uniqueness.
- [ ] Assert inbox status, operation, protocol-version, aggregate-version, attempt-count, and digest constraints.
- [ ] Assert exact dependency primary key and tenant-scoped foreign key.
- [ ] Assert entity-version primary key, non-negative version, operation, and digest constraints.
- [ ] Assert pending/dependency indexes.
- [ ] Confirm RED because migration is missing.
- [ ] Implement the additive migration.
- [ ] Run schema tests GREEN and build the migration manifest; expected count becomes 471.
- [ ] Commit schema slice.

## Task 2: Implement canonical envelope creation and validation

**Files:**
- Create: `src/lib/canonical/local-sync-protocol.ts`
- Create: `test/canonical/canonical-local-sync-protocol.test.ts`

**Interfaces:**

```ts
export type CanonicalSyncOperation = 'upsert' | 'tombstone';

export interface CanonicalSyncDependency {
  entityType: string;
  entityPublicId: string;
  minimumVersion: number;
}

export interface CanonicalSyncEnvelope {
  protocolVersion: 1;
  tenantId: string;
  eventPublicId: string;
  entityType: string;
  entityPublicId: string;
  eventType: string;
  aggregateVersion: number;
  operation: CanonicalSyncOperation;
  occurredAtUtc: string;
  sourceNodePublicId: string;
  payload: Record<string, unknown>;
  payloadSha256: string;
  dependencies: CanonicalSyncDependency[];
  idempotencyKey: string;
}
```

- [ ] RED: same payload with different key order must produce the same digest and idempotency key.
- [ ] RED: tampered payload/hash, invalid UTC, zero version, duplicate dependency, self-dependency, invalid operation, and mixed semantic idempotency must fail.
- [ ] Implement payload hashing using existing `stableCanonicalJson`/`createRequestFingerprint`.
- [ ] Sort dependencies by entity type/public ID/minimum version.
- [ ] Derive idempotency from all semantic fields.
- [ ] Validate bounded non-empty identifiers and lowercase SHA-256 digests.
- [ ] Run focused envelope tests GREEN.

## Task 3: Implement deterministic replay/conflict/dependency planning

**Files:**
- Modify: `src/lib/canonical/local-sync-protocol.ts`
- Modify: `test/canonical/canonical-local-sync-protocol.test.ts`

**Interfaces:**

```ts
export interface CanonicalSyncEntityVersion {
  tenantId: string;
  entityType: string;
  entityPublicId: string;
  appliedVersion: number;
  lastEventPublicId: string | null;
  lastOperation: CanonicalSyncOperation | null;
  lastPayloadSha256: string | null;
}

export type CanonicalSyncBlockedReason = 'VERSION_GAP' | 'DEPENDENCY_MISSING';

export interface CanonicalSyncPlan {
  ready: CanonicalSyncEnvelope[];
  replay: CanonicalSyncEnvelope[];
  blocked: Array<{ envelope: CanonicalSyncEnvelope; reasons: CanonicalSyncBlockedReason[] }>;
}

export function planCanonicalSyncApply(input: {
  tenantId: string;
  envelopes: CanonicalSyncEnvelope[];
  currentVersions: CanonicalSyncEntityVersion[];
}): CanonicalSyncPlan;
```

- [ ] RED: reject cross-tenant envelope/version input.
- [ ] RED: identical duplicate event is replay; different duplicate event semantics conflict.
- [ ] RED: matching historical event/version is replay; mismatching historical evidence conflicts.
- [ ] RED: next version is ready; future gap is blocked.
- [ ] RED: missing dependency is blocked.
- [ ] RED: encounter → request → event → invoice → payment/deposit/compensation chain is stably ordered.
- [ ] RED: multiple versions of one entity plan serially.
- [ ] RED: same entity/version different events conflict.
- [ ] RED: dependency cycle fails closed.
- [ ] RED: tombstone is valid and planned without physical-delete semantics.
- [ ] Implement deterministic planning and stable event-public-ID tie-breaks.
- [ ] Run focused protocol suite GREEN.
- [ ] Commit protocol/planner slice.

## Task 4: Verify and record CDB-110B

**Files:**
- Modify: `docs/database/canonical-local-sync-entity-registry.yaml`
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`
- Create: `docs/database/migration-runs/P11-canonical-sync-protocol-foundation.md`

- [ ] Mark protocol foundation evidence without marking runtime consumption/apply ready.
- [ ] Keep all eight CDB-110A entities blocked.
- [ ] Record migration 471, exact tests, commits, branch/main relationship, and no activation.
- [ ] Run schema/protocol/sync regression tests.
- [ ] Run full canonical suite, governance, retirement checks, local-sync readiness, TypeScript, migration manifest, worktree policy, diff check, and production builds.
- [ ] Commit receipt on the CDB branch only.
- [ ] Confirm local `main` remains unchanged.

## Completion

CDB-110B completes only the offline protocol schema and pure planner. Runtime outbox consumption, durable inbox insertion/apply, canonical business-table handlers, recovery, and activation remain future CDB-110 work.
