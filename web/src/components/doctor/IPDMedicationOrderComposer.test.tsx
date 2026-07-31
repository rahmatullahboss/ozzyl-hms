import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/apiClient';
import { useApiQuery } from '../../hooks/useApiQuery';
import IPDMedicationOrderComposer from './IPDMedicationOrderComposer';

const invalidateQueries = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const EMPTY_ORDERS = { Results: [] as Record<string, unknown>[] };

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries }),
}));

function renderComposer(visitId: number | null = 20) {
  return render(
    <IPDMedicationOrderComposer patientId={10} visitId={visitId} admissionId={300} />,
  );
}

describe('IPDMedicationOrderComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({ data: EMPTY_ORDERS, isLoading: false } as any);
  });

  it('disables medication ordering when the admission has no active IPD visit', () => {
    renderComposer(null);

    expect(screen.getByText(/not linked to an active IPD visit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /place order/i })).toBeDisabled();
    expect(screen.getByLabelText('Medication name')).toBeDisabled();
  });

  it('creates a patient and visit scoped medication order with a retry-safe key', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ Results: { id: 501, status: 'active', replayed: false } });
    renderComposer();

    fireEvent.change(screen.getByLabelText('Medication name'), { target: { value: 'Ceftriaxone' } });
    fireEvent.change(screen.getByLabelText('Generic name'), { target: { value: 'Ceftriaxone' } });
    fireEvent.change(screen.getByLabelText('Dose'), { target: { value: '1 g' } });
    fireEvent.change(screen.getByLabelText('Route'), { target: { value: 'IV' } });
    fireEvent.change(screen.getByLabelText('Frequency'), { target: { value: 'BD' } });
    fireEvent.change(screen.getByLabelText('Duration'), { target: { value: '5 days' } });
    fireEvent.change(screen.getByLabelText('Medication priority'), { target: { value: 'urgent' } });
    fireEvent.change(screen.getByLabelText('Medication instructions'), { target: { value: 'Administer slowly' } });
    fireEvent.click(screen.getByRole('button', { name: /place order/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/nursing/medication-orders',
      expect.objectContaining({
        patient_id: 10,
        visit_id: 20,
        medication_name: 'Ceftriaxone',
        generic_name: 'Ceftriaxone',
        dose: '1 g',
        route: 'IV',
        frequency: 'BD',
        duration: '5 days',
        priority: 'urgent',
        instructions: 'Administer slowly',
        idempotency_key: expect.stringMatching(/^doctor-order:/),
      }),
    ));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['ipd-medication-orders', 10, 20] });
  });

  it('requires a reason and sends hold decisions to the dedicated endpoint', async () => {
    const orderData = {
      Results: [{
        id: 501,
        medication_name: 'Ceftriaxone',
        dose: '1 g',
        route: 'IV',
        frequency: 'BD',
        priority: 'routine',
        status: 'active',
      }],
    };
    vi.mocked(useApiQuery).mockReturnValue({ data: orderData, isLoading: false } as any);
    vi.mocked(api.put).mockResolvedValueOnce({ Results: { id: 501, status: 'on_hold' } });
    renderComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    const confirm = screen.getByRole('button', { name: 'Confirm' });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Medication order action reason'), { target: { value: 'Patient is NPO' } });
    fireEvent.click(confirm);

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/api/nursing/medication-orders/501/hold',
      { status_reason: 'Patient is NPO' },
    ));
  });

  it('sends discontinue decisions with the doctor clinical reason', async () => {
    const orderData = {
      Results: [{
        id: 501,
        medication_name: 'Ceftriaxone',
        dose: '1 g',
        route: 'IV',
        frequency: 'BD',
        priority: 'routine',
        status: 'active',
      }],
    };
    vi.mocked(useApiQuery).mockReturnValue({ data: orderData, isLoading: false } as any);
    vi.mocked(api.put).mockResolvedValueOnce({ Results: { id: 501, status: 'discontinued' } });
    renderComposer();

    fireEvent.click(screen.getByRole('button', { name: 'Discontinue' }));
    fireEvent.change(screen.getByLabelText('Medication order action reason'), { target: { value: 'Antibiotic course completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/api/nursing/medication-orders/501/discontinue',
      { status_reason: 'Antibiotic course completed' },
    ));
  });

  it('uses formulary metadata when a medicine search result is selected', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      medicines: [{
        medicine_id: 30,
        name: 'Ceftriaxone',
        generic: 'Ceftriaxone',
        strength: '1 g',
        dosage_form: 'Injection',
        default_frequency: 'BD',
        default_duration: '5 days',
        default_instructions: 'Administer slowly',
      }],
    });

    renderComposer();
    fireEvent.change(screen.getByLabelText('Search inpatient medicine'), { target: { value: 'cef' } });
    const result = await screen.findByRole('button', { name: /Ceftriaxone.*1 g.*Injection/i });
    fireEvent.click(result);

    expect(screen.getByLabelText('Medication name')).toHaveValue('Ceftriaxone');
    expect(screen.getByLabelText('Generic name')).toHaveValue('Ceftriaxone');
    expect(screen.getByLabelText('Route')).toHaveValue('Oral');
    expect(screen.getByLabelText('Frequency')).toHaveValue('BD');
    expect(screen.getByLabelText('Duration')).toHaveValue('5 days');
  });
});
