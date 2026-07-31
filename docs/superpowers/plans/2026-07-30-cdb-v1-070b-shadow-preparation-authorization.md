# CDB-V1-070B Shadow Preparation Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a non-executable Gate A package and strict protected authorization contract for collecting the production evidence required by the later all-tenant shadow execution authorization.

**Architecture:** Add a separate preparation-evidence authorization boundary instead of weakening CDB-V1-070A. The repository package remains sanitized with every permission false; a protected external document may authorize only aggregate production reads, zero-traffic Worker-version upload, Time Travel bookmark capture and protected export capture. Migration, backfill, provider activation and traffic assignment remain impossible in Gate A.

**Tech Stack:** TypeScript, Node.js `crypto`/`fs`/`child_process`, existing `protected-json-document` helpers, Vitest, pnpm.

## Global Constraints

- Work only in `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/cdb-main-continuous-20260725` on `program/cdb-main-continuous-20260725`.
- Preserve `.ai-bridge/execution-log.jsonl` and `.ai-bridge/session-log.jsonl`; never stage them.
- Legacy remains the user-visible read/write authority.
- Gate A may not assign Worker traffic, apply migrations, run backfills, change provider flags, promote Canonical reads/writes, activate local sync, retire Legacy, delete a remote database, push, or integrate CDB to main.
- Protected documents must be outside the repository in a mode-700 directory as a mode-600 regular file with no symlink or hard link.
- Use TDD for every new behavior and run each RED test before implementation.
- CDB-V1-070A package remains historical evidence and must not be modified.

---

### Task 1: Sanitized Gate A package contract

**Files:**
- Create: `scripts/canonical/all-tenant-shadow-preparation-package.ts`
- Test: `test/canonical/all-tenant-shadow-preparation-package.test.ts`

**Interfaces:**
- Consumes: `AllTenantShadowExecutionPackage` from `scripts/canonical/all-tenant-shadow-execution-package.ts`.
- Produces:
  - `CDB_V1_070B_CHECKPOINT`
  - `CDB_V1_070B_NEXT_CHECKPOINT`
  - `buildAllTenantShadowPreparationPackage(root, binding)`
  - `evaluateAllTenantShadowPreparationPackage(root, packageDocument)`
  - `AllTenantShadowPreparationPackage`

- [ ] **Step 1: Write the failing package tests**

Create tests that require:

```ts
const packageDocument = buildAllTenantShadowPreparationPackage(process.cwd(), {
  branch: 'program/cdb-main-continuous-20260725',
  preparationCommit: head,
  buildSha: head,
});

expect(packageDocument).toMatchObject({
  checkpoint: 'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY',
  status: 'prepared_not_authorized',
  target: {
    databaseName: 'hms-super-admin-production-apac',
    databaseUuid: 'c68a5360-a2c1-44cc-9e71-f21057bea102',
  },
  expectedScope: {
    tenantIds: ['1', '100', '101', '102'],
    migrationManifestCount: 504,
  },
  permissions: {
    productionReadAuthorized: false,
    workerVersionUploadAuthorized: false,
    trafficChangeAuthorized: false,
    productionMigrationAuthorized: false,
    providerFlagChangeAuthorized: false,
  },
});
```

