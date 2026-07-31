import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import EmergencyAlertButton from './EmergencyAlertButton';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

const mockFetch = vi.fn();
vi.mock('../../lib/apiClient', () => ({
  apiFetch: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import toast from 'react-hot-toast';

describe('EmergencyAlertButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ message: 'Emergency alert sent', alert_id: 123 });
  });

  it('exports a valid React component', async () => {
    const mod = await import('./EmergencyAlertButton');
    const Component = mod.default || Object.values(mod)[0];
    expect(Component).toBeDefined();
    expect(typeof Component).toBe('function');
  });

  it('renders an emergency alert button', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    expect(screen.getByTestId('emergency-alert-btn')).toBeInTheDocument();
  });

  it('button has red styling', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    const btn = screen.getByTestId('emergency-alert-btn');
    expect(btn.className).toContain('red');
  });

  it('does not show modal initially', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    expect(screen.queryByTestId('emergency-modal')).not.toBeInTheDocument();
  });

  it('shows modal when button is clicked', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    expect(screen.getByTestId('emergency-modal')).toBeInTheDocument();
  });

  it('shows all 8 emergency reason options', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    expect(screen.getByTestId('reason-low-spo2')).toBeInTheDocument();
    expect(screen.getByTestId('reason-unconscious')).toBeInTheDocument();
    expect(screen.getByTestId('reason-severe-bleeding')).toBeInTheDocument();
    expect(screen.getByTestId('reason-chest-pain')).toBeInTheDocument();
    expect(screen.getByTestId('reason-seizure')).toBeInTheDocument();
    expect(screen.getByTestId('reason-fall')).toBeInTheDocument();
    expect(screen.getByTestId('reason-critical-vitals')).toBeInTheDocument();
    expect(screen.getByTestId('reason-other')).toBeInTheDocument();
  });

  it('shows correct label for each reason', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    expect(screen.getByText('Low SpO2')).toBeInTheDocument();
    expect(screen.getByText('Unconscious')).toBeInTheDocument();
    expect(screen.getByText('Severe bleeding')).toBeInTheDocument();
    expect(screen.getByText('Chest pain')).toBeInTheDocument();
    expect(screen.getByText('Seizure')).toBeInTheDocument();
    expect(screen.getByText('Fall')).toBeInTheDocument();
    expect(screen.getByText('Critical vitals')).toBeInTheDocument();
    expect(screen.getByText('Other')).toBeInTheDocument();
  });

  it('shows notes textarea when "Other" is selected', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    fireEvent.click(screen.getByTestId('reason-other'));
    expect(screen.getByTestId('emergency-notes')).toBeInTheDocument();
  });

  it('does not show notes textarea by default', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    expect(screen.queryByTestId('emergency-notes')).not.toBeInTheDocument();
  });

  it('submits with patient_id, admission_id, reason, and notes', async () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    fireEvent.click(screen.getByTestId('reason-low-spo2'));
    fireEvent.click(screen.getByTestId('emergency-submit'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/nursing/emergency-alert', {
        method: 'POST',
        body: {
          patient_id: 100,
          admission_id: 50,
          reason: 'low-spo2',
          notes: '',
        },
      });
    });
  });

  it('includes notes when "Other" reason is selected', async () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    fireEvent.click(screen.getByTestId('reason-other'));
    fireEvent.change(screen.getByTestId('emergency-notes'), { target: { value: 'Patient unresponsive' } });
    fireEvent.click(screen.getByTestId('emergency-submit'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/nursing/emergency-alert', {
        method: 'POST',
        body: {
          patient_id: 100,
          admission_id: 50,
          reason: 'other',
          notes: 'Patient unresponsive',
        },
      });
    });
  });

  it('shows success toast on successful submit', async () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    fireEvent.click(screen.getByTestId('reason-chest-pain'));
    fireEvent.click(screen.getByTestId('emergency-submit'));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Emergency alert sent to doctor');
    });
  });

  it('closes modal after successful submit', async () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    fireEvent.click(screen.getByTestId('reason-seizure'));
    fireEvent.click(screen.getByTestId('emergency-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('emergency-modal')).not.toBeInTheDocument();
    });
  });

  it('shows error toast on failed submit', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    fireEvent.click(screen.getByTestId('reason-fall'));
    fireEvent.click(screen.getByTestId('emergency-submit'));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Failed to send emergency alert');
    });
  });

  it('closes modal on cancel', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    expect(screen.getByTestId('emergency-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('emergency-cancel'));
    expect(screen.queryByTestId('emergency-modal')).not.toBeInTheDocument();
  });

  it('disables submit while loading', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // never resolves
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    fireEvent.click(screen.getByTestId('reason-low-spo2'));
    fireEvent.click(screen.getByTestId('emergency-submit'));

    await waitFor(() => {
      expect(screen.getByTestId('emergency-submit')).toBeDisabled();
    });
  });

  it('submits with correct reason for each option', async () => {
    const reasons = ['low-spo2', 'unconscious', 'severe-bleeding', 'chest-pain', 'seizure', 'fall', 'critical-vitals'];
    for (const reason of reasons) {
      mockFetch.mockClear();
      mockFetch.mockResolvedValue({});
      const { unmount } = render(<EmergencyAlertButton patientId={100} admissionId={50} />);
      fireEvent.click(screen.getByTestId('emergency-alert-btn'));
      fireEvent.click(screen.getByTestId(`reason-${reason}`));
      fireEvent.click(screen.getByTestId('emergency-submit'));
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith('/api/nursing/emergency-alert', {
          method: 'POST',
          body: expect.objectContaining({ reason }),
        });
      });
      unmount();
    }
  });

  it('resets state after successful submit', async () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    fireEvent.click(screen.getByTestId('reason-low-spo2'));
    fireEvent.click(screen.getByTestId('emergency-submit'));

    await waitFor(() => {
      expect(screen.queryByTestId('emergency-modal')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    expect(screen.getByTestId('emergency-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('emergency-notes')).not.toBeInTheDocument();
  });

  it('renders close button in modal', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    expect(screen.getByTestId('emergency-close')).toBeInTheDocument();
  });

  it('closes modal when close button clicked', () => {
    render(<EmergencyAlertButton patientId={100} admissionId={50} />);
    fireEvent.click(screen.getByTestId('emergency-alert-btn'));
    expect(screen.getByTestId('emergency-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('emergency-close'));
    expect(screen.queryByTestId('emergency-modal')).not.toBeInTheDocument();
  });
});
