# CDB-101 Two-Person Constrained Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed schema-v3 `two_person_constrained` production reporting cutover contract for exactly one technical operator and one non-technical monitoring owner without weakening the existing schema-v2 four-owner contract.

**Architecture:** Preserve schema v2 as a strict legacy branch and introduce schema v3 as an explicit discriminated contract mode. Centralize owner-model and risk-acceptance checks in `production-cutover-contract.ts`, then bind the same mode into protected document parsing, maintenance/recovery evidence, preflight, smoke/observation evidence, and mutation wrappers. Every production mutation remains separately command-ID gated; Worker traffic changes and canonical promotion remain prohibited.

**Tech Stack:** TypeScript 5.9, Zod 3, Vitest 4, tsx CLI scripts.

## Global Constraints

- Do not run production mutations, deployment, traffic assignment, migrations, import, feature-flag writes, restore, or database writes.
- Schema v2 must continue requiring four distinct acknowledged operational identities.
- Schema v3 must require exactly two distinct humans: one technical operator and one monitoring owner.
- The monitoring owner has no Cloudflare/database/rollback command responsibility.
- Schema v3 must reject Worker traffic change, canonical mode promotion, global scope, and tenants other than `100`.
- A later production deployment must invalidate stale candidate evidence.
- Each mutation stage remains separately approved through deterministic command IDs and current evidence.
- Safety-layer refusal must remain fail-closed.

---

### Task 1: Core schema-v3 authorization contract

**Files:**
- Modify: `scripts/canonical/production-cutover-contract.ts`
- Test: `test/canonical/production-cutover-contract.test.ts`

**Interfaces:**
- Produces: `ReportingCutoverAuthorization` union for schema versions 2 and 3.
- Produces: `ReportingTwoPersonRiskAcceptance` and `ownerModel: 'two_person_constrained'` for schema v3.
- Preserves: existing command-ID builders and schema-v2 validation behavior.

- [ ] **Step 1: Add failing schema-v3 tests**

Add a `readyTwoPersonAuthorization()` fixture derived from the existing fixture with:

```ts
schemaVersion: 3,
ownerModel: 'two_person_constrained',
rollbackOwner: {
  assigned: true,
  ownerId: 'rahmatullah-zisan',
  backupOwnerId: null,
  acknowledgedAtUtc: '2026-07-16T18:30:00.000Z',
  communicationChannelId: 'hms-cdb101-cutover-20260717',
  decisionAuthority: 'may_initiate_rollback',
},
observationOwner: {
  assigned: true,
  ownerId: 'staff-monitoring-owner',
  backupOwnerId: null,
  acknowledgedAtUtc: '2026-07-16T18:31:00.000Z',
  communicationChannelId: 'hms-cdb101-cutover-20260717',
  decisionAuthority: 'may_accept_or_reject_go',
},
twoPersonRiskAcceptance: {
  accepted: true,
  acceptedByOwnerId: 'rahmatullah-zisan',
  acceptedAtUtc: '2026-07-16T18:32:00.000Z',
  evidenceId: 'cdb101-two-person-risk-20260717-01',
  evidenceSha256: '7'.repeat(64),
  noTechnicalBackupAccepted: true,
  noMonitoringBackupAccepted: true,
  automaticAbortOnTechnicalOperatorUnavailable: true,
  automaticAbortOnMonitoringOwnerUnavailable: true,
  shadowOnlyAccepted: true,
  canonicalPromotionProhibited: true,
  workerTrafficChangeProhibited: true,
},
```

Assert that the valid fixture passes and that schema v3 rejects: duplicated primaries, any backup owner ID, missing risk evidence, mismatched accepting owner, canonical mode authorization, non-shadow flag mode, widened tenant scope, and a candidate equal to the live/previous Worker version.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm exec vitest run test/canonical/production-cutover-contract.test.ts
```

Expected: FAIL because schema v3 and `twoPersonRiskAcceptance` are not defined.

- [ ] **Step 3: Implement discriminated authorization types and validation**

Introduce:

```ts
export type ReportingOwnerModel = 'four_person_strict' | 'two_person_constrained';

