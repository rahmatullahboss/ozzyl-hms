import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useApiQuery } from '../../hooks/useApiQuery';
import InvoiceInspector from './InvoiceInspector';
import type { InvoiceInspectorResponse } from '../../types/invoiceInspector';

vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));

const response: InvoiceInspectorResponse = {
  summary: {
    billId: 92,
    invoiceNo: 'INV-92',
    status: 'partially_paid',
    patientId: 41,
    patientName: 'Patient One',
    patientCode: 'P-41',
    patientIdentityRedacted: false,
    createdAt: '2026-07-30 10:00:00',
    billType: 'opd',
    grossAmount: 1200,
    discountAmount: 200,
    netAmount: 1000,
    paidAmount: 600,
    depositAppliedAmount: 200,
    dueAmount: 200,
  },
  items: [],
  payments: [],
  deposits: [],
  discounts: [],
  compensation: [],
  audit: [],
  reconciliation: {
    invoice: {
      grossAmount: 1200,
      discountAmount: 200,
      expectedNetAmount: 1000,
      netAmount: 1000,
      difference: 0,
      status: 'reconciled',
    },
    settlement: {
      paymentAmount: 600,
      depositAppliedAmount: 200,
      settledAmount: 800,
      expectedSettledAmount: 800,
      dueAmount: 200,
      difference: 0,
      status: 'reconciled',
    },
    compensation: {
      payableAmount: 0,
      paidAmount: 0,
      outstandingAmount: 0,
      difference: 0,
      status: 'reconciled',
    },
  },
  warnings: [],
  actions: {
    fullBillingUrl: '/api/billing/92',
    printUrl: '/api/pdf/bill/92',
    pdfUrl: '/api/pdf/bill/92',
  },
};

function queryResult(overrides: Record<string, unknown> = {}) {
  return {
    data: response,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    isPlaceholderData: false,
    ...overrides,
  };
}

function renderInspector(props: Partial<React.ComponentProps<typeof InvoiceInspector>> = {}) {
  const onClose = vi.fn();
  const rendered = render(<InvoiceInspector billId={92} onClose={onClose} {...props} />);
  return { ...rendered, onClose };
}

describe('InvoiceInspector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue(queryResult() as never);
  });

  it('fetches the composite inspector endpoint and renders summary evidence', () => {
    renderInspector();
    expect(useApiQuery).toHaveBeenCalledWith(
      ['billing', 'invoiceInspector', 92],
      '/api/billing/92/inspector',
      expect.objectContaining({ enabled: true, placeholderData: undefined }),
    );
    expect(screen.getByRole('dialog', { name: 'Invoice inspector INV-92' })).toBeInTheDocument();
    expect(screen.getByText('Patient One')).toBeInTheDocument();
    expect(screen.getByText('P-41')).toBeInTheDocument();
    expect(screen.getByText(/BDT\s*1,200\.00/)).toBeInTheDocument();
    expect(screen.getAllByText(/BDT\s*200\.00/).length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText(/BDT\s*1,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/BDT\s*600\.00/)).toBeInTheDocument();
    expect(screen.getByText('Invoice reconciled')).toBeInTheDocument();
    expect(screen.getByText('Settlement reconciled')).toBeInTheDocument();
  });

  it('shows tenant-scoped header actions and copy control', () => {
    renderInspector();
    expect(screen.getByRole('button', { name: 'Copy invoice number' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open full billing details' })).toHaveAttribute('href', '/api/billing/92');
    expect(screen.getByRole('link', { name: 'Print invoice' })).toHaveAttribute('href', '/api/pdf/bill/92');
    expect(screen.getByRole('link', { name: 'Open invoice PDF' })).toHaveAttribute('href', '/api/pdf/bill/92');
  });

  it('shows additive partial-source warnings without hiding valid summary', () => {
    vi.mocked(useApiQuery).mockReturnValue(queryResult({
      data: { ...response, warnings: ['Discount allocation source is unavailable.'] },
    }) as never);
    renderInspector();
    expect(screen.getByRole('status')).toHaveTextContent('Discount allocation source is unavailable.');
    expect(screen.getByText('Patient One')).toBeInTheDocument();
    expect(screen.getByText(/BDT\s*1,000\.00/)).toBeInTheDocument();
  });

  it('shows exact reconciliation differences', () => {
    vi.mocked(useApiQuery).mockReturnValue(queryResult({
      data: {
        ...response,
        reconciliation: {
          ...response.reconciliation,
          invoice: {
            ...response.reconciliation.invoice,
            difference: 100,
            status: 'warning',
          },
        },
      },
    }) as never);
    renderInspector();
    expect(screen.getByRole('alert')).toHaveTextContent(/Invoice differs by BDT\s+100\.00/);
  });

  it('renders loading, not-found, unauthorized, and retryable error states', () => {
    const refetch = vi.fn();
    vi.mocked(useApiQuery).mockReturnValue(queryResult({ data: undefined, isLoading: true }) as never);
    const { rerender } = render(<InvoiceInspector billId={92} onClose={vi.fn()} />);
    expect(screen.getByLabelText('Loading invoice inspector')).toBeInTheDocument();

    vi.mocked(useApiQuery).mockReturnValue(queryResult({
      data: undefined,
      isError: true,
      error: Object.assign(new Error('not found'), { status: 404 }),
    }) as never);
    rerender(<InvoiceInspector billId={92} onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Invoice 92 was not found');

    vi.mocked(useApiQuery).mockReturnValue(queryResult({
      data: undefined,
      isError: true,
      error: Object.assign(new Error('forbidden'), { status: 403 }),
    }) as never);
    rerender(<InvoiceInspector billId={92} onClose={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('You do not have permission to view this invoice');

    vi.mocked(useApiQuery).mockReturnValue(queryResult({
      data: undefined,
      isError: true,
      error: new Error('network'),
      refetch,
    }) as never);
    rerender(<InvoiceInspector billId={92} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry invoice inspector' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('moves focus inside, closes with Escape, and restores trigger focus', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Invoice trigger';
    document.body.appendChild(trigger);
    trigger.focus();
    const { onClose, unmount } = renderInspector();
    expect(screen.getByRole('button', { name: 'Close invoice inspector' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it('traps keyboard focus inside the inspector', () => {
    renderInspector();
    const close = screen.getByRole('button', { name: 'Close invoice inspector' });
    const panel = screen.getByRole('tabpanel');

    panel.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(close).toHaveFocus();

    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(panel).toHaveFocus();
  });

  it('supports accessible tab semantics and arrow-key navigation', () => {
    renderInspector();
    for (const tab of ['Summary', 'Items / Tests', 'Payments', 'Discount / Referral', 'Compensation', 'Audit']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
    }
    const summaryTab = screen.getByRole('tab', { name: 'Summary' });
    expect(summaryTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(summaryTab, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Items / Tests' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('No invoice items or tests were found.')).toBeInTheDocument();
  });

  it('uses a full-screen mobile sheet with a bounded desktop drawer', () => {
    renderInspector();
    expect(screen.getByTestId('invoice-inspector-sheet')).toHaveClass('w-full', 'max-w-none', 'sm:max-w-5xl');
    expect(screen.getByTestId('invoice-inspector-sheet')).toHaveClass('min-h-dvh', 'sm:min-h-0');
  });
});
