# Executive Dashboard Due Control Progress

**Updated:** 2026-07-23
**Branch:** `feat/executive-dashboard-due-control-20260723`
**Base:** `main` at `16175df7538572744ae556a9072fbcd5dafe7f13`

## Completed checkpoints

- [x] Research and repository contract review.
- [x] Design specification created:
  - `docs/superpowers/specs/2026-07-23-executive-dashboard-due-control-design.md`
- [x] TDD implementation plan created:
  - `docs/superpowers/plans/2026-07-23-executive-dashboard-due-control.md`
- [x] Shared panel test contract created:
  - `web/src/components/dashboard/ExecutiveDuePanel.test.tsx`
- [x] Shared read-only live receivable panel implemented:
  - `web/src/components/dashboard/ExecutiveDuePanel.tsx`
- [x] Panel uses the canonical Action Center collection list contract:
  - `status=active`
  - `sort=exposure`
  - server page size `8`
  - full-dataset summary remains separate from visible rows
- [x] Null and multi-currency totals do not render a false BDT zero.
- [x] Authority-unavailable errors do not silently fall back.
- [x] Direct write-off execution is not exposed.
- [x] Hospital Admin dashboard placement and focused test added.
- [x] Managing Director dashboard placement and focused refresh/ordering test added.
- [x] Director dashboard placement and focused refresh/ordering test added.
- [x] MD and Director refresh actions invalidate the shared Action Center collections query family.
- [x] Summary and preview table have separate accessible regions/contracts; the preview remains horizontally scrollable on narrow screens.

## Current implementation status

### Hospital Admin

**Implemented and verified.**

Placement:

1. KPI summary
2. Pending requests
3. Outstanding Dues & Collection Control
4. IPD billing overview
5. Lower operational charts

### MD

**Implemented and verified.**

Placement:

1. Executive cash-control KPIs
2. Outstanding Dues & Collection Control
3. Period-aware IPD billing overview and pending requests
4. Lower accounting and operational content

The panel uses the shared Action Center collection authority. The legacy `finance.patientDue` dashboard value is not used as the panel source. Existing selected-period KPI and IPD query behaviour remains unchanged.

### Director

**Implemented and verified.**

Placement:

1. Executive cash-control KPIs
2. Outstanding Dues & Collection Control
3. Period-aware IPD billing overview and pending requests
4. Ownership, shareholder, and profit accounting sections

The ownership, shareholder, distribution, and accounting sections remain intact.

### Controlled write-off

**Phase 4 Tasks 1–5 implemented and locally verified.** The dashboard remains read-only. The active implementation authority remains:

- `docs/superpowers/plans/2026-07-14-unified-action-center-phase-4-write-off.md`

Completed:

- `0526_receivable_write_off_approval.sql` expands the current approval type CHECK without dropping execution-lock or two-person approval columns.
- The original `0502` reservation was superseded because current migration `0516` makes a lower-order rebuild unsafe across fresh and filename-tracked upgraded databases.
- `approvalTypeSchema` accepts `receivable_write_off`.
- Write-off approval review requires an explanatory approval note.
- Schema governance records the exact table rebuild approval.
- `ReceivableAdjustmentAuthority` validates positive safe integer minor units, currency, tenant-scoped invoice identity, and legacy/canonical source mapping before mutation.
- Legacy mode creates an approved zero-cash credit note, guarded bill projection update, accounting event, income reversal evidence, and audit evidence in one batch.
- Legacy adjustment blocks terminal invoices, over-due amounts, paid performer payouts, stale concurrent balances, closed accounting periods, and cross-tenant sources.
- Canonical mode uses the existing immutable credit-note command, guarded `credited_minor`/`net_due_minor` projection, source mapping, idempotency, and outbox evidence without mutating legacy invoices.
- Shadow mode keeps the legacy result authoritative, records canonical evidence when possible, and records a non-PHI processing issue when shadow evidence fails.
- Completed idempotency replays return the original result; failed attempts may reacquire the same request safely after the blocker is removed; changed payloads with the same key are rejected.
- The existing item-return/cash-refund credit-note route remains unchanged because its semantics are different from a zero-cash receivable adjustment.
- Controlled request creation validates requester, reason, explanatory note, evidence URLs, live currency, and amount against the current authoritative due.
- Request creation lazily creates or reuses the collection case and atomically creates the pending approval, approval event, `write_off_requested` collection transition, and collection event.
- `request_data` stores the live authority mode, full stable source mapping, live due at request, source evidence, and the previous collection state needed for later rejection restoration; no client-supplied due is accepted.
- Canonical authority can resolve a legacy-only stable bill reference through the canonical source mapping before persisting the request source.
- Duplicate pending requests, terminal receivables, cross-tenant sources, stale collection state, and partial event-trail writes fail without leaving inconsistent workflow rows.
- Generic approval creation rejects `receivable_write_off`, so callers cannot bypass the Action Center collection request service.
- Two distinct authorised approvers are required; requester self-review is rejected before any execution attempt.
- Final approval conditionally acquires the execution lock and applies the exact approved amount through `ReceivableAdjustmentAuthority` using `receivable-write-off:<approvalId>`.
- Live authority mode, source mapping, due, currency, and terminal state are revalidated at execution; approved amounts are never silently reduced.
- Full execution closes the case; partial execution returns it to `contact_due`; approval and collection events link the approval, source, adjustment, previous/new due, currency, and authority mode.
- Failed execution remains retryable; successful and recovered requests replay stored/idempotent evidence without duplicate financial or collection events.
- Rejection restores the prior actionable collection state or closes the case when the source has become terminal, and creates no financial mutation.
- Route-level integration uses the real SQLite D1 harness to verify first approval, final execution, failure retry, successful replay, rejection, and generic-create bypass prevention.
- The Action Center collection detail returns a server-resolved write-off request capability and exposes a permission-protected request endpoint; the client never chooses financial authority.
- Receivable permissions separate collection visibility/follow-up, write-off request, write-off approval, and audit authority. Manager/accountant may request by default; MD/director may approve; tenant/user overrides remain server-authoritative.
- The collection drawer defaults the amount from the live due, displays the API currency, validates reason/note/evidence, requires recovery acknowledgement, retains values after errors, and exposes no direct `Write off now` action.
- The approval queue maps minor-unit write-off evidence without currency assumptions and blocks quick approval. The review drawer shows source, live due, authority mode, evidence links, two-person safeguards, and idempotent execution recovery guidance.
- Approved-but-failed write-offs are retryable only for a non-requester reviewer who still has `receivables.write_off.approve`; manager/accountant generic approval access does not grant this financial permission.

