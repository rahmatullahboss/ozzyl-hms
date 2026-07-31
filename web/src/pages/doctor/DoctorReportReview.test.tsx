import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DoctorReportReview from './DoctorReportReview';
import { useApiMutation, useApiQuery } from '../../hooks/useApiQuery';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useParams: () => ({ slug: 'demo-hospital' }),
  };
});
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('../../components/DashboardLayout', () => ({ default: ({ children }: any) => <div>{children}</div> }));
vi.mock('../../lib/date-utils', () => ({ getTodayGMT6: () => '2026-05-27' }));

describe('DoctorReportReview', () => {
  const mutate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useApiMutation as any).mockReturnValue({ mutate, isPending: false });
    vi.mocked(useApiQuery as any).mockReturnValue({
      data: {
        patients: [{
          appointment_id: 31,
          patient_name: 'Rahim Uddin',
          patient_code: 'P-001',
          validity_badge: 'valid_report_show',
          last_prescription: {
            diagnosis: 'Viral fever',
            items: [{ medicine_name: 'Paracetamol 500mg', dosage: '1+0+1' }],
          },
          ordered_tests: [{ test_name: 'Serum Creatinine', status: 'ordered' }],
          completed_reports: [{ test_name: 'CBC', result: '12.4 g/dL', status: 'reported' }],
        }],
      },
      isLoading: false,
    });
  });

  it('shows report-show validity, prior prescription and completed or pending tests together', () => {
    render(
      <MemoryRouter>
        <DoctorReportReview />
      </MemoryRouter>,
    );

    expect(screen.getByText('Rahim Uddin')).toBeInTheDocument();
    expect(screen.getByText('Valid Report Show')).toBeInTheDocument();
    expect(screen.getByText(/Paracetamol 500mg/)).toBeInTheDocument();
    expect(screen.getByText(/CBC/)).toBeInTheDocument();
    expect(screen.getByText(/Serum Creatinine/)).toBeInTheDocument();
  });

  it('records a doctor review action without rewriting the prescription', () => {
    render(
      <MemoryRouter>
        <DoctorReportReview />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText('Review note for Rahim Uddin'), {
      target: { value: 'Reviewed; continue medication.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark Reviewed' }));

    expect(mutate).toHaveBeenCalledWith({
      appointmentId: 31,
      notes: 'Reviewed; continue medication.',
    });
  });
});
