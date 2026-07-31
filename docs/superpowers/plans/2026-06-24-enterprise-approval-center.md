# Enterprise Approval Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current Pending Approvals page into a design-system-aligned enterprise Approval Center for pending, approved, rejected, history, cash handover, and full request details.

**Architecture:** Keep the current route and approval API as the source of truth. Add frontend normalization helpers so old approval rows and richer new rows render consistently, then incrementally enrich the UI shell, table, drawer, and tests. Backend API changes are limited to safe list-query/status/type support and cash-handover inclusion if missing.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Hono, Cloudflare D1, existing HMS design-system classes and CSS variables.

---

## File structure

- Modify `web/src/pages/admin/PendingApprovals.tsx`: page shell, status tabs, filters, normalized mapping, richer table, design-system styling.
- Modify `web/src/components/admin/ApprovalDetailDrawer.tsx`: full details, timeline, before/after diff, cash handover fields, read-only history mode.
- Modify `web/src/pages/admin/PendingApprovals.test.tsx`: focused frontend regression tests for design-system labels, status views, drawer details, historical read-only mode.
- Modify `src/routes/tenant/approvals.ts`: only if current endpoint does not support status/type/history/cash-handover requirements.
- Modify `test/integration/routes/approvals.test.ts`: API regression tests if backend list behavior changes.

## Task 1: Frontend normalization helpers

**Files:**
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Test: `web/src/pages/admin/PendingApprovals.test.tsx`

- [ ] Add a failing test that legacy nested amounts from `request_data.oldValue.totalAmount`, cash handover amounts, and readable references render in the table.
- [ ] Run `pnpm --filter web test src/pages/admin/PendingApprovals.test.tsx` and confirm the new test fails for the missing behavior.
- [ ] Add helpers in `PendingApprovals.tsx`: `asRecord`, `firstFiniteNumber`, `getApprovalAmount`, `getApprovalReference`, `getApprovalContext`, and type normalization for `bill_cancel`, `cash_handover`, and `cash_closing`.
- [ ] Run the focused test and confirm it passes.
- [ ] Commit with `fix: normalize approval center rows`.

## Task 2: Enterprise status views and filters

**Files:**
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Test: `web/src/pages/admin/PendingApprovals.test.tsx`

- [ ] Add failing tests for status tabs: Pending uses `status=pending`, Approved uses `status=approved`, Rejected uses `status=rejected`, All History uses `status=all`.
- [ ] Add failing tests for human-readable type tabs including Cash Handover.
- [ ] Implement `StatusView` state, status tab buttons, query URL derivation, and reset of selected rows when the status view changes.
- [ ] Add a compact design-system filter bar with search input, high-risk toggle, stale toggle, and clear filters.
- [ ] Run focused tests and commit with `feat: add approval center status filters`.

## Task 3: Rich approval table UI

**Files:**
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Test: `web/src/pages/admin/PendingApprovals.test.tsx`

- [ ] Add failing tests that the table shows reference/context, amount/variance label, age/status, and hides bulk checkbox for historical rows.
- [ ] Replace ad-hoc table styling with HMS design-system classes: `card`, `btn-primary`, `btn-secondary`, CSS variables for surfaces/text/borders.
- [ ] Add columns: reference/context, amount or variance, submitted, status, risk.
- [ ] Ensure bulk actions only appear for pending rows.
- [ ] Run focused tests and commit with `feat: enrich approval center table`.

## Task 4: Rich detail drawer

**Files:**
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Test: `web/src/pages/admin/PendingApprovals.test.tsx`

- [ ] Add failing tests that clicking a request shows reason, invoice/reference, old/new values, cash handover expected/counted/variance, timeline, and read-only historical state.
- [ ] Extend the drawer approval shape with `context`, `requestData`, `oldValue`, `newValue`, `timeline`, and `isActionable`.
- [ ] Render sections: request summary, financial/cash context, billing/patient context, before/after values, reason, timeline, attachments, and actions.
- [ ] Only show approve/reject buttons when `status === 'pending'`.
- [ ] Run focused tests and commit with `feat: add rich approval detail drawer`.

## Task 5: Backend list support check

**Files:**
- Modify: `src/routes/tenant/approvals.ts` only if required.
- Test: `test/integration/routes/approvals.test.ts` only if required.

- [ ] Inspect current `/api/approvals` route for `status`, `type`, pagination, and safe JSON parsing support.
- [ ] If cash handover approval rows are not already represented in `approval_requests`, add a failing route test for cash handover inclusion or document that the existing upstream approval request creation already covers it.
- [ ] Implement the smallest backend change needed: status `all`, type filter, or cash handover row mapping.
- [ ] Run `pnpm vitest run test/integration/routes/approvals.test.ts` if backend is touched.
- [ ] Commit backend changes with `feat: expand approval list history support`.

## Task 6: Final verification and integration

**Files:**
- All touched files.

- [ ] Run `pnpm --filter web test src/pages/admin/PendingApprovals.test.tsx`.
- [ ] Run backend approval tests if backend changed.
- [ ] Run `pnpm --filter web build`.
- [ ] Check `git status` and `git log --oneline -5`.
- [ ] Merge into main integration worktree only after tests pass.
- [ ] Re-run focused tests/build on main.

## Self-review

- Spec coverage: pending/approved/rejected/history, cash handover, detail drawer, status/type filters, design-system styling, and testing are covered.
- Placeholder scan: no TBD/TODO placeholders remain.
- Scope control: custom workflow builder and broad upstream module rewrites remain out of scope.
