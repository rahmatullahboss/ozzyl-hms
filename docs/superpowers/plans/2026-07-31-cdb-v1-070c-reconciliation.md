# CDB-V1-070C Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed package, protected authorization contract, validator, and readiness checker for exact four-row migration-ledger reconciliation and exact archival FK disposition evidence without executing production reconciliation.

**Architecture:** Follow the existing CDB-V1-070B package/authorization patterns. A repository package fixes immutable files, target, tenant scope, migration hashes, archival groups, command templates, and prohibited permissions. A protected external authorization binds fresh aggregate evidence and deterministic confirmation tokens. The validator and readiness checker only evaluate documents and return non-executing plans.

**Tech Stack:** TypeScript, Node.js, Vitest, existing protected JSON loader, pnpm scripts.

## Global Constraints

- Exact production database: `hms-super-admin-production-apac`, UUID `c68a5360-a2c1-44cc-9e71-f21057bea102`.
- Exact tenant scope: `1`, `100`, `101`, `102`.
- Exact reconciliation migrations: `0549`, `0551`, `0552`, `0570` package filenames.
- Exact archival FK groups: 26 to `bills`, 15 to `visits`, raw 41, formally waived 41, effective unwaived 0.
- No migration SQL/DDL execution, business-table write, backfill, provider flag change, Worker/traffic/route change, Canonical promotion, sync activation, Legacy retirement, archival mutation/deletion, destructive action, push, or CDB-to-main integration.
- Every command template remains `executable:false`.
- Production execution is out of scope and requires future exact authorization.

---

### Task 1: Immutable reconciliation package

**Files:**
- Create: `scripts/canonical/all-tenant-reconciliation-package.ts`
- Test: `test/canonical/all-tenant-reconciliation-package.test.ts`

**Interfaces:**
- Produces: `buildAllTenantReconciliationPackage(root, binding)`, `evaluateAllTenantReconciliationPackage(root, document)`, `CDB_V1_070C_RECONCILIATION_MIGRATIONS`, `CDB_V1_070C_ARCHIVAL_FK_GROUPS`.
- Consumes: production target constants and `all-tenant-shadow-execution-package` tenant constants.

- [ ] **Step 1: Write failing package tests**

Test the exact checkpoint/status, four migration names and SHA-256 values, two archival groups, all command templates as non-executable, all permissions false, exact unresolved external binding list, and rejection of package/file/tenant/migration/FK drift.

- [ ] **Step 2: Run the package test and confirm failure**

Run:

```bash
pnpm exec vitest run test/canonical/all-tenant-reconciliation-package.test.ts
```

Expected: fail because the package module does not exist.

- [ ] **Step 3: Implement the package builder/evaluator**

Implement immutable file hashing, Git commit existence/ancestry checks, exact command contracts, package identity checks, external binding discovery, and operation flags fixed to false.

- [ ] **Step 4: Run the package test and confirm pass**

Run the same Vitest command. Expected: one test file passes with zero failures.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/canonical/all-tenant-reconciliation-package.ts test/canonical/all-tenant-reconciliation-package.test.ts
git commit -m "feat(canonical): add Gate C reconciliation package"
```

### Task 2: Protected authorization contract

**Files:**
- Create: `scripts/canonical/all-tenant-reconciliation-authorization.ts`
- Test: `test/canonical/all-tenant-reconciliation-authorization.test.ts`

**Interfaces:**
- Consumes: `AllTenantReconciliationPackage` and package evaluator.
- Produces: `buildAllTenantReconciliationRepositoryBinding`, `buildAllTenantReconciliationConfirmationTokens`, `parseAllTenantReconciliationAuthorizationJson`, `loadAllTenantReconciliationAuthorization`, `buildAllTenantReconciliationAuthorizationPlan`.

- [ ] **Step 1: Write failing exact-authorization tests**

Create one valid fixture and tests that reject generic approval, target/candidate/package drift, missing or extra migration entries, wrong migration hashes, schema/ledger evidence drift, ledger-present or post-schema-false entries, FK count/group drift, active/unknown FK violations, incomplete archival assertions, broad permissions, expired timing, invalid confirmation tokens, duplicate/unsafe/sensitive/unknown fields, in-repository files, weak modes, symlinks, and hard links.

- [ ] **Step 2: Run the authorization test and confirm failure**

```bash
pnpm exec vitest run test/canonical/all-tenant-reconciliation-authorization.test.ts
```

Expected: fail because the authorization module does not exist.

- [ ] **Step 3: Implement strict parsing and validation**

Use `parseStrictJsonDocument` and `loadProtectedJsonDocument`. Accept only approval source `user_explicit_cdb_v1_070c_schema_ledger_archival_fk_reconciliation_authorization`. Build tokens from exact database, candidate, migration/evidence bindings, FK disposition, and abort owner. Return an authorization object only when issue count is zero.

- [ ] **Step 4: Run the authorization test and confirm pass**

Run the same Vitest command. Expected: one test file passes with zero failures.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/canonical/all-tenant-reconciliation-authorization.ts test/canonical/all-tenant-reconciliation-authorization.test.ts
git commit -m "feat(canonical): validate exact Gate C authorization"
```

### Task 3: Validator and readiness CLIs

