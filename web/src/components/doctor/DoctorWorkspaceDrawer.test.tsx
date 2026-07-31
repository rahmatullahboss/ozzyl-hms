import { readFileSync } from 'node:fs';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/apiClient';
import { DoctorWorkspaceDrawer } from './DoctorWorkspaceDrawer';
import type { QueueItem } from './types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/apiClient', () => ({ api: { post: vi.fn(), put: vi.fn(), get: vi.fn() } }));
vi.mock('../../hooks/useAutoSave', () => ({
  useAutoSave: () => ({ save: vi.fn(), isPending: false, isError: false }),
}));
vi.mock('./PatientAIWidget', () => ({ PatientAIWidget: () => <div>AI summary</div> }));
vi.mock('./AIScribe', () => ({ AIScribe: () => <div>AI scribe</div> }));
vi.mock('./SmartPhrases', () => ({ SmartPhrases: () => <div>Smart phrases</div> }));
vi.mock('./QuickCodedDiagnosis', () => ({
  QuickCodedDiagnosis: ({ value, onChange }: any) => value
    ? <button type="button" onClick={() => onChange(null)}>Selected {value.code}</button>
    : <button type="button" onClick={() => onChange({ system: 'ICD-10', code: 'J06.9', description: 'Acute upper respiratory infection, unspecified' })}>Select coded diagnosis</button>,
}));
vi.mock('./PatientLabTrendsPanel', () => ({ PatientLabTrendsPanel: () => <div>Lab trends context</div> }));
vi.mock('./PatientSafetyOverrideHistoryPanel', () => ({ PatientSafetyOverrideHistoryPanel: () => <div>Safety override history</div> }));
vi.mock('./PatientHeader', () => ({ PatientHeader: () => <div data-testid="patient-header">Patient header</div> }));

const patient: QueueItem = {
  id: 1,
  appointment_id: 44,
  patient_id: 10,
  token_no: 4,
  appt_time: '10:00',
  visit_type: 'follow_up',
  status: 'in_progress',
  patient_name: 'Rahim Uddin',
  patient_code: 'P-001',
  patient_age: 45,
  gender: 'Male',
  allergy_count: 1,
  allergy_summary: 'Penicillin',
};

function renderDrawer(onClose = vi.fn(), itemOverride: Partial<QueueItem> = {}) {
  render(
    <MemoryRouter>
      <DoctorWorkspaceDrawer
        item={{ ...patient, ...itemOverride }}
        basePath="/h/demo"
        currentDoctor={{ id: 3, name: 'Dr A' }}
        availableDoctors={[]}
        onClose={onClose}
        onRefresh={vi.fn()}
        onUpdateStatus={vi.fn()}
        onReassign={vi.fn()}
      />
    </MemoryRouter>,
  );
  return onClose;
}

