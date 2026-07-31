import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminKpiInvoiceModal from './AdminKpiInvoiceModal';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../invoice-inspector/InvoiceInspector', () => ({
  default: ({ billId, onClose }: { billId: number; onClose: () => void }) => (
    <div role="dialog" aria-label={`Inspector ${billId}`}>
      <span>{billId}</span>
      <button type="button" onClick={onClose}>Close inspector</button>
    </div>
  ),
}));

describe('AdminKpiInvoiceModal compatibility adapter', () => {
  it('renders the shared inspector without the legacy bill-detail query', () => {
    render(<AdminKpiInvoiceModal billId={348} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Inspector 348' })).toBeInTheDocument();
    expect(useApiQuery).not.toHaveBeenCalled();
  });

  it('forwards close to the shared inspector', () => {
    const onClose = vi.fn();
    render(<AdminKpiInvoiceModal billId={349} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close inspector' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
