import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (value: string, options?: { defaultValue?: string }) => options?.defaultValue ?? value }),
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

vi.mock('./DetailDrawer', () => ({
  default: ({ open, footer, children }: { open: boolean; footer?: ReactNode; children: ReactNode }) => open ? <div>{children}{footer}</div> : null,
  DrawerField: ({ label, value }: { label: string; value: ReactNode }) => <div><span>{label}</span><span>{value}</span></div>,
  DrawerSection: ({ title, children }: { title: string; children: ReactNode }) => <section><h3>{title}</h3>{children}</section>,
}));

import ApprovalDetailDrawer from './ApprovalDetailDrawer';

const refundApproval = {
  id: '55',
  type: 'refund',
  requestedBy: 'Reception User',
  department: 'Reception',
  amount: 800,
  reason: 'CBC was not performed',
  submittedAt: '2026-07-12 10:00:00',
  risk: 'medium',
  status: 'pending',
  invoiceId: 'INV-75',
  requestData: {
    refundKind: 'item_partial_refund',
    requestedRefundAmount: 800,
    items: [
      { invoiceItemId: 101, description: 'CBC Test', returnQuantity: 1, calculatedAmount: 800 },
    ],
  },
  cashHold: {
    id: 9,
    amount: 800,
    status: 'held',
    counterSessionId: 17,
    heldAt: '2026-07-12 10:00:00',
    consumedAt: null,
    releasedAt: null,
    creditNoteId: null,
  },
};

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

const cashHandoverApproval = {
  id: '78',
  type: 'cash_handover',
  source: 'billing_handovers',
  requestedBy: 'Cashier A',
  department: 'Cash Control',
  amount: 1450,
  amountLabel: 'Expected ৳1,500 • Counted ৳1,450 • Variance -৳50',
  reason: 'Cash variance/dispute requires admin decision',
  submittedAt: '2026-07-14T02:00:00Z',
  risk: 'high',
  status: 'pending',
  expectedAmount: 1500,
  countedAmount: 1450,
  variance: -50,
  receiverName: 'Receiver B',
  isActionable: true,
} as const;

describe('ApprovalDetailDrawer refund cash hold', () => {
  it('shows selected items on demand and explains that held cash is not debited twice', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={refundApproval as any}
      />,
    );

    expect(screen.getByText('Pending approval — cash held')).toBeInTheDocument();
    expect(screen.getByText('Cash will not be deducted again on approval.')).toBeInTheDocument();
    expect(screen.queryByText('CBC Test')).not.toBeInTheDocument();
    expect(screen.queryByText(/Counter session #17/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /more details/i }));

    expect(screen.getByText('Item allocation')).toBeInTheDocument();
    expect(screen.queryByText('auto proportional adjustable')).not.toBeInTheDocument();
    expect(screen.getByText('CBC Test')).toBeInTheDocument();
    expect(screen.getByText(/Quantity 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Counter session #17/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pay refund/i })).not.toBeInTheDocument();
  });

  it('shows released hold state for a rejected legacy refund', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{
          ...refundApproval,
          status: 'rejected',
          isActionable: false,
          cashHold: { ...refundApproval.cashHold, status: 'released', releasedAt: '2026-07-12 10:05:00' },
        } as any}
      />,
    );

    expect(screen.getByText('Cash hold released')).toBeInTheDocument();
  });

  it('shows amount impact and disputed cash ownership while keeping advanced rows collapsed', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{
          ...compactRefundApproval,
          cashHold: { ...compactRefundApproval.cashHold, status: 'disputed' },
          refundReview: {
            ...compactRefundApproval.refundReview,
            dispute: { id: 31, amount: 400, status: 'open', requesterUserId: 3 },
          },
        } as any}
      />,
    );

    expect(screen.getByText('Refund rejected — cash remains disputed')).toBeInTheDocument();
    expect(screen.getByText(/outside available cash/i)).toBeInTheDocument();
    expect(screen.getAllByText('Tania').length).toBeGreaterThan(0);
    expect(screen.getByText('Collection reduction')).toBeInTheDocument();
    expect(screen.getByText('Doctor commission')).toBeInTheDocument();
    expect(screen.queryByText('ECG')).not.toBeInTheDocument();
    expect(screen.queryByText(/Dr\. Ashikur Rahman/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Dispute #31/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /more details/i }));

    expect(screen.getByText('ECG')).toBeInTheDocument();
    expect(screen.getByText(/Dr\. Ashikur Rahman/)).toBeInTheDocument();
    expect(screen.getByText(/Dispute #31/)).toBeInTheDocument();
  });

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
    expect(detailsButton).toHaveAttribute('aria-controls', 'refund-review-details-55');
    expect(document.getElementById('refund-review-details-55')).toHaveAttribute('hidden');

    expect(screen.queryByText('Item allocation')).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Example Three')).not.toBeInTheDocument();
    expect(screen.queryByText('Decision Checklist')).not.toBeInTheDocument();
    expect(screen.queryByText('Request Summary')).not.toBeInTheDocument();
    expect(screen.queryByText('Financial / Cash Context')).not.toBeInTheDocument();
    expect(screen.queryByText('Operational Context')).not.toBeInTheDocument();
    expect(screen.queryByText('Policy & Evidence')).not.toBeInTheDocument();

    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Return for correction' })).toHaveLength(1);
  });

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

  it('resets More details to collapsed when a different refund approval opens', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ApprovalDetailDrawer
        open
        onClose={onClose}
        approval={compactRefundApproval as any}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /more details/i }));
    expect(screen.getByRole('button', { name: /hide details/i })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Item allocation')).toBeInTheDocument();

    rerender(
      <ApprovalDetailDrawer
        open
        onClose={onClose}
        approval={{ ...compactRefundApproval, id: '56', reason: 'Second refund request' } as any}
      />,
    );

    expect(screen.getByRole('button', { name: /more details/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Item allocation')).not.toBeInTheDocument();
  });

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

  it('shows a safe fallback when commission is blocked without a reason', () => {
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
              blockedReasons: [],
            },
          },
        } as any}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText('Commission has already been paid.')).toBeInTheDocument();
  });

  it('does not invent zero collection or commission impact when review data is missing', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{
          ...compactRefundApproval,
          refundReview: null,
        } as any}
      />,
    );

    expect(screen.getAllByText('Not available')).toHaveLength(2);
  });
});

