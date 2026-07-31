import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import IPDWorkspace from './IPDWorkspace';
import { useApiQuery } from '../../hooks/useApiQuery';

const mockRoundMutate = vi.hoisted(() => vi.fn());
const mockNoteMutate = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ slug: 'demo-hospital', admissionId: '1' }),
  };
});
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: (_method: string, path: string) => ({
    mutate: path.includes('/api/ipd-doctor-rounds/clinical') ? mockRoundMutate : mockNoteMutate,
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('../../components/VitalsTrend', () => ({ default: ({ patientId }: any) => <div data-testid="vitals-trend">VitalsTrend-{patientId}</div> }));

function renderIPDWorkspace(role = 'hospital_admin', initialEntry = '/h/demo-hospital/doctor/ipd/1') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <IPDWorkspace role={role} />
    </MemoryRouter>,
  );
}

describe('IPDWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoundMutate.mockClear();
    mockNoteMutate.mockClear();
    (useApiQuery as any).mockImplementation((_key: any, _url: string, opts?: any) => {
      const keyStr = Array.isArray(_key) ? _key.join(',') : String(_key);
      if (keyStr.includes('admissions') && keyStr.includes('detail')) {
        return {
          data: {
            admission: {
              id: 1,
              admission_no: 'ADM-001',
              patient_id: 10,
              patient_name: 'Robert Johnson',
              age: 55,
              gender: 'Male',
              bed_number: 'B-12',
              ward_name: 'General Ward',
              admission_date: '2024-06-01',
              diagnosis: 'Pneumonia',
              admitting_doctor: 'Dr. Ahmed',
              ipd_visit_id: 20,
              status: 'active',
            },
            pendingOrders: [],
          },
          isLoading: false,
        };
      }
      if (keyStr.includes('patientChart') || keyStr.includes('clinical') || keyStr.includes('notes')) {
        return {
          data: {
            notes: [
              { id: 1, note_type: 'progress', title: 'Round Note', content: 'Patient is stable', doctor_name: 'Dr. Ahmed', created_at: '2024-06-01T10:00:00Z' },
            ],
          },
          isLoading: false,
        };
      }
      if (keyStr.includes('vitals')) {
        return {
          data: {
            vitals: [
              { id: 1, systolic: 125, diastolic: 82, heart_rate: 76, temperature: 37.0, spo2: 97, recorded_at: '2024-06-01T10:00:00Z' },
            ],
          },
          isLoading: false,
        };
      }
      if (keyStr.includes('prescriptions') || keyStr.includes('medications')) {
        return {
          data: {
            medications: [
              { id: 1, medication_name: 'Amoxicillin', dosage: '500mg', frequency: 'TID', route: 'oral', start_date: '2024-06-01', status: 'active' },
            ],
          },
          isLoading: false,
        };
      }
      if (keyStr.includes('dischargePlanning')) {
        return {
          data: {
            plan: {
              id: 1,
              status: 'pending',
              checklist_progress: { done: 5, total: 14, percent: 36 },
              checklist: { vitals_stable: true, medications_reconciled: true },
            },
          },
          isLoading: false,
        };
      }
      if (keyStr.includes('doctors') && keyStr.includes('detail')) {
        return {
          data: { fee: 0, configured: false },
          isLoading: false,
        };
      }
      if (keyStr.includes('ipdDoctorRounds')) {
        return {
          data: { rounds: [] },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });
  });

  it('renders with DashboardLayout wrapper', () => {
    renderIPDWorkspace();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('shows patient banner', async () => {
    renderIPDWorkspace();
    expect(await screen.findByText('Robert Johnson')).toBeInTheDocument();
    expect(screen.getByText(/55y/)).toBeInTheDocument();
    expect(screen.getByText('ADM-001')).toBeInTheDocument();
  });

  it('shows progress notes section', async () => {
    renderIPDWorkspace();
    await screen.findByText('Robert Johnson');
    expect(screen.getAllByText('Progress Notes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Round Note').length).toBeGreaterThan(0);
    expect(screen.getByText('Patient is stable')).toBeInTheDocument();
  });

  it('shows vitals trend', async () => {
    renderIPDWorkspace();
    await screen.findByText('Robert Johnson');
    expect(screen.getByText('Vitals Trend (Last 7 Days)')).toBeInTheDocument();
    expect(screen.getByTestId('vitals-trend')).toBeInTheDocument();
  });

  it('shows legacy Celsius temperature records as Fahrenheit in the doctor workspace', async () => {
    renderIPDWorkspace();
    await screen.findByText('Robert Johnson');
    expect(screen.getByText('98.6 °F')).toBeInTheDocument();
  });

  it('shows active medications', async () => {
    renderIPDWorkspace();
    await screen.findByText('Robert Johnson');
    expect(screen.getByText('Active Medications')).toBeInTheDocument();
    expect(screen.getByText('Amoxicillin')).toBeInTheDocument();
    expect(screen.getByText(/500mg/)).toBeInTheDocument();
  });

  it('prefers provisional_diagnosis over diagnosis', async () => {
    vi.clearAllMocks();
    (useApiQuery as any).mockImplementation((_key: any, _url: string, opts?: any) => {
      const keyStr = Array.isArray(_key) ? _key.join(',') : String(_key);
      if (keyStr.includes('admissions') && keyStr.includes('detail')) {
        return {
          data: {
            admission: {
              id: 1,
              admission_no: 'ADM-001',
              patient_id: 10,
              patient_name: 'Jane Doe',
              admission_date: '2024-06-01',
              diagnosis: 'Old Diagnosis',
              provisional_diagnosis: 'Acute Bronchitis',
              status: 'active',
            },
            pendingOrders: [],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });
    renderIPDWorkspace();
    expect(await screen.findByText('Acute Bronchitis')).toBeInTheDocument();
    expect(screen.queryByText('Old Diagnosis')).not.toBeInTheDocument();
  });

  it('falls back to diagnosis when provisional_diagnosis is absent', async () => {
    vi.clearAllMocks();
    (useApiQuery as any).mockImplementation((_key: any, _url: string, opts?: any) => {
      const keyStr = Array.isArray(_key) ? _key.join(',') : String(_key);
      if (keyStr.includes('admissions') && keyStr.includes('detail')) {
        return {
          data: {
            admission: {
              id: 2,
              admission_no: 'ADM-002',
              patient_id: 20,
              patient_name: 'John Smith',
              admission_date: '2024-06-01',
              diagnosis: 'Pneumonia',
              status: 'active',
            },
            pendingOrders: [],
          },
          isLoading: false,
        };
      }
      return { data: null, isLoading: false };
    });
    renderIPDWorkspace();
    expect(await screen.findByText('Pneumonia')).toBeInTheDocument();
  });

  it('shows discharge summary link in quick actions', async () => {
    renderIPDWorkspace();
    await screen.findByText('Robert Johnson');
    const link = screen.getByRole('link', { name: /discharge summary/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/h/demo-hospital/doctor/ipd/1/discharge');
  });

  it('links IPD doctors to a doctor-authorized laboratory ordering workflow', async () => {
    renderIPDWorkspace();
    await screen.findByText('Robert Johnson');
    const link = screen.getByRole('link', { name: /order lab test/i });
    expect(link).toHaveAttribute('href', '/h/demo-hospital/doctor/lab-orders?patient=10&admission=1&from=doctor/ipd/1');
  });

  it('keeps patient and admission context when opening a new IPD prescription', async () => {
    renderIPDWorkspace('doctor');
    await screen.findByText('Robert Johnson');
    const link = screen.getByRole('link', { name: /new prescription/i });
    expect(link).toHaveAttribute('href', '/h/demo-hospital/prescriptions/new?patient=10&admission=1&from=doctor/ipd/1');
  });

  it('shows inpatient medication ordering and transition reconciliation inside the doctor IPD workspace', async () => {
    renderIPDWorkspace('doctor');
    await screen.findByText('Robert Johnson');
    expect(screen.getByTestId('ipd-medication-order-composer')).toBeInTheDocument();
    expect(screen.getByText('Admission #1 · Doctor orders are sent directly to the nursing MAR schedule.')).toBeInTheDocument();
    expect(screen.getByTestId('medication-reconciliation-panel')).toBeInTheDocument();
    expect(screen.getByLabelText('Transition type')).toHaveValue('discharge');
  });

  it('keeps clinical round signing available but disables billing when fee is missing', async () => {
    renderIPDWorkspace('doctor', '/h/demo-hospital/doctor/ipd/1?tab=round');
    await screen.findByText('Robert Johnson');

    expect(screen.getByText(
      'Doctor IPD round fee is not configured. You can sign the clinical note, but billable doctor round creation is disabled until an admin sets the fee.',
    )).toBeInTheDocument();
    const billingCheckbox = screen.getByTestId('ipd-round-billing').querySelector('input');
    expect(billingCheckbox).toBeDisabled();

    fireEvent.change(screen.getByTestId('ipd-round-summary'), { target: { value: 'Routine round' } });
    fireEvent.click(screen.getByTestId('ipd-round-submit'));

    expect(mockRoundMutate).toHaveBeenCalledTimes(1);
    expect(mockRoundMutate.mock.calls[0][0]).toMatchObject({
      admissionId: 1,
      patientId: 10,
      roundSummary: 'Routine round',
      createBillingRound: false,
    });
  });
});
