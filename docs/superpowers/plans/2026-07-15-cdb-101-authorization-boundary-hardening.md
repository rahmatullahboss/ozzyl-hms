# CDB-101 Authorization Boundary Hardening Plan

Date: 2026-07-15

Branch: `task/cdb-101-authorization-boundary-hardening`

Base: `0564a1b9d663f82ae949f94999e2fb48da2ad21c`

## Constraints

- Work only in the isolated worktree.
- Preparation and validation only; do not perform any live stage.
- Follow RED-GREEN-REFACTOR.
- Error output must remain aggregate-only and must not echo paths or document values.

## Task 1 — Strict JSON document parser

- [x] Add failing tests for invalid JSON, duplicate keys, unknown fields, sensitive fields, missing nested objects, wrong types, unsafe integers, prototype-pollution keys, and excessive depth or size.
- [x] Implement exact strict schema parsing and duplicate-key scanning.
- [x] Preserve semantic validation as a separate gate.
- [x] Run focused tests and commit.

## Task 2 — Protected authorization file reader and offline CLI

- [x] Add failing tests for repository-contained files, symlinks, parent and file modes, oversized files, sanitized errors, and aggregate output.
- [x] Implement no-follow bounded protected reads.
- [x] Add `canonical:validate-reporting-authorization` CLI.
- [x] Clean the committed template to the exact schema.
- [x] Run focused tests and commit.

## Task 3 — Wrapper pre-request gate

- [x] Add subprocess tests with a fake package executable proving invalid authorization causes zero child invocations.
- [x] Integrate strict protected authorization preflight into migration, import, and flag wrappers before any external command.
- [x] Integrate strict parsing into the local operations planner and optional reporting preflight authorization path.
- [x] Run focused tests and commit.

## Task 4 — Documentation and verification

- [x] Add operator runbook and update CDB-101 operational readiness docs.
- [x] Run focused and full affected suites, migration build, governance, TypeScript, CLI negative tests, metadata parsing, secret scan, and `git diff --check`.
- [x] Commit clean worker handoff ready for program integration.
