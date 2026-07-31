import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NurseStation from './NurseStation';
import { useApiQuery, useQueryClient } from '../hooks/useApiQuery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: Record<string, unknown>) => opts?.defaultValue ?? k }) }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useParams: () => ({ slug: 'city-hospital' }),
    Link: ({ to, children, className }: any) => <a href={to} className={className}>{children}</a>,
  };
});
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(() => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false })),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../components/nursing/WardBedGrid', () => ({
  default: ({ beds, onBedClick }: any) => (
    <div data-testid="ward-bed-grid">
      {beds?.map((bed: any) => (
        <button key={bed.bed_id} data-testid={`bed-${bed.bed_id}`} onClick={() => onBedClick(bed)}>
          {bed.ward_name} — {bed.bed_number}
          {bed.patient_name && <span>{bed.patient_name}</span>}
        </button>
      ))}
    </div>
  ),
}));
vi.mock('../components/nursing/PatientDrawer', () => ({
  default: ({ bed, onClose }: any) => (
    <div data-testid="patient-drawer">
      <span>Drawer: {bed.patient_name}</span>
      <button onClick={onClose}>Close</button>
    </div>
  ),
}));
vi.mock('../components/ipd/DoctorRoundForm', () => ({
  default: (props: any) => (
    <div data-testid="doctor-round-form">
      {props.patientName}|{props.admissionNo}|{props.entrySource}
    </div>
  ),
}));

const mockPatients = [
  { admission_id: 1, admission_no: 'ADM-001', patient_id: 100, patient_name: 'Rahim Khan', patient_code: 'P001', ward_name: 'ICU', bed_number: 'B1', doctor_name: 'Dr. Ali', provisional_diagnosis: 'Pneumonia', admission_status: 'admitted', latestVitals: { systolic: 120, diastolic: 80, temperature: 98.6, heart_rate: 72, spo2: 98, recorded_at: new Date().toISOString() } },
  { admission_id: 2, admission_no: 'ADM-002', patient_id: 101, patient_name: 'Karim Ali', patient_code: 'P002', ward_name: 'ICU', bed_number: 'B2', doctor_name: 'Dr. Begum', provisional_diagnosis: 'Fracture', admission_status: 'critical', latestVitals: { systolic: 90, diastolic: 60, temperature: 101.2, heart_rate: 110, spo2: 88, recorded_at: new Date().toISOString() } },
  { admission_id: 3, admission_no: 'ADM-003', patient_id: 102, patient_name: 'Sultana Khatun', patient_code: 'P003', ward_name: 'General', bed_number: 'G1', doctor_name: 'Dr. Hossain', provisional_diagnosis: 'Observation', admission_status: 'admitted', latestVitals: null },
];

const mockVitals = [
  { id: 1, patient_name: 'Rahim Khan', systolic: 120, diastolic: 80, temperature: 98.6, heart_rate: 72, spo2: 98, recorded_by: 'Nurse Joy', recorded_at: new Date().toISOString() },
];

const mockAlerts = [
  { id: 1, patient_name: 'Karim Ali', vital_type: 'spo2', recorded_value: 88, threshold_min: 92, threshold_max: 100 },
];

const mockBedGrid = [
  { bed_id: 1, bed_number: 'B1', ward_name: 'ICU', bed_type: 'standard', bed_status: 'occupied', patient_id: 100, admission_id: 1, patient_name: 'Rahim Khan', statusColor: 'stable' },
  { bed_id: 2, bed_number: 'B2', ward_name: 'ICU', bed_type: 'standard', bed_status: 'occupied', patient_id: 101, admission_id: 2, patient_name: 'Karim Ali', statusColor: 'critical' },
  { bed_id: 3, bed_number: 'G1', ward_name: 'General', bed_type: 'standard', bed_status: 'occupied', patient_id: 102, admission_id: 3, patient_name: 'Sultana Khatun', statusColor: 'stable' },
];

function mockUseApiQuery(dataMap: Record<string, unknown>) {
  (useApiQuery as any).mockImplementation((_key: string[], url: string) => {
    const entry = Object.entries(dataMap).find(([k]) => url.includes(k));
    return { data: entry?.[1] ?? undefined, isLoading: false };
  });
}

