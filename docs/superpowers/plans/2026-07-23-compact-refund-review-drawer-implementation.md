# Compact Refund Review Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the refund approval drawer's long default layout with a compact decision-focused view and a collapsed `More details` section, without changing any backend or financial behavior.

**Architecture:** Keep `ApprovalDetailDrawer` as the shared container for all approval types. Add a refund-only compact body inside the same file so existing helpers, types, note validation, and actions remain reusable. Non-refund approval rendering remains unchanged. Use local React state for the accessible details disclosure and reset it whenever a different approval is opened.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, lucide-react, Vitest, React Testing Library.

## Global Constraints

- Work only in `/Users/rahmatullahzisan/Desktop/Dev/hms/.worktrees/refund-review-dashboard-20260722`.
- Target branch: `ui/compact-refund-review-drawer-20260723`.
- Never modify, clean, reset, or discard the dirty canonical root `/Users/rahmatullahzisan/Desktop/Dev/hms`.
- Follow `agents.md` and load `using-superpowers`, `executing-plans`, `test-driven-development`, and `verification-before-completion` before implementation.
- Apply the compact layout only when `approval.type === 'refund'`.
- Do not change refund calculations, cash-hold behavior, commission reservation, dispute settlement, API responses, migrations, accounting, or counter-session logic.
- Write failing tests before production code and observe each expected failure.
- Keep one action button area for refunds: the drawer action bar. Do not render the lower duplicate `Actions` section for refunds.
- `More details` must be collapsed by default and must use `aria-expanded` and `aria-controls`.
- Non-refund approval layouts and behavior must remain unchanged.

---

### Task 1: Define the compact refund drawer behavior with failing component tests

**Files:**
- Modify: `web/src/components/admin/ApprovalDetailDrawer.test.tsx`

**Interfaces:**
- Consumes: existing `ApprovalDetailDrawer` props and the existing mocked `DetailDrawer`.
- Produces: regression tests for the compact default view, disclosure behavior, blocker visibility, single action area, and non-refund compatibility.

- [ ] **Step 1: Import `fireEvent` and create a full compact-refund fixture**

