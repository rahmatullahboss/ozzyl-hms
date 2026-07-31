import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation, useSearchParams } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PatientAgeAnalyticsResponse, PatientAgeBucket } from '../../../../types/executiveDashboard';
import { useCurrentUserAccess } from '../../../../hooks/useCurrentUserAccess';
import { useExecutiveDashboardAnalytics } from '../../../../hooks/useExecutiveDashboardAnalytics';
import PatientsWorkspace from './PatientsWorkspace';

vi.mock('../../../../hooks/useCurrentUserAccess', () => ({
  useCurrentUserAccess: vi.fn(),
}));
vi.mock('../../../../hooks/useExecutiveDashboardAnalytics', () => ({
  useExecutiveDashboardAnalytics: vi.fn(),
}));
vi.mock('../../../../components/dashboard/PatientAgeDetailDrawer', () => ({
  default: ({ ageBucket, canViewPatients, onClose }: { ageBucket: PatientAgeBucket | null; canViewPatients: boolean; onClose: () => void }) => ageBucket ? (
    <div role="dialog" aria-label={`${ageBucket} age details`}>
      <span>{canViewPatients ? 'patient-access-enabled' : 'patient-access-disabled'}</span>
      <button type="button" onClick={onClose}>Close age details</button>
    </div>
  ) : null,
}));

const filters = {
  preset: '7d' as const,
  startDate: '2026-07-21',
  endDate: '2026-07-27',
};

const data: PatientAgeAnalyticsResponse = {
  period: { ...filters, label: '2026-07-21 → 2026-07-27' },
  metadata: {
    contractVersion: 'patient-age-at-service-v1',
    grain: 'age_bucket',
    ageBasis: 'completed_years_at_service_date',
    dateBasis: 'service_date',
    timezone: 'Asia/Dhaka',
    moneyUnit: 'major',
    currencyCode: 'BDT',
    averageBillDenominator: 'unique_bills',
    repeatVisitRateNumerator: 'patients_with_multiple_visits',
    repeatVisitRateDenominator: 'unique_patients',
  },
  rows: [
    { bucket: '0_5', label: '0–5 years', uniquePatients: 1, visits: 1, admissions: 0, services: 1, billCount: 1, collection: 100, averageBill: 100, repeatPatients: 0, repeatVisitRate: 0, patientShare: 50 },
    { bucket: '6_17', label: '6–17 years', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
    { bucket: '18_30', label: '18–30 years', uniquePatients: 1, visits: 2, admissions: 0, services: 2, billCount: 1, collection: 200, averageBill: 200, repeatPatients: 1, repeatVisitRate: 100, patientShare: 50 },
    { bucket: '31_45', label: '31–45 years', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
    { bucket: '46_60', label: '46–60 years', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
    { bucket: '61_plus', label: '61+ years', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
    { bucket: 'unknown', label: 'Unknown age', uniquePatients: 0, visits: 0, admissions: 0, services: 0, billCount: 0, collection: 0, averageBill: 0, repeatPatients: 0, repeatVisitRate: 0, patientShare: 0 },
  ],
  totals: { uniquePatients: 2, visits: 3, admissions: 0, services: 3, billCount: 2, collection: 300, averageBill: 150, repeatPatients: 1, repeatVisitRate: 50, patientShare: 100 },
  warnings: [],
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function WorkspaceHost() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawAgeBucket = searchParams.get('ageBucket');
  const ageBucket = rawAgeBucket ? rawAgeBucket as PatientAgeBucket : undefined;
  return (
    <PatientsWorkspace
      basePath="/h/city-hospital"
      filters={filters}
      ageBucket={ageBucket}
      onAgeBucketChange={(nextAgeBucket) => {
        const next = new URLSearchParams(searchParams);
        if (nextAgeBucket) next.set('ageBucket', nextAgeBucket);
        else next.delete('ageBucket');
        setSearchParams(next);
      }}
    />
  );
}

function renderWorkspace(initialEntry = '/h/city-hospital/dashboard?tab=patients&range=7d&from=2026-07-21&to=2026-07-27&doctorId=17') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspaceHost />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('PatientsWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useCurrentUserAccess).mockReturnValue({
      data: {
        user: { id: 1, name: 'Admin', email: 'admin@example.com', role: 'hospital_admin' },
        effective_permissions: ['patients:read'],
        workspaces: [],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as ReturnType<typeof useCurrentUserAccess>);
    vi.mocked(useExecutiveDashboardAnalytics).mockReturnValue({
      doctorPerformance: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
      testPerformance: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
      incomeServices: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
      expenseAnalysis: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
      reagentReconciliation: { data: undefined, isLoading: false, isError: false, refetch: vi.fn() },
      patientAge: { data, isLoading: false, isError: false, refetch: vi.fn() },
    } as ReturnType<typeof useExecutiveDashboardAnalytics>);
  });

  it('enables only the selected-period patient age query', () => {
    renderWorkspace();
    expect(screen.getByRole('heading', { name: 'Patients' })).toBeInTheDocument();
    expect(useExecutiveDashboardAnalytics).toHaveBeenCalledWith(expect.objectContaining({
      queryKeyScope: 'admin',
      filters,
      patientAgeEnabled: true,
    }));
    const enabledPanels = vi.mocked(useExecutiveDashboardAnalytics).mock.calls[0][0].enabledPanels;
    expect([...enabledPanels]).toEqual([]);
  });

  it('selecting a bucket updates only ageBucket and preserves command-center filters', () => {
    renderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'Open 18–30 years age details' }));
    expect(screen.getByTestId('location')).toHaveTextContent('ageBucket=18_30');
    expect(screen.getByTestId('location')).toHaveTextContent('tab=patients');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-07-21');
    expect(screen.getByTestId('location')).toHaveTextContent('to=2026-07-27');
    expect(screen.getByTestId('location')).toHaveTextContent('doctorId=17');
  });

  it('restores a direct ageBucket URL and closes without losing period filters', () => {
    renderWorkspace('/h/city-hospital/dashboard?tab=patients&range=7d&from=2026-07-21&to=2026-07-27&doctorId=17&ageBucket=18_30');
    expect(screen.getByRole('dialog', { name: '18_30 age details' })).toBeInTheDocument();
    expect(screen.getByText('patient-access-enabled')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close age details' }));
    expect(screen.queryByRole('dialog', { name: '18_30 age details' })).not.toBeInTheDocument();
    expect(screen.getByTestId('location')).not.toHaveTextContent('ageBucket=');
    expect(screen.getByTestId('location')).toHaveTextContent('range=7d');
    expect(screen.getByTestId('location')).toHaveTextContent('from=2026-07-21');
    expect(screen.getByTestId('location')).toHaveTextContent('to=2026-07-27');
    expect(screen.getByTestId('location')).toHaveTextContent('doctorId=17');
  });

  it('does not reference the removed admin patient analytics endpoint', () => {
    renderWorkspace();
    expect(JSON.stringify(vi.mocked(useExecutiveDashboardAnalytics).mock.calls)).not.toContain('/api/admin/analytics/patients');
  });
});