describe('NurseStation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseApiQuery({
      'dashboard': { patients: mockPatients, stats: { activePatients: 3, pendingVitals: 1, roundsCompleted: 2, totalRounds: 4, activeAlerts: 1 } },
      'vitals': { vitals: mockVitals },
      'active-alerts': { alerts: mockAlerts },
      'medication-due': { summary: { overdue: 1, upcoming: 2, total: 3 }, Results: [] },
      'bed-grid': { Results: mockBedGrid },
    });
  });

  it('renders KPI cards with stats', () => {
    render(<NurseStation />);
    expect(screen.getByText('stats.activePatients')).toBeInTheDocument();
    expect(screen.getByText('stats.pendingVitals')).toBeInTheDocument();
    expect(screen.getByText('stats.medicationsDue')).toBeInTheDocument();
    expect(screen.getByText('stats.rounds')).toBeInTheDocument();
  });

  it('renders the ward bed grid', () => {
    render(<NurseStation />);
    expect(screen.getByTestId('ward-bed-grid')).toBeInTheDocument();
    expect(screen.getByText(/ICU — B1/)).toBeInTheDocument();
    expect(screen.getByText(/ICU — B2/)).toBeInTheDocument();
    expect(screen.getByText(/General — G1/)).toBeInTheDocument();
  });

  it('renders patient names in bed grid', () => {
    render(<NurseStation />);
    expect(screen.getAllByText('Rahim Khan').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Karim Ali').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Sultana Khatun')).toBeInTheDocument();
  });

  it('renders search input', () => {
    render(<NurseStation />);
    expect(screen.getByPlaceholderText('Search patient or bed...')).toBeInTheDocument();
  });

  it('filters beds when searching', () => {
    render(<NurseStation />);
    const searchInput = screen.getByPlaceholderText('Search patient or bed...');
    fireEvent.change(searchInput, { target: { value: 'Rahim' } });
    expect(screen.getByText(/ICU — B1/)).toBeInTheDocument();
    expect(screen.queryByText(/ICU — B2/)).not.toBeInTheDocument();
  });

  it('renders active alerts section when alerts exist', () => {
    render(<NurseStation />);
    expect(screen.getByText(/Active Alerts/)).toBeInTheDocument();
  });

  it('renders recent vitals log table', () => {
    render(<NurseStation />);
    expect(screen.getByText('Recent Vitals')).toBeInTheDocument();
    expect(screen.getAllByText('Rahim Khan').length).toBeGreaterThanOrEqual(1);
  });

  it('renders print buttons', () => {
    render(<NurseStation />);
    expect(screen.getByText('MAR')).toBeInTheDocument();
    expect(screen.getByText('I/O')).toBeInTheDocument();
    expect(screen.getByText('Vitals')).toBeInTheDocument();
    expect(screen.getByText('Handover')).toBeInTheDocument();
  });

  it('opens patient drawer when clicking an occupied bed', () => {
    render(<NurseStation />);
    fireEvent.click(screen.getByTestId('bed-1'));
    expect(screen.getByTestId('patient-drawer')).toBeInTheDocument();
    expect(screen.getByText('Drawer: Rahim Khan')).toBeInTheDocument();
  });

  it('closes patient drawer when close is clicked', () => {
    render(<NurseStation />);
    fireEvent.click(screen.getByTestId('bed-1'));
    expect(screen.getByTestId('patient-drawer')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Close'));
    expect(screen.queryByTestId('patient-drawer')).not.toBeInTheDocument();
  });

  it('opens a separate doctor round form without replacing vitals round entry', () => {
    render(<NurseStation />);
    expect(screen.getByRole('button', { name: 'Vitals Round Entry' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Doctor Round' }));
    fireEvent.change(screen.getByLabelText('Doctor round patient'), { target: { value: '1' } });
    expect(screen.getByTestId('doctor-round-form')).toHaveTextContent('Rahim Khan|ADM-001|nurse_station');
  });
});
