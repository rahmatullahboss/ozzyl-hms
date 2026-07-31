# Unified Action Center Progress Tracker

**Last updated:** 2026-07-14
**Workspace:** `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/integrate-unified-action-center-phase1`
**Branch:** `feature/unified-action-center-phase2-exceptions`
**Status:** Phase 2 active inline execution

## Source Documents

- Design: `docs/superpowers/specs/2026-07-14-unified-action-center-design.md`
- Rollout: `docs/superpowers/plans/2026-07-14-unified-action-center-rollout.md`
- Phase 1: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-1-shell-navigation.md`
- Phase 2: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-2-exceptions.md`
- Phase 3: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-3-collections.md`
- Phase 4: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-4-write-off.md`
- Phase 5: `docs/superpowers/plans/2026-07-14-unified-action-center-phase-5-tasks-moderation.md`

## Execution Rules

1. Execute phases in dependency order.
2. Use TDD for every production change: failing test, verified RED, minimal implementation, verified GREEN.
3. Update the active phase plan checkboxes after each completed step/task.
4. Update this tracker after every task commit, blocker, review finding, migration decision, and verification gate.
5. Refresh `.ai-bridge/current-plan.md` whenever the active task changes so a new chat can resume without reconstructing context.
6. Do not merge, push, migrate production, or deploy without a separate explicit instruction after the relevant phase is verified.
7. Do not stage generated E2E reports, traces, screenshots, or auth-state artifacts.

## Completed Foundation

- [x] Design approved.
- [x] UI/UX Pro Max installed project-locally.
- [x] Five phased plans written and self-reviewed.
- [x] Isolated worktree created from main.
- [x] Design commit: `b00ad2b6`.
- [x] Plan commit: `c06255f2`.

## Phase Status

### Phase 1 — Shell and Navigation

**Status:** Integrated to `main`
**Integration commit:** `95789b598c0063821e72c31871a5e5fce6f23dc2`
**Migration:** None

- [x] Task 1 — Approval summary service
- [x] Task 2 — Action Center summary API
- [x] Task 3 — Shared Action Center shell
- [x] Task 4 — Overview page
- [x] Task 5 — Canonical routes and aliases
- [x] Task 6 — Embed approvals queue
- [x] Task 7 — Sidebar information architecture
- [x] Task 8 — Dashboard deep links
- [x] Task 9 — Verification and adversarial review

### Phase 2 — Persistent Exceptions

**Status:** Complete, integrated to `main`, deployed to production, and authenticated sync-smoked
**Active task:** Complete
**Dependency:** Phase 1 integrated
**Migration:** `0500_admin_exception_cases.sql` applied to production
**Main integration:** `7cfda8829`
**Production Worker:** `b9c4cb2a-669a-4f80-8bbb-42bc7724b4bb`

### Phase 3 — Collections Workflow

**Status:** Complete, integrated to `main`, migrated, deployed, and production-smoked in legacy authority mode
**Active task:** Complete
**Dependency:** Phases 1 and 2 integrated; shadow/canonical modes remain gated by canonical-program integration
**Migration:** `0501_collection_cases.sql` applied to production
**Main integration:** `0a3012e6`
**Production Worker:** `180cb73d-57f3-4cca-8f55-db3096f7c9d3`

### Phase 4 — Controlled Write-off

**Status:** Not started
**Dependency:** Phase 3 integrated
**Reserved migration:** `0502`

### Phase 5 — Tasks and Moderation

**Status:** Integrated into local `main` at `089269293`; production schema migration complete
**Active task:** None — Phase 5 Tasks 1–8 are complete
**Dependency:** Phases 2 and 3 integrated for tasks; Phase 1 integrated for moderation navigation; Phase 4 remains intentionally independent
**Migration:** `0503_action_tasks_review_moderation.sql` applied successfully to production D1 on 2026-07-15
**Source branch:** `feature/unified-action-center-phase5-tasks-moderation` at `7e7a554fc`

## Verification Evidence

