import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import MedicationsPanel from './MedicationsPanel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { apiFetch } from '../../lib/apiClient';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const mockMedications = [
  {
    id: 1,
    patient_id: 100,
    medication_name: 'Amoxicillin',
    generic_name: 'Amoxicillin trihydrate',
    strength: '500mg',
    dosage_form: 'capsule',
    dosage: '1 capsule',
    frequency: 'three_times_daily',
    duration: '7 days',
    instructions: 'After meals',
    status: 'active' as const,
    start_date: '2026-05-10',
    prescribed_by: 'Dr. Smith',
    created_at: '2026-05-10T10:00:00Z',
  },
  {
    id: 2,
    patient_id: 100,
    medication_name: 'Metformin',
    generic_name: 'Metformin HCl',
    strength: '850mg',
    dosage_form: 'tablet',
    dosage: '1 tablet',
    frequency: 'twice_daily',
    status: 'active' as const,
    start_date: '2024-06-15',
    created_at: '2024-06-15T08:00:00Z',
  },
  {
    id: 3,
    patient_id: 100,
    medication_name: 'Ibuprofen',
    strength: '400mg',
    dosage_form: 'tablet',
    dosage: '1 tablet',
    frequency: 'as_needed',
    status: 'discontinued' as const,
    discontinue_reason: 'Caused stomach upset',
    start_date: '2026-04-01',
    end_date: '2026-04-10',
    created_at: '2026-04-01T14:00:00Z',
  },
];

describe('MedicationsPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders medications heading', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ medications: [] });
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Medications')).toBeInTheDocument());
  });

  it('shows empty state when no medications', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ medications: [] });
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('No medications recorded')).toBeInTheDocument());
  });

  it('renders active medications list', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ medications: mockMedications });
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('Amoxicillin')).toBeInTheDocument();
      expect(screen.getByText('Metformin')).toBeInTheDocument();
    });
    // Discontinued medication should not appear in active view
    expect(screen.queryByText('Ibuprofen')).not.toBeInTheDocument();
  });

  it('filters by status - shows discontinued when selected', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ medications: mockMedications });
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Amoxicillin'));

    // Click Discontinued filter
    fireEvent.click(screen.getByText('discontinued'));
    await waitFor(() => {
      expect(screen.getByText('Ibuprofen')).toBeInTheDocument();
      expect(screen.queryByText('Amoxicillin')).not.toBeInTheDocument();
    });
  });

  it('filters by status - shows all when selected', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ medications: mockMedications });
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Amoxicillin'));

    fireEvent.click(screen.getByText('all'));
    await waitFor(() => {
      expect(screen.getByText('Amoxicillin')).toBeInTheDocument();
      expect(screen.getByText('Metformin')).toBeInTheDocument();
      expect(screen.getByText('Ibuprofen')).toBeInTheDocument();
    });
  });

  it('opens add form when clicking Add Medication', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ medications: [] });
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Add Medication'));
    fireEvent.click(screen.getByText('Add Medication'));
    expect(screen.getByText('Add New Medication')).toBeInTheDocument();
    expect(screen.getByText('Save Medication')).toBeInTheDocument();
  });

  it('submits new medication via POST', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') return Promise.resolve({});
      return Promise.resolve({ medications: [] });
    });

    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Add Medication'));
    fireEvent.click(screen.getByText('Add Medication'));

    const nameInput = screen.getByPlaceholderText('e.g., Amoxicillin');
    fireEvent.change(nameInput, { target: { value: 'Paracetamol' } });

    fireEvent.click(screen.getByText('Save Medication'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/clinical/medications', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          patient_id: 100,
          medication_name: 'Paracetamol',
        }),
      }));
    });
  });

  it('shows discontinue button for active medications', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ medications: mockMedications });
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Amoxicillin'));

    const discontinueButtons = screen.getAllByTitle('Discontinue');
    expect(discontinueButtons).toHaveLength(2); // 2 active medications
  });

  it('opens discontinue modal with reason field', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ medications: mockMedications });
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Amoxicillin'));

    const discontinueButtons = screen.getAllByTitle('Discontinue');
    fireEvent.click(discontinueButtons[0]);

    expect(screen.getByText('Discontinue Medication')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Reason for discontinuation/)).toBeInTheDocument();
    expect(screen.getByText('Discontinue')).toBeInTheDocument();
  });

  it('submits discontinue with reason', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'PUT' && url.includes('/discontinue')) return Promise.resolve({});
      return Promise.resolve({ medications: mockMedications });
    });

    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Amoxicillin'));

    const discontinueButtons = screen.getAllByTitle('Discontinue');
    fireEvent.click(discontinueButtons[0]);

    const reasonInput = screen.getByPlaceholderText(/Reason for discontinuation/);
    fireEvent.change(reasonInput, { target: { value: 'Allergic reaction' } });

    fireEvent.click(screen.getByText('Discontinue'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/clinical/medications/1/discontinue', expect.objectContaining({
        method: 'PUT',
        body: expect.objectContaining({
          reason: 'Allergic reaction',
        }),
      }));
    });
  });

  it('shows discontinued reason for discontinued medications', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ medications: mockMedications });
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Amoxicillin'));

    // Switch to all view to see discontinued
    fireEvent.click(screen.getByText('all'));
    await waitFor(() => {
      expect(screen.getByText('Caused stomach upset')).toBeInTheDocument();
    });
  });

  it('shows error toast on fetch failure', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Network error'));
    render(<MedicationsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('No medications recorded')).toBeInTheDocument();
    });
  });
});
