import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HospitalProfile from './HospitalProfile';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', () => ({ useParams: () => ({ slug: 'city-hospital' }) }));
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({ queryKeys: { admin: { hospitalProfile: () => ['admin', 'hospital-profile'] } } }));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

describe('HospitalProfile', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('wraps in DashboardLayout', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<HospitalProfile />);
    expect(screen.getByTestId('layout')).toBeTruthy();
  });

  it('shows loading when loading', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: true });
    render(<HospitalProfile />);
    expect(screen.getByText('Loading...')).toBeTruthy();
  });

  it('renders page title', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<HospitalProfile />);
    expect(screen.getByText('Hospital Profile')).toBeTruthy();
  });

  it('renders Basic Information section', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<HospitalProfile />);
    expect(screen.getByText('Basic Information')).toBeTruthy();
    expect(screen.getByText('Hospital Name')).toBeTruthy();
    expect(screen.getByText('Address')).toBeTruthy();
    expect(screen.getByText('Hotline')).toBeTruthy();
  });

  it('renders Quick Stats section', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    render(<HospitalProfile />);
    expect(screen.getByText('Quick Stats')).toBeTruthy();
    expect(screen.getByText('Branches')).toBeTruthy();
    expect(screen.getByText('Departments')).toBeTruthy();
    expect(screen.getByText('Beds')).toBeTruthy();
  });

  it('displays hospital data', () => {
    (useApiQuery as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { name: 'City Hospital', address: '123 Main St', hotline: '12345', email: 'test@test.com', website: 'city.com', registrationNumber: 'REG-001', logo: '', branchCount: 3, departmentCount: 12, bedCount: 100, establishedYear: 2020 },
      isLoading: false,
    });
    render(<HospitalProfile />);
    expect(screen.getByText('City Hospital')).toBeTruthy();
    expect(screen.getByText('123 Main St')).toBeTruthy();
  });
});
