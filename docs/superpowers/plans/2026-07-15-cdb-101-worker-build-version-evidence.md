# CDB-101 Worker Build and Version Evidence Plan

Date: 2026-07-15

Branch: `task/cdb-101-worker-build-version-evidence`

Base: `49a73155e9a362345c63805cc362729585efbc8d`

## Constraints

- Work only in the isolated worktree.
- Daytime offline preparation only.
- Do not call Cloudflare, upload a version, deploy, assign traffic, change routes, or query/mutate production.
- Reuse the shared protected JSON boundary.
- Keep receipts aggregate-only and value/path sanitized.
- Follow RED-GREEN-REFACTOR.

## Task 1 — Exact evidence schema and RED tests

- [x] Add one complete synthetic Worker build/version fixture.
- [x] Add RED tests for service/config identity, commit/build hash chain, chronology, candidate/previous version rules, traffic safety, exact routes, protected files, sensitive fields, duplicate keys, and CLI refusal.
- [x] Add authorization-binding and deterministic command-ID tests.
- [x] Prove mismatched evidence causes zero child-process invocations in all three wrappers.

## Task 2 — Strict validator and protected CLI

- [x] Implement strict schema and semantics using `protected-json-document.ts`.
- [x] Produce one authorization-compatible normalized deployment snapshot and aggregate-only receipt.
- [x] Add `canonical:validate-reporting-worker-build-version-evidence` with no network or execution option.
- [x] Add a structurally exact, semantically fail-closed template.

## Task 3 — Authorization and wrapper binding

- [x] Add exact `workerBuildVersionEvidence` ID/SHA fields to schema-v2 authorization.
- [x] Bind the complete normalized snapshot into migration, import, and flag command IDs.
- [x] Require protected Worker build/version evidence in all three wrappers before any external command.
- [x] Preserve existing authorization, FK, maintenance/recovery, execution, confirmation, and fresh-time gates.

## Task 4 — Documentation, verification, and integration

- [x] Document exact operator evidence and daytime/live-production safety boundaries.
- [x] Run focused and full affected suites, migration build, governance, TypeScript, positive/negative CLI, exact-template, JSON/YAML, forbidden-key, planner, and diff checks.
- [x] Commit a clean worker handoff at `0b6a2ca25dd1a003d6d000bf8db9ff0c5c5d6847`.
- [x] Merge only into `feature/hms-canonical-data-architecture` under the shared lock as `a25e711a6ff2612d7eb7619337e978bdb4966cce`.
- [x] Update trackers without changing the authoritative 17-blocker, 49-FK, no-write state.
