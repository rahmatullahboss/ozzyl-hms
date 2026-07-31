import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SecuritySettings from './SecuritySettings';

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

const MOCK_SECURITY = {
  min_password_length: 8,
  require_uppercase: true,
  require_number: true,
  require_special_char: false,
  force_password_change_days: 90,
  session_timeout_minutes: 30,
  max_login_attempts: 5,
  lockout_duration_minutes: 15,
  two_factor_enabled: false,
  ip_restriction_enabled: false,
  allowed_ips: '',
};

describe('SecuritySettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: { settings: MOCK_SECURITY }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('renders the page title', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByText('Security Settings')).toBeInTheDocument();
  });

  it('renders all setting sections', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByText('Password Policy')).toBeInTheDocument();
    expect(screen.getByText('Session Settings')).toBeInTheDocument();
    expect(screen.getByText('Login Protection')).toBeInTheDocument();
    expect(screen.getByText('Two-Factor Authentication')).toBeInTheDocument();
  });

  // ── Password Policy ─────────────────────────────────────────────────────────

  it('shows minimum password length input', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByLabelText(/minimum password length/i)).toHaveValue(8);
  });

  it('shows password complexity toggles', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /uppercase/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /number/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /special/i })).toBeInTheDocument();
  });

  it('shows force password change days input', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByLabelText(/force password change/i)).toHaveValue(90);
  });

  // ── Session Settings ────────────────────────────────────────────────────────

  it('shows session timeout input', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByLabelText(/session timeout/i)).toHaveValue(30);
  });

  // ── Login Protection ────────────────────────────────────────────────────────

  it('shows max login attempts input', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByLabelText(/max login attempts/i)).toHaveValue(5);
  });

  it('shows lockout duration input', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByLabelText(/lockout duration/i)).toHaveValue(15);
  });

  // ── Two-Factor Auth ─────────────────────────────────────────────────────────

  it('shows 2FA toggle', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /two.factor/i })).toBeInTheDocument();
  });

  it('toggles 2FA when clicked', async () => {
    const user = userEvent.setup();
    render(<SecuritySettings role="hospital_admin" />);
    const toggle = screen.getByRole('switch', { name: /two.factor/i });
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(toggle).toBeChecked();
  });

  // ── IP Restriction ──────────────────────────────────────────────────────────

  it('shows IP restriction toggle', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /ip restriction/i })).toBeInTheDocument();
  });

  it('shows allowed IPs input when IP restriction is enabled', async () => {
    const user = userEvent.setup();
    render(<SecuritySettings role="hospital_admin" />);
    // Toggle IP restriction on
    await user.click(screen.getByRole('switch', { name: /ip restriction/i }));
    expect(screen.getByLabelText(/allowed ips/i)).toBeInTheDocument();
  });

  // ── Save ────────────────────────────────────────────────────────────────────

  it('shows save button', () => {
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('saves settings when save button is clicked', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<SecuritySettings role="hospital_admin" />);
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockMutate).toHaveBeenCalled();
  });

  // ── Loading State ───────────────────────────────────────────────────────────

  it('shows skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: null, isLoading: true });
    render(<SecuritySettings role="hospital_admin" />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});
