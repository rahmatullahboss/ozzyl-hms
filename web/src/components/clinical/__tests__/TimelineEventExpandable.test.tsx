import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import TimelineEventExpandable from '../TimelineEventExpandable';
import type { TimelineEvent } from '../TimelineEventExpandable';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));

const mockApiGet = vi.fn();
vi.mock('../../../lib/apiClient', async () => {
  const actual = await vi.importActual<typeof import('../../../lib/apiClient')>('../../../lib/apiClient');
  return {
    ...actual,
    api: { get: (...args: any[]) => mockApiGet(...args) },
    apiFetch: vi.fn(),
    getToken: vi.fn(() => 'mock-token'),
  };
});

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
}

const baseEvent: TimelineEvent = {
  id: 1,
  type: 'visit',
  title: 'OPD Visit',
  description: 'Routine checkup',
  date: '2026-05-20T10:00:00Z',
  doctor: 'Dr. Smith',
  status: 'completed',
};

describe('TimelineEventExpandable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockReset();
  });

  it('renders the event title', () => {
    render(<TimelineEventExpandable event={baseEvent} isExpanded={false} onToggle={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText('OPD Visit')).toBeInTheDocument();
  });

  it('renders the event description', () => {
    render(<TimelineEventExpandable event={baseEvent} isExpanded={false} onToggle={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText('Routine checkup')).toBeInTheDocument();
  });

  it('renders doctor name when provided', () => {
    render(<TimelineEventExpandable event={baseEvent} isExpanded={false} onToggle={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText('Dr. Smith')).toBeInTheDocument();
  });

  it('renders status badge', () => {
    render(<TimelineEventExpandable event={baseEvent} isExpanded={false} onToggle={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('calls onToggle when card is clicked', () => {
    const onToggle = vi.fn();
    render(<TimelineEventExpandable event={baseEvent} isExpanded={false} onToggle={onToggle} />, { wrapper: Wrapper });
    fireEvent.click(screen.getByTestId('timeline-event-card'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('does not show detail panel when collapsed', () => {
    render(<TimelineEventExpandable event={baseEvent} isExpanded={false} onToggle={() => {}} />, { wrapper: Wrapper });
    expect(screen.queryByTestId('timeline-event-detail')).not.toBeInTheDocument();
  });

  it('shows detail panel when expanded', () => {
    render(<TimelineEventExpandable event={baseEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByTestId('timeline-event-detail')).toBeInTheDocument();
  });

  it('shows expand/collapse chevron icon', () => {
    const expandableEvent: TimelineEvent = {
      ...baseEvent,
      type: 'prescription',
      details: { Medicines: 'Paracetamol' },
    };
    const { rerender } = render(<TimelineEventExpandable event={expandableEvent} isExpanded={false} onToggle={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByTestId('expand-icon')).toBeInTheDocument();

    rerender(<TimelineEventExpandable event={expandableEvent} isExpanded={true} onToggle={() => {}} />);
    expect(screen.getByTestId('collapse-icon')).toBeInTheDocument();
  });

  it('renders inline details for non-visit event types', () => {
    const prescriptionEvent: TimelineEvent = {
      ...baseEvent,
      type: 'prescription',
      title: 'Prescription',
      details: { Medicines: 'Paracetamol 500mg', Duration: '5 days' },
    };
    render(<TimelineEventExpandable event={prescriptionEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText('Paracetamol 500mg')).toBeInTheDocument();
    expect(screen.getByText('5 days')).toBeInTheDocument();
  });

  it('fetches encounter summary for visit-type events when expanded', async () => {
    mockApiGet.mockResolvedValue({
      encounter: {
        chief_complaint: 'Headache',
        vitals: { temperature: 37.2, pulse: 80, systolic: 120, diastolic: 80 },
        diagnosis: 'Tension headache',
        follow_up: '1 week',
      },
    });

    const visitEvent: TimelineEvent = {
      ...baseEvent,
      type: 'visit',
      encounter_id: 42,
    };

    render(<TimelineEventExpandable event={visitEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(mockApiGet).toHaveBeenCalledWith('/api/clinical/encounters/42/summary');
    });
  });

  it('displays encounter summary data after fetch for visit events', async () => {
    mockApiGet.mockResolvedValue({
      encounter: {
        chief_complaint: 'Headache',
        vitals: { temperature: 37.2, pulse: 80, systolic: 120, diastolic: 80 },
        diagnosis: 'Tension headache',
        follow_up: '1 week',
      },
    });

    const visitEvent: TimelineEvent = {
      ...baseEvent,
      type: 'visit',
      encounter_id: 42,
    };

    render(<TimelineEventExpandable event={visitEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText('Headache')).toBeInTheDocument();
      expect(screen.getByText('Tension headache')).toBeInTheDocument();
    });
  });

  it('shows loading state while fetching encounter summary', async () => {
    mockApiGet.mockReturnValue(new Promise(() => {})); // never resolves

    const visitEvent: TimelineEvent = {
      ...baseEvent,
      type: 'visit',
      encounter_id: 42,
    };

    render(<TimelineEventExpandable event={visitEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByTestId('detail-loading')).toBeInTheDocument();
  });

  it('shows error state when encounter fetch fails', async () => {
    mockApiGet.mockRejectedValue(new Error('Network error'));

    const visitEvent: TimelineEvent = {
      ...baseEvent,
      type: 'visit',
      encounter_id: 42,
    };

    render(<TimelineEventExpandable event={visitEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });

    await waitFor(() => {
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
  });

  it('does not fetch encounter summary for non-visit events', () => {
    const labEvent: TimelineEvent = {
      ...baseEvent,
      type: 'lab',
      title: 'Blood Test',
      details: { Test: 'CBC', Result: 'Normal' },
    };

    render(<TimelineEventExpandable event={labEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });

    expect(mockApiGet).not.toHaveBeenCalled();
  });

  it('renders lab event details with abnormal flag', () => {
    const labEvent: TimelineEvent = {
      ...baseEvent,
      type: 'lab',
      title: 'Blood Test',
      details: { Test: 'CBC', Result: 'Normal', 'WBC': '15.2 (High)' },
    };

    render(<TimelineEventExpandable event={labEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText('Blood Test')).toBeInTheDocument();
    expect(screen.getByText('15.2 (High)')).toBeInTheDocument();
  });

  it('renders admission event details', () => {
    const admissionEvent: TimelineEvent = {
      ...baseEvent,
      type: 'admission',
      title: 'Admission',
      details: { Diagnosis: 'Pneumonia', Ward: 'General', Bed: 'G-12', Status: 'Active' },
    };

    render(<TimelineEventExpandable event={admissionEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText('Pneumonia')).toBeInTheDocument();
    expect(screen.getByText('General')).toBeInTheDocument();
  });

  it('renders appointment event details', () => {
    const appointmentEvent: TimelineEvent = {
      ...baseEvent,
      type: 'appointment',
      title: 'Follow-up',
      details: { Doctor: 'Dr. Jones', 'Date': '25 May 2026', Status: 'Scheduled', 'Chief Complaint': 'Back pain' },
    };

    render(<TimelineEventExpandable event={appointmentEvent} isExpanded={true} onToggle={() => {}} />, { wrapper: Wrapper });

    expect(screen.getByText('Dr. Jones')).toBeInTheDocument();
    expect(screen.getByText('Back pain')).toBeInTheDocument();
  });

  it('renders the event date formatted', () => {
    render(<TimelineEventExpandable event={baseEvent} isExpanded={false} onToggle={() => {}} />, { wrapper: Wrapper });
    expect(screen.getByText(/20 May 2026/)).toBeInTheDocument();
  });
});
