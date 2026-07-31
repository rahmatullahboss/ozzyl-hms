# Canonical IPD Continuity and Shadow Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent future IPD discharge shadow-write gaps, repair the four affected Tenant 100 discharges, and align production release verification with the approved all-active-tenant shadow policy.

**Architecture:** Add one idempotent canonical admission-continuity command used by both live admission creation routes. Treat exact admission-linked `inpatient` and `emergency` encounters as valid IPD episodes at discharge and in IPD projections. Generalize aggregate reconciliation to an exact tenant ID, add an all-active-tenant flag-scope preflight, then use protected production operators with exact source predicates, approval tokens, idempotent writes, receipts, and post-repair reconciliation.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, Vitest, Wrangler Worker Versions, canonical command-batch/source-mapping infrastructure, pnpm.

## Global Constraints

- Base reviewed local `main`: `89889b57e52fe622ed74dc8ee7ae4409b64a87d5`.
- Work only on `fix/ipd-admission-canonical-authority-20260727` in its linked worktree.
- Preserve legacy admission and billing authority in disabled/shadow modes.
- Do not expose patient names, contacts, clinical details, SQL internals, evidence hashes, or secrets in logs/issues.
- No ad-hoc production SQL. Production writes must use protected operators with database identity checks, exact source-state preconditions, explicit approval and execute switches, protected receipts, and verified idempotency.
- Tenant 100 remains `financial/shadow/enabled`; strict/canonical promotion is out of scope.
- The approved all-active-tenant non-blocking shadow policy remains in force; do not disable Tenant 101/102 merely to satisfy stale runbook text.
- TDD is mandatory: every functional code change starts with a failing test.
- Stage exact task-owned files and commit each verified checkpoint.

---

### Task 1: Canonical admission continuity command

**Files:**
- Create: `src/lib/canonical/commands/ensure-admission-encounter.ts`
- Create: `src/lib/canonical/live-admission-continuity.ts`
- Create: `test/canonical/ensure-admission-encounter.test.ts`
- Create: `test/canonical/live-admission-continuity.test.ts`

**Interfaces:**
- Produces `ensureAdmissionEncounter(db, input)` with exact tenant, admission, patient, admission number/type and start-time evidence.
- Produces `ensureLiveAdmissionContinuity(db, input)` that resolves the current tenant shadow policy, runs the idempotent command when enabled, and records a sanitized canonical processing issue if a shadow projection fails.

- [ ] **Step 1: Write RED command tests**

Test planned and emergency-origin admissions. Require deterministic encounter/source IDs, one active admission link, one source mapping, and replay with no duplicate rows. Seed an existing compatible encounter/link and require verified reuse. Seed patient/type conflicts and require fail-closed behavior.

- [ ] **Step 2: Verify RED**

Run:

```bash
pnpm exec vitest run test/canonical/ensure-admission-encounter.test.ts
```

Expected: FAIL because the command does not exist.

- [ ] **Step 3: Implement minimal command**

Use `createDeterministicSourceId`, `createSourceEvidenceSha256`, `toUtcIso`, exact source mapping identity `legacy_admission/<admissionId>`, and one D1 batch. Admission type `emergency` maps to canonical `emergency`; all other admitted IPD types map to `inpatient`. Do not require a practitioner mapping.

- [ ] **Step 4: Write and implement live helper tests**

