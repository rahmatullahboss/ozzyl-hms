import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import toast from 'react-hot-toast';
import { api } from '../../lib/apiClient';
import { useApiQuery } from '../../hooks/useApiQuery';
import MedicationReconciliationPanel from './MedicationReconciliationPanel';

const invalidateQueries = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const EMPTY_HISTORY = { Results: [] as Record<string, unknown>[] };

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries }),
}));

describe('MedicationReconciliationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockImplementation((key: readonly unknown[]) => {
      const joined = key.join(',');
      if (joined.includes('patient')) return { data: EMPTY_HISTORY, isLoading: false } as any;
      return { data: null, isLoading: false } as any;
    });
  });

  it('requires a real IPD visit before starting a transition reconciliation', () => {
    render(<MedicationReconciliationPanel patientId={10} visitId={null} />);

    expect(screen.getByText(/not linked to an active IPD visit/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start/i })).toBeDisabled();
  });

  it('starts a discharge reconciliation with patient and visit context', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ Results: { id: 71 } });
    render(<MedicationReconciliationPanel patientId={10} visitId={20} defaultType="discharge" />);

    fireEvent.change(screen.getByPlaceholderText('Optional transition note'), {
      target: { value: 'Discharge medicines reviewed with family' },
    });
    fireEvent.click(screen.getByRole('button', { name: /start/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/nursing/medication-reconciliation',
      {
        patient_id: 10,
        visit_id: 20,
        reconciliation_type: 'discharge',
        notes: 'Discharge medicines reviewed with family',
      },
    ));
  });

  it('saves a discontinue decision and its clinical reason', async () => {
    const openHistory = {
      Results: [{ id: 71, patientId: 10, visitId: 20, reconciliationType: 'discharge', status: 'in_progress' }],
    };
    const openDetail = {
      Results: {
        id: 71,
        patientId: 10,
        visitId: 20,
        reconciliationType: 'discharge',
        status: 'in_progress',
        items: [{
          id: 9,
          medicationName: 'Amlodipine',
          dose: '5 mg',
          frequency: 'once daily',
          route: 'oral',
          source: 'inpatient',
          action: 'continue',
        }],
      },
    };
    vi.mocked(useApiQuery).mockImplementation((key: readonly unknown[]) => {
      const joined = key.join(',');
      if (joined.includes('patient')) return { data: openHistory, isLoading: false } as any;
      if (joined.includes('detail,71')) return { data: openDetail, isLoading: false } as any;
      return { data: null, isLoading: false } as any;
    });
    vi.mocked(api.put).mockResolvedValueOnce({ Results: { id: 9 } });

    render(<MedicationReconciliationPanel patientId={10} visitId={20} />);

    const action = await screen.findByLabelText('Action for Amlodipine');
    fireEvent.change(action, { target: { value: 'discontinue' } });
    fireEvent.change(screen.getByPlaceholderText('Reason required'), { target: { value: 'Therapy completed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Amlodipine decision' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/api/nursing/medication-reconciliation/71/items/9',
      expect.objectContaining({ action: 'discontinue', action_reason: 'Therapy completed' }),
    ));
  });

  it('keeps completion successful but warns when discharge checklist sync fails', async () => {
    const openHistory = {
      Results: [{ id: 71, patientId: 10, visitId: 20, reconciliationType: 'discharge', status: 'in_progress' }],
    };
    const openDetail = {
      Results: {
        id: 71,
        patientId: 10,
        visitId: 20,
        reconciliationType: 'discharge',
        status: 'in_progress',
        items: [],
      },
    };
    vi.mocked(useApiQuery).mockImplementation((key: readonly unknown[]) => {
      const joined = key.join(',');
      if (joined.includes('patient')) return { data: openHistory, isLoading: false } as any;
      if (joined.includes('detail,71')) return { data: openDetail, isLoading: false } as any;
      return { data: null, isLoading: false } as any;
    });
    vi.mocked(api.put).mockResolvedValueOnce({
      Results: { id: 71, status: 'completed', dischargeChecklistSynced: false },
    });
    const onCompleted = vi.fn();

    render(<MedicationReconciliationPanel patientId={10} visitId={20} onCompleted={onCompleted} />);

    fireEvent.click(await screen.findByRole('button', { name: /complete & lock/i }));

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/api/nursing/medication-reconciliation/71/complete',
      {},
    ));
    expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/checklist was not synced/i));
    expect(onCompleted).toHaveBeenCalledTimes(1);
  });

  it('opens a provenance-linked discharge prescription after reconciliation is completed', async () => {
    const completedHistory = {
      Results: [{ id: 71, patientId: 10, visitId: 20, reconciliationType: 'discharge', status: 'completed' }],
    };
    const completedDetail = {
      Results: {
        id: 71,
        patientId: 10,
        visitId: 20,
        reconciliationType: 'discharge',
        status: 'completed',
        completedAt: '2026-07-11T00:00:00Z',
        items: [],
      },
    };
    vi.mocked(useApiQuery).mockImplementation((key: readonly unknown[]) => {
      const joined = key.join(',');
      if (joined.includes('patient')) return { data: completedHistory, isLoading: false } as any;
      if (joined.includes('detail,71')) return { data: completedDetail, isLoading: false } as any;
      return { data: null, isLoading: false } as any;
    });

    render(
      <MemoryRouter>
        <MedicationReconciliationPanel
          patientId={10}
          visitId={20}
          admissionId={300}
          basePath="/h/demo-hospital"
        />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /create discharge prescription/i });
    expect(link).toHaveAttribute(
      'href',
      '/h/demo-hospital/prescriptions/new?patient=10&admission=300&reconciliation=71&from=doctor/ipd/300',
    );
  });

  it('opens the existing discharge prescription instead of offering a duplicate', async () => {
    const completedHistory = {
      Results: [{ id: 71, patientId: 10, visitId: 20, reconciliationType: 'discharge', status: 'completed' }],
    };
    const completedDetail = {
      Results: {
        id: 71,
        patientId: 10,
        visitId: 20,
        reconciliationType: 'discharge',
        status: 'completed',
        items: [],
        linked_prescription: { id: 901, rx_no: 'RX-901', status: 'draft' },
      },
    };
    vi.mocked(useApiQuery).mockImplementation((key: readonly unknown[]) => {
      const joined = key.join(',');
      if (joined.includes('patient')) return { data: completedHistory, isLoading: false } as any;
      if (joined.includes('detail,71')) return { data: completedDetail, isLoading: false } as any;
      return { data: null, isLoading: false } as any;
    });

    render(
      <MemoryRouter>
        <MedicationReconciliationPanel
          patientId={10}
          visitId={20}
          admissionId={300}
          basePath="/h/demo-hospital"
        />
      </MemoryRouter>,
    );

    const link = await screen.findByRole('link', { name: /open discharge prescription.*rx-901/i });
    expect(link).toHaveAttribute('href', '/h/demo-hospital/prescriptions/901?from=doctor/ipd/300');
    expect(screen.queryByRole('link', { name: /create discharge prescription/i })).not.toBeInTheDocument();
  });
});
