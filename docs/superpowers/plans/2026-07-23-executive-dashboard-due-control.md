# Executive Dashboard Due Control Implementation Plan

> **Execution mode:** TDD, one safe checkpoint at a time. Do not merge, push `main`, migrate production, or deploy without separate authorization.

**Goal:** Add a shared, traceable, server-paginated outstanding-due panel to the Hospital Admin, MD, and Director dashboards, then connect it to the controlled receivable write-off workflow without creating a second financial authority.

**Design:** `docs/superpowers/specs/2026-07-23-executive-dashboard-due-control-design.md`

**Branch:** `feat/executive-dashboard-due-control-20260723`

**Dependencies:**

- Unified Action Center Phase 3 collections is integrated.
- `GET /api/action-center/collections` supports status, ageing, sorting, and server pagination.
- Existing collection frontend DTOs and query keys are reusable.
- Controlled write-off Phase 4 remains the authority for all write-off execution.

## Global constraints

- Preserve existing dirty work; do not overwrite unrelated changes.
- Use the active collection authority. No dashboard-only due SQL.
- Default list is all active open dues, sorted by exposure, eight rows per page.
- Summary is full-dataset and never recomputed from the visible page.
- Due is a live snapshot; do not falsely label it as a historical selected-period balance.
- Multi-currency amounts are never added into one false total.
- Dashboard cannot directly mutate receivable balances.
- Discharge with Due remains separate from write-off.
- Write-off requester and final approver must be different users.
- Every financial execution is idempotent, tenant-scoped, server-revalidated, and audited.
- Production releases must follow the canonical-shadow safety runbook.

---

## Task 1 — Shared due panel test contract

**Files:**

- Create: `web/src/components/dashboard/ExecutiveDuePanel.test.tsx`

### Required test cases

- [ ] Requests `/api/action-center/collections?status=active&sort=exposure&page=1&limit=8`.
- [ ] Uses `queryKeys.actionCenter.collections.list(...)`.
- [ ] Renders full-dataset total due and invoice count.
- [ ] Renders ageing amount/count buckets.
- [ ] Renders promised amount, disputed amount, and follow-up-due count.
- [ ] Renders eight-row preview independently of summary totals.
- [ ] Next/previous controls request server pages and do not locally slice data.
- [ ] Renders patient, contact, invoice, issued date, due, age, collection status, promise/follow-up.
- [ ] Renders row currency.
- [ ] Handles multiple currencies without a false combined total.
- [ ] Shows shadow mismatch warning only when non-zero.
- [ ] Shows loading, empty, generic API error, authority-unavailable error, and retry.
- [ ] Links `View all dues` to canonical Action Center collections with `status=active&sort=exposure`.
- [ ] Does not expose direct write-off execution.
- [ ] Write-off request control is capability-gated.
- [ ] Meets keyboard, semantic table, focus, and touch-target requirements.

### RED command

```bash
pnpm --dir web exec vitest run src/components/dashboard/ExecutiveDuePanel.test.tsx
```

### Commit

```bash
git add web/src/components/dashboard/ExecutiveDuePanel.test.tsx
git commit -m "test(dashboard): define executive due panel contract"
```

---

## Task 2 — Implement shared read-only due panel

**Files:**

- Create: `web/src/components/dashboard/ExecutiveDuePanel.tsx`
- Optional create: `web/src/components/dashboard/executiveDuePanel.ts`
- Modify locale files only when existing dashboard/action-center keys cannot be reused.

### Implementation requirements

- [ ] Props:

```ts
interface ExecutiveDuePanelProps {
  role: 'hospital_admin' | 'md' | 'director';
  basePath: string;
  queryKeyScope: 'admin' | 'md' | 'director';
}
```

- [ ] Query filters are stable objects containing `status`, `sort`, `page`, and `limit`.
- [ ] Use `CollectionListResponse` from `collectionTypes.ts`.
- [ ] Use `formatCurrency` with row/summary currency codes.
- [ ] Display `Live outstanding` and refresh timestamp.
- [ ] Keep layout stable during loading.
- [ ] Treat query error as unavailable, not zero.
- [ ] Query pages from the server.
- [ ] Reuse collection status labels/visual language.
- [ ] Deep-link to Action Center rather than duplicating its full drawer workflow in this task.
- [ ] No write-off mutation.

