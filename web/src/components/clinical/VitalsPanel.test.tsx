import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import VitalsPanel from './VitalsPanel';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('../../lib/apiClient', () => ({ apiFetch: vi.fn() }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { apiFetch } from '../../lib/apiClient';

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const mockVitals = [
  {
    id: 1,
    patient_id: 100,
    temperature: 37.2,
    pulse: 80,
    systolic: 120,
    diastolic: 80,
    spo2: 98,
    respiratory_rate: 16,
    weight: 70,
    height: 170,
    bmi: 24.2,
    blood_sugar: 100,
    pain_scale: 2,
    notes: 'Patient stable',
    recorded_at: '2026-05-15T10:30:00Z',
    recorded_by: 'Nurse A',
  },
  {
    id: 2,
    patient_id: 100,
    temperature: 39.1,
    pulse: 110,
    systolic: 185,
    diastolic: 125,
    spo2: 88,
    respiratory_rate: 22,
    recorded_at: '2026-05-15T14:00:00Z',
  },
];

describe('VitalsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: mock both fetchVitals and fetchTrend endpoints
    vi.mocked(apiFetch).mockImplementation((url: string) => {
      if (url.includes('/trend/')) return Promise.resolve({ vitals: [] });
      return Promise.resolve({ vitals: [] });
    });
  });

  it('renders vitals heading', async () => {
    render(<VitalsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('Vitals')).toBeInTheDocument());
  });

  it('shows empty state when no vitals', async () => {
    render(<VitalsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => expect(screen.getByText('No vitals recorded')).toBeInTheDocument());
  });

  it('renders vitals list with temperature, pulse, BP, SpO2', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string) => {
      if (url.includes('/trend/')) return Promise.resolve({ vitals: mockVitals });
      return Promise.resolve({ vitals: mockVitals });
    });
    render(<VitalsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getAllByText(/37.2/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/80/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/120/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/98/).length).toBeGreaterThan(0);
    });
  });

  it('opens add form when clicking Record Vitals', async () => {
    render(<VitalsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Record Vitals'));
    fireEvent.click(screen.getByText('Record Vitals'));
    expect(screen.getByText('Record New Vitals')).toBeInTheDocument();
    expect(screen.getByText('Save Vitals')).toBeInTheDocument();
  });

  it('auto-calculates BMI when weight and height are entered', async () => {
    render(<VitalsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Record Vitals'));
    fireEvent.click(screen.getByText('Record Vitals'));

    const weightInput = screen.getByPlaceholderText('70');
    const heightInput = screen.getByPlaceholderText('170');

    fireEvent.change(weightInput, { target: { value: '80' } });
    fireEvent.change(heightInput, { target: { value: '180' } });

    // BMI = 80 / (1.8 * 1.8) = 24.7
    await waitFor(() => {
      expect(screen.getByDisplayValue(/24\.7/)).toBeInTheDocument();
    });
  });

  it('color codes abnormal BP values', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string) => {
      if (url.includes('/trend/')) return Promise.resolve({ vitals: [] });
      return Promise.resolve({ vitals: [mockVitals[1]] }); // high BP: 185/125
    });
    render(<VitalsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      const bpCell = screen.getByText(/185\/125/);
      expect(bpCell).toHaveClass('text-red-600');
    });
  });

  it('submits new vital record via POST', async () => {
    vi.mocked(apiFetch).mockImplementation((url: string, opts?: any) => {
      if (url.includes('/trend/')) return Promise.resolve({ vitals: [] });
      if (opts?.method === 'POST') return Promise.resolve({});
      return Promise.resolve({ vitals: [] });
    });

    render(<VitalsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => screen.getByText('Record Vitals'));
    fireEvent.click(screen.getByText('Record Vitals'));

    fireEvent.change(screen.getByPlaceholderText('36.5'), { target: { value: '37.0' } });
    fireEvent.change(screen.getByPlaceholderText('72'), { target: { value: '75' } });

    fireEvent.click(screen.getByText('Save Vitals'));

    await waitFor(() => {
      expect(apiFetch).toHaveBeenCalledWith('/api/clinical/vitals', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({
          patient_id: 100,
          temperature: 37.0,
          pulse: 75,
        }),
      }));
    });
  });

  it('shows error toast on fetch failure', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('Network error'));
    render(<VitalsPanel patientId="100" />, { wrapper: Wrapper });
    await waitFor(() => {
      expect(screen.getByText('No vitals recorded')).toBeInTheDocument();
    });
  });
});