- Baseline backend: `approvals.test.ts` 97/97 passed before source edits.
- Baseline frontend: Pending Approvals, Approval Center, and Action Required suites 79/79 passed before source edits.
- Task 1 RED: expected missing `src/services/actionCenter/approvalSummary` module.
- Task 1 GREEN: `approvals.test.ts` 98/98 passed.
- Fresh-worktree prerequisite: `pnpm build:migrations` generated 433 migration entries.
- Task 1 typecheck: `pnpm exec tsc --noEmit` passed after manifest generation.
- Task 1 diff validation: `git diff --check` passed.
- Task 1 commit: `792cf76c` (`refactor(approvals): expose operational summary service`).
- Task 2 RED: expected missing `src/routes/tenant/actionCenter` module.
- Task 2 GREEN: Action Center API 3/3 passed; combined Action Center + Approvals 101/101 passed.
- Task 2 typecheck: `pnpm exec tsc --noEmit` passed.
- Task 2 diff validation: `git diff --check` passed.
- Task 2 design invariant: one tenant-bound full-dataset aggregate query provides receivable count and exposure; unsupported persistent capabilities remain false.
- Task 2 commit: `ec778a11` (`feat(action-center): add operational summary endpoint`).
- Task 3 RED: expected missing `ActionCenterShell` component.
- Task 3 GREEN: shell component 4/4 passed.
- Task 3 typecheck: `pnpm exec tsc --noEmit` passed.
- Task 3 UX invariants: semantic nav, canonical links, 44px-equivalent targets, visible focus, capability-aware count badges, and no nested dashboard layout.
- Task 3 commit: `1473889a` (`feat(action-center): add shared navigation shell`).
- Task 4 RED: expected missing `ActionCenterOverview` component.
- Task 4 GREEN: Overview 4/4 passed; combined Overview + Shell 8/8 passed.
- Task 4 typecheck: `pnpm exec tsc --noEmit` passed.
- Task 4 UX invariants: six compact metrics, four capability-aware workstreams, canonical actions, and a healthy no-pending state without disabled dead-end controls.
- Task 4 commit: `65fbcc71` (`feat(action-center): add operational overview`).
- Task 5 RED: expected missing `tenantRedirect` helper.
- Task 5 GREEN: canonical route contract 4/4 passed.
- Task 5 typecheck: `pnpm exec tsc --noEmit` passed.
- Task 5 routing invariants: replace redirects, preserved supported searches, canonical Action Center routes, and Patient Experience review route.
- Task 5 commit: `58b7a611` (`refactor(navigation): canonicalize action center routes`).
- Task 6 RED: embedded prop was ignored and the legacy Approval Center still rendered a second dashboard.
- Task 6 GREEN: Pending Approvals + two compatibility suites + route contract 63/63 passed.
- Task 6 typecheck: `pnpm exec tsc --noEmit` passed.
- Task 6 invariants: one Action Center header/navigation, no nested DashboardLayout, legacy component redirects, and approval decision/action logic remained unchanged.
- Task 6 commit: `f62d6a1e` (`refactor(approvals): embed queue in action center`).
- Task 7 RED: four expected sidebar IA gaps were reproduced.
- Task 7 GREEN: sidebar configuration 21/21 passed.
- Task 7 typecheck: `pnpm exec tsc --noEmit` passed.
- Task 7 IA invariants: exact five-item Action Center, separate Patient Experience group, no duplicate due/follow-up links, and referrals/setup preserved in appropriate groups.
- Task 7 commit: `b4606fca` (`refactor(sidebar): unify action center navigation`).
- Task 8 RED: seven expected dashboard source/link/retry gaps were reproduced.
- Task 8 GREEN: Action Required panel 9/9 passed.
- Task 8 typecheck: `pnpm exec tsc --noEmit` passed.
- Task 8 diff validation: `git diff --check` passed.
- Task 8 invariants: approval and receivable counts use Action Center summary; security rule cards keep the security source; every card opens a canonical filtered queue with touch-safe keyboard-accessible controls.
- Task 8 commit: `5d7ca0ea` (`fix(dashboard): deep link action cards to canonical queues`).
- Task 9 backend verification: Action Center + Approvals integration suites 101/101 passed.
- Task 9 frontend verification: shell, overview, routing, approvals, sidebar, and dashboard-action suites 99/99 passed.
- Task 9 compile/build gates: root TypeScript passed; full main, patient, and admin production bundles built successfully.
- Task 9 diff validation: `git diff --check` passed.
- Task 9 adversarial review fixes: canonical Approvals owns exactly one outer `DashboardLayout`; capability-false exception and collection cards display `Review only`.
- Phase 1 completion commit: `b1406a88` (`feat(action-center): complete shell and navigation phase`).
- Phase 1 integrated to `origin/main` at `95789b598c0063821e72c31871a5e5fce6f23dc2`; fresh merged-result verification passed backend 101/101, frontend 99/99, root TypeScript, full main/patient/admin build, and diff validation.
- Phase 2 Task 1 RED: migration contract failed 4/4 because the planned exception migration was absent.
- Phase 2 Task 1 GREEN: migration contract passed 4/4 with real SQLite constraints, uniqueness, foreign key, and index enforcement. Canonical-program review later moved the file from the initial `0424` reservation to `0500_admin_exception_cases.sql` and added composite tenant-FK plus JSON-validity enforcement.
- Phase 2 Task 1 manifest/typecheck: 434 migrations generated; root TypeScript and `git diff --check` passed.
- Phase 2 Task 1 commit: `9c55cee2` (`feat(exceptions): add persistent case schema`).
- Phase 2 Task 2 test-path correction: root Vitest only includes `test/**/*.test.ts`, so the detector contract moved to `test/action-center-exception-detectors.test.ts` before implementation.
- Phase 2 Task 2 RED: detector suite failed because the detector module was absent.
- Phase 2 Task 2 GREEN: detector suite 5/5 passed; root TypeScript and `git diff --check` passed.
- Phase 2 Task 2 invariants: stable fingerprints/source links, explicit tenant and `now` binds, zero-amount stale handovers retained, source timestamps preserved in metadata, duplicate observations collapsed, and query failures propagated.
- Phase 2 Task 2 commit: `ab53feee` (`feat(exceptions): normalize operational detectors`).
- Phase 2 Task 3 RED: synchronization and transition suites failed because `sync.ts` and `transitions.ts` were absent.
- Phase 2 Task 3 GREEN: synchronization/transition suites 12/12 passed; combined exception services 17/17 passed.
- Phase 2 Task 3 compile/diff: root TypeScript and `git diff --check` passed.
- Phase 2 Task 3 invariants: tenant-scoped observation upserts never overwrite lifecycle state; auto-resolve/reopen are policy-driven; dismissed fingerprints stay suppressed; every lifecycle update and event insert share one D1 batch with optimistic `updated_at` and `changes() = 1` guards.
- Phase 2 Task 3 commit: `261053b3` (`feat(exceptions): add sync and lifecycle engine`).
- Phase 2 Task 4 RED: exception API suite failed 8/8 because the subrouter was absent.
- Phase 2 Task 4 GREEN: exception API + Action Center summary integration passed 12/12; exception service regression remained 17/17 green.
- Phase 2 Task 4 compile/diff: root TypeScript and `git diff --check` passed.
- Phase 2 Task 4 invariants: role/tenant boundaries, SQL pagination before mapping, actor timeline names, 400/404/409 semantics, explicit sync, tenant-safe assignee validation, future-snooze exclusion, critical exception priority, and `persistentExceptions=true`.
- Phase 2 Task 4 commit: `e832fa76` (`feat(exceptions): expose actionable case APIs`).
- Phase 2 Task 5 RED: the page still used the legacy fraud-alert contract and the exception drawer did not exist.
- Phase 2 Task 5 GREEN: persistent exception queue and drawer suites 13/13 passed.
- Phase 2 Task 5 compile/content gates: root TypeScript, English/Bengali locale JSON parsing, and `git diff --check` passed.
- Phase 2 Task 5 invariants: URL-backed server filters, persistent counts, source links, accessible full-screen drawer, exact endpoint-specific mutation bodies, required resolution/dismissal/reopen evidence, query invalidation/refetch, 409 recovery, focus management, Escape close, and scroll lock.
- Phase 2 Task 5 commit: `b60c488b` (`feat(exceptions): add actionable exception workspace`).
- Phase 2 Task 6 RED: Action Required widget failed 7/7 because it still depended on `/api/dashboard/security-alerts` and short rule aliases; missing-discount-reference detector coverage also failed before implementation.
- Phase 2 Task 6 GREEN: widget 7/7, detector 5/5, summary/API integration 12/12, exception service/migration 21/21, and combined queue/drawer/widget frontend 20/20 passed.
- Phase 2 Task 6 invariants: one Action Center summary source, active `exceptions.byRule` counts, full canonical rule keys, persistent missing-discount-reference cases, no duplicate cash-handover subset card, and backward-compatible legacy dashboard endpoints left untouched outside the Action Center path.
- Phase 2 Task 6 compile/content gates: migration manifest generated 434 entries; root TypeScript, six English/Bengali locale JSON files, and `git diff --check` passed.
- Canonical compatibility review: production ledger row `448` is `0423_repair_clean_cash_handover_pending_approvals.sql`; isolated canonical branches currently carry unapplied `0423–0433` migrations. Action Center moved to `0500`, and the canonical block must be rebased/renumbered before integration rather than renaming the production-applied migration.
- Phase 2 Task 7 final verification: exception schema/service 21/21, API/summary integration 13/13, and queue/drawer/dashboard UI 20/20 passed; migration manifest, root TypeScript, full main/patient/admin production build, locale parsing, and diff validation passed.
- Final adversarial review RED: dashboard active counts deep-linked to exact `status=open`, producing empty queues for acknowledged/in-progress work; date-scoped discount observations were auto-resolvable, allowing a calendar boundary to falsely resolve unchanged records.
- Final adversarial review GREEN: added an explicit tenant-scoped `status=active` API/UI filter with future-snooze exclusion and changed high-discount/missing-reference observations to non-auto-resolving/non-recurring audit cases. Focused detector 5/5, API 13/13, widget 7/7, combined frontend 20/20, TypeScript, locale JSON, and all production builds passed.
- Phase 2 review commit: `ae3807ef` (`fix(action-center): align exceptions with canonical schema plan`).
- Production migration preflight: only `0500_admin_exception_cases.sql` was pending; target tables/indexes were absent; production identity and a pre-apply Time Travel bookmark were verified.
- Production migration result: D1 ledger row `449` applied `0500_admin_exception_cases.sql`; no migrations remain pending; both tables, four indexes, JSON constraints, and the composite tenant foreign key were verified; case/event row counts are `0/0`; a post-apply Time Travel bookmark was captured.
- Migration-operation boundary: no Worker deployment, exception synchronization, branch merge, or Git push was performed as part of the earlier schema-only operation.
- Phase 2 integration: verified feature HEAD `7cfda8829` was a direct descendant of `origin/main`; eight Phase 2 commits fast-forwarded `main` from `95789b598` to `7cfda8829` without force push or touching the dirty root checkout.
- Production deployment: `pnpm deploy:production` rebuilt all 434 migration-manifest entries and main/patient/admin bundles, uploaded the production schema manifest, uploaded the complete 759-file asset set, and deployed Worker version `b9c4cb2a-669a-4f80-8bbb-42bc7724b4bb` at 100% traffic.
- Unauthenticated production smoke: 12/12 checks passed against `https://hms.ozzyl.com`; root returned 200, invalid login returned 400, protected APIs returned 401, and no endpoint returned 500.
- Authenticated production smoke: hospital-admin API and browser checks passed with no recorded page errors or API 500s.
- Authenticated exception synchronization smoke: `demo-hospital` observed `1`, created `1`, updated `0`, and auto-resolved `0`; summary/list reported one open `cash.stale_handover` case. Direct D1 verification for tenant `100` confirmed exactly one open case and one immutable `created` event.
- Production boundary after smoke: no source handover, billing, or inventory record was changed; no recurring exception synchronization schedule was enabled. Protected tenant SPA routes continue to reject unauthenticated direct requests.
- Phase 3 canonical planning commit rebased onto current `origin/main` as `36bc06001`; baseline Action Center integration passed 4/4 and existing collections/navigation frontend suites passed 21/21.
- Phase 3 Task 1 RED: collection migration tests failed 5/5 because `0501_collection_cases.sql` was absent.
- Phase 3 Task 1 GREEN: collection migration tests passed 5/5 with real SQLite enforcement for dual legacy/canonical source identity, tenant-scoped partial uniqueness, integer minor-unit promises, explicit currency, UTC lifecycle fields, JSON-valid event metadata, composite tenant foreign key, and required queue/source/timeline indexes.
- Phase 3 Task 1 gates: migration manifest generated 435 conforming migrations; root TypeScript and `git diff --check` passed. No production migration was applied.
- Phase 3 Task 1 commit: `54208904` (`feat(collections): add canonical-ready workflow schema`).
- Phase 3 Task 2 RED: authority and adapter suites failed at import because the four service modules were absent.
- Phase 3 Task 2 GREEN: authority resolution passed 7/7 and legacy/canonical adapters passed 4/4; combined collection schema/authority/adapter regression passed 16/16.
- Phase 3 Task 2 invariants: missing canonical projections fail closed; disabled/missing flags remain legacy; legacy major-unit money converts once to safe integer minor units; canonical `net_due_minor` remains authoritative; mapped legacy identity is optional; patient/source queries are tenant-scoped; drafts are excluded and terminal states remain explicit.
- Phase 3 Task 2 gates: root TypeScript and `git diff --check` passed.
- Phase 3 Task 2 commit: `35a87fa6` (`feat(collections): add receivable authority adapters`).
- Phase 3 Task 3 initial RED: query suite failed at import because `query.ts` was absent.
- Phase 3 Task 3 SQL debugging: the first implementation reproduced SQLite's inability to reference the outer receivable alias inside the correlated subquery `ORDER BY`; direct tenant-scoped canonical/legacy case joins fixed the root cause and preserved canonical-case priority without duplicate rows.
- Phase 3 Task 3 currency RED: adversarial review proved that adding BDT and USD minor units into one flat total was invalid. The final contract groups authoritative amounts in `amountsByCurrency`; mixed-currency flat monetary fields are `null`, while single-currency responses retain flat values.
- Phase 3 Task 3 GREEN: full-dataset, pagination, filters, canonical mode, shadow mismatch, source-collision, and mixed-currency query tests passed 5/5; combined collection regression passed 21/21.
- Phase 3 Task 3 gates: root TypeScript and `git diff --check` passed. No migration, merge, push, or deployment occurred.
- Phase 3 Task 3 commit: `33ef1e56` (`feat(collections): add canonical-ready receivable query service`).
- Phase 3 Task 4 RED: transition and reconciliation suites failed at import because lifecycle modules were absent.
- Phase 3 Task 4 initial GREEN: transitions passed 8/8 and reconciliation passed 7/7 with real SQLite-backed D1 batches, live authority lookup, tenant-safe assignment, promise amount/currency validation, optimistic conflicts, terminal source events, shadow legacy precedence, and event-failure rollback.
- Phase 3 Task 4 cutover RED/GREEN: adversarial tests proved legacy-only cases were not receiving validated canonical invoice IDs during canonical transition or reconciliation. Both paths now enrich the same case with `canonical_invoice_public_id` while retaining the legacy ID; no duplicate workflow case is created.
- Phase 3 Task 4 final GREEN: transitions passed 9/9, reconciliation passed 7/7, and combined Task 1–4 collection regression passed 37/37.
- Phase 3 Task 4 gates: root TypeScript and `git diff --check` passed. Mutations use single-source adapter lookups rather than full-dataset scans. No production migration, merge, push, or deployment occurred.
- Phase 3 Task 5 API RED: collection list/detail/timeline/action routes returned 404 before the subrouter existed; canonical misconfiguration, source-key validation, and lifecycle status semantics were pinned before implementation.
- Phase 3 Task 5 API GREEN: collection routes passed 9/9 with URL validation, server pagination, structured source identity, authority metadata, tenant isolation, actor timeline, and 404/409/422/503 behavior.
- Phase 3 Task 5 legacy-total RED/GREEN: 105 seeded receivables proved the legacy admin endpoint calculated totals from its first 100 rows. The production admin composition wrapper now preserves a 100-row compatibility page while full-dataset totals, amount buckets, and aging counts cover all 105 invoices; focused tests passed 2/2.
- Phase 3 Task 5 summary integration: top-level Action Center uses `listCollectionCases` instead of a direct bill aggregate, exposes minor-unit/currency breakdowns, enables `persistentCollections`, and prioritizes due follow-ups. Summary tests use real SQLite authority paths and passed 4/4.
- Phase 3 Task 5 final gates: full integration passed 250/250 files and 6,067/6,067 tests; root TypeScript and `git diff --check` passed. No production migration, merge, push, or deployment occurred.
- Phase 3 Task 6 RED: focused frontend contracts reproduced the old client-derived dues page, missing detail drawer, non-canonical legacy routes, incorrect Collections breadcrumb, dashboard major-unit exposure, and an inert `/billing?collectBillId=` payment link.
- Phase 3 Task 6 workspace GREEN: the canonical Collections page now uses URL-backed server filters and pagination, API currency/minor-unit summaries, authority metadata, semantic desktop tables, mobile cards, and an explicit fail-closed 503 state. The drawer adds focus/scroll restoration, timeline, contact/follow-up/promise/dispute/escalation evidence, safe decimal-to-minor conversion, optimistic timestamps, pending-state disablement, and 409 recovery without `prompt()` or `confirm()`.
- Phase 3 Task 6 navigation GREEN: `/cash/dues` and `/cash/followups` preserve and merge query intent into canonical collection routes; the breadcrumb is scalar `Collections`; dashboard exposure uses `exposureMinor`; Billing Dashboard consumes the API-provided legacy payment link by opening the matching payment modal and removing the used query parameter.
- Phase 3 Task 6 final gates: focused frontend verification passed 6/6 files and 30/30 tests; web TypeScript passed; English and Bengali receivable locale JSON parsed successfully. No production migration, merge, push, or deployment occurred.
- Phase 3 Task 6 commit: `87f5034a` (`feat(collections): add canonical-ready operations workspace`).
- Phase 3 Task 7 final verification: migration/service suites passed 6/6 files and 37/37 tests; collection/summary/legacy integration suites passed 3/3 files and 16/16 tests; frontend collections/overview/navigation/dashboard/breadcrumb/drawer/payment suites passed 7/7 files and 35/35 tests.
- Phase 3 Task 7 full gates: migration manifest generated 435 conforming migrations; root TypeScript, all production builds, and `git diff --check` passed.
- Phase 3 Task 7 adversarial RED/GREEN: Action Center Overview no longer converts mixed-currency exposure into fake BDT `৳0.00`; it renders API currency-code totals or per-currency breakdowns and links to the active queue. The legacy due compatibility endpoint no longer masks database failures as `200` empty receivables; unexpected failures return `500`, while authority configuration failures remain `503`.
- Phase 3 canonical boundary: legacy mode may be released after controlled review/application of `0501`. Shadow and canonical flags remain disabled until the canonical foundation/invoice/payment/adjustment migrations are rebased, renumbered, deployed, backfilled, and reconciled. Canonical mode requires `credited_minor` and `net_due_minor`; code presence alone never authorizes cutover.
- Phase 3 release re-verification after fresh `origin/main` fetch/rebase passed services 37/37, integrations 16/16, frontend 35/35, 435-entry migration manifest, root TypeScript, full production builds, and diff validation.
- Phase 3 production migration: preflight found only `0501_collection_cases.sql` pending, target tables/indexes absent, production DB `c68a5360-a2c1-44cc-9e71-f21057bea102`, no `canonical_feature_flags` table, and captured pre-bookmark `00001d1e-00000000-000050a9-bc32c97ed30d26b596faed2655fdfbcc`. D1 ledger row `450` applied `0501`; no migrations remained; two tables, five indexes, UTC/amount/JSON constraints, and composite tenant foreign key were verified; post-bookmark `00001d1f-00000000-000050a9-89da3f6754ec2695434673b62a3df7cb` was captured.
- Phase 3 integration/deployment: eight reviewed commits fast-forwarded `origin/main` from `0053ba8f` to `0a3012e6` without force push. `pnpm run deploy:production` rebuilt all bundles, uploaded the 435-entry schema manifest and 758 production assets, and deployed Worker version `180cb73d-57f3-4cca-8f55-db3096f7c9d3`.
- Phase 3 production smoke: unauthenticated deploy smoke passed 12/12; the complete authenticated role/browser suite passed; a Collections-specific hospital-admin smoke verified Action Center summary, active queue, filtered summary, legacy compatibility API, and protected Collections page with no API 500 or page error. Temporary smoke-checker edits were reverted immediately.
- Phase 3 production boundary: direct D1 counts remain collection cases/events `0/0`; the canonical flag table remains absent, so all tenants stay in legacy receivable authority mode. No collection action, payment, promise, dispute, escalation, write-off, or source financial mutation was performed during release smoke.
- Phase 5 plan review corrected three blocking contract gaps before implementation: task mutations now require optimistic timestamps, review moderation events use a composite tenant foreign key with event-specific state semantics, and Phase 5 E2E no longer depends on the deferred Phase 4 write-off workflow. The migration also formalizes the compatibility columns already referenced by deployed moderation routes.
- Phase 5 Task 1 RED: migration contract failed 5/5 because `0503_action_tasks_review_moderation.sql` was absent.
- Phase 5 Task 1 GREEN: focused migration tests passed 5/5 and combined Action Center migrations `0500`, `0501`, and `0503` passed 14/14. Existing review rows survive the additive migration; task source uniqueness, lifecycle/UTC/JSON constraints, composite tenant event boundaries, structured moderation reasons, and required indexes are enforced by real SQLite.
- Phase 5 Task 1 adversarial RED/GREEN: an `approved` moderation event initially accepted a null old state. Event-type-specific checks now enforce pending-to-approved, pending-to-rejected, and state-preserving reply events; stale or semantically invalid history cannot be inserted.
- Phase 5 Task 1 gates: migration manifest generated 436 entries; root TypeScript and `git diff --check` passed. Commit `7e84604f` (`feat(action-center): add tasks and moderation audit schema`). No production migration, merge, push, or deployment occurred.
- Phase 5 Task 2 RED/GREEN: the missing task service module produced the expected RED; source deduplication, manual creation, assign/start/reschedule/complete/cancel transitions, required evidence, stale conflicts, tenant isolation, and atomic event rollback then passed 8/8.
- Phase 5 Task 2 adversarial RED/GREEN: completed source tasks initially lost canonical relink evidence, and same-millisecond writes could retain an unchanged optimistic timestamp. Passive sync now appends a state-preserving `source_relinked` event without reopening or erasing completion evidence, and every mutation advances `updated_at_utc` monotonically by at least one millisecond.
- Phase 5 Task 2 final gates: focused service tests passed 9/9; combined Task 1–2 migration/service tests passed 14/14; root TypeScript and `git diff --check` passed. Task completion/cancellation modifies only task/event tables and never mutates approval, exception, collection, invoice, payment, or adjustment sources. No production migration, merge, push, or deployment occurred.
- Phase 5 Task 3 RED/GREEN: the new integration suite initially failed 7/7 because `/action-center/tasks` did not exist, Action Center task counts/capability were placeholders, and `/api/admin/tasks` still generated synthetic due/refund/expense cards. Persistent query/detail/event APIs, lifecycle routes, summary counts, next-best-action, and the production admin compatibility wrapper then passed 7/7.
- Phase 5 Task 3 adversarial RED/GREEN: accountants could initially bypass the team restriction with `all`, `overdue`, or `completed`, access another assignee's detail/events/actions, create work for another user, and receive a forbidden team-overdue next-action link. Non-management access is now limited to `view=mine`, self-assigned creation, and owned tasks; summary links use `view=mine` only when that user's assigned work is overdue.
- Phase 5 Task 3 final gates: focused task API/summary tests passed 9/9; combined Action Center, collections, tasks, and admin compatibility integrations passed 25/25; Task 1–2 migration/service regressions passed 14/14; the production admin-wrapper unit suite passed 4/4; root TypeScript and `git diff --check` passed. Source status is read-only and legacy `/api/admin/tasks` no longer regenerates duplicate source cards. No production migration, merge, push, or deployment occurred.
- Phase 5 Task 4 RED/GREEN: exception assign/start and collection follow-up transitions now upsert one stable source-linked task; repeated actions deduplicate, follow-up dates and canonical identity metadata update in place, and completing a task alone never resolves its exception or changes financial source state. Paid sources complete linked tasks, cancelled/reversed sources cancel them, positive live dues remain unchanged, and already-closed collection reconciliation repairs missed task settlement.
- Phase 5 Task 4 adversarial RED/GREEN: cross-tenant exception assignee validation initially ran after the exception source mutation, and an exception already marked resolved could not repair a linked task left open by task-event failure. Tenant actor/assignee validation now runs before source mutation, while idempotent terminal retries settle the task from persisted source evidence. A route-boundary regression also proved authenticated collection detail reconciliation forwards actor evidence into linked-task completion.
- Phase 5 Task 4 final gates: source integration and task service suites passed 37/37; related Action Center route/admin compatibility integrations passed 27/27; root TypeScript and `git diff --check` passed. Migration `0503` remains unapplied to production, and no merge, push, or deployment occurred.
- Phase 5 Task 5 RED/GREEN: the legacy Tasks & Follow-ups page still consumed generated `/api/admin/tasks` cards and no persistent task drawer existed. The canonical Action Center workspace now consumes persistent list/detail/events/action APIs with management and ownership-safe views, URL-backed filters and pagination, semantic states, tenant-safe source links, and accessible loading/error/empty behavior.
- Phase 5 Task 5 action invariants: assign, start, reschedule, complete, and cancel send the detail timestamp as optimistic concurrency evidence; completion/cancellation require notes; pending writes disable controls; successful writes invalidate task and summary caches and refresh detail/timeline; `409` recovery resets stale mutation state before refetch. Adversarial review added nested-dialog focus entry and trigger-focus restoration.
- Phase 5 Task 5 final gates: focused task workspace suites passed 16/16; query-key regressions passed 5/5; web TypeScript, English/Bengali locale JSON parsing, and `git diff --check` passed. Migration `0503` remains unapplied to production, and no merge, push, or deployment occurred.
- Phase 5 Task 6 RED/GREEN: the structured moderation service and history endpoint were absent, rejection accepted no reason code, and stale second decisions returned success. Tenant-scoped conditional moderation and immutable event insertion now share one D1 batch; rejection uses schema-backed reason codes; provider replies are audited; actor-labelled, tenant-isolated history is exposed; and stale moderation returns `409`.
- Phase 5 Task 6 adversarial RED/GREEN: malformed JSON previously became an empty approval payload, reply events could record a stale pre-batch review state, non-text fields were coerced into strings, unsupported decisions were not rejected, and the existing prompt UI's legacy `{ reason }` payload would have broken before Task 7. Routes now fail malformed bodies closed, events select the live state, service validation requires real text and known decisions, legacy free text maps to structured `other` evidence, and compatibility datetime columns retain SQLite format alongside canonical UTC fields.
- Phase 5 Task 6 final gates: focused moderation service/routes passed 21/21; migration plus moderation regressions passed 26/26; root TypeScript and `git diff --check` passed. Migration `0503` remains unapplied to production, and no merge, push, or deployment occurred.
- Phase 5 Task 7 RED/GREEN: the prompt-driven moderation table had no full-review workspace, structured rejection form, audited timeline, semantic loading/error states, or stale-decision recovery. The canonical Patient Experience page now opens a full semantic drawer with reviewer, target, rating, publication state, complete review text, provider reply, structured reasons, optional moderation note, and actor-labelled history; approve/reject/reply actions no longer use browser prompts.
- Phase 5 Task 7 adversarial RED/GREEN: successful mutations initially left a stale selected review open, and nested action dialogs left the background drawer exposed to assistive technology. Success now closes the drawer before list refresh completes, and nested dialogs hide the background drawer while preserving focus entry, trapping, Escape handling, and trigger-focus return.
- Phase 5 Task 7 final gates: focused page/drawer suites passed 13/13; the canonical route/legacy redirect matrix brought the focused UI total to 17/17; English/Bengali locale parsing, the production web build, and `git diff --check` passed. Migration `0503` remains unapplied to production, and no merge, push, or deployment occurred.
- Phase 5 Task 8 regression matrix: migration/task/moderation suites passed 24/24, Action Center/approval integration routes passed 126/126, task/review frontend suites passed 29/29, and Playwright runner config regressions passed 3/3. A representative pre-existing portal E2E also passed after the shared helper moved from obsolete localStorage auth to the current in-memory login flow.
- Phase 5 Task 8 E2E: the exact approved command collected eight scenarios and passed seven without retries. Canonical/legacy routes, exception resolution, collection contact/promise, task assignment/completion, structured review rejection, responsive/keyboard behavior, and Back-filter restoration passed. The receivable write-off request/approval scenario is explicitly collected but skipped because Phase 4 authority remains intentionally gated; no financial workflow was simulated.
- Phase 5 Task 8 accessibility/responsive evidence: 375px, 768px, 1024px, and 1440px widths passed with reduced motion, keyboard drawer/dialog operation, focus entry/return, 44px action targets, non-colour status text, and no page-level horizontal overflow.
- Phase 5 Task 8 adversarial fixes: the dedicated Playwright project uses a local-only production preview lifecycle, derives custom host/port overrides, starts from either spec-path or project invocation, rejects remote server URLs, blocks third-party fonts/analytics for deterministic local rendering, and leaves generated reports outside the intended commit.
- Phase 5 Task 8 final gates: migration manifest generation, root TypeScript, the full multi-app production build, and `git diff --check` passed. Final implementation commit is `cc92e4b45` (`feat(action-center): complete tasks and moderation phase`).
- Phase 5 final code review found one High authorization issue: authenticated non-admin tenant roles could reach review moderation while central route RBAC was configured off. Regression testing reproduced the unsafe `200`, then route-level `hospital_admin` enforcement fixed it; `test/marketplace-reviews.test.ts` passed 12/12. Review fix commit: `7e7a554fc`.
- Phase 5 integration: current `origin/main`, the two preserved local reception doctor-waiver commits, and the reviewed Phase 5 branch were merged without conflicts. Local `main` integration commit: `089269293` (`merge(action-center): integrate tasks and moderation phase`). On the merged tree, backend suites passed 36/36, integration routes 126/126, frontend suites 29/29, Playwright runner config 3/3, Action Center E2E 7 passed with the Phase 4 write-off scenario intentionally skipped, root TypeScript passed, and the full multi-app production build passed.
- Phase 5 production migration: preflight confirmed `0503_action_tasks_review_moderation.sql` was the only pending migration, target tables/indexes were absent, and `provider_reviews` had no colliding out-of-band columns. Wrangler applied all 21 migration commands successfully on 2026-07-15. Post-check reported no pending migrations and confirmed `admin_action_tasks`, `admin_action_task_events`, `provider_review_moderation_events`, both unique indexes, and all moderation/reply columns in production D1.
- No remote push or Worker deployment occurred as part of this integration; Phase 4 write-off remains gated and production financial authority remains legacy-only.

