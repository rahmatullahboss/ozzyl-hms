import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import SystemAuditLog from './SystemAuditLog';
import { useApiQuery } from '../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') return fallback;
      if (fallback && typeof fallback === 'object' && typeof fallback.defaultValue === 'string') {
        return fallback.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en' },
  }),
}));
vi.mock('react-router', () => ({
  Link: ({ children, to }: any) => React.createElement('a', { href: to }, children),
  useParams: () => ({ slug: 'city-hospital' }),
}));
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => React.createElement('div', { 'data-testid': 'layout' }, children) }));

describe('SystemAuditLog', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./SystemAuditLog');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('renders real auditLogs response as readable activity instead of demo rows', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        auditLogs: [
          {
            id: 21,
            user_id: 7,
            user_name: 'Audit Supervisor',
            action: 'CANCEL',
            table_name: 'bills',
            record_id: 5522,
            old_value: JSON.stringify({ status: 'open', total: 2500 }),
            new_value: JSON.stringify({ status: 'cancelled', reason: 'Wrong patient' }),
            ip_address: '127.0.0.1',
            created_at: '2026-06-05T10:15:00Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as any);

    render(React.createElement(SystemAuditLog, { role: 'hospital_admin' }));

    expect(screen.getAllByText('Audit Supervisor').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cancelled').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Invoice/Bill').length).toBeGreaterThan(0);
    expect(screen.getAllByText('#5522').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Wrong patient/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Dr. Aminur Rahman')).not.toBeInTheDocument();
  });

  it('groups audit activity into cash vs other using the shared 2-group classifier', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: {
        auditLogs: [
          {
            id: 21,
            user_id: 7,
            user_name: 'Audit Supervisor',
            action: 'CREATE',
            table_name: 'cash_drawer_movements',
            record_id: 42,
            old_value: null,
            new_value: JSON.stringify({ movementType: 'cash_out', amount: 1600, reason: 'adjust' }),
            ip_address: '127.0.0.1',
            created_at: '2026-06-05T10:15:00Z',
          },
          {
            id: 22,
            user_id: 8,
            user_name: 'Admin User',
            action: 'UPDATE',
            table_name: 'settings',
            record_id: 3,
            old_value: JSON.stringify({ sms: false }),
            new_value: JSON.stringify({ sms: true }),
            ip_address: '127.0.0.1',
            created_at: '2026-06-05T11:15:00Z',
          },
        ],
      },
      isLoading: false,
      isError: false,
    } as any);

    render(React.createElement(SystemAuditLog, { role: 'hospital_admin' }));

    expect(screen.getByText('Cash & Transactions')).toBeInTheDocument();
    expect(screen.getByText('Other Activity')).toBeInTheDocument();
    expect(screen.getAllByText('Cash Drawer Movement').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Amount: ৳1,600/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Settings').length).toBeGreaterThan(0);
  });
});
