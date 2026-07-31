import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import Breadcrumbs from './Breadcrumbs';

describe('Breadcrumbs', () => {
  it('exports a valid React component', async () => {
    const mod = await import('./Breadcrumbs');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('builds tenant breadcrumb links from the hospital slug', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-care/settings/billing']}>
        <Routes>
          <Route path="/h/:slug/*" element={<Breadcrumbs />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Home')).toHaveAttribute('href', '/h/city-care/dashboard');
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/h/city-care/settings');
  });

  it('uses scalar labels for legacy dues and canonical Collections breadcrumbs', () => {
    const { unmount } = render(
      <MemoryRouter initialEntries={['/h/city-care/cash/dues']}>
        <Routes>
          <Route path="/h/:slug/*" element={<Breadcrumbs />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Due Collection')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("returned an object instead of string");
    unmount();

    render(
      <MemoryRouter initialEntries={['/h/city-care/action/collections']}>
        <Routes>
          <Route path="/h/:slug/*" element={<Breadcrumbs />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Action Center')).toBeInTheDocument();
    expect(screen.getByText('Collections')).toBeInTheDocument();
    expect(screen.queryByText('Daily Collection')).not.toBeInTheDocument();
  });

  it('does not build /h/undefined links for super-admin routes', () => {
    render(
      <MemoryRouter initialEntries={['/super-admin/settings/audit']}>
        <Routes>
          <Route path="/super-admin/*" element={<Breadcrumbs />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Home')).toHaveAttribute('href', '/super-admin/dashboard');
    expect(screen.queryByRole('link', { name: /super admin/i })).toHaveAttribute('href', '/super-admin');
    expect(document.body.innerHTML).not.toContain('/h/undefined');
  });
});