Cover disabled/missing flag as a no-op, exact tenant-scoped shadow flag as projection, and sanitized issue upsert on failure without exposing source payload.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec vitest run test/canonical/ensure-admission-encounter.test.ts test/canonical/live-admission-continuity.test.ts
git add src/lib/canonical/commands/ensure-admission-encounter.ts src/lib/canonical/live-admission-continuity.ts test/canonical/ensure-admission-encounter.test.ts test/canonical/live-admission-continuity.test.ts
git commit -m "fix(canonical): ensure admission encounter continuity"
```

---

### Task 2: Wire both admission routes and accept emergency-origin IPD episodes

**Files:**
- Modify: `src/routes/tenant/admissions.ts`
- Modify: `src/routes/tenant/reception.ts`
- Modify: `src/lib/canonical/commands/finalize-ipd-discharge-billing.ts`
- Modify: `src/lib/canonical/ipd-projection.ts`
- Modify: `test/canonical/finalize-ipd-discharge-billing.test.ts`
- Modify: `test/canonical/ipd-projection.test.ts`
- Create: `test/integration/routes/admission-canonical-continuity.test.ts`

**Interfaces:**
- Both admission creation routes call `ensureLiveAdmissionContinuity` after resolving the committed admission ID and before returning success.
- Discharge and IPD projection use the exact active admission link and accept encounter types `inpatient` or `emergency`.

- [ ] **Step 1: Write RED route and discharge tests**

Add tests proving both route source files invoke the helper with committed admission identity. Add a SQLite finalizer test where the exact linked encounter type is `emergency`; require invoice/link creation and encounter completion. Add projection coverage for an emergency-origin linked admission.

- [ ] **Step 2: Verify RED**

```bash
pnpm exec vitest run test/integration/routes/admission-canonical-continuity.test.ts test/canonical/finalize-ipd-discharge-billing.test.ts test/canonical/ipd-projection.test.ts
```

Expected: new emergency/route assertions fail.

- [ ] **Step 3: Implement minimal route/finalizer/projection changes**

Use `encounter_type IN ('inpatient','emergency')` only where an exact active admission link is already required. Do not broaden to outpatient or unlinked emergency encounters.

- [ ] **Step 4: Verify and commit**

```bash
pnpm exec vitest run test/integration/routes/admission-canonical-continuity.test.ts test/canonical/finalize-ipd-discharge-billing.test.ts test/canonical/ipd-projection.test.ts test/integration/routes/ipd-discharge-canonical.test.ts
git add src/routes/tenant/admissions.ts src/routes/tenant/reception.ts src/lib/canonical/commands/finalize-ipd-discharge-billing.ts src/lib/canonical/ipd-projection.ts test/integration/routes/admission-canonical-continuity.test.ts test/canonical/finalize-ipd-discharge-billing.test.ts test/canonical/ipd-projection.test.ts
git commit -m "fix(ipd): preserve admission encounter authority"
```

---

### Task 3: Tenant-scoped reconciliation and all-tenant shadow preflight

**Files:**
- Modify: `scripts/canonical/collect-tenant-financial-reconciliation.ts`
- Modify: `test/canonical/collect-tenant-financial-reconciliation.test.ts`
- Create: `scripts/canonical/validate-production-financial-shadow-scope.ts`
- Create: `test/canonical/production-financial-shadow-scope.test.ts`
- Modify: `docs/operations/canonical-shadow-safe-production-deploy.md`

**Interfaces:**
- Produces `buildTenantFinancialReconciliationSql(tenantId: string)` and `--tenant <positive-decimal-id>` CLI support; default remains `100`.
- Produces an aggregate-only scope validator requiring one exact enabled shadow row per active tenant, exact `tenantScope:[tenantId]`, `writePolicy:'shadow'`, no inactive/orphan flag, and no duplicate effective flag.

- [ ] **Step 1: Write RED collector tests**

Require generated SQL to scope legacy/canonical/control queries to `101` without hard-coded Tenant 100 authority and require snapshot tenant ID `101`. Reject empty, whitespace, zero, negative, fractional and non-decimal tenant IDs.

- [ ] **Step 2: Implement generalized collector and verify**

```bash
pnpm exec vitest run test/canonical/collect-tenant-financial-reconciliation.test.ts
```

- [ ] **Step 3: Write RED scope-preflight tests**

Cover exact active tenants `100/101/102`, missing flag, malformed config, disabled row, inactive-tenant flag and duplicates.

- [ ] **Step 4: Implement validator and update runbook**

Replace stale Tenant 101 legacy/Tenant 102 absent assertions with approved all-active-tenant shadow assertions and per-tenant reconciliation evidence.

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec vitest run test/canonical/collect-tenant-financial-reconciliation.test.ts test/canonical/production-financial-shadow-scope.test.ts test/canonical/all-tenant-shadow-flag.test.ts
git add scripts/canonical/collect-tenant-financial-reconciliation.ts scripts/canonical/validate-production-financial-shadow-scope.ts test/canonical/collect-tenant-financial-reconciliation.test.ts test/canonical/production-financial-shadow-scope.test.ts docs/operations/canonical-shadow-safe-production-deploy.md
git commit -m "fix(ops): validate all-tenant financial shadow scope"
```

