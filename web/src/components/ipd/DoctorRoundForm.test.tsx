import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorRoundForm, { getDhakaRoundDefaults } from './DoctorRoundForm';

const mockMutate = vi.fn();
const mockInvalidateQueries = vi.fn();
let mutationOptions: { onSuccess?: () => void } | undefined;
const uuid = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: () => ({
    data: {
      doctors: [
        { id: 4, name: 'Dr Round', is_active: 1, ipd_round_fee: 700 },
        { id: 5, name: 'Dr Unconfigured', is_active: 1, ipd_round_fee: 0 },
      ],
    },
    isLoading: false,
  }),
  useApiMutation: (_method: string, _path: string, options: { onSuccess?: () => void }) => {
    mutationOptions = options;
    return { mutate: mockMutate, isPending: false };
  },
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('../DoctorCombobox', () => ({
  default: ({ onChange }: { onChange: (doctor: { id: number; name: string }) => void }) => (
    <div>
      <button type="button" onClick={() => onChange({ id: 4, name: 'Dr Round' })}>Select Dr Round</button>
      <button type="button" onClick={() => onChange({ id: 5, name: 'Dr Unconfigured' })}>Select Dr Unconfigured</button>
    </div>
  ),
}));

describe('DoctorRoundForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutationOptions = undefined;
    uuid.mockReset();
    uuid.mockReturnValueOnce('round-key-1').mockReturnValueOnce('round-key-2');
    vi.spyOn(globalThis.crypto, 'randomUUID').mockImplementation(uuid);
  });

  it('uses Bangladesh-local date and time defaults', () => {
    expect(getDhakaRoundDefaults(new Date('2026-06-18T08:35:00.000Z'))).toEqual({
      roundDate: '2026-06-18',
      roundTime: '14:35',
    });
  });

  it('shows the admission, selected doctor fee, and submits only server-owned identifiers', () => {
    render(
      <DoctorRoundForm
        patientId={9}
        patientName="Test Patient"
        admissionId={21}
        admissionNo="ADM-21"
        entrySource="nurse_station"
      />,
    );

    expect(screen.getByText(/Test Patient/)).toBeInTheDocument();
    expect(screen.getByText(/ADM-21/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Select Dr Round'));
    expect(screen.getByLabelText('doctorRound.fee')).toHaveValue(700);
    expect(screen.getByLabelText('doctorRound.fee')).toHaveAttribute('readonly');

    fireEvent.click(screen.getByRole('button', { name: 'doctorRound.save' }));
    expect(mockMutate).toHaveBeenCalledWith({
      admissionId: 21,
      patientId: 9,
      doctorId: 4,
      roundDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      roundTime: expect.stringMatching(/^\d{2}:\d{2}$/),
      entrySource: 'nurse_station',
      idempotencyKey: 'round-key-1',
    });
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('fee');
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('doctorName');
    expect(mockMutate.mock.calls[0][0]).not.toHaveProperty('note');
  });

  it('reuses the idempotency key during retry and rotates it after success', () => {
    render(
      <DoctorRoundForm
        patientId={9}
        patientName="Test Patient"
        admissionId={21}
        admissionNo="ADM-21"
        entrySource="ipd_billing"
      />,
    );
    fireEvent.click(screen.getByText('Select Dr Round'));
    const submit = screen.getByRole('button', { name: 'doctorRound.save' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(mockMutate.mock.calls[0][0].idempotencyKey).toBe('round-key-1');
    expect(mockMutate.mock.calls[1][0].idempotencyKey).toBe('round-key-1');

    act(() => mutationOptions?.onSuccess?.());
    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['ipdDoctorRounds', 21] });
    fireEvent.click(submit);
    expect(mockMutate.mock.calls[2][0].idempotencyKey).toBe('round-key-2');
  });

  it('blocks doctors without a configured IPD round fee', () => {
    render(
      <DoctorRoundForm
        patientId={9}
        patientName="Test Patient"
        admissionId={21}
        admissionNo="ADM-21"
        entrySource="nurse_station"
      />,
    );
    fireEvent.click(screen.getByText('Select Dr Unconfigured'));
    expect(screen.getByText('doctorRound.feeNotConfigured')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'doctorRound.save' })).toBeDisabled();
  });
});
