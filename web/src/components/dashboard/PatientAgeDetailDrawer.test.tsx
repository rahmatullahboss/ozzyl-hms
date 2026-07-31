import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutiveDashboardFilters, PatientAgeDetailResponse } from '../../types/executiveDashboard';
import { useApiQuery } from '../../hooks/useApiQuery';
import PatientAgeDetailDrawer from './PatientAgeDetailDrawer';

vi.mock('../../hooks/useApiQuery', () => ({ useApiQuery: vi.fn() }));

const filters: ExecutiveDashboardFilters = {
  preset: '7d',
  startDate: '2026-07-21',
  endDate: '2026-07-27',
};

const aggregateData: PatientAgeDetailResponse = {
  period: { ...filters, label: 'Selected period' },
  ageBucket: '18_30',
  view: 'services',
  rows: [{ id: 'service:lab:cbc', name: 'CBC', category: 'Lab', uniquePatients: 2, visits: 0, services: 4, quantity: 4, collection: 800 }],
  totals: { uniquePatients: 2, visits: 0, services: 4, collection: 800 },
  page: 1,
  pageSize: 25,
  totalRows: 30,
  hasNextPage: true,
  reconciliation: {},
  warnings: [],
};

const patientData: PatientAgeDetailResponse = {
  ...aggregateData,
  view: 'patients',
  rows: [{ patientId: 41, patientCode: 'P-0041', patientName: 'Rahim Uddin', ageAtService: 28, bucket: '18_30', latestServiceAt: '2026-07-27', visits: 2, admissions: 1, services: 3, collection: 500 }],
  totals: { uniquePatients: 1, visits: 2, admissions: 1, services: 3, collection: 500 },
  totalRows: 1,
  hasNextPage: false,
};

function mockQuery(url: string) {
  if (url.includes('view=patients')) {
    return { data: patientData, isLoading: false, isError: false, error: null, refetch: vi.fn() };
  }
  return {
    data: { ...aggregateData, view: url.includes('view=doctors') ? 'doctors' : url.includes('view=departments') ? 'departments' : 'services' },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
}

function renderDrawer(options: { canViewPatients?: boolean; onClose?: () => void } = {}) {
  return render(
    <PatientAgeDetailDrawer
      ageBucket="18_30"
      filters={filters}
      canViewPatients={options.canViewPatients ?? true}
      onClose={options.onClose ?? vi.fn()}
    />,
  );
}

describe('PatientAgeDetailDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => mockQuery(url)) as never);
  });

  it('restores the bucket and requests selected-period services by default', () => {
    renderDrawer();
    expect(screen.getByRole('dialog', { name: '18–30 years patient age details' })).toBeInTheDocument();
    const call = vi.mocked(useApiQuery).mock.calls[0];
    expect(String(call[1])).toContain('/api/dashboard/patient-age-analytics/details?');
    expect(String(call[1])).toContain('ageBucket=18_30');
    expect(String(call[1])).toContain('view=services');
    expect(String(call[1])).toContain('startDate=2026-07-21');
    expect(String(call[1])).toContain('endDate=2026-07-27');
    expect(String(call[1])).toContain('page=1');
    expect(String(call[1])).toContain('pageSize=25');
  });

  it('switches aggregate tabs without rendering patient identity', () => {
    renderDrawer();
    expect(screen.getByText('CBC')).toBeInTheDocument();
    expect(screen.queryByText('Rahim Uddin')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Doctors' }));
    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('view=doctors'))).toBe(true);
    expect(screen.queryByText('Rahim Uddin')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Departments' }));
    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('view=departments'))).toBe(true);
  });

  it('disables patient identity tab when permission is unavailable', () => {
    renderDrawer({ canViewPatients: false });
    expect(screen.getByRole('tab', { name: 'Patients' })).toBeDisabled();
    expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('view=patients'))).toBe(false);
  });

  it('shows patient rows only on the authorized patient tab', () => {
    renderDrawer({ canViewPatients: true });
    fireEvent.click(screen.getByRole('tab', { name: 'Patients' }));
    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('P-0041')).toBeInTheDocument();
    expect(screen.getByText('Age at latest matching service: 28')).toBeInTheDocument();
  });

  it('isolates a patient 403 from aggregate tabs', () => {
    vi.mocked(useApiQuery).mockImplementation(((_key: unknown, url: string) => {
      if (url.includes('view=patients')) {
        return { data: undefined, isLoading: false, isError: true, error: { status: 403 }, refetch: vi.fn() };
      }
      return mockQuery(url);
    }) as never);
    renderDrawer({ canViewPatients: true });
    fireEvent.click(screen.getByRole('tab', { name: 'Patients' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Patient identity access is not available');
    fireEvent.click(screen.getByRole('tab', { name: 'Services' }));
    expect(screen.getByText('CBC')).toBeInTheDocument();
  });

  it('applies pagination and sorting through bound query parameters', async () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => {
      expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('page=2'))).toBe(true);
    });
    fireEvent.change(screen.getByLabelText('Sort patient age details'), { target: { value: 'collection' } });
    await waitFor(() => {
      expect(vi.mocked(useApiQuery).mock.calls.some((call) => String(call[1]).includes('sortBy=collection'))).toBe(true);
    });
  });

  it('uses stacked responsive cards instead of a mandatory wide table', () => {
    renderDrawer();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const card = screen.getByTestId('patient-age-detail-card');
    expect(card).toBeInTheDocument();
    expect(card).toHaveTextContent('4 services');
  });

  it('moves focus inside, closes with Escape, and restores trigger focus', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open patient age';
    document.body.appendChild(trigger);
    trigger.focus();
    const onClose = vi.fn();
    const { unmount } = renderDrawer({ onClose });
    expect(screen.getByRole('button', { name: 'Close patient age details' })).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.body.style.overflow).toBe('');
    expect(trigger).toHaveFocus();
    trigger.remove();
  });
});
