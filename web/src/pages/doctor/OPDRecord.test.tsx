import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import OPDRecord from './OPDRecord';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ slug: 'demo-hospital', patientId: '1', apptId: '10' }),
  };
});
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));

const followUpMutate = vi.fn();

function renderOPDRecord() {
  return render(
    <MemoryRouter>
      <OPDRecord />
    </MemoryRouter>,
  );
}

describe('OPDRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiMutation as any).mockImplementation((_method: string, url: string) => ({
      mutate: url.endsWith('/follow-up') ? followUpMutate : vi.fn(),
      isPending: false,
    }));
    (useApiQuery as any).mockImplementation((_key: any, _url: string, opts?: any) => {
      const keyStr = Array.isArray(_key) ? _key.join(',') : String(_key);
      if (keyStr.includes('patients') && keyStr.includes('detail')) {
        return {
          data: {
            patient: {
              id: 1, patient_code: 'P-001', name: 'Jane Smith',
              age: 28, gender: 'Female', blood_group: 'A+',
              mobile: '01800000000', address: '456 Oak Ave',
            },
          },
          isLoading: false,
        };
      }
      if (keyStr.includes('appointments')) {
        return {
          data: {
            appointment: {
              id: 10, appointment_date: '2024-06-01', visit_type: 'Consultation',
              status: 'checked_in', doctor_name: 'Dr. Ahmed',
            },
          },
          isLoading: false,
        };
      }
      if (keyStr.includes('vitals')) {
        return {
          data: { vitals: [{ systolic: 118, diastolic: 76, heart_rate: 72, temperature: 36.8, spo2: 99, weight: 65 }] },
          isLoading: false,
        };
      }
      if (keyStr.includes('allergies')) {
        return { data: { allergies: [] }, isLoading: false };
      }
      if (keyStr.includes('problems')) {
        return { data: { problems: [] }, isLoading: false };
      }
      if (keyStr.includes('notes') || keyStr.includes('patientChart')) {
        return { data: { notes: [] }, isLoading: false };
      }
      if (keyStr.includes('labCatalog')) {
        return { data: { items: [] }, isLoading: false };
      }
      return { data: null, isLoading: false };
    });
  });

  it('renders with DashboardLayout wrapper', () => {
    renderOPDRecord();
    expect(screen.getByTestId('layout')).toBeInTheDocument();
  });

  it('shows patient info in left column', async () => {
    renderOPDRecord();
    expect(await screen.findByRole('heading', { name: 'Jane Smith' })).toBeInTheDocument();
    expect(screen.getByText('P-001')).toBeInTheDocument();
    expect(screen.getByText(/28y/)).toBeInTheDocument();
    expect(screen.getByText('01800000000')).toBeInTheDocument();
  });

  it('shows SOAP form in center column', async () => {
    renderOPDRecord();
    await screen.findByRole('heading', { name: 'Jane Smith' });
    expect(screen.getByText('SOAP Note')).toBeInTheDocument();
    expect(screen.getByText('Chief Complaint')).toBeInTheDocument();
    expect(screen.getByText('Subjective')).toBeInTheDocument();
    expect(screen.getByText('Objective')).toBeInTheDocument();
    expect(screen.getByText('Assessment')).toBeInTheDocument();
    expect(screen.getByText('Plan')).toBeInTheDocument();
    expect(screen.getByText('Save SOAP Note')).toBeInTheDocument();
  });

  it('shows order panels in right column', async () => {
    renderOPDRecord();
    await screen.findByRole('heading', { name: 'Jane Smith' });
    expect(screen.getByText('Order Lab Tests')).toBeInTheDocument();
    expect(screen.getByText('Order Imaging')).toBeInTheDocument();
    expect(screen.getByText('Prescriptions')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Schedule Follow-up' })).toBeInTheDocument();
  });

  it('passes patient and appointment ids to the prescription form', async () => {
    renderOPDRecord();
    await screen.findByRole('heading', { name: 'Jane Smith' });

    expect(screen.getByRole('link', { name: /new prescription/i })).toHaveAttribute(
      'href',
      '/h/demo-hospital/prescriptions/new?patient=1&appt=10&from=doctor/opd/1/10',
    );
  });

  it('submits follow-up using the patient chart API contract', async () => {
    const { container } = renderOPDRecord();
    await screen.findByRole('heading', { name: 'Jane Smith' });

    const dateInput = container.querySelector('input[type="date"]');
    expect(dateInput).not.toBeNull();
    fireEvent.change(dateInput as HTMLInputElement, { target: { value: '2026-08-05' } });
    fireEvent.change(screen.getByPlaceholderText('Review lab results, check progress...'), {
      target: { value: 'Routine review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Schedule Follow-up' }));

    expect(followUpMutate).toHaveBeenCalledWith({
      apptDate: '2026-08-05',
      notes: 'Routine review',
    });
  });

  it('handles missing patient data', () => {
    (useApiQuery as any).mockImplementation((_key: any, _url: string, opts?: any) => {
      const keyStr = Array.isArray(_key) ? _key.join(',') : String(_key);
      if (keyStr.includes('patients')) {
        return { data: null, isLoading: false, isError: true };
      }
      return { data: null, isLoading: false };
    });
    renderOPDRecord();
    expect(screen.getByText('Patient not found')).toBeInTheDocument();
  });
});
