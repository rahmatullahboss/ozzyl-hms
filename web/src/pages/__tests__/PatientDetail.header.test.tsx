import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router';
import PatientDetail from '../PatientDetail';

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(() => ({ mutate: vi.fn() })),
  useQueryClient: vi.fn(() => ({ invalidateQueries: vi.fn() })),
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

vi.mock('../../components/PatientActivationCodeAction', () => ({
  PatientActivationCodeAction: () => null,
}));

vi.mock('../../components/VitalsTrend', () => ({
  default: () => null,
}));

vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => null,
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
  father_husband: 'Father',
  address: 'Dhaka',
  created_at: '2026-05-01T10:00:00Z',
};

const mockSummary = {
  patient: { id: 1, name: 'John Doe' },
  allergies: [
    { id: 1, allergen: 'Penicillin', severity: 'severe', allergy_type: 'drug' },
    { id: 2, allergen: 'Peanuts', severity: 'moderate', allergy_type: 'food' },
  ],
  recent_visits: [
    { id: 10, visit_type: 'opd', created_at: '2026-05-20T10:00:00Z' },
  ],
  recent_diagnoses: [
    { id: 1, ICD10Description: 'Diabetes Mellitus Type 2', IsActive: true },
    { id: 2, ICD10Description: 'Essential Hypertension', IsActive: true },
  ],
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/h/test/patients/1']}>
        <Routes>
          <Route path="/h/:slug/patients/:id" element={ui} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('PatientDetail — PatientEmrHeader integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockImplementation((key: unknown[], url: string) => {
      if (url === '/api/patients/1/summary') return { data: mockSummary, isLoading: false };
      if (url === '/api/patients/1') return { data: { patient: mockPatient }, isLoading: false };
      if (url.includes('/api/billing')) return { data: { bills: [] }, isLoading: false };
      if (url.includes('/api/lab')) return { data: { orders: [] }, isLoading: false };
      if (url.includes('/api/prescriptions')) return { data: { prescriptions: [] }, isLoading: false };
      if (url.includes('/api/appointments')) return { data: { appointments: [] }, isLoading: false };
      if (url.includes('/api/deposits/balance')) return { data: { balance: 0 }, isLoading: false };
      if (url.includes('/api/deposits')) return { data: { deposits: [] }, isLoading: false };
      if (url.includes('/api/admissions')) return { data: { admissions: [] }, isLoading: false };
      return { data: undefined, isLoading: false };
    });
  });

  it('passes allergies to PatientEmrHeader', () => {
    renderWithProviders(<PatientDetail />);
    const allergiesEl = screen.getByTestId('header-allergies');
    const allergies = JSON.parse(allergiesEl.textContent || '[]');
    expect(allergies).toHaveLength(2);
    expect(allergies[0].allergen).toBe('Penicillin');
    expect(allergies[1].allergen).toBe('Peanuts');
  });

  it('passes chronic conditions to PatientEmrHeader', () => {
    renderWithProviders(<PatientDetail />);
    const conditionsEl = screen.getByTestId('header-chronicConditions');
    const conditions = JSON.parse(conditionsEl.textContent || '[]');
    expect(conditions).toContain('Diabetes Mellitus Type 2');
    expect(conditions).toContain('Essential Hypertension');
  });

  it('passes visit type to PatientEmrHeader', () => {
    renderWithProviders(<PatientDetail />);
    const visitTypeEl = screen.getByTestId('header-visitType');
    expect(visitTypeEl.textContent).toBe('opd');
  });

  it('passes last visit date to PatientEmrHeader', () => {
    renderWithProviders(<PatientDetail />);
    const lastVisitEl = screen.getByTestId('header-lastVisitDate');
    expect(lastVisitEl.textContent).toBe('2026-05-20T10:00:00Z');
  });
});