describe('ApprovalDetailDrawer credit discharge review', () => {
  it('shows the executed clinical discharge and financial exception evidence separately', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{
          id: '501',
          type: 'credit_discharge',
          requestedBy: 'Reception User',
          department: 'IPD Billing',
          amount: 6700,
          amountLabel: '৳6,700',
          reason: 'Guardian will pay after salary',
          submittedAt: '2026-07-19 12:00:00',
          risk: 'medium',
          status: 'pending',
          referenceLabel: 'ADM-000022',
          patientName: 'Marufa Begum',
          isActionable: true,
          approvalNoteRequired: true,
          requestData: {
            actionState: 'executed_pending_review',
            patientName: 'Marufa Begum',
            patientCode: 'PT-000101',
            patientMobile: '01700000000',
            admissionId: 22,
            admissionNo: 'ADM-000022',
            currentInvoiceNo: 'BL-000090',
            currentDischargeDueMinor: 50000,
            externalOutstandingMinor: 620000,
            totalDueMinor: 670000,
            currencyCode: 'BDT',
            creditReason: 'Guardian will pay after salary',
            expectedPaymentDate: '2026-07-25',
            requesterAcknowledged: true,
            requesterRole: 'reception',
            counterId: 4,
            counterSessionId: 19,
            externalInvoices: [{
              invoiceNumber: 'LAB-0077',
              sourceLabel: 'Laboratory / Test',
              dueMinor: 620000,
              categories: [{ code: 'laboratory', label: 'Laboratory / Test', amountMinor: 620000 }],
            }],
          },
        }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/Credit Discharge/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Clinical: Discharged')).toBeInTheDocument();
    expect(screen.getByText('Financial: Approval pending')).toBeInTheDocument();
    expect(screen.getAllByText('Marufa Begum').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ADM-000022').length).toBeGreaterThan(0);
    expect(screen.getByText('LAB-0077')).toBeInTheDocument();
    expect(screen.getAllByText(/Laboratory \/ Test/).length).toBeGreaterThan(0);
    expect(screen.getByText('25 Jul 2026')).toBeInTheDocument();
    expect(screen.getAllByText(/The patient has already been discharged/i).length).toBeGreaterThan(0);
  });
});

