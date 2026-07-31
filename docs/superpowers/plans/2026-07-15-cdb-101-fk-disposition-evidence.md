# CDB-101 Foreign-Key Disposition Evidence Plan

Date: 2026-07-15

Branch: `task/cdb-101-fk-disposition-evidence`

Base: `083122fdf1967622267b2fe405dfe6847d5334f8`

## Constraints

- Work only in the isolated worktree.
- Offline validation and preparation only.
- Do not query or mutate production.
- Do not generate repair SQL or approve waivers.
- Keep all receipts aggregate-only and path/value sanitized.
- Follow RED-GREEN-REFACTOR.

## Task 1 — Shared protected JSON primitive

- [x] Add regression coverage preserving the authorization boundary behavior.
- [x] Extract duplicate-key, depth, unsafe-key, protected-file, no-follow, hard-link, and inode-binding logic into a reusable module.
- [x] Migrate authorization parsing to the shared primitive without changing issue behavior.
- [x] Run focused authorization tests.

## Task 2 — Exact FK evidence document

- [x] Add RED tests for one complete synthetic evidence pack.
- [x] Reject active-financial waivers, incomplete repairs, wrong before/after counts, unknown groups, widened scope, missing archival attestations, duplicate evidence IDs, invalid chronology, sensitive fields, duplicate keys, unsafe files, and value disclosure.
- [x] Implement exact schema parsing and semantic validation.
- [x] Produce authorization-compatible disposition groups and an aggregate-only receipt.

## Task 3 — Protected template and offline CLI

- [x] Add a fail-closed repository template containing only null/false evidence placeholders.
- [x] Add `canonical:validate-reporting-fk-evidence` with no execution or network option.
- [x] Verify protected mode-700/mode-600 input and sanitized failures.
- [x] Document the operator evidence-capture contract.

## Task 4 — Integration and verification

- [x] Update CDB-101 operational readiness and tracker artifacts.
- [x] Run focused and full affected suites, migration build, governance, TypeScript, template assertions, secret scan, and Git diff checks.
- [x] Commit a clean worker handoff.
- [x] Merge only into `feature/hms-canonical-data-architecture` under the shared lock.
