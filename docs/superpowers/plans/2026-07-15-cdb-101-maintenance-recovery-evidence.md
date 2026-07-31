# CDB-101 Maintenance and Recovery Evidence Plan

Date: 2026-07-15

Branch: `task/cdb-101-maintenance-recovery-evidence`

Base: `8031229842bd1c7345ffc3848b969c93b2a532ff`

## Constraints

- Work only in the isolated worktree.
- Offline validation and preparation only.
- Do not query production or capture an export/bookmark.
- Do not create owner approvals.
- Keep receipts aggregate-only and path/value sanitized.
- Follow RED-GREEN-REFACTOR.

## Task 1 — Exact evidence schema and RED tests

- [x] Add one complete synthetic maintenance/recovery evidence fixture.
- [x] Add RED tests for exact chronology, approval, owners, policy, export, bookmark, protected file, sensitive fields, duplicate keys, and CLI refusal.
- [x] Add authorization-binding and command-ID tests.

## Task 2 — Strict validator and protected CLI

- [x] Implement exact schema parsing and semantic validation using the shared protected JSON boundary.
- [x] Produce an authorization-compatible normalized snapshot and aggregate-only receipt.
- [x] Add `canonical:validate-reporting-maintenance-recovery-evidence` with no network or execution option.
- [x] Add a fail-closed exact repository template.

## Task 3 — Authorization and wrapper binding

- [x] Add exact `maintenanceRecoveryEvidence` ID/SHA fields to schema-v2 authorization.
- [x] Bind the evidence and normalized snapshot into all three deterministic command IDs.
- [x] Require protected maintenance/recovery evidence in migration, import, and flag wrappers before any external command.
- [x] Require import source-export SHA to equal protected recovery export SHA.
- [x] Prove mismatch causes zero child-process invocations.

## Task 4 — Documentation, verification, and integration

- [x] Document operator evidence requirements and update operational readiness.
- [x] Run focused and full affected suites, migration build, governance, TypeScript, CLI, template, JSON/YAML, secret, and diff checks.
- [x] Commit a clean worker handoff.
- [x] Merge only into `feature/hms-canonical-data-architecture` under the shared lock.
- [x] Update shared trackers without changing authoritative 17-blocker/no-write state.
