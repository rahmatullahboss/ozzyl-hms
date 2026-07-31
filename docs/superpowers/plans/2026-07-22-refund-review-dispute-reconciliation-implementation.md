# Refund Review, Dispute, and Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make refund requests fully reviewable from the dashboard, automatically allocate amount-based refunds to bill items, reconcile category collections and unpaid doctor commission on approval, and convert rejected refund reserves into requester-owned disputed cash that can be settled by cash recovery or authorized write-off.

**Architecture:** Keep the existing approval request and refund cash-hold workflow as the operational authority. Add focused domain helpers for financial allocation, commission reconciliation, and disputed-cash state transitions; extend the existing approvals API rather than creating a second approval engine; expose a small dispute API for settlement; and reuse the existing `ApprovalDetailDrawer` inside the dashboard. Tenant 102 remains canonical shadow mode and all new financial events retain legacy-first idempotent execution.

**Tech Stack:** TypeScript, Hono, Cloudflare D1/SQLite, Drizzle schema declarations, Zod, React, React Query wrappers, Vitest, Testing Library.

## Global Constraints

- Tenant 102 remains canonical `shadow`; this change does not authorize cutover.
- A pending refund reduces available cash through one active hold only; no permanent cash-out is posted until approval or rejection.
- Approval consumes the hold without deducting cash twice.
- Rejection converts the hold to disputed cash and must not restore it to available cash.
- Amount-based allocation is server-generated proportionally and requester-adjustable within item balances.
- Bill total, category collection, accounting, and unpaid doctor commission must reconcile from the same persisted allocation.
- Already-paid commission cannot become a silent negative balance; approval must fail with a specific conflict.
- All write operations are tenant-scoped, idempotent, audited, and protected by existing approval roles/two-person policy.
- Existing historical `released` holds remain readable.

---

## File Structure

- `src/lib/billing-refund.ts`: allocation types, proportional allocation, requester adjustment validation, and financial item-balance loading.
- `src/lib/billing-refund-commission.ts`: calculate and apply item-level unpaid commission reductions from a credit allocation.
- `src/lib/billing-refund-dispute.ts`: refund-dispute model, creation, recovery, write-off, and canonical shadow cash-ledger projections.
- `src/routes/tenant/approvals.ts`: structured refund creation/detail/approval/rejection orchestration.
- `src/routes/tenant/refundDisputes.ts`: dispute list/detail/recovery/write-off-request endpoints.
- `src/schemas/approval.ts`: request allocation shape and validation.
- `src/schemas/refundDispute.ts`: recovery and write-off request schemas.
- `migrations/0521_refund_dispute_reconciliation.sql`: hold status expansion, dispute table, indexes, and constraints.
- `src/db/schema/schema.ts`: Drizzle declarations for the new dispute table and expanded hold status documentation.
- `src/index.ts`: route registration.
- `web/src/components/dashboard/PendingRequestsSection.tsx`: reason/cash state and dashboard-native drawer actions.
- `web/src/components/admin/ApprovalDetailDrawer.tsx`: exported drawer DTO and allocation/impact sections.
- `web/src/lib/approvalReview.ts`: API-row-to-drawer mapping shared by the dashboard.
- Tests live beside the relevant backend integration/unit and frontend component files.

---

### Task 1: Financial allocation domain

**Files:**
- Modify: `src/lib/billing-refund.ts`
- Modify: `src/schemas/approval.ts`
- Create: `test/unit/billing-refund-allocation.test.ts`
- Modify: `test/integration/routes/refund-approval-cash-holds.test.ts`

**Interfaces:**
- Produces `RefundAllocationItem`, `calculateProportionalRefundAllocation(items, amount)`, `validateRefundAllocation(items, requestedAmount, supplied)`, and `loadRefundAllocationItems(db, tenantId, billId, options)`.
- `RefundAllocationItem` includes `invoiceItemId`, `description`, `itemCategory`, `lineAmount`, `approvedCreditAmount`, `pendingAllocatedAmount`, and `refundableBalance`.
- Validated output includes `allocatedRefundAmount` and `allocationSource`.