## Decisions

- Use one canonical Action Center shell while keeping domain-owned sources of truth.
- Preserve the current audited approval engine.
- Legacy routes remain replace redirects.
- Persistent exception, collection, and task lifecycles are introduced only in their designated phases.
- Collections resolve tenant financial authority through `legacy`, `shadow`, or `canonical` adapters; workflow cases never own invoice/payment balances.
- New Action Center money fields use integer minor units and explicit currency. Legacy major-unit values are converted only inside the legacy authority adapter.
- Collection cases support both `legacy_bill_id` and `canonical_invoice_public_id` so canonical cutover does not require replacing the workflow system.
- Shadow mode serves legacy balances and records comparison diagnostics; it never blends or substitutes canonical values.
- Receivable write-off executes through authority-aware legacy/canonical credit-note and accounting/outbox commands; no direct unlogged balance edit.
- A filename already recorded in the production D1 migration ledger is immutable history; `0423_repair_clean_cash_handover_pending_approvals.sql` will not be renamed or replaced.
- The isolated canonical program's current `0423–0433` migration block must be rebased and renumbered before integration with production history.
- Action Center operational exception tables use migration `0500`; follow-on Action Center phases reserve `0501–0503`, leaving `0423–0499` available for canonical migration coordination.
- `admin_exception_cases` manages operational acknowledgement and resolution. `canonical_processing_issues` remains the authority for canonical migration, backfill, reconciliation, and outbox processing issues; neither table replaces the other.

## Current Resume Instructions

1. Phase 5 Tasks 1–8 are integrated into local `main` at `089269293`; production migration `0503` is applied and verified.
2. Keep task state independent from approval, exception, collection, invoice, payment, and adjustment authority. Completing a task must not mutate or resolve its source.
3. Production financial authority remains legacy-only. Do not enable shadow/canonical flags, and do not start Phase 4 write-off until the canonical program is complete and reconciled.
4. Keep `.ai-bridge` continuity files uncommitted unless the owner explicitly asks to persist them in Git.
5. A future release step may push/deploy the reviewed local `main`, but no push or Worker deployment occurred during this integration.
