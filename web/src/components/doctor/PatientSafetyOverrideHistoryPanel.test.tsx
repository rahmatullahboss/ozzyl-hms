import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/apiClient';
import { PatientSafetyOverrideHistoryPanel } from './PatientSafetyOverrideHistoryPanel';

vi.mock('../../lib/apiClient', () => ({ api: { get: vi.fn() } }));

describe('PatientSafetyOverrideHistoryPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and displays patient safety override history', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      overrides: [{
        id: 77,
        patient_id: 10,
        medication_name: 'Warfarin, Aspirin',
        override_reason: 'Benefit outweighs risk after counselling',
        warning_count: 2,
        checked_by_name: 'Dr. Safety',
        checked_at: '2026-06-20T10:00:00Z',
      }],
    });

    render(<PatientSafetyOverrideHistoryPanel patientId={10} />);

    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/e-prescribing/safety-overrides?patientId=10&limit=5'));
    expect(await screen.findByText('Safety Override History')).toBeInTheDocument();
    expect(screen.getByText('Warfarin, Aspirin')).toBeInTheDocument();
    expect(screen.getByText('Benefit outweighs risk after counselling')).toBeInTheDocument();
    expect(screen.getByText('By Dr. Safety')).toBeInTheDocument();
  });

  it('stays hidden when there is no override history', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({ overrides: [] });

    const { container } = render(<PatientSafetyOverrideHistoryPanel patientId={10} />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
