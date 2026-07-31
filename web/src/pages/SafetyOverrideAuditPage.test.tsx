import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/apiClient';
import SafetyOverrideAuditPage from './SafetyOverrideAuditPage';

vi.mock('../lib/apiClient', () => ({ api: { get: vi.fn() } }));

describe('SafetyOverrideAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and displays override audit entries', async () => {
    vi.mocked(api.get).mockResolvedValueOnce({
      overrides: [{
        id: 77,
        prescription_id: 501,
        patient_id: 10,
        patient_name: 'Rahim Uddin',
        patient_code: 'P-001',
        medication_name: 'Medicine A, Medicine B',
        generic_name: 'generic-a',
        warning_count: 2,
        override_reason: 'Approved by consultant after review',
        checked_by_name: 'Dr. Safety',
        checked_at: '2026-06-20T10:00:00Z',
      }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1, hasMore: false },
    });

    render(<SafetyOverrideAuditPage />);

    expect(await screen.findByText('Safety Override Audit')).toBeInTheDocument();
    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('Medicine A, Medicine B')).toBeInTheDocument();
    expect(screen.getByText('Approved by consultant after review')).toBeInTheDocument();
    expect(screen.getByText('Dr. Safety')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/e-prescribing/safety-overrides?page=1&limit=20');
  });
});
