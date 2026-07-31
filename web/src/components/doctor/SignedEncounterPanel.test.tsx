import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/apiClient';
import { useApiQuery } from '../../hooks/useApiQuery';
import SignedEncounterPanel from './SignedEncounterPanel';

const invalidateQueries = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const DETAIL = {
  Results: {
    id: 700,
    visit_id: 99,
    appointment_id: 44,
    encounter_type: 'outpatient',
    status: 'signed',
    start_time: '2026-07-11 09:00:00',
    end_time: '2026-07-11 09:30:00',
    signed_at: '2026-07-11 09:30:00',
    snapshot_hash: 'a'.repeat(64),
    signature_version: 1,
    addendum_count: 1,
    signed_snapshot: JSON.stringify({
      soap: { assessment: 'Acute upper respiratory infection' },
      codedDiagnosis: { code: 'J06.9', description: 'Acute upper respiratory infection, unspecified' },
      prescription: { id: 501, rxNo: 'RX-501', status: 'final' },
      clinicalOrders: [{ type: 'lab', id: 201, orderNo: 'LAB-201', status: 'pending' }],
    }),
    order_refs_json: '[]',
    addenda: [{
      id: 1,
      author_id: 42,
      reason: 'Clarification',
      content: 'Corrected medication timing.',
      previous_snapshot_hash: 'a'.repeat(64),
      addendum_hash: 'b'.repeat(64),
      created_at: '2026-07-11 10:00:00',
    }],
  },
};

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/apiClient', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useQueryClient: () => ({ invalidateQueries }),
}));

const encounter = {
  id: 700,
  visit_id: 99,
  appointment_id: 44,
  encounter_type: 'outpatient',
  status: 'signed',
  start_time: '2026-07-11 09:00:00',
  end_time: '2026-07-11 09:30:00',
  chief_complaint: 'Fever and cough',
  signed_at: '2026-07-11 09:30:00',
  snapshot_hash: 'a'.repeat(64),
  signature_version: 1,
  addendum_count: 1,
};

const formatDateTime = (value?: string | null) => value ?? '—';

describe('SignedEncounterPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery).mockReturnValue({ data: DETAIL, isLoading: false } as any);
  });

  it('shows signed metadata before loading the immutable detail', () => {
    render(<SignedEncounterPanel encounter={encounter} role="doctor" formatDateTime={formatDateTime} />);

    const card = screen.getByTestId('signed-encounter-700');
    expect(within(card).getByText('Signed v1')).toBeInTheDocument();
    expect(within(card).getByText('1 addendum')).toBeInTheDocument();
    expect(within(card).getByText(/Fever and cough/i)).toBeInTheDocument();
    expect(within(card).getByText(/Hash aaaaaaaaaa…aaaaaaaa/i)).toBeInTheDocument();
  });

  it('expands the signed snapshot and addendum history as read-only clinical content', () => {
    render(<SignedEncounterPanel encounter={encounter} role="doctor" formatDateTime={formatDateTime} />);

    fireEvent.click(screen.getByRole('button', { name: /outpatient/i }));

    expect(screen.getByText(/Original snapshot is immutable/i)).toBeInTheDocument();
    expect(screen.getByText('Acute upper respiratory infection')).toBeInTheDocument();
    expect(screen.getByText(/J06.9/)).toBeInTheDocument();
    expect(screen.getByText(/RX-501 · final/)).toBeInTheDocument();
    expect(screen.getByText('1 linked order')).toBeInTheDocument();
    expect(screen.getByText('Corrected medication timing.')).toBeInTheDocument();
  });

  it('appends a correction and invalidates only the signed encounter detail', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ Results: { encounterId: 700 } });
    render(<SignedEncounterPanel encounter={encounter} role="doctor" formatDateTime={formatDateTime} />);

    fireEvent.click(screen.getByRole('button', { name: /outpatient/i }));
    fireEvent.change(screen.getByLabelText('Addendum reason for encounter 700'), {
      target: { value: 'Clarify dosage instruction' },
    });
    fireEvent.change(screen.getByLabelText('Addendum content for encounter 700'), {
      target: { value: 'Take the medicine once daily after breakfast.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Append addendum' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/clinical/encounters/700/addenda',
      {
        reason: 'Clarify dosage instruction',
        content: 'Take the medicine once daily after breakfast.',
      },
    ));
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['signed-encounter', 700] });
  });

  it('does not show the correction form to a read-only role', () => {
    render(<SignedEncounterPanel encounter={encounter} role="reception" formatDateTime={formatDateTime} />);

    fireEvent.click(screen.getByRole('button', { name: /outpatient/i }));

    expect(screen.queryByLabelText('Addendum reason for encounter 700')).not.toBeInTheDocument();
    expect(screen.getByText('Corrected medication timing.')).toBeInTheDocument();
  });
});
