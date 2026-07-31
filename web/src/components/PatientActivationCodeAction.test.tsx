import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PatientActivationCodeAction } from './PatientActivationCodeAction';
import { api } from '../lib/apiClient';

vi.mock('../lib/apiClient', () => ({
  api: {
    post: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('PatientActivationCodeAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('issues and displays a staff-assisted claim code for the patient', async () => {
    vi.mocked(api.post).mockResolvedValue({
      patient_id: 50,
      uhid: 'OZ-000998',
      claim_code: 'C-8F4K2Q',
      claim_code_expires_at: '2026-05-30T00:00:00.000Z',
    });

    render(<PatientActivationCodeAction patientId={50} uhid="OZ-000998" />);

    fireEvent.click(screen.getByRole('button', { name: /issue claim code/i }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/api/health-record/patients/50/activation-code', {});
    });

    expect(await screen.findByText('C-8F4K2Q')).toBeInTheDocument();
    expect(screen.getByText('/patient/claim-card?uhid=OZ-000998')).toBeInTheDocument();
    expect(screen.queryByText('/patient/claim-card?uhid=OZ-000998&code=C-8F4K2Q')).not.toBeInTheDocument();
  });
});
