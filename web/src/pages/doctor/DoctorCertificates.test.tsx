import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorCertificates from './DoctorCertificates';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';

vi.mock('../../components/DashboardLayout', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../lib/date-utils', () => ({ getTodayGMT6: () => '2026-05-27' }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: any) => opts?.defaultValue ?? k,
  }),
}));

describe('DoctorCertificates', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiQuery as any).mockImplementation((key: unknown[]) => {
      if (key.includes('patient-search')) {
        return { data: { patients: [{ id: 9, name: 'Rahim Uddin', patient_code: 'P-001', mobile: '01700000000' }] }, isLoading: false };
      }
      return { data: { certificates: [] }, isLoading: false };
    });
    vi.mocked(useApiMutation as any).mockReturnValue({ mutate, isPending: false });
  });

  it('requires the doctor to select a visible patient identity before issuing a certificate', () => {
    render(
      <MemoryRouter>
        <DoctorCertificates />
      </MemoryRouter>,
    );

    expect(screen.getByText('Medical Certificates')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search patient'), { target: { value: 'Rahim' } });
    fireEvent.click(screen.getByRole('button', { name: /Rahim Uddin.*P-001/i }));
    fireEvent.change(screen.getByLabelText('Recommendation'), { target: { value: 'Rest advised for three days.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Issue Certificate' }));

    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({
      patientId: 9,
      certificateType: 'medical',
      recommendation: 'Rest advised for three days.',
    }));
    expect(screen.queryByRole('button', { name: /edit/i })).not.toBeInTheDocument();
  });

  it('renders a final certificate preview before printing', () => {
    vi.mocked(useApiQuery as any).mockImplementation((key: unknown[]) => {
      if (key.includes('patient-search')) return { data: { patients: [] }, isLoading: false };
      return {
        data: {
          certificates: [{
            id: 12,
            certificate_no: 'MED-2026-ABC12345',
            certificate_type: 'medical',
            patient_name: 'Rahim Uddin',
            patient_code: 'P-001',
            doctor_name: 'Dr Ahmed',
            bmdc_reg_no: 'BMDC-12',
            issue_date: '2026-05-27',
            recommendation: 'Rest advised for three days.',
            status: 'final',
          }],
        },
        isLoading: false,
      };
    });

    render(<MemoryRouter><DoctorCertificates /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Preview & Print' }));

    expect(screen.getAllByText('MED-2026-ABC12345').length).toBeGreaterThan(1);
    expect(screen.getByText('Dr Ahmed')).toBeInTheDocument();
    expect(screen.getByText('BMDC-12')).toBeInTheDocument();
    expect(screen.getByText('Rest advised for three days.')).toBeInTheDocument();
  });
});
