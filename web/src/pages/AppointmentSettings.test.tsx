import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AppointmentSettings from './AppointmentSettings';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: any) => opts?.defaultValue ?? k }) }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ slug: 'city-hospital' }) };
});

const mockInvalidateQueries = vi.fn();
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('../components/DashboardLayout', () => ({ default: ({ children }: any) => <div data-testid="layout">{children}</div> }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { useApiQuery, useApiMutation } from '../hooks/useApiQuery';

const MOCK_SETTINGS = {
  appointment_mode: 'serial',
  token_prefix: 'OPD',
  token_reset: 'daily',
  token_print_size: 'a5',
  show_fee_on_token: true,
  auto_next_serial: true,
  manual_call_patient: true,
  skip_patient_allowed: false,
  no_show_mark_allowed: true,
  doctor_can_call_next: true,
  followup_validity_days: 7,
  followup_fee: 0,
  followup_serial_priority: true,
};

describe('AppointmentSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: { settings: MOCK_SETTINGS }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('renders the page title', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByText('Appointment Settings')).toBeInTheDocument();
  });

  it('renders all setting sections', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByText('Appointment Mode')).toBeInTheDocument();
    expect(screen.getByText('Token Settings')).toBeInTheDocument();
    expect(screen.getByText('Queue Settings')).toBeInTheDocument();
    expect(screen.getByText('Follow-up Settings')).toBeInTheDocument();
  });

  // ── Appointment Mode ────────────────────────────────────────────────────────

  it('shows appointment mode radio buttons', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByRole('radio', { name: /serial/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /time slot/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /both/i })).toBeInTheDocument();
  });

  it('selects the current appointment mode', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByRole('radio', { name: /serial/i })).toBeChecked();
  });

  it('changes appointment mode when radio is clicked', async () => {
    const user = userEvent.setup();
    render(<AppointmentSettings role="hospital_admin" />);
    await user.click(screen.getByRole('radio', { name: /time slot/i }));
    expect(screen.getByRole('radio', { name: /time slot/i })).toBeChecked();
  });

  // ── Token Settings ──────────────────────────────────────────────────────────

  it('shows token prefix input', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/token prefix/i)).toHaveValue('OPD');
  });

  it('shows token reset dropdown', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/token reset/i)).toBeInTheDocument();
  });

  it('shows token print size dropdown', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/print size/i)).toBeInTheDocument();
  });

  it('shows show fee on token toggle', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /show fee/i })).toBeInTheDocument();
  });

  // ── Queue Settings ──────────────────────────────────────────────────────────

  it('shows queue setting toggles', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /auto next/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /manual call/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /skip patient/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /no.show/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /doctor can call/i })).toBeInTheDocument();
  });

  it('toggles queue settings when clicked', async () => {
    const user = userEvent.setup();
    render(<AppointmentSettings role="hospital_admin" />);
    const skipToggle = screen.getByRole('switch', { name: /skip patient/i });
    expect(skipToggle).not.toBeChecked();
    await user.click(skipToggle);
    expect(skipToggle).toBeChecked();
  });

  // ── Follow-up Settings ──────────────────────────────────────────────────────

  it('shows follow-up validity input', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/validity/i)).toHaveValue(7);
  });

  it('shows follow-up fee input', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/follow.?up fee/i)).toHaveValue(0);
  });

  it('shows follow-up priority toggle', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /priority/i })).toBeInTheDocument();
  });

  // ── Save ────────────────────────────────────────────────────────────────────

  it('shows save button', () => {
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('saves settings when save button is clicked', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<AppointmentSettings role="hospital_admin" />);
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(mockMutate).toHaveBeenCalled();
  });

  // ── Loading State ───────────────────────────────────────────────────────────

  it('shows skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: null, isLoading: true });
    render(<AppointmentSettings role="hospital_admin" />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});