The user-facing write-off surface creates a controlled approval request only. It cannot directly mutate the receivable or bypass the two-person execution service.

## Read-only panel verification

Verified contracts:

- [x] List request is `/api/action-center/collections?status=active&sort=exposure&page=<page>&limit=8`.
- [x] Summary totals are supplied by the full result set and are not recomputed from the visible page.
- [x] Patient, mobile, invoice, issued date, due, age, status, promise/follow-up, and row currency are visible.
- [x] Multiple currencies render separately without a false combined total.
- [x] A `503` authority failure produces an explicit unavailable state with retry and no fallback zero.
- [x] Generic errors never render as zero due.
- [x] `View all dues` targets `/h/:slug/action/collections?status=active&sort=exposure`.
- [x] No direct due mutation or `Write off now` action is exposed.
- [x] Semantic table, accessible controls, minimum touch targets, and horizontal mobile overflow are covered.

## Verification results

Fresh worktree setup required the documented generated migration manifest:

```bash
pnpm build:migrations
```

Result: PASS — 460 conforming migrations generated locally; generated artifacts remain outside this feature checkpoint.

Required focused suite:

```bash
pnpm --dir web exec vitest run src/components/dashboard/ExecutiveDuePanel.test.tsx src/pages/admin/Dashboard.test.tsx src/pages/MDDashboard.test.tsx
```

Result: PASS — 3 test files, 36 tests.

Director focused suites:

```bash
pnpm --dir web exec vitest run src/pages/DirectorDashboard.test.tsx src/pages/DirectorDashboard.render.test.tsx
```

Result: PASS — 2 test files, 4 tests.

TypeScript:

```bash
pnpm exec tsc --noEmit
```

Result: PASS — zero TypeScript errors.

Production web build:

```bash
pnpm --dir web build
```

Result: PASS — Vite production build and PWA generation completed.

Diff validation:

```bash
git diff --check
```

Result: PASS — no whitespace errors.

### Phase 4 Task 1 verification

```bash
pnpm exec vitest run test/migrations/receivable-write-off-approval.test.ts
pnpm build:migrations
pnpm exec tsc --noEmit
```

Results:

- Migration/schema contract: PASS — 1 file, 4 tests.
- Existing approval integration regression: PASS — 1 file, 121 tests.
- Migration manifest and schema governance: PASS — 461 conforming migrations.
- TypeScript: PASS — zero errors.

### Phase 4 Task 2 verification

```bash
pnpm exec vitest run test/billing/receivable-adjustment-authority.test.ts test/billing/legacy-credit-note.test.ts test/billing/canonical-credit-note.test.ts test/canonical/adjustment-lifecycle.test.ts
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/credit-notes.test.ts test/integration/routes/credit-notes-accounting.test.ts
pnpm exec tsc --noEmit
```

