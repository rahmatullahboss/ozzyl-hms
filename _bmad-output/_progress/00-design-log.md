# WDS Design Log

## Current

- **2026-07-27 — Admin Command Center program reviewed and specified**
  - Reviewed current local `main` at `a4a4c47ac99412a50a6b07bc00765e67f1fd41e2` from isolated branch `design/admin-command-center-specs-20260727`.
  - Confirmed that doctor/test analytics, commission drilldowns, invoice modal behavior, KPI configuration, IPD billing overview, and the Action Center already provide a strong implementation foundation.
  - Confirmed remaining gaps: one long dashboard, mixed selected-period/live semantics, duplicate action/risk surfaces, incomplete reconciliation envelopes, non-responsive wide doctor tables, no shared deep-linked invoice inspector, and inactive patient age analytics.
  - Selected a modular eight-workspace Admin Command Center with six staged implementation plans (ACC-00 through ACC-05) and a final verification phase.
  - Analysis: `../evolution/analysis/2026-07-27-admin-command-center-current-state-review.md`
  - Program design: `../../docs/superpowers/specs/2026-07-27-admin-command-center-program-design.md`
  - Reporting contract: `../../docs/superpowers/specs/2026-07-27-admin-command-center-reporting-contract-design.md`
  - Execution pack: `../../docs/architecture/admin-command-center-program-execution-pack.md`
  - Program board: `../../docs/architecture/admin-command-center-program-board.yaml`
  - Scope is documentation only; application behavior, schema, and production state were not changed.

- **2026-07-22 — Doctor compensation drilldown implemented and reviewed**
  - Verified current local `main` at `2353587d8` already contained the recent payable-commission, doctor-waiver, discounted-base, performer-reserve, and readable-detail work.
  - Created isolated branch `feat/admin-doctor-compensation-drilldown-20260722` and added a focused doctor table with referred tests, discounted tests, test discount, performed tests, earned, doctor waiver, payable, paid, and outstanding amounts.
  - Doctor click now opens complete-period summary cards plus referred-test and compensation-ledger calculation chains covering gross, discount, net billed, reserve, commission base, rate, earned, waiver, payable, paid, outstanding, settlement, and waiver reason.
  - Full-waiver, fully-discounted, paid/unpaid performer reserve, invoice-only test, unassigned reserve, and unpaid-test eligibility fixtures are covered.
  - Adversarial review found and fixed two material inconsistencies: invoice-only test omission from summary and unpaid accrual leakage into test-row payable values.
  - Verification: 20 backend integration tests, 29 frontend component tests, root TypeScript, web production build, and whitespace checks passed.
  - Design: `../../docs/superpowers/specs/2026-07-22-admin-doctor-compensation-drilldown-design.md`
  - Plan: `../../docs/superpowers/plans/2026-07-22-admin-doctor-compensation-drilldown-implementation.md`
  - No push, merge, deploy, schema migration, or production mutation was performed.

- **2026-07-22 — Admin Dashboard Control Center analysis documented**
  - Reviewed the clean local `main` dashboard implementation at `79b054a199dbc877d0232015dcf9625361b0a08e` from isolated branch `docs/admin-dashboard-control-center-20260722`.
  - Confirmed the default dashboard enables 40 KPI cards and 5 full analytics panels, with additional IPD, request, trend, payment, Action Center, operations, live-cash, audit, and duplicate risk surfaces.
  - Selected the shared temporal, data-health, and reconciliation foundation as the first improvement target; visual restyling and additional cards are explicitly secondary.
  - Created the current-state audit, Bangla owner summary, product requirements, UX specification, data/API contract, roadmap, QA plan, agent task board, continuation prompt, and detailed TDD implementation plan.
  - Analysis: `../evolution/analysis/2026-07-22-admin-dashboard-control-center-review.md`
  - Program index: `../../docs/admin-dashboard/README.md`
  - Implementation plan: `../../docs/superpowers/plans/2026-07-22-admin-dashboard-control-center-implementation.md`
  - Scope is documentation only; application behavior and production state were not changed.

- **2026-07-21 — Main-based canonical continuation audit and CDB-102 hardening**
  - Confirmed `feature/hms-canonical-data-architecture` was merged into current `main` through `21a4f78d5`; current audited main is `fa742f4960a4bef35950bdb4c5a6a6f251782f8e`.
  - Rejected `review/all-branches-20260711`, the wrong review-based continuous branch, and `integration/main-unified-20260719` as execution bases.
  - Created `program/canonical-main-continuous-20260721` at `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/canonical-main-continuous`.
  - Verified current main with 78 canonical files / 612 tests, 453 generated migrations, TypeScript, zero canonical-governance issues, and full production builds.
  - P00–P09 are complete on current main. P10 remains partial because deposit, refund/application, payment reversal, credit-note approval and unpaid cancellation are not all integrated or fail-closed through the strict/shadow canonical runtime layer. P11 remains pending.
  - Added the current-main audit, continuation design, continuous implementation plan, prompt and architecture contract. Current local task is `CDB-102`; production authorization is false.

- **2026-07-16 — Running bill print layout bugfix in progress**
  - Production URL: `/h/patient-care-hospital/reception/ip-billing/13075/running-print` in Chrome.
  - Reproduced twice after reload: the bill renders at about 557px wide, but `.row` computes to `display: block` with `gap: normal`, causing labels and values to collapse together.
  - Root cause: security commit `43a36dc2b` introduced default `DOMPurify.sanitize(previewHtml)`. The sanitizer removes the generated template's `<style>` element, so only global application CSS remains and generic print classes such as `.row`, `.card`, and `table` render incorrectly.
  - Scope: the other DOMPurify call sites sanitize QR-code SVG only; this HTML-with-style path is specific to the running-bill preview.
  - Fix: the preview sanitizer now uses DOMPurify fragment body mode and explicitly permits the generated style tag; executable scripts and event-handler attributes remain removed.
  - TDD evidence: the new sanitizer contract test failed before the helper existed and again when `ADD_TAGS` alone still removed the style; it passes with `FORCE_BODY` and verifies computed `.row` display is `grid`.
  - Verification: focused IPD running-bill tests pass (5/5) and the web TypeScript/Vite production build succeeds. The full web baseline still has two unrelated pre-existing failures in `admin/widgets/a11y.test.tsx`.
  - Remaining release steps: focused commit, main integration, full production build/deploy, and live Chrome layout measurements.

- **2026-07-14 — Pending Approvals stabilization implemented**
  - Exact-count, undisputed cash handovers now complete as `received` with admin approval not required.
  - Only non-zero variance or explicit receiver disputes enter the admin approval queue.
  - Legacy zero-variance `pending_admin` rows are repaired by migration `0423`.
  - Receiver/admin handover decisions now write structured verification events and appear in the detail timeline.
  - Cash handover system evidence unblocks valid approvals; source-aware routing preserves legacy core approval requests.
  - Sender/receiver self-approval and clean direct-verification are blocked.
  - KPI drill-down filters execute server-side before pagination; reviewed-today metrics include core, handover, and expense sources.
  - Approval Center UI uses five primary decision cards, counted secondary filters, source-safe row keys, and type-aware recovery guidance.
  - Analysis: `../evolution/analysis/2026-07-14-pending-approvals-end-to-end-review.md`
  - Plan: `../../docs/superpowers/plans/2026-07-14-pending-approvals-stabilization.md`
  - Verification: 160 backend tests, 57 frontend tests, migration manifest build, web production build, and root TypeScript compile passed.

## Backlog

- Plan Approval Center V2 separately for multi-level approval, configurable policies, claims/assignment, MFA, audit export, and cross-module normalization.