Also assert six non-executing command phases, the exact Worker route set, the historical CDB-V1-070A package hash binding, unresolved external bindings, and rejection of hash/scope/permission drift.

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm exec vitest run test/canonical/all-tenant-shadow-preparation-package.test.ts`

Expected: FAIL because `all-tenant-shadow-preparation-package.ts` does not exist.

- [ ] **Step 3: Implement the minimal package contract**

The package must contain:

```ts
permissions: {
  productionReadAuthorized: false,
  workerVersionUploadAuthorized: false,
  trafficChangeAuthorized: false,
  timeTravelBookmarkCaptureAuthorized: false,
  backupExportCaptureAuthorized: false,
  productionMigrationAuthorized: false,
  productionBackfillAuthorized: false,
  providerFlagChangeAuthorized: false,
  canonicalPromotionAuthorized: false,
  localSyncActivationAuthorized: false,
  legacyRetirementAuthorized: false,
  destructiveActionAuthorized: false,
}
```

Every command entry must use `executable: false`. The evaluator must hash-check every bound repository file, require the exact production target and Worker routes, require 504 migrations, require all permissions false, and report `executionReady: false` unconditionally.

- [ ] **Step 4: Run package tests and verify GREEN**

Run: `pnpm exec vitest run test/canonical/all-tenant-shadow-preparation-package.test.ts`

Expected: all package tests pass.

- [ ] **Step 5: Commit the package slice**

Stage only the package module and its test. Commit message: `feat(canonical): define shadow preparation package`.

---

### Task 2: Protected Gate A authorization contract

**Files:**
- Create: `scripts/canonical/all-tenant-shadow-preparation-authorization.ts`
- Test: `test/canonical/all-tenant-shadow-preparation-authorization.test.ts`

**Interfaces:**
- Consumes: `AllTenantShadowPreparationPackage` and existing `protected-json-document` helpers.
- Produces:
  - `AllTenantShadowPreparationAuthorization`
  - `parseAllTenantShadowPreparationAuthorizationJson(text, root, packageDocument, atUtc)`
  - `loadAllTenantShadowPreparationAuthorization(path, root, packageDocument, atUtc)`
  - `buildAllTenantShadowPreparationRepositoryBinding(...)`
  - `buildAllTenantShadowPreparationConfirmationTokens(authorization)`
  - `buildAllTenantShadowPreparationPlan(result)`

- [ ] **Step 1: Write failing authorization tests**

The ready fixture must explicitly allow only:

```ts
permissions: {
  productionRead: true,
  workerVersionUpload: true,
  workerTrafficAssignment: false,
  timeTravelBookmarkCapture: true,
  backupExportCapture: true,
  productionSchemaMigration: false,
  productionBackfill: false,
  providerFlagChange: false,
  canonicalReadPromotion: false,
  canonicalWritePromotion: false,
  localSyncActivation: false,
  legacyRetirement: false,
  destructiveAction: false,
  remoteDatabaseDeletion: false,
  push: false,
  cdbToMainIntegration: false,
}
```

Tests must reject generic approval, final-execution approval used as a substitute, candidate traffic greater than zero, partial tenant scope, wrong target, stale package/hash binding, unsafe permissions, stale tokens, expired timing and weak/in-repository/linked protected files.

- [ ] **Step 2: Run authorization test and verify RED**

Run: `pnpm exec vitest run test/canonical/all-tenant-shadow-preparation-authorization.test.ts`

Expected: FAIL because the authorization module does not exist.

- [ ] **Step 3: Implement strict parsing and evaluation**

Use the existing strict JSON and protected-file helpers. Require approval source:

```ts
'user_explicit_all_tenant_shadow_preparation_evidence_authorization'
```

Require `candidateBranch: 'main'`, an existing 40-character candidate commit containing the minimum all-tenant implementation, exact Worker service/environment/entrypoint/compatibility date/routes, exact four-tenant read scope, zero candidate traffic, the previous Worker retained, and a protected evidence output ID/hash binding.

Generate four deterministic SHA-256 tokens:

```ts
{
  readToken,
  versionUploadToken,
  backupCaptureToken,
  abortToken,
}
```

The non-executing plan must report all network/production action fields as false because parsing only prepares a plan.

- [ ] **Step 4: Run authorization tests and verify GREEN**

Run: `pnpm exec vitest run test/canonical/all-tenant-shadow-preparation-authorization.test.ts`

Expected: all authorization tests pass.

- [ ] **Step 5: Commit the authorization slice**

Stage only the authorization module and its test. Commit message: `feat(canonical): validate shadow preparation authorization`.

---

### Task 3: Package writer, validator CLI and readiness checker

**Files:**
- Create: `scripts/canonical/prepare-all-tenant-shadow-preparation-package.ts`
- Create: `scripts/canonical/validate-all-tenant-shadow-preparation-authorization.ts`
- Create: `scripts/canonical/check-all-tenant-shadow-preparation-readiness.ts`
- Test: `test/canonical/prepare-all-tenant-shadow-preparation-package.test.ts`
- Test: `test/canonical/validate-all-tenant-shadow-preparation-authorization.test.ts`
- Test: `test/canonical/all-tenant-shadow-preparation-readiness.test.ts`
- Modify: `package.json`

**Interfaces:**
- Package writer atomically writes sanitized repository JSON and refuses silent overwrite.
- Validator accepts `--authorization <protected-path>` and optional `--at <UTC timestamp>`.
- Readiness checker accepts an optional protected authorization path and returns repository/package/authorization readiness without executing any command template.

- [ ] **Step 1: Write failing writer/CLI/readiness tests**

Require:

```ts
expect(readiness).toMatchObject({
  checkpoint: 'CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY',
  packageReady: true,
  authorizationPresent: false,
  authorizationReady: false,
  executionReady: false,
  issueCount: 0,
  networkRequestPerformed: false,
  productionReadPerformed: false,
  productionMutationPerformed: false,
  workerVersionUploadPerformed: false,
  trafficChanged: false,
});
```

The validator must exit non-zero for missing/invalid authorization and print only a sanitized receipt. The package writer must reject a changed existing package unless `--overwrite` is explicitly supplied.

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm exec vitest run test/canonical/prepare-all-tenant-shadow-preparation-package.test.ts test/canonical/validate-all-tenant-shadow-preparation-authorization.test.ts test/canonical/all-tenant-shadow-preparation-readiness.test.ts`