### GREEN commands

```bash
pnpm --dir web exec vitest run src/components/dashboard/ExecutiveDuePanel.test.tsx
pnpm exec tsc --noEmit
```

### Commit

```bash
git add web/src/components/dashboard/ExecutiveDuePanel.tsx web/src/components/dashboard/executiveDuePanel.ts web/public/locales
git commit -m "feat(dashboard): add shared executive due panel"
```

---

## Task 3 — Place panel on Hospital Admin dashboard

**Files:**

- Modify: `web/src/pages/admin/Dashboard.tsx`
- Create or modify: Admin dashboard focused test

### Requirements

- [ ] Build tenant base path from the current slug.
- [ ] Render after top KPI/pending-request control and before lower operational charts.
- [ ] Pass `role="hospital_admin"`, `queryKeyScope="admin"`.
- [ ] Do not trap panel state inside `KPISummaryCards`.
- [ ] Existing selected dashboard period remains unchanged for period-based components.
- [ ] Due panel remains clearly labelled as live current exposure.

### Verification

```bash
pnpm --dir web exec vitest run src/pages/admin/Dashboard.test.tsx src/components/dashboard/ExecutiveDuePanel.test.tsx
pnpm exec tsc --noEmit
```

### Commit

```bash
git add web/src/pages/admin/Dashboard.tsx web/src/pages/admin/Dashboard.test.tsx
git commit -m "feat(admin): surface live outstanding dues"
```

---

## Task 4 — Place panel on MD dashboard

**Files:**

- Modify: `web/src/pages/MDDashboard.tsx`
- Modify: `web/src/pages/MDDashboard.test.tsx` or the existing focused MD dashboard suite

### Requirements

- [ ] Render immediately after `ExecutiveControlKpis` and before lower accounting/operational content.
- [ ] Pass `role="md"`, `queryKeyScope="md"`.
- [ ] Add due-panel query invalidation to the MD refresh action using the shared Action Center collection query family.
- [ ] Do not reuse or restore ambiguous legacy `patientDue` numbers as the panel source.
- [ ] Keep existing selected-period KPI/IPD behaviour unchanged.

### Verification

```bash
pnpm --dir web exec vitest run src/pages/MDDashboard.test.tsx src/components/dashboard/ExecutiveDuePanel.test.tsx
pnpm exec tsc --noEmit
```

### Commit

```bash
git add web/src/pages/MDDashboard.tsx web/src/pages/MDDashboard.test.tsx
git commit -m "feat(md): add receivable control panel"
```

---

## Task 5 — Place panel on Director dashboard

**Files:**

- Modify: `web/src/pages/DirectorDashboard.tsx`
- Modify: `web/e2e/directors.spec.ts` and/or focused unit test

### Requirements

- [ ] Render after `ExecutiveControlKpis`, before ownership/profit sections.
- [ ] Pass `role="director"`, `queryKeyScope="director"`.
- [ ] Add due-panel query invalidation to director refresh.
- [ ] Preserve shareholder and accounting sections.
- [ ] Same API, summary, pagination, status, and currency behaviour as Admin/MD.

### Verification

```bash
pnpm --dir web exec vitest run src/components/dashboard/ExecutiveDuePanel.test.tsx
pnpm exec tsc --noEmit
```

### Commit

```bash
git add web/src/pages/DirectorDashboard.tsx web/e2e/directors.spec.ts
git commit -m "feat(director): add receivable control panel"
```

---

## Task 6 — Cross-dashboard parity and regression coverage

**Files:**

- Create or modify focused parity tests
- Modify E2E only if the existing fixtures support collection data

### Requirements

- [ ] Admin, MD, and Director render the same shared component.
- [ ] Same tenant/live refresh point produces same summary.
- [ ] Visible page changes do not change summary totals.
- [ ] Cancelled, reversed, paid, zero-due, and cross-tenant invoices are excluded by the source authority.
- [ ] 0–7, 8–30, 31–60, and 60+ boundaries are stable in Dhaka-facing display.
- [ ] API failure never displays false zero.
- [ ] Mobile horizontal overflow remains usable.
- [ ] English/Bengali labels parse and render.

### Verification

