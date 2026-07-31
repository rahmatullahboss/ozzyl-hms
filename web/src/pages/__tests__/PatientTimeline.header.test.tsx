import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import PatientTimeline from '../PatientTimeline';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
}));

vi.mock('../../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="dashboard-layout">{children}</div>,
}));

vi.mock('../../components/clinical/PatientEmrHeader', () => ({
  default: (props: Record<string, unknown>) => (
    <div data-testid="patient-emr-header">
      <span data-testid="header-allergies">{JSON.stringify(props.allergies)}</span>
      <span data-testid="header-chronicConditions">{JSON.stringify(props.chronicConditions)}</span>
      <span data-testid="header-visitType">{String(props.visitType ?? '')}</span>
      <span data-testid="header-lastVisitDate">{String(props.lastVisitDate ?? '')}</span>
    </div>
  ),
}));

vi.mock('../../components/clinical/TimelineEventExpandable', () => ({
  default: ({ event }: { event: { title: string } }) => <div data-testid="timeline-event">{event.title}</div>,
  TimelineEvent: {},
}));

import { useApiQuery } from '../../hooks/useApiQuery';

const mockPatient = {
  id: 1,
  patient_code: 'P-001',
  name: 'John Doe',
  age: 45,
  gender: 'Male',
  blood_group: 'A+',
  mobile: '01712345678',
};

const mockSummary = {
  patient: { id: 1, name: 'John Doe' },
  allergies: [
    { id: 1, allergen: 'Penicillin', severity: 'severe', allergy_type: 'drug' },
  ],
  recent_visits: [
    { id: 10, visit_type: 'followup', created_at: '2026-05-25T14:00:00Z' },
  ],
  recent_diagnoses: [
    { id: 1, ICD10Description: 'Asthma', IsActive: true },
  ],
};

const mockTimeline = {
  events: [
    { id: 1, type: 'visit', title: 'Visit', description: 'Test', date: '2026-05-20' },
  ],
  patient_name: 'John Doe',
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/h/test/patients/1/timeline']}>
        <Routes>
          <Route path="/h/:slug/patients/:id/timeline" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PatientTimeline — PatientEmrHeader integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockImplementation((key: unknown[], url: string) => {
      if (url === '/api/patients/1/summary') return { data: mockSummary, isLoading: false };
      if (url === '/api/patients/1/timeline') return { data: mockTimeline, isLoading: false };
      if (url === '/api/patients/1') return { data: { patient: mockPatient }, isLoading: false };
      return { data: undefined, isLoading: false };
    });
  });

  it('passes allergies to PatientEmrHeader', () => {
    renderWithProviders(<PatientTimeline />);
    const allergiesEl = screen.getByTestId('header-allergies');
    const allergies = JSON.parse(allergiesEl.textContent || '[]');
    expect(allergies).toHaveLength(1);
    expect(allergies[0].allergen).toBe('Penicillin');
  });

  it('passes chronic conditions to PatientEmrHeader', () => {
    renderWithProviders(<PatientTimeline />);
    const conditionsEl = screen.getByTestId('header-chronicConditions');
    const conditions = JSON.parse(conditionsEl.textContent || '[]');
    expect(conditions).toContain('Asthma');
  });

  it('passes visit type to PatientEmrHeader', () => {
    renderWithProviders(<PatientTimeline />);
    const visitTypeEl = screen.getByTestId('header-visitType');
    expect(visitTypeEl.textContent).toBe('followup');
  });

  it('passes last visit date to PatientEmrHeader', () => {
    renderWithProviders(<PatientTimeline />);
    const lastVisitEl = screen.getByTestId('header-lastVisitDate');
    expect(lastVisitEl.textContent).toBe('2026-05-25T14:00:00Z');
  });
});