Expected: FAIL because the three modules do not exist.

- [ ] **Step 3: Implement minimal writer, CLI and readiness checker**

Add package scripts:

```json
"canonical:all-tenant-shadow-preparation-package-prepare": "tsx scripts/canonical/prepare-all-tenant-shadow-preparation-package.ts",
"canonical:all-tenant-shadow-preparation-authorization-validate": "tsx scripts/canonical/validate-all-tenant-shadow-preparation-authorization.ts",
"canonical:all-tenant-shadow-preparation-readiness": "tsx scripts/canonical/check-all-tenant-shadow-preparation-readiness.ts"
```

No command may invoke Wrangler, D1, deployment, export, network or production operations.

- [ ] **Step 4: Run tests and verify GREEN**

Run the same three-file Vitest command. Expected: all tests pass.

- [ ] **Step 5: Run combined verification**

Run:

- `pnpm exec vitest run test/canonical/all-tenant-shadow-preparation-package.test.ts test/canonical/all-tenant-shadow-preparation-authorization.test.ts test/canonical/prepare-all-tenant-shadow-preparation-package.test.ts test/canonical/validate-all-tenant-shadow-preparation-authorization.test.ts test/canonical/all-tenant-shadow-preparation-readiness.test.ts`
- `pnpm exec tsc --noEmit`

Expected: zero failures.

- [ ] **Step 6: Commit the tooling slice**

Stage exact tooling, tests and `package.json`. Commit message: `feat(canonical): add shadow preparation readiness tooling`.

---

### Task 4: Generate sanitized evidence and update program continuity

**Files:**
- Create: `docs/database/cdb-v1-070b-all-tenant-shadow-preparation-package.json`
- Create: `docs/database/audits/2026-07-30-all-tenant-shadow-preparation-authorization-contract.md`
- Modify: `.ai-bridge/current-plan.md`
- Modify: `docs/architecture/canonical-program-control-center.md`
- Modify: `task-progress.yaml`
- Modify: continuity tests only when new current-checkpoint assertions are required while historical markers remain intact.

**Interfaces:**
- Generated package must bind the exact committed implementation checkpoint.
- Current checkpoint becomes `CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-AUTHORIZATION-CONTRACT-READY`.
- Next gate becomes `CDB-V1-070B-ALL-TENANT-SHADOW-PREPARATION-EVIDENCE-EXACT-AUTHORIZATION-REQUIRED`.

- [ ] **Step 1: Commit-bound package generation**

Run the package preparation command from the exact implementation commit. Require:

```text
packageReady=true
authorizationPresent=false
authorizationReady=false
executionReady=false
issueCount=0
```

- [ ] **Step 2: Write audit and continuity metadata**

Document the circular-gate correction, package SHA-256, exact permission separation, tests and explicit non-actions. Preserve all historical CDB-V1-060 and CDB-V1-070A markers.

- [ ] **Step 3: Run full verification**

Run:

- focused Gate A tests;
- CDB-V1-070A tests;
- continuity tests;
- `pnpm exec tsc --noEmit`;
- `pnpm build:migrations`;
- `pnpm canonical:check` after adding the new readiness checker to the canonical chain;
- `pnpm worktree:check -- --mode=task --allow-dirty`;
- `git diff --check`.

Expected: zero failures; only intentional `.ai-bridge` logs remain dirty after commits.

- [ ] **Step 4: Commit package evidence and metadata**

Use separate commits for generated package/audit and final metadata bindings. Do not stage execution/session logs.