- [ ] **Step 1: Write failing proportional-allocation tests**

```ts
it('allocates 400 across 400, 500, 1200, 1200 and fixes rounding deterministically', () => {
  const result = calculateProportionalRefundAllocation([
    item(3058, 400), item(3059, 500), item(3060, 1200), item(3061, 1200),
  ], 400);
  expect(result.map((row) => row.allocatedRefundAmount)).toEqual([48.48, 60.61, 145.46, 145.45]);
  expect(result.reduce((sum, row) => sum + row.allocatedRefundAmount, 0)).toBe(400);
});

it('accepts requester adjustments only when the exact amount and balances reconcile', () => {
  expect(validateRefundAllocation(items, 400, [
    { invoiceItemId: 3058, allocatedRefundAmount: 100 },
    { invoiceItemId: 3059, allocatedRefundAmount: 100 },
    { invoiceItemId: 3060, allocatedRefundAmount: 100 },
    { invoiceItemId: 3061, allocatedRefundAmount: 100 },
  ])).toMatchObject({ totalRefund: 400 });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run test/unit/billing-refund-allocation.test.ts`
Expected: FAIL because the allocation exports do not exist.

- [ ] **Step 3: Implement minimal allocation functions**

Use integer minor units internally:

```ts
const requestedMinor = Math.round(requestedAmount * 100);
const raw = requestedMinor * itemBalanceMinor / totalBalanceMinor;
const floorMinor = Math.floor(raw);
```

Distribute remaining minor units by descending fractional remainder, then descending refundable balance, then ascending invoice item ID. Return two-decimal major amounts. Reject duplicate IDs, unknown items, negative amounts, over-allocation, zero total, and totals not equal to the requested amount.

- [ ] **Step 4: Add financial item-balance loading**

Query active `invoice_items`, approved `billing_credit_note_items.total_amount`, and open refund approval request data. Pending allocation reads `allocatedRefundAmount`; legacy quantity requests fall back to `calculatedAmount`. Exclude the approval currently being reviewed when requested.

- [ ] **Step 5: Extend Zod request schema**

Permit amount-based items shaped as:

```ts
{
  invoiceItemId: number;
  allocatedRefundAmount: number;
  allocationSource?: 'auto' | 'requester_adjusted';
}
```

Keep quantity-based validation for `item_partial_refund`. Amount-based requests may omit items (server auto-allocation) or supply a valid adjustable allocation.

- [ ] **Step 6: Run allocation and existing refund tests GREEN**