describe('ApprovalDetailDrawer receivable write-off review', () => {
  const writeOffApproval = {
    id: '191',
    type: 'receivable_write_off',
    requestedBy: 'Collection Manager',
    department: 'Collections',
    amount: 30,
    amountLabel: 'BDT 30.00',
    reason: 'Repeated documented follow-ups did not produce payment.',
    submittedAt: '2026-07-23T04:00:00Z',
    risk: 'high',
    status: 'pending',
    referenceLabel: 'INV-101',
    isActionable: true,
    approvalCount: 0,
    requiredApprovals: 2,
    remainingApprovals: 2,
    approvalStage: 'Pending (0/2)',
    requestData: {
      amountMinor: 3000,
      currencyCode: 'BDT',
      liveDueMinorAtRequest: 8000,
      authorityModeAtRequest: 'legacy',
      reasonCode: 'uncollectible',
      note: 'Repeated documented follow-ups did not produce payment.',
      evidenceUrls: ['https://evidence.example/write-off/191'],
      source: { sourceType: 'invoice', legacyBillId: 101 },
      sourceEvidence: {
        sourceKey: 'legacy-bill:101',
        invoiceNumber: 'INV-101',
        patientId: 1,
        totalMinor: 10000,
        paidMinor: 2000,
        creditedMinor: 0,
        dueMinor: 8000,
        financialStatus: 'open',
      },
    },
  } as const;

  it('shows authority, live due, source, evidence, and maker-checker safeguards', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{
          ...writeOffApproval,
          canCurrentUserApprove: false,
          approvalBlockedReason: 'You cannot approve your own request',
        } as any}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/Receivable Write-off/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Write-off Review Evidence')).toBeInTheDocument();
    expect(screen.getAllByText(/BDT.*30\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/BDT.*80\.00/)).toBeInTheDocument();
    expect(screen.getByText('Legacy authority')).toBeInTheDocument();
    expect(screen.getAllByText('INV-101').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Evidence 1' })).toHaveAttribute('href', 'https://evidence.example/write-off/191');
    expect(screen.getAllByText(/two independent approvals/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/cannot approve your own request/i).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /write off now/i })).not.toBeInTheDocument();
  });

  it('offers an explicit retry action for a fully-approved write-off with failed execution', () => {
    const onApprove = vi.fn();
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{
          ...writeOffApproval,
          status: 'approved',
          isActionable: true,
          executionStatus: 'failed',
          executionError: 'Live due changed before execution',
          approvalCount: 2,
          remainingApprovals: 0,
          approvalStage: 'Fully Approved (2/2)',
          canCurrentUserApprove: true,
          approvalBlockedReason: null,
        } as any}
        onApprove={onApprove}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getByText('Live due changed before execution')).toBeInTheDocument();
    expect(screen.getByText(/retry uses the approved amount/i)).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: 'Retry execution' });
    expect(retryButton).not.toBeDisabled();
  });
});

describe('ApprovalDetailDrawer cash handover decisions', () => {
  it('enables approval when receiver-count system evidence is provided', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{ ...cashHandoverApproval, evidenceRequired: true, evidenceStatus: 'provided' }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onRequestInfo={vi.fn()}
      />,
    );

    expect(screen.getByText('Decision Checklist')).toBeInTheDocument();
    expect(screen.getByText('Request Summary')).toBeInTheDocument();

    const approveButtons = screen.getAllByRole('button', { name: 'Record first approval' });
    expect(approveButtons.length).toBeGreaterThan(0);
    expect(approveButtons.every((button) => !button.hasAttribute('disabled'))).toBe(true);
  });

  it('treats missing handover evidence as a warning instead of an approval blocker', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{ ...cashHandoverApproval, evidenceRequired: true, evidenceStatus: 'missing' }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onRequestInfo={vi.fn()}
      />,
    );

    expect(screen.getAllByText(/warning, not an approval blocker/i).length).toBeGreaterThanOrEqual(1);
    const approveButtons = screen.getAllByRole('button', { name: 'Record first approval' });
    expect(approveButtons.every((button) => !button.hasAttribute('disabled'))).toBe(true);
    expect(screen.queryByRole('button', { name: /return for correction/i })).toBeNull();
  });

  it('keeps Return for correction available for a core cash approval request', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{ ...cashHandoverApproval, source: 'approval_requests', evidenceRequired: true, evidenceStatus: 'missing' }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onRequestInfo={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('button', { name: /return for correction/i }).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/warning, not an approval blocker/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows one-of-two progress and blocks the same reviewer from approving twice', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{
          ...cashHandoverApproval,
          source: 'approval_requests',
          status: 'partially_approved',
          approvalCount: 1,
          requiredApprovals: 2,
          remainingApprovals: 1,
          approvalStage: 'Partially Approved (1/2)',
          currentUserApproved: true,
          canCurrentUserApprove: false,
          approvalBlockedReason: 'You already approved this request',
        }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(screen.getAllByText('Partially Approved (1/2)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('You already approved this request').length).toBeGreaterThanOrEqual(1);
    const approveButtons = screen.getAllByRole('button', { name: /Approve|approval/i });
    expect(approveButtons.every((button) => button.hasAttribute('disabled'))).toBe(true);
  });
});