---

### Task 4: Protected Tenant 100 IPD repair operators

**Files:**
- Create: `scripts/canonical/execute-production-ipd-admission-continuity-repair.ts`
- Create: `test/canonical/execute-production-ipd-admission-continuity-repair.test.ts`
- Create: `scripts/canonical/execute-production-ipd-discharge-financial-repair.ts`
- Create: `test/canonical/execute-production-ipd-discharge-financial-repair.test.ts`
- Modify: `package.json`

**Interfaces:**
- Admission repair verifies and creates exact canonical encounter/link/source mappings for affected/current admissions without duplicating compatible existing authority.
- Financial repair verifies the four exact legacy bills, invoice items, deposit adjustments, original deposit sources and DRF-000005, then projects canonical invoices, lines, deposit applications/refund, encounter invoice links and source mappings exactly once.
- Both operators require immutable approval constants, `--execute`, production database identity, protected receipt paths, exact source predicates and verified second-run no-op behavior.

- [ ] **Step 1: Write RED operator tests**

Use in-memory SQLite and fake gateways to prove approval/identity/source-state rejection, exact SQL scoping, complete creation, partial-state rejection, verified-existing replay and zero cross-tenant writes.

- [ ] **Step 2: Implement minimal protected operators**

Reuse canonical deterministic ID/evidence/projection functions. Do not update legacy bills/deposits. Resolve the existing shadow processing issue only after exact canonical post-state verification.

- [ ] **Step 3: Verify and commit**

```bash
pnpm exec vitest run test/canonical/execute-production-ipd-admission-continuity-repair.test.ts test/canonical/execute-production-ipd-discharge-financial-repair.test.ts
git add scripts/canonical/execute-production-ipd-admission-continuity-repair.ts scripts/canonical/execute-production-ipd-discharge-financial-repair.ts test/canonical/execute-production-ipd-admission-continuity-repair.test.ts test/canonical/execute-production-ipd-discharge-financial-repair.test.ts package.json
git commit -m "fix(canonical): add protected IPD shadow repair"
```

---

### Task 5: Integrated verification, deployment and production repair

**Files:**
- Modify only issue comments/receipts outside Git unless verification exposes a code defect.

- [ ] **Step 1: Run local gates**

```bash
pnpm exec vitest run test/canonical/ensure-admission-encounter.test.ts test/canonical/live-admission-continuity.test.ts test/integration/routes/admission-canonical-continuity.test.ts test/canonical/finalize-ipd-discharge-billing.test.ts test/canonical/ipd-projection.test.ts test/canonical/collect-tenant-financial-reconciliation.test.ts test/canonical/production-financial-shadow-scope.test.ts test/canonical/execute-production-ipd-admission-continuity-repair.test.ts test/canonical/execute-production-ipd-discharge-financial-repair.test.ts
pnpm exec tsc --noEmit
pnpm canonical:check
pnpm build
```

Run the full suite in shards and require zero reproducible failures.

- [ ] **Step 2: Integrate current main safely**

Rebase the clean task branch onto current local `main`, rerun gates, then use the clean main integration worktree and `pnpm worktree:check -- --mode=integration` for fast-forward integration.

- [ ] **Step 3: Deploy through Worker Versions**

Upload immutable candidate at 0%, verify candidate health/auth and per-active-tenant scope/reconciliation, promote 5% → 50% → 100%, and keep previous baseline at 0%.

- [ ] **Step 4: Execute protected repairs**

Capture pre-state and Time Travel bookmark, run admission continuity repair, run financial repair, rerun both to prove verified-existing/no-op, and collect Tenant 100 reconciliation requiring all 15 variances and 6 controls equal zero.

- [ ] **Step 5: Close issues with evidence**

Close #236, #237 and #243 only after zero reconciliation and exact post-state. Close #244 after all-active-tenant scope validation plus Tenant 101/102 aggregate-only reconciliation and runbook correction are verified. Record release commit/version/deployment/rollback IDs and protected receipt hashes without PHI.
