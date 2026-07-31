import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { RightPanel } from './RightPanel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_key: string, opts?: any) => opts?.defaultValue ?? _key }) }));

describe('RightPanel', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./RightPanel');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('shows diagnostic order billing status and invoice number', () => {
    render(
      <MemoryRouter>
        <RightPanel
          visitTypes={[]}
          recentRx={[]}
          followUps={[]}
          basePath="/h/demo"
          pendingOrders={[{
            id: 1,
            type: 'lab',
            order_no: 'LAB-1',
            ordered_at: '2026-06-17',
            patient_name: 'Rahim Uddin',
            patient_code: 'P-1',
            status: 'pending',
            billing_status: 'unpaid',
            bill_id: 77,
            invoice_no: 'INV-77',
            total: 500,
            due: 500,
          }]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('Billing pending')).toBeInTheDocument();
    expect(screen.getByText('INV-77')).toBeInTheDocument();
  });
});
