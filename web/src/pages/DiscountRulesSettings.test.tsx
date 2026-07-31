import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DiscountRulesSettings from './DiscountRulesSettings';

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

const MOCK_RULES = {
  cashier_can_discount: true,
  max_discount_amount: 500,
  max_discount_percentage: 10,
  discount_reason_mandatory: true,
  approval_required_above: 1000,
  due_allowed_opd: true,
  due_allowed_ipd: true,
  due_allowed_pharmacy: false,
  due_collection_reminder: true,
  refund_allowed: true,
  refund_approval_required: true,
  invoice_cancel_allowed_within_hours: 24,
  cancel_reason_mandatory: true,
  cancel_approval_required: true,
};

describe('DiscountRulesSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: { settings: MOCK_RULES }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('renders the page title', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByText('Discount & Due Rules')).toBeInTheDocument();
  });

  it('renders all setting sections', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByText('Discount Rules')).toBeInTheDocument();
    expect(screen.getByText('Due Rules')).toBeInTheDocument();
    expect(screen.getByText('Refund & Cancel Rules')).toBeInTheDocument();
  });

  // ── Discount Rules ──────────────────────────────────────────────────────────

  it('shows cashier can discount toggle', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /cashier can discount/i })).toBeChecked();
  });

  it('shows max discount amount input', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/max discount amount/i)).toHaveValue(500);
  });

  it('shows max discount percentage input', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/max discount percentage/i)).toHaveValue(10);
  });

  it('shows discount reason mandatory toggle', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /Discount Reason Mandatory/i })).toBeChecked();
  });

  it('shows approval required above input', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/approval required above/i)).toHaveValue(1000);
  });

  // ── Due Rules ───────────────────────────────────────────────────────────────

  it('shows due allowed toggles for each module', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /due.*opd/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /due.*ipd/i })).toBeChecked();
    expect(screen.getByRole('switch', { name: /due.*pharmacy/i })).not.toBeChecked();
  });

  it('shows due collection reminder toggle', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /due collection reminder/i })).toBeChecked();
  });

  // ── Refund & Cancel Rules ───────────────────────────────────────────────────

  it('shows refund allowed toggle', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /refund allowed/i })).toBeChecked();
  });

  it('shows refund approval required toggle', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /refund approval/i })).toBeChecked();
  });

  it('shows invoice cancel allowed within hours input', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByLabelText(/cancel allowed within/i)).toHaveValue(24);
  });

  it('shows cancel reason mandatory toggle', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /cancel reason/i })).toBeChecked();
  });

  it('shows cancel approval required toggle', () => {
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getByRole('switch', { name: /cancel approval/i })).toBeChecked();
  });

  // ── Toggle ──────────────────────────────────────────────────────────────────

  it('toggles settings when clicked', async () => {
    const user = userEvent.setup();
    render(<DiscountRulesSettings role="hospital_admin" />);
    const toggle = screen.getByRole('switch', { name: /cashier can discount/i });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
  });

  // ── Save ────────────────────────────────────────────────────────────────────

  it('saves settings when save button is clicked', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<DiscountRulesSettings role="hospital_admin" />);
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(mockMutate).toHaveBeenCalled();
  });

  // ── Loading State ───────────────────────────────────────────────────────────

  it('shows skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: null, isLoading: true });
    render(<DiscountRulesSettings role="hospital_admin" />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });
});
