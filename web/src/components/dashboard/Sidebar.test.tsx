import { readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Sidebar from './Sidebar';

const labels: Record<string, string> = {
  printLayouts: 'Print Templates',
  printTemplates: 'Print Templates',
  servicesPricing: 'Services & Pricing',
  systemPreferences: 'System Preferences',
  profile: 'Profile',
  labResults: 'Lab Results',
  reportReview: 'Report Review',
  prescriptions: 'Prescriptions',
  schedule: 'Schedule',
  certificates: 'Certificates',
  referrals: 'Referrals',
  billingCounter: 'Billing Counter',
  cashOperations: 'Cash Operations',
  shiftReportPrint: 'Shift Report Print',
  admissions: 'Admissions',
  accounting: 'Accounting',
  accessControl: 'Access Control',
  staff: 'Staff',
  dutyMonitor: 'Duty Monitor',
  patients: 'Patients',
  reports: 'Reports',
  managerOverview: 'Manager Overview',
  labDashboard: 'Lab Dashboard',
  labOrders: 'Lab Orders',
  inventoryDashboard: 'Inventory Dashboard',
  pendingApprovals: 'Pending Review',
  signOut: 'Sign out',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => labels[key] ?? opts?.defaultValue ?? key,
  }),
}));

vi.mock('../../hooks/usePrefetch', () => ({ usePrefetch: () => vi.fn() }));
vi.mock('../../hooks/useAuth', () => ({
  getTenant: () => ({ name: 'City Care Hospital', slug: 'city-hospital' }),
}));
vi.mock('../../lib/apiClient', () => ({
  apiFetch: vi.fn(async () => ({ hospital_info: { name: 'City Care Hospital' } })),
}));

