# CDB-101 Reporting Preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare a repeatable, read-only production preflight package for the first canonical cutover wave, using the reporting domain as the lowest-risk canary while leaving production migrations, feature flags, deployment, and active report routes unchanged.

**Architecture:** Add a pure production-preflight evaluator plus a Wrangler-backed collector that performs only approved read-only identity and `SELECT` operations. The collector emits aggregate tenant, schema, migration, flag, queue, and integrity evidence; a separate production runbook records the exact maintenance-window sequence and explicitly keeps execution blocked until a fresh named-domain authorization is issued.

**Tech Stack:** TypeScript, Vitest, Cloudflare Wrangler/D1 read-only commands, existing canonical cutover checker and production inspection utilities.

## Global Constraints

- Original dirty workspace must remain untouched.
- Production writes, migrations, feature-flag changes, deployment, Time Travel restore, and route switching are prohibited in this preparation task.
- First-wave recommendation is `reporting` because the canonical reporting modules are read-only and active routes are not switched.
- Evidence must be aggregate-only and must not include patient names, phones, diagnoses, protected SQL exports, secrets, signed URLs, or operator email addresses.
- Rehearsal readiness must never be represented as production authorization.
- CDB-101 remains blocked until a fresh authorization names the domain, tenants, maintenance window, migration set, flags, rollback owner, observation owner, smoke plan, timing thresholds, and expiry.

---

### Task 1: Production reporting preflight evaluator

**Files:**
- Create: `scripts/canonical/reporting-cutover-preflight.ts`
- Create: `test/canonical/reporting-cutover-preflight.test.ts`

**Interfaces:**
- Consumes: aggregate production identity, tenant, migration, feature-flag, canonical-schema, queue, and integrity evidence.
- Produces: `evaluateReportingCutoverPreflight(evidence)` with stable blocker codes, `preparationReady`, `nightExecutionReady`, and aggregate-only output.

- [x] Write RED tests for valid preparation evidence, missing tenants, production identity mismatch, pending canonical migrations, existing canonical tables with queue/critical/FK failures, premature canonical flags, missing smoke/rollback ownership, malformed runtime JSON, and output minimization.
- [x] Run `pnpm vitest run test/canonical/reporting-cutover-preflight.test.ts` and confirm the missing module failure.
- [x] Implement the minimal pure evaluator and read-only command argument guard.
- [x] Implement a CLI collector using the exact production D1 identity and only `SELECT` SQL plus read-only Wrangler identity commands.
- [x] Re-run the focused suite and confirm all tests pass.

### Task 2: Additive tenant-flagged reporting canary route

**Files:**
- Create: `src/routes/tenant/canonicalReporting.ts`
- Create: `test/integration/routes/canonical-reporting.test.ts`
- Modify: `src/index.ts`
- Modify: `src/lib/route-permissions.ts`

**Interfaces:**
- Consumes: canonical doctor, diagnostic, collections, and IPD finance read models.
- Produces: separate `/api/canonical-reporting/*` canary endpoints hidden unless `canonical_reporting_v1` is exactly `shadow` or `canonical`.

- [x] Write RED route tests for hidden-by-default behavior, explicit modes, RBAC, validation, read-only SQL, and all nine registry metrics.
- [x] Add status, doctor-performance, test-performance, collections, and IPD-finance endpoints.
- [x] Register only a read permission and leave every active report route unchanged.
- [x] Prove the route executes no write SQL.

### Task 3: Night execution command pack and current read-only evidence

**Files:**
- Create: `docs/database/migration-runs/production/CDB-101-reporting-preflight.md`
- Create: `docs/database/migration-runs/production/CDB-101-reporting-authorization-template.json`
- Modify: `package.json`

**Interfaces:**
- Consumes: the preflight CLI output and CDB-100 runbook.
- Produces: a reviewed command sequence for now, maintenance-window entry, migration/backfill/reconciliation, reporting flag canary, smoke tests, rollback, and reopen.

- [x] Add `canonical:preflight-reporting` package script.
- [x] Run the CLI against production in read-only mode and record exact aggregate evidence.
- [x] Record the recommended canary tenant set from active production tenants without enabling any flag.
- [x] Record which evidence must be refreshed at the maintenance-window start.
- [x] State an explicit current verdict: preparation may proceed now; night execution remains blocked until fresh authorization and maintenance mode.

### Task 4: Verification and handoff

**Files:**
- Modify: `task-progress.yaml`
- Modify: `.ai-bridge/current-plan.md`
- Modify: `.ai-bridge/agent-status.md`
- Modify: `.ai-bridge/decisions.md`

**Interfaces:**
- Consumes: focused tests, full canonical suite, TypeScript, governance, read-only production output, and diff checks.
- Produces: a preparation-complete handoff that does not mark CDB-101 production execution complete or authorized.

- [x] Run the 443-entry migration build.
- [x] Run TypeScript with zero errors.
- [x] Run focused preflight tests and the full canonical suite.
- [x] Run canonical governance.
- [x] Verify production query metadata reports `changed_db=false` and `rows_written=0`.
- [x] Verify no deployment, migration apply, feature-flag mutation, or active route switch occurred.
- [x] Run YAML assertions and `git diff --check`.
- [x] Commit the preparation package without creating or claiming production authorization.