export interface ReportingTwoPersonRiskAcceptance {
  accepted: boolean;
  acceptedByOwnerId: string | null;
  acceptedAtUtc: string | null;
  evidenceId: string | null;
  evidenceSha256: string | null;
  noTechnicalBackupAccepted: boolean;
  noMonitoringBackupAccepted: boolean;
  automaticAbortOnTechnicalOperatorUnavailable: boolean;
  automaticAbortOnMonitoringOwnerUnavailable: boolean;
  shadowOnlyAccepted: boolean;
  canonicalPromotionProhibited: boolean;
  workerTrafficChangeProhibited: boolean;
}
```

Model schema v2 and schema v3 as a union sharing the existing base fields. Schema v2 must keep the current four-distinct-owner check. Schema v3 must require two distinct primary IDs, null backup IDs, matching communication channel, exact authorities, valid acknowledgements, valid risk-acceptance hash/evidence/timestamp, `acceptedByOwnerId === rollbackOwner.ownerId`, all nine boolean safeguards true, `canonicalModeAuthorized === false`, shadow-only mode, tenant `100`, and distinct candidate/previous Worker IDs.

Add exact issue codes:

```ts
'CDB101_OWNER_MODEL_INVALID'
'CDB101_TWO_PERSON_RISK_ACCEPTANCE_INVALID'
'CDB101_TWO_PERSON_OWNER_CONTRACT_INVALID'
'CDB101_TWO_PERSON_BACKUP_PROHIBITED'
'CDB101_TWO_PERSON_SCOPE_PROHIBITED'
```

Include schema version, owner model, risk-evidence ID/hash, and the prohibition booleans in deterministic command-ID payloads so changing risk scope invalidates all command IDs.

- [ ] **Step 4: Run focused tests and verify pass**

Run the same Vitest command. Expected: PASS.

- [ ] **Step 5: Commit core contract changes**

```bash
git add scripts/canonical/production-cutover-contract.ts test/canonical/production-cutover-contract.test.ts
git commit -m "feat: add two-person constrained cutover contract"
```

### Task 2: Protected authorization document parsing

**Files:**
- Modify: `scripts/canonical/reporting-cutover-authorization-document.ts`
- Test: `test/canonical/reporting-cutover-authorization-document.test.ts`

**Interfaces:**
- Consumes: schema-v2/v3 union from Task 1.
- Produces: strict protected JSON parsing for both schemas without accepting unknown fields.

- [ ] **Step 1: Add failing parser tests**

Add tests proving that a complete schema-v3 document parses, schema-v2 documents continue to parse, schema-v3 without `ownerModel` or `twoPersonRiskAcceptance` fails, and schema-v2 with schema-v3-only fields fails as unknown fields.

- [ ] **Step 2: Run parser tests and verify failure**

```bash
pnpm exec vitest run test/canonical/reporting-cutover-authorization-document.test.ts
```

- [ ] **Step 3: Implement a Zod discriminated union**

Create shared field schemas, then:

```ts
const schemaV2 = sharedAuthorizationSchema.extend({
  schemaVersion: z.literal(2),
}).strict();

const schemaV3 = sharedAuthorizationSchema.extend({
  schemaVersion: z.literal(3),
  ownerModel: z.literal('two_person_constrained'),
  twoPersonRiskAcceptance: twoPersonRiskAcceptanceSchema,
}).strict();

const authorizationSchema = z.discriminatedUnion('schemaVersion', [schemaV2, schemaV3]);
```

Keep sensitive-key, duplicate-key, file-protection, size, and depth checks unchanged.

- [ ] **Step 4: Run parser tests and verify pass**

- [ ] **Step 5: Commit parser changes**

```bash
git add scripts/canonical/reporting-cutover-authorization-document.ts test/canonical/reporting-cutover-authorization-document.test.ts
git commit -m "feat: parse constrained cutover authorization"
```

### Task 3: Maintenance and recovery evidence owner model

**Files:**
- Modify: `scripts/canonical/reporting-maintenance-recovery-evidence.ts`
- Test: `test/canonical/reporting-maintenance-recovery-evidence.test.ts`

**Interfaces:**
- Consumes: authorization schema version and owner model.
- Produces: maintenance evidence that binds exactly the same two primary humans in schema v3.

- [ ] **Step 1: Add failing evidence tests**

Add a schema-v3 evidence fixture with one rollback primary, one observation primary, null backups, matching channel, both acknowledgements, and matching risk evidence. Assert rejection for missing primary, duplicate primary, non-null backup, mismatched communication channel, stale acknowledgement, and an evidence owner that does not match the authorization owner.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm exec vitest run test/canonical/reporting-maintenance-recovery-evidence.test.ts
```

- [ ] **Step 3: Implement schema-v3 evidence mode**

Add `ownerModel` and nullable backup acknowledgement handling to the evidence types/schema. Validate schema v2 exactly as before. For schema v3 require only the two primaries, prohibit backup IDs/acknowledgements, require a shared channel, and bind the evidence snapshot to the authorization owner IDs and risk evidence hash.

- [ ] **Step 4: Run focused tests and verify pass**

- [ ] **Step 5: Commit evidence changes**

```bash
git add scripts/canonical/reporting-maintenance-recovery-evidence.ts test/canonical/reporting-maintenance-recovery-evidence.test.ts
git commit -m "feat: bind two-person maintenance evidence"
```

### Task 4: Preflight and smoke/observation binding

**Files:**
- Modify: `scripts/canonical/reporting-cutover-preflight.ts`
- Modify: `scripts/canonical/reporting-smoke-observation-evidence.ts`
- Test: `test/canonical/reporting-cutover-preflight.test.ts`
- Test: `test/canonical/reporting-smoke-observation-evidence.test.ts`

**Interfaces:**
- Consumes: validated schema-v3 authorization and maintenance evidence.
- Produces: fail-closed preflight and observation receipts for the two-person model.

- [ ] **Step 1: Add failing tests**

