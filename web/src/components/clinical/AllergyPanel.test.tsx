import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import AllergyPanel from './AllergyPanel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { apiFetch } from '../../lib/apiClient';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const mockAllergies = [
  {
    id: 1,
    patient_id: 100,
    allergen: 'Penicillin',
    allergy_type: 'drug',
    severity: 'severe' as const,
    reaction: 'Anaphylaxis',
    notes: 'Documented in 2024',
    verified: true,
    verified_by: 'Dr. Smith',
    verified_at: '2026-01-15T10:00:00Z',
    created_at: '2026-01-10T08:00:00Z',
  },
  {
    id: 2,
    patient_id: 100,
    allergen: 'Peanuts',
    allergy_type: 'food',
    severity: 'moderate' as const,
    reaction: 'Rash',
    verified: false,
    created_at: '2026-03-20T14:00:00Z',
  },
];

describe('AllergyPanel', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders allergies heading', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ allergies: [] });
    render(<AllergyPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Allergies')).toBeInTheDocument());
  });

  it('shows empty state when no allergies', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ allergies: [] });
    render(<AllergyPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('No allergies recorded')).toBeInTheDocument());
  });

  it('renders allergy list with severity badges', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ allergies: mockAllergies });
    render(<AllergyPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('Penicillin')).toBeInTheDocument();
      expect(screen.getByText('severe')).toBeInTheDocument();
      expect(screen.getByText('Peanuts')).toBeInTheDocument();
      expect(screen.getByText('moderate')).toBeInTheDocument();
    });
  });

  it('shows verified badge for verified allergies', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ allergies: mockAllergies });
    render(<AllergyPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('Verified')).toBeInTheDocument();
    });
  });

  it('shows verify button for unverified allergies', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ allergies: mockAllergies });
    render(<AllergyPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      const verifyButtons = screen.getAllByTitle('Verify');
      // Only the unverified allergy (Peanuts) should have a verify button
      expect(verifyButtons).toHaveLength(1);
    });
  });

  it('opens add form when clicking Add Allergy', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ allergies: [] });
    render(<AllergyPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Add Allergy'));
    fireEvent.click(screen.getByText('Add Allergy'));
    expect(screen.getByText('Record New Allergy')).toBeInTheDocument();
    expect(screen.getByText('Save Allergy')).toBeInTheDocument();
  });

  it('submits new allergy via POST', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'POST') return Promise.resolve({});
      return Promise.resolve({ allergies: [] });
    });

    render(<AllergyPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Add Allergy'));
    fireEvent.click(screen.getByText('Add Allergy'));

    const allergenInput = screen.getByPlaceholderText(/Penicillin/);
    fireEvent.change(allergenInput, { target: { value: 'Aspirin' } });

    fireEvent.click(screen.getByText('Save Allergy'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/clinical/allergies', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          patient_id: 100,
          allergen: 'Aspirin',
        }),
      }));
    });
  });

  it('calls verify endpoint when verify button clicked', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (opts?.method === 'PUT' && url.includes('/verify')) return Promise.resolve({});
      return Promise.resolve({ allergies: mockAllergies });
    });

    render(<AllergyPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Peanuts'));

    const verifyButton = screen.getByTitle('Verify');
    fireEvent.click(verifyButton);

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/clinical/allergies/2/verify', expect.objectContaining({
        method: 'PUT',
      }));
    });
  });

  it('shows error toast on fetch failure', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Network error'));
    render(<AllergyPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('No allergies recorded')).toBeInTheDocument();
    });
  });
});
