import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import VisitSummary from './VisitSummary';
import { useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ slug: 'demo-hospital', id: '1' }),
  };
});
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));

function renderVisitSummary() {
  return render(
    <MemoryRouter>
      <VisitSummary />
    </MemoryRouter>,
  );
}

describe('VisitSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockImplementation((_key: any, _url: string, opts?: any) => {
      const keyStr = Array.isArray(_key) ? _key.join(',') : String(_key);
      if (keyStr.includes('visits') || keyStr.includes('detail')) {
        return {
          data: {
            visit: {
              id: 1,
              visit_number: 'V-001',
              visit_date: '2024-06-01',
              visit_type: 'OPD',
              status: 'active',
              doctor_name: 'Dr. Ahmed',
              patient_id: 1,
              patient_name: 'Jane Smith',
              patient_code: 'P-001',
              chief_complaint: 'Headache for 3 days',
              notes: 'Patient reports persistent headache',
              diagnosis: 'Migraine',
              icd_codes: ['G43.9'],
              created_at: '2024-06-01T10:00:00Z',
              updated_at: '2024-06-01T10:30:00Z',
            },
          },
          isLoading: false,
        };
      }
      if (keyStr.includes('clinical') || keyStr.includes('encounters') || keyStr.includes('summary')) {
        return {
          data: {
            soapNotes: [],
            prescriptions: [],
            labOrders: [],
            diagnoses: [],
            clinicalNotes: [],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });
  });

  it('renders with DashboardLayout wrapper', () => {
    renderVisitSummary();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('shows visit info header', async () => {
    renderVisitSummary();
    expect(await screen.findByRole('heading', { name: 'Visit #V-001' })).toBeInTheDocument();
    expect(screen.getByText('Dr. Ahmed')).toBeInTheDocument();
    expect(screen.getAllByText('Jane Smith').length).toBeGreaterThan(0);
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('renders tab navigation', async () => {
    renderVisitSummary();
    await screen.findByRole('heading', { name: 'Visit #V-001' });
    expect(screen.getByRole('button', { name: /Summary/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Notes/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Orders/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Diagnosis/ })).toBeInTheDocument();
  });

  it('shows edit button', async () => {
    renderVisitSummary();
    await screen.findByRole('heading', { name: 'Visit #V-001' });
    expect(screen.getByText('Edit')).toBeInTheDocument();
  });
});
