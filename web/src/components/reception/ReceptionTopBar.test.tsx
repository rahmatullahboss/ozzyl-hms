import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReceptionTopBar from './ReceptionTopBar';

const mockUseApiQuery = vi.hoisted(() => vi.fn(() => ({ data: undefined, isLoading: false })));
const mockUseApiMutation = vi.hoisted(() => vi.fn(() => ({ mutate: vi.fn(), isPending: false })));
const mockQueryClient = vi.hoisted(() => ({ invalidateQueries: vi.fn() }));
const mockNavigate = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());
const mockAuthUser = vi.hoisted(() => ({
  current: { userId: '42', role: 'reception', permissions: [] as string[] },
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k }) }));
vi.mock('react-hot-toast', () => ({ default: { success: mockToastSuccess, error: mockToastError } }));
vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ slug: 'demo-hospital' }) };
});
vi.mock('../../hooks/useApiQuery', () => ({
  useApiQuery: (...args: unknown[]) => mockUseApiQuery(...args),
  useApiMutation: (...args: unknown[]) => mockUseApiMutation(...args),
  useQueryClient: () => mockQueryClient,
}));
vi.mock('../../lib/handover', () => ({ getRoleBasePath: () => '/h/demo-hospital/reception' }));
vi.mock('../../hooks/useAuth', () => ({
  logout: vi.fn(),
  useAuth: () => ({
    isAuthenticated: true,
    user: mockAuthUser.current,
    token: 'test-token',
  }),
}));
vi.mock('./ReceptionPatientDrawer', () => ({ default: () => <div data-testid="patient-drawer" /> }));

const MOCK_LOCAL_PATIENTS = [
  { id: 1, name: 'Rahim Khan', patient_code: 'P001', mobile: '01712345678', age: 30, gender: 'male' },
];

const MOCK_GLOBAL_PATIENTS = [
  { id: 100, uhid: 'UHID-001', primary_name: 'Salman Ahmed', primary_phone: '01812345678', primary_email: null, date_of_birth: '1996-07-06', gender: 'male', linked_patient_id: null },
];

function renderTopBar(props: Partial<React.ComponentProps<typeof ReceptionTopBar>> = {}) {
  return render(
    <MemoryRouter>
      <ReceptionTopBar role="reception" {...props} />
    </MemoryRouter>,
  );
}

