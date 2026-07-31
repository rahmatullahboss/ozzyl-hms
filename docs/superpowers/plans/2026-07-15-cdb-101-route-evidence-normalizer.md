# CDB-101 Protected Route Evidence Normalizer Implementation Plan

Date: 2026-07-15

Branch: `task/cdb-101-route-evidence-normalizer`

Base: `c2740ef268821401ee25478d94fff3bee3a59541`

## Constraints

- Work only in the isolated normalizer worktree.
- No network requests, credentials, production connector calls, deployment, migration, import, flag mutation, export, restore, FK repair, push, or `main` merge.
- Raw response bodies and protected output stay outside the repository.
- Follow RED-GREEN-REFACTOR.
- The existing fingerprint validator remains the final readiness gate.

## Task 1 — Pure shape extraction and marker derivation

- [x] Add failing tests for nested objects, arrays, empty arrays, deterministic ordering, unioned array shapes, depth/node/path limits, control-character keys, and non-retention of values.
- [x] Add failing tests for `canonical` and `activeRouteSwitched` marker derivation.
- [x] Implement bounded pure functions in `scripts/canonical/normalize-reporting-route-evidence.ts`.
- [x] Run focused tests and commit.

## Task 2 — Strict manifest and protected-file contract

- [x] Add failing tests for exact manifest keys and exact twelve-route probe inventory.
- [x] Reject credentials, headers, cookies, tokens, duplicate routes, unknown routes, path traversal, absolute body paths, symlinks, incorrect modes, repository-contained protected roots, malformed JSON, and oversized inputs.
- [x] Implement secure path resolution and protected file reads using `lstat` and bounded reads.
- [x] Run focused tests and commit.

## Task 3 — Evidence generation, validation, and atomic output

- [x] Add failing tests proving generated evidence passes `evaluateReportingRouteFingerprint`.
- [x] Add failing tests for canonicalized legacy routes, active switches, invalid shapes/statuses, output overwrite refusal, partial cleanup, and output mode `600`.
- [x] Build `ReportingRouteLiveEvidence` from probe metadata plus derived shapes/markers.
- [x] Validate against a fresh repository capture before writing.
- [x] Write with a temporary exclusive file, flush, close, and atomic rename.
- [x] Return only an aggregate receipt.
- [x] Run focused tests and commit.

## Task 4 — CLI, documentation, and final verification

- [x] Add strict CLI parser for `--protected-root`, `--manifest`, and `--output` only.
- [x] Add `canonical:normalize-reporting-route-evidence` package script.
- [x] Add a fail-closed manifest template with no credential/header fields.
- [x] Update the route fingerprint runbook and create a PHI-free task report.
- [x] Run focused and full canonical suites, migration build, governance, TypeScript, CLI negative tests, JSON/YAML parsing, secret scan, and `git diff --check`.
- [x] Commit final handoff and leave a clean worker branch ready for integration.
