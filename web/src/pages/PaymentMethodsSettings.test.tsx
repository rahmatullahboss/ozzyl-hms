import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PaymentMethodsSettings from './PaymentMethodsSettings';

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

const MOCK_METHODS = [
  { id: 1, name: 'Cash', code: 'cash', active: true, transaction_id_required: false, charge_applicable: false },
  { id: 2, name: 'bKash', code: 'bkash', active: true, transaction_id_required: true, charge_applicable: false },
  { id: 3, name: 'Nagad', code: 'nagad', active: true, transaction_id_required: true, charge_applicable: false },
  { id: 4, name: 'Rocket', code: 'rocket', active: false, transaction_id_required: true, charge_applicable: false },
  { id: 5, name: 'Card', code: 'card', active: true, transaction_id_required: false, charge_applicable: true },
  { id: 6, name: 'Bank Transfer', code: 'bank', active: false, transaction_id_required: true, charge_applicable: false },
];

describe('PaymentMethodsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: { methods: MOCK_METHODS }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('renders the page title', () => {
    render(<PaymentMethodsSettings role="hospital_admin" />);
    expect(screen.getByText('Payment Methods')).toBeInTheDocument();
  });

  it('renders all payment methods', () => {
    render(<PaymentMethodsSettings role="hospital_admin" />);
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('bKash')).toBeInTheDocument();
    expect(screen.getByText('Nagad')).toBeInTheDocument();
    expect(screen.getByText('Rocket')).toBeInTheDocument();
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText('Bank Transfer')).toBeInTheDocument();
  });

  it('shows active/inactive status toggles', () => {
    render(<PaymentMethodsSettings role="hospital_admin" />);
    // Active methods should have checked switches
    const cashSwitch = screen.getByRole('switch', { name: /Cash active/i });
    expect(cashSwitch).toBeChecked();
    // Inactive methods should have unchecked switches
    const rocketSwitch = screen.getByRole('switch', { name: /Rocket active/i });
    expect(rocketSwitch).not.toBeChecked();
  });

  // ── Toggle Active ───────────────────────────────────────────────────────────

  it('toggles payment method active status', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<PaymentMethodsSettings role="hospital_admin" />);
    const rocketRow = screen.getByText('Rocket').closest('tr')!;
    await user.click(within(rocketRow).getByRole('switch'));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      id: 4,
      active: true,
    }));
  });

  // ── Transaction ID Toggle ───────────────────────────────────────────────────

  it('shows transaction ID required indicator', () => {
    render(<PaymentMethodsSettings role="hospital_admin" />);
    const bkashRow = screen.getByText('bKash').closest('tr')!;
    expect(within(bkashRow).getByText('Required')).toBeInTheDocument();
  });

  // ── Charge Toggle ───────────────────────────────────────────────────────────

  it('shows charge applicable indicator', () => {
    render(<PaymentMethodsSettings role="hospital_admin" />);
    const cardRow = screen.getByText('Card').closest('tr')!;
    expect(within(cardRow).getByText('Yes')).toBeInTheDocument();
  });

  // ── Add Method ──────────────────────────────────────────────────────────────

  it('shows add payment method button', () => {
    render(<PaymentMethodsSettings role="hospital_admin" />);
    expect(screen.getByRole('button', { name: /Add Payment Method/i })).toBeInTheDocument();
  });

  it('opens add form when button is clicked', async () => {
    const user = userEvent.setup();
    render(<PaymentMethodsSettings role="hospital_admin" />);
    await user.click(screen.getByRole('button', { name: /Add Payment Method/i }));
    expect(screen.getByLabelText(/Method Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Code/i)).toBeInTheDocument();
  });

  // ── Edit Method ─────────────────────────────────────────────────────────────

  it('opens edit form when edit button is clicked', async () => {
    const user = userEvent.setup();
    render(<PaymentMethodsSettings role="hospital_admin" />);
    const cashRow = screen.getByText('Cash').closest('tr')!;
    await user.click(within(cashRow).getByRole('button', { name: /edit/i }));
    expect(screen.getByLabelText(/Method Name/i)).toHaveValue('Cash');
  });

  // ── Loading State ───────────────────────────────────────────────────────────

  it('shows skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: null, isLoading: true });
    render(<PaymentMethodsSettings role="hospital_admin" />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  // ── Empty State ─────────────────────────────────────────────────────────────

  it('shows empty state when no methods', () => {
    (useApiQuery as any).mockReturnValue({ data: { methods: [] }, isLoading: false });
    render(<PaymentMethodsSettings role="hospital_admin" />);
    expect(screen.getByText(/No payment methods/i)).toBeInTheDocument();
  });

  // ── Save ────────────────────────────────────────────────────────────────────

  it('saves new payment method when form is submitted', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<PaymentMethodsSettings role="hospital_admin" />);
    await user.click(screen.getByRole('button', { name: /Add Payment Method/i }));
    await user.type(screen.getByLabelText(/Method Name/i), 'SSLCommerz');
    await user.type(screen.getByLabelText(/Code/i), 'ssl');
    await user.click(screen.getByRole('button', { name: /^Save$/i }));
    expect(mockMutate).toHaveBeenCalled();
  });
});