Run: `pnpm vitest run test/unit/billing-refund-allocation.test.ts test/integration/routes/refund-approval-cash-holds.test.ts`
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/billing-refund.ts src/schemas/approval.ts test/unit/billing-refund-allocation.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
git commit -m "feat(refunds): allocate partial amounts across bill items"
```

---

### Task 2: Disputed cash persistence and domain operations

**Files:**
- Create: `migrations/0521_refund_dispute_reconciliation.sql`
- Modify: `src/db/schema/schema.ts`
- Create: `src/lib/billing-refund-dispute.ts`
- Create: `test/refund-dispute-schema.test.ts`
- Create: `test/unit/billing-refund-dispute.test.ts`

**Interfaces:**
- Produces `RefundCashDispute`, `prepareCreateRefundDispute`, `prepareMarkRefundHoldDisputed`, `recoverRefundDispute`, `markRefundDisputeWriteoffPending`, and `completeRefundDisputeWriteoff`.
- Hold statuses become `held | consumed | released | disputed | settled`.
- Dispute statuses become `open | recovery_pending | recovered | writeoff_pending | written_off`.

- [ ] **Step 1: Write failing schema tests**

Assert migration contains:

```sql
CREATE TABLE billing_refund_cash_disputes
CHECK (status IN ('open','recovery_pending','recovered','writeoff_pending','written_off'))
UNIQUE (tenant_id, refund_cash_hold_id)
```

and rebuilt/updated hold validation accepts `disputed` and `settled` while preserving `released`.

- [ ] **Step 2: Run schema test RED**

Run: `pnpm vitest run test/refund-dispute-schema.test.ts`
Expected: FAIL because migration/table do not exist.

- [ ] **Step 3: Add migration and Drizzle schema**

The dispute table stores tenant, hold, approval, bill, requester, amount, status, rejection metadata, custody/counter/session, settlement method/reference, idempotency key, and timestamps. Add tenant/status, requester/status, and hold indexes.

- [ ] **Step 4: Write failing domain tests**

Cover:

```ts
it('rejection marks the hold disputed and creates one requester liability');
it('cash recovery posts cash-in and settles the dispute exactly once');
it('write-off closes liability without creating cash-in');
```

- [ ] **Step 5: Implement dispute helpers**

Rejection batch must:

```text
approval rejected
cash_drawer_movements disputed_cash_out
hold disputed
refund dispute open
```

The permanent disputed outflow replaces the held deduction; never retain both representations. Cash recovery posts `cash_in` linked to the dispute and credits the requester dispute receivable. Write-off records no cash movement and marks the approved loss settlement.

- [ ] **Step 6: Add canonical shadow projections**

Use `shadowCreateCashLedgerEntry` with idempotency keys:

```text
cash-ledger:refund-dispute:<id>:opened
cash-ledger:refund-dispute:<id>:recovered
cash-ledger:refund-dispute:<id>:written-off
```

and statuses/current locations `DISPUTED`, `IN_DRAWER`, and `WRITTEN_OFF`.

- [ ] **Step 7: Run tests GREEN and commit**

Run: `pnpm vitest run test/refund-dispute-schema.test.ts test/unit/billing-refund-dispute.test.ts`

```bash
git add migrations/0521_refund_dispute_reconciliation.sql src/db/schema/schema.ts src/lib/billing-refund-dispute.ts test/refund-dispute-schema.test.ts test/unit/billing-refund-dispute.test.ts
git commit -m "feat(refunds): add requester disputed cash lifecycle"
```

---

### Task 3: Commission reconciliation from item allocations

**Files:**
- Create: `src/lib/billing-refund-commission.ts`
- Create: `test/unit/billing-refund-commission.test.ts`
- Modify: `test/integration/routes/refund-approval-cash-holds.test.ts`

**Interfaces:**
- Produces `previewRefundCommissionImpact(db, input)` and `applyRefundCommissionImpact(db, input)`.
- Input includes tenant, bill, allocation rows, credit-note ID/no, user, date, and reason.
- Output rows include doctor/accrual/item, old base/payable, reversal, new base/payable, and blocked reason.

- [ ] **Step 1: Write failing calculation tests**

```ts
it('reduces a 25 percent commission when 48.48 is allocated to a 400 test line', () => {
  expect(calculateCommissionRefundImpact({
    commissionBaseAmount: 400,
    rateBps: 2500,
    flatAmount: 0,
    earned: 100,
    waiver: 0,
    payable: 100,
    paid: 0,
    allocatedRefundAmount: 48.48,
    itemRefundableBalance: 400,
  })).toMatchObject({ newBase: 351.52, newPayable: 87.88, reversal: 12.12 });
});

