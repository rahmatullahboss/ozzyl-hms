import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import PrescriptionRepeatButton from '../PrescriptionRepeatButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => opts?.defaultValue ?? k }),
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('../../../lib/apiClient', () => ({
  api: { get: vi.fn() },
}));

const mockNavigate = vi.fn();
vi.mock('react-router', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => ({ slug: 'test-hospital' }),
}));

import { api } from '../../../lib/apiClient';
import toast from 'react-hot-toast';

const mockedApi = vi.mocked(api);
const mockedToast = vi.mocked(toast);

describe('PrescriptionRepeatButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a button with "Repeat Rx" text', () => {
    render(<PrescriptionRepeatButton prescriptionId={42} patientId={1} />);
    expect(screen.getByRole('button', { name: /repeat rx/i })).toBeInTheDocument();
  });

  it('renders with a copy icon', () => {
    const { container } = render(<PrescriptionRepeatButton prescriptionId={42} patientId={1} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('calls GET /api/prescriptions/:id/repeat on click', async () => {
    const user = userEvent.setup();
    mockedApi.get.mockResolvedValueOnce({
      prescription: {
        patient_id: 1,
        chief_complaint: 'Headache',
        diagnosis: 'Migraine',
        items: [{ medicine_name: 'Paracetamol', dosage: '500mg', frequency: '1+1+1', duration: '5 days', instructions: 'After meal' }],
      },
    });

    render(<PrescriptionRepeatButton prescriptionId={42} patientId={1} />);
    await user.click(screen.getByRole('button', { name: /repeat rx/i }));

    expect(mockedApi.get).toHaveBeenCalledWith('/api/prescriptions/42/repeat');
  });

  it('navigates to new prescription form with repeated data on success', async () => {
    const user = userEvent.setup();
    const repeatedData = {
      prescription: {
        patient_id: 1,
        chief_complaint: 'Headache',
        diagnosis: 'Migraine',
        examination_notes: 'Normal vitals',
        advice: 'Rest well',
        lab_tests: ['CBC'],
        follow_up_date: '2026-06-15',
        items: [{ medicine_name: 'Paracetamol 500mg', dosage: '500mg', frequency: '1+1+1', duration: '5 Days', instructions: 'After meal' }],
      },
    };
    mockedApi.get.mockResolvedValueOnce(repeatedData);

    render(<PrescriptionRepeatButton prescriptionId={42} patientId={1} />);
    await user.click(screen.getByRole('button', { name: /repeat rx/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith(
        expect.stringContaining('/prescriptions/new?patient=1'),
        expect.objectContaining({ state: expect.any(Object) }),
      );
    });
  });

  it('passes repeat data via navigation state', async () => {
    const user = userEvent.setup();
    const repeatedData = {
      prescription: {
        patient_id: 1,
        chief_complaint: 'Headache',
        diagnosis: 'Migraine',
        items: [],
      },
    };
    mockedApi.get.mockResolvedValueOnce(repeatedData);

    render(<PrescriptionRepeatButton prescriptionId={42} patientId={1} />);
    await user.click(screen.getByRole('button', { name: /repeat rx/i }));

    await waitFor(() => {
      const navCall = mockNavigate.mock.calls[0];
      expect(navCall[1]).toEqual(
        expect.objectContaining({ state: expect.objectContaining({ repeatData: repeatedData.prescription }) }),
      );
    });
  });

  it('shows loading state while fetching', async () => {
    const user = userEvent.setup();
    let resolveGet: (value: unknown) => void;
    mockedApi.get.mockReturnValueOnce(new Promise((resolve) => { resolveGet = resolve; }));

    render(<PrescriptionRepeatButton prescriptionId={42} patientId={1} />);
    await user.click(screen.getByRole('button', { name: /repeat rx/i }));

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /loading/i })).toBeDisabled();

    resolveGet!({ prescription: { patient_id: 1, items: [] } });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /repeat rx/i })).not.toBeDisabled();
    });
  });

  it('shows error toast on API failure', async () => {
    const user = userEvent.setup();
    mockedApi.get.mockRejectedValueOnce(new Error('Network error'));

    render(<PrescriptionRepeatButton prescriptionId={42} patientId={1} />);
    await user.click(screen.getByRole('button', { name: /repeat rx/i }));

    await waitFor(() => {
      expect(mockedToast.error).toHaveBeenCalledWith('Failed to load prescription for repeat');
    });
  });

  it('does not navigate on API failure', async () => {
    const user = userEvent.setup();
    mockedApi.get.mockRejectedValueOnce(new Error('fail'));

    render(<PrescriptionRepeatButton prescriptionId={42} patientId={1} />);
    await user.click(screen.getByRole('button', { name: /repeat rx/i }));

    await waitFor(() => {
      expect(mockNavigate).not.toHaveBeenCalled();
    });
  });
});
