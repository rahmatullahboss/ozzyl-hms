import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import PatientOverview from './PatientOverview';
import * as apiClient from '../../lib/apiClient';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ slug: 'demo-hospital', id: '1' }),
  };
});
vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('../../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('../../components/clinical/VitalsPanel', () => ({ default: () => <div data-testid="vitals-panel" /> }));
vi.mock('../../components/clinical/AllergyPanel', () => ({ default: () => <div data-testid="allergy-panel" /> }));
vi.mock('../../components/clinical/ProblemListPanel', () => ({ default: () => <div data-testid="problem-list-panel" /> }));
vi.mock('../../components/clinical/MedicationsPanel', () => ({ default: () => <div data-testid="medications-panel" /> }));

const mockApiFetch = vi.mocked(apiClient.apiFetch);

function renderOverview() {
  return render(
    <MemoryRouter>
      <PatientOverview />
    </MemoryRouter>,
  );
}

describe('PatientOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/patients/')) {
        return Promise.resolve({
          patient: {
            id: 1,
            patient_code: 'P-001',
            name: 'John Doe',
            father_husband: 'James Doe',
            address: '123 Main St',
            mobile: '01700000000',
            age: 35,
            gender: 'Male',
            blood_group: 'O+',
            date_of_birth: '1991-01-01',
            email: 'john@example.com',
            created_at: '2024-01-15T10:00:00Z',
          },
        });
      }
      if (url.startsWith('/api/clinical/vitals')) {
        return Promise.resolve({
          vitals: [{ id: 1, temperature: 37.2, pulse: 78, systolic: 120, diastolic: 80, spo2: 98, recorded_at: '2024-06-01T10:00:00Z' }],
        });
      }
      if (url.startsWith('/api/clinical/allergies')) {
        return Promise.resolve({ allergies: [{ id: 1, allergen: 'Penicillin', severity: 'moderate', allergy_type: 'drug' }] });
      }
      if (url.startsWith('/api/clinical/problems')) {
        return Promise.resolve({ problems: [{ id: 1, description: 'Hypertension', status: 'active' }] });
      }
      if (url.startsWith('/api/prescriptions')) {
        return Promise.resolve({
          prescriptions: [{ id: 1, rx_no: 'RX-001', doctor_name: 'Dr. Smith', status: 'final', created_at: '2024-06-01', item_count: 2 }],
        });
      }
      return Promise.resolve({});
    });
  });

  it('renders with DashboardLayout wrapper', async () => {
    renderOverview();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('shows patient name and demographics after loading', async () => {
    renderOverview();
    expect(await screen.findByRole('heading', { name: 'John Doe' })).toBeInTheDocument();
    expect(screen.getByText('01700000000')).toBeInTheDocument();
    expect(screen.getByText(/35y/)).toBeInTheDocument();
    expect(screen.getByText('O+')).toBeInTheDocument();
    expect(screen.getByText('P-001')).toBeInTheDocument();
  });

  it('renders tab navigation', async () => {
    renderOverview();
    await screen.findByRole('heading', { name: 'John Doe' });
    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByText('Clinical')).toBeInTheDocument();
    expect(screen.getByText('Notes')).toBeInTheDocument();
    expect(screen.getByText('Orders')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Documents')).toBeInTheDocument();
  });

  it('switches tabs when clicked', async () => {
    renderOverview();
    await screen.findByRole('heading', { name: 'John Doe' });

    const notesTab = screen.getByText('Notes');
    notesTab.click();

    await waitFor(() => {
      expect(screen.getByText('Clinical Notes')).toBeInTheDocument();
    });
  });

  it('shows loading skeleton when data is loading', () => {
    mockApiFetch.mockReturnValue(new Promise(() => {}));
    renderOverview();
    const skeletons = document.querySelectorAll('.skeleton');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows error state when patient not found', async () => {
    mockApiFetch.mockImplementation((url: string) => {
      if (url.startsWith('/api/patients/')) return Promise.reject(new Error('Not found'));
      return Promise.resolve({});
    });
    renderOverview();
    expect(await screen.findByText('Patient not found.')).toBeInTheDocument();
  });
});
