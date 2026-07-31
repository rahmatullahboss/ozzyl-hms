import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

import ApprovalDecisionDialog from './ApprovalDecisionDialog';

describe('ApprovalDecisionDialog', () => {
  it('returns an approval for correction with an explicit revision reset warning', async () => {
    const onConfirm = vi.fn();
    const trigger = document.createElement('button');
    trigger.textContent = 'Trigger';
    document.body.appendChild(trigger);
    trigger.focus();

    const { rerender } = render(
      <ApprovalDecisionDialog
        open
        mode="return"
        approvalId="55"
        approvalRevision={2}
        approvalCount={1}
        requiredApprovals={2}
        executedRefund
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Return for correction' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText(/current 1\/2 approval will be superseded/i)).toBeInTheDocument();
    expect(screen.getByText(/revision 3 will restart at 0\/2/i)).toBeInTheDocument();
    expect(screen.getByText(/completed refund remains financially recorded/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Correction reason')).toHaveFocus());

    fireEvent.change(screen.getByLabelText('Correction reason'), {
      target: { value: 'Attach the corrected cashier acknowledgement.' },
    });
    fireEvent.change(screen.getByLabelText('Required corrections or evidence'), {
      target: { value: 'Cashier acknowledgement\nCorrected receipt' },
    });
    const submit = screen.getByRole('button', { name: 'Return and start revision 3' });
    expect(submit).toHaveClass('min-h-11');
    fireEvent.click(submit);

    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'return',
      notes: 'Attach the corrected cashier acknowledgement.',
      missingItems: ['Cashier acknowledgement', 'Corrected receipt'],
    });

    rerender(
      <ApprovalDecisionDialog
        open={false}
        mode="return"
        approvalId="55"
        approvalRevision={2}
        approvalCount={1}
        requiredApprovals={2}
        executedRefund
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('defaults executed-refund rejection to a dispute and emits a stable idempotency key', () => {
    const onConfirm = vi.fn();
    render(
      <ApprovalDecisionDialog
        open
        mode="reject"
        approvalId="83"
        approvalRevision={1}
        approvalCount={0}
        requiredApprovals={2}
        executedRefund
        cashReturnEligible={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByRole('radio', { name: /open cash-recovery dispute/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /cash already returned/i })).toBeDisabled();
    expect(screen.getByText(/refund will be financially reversed/i)).toBeInTheDocument();
    expect(screen.getByText(/no second cash-out/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Rejection reason'), {
      target: { value: 'Refund evidence is invalid.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Reject and reverse refund' }));

    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'reject',
      notes: 'Refund evidence is invalid.',
      cashResolution: 'open_dispute',
      cashReturnedAcknowledged: false,
      idempotencyKey: 'refund-reject:83:r1',
    });
  });

  it('requires acknowledgement before recording returned cash', () => {
    const onConfirm = vi.fn();
    render(
      <ApprovalDecisionDialog
        open
        mode="reject"
        approvalId="84"
        approvalRevision={3}
        approvalCount={1}
        requiredApprovals={2}
        executedRefund
        cashReturnEligible
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: /cash already returned/i }));
    fireEvent.change(screen.getByLabelText('Rejection reason'), {
      target: { value: 'Patient returned the cash.' },
    });
    const submit = screen.getByRole('button', { name: 'Reject and reverse refund' });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole('checkbox', { name: /physical cash was received and verified/i }));
    expect(submit).not.toBeDisabled();
    fireEvent.click(submit);

    expect(onConfirm).toHaveBeenCalledWith({
      mode: 'reject',
      notes: 'Patient returned the cash.',
      cashResolution: 'cash_returned',
      cashReturnedAcknowledged: true,
      idempotencyKey: 'refund-reject:84:r3',
    });
  });

  it('keeps a dirty form open on backdrop clicks and traps keyboard focus', () => {
    const onClose = vi.fn();
    render(
      <ApprovalDecisionDialog
        open
        mode="return"
        approvalId="86"
        approvalRevision={1}
        approvalCount={1}
        requiredApprovals={2}
        executedRefund
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText('Correction reason'), {
      target: { value: 'Correct the receipt.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close decision dialog backdrop' }));
    expect(onClose).not.toHaveBeenCalled();

    const closeButton = screen.getByRole('button', { name: 'Close decision dialog' });
    closeButton.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: 'Return and start revision 2' })).toHaveFocus();
  });

  it('closes on Escape and exposes a labelled 44px close target', () => {
    const onClose = vi.fn();
    render(
      <ApprovalDecisionDialog
        open
        mode="reject"
        approvalId="85"
        approvalRevision={1}
        approvalCount={0}
        requiredApprovals={2}
        executedRefund={false}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Close decision dialog' })).toHaveClass('min-h-11', 'min-w-11');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
