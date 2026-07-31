import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepartmentsSettings from './DepartmentsSettings';

// ─── Mocks ──────────────────────────────────────────────────────────────────────

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

const MOCK_DEPARTMENTS = [
  { id: 1, name: 'Medicine', code: 'MED', opd: true, ipd: true, status: 'active' },
  { id: 2, name: 'Surgery', code: 'SUR', opd: true, ipd: true, status: 'active' },
  { id: 3, name: 'Gynecology', code: 'GYN', opd: true, ipd: false, status: 'active' },
  { id: 4, name: 'Pediatrics', code: 'PED', opd: true, ipd: true, status: 'inactive' },
];

describe('DepartmentsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (useApiQuery as any).mockReturnValue({ data: { departments: MOCK_DEPARTMENTS }, isLoading: false });
    (useApiMutation as any).mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  // ── Rendering ───────────────────────────────────────────────────────────────

  it('renders the page title', () => {
    render(<DepartmentsSettings role="hospital_admin" />);
    expect(screen.getByText('Departments')).toBeInTheDocument();
  });

  it('renders the department list table', () => {
    render(<DepartmentsSettings role="hospital_admin" />);
    expect(screen.getByText('Medicine')).toBeInTheDocument();
    expect(screen.getByText('Surgery')).toBeInTheDocument();
    expect(screen.getByText('Gynecology')).toBeInTheDocument();
    expect(screen.getByText('Pediatrics')).toBeInTheDocument();
  });

  it('shows department codes in the table', () => {
    render(<DepartmentsSettings role="hospital_admin" />);
    expect(screen.getByText('MED')).toBeInTheDocument();
    expect(screen.getByText('SUR')).toBeInTheDocument();
  });

  it('shows OPD/IPD availability badges', () => {
    render(<DepartmentsSettings role="hospital_admin" />);
    // Gynecology has OPD=Yes, IPD=No
    const gynRow = screen.getByText('Gynecology').closest('tr')!;
    expect(within(gynRow).getByText('Yes')).toBeInTheDocument();
  });

  it('shows status badges', () => {
    render(<DepartmentsSettings role="hospital_admin" />);
    const activeBadges = screen.getAllByText('active');
    expect(activeBadges.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('inactive')).toBeInTheDocument();
  });

  // ── Add Department ──────────────────────────────────────────────────────────

  it('shows add department button', () => {
    render(<DepartmentsSettings role="hospital_admin" />);
    expect(screen.getByRole('button', { name: /Add Department/i })).toBeInTheDocument();
  });

  it('opens add form when add button is clicked', async () => {
    const user = userEvent.setup();
    render(<DepartmentsSettings role="hospital_admin" />);

    await user.click(screen.getByRole('button', { name: /Add Department/i }));

    expect(screen.getByLabelText(/Department Name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Department Code/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/OPD/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/IPD/i)).toBeInTheDocument();
  });

  it('validates required fields on submit', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<DepartmentsSettings role="hospital_admin" />);
    await user.click(screen.getByRole('button', { name: /Add Department/i }));
    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('submits new department with valid data', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<DepartmentsSettings role="hospital_admin" />);
    await user.click(screen.getByRole('button', { name: /Add Department/i }));

    await user.type(screen.getByLabelText(/Department Name/i), 'Cardiology');
    await user.type(screen.getByLabelText(/Department Code/i), 'CAR');
    await user.click(screen.getByLabelText(/OPD/i));
    await user.click(screen.getByLabelText(/IPD/i));

    await user.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Cardiology',
      code: 'CAR',
      opd: true,
      ipd: true,
      status: 'active',
    }));
  });

  // ── Edit Department ─────────────────────────────────────────────────────────

  it('opens edit form when edit button is clicked', async () => {
    const user = userEvent.setup();
    render(<DepartmentsSettings role="hospital_admin" />);

    const medicineRow = screen.getByText('Medicine').closest('tr')!;
    await user.click(within(medicineRow).getByRole('button', { name: /edit/i }));

    expect(screen.getByLabelText(/Department Name/i)).toHaveValue('Medicine');
    expect(screen.getByLabelText(/Department Code/i)).toHaveValue('MED');
  });

  // ── Status Toggle ───────────────────────────────────────────────────────────

  it('toggles department status when status button is clicked', async () => {
    const user = userEvent.setup();
    const mockMutate = vi.fn();
    (useApiMutation as any).mockReturnValue({ mutate: mockMutate, isPending: false });

    render(<DepartmentsSettings role="hospital_admin" />);

    const pedRow = screen.getByText('Pediatrics').closest('tr')!;
    await user.click(within(pedRow).getByRole('button', { name: /activate/i }));

    expect(mockMutate).toHaveBeenCalledWith(expect.objectContaining({
      id: 4,
      status: 'active',
    }));
  });

  // ── No Delete Option ────────────────────────────────────────────────────────

  it('does not show delete buttons (uses inactive instead)', () => {
    render(<DepartmentsSettings role="hospital_admin" />);
    expect(screen.queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  // ── Loading State ───────────────────────────────────────────────────────────

  it('shows skeleton when loading', () => {
    (useApiQuery as any).mockReturnValue({ data: null, isLoading: true });
    render(<DepartmentsSettings role="hospital_admin" />);
    expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
  });

  // ── Empty State ─────────────────────────────────────────────────────────────

  it('shows empty state when no departments', () => {
    (useApiQuery as any).mockReturnValue({ data: { departments: [] }, isLoading: false });
    render(<DepartmentsSettings role="hospital_admin" />);
    expect(screen.getByText(/No departments found/i)).toBeInTheDocument();
  });

  // ── Search ──────────────────────────────────────────────────────────────────

  it('filters departments by search query', async () => {
    const user = userEvent.setup();
    render(<DepartmentsSettings role="hospital_admin" />);

    const searchInput = screen.getByPlaceholderText(/search/i);
    await user.type(searchInput, 'Med');

    expect(screen.getByText('Medicine')).toBeInTheDocument();
    expect(screen.queryByText('Surgery')).not.toBeInTheDocument();
  });

  // ── Cancel Form ─────────────────────────────────────────────────────────────

  it('closes form when cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<DepartmentsSettings role="hospital_admin" />);

    await user.click(screen.getByRole('button', { name: /Add Department/i }));
    expect(screen.getByLabelText(/Department Name/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(screen.queryByLabelText(/Department Name/i)).not.toBeInTheDocument();
  });
});
