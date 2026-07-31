# CDB-101 Reporting Operational Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify fail-closed operational contracts, planning tools, and guarded execution wrappers for the remaining CDB-101 reporting cutover blockers without performing any production mutation.

**Architecture:** A pure TypeScript contract library owns deterministic authorization validation, command IDs, FK classification, SQL policy, and blocker resolutions. Thin CLIs use the library for read-only planning or for future explicitly authorized wrappers that default to refusal and require exact execution tokens.

**Tech Stack:** TypeScript, Node.js crypto/fs/child_process, Vitest, Wrangler CLI command contracts, existing canonical preflight and migration manifest tooling.

## Global Constraints

- Work only in `task/cdb-101-operational-readiness` and its isolated worktree.
- Do not deploy, apply production migrations, import production data, change feature flags, switch active routes, export production, restore Time Travel, push, merge to `main`, enable the local server, or touch the original dirty workspace.
- Production access is aggregate-only and read-only.
- Every executable wrapper defaults to non-execution and requires exact authorization, command ID, identity, time window, scope, confirmation token, and explicit `--execute`.
- The 49 FK violations may not be represented as a blanket count-only waiver.
- Wrangler migration execution is allowed only when the remote pending set equals `0423` through `0433` exactly.

---

### Task 1: Shared production cutover contract

**Files:**
- Create: `scripts/canonical/production-cutover-contract.ts`
- Test: `test/canonical/production-cutover-contract.test.ts`

**Interfaces:**
- Consumes: authorization JSON, current UTC time, pending migration list, FK aggregate groups, canonical bundle SQL/manifest, deployment evidence.
- Produces: stable validation issues, deterministic command IDs, migration/import/flag plans, FK classifications, timing calculations, and 17 blocker resolutions.

- [ ] Write RED tests for exact production identity, tenant/domain scope, time-window and expiry boundaries, owner separation, deployment evidence, command IDs, migration drift, FK classification, SQL allowlist, flag SQL, smoke coverage, export/bookmark evidence, timing measurements, and 17 blocker coverage.
- [ ] Run `pnpm vitest run test/canonical/production-cutover-contract.test.ts` and confirm module-not-found failure.
- [ ] Implement minimal types, constants, validators, hash canonicalization, command-ID builders, SQL parser/policy, FK classifier, flag SQL builder, and blocker matrix.
- [ ] Re-run the focused test and confirm pass.

### Task 2: Read-only operational planning CLI

**Files:**
- Create: `scripts/canonical/reporting-cutover-operations.ts`
- Modify: `package.json`
- Test: `test/canonical/production-cutover-contract.test.ts`

**Interfaces:**
- Consumes: authorization JSON and optional `--at-utc`.
- Produces: aggregate-only JSON with readiness, issues, expected command IDs, exact read-only verification commands, guarded mutation command descriptions, FK plan, and blocker resolution statuses.

- [ ] Add RED CLI argument and output-minimization tests around exported parser/build functions.
- [ ] Implement a no-network, no-write CLI.
- [ ] Add `canonical:plan-reporting-cutover` package script.
- [ ] Verify the template produces `executionReady=false` and all unresolved actions are explicit.

### Task 3: Guarded migration, import, and flag wrappers

**Files:**
- Create: `scripts/canonical/apply-production-canonical-migrations.ts`
- Create: `scripts/canonical/import-production-canonical-bundle.ts`
- Create: `scripts/canonical/set-production-canonical-flag.ts`
- Test: `test/canonical/production-cutover-contract.test.ts`

**Interfaces:**
- Migration wrapper consumes exact pending list and authorization and produces the single approved Wrangler command only when every gate passes.
- Import wrapper consumes a reviewed DML bundle and manifest and permits only allowlisted canonical table writes.
- Flag wrapper consumes expected prior state and produces a tenant-100 shadow-mode upsert plus read-before/read-after verification.

- [ ] Add RED tests proving default refusal, wrong token refusal, wrong DB/tenant/commit/time refusal, migration drift refusal, bundle checksum/SQL refusal, and global/multi-tenant flag refusal.
- [ ] Implement injectable runners and explicit execute switches.
- [ ] Do not invoke execution paths.
- [ ] Verify command arrays never select staging/local/preview and never widen tenant scope.

### Task 4: Authorization, evidence, and operational documentation

**Files:**
- Modify: `docs/database/migration-runs/production/CDB-101-reporting-authorization-template.json`
- Create: `docs/database/migration-runs/production/CDB-101-reporting-operational-readiness.md`
- Modify: `docs/database/migration-runs/production/CDB-101-reporting-preflight.md`

**Interfaces:**
- Consumes: the contract library and current production aggregate evidence.
- Produces: exact authorized procedures, owner contracts, deployment/version method, export/bookmark procedure, tenant-100 smoke checklist, rollback/reopen tracker, FK repair/waiver plan, and one actionable resolution for every current blocker.

- [ ] Upgrade the authorization template while preserving fail-closed defaults.
- [ ] Document exact Wrangler migration semantics and scope validation.
- [ ] Document production importer bundle requirements and unresolved generator gate.
- [ ] Document flag writer use and separate canonical-mode promotion authorization.
- [ ] Document route/version verification using read-only deployment/version inspection plus legacy route smoke fingerprints.
- [ ] Record all 17 blockers with owner role, action, evidence, and current status.

### Task 5: Tracker, AI bridge, adversarial review, verification, and integration

**Files:**
- Modify: `task-progress.yaml`
- Modify: `.ai-bridge/current-plan.md`
- Modify: `.ai-bridge/agent-status.md`
- Modify: `.ai-bridge/decisions.md`

**Interfaces:**
- Consumes: focused tests, full canonical suite, TypeScript, governance, migration build, JSON/YAML validation, diff checks, adversarial findings, and aggregate-only production preflight.
- Produces: a committed clean worker branch and a lock-protected merge into `feature/hms-canonical-data-architecture` only.

- [ ] Run adversarial review and fix confirmed issues.
- [ ] Run focused and full canonical tests.
- [ ] Run `pnpm exec tsc --noEmit`, `pnpm build:migrations`, and `pnpm canonical:check`.
- [ ] Validate JSON/YAML and run diff checks.
- [ ] Run aggregate-only production preflight and prove `changed_db=false`, `rows_written=0`.
- [ ] Commit the worker branch.
- [ ] Acquire the shared merge lock, merge only into the program branch, rerun required verification, update integration evidence, commit, and release the lock.