```bash
pnpm --dir web exec vitest run src/components/dashboard/ExecutiveDuePanel.test.tsx src/pages/admin/Dashboard.test.tsx src/pages/MDDashboard.test.tsx
pnpm exec tsc --noEmit
pnpm --dir web build
```

### Commit

```bash
git add web/src web/public/locales web/e2e
git commit -m "test(dashboard): verify due control parity"
```

---

## Task 7 — Controlled write-off migration and approval type

**Dependency:** Read-only due panel may ship independently. Do not expose an active request button before Tasks 7–11 are complete.

**Existing authoritative plan:** `docs/superpowers/plans/2026-07-14-unified-action-center-phase-4-write-off.md`

**Files:**

- Create: `migrations/0526_receivable_write_off_approval.sql`
- Create: `test/migrations/receivable-write-off-approval.test.ts`
- Modify: `src/schemas/approval.ts`
- Modify: `src/routes/tenant/approvals.ts`

### Requirements

- [ ] Add `receivable_write_off` without dropping current approval columns/indexes.
- [ ] Preserve every supported approval type.
- [ ] No production migration without separate approval.

### Verification

```bash
pnpm exec vitest run test/migrations/receivable-write-off-approval.test.ts
pnpm build:migrations
pnpm exec tsc --noEmit
```

---

## Task 8 — Receivable adjustment authority

Follow the existing Phase 4 plan exactly.

- [ ] Legacy credit-note/accounting adapter.
- [ ] Shadow executes legacy and records comparison evidence only.
- [ ] Canonical credit note and guarded projection update.
- [ ] Minor units, currency validation, tenant isolation, idempotency.
- [ ] No fallback from misconfigured canonical mode.

---

## Task 9 — Write-off request service and API

- [ ] `POST /api/action-center/collections/invoice/:sourceKey/write-off-request`.
- [ ] Request amount is a positive safe integer and cannot exceed live due.
- [ ] Live source, currency, mode, and mapping are server-resolved.
- [ ] One pending request per collection source.
- [ ] Request creates approval and collection events atomically.
- [ ] Requester cannot later approve the request.

---

## Task 10 — Approval execution and rejection

- [ ] Conditional execution lock.
- [ ] Execution-time revalidation.
- [ ] Deterministic idempotency key.
- [ ] Full write-off closes; partial write-off remains actionable.
- [ ] Rejection restores/reconciles workflow state without financial mutation.
- [ ] Audit links approval, adjustment, invoice, and collection case.

---

## Task 11 — Enable request UI and approval details

**Files:**

- Modify: `web/src/components/action-center/CollectionDetailDrawer.tsx`
- Modify: `web/src/pages/admin/PendingApprovals.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Modify focused tests and locales

### Requirements

- [ ] Dashboard panel deep-links to the collection drawer/queue.
- [ ] `Request write-off` appears only with server-backed capability/permission.
- [ ] Full/partial amount, current/remaining due, reason, note, evidence, acknowledgement.
- [ ] Approver sees immutable request details and live execution checks.
- [ ] No `Write off now` direct action.

---

## Task 12 — Final integrated verification

### Required gates

```bash
pnpm exec vitest run test/action-center/collections test/billing test/migrations/receivable-write-off-approval.test.ts
pnpm exec vitest run --config vitest.config.integration.ts test/integration/routes/action-center-collections.test.ts test/integration/routes/approvals.test.ts test/integration/routes/admin-due-receivables.test.ts
pnpm --dir web exec vitest run src/components/dashboard/ExecutiveDuePanel.test.tsx src/components/action-center/CollectionDetailDrawer.test.tsx src/pages/admin/PendingApprovals.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx
pnpm build:migrations
pnpm exec tsc --noEmit
pnpm --dir web build
```

Also run:

```bash
git diff --check
```

### Final review checklist

- [ ] Requirement review complete.
- [ ] Security/tenant review complete.
- [ ] Accounting and canonical-authority review complete.
- [ ] No direct due mutation exists.
- [ ] No self-approval path exists.
- [ ] No false historical due label exists.
- [ ] No false multi-currency aggregate exists.
- [ ] All changes committed and branch clean.
- [ ] Stop with `READY FOR INTEGRATION`; do not merge or deploy.
