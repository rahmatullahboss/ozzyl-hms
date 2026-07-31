import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminModuleCatalog from './AdminModuleCatalog';

const navigateMock = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) =>
      k === 'adminModuleCatalog.modulesCount' && opts?.count != null
        ? `${opts.count} modules`
        : k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useParams: () => ({ slug: 'city-hospital' }),
  };
});

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('AdminModuleCatalog', () => {
  it('lists blueprint admin setup modules and specialized software modules', () => {
    render(<AdminModuleCatalog role="hospital_admin" />);

    expect(screen.getByRole('heading', { name: 'adminModuleCatalog.title' })).toBeInTheDocument();
    expect(screen.getByText('adminModuleCatalog.blueprintCoverage')).toBeInTheDocument();
    expect(screen.getByText('adminModuleCatalog.specializedModulesTitle')).toBeInTheDocument();

    const blueprint = screen.getByRole('region', { name: 'adminModuleCatalog.blueprintCoverage' });
    [
      'Hospital Profile',
      'Users & Roles',
      'Permission Matrix',
      'Service & Pricing',
      'Billing Settings',
      'Lab Test & Report Setup',
      'Print Template Settings',
      'Audit Log',
      'Backup & Restore',
      'Setup Wizard',
    ].forEach((label) => {
      expect(within(blueprint).getByText(label)).toBeInTheDocument();
    });

    const specialized = screen.getByRole('region', { name: 'adminModuleCatalog.specializedModulesTitle' });
    [
      'Dental',
      'Surgery / OT',
      'Emergency & MLC',
      'Radiology',
      'Vaccination',
      'Maternity',
      'Psychiatry',
      'Blood Bank',
      'Ambulance',
      'Inventory',
      'Insurance',
      'Telemedicine',
    ].forEach((label) => {
      expect(within(specialized).getByText(label)).toBeInTheDocument();
    });
  }, 10000);

  it('filters modules and opens their admin route', () => {
    render(<AdminModuleCatalog role="hospital_admin" />);

    fireEvent.change(screen.getByRole('searchbox', { name: /adminModuleCatalog.searchAriaLabel/i }), {
      target: { value: 'dental' },
    });

    expect(screen.getByText('Dental')).toBeInTheDocument();
    expect(screen.queryByText('Radiology')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open dental/i }));
    expect(navigateMock).toHaveBeenCalledWith('/h/city-hospital/dental');
  });
});
