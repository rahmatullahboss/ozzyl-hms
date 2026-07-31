import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
} from 'react-router';
import { useInvoiceInspectorState } from './useInvoiceInspectorState';

function Harness() {
  const invoice = useInvoiceInspectorState();
  const location = useLocation();
  return (
    <div>
      <output data-testid="bill-id">{invoice.billId ?? 'closed'}</output>
      <output data-testid="location">{`${location.pathname}${location.search}`}</output>
      <button type="button" onClick={() => invoice.openInvoice(92)}>Open invoice 92</button>
      <button type="button" onClick={invoice.closeInvoice}>Close invoice</button>
    </div>
  );
}

function renderAt(initialEntries: string[]) {
  const router = createMemoryRouter([
    { path: '/h/:slug/dashboard', element: <Harness /> },
  ], { initialEntries });
  render(<RouterProvider router={router} />);
  return router;
}

describe('useInvoiceInspectorState', () => {
  it('opens an invoice from direct URL navigation', () => {
    renderAt(['/h/city-hospital/dashboard?tab=money&invoiceId=91']);
    expect(screen.getByTestId('bill-id')).toHaveTextContent('91');
  });

  it('opens and closes invoice state while preserving period and drill filters', () => {
    renderAt(['/h/city-hospital/dashboard?tab=doctors&range=custom&from=2026-07-01&to=2026-07-31&doctorId=17&testId=42']);
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice 92' }));
    expect(screen.getByTestId('bill-id')).toHaveTextContent('92');
    expect(screen.getByTestId('location')).toHaveTextContent('tab=doctors');
    expect(screen.getByTestId('location')).toHaveTextContent('range=custom');
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-07-01');
    expect(screen.getByTestId('location')).toHaveTextContent('to=2026-07-31');
    expect(screen.getByTestId('location')).toHaveTextContent('doctorId=17');
    expect(screen.getByTestId('location')).toHaveTextContent('testId=42');
    expect(screen.getByTestId('location')).toHaveTextContent('invoiceId=92');

    fireEvent.click(screen.getByRole('button', { name: 'Close invoice' }));
    expect(screen.getByTestId('bill-id')).toHaveTextContent('closed');
    expect(screen.getByTestId('location')).not.toHaveTextContent('invoiceId=');
    expect(screen.getByTestId('location')).toHaveTextContent('doctorId=17');
  });

  it('uses push history so Back closes and Forward reopens an invoice', async () => {
    const router = renderAt(['/h/city-hospital/dashboard?tab=money&range=7d']);
    fireEvent.click(screen.getByRole('button', { name: 'Open invoice 92' }));
    expect(screen.getByTestId('bill-id')).toHaveTextContent('92');

    await act(async () => { await router.navigate(-1); });
    expect(screen.getByTestId('bill-id')).toHaveTextContent('closed');
    expect(screen.getByTestId('location')).not.toHaveTextContent('invoiceId=');

    await act(async () => { await router.navigate(1); });
    expect(screen.getByTestId('bill-id')).toHaveTextContent('92');
    expect(screen.getByTestId('location')).toHaveTextContent('invoiceId=92');
  });

  it.each(['0', '-1', '1.5', 'abc'])('normalizes invalid invoice ID %s out of the URL', async (invoiceId) => {
    renderAt([`/h/city-hospital/dashboard?tab=money&range=7d&invoiceId=${invoiceId}&doctorId=17`]);
    expect(screen.getByTestId('bill-id')).toHaveTextContent('closed');
    await waitFor(() => {
      expect(screen.getByTestId('location')).not.toHaveTextContent('invoiceId=');
    });
    expect(screen.getByTestId('location')).toHaveTextContent('doctorId=17');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
  });
});
