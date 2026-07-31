import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import CommandPalette from './CommandPalette';

function PathProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

describe('CommandPalette', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./CommandPalette');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('keeps manager commands scoped to manager, reception, and lab workspaces', async () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={(
              <>
                <CommandPalette role="manager" permissions={['dashboard:read', 'billing:read', 'tests:read', 'tests:write', 'staff:read', 'accounting:read', 'reports:read']} />
                <PathProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('option', { name: /staff/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /accounting/i })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('option', { name: /labDashboard/i }));

    expect(screen.getByTestId('path')).toHaveTextContent('/h/city-hospital/lab/dashboard');
  });

  it('routes super-admin commands inside /super-admin instead of /h/undefined', async () => {
    render(
      <MemoryRouter initialEntries={['/super-admin/settings']}>
        <Routes>
          <Route
            path="/super-admin/*"
            element={(
              <>
                <CommandPalette role="super_admin" permissions={[]} />
                <PathProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    fireEvent.click(await screen.findByRole('option', { name: /dashboard/i }));

    expect(screen.getByTestId('path')).toHaveTextContent('/super-admin/dashboard');
    expect(document.body.innerHTML).not.toContain('/h/undefined');
  });
});
