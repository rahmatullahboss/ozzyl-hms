import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BillCancellationPage from './BillCancellationPage';
import { api } from '../lib/apiClient';
import { useApiMutation, useApiQuery } from '../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const labels: Record<string, string> = {
        billCancellation: 'Bill Cancellation',
        cancelVoidBillingRecords: 'Cancel or void billing records',
        cancelBill: 'Cancel Bill',
        totalCancellations: 'Total cancellations',
        today: 'Today',
        amountCancelled: 'Amount cancelled',
        invoice: 'Invoice',
        patient: 'Patient',
        amount: 'Amount',
        cancellationReason: 'Cancellation reason',
        cancelledBy: 'Cancelled by',
        date: 'Date',
        noCancellations: 'No cancellations',
        noCancellationsDesc: 'No cancelled bills yet',
        warningIrreversible: 'Cancellation is irreversible',
        billIdRequired: 'Bill ID',
        billIdPlaceholder: 'Enter bill ID',
        reason: 'Reason',
        reasonPlaceholder: 'Enter reason',
        additionalRemarks: 'Additional remarks',
        confirmCancellation: 'Confirm cancellation',
        cancelling: 'Cancelling',
        checkBill: 'Check Bill',
        checkingBill: 'Checking bill',
        paidBillCreditNoteTitle: 'Paid bill: issue credit note',
        paidBillCreditNoteDesc: 'This bill already has payment. Do not cancel it directly; issue a credit note/refund instead.',
        issueCreditNote: 'Issue Credit Note',
      };
      if (key === 'cancel') return 'Cancel';
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('react-router', () => ({
  useParams: () => ({ slug: 'city-hospital' }),
}));

vi.mock('../lib/apiClient', () => ({
  api: { get: vi.fn() },
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../components/dashboard/KPICard', () => ({
  default: ({ title, value }: { title: string; value: ReactNode }) => <div>{title}: {value}</div>,
}));

vi.mock('../components/dashboard/EmptyState', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

describe('BillCancellationPage', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({ data: { cancellations: [] }, isLoading: false } as never);
    vi.mocked(useApiMutation).mockReturnValue({ mutate, isPending: false } as never);
  });

  it('exports a valid React component', () => {
    expect(BillCancellationPage).toBeDefined();
    expect(typeof BillCancellationPage).toBe('function');
  });

  it('routes paid bills to credit note instead of direct cancellation', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      bill: { id: 42, paid_amount: 500, invoice_no: 'INV-42' },
    });

    render(<BillCancellationPage role="hospital_admin" />);

    await userEvent.click(screen.getByRole('button', { name: /cancel bill/i }));
    await userEvent.type(screen.getByLabelText(/bill id/i), '42');
    await userEvent.click(screen.getByRole('button', { name: /check bill/i }));

    expect(await screen.findByText('Paid bill: issue credit note')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /issue credit note/i })).toHaveAttribute(
      'href',
      '/h/city-hospital/credit-notes?billId=42&new=1',
    );
    expect(screen.queryByRole('button', { name: /confirm cancellation/i })).not.toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });
});
