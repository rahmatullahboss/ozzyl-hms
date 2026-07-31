# CDB-110A Canonical Local-Sync Readiness Implementation Plan

> **Execution:** Follow TDD in the continuous CDB worktree. Do not activate local sync, contact cloud endpoints, or merge CDB into `main`.

**Goal:** Make canonical public-ID synchronization readiness explicit and fail closed for eight core aggregates.

**Architecture:** A JSON-formatted YAML registry defines canonical table/public-ID identity, dependencies, and readiness dimensions. A local-only checker validates migrations, registry consistency, current legacy-sync blockers, and aggregate readiness. The current repository must truthfully report zero ready entities.

## Constraints

- Branch: `program/cdb-main-continuous-20260725`.
- Reviewed source: local `main`.
- Sync direction during the program: `main → CDB` only.
- No server activation, token use, fetch, database access, migration, runtime route behavior change, data transfer, deployment, or production action.

## Task 1: Define and test the entity registry

**Files:**
- Create: `docs/database/canonical-local-sync-entity-registry.yaml`
- Create: `test/canonical/canonical-local-sync-readiness.test.ts`

- [ ] Add eight core entity entries.
- [ ] Write a failing test importing `buildCanonicalLocalSyncReadiness` from the missing checker.
- [ ] Assert the real repository reports 8 blocked and 0 ready entities.
- [ ] Assert missing migration table/public-ID evidence fails closed.
- [ ] Assert duplicate entities and unknown dependencies fail closed.
- [ ] Assert a synthetic fully-supported entity becomes ready only when every readiness dimension is true and blocker is empty.
- [ ] Confirm module-not-found RED.

## Task 2: Implement local-only readiness checking

**Files:**
- Create: `scripts/canonical/check-canonical-local-sync-readiness.ts`
- Modify: `package.json`

**Interface:**

```ts
export type CanonicalSyncReadinessReason =
  | 'CANONICAL_OUTBOX_PRODUCTION_MISSING'
  | 'LOCAL_CANONICAL_OUTBOX_CONSUMPTION_MISSING'
  | 'CLOUD_CANONICAL_APPLY_MISSING'
  | 'LOCAL_CANONICAL_APPLY_MISSING'
  | 'VERSION_CONFLICT_POLICY_MISSING'
  | 'TOMBSTONE_SUPPORT_MISSING'
  | 'DEPENDENCY_ORDERING_MISSING';

export interface CanonicalLocalSyncReadiness {
  entityCount: number;
  readyEntityCount: number;
  blockedEntityCount: number;
  readyEntities: string[];
  blockedEntities: Array<{
    entityType: string;
    reasons: CanonicalSyncReadinessReason[];
  }>;
  auditedLegacyBlockers: {
    genericEntityIdTransportPresent: boolean;
    legacySnapshotSelectAllPresent: boolean;
    legacySnapshotReplaceApplyPresent: boolean;
    declaredCoreOutboxGapCount: number;
    declaredEntityMappingGapCount: number;
  };
}

export function buildCanonicalLocalSyncReadiness(root: string): CanonicalLocalSyncReadiness;
```

- [ ] Parse and validate the registry.
- [ ] Scan migration files for exact table and public-ID column evidence.
- [ ] Validate dependencies against registered entities or explicit external roots.
- [ ] Emit stable readiness reasons in fixed order.
- [ ] Audit existing legacy sync source patterns without executing them.
- [ ] Add package command `canonical:local-sync-readiness`.
- [ ] Run focused tests and real CLI report.

## Task 3: Verify and record CDB-110A

**Files:**
- Modify: `task-progress.yaml`
- Modify: `test/canonical/main-based-continuation-contract.test.ts`
- Create: `docs/database/migration-runs/P11-canonical-local-sync-readiness.md`

- [ ] Record 8 blocked and 0 ready entities.
- [ ] Record exact legacy blocker audit counts.
- [ ] Keep CDB-110 activation status blocked and unauthorized.
- [ ] Run focused tests, full canonical suite, governance, retirement checks, TypeScript, migration manifest, task policy, diff check, and frontend builds.
- [ ] Commit on the continuous CDB branch only.
- [ ] Confirm local `main` remains unchanged.

## Completion

CDB-110A is complete when the local readiness checker truthfully blocks activation and all verification gates pass. Implementation of canonical transport and apply belongs to later CDB-110 slices; activation remains separately authorized.
