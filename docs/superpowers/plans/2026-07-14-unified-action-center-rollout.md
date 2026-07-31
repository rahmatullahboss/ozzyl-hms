# Unified Action Center Rollout Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement the linked plans task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved Unified Action Center design through five independently testable and releasable phases.

**Architecture:** The rollout preserves the existing approval engine and introduces domain-owned exception, collection, task, and moderation workflows behind one shared Action Center shell. Each phase is merged only after its focused tests, full TypeScript/build gates, adversarial review, and migration checks pass.

**Tech Stack:** TypeScript, Hono, Cloudflare D1, React, React Router, TanStack Query, i18next, Tailwind CSS, Vitest, Playwright.

## Global Constraints

- Execute phases in dependency order.
- Rebase each phase against the latest clean `main` before integration.
- Action Center migration reservations are Phase 2 `0500`, Phase 3 `0501`, Phase 4 `0502`, and Phase 5 `0503`.
- Do not reuse isolated canonical-program migration numbers `0423–0433`; rebase and renumber that block before canonical integration because production migration `0423_repair_clean_cash_handover_pending_approvals.sql` is immutable history.
- Collections and write-offs resolve financial authority through tenant mode `legacy`, `shadow`, or `canonical`; workflow tables never become invoice/payment/adjustment authorities.
- Money introduced by Action Center uses integer minor units plus explicit currency. Existing legacy major-unit values are converted only inside legacy adapters.
- Canonical/shadow financial modes remain disabled until canonical foundation, invoice, payment, adjustment, backfill, and reconciliation work is integrated and production-verified.
- Apply production migrations only during an explicitly approved release, after remote dry-run and candidate-row checks.
- Build the full monorepo before every production deploy so main, patient, and admin assets are all present.
- Do not stage or commit generated E2E reports, traces, or auth-state files.
- Run fresh verification after conflict resolution; pre-merge test results are not sufficient.

## Phase Order

- [x] **Phase 1 — Shell and navigation**

Plan: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-1-shell-navigation.md`

Deliverable: one canonical Action Center, existing approvals embedded unchanged, legacy redirects, simplified sidebar, Patient Experience navigation, and corrected dashboard links.

Release risk: low; no migration.

Phase 1 integration status: `READY FOR INTEGRATION` at completion commit `b1406a88`.

- [x] Focused backend and frontend tests pass (101 backend, 99 frontend).
- [x] Root TypeScript passes.
- [x] Full main, patient, and admin production build passes.
- [x] `git diff --check` passes.
- [x] Adversarial findings are fixed.
- [x] Only Phase 1 source, test, and documentation files were committed.
- [ ] Rebase and fresh post-merge verification on the latest clean `main`.

`.ai-bridge` continuity files remain intentionally uncommitted and are excluded from integration commits.

- [x] **Phase 2 — Persistent exceptions**

Plan: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-2-exceptions.md`

Dependency: Phase 1.

Deliverable: persistent exception cases, detector sync, acknowledgement/assignment/snooze/resolve/dismiss/reopen, source links, and timeline.

Release result: migration `0500` applied; application commit `7cfda8829`; Worker `b9c4cb2a-669a-4f80-8bbb-42bc7724b4bb`; unauthenticated smoke 12/12 and authenticated exception sync verified.

Release risk: closed. Recurring synchronization remains a separate scheduling decision.

- [x] **Phase 3 — Collections workflow**

Plan: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-3-collections.md`

Dependency: Phases 1 and 2 are integrated. Canonical financial mode additionally depends on the rebased canonical foundation/invoice/payment/adjustment program; production remains intentionally in legacy authority mode.

Deliverable: full-dataset minor-unit receivable totals, server pagination, persistent canonical-ready collection cases, legacy/shadow/canonical authority adapters, contact/follow-up/promise/dispute/escalation, authority-provided payment deep links, and timeline.

Release result: migration `0501` applied as D1 ledger row `450`; application commit `0a3012e6`; Worker `180cb73d-57f3-4cca-8f55-db3096f7c9d3`; unauthenticated smoke 12/12, general authenticated checks, and Collections-specific authenticated API/page checks passed.

Release risk: closed for legacy authority mode. Shadow/canonical activation remains blocked until canonical migrations, backfills, and reconciliation are complete.

- [ ] **Phase 4 — Controlled write-off**

Plan: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-4-write-off.md`

Dependency: Phase 3 and the existing approval engine. Legacy-mode execution uses the audited current credit-note/accounting path; canonical/shadow execution additionally depends on the reconciled canonical adjustment/outbox/accounting commands.

Deliverable: minor-unit write-off request, maker-checker review, authority-aware legacy/canonical credit adjustment execution, rejection restoration, and UI evidence.

Release risk: high; financial mutation and authority cutover. Uses migration `0502` and requires explicit financial adversarial review, mode checks, and production candidate queries.

- [ ] **Phase 5 — Tasks and moderation**

Plan: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-5-tasks-moderation.md`

Dependency: Phases 2 and 3 for source-linked tasks; Phase 1 for navigation.

Deliverable: persistent task assignments with stable source public references and structured Review Moderation under Patient Experience, followed by end-to-end Action Center coverage.

Release risk: medium; additive migration `0503` and route/UI replacement. Task state remains independent of legacy/canonical financial authority.

## Integration Gate Per Phase

- [ ] Focused backend and frontend tests pass.
- [ ] Root `pnpm exec tsc --noEmit` passes.
- [ ] `pnpm build:migrations` passes when the phase has a migration.
- [ ] Full `pnpm build` passes.
- [ ] `git diff --check` passes.
- [ ] Adversarial and edge-case review findings are fixed or explicitly deferred with rationale.
- [ ] Only phase-owned files are staged.
- [ ] Branch is clean after commit.
- [ ] Main integration receives fresh post-merge verification.

## Production Gate Per Release

- [ ] `origin/main` matches the reviewed integration commit.
- [ ] Remote migration list contains only expected migrations.
- [ ] Candidate-row and schema preflight queries are recorded.
- [ ] D1 automatic backup is confirmed before migration apply.
- [ ] Post-migration invariants pass.
- [ ] Full monorepo assets are present before Worker deploy.
- [ ] Deploy smoke tests pass.
- [ ] Authenticated tenant smoke verifies the changed workflow.
- [ ] Rollback version and database backup identifiers are recorded.
