# Doctor Test Attribution Canonical-Shadow Production Release

**Released at (UTC):** 2026-07-23T20:06:28Z

**Deployed source:** `a225fe169375a3b2181ff66420443dcd658f3c9a`

**Worker version:** `4db62596-7927-44a5-8c34-51def5c67241`

**Worker tag:** `release-20260723T192948Z-a225fe1693`

**Rollback version retained:** `59b97b90-ec90-4c97-8184-bb66be895a9e` at 0%

## Delivered scope

- Added Doctor Performance `Test Commission` immediately after `Test Collection`.
- Added pre-waiver Test Commission to doctor Referred Tests details while preserving waiver and payable separately.
- Separated Referring Doctor, Ordering Clinician, Entered By, and Performing Doctor identities.
- Prevented receptionist/staff identities from being presented as Ordering Clinician.
- Added doctor Referred Tests and Performed Tests detail tabs.
- Added Test Performance Referred By, Performed By, and All Test Lines drilldowns.
- Preserved summary and row-count metadata for empty requested pages.

## Source and quality gates

- GitHub `main` was synchronized to deployed source before production mutation.
- Worktree policy: clean local `main`, integration mode passed.
- Full tests: 1,041 files and 16,702 tests passed.
- TypeScript: passed.
- Canonical schema governance: passed with 0 issues.
- Production builds: web, patient, and admin applications passed.
- Migration manifest: 466 conforming migrations generated; 9 known seed/helper SQL files skipped.

## Backup and migrations

A restricted pre-migration D1 export was created in the protected release evidence directory with mode `0600`. Its contents were not printed.

Applied production migrations:

- `0533_canonical_credit_note_cash_refunds.sql`
- `0534_lab_order_clinical_attribution.sql`

Post-migration checks:

- Pending migrations: none.
- Canonical refund projection tables: 4/4 present.
- `lab_orders.ordering_clinician_doctor_id`: present.
- Clinician links after conservative backfill: 11.
- Orphan clinician links: 0.

## Candidate verification

Zero-traffic deployment:

- Deployment: `b71f7ead-1868-4877-8d0c-f7d0a4ccc299`
- Baseline: 100%
- Candidate: 0%

Candidate-bound verification passed:

- Exact Worker version and release tag health check.
- Authenticated browser/API smoke for hospital admin, MD, director, and reception.
- Doctor Performance table contract including Test Collection, Test Commission, Earned, Doctor Waiver, and Payable.
- Actual authorized July data: 7 doctor rows, 14 referred detail rows, 11 test rows.
- Test drilldown line/referred/performed views returned 13/2/1 rows respectively.
- No patient, billing, settlement, admission, or financial mutation was created by smoke checks.

## Staged rollout

- 5% candidate: deployment `be28699d-8065-4ec0-b879-ed970abfe7c5`.
- 50% candidate: deployment `34b01e1a-fb76-4f4b-b802-da1167957d24`.
- 100% candidate: deployment `50a3b78b-6481-4c9e-84b2-d99fbd260eac`.

Final traffic allocation:

- `4db62596-7927-44a5-8c34-51def5c67241`: 100%.
- `59b97b90-ec90-4c97-8184-bb66be895a9e`: 0% rollback target.
- No third version in the final deployment.

## Canonical safety and final verification

- Canonical financial feature flags for tenants 1, 100, 101, and 102 remained enabled in `shadow` mode with `writePolicy=shadow`.
- No strict/canonical-only mode was enabled.
- Canonical reads were not promoted.
- Legacy financial authority remained active.
- Reconciliation passed before migration, after migration, after candidate smoke, at 5%, at 50%, and after final promotion.
- Final reconciliation: `evidenceReady=true`, `activationReady=true`, issue count 0, rows written 0, all 15 variances 0, and all 6 controls 0.
- Normal production health returned the exact new Worker version/tag.
- Final authenticated hospital-admin smoke passed.
- Production migration ledger reported no migrations to apply.

Transient Cloudflare GraphQL 429 responses occurred during two reconciliation identity checks. The rollout remained fail-closed at the current stage until each retry returned clean zero-state evidence.

## Non-blocking warnings

- Wrangler 4.93.0 reported a newer version available.
- Existing `sqlite_classes` configuration warning remained.
- Existing Vite chunk-size and plugin deprecation warnings remained.

None of these warnings affected tests, migration execution, candidate verification, staged traffic promotion, production health, or reconciliation.
