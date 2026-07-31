import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './SettingsPage';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: any) => ({
      title: 'Settings',
      adminSettingsTitle: 'Admin Settings',
    }[key] ?? opts?.defaultValue ?? key),
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ slug: 'city-hospital' }),
  };
});

vi.mock('../components/DashboardLayout', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="layout">{children}</div>,
}));

vi.mock('../hooks/useAuth', () => ({
  getTenant: () => ({ name: 'City Care Hospital', slug: 'city-hospital' }),
  getToken: () => 'token',
}));

vi.mock('../hooks/useTenantSlug', () => ({ getTenantSlugFromPath: () => 'city-hospital' }));
vi.mock('../lib/compressImage', () => ({ compressImage: vi.fn(async (file: File) => file) }));
vi.mock('../lib/pwaPrompt', () => ({ applyDynamicManifest: vi.fn(), applyPwaIcons: vi.fn() }));

const mockInvalidateQueries = vi.fn();
const mockMutate = vi.fn();
vi.mock('../hooks/useApiQuery', () => ({
  useApiQuery: vi.fn(),
  useApiMutation: vi.fn(),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { useApiQuery, useApiMutation } from '../hooks/useApiQuery';

const SETTINGS_RESPONSE = {
  settings: {
    hospital_logo_url: '/api/settings/logo',
    billing_invoice_prefix: 'INV',
    billing_invoice_reset: 'monthly',
    billing_currency: 'BDT',
    billing_vat_enabled: 'true',
    billing_discount_enabled: 'true',
    billing_due_allowed: 'true',
    billing_refund_allowed: 'false',
    sms_provider_name: 'BulkSMS BD',
    sms_sender_id: 'CITYCARE',
  },
  hospital_info: {
    name: 'City Care Hospital',
    short_name: 'CCH',
    address: 'Dhaka, Bangladesh',
    phone: '01700000000',
    email: 'info@citycare.test',
    website: 'https://citycare.test',
    registration_number: 'LIC-123',
    bin_tin: 'TIN-456',
    tagline: 'Care with trust',
    footer_text: 'Thank you for choosing City Care',
  },
  notifications: {
    low_stock: true,
    daily_summary: false,
    new_patient: true,
    failed_login: true,
  },
};

describe('SettingsPage control room', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: SETTINGS_RESPONSE, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });
  });

  it('renders the MVP admin-control cards from the blueprint', () => {
    render(<SettingsPage role="hospital_admin" />);

    expect(screen.getByRole('heading', { name: 'Admin Settings' })).toBeInTheDocument();

    [
      'Hospital Profile',
      'Users & Roles',
      'Permission Matrix',
      'Department Setup',
      'Doctor Setup',
      'Service & Pricing',
      'Billing Settings',
      'Payment Methods',
      'Lab Test Setup',
      'Print Settings',
      'Audit Log',
      'Backup',
      'System Prefix Settings',
    ].forEach((label) => {
      expect(screen.getByRole('button', { name: new RegExp(label, 'i') })).toBeInTheDocument();
    });
  });

  it('shows blueprint breadcrumbs for settings search results', async () => {
    const user = userEvent.setup();
    render(<SettingsPage role="hospital_admin" />);

    await user.type(screen.getByRole('searchbox', { name: /search settings/i }), 'discount');

    expect(screen.getByText('Search results')).toBeInTheDocument();
    expect(screen.getByText('Finance > Discount Rules')).toBeInTheDocument();
    expect(screen.getByText('People > Permission Matrix')).toBeInTheDocument();
    expect(screen.getByText('System > Report Access Control')).toBeInTheDocument();
  });

  it('opens hospital profile with a live print header preview and preview actions', async () => {
    const user = userEvent.setup();
    render(<SettingsPage role="hospital_admin" />);

    await user.click(screen.getByRole('button', { name: /hospital profile/i }));

    expect(screen.getByText('Live Header Preview')).toBeInTheDocument();
    expect(screen.getByText('City Care Hospital')).toBeInTheDocument();
    expect(screen.getByText('Dhaka, Bangladesh')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview invoice header/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /preview prescription header/i })).toBeInTheDocument();
  });

  it('opens billing settings with all sensitive rule sections', async () => {
    const user = userEvent.setup();
    render(<SettingsPage role="hospital_admin" />);

    await user.click(screen.getByRole('button', { name: /billing settings/i }));

    const billingPanel = screen.getByRole('region', { name: /billing settings/i });
    [
      'Invoice Number',
      'Payment Methods',
      'Discount Rules',
      'Due Rules',
      'Refund & Cancel Rules',
      'VAT / Tax',
    ].forEach((section) => {
      expect(within(billingPanel).getByRole('button', { name: new RegExp(section, 'i') })).toBeInTheDocument();
    });
    expect(within(billingPanel).getByText(/critical finance settings/i)).toBeInTheDocument();
  });

  it('opens routed inline panels when an admin settings subroute selects one', () => {
    const { rerender } = render(<SettingsPage role="hospital_admin" initialPanel="billing-settings" />);

    expect(screen.getByRole('region', { name: /billing settings/i })).toBeInTheDocument();
    expect(screen.getByText('Refund & Cancel Rules')).toBeInTheDocument();

    rerender(<SettingsPage role="hospital_admin" initialPanel="sms-settings" />);
    expect(screen.getByRole('region', { name: /sms settings/i })).toBeInTheDocument();
    expect(screen.getByText('{patient_name}')).toBeInTheDocument();
  });

  it('opens SMS settings with gateway fields, variables, and test action', async () => {
    const user = userEvent.setup();
    render(<SettingsPage role="hospital_admin" />);

    await user.click(screen.getByRole('button', { name: /sms settings/i }));

    expect(screen.getByRole('region', { name: /sms settings/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/provider name/i)).toHaveValue('BulkSMS BD');
    expect(screen.getByText('{patient_name}')).toBeInTheDocument();
    expect(screen.getByText('{doctor_name}')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send test sms/i })).toBeInTheDocument();
  });
});