describe('Sidebar', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    window.sessionStorage.clear();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('exposes the admin settings control-room structure for hospital admins', async () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role="hospital_admin" permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    // The admin sidebar was restructured in 58b1658a — there's no longer an "Admin Settings"
    // accordion parent. The settings live in the `groupSettings` group with top-level items.
    // Verify that the settings group items are rendered as direct links instead.
    [
      'Services & Pricing',
      'Print Templates',
      'System Preferences',
      'Duty Monitor',
      'Patients',
    ].forEach((label) => {
      expect(screen.getAllByRole('link', { name: label }).length).toBeGreaterThan(0);
    });

    expect(screen.getByRole('link', { name: 'System Preferences' })).toHaveAttribute('href', '/h/city-hospital/settings/preferences');
    expect(screen.getByRole('link', { name: 'Duty Monitor' })).toHaveAttribute('href', '/h/city-hospital/monitor/operations');
    expect(screen.getByRole('link', { name: 'Patients' })).toHaveAttribute('href', '/h/city-hospital/patients');
    expect(screen.getByRole('link', { name: 'Software Modules' })).toHaveAttribute('href', '/h/city-hospital/software-modules');

    const duplicateKeyWarnings = consoleErrorSpy.mock.calls.filter(([message]) =>
      String(message).includes('same key'),
    );
    expect(duplicateKeyWarnings).toHaveLength(0);
  }, 10_000);

  it('shows one direct Inventory Dashboard link for hospital admins', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role="hospital_admin" permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const inventoryLinks = screen.getAllByRole('link', { name: 'Inventory Dashboard' });
    expect(inventoryLinks).toHaveLength(1);
    expect(inventoryLinks[0]).toHaveAttribute('href', '/h/city-hospital/inventory');
  });

  it('shows a Profile link in the sidebar footer for hospital_admin', async () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role="hospital_admin" permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const profileLink = screen.getAllByRole('link', { name: 'Profile' }).find((link) => link.getAttribute('href') === '/h/city-hospital/profile');
    expect(profileLink).toBeInTheDocument();
    expect(profileLink).toHaveAttribute('href', '/h/city-hospital/profile');
  });

  it('renders admin group headings through translations instead of raw keys', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role="hospital_admin" permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText('Control Center')).toBeInTheDocument();
    expect(screen.getByText('Reagent & Stock')).toBeInTheDocument();
    expect(screen.queryByText('groupStarterControl')).not.toBeInTheDocument();
    expect(screen.queryByText('groupReagentStock')).not.toBeInTheDocument();
  });

  it('shows Cash Operations as a top-level reception shortcut after Billing Counter', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/reception/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role="reception" permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const navigation = screen.getByRole('navigation', { name: 'Main navigation' });
    const links = within(navigation).getAllByRole('link');
    const linkNames = links.map((link) => link.textContent?.trim());

    expect(screen.getByRole('link', { name: 'Cash Operations' })).toHaveAttribute(
      'href',
      '/h/city-hospital/reception/cash-operations',
    );
    expect(linkNames.indexOf('Cash Operations')).toBeGreaterThan(-1);
    expect(linkNames.indexOf('Cash Operations')).toBe(linkNames.indexOf('Billing Counter') + 1);
    expect(linkNames.indexOf('Cash Operations')).toBe(linkNames.indexOf('Admissions') - 1);
  });

  it('shows a direct receptionist shift report print shortcut in the sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/reception/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role="reception" permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Shift Report Print' })).toHaveAttribute(
      'href',
      '/h/city-hospital/reception/reports/pdf?report=shiftHandover',
    );
  });

  it('keeps collapsed accordion icon buttons accessible by label', () => {
    const source = readFileSync('src/components/dashboard/Sidebar.tsx', 'utf8');
    const collapsedBlock = source.slice(
      source.indexOf('if (collapsed) {'),
      source.indexOf('<div className="pointer-events-none absolute left-full'),
    );

    expect(collapsedBlock).toContain('title={itemLabel(item.labelKey)}');
    expect(collapsedBlock).toContain('aria-label={itemLabel(item.labelKey)}');
  });

  it('keeps manager sidebar scoped to manager, reception, and lab workspaces only', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={(
              <Sidebar
                role="manager"
                permissions={[
                  'dashboard:read',
                  'patients:read',
                  'appointments:read',
                  'billing:read',
                  'tests:read',
                  'tests:write',
                  'accounting:read',
                  'staff:read',
                  'reports:read',
                ]}
                onLogout={vi.fn()}
              />
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Billing Counter' })).toHaveAttribute(
      'href',
      '/h/city-hospital/reception/billing-counter',
    );
    expect(screen.getByRole('link', { name: 'Cash Operations' })).toHaveAttribute(
      'href',
      '/h/city-hospital/reception/cash-operations',
    );
    expect(screen.getByRole('link', { name: 'Manager Overview' })).toHaveAttribute(
      'href',
      '/h/city-hospital/manager/dashboard',
    );
    expect(screen.getByRole('link', { name: 'Lab Dashboard' })).toHaveAttribute(
      'href',
      '/h/city-hospital/lab/dashboard',
    );
    expect(screen.getByRole('link', { name: 'Lab Orders' })).toHaveAttribute(
      'href',
      '/h/city-hospital/lab/orders',
    );
    expect(screen.queryByRole('link', { name: 'Accounting' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Staff' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Reports' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'System Preferences' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Print Templates' })).not.toBeInTheDocument();
  });

  it('exposes the expanded clinical navigation for doctors', () => {
    render(
      <MemoryRouter initialEntries={['/h/city-hospital/doctor/dashboard']}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role="doctor" permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Lab Results' })).toHaveAttribute('href', '/h/city-hospital/doctor/lab-results');
    expect(screen.getByRole('link', { name: 'Report Review' })).toHaveAttribute('href', '/h/city-hospital/doctor/report-review');
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveAttribute('href', '/h/city-hospital/doctor-schedule');
    expect(screen.getByRole('link', { name: 'Certificates' })).toHaveAttribute('href', '/h/city-hospital/doctor/certificates');
    expect(screen.getByRole('link', { name: 'Referrals' })).toHaveAttribute('href', '/h/city-hospital/doctor/referrals');
  });

  it.each([
    ['md', '/h/city-hospital/md/pending-approvals'],
    ['director', '/h/city-hospital/director/pending-approvals'],
  ] as const)('shows Pending Review for %s', (role, href) => {
    render(
      <MemoryRouter initialEntries={[`/h/city-hospital/${role}/dashboard`]}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role={role} permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Pending Review' })).toHaveAttribute('href', href);
  });

  it.each([
    'super_admin',
    'hospital_admin',
    'laboratory',
    'reception',
    'md',
    'director',
    'pharmacist',
    'doctor',
    'nurse',
    'accountant',
  ] as const)('shows a Profile link for the %s role', (role) => {
    render(
      <MemoryRouter initialEntries={[`/h/city-hospital/${role}/dashboard`]}>
        <Routes>
          <Route
            path="/h/:slug/*"
            element={<Sidebar role={role} permissions={['*']} onLogout={vi.fn()} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    const profileLink = screen.getAllByRole('link', { name: 'Profile' }).find((link) => link.getAttribute('href') === '/h/city-hospital/profile');
    expect(profileLink).toBeInTheDocument();
    expect(profileLink).toHaveAttribute('href', '/h/city-hospital/profile');
  });
});
