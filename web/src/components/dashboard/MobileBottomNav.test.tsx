import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import MobileBottomNav from './MobileBottomNav';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      billing: 'Billing',
      cashControl: 'Cash',
      dashboard: 'Dashboard',
      patients: 'Patients',
      reagentControl: 'Reagent',
      more: 'More',
    }[key] ?? key),
  }),
}));

function PathProbe() {
  const location = useLocation();
  return <span data-testid="path">{location.pathname}</span>;
}

describe('MobileBottomNav', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./MobileBottomNav');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('routes manager billing shortcut to the reception billing counter when billing permission is granted', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={(
              <>
                <MobileBottomNav role="manager" permissions={['billing:read']} />
                <PathProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Billing' }));

    expect(screen.getByTestId('path')).toHaveTextContent('/h/city-hospital/reception/billing-counter');
  });

  it('routes hospital admin mobile shortcuts to billing, cash, and reagent control', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={(
              <>
                <MobileBottomNav role="hospital_admin" permissions={['*']} />
                <PathProbe />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Billing' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cash' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reagent' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Cash' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/h/city-hospital/cash/drawers');

    fireEvent.click(screen.getByRole('button', { name: 'Reagent' }));
    expect(screen.getByTestId('path')).toHaveTextContent('/h/city-hospital/lab/monitoring');
  });
});