Results:

- Receivable authority, legacy, canonical, and canonical adjustment lifecycle: PASS — 4 files, 33 tests.
- Existing credit-note route and accounting regressions: PASS — 2 files, 15 tests.
- TypeScript: PASS — zero errors.

### Phase 4 Task 3 verification

```bash
pnpm exec vitest run test/action-center/collections/authority.test.ts test/action-center/collections/adapters.test.ts test/action-center/collections/query.test.ts test/action-center/collections/transitions.test.ts test/action-center/collections/reconcile.test.ts test/action-center/collections/write-off.test.ts test/billing/receivable-adjustment-authority.test.ts
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts
pnpm exec tsc --noEmit
```

Results:

- Collection authority, adapters, query, transitions, reconciliation, write-off request service, and canonical mode-switch authority compatibility: PASS — 7 files, 47 tests.
- Existing approval integration regression: PASS — 1 file, 121 tests.
- TypeScript: PASS — zero errors.

### Phase 4 Task 4 verification

```bash
pnpm exec vitest run test/action-center/collections/write-off.test.ts test/action-center/collections/write-off-execution.test.ts test/billing/receivable-adjustment-authority.test.ts test/billing/legacy-credit-note.test.ts test/billing/canonical-credit-note.test.ts test/canonical/adjustment-lifecycle.test.ts
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts
pnpm exec tsc --noEmit
```

Results:

- Write-off request, execution/rejection, receivable authority, legacy/canonical adapters, and canonical adjustment lifecycle: PASS — 6 files, 48 tests.
- Approval route integration including controlled two-person execution, failed retry, successful replay, rejection, and generic-create bypass prevention: PASS — 1 file, 125 tests.
- TypeScript: PASS — zero errors.

### Phase 4 Task 5 verification

```bash
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center-collections.test.ts test/integration/routes/approvals.test.ts
pnpm --dir web exec vitest run src/components/action-center/CollectionDetailDrawer.test.tsx src/pages/admin/PendingApprovals.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx
pnpm exec vitest run test/authz.test.ts
pnpm exec tsc --noEmit
pnpm --dir web build
```

Results:

- Action Center request/capability and approval permission/retry integration: PASS — 2 files, 140 tests.
- Collection request UI, approval queue, and approval evidence/recovery UI: PASS — 3 files, 82 tests.
- Receivable permission matrix: PASS — 1 file, 9 tests.
- TypeScript: PASS — zero errors.
- Production web build: PASS — Vite production build and PWA generation completed.

### Phase 4 Task 6 verification

