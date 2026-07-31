# CDB-105A Legacy-Write Retirement Preparation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add fail-closed lifecycle evidence for every registered direct legacy write and generate a deterministic local retirement inventory without changing runtime behavior.

**Architecture:** Extend the existing canonical schema-governance registry contract instead of creating a second governance system. A small local-only report module consumes the same registry fields and emits deterministic aggregate evidence. All 65 current allowances are classified in place; no legacy write is removed during CDB-105A.

**Tech Stack:** TypeScript, Node.js filesystem APIs, Vitest, JSON-formatted YAML registry, existing canonical governance command.

## Global Constraints

- Work only on `program/cdb-main-continuous-20260725` in its dedicated linked worktree.
- Synchronize reviewed local `main` into CDB before a new implementation slice when CDB is behind.
- Do not merge CDB checkpoints into `main` until the complete CDB program receives final review and verification.
- Do not alter runtime behavior, production data, flags, traffic, deployments, or local-server activation.
- Preserve the dirty owner-facing checkout read-only.
- Use TDD and exact-file checkpoint commits.

---

### Task 1: Add lifecycle evidence validation

**Files:**
- Modify: `scripts/canonical/check-schema-governance.ts`
- Modify: `test/canonical/schema-governance.test.ts`

**Interfaces:**
- Consumes: `LegacyRegistry.directWriteAllowlist`
- Produces: validated `DirectWriteAllowance` fields `lifecycleStatus`, `retirementBlocker`, `retirementTask`, and `reviewedAtUtc`

- [ ] **Step 1: Write failing governance tests**

Add fixture cases that prove governance rejects:

```ts
{
  path: 'src/routes/orders.ts',
  table: 'legacy_orders',
  owner: 'billing-team',
  removalPhase: 'P05',
  reason: 'Compatibility write.',
}
```

and rejects invalid lifecycle values or non-UTC timestamps. Add a passing fixture containing:

```ts
{
  path: 'src/routes/orders.ts',
  table: 'legacy_orders',
  owner: 'billing-team',
  removalPhase: 'P05',
  reason: 'Compatibility write.',
  lifecycleStatus: 'canonical_compatibility',
  retirementBlocker: 'Production canonical read cutover and observation are incomplete.',
  retirementTask: 'CDB-105B',
  reviewedAtUtc: '2026-07-25T00:00:00Z',
}
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm exec vitest run test/canonical/schema-governance.test.ts
```

Expected: the missing-evidence fixture is incorrectly accepted before implementation.

- [ ] **Step 3: Extend the allowance contract**

Add:

```ts
type DirectWriteLifecycleStatus =
  | 'legacy_authority'
  | 'canonical_compatibility'
  | 'protected_fixture';

interface DirectWriteAllowance {
  path: string;
  table: string;
  owner: string;
  removalPhase: string;
  reason: string;
  lifecycleStatus: DirectWriteLifecycleStatus;
  retirementBlocker: string;
  retirementTask: string;
  reviewedAtUtc: string;
}
```

Validate exact lifecycle values, non-empty blocker/task, and an ISO-8601 UTC timestamp using the same timestamp shape already used for duplicate migration approvals.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run:

```bash
pnpm exec vitest run test/canonical/schema-governance.test.ts
```

Expected: all governance tests pass against fixtures; the real repository test remains RED until Task 2 enriches the registry.

- [ ] **Step 5: Commit the validation slice**

```bash
git add scripts/canonical/check-schema-governance.ts test/canonical/schema-governance.test.ts
git commit -m "test(canonical): require legacy write lifecycle evidence"
```

### Task 2: Classify all current allowances

**Files:**
- Modify: `docs/database/legacy-table-disposition.yaml`

**Interfaces:**
- Consumes: the Task 1 registry contract
- Produces: lifecycle evidence for all 65 current allowances

- [ ] **Step 1: Classify each exact allowance**

Use these deterministic rules:

```text
protected_fixture:
  src/lib/canonical/tenant-100-financial-smoke-fixture.ts

canonical_compatibility:
  src/lib/canonical/**
  plus non-canonical adapters whose reason explicitly states shadow/strict canonical orchestration

legacy_authority:
  every remaining active route/service/lib write
```

Set every `retirementTask` to `CDB-105B` and every `reviewedAtUtc` to the same review timestamp. Use a precise domain-specific `retirementBlocker`; do not use generic placeholders.

