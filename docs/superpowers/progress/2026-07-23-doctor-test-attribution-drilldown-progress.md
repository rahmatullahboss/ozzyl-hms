# Doctor Test Attribution and Drilldown Progress

**Feature branch:** `feat/doctor-test-attribution-drilldowns-20260723`

**Reviewed base:** `564ca64edebc40462a3eb737b4e2a04c591ac17c`

**Verified feature head:** `49c69e2461477bb80d8e27c1cc128631eb6045d1`

**Status:** Integrated into local `main` and verified

## Delivered behavior

- Preserved `lab_orders.ordered_by` as the user who entered the order.
- Added nullable `lab_orders.ordering_clinician_doctor_id` with conservative same-tenant backfill.
- Separated Referring Doctor, Ordering Clinician, Entered By, and Performing Doctor identities.
- Prevented receptionist/staff names from appearing as Ordering Clinician.
- Split doctor detail evidence into Referred Tests and Performed Tests.
- Added Test Performance views for Referred By, Performed By, and All Test Lines.
- Added doctor-wise grouping and complete selected-period summaries.
- Added Doctor Performance `Test Commission` after `Test Collection`.
- Added Referred Tests `Test Commission` after `Test Collection`; this value is the pre-waiver earned referral commission. Doctor Waiver and Payable remain separate.
- Preserved pagination summary/count metadata even when a requested page contains no rows.

## Financial and canonical boundaries

- No commission ownership, rate, base, performer reserve, waiver, payable, paid, outstanding, or settlement formula was changed.
- `Test Commission` detail display now exposes the already-existing pre-waiver earned amount; `Payable` remains the post-waiver amount.
- No canonical feature flag, read authority, write policy, strict mode, or legacy authority setting was changed.
- All analytics remain tenant/date scoped.

## Verification

| Gate | Result |
|---|---|
| Focused backend/schema/write-path/analytics suites | PASS — 12 files, 119 tests |
| Focused dashboard component suites | PASS — 3 files, 10 tests |
| Feature-branch full repository suite | PASS — 1,036 files, 16,663 tests |
| Merged local-main full repository suite | PASS — 1,041 files, 16,702 tests |
| Root TypeScript (`pnpm exec tsc --noEmit`) | PASS |
| Canonical schema governance (`pnpm canonical:check`) | PASS — 0 issues |
| Migration manifest/build | PASS — 466 conforming migrations generated; 9 known non-conforming seed/helper SQL files skipped |
| Production build | PASS — web, patient, and admin applications |
| Diff whitespace validation | PASS |

Existing non-blocking build warnings remained limited to large chunks and Vite/plugin deprecations. The Test Performance component test also emits the existing no-i18next-instance warning in the isolated test harness; assertions pass.

## Migration 0534 rehearsal

Migration `0534_lab_order_clinical_attribution.sql` was applied only to a private `/tmp` copy of the protected production-clone mirror. The protected source artifact checksum remained:

```text
8c33b8412226661373ace67df2715e78fd0f4c5842b72219a9bcfd6b0ec44175
```

Aggregate-only result:

```text
integrity_check: ok
foreign_key_violations: 0
lab_order_rows_before: 118
lab_order_rows_after: 118
ordering_clinician_links_after_backfill: 11
orphan_ordering_clinician_links: 0
```

No production D1 query, migration, flag mutation, deployment, or patient-row output was performed.

## Implementation commits

- `b8018cde6` — add explicit ordering-clinician attribution migration
- `e9a6f7cc7` — separate clinical ordering from data entry on write paths
- `32c115111` — separate doctor-test attribution roles in analytics
- `43fce2fcc` — split referred and performed doctor tests
- `a1034090f` — add doctor-wise Test Performance drilldowns
- `53304f9b9` — add Test Performance evidence UI and locales
- `da125f6b5` — show Test Commission in Doctor Performance
- `5342c424f` — preserve Test Performance summary across empty pages
- `49c69e246` — show pre-waiver Test Commission in doctor details

## Local-main integration

- `8d8b47ae3` — merged the complete feature branch into local `main` without conflicts.
- `1a462abb2` — updated two stale appointment-billing source-contract tests to follow the already-extracted atomic finalization helper; production appointment logic was not changed.
- Merged-main verification passed: 1,041 test files, 16,702 tests, TypeScript, canonical governance, and web/patient/admin production builds.
- No GitHub push, production migration, canonical flag change, or deployment was performed.

## Review outcome

Adversarial review found and fixed one pagination issue before integration: summary and total-row metadata previously disappeared when a page offset exceeded the available rows. No unresolved Critical, High, or Medium issue remains in the reviewed scope.
