import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PatientRecordAccess from './PatientRecordAccess';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({
  __esModule: true,
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: '3rdParty' },
}));
vi.mock('../../lib/i18n', () => ({ default: { get language() { return 'en'; } } }));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  let params = new URLSearchParams();
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    useLocation: () => ({ pathname: '/admin/patient-record-access', search: params.toString(), hash: '', state: null, key: 'default' }),
    useSearchParams: () => {
      const setParams = (next: Record<string, string> | ((p: URLSearchParams) => URLSearchParams)) => {
        if (typeof next === 'function') {
          params = next(params);
        } else {
          params = new URLSearchParams(next);
        }
      };
      return [params, setParams] as ReturnType<typeof actual.useSearchParams>;
    },
  };
});
vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));
vi.mock('../../lib/queryKeys', () => ({
  queryKeys: { admin: { patientRecordAccess: () => ['admin', 'patient-record-access'] } },
}));
vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

const mockSummary = {
  totalViews: 240,
  uniquePatients: 45,
  uniqueUsers: 8,
};

const mockAccesses = [
  { id: 'A1', timestamp: '2026-06-11T10:00:00Z', user: 'doctor1', role: 'doctor', patientName: 'Rahim', patientId: 'P-001', action: 'view', module: 'ehr', ip: '10.0.0.1' },
  { id: 'A2', timestamp: '2026-06-11T10:30:00Z', user: 'nurse1', role: 'nurse', patientName: 'Karim', patientId: 'P-002', action: 'edit', module: 'vitals', ip: '10.0.0.2' },
];

describe('PatientRecordAccess', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows loading state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: undefined, isLoading: true } as never);
    render(<PatientRecordAccess />);
    expect(screen.getByText('patientRecordAccess.loading')).toBeInTheDocument();
  });

  it('renders page title and subtitle', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { accesses: [] }, isLoading: false } as never);
    render(<PatientRecordAccess />);
    expect(screen.getByText('patientRecordAccess.title')).toBeInTheDocument();
    expect(screen.getByText('patientRecordAccess.subtitle')).toBeInTheDocument();
  });

  it('renders 3 summary cards', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { accesses: [], summary: mockSummary },
      isLoading: false,
    } as never);
    render(<PatientRecordAccess />);
    expect(screen.getByText('patientRecordAccess.summary.totalViews')).toBeInTheDocument();
    expect(screen.getByText('patientRecordAccess.summary.uniquePatients')).toBeInTheDocument();
    expect(screen.getByText('patientRecordAccess.summary.uniqueUsers')).toBeInTheDocument();
    expect(screen.getByText('240')).toBeInTheDocument();
  });

  it('renders 5 action tabs', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { accesses: [] }, isLoading: false } as never);
    render(<PatientRecordAccess />);
    expect(screen.getByText('All')).toBeInTheDocument();
    expect(screen.getByText('Viewed')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();
    expect(screen.getByText('Printed')).toBeInTheDocument();
    expect(screen.getByText('Exported')).toBeInTheDocument();
  });

  it('renders access events table with all data', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { accesses: mockAccesses, summary: mockSummary },
      isLoading: false,
    } as never);
    render(<PatientRecordAccess />);
    expect(screen.getByText('doctor1')).toBeInTheDocument();
    expect(screen.getByText('Rahim')).toBeInTheDocument();
    expect(screen.getByText('Karim')).toBeInTheDocument();
    expect(screen.getByText('#P-001')).toBeInTheDocument();
  });

  it('filters by Viewed action tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { accesses: mockAccesses, summary: mockSummary },
      isLoading: false,
    } as never);
    render(<PatientRecordAccess />);
    fireEvent.click(screen.getByText('Viewed'));
    expect(screen.getByText('doctor1')).toBeInTheDocument();
    expect(screen.queryByText('nurse1')).not.toBeInTheDocument();
  });

  it('filters by Edited action tab', () => {
    vi.mocked(useApiQuery).mockReturnValue({
      data: { accesses: mockAccesses, summary: mockSummary },
      isLoading: false,
    } as never);
    render(<PatientRecordAccess />);
    fireEvent.click(screen.getByText('Edited'));
    expect(screen.getByText('nurse1')).toBeInTheDocument();
    expect(screen.queryByText('doctor1')).not.toBeInTheDocument();
  });

  it('shows empty state', () => {
    vi.mocked(useApiQuery).mockReturnValue({ data: { accesses: [] }, isLoading: false } as never);
    render(<PatientRecordAccess />);
    expect(screen.getByText('patientRecordAccess.empty')).toBeInTheDocument();
  });
});
