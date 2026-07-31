# CDB-V1-060 Production Authorization Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare and govern a deterministic repository-side production authorization package for future CDB-V1-070 execution while keeping every production, deployment, traffic and retirement permission false.

**Architecture:** A focused package-contract module builds and validates exact repository-side bindings. A local-only preparation CLI writes the sanitized JSON package, and a readiness checker binds it into `canonical:check`. External owner/production bindings remain unresolved and force `executionReady=false`.

**Tech Stack:** TypeScript, Node.js standard library, Vitest, pnpm, Git metadata, existing Canonical governance scripts.

## Global Constraints

- Continue only in branch `program/cdb-main-continuous-20260725` and its dedicated worktree.
- Preserve `.ai-bridge/execution-log.jsonl` and `.ai-bridge/session-log.jsonl` without staging or committing them.
- Do not query or mutate production or any remote database.
- Do not execute Wrangler, D1, deployment, traffic, provider activation, local-sync or retirement commands.
- Bind exactly 19 migrations and four backfill scripts from the successful CDB-V1-050 rehearsal.
- First cutover permits read shadow preparation only; canonical writes and legacy retirement remain prohibited.
- Use TDD and exact-file staging for each coherent checkpoint.

---

### Task 1: Package contract and deterministic builder

**Files:**
- Create: `scripts/canonical/production-authorization-package.ts`
- Test: `test/canonical/production-authorization-package.test.ts`

**Interfaces:**
- Consumes: `evaluateProtectedCloneRehearsalResult(value: unknown): string[]` and repository files.
- Produces:
  - `buildProductionAuthorizationPackage(root: string, binding: { branch: string; candidateCommit: string; buildSha: string }): ProductionAuthorizationPackage`
  - `evaluateProductionAuthorizationPackage(root: string, value: unknown): ProductionAuthorizationPackageEvaluation`
  - exact exported migration/backfill/provider/consumer/source-table constants.

- [ ] **Step 1: Write failing contract tests**

