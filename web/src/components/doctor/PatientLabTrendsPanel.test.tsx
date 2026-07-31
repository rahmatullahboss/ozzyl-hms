import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/apiClient';
import { PatientLabTrendsPanel } from './PatientLabTrendsPanel';

vi.mock('../../lib/apiClient', () => ({ api: { get: vi.fn() } }));

describe('PatientLabTrendsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue({
      results: [
        { test_name: 'HbA1c', result_value: '8.1', unit: '%', reported_at: '2026-05-22', flag: 'high' },
        { test_name: 'HbA1c', result_value: '7.5', unit: '%', reported_at: '2026-02-10', flag: 'normal' },
      ],
    });
  });

  it('loads recent patient results and identifies abnormal trend context', async () => {
    render(<PatientLabTrendsPanel patientId={10} />);

    const hba1cRows = await screen.findAllByText('HbA1c');
    expect(api.get).toHaveBeenCalledWith('/api/lab/cumulative/10?limit=24');
    expect(screen.getByText('Lab Trends')).toBeInTheDocument();
    expect(hba1cRows.length).toBeGreaterThan(0);
    expect(screen.getByText('8.1 %')).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
  });
});
