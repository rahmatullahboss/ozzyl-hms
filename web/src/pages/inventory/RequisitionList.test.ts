import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import RequisitionList from './RequisitionList';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
}));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { inventory: { requisitions: (filters: unknown) => ['inventory', 'requisitions', filters] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement('div', { 'data-testid': 'layout' }, children),
}));

function PathProbe() {
  const location = useLocation();
  return React.createElement('span', { 'data-testid': 'path' }, location.pathname);
}

describe('RequisitionList', () => {
  beforeEach(() => vi.clearAllMocks());

  it('exports a valid React component', async () => {
    const mod = await import('./RequisitionList');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('does not show fake fallback requisitions when API has no rows', () => {
    (useApiQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { data: [], pagination: { total: 0 } },
      isLoading: false,
    });

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/h/city-hospital/inventory/purchase'] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: '/h/:slug/inventory/purchase',
            element: React.createElement(RequisitionList),
          }),
        ),
      ),
    );

    expect(screen.getByText('No requisitions found')).toBeInTheDocument();
    expect(screen.queryByText('REQ-001')).not.toBeInTheDocument();
    expect(screen.queryByText('OT Store')).not.toBeInTheDocument();
  });

  it('uses tenant-aware link for the create route', () => {
    (useApiQuery as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        data: [
          { RequisitionId: 7, RequisitionNo: 'REQ-007', RequisitionDate: '2026-07-05', RequestingStoreName: 'Lab Store', RequisitionStatus: 'pending', Priority: 'normal' },
        ],
        pagination: { total: 1 },
      },
      isLoading: false,
    });

    render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/h/city-hospital/inventory/purchase'] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: '/h/:slug/inventory/purchase',
            element: React.createElement(
              React.Fragment,
              null,
              React.createElement(RequisitionList),
              React.createElement(PathProbe),
            ),
          }),
          React.createElement(Route, {
            path: '/h/:slug/inventory/requisitions/new',
            element: React.createElement(PathProbe),
          }),
        ),
      ),
    );

    fireEvent.click(screen.getByRole('link', { name: /New Requisition/i }));
    expect(screen.getByTestId('path')).toHaveTextContent('/h/city-hospital/inventory/requisitions/new');
  });
});