it('blocks when paid commission exceeds recalculated payable', () => {
  expect(() => calculateCommissionRefundImpact({ paid: 95, ... })).toThrow(/already paid/i);
});
```

- [ ] **Step 2: Run test RED**

Run: `pnpm vitest run test/unit/billing-refund-commission.test.ts`
Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement calculation and bill-line matching**

Match accruals by bill and canonical source key fragment:

```text
bill:<billId>:line:<1-based invoice order>:<itemCategory>:<referenceId|none>:
```

Also support `lab_order_item_id` linkage when present. Percentage rows reduce base by the allocated amount, capped at zero. Flat rows reduce unpaid payable by allocation ratio. Preserve waiver up to recomputed earned.

- [ ] **Step 4: Implement preview and apply**

Preview performs no writes and reports blocked paid rows. Apply updates base/earned/waiver/payable/commission/balance/status, appends notes, and records a `commission_cancelled` accounting posting event for the reversal amount using an idempotent source key tied to credit note and accrual.

- [ ] **Step 5: Add route integration expectations**

Change the existing amount-refund regression so it expects:

- credit-note item allocation rows,
- category update,
- commission update/reversal,
- no clinical cancellation for amount-based price correction.

- [ ] **Step 6: Run tests GREEN and commit**

Run: `pnpm vitest run test/unit/billing-refund-commission.test.ts test/integration/routes/refund-approval-cash-holds.test.ts`

```bash
git add src/lib/billing-refund-commission.ts test/unit/billing-refund-commission.test.ts test/integration/routes/refund-approval-cash-holds.test.ts
git commit -m "feat(refunds): reconcile unpaid doctor commission by item"
```

---

### Task 4: Approval creation, detail, approval, and rejection orchestration

**Files:**
- Modify: `src/routes/tenant/approvals.ts`
- Modify: `src/lib/billing-refund-cash-hold.ts`
- Modify: `test/integration/routes/refund-approval-cash-holds.test.ts`
- Modify: `test/integration/routes/approvals.test.ts`

**Interfaces:**
- Creation persists `allocationMode`, `allocationVersion`, and normalized items for amount partial refunds.
- `GET /api/approvals/:id` returns `refund_review` with bill/payment/allocation/collection/commission impact.
- Approval returns `sideEffect` plus `refundImpact`.
- Rejection returns `cashHold.status = disputed` and dispute details.

- [ ] **Step 1: Write failing creation/detail tests**

Cover:

```ts
it('auto-allocates amount refund request data before creating the hold');
it('preserves a valid requester-adjusted allocation');
it('returns patient, bill, reason, cash hold, collection impact, and commission preview from GET /:id');
```

- [ ] **Step 2: Run tests RED**

Run: `pnpm vitest run test/integration/routes/refund-approval-cash-holds.test.ts test/integration/routes/approvals.test.ts`
Expected: new assertions fail.

- [ ] **Step 3: Normalize amount allocation during POST**

Load financial allocation items, calculate or validate allocation, persist normalized item metadata, then create approval and hold in the existing atomic batch.

- [ ] **Step 4: Add detail route**

Load one approval with requester/reviewer names, patient/bill/payment summary, hold/dispute, normalized allocation, category before/after, and commission preview. Apply the same role and tenant restrictions as the list route.

- [ ] **Step 5: Rework held-refund approval**

For amount partial refunds:

- revalidate/persist allocation,
- create credit-note item rows with `return_quantity = 0`,
- subtract per-category allocation from bill category fields,
- post item/category allocation in accounting payload,
- consume hold once,
- apply commission impact after the financial batch and make retry idempotent,
- do not cancel lab/radiology clinical work.

Item/full refunds retain existing clinical cancellation behaviour.

- [ ] **Step 6: Replace rejection release with dispute conversion**

Remove the new-flow call to `prepareReleaseRefundHold`. In one batch reject approval, create `disputed_cash_out`, mark hold `disputed`, and create the dispute. Historical release helpers remain for legacy/history and existing released rows.

- [ ] **Step 7: Run backend route tests GREEN and commit**

Run: `pnpm vitest run test/integration/routes/refund-approval-cash-holds.test.ts test/integration/routes/approvals.test.ts test/integration/routes/billing-counter.test.ts`

```bash
git add src/routes/tenant/approvals.ts src/lib/billing-refund-cash-hold.ts test/integration/routes/refund-approval-cash-holds.test.ts test/integration/routes/approvals.test.ts
git commit -m "feat(refunds): reconcile approvals and convert rejections to disputes"
```

---

### Task 5: Dispute settlement API

**Files:**
- Create: `src/schemas/refundDispute.ts`
- Create: `src/routes/tenant/refundDisputes.ts`
- Modify: `src/index.ts`
- Create: `test/integration/routes/refund-disputes.test.ts`

**Interfaces:**
- `GET /api/refund-disputes?status=open&requesterUserId=` lists requester liabilities.
- `GET /api/refund-disputes/:id` returns history and linked refund/bill/approval.
- `POST /api/refund-disputes/:id/recover` requires active counter and idempotency key.
- `POST /api/refund-disputes/:id/writeoff-request` creates a controlled `manual_adjustment` approval and marks dispute `writeoff_pending`.
- Final write-off completion is executed only by the approved controlled adjustment side effect.

- [ ] **Step 1: Write failing API tests**

Cover list/detail authorization, cash recovery, duplicate recovery, write-off request, requester self-approval protection, and no cash-in for write-off.

- [ ] **Step 2: Run tests RED**

Run: `pnpm vitest run test/integration/routes/refund-disputes.test.ts`
Expected: FAIL because route/schema are absent.

- [ ] **Step 3: Implement schemas and routes**

Recovery body:

```ts
{ idempotencyKey: string; notes?: string }
```

Write-off request body:

```ts
{ idempotencyKey: string; reason: string; evidence?: Record<string, unknown> }
```

Use `hospital_admin`, `md`, `director`, `manager`, and `accountant` for viewing/recovery; write-off approval follows existing controlled approval roles and separation of duties.

- [ ] **Step 4: Register route and controlled side effect**

Mount `/api/refund-disputes`. Teach approval side-effect execution to recognize a dispute-writeoff marker in `manual_adjustment` request data and call `completeRefundDisputeWriteoff`.

- [ ] **Step 5: Run tests GREEN and commit**

Run: `pnpm vitest run test/integration/routes/refund-disputes.test.ts test/integration/routes/two-person-approvals.test.ts`

```bash
git add src/schemas/refundDispute.ts src/routes/tenant/refundDisputes.ts src/index.ts test/integration/routes/refund-disputes.test.ts src/routes/tenant/approvals.ts
git commit -m "feat(refunds): add dispute recovery and write-off workflow"
```

---

### Task 6: Dashboard-native review drawer

**Files:**
- Create: `web/src/lib/approvalReview.ts`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Modify: `web/src/components/dashboard/PendingRequestsSection.tsx`
- Modify: `web/src/components/dashboard/PendingRequestsSection.test.tsx`
- Modify: `web/src/components/admin/ApprovalDetailDrawer.test.tsx`
- Modify: `web/public/locales/en/dashboard.json`
- Modify: `web/public/locales/bn/dashboard.json`

**Interfaces:**
- Export `ApprovalDrawerModel` from the drawer.
- `mapApprovalDetailToDrawer(api)` returns the drawer model.
- Dashboard Review fetches `/api/approvals/:id`, opens the drawer, and calls existing review/request-info endpoints.

- [ ] **Step 1: Write failing dashboard tests**

```tsx
it('shows refund reason and held cash state in the dashboard row');
it('opens ApprovalDetailDrawer in place instead of navigating');
it('approves and refreshes the dashboard query');
it('shows patient and requester as separate fields');
```

- [ ] **Step 2: Run frontend tests RED**

Run: `pnpm -C web exec vitest run src/components/dashboard/PendingRequestsSection.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx`
Expected: new assertions fail.

- [ ] **Step 3: Export shared drawer model and render impact sections**

Add refund allocation, original bill, collection before/after, commission impact, and dispute state sections. Keep one primary Approve action, clear Reject/Request Info actions, keyboard-close behaviour, and existing focus/contrast tokens.

- [ ] **Step 4: Open drawer from dashboard**

Replace row Review link with a button. On click, fetch detail, map it, and open the drawer without route navigation. Keep the full-page link in the section header. Row columns show reason and cash state.

- [ ] **Step 5: Wire mutations**

Use `useApiMutation` for approve/reject/request-info. Disable actions while pending, show toast feedback, close or refresh drawer on success, and refetch the pending list.

- [ ] **Step 6: Run frontend tests GREEN and commit**

Run: `pnpm -C web exec vitest run src/components/dashboard/PendingRequestsSection.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx`

```bash
git add web/src/lib/approvalReview.ts web/src/components/admin/ApprovalDetailDrawer.tsx web/src/components/dashboard/PendingRequestsSection.tsx web/src/components/dashboard/PendingRequestsSection.test.tsx web/src/components/admin/ApprovalDetailDrawer.test.tsx web/public/locales/en/dashboard.json web/public/locales/bn/dashboard.json
git commit -m "feat(dashboard): review refunds without leaving dashboard"
```

---

### Task 7: Cross-report regression and final verification

**Files:**
- Modify: `test/integration/routes/refund-discount-cancellation-report-reconciliation.test.ts`
- Modify: `test/integration/routes/collection-report-reconciliation.test.ts`
- Modify: `test/integration/routes/dashboard-kpi-summary.test.ts`
- Modify: `docs/superpowers/plans/2026-07-22-refund-review-dispute-reconciliation-implementation.md`

**Interfaces:**
- Verifies one approved amount allocation produces the same reduced amount in bill/category collection, doctor payable, doctor performance, and KPI reporting.

- [ ] **Step 1: Add failing cross-report regression**

Fixture mirrors `INV-D-2026-000703`: bill 3300, four test lines, refund 400, 25% commission. Assert allocation totals 400, new test collection 2900, and total commission falls from 825 to 725.

- [ ] **Step 2: Run regression RED, then fix only discovered parity gaps**

Run: `pnpm vitest run test/integration/routes/refund-discount-cancellation-report-reconciliation.test.ts test/integration/routes/collection-report-reconciliation.test.ts test/integration/routes/dashboard-kpi-summary.test.ts`

- [ ] **Step 3: Run focused full feature suite**

```bash
pnpm vitest run \
  test/unit/billing-refund-allocation.test.ts \
  test/unit/billing-refund-commission.test.ts \
  test/unit/billing-refund-dispute.test.ts \
  test/refund-dispute-schema.test.ts \
  test/integration/routes/refund-approval-cash-holds.test.ts \
  test/integration/routes/refund-disputes.test.ts \
  test/integration/routes/approvals.test.ts \
  test/integration/routes/billing-counter.test.ts \
  test/integration/routes/collection-report-reconciliation.test.ts \
  test/integration/routes/dashboard-kpi-summary.test.ts
