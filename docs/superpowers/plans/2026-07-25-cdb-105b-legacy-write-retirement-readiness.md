# CDB-105B Legacy-Write Retirement Readiness Implementation Plan

> **Execution:** Follow TDD in the existing clean continuous CDB worktree. Do not retire any write or merge to `main`.

**Goal:** Add a deterministic fail-closed checker proving exactly which direct legacy writes, if any, are eligible for retirement under explicit per-domain evidence.

**Architecture:** A new non-sensitive gate document maps every registered legacy table to exactly one retirement domain. A local-only checker combines the gate document with the existing exact allowance registry and evaluates common plus lifecycle-specific gates. Current repository evidence must produce zero eligible allowances.

## Constraints

- Branch: `program/cdb-main-continuous-20260725`.
- Base/source: reviewed local `main`.
- Synchronize `main → CDB` before new slices if main advances.
- No interim `CDB → main` integration.
- No route behavior changes, migrations, production access, local-server activation, write removal, or compatibility-view activation.

## Task 1: Define the retirement-gate contract

**Files:**
- Create: `docs/database/legacy-write-retirement-gates.yaml`
- Create: `test/canonical/legacy-write-retirement-readiness.test.ts`

- [ ] Write a failing test importing `buildLegacyWriteRetirementReadiness` from the missing checker.
- [ ] Test four domains and exact table mapping.
- [ ] Test that the real blocked gate state returns 65 blocked and 0 eligible allowances.
- [ ] Test that all common gates plus the matching lifecycle-specific approval make one exact allowance eligible.
- [ ] Test that a table mapped to zero or multiple domains fails closed.
- [ ] Confirm module-not-found RED.

## Task 2: Implement deterministic readiness evaluation

**Files:**
- Create: `scripts/canonical/check-legacy-write-retirement-readiness.ts`
- Modify: `package.json`

**Interface:**

```ts
export type RetirementReasonCode =
  | 'PRODUCTION_CUTOVER_INCOMPLETE'
  | 'CANONICAL_READ_PROMOTION_INCOMPLETE'
  | 'OBSERVATION_INCOMPLETE'
  | 'ROLLBACK_EVIDENCE_NOT_FRESH'
  | 'OWNER_AUTHORIZATION_MISSING'
  | 'LEGACY_AUTHORITY_RETIREMENT_NOT_APPROVED'
  | 'COMPATIBILITY_ADAPTER_RETIREMENT_NOT_APPROVED'
  | 'FIXTURE_RETIREMENT_NOT_APPROVED';

export interface LegacyWriteRetirementReadiness {
  allowanceCount: number;
  eligibleAllowanceCount: number;
  blockedAllowanceCount: number;
  byDomain: Record<string, { total: number; eligible: number; blocked: number }>;
  byLifecycleStatus: Record<string, number>;
  eligibleScopes: string[];
  blockedScopes: Array<{ scope: string; domain: string; reasons: RetirementReasonCode[] }>;
}

export function buildLegacyWriteRetirementReadiness(root: string): LegacyWriteRetirementReadiness;
```

- [ ] Validate both JSON-formatted YAML documents.
- [ ] Validate exact table/domain coverage and duplicate scope.
- [ ] Evaluate common gates in stable reason-code order.
- [ ] Evaluate one lifecycle-specific gate per allowance.
- [ ] Sort domains, scopes, and reason arrays deterministically.
- [ ] Add package command `canonical:legacy-retirement-readiness`.
- [ ] Run focused tests and real CLI report.

## Task 3: Verify and record the blocked readiness state

**Files:**
- Modify: `task-progress.yaml`
- Create: `docs/database/migration-runs/P11-legacy-write-retirement-readiness.md`

- [ ] Record all four domains and 65 blocked/0 eligible allowances.
- [ ] Record that CDB-105B readiness preparation is complete but actual retirement remains blocked.
- [ ] Run focused tests, full canonical suite, governance, retirement inventory, readiness checker, TypeScript, migration build, worktree policy, diff check, and frontend builds.
- [ ] Commit exact files on the continuous CDB branch.
- [ ] Confirm local `main` remains unchanged and CDB remains ahead.

## Completion

CDB-105B local readiness preparation is complete only when the current real-repository result is deterministically `eligibleAllowanceCount: 0`, all gates pass, and no runtime or production mutation has occurred.