describe('ApprovalDetailDrawer executed refund review UX', () => {
  it('separates executed refund state from revision-aware two-person review progress', () => {
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{
          id: '83',
          type: 'refund',
          requestedBy: 'Rina',
          department: 'Billing',
          amount: 800,
          reason: 'Service was not performed',
          submittedAt: '2026-07-26T10:00:00Z',
          risk: 'high',
          status: 'pending',
          reference: 'Approval #83',
          approvalRevision: 2,
          approvalCount: 1,
          requiredApprovals: 2,
          remainingApprovals: 1,
          currentUserApproved: false,
          canCurrentUserApprove: true,
          executionStatus: 'succeeded',
          requestData: {
            executionMode: 'executed_pending',
            financialState: 'refunded_pending_review',
            cashReturnEligible: true,
            creditNoteNo: 'CN-000083',
          },
          cashHold: {
            id: 9,
            amount: 800,
            status: 'consumed',
            counterSessionId: 17,
            heldAt: null,
            consumedAt: '2026-07-26T10:01:00Z',
            releasedAt: null,
            creditNoteId: 8,
          },
        }}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        onRequestInfo={vi.fn()}
      />,
    );

    expect(screen.getByText('Refund completed — awaiting review')).toBeInTheDocument();
    expect(screen.getByText('Revision 2')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Approval progress 1 of 2' })).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByText('First approval recorded')).toBeInTheDocument();
    expect(screen.getByText('Final approval pending')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Give final approval' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Return for correction' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Reject & reverse refund' })).toHaveLength(1);
  });

  it('opens structured return and rejection dialogs instead of generic note mode', () => {
    const onReject = vi.fn();
    const onRequestInfo = vi.fn();
    render(
      <ApprovalDetailDrawer
        open
        onClose={vi.fn()}
        approval={{
          id: '84',
          type: 'refund',
          requestedBy: 'Rina',
          department: 'Billing',
          amount: 400,
          reason: 'Duplicate service',
          submittedAt: '2026-07-26T10:00:00Z',
          risk: 'medium',
          status: 'pending',
          reference: 'Approval #84',
          approvalRevision: 3,
          approvalCount: 1,
          requiredApprovals: 2,
          executionStatus: 'succeeded',
          requestData: {
            executionMode: 'executed_pending',
            financialState: 'refunded_pending_review',
            cashReturnEligible: true,
          },
        }}
        onApprove={vi.fn()}
        onReject={onReject}
        onRequestInfo={onRequestInfo}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Return for correction' }));
    expect(screen.getByRole('dialog', { name: 'Return for correction' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Attach corrected receipt.' } });
    fireEvent.change(screen.getByLabelText('Required corrections or evidence'), { target: { value: 'Corrected receipt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Return and start revision 4' }));
    expect(onRequestInfo).toHaveBeenCalledWith('84', {
      notes: 'Attach corrected receipt.',
      missingItems: ['Corrected receipt'],
    });

    fireEvent.click(screen.getByRole('button', { name: 'Reject & reverse refund' }));
    expect(screen.getByRole('radio', { name: /cash already returned/i })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Rejection reason'), { target: { value: 'Refund was not justified.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reject and reverse refund' }));
    expect(onReject).toHaveBeenCalledWith('84', {
      notes: 'Refund was not justified.',
      cashResolution: 'open_dispute',
      cashReturnedAcknowledged: false,
      idempotencyKey: 'refund-reject:84:r3',
    });
  });
});