**Files:**
- Create: `scripts/canonical/validate-all-tenant-reconciliation-authorization.ts`
- Create: `scripts/canonical/check-all-tenant-reconciliation-readiness.ts`
- Test: `test/canonical/all-tenant-reconciliation-readiness.test.ts`

**Interfaces:**
- Validator input: `--authorization <protected-path>`.
- Readiness input: optional `--authorization <protected-path>`.
- Output: JSON receipt with package, authorization, plan, issue counts, and all operation flags false.

- [ ] **Step 1: Write failing CLI/readiness tests**

Verify no-authorization status, exact authorization status, unknown argument rejection, invalid package rejection, and no network/mutation/deployment flags.

- [ ] **Step 2: Run readiness tests and confirm failure**

```bash
pnpm exec vitest run test/canonical/all-tenant-reconciliation-readiness.test.ts
```

Expected: fail because CLI/readiness modules do not exist.

- [ ] **Step 3: Implement validator and readiness checker**

Load the committed package JSON, evaluate repository binding, optionally load protected authorization, build the non-executing plan, and set `executionReady` only when package and authorization are both exact. Do not invoke network commands.

- [ ] **Step 4: Run readiness tests and confirm pass**

Run the same Vitest command. Expected: one test file passes with zero failures.

- [ ] **Step 5: Commit Task 3**

```bash
git add scripts/canonical/validate-all-tenant-reconciliation-authorization.ts scripts/canonical/check-all-tenant-reconciliation-readiness.ts test/canonical/all-tenant-reconciliation-readiness.test.ts
git commit -m "feat(canonical): add Gate C readiness checks"
```

### Task 4: Package generation, repository artifact, and documentation

**Files:**
- Create: `scripts/canonical/prepare-all-tenant-reconciliation-package.ts`
- Create: `docs/database/cdb-v1-070c-reconciliation-package.json`
- Create: `docs/database/audits/2026-07-31-cdb-v1-070c-reconciliation-contract.md`
- Modify: `package.json`
- Test: `test/canonical/prepare-all-tenant-reconciliation-package.test.ts`

**Interfaces:**
- Produces deterministic package bytes ending in one newline.
- Adds scripts:
  - `canonical:all-tenant-reconciliation-package-prepare`
  - `canonical:all-tenant-reconciliation-authorization-validate`
  - `canonical:all-tenant-reconciliation-readiness`

- [ ] **Step 1: Write failing package-preparation test**

Verify deterministic bytes, package evaluation success, exact repository commit/build binding, no external evidence filled, all operation flags false, and no network/mutation.

- [ ] **Step 2: Run the preparation test and confirm failure**

```bash
pnpm exec vitest run test/canonical/prepare-all-tenant-reconciliation-package.test.ts
```

Expected: fail because the preparer and package artifact do not exist.

- [ ] **Step 3: Implement preparer, scripts, artifact, and audit contract**

Generate the package only from the current task commit after all implementation files exist. Document the exact future authorization boundary and state explicitly that production execution remains unauthorized.

- [ ] **Step 4: Run preparation and focused tests**

```bash
pnpm canonical:all-tenant-reconciliation-package-prepare
pnpm exec vitest run test/canonical/all-tenant-reconciliation-package.test.ts test/canonical/all-tenant-reconciliation-authorization.test.ts test/canonical/all-tenant-reconciliation-readiness.test.ts test/canonical/prepare-all-tenant-reconciliation-package.test.ts
```

Expected: all focused tests pass and the generated package is stable.

- [ ] **Step 5: Commit Task 4**

```bash
git add package.json scripts/canonical/prepare-all-tenant-reconciliation-package.ts docs/database/cdb-v1-070c-reconciliation-package.json docs/database/audits/2026-07-31-cdb-v1-070c-reconciliation-contract.md test/canonical/prepare-all-tenant-reconciliation-package.test.ts
git commit -m "docs(canonical): publish Gate C reconciliation contract"
```

### Task 5: Final verification and integration

**Files:**
- Review all Task 1-4 files.

**Interfaces:**
- Produces a clean, committed task branch ready for integration.

- [ ] **Step 1: Run focused tests**

```bash
pnpm exec vitest run test/canonical/all-tenant-reconciliation-package.test.ts test/canonical/all-tenant-reconciliation-authorization.test.ts test/canonical/all-tenant-reconciliation-readiness.test.ts test/canonical/prepare-all-tenant-reconciliation-package.test.ts
```

- [ ] **Step 2: Run TypeScript and package readiness**

```bash
pnpm exec tsc --noEmit
pnpm canonical:all-tenant-reconciliation-readiness
```

Expected readiness without authorization: `packageReady=true`, `authorizationReady=false`, `executionReady=false`, no network or mutation.

- [ ] **Step 3: Review diff and commit any final exact fixes**

Stage only task-owned files and commit with a focused message.

- [ ] **Step 4: Integrate through clean `main`**

Use the clean integration worktree, require latest `origin/main`, merge/cherry-pick the reviewed task commits, rerun focused tests and TypeScript, push `origin/main`, and confirm the remote contains the merge.

- [ ] **Step 5: Clean up**

Remove only the fully merged clean CDB-V1-070C worktree and local/remote task branch, prune worktrees, and preserve all protected evidence outside the repository.