Test exact counts, hashes, command phases, safety flags, unresolved external bindings and deterministic output. Add mutation cases for stale hashes, broad scope, unsafe command syntax and prohibited permissions.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm vitest run test/canonical/production-authorization-package.test.ts`

Expected: FAIL because the contract module does not exist.

- [ ] **Step 3: Implement the minimal deterministic contract**

The implementation must:

```ts
export interface ProductionAuthorizationPackageEvaluation {
  packageReady: boolean;
  executionReady: false;
  issues: string[];
  unresolvedExternalBindings: string[];
  productionReadPerformed: false;
  productionMutationPerformed: false;
  networkRequestPerformed: false;
}
```

It must hash exact repository files, use exact arrays, reject unsafe command tokens (`&&`, `||`, `;`, `|`, redirects, command substitution), and require all executable permissions false.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run test/canonical/production-authorization-package.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Run TypeScript**

Run: `pnpm exec tsc --noEmit`

Expected: exit 0.

- [ ] **Step 6: Commit contract implementation**

Stage only the two task files and commit:

```bash
git commit -m "feat(canonical): add production authorization package contract"
```

---

### Task 2: Local-only package preparation CLI

**Files:**
- Create: `scripts/canonical/prepare-production-authorization-package.ts`
- Modify: `package.json`
- Test: `test/canonical/prepare-production-authorization-package.test.ts`

**Interfaces:**
- Consumes: `buildProductionAuthorizationPackage` and local Git branch/HEAD.
- Produces: `docs/database/cdb-v1-060-production-authorization-package.json` after the implementation commit exists.

- [ ] **Step 1: Write failing CLI tests**

Cover argument parsing, exact output path, refusal to overwrite without `--force`, wrong branch rejection, output validation before write, and no child-process command except local Git metadata resolution.

- [ ] **Step 2: Run the focused CLI test and verify RED**

Run: `pnpm vitest run test/canonical/prepare-production-authorization-package.test.ts`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Implement the CLI**

Required package command:

```json
"canonical:production-authorization-package-prepare": "tsx scripts/canonical/prepare-production-authorization-package.ts"
```

The CLI must write JSON only after `packageReady=true` and `executionReady=false` are both proven.

- [ ] **Step 4: Run CLI and contract tests**

Run: `pnpm vitest run test/canonical/production-authorization-package.test.ts test/canonical/prepare-production-authorization-package.test.ts`

Expected: all tests pass.

- [ ] **Step 5: Run TypeScript and commit**

Run: `pnpm exec tsc --noEmit`

Commit:

```bash
git commit -m "feat(canonical): prepare production authorization package"
```

---

### Task 3: Generate and govern the sanitized package

**Files:**
- Create: `docs/database/cdb-v1-060-production-authorization-package.json`
- Create: `scripts/canonical/check-production-authorization-package-readiness.ts`
- Modify: `package.json`
- Test: `test/canonical/production-authorization-package-readiness.test.ts`

**Interfaces:**
- Consumes: committed Task 1/2 implementation HEAD and repository package.
- Produces: aggregate checker output with `packageReady=true`, `executionReady=false`, exact counts and unresolved external bindings.

- [ ] **Step 1: Commit Task 1/2 implementation and record exact candidate commit**

Run: `git rev-parse HEAD`

Use that exact full SHA as `candidateCommit` and `buildSha` in the generated package.

- [ ] **Step 2: Generate the package locally**

Run:

```bash
pnpm canonical:production-authorization-package-prepare -- --output docs/database/cdb-v1-060-production-authorization-package.json
```

Expected aggregate: package ready, execution not ready, no network/production action.

- [ ] **Step 3: Write failing readiness tests**

Test the committed package, exact candidate commit, 19 migrations, four backfills, nine providers, 12 consumers, nine source tables, all permissions false and all external bindings unresolved.

- [ ] **Step 4: Implement readiness checker and package script**

Required package command:

```json
"canonical:production-authorization-package-readiness": "tsx scripts/canonical/check-production-authorization-package-readiness.ts"
```

Append it to `canonical:check` after the CDB-V1-050 result checker.

- [ ] **Step 5: Run readiness and governance tests**

Run:

```bash
pnpm vitest run test/canonical/production-authorization-package.test.ts test/canonical/prepare-production-authorization-package.test.ts test/canonical/production-authorization-package-readiness.test.ts
pnpm canonical:production-authorization-package-readiness
```

Expected: package ready, execution false, issue count 0 for repository-side content.

- [ ] **Step 6: Commit package/checker slice**

Commit:

```bash
git commit -m "docs(canonical): prepare production authorization package"
```

---

### Task 4: Audit, continuity and executable governance

**Files:**
- Create: `docs/database/audits/2026-07-30-production-authorization-package-preparation.md`
- Modify: `.ai-bridge/current-plan.md`
- Modify: `docs/architecture/canonical-main-continuation-prompt.md`
- Modify: `docs/architecture/canonical-program-control-center.md`
- Modify: `docs/architecture/hms-canonical-parallel-execution-board.yaml`
- Modify: `docs/database/canonical-core-v1-production-cutover-runbook.md`
- Modify: `task-progress.yaml`
- Modify continuity tests under `test/canonical/`.

**Interfaces:**
- Consumes: CDB-V1-060 package and checker results.
- Produces: checkpoint `CDB-V1-060-PRODUCTION-AUTHORIZATION-PACKAGE-READY`; next gate `CDB-V1-070-STAGED-PRODUCTION-CUTOVER-EXACT-AUTHORIZATION-REQUIRED`.

- [ ] **Step 1: Write audit and tracker expectations**

Record exact candidate commit, package/evidence hashes, counts, unresolved bindings and safety flags. Do not record production secrets, backup paths or row identifiers.

- [ ] **Step 2: Update continuity tests**

Require the new checkpoint, next gate, package path, audit path, `packageReady=true`, `executionReady=false` and all production action flags false.

- [ ] **Step 3: Run focused regression**

Run all CDB-V1-050/060 package, continuity, access and identity/episode tests.

Expected: all pass.

- [ ] **Step 4: Run final gates**

Run:

```bash
pnpm exec tsc --noEmit
pnpm build:migrations
pnpm canonical:check
```

Expected: all exit 0; migration manifest count remains 504.

- [ ] **Step 5: Commit evidence and metadata**

Create one evidence commit and one final metadata commit, staging exact files only. Preserve `.ai-bridge` execution/session logs unstaged.

- [ ] **Step 6: Verify final state**

Run branch/head/divergence checks and verify only the two intentional `.ai-bridge` log files remain dirty. Do not push or integrate CDB into `main`.