Change the test import to:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
```

Add this fixture after `refundApproval`:

```tsx
const compactRefundApproval = {
  ...refundApproval,
  amount: 400,
  reason: 'Discount entered after payment',
  patientName: 'Tania',
  isActionable: true,
  canCurrentUserApprove: true,
  policyReason: 'Refund requires one authorized reviewer',
  evidenceStatus: 'provided',
  approvalCount: 0,
  requiredApprovals: 1,
  approvalStage: 'Pending review',
  timeline: [
    { label: 'Refund requested', at: '2026-07-22 20:00:00', by: 'Reception User' },
  ],
  requestData: {
    refundKind: 'amount_partial_refund',
    requestedRefundAmount: 400,
  },
  cashHold: {
    ...refundApproval.cashHold,
    amount: 400,
    status: 'held',
  },
  refundReview: {
    bill: {
      invoice_no: 'INV-D-2026-000703',
      patient_name: 'Tania',
      total: 3300,
      paid: 3300,
      due: 0,
    },
    allocationMode: 'auto_proportional_adjustable',
    allocations: [{
      invoiceItemId: 101,
      description: 'ECG',
      itemCategory: 'test',
      refundableBalance: 400,
      allocatedRefundAmount: 48.48,
      allocationSource: 'auto',
    }],
    collectionImpact: {
      before: { total: 3300, testBill: 3300 },
      reduction: { testBill: 400 },
      after: { total: 2900, testBill: 2900 },
    },
    commissionImpact: {
      totalReversal: 100,
      blocked: false,
      rows: [{
        accrualId: 300,
        doctorName: 'Dr. Example Three',
        itemDescription: 'ECG',
        oldCommissionBaseAmount: 400,
        newCommissionBaseAmount: 351.52,
        oldPayableCommissionAmount: 100,
        newPayableCommissionAmount: 87.88,
        reversalAmount: 12.12,
        paidAmount: 0,
      }],
    },
  },
} as const;
```

- [ ] **Step 2: Add a failing test for the compact default information hierarchy**

Add this test inside `describe('ApprovalDetailDrawer refund cash hold', ...)`:

```tsx
it('shows a compact decision view and hides duplicated refund sections by default', () => {
  render(
    <ApprovalDetailDrawer
      open
      onClose={vi.fn()}
      approval={compactRefundApproval as any}
      onApprove={vi.fn()}
      onReject={vi.fn()}
      onRequestInfo={vi.fn()}
    />,
  );

  expect(screen.getByText('Discount entered after payment')).toBeInTheDocument();
  expect(screen.getAllByText('Tania').length).toBeGreaterThan(0);
  expect(screen.getByText('INV-D-2026-000703')).toBeInTheDocument();
  expect(screen.getAllByText('Reception User').length).toBeGreaterThan(0);
  expect(screen.getByText('Pending approval — cash held')).toBeInTheDocument();
  expect(screen.getByText('Collection reduction')).toBeInTheDocument();
  expect(screen.getByText('Doctor commission')).toBeInTheDocument();

  const detailsButton = screen.getByRole('button', { name: /more details/i });
  expect(detailsButton).toHaveAttribute('aria-expanded', 'false');

  expect(screen.queryByText('Item allocation')).not.toBeInTheDocument();
  expect(screen.queryByText('Dr. Example Three')).not.toBeInTheDocument();
  expect(screen.queryByText('Decision Checklist')).not.toBeInTheDocument();
  expect(screen.queryByText('Request Summary')).not.toBeInTheDocument();
  expect(screen.queryByText('Financial / Cash Context')).not.toBeInTheDocument();
  expect(screen.queryByText('Operational Context')).not.toBeInTheDocument();
  expect(screen.queryByText('Policy & Evidence')).not.toBeInTheDocument();

  expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(1);
  expect(screen.getAllByRole('button', { name: 'Request Info' })).toHaveLength(1);
});
```

- [ ] **Step 3: Add a failing disclosure test**

```tsx
it('reveals allocation, commission, policy, technical IDs, and timeline from More details', () => {
  render(
    <ApprovalDetailDrawer
      open
      onClose={vi.fn()}
      approval={compactRefundApproval as any}
      onApprove={vi.fn()}
      onReject={vi.fn()}
    />,
  );

  const detailsButton = screen.getByRole('button', { name: /more details/i });
  fireEvent.click(detailsButton);

  expect(detailsButton).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('Item allocation')).toBeInTheDocument();
  expect(screen.getByText('ECG')).toBeInTheDocument();
  expect(screen.getByText('Dr. Example Three')).toBeInTheDocument();
  expect(screen.getByText('Refund requires one authorized reviewer')).toBeInTheDocument();
  expect(screen.getByText(/Counter session #17/i)).toBeInTheDocument();
  expect(screen.getByText(/Hold #9/i)).toBeInTheDocument();
  expect(screen.getByText('Refund requested')).toBeInTheDocument();
});
```

- [ ] **Step 4: Add a failing blocker-visibility test**

```tsx
it('keeps a commission blocker visible while advanced details are collapsed', () => {
  render(
    <ApprovalDetailDrawer
      open
      onClose={vi.fn()}
      approval={{
        ...compactRefundApproval,
        refundReview: {
          ...compactRefundApproval.refundReview,
          commissionImpact: {
            ...compactRefundApproval.refundReview.commissionImpact,
            blocked: true,
            blockedReasons: ['Commission has already been paid'],
          },
        },
      } as any}
      onApprove={vi.fn()}
      onReject={vi.fn()}
    />,
  );

  expect(screen.getByText(/Commission has already been paid/i)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /more details/i })).toHaveAttribute('aria-expanded', 'false');
});
```

- [ ] **Step 5: Add a non-refund compatibility assertion**

Extend the existing cash-handover test with:

```tsx
expect(screen.getByText('Decision Checklist')).toBeInTheDocument();
expect(screen.getByText('Request Summary')).toBeInTheDocument();
```

This proves the generic layout remains intact for non-refund approvals.

- [ ] **Step 6: Run the focused test and verify RED**

Run:

```bash
pnpm -C web exec vitest run src/components/admin/ApprovalDetailDrawer.test.tsx
```

Expected result: the new refund compact-layout tests fail because the current component still renders the long generic sections, has duplicate action buttons, and has no `More details` disclosure. Existing unrelated tests should still pass.

---

### Task 2: Implement the refund-only compact body and accessible details disclosure

**Files:**
- Modify: `web/src/components/admin/ApprovalDetailDrawer.tsx`

**Interfaces:**
- Consumes: existing approval data, refund review data, `DrawerField`, `DrawerSection`, formatting helpers, and existing action callbacks.
- Produces: `RefundApprovalCompactBody`, a refund-only presentation component with a compact default view and an accessible expandable details region.

- [ ] **Step 1: Add the disclosure icon import**

Change the lucide import to include `ChevronDown`:

```tsx
import {
  AlertTriangle,
  Check,
  ChevronDown,
  FileText,
  History,
  MessageSquare,
  ShieldCheck,
  X,
} from 'lucide-react';
```

- [ ] **Step 2: Add compact metric and amount helpers before the main component**

Add these helpers after `decisionRecommendation`:

```tsx
function refundCollectionReduction(collectionImpact: RefundReviewData['collectionImpact']): number {
  if (!collectionImpact) return 0;
  const explicitReduction = Number(collectionImpact.reduction?.total);
  if (Number.isFinite(explicitReduction) && explicitReduction > 0) return explicitReduction;
  const before = Number(collectionImpact.before?.total ?? 0);
  const after = Number(collectionImpact.after?.total ?? 0);
  return Math.max(0, before - after);
}

function CompactRefundMetric({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'neutral' | 'warning' | 'danger' | 'success';
}) {
  const toneClass = tone === 'danger'
    ? 'border-red-200 bg-red-50 text-red-800'
    : tone === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-800'
      : tone === 'success'
        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
        : 'border-[var(--color-border)] bg-white text-[var(--color-text-primary)]';

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${toneClass}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 font-data text-base font-bold">{value}</div>
      {detail && <div className="mt-0.5 text-xs opacity-80">{detail}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Add `RefundApprovalCompactBody` before `ApprovalDetailDrawer`**

Create a local component with this interface:

```tsx
function RefundApprovalCompactBody({
  approval,
  refundItems,
  refundCashHold,
  refundReview,
  approvalBlocked,
  blockedGuidance,
}: {
  approval: NonNullable<ApprovalDetailDrawerProps['approval']>;
  refundItems: RefundItemView[];
  refundCashHold: NonNullable<NonNullable<ApprovalDetailDrawerProps['approval']>['cashHold']> | null;
  refundReview: RefundReviewData | null;
  approvalBlocked: boolean;
  blockedGuidance: string;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const allocations = refundReview?.allocations ?? [];
  const collectionImpact = refundReview?.collectionImpact ?? null;
  const commissionImpact = refundReview?.commissionImpact ?? null;
  const collectionReduction = refundCollectionReduction(collectionImpact);
  const collectionAfter = Number(collectionImpact?.after?.total ?? 0);
  const commissionReduction = Number(commissionImpact?.totalReversal ?? 0);
  const patient = refundReview?.bill?.patient_name ?? approval.patientName ?? '-';
  const invoice = refundReview?.bill?.invoice_no ?? approval.invoiceId ?? approval.referenceLabel ?? approval.reference ?? '-';
  const detailsId = `refund-review-details-${approval.id}`;

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[var(--color-border)] bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_COLORS[approval.status] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>
                {approval.approvalStage ?? approval.status}
              </span>
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${RISK_COLORS[approval.risk] ?? 'bg-slate-100 text-slate-700 ring-1 ring-slate-200'}`}>
                {approval.risk} risk
              </span>
            </div>
            <div className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">{patient}</div>
            <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">
              {invoice} • Requested by {approval.requestedBy} • {approval.department}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Refund amount</div>
            <div className="font-data text-xl font-bold text-red-700">{approval.amountLabel ?? formatCurrency(approval.amount)}</div>
            <div className="text-xs text-[var(--color-text-muted)]">{formatDateTime(approval.submittedAt)}</div>
          </div>
        </div>
      </section>

      <section className="rounded-xl bg-[var(--color-surface-muted)] px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Reason</div>
        <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">{approval.reason}</p>
      </section>

      <div className="grid gap-2 sm:grid-cols-2">
        <CompactRefundMetric
          label="Cash state"
          value={refundCashHold ? cashHoldStatusLabel(refundCashHold.status) : 'No cash hold'}
          detail={refundCashHold ? formatCurrency(refundCashHold.amount) : undefined}
          tone={refundCashHold?.status === 'disputed' ? 'danger' : refundCashHold?.status === 'held' ? 'warning' : refundCashHold ? 'success' : 'neutral'}
        />
        <CompactRefundMetric
          label="Collection reduction"
          value={`-${formatCurrency(collectionReduction)}`}
          detail={collectionImpact?.after ? `After: ${formatCurrency(collectionAfter)}` : undefined}
          tone="danger"
        />
        <CompactRefundMetric
          label="Doctor commission"
          value={`-${formatCurrency(commissionReduction)}`}
          detail={commissionImpact?.blocked ? 'Approval blocked' : 'Reserved / reversed with refund'}
          tone={commissionImpact?.blocked ? 'danger' : 'warning'}
        />
        <CompactRefundMetric
          label="Bill"
          value={invoice}
          detail={refundReview?.bill ? `Paid ${formatCurrency(Number(refundReview.bill.paid ?? 0))} • Due ${formatCurrency(Number(refundReview.bill.due ?? 0))}` : undefined}
        />
      </div>

      {(approvalBlocked || commissionImpact?.blocked || refundReview?.allocationError) && (
        <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {refundReview?.allocationError
              ?? (commissionImpact?.blockedReasons ?? []).join('; ')
              ?? blockedGuidance}
          </span>
        </div>
      )}

      <button
        type="button"
        aria-expanded={detailsOpen}
        aria-controls={detailsId}
        onClick={() => setDetailsOpen((current) => !current)}
        className="flex w-full items-center justify-between rounded-xl border border-[var(--color-border)] bg-white px-3 py-2.5 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-muted)]"
      >
        <span>{detailsOpen ? 'Hide details' : 'More details'}</span>
        <ChevronDown className={`h-4 w-4 transition-transform ${detailsOpen ? 'rotate-180' : ''}`} />
      </button>

      {detailsOpen && (
        <div id={detailsId} className="space-y-3">
          <DrawerSection title="Bill and hold details">
            <div className="grid grid-cols-2 gap-2">
              {refundReview?.bill && <DrawerField label="Bill Total" value={formatCurrency(Number(refundReview.bill.total ?? 0))} />}
              {refundReview?.bill && <DrawerField label="Paid" value={formatCurrency(Number(refundReview.bill.paid ?? 0))} />}
              {refundReview?.bill && <DrawerField label="Due" value={formatCurrency(Number(refundReview.bill.due ?? 0))} />}
              <DrawerField label="Allocation" value={(refundReview?.allocationMode ?? 'auto_proportional_adjustable').replace(/_/g, ' ')} />
              {refundCashHold && <DrawerField label="Counter session" value={`#${refundCashHold.counterSessionId}`} />}
              {refundCashHold && <DrawerField label="Hold" value={`#${refundCashHold.id}`} />}
              {refundCashHold?.creditNoteId != null && <DrawerField label="Credit note" value={`#${refundCashHold.creditNoteId}`} />}
              {refundReview?.dispute?.id != null && <DrawerField label="Dispute" value={`#${refundReview.dispute.id}`} />}
            </div>
          </DrawerSection>

          {allocations.length > 0 && (
            <DrawerSection title="Item allocation">
              <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-white">
                {allocations.map((item) => (
                  <div key={item.invoiceItemId} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                    <div>
                      <div className="font-medium text-[var(--color-text-primary)]">{item.description}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        Item #{item.invoiceItemId} • {item.itemCategory.replace(/_/g, ' ')} • Balance {formatCurrency(item.refundableBalance)}
                      </div>
                    </div>
                    <div className="font-data font-bold text-red-700">-{formatCurrency(item.allocatedRefundAmount)}</div>
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}

          {allocations.length === 0 && refundItems.length > 0 && (
            <DrawerSection title="Refund items">
              <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-white">
                {refundItems.map((item) => (
                  <div key={`${item.invoiceItemId}-${item.returnQuantity}`} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                    <div>
                      <div className="font-medium">{item.description}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">Item #{item.invoiceItemId} • Quantity {item.returnQuantity}</div>
                    </div>
                    {item.calculatedAmount != null && <div className="font-data font-semibold">{formatCurrency(item.calculatedAmount)}</div>}
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}

          {(commissionImpact?.rows ?? []).length > 0 && (
            <DrawerSection title="Doctor commission breakdown">
              <div className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)] bg-white">
                {(commissionImpact?.rows ?? []).map((row) => (
                  <div key={row.accrualId} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
                    <div>
                      <div className="font-medium text-[var(--color-text-primary)]">{row.doctorName}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">
                        {row.itemDescription} • Payable {formatCurrency(row.oldPayableCommissionAmount)} → {formatCurrency(row.newPayableCommissionAmount)}
                      </div>
                    </div>
                    <div className="font-data font-bold text-red-700">-{formatCurrency(row.reversalAmount)}</div>
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}

          <DrawerSection title="Policy and approval">
            <div className="grid grid-cols-2 gap-2">
              <DrawerField label="Approval progress" value={approval.approvalStage ?? `${approval.approvalCount ?? 0}/${approval.requiredApprovals ?? 1}`} />
              <DrawerField label="Policy" value={approval.policyReason ?? 'Standard approval policy matched'} />
              <DrawerField label="Evidence" value={approval.evidenceStatus === 'missing' ? 'Missing' : approval.evidenceStatus === 'provided' ? 'Provided' : 'Not required'} />
              <DrawerField label="Assigned role" value={approval.assignedRole ?? '-'} />
              {approval.slaDueAt && <DrawerField label="SLA due" value={formatDateTime(approval.slaDueAt)} />}
              {approval.executionStatus && <DrawerField label="Execution" value={approval.executionStatus} />}
              {approval.executionError && <DrawerField label="Execution error" value={approval.executionError} />}
            </div>
          </DrawerSection>

          {approval.infoRequestStatus && approval.infoRequestStatus !== 'not_requested' && (
            <DrawerSection title="Information request">
              <div className="grid grid-cols-2 gap-2">
                <DrawerField label="Status" value={approval.infoRequestStatus === 'requested' ? 'Needs info' : 'Info submitted'} />
                {approval.infoRequestedAt && <DrawerField label="Requested at" value={formatDateTime(approval.infoRequestedAt)} />}
                {approval.infoRequestedBy != null && <DrawerField label="Requested by" value={`User #${approval.infoRequestedBy}`} />}
                {approval.infoSubmittedAt && <DrawerField label="Submitted at" value={formatDateTime(approval.infoSubmittedAt)} />}
                {approval.infoSubmittedBy != null && <DrawerField label="Submitted by" value={`User #${approval.infoSubmittedBy}`} />}
                {approval.infoRequestNote && <DrawerField label="Request note" value={approval.infoRequestNote} />}
                {approval.infoResponseNote && <DrawerField label="Response note" value={approval.infoResponseNote} />}
              </div>
              {approval.infoMissingItems && approval.infoMissingItems.length > 0 && (
                <div className="mt-2 text-xs text-amber-800">
                  Missing: {approval.infoMissingItems.join(', ')}
                </div>
              )}
            </DrawerSection>
          )}

          {approval.previousRequests && (
            <DrawerSection title="Previous requests by this user">
              <div className="flex flex-wrap gap-3 text-sm">
                <span className="font-medium text-emerald-600">{approval.previousRequests.approved} approved</span>
                <span className="font-medium text-red-600">{approval.previousRequests.rejected} rejected</span>
                <span className="text-[var(--color-text-muted)]">{formatCurrency(approval.previousRequests.totalAmount)} total</span>
              </div>
            </DrawerSection>
          )}

          {approval.timeline && approval.timeline.length > 0 && (
            <DrawerSection title="Timeline / Audit Trail">
              <div className="space-y-2">
                {approval.timeline.map((item, index) => (
                  <div key={`${item.label}-${index}`} className="flex gap-2 rounded-lg border border-[var(--color-border)] bg-white p-2.5 text-sm">
                    <History className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
                    <div>
                      <div className="font-semibold text-[var(--color-text-primary)]">{item.label}</div>
                      <div className="text-xs text-[var(--color-text-muted)]">{item.at ? formatDateTime(item.at) : 'Time not recorded'}{item.by ? ` • ${item.by}` : ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            </DrawerSection>
          )}

          {(isNonEmptyRecord(approval.oldValue) || isNonEmptyRecord(approval.newValue)) && (
            <DrawerSection title="Before / After Values">
              <div className="grid gap-3 md:grid-cols-2">
                {isNonEmptyRecord(approval.oldValue) && <KeyValueGrid data={approval.oldValue} />}
                {isNonEmptyRecord(approval.newValue) && <KeyValueGrid data={approval.newValue} />}
              </div>
            </DrawerSection>
          )}

          {approval.attachmentUrl && (
            <DrawerSection title="Supporting Document">
              <a href={approval.attachmentUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sm text-[var(--color-primary)] hover:underline">
                <FileText className="h-4 w-4" /> View Uploaded Document
              </a>
            </DrawerSection>
          )}
        </div>
      )}
    </div>
  );
}
```

During implementation, preserve the same copy and render conditions required by the tests. Do not add new backend fields.

- [ ] **Step 4: Route refunds to the compact body and keep the current body for other approval types**

In `ApprovalDetailDrawer`, add:

```tsx
const isRefundApproval = approval.type === 'refund';
```

Inside the `DetailDrawer` children, change the outer spacing container to:

```tsx
<div className={isRefundApproval ? 'space-y-3' : 'space-y-4'}>
```

Immediately after that opening `<div>`, insert the refund branch:

```tsx
{isRefundApproval ? (
  <RefundApprovalCompactBody
    key={approval.id}
    approval={approval}
    refundItems={refundItems}
    refundCashHold={refundCashHold}
    refundReview={refundReview}
    approvalBlocked={approvalBlocked}
    blockedGuidance={blockedGuidance}
  />
) : (
  <>
```

Place the existing contiguous generic content—from the summary card beginning with:

```tsx
<div className="rounded-2xl border border-[var(--color-border)] bg-white p-4 shadow-sm">
```

through the end of the `approval.previousRequests` section—inside that non-refund fragment. Close the branch immediately after the previous-request section with:

```tsx
  </>
)}
```

The existing `Refund Review & Financial Impact` block remains inside the non-refund fragment and is therefore unreachable because its own condition requires `approval.type === 'refund'`. Delete that unreachable block after the compact branch is green; all of its decision-critical content is rendered by `RefundApprovalCompactBody`.

Change the lower duplicate action condition from:

```tsx
{isActionable && !action && (
```

to:

```tsx
{!isRefundApproval && isActionable && !action && (
```

Leave the complete existing lower `Actions` section under that condition so non-refund approvals remain unchanged. Leave the complete existing `action && isActionable` note textarea and confirmation section after both branches so Approve, Reject, and Request Info validation behavior remains shared and unchanged.

- [ ] **Step 5: Ensure blocker text always resolves correctly**

Avoid the nullish-coalescing trap where an empty joined string suppresses `blockedGuidance`. Use:

```tsx
const commissionBlockReason = (commissionImpact?.blockedReasons ?? []).filter(Boolean).join('; ');
const criticalWarning = refundReview?.allocationError
  || commissionBlockReason
  || (approvalBlocked ? blockedGuidance : '');
```

Render the warning only when `criticalWarning` is non-empty.

- [ ] **Step 6: Run the focused test and verify GREEN**

Run:

```bash
pnpm -C web exec vitest run src/components/admin/ApprovalDetailDrawer.test.tsx
```

Expected result: all tests in `ApprovalDetailDrawer.test.tsx` pass. Confirm the new tests show exactly one refund action button for each action and the generic cash-handover sections remain visible.

- [ ] **Step 7: Refactor only after tests are green**

Remove duplicated refund-only markup and unused derived constants from the parent component. Keep generic approval rendering unchanged. Do not extract a new shared design system or alter `DetailDrawer.tsx` unless a failing test proves it is required.

- [ ] **Step 8: Re-run the focused test after refactoring**

Run:

```bash
pnpm -C web exec vitest run src/components/admin/ApprovalDetailDrawer.test.tsx
```

Expected result: PASS with no new warnings or React key errors.

- [ ] **Step 9: Commit the compact drawer implementation**

```bash
git add web/src/components/admin/ApprovalDetailDrawer.tsx web/src/components/admin/ApprovalDetailDrawer.test.tsx
git commit -m "feat(approvals): compact refund review drawer"
```

---

### Task 3: Run regression verification and review the final diff

**Files:**
- Review: `web/src/components/admin/ApprovalDetailDrawer.tsx`
- Review: `web/src/components/admin/ApprovalDetailDrawer.test.tsx`
- Review: `docs/superpowers/specs/2026-07-23-compact-refund-review-drawer-design.md`

**Interfaces:**
- Consumes: completed compact drawer implementation.
- Produces: verified clean branch ready for integration, without merging or deploying unless the user explicitly requests it.

- [ ] **Step 1: Run the related dashboard and drawer component tests**

```bash
pnpm -C web exec vitest run src/components/admin/ApprovalDetailDrawer.test.tsx src/components/dashboard/PendingRequestsSection.test.tsx
```

Expected result: all selected tests pass.

- [ ] **Step 2: Run the full web test suite**

```bash
pnpm -C web test -- --run
```

Expected result: the web suite passes with only pre-existing explicitly skipped tests.

- [ ] **Step 3: Run frontend typecheck and production build**

```bash
pnpm -C web exec tsc --noEmit
```

Expected result: exit code 0.

```bash
pnpm -C web build
```

Expected result: exit code 0. Existing chunk-size warnings are acceptable; new TypeScript, JSX, accessibility, or build errors are not.

- [ ] **Step 4: Review the diff against the approved design**

Use `HMS.show_changes` and verify:

- Refund default view contains patient, invoice, requester, reason, amount, cash state, collection reduction, commission reduction, and one critical warning.
- Advanced rows and technical IDs are collapsed by default.
- `More details` has `aria-expanded` and `aria-controls`.
- Refund action buttons appear only in the drawer action bar.
- Action note validation remains unchanged.
- Non-refund approval markup is functionally unchanged.
- No backend, migration, schema, accounting, or financial logic files changed.

- [ ] **Step 5: Run verification after any review fix**

If review changes are made, repeat Steps 1–3 before claiming completion.

- [ ] **Step 6: Commit review fixes only when necessary**

```bash
git add web/src/components/admin/ApprovalDetailDrawer.tsx web/src/components/admin/ApprovalDetailDrawer.test.tsx
git commit -m "fix(approvals): refine compact refund review details"
```

Skip this commit when no review fix is needed.

- [ ] **Step 7: Report integration readiness**

Report the final commit IDs, test counts, typecheck/build status, and exact changed files. Stop with a clean branch. Do not merge to `main`, push, or deploy unless the user explicitly instructs that integration step.
