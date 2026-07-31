# CDB-V1-070C Production Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and verify a fail-closed production executor that captures aggregate non-PHI evidence, prepares an exact protected authorization, atomically records exactly four pre-applied migration ledger rows, and verifies the post-state without executing migration SQL or modifying business data.

**Architecture:** A shared executor module defines deterministic aggregate evidence documents, exact schema/FK/ledger guards, and one atomic `INSERT INTO d1_migrations ... SELECT` statement. A read-only collector writes protected evidence outside the repository. An authorization preparer binds those evidence hashes, Gate A/B receipts, candidate `e2f6365130946d9ce0cbf4ab1bf3af2ec71e4170`, owner risk evidence, and deterministic confirmation tokens. The execution CLI validates the protected authorization, re-reads all live guards, performs one statement, verifies 29→25 pending migrations and unchanged archival FK disposition, then writes a protected receipt.

**Tech Stack:** TypeScript, Node.js, Vitest, Wrangler D1 CLI, existing protected JSON and CDB-V1-070C authorization contracts.

## Global Constraints

- Production D1: `hms-super-admin-production-apac`, UUID `c68a5360-a2c1-44cc-9e71-f21057bea102`.
- Candidate commit/build SHA remains `e2f6365130946d9ce0cbf4ab1bf3af2ec71e4170`.
- Exact target ledger rows: `0549_approval_revision_policy.sql`, `0551_workforce_roster_integrity.sql`, `0552_attendance_projection_integrity.sql`, `0570_doctor_commission_rule_version_snapshot.sql`.
- Pending migration count must change from 29 to 25.
- Raw archival FK groups must remain exactly 26 to `bills` and 15 to `visits`; effective unwaived count is zero.
- Migration SQL, DDL, business-table writes, backfill, provider flags, Worker/deployment, traffic/routes, Canonical promotion, local sync, Legacy retirement, archival mutation/deletion, destructive action, database deletion, and production-operation push/integration are prohibited.
- Protected directories must be mode 700 and protected files mode 600, outside the repository, with no symlinks or hard links.
- Abort before write on any target, evidence, schema, ledger, FK, timing, authorization, or operator drift.

---

### Task 1: Core evidence and atomic executor

**Files:**
- Create: `scripts/canonical/all-tenant-reconciliation-executor.ts`
- Test: `test/canonical/all-tenant-reconciliation-executor.test.ts`

- [ ] Write failing tests for deterministic evidence hashes, exact SQL boundary, success, and every fail-closed drift path.
- [ ] Run the focused test and confirm the module-missing failure.
- [ ] Implement aggregate-state validation, evidence builders, single-statement SQL, dependency-injected execution, and post-state verification.
- [ ] Run the focused test and confirm all cases pass.

### Task 2: Protected collector and authorization preparer

**Files:**
- Create: `scripts/canonical/collect-all-tenant-reconciliation-evidence.ts`
- Create: `scripts/canonical/prepare-all-tenant-reconciliation-execution-authorization.ts`
- Test: `test/canonical/all-tenant-reconciliation-protected-preparation.test.ts`

- [ ] Write failing tests for protected output, Gate A/B receipt hashing, exact candidate binding, deterministic evidence IDs/hashes, authorization validation, weak mode/link rejection, and no mutation flags.
- [ ] Implement Wrangler aggregate-read gateway and protected file writers.
- [ ] Implement authorization generation from the protected manifest and exact user approval evidence.
- [ ] Run focused tests and confirm pass.

### Task 3: Production execution CLI and scripts

**Files:**
- Create: `scripts/canonical/execute-all-tenant-reconciliation.ts`
- Modify: `package.json`
- Test: `test/canonical/execute-all-tenant-reconciliation-cli.test.ts`

- [ ] Write failing CLI argument and non-executing-default tests.
- [ ] Implement `--authorization`, `--output`, and mandatory `--execute` handling.
- [ ] Add collector, authorization preparer, and executor package scripts.
- [ ] Run all Gate C tests, TypeScript, diff check, and readiness.

### Task 4: Integrate and execute authorized operation

- [ ] Commit reviewed executor changes on the isolated branch.
- [ ] Fast-forward integrate through clean latest `main`, rerun tests/TypeScript, and push implementation.
- [ ] Create a fresh mode-700 protected Gate C directory and mode-600 exact user-approval evidence file.
- [ ] Capture fresh aggregate evidence only.
- [ ] Generate and validate the exact protected authorization.
- [ ] Execute the single atomic ledger statement.
- [ ] Verify exact post-state, unchanged FK disposition, zero prohibited operations, Legacy authority and traffic unchanged.
- [ ] Preserve protected receipts; do not commit or expose secrets/PHI.
