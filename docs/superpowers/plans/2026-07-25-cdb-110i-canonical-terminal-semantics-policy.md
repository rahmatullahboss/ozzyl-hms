# CDB-110I Canonical Terminal Semantics Policy Implementation Plan

> **Execution mode:** single-agent serial TDD in the dedicated CDB worktree.

**Goal:** Replace the universal tombstone-readiness assumption with reviewed entity-specific terminal semantics policies while preserving 0 ready / 8 blocked and all runtime/activation flags false.

**Architecture:** Bump the registry to version 2, add terminal policy/evidence fields to every entity, validate policy contradictions and evidence paths, and change readiness reasons so only true tombstone entities require `tombstoneSupport`. Lifecycle-state and append-only-reversal entities use `TERMINAL_SEMANTICS_MISSING` when their reviewed sync coverage is incomplete.

## Constraints

- No source/target runtime connection.
- No network transport, route, worker, scheduler, CLI, or startup integration.
- No physical deletion or destructive reinterpretation of immutable history.
- No production access, mutation, deployment, push, or CDB-to-main integration.
- Keep all eight `localCanonicalOutboxConsumption` values false.
- Keep `runtimeConsumptionConnected`, `businessApplyConnected`, and `activationAuthorized` false.
- Do not mark the four incomplete terminal paths verified.

## Task 1 — RED fixture and policy reason tests

**Files**

- Modify `test/canonical/canonical-local-sync-readiness.test.ts`

Add registry-v2 fixture fields:

```ts
terminalSemanticsPolicy: 'tombstone' | 'lifecycle_state' | 'append_only_reversal'
terminalSemanticsVerified: boolean
terminalSemanticsEvidencePath: string
terminalSemanticsEvidencePattern: string
```

Add tests proving:

1. verified lifecycle-state entity with `tombstoneSupport: false` has no terminal blocker;
2. verified append-only reversal entity with `tombstoneSupport: false` has no terminal blocker;
3. incomplete lifecycle-state entity returns `TERMINAL_SEMANTICS_MISSING`;
4. true tombstone entity without support returns `TOMBSTONE_SUPPORT_MISSING`;
5. real registry has terminal gaps only for encounter, service request, service event, and deposit.

Run:

```bash
pnpm vitest run test/canonical/canonical-local-sync-readiness.test.ts
```

Expected RED because the checker still requires version 1 and universal tombstone support.

## Task 2 — Registry/checker schema v2

**Files**

- Modify `scripts/canonical/check-canonical-local-sync-readiness.ts`
- Modify `docs/database/canonical-local-sync-entity-registry.yaml`

Checker changes:

- add `TERMINAL_SEMANTICS_MISSING` reason;
- require registry version 2;
- define terminal policy union;
- require terminal semantics fields and evidence path/pattern;
- read each evidence file and require the exact pattern;
- validate contradictions:
  - append-only reversal cannot have tombstone support;
  - verified true-tombstone policy requires tombstone support;
- update `reasonsFor()`:
  - true tombstone without support → `TOMBSTONE_SUPPORT_MISSING`;
  - any unverified policy → `TERMINAL_SEMANTICS_MISSING`;
  - lifecycle/append-only verified policies do not require tombstone support.

Registry classifications:

```text
encounter: lifecycle_state / false
service_request: lifecycle_state / false
service_event: lifecycle_state / false
invoice: tombstone / true
payment_receipt: tombstone / true
deposit: lifecycle_state / false
compensation_accrual: lifecycle_state / true
inventory_movement: append_only_reversal / true
```

Evidence patterns:

- encounter schema cancelled status;
- service request cancelled timestamp/status;
- service event cancelled/reversed schema values;
- invoice cancelled sync contract;
- payment reversed sync contract;
- deposit refunded source event;
- compensation adjusted sync contract;
- inventory reversal link field.

Add protocol foundation metadata:

```text
terminalSemanticsPolicyStatus: reviewed_offline
terminalSemanticsDesign: design document path
terminalSemanticsTest: readiness test path
```

Run focused tests and TypeScript.

## Task 3 — Contradiction and evidence validation

**Files**

- Modify `test/canonical/canonical-local-sync-readiness.test.ts`

Add rejection tests for:

- unknown policy;
- missing evidence path/pattern;
- evidence pattern absent from referenced file;
- append-only reversal with tombstone support true;
- verified tombstone with tombstone support false.

Assert no entity becomes ready merely because terminal semantics are verified; local runtime consumption remains required.

Run:

```bash
pnpm vitest run test/canonical/canonical-local-sync-readiness.test.ts
pnpm exec tsc --noEmit
```

## Task 4 — Tracker and verification receipt

**Files**

- Modify `task-progress.yaml`
- Modify `test/canonical/main-based-continuation-contract.test.ts`
- Create `docs/database/migration-runs/P11-canonical-terminal-semantics-policy.md`

Tracker:

```text
current checkpoint: CDB-110I-TERMINAL-SEMANTICS-POLICY-REVIEWED
verified terminal policies: 4
missing terminal sync paths: 4
next action: CDB-110J encounter/service-request terminal contracts
```

Verification report must record:

- policy audit;
- four verified and four missing paths;
- no physical deletion;
- readiness remains 0/8;
- runtime/activation false;
- tests/builds/gates;
- branch relationship and safety non-actions.

## Final gates

```bash
pnpm vitest run test/canonical/canonical-local-sync-readiness.test.ts test/canonical/main-based-continuation-contract.test.ts
pnpm vitest run test/canonical
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm canonical:local-sync-readiness
pnpm canonical:legacy-retirement-readiness
pnpm build:migrations
pnpm --filter web build
pnpm build:patient
pnpm build:admin
```

Expected:

- full canonical suite passes;
- readiness: 0 ready / 8 blocked;
- terminal gaps only encounter, service request, service event, deposit;
- retirement: 0 eligible;
- 474 migrations;
- all builds pass.