```

- [ ] **Step 4: Run frontend suite, typecheck, migration build, and production build**

```bash
pnpm -C web exec vitest run src/components/dashboard/PendingRequestsSection.test.tsx src/components/admin/ApprovalDetailDrawer.test.tsx
pnpm exec tsc --noEmit
pnpm build:migrations
pnpm build
```

Expected: zero failures. Known Wrangler configuration/chunk warnings may remain, but no new warning caused by this feature.

- [ ] **Step 5: Verify migration without production mutation**

Run the migration against a local/test D1 database or migration build only. Do not apply production migration or deploy without a separate authorization.

- [ ] **Step 6: Update checklist and commit**

Mark completed plan tasks, record exact test counts/commands, then:

```bash
git add docs/superpowers/plans/2026-07-22-refund-review-dispute-reconciliation-implementation.md test/integration/routes/refund-discount-cancellation-report-reconciliation.test.ts test/integration/routes/collection-report-reconciliation.test.ts test/integration/routes/dashboard-kpi-summary.test.ts
git commit -m "test(refunds): verify collection and commission parity"
```

- [ ] **Step 7: Finish branch**

Rebase on latest `origin/main`, rerun focused verification, perform adversarial review, push branch, open PR, and merge only after checks pass. Do not deploy or apply production migration in this task.
