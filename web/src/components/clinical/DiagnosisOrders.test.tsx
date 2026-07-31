import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import DiagnosisOrders from './DiagnosisOrders';

const diagTMap: Record<string, string> = {
  'diagnosis.title': 'Diagnoses',
  'diagnosis.add': 'Add',
  'diagnosis.empty': 'No diagnoses recorded',
  'diagnosis.searchPlaceholder': 'Search ICD-10 codes...',
  'diagnosis.searching': 'Searching...',
  'diagnosis.noResults': 'No results found',
  'diagnosis.orderFrom': 'Create order from this diagnosis',
  'diagnosis.remove': 'Remove',
  'orders.createFrom': 'Create Order',
  'orders.create': 'Create Order',
  'orders.lab': 'Lab',
  'orders.imaging': 'Imaging',
  'orders.medication': 'Medication',
  'orders.notes': 'Notes / Details',
  'orders.labPlaceholder': 'Test name or notes...',
  'orders.imagingPlaceholder': 'Imaging type, body part...',
  'orders.medPlaceholder': 'Medication details...',
  'common:close': 'Close',
  'common:cancel': 'Cancel',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: any) => diagTMap[k] ?? opts?.defaultValue ?? k,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));
vi.mock('../../lib/apiClient', async () => {
  const actual = await vi.importActual<typeof import('../../lib/apiClient')>('../../lib/apiClient');
  return {
    ...actual,
    api: {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    },
    apiFetch: vi.fn(),
    getToken: vi.fn(() => 'mock-token'),
  };
});
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { api } from '../../lib/apiClient';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const mockDiagnoses = [
  {
    id: 1,
    icd_code: 'E11.9',
    icd_description: 'Type 2 diabetes mellitus without complications',
    diagnosis_type: 'primary' as const,
    notes: 'Well controlled',
    patient_id: 100,
    created_at: '2026-05-10T10:00:00Z',
  },
  {
    id: 2,
    icd_code: 'I10',
    icd_description: 'Essential (primary) hypertension',
    diagnosis_type: 'secondary' as const,
    patient_id: 100,
    created_at: '2026-05-10T10:00:00Z',
  },
];

const mockSearchResults = [
  { code: 'J06.9', description: 'Acute upper respiratory infection, unspecified', system: 'ICD-10' },
  { code: 'J20.9', description: 'Acute bronchitis, unspecified', system: 'ICD-10' },
];

describe('DiagnosisOrders', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders diagnoses heading', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    render(<DiagnosisOrders patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Diagnoses')).toBeInTheDocument());
  });

  it('shows empty state when no diagnoses', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    render(<DiagnosisOrders patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('No diagnoses recorded')).toBeInTheDocument());
  });

  it('renders diagnosis list', async () => {
    vi.mocked(api.get).mockResolvedValue(mockDiagnoses);
    render(<DiagnosisOrders patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('E11.9')).toBeInTheDocument();
      expect(screen.getByText('Type 2 diabetes mellitus without complications')).toBeInTheDocument();
      expect(screen.getByText('I10')).toBeInTheDocument();
      expect(screen.getByText('Essential (primary) hypertension')).toBeInTheDocument();
    });
  });

  it('opens ICD search when clicking Add', async () => {
    vi.mocked(api.get).mockResolvedValue([]);
    render(<DiagnosisOrders patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Add'));
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByPlaceholderText('Search ICD-10 codes...')).toBeInTheDocument();
  });

  it('shows search results after typing', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/diagnosis/search')) return Promise.resolve(mockSearchResults);
      return Promise.resolve([]);
    });

    render(<DiagnosisOrders patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Add'));
    fireEvent.click(screen.getByText('Add'));

    const searchInput = screen.getByPlaceholderText('Search ICD-10 codes...');
    fireEvent.change(searchInput, { target: { value: 'acute' } });

    await waitFor(() => {
      expect(screen.getByText('J06.9')).toBeInTheDocument();
      expect(screen.getByText('Acute upper respiratory infection, unspecified')).toBeInTheDocument();
      expect(screen.getByText('J20.9')).toBeInTheDocument();
    });
  });

  it('creates order from diagnosis', async () => {
    vi.mocked(api.get).mockResolvedValue(mockDiagnoses);
    vi.mocked(api.post).mockResolvedValue({});

    render(<DiagnosisOrders patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('E11.9'));

    // Click the create order button (Plus icon) on first diagnosis
    const orderButtons = screen.getAllByTitle('Create order from this diagnosis');
    fireEvent.click(orderButtons[0]);

    expect(screen.getByRole('heading', { name: /Create Order:\s*E11\.9/ })).toBeInTheDocument();
    expect(screen.getByText('Lab')).toBeInTheDocument();
    expect(screen.getByText('Imaging')).toBeInTheDocument();
    expect(screen.getByText('Medication')).toBeInTheDocument();

    // Fill in notes and create order
    const notesInput = screen.getByPlaceholderText(/Test name or notes/);
    fireEvent.change(notesInput, { target: { value: 'HbA1c test' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Order' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/api/patients/100/chart/lab-order',
        expect.objectContaining({
          testName: 'HbA1c test',
          diagnosisId: 1,
        }),
      );
    });
  });

  it('removes diagnosis', async () => {
    vi.mocked(api.get).mockResolvedValue(mockDiagnoses);
    vi.mocked(api.delete).mockResolvedValue({});

    render(<DiagnosisOrders patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('E11.9'));

    const removeButtons = screen.getAllByTitle('Remove');
    fireEvent.click(removeButtons[0]);

    await waitFor(() => {
      expect(api.delete).toHaveBeenCalledWith('/api/clinical/diagnosis/1');
    });
  });

  it('shows error toast on fetch failure', async () => {
    vi.mocked(api.get).mockRejectedValue(new Error('Network error'));
    render(<DiagnosisOrders patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('No diagnoses recorded')).toBeInTheDocument();
    });
  });
});
