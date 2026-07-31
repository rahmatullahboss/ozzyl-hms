import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import NurseTasksPage from './NurseTasksPage';

const mockInvalidateQueries = vi.fn();
const mockFetch = vi.fn();

let bedGridData: Record<string, unknown> | undefined = undefined;
let medDueData: Record<string, unknown> | undefined = undefined;
let alertsData: Record<string, unknown> | undefined = undefined;
let marData: Record<string, unknown> | undefined = undefined;

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts?.defaultValue) return opts.defaultValue as string;
      return key;
    },
  }),
}));

vi.mock('react-router', () => ({
  Link: ({ children, to, ...props }: Record<string, unknown>) => {
    const React = require('react');
    return React.createElement('a', { href: to, ...props }, children);
  },
  useParams: () => ({ slug: 'test-hospital' }),
}));

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => {
    const React = require('react');
    return React.createElement('div', { 'data-testid': 'dashboard-layout' }, children);
  },
}));

vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: (_key: unknown, path: string) => {
    if (path.includes('wards/bed-grid')) return { data: bedGridData, isLoading: false };
    if (path.includes('medication-due')) return { data: medDueData, isLoading: false };
    if (path.includes('active-alerts')) return { data: alertsData, isLoading: false };
    if (path.includes('/api/nursing/mar')) return { data: marData, isLoading: false };
    return { data: undefined, isLoading: false };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('../lib/apiClient', () => ({
  apiFetch: (...args: unknown[]) => mockFetch(...args),
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

describe('NurseTasksPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bedGridData = undefined;
    medDueData = undefined;
    alertsData = undefined;
    marData = undefined;
    mockFetch.mockResolvedValue({});
  });

  it('exports a valid React component', async () => {
    const mod = await import('./NurseTasksPage');
    expect(mod.default).toBeDefined();
    expect(typeof mod.default).toBe('function');
  });

  it('renders the page layout', () => {
    render(<NurseTasksPage />);
    expect(screen.getByTestId('dashboard-layout')).toBeInTheDocument();
  });

  it('renders the page title', () => {
    render(<NurseTasksPage />);
    const titles = screen.getAllByText('My Tasks');
    expect(titles.length).toBeGreaterThanOrEqual(1);
  });

  it('renders empty state when no tasks', () => {
    bedGridData = { beds: [] };
    marData = { Results: [] };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    expect(screen.getByText('No tasks for today')).toBeInTheDocument();
  });

  it('renders stats cards', () => {
    render(<NurseTasksPage />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
    expect(screen.getByText('Due Now')).toBeInTheDocument();
    expect(screen.getByText('Upcoming')).toBeInTheDocument();
    expect(screen.getByText('Completed Today')).toBeInTheDocument();
  });

  it('renders critical tasks from alerts', () => {
    alertsData = {
      alerts: [
        { id: 1, patient_id: 100, patient_name: 'John Doe', vital_type: 'SpO2', recorded_value: '85%', threshold_min: '90', threshold_max: '100', bed_number: 'B1', ward_name: 'ICU' },
      ],
    };
    bedGridData = { beds: [] };
    marData = { Results: [] };
    render(<NurseTasksPage />);
    expect(screen.getByText(/Critical.*SpO2.*alert/)).toBeInTheDocument();
  });

  it('renders medication tasks from MAR data', () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    marData = {
      Results: [
        { id: 1, patient_id: 100, medication_name: 'Paracetamol', dose: '500mg', route: 'oral', scheduled_time: futureTime, status: 'pending', patient_name: 'John Doe', bed_number: 'B1' },
      ],
    };
    bedGridData = { beds: [] };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    expect(screen.getByText('Paracetamol')).toBeInTheDocument();
  });

  it('renders vitals due tasks for patients without vitals', () => {
    bedGridData = {
      beds: [
        { patient_id: 100, patient_name: 'John Doe', bed_number: 'B1', ward_name: 'ICU', latestVitals: null },
      ],
    };
    marData = { Results: [] };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    expect(screen.getByText('Vitals recording due')).toBeInTheDocument();
  });

  it('does not render vitals task for patients with vitals', () => {
    bedGridData = {
      beds: [
        { patient_id: 100, patient_name: 'John Doe', bed_number: 'B1', ward_name: 'ICU', latestVitals: { systolic: 120, diastolic: 80 } },
      ],
    };
    marData = { Results: [] };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    expect(screen.queryByText('Vitals recording due')).not.toBeInTheDocument();
  });

  it('renders patient name and bed number on task cards', () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    marData = {
      Results: [
        { id: 1, patient_id: 100, medication_name: 'Aspirin', dose: '100mg', scheduled_time: futureTime, status: 'pending' },
      ],
    };
    bedGridData = {
      beds: [
        { patient_id: 100, patient_name: 'Jane Smith', bed_number: 'B2', ward_name: 'ICU', latestVitals: { systolic: 120 } },
      ],
    };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    expect(screen.getAllByText('Jane Smith').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/B2/).length).toBeGreaterThanOrEqual(1);
  });

  it('renders Mark Done button for non-done tasks', () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    marData = {
      Results: [
        { id: 1, patient_id: 100, medication_name: 'Aspirin', scheduled_time: futureTime, status: 'pending' },
      ],
    };
    bedGridData = { beds: [] };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    expect(screen.getByText('Mark Done')).toBeInTheDocument();
  });

  it('calls API when Mark Done is clicked for MAR task', async () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    marData = {
      Results: [
        { id: 42, patient_id: 100, medication_name: 'Aspirin', scheduled_time: futureTime, status: 'pending', patient_name: 'John', bed_number: 'B1' },
      ],
    };
    bedGridData = { beds: [] };
    alertsData = { alerts: [] };
    mockFetch.mockResolvedValue({});
    render(<NurseTasksPage />);
    fireEvent.click(screen.getByText('Mark Done'));
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/nursing/mar/42/administer', {
        method: 'PUT',
        body: expect.objectContaining({ status: 'given' }),
      });
    });
  });

  it('renders refresh button', () => {
    render(<NurseTasksPage />);
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
  });

  it('renders Go to Patient link', () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    marData = {
      Results: [
        { id: 1, patient_id: 100, medication_name: 'Aspirin', scheduled_time: futureTime, status: 'pending' },
      ],
    };
    bedGridData = { beds: [] };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    expect(screen.getByText('Go to Patient')).toBeInTheDocument();
  });

  it('groups tasks by priority correctly', () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    const pastTime = new Date(Date.now() - 3600000).toISOString();
    marData = {
      Results: [
        { id: 1, patient_id: 100, medication_name: 'Overdue Med', scheduled_time: pastTime, status: 'pending' },
        { id: 2, patient_id: 101, medication_name: 'Upcoming Med', scheduled_time: futureTime, status: 'pending' },
      ],
    };
    alertsData = {
      alerts: [
        { id: 1, patient_id: 102, vital_type: 'HR', recorded_value: '200', bed_number: 'B3' },
      ],
    };
    bedGridData = { beds: [] };
    render(<NurseTasksPage />);
    const criticalLabels = screen.getAllByText('Critical');
    expect(criticalLabels.length).toBeGreaterThanOrEqual(1);
    const dueNowLabels = screen.getAllByText('Due Now');
    expect(dueNowLabels.length).toBeGreaterThanOrEqual(1);
  });

  it('does not show completed MAR entries from past days', () => {
    const pastDay = new Date(Date.now() - 86400000 * 2).toISOString();
    marData = {
      Results: [
        { id: 1, patient_id: 100, medication_name: 'Old Med', scheduled_time: pastDay, status: 'given' },
      ],
    };
    bedGridData = { beds: [] };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    expect(screen.queryByText('Old Med')).not.toBeInTheDocument();
  });

  it('renders task count in priority section headers', () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    marData = {
      Results: [
        { id: 1, patient_id: 100, medication_name: 'Med A', scheduled_time: futureTime, status: 'pending' },
        { id: 2, patient_id: 101, medication_name: 'Med B', scheduled_time: futureTime, status: 'pending' },
      ],
    };
    bedGridData = { beds: [] };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    const countBadges = screen.getAllByText('2');
    expect(countBadges.length).toBeGreaterThanOrEqual(1);
  });

  it('handles missing patient lookup gracefully', () => {
    const futureTime = new Date(Date.now() + 3600000).toISOString();
    marData = {
      Results: [
        { id: 1, patient_id: 999, medication_name: 'Unknown Patient Med', scheduled_time: futureTime, status: 'pending' },
      ],
    };
    bedGridData = { beds: [] };
    alertsData = { alerts: [] };
    render(<NurseTasksPage />);
    expect(screen.getByText('Unknown Patient Med')).toBeInTheDocument();
    expect(screen.getByText(/Patient #999/)).toBeInTheDocument();
  });
});
