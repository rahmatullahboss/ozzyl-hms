# CDB-V1-071 Production Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and execute a fail-closed, authorization-bound production release for exact candidate commit `6db262686985c01982b2858ce0963c8a1447215a` without changing provider authority or routes.

**Architecture:** Add a narrow CDB-V1-071 protected authorization validator and a resumable release executor. The executor binds every production read/write to the exact Worker, D1 database, routes, tenants, 25 migration names, four bounded backfills, candidate bundle hash, previous Worker version, staged traffic percentages, and rollback target. Existing canonical backfill functions are reused through a Wrangler-backed D1 adapter; no application route or provider flag is added.

**Tech Stack:** TypeScript, Node.js, Vitest, Wrangler 4, Cloudflare Workers Versions, Cloudflare D1, existing canonical backfill modules.

## Global Constraints

- Candidate source/build SHA is exactly `6db262686985c01982b2858ce0963c8a1447215a`.
- Candidate dry-run bundle SHA-256 is exactly `9d87fc4741fa91b065a085b1cc0df915dad1017d32a2c5737d1e932d30769c89`.
- Production Worker is exactly `hms-saas-production`.
- Previous Worker version is exactly `4f5d8f93-92d4-4fda-8fba-c0a2863f1b71` and remains rollback-capable.
- Production D1 is exactly `hms-super-admin-production-apac`, UUID `c68a5360-a2c1-44cc-9e71-f21057bea102`.
- Tenant scope is exactly `1`, `100`, `101`, `102`.
- Only the authorized 25 pending migrations may be applied, in repository order.
- Each authorized backfill pass processes at most 100 source records per tenant; a second pass is mandatory and must create zero new business rows.
- Traffic stages are exactly 5/95, 50/50, then 100/0 candidate/previous.
- Provider flags, Canonical read/write promotion, local-sync activation, Legacy retirement, route changes, destructive actions, unrelated production writes, database deletion, push during execution, and archival mutation remain forbidden.
- Any drift or failure aborts and restores the previous Worker to 100% traffic.

---

### Task 1: Protected release authorization validator

**Files:**
- Create: `scripts/canonical/cdb-v1-071-production-release-authorization.ts`
- Create: `scripts/canonical/validate-cdb-v1-071-production-release-authorization.ts`
- Test: `test/canonical/cdb-v1-071-production-release-authorization.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `loadProtectedJsonDocument()` from `scripts/canonical/protected-json-document.ts`.
- Produces: `prepareProtectedCdbV1071Authorization(path, repositoryRoot, atUtc)` returning an exact authorization plus a fail-closed receipt.

- [ ] **Step 1: Write failing validator tests** covering valid authorization, generic approval rejection, wrong commit, wrong bundle, wrong Worker/database/route/tenant, migration drift, backfill limit drift, traffic-stage drift, forbidden permissions, expired window, duplicate/unsafe JSON, repository-contained file, and unsafe permissions.
- [ ] **Step 2: Run the focused test and verify RED** with missing module/export failures.
- [ ] **Step 3: Implement the strict schema, deterministic confirmation tokens, protected-file checks, timing checks, exact scope checks, and receipt.**
- [ ] **Step 4: Run the focused test and verify GREEN.**
- [ ] **Step 5: Add the validation CLI and package script, then commit the validator slice.**

### Task 2: Production release executor and Wrangler D1 adapter

**Files:**
- Create: `scripts/canonical/cdb-v1-071-wrangler-d1-adapter.ts`
- Create: `scripts/canonical/execute-cdb-v1-071-production-release.ts`
- Test: `test/canonical/cdb-v1-071-wrangler-d1-adapter.test.ts`
- Test: `test/canonical/cdb-v1-071-production-release-executor.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: validated CDB-V1-071 authorization; existing `backfillTenantPatientLinks`, `backfillPractitioners`, `backfillAppointments`, and `backfillEncounterAdmissionBedConvergence` functions.
- Produces: a phase-based CLI with `--phase preflight|backup|migrate|backfill|upload|traffic-5|traffic-50|traffic-100|rollback`, `--authorization`, `--evidence-dir`, and `--execute`.

- [ ] **Step 1: Write failing adapter tests** for SQL literal escaping, bound parameter substitution, read-only metadata enforcement, write metadata accounting, and batch execution.
- [ ] **Step 2: Verify RED.**
- [ ] **Step 3: Implement the minimal Wrangler D1 adapter.**
- [ ] **Step 4: Verify adapter GREEN.**
- [ ] **Step 5: Write failing executor tests** for phase ordering, exact migration list, candidate upload tag, health/version checks, staged deployment commands, forbidden provider/route changes, second-pass zero enforcement, and rollback command.
- [ ] **Step 6: Verify RED.**
- [ ] **Step 7: Implement the resumable fail-closed executor and protected evidence receipts.**
- [ ] **Step 8: Verify executor GREEN, TypeScript, and focused canonical regression tests.**
- [ ] **Step 9: Commit the executor slice.**

### Task 3: Integrate tooling and execute the authorized release

**Files:**
- Modify only through verified integration; production evidence remains outside the repository.

**Interfaces:**
- Consumes: exact user authorization source `user_explicit_cdb_v1_071_production_release_activation_authorization`.
- Produces: protected authorization/evidence files and a production release with retained rollback version.

- [ ] **Step 1: Merge verified tooling into clean `main`, run post-merge tests/typecheck, push, and preserve candidate build source at `6db262...`.**
- [ ] **Step 2: Create mode-700 protected evidence directory and mode-600 authorization JSON outside the repository.**
- [ ] **Step 3: Validate authorization and require `executionReady: true`.**
- [ ] **Step 4: Reconfirm current active Worker, routes, D1 identity, pending migration list, candidate source, bundle SHA, and three public health endpoints.**
- [ ] **Step 5: Capture Time Travel bookmark and protected export before any schema mutation.**
- [ ] **Step 6: Apply only the exact 25 migrations and verify zero pending authorized migrations.**
- [ ] **Step 7: Run all four backfills for tenants 1/100/101/102 with limit 100 and mandatory zero-creation second pass.**
- [ ] **Step 8: Upload exact candidate at 0% and verify version metadata/config/routes/bindings.**
- [ ] **Step 9: Roll traffic 5%, 50%, and 100%, verifying health/version/runtime/schema/tenant isolation after each stage.**
- [ ] **Step 10: On any failure, immediately restore previous Worker `4f5d8f93-92d4-4fda-8fba-c0a2863f1b71` to 100%.**
- [ ] **Step 11: Record final evidence, verify production health and active version, then clean the tooling worktree/branch.**