describe('DoctorWorkspaceDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.put).mockReset();
    vi.mocked(api.get).mockReset();
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/api/e-prescribing/formulary/frequent')) {
        return Promise.resolve({ medicines: [] });
      }
      return Promise.resolve({});
    });
  });

  it('exports a valid React component', async () => {
    const mod = await import('./DoctorWorkspaceDrawer');
    expect(mod.DoctorWorkspaceDrawer).toBeDefined();
    expect(typeof mod.DoctorWorkspaceDrawer).toBe('function');
  });

  it('submits prescription item details without selecting a seller', () => {
    const source = readFileSync('src/components/doctor/DoctorWorkspaceDrawer.tsx', 'utf8');
    expect(source).toContain('medicine_name');
    expect(source).toContain('dosage');
    expect(source).toContain('duration');
    expect(source).not.toContain('commission');
  });

  it('keeps Save & Complete disabled until clinical documentation exists', () => {
    renderDrawer();

    expect(screen.getByText('Add SOAP, coded diagnosis, Rx or order before completing')).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Save & Complete' })) {
      expect(button).toBeDisabled();
    }

    fireEvent.change(screen.getByPlaceholderText('Chief complaint'), { target: { value: 'Fever' } });

    for (const button of screen.getAllByRole('button', { name: 'Save & Complete' })) {
      expect(button).not.toBeDisabled();
    }
  });

  it('treats a selected coded diagnosis as clinical documentation and submits it on completion', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ lifecycle: { appointmentStatus: 'completed' } });
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Select coded diagnosis' }));

    expect(screen.getByDisplayValue('Acute upper respiratory infection, unspecified')).toBeInTheDocument();
    const saveButton = screen
      .getAllByRole('button', { name: 'Save & Complete' })
      .find((button) => !(button as HTMLButtonElement).disabled);
    expect(saveButton).toBeDefined();
    fireEvent.click(saveButton!);

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/doctors/dashboard/appointments/44/complete-consultation',
      expect.objectContaining({
        codedDiagnosis: {
          system: 'ICD-10',
          code: 'J06.9',
          description: 'Acute upper respiratory infection, unspecified',
        },
        soap: expect.objectContaining({
          assessment: 'Acute upper respiratory infection, unspecified',
        }),
        completeVisit: true,
      }),
    ));
  });

  it('saves a selected coded diagnosis without completing the visit when Save SOAP is used', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ codedDiagnosis: { system: 'ICD-10', code: 'J06.9' } });
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Select coded diagnosis' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save SOAP' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/doctors/dashboard/appointments/44/complete-consultation',
      expect.objectContaining({
        codedDiagnosis: {
          system: 'ICD-10',
          code: 'J06.9',
          description: 'Acute upper respiratory infection, unspecified',
        },
        completeVisit: false,
      }),
    ));
  });

  it('keeps the consultation open when save and complete fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(api.post).mockRejectedValueOnce(new Error('save failed'));
    const onClose = renderDrawer();
    fireEvent.change(screen.getByPlaceholderText('Chief complaint'), { target: { value: 'Fever' } });

    fireEvent.change(screen.getByPlaceholderText('Chief complaint'), { target: { value: 'Fever' } });
    const saveButton = screen
      .getAllByRole('button', { name: 'Save & Complete' })
      .find((button) => !(button as HTMLButtonElement).disabled);
    expect(saveButton).toBeDefined();
    fireEvent.click(saveButton!);

    try {
      await waitFor(() => expect(api.post).toHaveBeenCalledWith(
        '/api/doctors/dashboard/appointments/44/complete-consultation',
        expect.any(Object),
      ));
      expect(onClose).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('reuses the same completion idempotency key across failed Save & Complete retries', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(api.post)
      .mockRejectedValueOnce(new Error('temporary completion failure'))
      .mockRejectedValueOnce(new Error('temporary completion failure'));
    renderDrawer();
    fireEvent.change(screen.getByPlaceholderText('Chief complaint'), { target: { value: 'Fever' } });

    const firstSaveButton = screen
      .getAllByRole('button', { name: 'Save & Complete' })
      .find((button) => !(button as HTMLButtonElement).disabled);
    fireEvent.click(firstSaveButton!);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    const firstPayload = vi.mocked(api.post).mock.calls[0]?.[1] as Record<string, unknown>;
    expect(firstPayload.completionIdempotencyKey).toMatch(/^doctor-completion:44:/);

    const secondSaveButton = await waitFor(() => {
      const button = screen
        .getAllByRole('button', { name: 'Save & Complete' })
        .find((candidate) => !(candidate as HTMLButtonElement).disabled);
      expect(button).toBeDefined();
      return button!;
    });
    fireEvent.click(secondSaveButton);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    const secondPayload = vi.mocked(api.post).mock.calls[1]?.[1] as Record<string, unknown>;
    expect(secondPayload.completionIdempotencyKey).toBe(firstPayload.completionIdempotencyKey);
    errorSpy.mockRestore();
  });

  it('keeps patient identity and allergy context visible in the consultation workspace', () => {
    renderDrawer();

    expect(screen.getByTestId('patient-header')).toBeInTheDocument();
    const contextPanel = screen.getByTestId('clinical-context-panel');
    expect(within(contextPanel).getByText('ALLERGY')).toBeInTheDocument();
    expect(within(contextPanel).getByText(/Penicillin/)).toBeInTheDocument();
  });

  it('lets doctors collapse the patient context panel for a cleaner focused workspace', () => {
    renderDrawer();

    fireEvent.click(screen.getByLabelText('Close panel'));

    expect(screen.getByLabelText('Show patient panel')).toBeInTheDocument();
    expect(screen.getByTestId('clinical-context-panel').parentElement).toHaveClass('md:hidden');
  });

  it('switches desktop workflow tabs so doctors can focus on one task area', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Orders' }));
    expect(screen.getByText('Structured SOAP Note').closest('section')?.parentElement).toHaveClass('md:hidden');
    expect(screen.getByRole('heading', { name: 'Orders' }).closest('section')?.parentElement).toHaveClass('md:block');

    fireEvent.click(screen.getByRole('button', { name: 'Rx' }));
    expect(screen.getByRole('heading', { name: 'Prescription Cart' }).closest('section')?.parentElement).toHaveClass('md:block');
    expect(screen.getByRole('heading', { name: 'Orders' }).closest('section')?.parentElement).toHaveClass('md:hidden');
  });


  it('supports keyboard-first prescription entry', async () => {
    vi.mocked(api.get).mockImplementation((url: string) => {
      if (url.includes('/api/e-prescribing/formulary/search')) {
        return Promise.resolve({ medicines: [{ name: 'Napa', strength: '500mg', default_frequency: '1+1+1', default_duration: '5 days', default_instructions: 'After meal' }] });
      }
      if (url.includes('/api/e-prescribing/formulary/frequent')) {
        return Promise.resolve({ medicines: [] });
      }
      return Promise.resolve({});
    });
    renderDrawer();

    fireEvent.keyDown(window, { key: 'm', altKey: true });
    const medicineSearch = screen.getByPlaceholderText('Search medicine by brand or generic');
    await waitFor(() => expect(document.activeElement).toBe(medicineSearch));
    expect(screen.getByText('Alt+M focus medicine')).toBeInTheDocument();

    fireEvent.change(medicineSearch, { target: { value: 'nap' } });
    await waitFor(() => expect(screen.getByText('Napa')).toBeInTheDocument());
    fireEvent.keyDown(medicineSearch, { key: 'Enter' });

    expect(screen.getByDisplayValue('Napa')).toBeInTheDocument();
    expect(screen.getByDisplayValue('500mg')).toBeInTheDocument();
  });

  it('keeps historical lab trends visible while the doctor writes a prescription', () => {
    renderDrawer();

    expect(screen.getByText('Lab trends context')).toBeInTheDocument();
  });

  it('warns but does not block Save & Complete when a medicine is missing dose or duration', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Add blank medicine' }));
    fireEvent.change(screen.getByPlaceholderText('Medicine name'), { target: { value: 'Amlodipine' } });

    expect(screen.getByText(/Dose missing/i)).toBeInTheDocument();
    expect(screen.getByText(/Duration missing/i)).toBeInTheDocument();
    for (const button of screen.getAllByRole('button', { name: 'Save & Complete' })) {
      expect(button).not.toBeDisabled();
    }
  });

  it('shows billing state after creating a quick lab order', async () => {
    vi.mocked(api.post).mockImplementation((url: string) => {
      if (url.includes('/chart/lab-order')) {
        return Promise.resolve({ id: 7, orderNo: 'LAB-7', invoiceNo: 'INV-7', billingStatus: 'unpaid', total: 500 });
      }
      return Promise.resolve({});
    });
    renderDrawer();

    fireEvent.change(screen.getByPlaceholderText('Selected test'), { target: { value: '501' } });
    fireEvent.click(screen.getByRole('button', { name: 'Order Lab' }));

    await waitFor(() => expect(screen.getByText('Billing pending')).toBeInTheDocument());
    expect(screen.getByText('LAB-7')).toBeInTheDocument();
    expect(screen.getByText('INV-7')).toBeInTheDocument();
  });

  it('does not fall back to the first lab catalog row when quick lab aliases do not match', () => {
    const source = readFileSync('src/components/doctor/DoctorWorkspaceDrawer.tsx', 'utf8');

    expect(source).not.toContain('}) ?? tests[0]');
  });

  it('warns before closing when unsaved SOAP documentation would be lost', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const onClose = renderDrawer();

    fireEvent.change(screen.getByPlaceholderText('Chief complaint'), { target: { value: 'New chest pain' } });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringMatching(/unsaved clinical work/i));
    expect(onClose).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    confirmSpy.mockRestore();
  });

  it('disables appointment-scoped prescription actions when appointment id is missing', () => {
    renderDrawer(vi.fn(), { appointment_id: undefined });

    expect(screen.getByRole('button', { name: 'Save Rx' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Full Rx Page' })).toBeDisabled();
    expect(screen.queryByRole('link', { name: 'Full Rx Page' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finalize Rx' })).toBeDisabled();
  });

  it('does not fall back to queue row id for appointment-scoped doctor actions', () => {
    const source = readFileSync('src/components/doctor/DoctorWorkspaceDrawer.tsx', 'utf8');

    expect(source).not.toContain('item.appointment_id ?? item.id');
    expect(source).toContain('const appointmentId = item.appointment_id ?? null');
    expect(source).toContain('if (appointmentId == null)');
    expect(source).toContain('appointmentId != null ? (');
    expect(source).toContain('disabled className="btn-ghost text-sm opacity-50"');
  });
});
