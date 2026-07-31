import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { api } from '../lib/apiClient';
import DigitalPrescription from './DigitalPrescription';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));
vi.mock('../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPrescription() {
  return render(
    <MemoryRouter initialEntries={['/h/demo/prescriptions/new?patient=10&admission=300&reconciliation=71&from=doctor/ipd/300']}>
      <Routes>
        <Route path="/h/:slug/prescriptions/new" element={<DigitalPrescription />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('DigitalPrescription discharge reconciliation hand-off', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('blocks saving until the completed reconciliation is loaded and then prefills medicines', async () => {
    const reconciliation = deferred<{ Results: Record<string, unknown> & { items: Record<string, unknown>[] } }>();
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/api/nursing/medication-reconciliation/71') return reconciliation.promise as any;
      if (path === '/api/patients/10') return Promise.resolve({ patient: { id: 10, name: 'Patient A', patient_code: 'P-10' } }) as any;
      if (path === '/api/patients/10/chart') return Promise.resolve({}) as any;
      if (path === '/api/doctors/dashboard') return Promise.resolve({ doctor: { id: 4, name: 'Dr Test' } }) as any;
      if (path.includes('/api/e-prescribing/formulary/frequent')) return Promise.resolve({ medicines: [] }) as any;
      if (path.includes('/api/prescriptions/frequent-lab-tests')) return Promise.resolve({ tests: [] }) as any;
      return Promise.resolve({}) as any;
    });

    renderPrescription();

    expect(await screen.findByRole('button', { name: 'Save Draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finalise Rx' })).toBeDisabled();

    await act(async () => {
      reconciliation.resolve({
        Results: {
          id: 71,
          patient_id: 10,
          reconciliation_type: 'discharge',
          status: 'completed',
          items: [
            {
              medication_name: 'Amlodipine',
              dose: '5 mg',
              frequency: 'once daily',
              route: 'oral',
              action: 'modify',
              new_dose: '10 mg',
              new_frequency: 'once daily',
              new_route: 'oral',
            },
            {
              medication_name: 'Ceftriaxone',
              action: 'discontinue',
              action_reason: 'Course completed',
            },
          ],
        },
      });
    });

    expect(await screen.findByDisplayValue('Amlodipine')).toBeInTheDocument();
    expect(screen.getByDisplayValue('10 mg')).toBeInTheDocument();
    const handoffBanner = screen.getByTestId('discharge-reconciliation-handoff');
    expect(within(handoffBanner).getByText(/stopped medicines:/i)).toBeInTheDocument();
    expect(within(handoffBanner).getByText(/ceftriaxone/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeEnabled();
  });

  it('sends admission and reconciliation provenance when the reviewed draft is saved', async () => {
    vi.mocked(api.get).mockImplementation((path: string) => {
      if (path === '/api/nursing/medication-reconciliation/71') {
        return Promise.resolve({
          Results: {
            id: 71,
            patient_id: 10,
            reconciliation_type: 'discharge',
            status: 'completed',
            items: [{ medication_name: 'Amlodipine', dose: '10 mg', frequency: 'Once Daily', action: 'continue' }],
          },
        }) as any;
      }
      if (path === '/api/patients/10') return Promise.resolve({ patient: { id: 10, name: 'Patient A', patient_code: 'P-10' } }) as any;
      if (path === '/api/patients/10/chart') return Promise.resolve({}) as any;
      if (path === '/api/doctors/dashboard') return Promise.resolve({ doctor: { id: 4, name: 'Dr Test' } }) as any;
      if (path.includes('/api/e-prescribing/formulary/frequent')) return Promise.resolve({ medicines: [] }) as any;
      if (path.includes('/api/prescriptions/frequent-lab-tests')) return Promise.resolve({ tests: [] }) as any;
      return Promise.resolve({}) as any;
    });
    vi.mocked(api.post).mockResolvedValueOnce({ id: 901, rxNo: 'RX-901' });

    renderPrescription();
    await screen.findByDisplayValue('Amlodipine');
    fireEvent.change(screen.getByPlaceholderText('5 Days'), { target: { value: '30 days' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/prescriptions',
      expect.objectContaining({
        patientId: 10,
        doctorId: 4,
        admissionId: 300,
        sourceReconciliationId: 71,
        status: 'draft',
        items: [expect.objectContaining({
          medicine_name: 'Amlodipine',
          dosage: '10 mg',
          duration: '30 days',
        })],
      }),
    ));
  });
});