Preflight must report ready owner evidence for two distinct primaries with no backups and must fail when either person is unavailable. Smoke evidence must require `primaryObserverId === authorization.observationOwner.ownerId`; for schema v3 the backup observer field must be null and any `NO_GO` decision must prevent progression.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm exec vitest run test/canonical/reporting-cutover-preflight.test.ts test/canonical/reporting-smoke-observation-evidence.test.ts
```

- [ ] **Step 3: Implement model-aware preflight and observation validation**

Branch by `authorization.schemaVersion`. Preserve schema-v2 backup requirements. For schema v3 set expected backup IDs to null, require both primary acknowledgements, require monitoring availability evidence, and add a blocker when observer decision is `NO_GO` or either owner is unavailable.

- [ ] **Step 4: Run focused tests and verify pass**

- [ ] **Step 5: Commit preflight/smoke changes**

```bash
git add scripts/canonical/reporting-cutover-preflight.ts scripts/canonical/reporting-smoke-observation-evidence.ts test/canonical/reporting-cutover-preflight.test.ts test/canonical/reporting-smoke-observation-evidence.test.ts
git commit -m "feat: enforce constrained cutover observation"
```

### Task 5: Mutation wrappers and stale candidate protection

**Files:**
- Modify: `scripts/canonical/apply-production-canonical-migrations.ts`
- Modify: `scripts/canonical/import-production-canonical-bundle.ts`
- Modify: `scripts/canonical/set-production-canonical-flag.ts`
- Modify: `scripts/canonical/reporting-worker-build-version-evidence.ts`
- Test: `test/canonical/production-cutover-contract.test.ts`
- Test: `test/canonical/reporting-worker-build-version-evidence.test.ts`

**Interfaces:**
- Consumes: current authorization command IDs and Worker build/version evidence.
- Produces: wrappers that refuse stale evidence, wrong stages, traffic changes, and canonical mode.

- [ ] **Step 1: Add failing wrapper tests**

Assert that schema-v3 wrappers accept the exact migration/import/shadow command IDs and reject any changed risk evidence, changed live Worker baseline, candidate that now appears in deployment traffic, canonical flag mode, tenant other than `100`, or missing exact stage approval.

- [ ] **Step 2: Run focused tests and verify failure**

```bash
pnpm exec vitest run test/canonical/production-cutover-contract.test.ts test/canonical/reporting-worker-build-version-evidence.test.ts
```

- [ ] **Step 3: Implement stage and freshness gates**

Bind wrapper preparation to the schema-v3 command IDs from Task 1. Extend Worker evidence with explicit `candidateTrafficPercentage` and `currentProductionWorkerVersionId`; require percentage `0`, current production version equal to `deployment.previousWorkerVersionId`, and candidate distinct from it. Keep canonical mode false and shadow tenant `100` checks at both authorization and wrapper boundaries.

- [ ] **Step 4: Run focused tests and verify pass**

- [ ] **Step 5: Commit wrapper changes**

```bash
git add scripts/canonical/apply-production-canonical-migrations.ts scripts/canonical/import-production-canonical-bundle.ts scripts/canonical/set-production-canonical-flag.ts scripts/canonical/reporting-worker-build-version-evidence.ts test/canonical/production-cutover-contract.test.ts test/canonical/reporting-worker-build-version-evidence.test.ts
git commit -m "feat: gate constrained cutover stages"
```

### Task 6: Templates, runbook, and full verification

**Files:**
- Modify matching protected example/template JSON under `docs/production-readiness/evidence-templates/` or the repository's existing CDB-101 template directory discovered by search.
- Modify the existing CDB-101 reporting runbook under `docs/production-readiness/`.
- Test: all canonical tests affected above.

**Interfaces:**
- Produces: operator-facing schema-v3 template and exact two-person monitoring/abort instructions.

- [ ] **Step 1: Locate and update the existing templates/runbook**

Document `schemaVersion: 3`, `ownerModel: "two_person_constrained"`, the exact risk-acceptance object, baseline monitoring versus official observation, automatic abort when either person is unavailable, fresh candidate requirement after any live deploy, and the prohibition on Worker traffic/canonical promotion.

- [ ] **Step 2: Run canonical regression tests**

```bash
pnpm exec vitest run test/canonical/production-cutover-contract.test.ts test/canonical/reporting-cutover-authorization-document.test.ts test/canonical/reporting-maintenance-recovery-evidence.test.ts test/canonical/reporting-cutover-preflight.test.ts test/canonical/reporting-smoke-observation-evidence.test.ts test/canonical/reporting-worker-build-version-evidence.test.ts
```

Expected: all pass.

- [ ] **Step 3: Run TypeScript verification**

```bash
pnpm exec tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 4: Review diff for production boundary**

Confirm there are no production credential changes, no migration SQL changes, no deployment config changes, and no commands that execute production writes.

- [ ] **Step 5: Commit documentation and final fixes**

```bash
git add docs scripts/canonical test/canonical
git commit -m "docs: add constrained cutover operations guidance"
```
