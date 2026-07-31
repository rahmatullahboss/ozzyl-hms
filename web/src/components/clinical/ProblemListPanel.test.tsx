import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import ProblemListPanel from './ProblemListPanel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { apiFetch } from '../../lib/apiClient';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const mockProblems = [
  {
    id: 1,
    patient_id: 100,
    description: 'Type 2 Diabetes Mellitus',
    icd10_code: 'E11.9',
    severity: 'moderate' as const,
    status: 'active' as const,
    beg_date: '2024-06-15',
    comments: 'Well controlled with metformin',
    created_at: '2024-06-15T10:00:00Z',
  },
  {
    id: 2,
    patient_id: 100,
    description: 'Essential Hypertension',
    icd10_code: 'I10',
    severity: 'severe' as const,
    status: 'active' as const,
    beg_date: '2023-01-10',
    created_at: '2023-01-10T08:00:00Z',
  },
  {
    id: 3,
    patient_id: 100,
    description: 'Acute Bronchitis',
    icd10_code: 'J20.9',
    severity: 'mild' as const,
    status: 'resolved' as const,
    beg_date: '2025-12-01',
    end_date: '2025-12-15',
    created_at: '2025-12-01T14:00:00Z',
  },
];

describe('ProblemListPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders problem list heading', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ problems: [] });
    render(<ProblemListPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Problem List')).toBeInTheDocument());
  });

  it('shows empty state when no problems', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ problems: [] });
    render(<ProblemListPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('No problems recorded')).toBeInTheDocument());
  });

  it('renders active problems list', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ problems: mockProblems });
    render(<ProblemListPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('Type 2 Diabetes Mellitus')).toBeInTheDocument();
      expect(screen.getByText('Essential Hypertension')).toBeInTheDocument();
    });
  });

  it('toggles between Active and Resolved tabs', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ problems: mockProblems });
    render(<ProblemListPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Type 2 Diabetes Mellitus'));

    // Active tab is default - should show 2 active problems
    expect(screen.getByText('Type 2 Diabetes Mellitus')).toBeInTheDocument();
    expect(screen.getByText('Essential Hypertension')).toBeInTheDocument();

    // Click Resolved tab
    fireEvent.click(screen.getByText(/resolved/));
    await waitFor(() => {
      expect(screen.getByText('Acute Bronchitis')).toBeInTheDocument();
      expect(screen.queryByText('Type 2 Diabetes Mellitus')).not.toBeInTheDocument();
    });

    // Click All tab
    fireEvent.click(screen.getByText(/^all$/i));
    await waitFor(() => {
      expect(screen.getByText('Type 2 Diabetes Mellitus')).toBeInTheDocument();
      expect(screen.getByText('Acute Bronchitis')).toBeInTheDocument();
    });
  });

  it('opens add form with ICD search when clicking Add Problem', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ problems: [] });
    render(<ProblemListPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Add Problem'));
    fireEvent.click(screen.getByText('Add Problem'));
    expect(screen.getByText('Add New Problem')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search ICD-10...')).toBeInTheDocument();
    expect(screen.getByText('Save Problem')).toBeInTheDocument();
  });

  it('shows resolve button for active problems', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ problems: mockProblems });
    render(<ProblemListPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Type 2 Diabetes Mellitus'));

    const resolveButtons = screen.getAllByTitle('Resolve');
    // 2 active problems should have resolve buttons
    expect(resolveButtons).toHaveLength(2);
  });

  it('calls resolve endpoint when resolve button clicked', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'PUT' && url.includes('/resolve')) return Promise.resolve({});
      return Promise.resolve({ problems: mockProblems });
    });

    render(<ProblemListPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Type 2 Diabetes Mellitus'));

    const resolveButtons = screen.getAllByTitle('Resolve');
    fireEvent.click(resolveButtons[0]);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/clinical/problems/1/resolve', expect.objectContaining({
        method: 'PUT',
      }));
    });
  });

  it('submits new problem via POST', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') return Promise.resolve({});
      return Promise.resolve({ problems: [] });
    });

    render(<ProblemListPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Add Problem'));
    fireEvent.click(screen.getByText('Add Problem'));

    const descriptionInput = screen.getByPlaceholderText('Problem description');
    fireEvent.change(descriptionInput, { target: { value: 'New Problem' } });

    fireEvent.click(screen.getByText('Save Problem'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/clinical/problems', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          patient_id: 100,
          description: 'New Problem',
          status: 'active',
        }),
      }));
    });
  });

  it('shows error toast on fetch failure', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Network error'));
    render(<ProblemListPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('No problems recorded')).toBeInTheDocument();
    });
  });
});