describe('ReceptionTopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: false });
    mockUseApiMutation.mockReturnValue({ mutate: vi.fn(), isPending: false });
    mockAuthUser.current = { userId: '42', role: 'reception', permissions: [] };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders search input with EMR placeholder and no large drawer outflow panel', () => {
    renderTopBar();
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i);
    expect(input).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /Search Patient/i })).toBe(input);
    expect(screen.queryByText('Controlled Drawer Outflows')).not.toBeInTheDocument();
  });

  it('docks the reception command bar without a downward sticky offset', () => {
    const { container } = renderTopBar();
    const commandBar = container.querySelector('.sticky');
    expect(commandBar?.className).toContain('top-0');
    expect(commandBar?.className).not.toContain('top-2');
  });

  it('renders emergency siren icon when onQuickAdmit is provided', () => {
    renderTopBar({ onQuickAdmit: vi.fn() });
    const button = screen.getByRole('button', { name: 'Emergency Quick Admit' });
    expect(button).toBeInTheDocument();
  });

  it('does not render emergency siren icon when onQuickAdmit is not provided', () => {
    renderTopBar();
    const button = screen.queryByTitle('Emergency Quick Admit');
    expect(button).not.toBeInTheDocument();
  });

  it('calls onQuickAdmit when siren icon is clicked', () => {
    const onQuickAdmit = vi.fn();
    renderTopBar({ onQuickAdmit });
    const button = screen.getByTitle('Emergency Quick Admit');
    fireEvent.click(button);
    expect(onQuickAdmit).toHaveBeenCalled();
  });

  it('calls onQuickAdmit when user types EMR and presses Enter', () => {
    const onQuickAdmit = vi.fn();
    renderTopBar({ onQuickAdmit });
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i);
    fireEvent.change(input, { target: { value: 'EMR' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQuickAdmit).toHaveBeenCalled();
  });

  it('does not call onQuickAdmit for non-EMR input on Enter', () => {
    const onQuickAdmit = vi.fn();
    renderTopBar({ onQuickAdmit });
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i);
    fireEvent.change(input, { target: { value: 'some patient' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onQuickAdmit).not.toHaveBeenCalled();
  });

  it('clears search after EMR triggers quick admit', () => {
    const onQuickAdmit = vi.fn();
    renderTopBar({ onQuickAdmit });
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'EMR' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('');
  });

  it('disables siren button when quickAdmitPending is true', () => {
    renderTopBar({ onQuickAdmit: vi.fn(), quickAdmitPending: true });
    const button = screen.getByTitle('Emergency Quick Admit');
    expect(button).toBeDisabled();
  });

  it('opens inactive counter rows through the billing counter activation page', () => {
    mockUseApiQuery.mockImplementation((keys: string[]) => {
      if (keys[1] === 'active-session') return { data: { active: false, session: null }, isLoading: false };
      if (keys[1] === 'all-with-counters') {
        return {
          data: {
            counters: [
              {
                id: 7,
                counter_name: 'Reception',
                counter_code: 'BILL-1',
                counter_type: 'billing',
                location: 'Front desk',
                active_session: null,
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: /Open counter/i }));
    const inactiveRowActions = screen.getByText('Inactive').parentElement;
    expect(inactiveRowActions).not.toBeNull();

    fireEvent.click(within(inactiveRowActions!).getByRole('button', { name: /Open counter/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/h/demo-hospital/reception/billing-counter?counterId=7');
    expect(screen.queryByText(/No active shift found/i)).not.toBeInTheDocument();
  });

  it('marks the current user active counter as yours even when active-session cache is stale', () => {
    mockUseApiQuery.mockImplementation((keys: string[]) => {
      if (keys[1] === 'active-session') return { data: { active: false, session: null }, isLoading: false };
      if (keys[1] === 'all-with-counters') {
        return {
          data: {
            counters: [
              {
                id: 7,
                counter_name: 'Reception',
                counter_code: 'BILL-1',
                counter_type: 'billing',
                location: 'Front desk',
                active_session: {
                  id: 17,
                  employee_id: 42,
                  employee_name: 'Nusrat Jahan Soni',
                  employee_role: 'reception',
                  opening_cash: 100,
                  expected_cash: 500,
                  opened_at: '2026-06-03 10:00:00',
                  session_no: 'BCS-17',
                },
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: /Shift Active/i }));

    expect(screen.getByText('Yours')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Take Over/i })).not.toBeInTheDocument();
  });

  it('shows Take Over action for manager default permissions on another active counter', () => {
    mockAuthUser.current = { userId: '99', role: 'manager', permissions: [] };
    mockUseApiQuery.mockImplementation((keys: string[]) => {
      if (keys[1] === 'active-session') return { data: { active: false, session: null }, isLoading: false };
      if (keys[1] === 'all-with-counters') {
        return {
          data: {
            counters: [
              {
                id: 7,
                counter_name: 'Reception',
                counter_code: 'BILL-1',
                counter_type: 'billing',
                location: 'Front desk',
                active_session: {
                  id: 17,
                  employee_id: 42,
                  employee_name: 'Nusrat Jahan Soni',
                  employee_role: 'reception',
                  opening_cash: 100,
                  expected_cash: 500,
                  opened_at: '2026-06-03 10:00:00',
                  session_no: 'BCS-17',
                },
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    renderTopBar({ role: 'manager' });
    fireEvent.click(screen.getByRole('button', { name: /Open counter/i }));

    expect(screen.getByRole('button', { name: /Take Over/i })).toBeInTheDocument();
  });

  it('shows Cash Operations action for the current active counter', () => {
    mockUseApiQuery.mockImplementation((keys: string[]) => {
      if (keys[1] === 'active-session') return { data: { active: true, session: { id: 17, counterName: 'Reception', expectedCash: 500 } }, isLoading: false };
      if (keys[1] === 'all-with-counters') {
        return {
          data: {
            counters: [
              {
                id: 7,
                counter_name: 'Reception',
                counter_code: 'BILL-1',
                counter_type: 'billing',
                location: 'Front desk',
                active_session: {
                  id: 17,
                  employee_id: 42,
                  employee_name: 'Nusrat Jahan Soni',
                  employee_role: 'reception',
                  opening_cash: 100,
                  expected_cash: 500,
                  opened_at: '2026-06-03 10:00:00',
                  session_no: 'BCS-17',
                },
              },
            ],
          },
          isLoading: false,
        };
      }
      return { data: undefined, isLoading: false };
    });

    renderTopBar();
    fireEvent.click(screen.getByRole('button', { name: /Shift Active/i }));
    fireEvent.click(screen.getByRole('button', { name: /Cash Operations/i }));

    expect(mockNavigate).toHaveBeenCalledWith('/h/demo-hospital/reception/cash-operations');
  });

  it('keeps shift handover modal focused on close and reconciliation only', () => {
    mockUseApiQuery.mockImplementation((keys: string[]) => {
      if (keys[1] === 'active-session') return { data: { active: true, session: { id: 17, counterName: 'Reception', expectedCash: 500, heldRefundCash: 80, availableCash: 420 } }, isLoading: false };
      if (keys[1] === 'handover-recipients') {
        return { data: { recipients: [{ id: 9, name: 'Next Cashier', role: 'reception' }] }, isLoading: false };
      }
      return { data: undefined, isLoading: false };
    });

    renderTopBar({ initialShiftModalOpen: true } as Partial<React.ComponentProps<typeof ReceptionTopBar>>);

    expect(screen.getByRole('heading', { name: /shift handover/i })).toBeInTheDocument();
    expect(screen.queryByText(/expense payment/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/doctor payout/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/drawer adjustment/i)).not.toBeInTheDocument();
    expect(screen.getByText('Expected drawer cash')).toBeInTheDocument();
    expect(screen.getByText('Pending refund reserve')).toBeInTheDocument();
    expect(screen.getByText('Available handover cash')).toBeInTheDocument();
    expect(screen.getByText('৳80')).toBeInTheDocument();
    expect(screen.getByText('৳420')).toBeInTheDocument();
    expect(screen.getByLabelText('Available cash counted for handover')).toHaveAttribute('placeholder', '420');
    expect(screen.getByLabelText('Handover To *')).toBeInTheDocument();
  });

  it('shows accept handover into current drawer copy when the user already has an active counter', () => {
    mockUseApiQuery.mockImplementation((keys: string[]) => {
      if (keys[1] === 'active-session') {
        return { data: { active: true, session: { id: 17, counterName: 'Reception', expectedCash: 500 } }, isLoading: false };
      }
      if (keys[1] === 'pending-handovers') {
        return {
          data: {
            handovers: [{
              id: 55,
              handover_by_name: 'Previous Cashier',
              handover_amount: 1200,
              due_amount: 0,
              counter_name: 'Main Billing Counter',
            }],
          },
          isLoading: false,
        };
      }
      if (keys[1] === 'session-movements') return { data: { movements: [] }, isLoading: false };
      return { data: undefined, isLoading: false };
    });

    renderTopBar();

    expect(screen.getByRole('dialog', { name: 'Pending Handover' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'গ্রহণ করে বর্তমান ড্রয়ারে যোগ করুন' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept & Start Shift' })).not.toBeInTheDocument();
  });

});

describe('ReceptionTopBar — Global Search Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: false });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('enables global search only for 11-digit number input', async () => {
    renderTopBar();
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i);

    fireEvent.change(input, { target: { value: '01739416661' } });
    await act(async () => { vi.advanceTimersByTime(800); });

    const globalCalls = mockUseApiQuery.mock.calls.filter(
      ([keys]: [string[]]) => Array.isArray(keys) && keys[1] === 'top-global-search',
    );
    expect(globalCalls.length).toBeGreaterThanOrEqual(1);
    const lastGlobalCall = globalCalls[globalCalls.length - 1];
    expect(lastGlobalCall[2]).toEqual({ enabled: true, staleTime: 60_000 });
  });

  it('disables global search for name input', () => {
    renderTopBar();
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i);

    fireEvent.change(input, { target: { value: 'Rahim' } });
    act(() => { vi.advanceTimersByTime(700); });

    const globalCall = mockUseApiQuery.mock.calls.find(
      ([keys]: [string[]]) => Array.isArray(keys) && keys[1] === 'top-global-search',
    );
    expect(globalCall).toBeDefined();
    expect(globalCall![2]).toEqual({ enabled: false, staleTime: 60_000 });
  });

  it('disables global search for partial number (not 11 digits)', () => {
    renderTopBar();
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i);

    fireEvent.change(input, { target: { value: '01739' } });
    act(() => { vi.advanceTimersByTime(700); });

    const globalCall = mockUseApiQuery.mock.calls.find(
      ([keys]: [string[]]) => Array.isArray(keys) && keys[1] === 'top-global-search',
    );
    expect(globalCall).toBeDefined();
    expect(globalCall![2]).toEqual({ enabled: false, staleTime: 60_000 });
  });

  it('hides global results when local results exist', () => {
    mockUseApiQuery.mockImplementation((keys: string[]) => {
      if (keys[1] === 'top-search') return { data: { patients: MOCK_LOCAL_PATIENTS }, isLoading: false };
      if (keys[1] === 'top-global-search') return { data: { results: MOCK_GLOBAL_PATIENTS }, isLoading: false };
      return { data: undefined, isLoading: false };
    });

    renderTopBar();
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i);

    fireEvent.change(input, { target: { value: '01739416661' } });
    act(() => { vi.advanceTimersByTime(700); });

    expect(screen.getByText('This Hospital')).toBeInTheDocument();
    expect(screen.getByText('Rahim Khan')).toBeInTheDocument();
    expect(screen.getByText('30 yrs')).toBeInTheDocument();
    expect(screen.queryByText('Global Registry')).not.toBeInTheDocument();
    expect(screen.queryByText('Salman Ahmed')).not.toBeInTheDocument();
  });

  it('shows global results when no local results and 11-digit input', () => {
    vi.setSystemTime(new Date('2026-07-06T12:00:00Z'));
    mockUseApiQuery.mockImplementation((keys: string[]) => {
      if (keys[1] === 'top-search') return { data: { patients: [] }, isLoading: false };
      if (keys[1] === 'top-global-search') return { data: { results: MOCK_GLOBAL_PATIENTS }, isLoading: false };
      return { data: undefined, isLoading: false };
    });

    renderTopBar();
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i);

    fireEvent.change(input, { target: { value: '01739416661' } });
    act(() => { vi.advanceTimersByTime(700); });

    expect(screen.getByText('Global Registry')).toBeInTheDocument();
    expect(screen.getByText('Salman Ahmed')).toBeInTheDocument();
    expect(screen.getByText('30 yrs')).toBeInTheDocument();
    expect(screen.queryByText('This Hospital')).not.toBeInTheDocument();
  });

  it('shows "Add new patient" when no local and no global results', () => {
    mockUseApiQuery.mockReturnValue({ data: undefined, isLoading: false });

    renderTopBar();
    const input = screen.getByPlaceholderText(/Type 'EMR' for Emergency/i);

    fireEvent.change(input, { target: { value: '01739416661' } });
    act(() => { vi.advanceTimersByTime(700); });

    expect(screen.getByText(/Add new patient for/)).toBeInTheDocument();
  });
});