- [ ] **Step 2: Run governance and confirm all 65 entries validate**

Run:

```bash
pnpm canonical:check
```

Expected: zero governance issues.

- [ ] **Step 3: Run registry-focused tests**

Run:

```bash
pnpm exec vitest run test/canonical/schema-governance.test.ts
```

Expected: all tests pass, including the real repository registry.

- [ ] **Step 4: Commit the registry classification**

```bash
git add docs/database/legacy-table-disposition.yaml
git commit -m "docs(canonical): classify legacy write retirement blockers"
```

### Task 3: Add deterministic local retirement reporting

**Files:**
- Create: `scripts/canonical/legacy-write-retirement-report.ts`
- Create: `test/canonical/legacy-write-retirement-report.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export interface LegacyWriteRetirementReport {
  tableCount: number;
  allowanceCount: number;
  byTable: Record<string, number>;
  byOwner: Record<string, number>;
  byLifecycleStatus: Record<string, number>;
  byRemovalPhase: Record<string, number>;
  retirementTasks: Record<string, number>;
  paths: string[];
}

export function buildLegacyWriteRetirementReport(root: string): LegacyWriteRetirementReport;
```

- [ ] **Step 1: Write failing report tests**

Create a temporary valid registry fixture and assert exact sorted aggregate output. Add invalid fixture tests for duplicate path/table scopes and missing lifecycle evidence.

- [ ] **Step 2: Run report tests and confirm RED**

Run:

```bash
pnpm exec vitest run test/canonical/legacy-write-retirement-report.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement local-only deterministic reporting**

The module must read only `docs/database/legacy-table-disposition.yaml`, validate the lifecycle evidence needed for reporting, sort all object keys and paths, and print JSON only when invoked as a CLI. It must not access a database or network.

Add package command:

```json
"canonical:legacy-retirement-report": "tsx scripts/canonical/legacy-write-retirement-report.ts"
```

- [ ] **Step 4: Run report and tests**

Run:

```bash
pnpm exec vitest run test/canonical/legacy-write-retirement-report.test.ts
pnpm canonical:legacy-retirement-report
```

Expected: tests pass and the CLI reports five registered tables and 65 classified allowances.

- [ ] **Step 5: Commit the reporting slice**

```bash
git add scripts/canonical/legacy-write-retirement-report.ts test/canonical/legacy-write-retirement-report.test.ts package.json
git commit -m "feat(canonical): report legacy write retirement inventory"
```

### Task 4: Record continuous-branch and CDB-105A receipts

**Files:**
- Modify: `task-progress.yaml`
- Create: `docs/database/migration-runs/P11-legacy-write-retirement-preparation.md`

**Interfaces:**
- Produces: exact branch, main-sync, allowance counts, test receipts, blockers, and next action

- [ ] **Step 1: Update the tracker**

Record:

```yaml
program_branch: program/cdb-main-continuous-20260725
main_sync_direction: main_to_cdb_only_until_program_complete
cdb_to_main_integration: one_final_merge_after_complete_review_and_verification
current_checkpoint: CDB-105A-COMPLETE
next_exact_action: begin_domain_by_domain_CDB_105B_retirement_only_after_cutover_evidence_or_continue_next_authorized_local_preparation
```

Keep original P10/P11 status truthful. Do not mark legacy retirement complete.

- [ ] **Step 2: Write the verification report**

Include historical-branch ancestry proof, CDB-118 patch-equivalence proof, current main/CDB equality at start, all classification counts, exact commits, and production prohibition.

- [ ] **Step 3: Run final verification**

Run:

```bash
pnpm exec vitest run test/canonical/schema-governance.test.ts test/canonical/legacy-write-retirement-report.test.ts
pnpm canonical:check
pnpm canonical:legacy-retirement-report
pnpm exec tsc --noEmit
pnpm build:migrations
pnpm worktree:check -- --mode=task
```

Expected: all tests and checks pass; migration count remains 470; worktree is clean after the receipt commit.

- [ ] **Step 4: Commit the CDB-105A receipt**

```bash
git add task-progress.yaml docs/database/migration-runs/P11-legacy-write-retirement-preparation.md
git commit -m "docs(canonical): record CDB-105A retirement preparation"
```

- [ ] **Step 5: Do not integrate into main**

Confirm `program/cdb-main-continuous-20260725` contains the new commits and local `main` remains unchanged. Future main commits must be merged into CDB before the next implementation slice.
