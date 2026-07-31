import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmailSettings from './EmailSettings';

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

const MOCK_EMAIL_SETTINGS = {
  email_provider: 'resend',
  email_from_name: 'City Care Hospital',
  email_from_address: 'noreply@citycare.test',
  email_api_key: '',
  email_smtp_host: '',
  email_smtp_port: '587',
  email_smtp_username: '',
  email_smtp_password: '',
  email_smtp_secure: 'true',
  email_enabled: 'true',
  email_appointment_reminder: 'true',
  email_lab_report_ready: 'true',
  email_invoice_sent: 'true',
  email_welcome_user: 'true',
  email_password_reset: 'true',
  email_due_reminder: 'false',
};

describe('EmailSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: { settings: MOCK_EMAIL_SETTINGS }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('renders the page title', () => {
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getByText('Email Settings')).toBeInTheDocument();
  });

  it('renders all setting sections', () => {
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getByRole('heading', { name: 'Email Provider' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Email Events' })).toBeInTheDocument();
  });

  // ── Provider Selection ──────────────────────────────────────────────────────

  it('shows provider selector with Resend and SMTP options', () => {
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/email provider/i)).toBeInTheDocument();
  });

  it('shows from name and from address fields', () => {
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/from name/i)).toHaveValue('City Care Hospital');
    expect(screen.getByLabelText(/from address/i)).toHaveValue('noreply@citycare.test');
  });

  // ── SMTP Configuration ──────────────────────────────────────────────────────

  it('shows SMTP section when SMTP provider is selected', async () => {
    const user = userEvent.setup();
    render(<EmailSettings role="hospital_admin" />);

    await user.selectOptions(screen.getByLabelText(/email provider/i), 'smtp');

    expect(screen.getByRole('heading', { name: 'SMTP Configuration' })).toBeInTheDocument();
    expect(screen.getByLabelText(/smtp host/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/smtp port/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/smtp username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/smtp password/i)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /use ssl\/tls/i })).toBeInTheDocument();
  });

  it('shows API key field when Resend provider is selected', () => {
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/api key/i)).toBeInTheDocument();
  });

  // ── Email Events ────────────────────────────────────────────────────────────

  it('shows all email event toggles', () => {
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /appointment reminder/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /lab report ready/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /invoice sent/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /welcome user/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /password reset/i })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /due reminder/i })).toBeInTheDocument();
  });

  it('toggles email events when clicked', async () => {
    const user = userEvent.setup();
    render(<EmailSettings role="hospital_admin" />);

    const dueToggle = screen.getByRole('switch', { name: /due reminder/i });
    expect(dueToggle).not.toBeChecked();
    await user.click(dueToggle);
    expect(dueToggle).toBeChecked();
  });

  // ── Test Email ──────────────────────────────────────────────────────────────

  it('shows test email section with send button', () => {
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/test email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send test email/i })).toBeInTheDocument();
  });

  it('sends test email when button is clicked', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<EmailSettings role="hospital_admin" />);
    await user.type(screen.getByLabelText(/test email address/i), 'test@example.com');
    await user.click(screen.getByRole('button', { name: /send test email/i }));

    expect(mockMutate).toHaveBeenCalled();
  });

  // ── Save ────────────────────────────────────────────────────────────────────

  it('shows save button', () => {
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('saves settings when save button is clicked', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<EmailSettings role="hospital_admin" />);
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockMutate).toHaveBeenCalled();
  });

  // ── Loading State ───────────────────────────────────────────────────────────

  it('shows skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: null, isLoading: true });
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  // ── Master Toggle ───────────────────────────────────────────────────────────

  it('shows master email enabled toggle', () => {
    render(<EmailSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /email enabled/i })).toBeInTheDocument();
  });

  it('disables event toggles when master email is off', async () => {
    const user = userEvent.setup();
    (useApiQuery as any).mockReturnValue({
      data: { settings: { ...MOCK_EMAIL_SETTINGS, email_enabled: 'false' } },
      isLoading: false,
    });
    render(<EmailSettings role="hospital_admin" />);

    const masterToggle = screen.getByRole('switch', { name: /email enabled/i });
    expect(masterToggle).not.toBeChecked();
  });
});