```bash
pnpm exec vitest run test/migrations/receivable-write-off-approval.test.ts test/billing/receivable-adjustment-authority.test.ts test/billing/legacy-credit-note.test.ts test/billing/canonical-credit-note.test.ts test/action-center/collections/write-off.test.ts test/action-center/collections/write-off-execution.test.ts
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/approvals.test.ts test/integration/routes/action-center-collections.test.ts
pnpm --dir web exec vitest run src/components/action-center/CollectionDetailDrawer.test.tsx src/pages/admin/PendingApprovals.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Results:

- Migration, request/execution, and legacy/canonical receivable adjustment services: PASS — 6 files, 35 tests.
- Approval and Action Center integration: PASS — 2 files, 140 tests.
- Collection request and approval review frontend: PASS — 3 files, 82 tests.
- Migration manifest and schema governance: PASS — 461 conforming migrations.
- TypeScript: PASS — zero errors.
- Full root production build: PASS — main web/PWA, patient/lifestyle, and admin applications completed.
- Diff validation: PASS — no whitespace errors.

The Task 6 adversarial financial review covered concurrent balance changes, conditional execution locking, request/execution idempotency, authority-mode and source-mapping drift, exact minor-unit amounts, currency mismatch blocking, accounting and canonical outbox evidence, terminal receivable states, closed accounting periods, paid performer safeguards, tenant isolation, requester/approver separation, rejection restoration, and linked audit evidence.

Schema governance initially blocked the intentional legacy `bills` projection update. An exact `src/services/billing/receivableAdjustment/legacyCreditNote.ts` → `bills` allowance now records billing-platform ownership, P05 removal, and the legacy-authority-only purpose.

### Post-completion branch review

A second branch-level adversarial review identified and fixed three integration defects before release review:

- Collection list/detail/events and follow-up actions now enforce `receivables.view` and `receivables.followup.manage` through tenant/user permission overrides. The composite Action Center summary also requires receivable visibility because it exposes collection amounts and follow-up counts.
- Financial idempotency no longer includes the executing reviewer identity. The same approved financial request can therefore be safely finalized or retried by a different authorised non-requester without changing the deterministic execution identity or duplicating money.
- Failed execution summary and KPI routing now include both pending and approved failures. The recovery queue uses `status=all&executionStatus=failed`, so approved write-off failures remain discoverable and retryable; clearing the KPI returns to the pending queue.

Fresh post-review verification:

- Write-off migration, request/execution, and legacy/canonical authority services: PASS — 6 files, 35 tests.
- Approval and Action Center route integration, including permission overrides and cross-reviewer retry: PASS — 2 files, 141 tests.
- Collection request and approval recovery frontend: PASS — 3 files, 83 tests.
- Receivable permission matrix: PASS — 1 file, 9 tests.
- Migration manifest/schema governance: PASS — 461 conforming migrations.
- TypeScript and full root production build: PASS.

### Canonical legacy-retirement readiness

The controlled receivable write-off boundary now has local canonical-only readiness for the period after legacy receivable tables are retired:

- Canonical collection reads no longer require the legacy `patients` table. Patient name/mobile remain optional tenant-scoped enrichment while the table exists; canonical invoice identity, patient reference, amounts, status, and timestamps remain authoritative without it.
- Canonical credit-note compensation safety checks canonical settled accruals first. Legacy performer-reserve and doctor-accrual checks remain active for every mapped legacy bill while those tables exist, but their absence no longer breaks a pure canonical command.
- Multiple legacy source mappings are checked collectively; a paid reserve on any mapped bill blocks the canonical credit adjustment, and malformed active bill mappings fail closed while legacy compensation tables remain present.
- Canonical reads and reconciliation remain available from the invoice projection. Write-off request and execution use a separate operation-specific preflight and fail closed unless every required table and column exists for canonical invoice updates, mutation idempotency, source mappings, outbox, credit-note header/line authority, compensation settlement checks, and accounting-period guards.
- A pure canonical write-off was verified after removing legacy `patients`, `bills`, `billing_credit_notes`, `income`, performer-reserve, and doctor-accrual tables. The approved amount reduced canonical `net_due_minor`, created canonical credit-note header/line authority, emitted a canonical outbox event, linked the approval through `canonical_source_mappings`, and finalized the collection case.
- A write-off requested against a legacy bill before cutover was verified after switching to canonical authority and removing the legacy receivable tables. The retained invoice source mapping routed the approved request to the canonical invoice without duplicating money.
- Canonical detail remains readable when adjustment command schema is incomplete, but the UI capability is `unavailable` and the request endpoint returns a fail-closed 503 with exact missing requirements.

Fresh canonical readiness verification:

- Focused authority, adapter, query, reconciliation, adjustment, request, and execution regressions: PASS — 7 files, 49 tests.
- Approval and Action Center HTTP integration: PASS — 2 files, 142 tests.
- Full canonical program suite: PASS — 99 files, 715 tests.
- TypeScript: PASS — zero errors.
- Migration manifest/schema governance: PASS — 461 conforming migrations.
- Full root production build: PASS — main web/PWA, patient/lifestyle, and admin applications completed.

This checkpoint proves the write-off boundary can operate without the retired legacy receivable tables. It does **not** authorize global legacy retirement or a production canonical-only flag. Production cutover still requires the current canonical program's backfills, reconciliation evidence, strict/canonical flag authorization, observation windows, rollback evidence, and tenant-specific production approval.

## Safety and release boundary

- No production migration was applied.
- No production deploy was performed.
- No merge to `main` was performed.
- No branch push was performed.
- No direct receivable balance mutation was added; approved execution delegates exclusively to `ReceivableAdjustmentAuthority`.
- The user-facing write-off endpoint and form create only a controlled approval request; they do not execute or mutate the receivable.
- Approval execution is available only after two distinct server-side decisions by users with the dedicated approval permission.
- Discharge with Due remains separate from write-off.
- Requester-versus-approver separation is enforced in both the route and execution service.
- Legacy-mode release is only a review candidate after the existing credit-note and accounting candidate checks; this checkpoint is not production authorization.
- Canonical write-off execution is locally legacy-retirement-ready at this boundary, but canonical and shadow modes remain disabled in production until the broader canonical foundation, invoice/payment/adjustment commands, backfills, reconciliations, observation evidence, rollback evidence, and tenant-specific authorization are production-verified.

## Status

**PHASE 4 COMPLETE — LEGACY AND CANONICAL WRITE-OFF BOUNDARIES VERIFIED LOCALLY**

The executive read-only due panel and controlled receivable write-off Tasks 1–6, including permission hardening, retry-idempotency, recovery visibility, and canonical legacy-retirement readiness, are implemented, documented, and locally verified. The branch is ready for review only; no production migration, deployment, merge, push, canonical-only activation, or legacy retirement has been performed.
